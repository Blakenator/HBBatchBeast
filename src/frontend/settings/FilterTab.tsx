import React from 'react';
import styled from 'styled-components';
import { Alert, Form } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import {
  BatchConfig,
  BatchTabConfig,
  FilterExpression,
  countFilterRules,
  resolveFilterExpression,
  validateFilterExpression,
} from '../../common';
import { FilterBuilder } from '../ui/filterBuilder/FilterBuilder';
import { FilterChips } from '../ui/filterBuilder/FilterChips';
import { filterBuilderMessages } from '../ui/filterBuilder/messages';
import { scanFilterFields } from './scanFilterFields';
import { settingsMessages } from './messages';

const Wrap = styled.div`
  display: grid;
  gap: var(--hb-space-md);
  padding-top: var(--hb-space-sm);
`;

const Section = styled.section`
  display: grid;
  gap: var(--hb-space-sm);
  padding: var(--hb-space-md);
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-md);
  background: var(--hb-surface);
`;

const Title = styled.h2`
  margin: 0;
  font-size: var(--hb-font-sm);
  font-weight: 600;
`;

const Help = styled.p`
  margin: 0;
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
`;

const ActionRow = styled.div`
  display: grid;
  gap: var(--hb-space-xs);
`;

interface FilterTabProps {
  config: BatchConfig;
  onChange: (path: string, value: unknown) => void;
}

export const FilterTab: React.FC<FilterTabProps> = ({ config, onChange }) => {
  const { formatMessage } = useIntl();
  const advanced: Partial<BatchTabConfig['advanced']> =
    config.tab_batch?.advanced ?? {};
  const expression = resolveFilterExpression(advanced);
  const problems = validateFilterExpression(expression);

  const updateExpression = (next: FilterExpression) =>
    onChange('tab_batch.advanced.filter_expression', next);

  return (
    <Wrap>
      <Help>{formatMessage(settingsMessages.filterTabDescription)}</Help>

      <Section>
        <Title>{formatMessage(settingsMessages.filterRulesTitle)}</Title>
        <Help>{formatMessage(settingsMessages.filterRulesHelp)}</Help>
        <FilterChips
          expression={expression}
          fields={scanFilterFields}
          ariaLabel={formatMessage(settingsMessages.filterRulesTitle)}
        />
        <FilterBuilder
          value={expression}
          fields={scanFilterFields}
          onChange={updateExpression}
          idPrefix="scan-filter"
        />
        <Help>
          {formatMessage(filterBuilderMessages.filterCount, {
            count: countFilterRules(expression),
          })}
        </Help>
      </Section>

      {problems.length > 0 && (
        <Alert variant="warning" className="mb-0">
          <strong>{formatMessage(settingsMessages.allProblems)}</strong>
          <ul className="mb-0">
            {problems.map((problem) => (
              <li key={problem}>
                {formatMessage(settingsMessages.filterProblemPrefix, {
                  problem,
                })}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <Section>
        <Title>{formatMessage(settingsMessages.filterActionsTitle)}</Title>
        <ActionRow>
          <Form.Check
            id="filter-copy-filtered"
            type="switch"
            checked={advanced.copy_filtered_files_toggle === 1}
            label={formatMessage(settingsMessages.filterCopyFiltered)}
            onChange={(event) =>
              onChange(
                'tab_batch.advanced.copy_filtered_files_toggle',
                event.target.checked ? 1 : 0,
              )
            }
          />
          <Help>{formatMessage(settingsMessages.filterCopyFilteredHelp)}</Help>
        </ActionRow>
        <ActionRow>
          <Form.Check
            id="filter-copy-srt"
            type="switch"
            checked={advanced.copy_srt_files_toggle === 1}
            label={formatMessage(settingsMessages.filterCopySrt)}
            onChange={(event) =>
              onChange(
                'tab_batch.advanced.copy_srt_files_toggle',
                event.target.checked ? 1 : 0,
              )
            }
          />
          <Help>{formatMessage(settingsMessages.filterCopySrtHelp)}</Help>
        </ActionRow>
      </Section>
    </Wrap>
  );
};
