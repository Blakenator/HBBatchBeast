import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import {
  isTmdbShowOrdering,
  parsePlexUserFields,
  plexOrderingWarning,
  plexShowOrdering,
} from '../src/common/organizer/plexOrdering';
import { readPlexLibraryOrdering } from '../src/backend/organizer/plex/catalog';

let root: string;
let dbPath: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hbb-plex-ordering-'));
  dbPath = path.join(root, 'plex.db');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function createLibrarySections(rows: { id: number; name: string; type: number; fields: string }[]) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE library_sections (
      id INTEGER PRIMARY KEY,
      name TEXT,
      section_type INTEGER,
      user_fields TEXT
    );
  `);
  const insert = db.prepare(
    'INSERT INTO library_sections (id, name, section_type, user_fields) VALUES (?, ?, ?, ?)',
  );
  for (const row of rows) insert.run(row.id, row.name, row.type, row.fields);
  db.close();
}

describe('Plex user fields', () => {
  it('parses the JSON form used by the new agent', () => {
    expect(
      plexShowOrdering('{"pr:showOrdering":"tmdbAiring","other":"value"}'),
    ).toBe('tmdbAiring');
  });

  it('parses the URL-encoded form used by older databases', () => {
    expect(
      plexShowOrdering('pr%3AflattenSeasons=2&pr%3AshowOrdering=aired'),
    ).toBe('aired');
    expect(parsePlexUserFields('pr%3AshowOrdering=dvd')).toMatchObject({
      'pr:showOrdering': 'dvd',
    });
  });

  it('returns no fields for empty or malformed values', () => {
    expect(parsePlexUserFields(undefined)).toEqual({});
    expect(parsePlexUserFields('')).toEqual({});
    expect(parsePlexUserFields('{not-json')).toEqual({});
    expect(plexShowOrdering(null)).toBeUndefined();
  });

  it('recognises TMDB orderings only', () => {
    expect(isTmdbShowOrdering('tmdbAiring')).toBe(true);
    expect(isTmdbShowOrdering('tmdbAbsolute')).toBe(true);
    expect(isTmdbShowOrdering('aired')).toBe(false);
    expect(isTmdbShowOrdering(undefined)).toBe(false);
  });
});

describe('readPlexLibraryOrdering', () => {
  it('reads TV library orderings and ignores movie sections', () => {
    createLibrarySections([
      {
        id: 1,
        name: 'Movies',
        type: 1,
        fields: '{"pr:showOrdering":"tmdbAiring"}',
      },
      {
        id: 2,
        name: 'TV Shows',
        type: 2,
        fields: '{"pr:showOrdering":"tmdbAiring"}',
      },
      {
        id: 3,
        name: 'Archive TV',
        type: 2,
        fields: 'pr%3AshowOrdering=aired',
      },
      { id: 4, name: 'No preference', type: 2, fields: '' },
    ]);

    const orderings = readPlexLibraryOrdering(dbPath, root);

    expect(orderings).toEqual([
      { sectionId: 2, name: 'TV Shows', showOrdering: 'tmdbAiring' },
      { sectionId: 3, name: 'Archive TV', showOrdering: 'aired' },
      { sectionId: 4, name: 'No preference' },
    ]);
  });

  it('returns an empty list when the database has no user_fields column', () => {
    const db = new DatabaseSync(dbPath);
    db.exec(
      'CREATE TABLE library_sections (id INTEGER PRIMARY KEY, name TEXT, section_type INTEGER);',
    );
    db.close();

    expect(readPlexLibraryOrdering(dbPath, root)).toEqual([]);
  });

  it('returns an empty list for a missing database', () => {
    expect(readPlexLibraryOrdering(path.join(root, 'missing.db'), root)).toEqual(
      [],
    );
  });
});

describe('plexOrderingWarning', () => {
  it('warns when a TV library uses TMDB ordering', () => {
    const warning = plexOrderingWarning([
      { sectionId: 2, name: 'TV Shows', showOrdering: 'tmdbAiring' },
      { sectionId: 3, name: 'Archive TV', showOrdering: 'aired' },
    ]);

    expect(warning).toContain('"TV Shows"');
    expect(warning).toContain('TMDB episode ordering');
    expect(warning).toContain('TheTVDB (Aired)');
    expect(warning).not.toContain('Archive TV');
  });

  it('does not warn when every TV library uses a TVDB order', () => {
    expect(
      plexOrderingWarning([
        { sectionId: 2, name: 'TV Shows', showOrdering: 'aired' },
        { sectionId: 3, name: 'Archive TV', showOrdering: 'dvd' },
      ]),
    ).toBeUndefined();
    expect(plexOrderingWarning([])).toBeUndefined();
    expect(plexOrderingWarning(undefined)).toBeUndefined();
  });
});
