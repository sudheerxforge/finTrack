import { BankAccount, DB } from '../types';
import { round2 } from './money';

/** Opening balance plus every credit minus every debit linked to the account. */
export function bankBalance(db: Pick<DB, 'transactions'>, bank: BankAccount): number {
  let bal = bank.openingBalance;
  for (const t of db.transactions) {
    if (t.bankId === bank.id) {
      bal += t.kind === 'credit' ? t.amount : -t.amount;
    }
  }
  return round2(bal);
}

/** Money available across all bank accounts. */
export function availableMoney(db: Pick<DB, 'banks' | 'transactions'>): number {
  return round2(db.banks.reduce((s, b) => s + bankBalance(db, b), 0));
}

export const bankName = (db: Pick<DB, 'banks'>, id?: string): string | undefined =>
  id ? db.banks.find(b => b.id === id)?.name : undefined;
