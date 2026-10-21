import { describe, expect, it } from 'vitest';
import { validateBatchConfig } from '../src/frontend/run/validation';

const paired = {
  path: {
    source_path: '/media/movies\n/media/tv',
    destination_path: '/out/movies\n/out/tv',
  },
  preset: 'Fast 1080p30',
  container: '.mp4',
};

describe('validateBatchConfig', () => {
  it('accepts a complete setup and a single preset reused for every folder', () => {
    expect(validateBatchConfig(paired)).toEqual([]);
  });

  it('names the row that is missing its destination', () => {
    const problems = validateBatchConfig({
      ...paired,
      path: {
        source_path: '/media/movies\n/media/tv',
        destination_path: '/out/movies\n',
      },
    });

    expect(problems).toContain(
      'Row 2: add a destination folder for /media/tv.',
    );
  });

  it('rejects a destination inside its source, including trailing separators', () => {
    const problems = validateBatchConfig({
      ...paired,
      path: {
        source_path: '/media/movies',
        destination_path: '/media/movies/converted/',
      },
    });

    expect(problems.some((problem) => problem.includes('is inside source'))).toBe(
      true,
    );
  });

  it('checks the temp row only when staging is enabled', () => {
    const disabled = validateBatchConfig({
      ...paired,
      path: { ...paired.path, temp_toggle: 0 },
    });
    expect(disabled).toEqual([]);

    const enabled = validateBatchConfig({
      ...paired,
      path: {
        ...paired.path,
        temp_toggle: 1,
        temp_destination_path: '/tmp/movies',
      },
    });
    expect(enabled).toContain('Row 2: add a temp folder for /media/tv.');
  });

  it('requires a preset for a configured folder', () => {
    expect(validateBatchConfig({ ...paired, preset: '' })).toContain(
      'Choose a HandBrake preset for each source folder.',
    );
  });

  it('flags a preset hole in the middle of the rows', () => {
    const problems = validateBatchConfig({
      ...paired,
      preset: '\nFast 720p30',
    });

    expect(problems).toContain('Folder 1 is missing a preset or arguments.');
  });

  it('treats FFmpeg arguments as required in FFmpeg mode', () => {
    expect(
      validateBatchConfig({
        ...paired,
        FFmpeg_toggle: 1,
        custom_preset_string: '',
      }),
    ).toContain('Add FFmpeg arguments for each source folder.');
  });

  it('rejects containers the selected encoder cannot write', () => {
    expect(validateBatchConfig({ ...paired, container: '.webm' })).toContain(
      'HandBrake cannot write .webm files; choose MP4, M4V, or MKV.',
    );
    expect(
      validateBatchConfig({
        ...paired,
        FFmpeg_toggle: 1,
        custom_preset_string: '0,0',
        container: '.webm',
      }),
    ).toEqual([]);
  });

  it('flags a suffix hole but allows empty suffixes at the end', () => {
    const withHole = validateBatchConfig({
      ...paired,
      advanced: {
        file_name_suffix_toggle: 1,
        file_name_suffix: '\n_sd',
      },
    });
    expect(withHole).toContain('Folder 1 is missing its filename suffix.');

    const trailingEmpty = validateBatchConfig({
      ...paired,
      advanced: {
        file_name_suffix_toggle: 1,
        file_name_suffix: '_hd\n',
      },
    });
    expect(trailingEmpty).toEqual([]);
  });
});
