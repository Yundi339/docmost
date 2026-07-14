type EventOption = {
  value: string;
  label: string;
};

type EventGroup = {
  group: string;
  items: EventOption[];
};

export const auditEventLabels: Record<string, string> = {
  "workspace.created": "Created workspace",
  "workspace.updated": "Updated workspace",
  "workspace.invite_created": "Created invitation",
  "workspace.invite_resent": "Resent invitation",
  "workspace.invite_revoked": "Revoked invitation",

  "user.created": "Created user",
  "user.deleted": "Deleted user",
  "user.login": "Logged in",
  "user.logout": "Logged out",
  "user.role_changed": "Changed user role",
  "user.password_changed": "Changed password",
  "user.password_reset": "Reset password",
  "user.email_change_requested": "Requested email change",
  "user.email_changed": "Changed email",
  "user.updated": "Updated user",
  "user.deactivated": "Deactivated user",
  "user.activated": "Activated user",
  "user.login_failed": "Failed to log in",
  "user.passkey_created": "Added passkey",
  "user.passkey_renamed": "Renamed passkey",
  "user.passkey_deleted": "Deleted passkey",
  "user.passkey_counter_anomaly": "Disabled unsafe passkey",
  "user.mfa_enabled": "Enabled MFA",
  "user.mfa_disabled": "Disabled MFA",
  "user.mfa_backup_code_generated": "Generated MFA backup codes",

  "api_key.created": "Created API key",
  "api_key.updated": "Updated API key",
  "api_key.deleted": "Deleted API key",

  "mcp.tool_called": "Called MCP tool",
  "mcp.session_started": "Started MCP session",
  "mcp.session_closed": "Closed MCP session",
  "mcp.session_expired": "Expired MCP session",
  "mcp.auth_failed": "Rejected MCP authentication",
  "mcp.oauth_client_registered": "Registered MCP OAuth client",
  "mcp.oauth_client_updated": "Updated MCP OAuth settings",
  "mcp.oauth_authorized": "Authorized MCP OAuth connection",
  "mcp.oauth_revoked": "Revoked MCP OAuth connection",

  "database.created": "Created database",
  "database.view_created": "Created database view",
  "database.title_updated": "Updated database title",
  "database.field_created": "Created database field",
  "database.field_updated": "Updated database field",
  "database.record_created": "Created database work item",
  "database.record_updated": "Updated database work item",
  "database.record_reordered": "Reordered database work item",
  "database.record_attached": "Added page to database",
  "database.record_moved": "Moved work item between databases",
  "database.record_trashed": "Trashed database work item",

  "space.created": "Created space",
  "space.updated": "Updated space",
  "space.deleted": "Deleted space",
  "space.member_added": "Added space member",
  "space.member_removed": "Removed space member",
  "space.member_role_changed": "Changed space member role",
  "space.exported": "Exported space",
  "space.graph_exported": "Exported space relationship graph",

  "group.created": "Created group",
  "group.updated": "Updated group",
  "group.deleted": "Deleted group",
  "group.member_added": "Added group member",
  "group.member_removed": "Removed group member",

  "comment.deleted": "Deleted comment",

  "page.trashed": "Trashed page",
  "page.deleted": "Deleted page",
  "page.restored": "Restored page",
  "page.imported": "Imported page",
  "page.exported": "Exported page",
  "page.restricted": "Restricted page",
  "page.restriction_removed": "Removed page restriction",
  "page.permission_added": "Added page permission",
  "page.permission_removed": "Removed page permission",
  "page.verification_created": "Created page verification",
  "page.verification_updated": "Updated page verification",
  "page.verification_removed": "Removed page verification",
  "page.verified": "Verified page",
  "page.approval_requested": "Requested page approval",
  "page.approval_rejected": "Rejected page approval",
  "page.marked_obsolete": "Marked page as obsolete",

  "share.created": "Created share link",
  "share.deleted": "Deleted share link",
  "share.password_set": "Set share password",
  "share.password_updated": "Changed share password",
  "share.password_removed": "Removed share password",
  "share.password_unlock_failed": "Failed to unlock share",

  "sso.provider_created": "Created SSO provider",
  "sso.provider_updated": "Updated SSO provider",
  "sso.provider_deleted": "Deleted SSO provider",

  "license.activated": "Activated license",
  "license.removed": "Removed license",
};

export function getEventLabel(event: string): string {
  return auditEventLabels[event] ?? event;
}

export const eventFilterOptions: EventGroup[] = [
  {
    group: "Workspace",
    items: [
      { value: "workspace.updated", label: "Updated workspace" },
      { value: "workspace.invite_created", label: "Created invitation" },
      { value: "workspace.invite_revoked", label: "Revoked invitation" },
    ],
  },
  {
    group: "User",
    items: [
      { value: "user.login", label: "Logged in" },
      { value: "user.login_failed", label: "Failed to log in" },
      { value: "user.logout", label: "Logged out" },
      { value: "user.created", label: "Created user" },
      { value: "user.deleted", label: "Deleted user" },
      { value: "user.deactivated", label: "Deactivated user" },
      { value: "user.activated", label: "Activated user" },
      { value: "user.role_changed", label: "Changed user role" },
      { value: "user.password_changed", label: "Changed password" },
      {
        value: "user.email_change_requested",
        label: "Requested email change",
      },
      { value: "user.email_changed", label: "Changed email" },
      { value: "user.mfa_enabled", label: "Enabled MFA" },
      { value: "user.mfa_disabled", label: "Disabled MFA" },
      { value: "user.passkey_created", label: "Added passkey" },
      { value: "user.passkey_renamed", label: "Renamed passkey" },
      { value: "user.passkey_deleted", label: "Deleted passkey" },
      {
        value: "user.passkey_counter_anomaly",
        label: "Disabled unsafe passkey",
      },
    ],
  },
  {
    group: "Space",
    items: [
      { value: "space.created", label: "Created space" },
      { value: "space.updated", label: "Updated space" },
      { value: "space.deleted", label: "Deleted space" },
      { value: "space.member_added", label: "Added space member" },
      { value: "space.member_removed", label: "Removed space member" },
      {
        value: "space.graph_exported",
        label: "Exported space relationship graph",
      },
    ],
  },
  {
    group: "Group",
    items: [
      { value: "group.created", label: "Created group" },
      { value: "group.updated", label: "Updated group" },
      { value: "group.deleted", label: "Deleted group" },
      { value: "group.member_added", label: "Added group member" },
      { value: "group.member_removed", label: "Removed group member" },
    ],
  },
  {
    group: "MCP",
    items: [
      { value: "mcp.tool_called", label: "Called MCP tool" },
      { value: "mcp.session_started", label: "Started MCP session" },
      { value: "mcp.session_closed", label: "Closed MCP session" },
      { value: "mcp.session_expired", label: "Expired MCP session" },
      { value: "mcp.auth_failed", label: "Rejected MCP authentication" },
      {
        value: "mcp.oauth_client_registered",
        label: "Registered MCP OAuth client",
      },
      {
        value: "mcp.oauth_client_updated",
        label: "Updated MCP OAuth settings",
      },
      {
        value: "mcp.oauth_authorized",
        label: "Authorized MCP OAuth connection",
      },
      {
        value: "mcp.oauth_revoked",
        label: "Revoked MCP OAuth connection",
      },
    ],
  },
  {
    group: "Database",
    items: [
      { value: "database.created", label: "Created database" },
      {
        value: "database.view_created",
        label: "Created database view",
      },
      {
        value: "database.title_updated",
        label: "Updated database title",
      },
      {
        value: "database.field_created",
        label: "Created database field",
      },
      {
        value: "database.field_updated",
        label: "Updated database field",
      },
      {
        value: "database.record_created",
        label: "Created database work item",
      },
      {
        value: "database.record_updated",
        label: "Updated database work item",
      },
      {
        value: "database.record_reordered",
        label: "Reordered database work item",
      },
      {
        value: "database.record_attached",
        label: "Added page to database",
      },
      {
        value: "database.record_moved",
        label: "Moved work item between databases",
      },
      {
        value: "database.record_trashed",
        label: "Trashed database work item",
      },
    ],
  },
  {
    group: "Comment",
    items: [{ value: "comment.deleted", label: "Deleted comment" }],
  },
  {
    group: "Page",
    items: [
      { value: "page.trashed", label: "Trashed page" },
      { value: "page.deleted", label: "Deleted page" },
      { value: "page.restored", label: "Restored page" },
      { value: "page.imported", label: "Imported page" },
      { value: "page.exported", label: "Exported page" },
      { value: "page.restricted", label: "Restricted page" },
      { value: "page.restriction_removed", label: "Removed page restriction" },
      { value: "page.permission_added", label: "Added page permission" },
      { value: "page.permission_removed", label: "Removed page permission" },
      {
        value: "page.verification_created",
        label: "Created page verification",
      },
      {
        value: "page.verification_updated",
        label: "Updated page verification",
      },
      {
        value: "page.verification_removed",
        label: "Removed page verification",
      },
      { value: "page.verified", label: "Verified page" },
      { value: "page.approval_requested", label: "Requested page approval" },
      { value: "page.approval_rejected", label: "Rejected page approval" },
      { value: "page.marked_obsolete", label: "Marked page as obsolete" },
    ],
  },
  {
    group: "Share",
    items: [
      { value: "share.created", label: "Created share link" },
      { value: "share.deleted", label: "Deleted share link" },
      { value: "share.password_set", label: "Set share password" },
      { value: "share.password_updated", label: "Changed share password" },
      { value: "share.password_removed", label: "Removed share password" },
      {
        value: "share.password_unlock_failed",
        label: "Failed to unlock share",
      },
    ],
  },
  {
    group: "SSO",
    items: [
      { value: "sso.provider_created", label: "Created SSO provider" },
      { value: "sso.provider_updated", label: "Updated SSO provider" },
      { value: "sso.provider_deleted", label: "Deleted SSO provider" },
    ],
  },
  {
    group: "API key",
    items: [
      { value: "api_key.created", label: "Created API key" },
      { value: "api_key.deleted", label: "Deleted API key" },
    ],
  },
  {
    group: "License",
    items: [
      { value: "license.activated", label: "Activated license" },
      { value: "license.removed", label: "Removed license" },
    ],
  },
];
