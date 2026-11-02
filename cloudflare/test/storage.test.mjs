// Runs the Worker's fetch handler in plain Node with an in-memory R2 bucket.
//   npm test        (needs Node 22.18+, which runs .ts files directly)
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';

function fakeBucket() {
  const store = new Map();
  return {
    store,
    async put(key, value, opts) {
      store.set(key, { bytes: new Uint8Array(await new Response(value).arrayBuffer()), opts });
    },
    async get(key) {
      const o = store.get(key);
      return o ? { body: new Blob([o.bytes]).stream(), text: async () => new TextDecoder().decode(o.bytes) } : null;
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const call = (env, path, init = {}, id = A) =>
  worker.fetch(new Request(`https://x.test${path}`, { ...init, headers: { 'X-Device-Id': id, ...(init.headers ?? {}) } }), env);

test('health needs no auth', async () => {
  const r = await worker.fetch(new Request('https://x.test/health'), { BUCKET: fakeBucket() });
  assert.equal(r.status, 200);
});

test('rejects missing or short device id', async () => {
  const env = { BUCKET: fakeBucket() };
  assert.equal((await worker.fetch(new Request('https://x.test/backup'), env)).status, 400);
  assert.equal((await call(env, '/backup', {}, 'short')).status, 400);
});

test('APP_KEY is enforced when set', async () => {
  const env = { BUCKET: fakeBucket(), APP_KEY: 'secret' };
  assert.equal((await call(env, '/backup')).status, 401);
  assert.equal((await call(env, '/backup', { headers: { 'X-App-Key': 'secret' } })).status, 404);
});

test('backup round trip, and devices are isolated', async () => {
  const env = { BUCKET: fakeBucket() };
  assert.equal((await call(env, '/backup')).status, 404);
  const put = await call(env, '/backup', { method: 'PUT', body: JSON.stringify({ transactions: [1] }) });
  assert.equal(put.status, 200);
  assert.deepEqual(await (await call(env, '/backup')).json(), { transactions: [1] });
  assert.equal((await call(env, '/backup', {}, B)).status, 404); // other device sees nothing
});

test('backup must be JSON and not too big', async () => {
  const env = { BUCKET: fakeBucket() };
  assert.equal((await call(env, '/backup', { method: 'PUT', body: 'not json' })).status, 400);
  const big = JSON.stringify({ x: 'y'.repeat(5 * 1024 * 1024 + 10) });
  assert.equal((await call(env, '/backup', { method: 'PUT', body: big })).status, 413);
});

test('receipt upload, fetch, delete, and cross-device access', async () => {
  const env = { BUCKET: fakeBucket() };
  const up = await call(env, '/receipts', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: new Uint8Array([1, 2, 3]) });
  assert.equal(up.status, 201);
  const { key } = await up.json();
  assert.match(key, /\.png$/);

  const got = await call(env, `/receipts/${key}`);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('Content-Type'), 'image/png');
  assert.deepEqual([...new Uint8Array(await got.arrayBuffer())], [1, 2, 3]);

  assert.equal((await call(env, `/receipts/${key}`, {}, B)).status, 404);
  assert.equal((await call(env, `/receipts/${key}`, { method: 'DELETE' })).status, 200);
  assert.equal((await call(env, `/receipts/${key}`)).status, 404);
});

test('receipt validation: type, key shape and path traversal', async () => {
  const env = { BUCKET: fakeBucket() };
  assert.equal((await call(env, '/receipts', { method: 'POST', headers: { 'Content-Type': 'text/html' }, body: 'x' })).status, 415);
  assert.equal((await call(env, '/receipts/..%2Fbackup.json')).status, 400);
  assert.equal((await call(env, '/receipts/nope.exe')).status, 400);
});

test('unknown paths 404', async () => {
  assert.equal((await call({ BUCKET: fakeBucket() }, '/nope')).status, 404);
});

// ---- Gemini routes (validation only; no network) ---------------------------
const post = (env, path, body, id = A) =>
  call(env, path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, id);

test('AI routes need a device id and POST', async () => {
  const env = { BUCKET: fakeBucket(), GEMINI_API_KEY: 'x' };
  assert.equal((await worker.fetch(new Request('https://x.test/token', { method: 'POST' }), env)).status, 400);
  assert.equal((await call(env, '/token')).status, 405);
});

test('token rejects unknown models and missing body', async () => {
  const env = { BUCKET: fakeBucket(), GEMINI_API_KEY: 'x' };
  assert.equal((await post(env, '/token', { model: 'models/evil' })).status, 400);
  assert.equal((await post(env, '/token', {})).status, 400);
});

test('parse and insights validate input', async () => {
  const env = { BUCKET: fakeBucket(), GEMINI_API_KEY: 'x' };
  assert.equal((await post(env, '/ai/parse', {})).status, 400);
  assert.equal((await post(env, '/ai/parse', { image_base64: 'A'.repeat(5.5 * 1024 * 1024) })).status, 413);
  assert.equal((await post(env, '/ai/insights', { currency: 'INR' })).status, 400);
});

test('AI limiter blocks by device or by IP', async () => {
  const env = { BUCKET: fakeBucket(), GEMINI_API_KEY: 'x', AI_LIMITER: { limit: async ({ key }) => ({ success: !key.startsWith('i:') }) } };
  assert.equal((await post(env, '/token', { model: 'models/gemini-3.8-live' })).status, 429);
});

// ---- PIN reset by email code (Resend mocked) --------------------------------
function withMail(fn) {
  return async () => {
    const real = globalThis.fetch;
    const sent = [];
    globalThis.fetch = async (url, init) => {
      sent.push({ url: String(url), body: JSON.parse(init.body), auth: init.headers.Authorization });
      return new Response('{}', { status: sent.fail ? 500 : 200 });
    };
    try {
      await fn(sent);
    } finally {
      globalThis.fetch = real;
    }
  };
}
const codeFrom = sent => sent.at(-1).body.html.match(/>(\d{6})</)[1];

test('forgot: 501 when email is not configured', async () => {
  const env = { BUCKET: fakeBucket() };
  assert.equal((await post(env, '/auth/forgot', { email: 'me@x.com' })).status, 501);
});

test('forgot: validates the email and POST only', async () => {
  const env = { BUCKET: fakeBucket(), RESEND_API_KEY: 'k' };
  assert.equal((await post(env, '/auth/forgot', { email: 'nope' })).status, 400);
  assert.equal((await call(env, '/auth/forgot')).status, 405);
});

test('forgot + verify: full happy path, code is single use', withMail(async sent => {
  const env = { BUCKET: fakeBucket(), RESEND_API_KEY: 'key123' };
  assert.equal((await post(env, '/auth/forgot', { email: ' Me@X.com ' })).status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.resend.com/emails');
  assert.equal(sent[0].auth, 'Bearer key123');
  assert.deepEqual(sent[0].body.to, ['me@x.com']);
  const code = codeFrom(sent);
  assert.match(code, /^\d{6}$/);
  // the code itself is never stored, only a hash
  for (const { bytes } of env.BUCKET.store.values()) assert.ok(!new TextDecoder().decode(bytes).includes(code));

  assert.equal((await post(env, '/auth/verify', { email: 'me@x.com', code })).status, 200);
  assert.equal((await post(env, '/auth/verify', { email: 'me@x.com', code })).status, 400); // burned
}));

test('verify: wrong code counts down then burns the code', withMail(async sent => {
  const env = { BUCKET: fakeBucket(), RESEND_API_KEY: 'k' };
  await post(env, '/auth/forgot', { email: 'me@x.com' });
  const real = codeFrom(sent);
  const wrong = real === '000000' ? '111111' : '000000';
  for (let i = 0; i < 4; i++) assert.equal((await post(env, '/auth/verify', { email: 'me@x.com', code: wrong })).status, 400);
  assert.equal((await post(env, '/auth/verify', { email: 'me@x.com', code: wrong })).status, 429);
  assert.equal((await post(env, '/auth/verify', { email: 'me@x.com', code: real })).status, 400); // already burned
}));

test('verify: expired code is rejected', withMail(async sent => {
  const env = { BUCKET: fakeBucket(), RESEND_API_KEY: 'k' };
  await post(env, '/auth/forgot', { email: 'me@x.com' });
  const code = codeFrom(sent);
  const realNow = Date.now;
  Date.now = () => realNow() + 11 * 60 * 1000;
  try {
    assert.equal((await post(env, '/auth/verify', { email: 'me@x.com', code })).status, 400);
  } finally {
    Date.now = realNow;
  }
}));

test('forgot: no code is kept if the email fails to send', withMail(async sent => {
  sent.fail = true;
  const env = { BUCKET: fakeBucket(), RESEND_API_KEY: 'k' };
  assert.equal((await post(env, '/auth/forgot', { email: 'me@x.com' })).status, 502);
  assert.equal(env.BUCKET.store.size, 0);
}));

test('forgot: rate limited by email or IP', withMail(async () => {
  const env = { BUCKET: fakeBucket(), RESEND_API_KEY: 'k', AUTH_LIMITER: { limit: async ({ key }) => ({ success: !key.startsWith('e:') }) } };
  assert.equal((await post(env, '/auth/forgot', { email: 'me@x.com' })).status, 429);
}));
