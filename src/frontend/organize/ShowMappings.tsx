import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { Alert, Form, Spinner } from 'react-bootstrap';
import {
  PROMISE_CHANNEL,
  applyNameReplacements,
  createShowMappingId,
  findShowMapping,
  guessSeriesQuery,
  normalizeSubpath,
  pathBasename,
  removeShowMapping,
  showMappingsForFolder,
  titleComparisonKey,
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
`;

const FolderControls = styled.div`
  display: flex;
  gap: var(--hb-space-sm);
  align-items: center;
  flex-wrap: wrap;
  margin-left: auto;
`;

const SelectAllLabel = styled.label`
  display: inline-flex;
  gap: var(--hb-space-xs);
  align-items: center;
  font-size: var(--hb-font-xs);
  cursor: pointer;

  .form-check-input {
    margin: 0;
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
  grid-template-columns: auto auto minmax(0, 1fr) auto auto;
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

const Toolbar = styled.div`
  display: grid;
  gap: var(--hb-space-sm);
  padding: var(--hb-space-sm);
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-md);
  background: var(--hb-surfaceMuted);
`;

const ToolbarRow = styled.div`
  display: flex;
  gap: var(--hb-space-sm);
  align-items: center;
  flex-wrap: wrap;
`;

const FilterPills = styled.div`
  display: inline-flex;
  gap: 2px;
  flex-wrap: wrap;
  padding: 2px;
  border: 1px solid var(--hb-border);
  border-radius: 999px;
  background: var(--hb-surface);
`;

const FilterPill = styled.button<{ $active: boolean }>`
  border: 0;
  border-radius: 999px;
  padding: 0 var(--hb-space-md);
  height: 24px;
  font: inherit;
  font-size: var(--hb-font-xs);
  white-space: nowrap;
  cursor: pointer;
  background: ${({ $active }) =>
    $active ? 'var(--hb-accent)' : 'transparent'};
  color: ${({ $active }) =>
    $active ? 'var(--hb-accentContrast)' : 'var(--hb-text)'};

  &:hover:not(:disabled) {
    background: ${({ $active }) =>
      $active ? 'var(--hb-accent)' : 'var(--hb-surfaceMuted)'};
  }

  &:focus-visible {
    outline: 2px solid var(--hb-focus);
    outline-offset: 1px;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const SelectionActions = styled.div`
  display: inline-flex;
  gap: var(--hb-space-xs);
  align-items: center;
  margin-left: auto;
  flex-wrap: wrap;
`;

const ToolbarCount = styled.span`
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
`;

const ScopeSummary = styled.div`
  display: flex;
  gap: var(--hb-space-sm);
  align-items: center;
  flex-wrap: wrap;
  padding: var(--hb-space-xs) var(--hb-space-sm);
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-md);
  background: var(--hb-surface);
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
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

type ShowFilter = 'all' | 'missing' | 'auto' | 'matched';

const SHOW_FILTERS: { value: ShowFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'missing', label: 'Needs matching' },
  { value: 'auto', label: 'Auto-matched' },
  { value: 'matched', label: 'Matched' },
];

/** Display names for the scan scope, capped so the summary stays one line. */
function scopeSummary(scope: OrganizeScanScope[], max = 3): string {
  const names = scope.map((show) => show.name || show.subpath || 'show');
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} +${names.length - max} more`;
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
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ShowFilter>('all');
  const [folderFilter, setFolderFilter] = useState('all');
  const [selectedOnly, setSelectedOnly] = useState(false);

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

  const rowsForFolder = useCallback(
    (folderId: string): MappingRow[] => {
      const folderRows = rows.filter((row) => row.folderId === folderId);
      if (!singleFolders.has(folderId)) {
        return folderRows.filter(
          (row) => normalizeSubpath(row.subpath) !== '',
        );
      }
      const root = folderRows.find(
        (row) => normalizeSubpath(row.subpath) === '',
      );
      const folder = library.folders.find(
        (candidate) => candidate.id === folderId,
      );
      return [
        root ?? {
          folderId,
          subpath: '',
          name: folder ? pathBasename(folder.source) : 'Folder',
          root: folder?.source ?? '',
          series: undefined,
          query: folder
            ? guessSeriesQuery(
                applyNameReplacements(
                  pathBasename(folder.source),
                  settings.nameReplacements,
                ),
              ).query
            : '',
          detected: false,
        },
      ];
    },
    [library.folders, rows, settings.nameReplacements, singleFolders],
  );

  const allRows = useMemo(
    () => library.folders.flatMap((folder) => rowsForFolder(folder.id)),
    [library.folders, rowsForFolder],
  );

  const unmapped = useMemo(
    () => allRows.filter((row) => !row.series),
    [allRows],
  );

  const selectedKeys = useMemo(
    () => new Set(scope.map((show) => rowKey(show.folderId, show.subpath))),
    [scope],
  );

  const needle = search.trim().toLowerCase();
  const normalizedNeedle = titleComparisonKey(search);
  const activeFolderFilter =
    folderFilter === 'all' ||
    library.folders.some((folder) => folder.id === folderFilter)
      ? folderFilter
      : 'all';
  const filtersActive =
    needle.length > 0 ||
    filter !== 'all' ||
    activeFolderFilter !== 'all' ||
    selectedOnly;

  const filterCounts = useMemo(
    () => ({
      all: allRows.length,
      missing: allRows.filter((row) => !row.series).length,
      auto: allRows.filter((row) => row.autoMatched === true).length,
      matched: allRows.filter((row) => row.series && !row.autoMatched).length,
    }),
    [allRows],
  );

  const visibleRowsByFolder = useMemo(() => {
    const result = new Map<string, MappingRow[]>();
    for (const folder of library.folders) {
      if (activeFolderFilter !== 'all' && activeFolderFilter !== folder.id) {
        continue;
      }
      const folderRows = rowsForFolder(folder.id).filter((row) => {
        if (
          selectedOnly &&
          selectedKeys.size > 0 &&
          !selectedKeys.has(rowKey(row.folderId, row.subpath))
        ) {
          return false;
        }
        if (filter === 'missing' && row.series) return false;
        if (filter === 'auto' && row.autoMatched !== true) return false;
        if (filter === 'matched' && (!row.series || row.autoMatched)) {
          return false;
        }
        if (!needle) return true;
        return [row.name, row.subpath, row.series?.name, folder.source]
          .filter(Boolean)
          .some((value) => {
            const text = String(value);
            if (text.toLowerCase().includes(needle)) return true;
            return (
              normalizedNeedle.length > 0 &&
              titleComparisonKey(text).includes(normalizedNeedle)
            );
          });
      });
      result.set(folder.id, folderRows);
    }
    return result;
  }, [
    activeFolderFilter,
    filter,
    library.folders,
    needle,
    normalizedNeedle,
    rowsForFolder,
    selectedKeys,
    selectedOnly,
  ]);

  const visibleRows = useMemo(
    () => [...visibleRowsByFolder.values()].flat(),
    [visibleRowsByFolder],
  );

  const allVisibleSelected =
    visibleRows.length > 0 &&
    visibleRows.every((row) =>
      selectedKeys.has(rowKey(row.folderId, row.subpath)),
    );
  const hiddenSelectedCount = scope.filter(
    (show) =>
      !visibleRows.some(
        (row) =>
          row.folderId === show.folderId &&
          normalizeSubpath(row.subpath) === normalizeSubpath(show.subpath),
      ),
  ).length;

  const selectRows = (targets: MappingRow[], selected: boolean) => {
    const targetKeys = new Set(
      targets.map((row) => rowKey(row.folderId, row.subpath)),
    );
    if (!selected) {
      const remaining = scope.filter(
        (show) => !targetKeys.has(rowKey(show.folderId, show.subpath)),
      );
      if (remaining.length !== scope.length) onScopeChange(remaining);
      return;
    }
    const additions = targets
      .filter(
        (row) => !selectedKeys.has(rowKey(row.folderId, row.subpath)),
      )
      .map((row) => ({
        folderId: row.folderId,
        subpath: row.subpath,
        name: row.name,
      }));
    if (additions.length > 0) onScopeChange([...scope, ...additions]);
  };

  const clearScope = () => {
    onScopeChange([]);
    setSelectedOnly(false);
  };

  const clearFilters = () => {
    setSearch('');
    setFilter('all');
    setFolderFilter('all');
    setSelectedOnly(false);
  };

  useEffect(() => {
    if (scope.length === 0) setSelectedOnly(false);
  }, [scope.length]);

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
      <Toolbar role="group" aria-label="Show list controls">
        <ToolbarRow>
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
              style={{
                color: 'var(--hb-textMuted)',
                fontSize: 'var(--hb-font-xs)',
              }}
            >
              <Spinner size="sm" animation="border" /> Looking for show folders
              and matching TVDB…
            </span>
          )}
          <input
            className="form-control form-control-sm"
            style={{ maxWidth: 260, flex: '1 1 200px' }}
            placeholder="Filter shows by name or series…"
            aria-label="Filter shows by name or series"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            disabled={allRows.length === 0}
          />
          {library.folders.length > 1 && (
            <Form.Select
              size="sm"
              style={{ maxWidth: 240, flex: '0 1 240px' }}
              aria-label="Filter shows by folder"
              value={activeFolderFilter}
              onChange={(event) => setFolderFilter(event.target.value)}
              disabled={allRows.length === 0}
            >
              <option value="all">All folders</option>
              {library.folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {pathBasename(folder.source)}
                </option>
              ))}
            </Form.Select>
          )}
        </ToolbarRow>
        <ToolbarRow>
          <FilterPills role="group" aria-label="Show match filter">
            {SHOW_FILTERS.map((option) => (
              <FilterPill
                key={option.value}
                type="button"
                aria-pressed={filter === option.value}
                $active={filter === option.value}
                onClick={() => setFilter(option.value)}
                disabled={allRows.length === 0}
              >
                {option.label} ({filterCounts[option.value]})
              </FilterPill>
            ))}
          </FilterPills>
          <Form.Check
            id="show-scope-selected-only"
            type="switch"
            label="Selected only"
            checked={selectedOnly}
            disabled={scope.length === 0}
            onChange={(event) => setSelectedOnly(event.target.checked)}
          />
          <SelectionActions>
            <ToolbarCount>
              {visibleRows.length} of {allRows.length} show
              {allRows.length === 1 ? '' : 's'} ·{' '}
              {scope.length === 0
                ? 'scanning the whole library'
                : `${scope.length} selected for the next scan${
                    hiddenSelectedCount > 0
                      ? ` (${hiddenSelectedCount} hidden by filters)`
                      : ''
                  }`}
            </ToolbarCount>
            <Button
              compact
              variant="ghost"
              icon="add"
              onClick={() => selectRows(visibleRows, true)}
              disabled={visibleRows.length === 0 || allVisibleSelected}
            >
              Select all shown
            </Button>
            <Button
              compact
              variant="ghost"
              icon="close"
              onClick={clearScope}
              disabled={scope.length === 0}
            >
              Clear selection
            </Button>
          </SelectionActions>
        </ToolbarRow>
      </Toolbar>

      {scope.length > 0 ? (
        <ScopeSummary role="status" aria-live="polite">
          <span>
            Scanning <strong>{scope.length}</strong> of{' '}
            <strong>{allRows.length}</strong> shows:{' '}
            <strong>{scopeSummary(scope)}</strong>
          </span>
          <Button
            compact
            variant="ghost"
            icon="cancel"
            onClick={clearScope}
          >
            Scan the whole library
          </Button>
        </ScopeSummary>
      ) : (
        <Muted>
          Scan scope: the whole library ({allRows.length} show
          {allRows.length === 1 ? '' : 's'}).
        </Muted>
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
          const allFolderRows = rowsForFolder(folder.id);
          const folderRows = visibleRowsByFolder.get(folder.id) ?? [];
          const folderName = pathBasename(folder.source);
          const single = singleFolders.has(folder.id);
          if (filtersActive && folderRows.length === 0) return null;
          const folderKeys = folderRows.map((row) =>
            rowKey(row.folderId, row.subpath),
          );
          const allFolderSelected =
            folderKeys.length > 0 &&
            folderKeys.every((key) => selectedKeys.has(key));
          const someFolderSelected = folderKeys.some((key) =>
            selectedKeys.has(key),
          );
          return (
            <FolderCard key={folder.id}>
              <FolderHeader>
                <FolderTitle>
                  <FolderName title={folder.source}>{folderName}</FolderName>
                  <Muted title={folder.source}>
                    {folder.source}
                    {allFolderRows.length > 0 && !single
                      ? filtersActive &&
                        folderRows.length !== allFolderRows.length
                        ? ` · ${folderRows.length} of ${allFolderRows.length} shows`
                        : ` · ${allFolderRows.length} show${allFolderRows.length === 1 ? '' : 's'}`
                      : ''}
                  </Muted>
                </FolderTitle>
                <FolderControls>
                  {folderRows.length > 1 && (
                    <SelectAllLabel title="Selects the shows currently visible in this folder">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        aria-label={`Select all visible shows in ${folderName} for the next scan`}
                        checked={allFolderSelected}
                        ref={(element) => {
                          if (element) {
                            element.indeterminate =
                              !allFolderSelected && someFolderSelected;
                          }
                        }}
                        onChange={(event) =>
                          selectRows(folderRows, event.target.checked)
                        }
                      />
                      Select all shown
                    </SelectAllLabel>
                  )}
                  <Form.Check
                    id={`single-show-${folder.id}`}
                    type="switch"
                    label="Whole folder is one show"
                    checked={single}
                    onChange={(event) =>
                      toggleSingleShow(folder.id, event.target.checked)
                    }
                  />
                </FolderControls>
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
                      row.query ??
                      guessSeriesQuery(
                        applyNameReplacements(
                          row.name,
                          settings.nameReplacements,
                        ),
                      ).query;
                    return (
                      <ShowRow key={key}>
                        <ShowHeader>
                          <Form.Check
                            type="checkbox"
                            id={`scan-only-${key}`}
                            aria-label={`Include ${row.name} in the next scan`}
                            title="Include this show in the next scan; the saved match is unchanged"
                            checked={selectedKeys.has(key)}
                            onChange={(event) =>
                              selectRows([row], event.target.checked)
                            }
                          />
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

      {allRows.length > 0 && visibleRows.length === 0 && (
        <Alert variant="info" className="mb-0">
          <div
            style={{
              display: 'flex',
              gap: 'var(--hb-space-sm)',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <span>No shows match the current search and filters.</span>
            <Button
              compact
              variant="ghost"
              icon="reset"
              onClick={clearFilters}
            >
              Clear filters
            </Button>
          </div>
        </Alert>
      )}

      {unmapped.length > 0 && (
        <Alert variant="warning" className="mb-0">
          {unmapped.length} show folder{unmapped.length === 1 ? '' : 's'} still
          need a TVDB series. Files in those folders are skipped.
        </Alert>
      )}
      {warnings.length > 0 && (
        <Alert variant="warning" className="mb-0">
          {warnings.slice(0, 8).map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
          {warnings.length > 8 && (
            <div>{warnings.length - 8} more warning(s) are hidden.</div>
          )}
        </Alert>
      )}
    </Wrap>
  );
};
