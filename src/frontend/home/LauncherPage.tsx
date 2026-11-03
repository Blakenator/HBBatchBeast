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

const CardHeader = styled.div`
  display: flex;
  align-items: center;
  gap: var(--hb-space-xs);
  min-width: 0;
`;

const CardTitle = styled.span`
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const TypeChip = styled.span`
  flex: 0 0 auto;
  padding: 0 var(--hb-space-xs);
  border: 1px solid var(--hb-border);
  border-radius: 999px;
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
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

const QuickActions = styled.div`
  display: flex;
  gap: var(--hb-space-xs);
  align-items: center;
  flex-wrap: wrap;
  padding-top: var(--hb-space-xs);
  border-top: 1px dashed var(--hb-border);
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
  onQuickOrganize: () => void;
  onQuickOrganizeFromLibrary: (library: Library) => void;
  onOrganizeLibrary: (libraryId: string) => void;
  onOpenSettings: () => void;
}

export const LauncherPage: React.FC<LauncherPageProps> = ({
  config,
  onOpenLibrary,
  onQuickConvert,
  onQuickFromLibrary,
  onQuickOrganize,
  onQuickOrganizeFromLibrary,
  onOrganizeLibrary,
  onOpenSettings,
}) => {
  return (
    <div style={{ display: 'grid', gap: 'var(--hb-space-lg)' }}>
      <PanelGrid>
        <Panel title="Convert" icon="quick">
          <p style={{ margin: 0, color: 'var(--hb-textMuted)' }}>
            Re-encode files with HandBrake or FFmpeg. A quick conversion uses a
            throwaway copy, so your saved libraries stay untouched.
          </p>
          {config.presets.length === 0 ? (
            <Alert variant="warning" className="mt-3 mb-0">
              Create a conversion preset before converting.
            </Alert>
          ) : (
            <Actions>
              <Button variant="success" icon="quick" onClick={onQuickConvert}>
                Start a quick conversion
              </Button>
              <Button variant="ghost" icon="presets" onClick={onOpenSettings}>
                Manage presets
              </Button>
            </Actions>
          )}
        </Panel>

        <Panel title="Organize" icon="libraries">
          <p style={{ margin: 0, color: 'var(--hb-textMuted)' }}>
            Match existing files to Plex or TVDB metadata and rename them into
            show, season and movie folders. No conversion is required.
          </p>
          <Actions>
            <Button variant="secondary" icon="libraries" onClick={onQuickOrganize}>
              Start quick organize
            </Button>
          </Actions>
        </Panel>
      </PanelGrid>

      <Panel title="Libraries" icon="libraries">
        {config.libraries.length === 0 ? (
          <Muted>No libraries yet.</Muted>
        ) : (
          <Grid>
            {config.libraries.map((library) => {
              const preset = config.presets.find(
                (item) => item.id === library.defaultPresetId,
              );
              const organizedShows = library.organize?.tvdb?.shows?.length ?? 0;
              const isTv = library.mediaType === 'tv';
              return (
                <Card key={library.id}>
                  <CardHeader>
                    <CardTitle>{library.name || 'Untitled library'}</CardTitle>
                    <TypeChip>{isTv ? 'TV' : 'Movies'}</TypeChip>
                  </CardHeader>
                  <Muted>
                    {library.folders.length} folder
                    {library.folders.length === 1 ? '' : 's'} ·{' '}
                    {preset?.name ?? 'no default preset'}
                  </Muted>
                  <Muted>
                    {library.mappingRules.length} mapping rule
                    {library.mappingRules.length === 1 ? '' : 's'}
                    {isTv
                      ? ` · ${organizedShows} show${organizedShows === 1 ? '' : 's'} matched`
                      : ''}
                  </Muted>
                  <CardActions>
                    <Button
                      compact
                      variant="success"
                      icon="arrowRight"
                      onClick={() => onOpenLibrary(library.id)}
                    >
                      Convert
                    </Button>
                    <Button
                      compact
                      variant="secondary"
                      icon="libraries"
                      onClick={() => onOrganizeLibrary(library.id)}
                    >
                      Organize
                    </Button>
                  </CardActions>
                  <QuickActions>
                    <Muted>One-off:</Muted>
                    <Button
                      compact
                      variant="ghost"
                      icon="quick"
                      onClick={() => onQuickFromLibrary(library)}
                    >
                      Quick convert
                    </Button>
                    <Button
                      compact
                      variant="ghost"
                      icon="libraries"
                      onClick={() => onQuickOrganizeFromLibrary(library)}
                    >
                      Quick organize
                    </Button>
                  </QuickActions>
                </Card>
              );
            })}
          </Grid>
        )}
        <Actions>
          <Button variant="secondary" icon="libraries" onClick={onOpenSettings}>
            Manage libraries
          </Button>
        </Actions>
      </Panel>
    </div>
  );
};
