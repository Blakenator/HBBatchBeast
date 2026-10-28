import { describe, expect, it } from 'vitest';
import {
  FFPROBE_PROPERTY_GROUPS,
  ffprobePropertyGroups,
  ffprobePropertySuggestions,
  ffprobeValueOptions,
  isKnownFfprobeProperty,
  isNumericFfprobeProperty,
} from '../src/common/ffprobeProperties';

describe('ffprobe property catalog', () => {
  it('groups suggestions in a stable order', () => {
    const groups = ffprobePropertyGroups();
    expect(groups.map((entry) => entry.group)).toEqual(FFPROBE_PROPERTY_GROUPS);
    expect(
      ffprobePropertySuggestions().find((entry) => entry.value === 'codec_name')
        ?.group,
    ).toBe('Common');
  });

  it('exposes common values for known properties', () => {
    expect(ffprobeValueOptions('codec_name')).toContain('hevc');
    expect(ffprobeValueOptions('width')).toContain('1920');
  });

  it('marks numeric fields so the picker can switch suggestions', () => {
    expect(isNumericFfprobeProperty('width')).toBe(true);
    expect(isNumericFfprobeProperty('codec_name')).toBe(false);
    expect(isKnownFfprobeProperty('codec_name')).toBe(true);
    expect(isKnownFfprobeProperty('custom_field')).toBe(false);
  });
});
