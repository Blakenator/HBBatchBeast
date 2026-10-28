// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { getDefaultMessages } from '../src/frontend/allMessages';
import { FolderRowsEditor } from '../src/frontend/settings/FolderRowsEditor';

vi.mock('../src/frontend/helpers', () => ({
  useBackend: () => ({
    loading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
}));

const messages = getDefaultMessages();

afterEach(cleanup);

function renderEditor(options: {
  sourcePath: string;
  destinationPath: string;
  suffixes?: string[];
  container?: string;
}) {
  return render(
    <IntlProvider locale="en" messages={messages} defaultLocale="en">
      <FolderRowsEditor
        id="folders"
        sourcePath={options.sourcePath}
        destinationPath={options.destinationPath}
        tempPath=""
        tempEnabled={false}
        container={options.container ?? '.mp4'}
        suffixes={options.suffixes ?? []}
        paths={{
          source: 'tab_batch.path.source_path',
          destination: 'tab_batch.path.destination_path',
          temp: 'tab_batch.path.temp_destination_path',
        }}
        onChange={vi.fn()}
      />
    </IntlProvider>,
  );
}

describe('FolderRowsEditor output preview', () => {
  it('shows the mirrored example for a complete row', () => {
    renderEditor({
      sourcePath: '/media/tv',
      destinationPath: '/media/converted/tv',
    });

    expect(screen.getByText('Example output')).toBeTruthy();
    expect(
      screen.getByText('Show Name/Season 01/Episode 01.mkv'),
    ).toBeTruthy();
    expect(
      screen.getByText('→ /media/converted/tv/Show Name/Season 01/Episode 01.mp4'),
    ).toBeTruthy();
  });

  it('applies the row suffix and container to the example', () => {
    renderEditor({
      sourcePath: '/media/tv',
      destinationPath: 'D:\\Converted',
      suffixes: ['-1080p'],
      container: 'mkv',
    });

    expect(
      screen.getByText(
        '→ D:\\Converted\\Show Name\\Season 01\\Episode 01-1080p.mkv',
      ),
    ).toBeTruthy();
  });

  it('shows no preview for a blank row', () => {
    renderEditor({ sourcePath: '', destinationPath: '' });

    expect(screen.queryByText('Example output')).toBeNull();
  });
});

describe('FolderRowsEditor shared destinations', () => {
  it('warns on every row that shares a destination', () => {
    renderEditor({
      sourcePath: '/media/tv\n/media/movies',
      destinationPath: '/media/converted/library\n/media/converted/library/',
    });

    expect(
      screen.getByText(
        /^Row 2 also writes here — the folder trees merge/,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /^Row 1 also writes here — the folder trees merge/,
      ),
    ).toBeTruthy();
  });

  it('lists every other row sharing the destination', () => {
    renderEditor({
      sourcePath: '/media/tv\n/media/movies\n/media/kids',
      destinationPath:
        '/media/converted/library\n/media/converted/library\n/media/converted/library',
    });

    expect(
      screen.getByText(/^Rows 2, 3 also write here — the folder trees merge/),
    ).toBeTruthy();
    expect(
      screen.getByText(/^Rows 1, 3 also write here — the folder trees merge/),
    ).toBeTruthy();
    expect(
      screen.getByText(/^Rows 1, 2 also write here — the folder trees merge/),
    ).toBeTruthy();
  });

  it('does not warn when destinations differ', () => {
    renderEditor({
      sourcePath: '/media/tv\n/media/movies',
      destinationPath: '/media/converted/tv\n/media/converted/movies',
    });

    expect(screen.queryByText(/folder trees merge/)).toBeNull();
  });
});
