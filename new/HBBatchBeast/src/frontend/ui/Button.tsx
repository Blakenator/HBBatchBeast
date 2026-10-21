import React from 'react';
import styled, { css } from 'styled-components';

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

const StyledButton = styled.button<{ $variant: ButtonVariant; $compact: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--hb-space-xs);
  border: 1px solid transparent;
  border-radius: var(--hb-radius-sm);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  padding: ${({ $compact }) =>
    $compact ? '0 var(--hb-space-md)' : '0 var(--hb-space-lg)'};
  height: ${({ $compact }) => ($compact ? '28px' : '36px')};
  transition: filter 120ms ease;

  ${({ $variant }) => variantStyles[$variant]}

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
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  compact = false,
  type = 'button',
  children,
  ...rest
}) => (
  <StyledButton $variant={variant} $compact={compact} type={type} {...rest}>
    {children}
  </StyledButton>
);
