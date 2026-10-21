import { describe, expect, it } from 'vitest';
import {
  migrateGlobalSettings,
  resolveGlobalSettings,
} from '../src/common/appSettings';
import { GlobalAppConfig } from '../src/common';

const config: GlobalAppConfig = {
  lang: 'en',
  selected_config: 1,
  version_message: 'test',
  configs: [
    {
      name: 'First',
      tab_batch: {},
      tab_system: {
        worker_instance_number: '2',
        save_worker_logs_toggle: 0,
      },
    },
    {
      name: 'Second',
      tab_batch: {},
      tab_system: {
        worker_instance_number: '6',
        save_worker_logs_toggle: 1,
      },
    },
  ],
};

describe('global app settings', () => {
  it('migrates legacy settings from the active profile to the app config', () => {
    const migrated = migrateGlobalSettings(config);

    expect(migrated.app_settings).toEqual({
      worker_instance_number: '6',
      save_worker_logs_toggle: 1,
    });
    expect(
      resolveGlobalSettings({ ...migrated, selected_config: 0 }),
    ).toEqual(migrated.app_settings);
  });

  it('keeps existing global values even when legacy profile values differ', () => {
    const migrated = migrateGlobalSettings({
      ...config,
      app_settings: {
        worker_instance_number: '3',
        save_worker_logs_toggle: 0,
      },
    });

    expect(
      resolveGlobalSettings({ ...migrated, selected_config: 0 }),
    ).toEqual({
      worker_instance_number: '3',
      save_worker_logs_toggle: 0,
    });
  });

  it('fills missing global values from legacy settings only during migration', () => {
    const migrated = migrateGlobalSettings({
      ...config,
      app_settings: { worker_instance_number: '5' },
    });

    expect(migrated.app_settings).toEqual({
      worker_instance_number: '5',
      save_worker_logs_toggle: 1,
    });
  });
});
