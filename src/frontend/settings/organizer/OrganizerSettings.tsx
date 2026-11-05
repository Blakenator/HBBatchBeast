import React from 'react';
import styled from 'styled-components';
import { Form } from 'react-bootstrap';
import {
  createNameReplacementId,
  libraryOrganizeSettings,
  type AppConfigV2,
  type Library,
  type OrganizeNameReplacement,
  type OrganizeSettings,
} from '../../../common';
import { NamingRulesEditor } from '../../organize/NamingRulesEditor';
import { Button, IconButton } from '../../ui/Button';

const Wrap = styled.div`
  display: grid;
  gap: var(--hb-space-md);
`;

const Section = styled.section`
  display: grid;
  gap: var(--hb-space-sm);
  padding: var(--hb-space-md);
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-md);
  background: var(--hb-surface);
`;

const SectionTitle = styled.h3`
  margin: 0;
  font-size: var(--hb-font-sm);
  font-weight: 600;
`;

const Muted = styled.p`
  margin: 0;
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
`;

const ReplacementRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: var(--hb-space-sm);
  align-items: end;
`;

interface OrganizerSettingsProps {
  config: AppConfigV2;
  library: Library;
  onChange: (library: Library) => void;
}

/**
 * Organizer defaults for one library. The review workflow keeps its own copy of
 * the naming rules; both edit the same persisted settings.
 */
export const OrganizerSettings: React.FC<OrganizerSettingsProps> = ({
  library,
  onChange,
}) => {
  const settings = libraryOrganizeSettings(library);
  const update = (patch: Partial<OrganizeSettings>) =>
    onChange({ ...library, organize: { ...settings, ...patch } });
  const updateReplacement = (
    id: string,
    patch: Partial<OrganizeNameReplacement>,
  ) =>
    update({
      nameReplacements: settings.nameReplacements.map((rule) =>
        rule.id === id ? { ...rule, ...patch } : rule,
      ),
    });
  const isTv = library.mediaType === 'tv';

  return (
    <Wrap>
      <Section>
        <SectionTitle>Metadata</SectionTitle>
        {isTv ? (
          <Muted>
            TVDB is used for TV libraries. Match show folders to series in the
            Organize view; the matches are saved here.
          </Muted>
        ) : (
          <Form.Group style={{ maxWidth: '24rem' }}>
            <Form.Label>Movie metadata</Form.Label>
            <Form.Select
              value={settings.movieMetadata}
              onChange={(event) =>
                update({
                  movieMetadata:
                    event.target.value === 'plex' ? 'plex' : 'tvdb',
                })
              }
            >
              <option value="tvdb">TVDB (no Plex required)</option>
              <option value="plex">Plex database</option>
            </Form.Select>
          </Form.Group>
        )}
        <Muted>
          The Plex database itself is a global setting (Settings → Global) so
          every library uses the same server.
        </Muted>
      </Section>

      <Section>
        <SectionTitle>Naming rules</SectionTitle>
        <NamingRulesEditor
          mediaType={library.mediaType}
          rules={settings.namingRules}
          confidenceThreshold={settings.confidenceThreshold}
          onChange={(namingRules) => update({ namingRules })}
          onConfidenceChange={(confidenceThreshold) =>
            update({ confidenceThreshold })
          }
        />
      </Section>

      <Section>
        <SectionTitle>Name replacements</SectionTitle>
        <Muted>
          Replaced in file and show-folder names before matching. Matching is
          case-insensitive; the file on disk is never changed.
        </Muted>
        {settings.nameReplacements.map((rule, index) => (
          <ReplacementRow key={rule.id}>
            <Form.Group>
              <Form.Label>Find</Form.Label>
              <Form.Control
                value={rule.find}
                aria-label={`Find text ${index + 1}`}
                placeholder="e.g. _"
                onChange={(event) =>
                  updateReplacement(rule.id, { find: event.target.value })
                }
              />
            </Form.Group>
            <Form.Group>
              <Form.Label>Replace with</Form.Label>
              <Form.Control
                value={rule.replace}
                aria-label={`Replace with ${index + 1}`}
                placeholder="e.g. leave empty"
                onChange={(event) =>
                  updateReplacement(rule.id, { replace: event.target.value })
                }
              />
            </Form.Group>
            <IconButton
              icon="delete"
              label={`Remove replacement ${index + 1}`}
              onClick={() =>
                update({
                  nameReplacements: settings.nameReplacements.filter(
                    (candidate) => candidate.id !== rule.id,
                  ),
                })
              }
            />
          </ReplacementRow>
        ))}
        <div>
          <Button
            compact
            variant="secondary"
            icon="add"
            onClick={() =>
              update({
                nameReplacements: [
                  ...settings.nameReplacements,
                  { id: createNameReplacementId(), find: '', replace: '' },
                ],
              })
            }
          >
            Add replacement
          </Button>
        </div>
      </Section>

      <Section>
        <SectionTitle>Safety</SectionTitle>
        <Form.Group style={{ maxWidth: '24rem' }}>
          <Form.Label>Subtitle sidecars</Form.Label>
          <Form.Select
            value={settings.sidecars}
            onChange={(event) =>
              update({
                sidecars: event.target.value === 'skip' ? 'skip' : 'rename',
              })
            }
          >
            <option value="rename">Rename with the video</option>
            <option value="skip">Leave them in place</option>
          </Form.Select>
        </Form.Group>
        <Form.Group style={{ maxWidth: '24rem' }}>
          <Form.Label>Name collisions</Form.Label>
          <Form.Select
            value={settings.collisions}
            onChange={(event) =>
              update({
                collisions:
                  event.target.value === 'suffix' ? 'suffix' : 'block',
              })
            }
          >
            <option value="block">Block the row</option>
            <option value="suffix">Add a numeric suffix</option>
          </Form.Select>
        </Form.Group>
        <Form.Check
          id="organize-cleanup-empty-folders"
          type="switch"
          checked={settings.cleanupEmptyFolders}
          label="Remove empty folders after a move"
          onChange={(event) =>
            update({ cleanupEmptyFolders: event.target.checked })
          }
        />
        {!isTv && (
          <Form.Check
            id="organize-rename-movie-folders"
            type="switch"
            checked={settings.renameMovieFolders}
            label="Rename the movie folder too"
            onChange={(event) =>
              update({ renameMovieFolders: event.target.checked })
            }
          />
        )}
        <Form.Check
          id="organize-case-insensitive"
          type="switch"
          checked={settings.caseInsensitive === true}
          label="Treat paths as case-insensitive (Windows/macOS default)"
          onChange={(event) =>
            update({ caseInsensitive: event.target.checked })
          }
        />
      </Section>
    </Wrap>
  );
};
