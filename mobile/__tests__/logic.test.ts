const mockMem = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => (mockMem.has(k) ? mockMem.get(k)! : null),
    setItem: async (k: string, v: string) => void mockMem.set(k, v),
    removeItem: async (k: string) => void mockMem.delete(k),
  },
}));

import { Bill, DB, Debt, InterestDebt } from '../src/types';
import { dateInMonth, formatTime12, isValidISO, ordinal, prettyDateOrd, addMonths, addMonthKey, relativeDue, toISO } from '../src/utils/dates';
import { debtOutstanding, debtSettled, formatMoney } from '../src/utils/money';
import { billStatus, monthBillSummary, statusText, maskedPhone } from '../src/utils/bills';
import { availableMoney, bankBalance } from '../src/utils/banks';
import { interestStatus } from '../src/utils/interest';
import { notificationDues, upcomingPayments } from '../src/utils/summary';
import { emptyDB, normalizeDB } from '../src/storage/db';

const bill = (over: Partial<Bill> = {}): Bill => ({
  id: 'b1',
  typeId: 'home-loan',
  label: '',
  amount: 10000,
  dueDate: '2026-11-10',
  dueDay: 10,
  startCycle: '2026-11',
  payType: 'manual',
  payments: [],
  createdAt: 0,
  ...over,
});
const pay = (cycle: string, amount = 10000, date = `${cycle}-10`) => ({ id: `p-${cycle}`, cycle, amount, date });

describe('dates', () => {
  it('writes ordinals', () => {
    const got = [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 26, 31].map(ordinal);
    expect(got).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '26th', '31st']);
  });
  it('formats dates and times the way the forms show them', () => {
    expect(prettyDateOrd('2026-11-26')).toBe('26th Nov 2026');
    expect(formatTime12('00:05')).toBe('12:05 AM');
    expect(formatTime12('12:00')).toBe('12:00 PM');
    expect(formatTime12('14:30')).toBe('2:30 PM');
  });
  it('clamps month ends', () => {
    expect(addMonths('2030-01-31', 1)).toBe('2030-02-28');
    expect(dateInMonth('2026-02', 31)).toBe('2026-02-28');
    expect(dateInMonth('2028-02', 31)).toBe('2028-02-29');
    expect(dateInMonth('2026-11', 10)).toBe('2026-11-10');
    expect(addMonthKey('2026-12', 1)).toBe('2027-01');
  });
  it('validates ISO dates and describes due dates', () => {
    expect(isValidISO('2030-02-30')).toBe(false);
    expect(isValidISO('2030-02-28')).toBe(true);
    expect(relativeDue(toISO(new Date()))).toBe('Due today');
  });
});

describe('formatMoney', () => {
  it('uses Indian grouping for rupees', () => {
    expect(formatMoney(1234567.5, '₹')).toBe('₹12,34,567.50');
    expect(formatMoney(-50, '₹')).toBe('-₹50');
  });
  it('uses standard grouping otherwise', () => {
    expect(formatMoney(1234567, '$')).toBe('$1,234,567');
  });
});

describe('monthly bill status', () => {
  it('is upcoming, due today, then overdue as the date passes', () => {
    expect(billStatus(bill(), 'standard', '2026-11-05')).toMatchObject({ state: 'upcoming', date: '2026-11-10', daysLeft: 5 });
    expect(billStatus(bill(), 'standard', '2026-11-10')).toMatchObject({ state: 'due-today', daysLeft: 0 });
    expect(billStatus(bill(), 'standard', '2026-11-13')).toMatchObject({ state: 'overdue', daysLeft: -3 });
  });

  it('is paid for the month once paid, and points at the next month', () => {
    const b = bill({ payments: [pay('2026-11')] });
    expect(billStatus(b, 'standard', '2026-11-13')).toMatchObject({ state: 'paid', cycle: '2026-12', date: '2026-12-10' });
  });

  it('becomes overdue again when the next month passes unpaid', () => {
    const b = bill({ payments: [pay('2026-11')] });
    expect(billStatus(b, 'standard', '2026-12-12')).toMatchObject({ state: 'overdue', cycle: '2026-12', daysLeft: -2 });
  });

  it('handles paying in advance', () => {
    const b = bill({ payments: [pay('2026-11'), pay('2026-12')] });
    expect(billStatus(b, 'standard', '2026-11-20')).toMatchObject({ state: 'paid', cycle: '2027-01', date: '2027-01-10' });
  });

  it('a bill that starts next month is upcoming, not paid', () => {
    const b = bill({ startCycle: '2026-12', dueDate: '2026-12-10' });
    expect(billStatus(b, 'standard', '2026-11-13')).toMatchObject({ state: 'upcoming', date: '2026-12-10' });
  });

  it('a 31st bill falls on the last day of short months', () => {
    const b = bill({ dueDay: 31, startCycle: '2027-02', dueDate: '2027-02-28' });
    expect(billStatus(b, 'standard', '2027-02-10').date).toBe('2027-02-28');
  });

  it('recharges are valid until the expiry date and never "paid"', () => {
    const r = bill({ typeId: 'recharges', dueDate: '2026-11-26', amount: undefined });
    expect(billStatus(r, 'recharge', '2026-11-20')).toMatchObject({ state: 'upcoming', daysLeft: 6 });
    expect(billStatus(r, 'recharge', '2026-11-27')).toMatchObject({ state: 'overdue', daysLeft: -1 });
  });

  it('writes friendly status text', () => {
    expect(statusText(billStatus(bill(), 'standard', '2026-11-09'), 'standard')).toBe('Due tomorrow');
    expect(statusText(billStatus(bill(), 'standard', '2026-11-13'), 'standard')).toBe('Overdue by 3 days');
    expect(statusText(billStatus(bill({ payments: [pay('2026-11')] }), 'standard', '2026-11-13'), 'standard')).toBe('Paid this month');
    expect(statusText(billStatus(bill({ dueDate: '2026-11-26' }), 'recharge', '2026-11-20'), 'recharge')).toBe('Expires in 6 days');
  });

  it('masks a recharge number as first 4 + last 2 digits', () => {
    expect(maskedPhone({ phoneStart: '9392', phoneEnd: '69' })).toBe('9392 ●●●● 69');
  });
});

describe('month summary, banks and upcoming', () => {
  const db = (): DB => ({
    ...emptyDB(),
    banks: [
      { id: 'icici', name: 'ICICI', openingBalance: 1000, createdAt: 0 },
      { id: 'sbi', name: 'SBI', openingBalance: 500, createdAt: 0 },
    ],
    transactions: [
      { id: 't1', kind: 'credit', amount: 500, category: 'Salary', note: '', date: '2026-11-01', createdAt: 0, bankId: 'icici' },
      { id: 't2', kind: 'debit', amount: 200, category: 'Food', note: '', date: '2026-11-02', createdAt: 0, bankId: 'icici' },
      { id: 't3', kind: 'debit', amount: 50, category: 'Food', note: '', date: '2026-11-02', createdAt: 0, bankId: 'sbi' },
      { id: 't4', kind: 'debit', amount: 999, category: 'Food', note: '', date: '2026-11-02', createdAt: 0 }, // no bank
    ],
    bills: [
      bill({ id: 'home', typeId: 'home-loan', amount: 10000, dueDay: 10, payments: [pay('2026-11', 10000)] }),
      bill({ id: 'power', typeId: 'power', amount: 1500, dueDay: 5, dueDate: '2026-11-05' }),
      bill({ id: 'rc', typeId: 'recharges', amount: undefined, dueDate: '2026-11-26', dueDay: 26 }),
    ],
    debts: [
      { id: 'd1', direction: 'owe', person: 'Ravi', principal: 5000, dueDate: '2026-11-30', note: '', createdAt: 0, payments: [] },
      { id: 'd2', direction: 'owed', person: 'Sita', principal: 2000, dueDate: '2026-11-20', note: '', createdAt: 0, payments: [] },
    ],
  });

  it('works out each bank balance from its transactions', () => {
    const d = db();
    expect(bankBalance(d, d.banks[0])).toBe(1300);
    expect(bankBalance(d, d.banks[1])).toBe(450);
  });

  it('available money is the sum of the banks and ignores transactions with no bank', () => {
    expect(availableMoney(db())).toBe(1750);
  });

  it('summarises the month: total, paid, remaining, overdue', () => {
    const s = monthBillSummary(db(), '2026-11', '2026-11-13');
    expect(s).toMatchObject({ total: 11500, paid: 10000, remaining: 1500, count: 3, paidCount: 1, overdueCount: 1 });
  });

  it('lists what is still to pay: unpaid bills and borrowed money, soonest first', () => {
    const list = upcomingPayments(db(), '2026-11-13');
    expect(list.map(x => x.sourceId)).toEqual(['power', 'rc', 'd1']);
    expect(list[0].overdue).toBe(true);
    expect(list.some(x => x.sourceId === 'home')).toBe(false); // already paid
    expect(list.some(x => x.sourceId === 'd2')).toBe(false); // someone owes me; not a payment
  });

  it('plans notifications for the next few months of each bill', () => {
    const dues = notificationDues(db(), '2026-11-13');
    const power = dues.filter(x => x.sourceId === 'power').map(x => x.date);
    expect(power).toEqual(['2026-11-05', '2026-12-05', '2027-01-05']);
    const home = dues.filter(x => x.sourceId === 'home').map(x => x.date);
    expect(home).toEqual(['2026-12-10', '2027-01-10', '2027-02-10']); // November is paid
  });
});

describe('interest debts', () => {
  const debt = (over: Partial<InterestDebt> = {}): InterestDebt => ({
    id: 'i1',
    direction: 'lend',
    person: 'Ravi',
    principal: 10000,
    rate: 2,
    per: 'month',
    startDate: '2026-01-01',
    note: '',
    createdAt: 0,
    payments: [],
    ...over,
  });

  it('charges simple monthly interest', () => {
    const s = interestStatus(debt(), '2026-01-31'); // 30 days
    expect(s.accrued).toBe(200);
    expect(s.interestDue).toBe(200);
    expect(s.perMonth).toBe(200);
    expect(s.totalOutstanding).toBe(10200);
  });

  it('charges yearly rates over a year', () => {
    expect(interestStatus(debt({ rate: 12, per: 'year' }), '2027-01-01').accrued).toBe(1200);
  });

  it('subtracts interest already paid', () => {
    const d = debt({ payments: [{ id: 'p', kind: 'interest', amount: 200, date: '2026-01-31' }] });
    expect(interestStatus(d, '2026-01-31')).toMatchObject({ interestPaid: 200, interestDue: 0 });
  });

  it('charges less interest after principal is paid back', () => {
    const d = debt({ payments: [{ id: 'p', kind: 'principal', amount: 5000, date: '2026-01-31' }] });
    const s = interestStatus(d, '2026-03-02'); // 30 days at 10000, then 30 days at 5000
    expect(s.accrued).toBe(300);
    expect(s.principalLeft).toBe(5000);
    expect(s.principalPaid).toBe(5000);
  });

  it('never shows negative interest due', () => {
    const d = debt({ payments: [{ id: 'p', kind: 'interest', amount: 999, date: '2026-01-02' }] });
    expect(interestStatus(d, '2026-01-02').interestDue).toBe(0);
  });
});

describe('lends and borrows', () => {
  const d: Debt = {
    id: 'd1', direction: 'owe', person: 'Ravi', principal: 5000, note: '', createdAt: 0,
    payments: [{ id: 'p', amount: 1500, date: '2030-01-01', note: '' }],
  };
  it('computes outstanding and settled', () => {
    expect(debtOutstanding(d)).toBe(3500);
    expect(debtSettled(d)).toBe(false);
    expect(debtSettled({ ...d, payments: [{ id: 'p', amount: 5000, date: '2030-01-01', note: '' }] })).toBe(true);
  });
});

describe('loading data', () => {
  it('starts with the built-in bill tabs, no banks and nothing else', () => {
    const e = emptyDB();
    expect(e.banks).toEqual([]);
    expect(e.billTypes.map(t => t.id)).toEqual(expect.arrayContaining(['recharges', 'credit-cards', 'home-loan', 'cheeti', 'schemes', 'hostel-fee', 'power', 'wifi']));
    expect(e.billTypes.find(t => t.id === 'recharges')?.kind).toBe('recharge');
  });

  it('upgrades older data: drops what no longer exists, keeps settings and custom tabs', () => {
    const old = {
      version: 1,
      transactions: [{ id: 't', kind: 'debit', amount: 5, category: 'Food', note: '', date: '2026-01-01', createdAt: 0 }],
      debts: [],
      loans: [{ id: 'l' }],
      reminders: [{ id: 'r' }],
      budgets: [{ category: 'Food', limit: 1 }],
      billTypes: [{ id: 'custom-1', name: 'Gym', kind: 'standard', custom: true }, { id: 'fake', name: 'Not custom', kind: 'standard' }],
      settings: { currency: '$', deviceId: 'abc', remindDaysBefore: 3 },
    };
    const n = normalizeDB(old) as any;
    expect(n.version).toBe(2);
    expect(n.transactions).toHaveLength(1);
    expect(n.loans).toBeUndefined();
    expect(n.reminders).toBeUndefined();
    expect(n.budgets).toBeUndefined();
    expect(n.settings).toMatchObject({ currency: '$', deviceId: 'abc', remindDaysBefore: 3 });
    expect(n.billTypes.some((t: any) => t.id === 'custom-1')).toBe(true);
    expect(n.billTypes.some((t: any) => t.id === 'fake')).toBe(false);
  });

  it('fills in missing bill fields from the due date', () => {
    const n = normalizeDB({ bills: [{ id: 'b', typeId: 'power', dueDate: '2026-11-05', payType: 'manual' }] });
    expect(n.bills[0]).toMatchObject({ label: '', dueDay: 5, startCycle: '2026-11', payments: [] });
  });
});
