export const SHARE_PASSWORD_REQUIRED = "SHARE_PASSWORD_REQUIRED";
export const SHARE_PASSWORD_INVALID = "SHARE_PASSWORD_INVALID";

export function getShareErrorCode(error: unknown): string | undefined {
  return (error as any)?.response?.data?.code;
}

export function isSharePasswordRequired(error: unknown): boolean {
  return getShareErrorCode(error) === SHARE_PASSWORD_REQUIRED;
}
