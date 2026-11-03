import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { readPlexCatalog } from '../src/backend/organizer/plex/catalog';

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
