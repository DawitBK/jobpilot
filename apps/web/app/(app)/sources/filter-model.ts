import type { SourceFilters } from '@/lib/types';

/** What the person types for the filters: words separated by commas, and a number of days. */
export interface FilterDraft {
  include: string;
  exclude: string;
  locations: string;
  remoteOnly: boolean;
  maxAgeDays: string;
}

export const emptyDraft: FilterDraft = {
  include: '',
  exclude: '',
  locations: '',
  remoteOnly: false,
  maxAgeDays: '',
};

const words = (v: string) =>
  v
    .split(/[,\n]/)
    .map((w) => w.trim())
    .filter(Boolean);

export const draftOf = (f: SourceFilters): FilterDraft => ({
  include: f.include.join(', '),
  exclude: f.exclude.join(', '),
  locations: f.locations.join(', '),
  remoteOnly: f.remoteOnly,
  maxAgeDays: f.maxAgeDays ? String(f.maxAgeDays) : '',
});

export function filtersOf(d: FilterDraft): SourceFilters {
  const age = Number(d.maxAgeDays);
  return {
    include: words(d.include),
    exclude: words(d.exclude),
    locations: words(d.locations),
    remoteOnly: d.remoteOnly,
    ...(Number.isInteger(age) && age >= 1 && age <= 365 ? { maxAgeDays: age } : {}),
  };
}

export const hasFilters = (f: SourceFilters) =>
  f.include.length > 0 ||
  f.exclude.length > 0 ||
  f.locations.length > 0 ||
  f.remoteOnly ||
  !!f.maxAgeDays;

export function filterSummary(f: SourceFilters): string {
  const parts: string[] = [];
  if (f.include.length) parts.push(`only ${f.include.join(' / ')}`);
  if (f.exclude.length) parts.push(`not ${f.exclude.join(' / ')}`);
  if (f.locations.length) parts.push(`in ${f.locations.join(' / ')}`);
  if (f.remoteOnly) parts.push('remote only');
  if (f.maxAgeDays) parts.push(`newer than ${f.maxAgeDays} days`);
  return parts.join(' · ');
}
