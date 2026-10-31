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
    recruitmentButtonText: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine((value) => !/[\r\n]/u.test(value))
      .optional(),
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
          recruitmentButtonText: settings.recruitmentButtonText,
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
      const currentSettings = dependencies.repository.getSettings();
      const settings = dependencies.repository.updateSettings({
        ...input,
        recruitmentButtonText: input.recruitmentButtonText ?? currentSettings.recruitmentButtonText,
      });
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
<title>M.A.T. Photobooth Admin</title><link rel="stylesheet" href="/admin.css"></head>
<body><header class="bar"><span>M.A.T. Photobooth</span><button id="logoutButton" class="link" hidden>Sign out</button></header>
<main>
<section id="login"><h1>Please sign in.</h1><p class="lead">Enter the booth&#8217;s operator passcode to see its health and uploads.</p>
<form id="loginForm"><div class="field"><label for="passcode">Passcode</label><input id="passcode" type="password" autocomplete="current-password" minlength="8" required>
<button id="loginButton" type="submit" aria-label="Sign in"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M13 8.5l3.5 3.5-3.5 3.5"/></svg></button></div></form></section>
<section id="dashboard" hidden><h1>Hi, operator. <span>Here&#8217;s how the booth is doing.</span></h1><p id="verdict" class="verdict"></p>
<h2>Status. <span>Everything this booth relies on.</span></h2><ul id="health" class="rows"></ul>
<h2>Uploads</h2><ul id="uploads" class="rows"></ul>
<h2>Booth</h2><dl id="facts" class="facts"></dl>
<button id="refreshButton" class="pill">Refresh status</button></section>
<p id="message" role="status" aria-live="polite"></p></main><script src="/admin.js"></script></body></html>`;

const ADMIN_CSS = `:root{font-family:-apple-system,BlinkMacSystemFont,"Inter Variable","Segoe UI",system-ui,sans-serif;color:#1d1d1f;background:#f5f5f7;color-scheme:light;-webkit-font-smoothing:antialiased}*{box-sizing:border-box}body{margin:0;min-height:100dvh}
.bar{display:flex;align-items:center;justify-content:space-between;height:52px;padding:0 max(20px,calc(50% - 340px));background:rgba(251,251,253,.8);backdrop-filter:saturate(180%) blur(20px);box-shadow:0 1px 0 #e8e8ed;font-size:14px;font-weight:600}
main{width:min(680px,100%);margin:0 auto;padding:40px 20px 56px}
h1{margin:0;font-size:clamp(32px,6vw,48px);line-height:1.08;font-weight:700;letter-spacing:-.03em}h1 span{color:#86868b}
h2{margin:40px 0 12px;font-size:21px;font-weight:700;letter-spacing:-.01em}h2 span{color:#636366;font-weight:600}
.lead{margin:12px 0 28px;font-size:17px;line-height:1.45;color:#636366}
.field{position:relative}.field label{position:absolute;top:9px;left:15px;font-size:12px;color:#636366;pointer-events:none}
input{width:100%;height:58px;padding:22px 56px 6px 14px;border:1px solid #86868b;border-radius:12px;background:#fff;color:#1d1d1f;font:inherit;font-size:17px}
input:focus{outline:none;border-color:#0066cc;box-shadow:0 0 0 3px rgba(0,102,204,.25)}
#loginButton{position:absolute;top:7px;right:6px;display:grid;place-items:center;width:44px;height:44px;border:0;border-radius:980px;background:transparent;color:#1d1d1f;cursor:pointer}
#loginButton svg{width:28px;height:28px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.verdict{display:flex;align-items:center;gap:8px;margin:12px 0 0;font-size:15px}.verdict::before,.state::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
.rows{display:flex;flex-direction:column;gap:10px;margin:0;padding:0;list-style:none}
.rows li{display:flex;align-items:center;gap:14px;padding:14px 18px;border-radius:18px;background:#fff}
.rows .text{flex:1;min-width:0;display:flex;flex-direction:column}.rows strong{font-size:15px;font-weight:600}.rows small{font-size:13px;color:#636366;overflow-wrap:anywhere}
.state{display:inline-flex;align-items:center;gap:7px;font-size:14px;font-weight:500;white-space:nowrap}
.good{color:#1b6f30}.warn{color:#8a5a00}.bad{color:#d70015}.idle{color:#636366}
.facts{display:grid;gap:14px;margin:0;padding:18px;border-radius:18px;background:#fff}.facts div{display:grid;grid-template-columns:120px 1fr;gap:12px}.facts dt{font-size:14px;font-weight:600}.facts dd{margin:0;font-size:14px;color:#424245;overflow-wrap:anywhere}
.pill{margin-top:28px;min-height:44px;padding:0 22px;border:0;border-radius:980px;background:#0066cc;color:#fff;font:inherit;font-size:15px;font-weight:500;cursor:pointer}.pill:hover{background:#0071e3}
.link{min-height:44px;padding:0;border:0;background:none;color:#0066cc;font:inherit;font-size:14px;cursor:pointer}
#message{min-height:20px;margin:20px 0 0;font-size:14px;color:#d70015}
button:focus-visible{outline:2px solid #0066cc;outline-offset:3px}
@media(forced-colors:active){input:focus,button:focus-visible{outline:2px solid Highlight;outline-offset:2px;box-shadow:none}}
@media(prefers-reduced-transparency:reduce){.bar{background:#fbfbfd;backdrop-filter:none}}`;

const ADMIN_JS = `let csrf='';const login=document.querySelector('#login');const dash=document.querySelector('#dashboard');const msg=document.querySelector('#message');const logout=document.querySelector('#logoutButton');
async function api(path,options={}){const headers={'content-type':'application/json',...(csrf?{'x-csrf-token':csrf}:{})};const response=await fetch(path,{...options,headers});const value=await response.json();if(!response.ok||value.ok===false)throw new Error(value.message||'Request failed');return value}
const tone={healthy:'good',degraded:'warn',unavailable:'bad',unconfigured:'idle',succeeded:'good',queued:'warn',creating_upload:'warn',uploading:'warn',confirming:'warn',retry_wait:'warn',failed:'bad',cancelled:'idle'};
const label=(value)=>{const text=String(value).replaceAll('_',' ');return text.charAt(0).toUpperCase()+text.slice(1)};
function row(title,detail,state){const li=document.createElement('li');const text=document.createElement('span');text.className='text';const strong=document.createElement('strong');strong.textContent=title;const small=document.createElement('small');small.textContent=detail;text.append(strong,small);const badge=document.createElement('span');badge.className='state '+(tone[state]||'idle');badge.textContent=label(state);li.append(text,badge);return li}
function fact(term,value){const div=document.createElement('div');const dt=document.createElement('dt');dt.textContent=term;const dd=document.createElement('dd');dd.textContent=value;div.append(dt,dd);return div}
async function refresh(){const value=await api('/api/overview');const health=value.health||{};const keys=['camera','cloud','database','encryption'];
const states=keys.map((key)=>(health[key]&&health[key].state)||'unavailable');const attention=states.filter((state)=>state!=='healthy').length;
const verdict=document.querySelector('#verdict');verdict.textContent=attention===0?'All systems working':attention+(attention===1?' system needs':' systems need')+' attention';verdict.className='verdict '+(attention===0?'good':'warn');
document.querySelector('#health').replaceChildren(...keys.map((key)=>row(label(key),(health[key]&&health[key].message)||'Not reported',(health[key]&&health[key].state)||'unavailable')));
const jobs=value.uploadJobs||[];document.querySelector('#uploads').replaceChildren(...(jobs.length?jobs.slice(0,10).map((job)=>row('Session '+String(job.sessionId).slice(0,8),job.lastErrorMessage||('Attempt '+job.attemptCount),job.state)):[row('Upload queue','Nothing waiting','healthy')]));
const s=value.settings||{};const lan=s.lan||{};document.querySelector('#facts').replaceChildren(fact('Frame',(s.activeFrame&&s.activeFrame.name)||'Default'),fact('Retention','Photos '+s.localRetentionDays+' days, links '+s.cloudRetentionDays+' days'),fact('LAN admin',lan.enabled?lan.bindHost+':'+lan.port:'Off'),fact('Revision',String(s.revision)))}
document.querySelector('#loginForm').addEventListener('submit',async(event)=>{event.preventDefault();try{const value=await api('/api/login',{method:'POST',body:JSON.stringify({passcode:document.querySelector('#passcode').value})});csrf=value.csrfToken;login.hidden=true;dash.hidden=false;logout.hidden=false;msg.textContent='';await refresh()}catch(error){msg.textContent=error.message}});
document.querySelector('#refreshButton').addEventListener('click',()=>refresh().catch((error)=>{msg.textContent=error.message}));
logout.addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST',body:'{}'});csrf='';dash.hidden=true;login.hidden=false;logout.hidden=true}catch(error){msg.textContent=error.message}});`;
