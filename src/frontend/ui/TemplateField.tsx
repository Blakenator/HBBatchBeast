import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { Form } from 'react-bootstrap';
import {
  formatTokenSnippet,
  parseTemplateSegments,
  renderTemplateExample,
  serializeTemplateSegments,
  templateTokenCatalog,
  tokenQueryAt,
  type MediaType,
  type TemplateSegment,
} from '../../common';
import { TokenBox, TokenChip } from './Tokens';

const DEFAULT_PADDING: Record<string, string> = {
  season: '02',
  episode: '02',
};

const Wrap = styled.div`
  position: relative;
  display: grid;
  gap: var(--hb-space-xs);
`;

const EditorBox = styled(TokenBox)`
  cursor: text;
  /* Chips sit flush against the text; the space before a chip is only the
     literal space the user typed. */
  gap: 0;
  row-gap: 2px;
`;

const TextRun = styled(Form.Control)`
  flex: 0 1 auto;
  min-width: 1ch;
  border: 0;
  box-shadow: none !important;
  background: transparent;
  padding: 0;
  font: inherit;
  font-size: var(--hb-font-sm);
  height: auto;

  &:focus {
    background: transparent;
  }
`;

const EditorChip = styled(TokenChip)`
  margin: 0 1px;

  code {
    font-size: var(--hb-font-sm);
  }
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

const PopoverBox = styled.ul`
  position: absolute;
  z-index: 1050;
  top: calc(100% + 2px);
  left: 0;
  min-width: min(420px, 100%);
  max-height: 280px;
  margin: 0;
  padding: var(--hb-space-xs) 0;
  overflow-y: auto;
  list-style: none;
  background: var(--hb-surface);
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-sm);
  box-shadow: var(--hb-shadow-md, 0 6px 18px rgba(0, 0, 0, 0.18));
`;

const Option = styled.li<{ $active: boolean }>`
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: var(--hb-space-sm);
  row-gap: 2px;
  padding: var(--hb-space-xs) var(--hb-space-sm);
  cursor: pointer;
  font-size: var(--hb-font-xs);
  background: ${({ $active }) =>
    $active ? 'var(--hb-surfaceMuted)' : 'transparent'};

  code {
    color: var(--hb-accent);
    font-size: var(--hb-font-xs);
  }
`;

const OptionDetail = styled.span`
  grid-column: 2;
  color: var(--hb-textMuted);
`;

const Example = styled.div`
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
  overflow-wrap: anywhere;

  code {
    color: var(--hb-text);
  }
`;

const ErrorText = styled.span`
  color: var(--hb-danger);
`;

interface TemplateFieldProps {
  id: string;
  label: string;
  value: string;
  mediaType: MediaType;
  onChange: (value: string) => void;
  placeholder?: string;
}

function normalizeSegments(segments: TemplateSegment[]): TemplateSegment[] {
  const merged: TemplateSegment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (segment.kind === 'text' && previous?.kind === 'text') {
      merged[merged.length - 1] = {
        kind: 'text',
        text: previous.text + segment.text,
      };
      continue;
    }
    merged.push({ ...segment });
  }
  return merged;
}

/**
 * Template editor with token chips.
 *
 * Typing `{` opens the variable list for the current media type; choosing one
 * inserts a deletable chip. The example line underneath always shows what the
 * template produces with representative data.
 */
export const TemplateField: React.FC<TemplateFieldProps> = ({
  id,
  label,
  value,
  mediaType,
  onChange,
  placeholder,
}) => {
  const listId = useId();
  const exampleId = `${id}-example`;
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const [open, setOpen] = useState<
    { index: number; start: number; query: string } | undefined
  >();
  const [active, setActive] = useState(0);
  const [focus, setFocus] = useState<'trailing' | number | undefined>();

  const segments = useMemo(() => {
    const parsed = parseTemplateSegments(value);
    return parsed.length === 0
      ? [{ kind: 'text', text: '' } as TemplateSegment]
      : parsed;
  }, [value]);

  // A chip at the end still needs an input after it so typing can continue.
  const last = segments[segments.length - 1];
  const renderSegments: TemplateSegment[] =
    last && last.kind === 'token'
      ? [...segments, { kind: 'text', text: '' }]
      : segments;

  const catalog = useMemo(() => templateTokenCatalog(mediaType), [mediaType]);
  const options = useMemo(() => {
    if (!open) return [];
    const query = open.query.toLowerCase();
    if (!query) return catalog;
    return catalog.filter(
      (token) =>
        token.name.toLowerCase().includes(query) ||
        token.label.toLowerCase().includes(query),
    );
  }, [catalog, open]);

  useEffect(() => {
    if (focus === undefined) return;
    const index = focus === 'trailing' ? renderSegments.length - 1 : focus;
    const input = inputs.current[index];
    input?.focus();
    input?.setSelectionRange(
      input.value.length,
      input.value.length,
    );
    setFocus(undefined);
  }, [focus, renderSegments.length]);

  const commit = (next: TemplateSegment[]) => {
    onChange(serializeTemplateSegments(normalizeSegments(next)));
  };

  const updateText = (index: number, text: string, caret: number) => {
    const next = renderSegments.map((segment, position) =>
      position === index && segment.kind === 'text'
        ? { kind: 'text' as const, text }
        : segment,
    );
    commit(next);
    const query = tokenQueryAt(text, caret);
    if (query) {
      setOpen({ index, start: query.start, query: query.query });
      setActive(0);
      return;
    }
    setOpen(undefined);
  };

  const choose = (name: string) => {
    if (!open) return;
    const segment = renderSegments[open.index];
    if (!segment || segment.kind !== 'text') return;
    const before = segment.text.slice(0, open.start);
    const after = segment.text.slice(open.start + 1 + open.query.length);
    const next: TemplateSegment[] = renderSegments.map((candidate, position) =>
      position === open.index
        ? { kind: 'text' as const, text: before }
        : candidate,
    );
    next.splice(
      open.index + 1,
      0,
      {
        kind: 'token',
        name,
        ...(DEFAULT_PADDING[name] ? { padding: DEFAULT_PADDING[name] } : {}),
      },
      ...(after ? [{ kind: 'text' as const, text: after }] : []),
      { kind: 'text' as const, text: '' },
    );
    commit(next);
    setOpen(undefined);
    setFocus('trailing');
  };

  const removeToken = (index: number) => {
    commit(renderSegments.filter((_, position) => position !== index));
    setFocus(index > 0 ? index - 1 : 0);
  };

  const handleKeyDown = (
    index: number,
    event: React.KeyboardEvent<HTMLElement>,
  ) => {
    if (open) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((current) =>
          options.length === 0 ? 0 : (current + 1) % options.length,
        );
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((current) =>
          options.length === 0
            ? 0
            : (current - 1 + options.length) % options.length,
        );
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const option = options[active];
        if (option) choose(option.name);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(undefined);
        return;
      }
    }
    const segment = renderSegments[index];
    if (
      event.key === 'Backspace' &&
      index > 0 &&
      segment?.kind === 'text' &&
      segment.text === '' &&
      ((event.currentTarget as HTMLInputElement).selectionStart ?? 0) === 0
    ) {
      event.preventDefault();
      const previous = renderSegments[index - 1];
      if (previous?.kind === 'token') {
        removeToken(index - 1);
      } else {
        setFocus(index - 1);
      }
    }
  };

  const example = renderTemplateExample(value, mediaType);

  return (
    <Wrap>
      <Form.Label htmlFor={`${id}-input-0`} id={`${id}-label`}>
        {label}
      </Form.Label>
      <EditorBox
        role="group"
        aria-labelledby={`${id}-label`}
        aria-describedby={exampleId}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            setFocus('trailing');
          }
        }}
      >
        {renderSegments.map((segment, index) =>
          segment.kind === 'text' ? (
            <TextRun
              key={`text-${index}`}
              id={`${id}-input-${index}`}
              ref={(element: HTMLInputElement | null) => {
                inputs.current[index] = element;
              }}
              style={{
                flex: '0 1 auto',
                // Chromium supports content-sized fields, which removes the
                // slack a `ch`-based width leaves before a chip.
                width: 'auto',
                fieldSizing: 'content',
                minWidth: '1ch',
                maxWidth: '100%',
                border: 0,
                boxShadow: 'none',
                background: 'transparent',
                padding: 0,
              }}
              aria-label={index === 0 ? label : `${label} (continued)`}
              aria-autocomplete="list"
              aria-expanded={Boolean(open)}
              aria-controls={open ? listId : undefined}
              value={segment.text}
              placeholder={renderSegments.length === 1 ? placeholder : undefined}
              onChange={(event) =>
                updateText(
                  index,
                  event.target.value,
                  event.target.selectionStart ?? event.target.value.length,
                )
              }
              onKeyDown={(event) => handleKeyDown(index, event)}
              onBlur={() => setOpen(undefined)}
            />
          ) : (
            <EditorChip key={`token-${index}-${segment.name}`}>
              <code>{formatTokenSnippet(segment.name, segment.padding)}</code>
              <ChipRemove
                type="button"
                aria-label={`Remove ${segment.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  removeToken(index);
                }}
              >
                ×
              </ChipRemove>
            </EditorChip>
          ),
        )}
      </EditorBox>

      {open && (
        <PopoverBox id={listId} role="listbox" aria-label="Template variables">
          {options.length === 0 ? (
            <Option $active={false}>
              <code>{`{${open.query}`}</code>
              <OptionDetail>No matching variable.</OptionDetail>
            </Option>
          ) : (
            options.map((option, index) => (
              <Option
                key={option.name}
                role="option"
                aria-selected={index === active}
                $active={index === active}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(option.name);
                }}
              >
                <code>
                  {formatTokenSnippet(
                    option.name,
                    DEFAULT_PADDING[option.name],
                  )}
                </code>
                <span>{option.label}</span>
                <OptionDetail>{option.description}</OptionDetail>
                <OptionDetail>Example: {option.example}</OptionDetail>
              </Option>
            ))
          )}
        </PopoverBox>
      )}

      <Example id={exampleId}>
        Example: <code>{example.text || '—'}</code>
        {example.unknownTokens.length > 0 && (
          <ErrorText>
            {' '}
            · Unknown variable
            {example.unknownTokens.length > 1 ? 's' : ''}:{' '}
            {example.unknownTokens.map((token) => `{${token}}`).join(', ')}
          </ErrorText>
        )}
      </Example>
    </Wrap>
  );
};
