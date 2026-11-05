import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { parseHTML } from 'linkedom';
import type {
  TvdbEpisode,
  TvdbMovie,
  TvdbSeriesRef,
} from '../../../common/organizer/types';

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

const SEARCH_URL = 'https://api4.thetvdb.com/web/search/queries';
const SERIES_PAGE = 'https://www.thetvdb.com/series';
const USER_AGENT =
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0';
const SEARCH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EPISODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SEARCH_BATCH_SIZE = 8;
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_MAX_FILES = 6000;
const CACHE_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface CacheEnvelope<T> {
  fetchedAt: number;
  value: T;
}

interface SearchHit {
  [key: string]: unknown;
}

interface SearchResponse {
  results?: { hits?: SearchHit[] }[];
}

export interface TvdbSearchResult {
  series: TvdbSeriesRef[];
  movies: TvdbMovie[];
}

export interface TvdbClientOptions {
  cacheDir: string;
  fetchImpl?: FetchLike;
  now?: () => number;
  minIntervalMs?: number;
  searchTtlMs?: number;
  episodeTtlMs?: number;
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function asNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function remoteId(hit: SearchHit, source: string): string | undefined {
  const remote = Array.isArray(hit.remote_ids) ? hit.remote_ids : [];
  const match = remote.find(
    (entry) =>
      Boolean(entry) &&
      typeof entry === 'object' &&
      asString((entry as { sourceName?: unknown }).sourceName) === source,
  ) as { id?: unknown } | undefined;
  return asString(match?.id) || undefined;
}

function seriesFromHit(hit: SearchHit): TvdbSeriesRef | undefined {
  const type = asString(hit.primary_type) || asString(hit.type);
  if (type !== 'series') return undefined;
  const id = asString(hit.id) || asString(hit.tvdb_id);
  const name = asString(hit.name);
  const slug = asString(hit.slug);
  if (!id || !name || !slug) return undefined;
  return {
    id,
    slug,
    name,
    ...(asNumber(hit.release_year ?? hit.year)
      ? { year: asNumber(hit.release_year ?? hit.year) }
      : {}),
    ...(asString(hit.image ?? hit.image_url)
      ? { image: asString(hit.image ?? hit.image_url) }
      : {}),
  };
}

function movieFromHit(hit: SearchHit): TvdbMovie | undefined {
  const type = asString(hit.primary_type) || asString(hit.type);
  if (type !== 'movie') return undefined;
  const id = asString(hit.id) || asString(hit.tvdb_id);
  const title = asString(hit.name);
  const slug = asString(hit.slug);
  if (!id || !title || !slug) return undefined;
  return {
    id,
    slug,
    title,
    ...(asNumber(hit.release_year ?? hit.year)
      ? { year: asNumber(hit.release_year ?? hit.year) }
      : {}),
    ...(asString(hit.overview) ? { overview: asString(hit.overview) } : {}),
    ...(asString(hit.image ?? hit.image_url)
      ? { image: asString(hit.image ?? hit.image_url) }
      : {}),
    ...(remoteId(hit, 'IMDB') ? { imdbId: remoteId(hit, 'IMDB') } : {}),
    ...(remoteId(hit, 'TheMovieDB.com')
      ? { tmdbId: remoteId(hit, 'TheMovieDB.com') }
      : {}),
  };
}

function resultFromHits(hits: SearchHit[]): TvdbSearchResult {
  const series = hits
    .map(seriesFromHit)
    .filter((item): item is TvdbSeriesRef => Boolean(item));
  const movies = hits
    .map(movieFromHit)
    .filter((item): item is TvdbMovie => Boolean(item));
  return { series, movies };
}

function emptySearchResult(): TvdbSearchResult {
  return { series: [], movies: [] };
}

function parseEpisodeTag(
  tag: string,
): { seasonNumber: number; episodeNumber: number } | undefined {
  const standard = /\bS(\d{1,2})E(\d{1,3})\b/i.exec(tag);
  if (standard) {
    return {
      seasonNumber: Number(standard[1]),
      episodeNumber: Number(standard[2]),
    };
  }
  const special = /\bSPECIAL\s+(\d{1,2})x(\d{1,3})\b/i.exec(tag);
  if (special) {
    return {
      seasonNumber: 0,
      episodeNumber: Number(special[2]),
    };
  }
  const crossed = /\b(\d{1,2})x(\d{1,3})\b/.exec(tag);
  if (crossed) {
    return {
      seasonNumber: Number(crossed[1]),
      episodeNumber: Number(crossed[2]),
    };
  }
  return undefined;
}

export function parseTvdbEpisodeHtml(html: string): TvdbEpisode[] {
  const { document } = parseHTML(html);
  const rows = [...document.querySelectorAll('.list-group-item')];
  const episodes: TvdbEpisode[] = [];
  for (const row of rows) {
    const tag = row.querySelector('.episode-label')?.textContent?.trim() ?? '';
    const parsed = parseEpisodeTag(tag);
    if (!parsed) continue;
    const heading =
      row.querySelector('.list-group-item-heading a')?.textContent ??
      row.querySelector('.list-group-item-heading')?.textContent ??
      '';
    const name = heading.trim();
    if (!name) continue;
    const description =
      row.querySelector('.list-group-item-text p')?.textContent?.trim() ?? '';
    episodes.push({
      tag,
      name,
      ...(description ? { description } : {}),
      seasonNumber: parsed.seasonNumber,
      episodeNumber: parsed.episodeNumber,
    });
  }
  return episodes.sort(
    (left, right) =>
      left.seasonNumber - right.seasonNumber ||
      left.episodeNumber - right.episodeNumber,
  );
}

/**
 * Keyless TVDB client. Search uses the same endpoint as the TVDB website; the
 * episode list is scraped from its public all-seasons page. Responses are cached
 * on disk to keep request volume low.
 */
export class TvdbClient {
  private readonly cacheDir: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly minIntervalMs: number;
  private readonly searchTtlMs: number;
  private readonly episodeTtlMs: number;
  private lastRequestAt = 0;
  private rateGate: Promise<void> = Promise.resolve();
  private readonly searchRequests = new Map<string, Promise<TvdbSearchResult>>();
  private readonly episodeRequests = new Map<string, Promise<TvdbEpisode[]>>();
  private lastPruneAt = 0;

  constructor(options: TvdbClientOptions) {
    this.cacheDir = options.cacheDir;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? (() => Date.now());
    this.minIntervalMs = options.minIntervalMs ?? 250;
    this.searchTtlMs = options.searchTtlMs ?? SEARCH_TTL_MS;
    this.episodeTtlMs = options.episodeTtlMs ?? EPISODE_TTL_MS;
  }

  private cachePath(key: string): string {
    const hash = crypto.createHash('sha1').update(key).digest('hex');
    return path.join(this.cacheDir, 'tvdb', `${hash}.json`);
  }

  private readCache<T>(key: string, ttlMs: number): T | undefined {
    try {
      const file = this.cachePath(key);
      if (!fs.existsSync(file)) return undefined;
      const parsed = JSON.parse(
        fs.readFileSync(file, 'utf8'),
      ) as CacheEnvelope<T>;
      if (!parsed || typeof parsed.fetchedAt !== 'number') return undefined;
      if (this.now() - parsed.fetchedAt > ttlMs) return undefined;
      return parsed.value;
    } catch {
      return undefined;
    }
  }

  private writeCache<T>(key: string, value: T): void {
    try {
      const file = this.cachePath(key);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const envelope: CacheEnvelope<T> = {
        fetchedAt: this.now(),
        value,
      };
      fs.writeFileSync(file, JSON.stringify(envelope), 'utf8');
      this.pruneCache();
    } catch {
      // A cache failure must never block a lookup.
    }
  }

  /** Drops stale cache files and caps the cache size; runs at most daily. */
  private pruneCache(): void {
    const now = this.now();
    if (now - this.lastPruneAt < CACHE_PRUNE_INTERVAL_MS) return;
    this.lastPruneAt = now;
    const directory = path.join(this.cacheDir, 'tvdb');
    try {
      const entries = fs.readdirSync(directory, { withFileTypes: true });
      const files = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => {
          const file = path.join(directory, entry.name);
          try {
            const stat = fs.statSync(file);
            return { file, modified: stat.mtimeMs, size: stat.size };
          } catch {
            return undefined;
          }
        })
        .filter((entry): entry is { file: string; modified: number; size: number } =>
          Boolean(entry),
        )
        .sort((left, right) => left.modified - right.modified);
      const excess = Math.max(0, files.length - CACHE_MAX_FILES);
      for (const [index, entry] of files.entries()) {
        if (index < excess || now - entry.modified > CACHE_MAX_AGE_MS) {
          try {
            fs.rmSync(entry.file, { force: true });
          } catch {
            // Pruning is best-effort.
          }
        }
      }
    } catch {
      // A missing cache directory is fine.
    }
  }

  private async waitForRateLimit(): Promise<void> {
    const previous = this.rateGate;
    let release!: () => void;
    this.rateGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const elapsed = this.now() - this.lastRequestAt;
      if (elapsed < this.minIntervalMs) {
        await new Promise((resolve) =>
          setTimeout(resolve, this.minIntervalMs - elapsed),
        );
      }
      this.lastRequestAt = this.now();
    } finally {
      release();
    }
  }

  private async request(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    await this.waitForRateLimit();
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw new Error(
        `TVDB request failed (${url}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new Error(`TVDB request failed (${response.status} ${url})`);
    }
    return response;
  }

  private async fetchSearchBatch(
    queries: string[],
  ): Promise<TvdbSearchResult[]> {
    if (queries.length === 0) return [];
    // No `referer` header: Chromium (Electron's `net.fetch`) cancels a request
    // whose referrer is a different origin than the target, and the endpoint
    // answers fine without one.
    const response = await this.request(SEARCH_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': USER_AGENT,
      },
      body: JSON.stringify({
        requests: queries.map((query) => ({
          indexName: 'TVDB',
          params: { query, page: 0 },
        })),
      }),
    });
    const payload = (await response.json()) as SearchResponse;
    const results = queries.map((_, index) =>
      resultFromHits(payload.results?.[index]?.hits ?? []),
    );
    const returned = payload.results?.length ?? 0;
    // Some deployments only answer the first request in a batch.
    if (queries.length > 1 && returned < queries.length) {
      for (let index = Math.max(1, returned); index < queries.length; index += 1) {
        const fallback = await this.fetchSearchBatch([queries[index]]);
        results[index] = fallback[0] ?? emptySearchResult();
      }
    }
    return results;
  }

  async searchMany(queries: string[]): Promise<TvdbSearchResult[]> {
    const trimmed = queries.map((query) => query.trim());
    const results: (TvdbSearchResult | undefined)[] = new Array(trimmed.length);
    const missing = new Map<string, { query: string; indices: number[] }>();
    for (const [index, query] of trimmed.entries()) {
      if (!query) {
        results[index] = emptySearchResult();
        continue;
      }
      const key = query.toLowerCase();
      const cached = this.readCache<TvdbSearchResult>(
        `search:${key}`,
        this.searchTtlMs,
      );
      if (cached) {
        results[index] = cached;
        continue;
      }
      const entry = missing.get(key) ?? { query, indices: [] };
      entry.indices.push(index);
      missing.set(key, entry);
    }

    const pending: { key: string; entry: { query: string; indices: number[] }; promise: Promise<TvdbSearchResult> }[] = [];
    const batches: { key: string; entry: { query: string; indices: number[] } }[] = [];
    for (const [key, entry] of missing) {
      const existing = this.searchRequests.get(key);
      if (existing) pending.push({ key, entry, promise: existing });
      else batches.push({ key, entry });
    }
    for (const { entry, promise } of pending) {
      const result = await promise.catch(() => emptySearchResult());
      for (const index of entry.indices) results[index] = result;
    }

    for (let start = 0; start < batches.length; start += SEARCH_BATCH_SIZE) {
      const chunk = batches.slice(start, start + SEARCH_BATCH_SIZE);
      const batchPromise = this.fetchSearchBatch(
        chunk.map(({ entry }) => entry.query),
      );
      for (const [index, { key }] of chunk.entries()) {
        const perQuery = batchPromise.then(
          (batch) => batch[index] ?? emptySearchResult(),
        );
        this.searchRequests.set(key, perQuery);
        void perQuery.then(
          () => this.searchRequests.delete(key),
          () => this.searchRequests.delete(key),
        );
      }
      const batch = await batchPromise;
      for (const [index, { key, entry }] of chunk.entries()) {
        const result = batch[index] ?? emptySearchResult();
        this.writeCache(`search:${key}`, result);
        for (const resultIndex of entry.indices) results[resultIndex] = result;
      }
    }

    return results.map((result) => result ?? emptySearchResult());
  }

  async search(query: string): Promise<TvdbSearchResult> {
    const [result] = await this.searchMany([query]);
    return result ?? emptySearchResult();
  }

  async searchSeries(query: string): Promise<TvdbSeriesRef[]> {
    return (await this.search(query)).series;
  }

  async searchMovies(query: string): Promise<TvdbMovie[]> {
    return (await this.search(query)).movies;
  }

  async loadEpisodes(slug: string): Promise<TvdbEpisode[]> {
    const trimmed = slug.trim();
    if (!trimmed) return [];
    const cacheKey = `episodes:${trimmed.toLowerCase()}`;
    const cached = this.readCache<TvdbEpisode[]>(cacheKey, this.episodeTtlMs);
    if (cached) return cached;
    const existing = this.episodeRequests.get(cacheKey);
    if (existing) return existing;
    const promise = this.fetchEpisodes(trimmed, cacheKey);
    this.episodeRequests.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      this.episodeRequests.delete(cacheKey);
    }
  }

  private async fetchEpisodes(
    slug: string,
    cacheKey: string,
  ): Promise<TvdbEpisode[]> {
    const response = await this.request(
      `${SERIES_PAGE}/${encodeURIComponent(slug)}/allseasons/official`,
      {
        method: 'GET',
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml',
        },
      },
    );
    const episodes = parseTvdbEpisodeHtml(await response.text());
    this.writeCache(cacheKey, episodes);
    return episodes;
  }
}
