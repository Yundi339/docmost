import {
  ApiKeyScope,
  ApiKeyType,
  DEFAULT_MCP_API_KEY_SCOPES,
  DEFAULT_REST_API_KEY_SCOPES,
  hasApiKeyScope,
  normalizeApiKeyScopes,
  normalizeApiKeyScopesForType,
} from './api-key-scopes';

describe('api key scopes', () => {
  it('normalizes write scopes to include the matching read scope', () => {
    expect(
      normalizeApiKeyScopes([ApiKeyScope.REST_WRITE, ApiKeyScope.MCP_WRITE]),
    ).toEqual([
      ApiKeyScope.REST_READ,
      ApiKeyScope.REST_WRITE,
      ApiKeyScope.MCP_READ,
      ApiKeyScope.MCP_WRITE,
    ]);
  });

  it('makes destructive access explicit while inheriting MCP read and write', () => {
    expect(DEFAULT_MCP_API_KEY_SCOPES).not.toContain(
      ApiKeyScope.MCP_DESTRUCTIVE,
    );
    expect(normalizeApiKeyScopes([ApiKeyScope.MCP_DESTRUCTIVE])).toEqual([
      ApiKeyScope.MCP_READ,
      ApiKeyScope.MCP_WRITE,
      ApiKeyScope.MCP_DESTRUCTIVE,
    ]);
  });

  it('uses separate minimal defaults for REST and MCP keys', () => {
    expect(DEFAULT_REST_API_KEY_SCOPES).toEqual([ApiKeyScope.REST_READ]);
    expect(DEFAULT_MCP_API_KEY_SCOPES).toEqual([ApiKeyScope.MCP_READ]);
    expect(normalizeApiKeyScopesForType(ApiKeyType.REST)).toEqual([
      ApiKeyScope.REST_READ,
    ]);
    expect(normalizeApiKeyScopesForType(ApiKeyType.MCP)).toEqual([
      ApiKeyScope.MCP_READ,
    ]);
  });

  it('rejects empty, mixed, unknown, and cross-type scopes', () => {
    expect(normalizeApiKeyScopesForType(ApiKeyType.REST, [])).toBeUndefined();
    expect(
      normalizeApiKeyScopesForType(ApiKeyType.REST, [
        ApiKeyScope.REST_READ,
        ApiKeyScope.MCP_READ,
      ]),
    ).toBeUndefined();
    expect(
      normalizeApiKeyScopesForType(ApiKeyType.MCP, [ApiKeyScope.REST_READ]),
    ).toBeUndefined();
    expect(
      normalizeApiKeyScopesForType(ApiKeyType.MCP, ['unknown']),
    ).toBeUndefined();
  });

  it('fails closed when guard-time scopes are absent or empty', () => {
    expect(hasApiKeyScope(undefined, ApiKeyScope.REST_READ)).toBe(false);
    expect(hasApiKeyScope(null, ApiKeyScope.REST_READ)).toBe(false);
    expect(hasApiKeyScope([], ApiKeyScope.REST_READ)).toBe(false);
  });
});
