import { describe, expect, it } from "vitest";
import {
  formatAuditPrimitive,
  getAuditFieldLabel,
  getMcpToolLabel,
  getVisibleAuditMetadataEntries,
} from "./audit-display";
import { getEventLabel } from "./audit-event-labels";

const t = (key: string) =>
  (
    ({
      Yes: "是",
      No: "否",
      "API key": "API 密钥",
      "Search pages": "搜索页面",
      "Additional verification failed": "二次验证失败",
    }) as Record<string, string>
  )[key] ?? key;

describe("audit display formatting", () => {
  it("labels email change request and completion events", () => {
    expect(getEventLabel("user.email_change_requested")).toBe(
      "Requested email change",
    );
    expect(getEventLabel("user.email_changed")).toBe("Changed email");
  });

  it("labels space relationship graph exports", () => {
    expect(getEventLabel("space.graph_exported")).toBe(
      "Exported space relationship graph",
    );
  });

  it("labels known and future fields without exposing camelCase", () => {
    expect(getAuditFieldLabel("oauthAuthorizationId")).toBe(
      "OAuth authorization ID",
    );
    expect(getAuditFieldLabel("ownerRecovery")).toBe("Owner recovery");
    expect(getAuditFieldLabel("futureAuditField")).toBe("Future Audit Field");
  });

  it("labels MCP tools and common values", () => {
    expect(getMcpToolLabel("search_pages")).toBe("Search pages");
    expect(getMcpToolLabel("trash_page")).toBe("Move to trash");
    expect(getMcpToolLabel("restore_page")).toBe("Restore page");
    expect(formatAuditPrimitive("search_pages", "toolName", t as any)).toBe(
      "搜索页面",
    );
    expect(formatAuditPrimitive("api_key", "authType", t as any)).toBe(
      "API 密钥",
    );
    expect(formatAuditPrimitive(true, "success", t as any)).toBe("是");
    expect(formatAuditPrimitive("step_up_failed", "reason", t as any)).toBe(
      "二次验证失败",
    );
  });

  it("hides internal snapshots and duplicate generic credential IDs", () => {
    expect(
      getVisibleAuditMetadataEntries({
        authType: "api_key",
        credentialId: "key-id",
        apiKeyId: "key-id",
        resourceSnapshot: { id: "page-id" },
      }),
    ).toEqual([
      ["authType", "api_key"],
      ["apiKeyId", "key-id"],
    ]);

    expect(
      getVisibleAuditMetadataEntries({
        credentialId: "session-credential",
        apiKeyId: "key-id",
      }),
    ).toContainEqual(["credentialId", "session-credential"]);
  });
});
