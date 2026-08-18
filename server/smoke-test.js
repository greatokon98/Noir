// smoke-test.js
// End-to-end smoke test: starts the app on an ephemeral port and exercises the
// public API and admin flows with a real session cookie jar.
//
// Requires DATABASE_URL to be set. Uses the same PostgreSQL database.

delete process.env.NODE_ENV;
process.env.ALLOWED_ORIGINS = 'https://noirclub.example.com';

const assert = require('assert');
const app = require('./index');
const { ensureSchema } = require('./db');
const { runSeed } = require('./seed');

let base;
let cookie = '';
let loginCsrf = '';
let adminCsrf = '';

async function req(method, path, opts) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + path, {
    method,
    headers,
    redirect: 'manual',
    ...(opts && opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {})
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    cookie = setCookie.split(';')[0];
  }
  return res;
}

function csrfFrom(html) {
  const m = /name="_csrf" value="([^"]+)"/.exec(html);
  return m ? m[1] : null;
}

const results = [];
function check(name, fn) {
  return Promise.resolve().then(fn).then(() => {
    results.push('PASS ' + name);
  }, (err) => {
    results.push('FAIL ' + name + ' — ' + err.message);
  });
}

async function main() {
  // Ensure schema and seed
  await ensureSchema();
  await runSeed();

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  await check('admin redirects to login when unauthenticated', async () => {
    const res = await req('GET', '/admin/dashboard');
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get('location'), '/admin/login');
  });

  await check('login page renders with CSRF token', async () => {
    const res = await req('GET', '/admin/login');
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('Sign in to the desk'));
    loginCsrf = csrfFrom(html);
    assert.ok(loginCsrf);
  });

  await check('wrong password is rejected', async () => {
    const res = await req('POST', '/admin/login', { body: { _csrf: loginCsrf, email: 'owner@noirclub.com', password: 'wrong' } });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get('location'), '/admin/login');
  });

  await check('correct credentials sign in and redirect to dashboard', async () => {
    const res = await req('POST', '/admin/login', { body: { _csrf: loginCsrf, email: 'owner@noirclub.com', password: 'noir2026' } });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get('location'), '/admin/dashboard');
  });

  await check('dashboard renders stats', async () => {
    const res = await req('GET', '/admin/dashboard');
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('New leads this week'));
    adminCsrf = csrfFrom(html);
    assert.ok(adminCsrf);
  });

  await check('admin POST without CSRF token is rejected', async () => {
    const res = await req('POST', '/admin/leads/1/status', { body: { status: 'contacted' } });
    assert.strictEqual(res.status, 403);
  });

  await check('admin pages render (leads, members, tiers, blog, settings)', async () => {
    for (const path of ['/admin/leads', '/admin/members', '/admin/tiers', '/admin/blog', '/admin/settings']) {
      const res = await req('GET', path);
      assert.strictEqual(res.status, 200, path + ' should be 200');
      await res.text();
    }
  });

  await check('public settings API returns JSON', async () => {
    const res = await req('GET', '/api/settings');
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(typeof data.hero_eyebrow === 'string');
    assert.ok(typeof data.cta_primary_label === 'string');
  });

  await check('API answers CORS preflight for the static landing page', async () => {
    const res = await fetch(base + '/api/leads', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://noirclub.example.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type'
      }
    });
    assert.strictEqual(res.status, 204);
    assert.strictEqual(res.headers.get('access-control-allow-origin'), 'https://noirclub.example.com');
    assert.ok(res.headers.get('access-control-allow-methods').includes('POST'));
    assert.ok(res.headers.get('access-control-allow-headers').toLowerCase().includes('content-type'));
  });

  await check('API responses carry CORS headers for cross-origin reads', async () => {
    const res = await fetch(base + '/api/settings', { headers: { Origin: 'https://noirclub.example.com' } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('access-control-allow-origin'), 'https://noirclub.example.com');
    await res.json();
  });

  await check('public blog API returns only published posts', async () => {
    const res = await req('GET', '/api/blog');
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.length, 2);
    assert.ok(data.every((p) => p.slug !== 'food-for-your-actual-week'));
    assert.ok(typeof data[0].body_html === 'string');
  });

  await check('lead creation validates input', async () => {
    const res = await req('POST', '/api/leads', { body: { name: '', email: 'nope', time: 'morning' } });
    assert.strictEqual(res.status, 400);
  });

  await check('lead creation stores a row', async () => {
    const res = await req('POST', '/api/leads', { body: { name: 'Test Visitor', email: 'test@example.com', phone: '+1 555 000 0000', time: 'evening' } });
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.ok(data.id > 0);
  });

  await check('honeypot submissions are dropped without a row', async () => {
    const res = await req('POST', '/api/leads', { body: { name: 'Bot', email: 'bot@example.com', time: 'morning', company: 'spam' } });
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.id, undefined);
  });

  await check('admin can update a lead status with CSRF', async () => {
    const res = await req('POST', '/admin/leads/1/status', { body: { _csrf: adminCsrf, status: 'contacted' } });
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get('location'), '/admin/leads');
  });

  await check('settings update flows through to the public API', async () => {
    const res = await req('POST', '/admin/settings', { body: { _csrf: adminCsrf, cta_primary_label: 'Book your tour' } });
    assert.strictEqual(res.status, 302);
    const sres = await req('GET', '/api/settings');
    const data = await sres.json();
    assert.strictEqual(data.cta_primary_label, 'Book your tour');
  });

  await check('logout clears the session', async () => {
    const res = await req('POST', '/admin/logout', { body: { _csrf: adminCsrf } });
    assert.strictEqual(res.status, 302);
    const again = await req('GET', '/admin/dashboard');
    assert.strictEqual(again.status, 302);
  });

  await check('GET /api/blog/:slug returns a published post', async () => {
    const res = await req('GET', '/api/blog/why-we-test-every-six-weeks');
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.slug, 'why-we-test-every-six-weeks');
    assert.ok(typeof data.body_html === 'string');
    assert.ok(data.body_html.length > 0);
  });

  await check('GET /api/blog/:slug returns 404 for draft posts', async () => {
    const res = await req('GET', '/api/blog/food-for-your-actual-week');
    assert.strictEqual(res.status, 404);
  });

  await check('GET /api/blog/:slug returns 400 for invalid slug', async () => {
    const res = await req('GET', '/api/blog/not+a+valid+slug');
    assert.ok(res.status === 400 || res.status === 429, 'expected 400 or 429, got ' + res.status);
  });

  await check('markdown blocks javascript: URIs', async () => {
    const md = require('./markdown');
    const html = md.render('[click](javascript:alert(1))');
    assert.ok(!html.includes('javascript:'));
    assert.ok(html.includes('click'));
    assert.ok(!html.includes('<a'));
  });

  await check('markdown allows http links', async () => {
    const md = require('./markdown');
    const html = md.render('[click](https://example.com)');
    assert.ok(html.includes('href="https://example.com"'));
    assert.ok(html.includes('<a'));
  });

  await check('constant-time CSRF rejects mismatched token length', async () => {
    const loginRes = await req('GET', '/admin/login');
    const html = await loginRes.text();
    const csrf = csrfFrom(html);
    const loginPost = await req('POST', '/admin/login', { body: { _csrf: csrf, email: 'owner@noirclub.com', password: 'noir2026' } });
    assert.strictEqual(loginPost.status, 302);
    const dashRes = await req('GET', '/admin/dashboard');
    const dashHtml = await dashRes.text();
    adminCsrf = csrfFrom(dashHtml);
    const res = await req('POST', '/admin/leads', { body: { _csrf: adminCsrf + 'x', name: 'Test', email: 'a@b.com' } });
    assert.strictEqual(res.status, 403);
  });

  await check('admin pages send CSP header', async () => {
    const res = await req('GET', '/admin/login');
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp, 'CSP header should be present');
    assert.ok(csp.includes("default-src 'self'"), 'default-src should be self');
    assert.ok(csp.includes("style-src"), 'style-src should be present');
  });

  await check('landing page sends CSP header', async () => {
    const res = await fetch(base + '/');
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp, 'CSP header should be present on landing page');
    assert.ok(csp.includes('fonts.googleapis.com'), 'should allow Google Fonts');
    assert.ok(csp.includes('fonts.gstatic.com'), 'should allow Google Fonts static');
  });

  await check('cross-origin API blocked when origin not in ALLOWED_ORIGINS', async () => {
    const res = await fetch(base + '/api/settings', {
      headers: { Origin: 'https://evil.example.com' }
    });
    assert.strictEqual(res.status, 403);
  });

  await check('GET /healthz returns 200', async () => {
    const res = await fetch(base + '/healthz');
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'ok');
    assert.ok(typeof data.uptime === 'number');
  });

  await check('GET /readyz returns 200 when DB is up', async () => {
    const res = await fetch(base + '/readyz');
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'ready');
    assert.strictEqual(data.db, 'ok');
  });

  await check('mailer module loads without error', async () => {
    const { sendLeadAlert } = require('./mailer');
    assert.strictEqual(typeof sendLeadAlert, 'function');
    await sendLeadAlert({ name: 'Test', email: 't@t.com', phone: '', preferred_time: 'morning', source: 'tour' });
  });

  server.close();
  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(results.join('\n'));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
