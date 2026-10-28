import React, { useState } from 'react';
import styled from 'styled-components';
import { Form } from 'react-bootstrap';
import {
  ConversionPreset,
  FilterRule,
  FolderPair,
  PresetRule,
  createEmptyFilterExpression,
  createRuleId,
} from '../../../common';
import { Button } from '../../ui/Button';
import { Combobox } from '../../ui/Combobox';
import { FilterBuilder } from '../../ui/filterBuilder/FilterBuilder';
import { FilterChips } from '../../ui/filterBuilder/FilterChips';
import {
  MappingFolderProvider,
  mappingFilterFields,
} from '../mappingFilterFields';

const Wrap = styled.div`
  display: grid;
  gap: var(--hb-space-sm);
`;

const Intro = styled.p`
  margin: 0;
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
`;

const Rules = styled.div`
  display: grid;
  gap: var(--hb-space-sm);
`;

const RuleCard = styled.div<{ $locked?: boolean }>`
  display: grid;
  gap: var(--hb-space-sm);
  padding: var(--hb-space-md);
  border: 1px solid
    ${({ $locked }) => ($locked ? 'var(--hb-borderStrong, var(--hb-border))' : 'var(--hb-border)')};
  border-radius: var(--hb-radius-md);
  background: ${({ $locked }) =>
    $locked ? 'var(--hb-surfaceMuted)' : 'var(--hb-surface)'};
`;

const RuleHead = styled.div`
  display: flex;
  align-items: center;
  gap: var(--hb-space-sm);
  flex-wrap: wrap;
`;

const RuleNumber = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  border-radius: 999px;
  background: var(--hb-surfaceMuted);
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
  font-weight: 700;
`;

const Grow = styled.div`
  flex: 1;
  min-width: 150px;
`;

const Actions = styled.div`
  display: flex;
  gap: 2px;
  align-items: center;
`;

const PresetLine = styled.div`
  display: grid;
  gap: var(--hb-space-xs);
`;

const FieldLabel = styled.span`
  font-size: var(--hb-font-xs);
  font-weight: 600;
  color: var(--hb-textMuted);
`;

const Summary = styled.div`
  display: grid;
  gap: var(--hb-space-xs);
`;

const LockBadge = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  border-radius: 999px;
  background: var(--hb-accent);
  color: var(--hb-accentContrast);
  font-size: var(--hb-font-xs);
  font-weight: 700;
`;

const LockedHead = styled.div`
  display: flex;
  align-items: center;
  gap: var(--hb-space-sm);
`;

const LockedTitle = styled.div`
  display: grid;
  gap: 2px;
`;

const LockedName = styled.span`
  font-weight: 600;
`;

const LockedHint = styled.span`
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
`;

interface MappingRulesEditorProps {
  rules: PresetRule[];
  folders: FolderPair[];
  presets: ConversionPreset[];
  encoder: 'handbrake' | 'ffmpeg';
  defaultPresetId: string;
  onDefaultPresetChange: (presetId: string) => void;
  onChange: (rules: PresetRule[]) => void;
}

function folderLabel(folder: FolderPair, index: number): string {
  const name = folder.source.split(/[\\/]/).filter(Boolean).pop();
  return name ? `${index + 1}. ${name}` : `Folder ${index + 1}`;
}

export const MappingRulesEditor: React.FC<MappingRulesEditorProps> = ({
  rules,
  folders,
  presets,
  encoder,
  defaultPresetId,
  onDefaultPresetChange,
  onChange,
}) => {
  const [expanded, setExpanded] = useState<Set<string>>(
    () =>
      new Set(
        rules
          .filter((rule) => rule.condition.root.children.length === 0)
          .map((rule) => rule.id),
      ),
  );
  const compatible = presets.filter((preset) =>
    encoder === 'handbrake' ? preset.handbrake : preset.ffmpeg,
  );

  const update = (id: string, next: Partial<PresetRule>) =>
    onChange(
      rules.map((rule) => (rule.id === id ? { ...rule, ...next } : rule)),
    );

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= rules.length) return;
    const next = [...rules];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const add = () => {
    const rule: PresetRule = {
      id: createRuleId(),
      name: `Rule ${rules.length + 1}`,
      condition: createEmptyFilterExpression(),
      presetId: compatible[0]?.id ?? '',
    };
    setExpanded((current) => new Set(current).add(rule.id));
    onChange([...rules, rule]);
  };

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const describeValue = (rule: FilterRule): string | undefined => {
    if (rule.field !== 'folder') return undefined;
    const value = rule.value as { folderId?: string; subpath?: string } | null;
    const index = folders.findIndex((folder) => folder.id === value?.folderId);
    const name =
      index >= 0 ? folderLabel(folders[index], index) : 'Choose a folder';
    return `Folder ${name}${value?.subpath ? ` / ${value.subpath}` : ''}`;
  };

  return (
    <MappingFolderProvider folders={folders}>
      <Wrap>
        <Intro>
          Rules run from top to bottom. The first matching rule chooses the
          preset. The locked default at the bottom handles every file that does
          not match a rule.
        </Intro>
        <div>
          <Button compact variant="secondary" onClick={add}>
            Add rule
          </Button>
        </div>
        <Rules>
          {rules.map((rule, index) => {
            const isExpanded = expanded.has(rule.id);
            return (
              <RuleCard key={rule.id}>
                <RuleHead>
                  <RuleNumber aria-label={`Rule ${index + 1}`}>
                    {index + 1}
                  </RuleNumber>
                  <Grow>
                    <Form.Control
                      value={rule.name ?? ''}
                      placeholder="Rule name (optional)"
                      aria-label={`Rule ${index + 1} name`}
                      onChange={(event) =>
                        update(rule.id, { name: event.target.value })
                      }
                    />
                  </Grow>
                  <Actions>
                    <Button
                      compact
                      variant="ghost"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      title="Move rule up"
                      aria-label="Move rule up"
                    >
                      ↑
                    </Button>
                    <Button
                      compact
                      variant="ghost"
                      onClick={() => move(index, 1)}
                      disabled={index === rules.length - 1}
                      title="Move rule down"
                      aria-label="Move rule down"
                    >
                      ↓
                    </Button>
                    <Button
                      compact
                      variant="ghost"
                      onClick={() =>
                        onChange(rules.filter((item) => item.id !== rule.id))
                      }
                      title="Delete rule"
                      aria-label="Delete rule"
                    >
                      ×
                    </Button>
                  </Actions>
                </RuleHead>

                <Summary>
                  <FieldLabel>When</FieldLabel>
                  <FilterChips
                    expression={rule.condition}
                    fields={mappingFilterFields}
                    empty="No conditions yet — add a stage below."
                    ariaLabel={`Rule ${index + 1} conditions`}
                    describeValue={describeValue}
                  />
                  <div>
                    <Button
                      compact
                      variant="ghost"
                      onClick={() => toggle(rule.id)}
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? 'Hide conditions' : 'Edit conditions'}
                    </Button>
                  </div>
                  {isExpanded && (
                    <FilterBuilder
                      value={rule.condition}
                      fields={mappingFilterFields}
                      onChange={(condition) =>
                        update(rule.id, { condition })
                      }
                      idPrefix={`mapping-rule-${rule.id}`}
                    />
                  )}
                </Summary>

                <PresetLine>
                  <FieldLabel>Use preset</FieldLabel>
                  <Combobox
                    id={`mapping-preset-${rule.id}`}
                    value={rule.presetId}
                    options={compatible.map((preset) => ({
                      value: preset.id,
                      label: preset.name,
                    }))}
                    onChange={(presetId) => update(rule.id, { presetId })}
                    ariaLabel={`Rule ${index + 1} preset`}
                  />
                </PresetLine>
              </RuleCard>
            );
          })}

          <RuleCard $locked>
            <LockedHead>
              <LockBadge aria-label="Locked">🔒</LockBadge>
              <LockedTitle>
                <LockedName>Default preset</LockedName>
                <LockedHint>
                  Used when no rule above matches. This rule is always present
                  and cannot be removed.
                </LockedHint>
              </LockedTitle>
            </LockedHead>
            <FieldLabel>Use preset</FieldLabel>
            <Combobox
              id="mapping-default-preset"
              value={defaultPresetId}
              options={compatible.map((preset) => ({
                value: preset.id,
                label: preset.name,
              }))}
              onChange={onDefaultPresetChange}
              ariaLabel="Default preset"
            />
          </RuleCard>
        </Rules>
      </Wrap>
    </MappingFolderProvider>
  );
};
