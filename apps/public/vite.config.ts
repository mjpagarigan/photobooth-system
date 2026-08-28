import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

export type ValidatedBuildEnvironment = {
  apiUrl: URL;
  pageOrigin: string;
};

const INERT_API_URL = 'https://unconfigured-api.invalid/functions/v1/photo';
const INERT_PAGE_ORIGIN = 'https://unconfigured-page.invalid';

export const DEFAULT_PRODUCTION_ENV: Record<string, string> = {
  VITE_PUBLIC_PHOTO_API_URL: 'https://bejgkclvsfbkpkflftxu.supabase.co/functions/v1/photo',
  VITE_PUBLIC_PAGE_ORIGIN: 'https://mat-photobooth.pages.dev',
};

function parseHttpsUrl(value: string, name: string, allowLocalHttp = true): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid absolute URL`);
  }
  const local = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  if (
    (parsed.protocol !== 'https:' && !(allowLocalHttp && local && parsed.protocol === 'http:')) ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error(`${name} must use HTTPS without embedded credentials`);
  }
  return parsed;
}

export function validateEnvironment(
  mode: string,
  providedEnvironment?: Record<string, string>,
): ValidatedBuildEnvironment {
  const loadedEnv: Record<string, string> = {
    ...loadEnv(mode, fileURLToPath(new URL('../..', import.meta.url)), 'VITE_'),
    ...loadEnv(mode, process.cwd(), 'VITE_'),
  };
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('VITE_') && typeof value === 'string') {
      loadedEnv[key] = value;
    }
  }
  const env =
    providedEnvironment ??
    (mode === 'production'
      ? {
          ...DEFAULT_PRODUCTION_ENV,
          ...loadedEnv,
        }
      : loadedEnv);
  const testing = mode === 'test';
  const production = mode === 'production';
  const missing = [
    env.VITE_PUBLIC_PHOTO_API_URL ? null : 'VITE_PUBLIC_PHOTO_API_URL',
    env.VITE_PUBLIC_PAGE_ORIGIN ? null : 'VITE_PUBLIC_PAGE_ORIGIN',
  ].filter((name): name is string => name !== null);
  if (production && missing.length > 0) {
    throw new Error(
      `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required for a production build`,
    );
  }
  const apiValue = testing
    ? 'https://api.example.test/functions/v1/photo'
    : (env.VITE_PUBLIC_PHOTO_API_URL ?? INERT_API_URL);
  const pageValue = testing
    ? 'https://photos.example.test'
    : (env.VITE_PUBLIC_PAGE_ORIGIN ?? INERT_PAGE_ORIGIN);

  const apiUrl = parseHttpsUrl(apiValue, 'VITE_PUBLIC_PHOTO_API_URL');
  if (
    apiUrl.search ||
    apiUrl.hash ||
    apiUrl.pathname.replace(/\/+$/u, '') !== '/functions/v1/photo'
  ) {
    throw new Error('VITE_PUBLIC_PHOTO_API_URL must end with /functions/v1/photo');
  }
  apiUrl.pathname = apiUrl.pathname.replace(/\/+$/u, '');

  const pageUrl = parseHttpsUrl(pageValue, 'VITE_PUBLIC_PAGE_ORIGIN');
  if (pageUrl.pathname !== '/' || pageUrl.search || pageUrl.hash) {
    throw new Error('VITE_PUBLIC_PAGE_ORIGIN must contain only an origin');
  }

  return { apiUrl, pageOrigin: pageUrl.origin };
}

function contentSecurityPolicy(environment: ValidatedBuildEnvironment): string {
  const upgradeInsecureRequests =
    environment.apiUrl.protocol === 'https:' && environment.pageOrigin.startsWith('https://')
      ? ' upgrade-insecure-requests'
      : '';
  return `default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' blob:; connect-src ${environment.apiUrl.origin}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; manifest-src 'self';${upgradeInsecureRequests}`;
}

export function renderCloudflarePagesHeaders(environment: ValidatedBuildEnvironment): string {
  return `/*
  Content-Security-Policy: ${contentSecurityPolicy(environment)}
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()
  Cross-Origin-Opener-Policy: same-origin

/photo
  Cache-Control: private, no-store, max-age=0
  X-Robots-Tag: noindex, nofollow, noarchive, noimageindex

/photo/*
  Cache-Control: private, no-store, max-age=0
  X-Robots-Tag: noindex, nofollow, noarchive, noimageindex

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;
}

export function securityTemplatePlugin(environment: ValidatedBuildEnvironment): Plugin {
  return {
    name: 'grace-booth-security-template',
    transformIndexHtml(html, ctx) {
      const upgradeInsecureRequests =
        !ctx.server &&
        environment.apiUrl.protocol === 'https:' &&
        environment.pageOrigin.startsWith('https://')
          ? 'upgrade-insecure-requests'
          : '';
      let rendered = html
        .replaceAll('__PHOTO_API_ORIGIN__', environment.apiUrl.origin)
        .replaceAll('__PUBLIC_PAGE_ORIGIN__', environment.pageOrigin)
        .replaceAll('__UPGRADE_INSECURE_REQUESTS__', upgradeInsecureRequests);

      // In Vite dev mode, allow 'unsafe-inline' and dev server origins on CSP for HMR and module execution
      if (ctx.server) {
        rendered = rendered
          .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
          .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
          .replace(
            `connect-src ${environment.apiUrl.origin}`,
            `connect-src ${environment.apiUrl.origin} https://api.example.test ws: http: https:`,
          );
      }

      if (/__[A-Z0-9_]+__/u.test(rendered)) {
        throw new Error('Public security template contains an unresolved placeholder');
      }
      return rendered;
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: renderCloudflarePagesHeaders(environment),
      });
    },
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url && (req.url === '/photo' || req.url.startsWith('/photo?') || req.url.startsWith('/photo#'))) {
          req.url = '/index.html';
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const environment = validateEnvironment(mode);
  return {
    plugins: [tailwindcss(), react(), securityTemplatePlugin(environment)],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: false,
      target: 'es2022',
      assetsInlineLimit: 4096,
      reportCompressedSize: true,
    },
    server: {
      host: '127.0.0.1',
      port: 4173,
      strictPort: true,
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
      strictPort: true,
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts'],
      clearMocks: true,
      restoreMocks: true,
    },
  };
});
