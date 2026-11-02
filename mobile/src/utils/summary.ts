import { DB } from '../types';
import { addMonthKey, dateInMonth, monthKey, today as todayISO } from './dates';
import { billDisplayName, billStatus, typeOf } from './bills';
import { bankName } from './banks';
import { debtOutstanding, debtSettled, round2 } from './money';

export interface MonthTotals {
  key: string;
  credits: number;
  debits: number;
}

/** Money in and out through transactions in a month. */
export function monthTotals(db: Pick<DB, 'transactions'>, key: string): MonthTotals {
  let credits = 0;
  let debits = 0;
  for (const t of db.transactions) {
    if (monthKey(t.date) !== key) {
      continue;
    }
    if (t.kind === 'credit') {
      credits += t.amount;
    } else {
      debits += t.amount;
    }
  }
  return { key, credits: round2(credits), debits: round2(debits) };
}

export const totalOwe = (db: Pick<DB, 'debts'>) =>
  round2(db.debts.filter(d => d.direction === 'owe').reduce((s, d) => s + debtOutstanding(d), 0));
export const totalOwed = (db: Pick<DB, 'debts'>) =>
  round2(db.debts.filter(d => d.direction === 'owed').reduce((s, d) => s + debtOutstanding(d), 0));

// ------------------------------------------------------------------ dues ---
export interface Due {
  /** Stable id, used for notification ids. */
  id: string;
  kind: 'bill' | 'debt';
  title: string;
  amount?: number;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  sourceId: string;
  autoDebit?: boolean;
  bank?: string;
  overdue: boolean;
}

const DEFAULT_TIME = '09:00';

/**
 * Everything still to be paid, soonest first: unpaid bills (this cycle), plus
 * borrowed money with a due date. One entry per bill / debt.
 */
export function upcomingPayments(db: DB, today = todayISO()): Due[] {
  const dues: Due[] = [];

  for (const bill of db.bills) {
    const type = typeOf(db.billTypes, bill);
    const kind = type?.kind ?? 'standard';
    const st = billStatus(bill, kind, today);
    if (st.state === 'paid') {
      continue;
    }
    dues.push({
      id: `bill-${bill.id}-${st.cycle}`,
      kind: 'bill',
      title: kind === 'recharge' ? `${billDisplayName(bill, type)} expires` : billDisplayName(bill, type),
      amount: bill.amount,
      date: st.date,
      time: bill.time ?? DEFAULT_TIME,
      sourceId: bill.id,
      autoDebit: bill.payType === 'auto',
      bank: bankName(db, bill.bankId),
      overdue: st.state === 'overdue',
    });
  }

  for (const d of db.debts) {
    if (d.direction === 'owe' && d.dueDate && !debtSettled(d)) {
      dues.push({
        id: `debt-${d.id}`,
        kind: 'debt',
        title: `Repay ${d.person}`,
        amount: debtOutstanding(d),
        date: d.dueDate,
        time: DEFAULT_TIME,
        sourceId: d.id,
        overdue: d.dueDate < today,
      });
    }
  }
  return dues.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

/**
 * Dues for scheduling notifications: the current unpaid cycle of every bill
 * and the next two months after it, so reminders keep coming without opening the app.
 */
export function notificationDues(db: DB, today = todayISO()): Due[] {
  const dues: Due[] = [];
  for (const bill of db.bills) {
    const type = typeOf(db.billTypes, bill);
    const kind = type?.kind ?? 'standard';
    const st = billStatus(bill, kind, today);
    const base = {
      kind: 'bill' as const,
      title: kind === 'recharge' ? `${billDisplayName(bill, type)} expires` : billDisplayName(bill, type),
      amount: bill.amount,
      time: bill.time ?? DEFAULT_TIME,
      sourceId: bill.id,
      autoDebit: bill.payType === 'auto',
      bank: bankName(db, bill.bankId),
    };
    const count = kind === 'recharge' ? 1 : 3;
    for (let i = 0; i < count; i++) {
      const cycle = kind === 'recharge' ? st.cycle : addMonthKey(st.cycle, i);
      const date = kind === 'recharge' ? st.date : dateInMonth(cycle, bill.dueDay);
      dues.push({ ...base, id: `bill-${bill.id}-${cycle}`, date, overdue: date < today });
    }
  }
  for (const d of upcomingPayments(db, today)) {
    if (d.kind === 'debt') {
      dues.push(d);
    }
  }
  return dues.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}
