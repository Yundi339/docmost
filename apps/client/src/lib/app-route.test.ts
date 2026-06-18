import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./app-route";

describe("safeRedirectPath", () => {
  it("allows same-origin absolute paths", () => {
    expect(safeRedirectPath("/s/docs/p/page?tab=1#top")).toBe(
      "/s/docs/p/page?tab=1#top",
    );
  });

  it("rejects external and protocol-relative redirects", () => {
    expect(safeRedirectPath("https://example.com/login")).toBeNull();
    expect(safeRedirectPath("//example.com/login")).toBeNull();
  });

  it("rejects control characters, whitespace, and backslashes", () => {
    expect(safeRedirectPath("/home\n/admin")).toBeNull();
    expect(safeRedirectPath("/home /admin")).toBeNull();
    expect(safeRedirectPath("/home\\admin")).toBeNull();
  });

  it("rejects scheme-like paths", () => {
    expect(safeRedirectPath("/javascript:alert(1)")).toBeNull();
  });
});
