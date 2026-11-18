import React, { useId } from 'react';
import { OverlayTrigger, Popover } from 'react-bootstrap';
import styled from 'styled-components';

const Wrapper = styled.span`
  display: inline-flex;
  align-items: center;
  min-width: 0;
`;

const Body = styled(Popover.Body)`
  max-width: 280px;
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
  line-height: 1.45;
`;

/**
 * Explains a control on hover and keyboard focus. The popover is attached to
 * the control itself instead of a separate info icon, so the explanation is
 * there when you need it without adding visual noise to every row.
 */
export const ControlTip: React.FC<{
  /** Short name used by tests and for an accessible description. */
  label: string;
  content: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ label, content, children, style }) => {
  const id = useId();
  return (
    <OverlayTrigger
      trigger={['hover', 'focus']}
      placement="top"
      overlay={
        <Popover id={id}>
          <Body>{content}</Body>
        </Popover>
      }
    >
      <Wrapper style={style} data-tip={label}>
        {children}
      </Wrapper>
    </OverlayTrigger>
  );
};
