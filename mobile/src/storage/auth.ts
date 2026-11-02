import AsyncStorage from '@react-native-async-storage/async-storage';
import { sha256 } from '../utils/sha256';

const KEY = 'fintrack.auth.v1';

export const PIN_LENGTH = 4;
const HASH_ROUNDS = 2000;
const FREE_TRIES = 5;

export interface Account {
  email: string;
  salt: string;
  pinHash: string;
  createdAt: number;
  /** Consecutive wrong PINs; reset on success. */
  failed: number;
  /** Epoch ms until which login is blocked. */
  lockedUntil: number;
}

export const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());
export const normalizeEmail = (e: string) => e.trim().toLowerCase();
export const isValidPin = (p: string) => new RegExp(`^\\d{${PIN_LENGTH}}$`).test(p);

function randomSalt(): string {
  let s = '';
  for (let i = 0; i < 32; i++) {
    s += Math.floor(Math.random() * 16).toString(16);
  }
  return s;
}

/** Salted, stretched hash. A 4-digit PIN is easy to brute force, so the real protection is the lockout. */
export function hashPin(pin: string, salt: string): string {
  let h = sha256(`${salt}:${pin}`);
  for (let i = 0; i < HASH_ROUNDS; i++) {
    h = sha256(`${h}${salt}`);
  }
  return h;
}

/** 30 s after 5 wrong tries, then doubling (1 min, 2 min, ...), capped at 1 hour. */
export function lockoutMs(failed: number): number {
  if (failed < FREE_TRIES) {
    return 0;
  }
  return Math.min(60 * 60 * 1000, 30000 * 2 ** (failed - FREE_TRIES));
}

export async function loadAccount(): Promise<Account | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Account) : null;
  } catch {
    return null;
  }
}

async function save(a: Account): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(a));
}

export async function createAccount(email: string, pin: string): Promise<Account> {
  const salt = randomSalt();
  const account: Account = {
    email: normalizeEmail(email),
    salt,
    pinHash: hashPin(pin, salt),
    createdAt: Date.now(),
    failed: 0,
    lockedUntil: 0,
  };
  await save(account);
  return account;
}

export type VerifyResult = { ok: true; account: Account } | { ok: false; account: Account; lockedForMs: number };

/** Checks a PIN, updates the failure counter and lockout, and returns the new state. */
export async function verifyPin(account: Account, pin: string, now = Date.now()): Promise<VerifyResult> {
  if (now < account.lockedUntil) {
    return { ok: false, account, lockedForMs: account.lockedUntil - now };
  }
  if (hashPin(pin, account.salt) === account.pinHash) {
    const next = { ...account, failed: 0, lockedUntil: 0 };
    await save(next);
    return { ok: true, account: next };
  }
  const failed = account.failed + 1;
  const wait = lockoutMs(failed);
  const next = { ...account, failed, lockedUntil: wait ? now + wait : 0 };
  await save(next);
  return { ok: false, account: next, lockedForMs: wait };
}

export async function setNewPin(account: Account, pin: string): Promise<Account> {
  const salt = randomSalt();
  const next = { ...account, salt, pinHash: hashPin(pin, salt), failed: 0, lockedUntil: 0 };
  await save(next);
  return next;
}

export async function deleteAccount(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
