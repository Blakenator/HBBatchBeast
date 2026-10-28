import React from 'react';
import styled from 'styled-components';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { appIcons, AppIconName } from './icons';

export type IconSize = 'xs' | 'sm' | 'md' | 'lg';
export type IconTone = 'muted' | 'accent' | 'success' | 'warning' | 'danger';

const sizeMap: Record<IconSize, string> = {
  xs: '0.75em',
  sm: '0.875em',
  md: '1em',
  lg: '1.25em',
};

const toneMap: Record<IconTone, string> = {
  muted: 'var(--hb-textMuted)',
  accent: 'var(--hb-accent)',
  success: 'var(--hb-success)',
  warning: 'var(--hb-warning)',
  danger: 'var(--hb-danger)',
};

const Wrap = styled.span<{ $size: IconSize; $tone?: IconTone }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  font-size: ${({ $size }) => sizeMap[$size]};
  color: ${({ $tone }) => ($tone ? toneMap[$tone] : 'currentColor')};
  line-height: 1;
`;

export interface IconProps {
  name: AppIconName;
  size?: IconSize;
  tone?: IconTone;
  spin?: boolean;
  label?: string;
  className?: string;
}

/**
 * Icon wrapper. Icons are decorative by default; pass `label` only when the
 * icon itself carries meaning for assistive technology.
 */
export const Icon: React.FC<IconProps> = ({
  name,
  size = 'sm',
  tone,
  spin = false,
  label,
  className,
}) => (
  <Wrap $size={size} $tone={tone} className={className}>
    <FontAwesomeIcon
      icon={appIcons[name]}
      fixedWidth
      spin={spin}
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : 'presentation'}
      aria-label={label}
      focusable="false"
    />
  </Wrap>
);
