import { DB } from '../types';
import { Actions } from '../state/store';
import { ALL_CATEGORIES } from '../data/categories';
import { isValidISO, monthKey, today } from '../utils/dates';
import { debtOutstanding, debtSettled, formatMoney } from '../utils/money';
import { availableMoney, bankBalance } from '../utils/banks';
import { billDisplayName, billStatus, isRechargeType, monthBillSummary, typeOf } from '../utils/bills';
import { interestStatus } from '../utils/interest';
import { monthTotals, totalOwe, totalOwed, upcomingPayments } from '../utils/summary';

/** Function declarations sent to Gemini Live in the session setup. */
export const FUNCTION_DECLARATIONS = [
  {
    name: 'add_transaction',
    description: 'Record money the user spent (debit) or received (credit): expenses, salary, refunds and so on.',
    parameters: {
      type: 'OBJECT',
      properties: {
        kind: { type: 'STRING', enum: ['debit', 'credit'], description: 'debit = spent, credit = received' },
        amount: { type: 'NUMBER', description: 'Positive amount' },
        category: { type: 'STRING', description: `One of: ${ALL_CATEGORIES.join(', ')}` },
        note: { type: 'STRING', description: 'Few words' },
        bank: { type: 'STRING', description: "Name of the user's bank account it went through. Optional." },
        date: { type: 'STRING', description: 'YYYY-MM-DD. Omit for today.' },
      },
      required: ['kind', 'amount'],
    },
  },
  {
    name: 'add_debt',
    description: 'Record money the user lent to someone (lend) or borrowed from someone (borrow).',
    parameters: {
      type: 'OBJECT',
      properties: {
        direction: { type: 'STRING', enum: ['lend', 'borrow'], description: 'lend = user gave money; borrow = user took money' },
        person: { type: 'STRING' },
        amount: { type: 'NUMBER' },
        due_date: { type: 'STRING', description: 'YYYY-MM-DD, optional' },
        note: { type: 'STRING' },
      },
      required: ['direction', 'person', 'amount'],
    },
  },
  {
    name: 'record_debt_payment',
    description: 'Record money paid back to, or received back from, a person who has an existing lend or borrow.',
    parameters: {
      type: 'OBJECT',
      properties: {
        person: { type: 'STRING', description: 'Name of the person (as in the record)' },
        amount: { type: 'NUMBER' },
        bank: { type: 'STRING', description: 'Bank account used. Optional.' },
      },
      required: ['person', 'amount'],
    },
  },
  {
    name: 'mark_bill_paid',
    description:
      'Mark one of the user\'s monthly bills as paid (power bill, wifi, credit card, home loan, hostel fee, cheeti, a recharge...). For a recharge also give the new expiry date.',
    parameters: {
      type: 'OBJECT',
      properties: {
        bill: { type: 'STRING', description: 'Bill name or type, e.g. "power", "ICICI personal loan", "credit card"' },
        amount: { type: 'NUMBER', description: 'Amount actually paid. Optional: defaults to the bill amount.' },
        bank: { type: 'STRING', description: 'Bank account it was paid from. Optional: defaults to the bill bank.' },
        new_expiry: { type: 'STRING', description: 'Recharges only: the new expiry date, YYYY-MM-DD' },
      },
      required: ['bill'],
    },
  },
  {
    name: 'get_summary',
    description:
      "Get the user's available money, bank balances, this month's credits and debits, bills still to pay, bills paid, and lends/borrows. Call it before answering any question about their money.",
    parameters: { type: 'OBJECT', properties: {} },
  },
];

type Args = Record<string, any>;

const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : Number(v));
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function matchName(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

const findBank = (db: DB, name?: string) => (name ? db.banks.find(b => matchName(b.name, name)) : undefined);

/**
 * Runs one tool call from Gemini against the app data and returns the JSON
 * result that is sent back to the model. Never throws.
 */
export function runTool(name: string, args: Args, getDb: () => DB, actions: Actions): object {
  try {
    const db = getDb();
    const cur = db.settings.currency;
    const t = today();

    switch (name) {
      case 'add_transaction': {
        const amount = num(args.amount);
        if (!(amount > 0)) {
          return { error: 'amount must be a positive number' };
        }
        const kind = args.kind === 'credit' ? 'credit' : 'debit';
        const date = isValidISO(text(args.date)) ? text(args.date) : t;
        const category = ALL_CATEGORIES.find(c => c.toLowerCase() === text(args.category).toLowerCase()) ?? 'Other';
        const wanted = text(args.bank);
        const bank = findBank(db, wanted);
        if (wanted && !bank) {
          return { error: `No bank account called "${wanted}". Their banks: ${db.banks.map(b => b.name).join(', ') || 'none yet'}.` };
        }
        actions.addTransaction({ kind, amount, category, note: text(args.note), date, bankId: bank?.id });
        return { ok: true, saved: `${kind} ${formatMoney(amount, cur)} (${category}) on ${date}${bank ? ` via ${bank.name}` : ''}` };
      }

      case 'add_debt': {
        const amount = num(args.amount);
        const person = text(args.person);
        if (!(amount > 0) || !person) {
          return { error: 'person and a positive amount are required' };
        }
        const lend = args.direction === 'lend';
        const dueDate = isValidISO(text(args.due_date)) ? text(args.due_date) : undefined;
        actions.addDebt({ direction: lend ? 'owed' : 'owe', person, principal: amount, dueDate, note: text(args.note) });
        return { ok: true, saved: lend ? `You lent ${person} ${formatMoney(amount, cur)}` : `You borrowed ${formatMoney(amount, cur)} from ${person}` };
      }

      case 'record_debt_payment': {
        const person = text(args.person);
        const amount = num(args.amount);
        const open = db.debts.filter(d => !debtSettled(d) && matchName(d.person, person));
        if (open.length === 0) {
          return { error: `No open lend or borrow found for "${person}"` };
        }
        if (open.length > 1) {
          return { error: `Several open records match "${person}". Ask the user which one.`, people: open.map(d => `${d.person} (${d.direction === 'owed' ? 'lend' : 'borrow'})`) };
        }
        const debt = open[0];
        const bank = findBank(db, text(args.bank));
        const p = actions.addDebtPayment(debt.id, amount, today(), '', bank?.id);
        if (!p) {
          return { error: 'Could not record that payment' };
        }
        const left = debtOutstanding(getDb().debts.find(d => d.id === debt.id)!);
        return { ok: true, recorded: formatMoney(p.amount, cur), remaining: formatMoney(left, cur) };
      }

      case 'mark_bill_paid': {
        const q = text(args.bill);
        const candidates = db.bills.filter(b => {
          const type = typeOf(db.billTypes, b);
          const st = billStatus(b, type?.kind ?? 'standard', t);
          return st.state !== 'paid' && (matchName(billDisplayName(b, type), q) || matchName(type?.name ?? '', q));
        });
        if (candidates.length === 0) {
          return { error: `No unpaid bill found for "${q}"` };
        }
        if (candidates.length > 1) {
          return {
            error: `Several unpaid bills match "${q}". Ask the user which one.`,
            bills: candidates.map(b => billDisplayName(b, typeOf(db.billTypes, b))),
          };
        }
        const bill = candidates[0];
        const type = typeOf(db.billTypes, bill);
        const recharge = isRechargeType(type);
        const amount = args.amount !== undefined && num(args.amount) > 0 ? num(args.amount) : bill.amount;
        if (!amount) {
          return { error: 'This bill has no amount saved. Ask the user how much they paid.' };
        }
        const newExpiry = isValidISO(text(args.new_expiry)) ? text(args.new_expiry) : undefined;
        if (recharge && !newExpiry) {
          return { error: 'For a recharge, ask the user for the new expiry date.' };
        }
        const wanted = text(args.bank);
        const bank = findBank(db, wanted) ?? db.banks.find(b => b.id === bill.bankId);
        if (wanted && !findBank(db, wanted)) {
          return { error: `No bank account called "${wanted}".` };
        }
        const p = actions.payBill(bill.id, { amount, bankId: bank?.id, newExpiry });
        if (!p) {
          return { error: 'Could not record that payment' };
        }
        return { ok: true, saved: `${billDisplayName(bill, type)} paid ${formatMoney(amount, cur)}${bank ? ` from ${bank.name}` : ''}` };
      }

      case 'get_summary': {
        const month = monthKey(t);
        const totals = monthTotals(db, month);
        const bills = monthBillSummary(db, month, t);
        return {
          currency: cur,
          today: t,
          availableMoney: availableMoney(db),
          banks: db.banks.map(b => ({ name: b.name, balance: bankBalance(db, b) })),
          thisMonth: { credits: totals.credits, debits: totals.debits },
          billsThisMonth: { total: bills.total, paid: bills.paid, remaining: bills.remaining, overdue: bills.overdueCount },
          billsToPay: upcomingPayments(db, t)
            .slice(0, 8)
            .map(d => ({ name: d.title, amount: d.amount, due: d.date, overdue: d.overdue, autoDebit: !!d.autoDebit, bank: d.bank })),
          lendsTotal: totalOwed(db),
          borrowTotal: totalOwe(db),
          openLends: db.debts.filter(d => d.direction === 'owed' && !debtSettled(d)).map(d => ({ person: d.person, outstanding: debtOutstanding(d), due: d.dueDate })),
          openBorrows: db.debts.filter(d => d.direction === 'owe' && !debtSettled(d)).map(d => ({ person: d.person, outstanding: debtOutstanding(d), due: d.dueDate })),
          interestDebts: db.interestDebts.map(d => {
            const s = interestStatus(d, t);
            return { person: d.person, direction: d.direction, principalLeft: s.principalLeft, interestDue: s.interestDue };
          }),
        };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e: any) {
    return { error: String(e?.message ?? e) };
  }
}
