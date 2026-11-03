import React from 'react';
import styled from 'styled-components';
import { useIntl } from 'react-intl';
import { AppConfigV2 } from '../../common';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { homeMessages } from './messages';
import type { HomeMode } from './types';

const Wrap = styled.div`
  display: grid;
  gap: var(--hb-space-xl);
`;

const Question = styled.h2`
  margin: 0;
  font-size: var(--hb-font-lg);
  font-weight: 600;
`;

const Doors = styled.div`
  display: grid;
  gap: var(--hb-space-lg);
  grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
`;

const DoorCard = styled.section`
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--hb-surface);
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-lg);
  overflow: hidden;
`;

const DoorButton = styled.button`
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--hb-space-sm);
  min-height: 200px;
  padding: var(--hb-space-xl);
  border: 0;
  background: transparent;
  color: var(--hb-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms ease;

  &:hover {
    background: var(--hb-surfaceMuted);
  }
`;

const DoorTop = styled.span`
  display: flex;
  align-items: center;
  gap: var(--hb-space-sm);
`;

const DoorIcon = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--hb-radius-md);
  background: var(--hb-surfaceMuted);
  color: var(--hb-accent);
  font-size: 1.25rem;
`;

const DoorTitle = styled.span`
  font-size: var(--hb-font-lg);
  font-weight: 600;
`;

const DoorBody = styled.span`
  color: var(--hb-textMuted);
  font-size: var(--hb-font-sm);
  line-height: 1.45;
`;

const DoorMeta = styled.span`
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
`;

const DoorArrow = styled.span`
  display: flex;
  justify-content: flex-end;
  margin-top: auto;
  padding-top: var(--hb-space-sm);
  color: var(--hb-accent);
`;

const DoorFooter = styled.div`
  display: flex;
  justify-content: flex-end;
  padding: var(--hb-space-sm) var(--hb-space-md);
  border-top: 1px solid var(--hb-border);
`;

interface LauncherPageProps {
  config: AppConfigV2;
  /** Session memory for the “Continue with …” shortcut, per door. */
  lastLibraryByMode: Partial<Record<HomeMode, string>>;
  onChooseMode: (mode: HomeMode) => void;
  onContinue: (mode: HomeMode, libraryId: string) => void;
}

export const LauncherPage: React.FC<LauncherPageProps> = ({
  config,
  lastLibraryByMode,
  onChooseMode,
  onContinue,
}) => {
  const { formatMessage } = useIntl();
  const doors: Array<{
    mode: HomeMode;
    icon: 'quick' | 'libraries';
    title: string;
    body: string;
  }> = [
    {
      mode: 'convert',
      icon: 'quick',
      title: formatMessage(homeMessages.convertTitle),
      body: formatMessage(homeMessages.convertBody),
    },
    {
      mode: 'organize',
      icon: 'libraries',
      title: formatMessage(homeMessages.organizeTitle),
      body: formatMessage(homeMessages.organizeBody),
    },
  ];
  const libraryCount = formatMessage(homeMessages.libraryCount, {
    count: config.libraries.length,
  });

  return (
    <Wrap>
      <Question>{formatMessage(homeMessages.homeQuestion)}</Question>
      <Doors>
        {doors.map((door) => {
          const library = config.libraries.find(
            (candidate) => candidate.id === lastLibraryByMode[door.mode],
          );
          const descriptionId = `home-door-${door.mode}`;
          return (
            <DoorCard key={door.mode}>
              <DoorButton
                type="button"
                aria-label={door.title}
                aria-describedby={descriptionId}
                onClick={() => onChooseMode(door.mode)}
              >
                <DoorTop>
                  <DoorIcon>
                    <Icon name={door.icon} size="md" />
                  </DoorIcon>
                  <DoorTitle>{door.title}</DoorTitle>
                </DoorTop>
                <DoorBody id={descriptionId}>{door.body}</DoorBody>
                <DoorMeta>{libraryCount}</DoorMeta>
                <DoorArrow>
                  <Icon name="arrowRight" size="sm" />
                </DoorArrow>
              </DoorButton>
              {library && (
                <DoorFooter>
                  <Button
                    compact
                    variant="ghost"
                    icon="arrowRight"
                    iconPosition="end"
                    onClick={() => onContinue(door.mode, library.id)}
                  >
                    {formatMessage(homeMessages.continueWith, {
                      name: library.name || formatMessage(homeMessages.untitledLibrary),
                    })}
                  </Button>
                </DoorFooter>
              )}
            </DoorCard>
          );
        })}
      </Doors>
    </Wrap>
  );
};
