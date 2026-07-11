import { describe, expect, it } from "vitest";
import {
  formatAuditPrimitive,
  getAuditFieldLabel,
  getMcpToolLabel,
} from "./audit-display";

const t = (key: string) =>
  (
    {
      Yes: "是",
      No: "否",
      "API key": "API 密钥",
      "Search pages": "搜索页面",
    } as Record<string, string>
  )[key] ?? key;

describe("audit display formatting", () => {
  it("labels known and future fields without exposing camelCase", () => {
    expect(getAuditFieldLabel("oauthAuthorizationId")).toBe(
      "OAuth authorization ID",
    );
    expect(getAuditFieldLabel("futureAuditField")).toBe("Future Audit Field");
  });

  it("labels MCP tools and common values", () => {
    expect(getMcpToolLabel("search_pages")).toBe("Search pages");
    expect(formatAuditPrimitive("search_pages", "toolName", t as any)).toBe(
      "搜索页面",
    );
    expect(formatAuditPrimitive("api_key", "authType", t as any)).toBe(
      "API 密钥",
    );
    expect(formatAuditPrimitive(true, "success", t as any)).toBe("是");
  });
});
