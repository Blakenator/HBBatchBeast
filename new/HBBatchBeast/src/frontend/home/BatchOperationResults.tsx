import React from 'react';
import { useBatchResult, useGlobalConfig } from '../core/stores';
import { Table } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import { batchOperationResultsMessages } from './messages';

export const BatchOperationResults: React.FC = () => {
  const batchResult = useBatchResult();
  const config = useGlobalConfig();
  const { formatMessage } = useIntl();
  console.log(
    config?.configs[config.selected_config].tab_batch.custom_preset_string,
    config?.configs[config.selected_config].tab_batch.custom_preset_string.split('\n'),
    batchResult
  );

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
      <td>{config.configs[config.selected_config].tab_batch.custom_preset_string.split('\n')[fileResult.presetIndex]?.trim()}</td>
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
