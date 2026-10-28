import React from 'react';
import styled from 'styled-components';
import { Icon } from './Icon';
import { AppIconName } from './icons';

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

const statusIcon: Record<
  AppStatus,
  { name: AppIconName; spin?: boolean }
> = {
  idle: { name: 'statusIdle' },
  scanning: { name: 'statusScanning', spin: true },
  running: { name: 'statusRunning', spin: true },
  paused: { name: 'statusPaused' },
  stopping: { name: 'statusStopping', spin: true },
  completed: { name: 'statusCompleted' },
  error: { name: 'statusError' },
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

export const StatusPill: React.FC<{ status: AppStatus }> = ({ status }) => {
  const icon = statusIcon[status];
  return (
    <Pill $tone={tone[status]} role="status" aria-live="polite">
      <Icon name={icon.name} size="xs" spin={icon.spin} />
      {status}
    </Pill>
  );
};
