import { Badge, statusTone } from '@/components/ui';
import { label } from '@/lib/format';
import type { Match } from '@/lib/types';

const PARTS: [keyof Match, string][] = [
  ['technicalScore', 'Skills'],
  ['locationScore', 'Location'],
  ['seniorityScore', 'Level'],
  ['salaryScore', 'Pay'],
];

/** The score and everything behind it, so a person can disagree with it knowingly. */
export function MatchBreakdown({ match }: { match: Match }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="text-3xl font-semibold tabular-nums">{Math.round(match.overallScore)}</div>
        <Badge tone={statusTone(match.recommendation)}>{label(match.recommendation)}</Badge>
        <span className="text-xs text-muted">scored by {match.scoringVersion}</span>
      </div>
      {match.hardFilters.length > 0 ? (
        <div className="rounded-md bg-bad/10 px-3 py-2 text-sm text-bad" role="note">
          <strong>Ruled out:</strong> {match.hardFilters.join('; ')}
        </div>
      ) : null}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        {PARTS.map(([key, text]) => (
          <div key={key}>
            <dt className="text-xs text-muted">{text}</dt>
            <dd>
              <div className="font-semibold tabular-nums">{Math.round(Number(match[key]))}</div>
              <div className="mt-1 h-1.5 rounded-full bg-line" aria-hidden="true">
                <div
                  className="h-1.5 rounded-full bg-brand"
                  style={{ width: `${Math.min(Math.max(Number(match[key]), 0), 100)}%` }}
                />
              </div>
            </dd>
          </div>
        ))}
      </dl>
      {match.strongEvidence.length > 0 ? (
        <p className="text-sm">
          <span className="font-medium text-good">Strong: </span>
          {match.strongEvidence.join(', ')}
        </p>
      ) : null}
      {match.missingSkills.length > 0 ? (
        <p className="text-sm">
          <span className="font-medium text-warn">Missing: </span>
          {match.missingSkills.join(', ')}
        </p>
      ) : null}
    </div>
  );
}
