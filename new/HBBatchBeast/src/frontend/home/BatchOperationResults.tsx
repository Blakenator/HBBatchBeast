import React from 'react';
import { GlobalAppConfig } from '../../common';
import { useBatchResult, useGlobalConfig } from '../core/stores';
import { Table } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import { batchOperationResultsMessages } from './messages';

function getPresetLabels(
  batch: GlobalAppConfig['configs'][number]['tab_batch'],
): string[] {
  const configured =
    batch.custom_preset_toggle === 1
      ? (batch.custom_preset_string ?? '')
      : (batch.preset ?? '');

  return configured
    .split('\n')
    .map((line) => line.trim().replace(/^-Z\s+"?|"$/g, ''))
    .filter((line) => line.length > 0);
}

export const BatchOperationResults: React.FC = () => {
  const batchResult = useBatchResult();
  const config = useGlobalConfig();
  const { formatMessage } = useIntl();
  const batchConfig = config
    ? config.configs[config.selected_config]?.tab_batch
    : undefined;
  const presetLabels = batchConfig ? getPresetLabels(batchConfig) : [];

  return batchResult ? <Table striped borderless hover>
    <thead>
    <tr>
      <th>{formatMessage(batchOperationResultsMessages.index)}</th>
      <th>{formatMessage(batchOperationResultsMessages.filePath)}</th>
      <th>{formatMessage(batchOperationResultsMessages.preset)}</th>
      <th>{formatMessage(batchOperationResultsMessages.extraActions)}</th>
    </tr>
    </thead>
    <tbody>
    {batchResult?.fileList.map((fileResult, i) => <tr key={fileResult.path}>
      <td>{i + 1}</td>
      <td>{fileResult.path}</td>
      <td>
        {presetLabels[fileResult.presetIndex ?? 0] ??
          formatMessage(batchOperationResultsMessages.preset)}
      </td>
      <td>
        {fileResult.extraActions.copiedFromFilter &&
          <div>{formatMessage(batchOperationResultsMessages.copyFilter)}</div>}
        {fileResult.extraActions.skippedFromFilter &&
          <div>{formatMessage(batchOperationResultsMessages.skippedFilter)}</div>}
        {fileResult.extraActions.copiedSrt &&
          <div>{formatMessage(batchOperationResultsMessages.copySRT)}</div>}
      </td>
    </tr>)}
    </tbody>
  </Table> : null;
};
