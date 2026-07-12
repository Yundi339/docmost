import {
  ApiKeyScope,
  DEFAULT_API_KEY_SCOPES,
  normalizeApiKeyScopes,
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
    expect(DEFAULT_API_KEY_SCOPES).not.toContain(ApiKeyScope.MCP_DESTRUCTIVE);
    expect(normalizeApiKeyScopes([ApiKeyScope.MCP_DESTRUCTIVE])).toEqual([
      ApiKeyScope.MCP_READ,
      ApiKeyScope.MCP_WRITE,
      ApiKeyScope.MCP_DESTRUCTIVE,
    ]);
  });
});
