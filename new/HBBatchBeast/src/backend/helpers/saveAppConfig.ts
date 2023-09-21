import { GlobalAppConfig } from '../../common';
import fs from 'fs';
import { AppError } from '@superflag/super-ipc/common';

export function saveAppConfig(configPath: string, config: GlobalAppConfig) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (err) {
    throw new AppError('Error persisting new app config', { inner: err });
  }
}
