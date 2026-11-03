import { describe, expect, it } from 'vitest';
import {
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
      padding: '02',
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

  it('offers only the tokens for the media type', () => {
    const tv = templateTokenCatalog('tv').map((token) => token.name);
    const movies = templateTokenCatalog('movies').map((token) => token.name);
    expect(tv).toContain('show');
    expect(tv).toContain('tag');
    expect(tv).not.toContain('imdbId');
    expect(movies).toContain('imdbId');
    expect(movies).not.toContain('show');
    expect(tv).toContain('ext');
  });

  it('finds the token query at the caret', () => {
    expect(tokenQueryAt('Show {sh', 8)).toEqual({ start: 5, query: 'sh' });
    expect(tokenQueryAt('Show {show}', 11)).toBeUndefined();
    expect(tokenQueryAt('Show {show}/Season', 17)).toBeUndefined();
    expect(tokenQueryAt('Show ', 5)).toBeUndefined();
  });

  it('formats snippets with default padding', () => {
    expect(formatTokenSnippet('season', '02')).toBe('{season:02}');
    expect(formatTokenSnippet('show')).toBe('{show}');
  });
});
