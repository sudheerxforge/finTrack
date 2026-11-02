import { APP_KEY } from '../config';

const TIMEOUT_MS = 20000;

// The Worker identifies a phone by this private random id (set once the data loads).
let deviceId = '';
export function setDeviceId(id: string) {
  deviceId = id;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

/** fetch with a timeout and friendly errors. Returns the raw Response when ok. */
export async function request(
  baseUrl: string,
  path: string,
  init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> } = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (APP_KEY) {
    headers['X-App-Key'] = APP_KEY;
  }
  if (deviceId && !headers['X-Device-Id']) {
    headers['X-Device-Id'] = deviceId;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } catch (e: any) {
    const why = controller.signal.aborted ? 'timed out' : 'network error';
    console.warn(`[finTrack] ${init.method ?? 'GET'} ${baseUrl}${path} failed (${why}): ${e?.message ?? e}`);
    throw new ApiError(`Can't reach ${baseUrl} (${why}). Is the server running?`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(body?.detail ?? `Server error (HTTP ${res.status})`, res.status);
  }
  return res;
}
