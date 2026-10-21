import React from 'react';
import styled from 'styled-components';
import { Form } from 'react-bootstrap';

export const Field = styled.div`
  margin-top: var(--hb-space-md);
`;

export const LabelRow = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--hb-space-sm);
`;

export const Help = styled.div`
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
  margin-top: var(--hb-space-xs);
`;

export const InlineNote = styled.span<{ $tone?: 'warning' | 'muted' }>`
  color: ${({ $tone }) =>
    $tone === 'warning' ? 'var(--hb-warning)' : 'var(--hb-textMuted)'};
  font-size: var(--hb-font-xs);
`;

export const Label: React.FC<{
  htmlFor?: string;
  children: React.ReactNode;
}> = ({ htmlFor, children }) => (
  <Form.Label htmlFor={htmlFor} className="mb-0">
    {children}
  </Form.Label>
);
