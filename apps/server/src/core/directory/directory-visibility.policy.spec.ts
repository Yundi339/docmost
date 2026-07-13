import { DirectoryVisibilityPolicy } from './directory-visibility.policy';

describe('DirectoryVisibilityPolicy', () => {
  const policy = new DirectoryVisibilityPolicy();

  it('keeps legacy workspaces compatible', () => {
    expect(policy.resolveVisibility(undefined)).toBe('workspace');
    expect(policy.resolveVisibility({ directory: {} })).toBe('workspace');
  });

  it('accepts only known visibility values', () => {
    expect(
      policy.resolveVisibility({ directory: { visibility: 'context' } }),
    ).toBe('context');
    expect(
      policy.resolveVisibility({ directory: { visibility: 'invalid' } }),
    ).toBe('workspace');
  });

  it('gives workspace owners and admins full directory scope', () => {
    expect(policy.resolveScope('admins-only', 'owner', 'generic')).toBe(
      'workspace',
    );
    expect(policy.resolveScope('context', 'admin', 'space-member')).toBe(
      'workspace',
    );
  });

  it('never bypasses target page access for mentions and verifiers', () => {
    expect(policy.resolveScope('workspace', 'owner', 'mention')).toBe(
      'target-page',
    );
    expect(policy.resolveScope('admins-only', 'admin', 'verification')).toBe(
      'target-page',
    );
  });

  it('uses target access for member-facing contexts', () => {
    expect(policy.resolveScope('context', 'member', 'mention')).toBe(
      'target-page',
    );
    expect(policy.resolveScope('context', 'member', 'permission-picker')).toBe(
      'target-space',
    );
  });

  it('requires exact management lookup in admins-only mode', () => {
    expect(
      policy.resolveScope('admins-only', 'member', 'permission-picker'),
    ).toBe('exact');
    expect(policy.resolveScope('admins-only', 'member', 'generic')).toBe(
      'self',
    );
  });
});
