const currencyFormatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(amount: number, currency = 'INR'): string {
  let formatter = currencyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 });
    currencyFormatters.set(currency, formatter);
  }
  return formatter.format(amount);
}

// Due dates (loan installments, statement dates, recurring cycles) are bare
// calendar dates - `new Date('2026-08-05')` reads those as UTC midnight,
// which renders as the 4th anywhere west of Greenwich. Calendar dates are
// parsed as local midnight instead; full timestamps are left alone.
function parseDateLike(dateLike: string | Date): Date {
  if (typeof dateLike !== 'string') return dateLike;
  const calendarDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateLike);
  if (!calendarDate) return new Date(dateLike);
  const [, y, m, d] = calendarDate;
  return new Date(Number(y), Number(m) - 1, Number(d));
}

export function formatDate(dateLike: string | Date): string {
  return parseDateLike(dateLike).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "5 Aug" - for due dates where the year is obvious from context. */
export function formatDayMonth(dateLike: string | Date): string {
  return parseDateLike(dateLike).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// Which period a recurring cycle covers, said the way you'd say it out loud:
// a monthly rule due 5 Aug 2026 is "Aug 2026" rent, not "the 5 Aug run".
export function formatCyclePeriod(frequency: string, cycleDate: string): string {
  const d = parseDateLike(cycleDate);
  if (frequency === 'yearly') return String(d.getFullYear());
  if (frequency === 'monthly') return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  return formatDate(d);
}

export function formatDateTime(dateLike: string | Date): string {
  const d = parseDateLike(dateLike);
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

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

export function toDatetimeLocalValue(dateLike: string | Date = new Date()): string {
  const d = typeof dateLike === 'string' ? new Date(dateLike) : dateLike;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
