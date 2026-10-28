import { describe, expect, it } from 'vitest';
import {
  buildFolderTree,
  flattenFolderTree,
  normalizePath,
  type TreeFileLike,
} from '../src/frontend/run/folderTree';

function file(
  path: string,
  state: TreeFileLike['state'],
  extra: Partial<TreeFileLike> = {},
): TreeFileLike {
  return { path, state, ...extra };
}

describe('folderTree', () => {
  it('normalizes separators without losing the filesystem root', () => {
    expect(normalizePath('C:\\Media\\Movies\\')).toBe('C:/Media/Movies');
    expect(normalizePath('/media/movies///')).toBe('/media/movies');
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('')).toBe('');
  });

  it('groups files under their source roots and aggregates stats', () => {
    const tree = buildFolderTree(
      [
        file('/media/movies/a.mkv', 'success', {
          sourceBytes: 100,
          progress: { percent: 100 },
        }),
        file('/media/movies/sub/b.mkv', 'pending', { sourceBytes: 200 }),
        file('/media/tv/c.mkv', 'running', {
          sourceBytes: 50,
          progress: { percent: 50 },
        }),
      ],
      ['/media/movies', '/media/tv'],
    );

    expect(tree.map((node) => node.name)).toEqual([
      '/media/movies',
      '/media/tv',
    ]);

    const movies = tree[0];
    expect(movies.fileCount).toBe(2);
    expect(movies.sourceBytes).toBe(300);
    expect(movies.stateCounts.success).toBe(1);
    expect(movies.stateCounts.pending).toBe(1);
    expect(movies.percent).toBe(50);
    expect(movies.children.map((child) => child.name)).toEqual(['sub']);

    const sub = movies.children[0];
    expect(sub.fileCount).toBe(1);
    expect(sub.percent).toBeUndefined();
    expect(sub.files.map((entry) => entry.path)).toEqual([
      '/media/movies/sub/b.mkv',
    ]);

    expect(tree[1].percent).toBe(50);
    expect(tree[1].stateCounts.running).toBe(1);
  });

  it('assigns nested source-root files to the most specific root', () => {
    const tree = buildFolderTree(
      [
        file('/media/movies/a.mkv', 'pending'),
        file('/media/tv/b.mkv', 'pending'),
      ],
      ['/media', '/media/movies'],
    );

    expect(tree.map((node) => node.key)).toEqual(['/media', '/media/movies']);
    const media = tree.find((node) => node.key === '/media')!;
    expect(media.children.map((child) => child.name)).toEqual(['tv']);
    expect(media.fileCount).toBe(1);
    const movies = tree.find((node) => node.key === '/media/movies')!;
    expect(movies.children).toEqual([]);
    expect(movies.files).toHaveLength(1);
  });

  it('matches Windows paths case-insensitively across separators', () => {
    const tree = buildFolderTree(
      [file('c:/media/movies/Sub/A.mkv', 'pending')],
      ['C:\\Media\\Movies'],
    );

    expect(tree).toHaveLength(1);
    expect(tree[0].key).toBe('C:/Media/Movies');
    expect(tree[0].name).toBe('C:/Media/Movies');
    expect(tree[0].children[0].key).toBe('C:/Media/Movies/Sub');
    expect(tree[0].children[0].files[0].path).toBe(
      'c:/media/movies/Sub/A.mkv',
    );
  });

  it('falls back to a top-level root for paths outside every source folder', () => {
    const tree = buildFolderTree(
      [file('/media/movies/a.mkv', 'pending')],
      ['/library'],
    );

    expect(tree).toHaveLength(1);
    expect(tree[0].key).toBe('/media');
    expect(tree[0].children[0].name).toBe('movies');
  });

  it('flattens collapsed and expanded folders in pre-order', () => {
    const tree = buildFolderTree(
      [
        file('/media/movies/a.mkv', 'pending'),
        file('/media/movies/sub/b.mkv', 'pending'),
        file('/media/tv/c.mkv', 'pending'),
      ],
      ['/media/movies', '/media/tv'],
    );

    const collapsed = flattenFolderTree(tree, new Set());
    expect(
      collapsed.map((item) =>
        item.kind === 'folder' ? `folder:${item.node.key}` : `file:${item.file.path}`,
      ),
    ).toEqual(['folder:/media/movies', 'folder:/media/tv']);

    const moviesOpen = flattenFolderTree(tree, new Set(['/media/movies']));
    expect(
      moviesOpen.map((item) => ({
        kind: item.kind,
        depth: item.depth,
        key:
          item.kind === 'folder' ? item.node.key : item.file.path,
      })),
    ).toEqual([
      { kind: 'folder', depth: 0, key: '/media/movies' },
      { kind: 'folder', depth: 1, key: '/media/movies/sub' },
      { kind: 'file', depth: 1, key: '/media/movies/a.mkv' },
      { kind: 'folder', depth: 0, key: '/media/tv' },
    ]);

    const fullyOpen = flattenFolderTree(
      tree,
      new Set(['/media/movies', '/media/movies/sub', '/media/tv']),
    );
    expect(fullyOpen.at(-1)).toEqual({
      kind: 'file',
      depth: 1,
      file: expect.objectContaining({ path: '/media/tv/c.mkv' }),
    });
  });

  it('ignores excluded files when calculating aggregate progress', () => {
    const tree = buildFolderTree(
      [
        file('/media/movies/a.mkv', 'excluded'),
        file('/media/movies/b.mkv', 'pending'),
      ],
      ['/media/movies'],
    );

    expect(tree[0].percent).toBeUndefined();
    expect(tree[0].fileCount).toBe(2);
    expect(tree[0].stateCounts.excluded).toBe(1);
    expect(tree[0].stateCounts.pending).toBe(1);
  });

  it('reports unknown sizes when no file carries one', () => {
    const tree = buildFolderTree(
      [file('/media/movies/a.mkv', 'pending')],
      ['/media/movies'],
    );

    expect(tree[0].hasKnownSize).toBe(false);
    expect(tree[0].sourceBytes).toBe(0);
  });
});
