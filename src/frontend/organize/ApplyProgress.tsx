import React from 'react';
import styled from 'styled-components';
import { ProgressBar } from 'react-bootstrap';
import { pathBasename, type OrganizeApplyProgress } from '../../common';
import { formatDuration } from '../run/format';
import { Button } from '../ui/Button';

interface ApplyProgressProps {
  progress?: OrganizeApplyProgress;
  /** True while the background apply job is running. */
  applying: boolean;
  cancelling: boolean;
  onCancel: () => void;
}

const Panel = styled.div`
  display: grid;
  gap: var(--hb-space-xs);
  padding: var(--hb-space-sm);
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-md);
  background: var(--hb-surface);

  strong {
    font-size: var(--hb-font-sm);
  }

  .hb-apply-path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--hb-textMuted);
    font-size: var(--hb-font-xs);
  }

  ul {
    margin: 0;
    padding-left: 1.2rem;
    color: var(--hb-warning);
    font-size: var(--hb-font-xs);
  }
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: var(--hb-space-sm);
  flex-wrap: wrap;
`;

const Meta = styled.span`
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
  font-variant-numeric: tabular-nums;
`;

const PHASE_LABEL: Record<OrganizeApplyProgress['phase'], string> = {
  preflight: 'Checking files and disk space…',
  renaming: 'Renaming files…',
  splitting: 'Splitting episodes…',
  plex: 'Updating Plex…',
  done: 'Finished',
};

/**
 * Visible progress for the background apply job: an overall bar over the result
 * files (renames plus every split output) and the fraction of the current
 * source file's split.
 */
export const ApplyProgress: React.FC<ApplyProgressProps> = ({
  progress,
  applying,
  cancelling,
  onCancel,
}) => {
  const total = progress?.total ?? 0;
  const completedValue = progress?.completed ?? 0;
  const completed = Math.floor(completedValue);
  const overallPercent =
    total > 0 ? Math.min(100, Math.round((completedValue / total) * 100)) : 0;
  const currentPercent =
    progress?.currentPercent !== undefined
      ? Math.min(100, Math.max(0, Math.round(progress.currentPercent * 100)))
      : undefined;
  const label = progress ? PHASE_LABEL[progress.phase] : 'Starting apply…';
  const remaining =
    progress?.etaMs !== undefined && progress.etaMs > 0
      ? ` · about ${formatDuration(progress.etaMs / 1000)} left`
      : '';

  return (
    <Panel role="status" aria-live="polite" aria-label="Apply progress">
      <Header>
        <strong>{label}</strong>
        {total > 0 && (
          <Meta>
            {completed} of {total} result file{total === 1 ? '' : 's'} ·{' '}
            {overallPercent}%
            {progress?.elapsedMs
              ? ` · ${formatDuration(progress.elapsedMs / 1000)} elapsed${remaining}`
              : ''}
          </Meta>
        )}
        {applying && (
          <Button
            compact
            variant="ghost"
            icon="cancel"
            onClick={onCancel}
            disabled={cancelling}
            style={{ marginLeft: 'auto' }}
          >
            {cancelling ? 'Cancelling…' : 'Cancel apply'}
          </Button>
        )}
      </Header>
      <ProgressBar
        now={overallPercent}
        animated={applying}
        striped={applying && overallPercent === 0}
        label={overallPercent > 0 ? `${overallPercent}%` : undefined}
        aria-label="Overall apply progress"
      />
      {currentPercent !== undefined && currentPercent < 100 && (
        <ProgressBar
          now={currentPercent}
          animated
          variant="info"
          style={{ height: 6 }}
          aria-label="Current split progress"
        />
      )}
      {progress && progress.splitTotal > 1 ? (
        <Meta>
          Source files: {progress.splitCompleted} of {progress.splitTotal} done
          {progress.currentKind === 'split' && currentPercent !== undefined
            ? ` · current file ${currentPercent}%`
            : ''}
        </Meta>
      ) : null}
      {progress?.currentPath && (
        <span className="hb-apply-path" title={progress.currentPath}>
          {progress.currentKind === 'split' ? 'Splitting ' : 'Renaming '}
          {pathBasename(progress.currentPath)}
        </span>
      )}
      {progress && progress.warnings.length > 0 && (
        <ul>
          {progress.warnings.slice(-4).map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </Panel>
  );
};
