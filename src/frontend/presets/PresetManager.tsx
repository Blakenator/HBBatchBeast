import React from 'react';
import styled from 'styled-components';
import { Form } from 'react-bootstrap';
import {
  AppConfigV2,
  ConversionPreset,
  HandBrakePresetScan,
  createPresetId,
  libraryPresetIds,
  presetArgument,
} from '../../common';
import { Button } from '../ui/Button';
import { Combobox } from '../ui/Combobox';
import { PresetSelect } from '../settings/PresetSelect';
import { PresetScanStatus } from '../settings/PresetScanStatus';

const Wrap = styled.div`
  display: grid;
  gap: var(--hb-space-md);
`;

const Card = styled.section`
  display: grid;
  gap: var(--hb-space-sm);
  padding: var(--hb-space-md);
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-md);
  background: var(--hb-surface);
`;

const Head = styled.div`
  display: flex;
  gap: var(--hb-space-sm);
  align-items: center;
`;

const Grow = styled.div`
  flex: 1;
  min-width: 160px;
`;

interface PresetManagerProps {
  config: AppConfigV2;
  onChange: (presets: ConversionPreset[]) => void;
  scan?: HandBrakePresetScan;
  loading: boolean;
  onRefresh: () => void;
}

function kindOf(preset: ConversionPreset): 'handbrake' | 'ffmpeg' {
  return preset.handbrake ? 'handbrake' : 'ffmpeg';
}

function newPreset(kind: 'handbrake' | 'ffmpeg', index: number): ConversionPreset {
  return kind === 'handbrake'
    ? {
        id: createPresetId(),
        name: `HandBrake preset ${index}`,
        handbrake: { preset: '' },
      }
    : {
        id: createPresetId(),
        name: `FFmpeg preset ${index}`,
        ffmpeg: { inputArgs: '', outputArgs: '' },
      };
}

export const PresetManager: React.FC<PresetManagerProps> = ({
  config,
  onChange,
  scan,
  loading,
  onRefresh,
}) => {
  const used = new Set<string>();
  config.libraries.forEach((library) => {
    libraryPresetIds(library).forEach((id) => used.add(id));
  });

  const update = (id: string, next: Partial<ConversionPreset>) =>
    onChange(
      config.presets.map((preset) =>
        preset.id === id ? { ...preset, ...next } : preset,
      ),
    );

  const changeKind = (preset: ConversionPreset, kind: 'handbrake' | 'ffmpeg') => {
    if (kindOf(preset) === kind) return;
    update(preset.id, {
      handbrake: kind === 'handbrake' ? { preset: '' } : undefined,
      ffmpeg: kind === 'ffmpeg' ? { inputArgs: '', outputArgs: '' } : undefined,
    });
  };

  return (
    <Wrap>
      <div>
        <Button
          variant="secondary"
          onClick={() =>
            onChange([
              ...config.presets,
              newPreset('handbrake', config.presets.length + 1),
            ])
          }
        >
          Add HandBrake preset
        </Button>{' '}
        <Button
          variant="secondary"
          onClick={() =>
            onChange([
              ...config.presets,
              newPreset('ffmpeg', config.presets.length + 1),
            ])
          }
        >
          Add FFmpeg preset
        </Button>
      </div>

      <PresetScanStatus scan={scan} loading={loading} onRefresh={onRefresh} />

      {config.presets.map((preset) => {
        const kind = kindOf(preset);
        const inUse = used.has(preset.id);
        return (
          <Card key={preset.id}>
            <Head>
              <Grow>
                <Form.Control
                  value={preset.name}
                  aria-label="Preset name"
                  onChange={(event) =>
                    update(preset.id, { name: event.target.value })
                  }
                />
              </Grow>
              <Button
                compact
                variant="dangerOutline"
                disabled={inUse || config.presets.length <= 1}
                title={
                  inUse
                    ? 'This preset is used by a library default or mapping rule.'
                    : config.presets.length <= 1
                      ? 'Keep at least one preset.'
                      : undefined
                }
                onClick={() =>
                  onChange(
                    config.presets.filter((item) => item.id !== preset.id),
                  )
                }
              >
                Delete
              </Button>
            </Head>

            <Combobox
              id={`preset-kind-${preset.id}`}
              value={kind}
              options={[
                { value: 'handbrake', label: 'HandBrake' },
                { value: 'ffmpeg', label: 'FFmpeg' },
              ]}
              onChange={(next) =>
                changeKind(preset, next === 'ffmpeg' ? 'ffmpeg' : 'handbrake')
              }
              ariaLabel="Preset encoder"
            />

            {preset.handbrake ? (
              <>
                <PresetSelect
                  id={`preset-handbrake-${preset.id}`}
                  ariaLabel="HandBrake preset"
                  value={preset.handbrake.preset ?? ''}
                  onChange={(value) =>
                    update(preset.id, {
                      handbrake: { ...preset.handbrake, preset: value },
                    })
                  }
                  scan={scan}
                  loading={loading}
                />
                <Form.Control
                  value={preset.handbrake.args ?? ''}
                  placeholder="Optional raw HandBrakeCLI arguments (override the preset name)"
                  aria-label="HandBrake arguments"
                  onChange={(event) =>
                    update(preset.id, {
                      handbrake: {
                        ...preset.handbrake,
                        args: event.target.value,
                      },
                    })
                  }
                />
              </>
            ) : (
              <>
                <Form.Control
                  value={preset.ffmpeg?.inputArgs ?? ''}
                  placeholder="Arguments before -i, e.g. -ss 00:00:10"
                  aria-label="FFmpeg input arguments"
                  onChange={(event) =>
                    update(preset.id, {
                      ffmpeg: {
                        inputArgs: event.target.value,
                        outputArgs: preset.ffmpeg?.outputArgs ?? '',
                      },
                    })
                  }
                />
                <Form.Control
                  value={preset.ffmpeg?.outputArgs ?? ''}
                  placeholder="Arguments after the input, e.g. -c:v libx264 -crf 20"
                  aria-label="FFmpeg output arguments"
                  onChange={(event) =>
                    update(preset.id, {
                      ffmpeg: {
                        inputArgs: preset.ffmpeg?.inputArgs ?? '',
                        outputArgs: event.target.value,
                      },
                    })
                  }
                />
              </>
            )}

            {!presetArgument(preset) && (
              <span style={{ color: 'var(--hb-danger)' }}>
                Preset has no {kind} arguments.
              </span>
            )}
          </Card>
        );
      })}
    </Wrap>
  );
};
