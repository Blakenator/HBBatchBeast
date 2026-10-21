import React from 'react';
import { useIntl } from 'react-intl';
import { HandBrakePresetScan, normalizePresetName } from '../../common';
import { Combobox, ComboboxOption } from '../ui/Combobox';
import { FALLBACK_HANDBRAKE_PRESETS } from './schema';
import { settingsMessages } from './messages';
import { InlineNote } from './FieldLayout';

interface PresetSelectProps {
  id: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  scan?: HandBrakePresetScan;
  loading?: boolean;
}

/**
 * Searchable preset picker backed by the presets installed with HandBrakeCLI.
 * The same field also accepts raw HandBrakeCLI arguments, so a custom preset
 * source can hold either a preset name or something like `-e x264 -q 22`.
 */
export const PresetSelect: React.FC<PresetSelectProps> = ({
  id,
  ariaLabel,
  value,
  onChange,
  scan,
  loading,
}) => {
  const { formatMessage } = useIntl();
  const presets = scan?.available ? (scan.presets ?? []) : [];
  const options: ComboboxOption[] =
    presets.length > 0
      ? presets.map((preset) => ({
          value: preset.name,
          label: preset.name,
          title: preset.description,
          group: preset.category,
        }))
      : FALLBACK_HANDBRAKE_PRESETS.map((preset) => ({
          value: preset,
          label: preset,
        }));

  const trimmed = value.trim();
  const isArguments = trimmed.startsWith('-') && !/^-Z\s/i.test(trimmed);
  const selectedName = normalizePresetName(value);
  const installedNames = new Set(presets.map((preset) => preset.name));
  const presetIsUnavailable =
    !isArguments &&
    presets.length > 0 &&
    trimmed.length > 0 &&
    !installedNames.has(selectedName);

  return (
    <div>
      <Combobox
        id={id}
        value={value}
        options={options}
        onChange={onChange}
        ariaLabel={ariaLabel}
        placeholder={
          loading
            ? formatMessage(settingsMessages.scanningPresets)
            : formatMessage(settingsMessages.enterPreset)
        }
        allowCustom
      />
      {presetIsUnavailable && (
        <InlineNote $tone="warning" role="status" aria-live="polite">
          {formatMessage(settingsMessages.presetUnavailableWarning)}
        </InlineNote>
      )}
    </div>
  );
};
