import { createHash } from 'crypto';
import { DEFAULT_OAUTH_SCOPES, OAuthScope } from './oauth.constants';
import {
  buildAuthorizationKey,
  normalizeResourceUrl,
  normalizeScopes,
  verifyPkceS256,
} from './oauth-protocol.utils';

describe('OAuth protocol utilities', () => {
  it('does not grant destructive MCP access by default', () => {
    expect(DEFAULT_OAUTH_SCOPES).toEqual([OAuthScope.MCP_READ]);
    expect(DEFAULT_OAUTH_SCOPES).not.toContain(OAuthScope.MCP_DESTRUCTIVE);
  });

  it('adds prerequisite scopes without broadening unrelated requests', () => {
    expect(
      normalizeScopes([OAuthScope.MCP_DESTRUCTIVE], DEFAULT_OAUTH_SCOPES),
    ).toEqual([
      OAuthScope.MCP_READ,
      OAuthScope.MCP_WRITE,
      OAuthScope.MCP_DESTRUCTIVE,
    ]);
  });

  it('binds authorization identity to unambiguous client and resource values', () => {
    expect(buildAuthorizationKey('ab', 'c')).not.toBe(
      buildAuthorizationKey('a', 'bc'),
    );
    expect(buildAuthorizationKey('ab', 'c')).toHaveLength(64);
  });

  it('normalizes resource query and fragment before comparison', () => {
    expect(normalizeResourceUrl('https://docs.example.test/mcp/?a=1#x')).toBe(
      'https://docs.example.test/mcp',
    );
  });

  it('verifies PKCE S256', () => {
    const verifier = 'test-verifier-with-sufficient-entropy';
    const challenge = createHash('sha256').update(verifier).digest('base64url');

    expect(verifyPkceS256(verifier, challenge)).toBe(true);
    expect(verifyPkceS256(`${verifier}-wrong`, challenge)).toBe(false);
  });
});
