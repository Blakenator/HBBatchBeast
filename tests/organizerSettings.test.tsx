// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  emptyLibrary,
  type AppConfigV2,
  type Library,
} from '../src/common';
import { OrganizerSettings } from '../src/frontend/settings/organizer/OrganizerSettings';

afterEach(cleanup);

const Harness: React.FC = () => {
  const [library, setLibrary] = useState<Library>(() =>
    emptyLibrary({ id: 'library-1', name: 'TV', mediaType: 'tv' }),
  );
  return (
    <OrganizerSettings
      config={{} as AppConfigV2}
      library={library}
      onChange={setLibrary}
    />
  );
};

describe('OrganizerSettings name replacements', () => {
  it('adds, edits and removes replacement rows', () => {
    render(<Harness />);

    expect(screen.queryByLabelText('Find text 1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add replacement' }));
    const find = screen.getByLabelText('Find text 1');
    expect(find).toBeTruthy();

    fireEvent.change(find, { target: { value: '_' } });
    fireEvent.change(screen.getByLabelText('Replace with 1'), {
      target: { value: ' ' },
    });
    expect((find as HTMLInputElement).value).toBe('_');

    fireEvent.click(screen.getByRole('button', { name: 'Remove replacement 1' }));
    expect(screen.queryByLabelText('Find text 1')).toBeNull();
  });
});
