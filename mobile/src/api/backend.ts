import { BACKEND_URL } from '../config';
import { request } from './http';

export interface ParsedTransaction {
  kind: 'credit' | 'debit';
  amount: number;
  category: string;
  note: string;
  date: string;
}

/** Single-use Gemini Live token. The real API key stays on the server. */
export async function fetchLiveToken(model: string): Promise<string> {
  const res = await request(BACKEND_URL, '/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  });
  const body = await res.json();
  if (!body?.token) {
    throw new Error('Backend did not return a token');
  }
  return body.token;
}

export function liveSocketUrl(token: string): string {
  return (
    'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.' +
    'v1alpha.GenerativeService.BidiGenerateContentConstrained' +
    `?access_token=${encodeURIComponent(token)}`
  );
}

/** "paid 450 for groceries yesterday" or a receipt photo -> transactions. */
export async function parseTransactions(input: {
  text?: string;
  imageBase64?: string;
  mimeType?: string;
  categories: string[];
}): Promise<ParsedTransaction[]> {
  const res = await request(BACKEND_URL, '/ai/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: input.text,
      image_base64: input.imageBase64,
      mime_type: input.mimeType ?? 'image/jpeg',
      categories: input.categories,
    }),
  });
  const body = await res.json();
  return body.transactions ?? [];
}

export async function fetchInsights(summary: object, currency: string): Promise<string[]> {
  const res = await request(BACKEND_URL, '/ai/insights', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary, currency }),
  });
  const body = await res.json();
  return body.tips ?? [];
}

/** Emails a 6-digit PIN-reset code. Throws ApiError (status 501 = server email not set up). */
export async function sendResetCode(email: string): Promise<void> {
  await request(BACKEND_URL, '/auth/forgot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

export async function verifyResetCode(email: string, code: string): Promise<void> {
  await request(BACKEND_URL, '/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
}
