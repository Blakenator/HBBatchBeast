import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import { Alert, Form, Spinner } from 'react-bootstrap';
import {
  PROMISE_CHANNEL,
  createShowMappingId,
  findShowMapping,
  guessSeriesQuery,
  normalizeSubpath,
  pathBasename,
  removeShowMapping,
  showMappingsForFolder,
  upsertShowMapping,
  type DetectedShow,
  type Library,
  type OrganizeScanScope,
  type OrganizeSettings,
  type TvdbSeriesRef,
} from '../../common';
import { useBackend } from '../helpers';
import { Button } from '../ui/Button';
import { Poster, SeriesSearch } from './SeriesSearch';

const Wrap = styled.div`
  display: grid;
  gap: var(--hb-space-sm);
`;

const FolderCard = styled.section`
  display: grid;
  gap: var(--hb-space-sm);
  padding: var(--hb-space-sm);
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-md);
  background: var(--hb-surface);
`;

const FolderHeader = styled.div`
  display: flex;
  gap: var(--hb-space-sm);
  align-items: center;
  flex-wrap: wrap;

  .form-check {
    margin: 0 0 0 auto;
  }
`;

const FolderTitle = styled.div`
  display: grid;
  gap: 2px;
  min-width: 0;
  flex: 1 1 220px;
`;

const FolderName = styled.span`
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Muted = styled.span`
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const RowList = styled.div`
  display: grid;
  gap: var(--hb-space-xs);
`;

const ShowRow = styled.div`
  display: grid;
  gap: 0;
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-sm);
  background: var(--hb-surface);
`;

const ShowHeader = styled.div`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto auto;
  gap: var(--hb-space-sm);
  align-items: center;
  padding: var(--hb-space-xs) var(--hb-space-sm);
`;

const ShowText = styled.div`
  display: grid;
  gap: 2px;
  min-width: 0;
`;

const SearchPanel = styled.div`
  display: grid;
  gap: var(--hb-space-sm);
  padding: var(--hb-space-sm);
  border-top: 1px dashed var(--hb-border);
  background: var(--hb-surfaceMuted);
  border-radius: 0 0 var(--hb-radius-sm) var(--hb-radius-sm);
`;

const Badge = styled.span<{ $tone: 'ok' | 'auto' | 'missing' }>`
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
  padding: 0 var(--hb-space-xs);
  border-radius: 999px;
  font-size: var(--hb-font-xs);
  border: 1px solid
    ${({ $tone }) =>
      $tone === 'missing'
        ? 'var(--hb-warning)'
        : $tone === 'auto'
          ? 'var(--hb-border)'
          : 'var(--hb-success)'};
  color: ${({ $tone }) =>
    $tone === 'missing'
      ? 'var(--hb-warning)'
      : $tone === 'auto'
        ? 'var(--hb-textMuted)'
        : 'var(--hb-success)'};
`;

const Actions = styled.div`
  display: flex;
  gap: var(--hb-space-xs);
  align-items: center;
  flex-wrap: wrap;
`;

interface ShowMappingsProps {
  library: Library;
  settings: OrganizeSettings;
  onSettingsChange: (settings: OrganizeSettings) => void;
  /** Show folders selected for the next scan; empty means the whole library. */
  scope: OrganizeScanScope[];
  onScopeChange: (scope: OrganizeScanScope[]) => void;
}

interface MappingRow {
  folderId: string;
  subpath: string;
  name: string;
  root: string;
  mediaCount?: number;
  series?: TvdbSeriesRef;
  autoMatched?: boolean;
  query?: string;
  candidates?: TvdbSeriesRef[];
  detected: boolean;
}

function rowKey(folderId: string, subpath: string): string {
  return `${folderId}:${normalizeSubpath(subpath)}`;
}

/**
 * Matches the show folders of a library to TVDB series.
 *
 * Each library folder can list its show subfolders, or be declared a single
 * show (useful when the folder is one show or for one-off renames). Matches are
 * persisted on the library.
 */
export const ShowMappings: React.FC<ShowMappingsProps> = ({
  library,
  settings,
  onSettingsChange,
  scope,
  onScopeChange,
}) => {
  const detect = useBackend({
    channel: PROMISE_CHANNEL.OrganizeDetectShows,
    skip: true,
  });
  const [detected, setDetected] = useState<DetectedShow[]>();
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string>();
  const [singleFolders, setSingleFolders] = useState<Set<string>>(
    () =>
      new Set(
        library.folders
          .filter((folder) => findShowMapping(settings, folder.id, ''))
          .map((folder) => folder.id),
      ),
  );

  const rows = useMemo<MappingRow[]>(() => {
    if (detected) {
      const sources = new Map(
        library.folders.map((folder) => [folder.id, folder.source]),
      );
      return detected.map((show) => ({
        folderId: show.folderId,
        subpath: show.subpath,
        name: show.name,
        root: sources.get(show.folderId) ?? show.root,
        mediaCount: show.mediaCount,
        series: show.series,
        autoMatched: show.autoMatched,
        query: show.query,
        candidates: show.candidates,
        detected: true,
      }));
    }
    return library.folders.flatMap((folder) =>
      showMappingsForFolder(settings, folder.id).map((mapping) => ({
        folderId: folder.id,
        subpath: mapping.subpath,
        name: mapping.subpath
          ? (mapping.subpath.split('/').filter(Boolean).pop() ?? mapping.subpath)
          : pathBasename(folder.source),
        root: folder.source,
        series: mapping.series,
        autoMatched: mapping.autoMatched,
        detected: false,
      })),
    );
  }, [detected, library.folders, settings]);

  const rowsForFolder = (folderId: string): MappingRow[] => {
    const folderRows = rows.filter((row) => row.folderId === folderId);
    if (!singleFolders.has(folderId)) {
      return folderRows.filter((row) => normalizeSubpath(row.subpath) !== '');
    }
    const root = folderRows.find((row) => normalizeSubpath(row.subpath) === '');
    const folder = library.folders.find((candidate) => candidate.id === folderId);
    return [
      root ?? {
        folderId,
        subpath: '',
        name: folder ? pathBasename(folder.source) : 'Folder',
        root: folder?.source ?? '',
        series: undefined,
        query: folder ? guessSeriesQuery(pathBasename(folder.source)).query : '',
        detected: false,
      },
    ];
  };

  const unmapped = library.folders.flatMap((folder) =>
    rowsForFolder(folder.id).filter((row) => !row.series),
  );

  const runDetection = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await detect.refetch({
        library: { ...library, organize: settings },
      });
      if (result.error) {
        setError(result.error.message);
        return;
      }
      const folders = result.data?.folders ?? [];
      setDetected(folders);
      setWarnings(result.data?.warnings ?? []);
      if (scope.length > 0) {
        const available = new Set(
          folders.map((show) => rowKey(show.folderId, show.subpath)),
        );
        const pruned = scope.filter((show) =>
          available.has(rowKey(show.folderId, show.subpath)),
        );
        if (pruned.length !== scope.length) onScopeChange(pruned);
      }
      let next = settings;
      for (const show of folders) {
        if (!show.series) continue;
        if (singleFolders.has(show.folderId) && normalizeSubpath(show.subpath) !== '') {
          continue;
        }
        const existing = showMappingsForFolder(next, show.folderId).find(
          (mapping) =>
            normalizeSubpath(mapping.subpath).toLowerCase() ===
            normalizeSubpath(show.subpath).toLowerCase(),
        );
        if (existing) continue;
        next = upsertShowMapping(next, {
          id: createShowMappingId(),
          folderId: show.folderId,
          subpath: show.subpath,
          series: show.series,
          autoMatched: show.autoMatched === true,
        });
      }
      if (next !== settings) onSettingsChange(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const toggleSingleShow = (folderId: string, enabled: boolean) => {
    if (scope.some((show) => show.folderId === folderId)) {
      onScopeChange(scope.filter((show) => show.folderId !== folderId));
    }
    setSingleFolders((current) => {
      const next = new Set(current);
      if (enabled) next.add(folderId);
      else next.delete(folderId);
      return next;
    });
    const mappings = showMappingsForFolder(settings, folderId);
    if (enabled) {
      // Nested matches stay stored; the root mapping wins while this is on.
      setDetected(undefined);
      setExpanded(rowKey(folderId, ''));
      return;
    }
    const root = mappings.find((mapping) => !normalizeSubpath(mapping.subpath));
    if (root) {
      onSettingsChange(removeShowMapping(settings, folderId, ''));
    }
    setDetected(undefined);
    if (expanded === rowKey(folderId, '')) setExpanded(undefined);
  };

  const assign = (row: MappingRow, series: TvdbSeriesRef) => {
    const existing = showMappingsForFolder(settings, row.folderId).find(
      (mapping) =>
        normalizeSubpath(mapping.subpath).toLowerCase() ===
        normalizeSubpath(row.subpath).toLowerCase(),
    );
    const next = upsertShowMapping(settings, {
      id: existing?.id ?? createShowMappingId(),
      folderId: row.folderId,
      subpath: row.subpath,
      series,
    });
    onSettingsChange(next);
    setDetected((current) =>
      current?.map((show) =>
        rowKey(show.folderId, show.subpath) === rowKey(row.folderId, row.subpath)
          ? { ...show, series, autoMatched: false }
          : show,
      ),
    );
    setExpanded(undefined);
  };

  const clear = (row: MappingRow) => {
    onSettingsChange(removeShowMapping(settings, row.folderId, row.subpath));
    setDetected((current) =>
      current?.map((show) =>
        rowKey(show.folderId, show.subpath) === rowKey(row.folderId, row.subpath)
          ? { ...show, series: undefined, autoMatched: false }
          : show,
      ),
    );
  };

  return (
    <Wrap>
      <Actions>
        <Button
          compact
          variant="secondary"
          icon="rescan"
          onClick={() => void runDetection()}
          disabled={busy || library.folders.length === 0}
        >
          {busy ? 'Detecting…' : 'Detect & match shows'}
        </Button>
        {busy && (
          <span
            role="status"
            aria-live="polite"
            style={{ color: 'var(--hb-textMuted)', fontSize: 'var(--hb-font-xs)' }}
          >
            <Spinner size="sm" animation="border" /> Looking for show folders and
            matching TVDB…
          </span>
        )}
      </Actions>

      {scope.length > 0 && (
        <Alert variant="info" className="mb-0">
          <div
            style={{
              display: 'flex',
              gap: 'var(--hb-space-sm)',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <span>
              Scanning only{' '}
              <strong>
                {scope.map((show) => show.name ?? show.subpath).join(', ')}
              </strong>
            </span>
            <Button
              compact
              variant="ghost"
              icon="cancel"
              onClick={() => onScopeChange([])}
            >
              Scan the whole library
            </Button>
          </div>
        </Alert>
      )}

      {error && (
        <Alert variant="danger" className="mb-0">
          Could not detect show folders: {error}
        </Alert>
      )}

      {library.folders.length === 0 ? (
        <Muted>Add a TV library folder above to match its shows.</Muted>
      ) : (
        library.folders.map((folder) => {
          const folderRows = rowsForFolder(folder.id);
          const single = singleFolders.has(folder.id);
          return (
            <FolderCard key={folder.id}>
              <FolderHeader>
                <FolderTitle>
                  <FolderName title={folder.source}>
                    {pathBasename(folder.source)}
                  </FolderName>
                  <Muted title={folder.source}>
                    {folder.source}
                    {folderRows.length > 0 && !single
                      ? ` · ${folderRows.length} show${folderRows.length === 1 ? '' : 's'}`
                      : ''}
                  </Muted>
                </FolderTitle>
                <Form.Check
                  id={`single-show-${folder.id}`}
                  type="switch"
                  label="Whole folder is one show"
                  checked={single}
                  onChange={(event) =>
                    toggleSingleShow(folder.id, event.target.checked)
                  }
                />
              </FolderHeader>

              {folderRows.length === 0 ? (
                <Muted>
                  {single
                    ? 'Choose the show for this folder.'
                    : 'Run “Detect & match shows” to list the show folders here.'}
                </Muted>
              ) : (
                <RowList>
                  {folderRows.map((row) => {
                    const key = rowKey(row.folderId, row.subpath);
                    const open = expanded === key;
                    const query =
                      row.query ?? guessSeriesQuery(row.name).query;
                    return (
                      <ShowRow key={key}>
                        <ShowHeader>
                          <Poster
                            src={row.series?.image}
                            alt={row.series?.name ?? row.name}
                          />
                          <ShowText>
                            <FolderName>{row.name}</FolderName>
                            <Muted>
                              {row.series
                                ? `${row.series.name}${
                                    row.series.year ? ` (${row.series.year})` : ''
                                  }`
                                : 'No TVDB series matched yet'}
                              {row.mediaCount !== undefined
                                ? ` · ${row.mediaCount} file${
                                    row.mediaCount === 1 ? '' : 's'
                                  }`
                                : ''}
                            </Muted>
                          </ShowText>
                          <Badge
                            $tone={
                              !row.series
                                ? 'missing'
                                : row.autoMatched
                                  ? 'auto'
                                  : 'ok'
                            }
                          >
                            {!row.series
                              ? 'Needs matching'
                              : row.autoMatched
                                ? 'Auto-matched'
                                : 'Matched'}
                          </Badge>
                          <Form.Check
                            type="checkbox"
                            id={`scan-only-${key}`}
                            label="Scan only"
                            title="Include this show in the next scan and leave the rest untouched"
                            checked={scope.some(
                              (show) =>
                                show.folderId === row.folderId &&
                                show.subpath === row.subpath,
                            )}
                            onChange={(event) => {
                              const selected = {
                                folderId: row.folderId,
                                subpath: row.subpath,
                                name: row.name,
                              };
                              const without = scope.filter(
                                (show) =>
                                  !(
                                    show.folderId === row.folderId &&
                                    show.subpath === row.subpath
                                  ),
                              );
                              onScopeChange(
                                event.target.checked
                                  ? [...without, selected]
                                  : without,
                              );
                            }}
                          />
                          <Button
                            compact
                            variant="ghost"
                            icon={open ? 'collapse' : 'expand'}
                            aria-expanded={open}
                            aria-controls={`${key}-search`}
                            onClick={() =>
                              setExpanded(open ? undefined : key)
                            }
                          >
                            {open ? 'Hide search' : row.series ? 'Change' : 'Match'}
                          </Button>
                        </ShowHeader>
                        {open && (
                          <SearchPanel id={`${key}-search`}>
                            <SeriesSearch
                              id={`show-search-${key}`}
                              autoFocus
                              selectedSlug={row.series?.slug}
                              initialQuery={query}
                              initialResults={row.candidates}
                              autoSearch
                              onSelect={(series) => assign(row, series)}
                            />
                            {row.series && (
                              <div>
                                <Button
                                  compact
                                  variant="ghost"
                                  icon="delete"
                                  onClick={() => clear(row)}
                                >
                                  Clear match
                                </Button>
                              </div>
                            )}
                          </SearchPanel>
                        )}
                      </ShowRow>
                    );
                  })}
                </RowList>
              )}
            </FolderCard>
          );
        })
      )}

      {unmapped.length > 0 && (
        <Alert variant="warning" className="mb-0">
          {unmapped.length} show folder{unmapped.length === 1 ? '' : 's'} still
          need a TVDB series. Files in those folders are skipped.
        </Alert>
      )}
      {warnings.length > 0 && (
        <Alert variant="warning" className="mb-0">
          {warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </Alert>
      )}
    </Wrap>
  );
};
