/**
 * Gemini-backed routes (port of backend/main.py):
 *   POST /token         -> { token, expires_at }   body { model }
 *   POST /ai/parse      -> { transactions: [...] } body { text?, image_base64?, mime_type?, categories? }
 *   POST /ai/insights   -> { tips: [...] }         body { summary, currency? }
 */
import { GoogleGenAI, Type } from '@google/genai';

export interface AiEnv {
  GEMINI_API_KEY: string;
  /** Optional override, e.g. a newer model name. */
  TEXT_MODEL?: string;
}

const DEFAULT_TEXT_MODEL = 'gemini-flash-lite-latest';
const ALLOWED_LIVE_MODELS = new Set(['models/gemini-3.8-live', 'models/gemini-3.8-live-extended-thinking']);
const NEW_SESSION_WINDOW_MS = 60 * 1000;
const TOKEN_LIFETIME_MS = 30 * 60 * 1000;
export const MAX_JSON_BYTES = 6 * 1024 * 1024; // receipt photos arrive as base64
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function readJson(request: Request): Promise<any | null> {
  const declared = Number(request.headers.get('Content-Length') ?? 0);
  if (declared > MAX_JSON_BYTES) return null;
  const text = await request.text();
  if (text.length > MAX_JSON_BYTES) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** generateContent with a few retries: Gemini sometimes answers 503 (busy). */
async function generate(env: AiEnv, contents: any, config: any): Promise<string> {
  const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY, httpOptions: { timeout: 25000 } });
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await client.models.generateContent({
        model: env.TEXT_MODEL || DEFAULT_TEXT_MODEL,
        contents,
        config,
      });
      return res.text ?? '';
    } catch (e: any) {
      last = e;
      const msg = String(e?.message ?? e);
      if (!msg.includes('503') && !msg.includes('UNAVAILABLE')) throw e;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw last;
}

export async function handleToken(request: Request, env: AiEnv): Promise<Response> {
  const body = await readJson(request);
  const model = typeof body?.model === 'string' ? body.model : null;
  if (!model) return json({ detail: 'Request body must be JSON like {"model": "..."}' }, 400);
  if (!ALLOWED_LIVE_MODELS.has(model)) return json({ detail: `Model not allowed: ${model}` }, 400);

  const now = Date.now();
  const expiresAt = new Date(now + TOKEN_LIFETIME_MS).toISOString();
  try {
    // Ephemeral tokens are only available in the v1alpha API.
    const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY, httpOptions: { apiVersion: 'v1alpha' } });
    const token = await client.authTokens.create({
      config: {
        uses: 1,
        expireTime: expiresAt,
        newSessionExpireTime: new Date(now + NEW_SESSION_WINDOW_MS).toISOString(),
        liveConnectConstraints: { model },
        lockAdditionalFields: [],
      },
    });
    return json({ token: token.name, expires_at: expiresAt });
  } catch (e) {
    console.error('Token creation failed:', e);
    return json({ detail: 'Could not create token' }, 502);
  }
}

const TX_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      kind: { type: Type.STRING, enum: ['credit', 'debit'] },
      amount: { type: Type.NUMBER },
      category: { type: Type.STRING },
      note: { type: Type.STRING },
      date: { type: Type.STRING, description: 'YYYY-MM-DD' },
    },
    required: ['kind', 'amount', 'category', 'note', 'date'],
  },
};

export async function handleParse(request: Request, env: AiEnv): Promise<Response> {
  const body = await readJson(request);
  if (!body) return json({ detail: 'Body must be JSON (max 6 MB)' }, 400);
  const text = typeof body.text === 'string' ? body.text.slice(0, 2000) : '';
  const image = typeof body.image_base64 === 'string' ? body.image_base64 : '';
  if (!text && !image) return json({ detail: 'Send text or image_base64' }, 400);
  // base64 length * 3/4 ~ bytes
  if (image.length * 0.75 > MAX_IMAGE_BYTES) return json({ detail: 'Image too large (max 4 MB)' }, 413);

  const mime = ['image/jpeg', 'image/png', 'image/webp'].includes(body.mime_type) ? body.mime_type : 'image/jpeg';
  const cats = Array.isArray(body.categories) && body.categories.length
    ? body.categories.filter((c: unknown) => typeof c === 'string').slice(0, 40).join(', ')
    : 'Food, Transport, Bills, Shopping, Salary, Other';
  const today = new Date().toISOString().slice(0, 10);
  const instruction =
    `Today is ${today}. Extract every money transaction from the input. kind is 'debit' when money goes out ` +
    `(spent, paid, bought) and 'credit' when money comes in (received, salary, refund). amount is a positive ` +
    `number. category must be one of: ${cats}. date is YYYY-MM-DD; resolve words like 'yesterday' using ` +
    `today's date. note is a few words.`;

  const parts: any[] = [{ text: instruction }];
  if (text) parts.push({ text });
  if (image) parts.push({ inlineData: { mimeType: mime, data: image } });

  try {
    const out = await generate(env, [{ role: 'user', parts }], {
      responseMimeType: 'application/json',
      responseSchema: TX_SCHEMA,
    });
    const items = JSON.parse(out);
    const transactions = (Array.isArray(items) ? items : [])
      .filter((t: any) => (t.kind === 'credit' || t.kind === 'debit') && Number(t.amount) > 0)
      .map((t: any) => ({
        kind: t.kind,
        amount: Number(t.amount),
        category: String(t.category ?? 'Other'),
        note: String(t.note ?? ''),
        date: String(t.date ?? today),
      }));
    return json({ transactions });
  } catch (e) {
    console.error('Parse failed:', e);
    return json({ detail: 'Could not parse that' }, 502);
  }
}

export async function handleInsights(request: Request, env: AiEnv): Promise<Response> {
  const body = await readJson(request);
  if (!body || typeof body.summary !== 'object' || body.summary === null) {
    return json({ detail: 'Body must be JSON like {"summary": {...}}' }, 400);
  }
  const currency = typeof body.currency === 'string' ? body.currency.slice(0, 5) : 'INR';
  const prompt =
    `You are a practical personal-finance coach. Based on this summary (currency ${currency}), give 3 to 5 ` +
    `short, specific tips to spend less, clear debts faster or save more. One sentence each. No ` +
    `investment-product recommendations.\n\n` + JSON.stringify(body.summary).slice(0, 6000);
  try {
    const out = await generate(env, prompt, {
      responseMimeType: 'application/json',
      responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } },
    });
    const tips = JSON.parse(out);
    return json({ tips: Array.isArray(tips) ? tips.map(String).slice(0, 6) : [] });
  } catch (e) {
    console.error('Insights failed:', e);
    return json({ detail: 'Could not get tips' }, 502);
  }
}
