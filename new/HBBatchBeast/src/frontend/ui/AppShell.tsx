import React, { PropsWithChildren } from 'react';
import styled from 'styled-components';
import { Button } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import { StatusPill, AppStatus } from './StatusPill';
import { shellMessages } from './messages';

const Header = styled.header`
  display: flex;
  align-items: center;
  gap: var(--hb-space-md);
  padding: var(--hb-space-md) var(--hb-space-xl);
  background: var(--hb-surface);
  border-bottom: 1px solid var(--hb-border);
`;

const Title = styled.h1`
  font-size: var(--hb-font-md);
  font-weight: 600;
  margin: 0;
`;

const Spacer = styled.div`
  flex: 1;
`;

const Main = styled.main`
  padding: var(--hb-space-xl);
  max-width: 1200px;
  margin: 0 auto;
`;

interface AppShellProps {
  status: AppStatus;
  profileName?: string;
  onOpenSettings: () => void;
  children: React.ReactNode;
}

export const AppShell: React.FC<PropsWithChildren<AppShellProps>> = ({
  status,
  profileName,
  onOpenSettings,
  children,
}) => {
  const { formatMessage } = useIntl();

  return (
    <>
      <Header>
        <Title>HBBatchBeast</Title>
        {profileName && (
          <span style={{ color: 'var(--hb-textMuted)' }}>{profileName}</span>
        )}
        <Spacer />
        <StatusPill status={status} />
        <Button size="sm" variant="outline-secondary" onClick={onOpenSettings}>
          {formatMessage(shellMessages.settings)}
        </Button>
      </Header>
      <Main>{children}</Main>
    </>
  );
};
