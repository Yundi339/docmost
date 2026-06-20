import { ApiKeyScope, normalizeApiKeyScopes } from './api-key-scopes';

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
});
