export type TxKind = 'credit' | 'debit'; // credit = money in, debit = money out

/** A bank account. Its balance = openingBalance + the transactions linked to it. */
export interface BankAccount {
  id: string;
  name: string;
  openingBalance: number;
  createdAt: number;
}

export interface Transaction {
  id: string;
  kind: TxKind;
  amount: number;
  category: string;
  note: string;
  date: string; // YYYY-MM-DD
  createdAt: number;
  /** Which bank account the money moved through. No bank = doesn't affect balances. */
  bankId?: string;
  /** Receipt image stored in the Cloudflare worker (R2). */
  receiptKey?: string;
  /**
   * Set when created by a payment (bill, debt, interest), so removing the
   * payment removes the transaction. Format: "bill:<billId>:<paymentId>" etc.
   */
  refId?: string;
}

export interface Payment {
  id: string;
  amount: number;
  date: string; // YYYY-MM-DD
  note: string;
  bankId?: string;
}

/** Money lent to / borrowed from a person (no interest tracking; see InterestDebt). */
export interface Debt {
  id: string;
  /** 'owe' = I borrowed and must repay (Borrow). 'owed' = I lent and am waiting (Lends). */
  direction: 'owe' | 'owed';
  person: string;
  principal: number;
  dueDate?: string; // YYYY-MM-DD
  note: string;
  createdAt: number;
  payments: Payment[];
}

// ------------------------------------------------------------ monthly bills --
export type BillKind = 'standard' | 'recharge';

/** A tab on the Monthly Bills screen. */
export interface BillType {
  id: string;
  name: string;
  kind: BillKind;
  /** Added by the user (can be deleted). Built-in tabs can't be. */
  custom?: boolean;
}

export type PayType = 'manual' | 'auto';

export interface BillPayment {
  id: string;
  /** Which monthly cycle this settled: "YYYY-MM". For recharges: the expiry date it covered. */
  cycle: string;
  amount: number;
  date: string; // YYYY-MM-DD, when it was actually paid
  bankId?: string;
}

export interface Bill {
  id: string;
  typeId: string;
  /** Optional name to tell similar bills apart, e.g. "ICICI Amazon card". */
  label: string;
  /** Mandatory for most bills, optional for recharges. */
  amount?: number;
  /** Repayment date. For recharges: the expiry date. */
  dueDate: string; // YYYY-MM-DD
  /** Day of the month the bill falls on every month (standard bills). */
  dueDay: number;
  /** First month that is owed: "YYYY-MM". */
  startCycle: string;
  time?: string; // HH:mm (24h), optional
  payType: PayType;
  /** Bank used. Mandatory for auto debit, optional for manual. */
  bankId?: string;
  /** Recharges only: first 4 and last 2 digits of the number. */
  phoneStart?: string;
  phoneEnd?: string;
  payments: BillPayment[];
  createdAt: number;
}

// ---------------------------------------------------------- interest debts --
export interface InterestPayment {
  id: string;
  kind: 'interest' | 'principal';
  amount: number;
  date: string;
  bankId?: string;
}

/** Money lent/borrowed with interest. Simple interest on the principal still outstanding. */
export interface InterestDebt {
  id: string;
  direction: 'lend' | 'borrow';
  person: string;
  principal: number;
  /** Interest rate in percent, per month or per year. */
  rate: number;
  per: 'month' | 'year';
  startDate: string; // YYYY-MM-DD
  note: string;
  createdAt: number;
  payments: InterestPayment[];
}

export interface Settings {
  currency: string; // symbol, e.g. ₹
  deviceId: string;
  lastBackupAt?: number;
  /** Notify this many days before a due date (plus on the day). */
  remindDaysBefore: number;
}

export interface DB {
  version: 2;
  banks: BankAccount[];
  transactions: Transaction[];
  debts: Debt[];
  billTypes: BillType[];
  bills: Bill[];
  interestDebts: InterestDebt[];
  settings: Settings;
}
