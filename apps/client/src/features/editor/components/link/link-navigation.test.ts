import { describe, expect, it } from "vitest";
import {
  resolveSafeNewTabUrl,
  shouldOpenLinkInNewTab,
} from "./link-navigation";

describe("link navigation", () => {
  it("uses Ctrl or Meta only while editing", () => {
    expect(
      shouldOpenLinkInNewTab(true, { ctrlKey: true, metaKey: false }),
    ).toBe(true);
    expect(
      shouldOpenLinkInNewTab(true, { ctrlKey: false, metaKey: true }),
    ).toBe(true);
    expect(
      shouldOpenLinkInNewTab(false, { ctrlKey: true, metaKey: false }),
    ).toBe(false);
  });

  it("resolves internal paths, anchors, and external URLs", () => {
    expect(resolveSafeNewTabUrl("/s/test/p/page", "https://docs.test")).toBe(
      "https://docs.test/s/test/p/page",
    );
    expect(resolveSafeNewTabUrl("#section", "https://docs.test/page")).toBe(
      "https://docs.test/page#section",
    );
    expect(
      resolveSafeNewTabUrl("https://example.com/path", "https://docs.test"),
    ).toBe("https://example.com/path");
  });

  it("rejects executable URL schemes", () => {
    expect(
      resolveSafeNewTabUrl("javascript:alert(1)", "https://docs.test"),
    ).toBeNull();
    expect(
      resolveSafeNewTabUrl("data:text/html,unsafe", "https://docs.test"),
    ).toBeNull();
  });
});
