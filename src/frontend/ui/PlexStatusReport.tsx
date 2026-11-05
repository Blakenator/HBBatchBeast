import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import type {
  OrganizePlexCheck,
  PlexFixStep,
  PlexIssue,
  PlexRemediationStep,
} from '../../common';
import { copyText } from '../core/utils';
import { Button } from './Button';
import { Icon } from './Icon';
import type { AppIconName } from './icons';

const Wrap = styled.section`
  display: grid;
  gap: var(--hb-space-sm);
  min-width: 0;
`;

const StatusRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--hb-space-xs);
`;

const Chip = styled.span<{ $color: string }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 var(--hb-space-sm);
  border: 1px solid
    color-mix(in srgb, ${({ $color }) => $color} 45%, var(--hb-border));
  border-radius: 999px;
  background: color-mix(in srgb, ${({ $color }) => $color} 12%, transparent);
  color: ${({ $color }) => $color};
  font-size: var(--hb-font-xs);
  font-weight: 500;
  white-space: nowrap;
`;

const List = styled.ol`
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--hb-space-xs);
`;

const Item = styled.li`
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: var(--hb-space-xs);
  font-size: var(--hb-font-sm);
`;

const Status = styled.span<{ $color: string }>`
  color: ${({ $color }) => $color};
  font-weight: 700;
  line-height: 1.4;
`;

const Body = styled.div`
  display: grid;
  gap: 1px;
  min-width: 0;
`;

const IssueTitle = styled.span`
  font-weight: 500;
  overflow-wrap: anywhere;
`;

const Meta = styled.span`
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
  overflow-wrap: anywhere;
`;

const Block = styled.div`
  display: grid;
  gap: var(--hb-space-xs);
  min-width: 0;
`;

const BlockHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hb-space-sm);
  flex-wrap: wrap;
`;

const BlockTitle = styled.span`
  font-size: var(--hb-font-sm);
  font-weight: 600;
`;

const Pre = styled.pre`
  margin: 0;
  max-height: 18rem;
  overflow: auto;
  padding: var(--hb-space-sm);
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-sm);
  background: var(--hb-surfaceMuted);
  font-size: var(--hb-font-xs);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;

const FixRow = styled.div`
  display: flex;
  align-items: center;
  gap: var(--hb-space-sm);
  flex-wrap: wrap;
`;

const Hint = styled.span`
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
`;

const StepList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--hb-space-xs);
`;

const StepItem = styled.li`
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: var(--hb-space-xs);
  font-size: var(--hb-font-sm);
`;

const ISSUE_TONE: Record<PlexIssue['severity'], string> = {
  error: 'var(--hb-danger)',
  warning: 'var(--hb-warning)',
  info: 'var(--hb-textMuted)',
};

const ISSUE_ICON: Record<PlexIssue['severity'], AppIconName> = {
  error: 'failed',
  warning: 'warning',
  info: 'inspect',
};

const useCopied = (text: string) => {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    const ok = await copyText(text);
    if (!ok) return;
    setCopied(true);
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2000);
  };

  return { copied, copy };
};

export const PlexCommandBlock: React.FC<{
  steps: PlexRemediationStep[];
  summary?: string;
}> = ({ steps, summary }) => {
  const script = steps.map((step) => step.command).join('\n');
  const { copied, copy } = useCopied(script);
  if (!script) return null;
  return (
    <Block>
      <BlockHeader>
        <BlockTitle>Manual fix</BlockTitle>
        <Button
          compact
          variant="ghost"
          icon="copy"
          onClick={() => void copy()}
          aria-label="Copy Plex fix commands"
        >
          {copied ? 'Copied' : 'Copy commands'}
        </Button>
      </BlockHeader>
      {summary && <Meta>{summary}</Meta>}
      <Pre>
        <code>{script}</code>
      </Pre>
    </Block>
  );
};

export interface PlexStatusReportProps {
  check: OrganizePlexCheck;
  onAutoFix?: () => void;
  fixing?: boolean;
  fixSteps?: PlexFixStep[];
  showAutoFix?: boolean;
  showCommands?: boolean;
}

/**
 * Shared Plex health report: status chips, a structured issue list, the
 * automatic fix action and copy-ready manual commands.
 */
export const PlexStatusReport: React.FC<PlexStatusReportProps> = ({
  check,
  onAutoFix,
  fixing = false,
  fixSteps,
  showAutoFix = true,
  showCommands = true,
}) => {
  const database = check.exists
    ? { color: 'var(--hb-success)', icon: 'passed' as const, label: 'Database found' }
    : { color: 'var(--hb-danger)', icon: 'failed' as const, label: 'Database missing' };
  const access = !check.exists
    ? { color: 'var(--hb-textMuted)', icon: 'neutral' as const, label: 'Unavailable' }
    : check.writable
      ? { color: 'var(--hb-success)', icon: 'passed' as const, label: 'Writable' }
      : { color: 'var(--hb-danger)', icon: 'failed' as const, label: 'Read-only' };
  const service = check.running
    ? { color: 'var(--hb-warning)', icon: 'warning' as const, label: 'Plex running' }
    : { color: 'var(--hb-success)', icon: 'passed' as const, label: 'Plex stopped' };

  return (
    <Wrap>
      <StatusRow>
        {[database, access, service].map((chip) => (
          <Chip key={chip.label} $color={chip.color}>
            <Icon name={chip.icon} size="xs" />
            {chip.label}
          </Chip>
        ))}
      </StatusRow>

      {check.issues.length > 0 && (
        <List aria-label="Plex issues">
          {check.issues.map((issue) => (
            <Item key={issue.id}>
              <Status $color={ISSUE_TONE[issue.severity]} aria-hidden>
                <Icon name={ISSUE_ICON[issue.severity]} size="xs" />
              </Status>
              <Body>
                <IssueTitle>{issue.title}</IssueTitle>
                <Meta>{issue.detail}</Meta>
              </Body>
            </Item>
          ))}
        </List>
      )}

      {showAutoFix && check.canAutoFix && onAutoFix && (
        <FixRow>
          <Button
            compact
            variant="secondary"
            icon="fix"
            onClick={onAutoFix}
            disabled={fixing}
          >
            {fixing ? 'Fixing…' : 'Fix automatically'}
          </Button>
          <Hint>
            Stops Plex if needed, grants your user access to the database
            folder, then restarts Plex only if it was running. Windows, macOS
            and Linux ask for administrator approval.
          </Hint>
        </FixRow>
      )}

      {fixSteps && fixSteps.length > 0 && (
        <StepList aria-label="Automatic fix results">
          {fixSteps.map((step) => (
            <StepItem key={step.id}>
              <Status
                $color={step.ok ? 'var(--hb-success)' : 'var(--hb-danger)'}
                aria-hidden
              >
                <Icon name={step.ok ? 'passed' : 'failed'} size="xs" />
              </Status>
              <Body>
                <IssueTitle>{step.title}</IssueTitle>
                {step.detail && <Meta>{step.detail}</Meta>}
              </Body>
            </StepItem>
          ))}
        </StepList>
      )}

      {showCommands && (
        <PlexCommandBlock
          steps={check.remediation.steps}
          summary={check.remediation.summary}
        />
      )}
    </Wrap>
  );
};
