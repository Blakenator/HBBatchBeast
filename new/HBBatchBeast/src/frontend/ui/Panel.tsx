import React from 'react';
import styled from 'styled-components';

const Section = styled.section`
  background: var(--hb-surface);
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-md);
  padding: var(--hb-space-lg);
`;

const Title = styled.h2`
  font-size: var(--hb-font-sm);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--hb-textMuted);
  margin: 0 0 var(--hb-space-sm);
`;

export const Panel: React.FC<{
  title?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, actions, children }) => (
  <Section>
    {(title || actions) && (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {title && <Title>{title}</Title>}
        {actions}
      </div>
    )}
    {children}
  </Section>
);

export const PanelGrid = styled.div`
  display: grid;
  gap: var(--hb-space-lg);
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  margin-bottom: var(--hb-space-lg);
`;
