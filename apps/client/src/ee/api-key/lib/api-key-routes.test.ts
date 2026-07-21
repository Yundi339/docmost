import { describe, expect, it } from "vitest";
import {
  ACCOUNT_API_KEY_NAVIGATION,
  ACCOUNT_API_KEY_ROUTES,
  LEGACY_ACCOUNT_MCP_ROUTES,
} from "./api-key-routes";

describe("account API key routes", () => {
  it("keeps REST and MCP account destinations separate", () => {
    expect(ACCOUNT_API_KEY_ROUTES.rest).toBe("/settings/account/api-keys");
    expect(ACCOUNT_API_KEY_ROUTES.mcp).toBe("/settings/account/mcp/keys");
    expect(ACCOUNT_API_KEY_ROUTES.oauth).toBe("/settings/account/mcp/oauth");
    expect(ACCOUNT_API_KEY_ROUTES.activity).toBe(
      "/settings/account/mcp/activity",
    );
  });

  it("maps legacy MCP URLs to canonical destinations", () => {
    expect(LEGACY_ACCOUNT_MCP_ROUTES).toEqual({
      "/settings/account/oauth": "/settings/account/mcp/oauth",
      "/settings/account/mcp-activity": "/settings/account/mcp/activity",
    });
  });

  it("defines the separated account menu labels and destinations", () => {
    expect(ACCOUNT_API_KEY_NAVIGATION).toEqual({
      rest: {
        label: "REST API keys",
        path: "/settings/account/api-keys",
      },
      mcp: {
        label: "MCP keys",
        path: "/settings/account/mcp/keys",
      },
      oauth: {
        label: "OAuth applications",
        path: "/settings/account/mcp/oauth",
      },
      activity: {
        label: "MCP activity",
        path: "/settings/account/mcp/activity",
      },
    });
  });
});
