import React, { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { Form } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import { shellMessages } from './messages';

export interface ComboboxOption {
  value: string;
  label: string;
  title?: string;
  /** Optional heading rendered above the first option in the group. */
  group?: string;
}

interface ComboboxProps {
  id: string;
  value: string;
  options: ComboboxOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  placeholder?: string;
  /** Keeps text that does not match an option (custom preset names, arguments). */
  allowCustom?: boolean;
  disabled?: boolean;
  describedBy?: string;
}

const Wrap = styled.div`
  position: relative;

  > .form-control {
    padding-right: 2.25rem;
  }
`;

const Caret = styled.span<{ $open: boolean }>`
  position: absolute;
  top: 50%;
  right: 0.85rem;
  width: 0;
  height: 0;
  border-right: 4px solid transparent;
  border-left: 4px solid transparent;
  border-top: 5px solid var(--hb-textMuted);
  transform: translateY(-50%) rotate(${({ $open }) => ($open ? 180 : 0)}deg);
  transition: transform 120ms ease;
  pointer-events: none;
`;

const Menu = styled.ul`
  position: absolute;
  z-index: 1050;
  top: calc(100% + 2px);
  left: 0;
  right: 0;
  max-height: 280px;
  margin: 0;
  padding: var(--hb-space-xs) 0;
  overflow-y: auto;
  list-style: none;
  background: var(--hb-surface);
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-sm);
  box-shadow: 0 8px 24px rgb(0 0 0 / 18%);
`;

const GroupHeading = styled.li`
  padding: var(--hb-space-xs) var(--hb-space-sm);
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const Option = styled.li<{ $active: boolean }>`
  padding: var(--hb-space-xs) var(--hb-space-sm);
  cursor: pointer;
  font-size: var(--hb-font-sm);
  color: var(--hb-text);
  background: ${({ $active }) =>
    $active ? 'var(--hb-surfaceMuted)' : 'transparent'};

  &:hover {
    background: var(--hb-surfaceMuted);
  }
`;

const Empty = styled.li`
  padding: var(--hb-space-xs) var(--hb-space-sm);
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
`;

/**
 * Text input with a filtered option list: type to narrow the list, then click
 * or press Enter to choose. With `allowCustom`, unmatched text is kept as the
 * value, which lets the preset field also accept raw HandBrakeCLI arguments.
 */
export const Combobox: React.FC<ComboboxProps> = ({
  id,
  value,
  options,
  onChange,
  ariaLabel,
  placeholder,
  allowCustom = false,
  disabled,
  describedBy,
}) => {
  const { formatMessage } = useIntl();
  const selected = options.find((option) => option.value === value);
  const selectedLabel = selected?.label ?? value;
  const [query, setQuery] = useState(selectedLabel);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const activeRef = useRef<HTMLLIElement | null>(null);
  const listId = `${id}-listbox`;

  useEffect(() => {
    setQuery(selectedLabel);
  }, [selectedLabel]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const filtered = useMemo(() => {
    if (filter === null) return options;
    const needle = filter.trim().toLowerCase();
    if (!needle) return options;
    const matches = options.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) ||
        option.value.toLowerCase().includes(needle) ||
        (option.group ?? '').toLowerCase().includes(needle),
    );
    return matches.sort((left, right) => {
      const leftStarts = left.label.toLowerCase().startsWith(needle) ? 0 : 1;
      const rightStarts = right.label.toLowerCase().startsWith(needle) ? 0 : 1;
      return leftStarts - rightStarts;
    });
  }, [filter, options]);

  const close = () => {
    setOpen(false);
    setFilter(null);
    setActive(-1);
  };

  const choose = (option: ComboboxOption) => {
    setQuery(option.label);
    close();
    if (option.value !== value) onChange(option.value);
  };

  const commitTyped = (allowFreeText: boolean) => {
    const trimmed = query.trim();
    const exact = options.find(
      (option) => option.label.toLowerCase() === trimmed.toLowerCase(),
    );
    const keepFreeText =
      allowCustom && (allowFreeText || trimmed.startsWith('-'));
    const next = exact?.value ?? (keepFreeText ? trimmed : value);
    setQuery(exact?.label ?? (keepFreeText ? trimmed : selectedLabel));
    close();
    if (next !== value) onChange(next);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setFilter(null);
        setActive(filtered.length > 0 ? 0 : -1);
      } else {
        setActive((current) =>
          filtered.length === 0
            ? -1
            : Math.min(current + 1, filtered.length - 1),
        );
      }
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setFilter(null);
        setActive(filtered.length > 0 ? filtered.length - 1 : -1);
      } else {
        setActive((current) => Math.max(current - 1, 0));
      }
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (open && active >= 0 && filtered[active]) {
        choose(filtered[active]);
      } else {
        commitTyped(true);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setQuery(selectedLabel);
      close();
    }
  };

  let lastGroup: string | undefined;

  return (
    <Wrap>
      <Form.Control
        id={id}
        value={query}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={
          open && active >= 0 ? `${id}-option-${active}` : undefined
        }
        onFocus={() => {
          setOpen(true);
          setFilter(null);
          setActive(-1);
        }}
        onClick={() => {
          setOpen(true);
          setFilter(null);
          setActive(-1);
        }}
        onBlur={() => commitTyped(false)}
        onChange={(event) => {
          const next = event.target.value;
          const needle = next.trim().toLowerCase();
          const hasMatch =
            needle.length > 0 &&
            options.some(
              (option) =>
                option.label.toLowerCase().includes(needle) ||
                option.value.toLowerCase().includes(needle) ||
                (option.group ?? '').toLowerCase().includes(needle),
            );
          setQuery(next);
          setFilter(next);
          setOpen(true);
          setActive(hasMatch ? 0 : -1);
        }}
        onKeyDown={handleKeyDown}
      />
      <Caret $open={open} aria-hidden="true" />
      {open && (
        <Menu id={listId} role="listbox" aria-label={ariaLabel}>
          {filtered.length === 0 ? (
            <Empty>
              {allowCustom && query.trim().length > 0
                ? formatMessage(shellMessages.useCustomValue, {
                    value: query.trim(),
                  })
                : formatMessage(shellMessages.noMatches)}
            </Empty>
          ) : (
            filtered.map((option, index) => {
              const heading =
                option.group && option.group !== lastGroup ? option.group : null;
              lastGroup = option.group;
              return (
                <React.Fragment key={`${option.group ?? ''}-${option.value}`}>
                  {heading && <GroupHeading>{heading}</GroupHeading>}
                  <Option
                    id={`${id}-option-${index}`}
                    ref={index === active ? activeRef : undefined}
                    role="option"
                    aria-selected={option.value === value}
                    $active={index === active}
                    title={option.title}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(option)}
                  >
                    {option.label}
                  </Option>
                </React.Fragment>
              );
            })
          )}
        </Menu>
      )}
    </Wrap>
  );
};
