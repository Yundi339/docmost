export function canToggleSsoProvider(
  loginAvailable: boolean,
  isEnabled: boolean,
): boolean {
  return loginAvailable || isEnabled;
}
