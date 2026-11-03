import React, { useId } from 'react';
import styled from 'styled-components';
import { OverlayTrigger, Popover } from 'react-bootstrap';
import type {
  EpisodeMatchComponent,
  EpisodeMatchSummary,
} from '../../common';

type MatchBand = 'strong' | 'weak' | 'conflict';

const TONES: Record<MatchBand, { color: string; surface: string }> = {
  strong: {
    color: 'var(--hb-success)',
    surface: 'color-mix(in srgb, var(--hb-success) 16%, transparent)',
  },
  weak: {
    color: 'var(--hb-warning)',
    surface: 'color-mix(in srgb, var(--hb-warning) 18%, transparent)',
  },
  conflict: {
    color: 'var(--hb-danger)',
    surface: 'color-mix(in srgb, var(--hb-danger) 16%, transparent)',
  },
};

const Split = styled.button<{ $tone: (typeof TONES)[MatchBand] }>`
  display: inline-flex;
  align-items: stretch;
  height: 20px;
  max-width: 100%;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--hb-border);
  border-radius: 999px;
  background: var(--hb-surface);
  font: inherit;
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid var(--hb-focus);
    outline-offset: 1px;
  }
`;

const Lead = styled.span<{ $tone: (typeof TONES)[MatchBand] }>`
  display: inline-flex;
  align-items: center;
  padding: 0 7px;
  background: ${({ $tone }) => $tone.surface};
  color: ${({ $tone }) => $tone.color};
  font-size: var(--hb-font-xs);
  font-weight: 600;
  line-height: 1;
  text-transform: lowercase;
  white-space: nowrap;
`;

const Value = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 0 7px;
  background: var(--hb-surfaceMuted);
  color: var(--hb-text);
  font-size: var(--hb-font-xs);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
`;

const Evidence = styled(Popover)`
  max-width: 24rem;
  font-size: var(--hb-font-xs);
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: auto auto auto auto auto;
  gap: 3px 10px;
  align-items: baseline;
`;

const Header = styled.span`
  color: var(--hb-textMuted);
  font-weight: 600;
  white-space: nowrap;
`;

const Cell = styled.span<{ $muted?: boolean }>`
  color: ${({ $muted }) =>
    $muted ? 'var(--hb-textMuted)' : 'var(--hb-text)'};
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
`;

const Footnote = styled.p`
  margin: var(--hb-space-sm) 0 0;
  color: var(--hb-textMuted);
  white-space: normal;
`;

const Reason = styled.p`
  margin: var(--hb-space-sm) 0 0;
  white-space: normal;
`;

const COMPONENT_LABELS: Record<EpisodeMatchComponent['kind'], string> = {
  tag: 'Tag',
  name: 'Title',
  airDate: 'Air date',
};

function bandFor(
  summary: EpisodeMatchSummary | undefined,
  confidence: number | undefined,
  threshold: number,
): MatchBand {
  if (summary?.conflict) return 'conflict';
  if (confidence !== undefined && confidence < threshold) return 'weak';
  return 'strong';
}

function contribution(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function componentScore(component: EpisodeMatchComponent): string {
  if (!component.present || component.componentScore === undefined) return '—';
  return `${Math.round(component.componentScore * 100)}%`;
}

const Breakdown: React.FC<{
  summary: EpisodeMatchSummary;
  confidence: number | undefined;
}> = ({ summary, confidence }) => (
  <>
    <Grid>
      <Header>Signal</Header>
      <Header>State</Header>
      <Header>Weight</Header>
      <Header>Score</Header>
      <Header>Contribution</Header>
      {summary.components.map((component) => (
        <React.Fragment key={component.kind}>
          <Cell>{COMPONENT_LABELS[component.kind]}</Cell>
          <Cell $muted={!component.present}>{component.state}</Cell>
          <Cell $muted>{contribution(component.weight)}</Cell>
          <Cell $muted={!component.present}>
            {componentScore(component)}
          </Cell>
          <Cell $muted={!component.present}>
            {component.present ? contribution(component.contribution) : '—'}
          </Cell>
        </React.Fragment>
      ))}
    </Grid>
    <Footnote>
      Coverage {contribution(summary.coverage)} · weighted score{' '}
      {contribution(summary.rawScore)}
      {summary.cap !== undefined
        ? ` · capped at ${contribution(summary.cap)}`
        : ''}
      {' · '}final {confidence === undefined ? '—' : contribution(confidence)}
    </Footnote>
    {summary.conflictReason && <Reason>{summary.conflictReason}</Reason>}
  </>
);

interface MatchBadgeProps {
  confidence?: number;
  threshold: number;
  summary?: EpisodeMatchSummary;
  reason?: string;
  label?: string;
}

/**
 * Two-faced match pill. The left face is the verdict, the right face is the
 * confidence; hovering or focusing opens the weighted breakdown.
 */
export const MatchBadge: React.FC<MatchBadgeProps> = ({
  confidence,
  threshold,
  summary,
  reason,
  label,
}) => {
  const popoverId = useId();
  const band = bandFor(summary, confidence, threshold);
  const tone = TONES[band];
  const percent =
    confidence === undefined ? '—' : `${Math.round(confidence * 100)}%`;
  return (
    <OverlayTrigger
      trigger={['hover', 'focus']}
      placement="auto"
      overlay={
        <Evidence id={popoverId}>
          <Popover.Header as="h3">Match evidence</Popover.Header>
          <Popover.Body>
            {summary ? (
              <Breakdown summary={summary} confidence={confidence} />
            ) : (
              <Reason>{reason || 'No match evidence recorded.'}</Reason>
            )}
            {summary && reason && reason !== summary.conflictReason && (
              <Reason>{reason}</Reason>
            )}
          </Popover.Body>
        </Evidence>
      }
    >
      <Split
        type="button"
        $tone={tone}
        aria-label={`${label ?? 'Match'} ${band} ${percent}`}
        onClick={(event) => event.stopPropagation()}
      >
        <Lead $tone={tone}>{band}</Lead>
        <Value>{percent}</Value>
      </Split>
    </OverlayTrigger>
  );
};
