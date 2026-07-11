import type { TFunction } from "i18next";

const auditFieldLabels: Record<string, string> = {
  toolName: "Tool",
  access: "Access",
  authType: "Authentication",
  credentialId: "Credential ID",
  apiKeyId: "API key ID",
  oauthAuthorizationId: "OAuth authorization ID",
  oauthClientId: "OAuth client ID",
  clientId: "Client ID",
  success: "Success",
  target: "Target",
  result: "Result",
  error: "Error",
  userAgent: "User agent",
  sessionId: "Session ID",
  reason: "Reason",
  mode: "Mode",
  scopes: "Scopes",
  provider: "Provider",
  clientName: "Client name",
  redirectHost: "Redirect host",
  redirectHosts: "Redirect hosts",
  existingRegistration: "Existing registration",
  authorizationUserId: "Authorization user ID",
  revokedByAdmin: "Revoked by administrator",
  name: "Name",
  isEnabled: "Enabled",
  allowedScopes: "Allowed scopes",
  title: "Title",
  format: "Format",
  includeChildren: "Include children",
  includeAttachments: "Include attachments",
  spaceId: "Space ID",
  pageId: "Page ID",
  commentId: "Comment ID",
  parentPageId: "Parent page ID",
  operation: "Operation",
  role: "Role",
  status: "Status",
  source: "Source",
  mcpMode: "MCP mode",
  disablePublicSharing: "Disable public sharing",
  emailDomains: "Email domains",
  expiresAt: "Expires at",
  closeReason: "Close reason",
  id: "ID",
};

const mcpToolLabels: Record<string, string> = {
  search_pages: "Search pages",
  get_page: "Get page",
  create_page: "Create page",
  update_page: "Update page",
  list_pages: "List pages",
  list_child_pages: "List child pages",
  duplicate_page: "Duplicate page",
  copy_page_to_space: "Copy page to space",
  move_page: "Move page",
  move_page_to_space: "Move page to space",
  get_space: "Get space",
  list_spaces: "List spaces",
  create_space: "Create space",
  update_space: "Update space",
  get_comments: "Get comments",
  create_comment: "Create comment",
  update_comment: "Update comment",
  search_attachments: "Search attachments",
  list_workspace_members: "List workspace members",
  get_current_user: "Get current user",
};

const auditValueLabels: Record<string, string> = {
  api_key: "API key",
  oauth: "OAuth",
  user: "User",
  system: "System",
  read: "Read",
  write: "Write",
  "read-only": "Read only",
  "read-write": "Read and write",
  off: "Off",
  password: "Password",
  client_closed: "Client closed",
  idle_timeout: "Idle timeout",
  session_replaced: "Session replaced",
  service_shutdown: "Service shutdown",
};

export function getAuditFieldLabel(key: string): string {
  return auditFieldLabels[key] ?? humanizeIdentifier(key);
}

export function getMcpToolLabel(toolName: string): string {
  return mcpToolLabels[toolName] ?? humanizeIdentifier(toolName);
}

export function formatAuditPrimitive(
  value: unknown,
  fieldKey: string,
  t: TFunction,
): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? t("Yes") : t("No");

  const text = String(value);
  if (fieldKey === "toolName") return t(getMcpToolLabel(text));

  const valueLabel = auditValueLabels[text];
  return valueLabel ? t(valueLabel) : text;
}

function humanizeIdentifier(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .trim();

  if (!words) return value;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
