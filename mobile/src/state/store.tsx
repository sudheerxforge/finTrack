import React, {
  createContext,
  FC,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  BankAccount,
  Bill,
  BillPayment,
  BillType,
  DB,
  Debt,
  InterestDebt,
  InterestPayment,
  PayType,
  Payment,
  Settings,
  Transaction,
} from '../types';
import { emptyDB, loadDB, normalizeDB, saveDB } from '../storage/db';
import { newId } from '../utils/ids';
import { monthKey, today } from '../utils/dates';
import { debtOutstanding, round2 } from '../utils/money';
import { DEBT_CATEGORY } from '../data/categories';
import { setDeviceId } from '../api/http';
import { billDisplayName, billStatus, typeOf } from '../utils/bills';
import { interestStatus } from '../utils/interest';

export type NewTransaction = Omit<Transaction, 'id' | 'createdAt'>;
export interface NewDebt {
  direction: Debt['direction'];
  person: string;
  principal: number;
  dueDate?: string;
  note?: string;
}
export interface NewBill {
  typeId: string;
  label?: string;
  amount?: number;
  dueDate: string;
  time?: string;
  payType: PayType;
  bankId?: string;
  phoneStart?: string;
  phoneEnd?: string;
}
export interface NewInterestDebt {
  direction: InterestDebt['direction'];
  person: string;
  principal: number;
  rate: number;
  per: InterestDebt['per'];
  startDate: string;
  note?: string;
}
export interface PayBillOptions {
  amount: number;
  date?: string;
  bankId?: string;
  /** Recharges: the new expiry date after recharging (required for them). */
  newExpiry?: string;
}

export interface Actions {
  addBank(name: string, openingBalance: number): BankAccount;
  deleteBank(id: string): void;

  addTransaction(t: NewTransaction): Transaction;
  deleteTransaction(id: string): void;

  addDebt(d: NewDebt): Debt;
  deleteDebt(id: string): void;
  /** Records a repayment; also logs a matching transaction (against `bankId` if given). */
  addDebtPayment(debtId: string, amount: number, date?: string, note?: string, bankId?: string): Payment | null;
  deleteDebtPayment(debtId: string, paymentId: string): void;

  addBillType(name: string): BillType;
  deleteBillType(id: string): void;
  addBill(b: NewBill): Bill;
  updateBill(id: string, patch: Partial<NewBill>): void;
  deleteBill(id: string): void;
  /** Marks the current cycle paid (or a recharge done) and logs the transaction. */
  payBill(billId: string, opts: PayBillOptions): BillPayment | null;
  deleteBillPayment(billId: string, paymentId: string): void;

  addInterestDebt(d: NewInterestDebt): InterestDebt;
  deleteInterestDebt(id: string): void;
  addInterestPayment(id: string, kind: InterestPayment['kind'], amount: number, date?: string, bankId?: string): InterestPayment | null;
  deleteInterestPayment(id: string, paymentId: string): void;

  updateSettings(patch: Partial<Settings>): void;
  replaceAll(db: unknown): void;
  markBackedUp(): void;
  /** Wipes everything on this phone and starts with a new private device id. */
  eraseAll(): void;
}

interface Ctx {
  db: DB;
  /** Always the latest data, even inside async callbacks and socket handlers. */
  dbRef: React.MutableRefObject<DB>;
  actions: Actions;
  ready: boolean;
}

const StoreContext = createContext<Ctx | null>(null);

/** Where a bill's cycle starts: the month of the date entered, but never a month in the past. */
function startCycleFor(dueDate: string): string {
  const entered = dueDate.slice(0, 7);
  const current = monthKey(today());
  return entered >= current ? entered : current;
}

export const StoreProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [db, setDb] = useState<DB | null>(null);
  const dbRef = useRef<DB>(null as unknown as DB);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadDB().then(loaded => {
      setDeviceId(loaded.settings.deviceId);
      dbRef.current = loaded;
      setDb(loaded);
    });
  }, []);

  /** Applies a change immediately to the ref (so callers see it at once) and saves soon. */
  const commit = useCallback((fn: (d: DB) => DB) => {
    const next = fn(dbRef.current);
    dbRef.current = next;
    setDb(next);
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
    }
    saveTimer.current = setTimeout(() => saveDB(dbRef.current), 300);
  }, []);

  // Don't lose the last edit if the screen is torn down mid-debounce.
  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        if (dbRef.current) {
          saveDB(dbRef.current);
        }
      }
    },
    [],
  );

  const actions = useMemo<Actions>(() => {
    const makeTx = (
      kind: Transaction['kind'],
      amount: number,
      category: string,
      note: string,
      date: string,
      refId: string,
      bankId?: string,
    ): Transaction => ({ id: newId(), kind, amount, category, note, date, createdAt: Date.now(), refId, bankId });

    /** Removes every transaction created by something that started with this ref prefix. */
    const dropTxByPrefix = (txs: Transaction[], prefix: string) => txs.filter(t => !t.refId?.startsWith(prefix));

    return {
      // ------------------------------------------------------------- banks --
      addBank(name, openingBalance) {
        const bank: BankAccount = { id: newId(), name: name.trim(), openingBalance: round2(openingBalance), createdAt: Date.now() };
        commit(d => ({ ...d, banks: [...d.banks, bank] }));
        return bank;
      },
      deleteBank(id) {
        // Keep the history; it just stops being linked to a bank.
        commit(d => ({
          ...d,
          banks: d.banks.filter(b => b.id !== id),
          transactions: d.transactions.map(t => (t.bankId === id ? { ...t, bankId: undefined } : t)),
          bills: d.bills.map(b => ({
            ...b,
            bankId: b.bankId === id ? undefined : b.bankId,
            payments: b.payments.map(p => (p.bankId === id ? { ...p, bankId: undefined } : p)),
          })),
          debts: d.debts.map(x => ({ ...x, payments: x.payments.map(p => (p.bankId === id ? { ...p, bankId: undefined } : p)) })),
          interestDebts: d.interestDebts.map(x => ({
            ...x,
            payments: x.payments.map(p => (p.bankId === id ? { ...p, bankId: undefined } : p)),
          })),
        }));
      },

      // ------------------------------------------------------ transactions --
      addTransaction(t) {
        const tx: Transaction = { ...t, amount: round2(t.amount), id: newId(), createdAt: Date.now() };
        commit(d => ({ ...d, transactions: [tx, ...d.transactions] }));
        return tx;
      },
      deleteTransaction(id) {
        // A transaction made by a payment is removed together with that payment.
        const tx = dbRef.current.transactions.find(t => t.id === id);
        const ref = tx?.refId?.split(':');
        commit(d => {
          let next: DB = { ...d, transactions: d.transactions.filter(t => t.id !== id) };
          if (ref && ref.length === 3) {
            const [kind, parent, pid] = ref;
            if (kind === 'bill') {
              next = { ...next, bills: next.bills.map(b => (b.id === parent ? { ...b, payments: b.payments.filter(p => p.id !== pid) } : b)) };
            } else if (kind === 'debt') {
              next = { ...next, debts: next.debts.map(x => (x.id === parent ? { ...x, payments: x.payments.filter(p => p.id !== pid) } : x)) };
            } else if (kind === 'int') {
              next = {
                ...next,
                interestDebts: next.interestDebts.map(x => (x.id === parent ? { ...x, payments: x.payments.filter(p => p.id !== pid) } : x)),
              };
            }
          }
          return next;
        });
      },

      // ------------------------------------------------------------- debts --
      addDebt(n) {
        const debt: Debt = {
          id: newId(),
          direction: n.direction,
          person: n.person.trim(),
          principal: round2(n.principal),
          dueDate: n.dueDate || undefined,
          note: n.note ?? '',
          createdAt: Date.now(),
          payments: [],
        };
        commit(d => ({ ...d, debts: [debt, ...d.debts] }));
        return debt;
      },
      deleteDebt(id) {
        commit(d => ({ ...d, debts: d.debts.filter(x => x.id !== id), transactions: dropTxByPrefix(d.transactions, `debt:${id}:`) }));
      },
      addDebtPayment(debtId, amount, date = today(), note = '', bankId) {
        const debt = dbRef.current.debts.find(x => x.id === debtId);
        if (!debt || !(amount > 0)) {
          return null;
        }
        // Never record more than what is still outstanding.
        const amt = round2(Math.min(amount, debtOutstanding(debt)));
        if (amt <= 0) {
          return null;
        }
        const payment: Payment = { id: newId(), amount: amt, date, note, bankId };
        const tx = makeTx(
          debt.direction === 'owe' ? 'debit' : 'credit',
          amt,
          DEBT_CATEGORY,
          debt.direction === 'owe' ? `Repaid ${debt.person}` : `Received from ${debt.person}`,
          date,
          `debt:${debtId}:${payment.id}`,
          bankId,
        );
        commit(d => ({
          ...d,
          debts: d.debts.map(x => (x.id === debtId ? { ...x, payments: [...x.payments, payment] } : x)),
          transactions: [tx, ...d.transactions],
        }));
        return payment;
      },
      deleteDebtPayment(debtId, paymentId) {
        commit(d => ({
          ...d,
          debts: d.debts.map(x => (x.id === debtId ? { ...x, payments: x.payments.filter(p => p.id !== paymentId) } : x)),
          transactions: d.transactions.filter(t => t.refId !== `debt:${debtId}:${paymentId}`),
        }));
      },

      // ------------------------------------------------------------- bills --
      addBillType(name) {
        const type: BillType = { id: `custom-${newId()}`, name: name.trim(), kind: 'standard', custom: true };
        commit(d => ({ ...d, billTypes: [...d.billTypes, type] }));
        return type;
      },
      deleteBillType(id) {
        const type = dbRef.current.billTypes.find(t => t.id === id);
        if (!type?.custom) {
          return; // built-in tabs stay
        }
        commit(d => {
          const gone = new Set(d.bills.filter(b => b.typeId === id).map(b => b.id));
          let txs = d.transactions;
          gone.forEach(billId => {
            txs = dropTxByPrefix(txs, `bill:${billId}:`);
          });
          return { ...d, billTypes: d.billTypes.filter(t => t.id !== id), bills: d.bills.filter(b => b.typeId !== id), transactions: txs };
        });
      },
      addBill(n) {
        const bill: Bill = {
          id: newId(),
          typeId: n.typeId,
          label: (n.label ?? '').trim(),
          amount: n.amount && n.amount > 0 ? round2(n.amount) : undefined,
          dueDate: n.dueDate,
          dueDay: Number(n.dueDate.slice(8, 10)),
          startCycle: startCycleFor(n.dueDate),
          time: n.time || undefined,
          payType: n.payType,
          bankId: n.bankId,
          phoneStart: n.phoneStart,
          phoneEnd: n.phoneEnd,
          payments: [],
          createdAt: Date.now(),
        };
        commit(d => ({ ...d, bills: [bill, ...d.bills] }));
        return bill;
      },
      updateBill(id, patch) {
        commit(d => ({
          ...d,
          bills: d.bills.map(b => {
            if (b.id !== id) {
              return b;
            }
            const next: Bill = {
              ...b,
              ...patch,
              label: patch.label !== undefined ? patch.label.trim() : b.label,
              amount: 'amount' in patch ? (patch.amount && patch.amount > 0 ? round2(patch.amount) : undefined) : b.amount,
              time: 'time' in patch ? patch.time || undefined : b.time,
            };
            if (patch.dueDate && patch.dueDate !== b.dueDate) {
              next.dueDay = Number(patch.dueDate.slice(8, 10));
              next.startCycle = startCycleFor(patch.dueDate);
            }
            return next;
          }),
        }));
      },
      deleteBill(id) {
        commit(d => ({ ...d, bills: d.bills.filter(b => b.id !== id), transactions: dropTxByPrefix(d.transactions, `bill:${id}:`) }));
      },
      payBill(billId, opts) {
        const cur = dbRef.current;
        const bill = cur.bills.find(b => b.id === billId);
        if (!bill || !(opts.amount > 0)) {
          return null;
        }
        const type = typeOf(cur.billTypes, bill);
        const recharge = type?.kind === 'recharge';
        if (recharge && !opts.newExpiry) {
          return null; // a recharge needs the new expiry date
        }
        const date = opts.date ?? today();
        const cycle = billStatus(bill, recharge ? 'recharge' : 'standard', today()).cycle;
        const payment: BillPayment = { id: newId(), cycle, amount: round2(opts.amount), date, bankId: opts.bankId };
        const tx = makeTx(
          'debit',
          payment.amount,
          type?.name ?? 'Bills',
          billDisplayName(bill, type),
          date,
          `bill:${billId}:${payment.id}`,
          opts.bankId,
        );
        commit(d => ({
          ...d,
          bills: d.bills.map(b => {
            if (b.id !== billId) {
              return b;
            }
            const next: Bill = { ...b, payments: [...b.payments, payment] };
            if (recharge && opts.newExpiry) {
              next.dueDate = opts.newExpiry;
              next.dueDay = Number(opts.newExpiry.slice(8, 10));
              next.startCycle = opts.newExpiry.slice(0, 7);
            }
            return next;
          }),
          transactions: [tx, ...d.transactions],
        }));
        return payment;
      },
      deleteBillPayment(billId, paymentId) {
        commit(d => ({
          ...d,
          bills: d.bills.map(b => (b.id === billId ? { ...b, payments: b.payments.filter(p => p.id !== paymentId) } : b)),
          transactions: d.transactions.filter(t => t.refId !== `bill:${billId}:${paymentId}`),
        }));
      },

      // -------------------------------------------------- interest debts --
      addInterestDebt(n) {
        const debt: InterestDebt = {
          id: newId(),
          direction: n.direction,
          person: n.person.trim(),
          principal: round2(n.principal),
          rate: n.rate,
          per: n.per,
          startDate: n.startDate,
          note: n.note ?? '',
          createdAt: Date.now(),
          payments: [],
        };
        commit(d => ({ ...d, interestDebts: [debt, ...d.interestDebts] }));
        return debt;
      },
      deleteInterestDebt(id) {
        commit(d => ({
          ...d,
          interestDebts: d.interestDebts.filter(x => x.id !== id),
          transactions: dropTxByPrefix(d.transactions, `int:${id}:`),
        }));
      },
      addInterestPayment(id, kind, amount, date = today(), bankId) {
        const debt = dbRef.current.interestDebts.find(x => x.id === id);
        if (!debt || !(amount > 0)) {
          return null;
        }
        let amt = round2(amount);
        if (kind === 'principal') {
          amt = Math.min(amt, interestStatus(debt, date).principalLeft);
          if (amt <= 0) {
            return null;
          }
        }
        const payment: InterestPayment = { id: newId(), kind, amount: amt, date, bankId };
        const tx = makeTx(
          debt.direction === 'borrow' ? 'debit' : 'credit',
          amt,
          kind === 'interest' ? 'Interest' : DEBT_CATEGORY,
          `${kind === 'interest' ? 'Interest' : 'Principal'} ${debt.direction === 'borrow' ? 'paid to' : 'received from'} ${debt.person}`,
          date,
          `int:${id}:${payment.id}`,
          bankId,
        );
        commit(d => ({
          ...d,
          interestDebts: d.interestDebts.map(x => (x.id === id ? { ...x, payments: [...x.payments, payment] } : x)),
          transactions: [tx, ...d.transactions],
        }));
        return payment;
      },
      deleteInterestPayment(id, paymentId) {
        commit(d => ({
          ...d,
          interestDebts: d.interestDebts.map(x => (x.id === id ? { ...x, payments: x.payments.filter(p => p.id !== paymentId) } : x)),
          transactions: d.transactions.filter(t => t.refId !== `int:${id}:${paymentId}`),
        }));
      },

      // ---------------------------------------------------------- settings --
      updateSettings(patch) {
        commit(d => ({ ...d, settings: { ...d.settings, ...patch } }));
      },
      replaceAll(raw) {
        // Keep this phone's own device id so it stays linked to its cloud backup.
        const incoming = normalizeDB(raw);
        commit(d => ({ ...incoming, settings: { ...incoming.settings, deviceId: d.settings.deviceId } }));
      },
      markBackedUp() {
        commit(d => ({ ...d, settings: { ...d.settings, lastBackupAt: Date.now() } }));
      },
      eraseAll() {
        const fresh = emptyDB();
        setDeviceId(fresh.settings.deviceId);
        commit(() => fresh);
      },
    };
  }, [commit]);

  if (!db) {
    return null;
  }
  return <StoreContext.Provider value={{ db, dbRef, actions, ready: true }}>{children}</StoreContext.Provider>;
};

export function useStore(): Ctx {
  const ctx = useContext(StoreContext);
  if (!ctx) {
    throw new Error('useStore must be used inside <StoreProvider>');
  }
  return ctx;
}
