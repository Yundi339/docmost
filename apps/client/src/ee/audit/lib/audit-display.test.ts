import { describe, expect, it } from "vitest";
import {
  formatAuditPrimitive,
  getAuditFieldLabel,
  getMcpToolLabel,
  getVisibleAuditChangeKeys,
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
      Rename: "重命名",
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
    expect(getEventLabel("system.diagnostic_detected")).toBe(
      "Detected system diagnostic",
    );
  });

  it("labels known and future fields without exposing camelCase", () => {
    expect(getAuditFieldLabel("oauthAuthorizationId")).toBe(
      "OAuth authorization ID",
    );
    expect(getAuditFieldLabel("ownerRecovery")).toBe("Owner recovery");
    expect(getAuditFieldLabel("optionOperation")).toBe(
      "Field option operation",
    );
    expect(getAuditFieldLabel("affectedRecordCount")).toBe(
      "Affected record count",
    );
    expect(getAuditFieldLabel("diagnosticCode")).toBe("Diagnostic code");
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
    expect(formatAuditPrimitive("rename", "optionOperation", t as any)).toBe(
      "重命名",
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

  it("hides page identity fields already represented by readable resource details", () => {
    expect(
      getVisibleAuditChangeKeys(
        {
          before: {
            title: "Meeting notes",
            pageId: "page-id",
            slugId: "slug-id",
            spaceId: "space-id",
          },
        },
        {
          id: "page-id",
          type: "page",
          slugId: "slug-id",
          spaceName: "Engineering",
        },
      ),
    ).toEqual(["title"]);
  });

  it("keeps space IDs when they describe an actual cross-space move", () => {
    expect(
      getVisibleAuditChangeKeys(
        {
          before: { spaceId: "old-space" },
          after: { spaceId: "new-space" },
        },
        { id: "page-id", type: "page", spaceName: "New space" },
      ),
    ).toEqual(["spaceId"]);
  });
});
