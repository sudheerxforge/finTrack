import { STORAGE_URL } from '../config';
import { DB } from '../types';
import { request } from './http';

const idHeader = (deviceId: string) => ({ 'X-Device-Id': deviceId });

export async function uploadBackup(deviceId: string, db: DB): Promise<void> {
  await request(STORAGE_URL, '/backup', {
    method: 'PUT',
    headers: { ...idHeader(deviceId), 'Content-Type': 'application/json' },
    body: JSON.stringify(db),
  });
}

/** Returns the saved backup, or null if this device has none yet. */
export async function downloadBackup(deviceId: string): Promise<unknown | null> {
  try {
    const res = await request(STORAGE_URL, '/backup', { headers: idHeader(deviceId) });
    return await res.json();
  } catch (e: any) {
    if (e?.status === 404) {
      return null;
    }
    throw e;
  }
}

/** Uploads an image file (file:// uri) and returns its receipt key. */
export async function uploadReceipt(deviceId: string, uri: string, mimeType: string): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  const res = await request(STORAGE_URL, '/receipts', {
    method: 'POST',
    headers: { ...idHeader(deviceId), 'Content-Type': mimeType },
    body: blob,
  });
  const body = await res.json();
  return body.key as string;
}

export async function deleteReceipt(deviceId: string, key: string): Promise<void> {
  await request(STORAGE_URL, `/receipts/${key}`, { method: 'DELETE', headers: idHeader(deviceId) });
}

/**
 * <Image source> for a receipt. React Native Image can send headers, so the
 * device id never goes in the URL.
 */
export function receiptSource(deviceId: string, key: string) {
  return { uri: `${STORAGE_URL}/receipts/${key}`, headers: idHeader(deviceId) };
}
