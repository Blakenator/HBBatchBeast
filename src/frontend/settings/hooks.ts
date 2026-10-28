import {
  AppConfigV2,
  DeepPartial,
  Library,
  PROMISE_CHANNEL,
} from '../../common';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useBackend } from '../helpers';
import { cloneDeep, debounce, isEqual, mergeWith } from 'lodash';
import { toast } from 'react-toastify';
import { useIntl } from 'react-intl';
import { settingsMessages } from './messages';
import { useSetGlobalConfigDirect } from '../core/stores';

/** Replaces arrays instead of index-merging them (filter children, rules). */
function replaceArrays(_target: unknown, source: unknown): unknown {
  return Array.isArray(source) ? source : undefined;
}

export function useUpdateAppConfigDebounced(config: AppConfigV2) {
  const { formatMessage } = useIntl();
  const [updatedConfig, setUpdatedConfig] = useState(config);
  const setGlobalConfig = useSetGlobalConfigDirect();
  const { refetch } = useBackend({
    channel: PROMISE_CHANNEL.SaveConfiguration,
    skip: true,
  });
  const debouncedUpdate = useCallback(
    debounce(
      (args: AppConfigV2) =>
        refetch(args).then(({ error }) => {
          if (!error) {
            // Keep the shared store in step with what was just persisted so the
            // run screen does not keep showing the previous settings.
            setGlobalConfig(args);
            toast.success(formatMessage(settingsMessages.savedConfig));
          } else {
            toast.error(error.message);
          }
        }),
      1000,
    ),
    [refetch, setGlobalConfig],
  );

  const mergeAppUpdate = (update: DeepPartial<AppConfigV2>) =>
    setUpdatedConfig((recent) =>
      mergeWith(cloneDeep(recent), update, replaceArrays),
    );

  const updateLibrary = (
    updater: (library: Library) => Library,
    libraryId?: string,
  ) =>
    setUpdatedConfig((recent) => {
      const id = libraryId ?? recent.selected_library;
      return {
        ...recent,
        libraries: recent.libraries.map((library) =>
          library.id === id ? updater(library) : library,
        ),
      };
    });

  const selectLibrary = (libraryId: string) =>
    setUpdatedConfig((recent) => ({
      ...recent,
      selected_library: libraryId,
    }));

  const currentLibrary =
    updatedConfig.libraries.find(
      (library) => library.id === updatedConfig.selected_library,
    ) ?? updatedConfig.libraries[0];

  useEffect(() => {
    if (!isEqual(config, updatedConfig)) {
      setUpdatedConfig(config);
    }
  }, [config]);

  useEffect(() => {
    if (!isEqual(config, updatedConfig)) {
      debouncedUpdate(updatedConfig);
    }
  }, [updatedConfig]);

  return {
    currentLibrary,
    currentGlobalConfig: updatedConfig,
    mergeAppUpdate,
    mergeGlobalUpdate: (update: DeepPartial<AppConfigV2>) =>
      mergeAppUpdate(update),
    updateLibrary,
    selectLibrary,
  };
}

/** Loads HandBrake's installed presets once, and on explicit refresh. */
export function useHandBrakePresets(enabled: boolean) {
  const backend = useBackend({
    channel: PROMISE_CHANNEL.ListHandBrakePresets,
    skip: true,
  });
  // `refetch` is recreated whenever the hook's loading state changes, so it
  // must not be an effect dependency: doing that re-triggers the request the
  // moment the previous one finishes, spawning HandBrakeCLI in a loop.
  const backendRef = useRef(backend);
  backendRef.current = backend;
  const requested = useRef(false);

  useEffect(() => {
    if (!enabled || requested.current) return;
    requested.current = true;
    void backendRef.current.refetch({ refresh: false });
  }, [enabled]);

  const refresh = useCallback(() => {
    void backendRef.current.refetch({ refresh: true });
  }, []);

  return { ...backend, refresh };
}
