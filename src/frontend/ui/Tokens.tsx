import React from 'react';
import styled from 'styled-components';

/** Bordered field shell shared by the token editor and its read-only view. */
export const TokenBox = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--hb-space-xs);
  padding: var(--hb-space-xs);
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-sm);
  background: var(--hb-surface);
`;

export const TokenChip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: var(--hb-space-xs);
  padding: 1px var(--hb-space-xs);
  border-radius: var(--hb-radius-sm);
  background: var(--hb-surfaceMuted);
  font-size: var(--hb-font-sm);
`;

interface TokenChipsProps {
  tokens: string[];
  empty?: React.ReactNode;
  ariaLabel?: string;
}

/** Read-only token list rendered with the same chips as `TokenListEditor`. */
export const TokenChips: React.FC<TokenChipsProps> = ({
  tokens,
  empty = '—',
  ariaLabel,
}) => {
  if (tokens.length === 0) return <>{empty}</>;

  return (
    <TokenBox role="list" aria-label={ariaLabel}>
      {tokens.map((token, index) => (
        <TokenChip role="listitem" key={`${token}-${index}`}>
          {token}
        </TokenChip>
      ))}
    </TokenBox>
  );
};
