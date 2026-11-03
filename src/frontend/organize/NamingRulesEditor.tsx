import React from 'react';
import { Form } from 'react-bootstrap';
import {
  createNamingRule,
  type MediaType,
  type NamingRule,
  type OrganizeConditionField,
  type OrganizeConditionOperator,
} from '../../common';
import { Button } from '../ui/Button';
import { TemplateField } from '../ui/TemplateField';

const FIELD_OPTIONS: { value: OrganizeConditionField; label: string }[] = [
  { value: 'mediaType', label: 'Media type' },
  { value: 'path', label: 'Path' },
  { value: 'filename', label: 'Filename' },
  { value: 'extension', label: 'Extension' },
  { value: 'resolution', label: 'Resolution' },
  { value: 'season', label: 'Season' },
  { value: 'episode', label: 'Episode' },
  { value: 'title', label: 'Title' },
  { value: 'year', label: 'Year' },
];

const OPERATOR_OPTIONS: { value: OrganizeConditionOperator; label: string }[] =
  [
    { value: 'is', label: 'is' },
    { value: 'isNot', label: 'is not' },
    { value: 'contains', label: 'contains' },
    { value: 'notContains', label: 'does not contain' },
    { value: 'atLeast', label: 'at least' },
    { value: 'atMost', label: 'at most' },
  ];

interface NamingRulesEditorProps {
  mediaType: MediaType;
  rules: NamingRule[];
  confidenceThreshold: number;
  onChange: (rules: NamingRule[]) => void;
  onConfidenceChange: (value: number) => void;
}

/**
 * Ordered first-match naming rules. The last rule is the default and cannot be
 * removed. Template fields support `{` completion and show an example line.
 */
export const NamingRulesEditor: React.FC<NamingRulesEditorProps> = ({
  mediaType,
  rules,
  confidenceThreshold,
  onChange,
  onConfidenceChange,
}) => {
  const updateRule = (index: number, patch: Partial<NamingRule>) => {
    onChange(rules.map((rule, position) => (position === index ? { ...rule, ...patch } : rule)));
  };

  const updateCondition = (
    ruleIndex: number,
    conditionIndex: number,
    patch: Partial<NamingRule['conditions'][number]>,
  ) => {
    const rule = rules[ruleIndex];
    if (!rule) return;
    updateRule(ruleIndex, {
      conditions: rule.conditions.map((condition, position) =>
        position === conditionIndex ? { ...condition, ...patch } : condition,
      ),
    });
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--hb-space-md)' }}>
      {rules.map((rule, ruleIndex) => {
        const isDefault = ruleIndex === rules.length - 1;
        return (
          <div
            key={rule.id}
            style={{
              border: '1px solid var(--hb-border)',
              borderRadius: 'var(--hb-radius-md)',
              padding: 'var(--hb-space-md)',
              display: 'grid',
              gap: 'var(--hb-space-sm)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--hb-space-sm)',
              }}
            >
              <strong>
                {isDefault
                  ? 'Default rule (always matches last)'
                  : `Rule ${ruleIndex + 1}`}
              </strong>
              <span style={{ flex: 1 }} />
              {!isDefault && (
                <Button
                  compact
                  variant="ghost"
                  onClick={() =>
                    onChange(rules.filter((_, position) => position !== ruleIndex))
                  }
                >
                  Remove
                </Button>
              )}
            </div>
            <TemplateField
              id={`naming-file-${rule.id}`}
              label="File template"
              mediaType={mediaType}
              value={rule.fileTemplate}
              onChange={(fileTemplate) => updateRule(ruleIndex, { fileTemplate })}
            />
            <TemplateField
              id={`naming-folder-${rule.id}`}
              label="Folder template"
              mediaType={mediaType}
              value={rule.folderTemplate}
              onChange={(folderTemplate) =>
                updateRule(ruleIndex, { folderTemplate })
              }
            />
            {!isDefault && (
              <div style={{ display: 'grid', gap: 'var(--hb-space-xs)' }}>
                <span
                  style={{
                    fontSize: 'var(--hb-font-xs)',
                    color: 'var(--hb-textMuted)',
                  }}
                >
                  Match {rule.match === 'all' ? 'all' : 'any'} of:
                </span>
                {rule.conditions.map((condition, conditionIndex) => (
                  <div
                    key={`${rule.id}-${conditionIndex}`}
                    style={{
                      display: 'flex',
                      gap: 'var(--hb-space-xs)',
                      flexWrap: 'wrap',
                    }}
                  >
                    <Form.Select
                      style={{ width: '11rem' }}
                      aria-label="Condition field"
                      value={condition.field}
                      onChange={(event) =>
                        updateCondition(ruleIndex, conditionIndex, {
                          field: event.target.value as OrganizeConditionField,
                        })
                      }
                    >
                      {FIELD_OPTIONS.map((field) => (
                        <option key={field.value} value={field.value}>
                          {field.label}
                        </option>
                      ))}
                    </Form.Select>
                    <Form.Select
                      style={{ width: '10rem' }}
                      aria-label="Condition operator"
                      value={condition.operator}
                      onChange={(event) =>
                        updateCondition(ruleIndex, conditionIndex, {
                          operator: event.target
                            .value as OrganizeConditionOperator,
                        })
                      }
                    >
                      {OPERATOR_OPTIONS.map((operator) => (
                        <option key={operator.value} value={operator.value}>
                          {operator.label}
                        </option>
                      ))}
                    </Form.Select>
                    <Form.Control
                      style={{ width: '12rem' }}
                      aria-label="Condition value"
                      value={String(condition.value ?? '')}
                      onChange={(event) =>
                        updateCondition(ruleIndex, conditionIndex, {
                          value: event.target.value,
                        })
                      }
                    />
                    <Button
                      compact
                      variant="ghost"
                      onClick={() =>
                        updateRule(ruleIndex, {
                          conditions: rule.conditions.filter(
                            (_, position) => position !== conditionIndex,
                          ),
                        })
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                <div>
                  <Button
                    compact
                    variant="ghost"
                    onClick={() =>
                      updateRule(ruleIndex, {
                        conditions: [
                          ...rule.conditions,
                          {
                            field: 'resolution',
                            operator: 'is',
                            value: '',
                          },
                        ],
                      })
                    }
                  >
                    Add condition
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <div>
        <Button
          compact
          variant="secondary"
          onClick={() => {
            // New rules go above the locked default so it stays last.
            const next = [...rules];
            next.splice(Math.max(0, rules.length - 1), 0, {
              ...createNamingRule(mediaType),
              name: undefined,
            });
            onChange(next);
          }}
        >
          Add rule
        </Button>
      </div>
      <Form.Group style={{ maxWidth: '18rem' }}>
        <Form.Label>Confidence threshold</Form.Label>
        <Form.Control
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={confidenceThreshold}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (Number.isFinite(parsed)) {
              onConfidenceChange(Math.min(1, Math.max(0, parsed)));
            }
          }}
        />
        <Form.Text muted>
          Matches below this confidence are skipped. Use Fix match in the review
          table to correct one file.
        </Form.Text>
      </Form.Group>
    </div>
  );
};
