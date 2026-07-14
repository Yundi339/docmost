import type { IPageExtension } from "@/features/page/types/page.types";
import {
  getPageExtensionRenderer,
  getVisiblePageExtensions,
} from "./page-extension-registry";

export function PageExtensionIndicators({
  extensions = [],
}: {
  extensions?: IPageExtension[];
}) {
  return getVisiblePageExtensions(extensions).map((extension) => {
    const Renderer = getPageExtensionRenderer(extension.provider);
    if (!Renderer) return null;

    return (
      <Renderer
        key={`${extension.provider}:${extension.role}:${extension.resourceId}`}
        extension={extension}
      />
    );
  });
}
