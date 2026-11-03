import React, { useState } from 'react';
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
import { PlexSettings } from './PlexSettings';
import { DiagnosticsPanel } from '../diagnostics/DiagnosticsPanel';
import { Icon } from '../ui/Icon';
import type { AppIconName } from '../ui/icons';
import { LibraryHeader } from './library/LibraryHeader';
import { LibraryEditor } from './library/LibraryEditor';
import { OrganizerSettings } from './organizer/OrganizerSettings';
import { SegmentedControl } from './SegmentedControl';
import { PresetManager } from '../presets/PresetManager';

interface SettingsFormProps {
  config: AppConfigV2;
}

const tabTitle = (icon: AppIconName, label: string) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--hb-space-xs)',
    }}
  >
    <Icon name={icon} size="sm" />
    {label}
  </span>
);

export const SettingsForm: React.FC<SettingsFormProps> = ({ config }) => {
  const { formatMessage } = useIntl();
  const [tab, setTab] = useState('global');
  const [librarySection, setLibrarySection] = useState<
    'encoding' | 'organizer'
  >('encoding');
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
    if (!currentLibrary || currentGlobalConfig.libraries.length <= 1) return;
    const libraries = currentGlobalConfig.libraries.filter(
      (library) => library.id !== currentLibrary.id,
    );
    mergeAppUpdate({
      libraries,
      selected_library: libraries[0]?.id ?? '',
    });
  };

  const globalSettings = resolveGlobalSettings(currentGlobalConfig);

  return (
    <div>
      <Tabs
        activeKey={tab}
        onSelect={(key) => setTab(key ?? 'global')}
        className="mb-3"
      >
        <Tab
          eventKey="global"
          title={tabTitle(
            'globalSettings',
            formatMessage(settingsMessages.globalSettings),
          )}
        >
          <div style={{ paddingTop: 'var(--hb-space-sm)' }}>
            {tab !== 'global' ? null : (
              <>
            <LanguageSelect config={currentGlobalConfig} />
            <GlobalSystemSettings
              value={globalSettings}
              onChange={(update) => mergeAppUpdate({ app_settings: update })}
            />
            <PlexSettings
              value={currentGlobalConfig.app_settings?.plex}
              onChange={(plex) =>
                mergeAppUpdate({
                  app_settings: {
                    ...currentGlobalConfig.app_settings,
                    plex,
                  },
                })
              }
            />
            <div style={{ marginTop: 'var(--hb-space-lg)' }}>
              <DiagnosticsPanel />
            </div>
              </>
            )}
          </div>
        </Tab>

        <Tab
          eventKey="libraries"
          title={tabTitle(
            'libraries',
            formatMessage(settingsMessages.librarySettings),
          )}
        >
          <div style={{ paddingTop: 'var(--hb-space-sm)' }}>
            {tab !== 'libraries' ? null : (
              <>
                <LibraryHeader
                  config={currentGlobalConfig}
                  library={currentLibrary}
                  onSelect={selectLibrary}
                  onCreate={addLibrary}
                  onDuplicate={duplicateLibrary}
                  onChange={(library) =>
                    updateLibrary(() => library, library.id)
                  }
                  onDelete={deleteLibrary}
                />
                {currentLibrary ? (
                  <>
                    <div style={{ marginTop: 'var(--hb-space-md)' }}>
                      <SegmentedControl
                        label={formatMessage(settingsMessages.librarySections)}
                        value={librarySection}
                        onChange={(value) =>
                          setLibrarySection(
                            value === 'organizer' ? 'organizer' : 'encoding',
                          )
                        }
                        options={[
                          {
                            value: 'encoding',
                            label: formatMessage(
                              settingsMessages.encodingSection,
                            ),
                          },
                          {
                            value: 'organizer',
                            label: formatMessage(
                              settingsMessages.organizerSection,
                            ),
                          },
                        ]}
                      />
                    </div>
                    <div style={{ marginTop: 'var(--hb-space-md)' }}>
                      {librarySection === 'encoding' ? (
                        <LibraryEditor
                          config={currentGlobalConfig}
                          library={currentLibrary}
                          showIdentity={false}
                          onChange={(library) =>
                            updateLibrary(() => library, library.id)
                          }
                        />
                      ) : (
                        <OrganizerSettings
                          config={currentGlobalConfig}
                          library={currentLibrary}
                          onChange={(library) =>
                            updateLibrary(() => library, library.id)
                          }
                        />
                      )}
                    </div>
                  </>
                ) : null}
              </>
            )}
          </div>
        </Tab>

        <Tab
          eventKey="presets"
          title={tabTitle(
            'presets',
            formatMessage(settingsMessages.presetSettings),
          )}
        >
          <div style={{ paddingTop: 'var(--hb-space-sm)' }}>
            {tab === 'presets' ? (
              <PresetManager
                config={currentGlobalConfig}
                onChange={(presets) => mergeAppUpdate({ presets })}
                scan={presetScan.data}
                loading={presetScan.loading}
                onRefresh={presetScan.refresh}
              />
            ) : null}
          </div>
        </Tab>
      </Tabs>
    </div>
  );
};
