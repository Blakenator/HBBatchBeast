// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Button, IconButton } from '../src/frontend/ui/Button';

afterEach(cleanup);

describe('icon buttons', () => {
  it('exposes the required label and hides the icon from assistive technology', () => {
    const onClick = vi.fn();
    const { container } = render(
      <IconButton icon="log" label="Show log" onClick={onClick} />,
    );

    const button = screen.getByRole('button', { name: 'Show log' });
    expect(button.getAttribute('title')).toBe('Show log');

    const icon = container.querySelector('svg');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalled();
  });

  it('keeps icon + text buttons named by their text', () => {
    const { container } = render(
      <Button icon="scan" onClick={() => undefined}>
        Scan
      </Button>,
    );

    expect(screen.getByRole('button', { name: 'Scan' })).toBeTruthy();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });

  it('exposes pressed state for toggle buttons', () => {
    render(
      <IconButton
        icon="copy"
        label="Invert this stage"
        aria-pressed
        active
      />,
    );

    expect(
      screen
        .getByRole('button', { name: 'Invert this stage' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });
});
