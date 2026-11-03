import React from 'react';
import styled from 'styled-components';
import { Form } from 'react-bootstrap';
import {
  libraryOrganizeSettings,
  type AppConfigV2,
  type Library,
  type OrganizeSettings,
} from '../../../common';
import { NamingRulesEditor } from '../../organize/NamingRulesEditor';

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
