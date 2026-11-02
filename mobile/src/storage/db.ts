import AsyncStorage from '@react-native-async-storage/async-storage';
import { BillType, DB } from '../types';
import { newDeviceId } from '../utils/ids';
import { DEFAULT_BILL_TYPES } from '../data/billTypes';

const KEY = 'fintrack.db.v1';

export function emptyDB(): DB {
  return {
    version: 2,
    banks: [],
    transactions: [],
    debts: [],
    billTypes: DEFAULT_BILL_TYPES.map(t => ({ ...t })),
    bills: [],
    interestDebts: [],
    settings: { currency: '₹', deviceId: newDeviceId(), remindDaysBefore: 2 },
  };
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/**
 * Fills in anything missing, so older data (this app's first version) and
 * backups still load. Built-in bill tabs are always present; custom tabs are kept.
 * Things that no longer exist (EMI loans, budgets, reminders) are dropped.
 */
export function normalizeDB(raw: any): DB {
  const base = emptyDB();
  if (!raw || typeof raw !== 'object') {
    return base;
  }
  const custom = arr<BillType>(raw.billTypes).filter(t => t && t.custom && t.id && t.name);
  return {
    version: 2,
    banks: arr(raw.banks),
    transactions: arr(raw.transactions),
    debts: arr(raw.debts),
    billTypes: [...DEFAULT_BILL_TYPES.map(t => ({ ...t })), ...custom],
    bills: arr<any>(raw.bills).map(b => ({
      ...b,
      label: b.label ?? '',
      payments: arr(b.payments),
      dueDay: b.dueDay ?? Number(String(b.dueDate).slice(8, 10)),
      startCycle: b.startCycle ?? String(b.dueDate).slice(0, 7),
    })),
    interestDebts: arr<any>(raw.interestDebts).map(d => ({ ...d, payments: arr(d.payments) })),
    settings: { ...base.settings, ...(raw.settings ?? {}) },
  };
}

export async function loadDB(): Promise<DB> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const db = normalizeDB(raw ? JSON.parse(raw) : null);
    if (!raw) {
      await saveDB(db); // keep the generated deviceId stable
    }
    return db;
  } catch (e) {
    console.warn('[finTrack] could not read data:', e);
    return emptyDB();
  }
}

export async function saveDB(db: DB): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(db));
  } catch (e) {
    console.warn('[finTrack] could not save data:', e);
  }
}
