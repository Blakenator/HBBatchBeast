import { create } from 'zustand';
import { GlobalAppConfig, RunBatchOperationResult } from '../../common';
import { useEffect } from 'react';
import { isEqual } from 'lodash';
import { AppError } from '@superflag/super-ipc-core';

interface SimpleStore<T> {
  value: T;
  setValue: (res?: T) => void;
}

function createSimpleStore<T>(initialValue?: T) {
  const useStore = create<SimpleStore<T>>((set) => ({
    value: initialValue,
    setValue: (res) => set({ value: res }),
  }));
  const useValue = () => useStore((state) => state.value) as T;
  return {
    useStore,
    useValue,
    useValueRequired: () =>
      useStore((state) => {
        if (!state.value) {
          throw new AppError('Missing state for required simple store');
        }
        return state.value!;
      }),
    useSetValue: (data?: T) => {
      // Select fields individually: returning a fresh object from a zustand v5
      // selector makes useSyncExternalStore loop forever.
      const value = useStore((state) => state.value);
      const setValue = useStore((state) => state.setValue);

      useEffect(() => {
        if (!isEqual(data, value)) {
          setValue(data);
        }
      }, [data, value, setValue]);

      return setValue;
    },
  };
}

export const {
  useValue: useBatchResult,
  useValueRequired: useSetBatchResultRequired,
  useSetValue: useSetBatchResult,
} = createSimpleStore<RunBatchOperationResult | undefined>();

export const {
  useValue: useGlobalConfig,
  useValueRequired: useGlobalConfigRequired,
  useSetValue: useSetGlobalConfig,
} = createSimpleStore<GlobalAppConfig | undefined>();
