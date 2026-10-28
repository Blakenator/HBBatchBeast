import React, { useState } from 'react';
import styled from 'styled-components';
import { Alert, Form, Tab, Tabs } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import { merge } from 'lodash';
import {
  BatchConfig,
  DeepPartial,
  GlobalAppConfig,
  GlobalSettingsConfig,
  HANDBRAKE_CONTAINERS,
  normalizeContainerExtension,
  resolveGlobalSettings,
} from '../../common';
import { useHandBrakePresets, useUpdateConfigDebounced } from './hooks';
import {
  EncoderMode,
  FieldSchema,
  GroupSchema,
  settingsSchema,
} from './schema';
import { settingsMessages } from './messages';
import { validateBatchConfig } from '../run/validation';
import { Combobox } from '../ui/Combobox';
import { Field, Help, Label, LabelRow } from './FieldLayout';
import { SegmentedControl } from './SegmentedControl';
import { AlignedRowsEditor } from './AlignedRowsEditor';
import { FolderRowsEditor } from './FolderRowsEditor';
import { PathInput } from './PathInput';
import { PresetScanStatus } from './PresetScanStatus';
import { usesHardwareEncoder } from './presetWarnings';
import { LanguageSelect } from './LanguageSelect';
import { GlobalSystemSettings } from './GlobalSystemSettings';
import { FilterTab } from './FilterTab';
import { ProfileBar } from './profile/ProfileBar';
import { DiagnosticsPanel } from '../diagnostics/DiagnosticsPanel';

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

const GroupDescription = styled.p`
  margin: var(--hb-space-xs) 0 0;
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
`;

const Destructive = styled.div`
  margin-top: var(--hb-space-md);
  padding: var(--hb-space-md);
  border: 1px solid var(--hb-danger);
  border-radius: var(--hb-radius-md);
`;

const DestructiveCaption = styled.p`
  margin: 0;
  color: var(--hb-danger);
  font-size: var(--hb-font-xs);
  font-weight: 600;
`;

const NumberWrap = styled.div`
  display: flex;
  align-items: center;
  gap: var(--hb-space-xs);
`;

const Unit = styled.span`
  color: var(--hb-textMuted);
  font-size: var(--hb-font-sm);
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

/** Roots a profile field under its config section (`tab_batch`). */
function toConfigUpdate(path: string, value: unknown): Record<string, unknown> {
  const [root, ...rest] = path.split('.');
  return { [root]: writeValue(rest.join('.'), value) };
}

function conditionMatches(
  config: BatchConfig,
  rule: { path: string; equals?: string | number; notEquals?: string | number },
): boolean {
  const value = readValue(config, rule.path);
  if (rule.equals !== undefined) {
    return value === rule.equals || String(value) === String(rule.equals);
  }
  if (rule.notEquals !== undefined) {
    return value !== rule.notEquals && String(value) !== String(rule.notEquals);
  }
  return true;
}

function isVisible(field: FieldSchema, config: BatchConfig): boolean {
  const rule = field.showWhen;
  if (!rule) return true;
  return (
    (rule.all ?? []).every((condition) => conditionMatches(config, condition)) &&
    (!rule.any || rule.any.some((condition) => conditionMatches(config, condition)))
  );
}

interface FieldProps {
  field: FieldSchema;
  config: BatchConfig;
  onChange: (path: string, value: unknown) => void;
  onChangeMany: (updates: Record<string, unknown>) => void;
  presetScan?: ReturnType<typeof useHandBrakePresets>['data'];
  presetsLoading: boolean;
  refreshPresets: () => void;
}

const SettingsField: React.FC<FieldProps> = ({
  field,
  config,
  onChange,
  onChangeMany,
  presetScan,
  presetsLoading,
  refreshPresets,
}) => {
  const { formatMessage } = useIntl();
  const id = `setting-${field.path.replace(/\./g, '-')}`;
  const value = readValue(config, field.path);
  const label = formatMessage({ id: field.label, defaultMessage: field.label });
  const helpId = field.help || field.disabledReason ? `${id}-help` : undefined;
  const disabled = Boolean(field.disabledReason);

  const help = field.help && (
    <Help id={helpId}>{field.help}</Help>
  );
  const disabledHelp = field.disabledReason && (
    <Help id={helpId} style={{ color: 'var(--hb-warning)' }}>
      {field.disabledReason}
    </Help>
  );

  const numericValue = (next: string) =>
    field.numericOptions ? Number(next) : next;

  if (field.kind === 'toggle') {
    return (
      <Field>
        <Form.Check
          id={id}
          type="switch"
          checked={(value ?? field.defaultValue) === 1}
          disabled={disabled}
          label={label}
          aria-describedby={helpId}
          onChange={(event) => onChange(field.path, event.target.checked ? 1 : 0)}
        />
        {disabledHelp || help}
      </Field>
    );
  }

  if (field.kind === 'segmented') {
    return (
      <Field>
        <Label>{label}</Label>
        <div style={{ marginTop: 'var(--hb-space-xs)' }}>
          <SegmentedControl
            label={label}
            options={(field.options ?? []).map((option) => ({
              value: option.value,
              label: option.label,
              title: option.title,
            }))}
            value={String(value ?? field.options?.[0]?.value ?? '')}
            onChange={(next) => {
              const numeric = numericValue(next);
              const container = normalizeContainerExtension(
                String(readValue(config, 'tab_batch.container') ?? ''),
              );
              if (
                field.path === 'tab_batch.FFmpeg_toggle' &&
                numeric === 0 &&
                container &&
                !(HANDBRAKE_CONTAINERS as readonly string[]).includes(container)
              ) {
                // Switching to HandBrake makes FFmpeg-only containers invalid.
                onChangeMany({
                  [field.path]: numeric,
                  'tab_batch.container': '.mp4',
                });
                return;
              }
              onChange(field.path, numeric);
            }}
          />
        </div>
        {help}
      </Field>
    );
  }

  if (field.kind === 'select') {
    const encoderMode: EncoderMode =
      readValue(config, 'tab_batch.FFmpeg_toggle') === 1
        ? 'ffmpeg'
        : 'handbrake';
    const availableOptions = (field.options ?? []).filter(
      (option) => !option.modes || option.modes.includes(encoderMode),
    );
    const selected = String(value ?? availableOptions[0]?.value ?? '');
    return (
      <Field>
        <Label htmlFor={id}>{label}</Label>
        <Combobox
          id={id}
          value={selected}
          options={availableOptions.map((option) => ({
            value: option.value,
            label: option.text,
            title: option.title,
          }))}
          onChange={(next) => onChange(field.path, numericValue(next))}
          describedBy={helpId}
        />
        {help}
      </Field>
    );
  }

  if (field.kind === 'preset-rows') {
    const sourceRows = String(readValue(config, field.alignTo ?? '') ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const ffmpegMode = readValue(config, 'tab_batch.FFmpeg_toggle') === 1;
    // Profiles saved before the single preset field keep their selection in
    // `tab_batch.preset`; show it until the user picks a new one here.
    const legacyPreset = String(
      readValue(config, 'tab_batch.preset') ?? '',
    );
    const presetValue =
      String(value ?? '').trim().length > 0
        ? String(value)
        : ffmpegMode
          ? ''
          : legacyPreset;
    return (
      <Field>
        <LabelRow>
          <Label htmlFor={`${id}-0`}>
            {ffmpegMode
              ? formatMessage(settingsMessages.ffmpegArguments)
              : label}
          </Label>
        </LabelRow>
        {!ffmpegMode && (
          <PresetScanStatus
            scan={presetScan}
            loading={presetsLoading}
            onRefresh={refreshPresets}
          />
        )}
        <AlignedRowsEditor
          id={id}
          value={presetValue}
          onChange={(next) => onChange(field.path, next)}
          sourceRows={sourceRows}
          variant={ffmpegMode ? 'ffmpeg-args' : 'preset'}
          scan={presetScan}
          presetsLoading={presetsLoading}
        />
        <Help id={helpId}>
          {formatMessage(
            ffmpegMode
              ? settingsMessages.ffmpegArgsHelp
              : settingsMessages.customArgsHelp,
          )}
        </Help>
      </Field>
    );
  }

  if (field.kind === 'custom-args-rows' || field.kind === 'suffix-rows') {
    const sourceRows = String(readValue(config, field.alignTo ?? '') ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const ffmpegMode = readValue(config, 'tab_batch.FFmpeg_toggle') === 1;
    const variant =
      field.kind === 'suffix-rows'
        ? 'suffix'
        : ffmpegMode
          ? 'ffmpeg-args'
          : 'handbrake-args';
    const modeHelp =
      field.kind === 'custom-args-rows' ? (
        <Help id={helpId}>
          {formatMessage(
            ffmpegMode
              ? settingsMessages.ffmpegArgsHelp
              : settingsMessages.customArgsHelp,
          )}
        </Help>
      ) : (
        help
      );
    const displayedLabel =
      field.kind === 'custom-args-rows' && ffmpegMode
        ? formatMessage(settingsMessages.ffmpegArguments)
        : label;
    return (
      <Field>
        <Label htmlFor={`${id}-0`}>{displayedLabel}</Label>
        <AlignedRowsEditor
          id={id}
          value={String(value ?? '')}
          onChange={(next) => onChange(field.path, next)}
          sourceRows={sourceRows}
          variant={variant}
          scan={presetScan}
          presetsLoading={presetsLoading}
        />
        {modeHelp}
      </Field>
    );
  }

  if (field.kind === 'path') {
    return (
      <Field>
        <Label htmlFor={id}>{label}</Label>
        <PathInput
          id={id}
          value={String(value ?? '')}
          onChange={(next) => onChange(field.path, next)}
          kind={field.browse ?? 'file'}
          title={label}
          placeholder={field.placeholder}
          filters={field.browseFilters}
          allowClear
          describedBy={helpId}
        />
        {help}
      </Field>
    );
  }

  if (field.kind === 'number') {
    return (
      <Field>
        <Label htmlFor={id}>{label}</Label>
        <NumberWrap>
          <Form.Control
            id={id}
            type="number"
            value={String(value ?? '')}
            min={field.min}
            max={field.max}
            step={field.step}
            aria-describedby={helpId}
            onChange={(event) =>
              onChange(
                field.path,
                event.target.value === '' ? '' : Number(event.target.value),
              )
            }
          />
          {field.unit && <Unit>{field.unit}</Unit>}
        </NumberWrap>
        {help}
      </Field>
    );
  }

  const common = {
    id,
    value: String(value ?? ''),
    placeholder: field.placeholder,
    'aria-describedby': helpId,
  };

  return (
    <Field>
      <Label htmlFor={id}>{label}</Label>
      {field.kind === 'multiline' ? (
        <Form.Control
          as="textarea"
          rows={3}
          {...common}
          onChange={(event) => onChange(field.path, event.target.value)}
        />
      ) : field.options ? (
        <>
          <Form.Control
            list={`${id}-options`}
            {...common}
            onChange={(event) => onChange(field.path, event.target.value)}
          />
          <datalist id={`${id}-options`}>
            {field.options.map((option) => (
              <option key={option.value} value={option.value} />
            ))}
          </datalist>
        </>
      ) : (
        <Form.Control
          {...common}
          onChange={(event) => onChange(field.path, event.target.value)}
        />
      )}
      {help}
    </Field>
  );
};

const SettingsGroup: React.FC<{
  group: GroupSchema;
  config: BatchConfig;
  advanced: boolean;
  onChange: (path: string, value: unknown) => void;
  onChangeMany: (updates: Record<string, unknown>) => void;
  workerCount: number;
  presetScan?: ReturnType<typeof useHandBrakePresets>['data'];
  presetsLoading: boolean;
  refreshPresets: () => void;
}> = ({
  group,
  config,
  advanced,
  onChange,
  onChangeMany,
  workerCount,
  presetScan,
  presetsLoading,
  refreshPresets,
}) => {
  const { formatMessage } = useIntl();
  const fields = group.fields
    .filter((field) => isVisible(field, config))
    .filter((field) => advanced || !field.advanced);
  const tempEnabled =
    group.pathRows !== undefined &&
    readValue(config, group.pathRows.tempToggle) === 1;
  const showHardwareWarning =
    group.id === 'encoding' &&
    workerCount > 1 &&
    usesHardwareEncoder(config.tab_batch);

  if (fields.length === 0 && !group.pathRows) return null;

  const renderField = (field: FieldSchema) => (
    <SettingsField
      key={field.path}
      field={field}
      config={config}
      onChange={onChange}
      onChangeMany={onChangeMany}
      presetScan={presetScan}
      presetsLoading={presetsLoading}
      refreshPresets={refreshPresets}
    />
  );
  const risky = fields.filter((field) => field.destructive);
  const beforeRows = group.pathRows
    ? fields.filter((field) => field.beforeRows && !field.destructive)
    : [];
  const inline = fields.filter(
    (field) => !field.destructive && !field.beforeRows,
  );

  return (
    <Group open>
      <summary>{formatMessage({ id: group.title, defaultMessage: group.title })}</summary>
      {group.description && <GroupDescription>{group.description}</GroupDescription>}
      {beforeRows.map(renderField)}
      {group.pathRows && (
        <FolderRowsEditor
          id={group.id}
          sourcePath={String(readValue(config, group.pathRows.source) ?? '')}
          destinationPath={String(
            readValue(config, group.pathRows.destination) ?? '',
          )}
          tempPath={String(readValue(config, group.pathRows.temp) ?? '')}
          tempEnabled={tempEnabled}
          paths={{
            source: group.pathRows.source,
            destination: group.pathRows.destination,
            temp: group.pathRows.temp,
          }}
          onChange={(updates) =>
            onChangeMany(updates as Record<string, unknown>)
          }
        />
      )}
      {inline.map(renderField)}
      {showHardwareWarning && (
        <Alert variant="warning" className="mt-3" role="status">
          {formatMessage(settingsMessages.hardwareEncoderWarning)}
        </Alert>
      )}
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
  const {
    currentConfig,
    currentGlobalConfig,
    mergeUpdate,
    mergeGlobalUpdate,
  } = useUpdateConfigDebounced(config);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const presetScan = useHandBrakePresets(
    currentConfig.tab_batch?.FFmpeg_toggle !== 1,
  );
  const handleChangeMany = (updates: Record<string, unknown>) => {
    const merged = Object.entries(updates).reduce<Record<string, unknown>>(
      (accumulator, [path, value]) =>
        merge(accumulator, toConfigUpdate(path, value)),
      {},
    );
    mergeUpdate(merged as DeepPartial<BatchConfig>);
  };

  const handleChange = (path: string, value: unknown) =>
    handleChangeMany({ [path]: value });

  const globalSettings = resolveGlobalSettings(currentGlobalConfig);
  const workerCount = Number(globalSettings.worker_instance_number);
  const handleGlobalSettingsChange = (
    update: Partial<GlobalSettingsConfig>,
  ) => {
    mergeGlobalUpdate({
      app_settings: update,
    });
  };

  const problems = validateBatchConfig(currentConfig.tab_batch);

  return (
    <div>
      <Tabs defaultActiveKey="profiles" className="mb-3">
        <Tab
          eventKey="global"
          title={formatMessage(settingsMessages.globalSettings)}
        >
          <div style={{ paddingTop: 'var(--hb-space-sm)' }}>
            <GroupDescription>
              {formatMessage(settingsMessages.globalSettingsDescription)}
            </GroupDescription>
            <LanguageSelect config={currentGlobalConfig} />
            <GlobalSystemSettings
              value={globalSettings}
              onChange={handleGlobalSettingsChange}
            />
            <div style={{ marginTop: 'var(--hb-space-lg)' }}>
              <DiagnosticsPanel />
            </div>
          </div>
        </Tab>

        <Tab
          eventKey="profiles"
          title={formatMessage(settingsMessages.profileSettings)}
        >
          <div style={{ paddingTop: 'var(--hb-space-sm)' }}>
            <GroupDescription>
              {formatMessage(settingsMessages.profileSettingsDescription)}
            </GroupDescription>
            <div style={{ marginTop: 'var(--hb-space-md)' }}>
              <ProfileBar />
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                marginTop: 'var(--hb-space-sm)',
              }}
            >
              <Form.Check
                id="settings-show-advanced"
                type="switch"
                checked={showAdvanced}
                onChange={(event) => setShowAdvanced(event.target.checked)}
                label={formatMessage(settingsMessages.advanced)}
                title={formatMessage(settingsMessages.advancedHint)}
              />
            </div>

            {settingsSchema.map((group) => (
              <SettingsGroup
                key={group.id}
                group={group}
                config={currentConfig}
                advanced={showAdvanced}
                onChange={handleChange}
                onChangeMany={handleChangeMany}
                workerCount={workerCount}
                presetScan={presetScan.data}
                presetsLoading={presetScan.loading}
                refreshPresets={presetScan.refresh}
              />
            ))}

            {problems.length > 0 && (
              <Alert variant="warning" className="mt-3 mb-0">
                <strong>{formatMessage(settingsMessages.allProblems)}</strong>
                <ul className="mb-0">
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </Alert>
            )}
          </div>
        </Tab>

        <Tab
          eventKey="filters"
          title={formatMessage(settingsMessages.filterTab)}
        >
          <div style={{ paddingTop: 'var(--hb-space-sm)' }}>
            <ProfileBar />
            <FilterTab config={currentConfig} onChange={handleChange} />
          </div>
        </Tab>
      </Tabs>
    </div>
  );
};
