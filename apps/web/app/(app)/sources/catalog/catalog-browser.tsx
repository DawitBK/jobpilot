'use client';

import { FlaskConical, Plus, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Field, Modal, useMutation } from '@/components/form';
import { Badge, Empty, Notice } from '@/components/ui';
import { formatDate } from '@/lib/format';
import type { CatalogEntry, PreviewResult, Source } from '@/lib/types';
import { emptyDraft, filtersOf, type FilterDraft } from '../filter-model';
import { FiltersFields } from '../filters-fields';
import { Homepage, ImportLinks } from '../source-forms';

const ACCESS: Record<CatalogEntry['access'], { label: string; tone: 'good' | 'info' | 'warn' }> = {
  OPEN: { label: 'Open feed', tone: 'good' },
  CONFIGURE: { label: 'You set it up', tone: 'info' },
  LINK_ONLY: { label: 'Add from links', tone: 'warn' },
};

export function CatalogBrowser({ entries }: { entries: CatalogEntry[] }) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [chosen, setChosen] = useState<CatalogEntry | null>(null);

  const groups = useMemo(() => [...new Set(entries.map((e) => e.group))], [entries]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter(
      (e) =>
        (!group || e.group === group) &&
        (!q || `${e.name} ${e.summary} ${e.tags.join(' ')} ${e.group}`.toLowerCase().includes(q)),
    );
  }, [entries, query, group]);

  return (
    <>
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <label className="relative">
          <span className="sr-only">Search the catalog</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-subtle"
          />
          <input
            className="input w-72 pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search: LinkedIn, Ethiopia, banks, remote…"
          />
        </label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by group">
          <button
            className={`btn btn-sm ${group === '' ? 'btn-primary' : ''}`}
            onClick={() => setGroup('')}
          >
            All ({entries.length})
          </button>
          {groups.map((g) => (
            <button
              key={g}
              className={`btn btn-sm ${group === g ? 'btn-primary' : ''}`}
              onClick={() => setGroup(g)}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <Empty icon={Search} title="Nothing matches">
          Try fewer words, or use “Any site that publishes job data”, “Any JSON API” or “Any listing
          page” to set up a site yourself.
        </Empty>
      ) : (
        groups
          .filter((g) => shown.some((e) => e.group === g))
          .map((g) => (
            <section key={g} className="mb-8" aria-label={g}>
              <h2 className="mb-3 text-sm font-semibold text-muted">{g}</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {shown
                  .filter((e) => e.group === g)
                  .map((e) => (
                    <article key={e.id} className="card flex flex-col p-4" data-entry={e.id}>
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold">{e.name}</h3>
                        <Badge tone={ACCESS[e.access].tone}>{ACCESS[e.access].label}</Badge>
                      </div>
                      <p className="mt-1.5 text-sm text-muted">{e.summary}</p>
                      {e.note ? <p className="mt-2 text-xs text-subtle">{e.note}</p> : null}
                      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                        {e.access === 'LINK_ONLY' ? (
                          <ImportLinks compact />
                        ) : (
                          <button className="btn btn-sm btn-primary" onClick={() => setChosen(e)}>
                            <Plus aria-hidden="true" className="h-3.5 w-3.5" /> Add
                          </button>
                        )}
                        {e.homepage ? <Homepage href={e.homepage} /> : null}
                        {e.tested ? (
                          <span
                            className="ml-auto text-xs text-subtle"
                            title="The day this was last read from the real site"
                          >
                            Checked {formatDate(e.tested)}
                          </span>
                        ) : null}
                      </div>
                    </article>
                  ))}
              </div>
            </section>
          ))
      )}

      <Configure entry={chosen} onClose={() => setChosen(null)} />
    </>
  );
}

/** Fill in what a source needs, try it, and add it. */
function Configure({ entry, onClose }: { entry: CatalogEntry | null; onClose: () => void }) {
  return (
    <Modal open={entry !== null} onClose={onClose} title={entry ? `Add ${entry.name}` : ''} wide>
      {entry ? <ConfigureForm key={entry.id} entry={entry} onClose={onClose} /> : null}
    </Modal>
  );
}

function ConfigureForm({ entry, onClose }: { entry: CatalogEntry; onClose: () => void }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [every, setEvery] = useState('60');
  const [draft, setDraft] = useState<FilterDraft>(emptyDraft);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const m = useMutation();
  const minutes = Number(every);
  const missing = entry.fields.some((f) => f.required && !(values[f.key] ?? '').trim());
  const valid = !missing && Number.isInteger(minutes) && minutes >= 5 && minutes <= 10080;
  const body = {
    presetId: entry.id,
    values: Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== '')),
    filters: filtersOf(draft),
  };

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        const r = await m.run<Source>('POST', '/sources/from-catalog', {
          ...body,
          ...(name.trim() ? { name: name.trim() } : {}),
          pollIntervalMinutes: minutes,
        });
        if (r.ok) {
          onClose();
          router.push('/sources');
        }
      }}
    >
      {entry.note ? <Notice>{entry.note}</Notice> : null}
      {entry.fields.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {entry.fields.map((f) => (
            <Field
              key={f.key}
              label={f.label + (f.required ? ' *' : '')}
              hint={f.help}
              error={m.fieldErrors[f.key]}
            >
              {f.kind === 'select' ? (
                <select
                  className="input"
                  value={values[f.key] ?? f.options?.[0]?.value ?? ''}
                  onChange={(ev) => setValues({ ...values, [f.key]: ev.target.value })}
                >
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="input"
                  type={f.kind === 'url' ? 'url' : 'text'}
                  inputMode={f.kind === 'number' ? 'numeric' : undefined}
                  value={values[f.key] ?? ''}
                  placeholder={f.placeholder}
                  onChange={(ev) => setValues({ ...values, [f.key]: ev.target.value })}
                  required={f.required}
                />
              )}
            </Field>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">Nothing to fill in: this source needs no settings.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" hint={`Leave empty to call it “${entry.name}”`}>
          <input
            className="input"
            value={name}
            onChange={(ev) => setName(ev.target.value)}
            maxLength={120}
          />
        </Field>
        <Field label="Read every (minutes)" hint="Between 5 and 10080">
          <input
            className="input"
            inputMode="numeric"
            value={every}
            onChange={(ev) => setEvery(ev.target.value)}
          />
        </Field>
      </div>
      <FiltersFields value={draft} onChange={setDraft} />

      {m.error ? <Notice tone="bad">{m.error}</Notice> : null}
      {preview ? (
        <div className="rounded-lg border border-line p-3 text-sm" aria-live="polite">
          <p className="font-medium text-good">
            It works: {preview.fetched} jobs found, {preview.kept} kept
            {preview.filtered ? `, ${preview.filtered} left out by your filters` : ''}.
          </p>
          {preview.sample.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {preview.sample.map((s, i) => (
                <li key={`${s.url ?? s.title}-${i}`} className="text-xs">
                  <span className="font-medium">{s.title}</span>
                  <span className="text-muted">
                    {' '}
                    · {s.company}
                    {s.location ? ` · ${s.location}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-muted">
              Nothing is left after the filters. Loosen them, or check the settings.
            </p>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn"
          disabled={m.busy || missing}
          onClick={async () => {
            setPreview(null);
            const r = await m.run<PreviewResult>('POST', '/sources/preview', body, {
              refresh: false,
            });
            if (r.ok && r.data) setPreview(r.data);
          }}
        >
          <FlaskConical aria-hidden="true" className="h-4 w-4" />
          {m.busy ? 'Reading…' : 'Test it'}
        </button>
        <button className="btn btn-primary" disabled={m.busy || !valid}>
          Add source
        </button>
      </div>
    </form>
  );
}
