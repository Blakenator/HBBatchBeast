// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { getDefaultMessages } from '../src/frontend/allMessages';
import {
  APP_CONFIG_SCHEMA_VERSION,
  AppConfigV2,
  emptyLibrary,
} from '../src/common';
import { LibraryHeader } from '../src/frontend/settings/library/LibraryHeader';

const presets = [
  {
    id: 'preset-1',
    name: 'Fast 1080p30',
    handbrake: { preset: 'Fast 1080p30' },
  },
];

const movies = {
  ...emptyLibrary({
    id: 'library-1',
    name: 'Movies',
    defaultPresetId: 'preset-1',
  }),
  folders: [{ id: 'folder-1', source: '/src', destination: '/dst' }],
};

const shows = emptyLibrary({
  id: 'library-2',
  name: 'Shows',
  mediaType: 'tv',
  defaultPresetId: 'preset-1',
});

const config: AppConfigV2 = {
  schema_version: APP_CONFIG_SCHEMA_VERSION,
  lang: 'en',
  version_message: 'test',
  selected_library: 'library-1',
  presets,
  libraries: [movies, shows],
};

function renderHeader(overrides: Partial<AppConfigV2> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onDuplicate: vi.fn(),
    onChange: vi.fn(),
    onDelete: vi.fn(),
  };
  render(
    <IntlProvider
      locale="en"
      messages={getDefaultMessages()}
      defaultLocale="en"
    >
      <LibraryHeader
        config={{ ...config, ...overrides }}
        library={movies}
        {...handlers}
      />
    </IntlProvider>,
  );
  return handlers;
}

describe('LibraryHeader', () => {
  afterEach(cleanup);

  it('shows the selected library summary', () => {
    renderHeader();

    expect(screen.getByText('1 folder')).toBeTruthy();
    expect(screen.getByText('0 mapping rules')).toBeTruthy();
    expect(screen.getByText('Default preset: Fast 1080p30')).toBeTruthy();
    expect(
      (screen.getByRole('combobox', { name: 'Library' }) as HTMLInputElement)
        .value,
    ).toBe('Movies');
  });

  it('selects another library from the picker', () => {
    const { onSelect } = renderHeader();

    fireEvent.focus(screen.getByRole('combobox', { name: 'Library' }));
    fireEvent.click(screen.getByRole('option', { name: 'Shows' }));

    expect(onSelect).toHaveBeenCalledWith('library-2');
  });

  it('renames and retypes the library inline', () => {
    const { onChange } = renderHeader();

    fireEvent.change(screen.getByLabelText('Library name'), {
      target: { value: 'Renamed' },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'library-1', name: 'Renamed' }),
    );

    fireEvent.click(screen.getByRole('radio', { name: 'TV shows' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'library-1', mediaType: 'tv' }),
    );
  });

  it('creates and duplicates libraries', () => {
    const { onCreate, onDuplicate } = renderHeader();

    fireEvent.click(screen.getByRole('button', { name: 'New library' }));
    expect(onCreate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(onDuplicate).toHaveBeenCalledTimes(1);
  });

  it('asks for confirmation before deleting the library', () => {
    const { onDelete } = renderHeader();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Delete “Movies”\?/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('blocks deleting the last library', () => {
    renderHeader({ libraries: [movies] });

    expect(
      (screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
