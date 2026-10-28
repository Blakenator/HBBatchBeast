import React, { useState } from 'react';
import styled from 'styled-components';
import { Alert } from 'react-bootstrap';
import {
  AppConfigV2,
  Library,
  validateLibrary,
} from '../../common';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { LibraryEditor } from '../settings/library/LibraryEditor';

const Wrap = styled.div`
  display: grid;
  gap: var(--hb-space-lg);
`;

const Actions = styled.div`
  display: flex;
  gap: var(--hb-space-sm);
  flex-wrap: wrap;
`;

const Muted = styled.p`
  margin: 0;
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
`;

interface QuickConvertPageProps {
  config: AppConfigV2;
  initialLibrary: Library;
  onCancel: () => void;
  onContinue: (library: Library) => void;
}

export const QuickConvertPage: React.FC<QuickConvertPageProps> = ({
  config,
  initialLibrary,
  onCancel,
  onContinue,
}) => {
  const [library, setLibrary] = useState(initialLibrary);
  const problems = validateLibrary(library, config.presets);

  return (
    <Wrap>
      <Panel title="Quick conversion">
        <Muted>
          This run is temporary. It will not change your saved libraries, and
          you can save it as a library after reviewing the queue.
        </Muted>
        <Actions style={{ marginTop: 'var(--hb-space-md)' }}>
          <Button
            variant="success"
            onClick={() => onContinue(library)}
            disabled={problems.length > 0}
          >
            Continue to scan
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </Actions>
        {problems.length > 0 && (
          <Alert variant="warning" className="mt-3 mb-0">
            <strong>Fix these before scanning</strong>
            <ul className="mb-0">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </Alert>
        )}
      </Panel>

      <LibraryEditor
        config={config}
        library={library}
        onChange={setLibrary}
        showFileHandling={false}
      />
    </Wrap>
  );
};
