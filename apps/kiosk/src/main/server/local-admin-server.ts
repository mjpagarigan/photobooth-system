import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { UploadJobSummary } from '@grace-booth/shared';

import type { AdminSessionService } from '../auth/admin-sessions.js';
import type { PasscodeService } from '../auth/passcode-service.js';
import type { UploadQueue } from '../cloud/upload-queue.js';
import type { LocalRepository, StoredUploadJob } from '../database/repositories.js';
import { AppError } from '../errors.js';
import type { FrameService } from '../frame/frame-service.js';
import type { HealthService } from '../health-service.js';
import { assertPrivateIpv4, validateAdminRequestBoundary } from './network-boundary.js';

const LoginSchema = z.object({ passcode: z.string().min(8).max(64) }).strict();
const RetrySchema = z.object({ uploadJobId: z.uuid() }).strict();
const SettingsSchema = z
  .object({
    googleFormsUrl: z.string().max(2_048).nullable(),
    lanEnabled: z.boolean(),
    lanBindHost: z.ipv4(),
    lanPort: z.number().int().min(1_024).max(65_535),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

export type LocalAdminDependencies = {
  passcodes: PasscodeService;
  sessions: AdminSessionService;
  repository: LocalRepository;
  frames: FrameService;
  health: HealthService;
  uploadQueue: UploadQueue;
  onNetworkSettingsChanged(): void;
  listenerHealth?(): AdminListenerHealth;
};

export type AdminListenerHealth = {
  loopback: 'healthy' | 'unavailable';
  lan: 'disabled' | 'healthy' | 'unavailable';
  code: string | null;
  message: string;
};

export type LocalAdminListenerOptions = {
  host: string;
  port: number;
  tls: { pfx: Buffer; passphrase: string } | null;
};

export async function startLocalAdminListener(
  dependencies: LocalAdminDependencies,
  options: LocalAdminListenerOptions,
): Promise<FastifyInstance> {
  const server = (
    options.tls
      ? Fastify({
          logger: false,
          bodyLimit: 64 * 1_024,
          trustProxy: false,
          https: { pfx: options.tls.pfx, passphrase: options.tls.passphrase },
        })
      : Fastify({ logger: false, bodyLimit: 64 * 1_024, trustProxy: false })
  ) as FastifyInstance;
  const secure = options.tls !== null;
  const cookieName = secure ? '__Host-grace_admin' : 'grace_admin_loopback';

  server.addHook('onRequest', async (request, reply) => {
    const result = validateAdminRequestBoundary(options, {
      method: request.method,
      host: request.headers.host,
      origin: request.headers.origin,
      remoteAddress: request.raw.socket.remoteAddress,
    });
    if (!result.allowed) {
      return reply.code(403).send({ ok: false, message: 'This admin request is not allowed.' });
    }
  });

  await server.register(cookie);
  await server.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: secure ? { maxAge: 31_536_000, includeSubDomains: false } : false,
  });
  await server.register(rateLimit, { global: true, max: 120, timeWindow: '1 minute' });

  server.get('/', async (_request, reply) => {
    return reply.type('text/html; charset=utf-8').send(ADMIN_HTML);
  });
  server.get('/admin.css', async (_request, reply) => {
    return reply.type('text/css; charset=utf-8').send(ADMIN_CSS);
  });
  server.get('/admin.js', async (_request, reply) => {
    return reply.type('application/javascript; charset=utf-8').send(ADMIN_JS);
  });

  server.post(
    '/api/login',
    { config: { rateLimit: { max: 5, timeWindow: '5 minutes' } } },
    async (request, reply) => {
      try {
        const { passcode } = LoginSchema.parse(request.body);
        const attemptKey = `web:${request.ip}`;
        dependencies.sessions.assertLoginAllowed(attemptKey);
        const valid = await dependencies.passcodes.verify(passcode);
        dependencies.sessions.recordLoginResult(attemptKey, valid);
        if (!valid) throw new AppError('invalid_passcode', 'The passcode is incorrect.');
        const session = dependencies.sessions.createWebSession();
        reply.setCookie(cookieName, session.cookieValue, {
          path: '/',
          httpOnly: true,
          secure,
          sameSite: 'strict',
          maxAge: 8 * 60 * 60,
        });
        return { ok: true, csrfToken: session.csrfToken, expiresAt: session.expiresAt };
      } catch (error) {
        return sendSafeError(reply, error);
      }
    },
  );

  server.get('/api/overview', async (request, reply) => {
    try {
      requireSession(
        dependencies.sessions,
        request.cookies[cookieName],
        request.headers['x-csrf-token'],
      );
      const settings = dependencies.repository.getSettings();
      const frame =
        dependencies.repository.getActiveFrame() ??
        (await dependencies.frames.ensureDefaultFrame());
      return {
        ok: true,
        settings: {
          googleFormsUrl: settings.googleFormsUrl,
          localRetentionDays: 60,
          cloudRetentionDays: 30,
          lan: {
            enabled: settings.lanEnabled,
            bindHost: settings.lanBindHost,
            port: settings.lanPort,
            tlsConfigured: settings.lanTlsSecretRef !== null,
            certificateFingerprint: settings.lanCertificateFingerprint,
          },
          activeFrame: dependencies.frames.toSummary(frame),
          revision: settings.revision,
        },
        uploadJobs: dependencies.repository.listUploadJobs(50).map(toUploadJobSummary),
        health: await dependencies.health.getHealth(),
        listener: dependencies.listenerHealth?.() ?? null,
      };
    } catch (error) {
      return sendSafeError(reply, error);
    }
  });

  server.post('/api/retry-upload', async (request, reply) => {
    try {
      requireSession(
        dependencies.sessions,
        request.cookies[cookieName],
        request.headers['x-csrf-token'],
      );
      const { uploadJobId } = RetrySchema.parse(request.body);
      const job = dependencies.repository.retryUpload(uploadJobId);
      dependencies.uploadQueue.wake();
      return { ok: true, job: toUploadJobSummary(job) };
    } catch (error) {
      return sendSafeError(reply, error);
    }
  });

  server.post('/api/settings', async (request, reply) => {
    try {
      requireSession(
        dependencies.sessions,
        request.cookies[cookieName],
        request.headers['x-csrf-token'],
      );
      const input = SettingsSchema.parse(request.body);
      if (input.lanEnabled) {
        assertPrivateIpv4(input.lanBindHost);
        if (!dependencies.repository.getSettings().lanTlsSecretRef) {
          throw new AppError('lan_tls_required', 'Choose a PFX certificate on the booth first.');
        }
      }
      const settings = dependencies.repository.updateSettings(input);
      setTimeout(() => dependencies.onNetworkSettingsChanged(), 100);
      return { ok: true, revision: settings.revision };
    } catch (error) {
      return sendSafeError(reply, error);
    }
  });

  server.post('/api/logout', async (request, reply) => {
    try {
      requireSession(
        dependencies.sessions,
        request.cookies[cookieName],
        request.headers['x-csrf-token'],
      );
      dependencies.sessions.logoutWeb(request.cookies[cookieName]);
      reply.clearCookie(cookieName, { path: '/', secure, sameSite: 'strict' });
      return { ok: true };
    } catch (error) {
      return sendSafeError(reply, error);
    }
  });

  server.setNotFoundHandler(async (_request, reply) =>
    reply.code(404).send({ ok: false, message: 'Not found.' }),
  );
  try {
    await server.listen({ host: options.host, port: options.port });
    return server;
  } catch (error) {
    await server.close().catch(() => undefined);
    throw error;
  }
}

function toUploadJobSummary(job: StoredUploadJob): UploadJobSummary {
  return {
    id: job.id,
    sessionId: job.sessionId,
    state: job.state,
    attemptCount: job.attemptCount,
    automaticRetryIndex: job.automaticRetryIndex,
    nextAttemptAt: job.nextAttemptAt,
    lastErrorCode: job.lastErrorCode,
    lastErrorMessage: job.lastErrorMessage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function requireSession(
  sessions: AdminSessionService,
  cookieValue: string | undefined,
  csrfHeader: string | string[] | undefined,
): void {
  sessions.requireWebSession(cookieValue, typeof csrfHeader === 'string' ? csrfHeader : undefined);
}

function sendSafeError(
  reply: { code(statusCode: number): { send(value: unknown): unknown } },
  error: unknown,
): unknown {
  const appError =
    error instanceof AppError
      ? error
      : new AppError('invalid_request', 'The request could not be completed.');
  const status =
    appError.code === 'unauthorized' || appError.code === 'invalid_passcode'
      ? 401
      : appError.code === 'rate_limited'
        ? 429
        : appError.code.includes('conflict')
          ? 409
          : 400;
  return reply.code(status).send({ ok: false, message: appError.safeMessage });
}

const ADMIN_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Grace Booth Admin</title><link rel="stylesheet" href="/admin.css"></head>
<body><main><p class="eyebrow">Grace Booth</p><h1>Booth health and delivery</h1>
<section id="login"><label>Admin passcode<input id="passcode" type="password" autocomplete="current-password" minlength="8"></label><button id="loginButton">Sign in</button></section>
<section id="dashboard" hidden><div id="status"></div><button id="refreshButton">Refresh status</button><button id="logoutButton">Sign out</button></section>
<p id="message" role="status" aria-live="polite"></p></main><script src="/admin.js"></script></body></html>`;

const ADMIN_CSS = `:root{font-family:"Segoe UI Variable","Segoe UI",system-ui,sans-serif;color:#242424;background:#f5f5f5;color-scheme:light}*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px}main{width:min(760px,100%);background:#fff;padding:32px;border:1px solid #e0e0e0;border-radius:8px;box-shadow:0 0 2px rgba(0,0,0,.12),0 8px 16px rgba(0,0,0,.14)}h1{font-size:28px;line-height:36px;font-weight:600;margin:4px 0 24px}.eyebrow{margin:0;color:#0f6cbd;font-size:14px;line-height:20px;font-weight:600}section{display:flex;gap:8px;align-items:end;flex-wrap:wrap}label{display:grid;gap:4px;font-size:14px;line-height:20px;font-weight:600}input,button{min-height:40px;border-radius:4px;padding:0 12px;font:inherit}input{border:1px solid #616161;background:#fff;color:#242424}button{border:1px solid transparent;background:#0f6cbd;color:#fff;font-weight:600;cursor:pointer;box-shadow:0 0 2px rgba(0,0,0,.12),0 1px 2px rgba(0,0,0,.14)}button:hover{background:#115ea3}button:active{background:#0c3b5e}button:focus-visible,input:focus-visible{outline:2px solid #fff;outline-offset:0;box-shadow:0 0 0 2px #000}#status{width:100%;white-space:pre-wrap;background:#f5f5f5;padding:16px;border:1px solid #e0e0e0;border-radius:4px;font:12px/16px Consolas,"Courier New",monospace}#message{min-height:20px;color:#c50f1f;font-size:14px;line-height:20px}@media(forced-colors:active){button:focus-visible,input:focus-visible{outline:2px solid Highlight;outline-offset:2px;box-shadow:none}}`;

const ADMIN_JS = `let csrf='';const login=document.querySelector('#login');const dash=document.querySelector('#dashboard');const msg=document.querySelector('#message');const status=document.querySelector('#status');async function api(path,options={}){const headers={'content-type':'application/json',...(csrf?{'x-csrf-token':csrf}:{})};const response=await fetch(path,{...options,headers});const value=await response.json();if(!response.ok||value.ok===false)throw new Error(value.message||'Request failed');return value}async function refresh(){const value=await api('/api/overview');status.textContent=JSON.stringify(value,null,2)}document.querySelector('#loginButton').addEventListener('click',async()=>{try{const value=await api('/api/login',{method:'POST',body:JSON.stringify({passcode:document.querySelector('#passcode').value})});csrf=value.csrfToken;login.hidden=true;dash.hidden=false;msg.textContent='';await refresh()}catch(error){msg.textContent=error.message}});document.querySelector('#refreshButton').addEventListener('click',()=>refresh().catch(error=>msg.textContent=error.message));document.querySelector('#logoutButton').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST',body:'{}'});csrf='';dash.hidden=true;login.hidden=false;status.textContent=''}catch(error){msg.textContent=error.message}});`;
