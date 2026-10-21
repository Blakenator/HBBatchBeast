import { GlobalAppConfig, GlobalSettingsConfig } from './types';

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettingsConfig = {
  worker_instance_number: '4',
  save_worker_logs_toggle: 0,
};

/**
 * Reads app-wide settings while remaining compatible with values saved inside
 * profile `tab_system` objects by older versions.
 */
export function resolveGlobalSettings(
  config: GlobalAppConfig,
): GlobalSettingsConfig {
  const legacy = config.configs[config.selected_config]?.tab_system;
  return {
    worker_instance_number:
      config.app_settings?.worker_instance_number ??
      legacy?.worker_instance_number ??
      DEFAULT_GLOBAL_SETTINGS.worker_instance_number,
    save_worker_logs_toggle:
      config.app_settings?.save_worker_logs_toggle ??
      legacy?.save_worker_logs_toggle ??
      DEFAULT_GLOBAL_SETTINGS.save_worker_logs_toggle,
  };
}

/** Promotes the active profile's legacy values once, keeping them global thereafter. */
export function migrateGlobalSettings(
  config: GlobalAppConfig,
): GlobalAppConfig {
  if (
    config.app_settings?.worker_instance_number !== undefined &&
    config.app_settings.save_worker_logs_toggle !== undefined
  ) {
    return config;
  }

  return {
    ...config,
    app_settings: resolveGlobalSettings(config),
  };
}
