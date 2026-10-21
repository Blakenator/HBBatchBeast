import { create } from 'zustand';
import { GlobalAppConfig, RunBatchOperationResult } from '../../common';
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
    /**
     * Setter only. A "mirror this prop into the store" variant used to exist and
     * silently reset the store whenever it was called with no argument, so
     * callers that need to sync fetched data do it in their own effect.
     */
    useSetter: () => useStore((state) => state.setValue),
    useValueRequired: () =>
      useStore((state) => {
        if (!state.value) {
          throw new AppError('Missing state for required simple store');
        }
        return state.value!;
      }),
  };
}

export const {
  useValue: useBatchResult,
  useValueRequired: useSetBatchResultRequired,
  useSetter: useSetBatchResultDirect,
} = createSimpleStore<RunBatchOperationResult | undefined>();

export const {
  useValue: useGlobalConfig,
  useValueRequired: useGlobalConfigRequired,
  useSetter: useSetGlobalConfigDirect,
} = createSimpleStore<GlobalAppConfig | undefined>();
