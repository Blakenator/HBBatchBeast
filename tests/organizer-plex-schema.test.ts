import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import {
  loadPlexCatalog,
  readPlexCatalog,
} from '../src/backend/organizer/plex/catalog';

let root: string;
let dbPath: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hbb-plex-schema-'));
  dbPath = path.join(root, 'library.db');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('Plex schema validation', () => {
  it('reports a missing table instead of a raw SQLite error', () => {
    const db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE metadata_items (id INTEGER PRIMARY KEY)');
    db.close();

    expect(() => readPlexCatalog(dbPath)).toThrow(
      /Unsupported Plex database: table "library_sections" is missing/,
    );
  });

  it('reports the first missing column', () => {
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE library_sections (id INTEGER PRIMARY KEY, name TEXT, section_type INTEGER);
      CREATE TABLE section_locations (library_section_id INTEGER, root_path TEXT);
      CREATE TABLE directories (id INTEGER PRIMARY KEY);
    `);
    db.close();

    expect(() => readPlexCatalog(dbPath)).toThrow(
      /Unsupported Plex database schema: directories\./,
    );
  });
});

const PLEX_SCHEMA = `
  CREATE TABLE library_sections (id INTEGER PRIMARY KEY, name TEXT, section_type INTEGER);
  CREATE TABLE section_locations (id INTEGER PRIMARY KEY, library_section_id INTEGER, root_path TEXT);
  CREATE TABLE directories (
    id INTEGER PRIMARY KEY, library_section_id INTEGER, parent_directory_id INTEGER,
    path TEXT, created_at TEXT, deleted_at TEXT, updated_at TEXT
  );
  CREATE TABLE metadata_items (
    id INTEGER PRIMARY KEY, library_section_id INTEGER, parent_id INTEGER,
    metadata_type INTEGER, "index" INTEGER, guid TEXT, title TEXT, year INTEGER,
    originally_available_at TEXT, added_at TEXT
  );
  CREATE TABLE media_items (
    id INTEGER PRIMARY KEY, metadata_item_id INTEGER, width INTEGER, height INTEGER
  );
  CREATE TABLE media_parts (
    id INTEGER PRIMARY KEY, media_item_id INTEGER, file TEXT, directory_id INTEGER,
    deleted_at TEXT, updated_at TEXT
  );
  CREATE TABLE media_streams (
    id INTEGER PRIMARY KEY, stream_type_id INTEGER, media_item_id INTEGER,
    media_part_id INTEGER, url TEXT, updated_at TEXT
  );
  CREATE TABLE metadata_item_settings (
    id INTEGER PRIMARY KEY, account_id INTEGER, guid TEXT, view_count INTEGER,
    view_offset INTEGER, last_viewed_at TEXT, skip_count INTEGER, last_skipped_at TEXT,
    rating REAL, last_rated_at TEXT, created_at TEXT, updated_at TEXT, changed_at INTEGER
  );
  CREATE TABLE metadata_item_views (
    id INTEGER PRIMARY KEY, account_id INTEGER, guid TEXT, grandparent_guid TEXT,
    metadata_type INTEGER, title TEXT, parent_title TEXT, grandparent_title TEXT,
    viewed_at TEXT
  );
`;

describe('Plex catalog loading', () => {
  it('copies the database when the live file cannot be read in place', () => {
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec(PLEX_SCHEMA);
    db.close();

    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hbb-plex-cache-'));
    fs.chmodSync(root, 0o500);
    let result;
    try {
      // A read-only connection still needs to create the WAL shm file.
      expect(() => readPlexCatalog(dbPath)).toThrow();
      result = loadPlexCatalog(dbPath, cacheDir);
    } finally {
      fs.chmodSync(root, 0o700);
    }

    expect(result.error).toBeUndefined();
    expect(result.catalog?.episodes).toEqual([]);
    // The temporary copy is cleaned up again.
    expect(fs.readdirSync(cacheDir)).toEqual([]);
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('reports an unusable database instead of throwing', () => {
    const corrupt = path.join(root, 'corrupt.db');
    fs.writeFileSync(corrupt, 'not a database');
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hbb-plex-cache-'));
    const result = loadPlexCatalog(corrupt, cacheDir);

    expect(result.catalog).toBeUndefined();
    expect(result.error?.message).toBeTruthy();
    expect(fs.readdirSync(cacheDir)).toEqual([]);
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });
});
