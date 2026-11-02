// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createHash } = require('crypto');

const mockMem = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => (mockMem.has(k) ? mockMem.get(k)! : null),
    setItem: async (k: string, v: string) => void mockMem.set(k, v),
    removeItem: async (k: string) => void mockMem.delete(k),
  },
}));

import { sha256 } from '../src/utils/sha256';
import {
  createAccount,
  deleteAccount,
  hashPin,
  isValidEmail,
  isValidPin,
  loadAccount,
  lockoutMs,
  setNewPin,
  verifyPin,
} from '../src/storage/auth';

describe('sha256', () => {
  it.each(['', 'abc', 'hello world', 'ünïcödé ₹ 😀', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(1000)])(
    'matches node crypto for %j',
    s => {
      expect(sha256(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
    },
  );
});

describe('validation', () => {
  it('checks emails and PINs', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('no spaces@x.com')).toBe(false);
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('12345')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
  });
});

describe('PIN login', () => {
  beforeEach(async () => {
    mockMem.clear();
  });

  it('stores a hash, never the PIN', async () => {
    const a = await createAccount('  Me@Example.COM ', '4821');
    expect(a.email).toBe('me@example.com');
    expect(JSON.stringify(a)).not.toContain('4821');
    expect(a.pinHash).toBe(hashPin('4821', a.salt));
    expect(await loadAccount()).toEqual(a);
  });

  it('accepts the right PIN and rejects a wrong one', async () => {
    const a = await createAccount('me@example.com', '4821');
    expect((await verifyPin(a, '0000')).ok).toBe(false);
    const ok = await verifyPin((await loadAccount())!, '4821');
    expect(ok.ok).toBe(true);
  });

  it('locks after 5 wrong tries, even for the right PIN, then unlocks', async () => {
    let a = await createAccount('me@example.com', '4821');
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) {
      const r = await verifyPin(a, '1111', t0);
      a = r.account;
    }
    expect(a.failed).toBe(5);
    expect(a.lockedUntil).toBe(t0 + 30000);

    const blocked = await verifyPin(a, '4821', t0 + 1000);
    expect(blocked.ok).toBe(false);
    expect(blocked.ok === false && blocked.lockedForMs).toBe(29000);

    const later = await verifyPin(blocked.account, '4821', t0 + 31000);
    expect(later.ok).toBe(true);
    expect(later.account.failed).toBe(0);
  });

  it('lockout grows and is capped', () => {
    expect(lockoutMs(4)).toBe(0);
    expect(lockoutMs(5)).toBe(30000);
    expect(lockoutMs(6)).toBe(60000);
    expect(lockoutMs(50)).toBe(3600000);
  });

  it('resets the PIN with a new salt and clears the lockout', async () => {
    let a = await createAccount('me@example.com', '4821');
    for (let i = 0; i < 5; i++) {
      a = (await verifyPin(a, '1111')).account;
    }
    const b = await setNewPin(a, '9999');
    expect(b.salt).not.toBe(a.salt);
    expect(b.lockedUntil).toBe(0);
    expect((await verifyPin(b, '9999')).ok).toBe(true);
    expect((await verifyPin(b, '4821')).ok).toBe(false);
  });

  it('can be deleted', async () => {
    await createAccount('me@example.com', '4821');
    await deleteAccount();
    expect(await loadAccount()).toBeNull();
  });
});
