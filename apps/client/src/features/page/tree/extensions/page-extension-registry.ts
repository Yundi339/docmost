import type { ComponentType } from "react";
import type { IPageExtension } from "@/features/page/types/page.types";

export interface PageExtensionRendererProps {
  extension: IPageExtension;
}

const renderers = new Map<string, ComponentType<PageExtensionRendererProps>>();

export function registerPageExtensionRenderer(
  provider: string,
  renderer: ComponentType<PageExtensionRendererProps>,
): void {
  const existing = renderers.get(provider);
  if (existing && existing !== renderer) {
    throw new Error(`Page extension renderer already registered: ${provider}`);
  }
  renderers.set(provider, renderer);
}

export function getPageExtensionRenderer(provider: string) {
  return renderers.get(provider);
}

export function getVisiblePageExtensions(
  extensions: IPageExtension[],
): IPageExtension[] {
  const visible = new Map<string, IPageExtension>();
  for (const extension of extensions) {
    const key = `${extension.provider}:${extension.role}`;
    if (!visible.has(key)) visible.set(key, extension);
  }
  return [...visible.values()];
}
