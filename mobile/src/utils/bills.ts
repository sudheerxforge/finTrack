import { Bill, BillType, DB } from '../types';
import { addMonthKey, daysBetween, dateInMonth } from './dates';
import { round2 } from './money';

export type BillState = 'overdue' | 'due-today' | 'upcoming' | 'paid';

export interface BillStatus {
  state: BillState;
  /** The date that matters now: the due date of the unpaid cycle, or the next one if all is paid. */
  date: string;
  /** The cycle the date belongs to. */
  cycle: string;
  /** Days from today to `date` (negative = overdue). */
  daysLeft: number;
}

export const typeOf = (types: BillType[], bill: Bill): BillType | undefined => types.find(t => t.id === bill.typeId);
export const isRechargeType = (t?: BillType) => t?.kind === 'recharge';

/**
 * Where a bill stands today.
 *
 * Standard bills repeat every month on `dueDay`. Cycles before `startCycle`
 * aren't owed. The status is about the first cycle that isn't paid yet; if
 * this month is paid, the state is "paid" and `date` is the next due date.
 *
 * Recharges aren't monthly: `dueDate` is the expiry, and it moves forward each
 * time you recharge, so they are never "paid", just valid until a date.
 */
export function billStatus(bill: Bill, kind: 'standard' | 'recharge', today: string): BillStatus {
  const byDate = (date: string, cycle: string): BillStatus => {
    const daysLeft = daysBetween(today, date);
    return {
      state: daysLeft < 0 ? 'overdue' : daysLeft === 0 ? 'due-today' : 'upcoming',
      date,
      cycle,
      daysLeft,
    };
  };

  if (kind === 'recharge') {
    return byDate(bill.dueDate, bill.dueDate);
  }

  const paid = new Set(bill.payments.map(p => p.cycle));
  const current = today.slice(0, 7);
  let cycle = bill.startCycle;
  // Skip over every cycle that is already paid (even ones paid in advance).
  for (let guard = 0; paid.has(cycle) && guard < 1200; guard++) {
    cycle = addMonthKey(cycle, 1);
  }

  if (cycle <= current) {
    return byDate(dateInMonth(cycle, bill.dueDay), cycle);
  }
  const date = dateInMonth(cycle, bill.dueDay);
  const daysLeft = daysBetween(today, date);
  // Everything up to this month is paid when this month's cycle counts and is settled.
  const thisMonthIsPaid = current >= bill.startCycle;
  return { state: thisMonthIsPaid ? 'paid' : 'upcoming', date, cycle, daysLeft };
}

export const billDisplayName = (bill: Bill, type?: BillType): string => bill.label.trim() || type?.name || 'Bill';

/** "9392 ●●●● 69" */
export function maskedPhone(bill: Pick<Bill, 'phoneStart' | 'phoneEnd'>): string {
  return `${bill.phoneStart ?? '••••'} ●●●● ${bill.phoneEnd ?? '••'}`;
}

/** Short text for a card: "Overdue by 3 days", "Due tomorrow", "Paid · next 10th Dec". */
export function statusText(status: BillStatus, kind: 'standard' | 'recharge'): string {
  const n = status.daysLeft;
  if (kind === 'recharge') {
    if (n < 0) return `Expired ${-n} day${n === -1 ? '' : 's'} ago`;
    if (n === 0) return 'Expires today';
    if (n === 1) return 'Expires tomorrow';
    return `Expires in ${n} days`;
  }
  if (status.state === 'paid') return 'Paid this month';
  if (n < 0) return `Overdue by ${-n} day${n === -1 ? '' : 's'}`;
  if (n === 0) return 'Due today';
  if (n === 1) return 'Due tomorrow';
  return `Due in ${n} days`;
}

export interface MonthBillSummary {
  /** Planned or actual amounts of every bill that falls in the month. */
  total: number;
  paid: number;
  remaining: number;
  count: number;
  paidCount: number;
  overdueCount: number;
}

/** What the month looks like across all bills: how much, how much is paid, how much is left. */
export function monthBillSummary(db: DB, month: string, today: string): MonthBillSummary {
  let total = 0;
  let paid = 0;
  let count = 0;
  let paidCount = 0;
  let overdueCount = 0;

  for (const bill of db.bills) {
    const kind = typeOf(db.billTypes, bill)?.kind ?? 'standard';
    if (kind === 'recharge') {
      // Recharges count in the month they expire, or in the month a recharge was paid.
      const made = bill.payments.filter(p => p.date.slice(0, 7) === month);
      if (made.length) {
        const amt = round2(made.reduce((s, p) => s + p.amount, 0));
        total += amt;
        paid += amt;
        count += 1;
        paidCount += 1;
      }
      if (bill.dueDate.slice(0, 7) === month) {
        total += bill.amount ?? 0;
        count += 1;
        if (bill.dueDate < today) overdueCount += 1;
      }
      continue;
    }
    if (bill.startCycle > month) continue;
    count += 1;
    const payment = bill.payments.find(p => p.cycle === month);
    if (payment) {
      total += payment.amount;
      paid += payment.amount;
      paidCount += 1;
    } else {
      total += bill.amount ?? 0;
      if (dateInMonth(month, bill.dueDay) < today) overdueCount += 1;
    }
  }
  return {
    total: round2(total),
    paid: round2(paid),
    remaining: round2(Math.max(0, total - paid)),
    count,
    paidCount,
    overdueCount,
  };
}

/** Every payment made in a month, newest first, with its bill and tab. */
export function billPaymentsInMonth(db: DB, month: string) {
  const rows: Array<{ bill: Bill; type?: BillType; payment: Bill['payments'][number] }> = [];
  for (const bill of db.bills) {
    for (const payment of bill.payments) {
      if (payment.date.slice(0, 7) === month) {
        rows.push({ bill, type: typeOf(db.billTypes, bill), payment });
      }
    }
  }
  return rows.sort((a, b) => b.payment.date.localeCompare(a.payment.date));
}
