export const ACCOUNT_API_KEY_ROUTES = {
  rest: "/settings/account/api-keys",
  mcp: "/settings/account/mcp/keys",
  oauth: "/settings/account/mcp/oauth",
  activity: "/settings/account/mcp/activity",
} as const;

export const LEGACY_ACCOUNT_MCP_ROUTES = {
  "/settings/account/oauth": ACCOUNT_API_KEY_ROUTES.oauth,
  "/settings/account/mcp-activity": ACCOUNT_API_KEY_ROUTES.activity,
} as const;

export const ACCOUNT_API_KEY_NAVIGATION = {
  rest: {
    label: "REST API keys",
    path: ACCOUNT_API_KEY_ROUTES.rest,
  },
  mcp: {
    label: "MCP keys",
    path: ACCOUNT_API_KEY_ROUTES.mcp,
  },
  oauth: {
    label: "OAuth applications",
    path: ACCOUNT_API_KEY_ROUTES.oauth,
  },
  activity: {
    label: "MCP activity",
    path: ACCOUNT_API_KEY_ROUTES.activity,
  },
} as const;
