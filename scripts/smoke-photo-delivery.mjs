import process from 'node:process';

const LAYERS = {
  CONFIGURATION: 'configuration',
  NETWORK: 'cors/network',
  HTTP_STATUS: 'http-status',
  ORIGIN_MISMATCH: 'origin-mismatch',
  STORAGE_BACKEND: 'storage-backend',
  NON_JPEG_BODY: 'non-jpeg-body',
  CORS_POLICY: 'r2-cors',
};

function fail(layer, message) {
  console.error(`[smoke:photo] FAIL (${layer}) ${message}`);
  process.exit(1);
}

function pass(message) {
  console.log(`[smoke:photo] ok - ${message}`);
}

function readEnvironment(names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function readApiBaseUrl() {
  const value = readEnvironment(['PHOTO_API_URL', 'VITE_PUBLIC_PHOTO_API_URL']);
  if (!value) {
    fail(LAYERS.CONFIGURATION, 'PHOTO_API_URL (or VITE_PUBLIC_PHOTO_API_URL) is not configured');
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(LAYERS.CONFIGURATION, 'PHOTO_API_URL is not a valid absolute URL');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.replace(/\/+$/u, '').endsWith('/functions/v1/photo')
  ) {
    fail(
      LAYERS.CONFIGURATION,
      'PHOTO_API_URL must be an HTTPS URL ending with /functions/v1/photo',
    );
  }
  return url.toString().replace(/\/+$/u, '');
}

function readExactOrigin(names) {
  const value = readEnvironment(names);
  if (!value) {
    fail(LAYERS.CONFIGURATION, `${names[0]} (or ${names[1]}) is not configured`);
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(LAYERS.CONFIGURATION, `${names[0]} is not a valid absolute URL`);
  }
  if (
    url.protocol !== 'https:' ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    fail(LAYERS.CONFIGURATION, `${names[0]} must be a bare HTTPS origin`);
  }
  return url.origin;
}

const apiBaseUrl = readApiBaseUrl();
const pageOrigin = readExactOrigin(['PAGE_ORIGIN', 'PUBLIC_PAGE_ORIGIN']);
const r2Origin = readExactOrigin(['R2_ORIGIN', 'VITE_PUBLIC_R2_ORIGIN']);
const token = readEnvironment(['SMOKE_PHOTO_TOKEN']);
if (!token) fail(LAYERS.CONFIGURATION, 'SMOKE_PHOTO_TOKEN is not configured');
if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) {
  fail(LAYERS.CONFIGURATION, 'SMOKE_PHOTO_TOKEN must be a 43-character base64url token');
}
const apiOrigin = new URL(apiBaseUrl).origin;

function postPhotoRoute(route, redirect) {
  return fetch(`${apiBaseUrl}/${route}`, {
    method: 'POST',
    redirect,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Origin: pageOrigin },
    body: JSON.stringify({ token }),
  }).catch(() => undefined);
}

pass(`page origin ${pageOrigin}`);

const resolveResponse = await postPhotoRoute('resolve', 'follow');
if (!resolveResponse) {
  fail(LAYERS.NETWORK, 'photo API unreachable (DNS, TLS, or Function CORS)');
}
if (resolveResponse.status !== 200) {
  fail(
    LAYERS.HTTP_STATUS,
    `resolve returned HTTP ${resolveResponse.status} (403 page-origin gate; 404 unknown token; 503 backend)`,
  );
}
const resolvePayload = await resolveResponse.json().catch(() => undefined);
if (resolvePayload?.status !== 'ready') {
  fail(LAYERS.HTTP_STATUS, 'resolve did not report a ready photo');
}
pass('resolve reports ready');

const imageResponse = await postPhotoRoute('image', 'follow');
if (!imageResponse) {
  fail(LAYERS.NETWORK, 'photo API unreachable on the image route');
}
if (imageResponse.status !== 200) {
  fail(
    LAYERS.HTTP_STATUS,
    `image returned HTTP ${imageResponse.status} (403 page-origin gate; 404 expired; 503 unavailable)`,
  );
}
let finalOrigin;
try {
  finalOrigin = new URL(imageResponse.url).origin;
} catch {
  fail(LAYERS.NETWORK, 'final image response has no parseable URL');
}
if (finalOrigin === apiOrigin) {
  fail(
    LAYERS.STORAGE_BACKEND,
    'photo streamed from Supabase Storage instead of an R2 303 - storage_backend or migration drift for this token',
  );
}
if (finalOrigin !== r2Origin) {
  fail(
    LAYERS.ORIGIN_MISMATCH,
    `redirected to ${finalOrigin}, expected ${r2Origin} - build-time R2 origin does not match the presigned host`,
  );
}
pass(`image redirected and followed to ${r2Origin}`);

const contentType = imageResponse.headers.get('content-type')?.split(';', 1)[0]?.toLowerCase();
if (contentType !== 'image/jpeg') {
  fail(LAYERS.NON_JPEG_BODY, `content-type is ${contentType ?? 'missing'}, expected image/jpeg`);
}
const bytes = new Uint8Array(await imageResponse.arrayBuffer());
if (
  bytes.length < 5 ||
  bytes[0] !== 0xff ||
  bytes[1] !== 0xd8 ||
  bytes[2] !== 0xff ||
  bytes[bytes.length - 2] !== 0xff ||
  bytes[bytes.length - 1] !== 0xd9
) {
  fail(LAYERS.NON_JPEG_BODY, 'stored object is not a complete JPEG (magic-byte mismatch)');
}
pass('delivered bytes are a complete JPEG');

const manualProbe = await postPhotoRoute('image', 'manual');
if (manualProbe?.status !== 303) {
  fail(
    LAYERS.HTTP_STATUS,
    `manual re-request returned HTTP ${manualProbe?.status ?? 'network error'}, expected 303`,
  );
}
const locationValue = manualProbe.headers.get('location');
let location;
try {
  location = new URL(locationValue ?? '');
} catch {
  fail(LAYERS.ORIGIN_MISMATCH, '303 Location header is missing or invalid');
}
if (location.origin !== r2Origin) {
  fail(
    LAYERS.ORIGIN_MISMATCH,
    `Location points at ${location.origin}, expected ${r2Origin}`,
  );
}
const direct = await fetch(location, {
  redirect: 'error',
  cache: 'no-store',
  headers: { Origin: pageOrigin },
}).catch(() => undefined);
if (!direct) {
  fail(LAYERS.NETWORK, 'R2 presigned GET unreachable (DNS or TLS)');
}
if (direct.status !== 200) {
  fail(LAYERS.HTTP_STATUS, `R2 object GET returned HTTP ${direct.status} (signature or object problem)`);
}
const allowOrigin = direct.headers.get('access-control-allow-origin')?.split(',', 1)[0]?.trim();
if (allowOrigin !== pageOrigin) {
  fail(
    LAYERS.CORS_POLICY,
    `R2 answered without Access-Control-Allow-Origin for the page origin${allowOrigin ? ` (got ${allowOrigin})` : ''} - apply infra/r2-cors.json via pnpm r2:cors:apply`,
  );
}
pass('R2 bucket CORS allows the page origin');

console.log('[smoke:photo] PASS - QR photo delivery chain is healthy end-to-end');
