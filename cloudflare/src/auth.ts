/**
 * "Forgot PIN" by email code.
 *   POST /auth/forgot   { email }        -> emails a 6-digit code (valid 10 min)
 *   POST /auth/verify   { email, code }  -> { ok: true } and the code is burned
 *
 * Sending uses Resend (https://resend.com). Set the RESEND_API_KEY secret, and
 * optionally MAIL_FROM. Without the key /auth/forgot answers 501 so the app can
 * tell the user honestly instead of pretending an email was sent.
 *
 * Only a hash of the code is stored (in R2), and it is single use with a
 * 5-try limit. The PIN itself never reaches the server.
 */

export interface AuthEnv {
  BUCKET: R2Bucket;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  /** 3/min per email and per IP, so the Worker can't be used to spam an inbox. */
  AUTH_LIMITER?: RateLimit;
}

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_TRIES = 5;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function sixDigits(): string {
  // Rejection sampling so every code is equally likely.
  const arr = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / 1000000) * 1000000;
  do {
    crypto.getRandomValues(arr);
  } while (arr[0] >= limit);
  return String(arr[0] % 1000000).padStart(6, '0');
}

async function readBody(request: Request): Promise<any | null> {
  const text = await request.text();
  if (text.length > 2048) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const cleanEmail = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
const recordKey = async (email: string) => `auth/${await sha256Hex(email)}.json`;

export async function handleForgot(request: Request, env: AuthEnv): Promise<Response> {
  const body = await readBody(request);
  const email = cleanEmail(body?.email);
  if (!EMAIL_RE.test(email)) return json({ detail: 'Enter a valid email address' }, 400);
  if (!env.RESEND_API_KEY) {
    return json({ detail: 'Email reset is not set up on the server yet' }, 501);
  }

  if (env.AUTH_LIMITER) {
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const [byEmail, byIp] = await Promise.all([
      env.AUTH_LIMITER.limit({ key: `e:${await sha256Hex(email)}` }),
      env.AUTH_LIMITER.limit({ key: `i:${ip}` }),
    ]);
    if (!byEmail.success || !byIp.success) {
      return json({ detail: 'Too many requests. Please wait a minute.' }, 429, { 'Retry-After': '60' });
    }
  }

  const code = sixDigits();
  const record = { hash: await sha256Hex(`${email}:${code}`), exp: Date.now() + CODE_TTL_MS, tries: 0 };

  // Send first; only keep the code if the email actually went out.
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.MAIL_FROM || 'FINTRACK <onboarding@resend.dev>',
      to: [email],
      subject: 'Your FINTRACK PIN reset code',
      html:
        `<div style="font-family:system-ui,sans-serif"><h2>FINTRACK</h2>` +
        `<p>Your PIN reset code is:</p><p style="font-size:32px;font-weight:800;letter-spacing:6px">${code}</p>` +
        `<p>It expires in 10 minutes. If you did not ask for this, you can ignore this email.</p></div>`,
    }),
  });
  if (!res.ok) {
    console.error('Resend failed:', res.status, await res.text().catch(() => ''));
    return json({ detail: 'Could not send the email. Try again later.' }, 502);
  }
  await env.BUCKET.put(await recordKey(email), JSON.stringify(record), {
    httpMetadata: { contentType: 'application/json' },
  });
  return json({ ok: true });
}

export async function handleVerify(request: Request, env: AuthEnv): Promise<Response> {
  const body = await readBody(request);
  const email = cleanEmail(body?.email);
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) return json({ detail: 'Enter the 6-digit code' }, 400);

  const key = await recordKey(email);
  const obj = await env.BUCKET.get(key);
  if (!obj) return json({ detail: 'No code requested, or it expired. Ask for a new one.' }, 400);
  const record = JSON.parse(await obj.text()) as { hash: string; exp: number; tries: number };

  if (Date.now() > record.exp) {
    await env.BUCKET.delete(key);
    return json({ detail: 'That code expired. Ask for a new one.' }, 400);
  }
  if ((await sha256Hex(`${email}:${code}`)) !== record.hash) {
    record.tries += 1;
    if (record.tries >= MAX_TRIES) {
      await env.BUCKET.delete(key);
      return json({ detail: 'Too many wrong codes. Ask for a new one.' }, 429);
    }
    await env.BUCKET.put(key, JSON.stringify(record), { httpMetadata: { contentType: 'application/json' } });
    return json({ detail: `Wrong code. ${MAX_TRIES - record.tries} tries left.` }, 400);
  }
  await env.BUCKET.delete(key); // single use
  return json({ ok: true });
}
