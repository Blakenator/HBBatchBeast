import React from 'react';
import { Alert, Button, Card, Spinner } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import { ASYNC_CHANNEL, GlobalAppConfig, PROMISE_CHANNEL } from '../../common';
import { useBackend, useBackendAsync } from '../helpers';
import { useSetBatchResult } from '../core/stores';
import { runMessages } from './messages';
import { RunStatePayload } from './types';

interface RunPanelProps {
  config: GlobalAppConfig;
  items: { path: string; preset: string; destinationPath?: string }[];
}

export const RunPanel: React.FC<RunPanelProps> = ({ config, items }) => {
  const { formatMessage } = useIntl();
  const setBatchResult = useSetBatchResult();

  const { refetch: startRun, loading, error, lastProgressData, completeData } =
    useBackendAsync({
      channel: ASYNC_CHANNEL.RunConversion,
      props: { config, items },
      skip: true,
      onComplete: (result) => setBatchResult(undefined),
    });

  const pause = useBackend({ channel: PROMISE_CHANNEL.PauseRun, skip: true });
  const resume = useBackend({ channel: PROMISE_CHANNEL.ResumeRun, skip: true });
  const stop = useBackend({ channel: PROMISE_CHANNEL.StopRun, skip: true });

  const state: RunStatePayload | undefined =
    lastProgressData ?? completeData ?? undefined;
  const status = state?.status ?? 'idle';
  const canStart = items.length > 0 && !loading;
  const running = status === 'running' || status === 'paused';

  return (
    <Card className="mt-3">
      <Card.Body>
        <div style={{ display: 'flex', gap: '.5em', alignItems: 'center' }}>
          <Button onClick={() => startRun()} disabled={!canStart}>
            {formatMessage(runMessages.startConversion)}
          </Button>
          <Button
            variant="secondary"
            onClick={() => pause.refetch()}
            disabled={status !== 'running'}
          >
            {formatMessage(runMessages.pause)}
          </Button>
          <Button
            variant="secondary"
            onClick={() => resume.refetch()}
            disabled={status !== 'paused'}
          >
            {formatMessage(runMessages.resume)}
          </Button>
          <Button
            variant="outline-danger"
            onClick={() => stop.refetch()}
            disabled={!running}
          >
            {formatMessage(runMessages.stop)}
          </Button>
          {loading && <Spinner size="sm" />}
          <span style={{ marginLeft: 'auto' }}>
            {formatMessage(runMessages.status, { status })}
          </span>
        </div>

        {items.length === 0 && (
          <div className="text-muted mt-2">{formatMessage(runMessages.noQueue)}</div>
        )}

        {state && (
          <div className="mt-2">
            {formatMessage(runMessages.progress, {
              done: state.counts.success,
              total: state.counts.total,
              failed: state.counts.error,
              cancelled: state.counts.cancelled,
            })}
          </div>
        )}

        {state && state.counts.error > 0 && (
          <Alert variant="danger" className="mt-2">
            <strong>{formatMessage(runMessages.failures)}</strong>
            <ul className="mb-0">
              {state.items
                .filter((item) => item.state === 'error')
                .slice(0, 5)
                .map((item) => (
                  <li key={item.path}>
                    {item.path} — {item.reason ?? ''}
                  </li>
                ))}
            </ul>
          </Alert>
        )}

        {error && <Alert variant="danger">{error.message}</Alert>}
      </Card.Body>
    </Card>
  );
};
