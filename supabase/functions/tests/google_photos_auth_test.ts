import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { escapeHtml, handler, renderOAuthCallbackPage } from '../google-photos-auth/index.ts';

Deno.test('GET ?error escapes HTML payloads and serves Apple light styling with strict CSP', async () => {
  const payload = '<script>alert(1)</script>';
  const request = new Request(
    `https://example.test/functions/v1/google-photos-auth?error=${encodeURIComponent(payload)}`,
    { method: 'GET' },
  );

  const response = await handler(request);
  assertEquals(response.status, 400);
  assertEquals(response.headers.get('content-type'), 'text/html; charset=utf-8');
  assertEquals(
    response.headers.get('content-security-policy'),
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  assertEquals(response.headers.get('x-content-type-options'), 'nosniff');
  assertEquals(response.headers.get('referrer-policy'), 'no-referrer');
  assertEquals(response.headers.get('cache-control'), 'no-store');

  const html = await response.text();
  assertStringIncludes(html, '&lt;script&gt;alert(1)&lt;/script&gt;');
  assertEquals(html.includes('<script>'), false);
  assertStringIncludes(html, '#f5f5f7');
  assertStringIncludes(html, '#ffffff');
  assertStringIncludes(html, '#d70015');
  assertStringIncludes(html, '#ffecee');
  assertStringIncludes(html, 'viewport-fit=cover');
  assertStringIncludes(html, 'color-scheme');
  assertEquals(html.includes('#09090b'), false);
  assertEquals(html.includes('#18181b'), false);
  assertEquals(html.includes('Segoe UI'), false);
});

Deno.test('renderOAuthCallbackPage escapes connected email and uses Apple success palette', () => {
  const html = renderOAuthCallbackPage({
    kind: 'connected',
    email: 'operator+"<img src=x>"@example.org',
  });

  assertStringIncludes(html, 'Google Photos Connected');
  assertStringIncludes(html, 'operator+&quot;&lt;img src=x&gt;&quot;@example.org');
  assertEquals(html.includes('<img src=x>'), false);
  assertStringIncludes(html, '#1b6f30');
  assertStringIncludes(html, '#e3f5e7');
  assertStringIncludes(html, '#f5f5f7');
});

Deno.test('escapeHtml neutralizes HTML metacharacters', () => {
  assertEquals(
    escapeHtml(`& < > " '`),
    '&amp; &lt; &gt; &quot; &#39;',
  );
});
