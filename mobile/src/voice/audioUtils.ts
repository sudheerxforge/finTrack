/* eslint-disable no-bitwise */
// PCM / base64 / UTF-8 helpers, reused from the LiveVoice app.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Uint8Array(128);
for (let i = 0; i < B64.length; i++) {
  B64_LOOKUP[B64.charCodeAt(i)] = i;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64[n >> 18] + B64[(n >> 12) & 63] + '==';
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  return out;
}

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = new Uint8Array((clean.length * 3) >> 2);
  let j = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64_LOOKUP[clean.charCodeAt(i)] << 18) |
      (B64_LOOKUP[clean.charCodeAt(i + 1)] << 12) |
      ((B64_LOOKUP[clean.charCodeAt(i + 2)] ?? 0) << 6) |
      (B64_LOOKUP[clean.charCodeAt(i + 3)] ?? 0);
    if (j < bytes.length) { bytes[j++] = (n >> 16) & 255; }
    if (j < bytes.length) { bytes[j++] = (n >> 8) & 255; }
    if (j < bytes.length) { bytes[j++] = n & 255; }
  }
  return bytes;
}

export function float32ToPcm16Base64(samples: Float32Array): string {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  // Int16Array uses platform endianness; all Android/iOS devices are little-endian.
  return bytesToBase64(new Uint8Array(pcm.buffer));
}

export function pcm16Base64ToFloat32(base64: string): Float32Array<ArrayBuffer> {
  const bytes = base64ToBytes(base64);
  const pcm = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    out[i] = pcm[i] / 0x8000;
  }
  return out;
}

// Linear resampling; only used if the device refuses a 24 kHz audio context.
export function resample(
  input: Float32Array<ArrayBuffer>,
  fromRate: number,
  toRate: number,
): Float32Array<ArrayBuffer> {
  if (fromRate === toRate) {
    return input;
  }
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.round(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

// Gemini sends JSON as binary WebSocket frames, so decode UTF-8 manually
// (TextDecoder is not guaranteed to exist in React Native).
export function utf8Decode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i++];
    let cp: number;
    if (b < 0x80) {
      cp = b;
    } else if (b < 0xe0) {
      cp = ((b & 0x1f) << 6) | (bytes[i++] & 0x3f);
    } else if (b < 0xf0) {
      cp = ((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    } else {
      cp =
        ((b & 0x07) << 18) |
        ((bytes[i++] & 0x3f) << 12) |
        ((bytes[i++] & 0x3f) << 6) |
        (bytes[i++] & 0x3f);
    }
    out += String.fromCodePoint(cp);
  }
  return out;
}
