import React, { CSSProperties, useEffect, useState } from 'react';
import { Alert, Badge, Button, Modal, Spinner } from 'react-bootstrap';
import packageJson from '../../../package.json';
import { useIntl } from 'react-intl';
import { versionWarningMessages } from './messages';
import { commonButtonMessages } from '../core/messages';

interface VersionWarningProps {
  oldVersion?: string;
}

export const VersionWarning: React.FC<VersionWarningProps> = ({
  oldVersion,
}) => {
  const [hideModal, setHideModal] = useState(false);
  const [versionMessage, setVersionMessage] = useState<{
    message: string;
    version: string;
    date: Date;
  }>();
  const [error, setError] = useState<any>();
  const [loading, setLoading] = useState(false);
  const versionChanged = !oldVersion || oldVersion !== packageJson.version;
  const { formatMessage } = useIntl();

  useEffect(() => {
    if (oldVersion && versionChanged && !versionMessage) {
      setLoading(true);

      fetch('https://api.github.com/repos/HaveAGitGat/HBBatchBeast/releases')
        .then(async (response) => {
          const latestVersion = (await response.json())[0];
          const message = latestVersion.body;
          setVersionMessage({
            message,
            version: latestVersion.tag_name,
            date: new Date(Date.parse(latestVersion.created_at)),
          });
          setLoading(false);
        })
        .catch((err) => {
          setError(err);
          setLoading(false);
        });
    }
  }, [versionChanged, oldVersion]);

  return (
    <>
      {versionChanged && (
        <Button onClick={() => setHideModal(false)}>
          {formatMessage(versionWarningMessages.showVersionChangelog)}
        </Button>
      )}
      <Modal
        show={versionChanged && !hideModal}
        onHide={() => setHideModal(true)}
        centered
      >
        <Modal.Header closeButton>
          <div style={{ display: 'flex', gap: '.5em', alignItems: 'center' }}>
            <span>
              {' '}
              {formatMessage(versionWarningMessages.versionChangelog)}
            </span>
            {versionMessage && (
              <>
                <Badge style={{ display: 'flex', alignItems: 'center' }}>
                  {versionMessage.version}
                </Badge>
                <i>
                  {versionMessage.date.toLocaleDateString(navigator.language, {
                    dateStyle: 'medium',
                  })}
                </i>
              </>
            )}
          </div>
        </Modal.Header>
        <Modal.Body>
          {loading && <Spinner />}
          {error && <Alert variant="danger">{error.message}</Alert>}
          {versionMessage && (
            <pre
              style={{ textWrap: 'wrap', overflow: 'unset' } as CSSProperties}
            >
              {versionMessage.message}
            </pre>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button onClick={() => setHideModal(true)}>
            {formatMessage(commonButtonMessages.close)}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};
