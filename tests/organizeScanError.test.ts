import { describe, expect, it } from 'vitest';
import { describeOrganizeScanError } from '../src/frontend/organize/scanError';

describe('organize scan error messages', () => {
  it('unwraps the generic async wrapper', () => {
    expect(
      describeOrganizeScanError({
        message: 'error',
        inner: {
          message: 'Organize scan failed',
          inner: { message: 'no such column: mti.originally_available_at' },
        },
      }),
    ).toBe('Organize scan failed');
  });

  it('skips empty messages in the chain', () => {
    expect(
      describeOrganizeScanError({
        message: '',
        inner: { message: 'Source folder does not exist' },
      }),
    ).toBe('Source folder does not exist');
  });

  it('never returns an empty message', () => {
    expect(describeOrganizeScanError(undefined)).toMatch(/Organize scan failed/);
    expect(describeOrganizeScanError({ message: '' })).toMatch(
      /Organize scan failed/,
    );
    expect(describeOrganizeScanError(new Error('boom'))).toBe('boom');
    expect(describeOrganizeScanError('boom')).toBe('boom');
  });
});
