import React from 'react';
import styled, { css } from 'styled-components';
import { Icon } from './Icon';
import { AppIconName } from './icons';

export type ButtonVariant =
  | 'primary'
  | 'success'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'dangerOutline';

/**
 * Token-based button. Bootstrap's variants hard-code their own palette and white
 * label, which fails contrast in the dark theme; these pull both colours from the
 * theme tokens instead.
 */
const variantStyles: Record<ButtonVariant, ReturnType<typeof css>> = {
  primary: css`
    background: var(--hb-accent);
    color: var(--hb-accentContrast);
    border-color: var(--hb-accent);
  `,
  success: css`
    background: var(--hb-success);
    color: var(--hb-accentContrast);
    border-color: var(--hb-success);
  `,
  danger: css`
    background: var(--hb-danger);
    color: var(--hb-accentContrast);
    border-color: var(--hb-danger);
  `,
  dangerOutline: css`
    background: transparent;
    color: var(--hb-danger);
    border-color: var(--hb-danger);
  `,
  ghost: css`
    background: transparent;
    color: var(--hb-text);
    border-color: var(--hb-border);
  `,
  secondary: css`
    background: var(--hb-surfaceMuted);
    color: var(--hb-text);
    border-color: var(--hb-border);
  `,
};

const StyledButton = styled.button<{
  $variant: ButtonVariant;
  $compact: boolean;
  $iconOnly: boolean;
  $active: boolean;
}>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--hb-space-xs);
  border: 1px solid transparent;
  border-radius: var(--hb-radius-sm);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  padding: ${({ $compact, $iconOnly }) =>
    $iconOnly
      ? '0'
      : $compact
        ? '0 var(--hb-space-md)'
        : '0 var(--hb-space-lg)'};
  width: ${({ $iconOnly, $compact }) =>
    $iconOnly ? ($compact ? '28px' : '36px') : undefined};
  height: ${({ $compact }) => ($compact ? '28px' : '36px')};
  transition:
    filter 120ms ease,
    color 120ms ease,
    background-color 120ms ease;
  ${({ $variant }) => variantStyles[$variant]}

  ${({ $active }) =>
    $active &&
    css`
      background: var(--hb-surfaceMuted);
      border-color: var(--hb-accent);
      color: var(--hb-accent);
    `}

  &:hover:not(:disabled) {
    filter: brightness(1.08);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'color'> {
  variant?: ButtonVariant;
  compact?: boolean;
  icon?: AppIconName;
  iconPosition?: 'start' | 'end';
  iconOnly?: boolean;
  active?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  compact = false,
  icon,
  iconPosition = 'start',
  iconOnly = false,
  active = false,
  type = 'button',
  children,
  ...rest
}) => (
  <StyledButton
    $variant={variant}
    $compact={compact}
    $iconOnly={iconOnly}
    $active={active}
    type={type}
    {...rest}
  >
    {icon && iconPosition === 'start' && <Icon name={icon} />}
    {children}
    {icon && iconPosition === 'end' && <Icon name={icon} />}
  </StyledButton>
);

export interface IconButtonProps
  extends Omit<
    ButtonProps,
    'children' | 'icon' | 'iconPosition' | 'iconOnly' | 'aria-label'
  > {
  icon: AppIconName;
  /** Accessible name and default tooltip. Required so icon-only controls stay usable. */
  label: string;
  title?: string;
}

/** Square icon-only button with a guaranteed accessible name and tooltip. */
export const IconButton: React.FC<IconButtonProps> = ({
  icon,
  label,
  title,
  compact = true,
  variant = 'ghost',
  ...rest
}) => (
  <Button
    compact={compact}
    variant={variant}
    icon={icon}
    iconOnly
    aria-label={label}
    title={title ?? label}
    {...rest}
  />
);
