import React from 'react';
import styled from 'styled-components';
import { Modal, Spinner } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import { PROMISE_CHANNEL } from '../../common';
import { useBackend } from '../helpers';
import { Button } from '../ui/Button';
import { mediaMessages } from './mediaMessages';

const Summary = styled.dl`
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--hb-space-xs) var(--hb-space-lg);
  margin: 0 0 var(--hb-space-lg);
  font-size: var(--hb-font-sm);

  dt {
    color: var(--hb-textMuted);
  }

  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
`;

const Streams = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: var(--hb-font-sm);

  th,
  td {
    text-align: left;
    padding: var(--hb-space-xs) var(--hb-space-sm);
    border-bottom: 1px solid var(--hb-border);
    white-space: nowrap;
  }

  th {
    color: var(--hb-textMuted);
    font-weight: 600;
  }
`;

const Scroll = styled.div`
  overflow-x: auto;
`;

function seconds(value?: number): string | undefined {
  if (!value || !Number.isFinite(value)) return undefined;
  const total = Math.round(value);
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}m ${String(remainder).padStart(2, '0')}s`;
}

function kbps(value?: number): string | undefined {
  if (!value || !Number.isFinite(value)) return undefined;
  return `${Math.round(value / 1000)} kbps`;
}

/** Probes one file on mount; the modal remounts it per path with a `key`. */
const MediaInfoBody: React.FC<{ path: string }> = ({ path }) => {
  const { formatMessage } = useIntl();
  const { data, error, loading } = useBackend({
    channel: PROMISE_CHANNEL.ProbeMedia,
    props: { path },
  });

  if (loading) return <Spinner size="sm" />;

  if (error) {
    return (
      <p style={{ color: 'var(--hb-danger)' }}>
        {formatMessage(mediaMessages.failed)}: {error.message}
      </p>
    );
  }

  if (!data) return null;

  return (
    <>
      <Summary>
        <dt>{formatMessage(mediaMessages.container)}</dt>
        <dd>{data.container ?? '—'}</dd>
        <dt>{formatMessage(mediaMessages.duration)}</dt>
        <dd>{seconds(data.duration) ?? '—'}</dd>
        <dt>{formatMessage(mediaMessages.bitRate)}</dt>
        <dd>{kbps(data.bitRate) ?? '—'}</dd>
        <dt>{formatMessage(mediaMessages.streams)}</dt>
        <dd>{data.streams.length}</dd>
      </Summary>

      <Scroll>
        <Streams>
          <thead>
            <tr>
              <th>#</th>
              <th>{formatMessage(mediaMessages.type)}</th>
              <th>{formatMessage(mediaMessages.codec)}</th>
              <th>{formatMessage(mediaMessages.details)}</th>
              <th>{formatMessage(mediaMessages.bitRate)}</th>
              <th>{formatMessage(mediaMessages.language)}</th>
            </tr>
          </thead>
          <tbody>
            {data.streams.map((stream) => (
              <tr key={stream.index}>
                <td>{stream.index}</td>
                <td>{stream.type}</td>
                <td>{stream.codec ?? '—'}</td>
                <td>
                  {stream.width && stream.height
                    ? `${stream.width}×${stream.height}`
                    : stream.channels
                      ? `${stream.channels} ch`
                      : '—'}
                </td>
                <td>{kbps(stream.bitRate) ?? '—'}</td>
                <td>{stream.language ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </Streams>
      </Scroll>
    </>
  );
};

export const MediaInfoModal: React.FC<{ path: string | null; onClose: () => void }> = ({
  path,
  onClose,
}) => {
  const { formatMessage } = useIntl();

  return (
    <Modal show={path !== null} onHide={onClose} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title>{formatMessage(mediaMessages.title)}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div
          style={{
            color: 'var(--hb-textMuted)',
            fontSize: 'var(--hb-font-xs)',
            marginBottom: 'var(--hb-space-md)',
            overflowWrap: 'anywhere',
          }}
        >
          {path}
        </div>

        {path && <MediaInfoBody key={path} path={path} />}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onClose}>
          {formatMessage(mediaMessages.close)}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};
