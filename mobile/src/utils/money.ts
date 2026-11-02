import { Debt, Payment } from '../types';

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function formatMoney(amount: number, symbol = '₹'): string {
  const neg = amount < 0;
  const [int, frac] = Math.abs(amount).toFixed(2).split('.');
  let grouped: string;
  if (symbol === '₹') {
    // Indian grouping: 12,34,567
    const last3 = int.slice(-3);
    const rest = int.slice(0, -3);
    grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  } else {
    grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  const body = frac === '00' ? grouped : `${grouped}.${frac}`;
  const sep = symbol.length > 1 ? ' ' : '';
  return `${neg ? '-' : ''}${symbol}${sep}${body}`;
}

export const sumPayments = (p: Array<Pick<Payment, 'amount'>>) => round2(p.reduce((s, x) => s + x.amount, 0));

// ------------------------------------------------------------------ debts --
export const debtPaid = (d: Debt) => sumPayments(d.payments);
export const debtOutstanding = (d: Debt) => Math.max(0, round2(d.principal - debtPaid(d)));
export const debtSettled = (d: Debt) => debtOutstanding(d) <= 0;
