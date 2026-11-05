import { describe, expect, it } from 'vitest';
import {
  formatTemplateValue,
  formatTokenSnippet,
  parseTemplateSegments,
  renderTemplateExample,
  serializeTemplateSegments,
  templateTokenCatalog,
  tokenQueryAt,
} from '../src/common/organizer';

describe('template tokens', () => {
  it('parses tokens and round-trips them', () => {
    const template = '{show}/Season {season:02}/{tag} - {name}.{ext}';
    const segments = parseTemplateSegments(template);

    expect(segments[0]).toEqual({ kind: 'token', name: 'show' });
    expect(segments[1]).toEqual({ kind: 'text', text: '/Season ' });
    expect(segments[2]).toEqual({
      kind: 'token',
      name: 'season',
      format: '02',
    });
    expect(serializeTemplateSegments(segments)).toBe(template);
  });

  it('treats unknown variables as chips so they can be removed', () => {
    const segments = parseTemplateSegments('{unknown}/{show}');
    expect(segments[0]).toEqual({ kind: 'token', name: 'unknown' });
    const example = renderTemplateExample('{unknown}/{show}', 'tv');
    expect(example.unknownTokens).toEqual(['unknown']);
    expect(example.text).toBe('{unknown}/Blue Planet II');
  });

  it('renders an example line with representative data', () => {
    expect(
      renderTemplateExample('{show} ({seriesYear})/Season {season:02}', 'tv')
        .text,
    ).toBe('Blue Planet II (2017)/Season 01');
    expect(
      renderTemplateExample('{title} ({year}) [{resolution}]', 'movies').text,
    ).toBe('Arrival (2016) [1080p]');
  });

  it('never throws while a template is half-typed', () => {
    expect(() => renderTemplateExample('{sh', 'tv')).not.toThrow();
    expect(renderTemplateExample('{sh', 'tv').text).toBe('{sh');
  });

  it('renders named format variants for air dates', () => {
    expect(
      renderTemplateExample(
        '{airDate}|{airDate:short}|{airDate:year}|{airDate:month}|{airDate:day}|{airDate:compact}|{airDate:dot}',
        'tv',
      ).text,
    ).toBe('2017-10-29|2017-10|2017|10|29|20171029|2017.10.29');
    expect(
      renderTemplateExample('{width}x{height}', 'movies').text,
    ).toBe('1920x1080');
  });

  it('reports unknown format variants', () => {
    const example = renderTemplateExample('{airDate:bogus}', 'tv');
    expect(example.text).toBe('{airDate:bogus}');
    expect(example.unknownTokens).toEqual(['airDate:bogus']);
  });

  it('lists padded and unpadded number variants', () => {
    const seasons = templateTokenCatalog('tv').filter(
      (token) => token.name === 'season',
    );
    expect(seasons.map((token) => token.format)).toEqual([undefined, '02']);
    expect(
      templateTokenCatalog('tv').filter((token) => token.name === 'episodeEnd'),
    ).toHaveLength(2);
  });

  it('has example data for every catalog entry', () => {
    for (const mediaType of ['tv', 'movies'] as const) {
      for (const token of templateTokenCatalog(mediaType)) {
        const snippet = formatTokenSnippet(token.name, token.format);
        expect(renderTemplateExample(snippet, mediaType).unknownTokens).toEqual(
          [],
        );
      }
    }
  });

  it('offers only the tokens for the media type', () => {
    const tv = templateTokenCatalog('tv').map((token) => token.name);
    const movies = templateTokenCatalog('movies').map((token) => token.name);
    expect(tv).toContain('show');
    expect(tv).toContain('tag');
    expect(tv).toContain('airDate');
    expect(tv).not.toContain('imdbId');
    expect(movies).toContain('imdbId');
    expect(movies).toContain('width');
    expect(movies).toContain('height');
    expect(movies).not.toContain('show');
    expect(tv).toContain('ext');
  });

  it('finds the token query at the caret', () => {
    expect(tokenQueryAt('Show {sh', 8)).toEqual({ start: 5, query: 'sh' });
    expect(tokenQueryAt('Show {show}', 11)).toBeUndefined();
    expect(tokenQueryAt('Show {show}/Season', 17)).toBeUndefined();
    expect(tokenQueryAt('Show ', 5)).toBeUndefined();
  });

  it('splits and pads multi-episode ranges', () => {
    expect(formatTemplateValue('episode', undefined, '3-4')).toBe('3-4');
    expect(formatTemplateValue('episode', '02', '3-4')).toBe('03-04');
    expect(formatTemplateValue('episode', '02', '3')).toBe('03');
    expect(formatTemplateValue('episode', 'start', '3-4')).toBe('3');
    expect(formatTemplateValue('episode', 'end', '3-4')).toBe('4');
    expect(formatTemplateValue('episode', 'separator', '3-4')).toBe('-');
    expect(formatTemplateValue('episode', 'end', '3')).toBe('');
    expect(formatTemplateValue('episode', 'separator', '3')).toBe('');
    expect(formatTemplateValue('episode', 'start:02', '3-4')).toBe('03');
    expect(formatTemplateValue('episode', 'end:02', '3-4')).toBe('04');
    expect(
      renderTemplateExample(
        '{episode:start:02}{episode:separator}{episode:end:02}',
        'tv',
      ).text,
    ).toBe('02-03');
  });

  it('parses a variant that also carries a width', () => {
    const segments = parseTemplateSegments(
      'S{season:02}E{episode:start:02}{episode:separator}',
    );
    expect(segments).toContainEqual({
      kind: 'token',
      name: 'episode',
      format: 'start:02',
    });
    expect(serializeTemplateSegments(segments)).toBe(
      'S{season:02}E{episode:start:02}{episode:separator}',
    );
  });

  it('formats snippets with default padding', () => {
    expect(formatTokenSnippet('season', '02')).toBe('{season:02}');
    expect(formatTokenSnippet('show')).toBe('{show}');
  });
});
