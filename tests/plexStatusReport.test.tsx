// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { OrganizePlexCheck } from '../src/common';
import {
  PlexCommandBlock,
  PlexStatusReport,
} from '../src/frontend/ui/PlexStatusReport';

const { copyText } = vi.hoisted(() => ({
  copyText: vi.fn().mockResolvedValue(true),
}));

vi.mock('../src/frontend/core/utils', () => ({ copyText }));

afterEach(() => {
  cleanup();
  copyText.mockClear();
});

const check: OrganizePlexCheck = {
  path: '/var/lib/plex.db',
  exists: true,
  writable: false,
  running: true,
  serviceKind: 'systemd',
  issues: [
    {
      id: 'database-not-writable',
      severity: 'error',
      title: 'Plex database is read-only',
      detail: 'HBBatchBeast cannot write to the Plex database.',
      fixable: true,
    },
    {
      id: 'service-running',
      severity: 'warning',
      title: 'Plex Media Server is running',
      detail: 'Stop Plex before updating the database.',
      fixable: false,
    },
  ],
  remediation: {
    summary:
      'Stop Plex, grant "ada" write access to the database folder, then start Plex again.',
    steps: [
      {
        id: 'stop-service',
        title: 'Stop Plex Media Server',
        command: 'sudo systemctl stop plexmediaserver',
      },
      {
        id: 'grant-access',
        title: 'Grant your user access to the Plex database',
        command:
          "sudo find '/var/lib' -type d -exec setfacl -m 'u:ada:rwx,d:u:ada:rwx' {} +",
      },
      {
        id: 'start-service',
        title: 'Start Plex Media Server',
        command: 'sudo systemctl start plexmediaserver',
      },
    ],
    script:
      "sudo systemctl stop plexmediaserver\nsudo find '/var/lib' -type d -exec setfacl -m 'u:ada:rwx,d:u:ada:rwx' {} +\nsudo systemctl start plexmediaserver",
  },
  canAutoFix: true,
};

describe('PlexStatusReport', () => {
  it('renders status chips and structured issues', () => {
    render(<PlexStatusReport check={check} />);
    expect(screen.getByText('Database found')).toBeTruthy();
    expect(screen.getByText('Read-only')).toBeTruthy();
    expect(screen.getByText('Plex running')).toBeTruthy();
    expect(screen.getByText('Plex database is read-only')).toBeTruthy();
    expect(
      screen.getByText('HBBatchBeast cannot write to the Plex database.'),
    ).toBeTruthy();
    expect(screen.getByText('Plex Media Server is running')).toBeTruthy();
  });

  it('shows the full commands in a code block and copies them', async () => {
    render(<PlexStatusReport check={check} />);
    expect(screen.getByText(/sudo systemctl stop plexmediaserver/)).toBeTruthy();
    expect(screen.getByText(/setfacl -m 'u:ada:rwx,d:u:ada:rwx'/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Copy Plex fix commands' }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith(check.remediation.script));
    expect(screen.getByText('Copied')).toBeTruthy();
  });

  it('fires the automatic fix action', () => {
    const onAutoFix = vi.fn();
    render(<PlexStatusReport check={check} onAutoFix={onAutoFix} />);
    fireEvent.click(screen.getByRole('button', { name: /Fix automatically/ }));
    expect(onAutoFix).toHaveBeenCalledTimes(1);
  });

  it('shows automatic fix step results', () => {
    render(
      <PlexStatusReport
        check={check}
        fixSteps={[
          {
            id: 'stop-service',
            title: 'Stop Plex Media Server',
            ok: true,
          },
          {
            id: 'grant-access',
            title: 'Grant your user access to the Plex database',
            ok: false,
            detail: 'The administrator prompt was cancelled.',
          },
        ]}
      />,
    );
    expect(screen.getByLabelText('Automatic fix results')).toBeTruthy();
    expect(
      screen.getByText('The administrator prompt was cancelled.'),
    ).toBeTruthy();
  });

  it('can hide the fix action and manual commands', () => {
    render(
      <PlexStatusReport check={check} showAutoFix={false} showCommands={false} />,
    );
    expect(screen.queryByRole('button', { name: /Fix automatically/ })).toBeNull();
    expect(screen.queryByText('Manual fix')).toBeNull();
  });

  it('renders only the supplied commands in a command block', () => {
    render(
      <PlexCommandBlock
        steps={[check.remediation.steps[0]]}
        summary="Stop Plex first."
      />,
    );
    expect(screen.getByText('Stop Plex first.')).toBeTruthy();
    expect(screen.getByText(/sudo systemctl stop plexmediaserver/)).toBeTruthy();
    expect(screen.queryByText(/setfacl/)).toBeNull();
  });
});
