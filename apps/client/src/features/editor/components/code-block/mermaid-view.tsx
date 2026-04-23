import { NodeViewProps } from "@tiptap/react";
import { useEffect, useState } from "react";
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

  // Update Mermaid config when theme changes.
  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      suppressErrorRendering: true,
      theme: computedColorScheme === "light" ? "default" : "dark",
    });
  }, [computedColorScheme]);

  // Re-render the diagram whenever the node content or theme changes.
  // Debounced to avoid expensive re-renders on every keystroke while editing.
  useEffect(() => {
    if (node.textContent.length === 0) return;
    const timer = setTimeout(() => {
      const id = `mermaid-${uuidv4()}`;
      mermaid
        .render(id, node.textContent)
        .then((item) => {
          setPreview(item.svg);
          setHasError(false);
        })
        .catch((err) => {
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
    }, 300);
    return () => clearTimeout(timer);
  }, [node.textContent, computedColorScheme]);

  const svgContent = (
    <div
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
