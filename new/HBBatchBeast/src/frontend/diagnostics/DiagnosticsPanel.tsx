import React, { useState } from 'react';
import styled from 'styled-components';
import { Modal } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import { toast } from 'react-toastify';
import { PROMISE_CHANNEL } from '../../common';
import { useBackend } from '../helpers';
import { Button } from '../ui/Button';
import { diagnosticsMessages } from './messages';

const Section = styled.section`
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-md);
  padding: var(--hb-space-md);
  background: var(--hb-surface);
`;

const SectionTitle = styled.h3`
  margin: 0 0 var(--hb-space-sm);
  font-size: var(--hb-font-sm);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--hb-textMuted);
`;

const List = styled.ul`
  list-style: none;
  margin: 0 0 var(--hb-space-sm);
  padding: 0;
`;

const ListItem = styled.li`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hb-space-sm);
  padding: var(--hb-space-xs) 0;
  border-bottom: 1px solid var(--hb-border);
  font-size: var(--hb-font-sm);

  &:last-child {
    border-bottom: none;
  }
`;

const Name = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Size = styled.span`
  color: var(--hb-textMuted);
  font-variant-numeric: tabular-nums;
`;

const Row = styled.div`
  display: flex;
  gap: var(--hb-space-sm);
  flex-wrap: wrap;
  margin-top: var(--hb-space-sm);
`;

const Hint = styled.p`
  margin: 0;
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
`;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type ConfirmKind = 'caches' | 'journal';

export const DiagnosticsPanel: React.FC = () => {
  const { formatMessage } = useIntl();
  const diagnostics = useBackend({ channel: PROMISE_CHANNEL.GetDiagnostics });
  const openPath = useBackend({ channel: PROMISE_CHANNEL.OpenAppPath, skip: true });
  const clearCaches = useBackend({ channel: PROMISE_CHANNEL.ClearCaches, skip: true });
  const clearJournal = useBackend({
    channel: PROMISE_CHANNEL.ClearRunJournal,
    skip: true,
  });
  const [confirming, setConfirming] = useState<ConfirmKind | null>(null);

  const info = diagnostics.data;
  // Only a run that was still going when the app died needs recovering.
  const interrupted =
    info?.journalStatus === 'running' || info?.journalStatus === 'paused';

  const confirm = () => {
    if (confirming === 'caches') {
      void clearCaches.refetch().then(({ data }) => {
        const cleared = data?.cleared ?? [];
        toast.success(
          cleared.length === 0
            ? formatMessage(diagnosticsMessages.nothingToClear)
            : formatMessage(diagnosticsMessages.clearedCaches, {
                names: cleared.join(', '),
              }),
        );
        void diagnostics.refetch();
      });
    } else if (confirming === 'journal') {
      void clearJournal.refetch().then(() => {
        toast.success(formatMessage(diagnosticsMessages.journalCleared));
        void diagnostics.refetch();
      });
    }
    setConfirming(null);
  };

  return (
    <Section>
      <SectionTitle>{formatMessage(diagnosticsMessages.title)}</SectionTitle>

      {diagnostics.error && (
        <Hint>
          {formatMessage(diagnosticsMessages.loadFailed)}:{' '}
          {diagnostics.error.message}
        </Hint>
      )}

      {info && (
        <>
          <List>
            {info.logs.length === 0 && (
              <ListItem>
                <Hint>{formatMessage(diagnosticsMessages.noLogs)}</Hint>
              </ListItem>
            )}
            {info.logs.map((log) => (
              <ListItem key={log.path}>
                <Name title={log.path}>{log.name}</Name>
                <Size>{formatBytes(log.size)}</Size>
                <Button
                  compact
                  variant="ghost"
                  onClick={() => void openPath.refetch({ path: log.path })}
                >
                  {formatMessage(diagnosticsMessages.open)}
                </Button>
              </ListItem>
            ))}
          </List>

          <Row>
            <Button
              compact
              variant="ghost"
              onClick={() => void openPath.refetch({ path: info.logDir })}
            >
              {formatMessage(diagnosticsMessages.openLogFolder)}
            </Button>
            <Button
              compact
              variant="ghost"
              onClick={() => void openPath.refetch({ path: info.configDir })}
            >
              {formatMessage(diagnosticsMessages.openConfigFolder)}
            </Button>
            <Button
              compact
              variant="dangerOutline"
              onClick={() => setConfirming('caches')}
            >
              {formatMessage(diagnosticsMessages.clearCaches)}
            </Button>
          </Row>

          <Row style={{ alignItems: 'center' }}>
            <Hint>
              {interrupted
                ? formatMessage(diagnosticsMessages.journalPresent)
                : info.journalExists
                  ? formatMessage(diagnosticsMessages.journalFinished, {
                      status: info.journalStatus ?? 'completed',
                    })
                  : formatMessage(diagnosticsMessages.journalAbsent)}
            </Hint>
            {interrupted && (
              <Button
                compact
                variant="dangerOutline"
                onClick={() => setConfirming('journal')}
              >
                {formatMessage(diagnosticsMessages.clearJournal)}
              </Button>
            )}
          </Row>
        </>
      )}

      <Modal show={confirming !== null} onHide={() => setConfirming(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>
            {confirming === 'journal'
              ? formatMessage(diagnosticsMessages.clearJournal)
              : formatMessage(diagnosticsMessages.cachesTitle)}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {confirming === 'journal'
            ? formatMessage(diagnosticsMessages.journalPresent)
            : formatMessage(diagnosticsMessages.cachesBody)}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setConfirming(null)}>
            {formatMessage(diagnosticsMessages.cancel)}
          </Button>
          <Button variant="danger" onClick={confirm}>
            {formatMessage(diagnosticsMessages.clear)}
          </Button>
        </Modal.Footer>
      </Modal>
    </Section>
  );
};
