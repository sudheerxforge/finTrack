/**
 * finTrack API on Cloudflare Workers (+ R2).
 *
 *   GET    /health
 *   POST   /token               single-use Gemini Live token   { model }
 *   POST   /ai/parse            text / receipt photo -> transactions
 *   POST   /ai/insights         short money tips
 *   POST   /auth/forgot         email a PIN-reset code      { email }
 *   POST   /auth/verify         check the code              { email, code }
 *   PUT    /backup              body: JSON backup of the app's data
 *   GET    /backup              -> the last backup (404 if none)
 *   POST   /receipts            body: image bytes (Content-Type image/*) -> { key }
 *   GET    /receipts/:key       -> the image
 *   DELETE /receipts/:key
 *
 * Every call except /health needs an X-Device-Id header (a random id the app
 * creates once). Storage is per device: devices/<id>/...  The Gemini key is a
 * Worker secret and never reaches the phone.
 * If the APP_KEY secret is set, X-App-Key must match it too.
 *
 * Note: a device id is a bearer secret for that device's stored data, so the
 * app keeps it private and never logs it.
 */
import { type AiEnv, handleInsights, handleParse, handleToken } from './ai.ts';
import { type AuthEnv, handleForgot, handleVerify } from './auth.ts';

interface Env extends AiEnv, AuthEnv {
  APP_KEY?: string;
  /** 60/min per device, for storage calls. */
  RATE_LIMITER?: RateLimit;
  /** 10/min per device, for the Gemini routes (they cost money). */
  AI_LIMITER?: RateLimit;
}

const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9-]{16,64}$/;
const KEY_RE = /^[A-Za-z0-9-]{8,64}\.(jpg|png|webp)$/;
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** Reads the body but refuses anything bigger than `max` bytes. */
async function readLimited(request: Request, max: number): Promise<ArrayBuffer | null> {
  const declared = Number(request.headers.get('Content-Length') ?? 0);
  if (declared > max) return null;
  const buf = await request.arrayBuffer();
  return buf.byteLength > max ? null : buf;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/health') return json({ status: 'ok' });

    if (env.APP_KEY && request.headers.get('X-App-Key') !== env.APP_KEY) {
      return json({ detail: 'Unauthorized' }, 401);
    }

    const deviceId = request.headers.get('X-Device-Id') ?? '';
    if (!ID_RE.test(deviceId)) {
      return json({ detail: 'Missing or invalid X-Device-Id' }, 400);
    }

    if (env.RATE_LIMITER) {
      const { success } = await env.RATE_LIMITER.limit({ key: deviceId });
      if (!success) return json({ detail: 'Too many requests' }, 429, { 'Retry-After': '60' });
    }

    // ---- Gemini routes --------------------------------------------------
    if (path === '/token' || path === '/ai/parse' || path === '/ai/insights') {
      if (request.method !== 'POST') return json({ detail: 'Method not allowed' }, 405, { Allow: 'POST' });
      if (env.AI_LIMITER) {
        const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
        // Limit by device AND by IP so a new device id can't dodge the limit.
        const [byDevice, byIp] = await Promise.all([
          env.AI_LIMITER.limit({ key: `d:${deviceId}` }),
          env.AI_LIMITER.limit({ key: `i:${ip}` }),
        ]);
        if (!byDevice.success || !byIp.success) {
          return json({ detail: 'Too many requests. Please wait a minute.' }, 429, { 'Retry-After': '60' });
        }
      }
      if (path === '/token') return handleToken(request, env);
      if (path === '/ai/parse') return handleParse(request, env);
      return handleInsights(request, env);
    }

    // ---- PIN reset by email code ----------------------------------------
    if (path === '/auth/forgot' || path === '/auth/verify') {
      if (request.method !== 'POST') return json({ detail: 'Method not allowed' }, 405, { Allow: 'POST' });
      return path === '/auth/forgot' ? handleForgot(request, env) : handleVerify(request, env);
    }

    const prefix = `devices/${deviceId}`;

    // ---- backup ---------------------------------------------------------
    if (path === '/backup') {
      const key = `${prefix}/backup.json`;
      if (request.method === 'PUT') {
        const buf = await readLimited(request, MAX_BACKUP_BYTES);
        if (!buf) return json({ detail: 'Backup too large (max 5 MB)' }, 413);
        try {
          JSON.parse(new TextDecoder().decode(buf));
        } catch {
          return json({ detail: 'Body must be JSON' }, 400);
        }
        await env.BUCKET.put(key, buf, { httpMetadata: { contentType: 'application/json' } });
        return json({ ok: true, savedAt: new Date().toISOString() });
      }
      if (request.method === 'GET') {
        const obj = await env.BUCKET.get(key);
        if (!obj) return json({ detail: 'No backup yet' }, 404);
        return new Response(obj.body, {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
      }
      return json({ detail: 'Method not allowed' }, 405, { Allow: 'GET, PUT' });
    }

    // ---- receipts -------------------------------------------------------
    if (path === '/receipts' && request.method === 'POST') {
      const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim();
      const ext = EXT[type];
      if (!ext) return json({ detail: 'Content-Type must be image/jpeg, png or webp' }, 415);
      const buf = await readLimited(request, MAX_RECEIPT_BYTES);
      if (!buf) return json({ detail: 'Image too large (max 5 MB)' }, 413);
      const key = `${crypto.randomUUID()}.${ext}`;
      await env.BUCKET.put(`${prefix}/receipts/${key}`, buf, {
        httpMetadata: { contentType: type },
      });
      return json({ key }, 201);
    }

    const m = path.match(/^\/receipts\/([^/]+)$/);
    if (m) {
      const name = m[1];
      if (!KEY_RE.test(name)) return json({ detail: 'Bad receipt key' }, 400);
      const key = `${prefix}/receipts/${name}`;
      if (request.method === 'GET') {
        const obj = await env.BUCKET.get(key);
        if (!obj) return json({ detail: 'Not found' }, 404);
        return new Response(obj.body, {
          headers: {
            'Content-Type': MIME[name.split('.').pop()!],
            'Cache-Control': 'private, max-age=86400',
          },
        });
      }
      if (request.method === 'DELETE') {
        await env.BUCKET.delete(key);
        return json({ ok: true });
      }
      return json({ detail: 'Method not allowed' }, 405, { Allow: 'GET, DELETE' });
    }

    return json({ detail: 'Not found' }, 404);
  },
} satisfies ExportedHandler<Env>;
