import { NodeViewProps } from "@tiptap/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import { v4 as uuidv4 } from "uuid";
import classes from "./code-block.module.css";
import { useTranslation } from "react-i18next";
import { useComputedColorScheme } from "@mantine/core";
import DOMPurify from "dompurify";
import ZoomableSvg from "./zoomable-svg";

interface MermaidViewProps {
  props: NodeViewProps;
}

export default function MermaidView({ props }: MermaidViewProps) {
  const { t } = useTranslation();
  const computedColorScheme = useComputedColorScheme();
  const { node } = props;
  const [preview, setPreview] = useState<string>("");
  const [hasError, setHasError] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Update Mermaid config when theme changes.
  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      suppressErrorRendering: true,
      theme: computedColorScheme === "light" ? "default" : "dark",
    });
  }, [computedColorScheme]);

  // Defer rendering until the block enters (or is near) the viewport.
  // Visible blocks render first; off-screen blocks wait until scrolled near.
  useLayoutEffect(() => {
    if (isVisible) return;
    const el = containerRef.current;
    if (!el) return;
    // Synchronously check if already in (or near) viewport on mount to avoid
    // IntersectionObserver's async first callback delaying visible blocks.
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    if (rect.bottom >= -400 && rect.top <= vh + 400) {
      setIsVisible(true);
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin: "400px 0px", threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [isVisible]);

  // Re-render the diagram whenever the node content or theme changes.
  // First render is immediate; subsequent edits are debounced to avoid
  // expensive re-renders on every keystroke.
  const hasRenderedOnceRef = useRef(false);
  useEffect(() => {
    if (!isVisible) return;
    if (node.textContent.length === 0) return;
    const delay = hasRenderedOnceRef.current ? 300 : 0;
    const timer = setTimeout(() => {
      const id = `mermaid-${uuidv4()}`;
      mermaid
        .render(id, node.textContent)
        .then((item) => {
          hasRenderedOnceRef.current = true;
          setPreview(item.svg);
          setHasError(false);
        })
        .catch((err) => {
          hasRenderedOnceRef.current = true;
          setHasError(true);
          if (props.editor.isEditable) {
            setPreview(
              `<div class="${classes.error}">${t("Mermaid diagram error:")} ${DOMPurify.sanitize(err)}</div>`,
            );
          } else {
            setPreview(
              `<div class="${classes.error}">${t("Invalid Mermaid diagram")}</div>`,
            );
          }
        });
    }, delay);
    return () => clearTimeout(timer);
  }, [node.textContent, computedColorScheme, isVisible]);

  const svgContent = (
    <div
      ref={containerRef}
      className={classes.mermaid}
      contentEditable={false}
      dangerouslySetInnerHTML={{ __html: preview }}
    />
  );

  if (hasError || !preview) {
    return svgContent;
  }

  return (
    <ZoomableSvg>
      {svgContent}
    </ZoomableSvg>
  );
}
