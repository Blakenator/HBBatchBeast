import React, { useMemo } from 'react';
import styled from 'styled-components';
import { useIntl } from 'react-intl';
import { parseMappedRows } from '../../common';
import { OpenFolderButton } from '../ui/OpenFolderButton';
import { runMessages } from './messages';

const List = styled.div`
  display: grid;
  gap: var(--hb-space-sm);
  margin-top: var(--hb-space-sm);
  max-height: 180px;
  overflow-y: auto;
`;

const Pair = styled.div`
  display: grid;
  gap: 2px;

  & + & {
    border-top: 1px solid var(--hb-border);
    padding-top: var(--hb-space-sm);
  }
`;

const PairTitle = styled.span`
  font-size: var(--hb-font-xs);
  font-weight: 600;
  color: var(--hb-textMuted);
`;

const FolderLine = styled.div`
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--hb-space-xs);
`;

const Role = styled.span`
  font-size: var(--hb-font-xs);
  color: var(--hb-textMuted);
`;

const PathText = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--hb-font-xs);
`;

interface FolderPair {
  source: string;
  destination: string;
}

const buildPairs = (sourcePath?: string, destinationPath?: string): FolderPair[] => {
  const sources = parseMappedRows(sourcePath ?? '');
  const destinations = parseMappedRows(destinationPath ?? '');
  const count = Math.max(sources.length, destinations.length);
  return Array.from({ length: count }, (_, index) => ({
    source: sources[index] ?? '',
    destination: destinations[index] ?? '',
  })).filter((pair) => pair.source.length > 0 || pair.destination.length > 0);
};

interface FolderPairsProps {
  sourcePath?: string;
  destinationPath?: string;
}

/** Lists each configured source/destination pair with an OS folder shortcut. */
export const FolderPairs: React.FC<FolderPairsProps> = ({
  sourcePath,
  destinationPath,
}) => {
  const { formatMessage } = useIntl();
  const pairs = useMemo(
    () => buildPairs(sourcePath, destinationPath),
    [sourcePath, destinationPath],
  );

  if (pairs.length === 0) return null;

  return (
    <List>
      {pairs.map((pair, index) => (
        <Pair key={index}>
          {pairs.length > 1 && (
            <PairTitle>
              {formatMessage(runMessages.folderNumber, { number: index + 1 })}
            </PairTitle>
          )}
          <FolderLine>
            <Role>{formatMessage(runMessages.sourceFolder)}</Role>
            <PathText title={pair.source}>
              {pair.source || '—'}
            </PathText>
            <OpenFolderButton
              path={pair.source}
              label={formatMessage(runMessages.open)}
              title={formatMessage(runMessages.openSourceFolder)}
              failureMessage={formatMessage(runMessages.openFolderFailed)}
            />
          </FolderLine>
          <FolderLine>
            <Role>{formatMessage(runMessages.destinationFolder)}</Role>
            <PathText title={pair.destination}>
              {pair.destination || '—'}
            </PathText>
            <OpenFolderButton
              path={pair.destination}
              label={formatMessage(runMessages.open)}
              title={formatMessage(runMessages.openDestinationFolder)}
              failureMessage={formatMessage(runMessages.openFolderFailed)}
            />
          </FolderLine>
        </Pair>
      ))}
    </List>
  );
};
