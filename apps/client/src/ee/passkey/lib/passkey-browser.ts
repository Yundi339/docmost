let browserModulePromise:
  | Promise<typeof import("@simplewebauthn/browser")>
  | undefined;

function loadBrowserModule() {
  browserModulePromise ??= import("@simplewebauthn/browser");
  return browserModulePromise;
}

export function browserSupportsPasskeys(): boolean {
  return Boolean(
    window.isSecureContext &&
    window.PublicKeyCredential &&
    navigator.credentials,
  );
}

export function suggestedPasskeyName(userAgent = navigator.userAgent): string {
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\//.test(userAgent)
      ? "Opera"
      : /Chrome\/|CriOS\//.test(userAgent)
        ? "Chrome"
        : /Firefox\/|FxiOS\//.test(userAgent)
          ? "Firefox"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : "Browser";
  const os = /CrOS/.test(userAgent)
    ? "ChromeOS"
    : /Windows/.test(userAgent)
      ? "Windows"
      : /Macintosh|Mac OS/.test(userAgent)
        ? "macOS"
        : /iPhone|iPad|iPod/.test(userAgent)
          ? "iOS"
          : /Android/.test(userAgent)
            ? "Android"
            : /Linux/.test(userAgent)
              ? "Linux"
              : "";
  return os ? `${os} - ${browser}` : browser;
}

export function isPasskeyCancellation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "NotAllowedError" ||
    error.name === "AbortError" ||
    ("code" in error &&
      (error as Error & { code?: string }).code === "ERROR_CEREMONY_ABORTED")
  );
}

export async function startPasskeyAuthentication(
  options: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { startAuthentication } = await loadBrowserModule();
  return (await startAuthentication({
    optionsJSON: options as never,
  })) as unknown as Record<string, unknown>;
}

export async function startPasskeyRegistration(
  options: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { startRegistration } = await loadBrowserModule();
  return (await startRegistration({
    optionsJSON: options as never,
  })) as unknown as Record<string, unknown>;
}

export function abortPasskeyCeremony(): void {
  void browserModulePromise?.then(({ WebAuthnAbortService }) => {
    WebAuthnAbortService.cancelCeremony();
  });
}
