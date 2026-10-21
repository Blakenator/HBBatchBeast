import React, { useState } from 'react';
import styled from 'styled-components';
import { Form } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import { parseTokenList, serializeTokenList } from '../../common';
import { Button } from '../ui/Button';
import { settingsMessages } from './messages';

interface TokenListEditorProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  normalize?: (token: string) => string;
  defaults?: string[];
  defaultsLabel?: string;
  describedBy?: string;
}

const Box = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--hb-space-xs);
  padding: var(--hb-space-xs);
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-sm);
  background: var(--hb-surface);
`;

const Chip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: var(--hb-space-xs);
  padding: 1px var(--hb-space-xs);
  border-radius: var(--hb-radius-sm);
  background: var(--hb-surfaceMuted);
  font-size: var(--hb-font-sm);
`;

const ChipRemove = styled.button`
  border: 0;
  background: transparent;
  color: var(--hb-textMuted);
  cursor: pointer;
  font: inherit;
  line-height: 1;
  padding: 0 2px;

  &:hover {
    color: var(--hb-danger);
  }
`;

const Entry = styled(Form.Control)`
  flex: 1;
  min-width: 140px;
  border: 0;
  box-shadow: none !important;
  background: transparent;
  padding: var(--hb-space-xs);

  &:focus {
    background: transparent;
  }
`;

/** Comma-separated values edited as removable chips. */
export const TokenListEditor: React.FC<TokenListEditorProps> = ({
  id,
  value,
  onChange,
  placeholder,
  normalize = (token) => token.trim(),
  defaults,
  defaultsLabel,
  describedBy,
}) => {
  const { formatMessage } = useIntl();
  const [draft, setDraft] = useState('');
  const tokens = parseTokenList(value);

  const commit = (raw: string) => {
    const additions = parseTokenList(raw)
      .map(normalize)
      .filter((token) => token.length > 0);
    if (additions.length === 0) {
      setDraft('');
      return;
    }

    const next = [...tokens];
    for (const addition of additions) {
      if (!next.some((token) => normalize(token) === addition)) {
        next.push(addition);
      }
    }
    onChange(serializeTokenList(next));
    setDraft('');
  };

  const remove = (index: number) => {
    onChange(serializeTokenList(tokens.filter((_token, i) => i !== index)));
  };

  return (
    <div>
      <Box>
        {tokens.map((token, index) => (
          <Chip key={`${token}-${index}`}>
            {token}
            <ChipRemove
              type="button"
              aria-label={formatMessage(settingsMessages.removeToken, { token })}
              onClick={() => remove(index)}
            >
              ×
            </ChipRemove>
          </Chip>
        ))}
        <Entry
          id={id}
          value={draft}
          placeholder={tokens.length === 0 ? placeholder : undefined}
          aria-describedby={describedBy}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault();
              commit(draft);
            } else if (event.key === 'Backspace' && draft === '' && tokens.length > 0) {
              remove(tokens.length - 1);
            }
          }}
          onPaste={(event) => {
            const text = event.clipboardData.getData('text');
            if (/[,\r\n]/.test(text)) {
              event.preventDefault();
              commit(text);
            }
          }}
        />
      </Box>
      {tokens.length === 0 && defaults && defaults.length > 0 && (
        <Button
          compact
          variant="ghost"
          style={{ marginTop: 'var(--hb-space-xs)' }}
          onClick={() => commit(defaults.join(','))}
        >
          {defaultsLabel ?? formatMessage(settingsMessages.addDefaults)}
        </Button>
      )}
    </div>
  );
};
