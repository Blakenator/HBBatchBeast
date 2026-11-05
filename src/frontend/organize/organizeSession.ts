import { create } from 'zustand';
import type { OrganizePlan, OrganizeScanScope } from '../../common';

export type OrganizeStep = 'setup' | 'rules' | 'review';

export interface OrganizeSession {
  libraryId: string;
  step: OrganizeStep;
  plan?: OrganizePlan;
  selected: string[];
  scope: OrganizeScanScope[];
  matchSignature: string;
  planSignature: string;
  librarySignature: string;
  updatedAt: number;
}

interface OrganizeSessionStore {
  sessions: Record<string, OrganizeSession>;
  save: (session: OrganizeSession) => void;
  clear: (libraryId: string) => void;
}

const MAX_SESSIONS = 8;

export const useOrganizeSessionStore = create<OrganizeSessionStore>((set) => ({
  sessions: {},
  save: (session) =>
    set((state) => {
      const sessions = { ...state.sessions, [session.libraryId]: session };
      const ids = Object.keys(sessions);
      if (ids.length > MAX_SESSIONS) {
        ids
          .sort(
            (left, right) =>
              (sessions[left]?.updatedAt ?? 0) - (sessions[right]?.updatedAt ?? 0),
          )
          .slice(0, ids.length - MAX_SESSIONS)
          .forEach((id) => delete sessions[id]);
      }
      return { sessions };
    }),
  clear: (libraryId) =>
    set((state) => {
      const sessions = { ...state.sessions };
      delete sessions[libraryId];
      return { sessions };
    }),
}));

export function readOrganizeSession(
  libraryId: string,
): OrganizeSession | undefined {
  return useOrganizeSessionStore.getState().sessions[libraryId];
}

export function saveOrganizeSession(session: OrganizeSession): void {
  useOrganizeSessionStore.getState().save(session);
}
