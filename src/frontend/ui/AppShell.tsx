import React, { PropsWithChildren } from 'react';
import styled from 'styled-components';

import { useIntl } from 'react-intl';
import { StatusPill, AppStatus } from './StatusPill';
import { Button } from './Button';
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

const PageName = styled.span`
  color: var(--hb-textMuted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  pageName?: string;
  backLabel?: string;
  onBack?: () => void;
  onOpenSettings: () => void;
  showSettings?: boolean;
  children: React.ReactNode;
}

export const AppShell: React.FC<PropsWithChildren<AppShellProps>> = ({
  status,
  pageName,
  backLabel = 'Back',
  onBack,
  onOpenSettings,
  showSettings = true,
  children,
}) => {
  const { formatMessage } = useIntl();

  return (
    <>
      <Header>
        {onBack && (
          <Button compact variant="ghost" onClick={onBack}>
            ← {backLabel}
          </Button>
        )}
        <Title>HBBatchBeast</Title>
        {pageName && <PageName>{pageName}</PageName>}
        <Spacer />
        <StatusPill status={status} />
        {showSettings && (
          <Button compact variant="ghost" onClick={onOpenSettings}>
            {formatMessage(shellMessages.settings)}
          </Button>
        )}
      </Header>
      <Main>{children}</Main>
    </>
  );
};
