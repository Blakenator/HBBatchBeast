import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { Alert, Form, Spinner } from 'react-bootstrap';
import {
  PROMISE_CHANNEL,
  type TvdbSeriesRef,
} from '../../common';
import { useBackend } from '../helpers';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

export const CoverThumb = styled.span<{ $width: number }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: ${({ $width }) => `${$width}px`};
  height: ${({ $width }) => `${Math.round($width * 1.5)}px`};
  border-radius: var(--hb-radius-sm);
  background: var(--hb-surfaceMuted);
  color: var(--hb-textMuted);
  overflow: hidden;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
`;

interface PosterProps {
  src?: string;
  alt: string;
  /** Width in px; the height is 1.5× the width. */
  width?: number;
}

/** Small cover art with a placeholder when the URL is missing or fails. */
export const Poster: React.FC<PosterProps> = ({ src, alt, width = 40 }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) {
    return (
      <CoverThumb $width={width} role="img" aria-label={`${alt} (no artwork)`}>
        <Icon name="encoding" size="sm" />
      </CoverThumb>
    );
  }
  return (
    <CoverThumb $width={width}>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </CoverThumb>
  );
};

const Results = styled.div`
  display: grid;
  gap: var(--hb-space-xs);
  max-height: 320px;
  overflow-y: auto;
`;

const ResultRow = styled.button<{ $selected: boolean }>`
  display: flex;
  align-items: center;
  gap: var(--hb-space-sm);
  width: 100%;
  min-width: 0;
  padding: var(--hb-space-xs) var(--hb-space-sm);
  border: 1px solid
    ${({ $selected }) =>
      $selected ? 'var(--hb-accent)' : 'var(--hb-border)'};
  border-radius: var(--hb-radius-sm);
  background: ${({ $selected }) =>
    $selected ? 'var(--hb-surfaceMuted)' : 'var(--hb-surface)'};
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:hover {
    border-color: var(--hb-accent);
  }

  &:focus-visible {
    outline: 2px solid var(--hb-focus);
    outline-offset: 1px;
  }
`;

const ResultText = styled.span`
  display: grid;
  gap: 2px;
  min-width: 0;
`;

const ResultName = styled.span`
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Muted = styled.span`
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
`;

interface SeriesSearchProps {
  id: string;
  onSelect: (series: TvdbSeriesRef) => void;
  /** Series already used for the folder, shown as selected. */
  selectedSlug?: string;
  autoFocus?: boolean;
  label?: string;
  placeholder?: string;
  /** Prefills the query with the folder name. */
  initialQuery?: string;
  /** Results already fetched (for example by the failed auto-match). */
  initialResults?: TvdbSeriesRef[];
  /** Runs the prefilled query once when there are no initial results. */
  autoSearch?: boolean;
}

/**
 * TVDB series search with cover art, a loading spinner and inline failures.
 * Used both for show-folder matching and for fixing a single file's match.
 */
export const SeriesSearch: React.FC<SeriesSearchProps> = ({
  id,
  onSelect,
  selectedSlug,
  autoFocus,
  label = 'Search TVDB for a series',
  placeholder = 'Series name…',
  initialQuery,
  initialResults,
  autoSearch = false,
}) => {
  const [query, setQuery] = useState(initialQuery ?? '');
  const [results, setResults] = useState<TvdbSeriesRef[]>(initialResults ?? []);
  const [searched, setSearched] = useState(
    initialResults && initialResults.length > 0 ? (initialQuery ?? '') : '',
  );
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const search = useBackend({
    channel: PROMISE_CHANNEL.OrganizeSearchSeries,
    skip: true,
  });

  const runSearch = async (overrideQuery?: string) => {
    const trimmed = (overrideQuery ?? query).trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      const result = await search.refetch({ query: trimmed });
      if (result.error) {
        setError(result.error.message);
        setResults([]);
        return;
      }
      setResults(result.data ?? []);
      setSearched(trimmed);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!autoSearch) return;
    const trimmed = (initialQuery ?? '').trim();
    if (!trimmed || (initialResults && initialResults.length > 0)) return;
    void runSearch(trimmed);
    // Only the opening query matters; later edits are explicit searches.
  }, []);

  return (
    <div style={{ display: 'grid', gap: 'var(--hb-space-sm)' }}>
      <div style={{ display: 'flex', gap: 'var(--hb-space-xs)' }}>
        <Form.Control
          id={id}
          value={query}
          autoFocus={autoFocus}
          placeholder={placeholder}
          aria-label={label}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void runSearch();
            }
          }}
        />
        <Button
          compact
          variant="secondary"
          icon="scan"
          onClick={() => void runSearch()}
          disabled={!query.trim() || loading}
        >
          {loading ? 'Searching…' : 'Search'}
        </Button>
      </div>

      {loading && (
        <Muted role="status" aria-live="polite">
          <Spinner size="sm" animation="border" /> Searching TVDB for “{query.trim()}”…
        </Muted>
      )}

      {error && (
        <Alert
          variant="danger"
          className="mb-0"
          style={{ fontSize: 'var(--hb-font-xs)' }}
        >
          <div>TVDB search failed: {error}</div>
          <Button
            compact
            variant="ghost"
            icon="rescan"
            onClick={() => void runSearch()}
          >
            Retry
          </Button>
        </Alert>
      )}

      {!loading && !error && searched && results.length === 0 && (
        <Muted>No shows found for “{searched}”. Try the year or original title.</Muted>
      )}

      {results.length > 0 && (
        <Results role="list">
          {results.map((series) => (
            <ResultRow
              key={`${series.id}-${series.slug}`}
              type="button"
              role="listitem"
              $selected={selectedSlug === series.slug}
              onClick={() => onSelect(series)}
            >
              <Poster src={series.image} alt={series.name} width={40} />
              <ResultText>
                <ResultName>{series.name}</ResultName>
                <Muted>
                  {series.year ? `${series.year} · ` : ''}
                  {selectedSlug === series.slug ? 'Selected' : 'Choose'}
                </Muted>
              </ResultText>
              {selectedSlug === series.slug && (
                <span
                  aria-label="Selected"
                  style={{ color: 'var(--hb-success)', flex: '0 0 auto' }}
                >
                  <Icon name="passed" size="sm" />
                </span>
              )}
            </ResultRow>
          ))}
        </Results>
      )}
    </div>
  );
};
