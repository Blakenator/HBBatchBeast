// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SeriesSearch } from '../src/frontend/organize/SeriesSearch';

const { mockRefetch } = vi.hoisted(() => ({ mockRefetch: vi.fn() }));

vi.mock('../src/frontend/helpers', () => ({
  useBackend: () => ({
    loading: false,
    error: undefined,
    data: undefined,
    refetch: mockRefetch,
  }),
}));

afterEach(() => {
  cleanup();
  mockRefetch.mockReset();
});

function search(query = 'Blue Planet') {
  const input = screen.getByRole('textbox', { name: 'Search TVDB for a series' });
  fireEvent.change(input, { target: { value: query } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
}

describe('SeriesSearch', () => {
  it('shows a spinner while loading and then cover art', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    mockRefetch.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(<SeriesSearch id="s" onSelect={vi.fn()} />);
    search();

    expect(screen.getByText(/Searching TVDB/)).toBeTruthy();
    resolve({
      data: [
        {
          id: '1',
          slug: 'blue-planet-ii',
          name: 'Blue Planet II',
          year: 2017,
          image: 'https://artworks.test/blue.jpg',
        },
      ],
    });

    const name = await screen.findByText('Blue Planet II');
    expect(name).toBeTruthy();
    expect(screen.getByText('2017 · Choose')).toBeTruthy();
    const image = screen.getByRole('img', { name: 'Blue Planet II' });
    expect(image.getAttribute('src')).toBe('https://artworks.test/blue.jpg');
    expect(image.getAttribute('loading')).toBe('lazy');
  });

  it('falls back to a placeholder when artwork fails', async () => {
    mockRefetch.mockResolvedValue({
      data: [
        {
          id: '1',
          slug: 'blue-planet-ii',
          name: 'Blue Planet II',
          image: 'https://artworks.test/missing.jpg',
        },
      ],
    });
    render(<SeriesSearch id="s" onSelect={vi.fn()} />);
    search();

    const image = await screen.findByRole('img', { name: 'Blue Planet II' });
    fireEvent.error(image);
    expect(
      screen.getByRole('img', { name: 'Blue Planet II (no artwork)' }),
    ).toBeTruthy();
  });

  it('shows an inline error with retry', async () => {
    mockRefetch.mockResolvedValue({ error: { message: 'network down' } });
    render(<SeriesSearch id="s" onSelect={vi.fn()} />);
    search();

    expect(await screen.findByText(/TVDB search failed: network down/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mockRefetch).toHaveBeenCalledTimes(2);
  });

  it('explains an empty result', async () => {
    mockRefetch.mockResolvedValue({ data: [] });
    render(<SeriesSearch id="s" onSelect={vi.fn()} />);
    search('Nothing Here');

    expect(await screen.findByText(/No shows found for/)).toBeTruthy();
  });

  it('shows prefilled folder results without searching again', () => {
    render(
      <SeriesSearch
        id="s"
        onSelect={vi.fn()}
        initialQuery="Blue Planet 2"
        initialResults={[
          { id: '1', slug: 'blue-planet-ii', name: 'Blue Planet II', year: 2017 },
        ]}
        autoSearch
      />,
    );

    expect(screen.getByDisplayValue('Blue Planet 2')).toBeTruthy();
    expect(screen.getByText('Blue Planet II')).toBeTruthy();
    expect(screen.getByText('2017 · Choose')).toBeTruthy();
    expect(mockRefetch).not.toHaveBeenCalled();
  });

  it('runs the prefilled query when there are no stored results', async () => {
    mockRefetch.mockResolvedValue({
      data: [{ id: '1', slug: 'blue-planet-ii', name: 'Blue Planet II' }],
    });
    render(
      <SeriesSearch
        id="s"
        onSelect={vi.fn()}
        initialQuery="Blue Planet"
        autoSearch
      />,
    );

    expect(await screen.findByText('Blue Planet II')).toBeTruthy();
    expect(mockRefetch).toHaveBeenCalledWith({ query: 'Blue Planet' });
  });

  it('reports the selected series and calls onSelect', async () => {
    const onSelect = vi.fn();
    mockRefetch.mockResolvedValue({
      data: [
        { id: '1', slug: 'blue-planet-ii', name: 'Blue Planet II' },
      ],
    });
    render(
      <SeriesSearch id="s" selectedSlug="blue-planet-ii" onSelect={onSelect} />,
    );
    search();

    expect(await screen.findByText('Selected')).toBeTruthy();
    fireEvent.click(screen.getByText('Blue Planet II'));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'blue-planet-ii' }),
    );
  });
});
