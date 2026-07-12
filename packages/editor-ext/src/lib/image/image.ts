import Image from "@tiptap/extension-image";
import { ImageOptions as DefaultImageOptions } from "@tiptap/extension-image";
import { ReactNodeViewRenderer } from "@tiptap/react";
import {
  mergeAttributes,
  Range,
} from "@tiptap/core";
import { ResizableNodeView } from "../resizable-nodeview";
import type { ResizableNodeViewDirection } from "../resizable-nodeview";
import { normalizeFileUrl } from "../media-utils";
import type { DOMOutputSpec } from "@tiptap/pm/model";

export type ImageResizeOptions = {
  enabled: boolean;
  directions?: ResizableNodeViewDirection[];
  minWidth?: number;
  minHeight?: number;
  alwaysPreserveAspectRatio?: boolean;
  createCustomHandle?: (direction: ResizableNodeViewDirection) => HTMLElement;
  className?: {
    container?: string;
    wrapper?: string;
    handle?: string;
    resizing?: string;
  };
};

export interface ImageOptions extends DefaultImageOptions {
  view: any;
  resize: ImageResizeOptions | false;
}

export interface ImageAttributes {
  src?: string;
  alt?: string;
  caption?: string;
  align?: string;
  attachmentId?: string;
  size?: number;
  width?: number | string;
  height?: number;
  aspectRatio?: number;
  placeholder?: {
    id: string;
    name: string;
  };
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    imageBlock: {
      setImage: (attributes: ImageAttributes) => ReturnType;
      setImageAt: (
        attributes: ImageAttributes & { pos: number | Range },
      ) => ReturnType;
      setImageAlign: (align: "left" | "center" | "right") => ReturnType;
      setImageWidth: (width: number) => ReturnType;
      setImageSize: (width: number, height: number) => ReturnType;
      setImageCaption: (caption?: string) => ReturnType;
    };
  }
}

export const TiptapImage = Image.extend<ImageOptions>({
  name: "image",

  inline: false,
  group: "block",
  isolating: true,
  atom: true,
  defining: true,

  addOptions() {
    return {
      ...this.parent?.(),
      view: null,
      resize: false,
    };
  },

  addAttributes() {
    return {
      src: {
        default: "",
        parseHTML: (element) => getImageElement(element)?.getAttribute("src"),
        renderHTML: (attributes) => ({
          src: attributes.src,
        }),
      },
      width: {
        default: null,
        parseHTML: (element) => {
          const raw = getImageElement(element)?.getAttribute("width");
          if (!raw) return null;
          if (raw.endsWith("%")) return raw;
          const num = parseFloat(raw);
          return isNaN(num) ? null : num;
        },
        renderHTML: (attributes: ImageAttributes) => ({
          width: attributes.width,
        }),
      },
      height: {
        default: null,
        parseHTML: (element) => {
          const raw = getImageElement(element)?.getAttribute("height");
          if (!raw) return null;
          const num = parseFloat(raw);
          return isNaN(num) ? null : num;
        },
        renderHTML: (attributes: ImageAttributes) => ({
          height: attributes.height,
        }),
      },
      align: {
        default: "center",
        parseHTML: (element) =>
          element.getAttribute("data-align") ||
          getImageElement(element)?.getAttribute("data-align"),
        renderHTML: (attributes: ImageAttributes) => ({
          "data-align": attributes.align,
        }),
      },
      alt: {
        default: undefined,
        parseHTML: (element) => getImageElement(element)?.getAttribute("alt"),
        renderHTML: (attributes: ImageAttributes) => ({
          alt: attributes.alt,
        }),
      },
      caption: {
        default: undefined,
        rendered: false,
        parseHTML: (element) => {
          if (element.tagName === "FIGURE") {
            return sanitizeImageCaption(
              element.querySelector("figcaption")?.textContent || "",
            );
          }
          return undefined;
        },
      },
      attachmentId: {
        default: undefined,
        parseHTML: (element) =>
          getImageElement(element)?.getAttribute("data-attachment-id"),
        renderHTML: (attributes: ImageAttributes) => ({
          "data-attachment-id": attributes.attachmentId,
        }),
      },
      size: {
        default: null,
        parseHTML: (element) =>
          getImageElement(element)?.getAttribute("data-size"),
        renderHTML: (attributes: ImageAttributes) => ({
          "data-size": attributes.size,
        }),
      },
      aspectRatio: {
        default: null,
        parseHTML: (element) =>
          getImageElement(element)?.getAttribute("data-aspect-ratio"),
        renderHTML: (attributes: ImageAttributes) => ({
          "data-aspect-ratio": attributes.aspectRatio,
        }),
      },
      placeholder: {
        default: null,
        rendered: false,
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'figure[data-type="image"]' },
      { tag: "img[src]" },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const image: DOMOutputSpec = [
      "img",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
    ];
    const caption = sanitizeImageCaption(node.attrs.caption || "");
    if (!caption) return image;
    return [
      "figure",
      { "data-type": "image", "data-align": node.attrs.align || "center" },
      image,
      ["figcaption", {}, caption],
    ] as DOMOutputSpec;
  },

  addCommands() {
    return {
      setImage:
        (attrs: ImageAttributes) =>
        ({ commands }) => {
          return commands.insertContent({
            type: "image",
            attrs: attrs,
          });
        },

      setImageAt:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContentAt(attrs.pos, {
            type: "image",
            attrs: attrs,
          });
        },

      setImageAlign:
        (align) =>
        ({ commands }) =>
          commands.updateAttributes("image", { align }),

      setImageWidth:
        (width) =>
        ({ commands }) =>
          commands.updateAttributes("image", { width }),

      setImageSize:
        (width, height) =>
        ({ commands }) =>
          commands.updateAttributes("image", { width, height }),

      setImageCaption:
        (caption) =>
        ({ commands }) =>
          commands.updateAttributes("image", {
            caption: sanitizeImageCaption(caption || "") || undefined,
          }),
    };
  },

  addNodeView() {
    const resize = this.options.resize;

    if (!resize || !resize.enabled) {
      // Fallback to React node view (existing behavior)
      this.editor.isInitialized = true;
      return ReactNodeViewRenderer(this.options.view);
    }

    const {
      directions,
      minWidth,
      minHeight,
      alwaysPreserveAspectRatio,
      createCustomHandle,
      className,
    } = resize;

    return (props) => {
      const { node, getPos, HTMLAttributes, editor } = props;

      // If no src yet (placeholder/uploading), use React view for loading UI
      if (!HTMLAttributes.src) {
        editor.isInitialized = true;
        const reactView = ReactNodeViewRenderer(this.options.view);
        const view = reactView(props);

        // When the node gets a src, return false from update to force rebuild
        const originalUpdate = view.update?.bind(view);
        view.update = (updatedNode, decorations, innerDecorations) => {
          if (updatedNode.attrs.src && !node.attrs.src) {
            return false;
          }
          if (originalUpdate) {
            return originalUpdate(updatedNode, decorations, innerDecorations);
          }
          return true;
        };

        return view;
      }

      // Has src — use ResizableNodeView
      const el = document.createElement("img");

      Object.entries(HTMLAttributes).forEach(([key, value]) => {
        if (value != null) {
          switch (key) {
            case "width":
            case "height":
              break;
            default:
              el.setAttribute(key, String(value));
              break;
          }
        }
      });

      el.src = normalizeFileUrl(HTMLAttributes.src);
      el.style.display = "block";
      el.style.maxWidth = "100%";
      el.style.borderRadius = "8px";

      if (typeof node.attrs.width === "number" && node.attrs.width > 0) {
        el.style.width = `${node.attrs.width}px`;
        if (typeof node.attrs.height === "number" && node.attrs.height > 0) {
          el.style.height = `${node.attrs.height}px`;
        }
      }

      let currentNode = node;
      const captionEl = createCaptionElement(
        node.attrs.caption,
        editor.isEditable,
      );

      const commitCaption = () => {
        if (!editor.isEditable) return;
        const pos = getPos();
        if (pos === undefined) return;
        const caption = sanitizeImageCaption(captionEl.textContent || "");
        if (captionEl.textContent !== caption) {
          captionEl.textContent = caption;
        }
        if ((currentNode.attrs.caption || "") === caption) return;
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, {
            ...currentNode.attrs,
            caption: caption || undefined,
          }),
        );
      };
      const handleCaptionKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commitCaption();
          captionEl.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          captionEl.textContent = currentNode.attrs.caption || "";
          captionEl.blur();
        }
      };
      const handleCaptionPaste = (event: ClipboardEvent) => {
        event.preventDefault();
        const text = sanitizeImageCaption(
          event.clipboardData?.getData("text/plain") || "",
        );
        document.execCommand("insertText", false, text);
      };
      captionEl.addEventListener("input", commitCaption);
      captionEl.addEventListener("blur", commitCaption);
      captionEl.addEventListener("keydown", handleCaptionKeyDown);
      captionEl.addEventListener("paste", handleCaptionPaste);

      const nodeView = new ResizableNodeView({
        element: el,
        editor,
        node,
        getPos,
        onResize: (w, h) => {
          el.style.width = `${w}px`;
          el.style.height = `${h}px`;
        },
        onCommit: () => {
          const pos = getPos();
          if (pos === undefined) return;

          this.editor
            .chain()
            .setNodeSelection(pos)
            .updateAttributes(this.name, {
              width: Math.round(el.offsetWidth),
              height: Math.round(el.offsetHeight),
            })
            .run();
        },
        onUpdate: (updatedNode, _decorations, _innerDecorations) => {
          if (updatedNode.type !== currentNode.type) {
            return false;
          }

          if (updatedNode.attrs.src !== currentNode.attrs.src) {
            el.src = normalizeFileUrl(updatedNode.attrs.src);
          }

          if (updatedNode.attrs.alt !== currentNode.attrs.alt) {
            el.alt = updatedNode.attrs.alt || "";
          }

          if (
            updatedNode.attrs.caption !== currentNode.attrs.caption &&
            document.activeElement !== captionEl
          ) {
            captionEl.textContent = updatedNode.attrs.caption || "";
          }
          captionEl.contentEditable = String(editor.isEditable);

          const w = updatedNode.attrs.width;
          const h = updatedNode.attrs.height;
          if (w != null) {
            el.style.width = `${w}px`;
          }
          if (h != null) {
            el.style.height = `${h}px`;
          }

          // Update alignment on container
          const align = updatedNode.attrs.align || "center";
          const container = nodeView.dom as HTMLElement;
          applyAlignment(container, align);

          currentNode = updatedNode;
          return true;
        },
        options: {
          directions,
          min: {
            width: minWidth,
            height: minHeight,
          },
          preserveAspectRatio: alwaysPreserveAspectRatio === true,
          createCustomHandle,
          className,
        },
      });

      const dom = nodeView.dom as HTMLElement;
      nodeView.wrapper.appendChild(captionEl);

      const originalDestroy = nodeView.destroy.bind(nodeView);
      nodeView.destroy = () => {
        captionEl.removeEventListener("input", commitCaption);
        captionEl.removeEventListener("blur", commitCaption);
        captionEl.removeEventListener("keydown", handleCaptionKeyDown);
        captionEl.removeEventListener("paste", handleCaptionPaste);
        originalDestroy();
      };
      (nodeView as any).stopEvent = (event: Event) =>
        captionEl.contains(event.target as Node);

      // Apply initial alignment
      applyAlignment(dom, node.attrs.align || "center");

      // Handle percentage width backward compat
      const widthAttr = node.attrs.width;
      if (typeof widthAttr === "string" && widthAttr.endsWith("%")) {
        // Defer conversion until we can measure the container
        requestAnimationFrame(() => {
          const parentEl = dom.parentElement;
          if (parentEl) {
            const containerWidth = parentEl.clientWidth;
            const pctValue = parseInt(widthAttr, 10);
            if (!isNaN(pctValue) && containerWidth > 0) {
              const pxWidth = Math.round(
                containerWidth * (pctValue / 100),
              );
              el.style.width = `${pxWidth}px`;
              if (node.attrs.aspectRatio) {
                el.style.height = `${Math.round(pxWidth / node.attrs.aspectRatio)}px`;
              }
            }
          }
          dom.style.visibility = "";
          dom.style.pointerEvents = "";
        });
      }

      // Show skeleton background while image loads from server
      dom.style.pointerEvents = "none";
      el.classList.add("media-pulse");

      el.onload = () => {
        dom.style.pointerEvents = "";
        el.classList.remove("media-pulse");
      };

      return nodeView;
    };
  },
});

function applyAlignment(container: HTMLElement, align: string) {
  if (align === "left") {
    container.style.justifyContent = "flex-start";
  } else if (align === "right") {
    container.style.justifyContent = "flex-end";
  } else {
    container.style.justifyContent = "center";
  }
}

export const IMAGE_CAPTION_MAX_LENGTH = 300;

export function sanitizeImageCaption(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, IMAGE_CAPTION_MAX_LENGTH);
}

function getImageElement(element: HTMLElement): HTMLElement | null {
  return element.tagName === "IMG" ? element : element.querySelector("img");
}

function createCaptionElement(
  caption: string | undefined,
  editable: boolean,
): HTMLElement {
  const element = document.createElement("figcaption");
  element.className = "image-caption";
  element.textContent = sanitizeImageCaption(caption || "");
  element.contentEditable = String(editable);
  element.spellcheck = true;
  element.setAttribute("aria-label", "Image caption");
  return element;
}
