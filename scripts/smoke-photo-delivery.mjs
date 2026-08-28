import process from 'node:process';

const LAYERS = {
  CONFIGURATION: 'configuration',
  NETWORK: 'cors/network',
  HTTP_STATUS: 'http-status',
  ORIGIN_MISMATCH: 'origin-mismatch',
  NON_JPEG_BODY: 'non-jpeg-body',
};

class SmokeFailure extends Error {
  constructor(layer, message) {
    super(message);
    this.layer = layer;
  }
}

function fail(layer, message) {
  console.error(`[smoke:photo] FAIL (${layer}) ${message}`);
  throw new SmokeFailure(layer, message);
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

function readPageOrigin() {
  const value = readEnvironment(['PAGE_ORIGIN', 'PUBLIC_PAGE_ORIGIN']);
  if (!value) {
    fail(LAYERS.CONFIGURATION, 'PAGE_ORIGIN (or PUBLIC_PAGE_ORIGIN) is not configured');
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(LAYERS.CONFIGURATION, 'PAGE_ORIGIN is not a valid absolute URL');
  }
  if (
    url.protocol !== 'https:' ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    fail(LAYERS.CONFIGURATION, 'PAGE_ORIGIN must be a bare HTTPS origin');
  }
  return url.origin;
}

async function runSmokeTest() {
  const apiBaseUrl = readApiBaseUrl();
  const pageOrigin = readPageOrigin();
  const token = readEnvironment(['SMOKE_PHOTO_TOKEN']);
  if (!token) fail(LAYERS.CONFIGURATION, 'SMOKE_PHOTO_TOKEN is not configured');
  if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) {
    fail(LAYERS.CONFIGURATION, 'SMOKE_PHOTO_TOKEN must be a 43-character base64url token');
  }
  const apiOrigin = new URL(apiBaseUrl).origin;

  function postPhotoRoute(route) {
    return fetch(`${apiBaseUrl}/${route}`, {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Origin: pageOrigin },
      body: JSON.stringify({ token }),
    }).catch(() => undefined);
  }

  pass(`page origin ${pageOrigin}`);

  const resolveResponse = await postPhotoRoute('resolve');
  if (!resolveResponse) {
    fail(LAYERS.NETWORK, 'photo API unreachable (DNS, TLS, or Function CORS)');
  }
  if (resolveResponse.status !== 200) {
    fail(
      LAYERS.HTTP_STATUS,
      `resolve returned HTTP ${resolveResponse.status} (403 origin; 404 missing object/token; 503 verification failure)`,
    );
  }
  const resolvePayload = await resolveResponse.json().catch(() => undefined);
  if (resolvePayload?.status !== 'ready') {
    fail(LAYERS.HTTP_STATUS, 'resolve did not report a storage-verified ready photo');
  }
  pass('resolve reports a storage-verified ready photo');

  for (const route of ['image', 'download']) {
    const response = await postPhotoRoute(route);
    if (!response) fail(LAYERS.NETWORK, `photo API unreachable on the ${route} route`);
    if (response.status !== 200) {
      fail(
        LAYERS.HTTP_STATUS,
        `${route} returned HTTP ${response.status} (403 origin; 404 missing; 503 verification failure)`,
      );
    }
    let responseOrigin;
    try {
      responseOrigin = new URL(response.url).origin;
    } catch {
      fail(LAYERS.NETWORK, `${route} response has no parseable URL`);
    }
    if (response.redirected || responseOrigin !== apiOrigin) {
      fail(
        LAYERS.ORIGIN_MISMATCH,
        `${route} must stream directly from ${apiOrigin}; browser-visible storage redirects are not allowed`,
      );
    }
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.toLowerCase();
    if (contentType !== 'image/jpeg') {
      fail(LAYERS.NON_JPEG_BODY, `${route} content-type is ${contentType ?? 'missing'}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (
      bytes.length < 5 ||
      bytes[0] !== 0xff ||
      bytes[1] !== 0xd8 ||
      bytes[2] !== 0xff ||
      bytes[bytes.length - 2] !== 0xff ||
      bytes[bytes.length - 1] !== 0xd9
    ) {
      fail(LAYERS.NON_JPEG_BODY, `${route} did not return a complete JPEG`);
    }
    pass(`${route} streams a complete JPEG directly from the photo API`);
  }

  console.log('[smoke:photo] PASS - storage-aware QR photo delivery is healthy end-to-end');
}

try {
  await runSmokeTest();
} catch (error) {
  if (!(error instanceof SmokeFailure)) throw error;
  process.exitCode = 1;
}
