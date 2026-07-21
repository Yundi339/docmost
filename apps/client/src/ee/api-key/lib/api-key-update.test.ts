import { describe, expect, it } from "vitest";
import { buildApiKeyUpdateRequest } from "./api-key-update";

describe("API key update payload", () => {
  it("omits scopes and space access in name-only mode", () => {
    expect(
      buildApiKeyUpdateRequest({
        apiKeyId: "key-1",
        name: "Renamed",
        nameOnly: true,
        scopes: ["mcp:read"],
        spaceAccess: { mode: "selected", spaceIds: ["space-1"] },
      }),
    ).toEqual({ apiKeyId: "key-1", name: "Renamed" });
  });

  it("includes scopes and space access for the key owner", () => {
    expect(
      buildApiKeyUpdateRequest({
        apiKeyId: "key-1",
        name: "Personal key",
        scopes: ["mcp:read"],
        spaceAccess: { mode: "selected", spaceIds: ["space-1"] },
      }),
    ).toEqual({
      apiKeyId: "key-1",
      name: "Personal key",
      scopes: ["mcp:read"],
      spaceAccess: { mode: "selected", spaceIds: ["space-1"] },
    });
  });
});
