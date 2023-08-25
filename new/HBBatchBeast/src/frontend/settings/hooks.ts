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

export function useUpdateConfigDebounced(config: GlobalAppConfig) {
  const { formatMessage } = useIntl();
  const [updatedConfig, setUpdatedConfig] = useState(config);
  const { refetch } = useBackend({
    channel: PROMISE_CHANNEL.SaveConfiguration,
    skip: true,
  });
  const debouncedUpdate = useCallback(
    debounce(
      (args) =>
        refetch(args).then(({ error }) => {
          if (!error) {
            toast.success(formatMessage(settingsMessages.savedConfig));
          } else {
            toast.error(error.message);
          }
        }),
      1000,
    ),
    [refetch],
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
