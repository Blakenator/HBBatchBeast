import React from 'react';
import { useIntl } from 'react-intl';
import { Button } from '../Button';
import { filterBuilderMessages } from './messages';

interface NegateButtonProps {
  active: boolean;
  disabled?: boolean;
  group?: boolean;
  onToggle: () => void;
}

/**
 * Logical negation has no unambiguous FontAwesome glyph, so this control uses a
 * compact NOT label. It matches the "not" badge shown beside negated fields.
 */
export const NegateButton: React.FC<NegateButtonProps> = ({
  active,
  disabled,
  group = false,
  onToggle,
}) => {
  const { formatMessage } = useIntl();
  const label = formatMessage(
    group ? filterBuilderMessages.negateGroup : filterBuilderMessages.negate,
  );

  return (
    <Button
      compact
      variant="ghost"
      active={active}
      disabled={disabled}
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      {formatMessage(filterBuilderMessages.negateShort)}
    </Button>
  );
};
