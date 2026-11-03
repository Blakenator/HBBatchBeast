import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  TvdbClient,
  parseTvdbEpisodeHtml,
} from '../src/backend/organizer/tvdb/client';

const searchPayload = {
  results: [
    {
      hits: [
        {
          primary_type: 'series',
          id: 75978,
          tvdb_id: '75978',
          name: 'Family Guy',
          slug: 'family-guy',
          release_year: 1995,
          image: 'https://example.test/family.jpg',
        },
        {
          primary_type: 'movie',
          id: 5271,
          name: 'Speed Racer',
          slug: 'speed-racer',
          release_year: 2008,
          overview: 'A movie',
          image: 'https://example.test/speed.jpg',
          remote_ids: [
            { id: 'tt0811080', sourceName: 'IMDB', type: 2 },
            { id: '7459', sourceName: 'TheMovieDB.com', type: 10 },
          ],
        },
        { primary_type: 'list', id: 1, name: 'Ignored', slug: 'ignored' },
      ],
    },
  ],
};

const episodeHtml = `
<div class="list-group-item">
  <small class="text-muted episode-label">S01E01</small>
  <h4 class="list-group-item-heading"><a href="/series/x">One Ocean</a></h4>
  <div class="list-group-item-text"><p>First episode</p></div>
</div>
<div class="list-group-item">
  <small class="text-muted episode-label">SPECIAL 0x1</small>
  <h4 class="list-group-item-heading"><a href="/series/x">Behind the Scenes</a></h4>
</div>
<div class="list-group-item">
  <small class="text-muted episode-label">S01E02</small>
  <h4 class="list-group-item-heading"><a href="/series/x">The Deep</a></h4>
</div>
`;

let cacheDir: string;

beforeEach(() => {
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hbb-tvdb-'));
});

afterEach(() => {
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

describe('TVDB parsing', () => {
  it('parses episode tags, specials and names', () => {
    const episodes = parseTvdbEpisodeHtml(episodeHtml);
    expect(episodes).toHaveLength(3);
    expect(
      episodes.find((episode) => episode.tag === 'S01E01'),
    ).toMatchObject({
      name: 'One Ocean',
      seasonNumber: 1,
      episodeNumber: 1,
    });
    expect(
      episodes.find((episode) => episode.tag === 'SPECIAL 0x1'),
    ).toMatchObject({
      seasonNumber: 0,
      episodeNumber: 1,
    });
    expect(
      episodes.find((episode) => episode.tag === 'S01E02')?.name,
    ).toBe('The Deep');
  });
});

describe('TVDB client', () => {
  it('searches series and movies and caches the result', async () => {
    let calls = 0;
    const client = new TvdbClient({
      cacheDir,
      minIntervalMs: 0,
      fetchImpl: async (url) => {
        calls += 1;
        expect(url).toBe('https://api4.thetvdb.com/web/search/queries');
        return new Response(JSON.stringify(searchPayload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    const result = await client.search('family guy');
    expect(result.series[0]).toMatchObject({
      id: '75978',
      slug: 'family-guy',
      name: 'Family Guy',
      year: 1995,
    });
    expect(result.movies[0]).toMatchObject({
      id: '5271',
      slug: 'speed-racer',
      title: 'Speed Racer',
      year: 2008,
      imdbId: 'tt0811080',
      tmdbId: '7459',
    });
    await client.search('family guy');
    expect(calls).toBe(1);
  });

  it('sends no referrer, which Chromium would reject as cross-origin', async () => {
    let headers: Record<string, string> = {};
    const client = new TvdbClient({
      cacheDir,
      minIntervalMs: 0,
      fetchImpl: async (_url, init) => {
        headers = { ...(init?.headers as Record<string, string>) };
        return new Response(JSON.stringify(searchPayload), { status: 200 });
      },
    });

    await client.search('family guy');

    expect(headers).not.toHaveProperty('referer');
    expect(headers).not.toHaveProperty('Referer');
    expect(headers).not.toHaveProperty('origin');
    expect(headers['content-type']).toBe('application/json');
  });

  it('reports a transport failure with the request URL', async () => {
    const client = new TvdbClient({
      cacheDir,
      minIntervalMs: 0,
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
    });

    await expect(client.search('family guy')).rejects.toThrow(
      /TVDB request failed \(https:\/\/api4\.thetvdb\.com\/web\/search\/queries\): Failed to fetch/,
    );
  });

  it('loads and caches the all-seasons page', async () => {
    let calls = 0;
    const client = new TvdbClient({
      cacheDir,
      minIntervalMs: 0,
      fetchImpl: async (url) => {
        calls += 1;
        expect(url).toContain('/series/family-guy/allseasons/official');
        return new Response(episodeHtml, { status: 200 });
      },
    });

    const episodes = await client.loadEpisodes('family-guy');
    expect(episodes[2]).toMatchObject({
      tag: 'S01E02',
      name: 'The Deep',
    });
    await client.loadEpisodes('family-guy');
    expect(calls).toBe(1);
  });

  it('surfaces non-2xx responses', async () => {
    const client = new TvdbClient({
      cacheDir,
      minIntervalMs: 0,
      fetchImpl: async () => new Response('nope', { status: 503 }),
    });
    await expect(client.loadEpisodes('x')).rejects.toThrow(/503/);
  });
});
