import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { Alert, Form } from 'react-bootstrap';
import {
  PROMISE_CHANNEL,
  type SplitFfmpegStatus,
} from '../../common';
import { backendErrorMessage, useBackend } from '../helpers';
import { Button } from '../ui/Button';
import { PathInput } from './PathInput';

const Wrap = styled.section`
  display: grid;
  gap: var(--hb-space-sm);
  padding: var(--hb-space-md);
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-md);
  background: var(--hb-surface);
  margin-top: var(--hb-space-lg);
`;

const Title = styled.h3`
  margin: 0;
  font-size: var(--hb-font-sm);
  font-weight: 600;
`;

const Muted = styled.p`
  margin: 0;
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
`;

interface FfmpegSettingsProps {
  /** Configured executable; empty means auto-detect the bundled binary. */
  value?: string;
  onChange: (path: string) => void;
}

const SOURCE_LABEL: Record<SplitFfmpegStatus['source'], string> = {
  configured: 'custom path',
  bundled: 'bundled',
  path: 'system PATH',
};

/**
 * Shared ffmpeg used by FFmpeg conversions and multi-episode splitting. The
 * app ships a static binary, so this only exists to point at a custom build.
 */
export const FfmpegSettings: React.FC<FfmpegSettingsProps> = ({
  value,
  onChange,
}) => {
  const check = useBackend({
    channel: PROMISE_CHANNEL.OrganizeFfmpegStatus,
    skip: true,
  });
  // `refetch` is recreated as the hook's loading state changes; a ref keeps the
  // debounced check on the newest one without re-running the effect.
  const checkRef = useRef(check);
  checkRef.current = check;
  const [status, setStatus] = useState<SplitFfmpegStatus>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const runCheck = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await checkRef.current.refetch();
      setStatus(result.data);
      if (result.error) setError(backendErrorMessage(result.error));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    // Check automatically, but debounce so typing a path does not spawn ffmpeg
    // on every keystroke.
    const timer = window.setTimeout(() => {
      void runCheck();
    }, 500);
    return () => window.clearTimeout(timer);
  }, [value]);

  const path = value ?? '';

  return (
    <Wrap>
      <Title>FFmpeg</Title>
      <Muted>
        Used by FFmpeg conversions and episode splitting. Leave this empty to
        use the bundled static binary; set a path only to override it.
      </Muted>
      <Form.Group>
        <Form.Label htmlFor="ffmpeg-path">FFmpeg executable</Form.Label>
        <PathInput
          id="ffmpeg-path"
          kind="file"
          title="Choose the ffmpeg executable"
          value={path}
          placeholder="Auto (bundled FFmpeg)"
          allowClear
          onChange={(next) => onChange(next.trim() ? next : '')}
        />
      </Form.Group>
      <div>
        <Button
          compact
          variant="secondary"
          icon="scan"
          onClick={() => void runCheck()}
          disabled={busy}
        >
          {busy ? 'Checking…' : 'Check FFmpeg'}
        </Button>
      </div>
      {error && (
        <Alert variant="danger" className="mb-0">
          {error}
        </Alert>
      )}
      {status && (
        <Alert
          variant={status.available ? 'success' : 'warning'}
          className="mb-0"
        >
          {status.available
            ? `Ready (${SOURCE_LABEL[status.source]}): ${status.path}${
                status.version ? ` — ${status.version}` : ''
              }`
            : `FFmpeg could not be started at ${status.path}. Episode splitting stays disabled until it is available.`}
        </Alert>
      )}
    </Wrap>
  );
};
