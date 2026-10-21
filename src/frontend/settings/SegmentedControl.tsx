import React, { useRef } from 'react';
import styled from 'styled-components';

export interface SegmentedOption {
  value: string;
  label: string;
  title?: string;
}

const Wrap = styled.div`
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  background: var(--hb-surfaceMuted);
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-sm);
`;

const Option = styled.button<{ $active: boolean }>`
  border: 0;
  border-radius: calc(var(--hb-radius-sm) - 1px);
  background: ${({ $active }) =>
    $active ? 'var(--hb-accent)' : 'transparent'};
  color: ${({ $active }) =>
    $active ? 'var(--hb-accentContrast)' : 'var(--hb-text)'};
  font: inherit;
  font-size: var(--hb-font-sm);
  padding: var(--hb-space-xs) var(--hb-space-md);
  cursor: pointer;

  &:hover:not(:disabled) {
    background: ${({ $active }) =>
      $active ? 'var(--hb-accent)' : 'var(--hb-surface)'};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

interface SegmentedControlProps {
  label: string;
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/** Radio-group styled as a segmented switch; arrow keys move the selection. */
export const SegmentedControl: React.FC<SegmentedControlProps> = ({
  label,
  options,
  value,
  onChange,
  disabled,
}) => {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  const move = (index: number) => {
    const next = (index + options.length) % options.length;
    onChange(options[next].value);
    buttons.current[next]?.focus();
  };

  return (
    <Wrap role="radiogroup" aria-label={label}>
      {options.map((option, index) => (
        <Option
          key={option.value}
          ref={(element) => {
            buttons.current[index] = element;
          }}
          type="button"
          role="radio"
          aria-checked={index === selected}
          tabIndex={index === selected ? 0 : -1}
          $active={index === selected}
          disabled={disabled}
          title={option.title}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
              event.preventDefault();
              move(index + 1);
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
              event.preventDefault();
              move(index - 1);
            } else if (event.key === 'Home') {
              event.preventDefault();
              move(0);
            } else if (event.key === 'End') {
              event.preventDefault();
              move(options.length - 1);
            }
          }}
        >
          {option.label}
        </Option>
      ))}
    </Wrap>
  );
};
