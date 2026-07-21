import { describe, expect, it } from "vitest";
import {
  getApiKeyConfigurationError,
  restrictApiKeyScopesToMcp,
} from "./api-key-scopes";

describe("API key scopes with space access", () => {
  it("rejects REST scopes for selected-space access", () => {
    expect(
      getApiKeyConfigurationError(["rest:read", "mcp:read"], {
        mode: "selected",
        spaceIds: ["space-1"],
      }),
    ).toBe("rest_scope_with_selected_spaces");
  });

  it("allows REST scopes when all spaces are selected", () => {
    expect(
      getApiKeyConfigurationError(["rest:read"], { mode: "all" }),
    ).toBeNull();
  });

  it("requires both a selected space and at least one scope", () => {
    expect(
      getApiKeyConfigurationError(["mcp:read"], {
        mode: "selected",
        spaceIds: [],
      }),
    ).toBe("missing_space");
    expect(getApiKeyConfigurationError([], { mode: "all" })).toBe(
      "missing_scope",
    );
  });

  it("retains MCP scopes and supplies read access when none remain", () => {
    expect(
      restrictApiKeyScopesToMcp(["rest:read", "mcp:read", "mcp:destructive"]),
    ).toEqual(["mcp:read", "mcp:destructive"]);
    expect(restrictApiKeyScopesToMcp(["rest:read", "rest:write"])).toEqual([
      "mcp:read",
    ]);
  });
});
