'use client';

import { useState } from 'react';
import { Field, Modal, useMutation } from '@/components/form';
import { Notice } from '@/components/ui';

const csv = (v: string) =>
  v
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

export function NewJob() {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    companyName: '',
    title: '',
    description: '',
    location: '',
    remoteType: 'REMOTE',
    seniority: '',
    salaryMin: '',
    salaryMax: '',
    requiredSkills: '',
    preferredSkills: '',
    applicationUrl: '',
    visa: '',
  });
  const m = useMutation();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const min = f.salaryMin.trim() ? Number(f.salaryMin) : null;
  const max = f.salaryMax.trim() ? Number(f.salaryMax) : null;
  const badPay =
    (min !== null && (!Number.isInteger(min) || min < 0)) ||
    (max !== null && (!Number.isInteger(max) || max < 0)) ||
    (min !== null && max !== null && min > max);

  return (
    <>
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        Add a job
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add a job posting" wide>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (badPay) return;
            const r = await m.run('POST', '/jobs', {
              companyName: f.companyName.trim(),
              title: f.title.trim(),
              description: f.description.trim(),
              ...(f.location.trim() ? { location: f.location.trim() } : {}),
              remoteType: f.remoteType,
              ...(f.seniority ? { seniority: f.seniority } : {}),
              ...(min !== null ? { salaryMin: min } : {}),
              ...(max !== null ? { salaryMax: max } : {}),
              requiredSkills: csv(f.requiredSkills),
              preferredSkills: csv(f.preferredSkills),
              ...(f.applicationUrl.trim() ? { applicationUrl: f.applicationUrl.trim() } : {}),
              ...(f.visa ? { visaSponsorship: f.visa === 'yes' } : {}),
            });
            if (r.ok) setOpen(false);
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Company" error={m.fieldErrors['companyName']}>
              <input
                className="input"
                value={f.companyName}
                onChange={set('companyName')}
                required
                maxLength={200}
              />
            </Field>
            <Field label="Job title" error={m.fieldErrors['title']}>
              <input
                className="input"
                value={f.title}
                onChange={set('title')}
                required
                maxLength={200}
              />
            </Field>
            <Field label="Location">
              <input
                className="input"
                value={f.location}
                onChange={set('location')}
                maxLength={200}
              />
            </Field>
            <Field label="Where you work">
              <select className="input" value={f.remoteType} onChange={set('remoteType')}>
                <option value="REMOTE">Remote</option>
                <option value="HYBRID">Hybrid</option>
                <option value="ONSITE">On site</option>
              </select>
            </Field>
            <Field label="Level">
              <select className="input" value={f.seniority} onChange={set('seniority')}>
                <option value="">Not stated</option>
                {['ENTRY', 'MID', 'SENIOR', 'STAFF', 'PRINCIPAL'].map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0) + s.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Visa sponsorship">
              <select className="input" value={f.visa} onChange={set('visa')}>
                <option value="">Not stated</option>
                <option value="yes">Offered</option>
                <option value="no">Not offered</option>
              </select>
            </Field>
            <Field label="Pay, lowest (a year)" error={badPay ? 'Check the pay range' : undefined}>
              <input
                className="input"
                inputMode="numeric"
                value={f.salaryMin}
                onChange={set('salaryMin')}
              />
            </Field>
            <Field label="Pay, highest (a year)">
              <input
                className="input"
                inputMode="numeric"
                value={f.salaryMax}
                onChange={set('salaryMax')}
              />
            </Field>
            <Field label="Required skills" hint="Separate with commas">
              <input className="input" value={f.requiredSkills} onChange={set('requiredSkills')} />
            </Field>
            <Field label="Nice to have" hint="Separate with commas">
              <input
                className="input"
                value={f.preferredSkills}
                onChange={set('preferredSkills')}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Where to apply (web address)" error={m.fieldErrors['applicationUrl']}>
                <input
                  className="input"
                  type="url"
                  value={f.applicationUrl}
                  onChange={set('applicationUrl')}
                  placeholder="https://"
                />
              </Field>
            </div>
          </div>
          <Field label="Description">
            <textarea
              className="input min-h-28 py-2"
              value={f.description}
              onChange={set('description')}
              maxLength={50000}
            />
          </Field>
          {m.error ? <Notice tone="bad">{m.error}</Notice> : null}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={m.busy || badPay}>
              Add job
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
