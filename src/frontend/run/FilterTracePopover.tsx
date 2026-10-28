import React, { useId } from 'react';
import styled from 'styled-components';
import { OverlayTrigger, Popover } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import { FilterTrace } from '../../common/filterExpression';
import type { RunItemAction } from '../../common';
import { Button } from '../ui/Button';
import { FilterTraceList } from '../ui/filterBuilder/FilterTraceList';
import { filterBuilderMessages } from '../ui/filterBuilder/messages';
import { scanFilterFields } from '../settings/scanFilterFields';
import type { QueueRowState } from './QueueTable';

const TracePopover = styled(Popover)`
  min-width: 300px;
  max-width: 460px;
`;

const Path = styled.div`
  font-size: var(--hb-font-sm);
  overflow-wrap: anywhere;
`;

const Subtitle = styled.div`
  margin-top: 2px;
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
`;

const Reason = styled.div`
  margin-top: var(--hb-space-sm);
  padding-top: var(--hb-space-sm);
  border-top: 1px solid var(--hb-border);
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
`;

interface FilterTracePopoverProps {
  trace?: FilterTrace;
  state: QueueRowState;
  action?: RunItemAction;
  path: string;
  reason?: string;
}

export const FilterTracePopover: React.FC<FilterTracePopoverProps> = ({
  trace,
  state,
  action,
  path,
  reason,
}) => {
  const { formatMessage } = useIntl();
  const popoverId = useId();
  const label = !trace
    ? '—'
    : state === 'excluded'
      ? formatMessage(filterBuilderMessages.traceExcluded)
      : state === 'skipped' || action === 'copy'
        ? formatMessage(filterBuilderMessages.traceCopied)
        : formatMessage(filterBuilderMessages.traceIncluded);
  const copied = state === 'skipped' || action === 'copy';
  const tone =
    state === 'excluded' || copied ? 'var(--hb-textMuted)' : 'var(--hb-success)';

  if (!trace) {
    return <span style={{ color: 'var(--hb-textMuted)' }}>—</span>;
  }

  return (
    <OverlayTrigger
      trigger="click"
      rootClose
      placement="auto"
      flip
      overlay={
        <TracePopover id={popoverId}>
          <Popover.Header as="h3">
            {formatMessage(filterBuilderMessages.traceTitle)}
          </Popover.Header>
          <Popover.Body>
            <Path>{path}</Path>
            <Subtitle>{formatMessage(filterBuilderMessages.traceSubtitle)}</Subtitle>
            <div style={{ marginTop: 'var(--hb-space-sm)' }}>
              <FilterTraceList trace={trace} fields={scanFilterFields} />
            </div>
            {reason && <Reason>{reason}</Reason>}
          </Popover.Body>
        </TracePopover>
      }
    >
      <Button
        compact
        variant="ghost"
        style={{ color: tone }}
        title={formatMessage(filterBuilderMessages.whyThisFile)}
        aria-label={`${formatMessage(filterBuilderMessages.whyThisFile)} ${path}`}
      >
        {label}
      </Button>
    </OverlayTrigger>
  );
};
