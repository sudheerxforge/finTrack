export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** 32 hex chars. The device's private id for the cloud backup (acts like a password). */
export function newDeviceId(): string {
  let s = '';
  for (let i = 0; i < 32; i++) {
    s += Math.floor(Math.random() * 16).toString(16);
  }
  return s;
}
