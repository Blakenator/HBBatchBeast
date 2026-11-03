import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import type {
  OrganizePlan,
  OrganizePlanItem,
  PlexAssociation,
} from '../../../common/organizer/types';
import { organizerComparisonKey } from '../../../common/organizer/paths';
import {
  findEpisodeGuid,
  readPlexCatalog,
  type PlexCatalog,
} from './catalog';

export interface PlexUpdateOptions {
  dbPath: string;
  backupDir: string;
  pendingPath: string;
  platform: NodeJS.Platform;
  caseInsensitive: boolean;
}

export interface PlexUpdateResult {
  updated: number;
  historyMoved: number;
  pendingTransfers: number;
  warnings: string[];
  backupPath?: string;
}

export interface PendingHistoryTransfer {
  oldGuid: string;
  newFilePath: string;
  showTitle: string;
  seasonNumber: number;
  episodeNumber: number;
  createdAt: string;
}

interface DirectoryRow {
  id: number;
  parentDirectoryId: number | null;
  path: string;
}

interface StreamRow {
  id: number;
  url: string;
}

function key(value: string, caseInsensitive: boolean): string {
  return organizerComparisonKey(value, { caseInsensitive });
}

function backupDatabase(
  dbPath: string,
  backupDir: string,
): string {
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const unique = Math.random().toString(36).slice(2, 8);
  const backupPath = path.join(backupDir, `plex-${stamp}-${unique}.db`);
  fs.copyFileSync(dbPath, backupPath);
  for (const suffix of ['-wal', '-shm']) {
    const source = `${dbPath}${suffix}`;
    if (fs.existsSync(source)) fs.copyFileSync(source, `${backupPath}${suffix}`);
  }
  return backupPath;
}

function directoriesFor(
  db: DatabaseSync,
  sectionId: number,
): DirectoryRow[] {
  return db
    .prepare(
      `SELECT id, parent_directory_id AS parentDirectoryId, path
       FROM directories WHERE library_section_id = ? AND deleted_at IS NULL`,
    )
    .all(sectionId) as unknown as DirectoryRow[];
}

function findDirectory(
  rows: DirectoryRow[],
  relativePath: string,
  caseInsensitive: boolean,
): DirectoryRow | undefined {
  const target = key(relativePath, caseInsensitive);
  return rows.find((row) => key(row.path, caseInsensitive) === target);
}

function ensureDirectory(
  db: DatabaseSync,
  sectionId: number,
  relativePath: string,
  caseInsensitive: boolean,
): number {
  const normalized = relativePath === '.' ? '' : relativePath;
  const rows = directoriesFor(db, sectionId);
  const existing = findDirectory(rows, normalized, caseInsensitive);
  if (existing) return existing.id;

  const parentPath = path.dirname(normalized);
  const parentId =
    normalized && parentPath !== '.' && parentPath !== ''
      ? ensureDirectory(db, sectionId, parentPath, caseInsensitive)
      : (findDirectory(rows, '', caseInsensitive)?.id ?? null);

  const result = db
    .prepare(
      `INSERT INTO directories
         (library_section_id, parent_directory_id, path, created_at, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .run(sectionId, parentId, normalized);
  return Number(result.lastInsertRowid);
}

function updateDirectorySubtree(
  db: DatabaseSync,
  sectionId: number,
  oldRelative: string,
  newRelative: string,
  caseInsensitive: boolean,
): void {
  if (!oldRelative || key(oldRelative, caseInsensitive) === key(newRelative, caseInsensitive)) {
    return;
  }
  const rows = directoriesFor(db, sectionId);
  const oldKey = key(oldRelative, caseInsensitive);
  const updates: { id: number; next: string }[] = [];
  for (const row of rows) {
    const rowKey = key(row.path, caseInsensitive);
    if (rowKey === oldKey) {
      updates.push({ id: row.id, next: newRelative });
    } else if (rowKey.startsWith(`${oldKey}${path.sep}`) || rowKey.startsWith(`${oldKey}/`)) {
      const prefixSegments = oldRelative.split(/[\\/]+/).length;
      const rest = row.path
        .split(/[\\/]+/)
        .slice(prefixSegments)
        .join(path.sep);
      updates.push({ id: row.id, next: path.join(newRelative, rest) });
    }
  }
  const update = db.prepare(
    `UPDATE directories SET path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  );
  for (const entry of updates) update.run(entry.next, entry.id);
}

function updateSidecarStreams(
  db: DatabaseSync,
  item: OrganizePlanItem,
  association: PlexAssociation,
  caseInsensitive: boolean,
  warnings: string[],
): void {
  if (item.sidecars.length === 0) return;
  const streams = db
    .prepare(
      `SELECT id, url FROM media_streams
       WHERE media_part_id = ? AND stream_type_id = 3 AND url LIKE 'file://%'`,
    )
    .all(association.mediaPartId) as unknown as StreamRow[];
  if (streams.length === 0) return;
  const byUrl = new Map(
    streams.map((stream) => [key(stream.url, caseInsensitive), stream]),
  );
  const update = db.prepare(
    `UPDATE media_streams SET url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  );
  for (const sidecar of item.sidecars) {
    const sourceUrl = pathToFileURL(sidecar.sourcePath).href;
    const targetUrl = pathToFileURL(sidecar.targetPath).href;
    const stream = byUrl.get(key(sourceUrl, caseInsensitive));
    if (stream) {
      update.run(targetUrl, stream.id);
    } else {
      warnings.push(
        `Plex has no external subtitle stream for ${sidecar.sourcePath}; the file was renamed but its stream row was left alone.`,
      );
    }
  }
}

interface SettingRow {
  id: number;
  account_id: number;
  view_count: number;
  view_offset: number | null;
  last_viewed_at: string | null;
  skip_count: number | null;
  last_skipped_at: string | null;
  rating: number | null;
  last_rated_at: string | null;
  created_at: string | null;
}

function later(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
}

function earlier(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return left < right ? left : right;
}

/** Moves per-account watch state from one metadata GUID to another. */
export function transferWatchState(
  db: DatabaseSync,
  oldGuid: string,
  newGuid: string,
): number {
  if (!oldGuid || !newGuid || oldGuid === newGuid) return 0;
  let moved = 0;
  const settings = db
    .prepare(
      `SELECT id, account_id, view_count, view_offset, last_viewed_at,
              skip_count, last_skipped_at, rating, last_rated_at, created_at
       FROM metadata_item_settings WHERE guid = ?`,
    )
    .all(oldGuid) as unknown as SettingRow[];

  for (const old of settings) {
    const existing = db
      .prepare(
        `SELECT id, account_id, view_count, view_offset, last_viewed_at,
                skip_count, last_skipped_at, rating, last_rated_at, created_at
         FROM metadata_item_settings WHERE guid = ? AND account_id = ?`,
      )
      .get(newGuid, old.account_id) as unknown as SettingRow | undefined;
    if (!existing) {
      db.prepare(
        `UPDATE metadata_item_settings
         SET guid = ?, updated_at = CURRENT_TIMESTAMP, changed_at = strftime('%s','now')
         WHERE id = ?`,
      ).run(newGuid, old.id);
      moved += 1;
      continue;
    }

    const oldLatest = old.last_viewed_at ?? '';
    const newLatest = existing.last_viewed_at ?? '';
    const offset =
      oldLatest > newLatest ? old.view_offset : existing.view_offset;
    db.prepare(
      `UPDATE metadata_item_settings
       SET view_count = ?, view_offset = ?, last_viewed_at = ?, skip_count = ?,
           last_skipped_at = ?, rating = ?, last_rated_at = ?, created_at = ?,
           updated_at = CURRENT_TIMESTAMP, changed_at = strftime('%s','now')
       WHERE id = ?`,
    ).run(
      Number(old.view_count ?? 0) + Number(existing.view_count ?? 0),
      offset,
      later(old.last_viewed_at, existing.last_viewed_at),
      Number(old.skip_count ?? 0) + Number(existing.skip_count ?? 0),
      later(old.last_skipped_at, existing.last_skipped_at),
      existing.rating ?? old.rating,
      later(old.last_rated_at, existing.last_rated_at),
      earlier(old.created_at, existing.created_at),
      existing.id,
    );
    db.prepare('DELETE FROM metadata_item_settings WHERE id = ?').run(old.id);
    moved += 1;
  }

  const viewResult = db
    .prepare('UPDATE metadata_item_views SET guid = ? WHERE guid = ?')
    .run(newGuid, oldGuid);
  return moved + Number(viewResult.changes ?? 0);
}

function readPending(pendingPath: string): PendingHistoryTransfer[] {
  try {
    if (!fs.existsSync(pendingPath)) return [];
    const parsed = JSON.parse(fs.readFileSync(pendingPath, 'utf8')) as unknown;
    return Array.isArray(parsed) ? (parsed as PendingHistoryTransfer[]) : [];
  } catch {
    return [];
  }
}

function writePending(
  pendingPath: string,
  pending: PendingHistoryTransfer[],
): void {
  fs.mkdirSync(path.dirname(pendingPath), { recursive: true });
  fs.writeFileSync(pendingPath, JSON.stringify(pending, null, 2), 'utf8');
}

function pendingForItem(
  item: OrganizePlanItem,
  association: PlexAssociation,
): PendingHistoryTransfer | undefined {
  if (!item.episode) return undefined;
  return {
    oldGuid: association.guid,
    newFilePath: item.targetPath,
    showTitle: association.showTitle ?? '',
    seasonNumber: item.episode.seasonNumber,
    episodeNumber: item.episode.episodeNumber,
    createdAt: new Date().toISOString(),
  };
}

function planDirectoryMove(
  item: OrganizePlanItem,
  association: PlexAssociation,
  mediaType: OrganizePlan['mediaType'],
  db: DatabaseSync,
  caseInsensitive: boolean,
): number | undefined {
  if (!association.libraryRoot) return undefined;
  const oldDirectory = path.dirname(item.sourcePath);
  const newDirectory = path.dirname(item.targetPath);
  if (key(oldDirectory, caseInsensitive) === key(newDirectory, caseInsensitive)) {
    return association.directoryId;
  }
  const oldRelative = path.relative(association.libraryRoot, oldDirectory);
  const newRelative = path.relative(association.libraryRoot, newDirectory);
  const sectionId = association.librarySectionId;
  if (!sectionId) return undefined;

  if (mediaType === 'movies') {
    const rows = directoriesFor(db, sectionId);
    const existing = association.directoryId
      ? rows.find((row) => row.id === association.directoryId)
      : undefined;
    if (existing && existing.path) {
      updateDirectorySubtree(db, sectionId, oldRelative, newRelative, caseInsensitive);
      return existing.id;
    }
    return ensureDirectory(db, sectionId, newRelative, caseInsensitive);
  }

  return ensureDirectory(db, sectionId, newRelative, caseInsensitive);
}

/**
 * Applies Plex location and watch-history updates for an organize plan. The
 * caller must have stopped Plex and verified write access; this function makes
 * a backup, uses one transaction and never writes `metadata_items`.
 */
export function updatePlexFromPlan(
  plan: OrganizePlan,
  options: PlexUpdateOptions,
): PlexUpdateResult {
  const warnings: string[] = [];
  const result: PlexUpdateResult = {
    updated: 0,
    historyMoved: 0,
    pendingTransfers: 0,
    warnings,
  };
  if (!fs.existsSync(options.dbPath)) {
    throw new Error(`Plex database not found: ${options.dbPath}`);
  }
  fs.accessSync(options.dbPath, fs.constants.W_OK);

  const catalog: PlexCatalog = readPlexCatalog(options.dbPath);
  const pending = readPending(options.pendingPath);
  result.backupPath = backupDatabase(options.dbPath, options.backupDir);

  const db = new DatabaseSync(options.dbPath);
  db.exec('PRAGMA busy_timeout = 5000');
  try {
    db.exec('BEGIN IMMEDIATE');
    for (const item of plan.items) {
      if (item.action !== 'rename' || !item.plex) continue;
      const current = db
        .prepare('SELECT file, directory_id AS directoryId FROM media_parts WHERE id = ?')
        .get(item.plex.mediaPartId) as unknown as
        | { file: string; directoryId: number | null }
        | undefined;
      if (!current) {
        warnings.push(`Plex part ${item.plex.mediaPartId} no longer exists.`);
        continue;
      }
      if (
        key(current.file, options.caseInsensitive) !==
        key(item.sourcePath, options.caseInsensitive)
      ) {
        warnings.push(
          `Plex part ${item.plex.mediaPartId} moved on disk before the update; skipping ${item.sourcePath}.`,
        );
        continue;
      }

      const directoryId = planDirectoryMove(
        item,
        item.plex,
        plan.mediaType,
        db,
        options.caseInsensitive,
      );
      db.prepare(
        `UPDATE media_parts
         SET file = ?, directory_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      ).run(item.targetPath, directoryId ?? current.directoryId ?? null, item.plex.mediaPartId);
      result.updated += 1;
      updateSidecarStreams(db, item, item.plex, options.caseInsensitive, warnings);

      if (
        plan.mediaType === 'tv' &&
        item.episode &&
        item.plex.showTitle &&
        (item.plex.seasonNumber !== item.episode.seasonNumber ||
          item.plex.episodeNumber !== item.episode.episodeNumber)
      ) {
        const newGuid = findEpisodeGuid(
          catalog,
          item.plex.showTitle,
          item.episode.seasonNumber,
          item.episode.episodeNumber,
        );
        if (newGuid && newGuid !== item.plex.guid) {
          result.historyMoved += transferWatchState(db, item.plex.guid, newGuid);
        } else {
          const transfer = pendingForItem(item, item.plex);
          if (transfer) {
            const duplicate = pending.some(
              (entry) =>
                entry.oldGuid === transfer.oldGuid &&
                entry.newFilePath === transfer.newFilePath,
            );
            if (!duplicate) pending.push(transfer);
            warnings.push(
              `Watch history for ${path.basename(item.targetPath)} will move after Plex rescans the new file.`,
            );
          }
        }
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Ignore rollback failures; the original error is more useful.
    }
    throw error;
  } finally {
    db.close();
  }

  writePending(options.pendingPath, pending);
  result.pendingTransfers = pending.length;
  return result;
}

/** Completes history transfers once Plex has matched the renamed files. */
export function completePendingHistoryTransfers(
  options: PlexUpdateOptions,
): PlexUpdateResult {
  const pending = readPending(options.pendingPath);
  if (pending.length === 0) {
    return {
      updated: 0,
      historyMoved: 0,
      pendingTransfers: 0,
      warnings: [],
    };
  }
  const remaining: PendingHistoryTransfer[] = [];
  const warnings: string[] = [];
  let moved = 0;
  fs.accessSync(options.dbPath, fs.constants.W_OK);
  const backupPath = backupDatabase(options.dbPath, options.backupDir);
  const db = new DatabaseSync(options.dbPath);
  db.exec('PRAGMA busy_timeout = 5000');
  try {
    db.exec('BEGIN IMMEDIATE');
    for (const transfer of pending) {
      const rows = db
        .prepare(
          `SELECT mi.metadata_item_id AS metadataItemId, ep.guid AS guid,
                  show.title AS showTitle, season."index" AS seasonNumber,
                  ep."index" AS episodeNumber
           FROM media_parts mp
           JOIN media_items mi ON mi.id = mp.media_item_id
           JOIN metadata_items ep ON ep.id = mi.metadata_item_id AND ep.metadata_type = 4
           JOIN metadata_items season ON season.id = ep.parent_id AND season.metadata_type = 3
           JOIN metadata_items show ON show.id = season.parent_id AND show.metadata_type = 2
           WHERE mp.file = ?`,
        )
        .all(transfer.newFilePath) as unknown as {
        metadataItemId: number;
        guid: string;
        showTitle: string;
        seasonNumber: number;
        episodeNumber: number;
      }[];
      const intended = rows.find(
        (row) =>
          row.showTitle.toLowerCase() === transfer.showTitle.toLowerCase() &&
          Number(row.seasonNumber) === transfer.seasonNumber &&
          Number(row.episodeNumber) === transfer.episodeNumber,
      );
      const replacement =
        intended ?? rows.find((row) => row.guid && row.guid !== transfer.oldGuid);
      if (!replacement?.guid) {
        remaining.push(transfer);
        continue;
      }
      moved += transferWatchState(db, transfer.oldGuid, replacement.guid);
    }
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Ignore.
    }
    throw error;
  } finally {
    db.close();
  }
  writePending(options.pendingPath, remaining);
  if (remaining.length > 0) {
    warnings.push(
      `${remaining.length} history transfer(s) are still waiting for Plex to scan the new files.`,
    );
  }
  return {
    updated: 0,
    historyMoved: moved,
    pendingTransfers: remaining.length,
    warnings,
    backupPath,
  };
}
