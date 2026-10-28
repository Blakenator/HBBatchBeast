import React from 'react';
import { Tab, Tabs } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import {
  AppConfigV2,
  DEFAULT_PRESET,
  cloneEmptyLibrary,
  createPresetId,
  emptyLibrary,
  resolveGlobalSettings,
} from '../../common';
import { useHandBrakePresets, useUpdateAppConfigDebounced } from './hooks';
import { settingsMessages } from './messages';
import { LanguageSelect } from './LanguageSelect';
import { GlobalSystemSettings } from './GlobalSystemSettings';
import { DiagnosticsPanel } from '../diagnostics/DiagnosticsPanel';
import { LibraryBar } from './library/LibraryBar';
import { LibraryEditor } from './library/LibraryEditor';
import { PresetManager } from '../presets/PresetManager';

interface SettingsFormProps {
  config: AppConfigV2;
}

export const SettingsForm: React.FC<SettingsFormProps> = ({ config }) => {
  const { formatMessage } = useIntl();
  const {
    currentLibrary,
    currentGlobalConfig,
    mergeAppUpdate,
    updateLibrary,
    selectLibrary,
  } = useUpdateAppConfigDebounced(config);
  const presetScan = useHandBrakePresets(
    currentGlobalConfig.presets.some((preset) => preset.handbrake),
  );

  const addLibrary = () => {
    const existingPreset = currentGlobalConfig.presets[0];
    const preset = existingPreset ?? {
      ...DEFAULT_PRESET,
      id: createPresetId(),
    };
    const library = emptyLibrary({
      name: `Library ${currentGlobalConfig.libraries.length + 1}`,
      defaultPresetId: preset.id,
    });
    if (preset.ffmpeg) {
      library.encoder = 'ffmpeg';
      library.container = '.mp4';
    }
    mergeAppUpdate({
      presets: existingPreset
        ? currentGlobalConfig.presets
        : [...currentGlobalConfig.presets, preset],
      libraries: [...currentGlobalConfig.libraries, library],
      selected_library: library.id,
    });
  };

  const duplicateLibrary = () => {
    if (!currentLibrary) return;
    const copy = cloneEmptyLibrary(currentLibrary, `Copy of ${currentLibrary.name}`);
    mergeAppUpdate({
      libraries: [...currentGlobalConfig.libraries, copy],
      selected_library: copy.id,
    });
  };

  const deleteLibrary = () => {
    if (currentGlobalConfig.libraries.length <= 1) return;
    const libraries = currentGlobalConfig.libraries.filter(
      (library) => library.id !== currentGlobalConfig.selected_library,
    );
    mergeAppUpdate({
      libraries,
      selected_library: libraries[0]?.id ?? '',
    });
  };

  const globalSettings = resolveGlobalSettings(currentGlobalConfig);

  return (
    <div>
      <Tabs defaultActiveKey="libraries" className="mb-3">
        <Tab
          eventKey="global"
          title={formatMessage(settingsMessages.globalSettings)}
        >
          <div style={{ paddingTop: 'var(--hb-space-sm)' }}>
            <LanguageSelect config={currentGlobalConfig} />
            <GlobalSystemSettings
              value={globalSettings}
              onChange={(update) =>
                mergeAppUpdate({ app_settings: update })
              }
            />
            <div style={{ marginTop: 'var(--hb-space-lg)' }}>
              <DiagnosticsPanel />
            </div>
          </div>
        </Tab>

        <Tab
          eventKey="libraries"
          title={formatMessage(settingsMessages.librarySettings)}
        >
          <div style={{ paddingTop: 'var(--hb-space-sm)' }}>
            <LibraryBar
              config={currentGlobalConfig}
              onSelect={selectLibrary}
              onCreate={addLibrary}
              onDuplicate={duplicateLibrary}
              onRename={(libraryId, name) =>
                updateLibrary(
                  (library) => ({ ...library, name: name.trim() || library.name }),
                  libraryId,
                )
              }
              onDelete={deleteLibrary}
            />
            <div style={{ marginTop: 'var(--hb-space-md)' }}>
              {currentLibrary ? (
                <LibraryEditor
                  config={currentGlobalConfig}
                  library={currentLibrary}
                  onChange={(library) =>
                    updateLibrary(() => library, library.id)
                  }
                />
              ) : null}
            </div>
          </div>
        </Tab>

        <Tab
          eventKey="presets"
          title={formatMessage(settingsMessages.presetSettings)}
        >
          <div style={{ paddingTop: 'var(--hb-space-sm)' }}>
            <PresetManager
              config={currentGlobalConfig}
              onChange={(presets) => mergeAppUpdate({ presets })}
              scan={presetScan.data}
              loading={presetScan.loading}
              onRefresh={presetScan.refresh}
            />
          </div>
        </Tab>
      </Tabs>
    </div>
  );
};
