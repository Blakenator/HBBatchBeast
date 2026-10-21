import React from 'react';
import { Form } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import { GlobalAppConfig, PROMISE_CHANNEL } from '../../common';
import { useBackend } from '../helpers';
import { settingsMessages } from './messages';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'it', label: 'Italiano' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'pl', label: 'Polski' },
  { code: 'pt', label: 'Português' },
  { code: 'ru', label: 'Русский' },
  { code: 'ja', label: '日本語' },
  { code: 'zh-CN', label: '中文（简体）' },
];

export const resolveLanguage = (): string =>
  window.localStorage.getItem('hbb.lang') ??
  (navigator.language ?? 'en-US').split('-')[0];

interface LanguageSelectProps {
  config: GlobalAppConfig;
}

export const LanguageSelect: React.FC<LanguageSelectProps> = ({ config }) => {
  const { formatMessage } = useIntl();
  const save = useBackend({
    channel: PROMISE_CHANNEL.SaveConfiguration,
    skip: true,
  });

  const change = (code: string) => {
    window.localStorage.setItem('hbb.lang', code);
    void save.refetch({ ...config, lang: code }).then(() => {
      // Messages are loaded at provider mount, so reload to apply them.
      window.location.reload();
    });
  };

  return (
    <div style={{ marginBottom: 'var(--hb-space-md)' }}>
      <Form.Label htmlFor="language-select">
        {formatMessage(settingsMessages.language)}
      </Form.Label>
      <Form.Select
        id="language-select"
        value={resolveLanguage()}
        onChange={(event) => change(event.target.value)}
      >
        {LANGUAGES.map((language) => (
          <option key={language.code} value={language.code}>
            {language.label}
          </option>
        ))}
      </Form.Select>
    </div>
  );
};
