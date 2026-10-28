import {
  BatchTabConfig,
  ConversionPreset,
  parseMappedRows,
  presetArgument,
} from '../../common';

const HARDWARE_ENCODER_PATTERN =
  /(?:^|[^a-z0-9])(?:nvenc|qsv|quick[\s_-]*sync|videotoolbox|vaapi|amf|vce)(?=$|[^a-z0-9])/i;

export function usesHardwarePreset(preset: ConversionPreset): boolean {
  return HARDWARE_ENCODER_PATTERN.test(presetArgument(preset));
}

export function usesHardwareEncoder(
  batch: Partial<BatchTabConfig>,
): boolean {
  const hasCustomRows =
    batch.FFmpeg_toggle === 1 ||
    parseMappedRows(batch.custom_preset_string).some(Boolean);
  const value = hasCustomRows ? batch.custom_preset_string : batch.preset;

  return (value ?? '')
    .split('\n')
    .some((row) => HARDWARE_ENCODER_PATTERN.test(row));
}
