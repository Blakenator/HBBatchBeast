import React from 'react';
import styled from 'styled-components';
import { Alert } from 'react-bootstrap';
import { AppConfigV2, Library } from '../../common';
import { Button } from '../ui/Button';
import { Panel, PanelGrid } from '../ui/Panel';

const Grid = styled.div`
  display: grid;
  gap: var(--hb-space-md);
  grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
`;

const Card = styled.div`
  display: grid;
  gap: var(--hb-space-xs);
  padding: var(--hb-space-md);
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-md);
  background: var(--hb-surface);
`;

const CardTitle = styled.span`
  font-weight: 600;
`;

const Muted = styled.span`
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
`;

const CardActions = styled.div`
  display: flex;
  gap: var(--hb-space-xs);
  flex-wrap: wrap;
  margin-top: var(--hb-space-xs);
`;

const Actions = styled.div`
  display: flex;
  gap: var(--hb-space-sm);
  flex-wrap: wrap;
  margin-top: var(--hb-space-sm);
`;

interface LauncherPageProps {
  config: AppConfigV2;
  onOpenLibrary: (libraryId: string) => void;
  onQuickConvert: () => void;
  onQuickFromLibrary: (library: Library) => void;
  onOpenSettings: () => void;
}

export const LauncherPage: React.FC<LauncherPageProps> = ({
  config,
  onOpenLibrary,
  onQuickConvert,
  onQuickFromLibrary,
  onOpenSettings,
}) => {
  return (
    <div style={{ display: 'grid', gap: 'var(--hb-space-lg)' }}>
      <PanelGrid>
        <Panel title="Quick convert">
          <p style={{ margin: 0, color: 'var(--hb-textMuted)' }}>
            Convert a folder once without changing your saved libraries. You
            can still review the queue, edit filters and mapping rules, and save
            the run as a library afterwards.
          </p>
          {config.presets.length === 0 ? (
            <Alert variant="warning" className="mt-3 mb-0">
              Create a conversion preset first.
            </Alert>
          ) : (
            <Actions>
              <Button variant="success" onClick={onQuickConvert}>
                Start a quick conversion
              </Button>
              <Button variant="ghost" onClick={onOpenSettings}>
                Manage presets
              </Button>
            </Actions>
          )}
        </Panel>

        <Panel title="Libraries">
          {config.libraries.length === 0 ? (
            <Muted>No libraries yet.</Muted>
          ) : (
            <Grid>
              {config.libraries.map((library) => {
                const preset = config.presets.find(
                  (item) => item.id === library.defaultPresetId,
                );
                return (
                  <Card key={library.id}>
                    <CardTitle>{library.name || 'Untitled library'}</CardTitle>
                    <Muted>
                      {library.folders.length} folder
                      {library.folders.length === 1 ? '' : 's'} ·{' '}
                      {preset?.name ?? 'no default preset'}
                    </Muted>
                    <Muted>
                      {library.mappingRules.length} mapping rule
                      {library.mappingRules.length === 1 ? '' : 's'}
                    </Muted>
                    <CardActions>
                      <Button
                        compact
                        variant="secondary"
                        onClick={() => onOpenLibrary(library.id)}
                      >
                        Open
                      </Button>
                      <Button
                        compact
                        variant="ghost"
                        onClick={() => onQuickFromLibrary(library)}
                      >
                        Use as quick run
                      </Button>
                    </CardActions>
                  </Card>
                );
              })}
            </Grid>
          )}
          <Actions>
            <Button variant="secondary" onClick={onOpenSettings}>
              Manage libraries
            </Button>
          </Actions>
        </Panel>
      </PanelGrid>
    </div>
  );
};
