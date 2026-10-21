import {
  BatchConfig,
  PROMISE_CHANNEL,
  DeepPartial,
  GlobalAppConfig,
} from '../../common';
import { useCallback, useEffect, useState } from 'react';
import { useBackend } from '../helpers';
import { cloneDeep, debounce, isEqual, merge } from 'lodash';
import { toast } from 'react-toastify';
import { useIntl } from 'react-intl';
import { settingsMessages } from './messages';
import { useSetGlobalConfigDirect } from '../core/stores';

export function useUpdateConfigDebounced(config: GlobalAppConfig) {
  const { formatMessage } = useIntl();
  const [updatedConfig, setUpdatedConfig] = useState(config);
  const setGlobalConfig = useSetGlobalConfigDirect();
  const { refetch } = useBackend({
    channel: PROMISE_CHANNEL.SaveConfiguration,
    skip: true,
  });
  const debouncedUpdate = useCallback(
    debounce(
      (args: GlobalAppConfig) =>
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
  const currentConfig = updatedConfig.configs[updatedConfig.selected_config];

  const mergeUpdate = (update: DeepPartial<BatchConfig>) =>
    setUpdatedConfig((recent) => {
      const newConfig = cloneDeep(recent);
      newConfig.configs[newConfig.selected_config] = merge(
        newConfig.configs[newConfig.selected_config],
        update,
      );
      return newConfig;
    });

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
  return { currentConfig, mergeUpdate };
}
