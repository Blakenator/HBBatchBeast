import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { Alert } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import {
  AppConfigV2,
  Library,
  presetMatchesEncoder,
  validateLibrary,
} from '../../common';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Panel } from '../ui/Panel';
import { homeMessages } from './messages';
import type { HomeMode } from './types';

const Wrap = styled.div`
  display: grid;
  gap: var(--hb-space-lg);
`;

const Heading = styled.h2`
  margin: 0;
  font-size: var(--hb-font-lg);
  font-weight: 600;
`;

const List = styled.div`
  display: grid;
  gap: var(--hb-space-sm);
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--hb-space-md);
  align-items: center;
  padding: var(--hb-space-md);
  background: var(--hb-surface);
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-md);

  @media (max-width: 640px) {
    grid-template-columns: 1fr;
  }
`;

const RowMain = styled.div`
  display: grid;
  gap: var(--hb-space-xs);
  min-width: 0;
`;

const RowHeader = styled.div`
  display: flex;
  align-items: center;
  gap: var(--hb-space-xs);
  flex-wrap: wrap;
  min-width: 0;
`;

const Name = styled.span`
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
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

const Meta = styled.span`
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
`;

const LastUsed = styled.span`
  color: var(--hb-accent);
  font-size: var(--hb-font-xs);
  font-weight: 500;
`;

const Readiness = styled.span<{ $ready: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: var(--hb-space-xs);
  color: ${({ $ready }) =>
    $ready ? 'var(--hb-success)' : 'var(--hb-warning)'};
  font-size: var(--hb-font-xs);
  font-weight: 500;
`;

const RowActions = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--hb-space-xs);
`;

const MenuWrap = styled.div`
  position: relative;
`;

const Menu = styled.div`
  position: absolute;
  top: calc(100% + var(--hb-space-xs));
  right: 0;
  z-index: 10;
  min-width: 200px;
  padding: var(--hb-space-xs);
  background: var(--hb-surface);
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-md);
`;

const MenuItem = styled.button`
  display: flex;
  align-items: center;
  gap: var(--hb-space-xs);
  width: 100%;
  padding: var(--hb-space-sm);
  border: 0;
  border-radius: var(--hb-radius-sm);
  background: transparent;
  color: var(--hb-text);
  font: inherit;
  font-size: var(--hb-font-sm);
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--hb-surfaceMuted);
  }
`;

const OneOff = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hb-space-md);
  flex-wrap: wrap;
  padding: var(--hb-space-md);
  border: 1px dashed var(--hb-border);
  border-radius: var(--hb-radius-md);

  & > div {
    display: grid;
    gap: var(--hb-space-xs);
  }
`;

const OneOffTitle = styled.span`
  font-weight: 600;
`;

const BodyText = styled.p`
  margin: 0;
  color: var(--hb-textMuted);
  font-size: var(--hb-font-sm);
`;

const EmptyActions = styled.div`
  display: flex;
  gap: var(--hb-space-sm);
  flex-wrap: wrap;
  margin-top: var(--hb-space-md);
`;

type ReadinessKind = 'ready' | 'needsFolders' | 'needsPreset' | 'needsSetup';

interface LibraryPickerPageProps {
  mode: HomeMode;
  config: AppConfigV2;
  /** Marks the last-used row; purely visual. */
  selectedLibraryId?: string;
  onStartLibrary: (libraryId: string) => void;
  onQuickStart: () => void;
  onQuickFromLibrary: (library: Library) => void;
  onOpenSettings: () => void;
}

const RowMenu: React.FC<{
  library: Library;
  onQuickCopy: (library: Library) => void;
}> = ({ library, onQuickCopy }) => {
  const { formatMessage } = useIntl();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const label = formatMessage(homeMessages.moreActions, {
    name: library.name || formatMessage(homeMessages.untitledLibrary),
  });

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <MenuWrap ref={wrapRef}>
      <Button
        compact
        variant="ghost"
        icon="chevronDown"
        iconOnly
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      />
      {open && (
        <Menu role="menu" aria-label={label}>
          <MenuItem
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onQuickCopy(library);
            }}
          >
            <Icon name="quick" size="sm" />
            {formatMessage(homeMessages.useOneOffCopy)}
          </MenuItem>
        </Menu>
      )}
    </MenuWrap>
  );
};

const LibraryRow: React.FC<{
  library: Library;
  mode: HomeMode;
  config: AppConfigV2;
  selected: boolean;
  onStart: (libraryId: string) => void;
  onQuickCopy: (library: Library) => void;
}> = ({ library, mode, config, selected, onStart, onQuickCopy }) => {
  const { formatMessage } = useIntl();
  const isConvert = mode === 'convert';

  const folderCount = library.folders.filter(
    (folder) => folder.source.trim() || folder.destination.trim(),
  ).length;
  const sourceFolderCount = library.folders.filter((folder) =>
    folder.source.trim(),
  ).length;
  const compatiblePresets = config.presets.filter((preset) =>
    presetMatchesEncoder(preset, library.encoder),
  );
  const preset = compatiblePresets.find(
    (candidate) => candidate.id === library.defaultPresetId,
  );
  const problems = isConvert
    ? validateLibrary(library, config.presets)
    : [];

  let readiness: ReadinessKind;
  if (isConvert) {
    if (folderCount === 0) readiness = 'needsFolders';
    else if (!preset) readiness = 'needsPreset';
    else if (problems.length > 0) readiness = 'needsSetup';
    else readiness = 'ready';
  } else {
    readiness = sourceFolderCount > 0 ? 'ready' : 'needsFolders';
  }

  const ready = readiness === 'ready';
  const readinessMessage =
    readiness === 'ready'
      ? homeMessages.ready
      : readiness === 'needsFolders'
        ? homeMessages.needsFolders
        : readiness === 'needsPreset'
          ? homeMessages.needsPreset
          : homeMessages.needsSetup;

  const summary = isConvert
    ? [
        formatMessage(homeMessages.folderCount, { count: folderCount }),
        preset?.name ?? formatMessage(homeMessages.noPreset),
        formatMessage(homeMessages.mappingRuleCount, {
          count: library.mappingRules.length,
        }),
      ]
    : [
        formatMessage(homeMessages.folderCount, { count: sourceFolderCount }),
        library.mediaType === 'tv'
          ? formatMessage(homeMessages.showCount, {
              count: library.organize?.tvdb?.shows?.length ?? 0,
            })
          : formatMessage(
              library.organize?.movieMetadata === 'tvdb'
                ? homeMessages.tvdbMetadata
                : homeMessages.plexMetadata,
            ),
      ];

  return (
    <Row>
      <RowMain>
        <RowHeader>
          <Name>
            {library.name || formatMessage(homeMessages.untitledLibrary)}
          </Name>
          <TypeChip>
            {library.mediaType === 'tv'
              ? formatMessage(homeMessages.tv)
              : formatMessage(homeMessages.movies)}
          </TypeChip>
          {selected && (
            <LastUsed>{formatMessage(homeMessages.lastUsed)}</LastUsed>
          )}
        </RowHeader>
        <Meta>{summary.join(' · ')}</Meta>
        <Readiness $ready={ready}>
          <Icon name={ready ? 'statusCompleted' : 'warning'} size="xs" />
          {formatMessage(readinessMessage)}
        </Readiness>
      </RowMain>
      <RowActions>
        <Button
          variant={ready ? 'primary' : 'secondary'}
          onClick={() => onStart(library.id)}
        >
          {formatMessage(ready ? homeMessages.start : homeMessages.reviewSetup)}
        </Button>
        <RowMenu library={library} onQuickCopy={onQuickCopy} />
      </RowActions>
    </Row>
  );
};

export const LibraryPickerPage: React.FC<LibraryPickerPageProps> = ({
  mode,
  config,
  selectedLibraryId,
  onStartLibrary,
  onQuickStart,
  onQuickFromLibrary,
  onOpenSettings,
}) => {
  const { formatMessage } = useIntl();
  const isConvert = mode === 'convert';
  const noPresets = isConvert && config.presets.length === 0;
  const oneOffLabel = isConvert
    ? homeMessages.oneOffConvert
    : homeMessages.oneOffOrganize;

  return (
    <Wrap>
      <Heading>
        {formatMessage(
          isConvert ? homeMessages.chooseConvert : homeMessages.chooseOrganize,
        )}
      </Heading>

      {noPresets && (
        <Alert variant="warning" className="mb-0">
          <strong>{formatMessage(homeMessages.noPresetsTitle)}</strong>
          <div>{formatMessage(homeMessages.noPresetsBody)}</div>
          <Button
            className="mt-2"
            variant="secondary"
            icon="settings"
            onClick={onOpenSettings}
          >
            {formatMessage(homeMessages.openSettings)}
          </Button>
        </Alert>
      )}

      {config.libraries.length === 0 ? (
        <Panel
          title={formatMessage(homeMessages.noLibrariesTitle)}
          icon="libraries"
        >
          <BodyText>{formatMessage(homeMessages.noLibrariesBody)}</BodyText>
          <EmptyActions>
            <Button
              variant={noPresets ? 'secondary' : 'primary'}
              icon={
                noPresets ? 'settings' : isConvert ? 'quick' : 'libraries'
              }
              onClick={noPresets ? onOpenSettings : onQuickStart}
            >
              {formatMessage(noPresets ? homeMessages.openSettings : oneOffLabel)}
            </Button>
            {!noPresets && (
              <Button variant="ghost" icon="settings" onClick={onOpenSettings}>
                {formatMessage(homeMessages.openSettings)}
              </Button>
            )}
          </EmptyActions>
        </Panel>
      ) : (
        <>
          <List>
            {config.libraries.map((library) => (
              <LibraryRow
                key={library.id}
                library={library}
                mode={mode}
                config={config}
                selected={library.id === selectedLibraryId}
                onStart={onStartLibrary}
                onQuickCopy={onQuickFromLibrary}
              />
            ))}
          </List>
          <OneOff>
            <div>
              <OneOffTitle>{formatMessage(homeMessages.oneOffTitle)}</OneOffTitle>
              <Meta>{formatMessage(homeMessages.oneOffHint)}</Meta>
            </div>
            <Button
              variant="secondary"
              icon={isConvert ? 'quick' : 'libraries'}
              onClick={onQuickStart}
              disabled={noPresets}
            >
              {formatMessage(oneOffLabel)}
            </Button>
          </OneOff>
        </>
      )}
    </Wrap>
  );
};
