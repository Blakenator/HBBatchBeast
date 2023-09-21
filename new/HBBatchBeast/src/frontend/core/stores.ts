import { create } from 'zustand';
import { GlobalAppConfig, RunBatchOperationResult } from '../../common';
import { useEffect } from 'react';
import { isEqual } from 'lodash';
import { AppError } from '@superflag/super-ipc/common';

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
      const { setValue, value } = useStore((state) => ({
        value: state.value,
        setValue: state.setValue,
      }));

      useEffect(() => {
        if (!isEqual(data, value)) {
          setValue(data);
        }
      }, [data]);

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
