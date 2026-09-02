/**
 * Money, dates and cycle labels rendered the way the UI says them out loud.
 *
 * @module formatting
 */

// Intl.NumberFormat construction is expensive; the app formats thousands of
// amounts per render pass, so one formatter per currency is reused.
const currencyFormatters = new Map<string, Intl.NumberFormat>();

/**
 * Formats an amount in Indian digit grouping with the currency symbol.
 *
 * @param currency ISO code from the user's profile, not the browser locale.
 * @public
 */
export function formatMoney(amount: number, currency = 'INR'): string {
  let formatter = currencyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 });
    currencyFormatters.set(currency, formatter);
  }
  return formatter.format(amount);
}

/**
 * Parses a bare `YYYY-MM-DD` as local midnight, leaving full timestamps alone.
 *
 * `new Date('2026-08-05')` is UTC midnight, which renders as the 4th anywhere
 * west of Greenwich. Due dates are calendar dates, so they must not shift.
 */
function parseDateLike(dateLike: string | Date): Date {
  if (typeof dateLike !== 'string') return dateLike;
  const calendarDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateLike);
  if (!calendarDate) return new Date(dateLike);
  const [, y, m, d] = calendarDate;
  return new Date(Number(y), Number(m) - 1, Number(d));
}

/** Long form, "5 Aug 2026". @public */
export function formatDate(dateLike: string | Date): string {
  return parseDateLike(dateLike).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Short form, "5 Aug", for due dates where the year is obvious. @public */
export function formatDayMonth(dateLike: string | Date): string {
  return parseDateLike(dateLike).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/**
 * Names the period a recurring cycle covers, the way a person would say it:
 * a monthly rule due 5 Aug 2026 is "Aug 2026" rent, not "the 5 Aug run".
 *
 * @public
 */
export function formatCyclePeriod(frequency: string, cycleDate: string): string {
  const d = parseDateLike(cycleDate);
  if (frequency === 'yearly') return String(d.getFullYear());
  if (frequency === 'monthly') return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  return formatDate(d);
}

/** Date plus time of day, for the transaction ledger. @public */
export function formatDateTime(dateLike: string | Date): string {
  const d = parseDateLike(dateLike);
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "Today" / "Yesterday" / "Tomorrow", falling back to a full date. @public */
export function formatRelativeDay(dateLike: string | Date): string {
  const d = parseDateLike(dateLike);
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((new Date(d.toDateString()).getTime() - new Date(now.toDateString()).getTime()) / dayMs);
  if (diffDays === 0) return 'Today';
  if (diffDays === -1) return 'Yesterday';
  if (diffDays === 1) return 'Tomorrow';
  return formatDate(d);
}

/** Formats an instant for an `<input type="datetime-local">` value. @public */
export function toDatetimeLocalValue(dateLike: string | Date = new Date()): string {
  const d = typeof dateLike === 'string' ? new Date(dateLike) : dateLike;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
