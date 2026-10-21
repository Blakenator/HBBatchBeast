import React, { useState } from 'react';
import styled from 'styled-components';
import { Alert, Form } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import { BatchConfig, GlobalAppConfig } from '../../common';
import { useUpdateConfigDebounced } from './hooks';
import { FieldSchema, GroupSchema, settingsSchema } from './schema';
import { settingsMessages } from './messages';
import { validateBatchConfig } from '../run/validation';
import { Button } from '../ui/Button';

interface SettingsFormProps {
  config: GlobalAppConfig;
}

const Group = styled.details`
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-md);
  padding: var(--hb-space-md);
  background: var(--hb-surface);

  & + & {
    margin-top: var(--hb-space-md);
  }

  summary {
    cursor: pointer;
    font-weight: 600;
  }
`;

const Field = styled.div`
  margin-top: var(--hb-space-md);
`;

const Destructive = styled.div`
  margin-top: var(--hb-space-md);
  padding-top: var(--hb-space-md);
  border-top: 1px dashed var(--hb-danger);
`;

const DestructiveCaption = styled.p`
  margin: 0;
  color: var(--hb-danger);
  font-size: var(--hb-font-xs);
  font-weight: 600;
`;

const Help = styled.div`
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
  margin-top: var(--hb-space-xs);
`;

/** Reads a dot path (`tab_batch.path.source_path`) out of one profile. */
function readValue(config: BatchConfig, path: string): unknown {
  return path.split('.').reduce<unknown>((accumulator, key) => {
    if (accumulator && typeof accumulator === 'object') {
      return (accumulator as Record<string, unknown>)[key];
    }
    return undefined;
  }, config as unknown);
}

/** Builds a nested partial so mergeUpdate only touches one field. */
function writeValue(path: string, value: unknown): Record<string, unknown> {
  return path
    .split('.')
    .reduceRight<unknown>((accumulator, key) => ({ [key]: accumulator }), value) as Record<
    string,
    unknown
  >;
}

const SettingsField: React.FC<{
  field: FieldSchema;
  value: unknown;
  onChange: (value: unknown) => void;
}> = ({ field, value, onChange }) => {
  const { formatMessage } = useIntl();
  const id = `setting-${field.path.replace(/\./g, '-')}`;

  if (field.kind === 'toggle') {
    return (
      <Field>
        <Form.Check
          id={id}
          type="switch"
          checked={value === 1}
          label={formatMessage({ id: field.label, defaultMessage: field.label })}
          onChange={(event) => onChange(event.target.checked ? 1 : 0)}
        />
        {field.help && <Help>{field.help}</Help>}
      </Field>
    );
  }

  if (field.kind === 'select') {
    return (
      <Field>
        <Form.Label htmlFor={id}>
          {formatMessage({ id: field.label, defaultMessage: field.label })}
        </Form.Label>
        <Form.Select
          id={id}
          value={String(value ?? field.options?.[0]?.value ?? '')}
          onChange={(event) =>
            onChange(
              field.numericOptions ? Number(event.target.value) : event.target.value,
            )
          }
        >
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.text}
            </option>
          ))}
        </Form.Select>
        {field.help && <Help>{field.help}</Help>}
      </Field>
    );
  }

  const common = {
    id,
    value: String(value ?? ''),
    'aria-describedby': field.help ? `${id}-help` : undefined,
  };

  return (
    <Field>
      <Form.Label htmlFor={id}>
        {formatMessage({ id: field.label, defaultMessage: field.label })}
      </Form.Label>
      {field.kind === 'multiline' ? (
        <Form.Control
          as="textarea"
          rows={3}
          {...common}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Form.Control
          type={field.kind === 'number' ? 'number' : field.kind === 'time' ? 'time' : 'text'}
          min={field.min}
          max={field.max}
          {...common}
          onChange={(event) =>
            onChange(
              field.kind === 'number' && event.target.value !== ''
                ? Number(event.target.value)
                : event.target.value,
            )
          }
        />
      )}
      {field.help && <Help id={`${id}-help`}>{field.help}</Help>}
    </Field>
  );
};

const SettingsGroup: React.FC<{
  group: GroupSchema;
  config: BatchConfig;
  advanced: boolean;
  onChange: (path: string, value: unknown) => void;
}> = ({ group, config, advanced, onChange }) => {
  const { formatMessage } = useIntl();
  // Advanced mode adds the advanced fields; basic mode hides them.
  const fields = advanced
    ? group.fields
    : group.fields.filter((field) => !field.advanced);
  if (fields.length === 0) return null;

  const renderField = (field: FieldSchema) => (
    <SettingsField
      key={field.path}
      field={field}
      value={readValue(config, field.path)}
      onChange={(value) => onChange(field.path, value)}
    />
  );
  const risky = fields.filter((field) => field.destructive);

  return (
    <Group open>
      <summary>
        {formatMessage({ id: group.title, defaultMessage: group.title })}
      </summary>
      {fields.filter((field) => !field.destructive).map(renderField)}
      {risky.length > 0 && (
        <Destructive>
          <DestructiveCaption>
            {formatMessage(settingsMessages.dangerTitle)}
          </DestructiveCaption>
          {risky.map(renderField)}
        </Destructive>
      )}
    </Group>
  );
};

export const SettingsForm: React.FC<SettingsFormProps> = ({ config }) => {
  const { formatMessage } = useIntl();
  const { currentConfig, mergeUpdate } = useUpdateConfigDebounced(config);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleChange = (path: string, value: unknown) => {
    const [root, ...rest] = path.split('.');
    mergeUpdate({ [root]: writeValue(rest.join('.'), value) });
  };

  const problems = validateBatchConfig(currentConfig.tab_batch);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--hb-space-sm)' }}>
        <Button
          compact
          variant={showAdvanced ? 'secondary' : 'ghost'}
          onClick={() => setShowAdvanced((value) => !value)}
          aria-pressed={showAdvanced}
        >
          {formatMessage(settingsMessages.advanced)}
        </Button>
      </div>

      {settingsSchema.map((group) => (
        <SettingsGroup
          key={group.id}
          group={group}
          config={currentConfig}
          advanced={showAdvanced}
          onChange={handleChange}
        />
      ))}

      {problems.length > 0 && (
        <Alert variant="warning" className="mt-3 mb-0">
          {problems[0]}
        </Alert>
      )}
    </div>
  );
};
