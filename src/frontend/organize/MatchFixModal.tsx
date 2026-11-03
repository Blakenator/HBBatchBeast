import React, { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { Alert, Form, Modal, Spinner } from 'react-bootstrap';
import {
  PROMISE_CHANNEL,
  episodeDisplayTag,
  episodeNameText,
  organizerIsPathInside,
  overrideFor,
  parseMediaFilename,
  pathBasename,
  previewTargetForItem,
  rankEpisodes,
  resolveEpisode,
  resolveShowMapping,
  titleComparisonKey,
  type EpisodeMatchSummary,
  type Library,
  type MediaType,
  type OrganizeMatchOverride,
  type OrganizePlanItem,
  type OrganizeSettings,
  type TvdbEpisode,
  type TvdbMovie,
  type TvdbSeriesRef,
} from '../../common';
import { useBackend } from '../helpers';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { MatchBadge } from './MatchBadge';
import { Poster, SeriesSearch } from './SeriesSearch';

const Rows = styled.div`
  display: grid;
  gap: var(--hb-space-xs);
  /* Cards clip their overflow, which zeroes their automatic minimum size;
     without fixed row tracks a scrolling list squashes every card flat. */
  grid-auto-rows: max-content;
  align-content: start;
  max-height: 300px;
  overflow-y: auto;
  padding-right: 2px;
`;

const Card = styled.div<{ $selected: boolean }>`
  display: grid;
  gap: 0;
  min-width: 0;
  border: 1px solid
    ${({ $selected }) =>
      $selected ? 'var(--hb-accent)' : 'var(--hb-border)'};
  border-radius: var(--hb-radius-sm);
  background: ${({ $selected }) =>
    $selected ? 'var(--hb-surfaceMuted)' : 'var(--hb-surface)'};
  overflow: hidden;

  &:hover {
    border-color: var(--hb-accent);
  }
`;

const CardHeader = styled.div`
  display: flex;
  align-items: center;
  gap: var(--hb-space-sm);
  min-width: 0;
  padding: var(--hb-space-xs) var(--hb-space-sm);
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid var(--hb-focus);
    outline-offset: -2px;
  }
`;

const CardBody = styled.div`
  padding: var(--hb-space-xs) var(--hb-space-sm) var(--hb-space-sm);
  border-top: 1px dashed var(--hb-border);
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
  white-space: normal;
  overflow-wrap: anywhere;
`;

const ExpandToggle = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-sm);
  background: transparent;
  color: var(--hb-textMuted);
  cursor: pointer;

  &:hover {
    color: var(--hb-accent);
    border-color: var(--hb-accent);
  }

  &:focus-visible {
    outline: 2px solid var(--hb-focus);
    outline-offset: 1px;
  }
`;

const RowText = styled.span`
  display: grid;
  flex: 1 1 auto;
  gap: 2px;
  min-width: 0;
`;

const Name = styled.span`
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const DescriptionPreview = styled.span<{ $clamped: boolean }>`
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
  white-space: normal;
  overflow-wrap: anywhere;
  display: ${({ $clamped }) => ($clamped ? '-webkit-box' : 'block')};
  -webkit-box-orient: vertical;
  -webkit-line-clamp: ${({ $clamped }) => ($clamped ? 1 : 'none')};
  overflow: hidden;
`;

const Muted = styled.span`
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const FilenamePreview = styled.div`
  padding: var(--hb-space-xs) var(--hb-space-sm);
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-sm);
  background: var(--hb-surfaceMuted);
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
  white-space: normal;
  overflow-wrap: anywhere;

  strong {
    color: var(--hb-text);
    font-weight: 600;
  }
`;

const SelectedMark = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  color: var(--hb-accentContrast);
  background: var(--hb-success);
`;

const Tag = styled.code`
  color: var(--hb-accent);
  font-size: var(--hb-font-xs);
  white-space: nowrap;
`;

interface MatchFixModalProps {
  item: OrganizePlanItem;
  mediaType: MediaType;
  settings: OrganizeSettings;
  library: Library;
  onClose: () => void;
  onSave: (override: OrganizeMatchOverride | undefined) => void;
}

function currentSeries(
  item: OrganizePlanItem,
  settings: OrganizeSettings,
  library: Library,
): TvdbSeriesRef | undefined {
  const caseInsensitive = settings.caseInsensitive ?? false;
  const folder = library.folders.find((candidate) =>
    organizerIsPathInside(item.sourcePath, candidate.source, {
      caseInsensitive,
    }),
  );
  const override = overrideFor(settings, item.sourcePath, caseInsensitive);
  if (override?.series) return override.series;
  if (!folder) return undefined;
  return resolveShowMapping(settings, folder.id, item.sourceRelativePath, {
    caseInsensitive,
  })?.series;
}

/**
 * A search query derived from the file: the parsed title when available,
 * otherwise the file name without its extension.
 */
function fileSearchQuery(item: OrganizePlanItem): string {
  const parsed = item.parsed?.title?.trim();
  if (parsed) return parsed;
  return fileNameQuery(item).replace(/[._]+/g, ' ').trim();
}

/** The literal file name without its extension, for the search shortcut. */
function fileNameQuery(item: OrganizePlanItem): string {
  const name =
    item.sourceRelativePath.split(/[\\/]+/).pop() ??
    item.sourcePath.split(/[\\/]+/).pop() ??
    '';
  return name.replace(/\.[^.]+$/, '').trim();
}

function episodeKey(episode: TvdbEpisode): string {
  return `${episode.seasonNumber}:${episode.episodeNumber}`;
}

function sameEpisode(left: TvdbEpisode, right: TvdbEpisode): boolean {
  if (left.id && right.id) return left.id === right.id;
  return (
    left.seasonNumber === right.seasonNumber &&
    left.episodeNumber === right.episodeNumber
  );
}

interface SelectableRowProps {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description?: string;
  leading?: React.ReactNode;
  badge?: React.ReactNode;
  cover?: React.ReactNode;
}

/**
 * One search result. The checkmark is the primary selection cue; long
 * descriptions clamp to two lines and can be expanded without selecting.
 */
const SelectableRow: React.FC<SelectableRowProps> = ({
  selected,
  onSelect,
  title,
  description,
  leading,
  badge,
  cover,
}) => {
  const [expanded, setExpanded] = useState(false);
  const long = (description?.length ?? 0) > 100;
  return (
    <Card $selected={selected}>
      <CardHeader
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect();
          }
        }}
      >
        {cover}
        {leading}
        <RowText>
          <Name>{title}</Name>
          {badge}
          {description && !expanded && (
            <DescriptionPreview $clamped={long} title={description}>
              {description}
            </DescriptionPreview>
          )}
        </RowText>
        {selected && (
          <SelectedMark role="img" aria-label="Selected">
            <Icon name="passed" size="sm" />
          </SelectedMark>
        )}
        {description && (
          <ExpandToggle
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse description' : 'Expand description'}
            title={expanded ? 'Collapse description' : 'Expand description'}
            onClick={(event) => {
              event.stopPropagation();
              setExpanded((current) => !current);
            }}
          >
            <Icon name={expanded ? 'collapse' : 'expand'} size="xs" />
          </ExpandToggle>
        )}
      </CardHeader>
      {description && expanded && (
        <CardBody
          role="region"
          aria-label="Full description"
          onClick={onSelect}
        >
          {description}
        </CardBody>
      )}
    </Card>
  );
};

/** Search and choose the movie for one file. */
const MoviePicker: React.FC<{
  selected?: TvdbMovie;
  onSelect: (movie: TvdbMovie) => void;
  initialQuery?: string;
}> = ({ selected, onSelect, initialQuery }) => {
  const [query, setQuery] = useState(initialQuery ?? '');
  const [movies, setMovies] = useState<TvdbMovie[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState('');
  const search = useBackend({
    channel: PROMISE_CHANNEL.OrganizeSearchMovies,
    skip: true,
  });

  const run = async (overrideQuery?: string) => {
    const trimmed = (overrideQuery ?? query).trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      const result = await search.refetch({ query: trimmed });
      if (result.error) {
        setError(result.error.message);
        setMovies([]);
        return;
      }
      setMovies(result.data ?? []);
      setSearched(trimmed);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const trimmed = (initialQuery ?? '').trim();
    if (!trimmed) return;
    void run(trimmed);
    // Prefill runs once when the picker opens.
  }, []);

  return (
    <div style={{ display: 'grid', gap: 'var(--hb-space-sm)' }}>
      <div
        style={{ display: 'flex', gap: 'var(--hb-space-xs)', flexWrap: 'wrap' }}
      >
        <Form.Control
          style={{ flex: '1 1 220px', minWidth: 0 }}
          value={query}
          aria-label="Search TVDB for a movie"
          placeholder="Movie title…"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void run();
            }
          }}
        />
        <Button
          compact
          variant="secondary"
          icon="scan"
          onClick={() => void run()}
          disabled={!query.trim() || loading}
        >
          Search
        </Button>
      </div>
      {loading && (
        <Muted role="status" aria-live="polite">
          <Spinner size="sm" animation="border" /> Searching TVDB…
        </Muted>
      )}
      {error && (
        <Alert variant="danger" className="mb-0">
          TVDB search failed: {error}{' '}
          <Button compact variant="ghost" icon="rescan" onClick={() => void run()}>
            Retry
          </Button>
        </Alert>
      )}
      {!loading && !error && searched && movies.length === 0 && (
        <Muted>No movies found for “{searched}”.</Muted>
      )}
      {movies.length > 0 && (
        <Rows role="listbox" aria-label="Movies">
          {movies.map((movie) => (
            <SelectableRow
              key={movie.id}
              selected={selected?.id === movie.id}
              onSelect={() => onSelect(movie)}
              title={`${movie.title}${movie.year ? ` (${movie.year})` : ''}`}
              description={movie.overview}
              cover={<Poster src={movie.image} alt={movie.title} />}
            />
          ))}
        </Rows>
      )}
    </div>
  );
};

/**
 * Fixes one file's match. TV files can change the show and pick an episode;
 * movie files can pick a movie. Saving stores a per-file override.
 */
export const MatchFixModal: React.FC<MatchFixModalProps> = ({
  item,
  mediaType,
  settings,
  library,
  onClose,
  onSave,
}) => {
  const originalSeries = useMemo(
    () => currentSeries(item, settings, library),
    [item, library, settings],
  );
  const [series, setSeries] = useState<TvdbSeriesRef | undefined>(
    originalSeries,
  );
  const effectiveSeries = series ?? originalSeries;
  const [episode, setEpisode] = useState<TvdbEpisode | undefined>(item.episode);
  const [movie, setMovie] = useState<TvdbMovie | undefined>(item.movie);
  const [changingShow, setChangingShow] = useState(!originalSeries);
  const [episodes, setEpisodes] = useState<TvdbEpisode[]>([]);
  // Start on the current season so neighbouring episodes are visible without
  // hiding the rest of the list behind an exact tag match.
  const [episodeFilter, setEpisodeFilter] = useState(() => {
    const season = item.episode?.seasonNumber ?? item.parsed?.seasonNumber;
    return season === undefined ? '' : `S${String(season).padStart(2, '0')}`;
  });
  const [loadError, setLoadError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [movieQuery, setMovieQuery] = useState(fileSearchQuery(item));
  const [movieNonce, setMovieNonce] = useState(0);
  const load = useBackend({
    channel: PROMISE_CHANNEL.OrganizeLoadEpisodes,
    skip: true,
  });
  const fileName = fileNameQuery(item);
  /** Fills the episode filter for TV, or the movie search for movies. */
  const useFileName = () => {
    if (mediaType === 'tv') {
      setEpisodeFilter(fileName);
      return;
    }
    setMovieQuery(fileName);
    setMovieNonce((nonce) => nonce + 1);
  };

  useEffect(() => {
    const slug = effectiveSeries?.slug;
    if (mediaType !== 'tv' || !slug) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(undefined);
    void load
      .refetch({ slug })
      .then((result) => {
        if (cancelled) return;
        if (result.error) {
          setLoadError(result.error.message);
          setEpisodes([]);
          return;
        }
        setEpisodes(result.data ?? []);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Only the slug and media type change what is loaded.
  }, [effectiveSeries?.slug, mediaType]);

  const parsedMedia = useMemo(
    () =>
      item.parsed ??
      parseMediaFilename(fileNameQuery(item), item.sourceRelativePath),
    [item],
  );
  const rankedEpisodes = useMemo(
    () =>
      rankEpisodes(parsedMedia, episodes, episodes.length, {
        seriesName: effectiveSeries?.name,
      }),
    [effectiveSeries?.name, episodes, parsedMedia],
  );
  const matchesByEpisode = useMemo(
    () =>
      new Map(
        rankedEpisodes.map((candidate) => [
          episodeKey(candidate.episode),
          candidate,
        ]),
      ),
    [rankedEpisodes],
  );
  const resolution = useMemo(
    () =>
      resolveEpisode(parsedMedia, episodes, {
        seriesName: effectiveSeries?.name,
      }),
    [effectiveSeries?.name, episodes, parsedMedia],
  );
  const displayEpisodes = useMemo(() => {
    const ranked = rankedEpisodes.map((candidate) => candidate.episode);
    if (!resolution.episode) return ranked;
    return [
      resolution.episode,
      ...ranked.filter(
        (candidate) => !sameEpisode(candidate, resolution.episode!),
      ),
    ];
  }, [rankedEpisodes, resolution.episode]);
  const matchedTitle =
    parsedMedia.episodeTitle ??
    episodeNameText(parsedMedia, effectiveSeries?.name);
  const previewOverride = useMemo<OrganizeMatchOverride | undefined>(() => {
    const selectedSeries = series ?? originalSeries;
    const ready = mediaType === 'tv' ? Boolean(episode) : Boolean(movie);
    if (!ready) return undefined;
    return {
      ...(selectedSeries ? { series: selectedSeries } : {}),
      ...(episode ? { episode } : {}),
      ...(movie ? { movie } : {}),
    };
  }, [episode, mediaType, movie, originalSeries, series]);
  const previewFilename = useMemo(() => {
    if (!previewOverride) return undefined;
    const target = previewTargetForItem(item, previewOverride, {
      settings,
      mediaType,
    });
    return target ? pathBasename(target) : undefined;
  }, [item, mediaType, previewOverride, settings]);

  const filteredEpisodes = useMemo(() => {
    const needle = titleComparisonKey(episodeFilter);
    // Ranked first so the best tag/title evidence stays at the top.
    const source =
      displayEpisodes.length > 0 ? displayEpisodes : episodes;
    if (!needle) return source;
    // A pasted file name usually carries S01E02 (or 1x02); match that episode
    // exactly instead of failing on the surrounding title/quality tokens.
    const tag =
      /s(\d{1,2})[ ._-]*e(\d{1,3})/i.exec(needle) ??
      /(\d{1,2})x(\d{1,3})/i.exec(needle);
    if (tag) {
      const season = Number(tag[1]);
      const episodeNumber = Number(tag[2]);
      return source.filter(
        (candidate) =>
          candidate.seasonNumber === season &&
          candidate.episodeNumber === episodeNumber,
      );
    }
    return source.filter(
      (candidate) =>
        titleComparisonKey(episodeDisplayTag(candidate)).includes(needle) ||
        titleComparisonKey(candidate.name).includes(needle),
    );
  }, [displayEpisodes, episodeFilter, episodes]);

  const save = () => {
    if (!series && !episode && !movie) {
      onSave(undefined);
      return;
    }
    onSave({
      ...(series ? { series } : {}),
      ...(episode ? { episode } : {}),
      ...(movie ? { movie } : {}),
    });
  };

  return (
    <Modal show onHide={onClose} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: 'var(--hb-font-md)' }}>
          Fix match
        </Modal.Title>
      </Modal.Header>
      <Modal.Body style={{ display: 'grid', gap: 'var(--hb-space-md)' }}>
        <div
          style={{
            display: 'flex',
            gap: 'var(--hb-space-sm)',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Muted
            style={{ flex: '1 1 240px', minWidth: 0, whiteSpace: 'normal' }}
            title={item.sourcePath}
          >
            {item.sourceRelativePath || item.sourcePath}
          </Muted>
          <Button
            compact
            variant="ghost"
            icon="copy"
            title={
              mediaType === 'tv'
                ? 'Filter the episode list using the file name, without the extension'
                : 'Search using the file name, without the extension'
            }
            onClick={useFileName}
          >
            Use file name
          </Button>
        </div>

        {mediaType === 'tv' ? (
          <>
            <div
              style={{
                display: 'flex',
                gap: 'var(--hb-space-sm)',
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <Poster
                src={effectiveSeries?.image}
                alt={effectiveSeries?.name ?? 'Show'}
              />
              <div style={{ display: 'grid', gap: 2, flex: 1, minWidth: 0 }}>
                <Name>
                  {effectiveSeries?.name ?? 'No show matched'}
                  {effectiveSeries?.year ? ` (${effectiveSeries.year})` : ''}
                </Name>
                <Muted>Choose the show, then the episode.</Muted>
              </div>
              <Button
                compact
                variant="ghost"
                onClick={() => setChangingShow((current) => !current)}
              >
                {changingShow ? 'Cancel' : 'Change show'}
              </Button>
            </div>

            {changingShow && (
              <SeriesSearch
                id={`fix-show-${item.id}`}
                autoFocus
                selectedSlug={effectiveSeries?.slug}
                initialQuery={fileSearchQuery(item)}
                autoSearch
                onSelect={(next) => {
                  setSeries(next);
                  setEpisode(undefined);
                  setChangingShow(false);
                }}
              />
            )}

            <Form.Group>
              <Form.Label>Find episode</Form.Label>
              <Form.Control
                value={episodeFilter}
                aria-label="Find episode"
                placeholder="S01E02, episode title or file name…"
                onChange={(event) => setEpisodeFilter(event.target.value)}
              />
            </Form.Group>
            {previewFilename && (
              <FilenamePreview>
                New filename: <strong>{previewFilename}</strong>
              </FilenamePreview>
            )}
            {matchedTitle && (
              <Muted style={{ whiteSpace: 'normal' }}>
                Matching filename title: “{matchedTitle}”
              </Muted>
            )}

            {loading ? (
              <Muted role="status" aria-live="polite">
                <Spinner size="sm" animation="border" /> Loading episodes…
              </Muted>
            ) : loadError ? (
              <Alert variant="danger" className="mb-0">
                Could not load episodes: {loadError}
              </Alert>
            ) : (
              <Rows role="listbox" aria-label="Episodes">
                {filteredEpisodes.slice(0, 200).map((candidate) => (
                  <SelectableRow
                    key={`${candidate.id ?? candidate.tag}-${candidate.episodeNumber}`}
                    selected={
                      episode ? sameEpisode(episode, candidate) : false
                    }
                    onSelect={() => setEpisode(candidate)}
                    title={candidate.name}
                    badge={(() => {
                      const match = matchesByEpisode.get(
                        episodeKey(candidate),
                      );
                      if (!match) return undefined;
                      const resolved = Boolean(
                        resolution.episode &&
                          sameEpisode(candidate, resolution.episode),
                      );
                      const summary: EpisodeMatchSummary = resolved
                        ? (resolution.summary ?? {
                            ...match.evidence,
                            conflict: false,
                          })
                        : { ...match.evidence, conflict: false };
                      return (
                        <MatchBadge
                          confidence={
                            resolved ? resolution.confidence : match.confidence
                          }
                          threshold={settings.confidenceThreshold}
                          summary={summary}
                          reason={resolved ? resolution.reason : match.reason}
                          label={episodeDisplayTag(candidate)}
                        />
                      );
                    })()}
                    description={[
                      candidate.description,
                      candidate.airDate ? `Aired ${candidate.airDate}` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    leading={<Tag>{episodeDisplayTag(candidate)}</Tag>}
                  />
                ))}
                {filteredEpisodes.length === 0 && (
                  <Muted>No episode matches “{episodeFilter}”.</Muted>
                )}
              </Rows>
            )}
          </>
        ) : (
          <>
            {movie && (
              <div
                style={{
                  display: 'flex',
                  gap: 'var(--hb-space-sm)',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <Poster src={movie.image} alt={movie.title} />
                <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                  <Name>
                    {movie.title}
                    {movie.year ? ` (${movie.year})` : ''}
                  </Name>
                  <Muted>Current movie match</Muted>
                </div>
              </div>
            )}
            <MoviePicker
              key={`movie-${movieNonce}`}
              selected={movie}
              onSelect={setMovie}
              initialQuery={movieQuery}
            />
            {previewFilename && (
              <FilenamePreview>
                New filename: <strong>{previewFilename}</strong>
              </FilenamePreview>
            )}
          </>
        )}
      </Modal.Body>
      <Modal.Footer style={{ flexWrap: 'wrap', gap: 'var(--hb-space-xs)' }}>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="secondary" onClick={() => onSave(undefined)}>
          Use best guess
        </Button>
        <Button variant="success" icon="passed" onClick={save}>
          Save match
        </Button>
      </Modal.Footer>
    </Modal>
  );
};
