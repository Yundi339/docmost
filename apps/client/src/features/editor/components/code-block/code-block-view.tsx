import { NodeViewContent, NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { ActionIcon, Group, Select, Text, Tooltip } from "@mantine/core";
import { CopyButton } from "@/components/common/copy-button";
import { useEffect, useRef, useState } from "react";
import { IconCheck, IconCopy, IconCode, IconCodeOff } from "@tabler/icons-react";
import classes from "./code-block.module.css";
import React from "react";
import { Suspense } from "react";
import { useTranslation } from "react-i18next";
import { ErrorBoundary } from "react-error-boundary";

function MermaidErrorFallback() {
  const { t } = useTranslation();
  return (
    <div className={classes.error}>
      <Text size="sm">{t("Failed to render Mermaid diagram")}</Text>
    </div>
  );
}

const MermaidView = React.lazy(
  () => import("@/features/editor/components/code-block/mermaid-view.tsx"),
);

export default function CodeBlockView(props: NodeViewProps) {
  const { t } = useTranslation();
  const { node, updateAttributes, extension, editor, getPos } = props;
  const { language } = node.attrs;
  const [languageValue, setLanguageValue] = useState<string | null>(
    language || null,
  );
  // Explicit show/hide of the mermaid source code. Previously this was driven
  // by the editor selection which caused two issues:
  // 1. Clicking the mermaid diagram itself moved the cursor into the code
  //    block and accidentally revealed the source.
  // 2. Clicking outside the diagram (e.g. on whitespace inside the editor)
  //    did not always clear the selection, so the source stayed visible.
  // A dedicated toggle button gives the user predictable control, and we
  // collapse the source automatically when the user clicks outside.
  const [showSource, setShowSource] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const isMermaid = language === "mermaid";

  // Auto-collapse the mermaid source when clicking outside this code block.
  useEffect(() => {
    if (!isMermaid || !showSource) return;
    const handlePointerDown = (event: MouseEvent) => {
      const wrapper = wrapperRef.current;
      if (wrapper && !wrapper.contains(event.target as Node)) {
        setShowSource(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isMermaid, showSource]);

  // Reset the toggle when switching language away from mermaid.
  useEffect(() => {
    if (!isMermaid && showSource) setShowSource(false);
  }, [isMermaid, showSource]);

  function changeLanguage(language: string) {
    setLanguageValue(language);
    updateAttributes({
      language: language,
    });
  }

  // Decide whether the <pre> with the raw source should be hidden.
  // For non-mermaid code blocks: never hide. For mermaid: hide unless the
  // user explicitly opens the source via the toggle button. When the diagram
  // is empty (e.g. just created) we always show the source so the user can
  // start typing.
  const hideMermaidSource =
    isMermaid && node.textContent.length > 0 && !showSource;

  return (
    <NodeViewWrapper
      className={`codeBlock ${classes.wrapper}`}
      ref={wrapperRef}
    >
      {editor.isEditable && (
        <Group
          justify="flex-end"
          contentEditable={false}
          className={classes.menuGroup}
        >
          <Select
            placeholder="auto"
            checkIconPosition="right"
            data={extension.options.lowlight.listLanguages().sort()}
            value={languageValue}
            onChange={changeLanguage}
            searchable
            style={{ maxWidth: "130px" }}
            classNames={{ input: classes.selectInput }}
          />

          {isMermaid && node.textContent.length > 0 && (
            <Tooltip
              label={showSource ? t("Hide source") : t("Show source")}
              withArrow
              position="left"
            >
              <ActionIcon
                color="gray"
                variant="subtle"
                onClick={() => setShowSource((value) => !value)}
                aria-label={
                  showSource ? t("Hide source") : t("Show source")
                }
              >
                {showSource ? <IconCodeOff size={16} /> : <IconCode size={16} />}
              </ActionIcon>
            </Tooltip>
          )}

          <CopyButton value={node?.textContent} timeout={2000}>
            {({ copied, copy }) => (
              <Tooltip
                label={copied ? t("Copied") : t("Copy")}
                withArrow
                position="right"
              >
                <ActionIcon
                  color={copied ? "teal" : "gray"}
                  variant="subtle"
                  onClick={copy}
                >
                  {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                </ActionIcon>
              </Tooltip>
            )}
          </CopyButton>
        </Group>
      )}

      {!editor.isEditable && (
        <CopyButton value={node?.textContent} timeout={2000}>
          {({ copied, copy }) => (
            <Tooltip
              label={copied ? t("Copied") : t("Copy")}
              withArrow
              position="left"
            >
              <ActionIcon
                className={classes.readOnlyCopyButton}
                color={copied ? "teal" : "gray"}
                variant="subtle"
                onClick={copy}
                aria-label={copied ? t("Copied") : t("Copy")}
              >
                {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
              </ActionIcon>
            </Tooltip>
          )}
        </CopyButton>
      )}

      <pre spellCheck="false" hidden={hideMermaidSource}>
        {/* @ts-ignore */}
        <NodeViewContent as="code" className={`language-${language}`} />
      </pre>

      {isMermaid && (
        <ErrorBoundary FallbackComponent={MermaidErrorFallback}>
          <Suspense fallback={null}>
            <div
              onDoubleClick={
                editor.isEditable && node.textContent.length > 0
                  ? () => setShowSource((value) => !value)
                  : undefined
              }
            >
              <MermaidView props={props} />
            </div>
          </Suspense>
        </ErrorBoundary>
      )}
    </NodeViewWrapper>
  );
}
