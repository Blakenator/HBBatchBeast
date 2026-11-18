import React from 'react';
import styled from 'styled-components';
import type { DiffSegment } from '../../common';

const Removed = styled.span`
  color: var(--hb-danger);
  background: color-mix(in srgb, var(--hb-danger) 16%, transparent);
  border-radius: 2px;
  text-decoration: line-through;
`;

const Added = styled.span`
  color: var(--hb-success);
  background: color-mix(in srgb, var(--hb-success) 18%, transparent);
  border-radius: 2px;
  font-weight: 600;
`;

/**
 * Renders word-level name diff segments, used by the review table and the
 * multi-episode preview so "what changed in this name" looks the same in both.
 */
export const DiffSegments: React.FC<{
  segments: DiffSegment[];
  changedStyle: 'removed' | 'added';
}> = ({ segments, changedStyle }) => (
  <>
    {segments.map((segment, index) =>
      segment.changed ? (
        changedStyle === 'removed' ? (
          <Removed key={index} data-diff="removed">
            {segment.text}
          </Removed>
        ) : (
          <Added key={index} data-diff="added">
            {segment.text}
          </Added>
        )
      ) : (
        <React.Fragment key={index}>{segment.text}</React.Fragment>
      ),
    )}
  </>
);
