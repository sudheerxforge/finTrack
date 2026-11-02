import { InterestDebt } from '../types';
import { daysBetween } from './dates';
import { round2 } from './money';

export interface InterestStatus {
  principalLeft: number;
  principalPaid: number;
  /** Simple interest accrued from the start date until `asOf`. */
  accrued: number;
  interestPaid: number;
  /** Interest still to be paid (never negative). */
  interestDue: number;
  /** Interest that builds up in a month on the principal still outstanding. */
  perMonth: number;
  /** Everything outstanding: principal left plus interest due. */
  totalOutstanding: number;
}

/** Interest per day on a balance. Monthly rates use a 30-day month, yearly rates a 365-day year. */
const dailyRate = (d: Pick<InterestDebt, 'rate' | 'per'>) => (d.per === 'month' ? d.rate / 100 / 30 : d.rate / 100 / 365);

/**
 * Simple interest on the principal still outstanding. When principal is paid
 * back, interest from then on is charged on the smaller amount.
 */
export function interestStatus(d: InterestDebt, asOf: string): InterestStatus {
  const principalPayments = d.payments.filter(p => p.kind === 'principal').sort((a, b) => a.date.localeCompare(b.date));
  const rate = dailyRate(d);

  let balance = d.principal;
  let from = d.startDate;
  let accrued = 0;
  for (const p of principalPayments) {
    const days = Math.max(0, daysBetween(from, p.date));
    accrued += balance * rate * days;
    balance = Math.max(0, balance - p.amount);
    if (p.date > from) from = p.date;
  }
  accrued += balance * rate * Math.max(0, daysBetween(from, asOf));

  const interestPaid = d.payments.filter(p => p.kind === 'interest').reduce((s, p) => s + p.amount, 0);
  const principalPaid = principalPayments.reduce((s, p) => s + p.amount, 0);
  const principalLeft = Math.max(0, round2(d.principal - principalPaid));
  const interestDue = Math.max(0, round2(accrued - interestPaid));
  return {
    principalLeft,
    principalPaid: round2(principalPaid),
    accrued: round2(accrued),
    interestPaid: round2(interestPaid),
    interestDue,
    perMonth: round2(principalLeft * (d.per === 'month' ? d.rate / 100 : d.rate / 100 / 12)),
    totalOutstanding: round2(principalLeft + interestDue),
  };
}

export const rateLabel = (d: Pick<InterestDebt, 'rate' | 'per'>) => `${d.rate}% per ${d.per}`;
