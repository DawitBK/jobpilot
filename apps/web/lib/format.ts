/** Money is stored as integer minor units (santim); this is the only place it becomes text. */
export function formatMoney(minor: number | null | undefined, currency = 'ETB'): string {
  if (minor === null || minor === undefined) return '–';
  try {
    return new Intl.NumberFormat('en-ET', {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

/** "12.50" -> 1250. Returns null for anything that is not a plain non-negative amount. */
export function parseMoney(input: string): number | null {
  const t = input.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ''] = t.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/** Minor units as an editable decimal string ("1250" -> "12.50"). */
export function toInput(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return '';
  return (minor / 100).toFixed(2);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '–';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '–';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

export function label(value: string): string {
  const t = value.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

/** A yearly salary range as written on a job, or "Not stated". Whole currency units, not minor units. */
export function salaryRange(min: number | null, max: number | null): string {
  const n = (v: number) => v.toLocaleString('en-US');
  if (min !== null && max !== null) return `${n(min)} to ${n(max)}`;
  if (min !== null) return `From ${n(min)}`;
  if (max !== null) return `Up to ${n(max)}`;
  return 'Not stated';
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return formatDate(iso);
}
