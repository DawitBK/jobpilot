'use client';

import { Field } from '@/components/form';
import type { FilterDraft } from './filter-model';

export function FiltersFields({
  value,
  onChange,
}: {
  value: FilterDraft;
  onChange: (next: FilterDraft) => void;
}) {
  const set = (patch: Partial<FilterDraft>) => onChange({ ...value, ...patch });
  return (
    <fieldset className="space-y-3 rounded-lg border border-line p-3">
      <legend className="px-1 text-sm font-medium">Keep only what you want</legend>
      <p className="text-xs text-muted">
        Everything is optional. Words are separated by commas. Leave all empty to keep every job.
      </p>
      <Field label="Mentions any of" hint="For example: typescript, react, accountant">
        <input
          className="input"
          value={value.include}
          onChange={(e) => set({ include: e.target.value })}
        />
      </Field>
      <Field label="Leave out titles with" hint="For example: intern, junior, sales">
        <input
          className="input"
          value={value.exclude}
          onChange={(e) => set({ exclude: e.target.value })}
        />
      </Field>
      <Field label="Places" hint="A city or a country, for example: Addis Ababa, Kenya, Remote">
        <input
          className="input"
          value={value.locations}
          onChange={(e) => set({ locations: e.target.value })}
        />
      </Field>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.remoteOnly}
            onChange={(e) => set({ remoteOnly: e.target.checked })}
          />
          Remote jobs only
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Newer than (days)</span>
          <input
            className="input w-28"
            inputMode="numeric"
            value={value.maxAgeDays}
            onChange={(e) => set({ maxAgeDays: e.target.value })}
            placeholder="any"
          />
        </label>
      </div>
    </fieldset>
  );
}
