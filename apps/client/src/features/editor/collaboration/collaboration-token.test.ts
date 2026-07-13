import { describe, expect, it } from "vitest";

import { isCollaborationTokenExpired } from "./collaboration-token";

function tokenWithExpiry(exp: number) {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({ exp })}.signature`;
}

describe("isCollaborationTokenExpired", () => {
  it("detects an expired collaboration token", () => {
    expect(isCollaborationTokenExpired(tokenWithExpiry(99), 100_000)).toBe(
      true,
    );
    expect(isCollaborationTokenExpired(tokenWithExpiry(101), 100_000)).toBe(
      false,
    );
  });

  it("does not retry malformed or expiry-less tokens automatically", () => {
    expect(isCollaborationTokenExpired("invalid", 100_000)).toBe(false);
    expect(isCollaborationTokenExpired(tokenWithExpiry(NaN), 100_000)).toBe(
      false,
    );
  });
});
