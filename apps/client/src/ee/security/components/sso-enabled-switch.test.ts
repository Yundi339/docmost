import { describe, expect, it } from "vitest";
import { canToggleSsoProvider } from "./sso-enabled-switch.utils";

describe("canToggleSsoProvider", () => {
  it("blocks enabling a provider without a login handler", () => {
    expect(canToggleSsoProvider(false, false)).toBe(false);
  });

  it("allows a legacy unavailable provider to be disabled", () => {
    expect(canToggleSsoProvider(false, true)).toBe(true);
  });

  it("allows available providers to be toggled", () => {
    expect(canToggleSsoProvider(true, false)).toBe(true);
  });
});
