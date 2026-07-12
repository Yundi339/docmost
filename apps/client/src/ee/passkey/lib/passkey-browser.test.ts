import { beforeEach, describe, expect, it, vi } from "vitest";

const cancelCeremony = vi.fn();
const startAuthentication = vi.fn().mockResolvedValue({ id: "credential" });
const startRegistration = vi.fn().mockResolvedValue({ id: "credential" });

vi.mock("@simplewebauthn/browser", () => ({
  WebAuthnAbortService: { cancelCeremony },
  startAuthentication,
  startRegistration,
}));

import {
  abortPasskeyCeremony,
  browserSupportsPasskeys,
  isPasskeyCancellation,
  startPasskeyAuthentication,
  suggestedPasskeyName,
} from "./passkey-browser";

describe("Passkey browser helpers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires a secure context and browser credential APIs", () => {
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(window, "PublicKeyCredential", {
      configurable: true,
      value: class {},
    });
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: {},
    });
    expect(browserSupportsPasskeys()).toBe(true);

    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: false,
    });
    expect(browserSupportsPasskeys()).toBe(false);
  });

  it("generates a short device name from existing browser information", () => {
    expect(
      suggestedPasskeyName(
        "Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/126.0",
      ),
    ).toBe("Windows - Chrome");
    expect(
      suggestedPasskeyName(
        "Mozilla/5.0 (Macintosh) AppleWebKit Version/17.0 Safari/605.1",
      ),
    ).toBe("macOS - Safari");
  });

  it("treats user cancellation and router cleanup as non-security errors", async () => {
    const cancellation = new Error("cancelled");
    cancellation.name = "NotAllowedError";
    expect(isPasskeyCancellation(cancellation)).toBe(true);

    await startPasskeyAuthentication({ challenge: "challenge" });
    abortPasskeyCeremony();
    await Promise.resolve();

    expect(cancelCeremony).toHaveBeenCalledTimes(1);
  });
});
