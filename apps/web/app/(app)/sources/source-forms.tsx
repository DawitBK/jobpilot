'use client';

import {
  CheckCircle2,
  ExternalLink,
  History,
  Link2,
  SlidersHorizontal,
  XCircle,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Field, Modal, useMutation } from '@/components/form';
import { Badge, Notice, statusTone } from '@/components/ui';
import { call } from '@/lib/client-api';
import { formatDateTime } from '@/lib/format';
import type { ImportResult, RunResult, Source, SourceRun } from '@/lib/types';
import { draftOf, emptyDraft, filtersOf, type FilterDraft } from './filter-model';
import { FiltersFields } from './filters-fields';

export function RunSource({ id }: { id: string }) {
  const router = useRouter();
  const m = useMutation();
  const [result, setResult] = useState<RunResult | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <button
        className="btn btn-sm"
        disabled={m.busy}
        onClick={async () => {
          setResult(null);
          const r = await m.run<RunResult>('POST', `/sources/${id}/run`, {});
          if (r.ok && r.data) setResult(r.data);
          // A failed read is also news: the row shows it, and when the next try will be.
          else router.refresh();
        }}
      >
        {m.busy ? 'Reading…' : 'Read now'}
      </button>
      {result ? (
        <span className="mt-1 max-w-60 text-right text-xs text-good">
          {result.created} new, {result.duplicates} known
          {result.filtered ? `, ${result.filtered} filtered out` : ''}, {result.matched} scored
        </span>
      ) : null}
      {m.error ? (
        <span className="mt-1 max-w-60 text-right text-xs text-bad">{m.error}</span>
      ) : null}
    </span>
  );
}

/** The last reads of a source and how each went. */
export function RunHistory({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<SourceRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        className="btn btn-sm"
        onClick={async () => {
          setOpen(true);
          setRuns(null);
          setError(null);
          const r = await call<SourceRun[]>('GET', `/sources/${id}/runs`);
          if (r.ok && r.data) setRuns(r.data);
          else setError(r.message ?? 'The history could not be loaded');
        }}
      >
        <History aria-hidden="true" className="h-3.5 w-3.5" /> History
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Reads of ${name}`} wide>
        {error ? <Notice tone="bad">{error}</Notice> : null}
        {!error && runs === null ? <p className="text-sm text-muted">Loading…</p> : null}
        {runs && runs.length === 0 ? (
          <p className="text-sm text-muted">This source has not been read yet.</p>
        ) : null}
        {runs && runs.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max border-collapse text-sm">
              <thead className="border-b border-line text-left text-xs text-muted">
                <tr>
                  <th className="py-2 pr-4 font-medium">When</th>
                  <th className="py-2 pr-4 font-medium">How</th>
                  <th className="py-2 pr-4 text-right font-medium">Found</th>
                  <th className="py-2 pr-4 text-right font-medium">New</th>
                  <th className="py-2 pr-4 text-right font-medium">Known</th>
                  <th className="py-2 pr-4 text-right font-medium">Filtered</th>
                  <th className="py-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="py-2 pr-4 whitespace-nowrap">{formatDateTime(r.startedAt)}</td>
                    <td className="py-2 pr-4 text-muted">
                      {r.trigger === 'SCHEDULE' ? 'Automatic' : 'By hand'}
                    </td>
                    <td className="py-2 pr-4 text-right">{r.fetched}</td>
                    <td className="py-2 pr-4 text-right">{r.created}</td>
                    <td className="py-2 pr-4 text-right">{r.duplicates}</td>
                    <td className="py-2 pr-4 text-right">{r.filtered}</td>
                    <td className="py-2">
                      <Badge tone={statusTone(r.status)}>
                        {r.status === 'OK' ? 'Worked' : 'Failed'}
                      </Badge>
                      {r.status === 'ERROR' && r.message ? (
                        <div className="mt-0.5 max-w-72 text-xs text-bad">{r.message}</div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Modal>
    </>
  );
}

/** Change what a source keeps, or how often it is read. */
export function EditSource({ source }: { source: Source }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FilterDraft>(emptyDraft);
  const [every, setEvery] = useState(String(source.pollIntervalMinutes));
  const [name, setName] = useState(source.name);
  const m = useMutation();
  const minutes = Number(every);
  const valid = name.trim() !== '' && Number.isInteger(minutes) && minutes >= 5 && minutes <= 10080;
  return (
    <>
      <button
        className="btn btn-sm"
        onClick={() => {
          setDraft(draftOf(source.filters));
          setEvery(String(source.pollIntervalMinutes));
          setName(source.name);
          setOpen(true);
        }}
      >
        <SlidersHorizontal aria-hidden="true" className="h-3.5 w-3.5" /> Settings
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Settings for ${source.name}`}>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!valid) return;
            const r = await m.run('PATCH', `/sources/${source.id}`, {
              version: source.version,
              name: name.trim(),
              pollIntervalMinutes: minutes,
              filters: filtersOf(draft),
            });
            if (r.ok) setOpen(false);
          }}
        >
          <Field label="Name" error={m.fieldErrors['name']}>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
            />
          </Field>
          <Field
            label="Read every (minutes)"
            hint="Between 5 and 10080. A failing source waits longer."
          >
            <input
              className="input"
              inputMode="numeric"
              value={every}
              onChange={(e) => setEvery(e.target.value)}
            />
          </Field>
          <FiltersFields value={draft} onChange={setDraft} />
          {m.error ? <Notice tone="bad">{m.error}</Notice> : null}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={m.busy || !valid}>
              Save
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

/** Add jobs one by one from their own pages, or from the links inside a pasted email. */
export function ImportLinks({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const m = useMutation();
  return (
    <>
      <button className={compact ? 'btn btn-sm' : 'btn'} onClick={() => setOpen(true)}>
        <Link2 aria-hidden="true" className="h-4 w-4" /> Add jobs from links
      </button>
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          setResult(null);
        }}
        title="Add jobs from links"
        wide
      >
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setResult(null);
            const r = await m.run<ImportResult>('POST', '/jobs/import', { text: text.trim() });
            if (r.ok && r.data) setResult(r.data);
          }}
        >
          <p className="text-sm text-muted">
            For LinkedIn, Glassdoor, Indeed, Bayt, Hahu and any site without a feed: paste a job’s
            link, several links, or a whole job-alert email. Every https link is opened the way a
            browser would, and the job on the page is added.
          </p>
          <Field label="Links or pasted text" error={m.fieldErrors['text']}>
            <textarea
              className="input min-h-32 py-2 font-mono text-xs"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                'https://www.linkedin.com/jobs/view/123456\nhttps://example.com/careers/42'
              }
              required
            />
          </Field>
          {m.error ? <Notice tone="bad">{m.error}</Notice> : null}
          {result ? (
            <ul className="divide-y divide-line rounded-lg border border-line text-sm">
              {result.results.map((r) => (
                <li key={r.url} className="flex items-start gap-2.5 px-3 py-2">
                  {r.outcome === 'FAILED' ? (
                    <XCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-bad" />
                  ) : (
                    <CheckCircle2
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 shrink-0 text-good"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="font-medium">
                      {r.title ? `${r.title} at ${r.company}` : 'Could not be added'}
                      <span className="ml-2">
                        <Badge
                          tone={
                            r.outcome === 'ADDED'
                              ? 'good'
                              : r.outcome === 'FAILED'
                                ? 'bad'
                                : 'neutral'
                          }
                        >
                          {r.outcome === 'ADDED'
                            ? 'Added'
                            : r.outcome === 'ALREADY_KNOWN'
                              ? 'Already on file'
                              : 'Failed'}
                        </Badge>
                      </span>
                    </div>
                    <div className="truncate text-xs text-muted">{r.url}</div>
                    {r.message ? <div className="text-xs text-bad">{r.message}</div> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setOpen(false);
                setResult(null);
              }}
            >
              Close
            </button>
            <button className="btn btn-primary" disabled={m.busy || text.trim().length < 8}>
              {m.busy ? 'Opening the pages…' : 'Add the jobs'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function Homepage({ href }: { href: string }) {
  return (
    <a
      className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
      href={href}
      target="_blank"
      rel="noreferrer noopener"
    >
      <ExternalLink aria-hidden="true" className="h-3 w-3" /> Visit
    </a>
  );
}
