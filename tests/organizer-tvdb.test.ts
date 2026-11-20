import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  TvdbClient,
  parseTvdbEpisodeHtml,
  parseTvdbEpisodeRuntimeHtml,
  parseRuntimeMinutes,
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
  <small class="text-muted episode-label">SPECIAL 2x7</small>
  <h4 class="list-group-item-heading"><a href="/series/x">Extended Special</a></h4>
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
    expect(episodes).toHaveLength(4);
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
      episodes.find((episode) => episode.tag === 'SPECIAL 2x7'),
    ).toMatchObject({
      seasonNumber: 0,
      episodeNumber: 7,
    });
    expect(
      episodes.find((episode) => episode.tag === 'S01E02')?.name,
    ).toBe('The Deep');
  });

  it('parses year-based season tags such as S1940E07', () => {
    const episodes = parseTvdbEpisodeHtml(`
      <div class="list-group-item">
        <small class="text-muted episode-label">S1929E01</small>
        <h4 class="list-group-item-heading"><a href="/series/x/episodes/1">Bosko the Talk-Ink Kid</a></h4>
      </div>
      <div class="list-group-item">
        <small class="text-muted episode-label">S1940E07</small>
        <h4 class="list-group-item-heading"><a href="/series/x/episodes/2">Elmer&#039;s Candid Camera</a></h4>
      </div>
    `);
    expect(episodes).toHaveLength(2);
    expect(episodes[1]).toMatchObject({
      tag: 'S1940E07',
      name: "Elmer's Candid Camera",
      seasonNumber: 1940,
      episodeNumber: 7,
    });
  });

  it('captures episode ids from the all-seasons anchors', () => {
    const episodes = parseTvdbEpisodeHtml(`
      <div class="list-group-item">
        <small class="text-muted episode-label">S01E01</small>
        <h4 class="list-group-item-heading">
          <a href="/series/blue-planet-ii/episodes/6359665">One Ocean</a>
        </h4>
      </div>
    `);
    expect(episodes[0]?.id).toBe('6359665');
  });

  it('reads the runtime line from an episode page', () => {
    const runtimeHtml = `
      <ul class="list-group">
        <li class="list-group-item clearfix">
          <strong>Originally Aired</strong>
          <span><a href="/on-today/2017-10-29">October 29, 2017</a></span>
        </li>
        <li class="list-group-item clearfix">
          <strong>Runtime</strong>
          <span>58 minutes</span>
        </li>
      </ul>
    `;
    expect(parseTvdbEpisodeRuntimeHtml(runtimeHtml)).toBe(58);
    expect(parseTvdbEpisodeRuntimeHtml('<div>No runtime here</div>')).toBeUndefined();
  });

  it('parses minute and hour runtime strings', () => {
    expect(parseRuntimeMinutes('58 minutes')).toBe(58);
    expect(parseRuntimeMinutes('1 hour 5 minutes')).toBe(65);
    expect(parseRuntimeMinutes('   ')).toBeUndefined();
    expect(parseRuntimeMinutes('0 minutes')).toBeUndefined();
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
    expect(episodes.find((episode) => episode.tag === 'S01E02')).toMatchObject({
      tag: 'S01E02',
      name: 'The Deep',
    });
    await client.loadEpisodes('family-guy');
    expect(calls).toBe(1);
  });

  it('loads and caches episode runtimes', async () => {
    let calls = 0;
    const client = new TvdbClient({
      cacheDir,
      minIntervalMs: 0,
      fetchImpl: async (url) => {
        calls += 1;
        expect(url).toContain('/series/family-guy/episodes/123');
        return new Response(
          `<li class="list-group-item"><strong>Runtime</strong><span>22 minutes</span></li>`,
          { status: 200 },
        );
      },
    });

    const runtimes = await client.loadEpisodeRuntimes('family-guy', [
      '123',
      '123',
    ]);
    expect(runtimes).toEqual({ '123': 22 });
    await client.loadEpisodeRuntimes('family-guy', ['123']);
    expect(calls).toBe(1);
  });

  it('returns no runtime when the episode page has none or fails', async () => {
    const client = new TvdbClient({
      cacheDir,
      minIntervalMs: 0,
      fetchImpl: async () => new Response('<div>no runtime</div>', { status: 200 }),
    });
    await expect(
      client.loadEpisodeRuntimes('family-guy', ['1']),
    ).resolves.toEqual({ '1': undefined });
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

describe('TVDB search batching', () => {
  it('sends multiple queries in one request and maps results by index', async () => {
    const bodies: unknown[] = [];
    const client = new TvdbClient({
      cacheDir,
      minIntervalMs: 0,
      fetchImpl: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            results: [
              { hits: searchPayload.results[0].hits },
              {
                hits: [
                  {
                    primary_type: 'series',
                    id: 2,
                    name: 'Planet Earth',
                    slug: 'planet-earth',
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        );
      },
    });

    const results = await client.searchMany(['family guy', 'planet earth']);

    expect(bodies).toHaveLength(1);
    expect(
      (bodies[0] as { requests: { params: { query: string } }[] }).requests.map(
        (request) => request.params.query,
      ),
    ).toEqual(['family guy', 'planet earth']);
    expect(results[0].series[0]?.name).toBe('Family Guy');
    expect(results[1].series[0]?.name).toBe('Planet Earth');
  });

  it('retries missing batch answers one query at a time', async () => {
    const bodies: { requests: unknown[] }[] = [];
    const client = new TvdbClient({
      cacheDir,
      minIntervalMs: 0,
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as {
          requests: { params: { query: string } }[];
        };
        bodies.push(body);
        const query = body.requests[0]?.params.query;
        return new Response(
          JSON.stringify({
            results: [
              {
                hits:
                  query === 'planet earth'
                    ? [
                        {
                          primary_type: 'series',
                          id: 2,
                          name: 'Planet Earth',
                          slug: 'planet-earth',
                        },
                      ]
                    : searchPayload.results[0].hits,
              },
            ],
          }),
          { status: 200 },
        );
      },
    });

    const results = await client.searchMany(['family guy', 'planet earth']);

    expect(bodies.length).toBeGreaterThan(1);
    expect(results[0].series[0]?.name).toBe('Family Guy');
    expect(results[1].series[0]?.name).toBe('Planet Earth');
  });

  it('deduplicates identical searches that are in flight', async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const client = new TvdbClient({
      cacheDir,
      minIntervalMs: 0,
      fetchImpl: async () => {
        calls += 1;
        await gate;
        return new Response(JSON.stringify(searchPayload), { status: 200 });
      },
    });

    const first = client.search('family guy');
    const second = client.search('family guy');
    release();
    await Promise.all([first, second]);

    expect(calls).toBe(1);
  });
});
