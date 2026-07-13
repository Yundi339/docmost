import { jwtDecode } from "jwt-decode";

export function isCollaborationTokenExpired(
  token: string,
  now = Date.now(),
): boolean {
  try {
    const payload = jwtDecode<{ exp?: number }>(token);
    return typeof payload.exp === "number" && now / 1000 >= payload.exp;
  } catch {
    return false;
  }
}
