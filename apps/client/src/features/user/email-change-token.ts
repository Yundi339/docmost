const EMAIL_CHANGE_TOKEN_STORAGE_KEY = "emailChangeToken";
export const EMAIL_CHANGE_CONFIRM_PARAM = "confirmEmailChange";

export function captureEmailChangeTokenFromLocation(): void {
  if (window.location.pathname !== "/settings/account/profile") return;

  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  const token = hashParams.get("emailChangeToken");
  if (!token) return;

  if (/^[A-Za-z0-9_-]{40,128}$/.test(token)) {
    window.sessionStorage.setItem(EMAIL_CHANGE_TOKEN_STORAGE_KEY, token);
  }

  const query = new URLSearchParams(window.location.search);
  query.set(EMAIL_CHANGE_CONFIRM_PARAM, "1");
  const search = query.toString();
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${search ? `?${search}` : ""}`,
  );
}

export function takeEmailChangeToken(): string | null {
  const token = window.sessionStorage.getItem(EMAIL_CHANGE_TOKEN_STORAGE_KEY);
  window.sessionStorage.removeItem(EMAIL_CHANGE_TOKEN_STORAGE_KEY);
  return token;
}
