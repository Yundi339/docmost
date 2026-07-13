import { describe, expect, it } from "vitest";
import { getOAuthProviderDescriptor } from "./oauth-provider-registry";

describe("OAuth provider registry", () => {
  it("returns the ChatGPT descriptor from one central registry", () => {
    expect(getOAuthProviderDescriptor("chatgpt")).toEqual({
      id: "chatgpt",
      label: "ChatGPT OAuth",
      badge: "GPT",
      description: "ChatGPT OAuth provider for Docmost MCP.",
    });
  });

  it("renders an unknown server provider without hiding it", () => {
    expect(
      getOAuthProviderDescriptor("future-provider", "Future OAuth"),
    ).toEqual({
      id: "future-provider",
      label: "Future OAuth",
      badge: "FUT",
    });
  });
});
