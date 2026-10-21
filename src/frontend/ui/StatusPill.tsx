import React from 'react';
import styled from 'styled-components';

export type AppStatus =
  | 'idle'
  | 'scanning'
  | 'running'
  | 'paused'
  | 'stopping'
  | 'completed'
  | 'error';

const tone: Record<AppStatus, string> = {
  idle: 'var(--hb-textMuted)',
  scanning: 'var(--hb-accent)',
  running: 'var(--hb-accent)',
  paused: 'var(--hb-warning)',
  stopping: 'var(--hb-warning)',
  completed: 'var(--hb-success)',
  error: 'var(--hb-danger)',
};

const Pill = styled.span<{ $tone: string }>`
  display: inline-flex;
  align-items: center;
  gap: var(--hb-space-xs);
  padding: 0 var(--hb-space-sm);
  height: 24px;
  border-radius: 999px;
  border: 1px solid ${({ $tone }) => $tone};
  color: ${({ $tone }) => $tone};
  font-size: var(--hb-font-xs);
  font-weight: 500;
  text-transform: capitalize;
`;

export const StatusPill: React.FC<{ status: AppStatus }> = ({ status }) => (
  <Pill $tone={tone[status]} role="status" aria-live="polite">
    {status}
  </Pill>
);
