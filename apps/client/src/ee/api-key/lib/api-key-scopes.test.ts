import { describe, expect, it } from "vitest";
import {
  buildApiKeyCreateRequest,
  getApiKeyConfigurationError,
  getDefaultApiKeyScopes,
  restrictApiKeyScopesToType,
} from "./api-key-scopes";

describe("API key type scopes", () => {
  it("defaults both key types to read-only access", () => {
    expect(getDefaultApiKeyScopes("rest")).toEqual(["rest:read"]);
    expect(getDefaultApiKeyScopes("mcp")).toEqual(["mcp:read"]);
  });

  it("restricts scopes to the immutable key type", () => {
    expect(
      restrictApiKeyScopesToType("rest", [
        "rest:read",
        "rest:write",
        "mcp:destructive",
      ]),
    ).toEqual(["rest:read", "rest:write"]);
    expect(
      restrictApiKeyScopesToType("mcp", ["rest:write", "mcp:read"]),
    ).toEqual(["mcp:read"]);
  });

  it("rejects cross-type scopes and invalid space access", () => {
    expect(
      getApiKeyConfigurationError("rest", ["mcp:read"], { mode: "all" }),
    ).toBe("invalid_scope");
    expect(
      getApiKeyConfigurationError("rest", ["rest:read"], {
        mode: "selected",
        spaceIds: ["space-1"],
      }),
    ).toBe("rest_space_access");
    expect(
      getApiKeyConfigurationError("mcp", ["mcp:read"], {
        mode: "selected",
        spaceIds: [],
      }),
    ).toBe("missing_space");
  });

  it("builds an explicit REST payload with all-space access", () => {
    expect(
      buildApiKeyCreateRequest({
        name: "REST client",
        expiresAt: "2026-08-20T00:00:00.000Z",
        keyType: "rest",
        scopes: ["rest:read"],
        spaceAccess: { mode: "selected", spaceIds: ["space-1"] },
      }),
    ).toEqual({
      name: "REST client",
      expiresAt: "2026-08-20T00:00:00.000Z",
      keyType: "rest",
      scopes: ["rest:read"],
      spaceAccess: { mode: "all" },
    });
  });

  it("builds an explicit MCP payload with selected-space access", () => {
    expect(
      buildApiKeyCreateRequest({
        name: "MCP client",
        expiresAt: "2026-08-20T00:00:00.000Z",
        keyType: "mcp",
        scopes: ["mcp:read", "mcp:write", "mcp:destructive"],
        spaceAccess: { mode: "selected", spaceIds: ["space-1"] },
      }),
    ).toEqual({
      name: "MCP client",
      expiresAt: "2026-08-20T00:00:00.000Z",
      keyType: "mcp",
      scopes: ["mcp:read", "mcp:write", "mcp:destructive"],
      spaceAccess: { mode: "selected", spaceIds: ["space-1"] },
    });
  });
});
