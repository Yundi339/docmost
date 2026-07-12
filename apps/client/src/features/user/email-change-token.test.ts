// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  captureEmailChangeTokenFromLocation,
  takeEmailChangeToken,
} from "./email-change-token";

describe("email change token handoff", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/settings/account/profile");
  });

  it("moves a fragment token out of the URL and consumes it once", () => {
    const token = "a".repeat(43);
    window.history.replaceState(
      {},
      "",
      `/settings/account/profile#emailChangeToken=${token}`,
    );

    captureEmailChangeTokenFromLocation();

    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("?confirmEmailChange=1");
    expect(takeEmailChangeToken()).toBe(token);
    expect(takeEmailChangeToken()).toBeNull();
  });

  it("does not retain malformed token material", () => {
    window.history.replaceState(
      {},
      "",
      "/settings/account/profile#emailChangeToken=invalid/token",
    );

    captureEmailChangeTokenFromLocation();

    expect(window.location.hash).toBe("");
    expect(takeEmailChangeToken()).toBeNull();
  });

  it("ignores fragments outside the account profile route", () => {
    window.history.replaceState(
      {},
      "",
      `/home#emailChangeToken=${"a".repeat(43)}`,
    );

    captureEmailChangeTokenFromLocation();

    expect(window.location.hash).not.toBe("");
    expect(takeEmailChangeToken()).toBeNull();
  });
});
