// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { getDefaultMessages } from '../src/frontend/allMessages';
import {
  FilterExpression,
  defaultFilterExpression,
  flattenFilterRules,
} from '../src/common/filterExpression';
import { FilterBuilder } from '../src/frontend/ui/filterBuilder/FilterBuilder';
import { FilterPropertyValue } from '../src/frontend/settings/FilterPropertyValue';
import { scanFilterFields } from '../src/frontend/settings/scanFilterFields';

const messages = getDefaultMessages();
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: vi.fn(),
});

afterEach(cleanup);

function Harness({ initial = defaultFilterExpression() }: { initial?: FilterExpression }) {
  const [value, setValue] = useState(initial);
  return (
    <IntlProvider locale="en" messages={messages} defaultLocale="en">
      <div data-testid="expr">{JSON.stringify(value)}</div>
      <FilterBuilder fields={scanFilterFields} value={value} onChange={setValue} />
    </IntlProvider>
  );
}

function currentExpression(): FilterExpression {
  return JSON.parse(screen.getByTestId('expr').textContent ?? '{}');
}

describe('FilterBuilder', () => {
  it('renders the default stages and adds an unused filter from the menu', () => {
    render(<Harness />);
    expect(screen.getByText(/File type/)).toBeTruthy();
    expect(screen.getByText(/Output state/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Add stage/i }));
    fireEvent.click(screen.getByRole('button', { name: /File size/i }));

    const expression = currentExpression();
    expect(flattenFilterRules(expression).some(({ rule }) => rule.field === 'fileSize'))
      .toBe(true);
    expect(screen.getByText(/is at least/)).toBeTruthy();
  });

  it('types into the add-stage search and filters the menu', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /Add stage/i }));
    const search = screen.getByRole('textbox', { name: 'Search filters' });
    fireEvent.change(search, { target: { value: 'size' } });

    expect((search as HTMLInputElement).value).toBe('size');
    expect(screen.getByRole('button', { name: /File size/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Media property/i })).toBeNull();
  });

  it('switches a group between ALL and ANY', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Match any' }));
    expect(currentExpression().root.combinator).toBe('or');
  });

  it('accepts typing in a numeric stage value', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /Add stage/i }));
    fireEvent.click(screen.getByRole('button', { name: /File size/i }));

    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '250' } });

    const rule = flattenFilterRules(currentExpression()).find(
      ({ rule: item }) => item.field === 'fileSize',
    );
    expect(rule?.rule.value).toBe(250);
  });

  it('removes a stage', () => {
    render(<Harness />);
    const before = flattenFilterRules(currentExpression()).length;
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
    expect(flattenFilterRules(currentExpression())).toHaveLength(before - 1);
  });

  it('toggles stage negation from the NOT control', () => {
    render(<Harness />);
    const buttons = screen.getAllByRole('button', { name: 'Invert this stage' });
    fireEvent.click(buttons[0]);

    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    const [first] = flattenFilterRules(currentExpression());
    expect(first.rule.negate).toBe(true);
  });

  it('adds a property pair and clears an invalid value when the key changes', () => {
    const field = scanFilterFields.find((item) => item.id === 'mediaProperty');
    if (!field) throw new Error('missing mediaProperty field');
    const operator = field.operators.find((item) => item.id === 'equals');
    if (!operator) throw new Error('missing equals operator');
    const changes: unknown[] = [];
    render(
      <IntlProvider locale="en" messages={messages} defaultLocale="en">
        <FilterPropertyValue
          id="property"
          field={field}
          operator={operator}
          value={{ key: 'codec_name', value: 'h264' }}
          onChange={(next) => changes.push(next)}
        />
      </IntlProvider>,
    );

    const key = screen.getByRole('combobox', { name: 'Property name' });
    fireEvent.change(key, { target: { value: 'width' } });
    fireEvent.blur(key);

    expect(changes.at(-1)).toEqual({ key: 'width', value: '' });
  });
});
