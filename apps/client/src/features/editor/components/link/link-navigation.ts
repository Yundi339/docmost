import { sanitizeUrl } from "@docmost/editor-ext";

export function shouldOpenLinkInNewTab(
  isEditable: boolean,
  event: Pick<MouseEvent, "ctrlKey" | "metaKey">,
): boolean {
  return isEditable && (event.ctrlKey || event.metaKey);
}

export function resolveSafeNewTabUrl(
  href: string,
  origin: string,
): string | null {
  try {
    const absoluteUrl = new URL(href, origin).toString();
    return sanitizeUrl(absoluteUrl) || null;
  } catch {
    return null;
  }
}
