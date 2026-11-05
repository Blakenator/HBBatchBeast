import { afterEach, describe, expect, it } from 'vitest';
import { emptyLibrary } from '../src/common/library';
import {
  createOrganizeSettings,
  organizeLibrarySignature,
  organizeMatchSignature,
  organizePlanSignature,
} from '../src/common/organizer';
import {
  readOrganizeSession,
  saveOrganizeSession,
  useOrganizeSessionStore,
  type OrganizeSession,
} from '../src/frontend/organize/organizeSession';

afterEach(() => {
  useOrganizeSessionStore.setState({ sessions: {} });
});

function session(libraryId: string, updatedAt = Date.now()): OrganizeSession {
  return {
    libraryId,
    step: 'review',
    selected: ['a.mkv'],
    scope: [],
    matchSignature: 'match',
    planSignature: 'plan',
    librarySignature: 'library',
    updatedAt,
  };
}

describe('organize session store', () => {
  it('keeps a session across component unmounts by library id', () => {
    saveOrganizeSession(session('library-1'));
    expect(readOrganizeSession('library-1')).toMatchObject({
      libraryId: 'library-1',
      step: 'review',
      selected: ['a.mkv'],
    });
    expect(readOrganizeSession('library-2')).toBeUndefined();
  });

  it('caps the number of remembered sessions', () => {
    for (let index = 0; index < 10; index += 1) {
      saveOrganizeSession(session(`library-${index}`, index));
    }
    expect(Object.keys(useOrganizeSessionStore.getState().sessions)).toHaveLength(
      8,
    );
    expect(readOrganizeSession('library-0')).toBeUndefined();
    expect(readOrganizeSession('library-9')).toBeDefined();
  });
});

describe('organize signatures', () => {
  it('separates match inputs from naming inputs', () => {
    const settings = createOrganizeSettings('tv');
    const match = organizeMatchSignature(settings);
    const plan = organizePlanSignature(settings);

    const renamed = {
      ...settings,
      namingRules: [
        ...settings.namingRules,
        { ...settings.namingRules[0], id: 'second', name: 'Second' },
      ],
    };
    expect(organizeMatchSignature(renamed)).toBe(match);
    expect(organizePlanSignature(renamed)).not.toBe(plan);

    const rematched = {
      ...settings,
      tvdb: {
        ...settings.tvdb,
        shows: [
          {
            id: 'show-1',
            folderId: 'folder-1',
            subpath: '',
            series: { id: '1', slug: 'show', name: 'Show' },
          },
        ],
      },
    };
    expect(organizeMatchSignature(rematched)).not.toBe(match);
    expect(organizePlanSignature(rematched)).toBe(plan);

    const replaced = {
      ...settings,
      nameReplacements: [{ id: 'r1', find: '_', replace: ' ' }],
    };
    expect(organizeMatchSignature(replaced)).not.toBe(match);
    expect(organizePlanSignature(replaced)).toBe(plan);
  });

  it('changes when the discovered library layout changes', () => {
    const base = emptyLibrary({ id: 'lib', name: 'TV', mediaType: 'tv' });
    const first = organizeLibrarySignature(base);
    expect(
      organizeLibrarySignature({
        ...base,
        folders: [{ id: 'folder-1', source: '/media/tv', destination: '' }],
      }),
    ).not.toBe(first);
  });
});
