import React from 'react';
import styled from 'styled-components';
import { useIntl } from 'react-intl';
import { HandBrakePresetScan } from '../../common';
import { Button } from '../ui/Button';
import { InlineNote } from './FieldLayout';
import { settingsMessages } from './messages';

const Bar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hb-space-sm);
  margin-bottom: var(--hb-space-xs);
`;

interface PresetScanStatusProps {
  scan?: HandBrakePresetScan;
  loading: boolean;
  onRefresh: () => void;
}

export const PresetScanStatus: React.FC<PresetScanStatusProps> = ({
  scan,
  loading,
  onRefresh,
}) => {
  const { formatMessage } = useIntl();

  const pending = loading || !scan;
  const text = pending
    ? formatMessage(settingsMessages.scanningPresets)
    : scan.available
      ? formatMessage(settingsMessages.presetScanCount, {
          count: scan.presets.length,
          executable: scan.executable ?? 'HandBrakeCLI',
        })
      : formatMessage(settingsMessages.presetScanFailed, {
          error: scan.error ?? '',
        });

  return (
    <Bar>
      <InlineNote $tone={scan?.available || pending ? 'muted' : 'warning'}>
        {text}
      </InlineNote>
      <Button compact variant="ghost" onClick={onRefresh} disabled={pending}>
        {formatMessage(settingsMessages.refreshPresets)}
      </Button>
    </Bar>
  );
};
