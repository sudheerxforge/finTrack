export const DEBT_CATEGORY = 'Debt & Loans';
export const DEBIT_CATEGORIES = [
  'Food', 'Groceries', 'Transport', 'Bills', 'Rent', 'Shopping',
  'Health', 'Entertainment', 'Education', DEBT_CATEGORY, 'Other',
];
export const CREDIT_CATEGORIES = ['Salary', 'Business', 'Gift', 'Refund', 'Interest', DEBT_CATEGORY, 'Other'];
export const ALL_CATEGORIES = Array.from(new Set([...DEBIT_CATEGORIES, ...CREDIT_CATEGORIES]));
export const CURRENCIES = ['₹', '$', '€', '£', 'AED', '¥'];
