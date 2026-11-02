export const pad = (n: number) => String(n).padStart(2, '0');

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const today = () => toISO(new Date());

/** Parses YYYY-MM-DD as a local date (not UTC). */
export function parseISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function isValidISO(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return toISO(parseISO(s)) === s;
}

export function isValidTime(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** Adds months, clamping the day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: string, months: number): string {
  const d = parseISO(iso);
  const day = d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, last));
  return toISO(target);
}

export function addDaysISO(iso: string, days: number): string {
  const d = parseISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

export function daysBetween(fromISO: string, toISOStr: string): number {
  return Math.round((parseISO(toISOStr).getTime() - parseISO(fromISO).getTime()) / 86400000);
}

export const monthKey = (iso: string) => iso.slice(0, 7); // YYYY-MM

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function prettyDate(iso: string): string {
  const d = parseISO(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** "Due today", "Due tomorrow", "Due in 5 days", "3 days overdue". */
export function relativeDue(iso: string): string {
  const n = daysBetween(today(), iso);
  if (n === 0) return 'Due today';
  if (n === 1) return 'Due tomorrow';
  if (n > 1) return `Due in ${n} days`;
  return `${-n} day${n === -1 ? '' : 's'} overdue`;
}

// ---------------------------------------------------------------- display ---
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** 1 -> "1st", 2 -> "2nd", 11 -> "11th", 23 -> "23rd". */
export function ordinal(n: number): string {
  const suffix = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (suffix[(v - 20) % 10] || suffix[v] || suffix[0]);
}

/** "26th Nov 2026" */
export function prettyDateOrd(iso: string): string {
  const d = parseISO(iso);
  return `${ordinal(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "26th Nov" */
export function shortDateOrd(iso: string): string {
  const d = parseISO(iso);
  return `${ordinal(d.getDate())} ${MONTHS[d.getMonth()]}`;
}

/** "14:05" -> "2:05 PM" */
export function formatTime12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${ap}`;
}

/** "2026-11" -> "November 2026" */
export function monthLabelLong(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

export const daysInMonth = (year: number, month1to12: number) => new Date(year, month1to12, 0).getDate();

/** Adds months to a "YYYY-MM" key. */
export function addMonthKey(key: string, n: number): string {
  return addMonths(`${key}-01`, n).slice(0, 7);
}

/** The date a monthly bill falls on in a given "YYYY-MM" (31st clamps to the month's last day). */
export function dateInMonth(key: string, day: number): string {
  const [y, m] = key.split('-').map(Number);
  return `${y}-${pad(m)}-${pad(Math.min(day, daysInMonth(y, m)))}`;
}
