// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TemplateField } from '../src/frontend/ui/TemplateField';

afterEach(cleanup);

function Harness({
  initial = '',
  mediaType = 'tv' as const,
}: {
  initial?: string;
  mediaType?: 'tv' | 'movies';
}) {
  const [value, setValue] = useState(initial);
  return (
    <div>
      <TemplateField
        id="template"
        label="Folder template"
        mediaType={mediaType}
        value={value}
        onChange={setValue}
      />
      <output data-testid="value">{value}</output>
    </div>
  );
}

describe('TemplateField', () => {
  it('opens the variable popover after typing { and filters it', () => {
    render(<Harness />);
    const input = screen.getByRole('textbox', { name: 'Folder template' });
    fireEvent.change(input, { target: { value: 'Season {se' } });

    const listbox = screen.getByRole('listbox', { name: 'Template variables' });
    expect(listbox).toBeTruthy();
    expect(screen.getByText('Season number')).toBeTruthy();
    expect(screen.queryByText('IMDB id')).toBeNull();
  });

  it('inserts a deletable chip when a variable is chosen', () => {
    render(<Harness />);
    const input = screen.getByRole('textbox', { name: 'Folder template' });
    fireEvent.change(input, { target: { value: 'Season {se' } });
    fireEvent.mouseDown(screen.getByText('Season number'));

    expect(screen.getByTestId('value').textContent).toBe('Season {season:02}');
    expect(screen.getByText('{season:02}')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove season' }));
    expect(screen.getByTestId('value').textContent).toBe('Season ');
  });

  it('renders an example line for every token', () => {
    render(<Harness initial="{show} ({seriesYear})/Season {season:02}" />);
    const example = screen.getByText(/Example:/);
    expect(example.textContent).toContain(
      'Blue Planet II (2017)/Season 01',
    );
  });

  it('flags unknown variables without breaking the field', () => {
    render(<Harness initial="{show}/{nope}" />);
    expect(screen.getByText(/Unknown variable/)).toBeTruthy();
    expect(screen.getByText('{nope}')).toBeTruthy();
  });

  it('offers movie tokens for movie libraries', () => {
    render(<Harness mediaType="movies" />);
    const input = screen.getByRole('textbox', { name: 'Folder template' });
    fireEvent.change(input, { target: { value: '{im' } });
    expect(screen.getByText('IMDB id')).toBeTruthy();
    expect(screen.queryByText('Show name')).toBeNull();
  });
});
