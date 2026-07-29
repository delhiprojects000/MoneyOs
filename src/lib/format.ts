const currencyFormatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(amount: number, currency = 'INR'): string {
  let formatter = currencyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 });
    currencyFormatters.set(currency, formatter);
  }
  return formatter.format(amount);
}

export function formatDate(dateLike: string | Date): string {
  const d = typeof dateLike === 'string' ? new Date(dateLike) : dateLike;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(dateLike: string | Date): string {
  const d = typeof dateLike === 'string' ? new Date(dateLike) : dateLike;
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatRelativeDay(dateLike: string | Date): string {
  const d = typeof dateLike === 'string' ? new Date(dateLike) : dateLike;
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
