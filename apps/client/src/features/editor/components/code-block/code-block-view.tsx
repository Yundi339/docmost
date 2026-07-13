import { NodeViewContent, NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import {
  ActionIcon,
  Group,
  Select,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { CopyButton } from "@/components/common/copy-button";
import { useEffect, useRef, useState } from "react";
import {
  IconCheck,
  IconCopy,
  IconCode,
  IconCodeOff,
  IconDownload,
  IconTextWrap,
  IconTextWrapDisabled,
} from "@tabler/icons-react";
import classes from "./code-block.module.css";
import React from "react";
import { Suspense } from "react";
import { useTranslation } from "react-i18next";
import { ErrorBoundary } from "react-error-boundary";
import {
  MAX_CODE_BLOCK_TITLE_LENGTH,
  normalizeCodeBlockTitle,
} from "@docmost/editor-ext";
import { downloadCodeBlock } from "./code-block-download";
import { useEditorEditable } from "@/features/editor/hooks/use-editor-editable";

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
  const { language, title, wrap } = node.attrs;
  const [languageValue, setLanguageValue] = useState<string | null>(
    language || null,
  );
  const [titleValue, setTitleValue] = useState(title || "");
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
  const skipTitleCommitRef = useRef(false);
  const isEditable = useEditorEditable(editor);

  const isMermaid = language === "mermaid";

  useEffect(() => {
    setLanguageValue(language || null);
  }, [language]);

  useEffect(() => {
    setTitleValue(title || "");
  }, [title]);

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

  useEffect(() => {
    if (!isEditable && showSource) setShowSource(false);
  }, [isEditable, showSource]);

  function changeLanguage(language: string) {
    setLanguageValue(language);
    updateAttributes({
      language: language,
    });
  }

  function commitTitle(value: string) {
    const normalizedTitle = normalizeCodeBlockTitle(value);
    setTitleValue(normalizedTitle || "");
    if (normalizedTitle !== (title || null)) {
      updateAttributes({ title: normalizedTitle });
    }
  }

  function download() {
    downloadCodeBlock(
      node.textContent,
      isEditable ? titleValue : title,
      language,
    );
  }

  // Decide whether the <pre> with the raw source should be hidden.
  // For non-mermaid code blocks: never hide. For mermaid: hide unless the
  // user explicitly opens the source via the toggle button. When the diagram
  // is empty (e.g. just created) we always show the source so the user can
  // start typing.
  const hideMermaidSource =
    isMermaid && node.textContent.length > 0 && (!isEditable || !showSource);

  return (
    <NodeViewWrapper
      className={`codeBlock ${classes.wrapper} ${wrap ? classes.wrapped : ""}`}
      ref={wrapperRef}
    >
      {isEditable && (
        <Group
          justify="space-between"
          gap="xs"
          wrap="nowrap"
          contentEditable={false}
          className={classes.menuGroup}
        >
          <TextInput
            value={titleValue}
            onChange={(event) => setTitleValue(event.currentTarget.value)}
            onBlur={(event) => {
              if (skipTitleCommitRef.current) {
                skipTitleCommitRef.current = false;
                return;
              }
              commitTitle(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                skipTitleCommitRef.current = true;
                setTitleValue(title || "");
                event.currentTarget.blur();
              }
              event.stopPropagation();
            }}
            maxLength={MAX_CODE_BLOCK_TITLE_LENGTH}
            placeholder={t("Code block title")}
            aria-label={t("Code block title")}
            className={classes.titleInput}
            classNames={{ input: classes.titleInputControl }}
          />

          <Group gap={4} wrap="nowrap" className={classes.controls}>
            <Select
              placeholder="auto"
              checkIconPosition="right"
              data={extension.options.lowlight.listLanguages().sort()}
              value={languageValue}
              onChange={changeLanguage}
              searchable
              className={classes.languageSelect}
              classNames={{ input: classes.selectInput }}
            />

            <Tooltip
              label={wrap ? t("Do not wrap lines") : t("Wrap lines")}
              withArrow
              position="left"
            >
              <ActionIcon
                color={wrap ? "blue" : "gray"}
                variant={wrap ? "light" : "subtle"}
                onClick={() => updateAttributes({ wrap: !wrap })}
                aria-label={wrap ? t("Do not wrap lines") : t("Wrap lines")}
                aria-pressed={Boolean(wrap)}
              >
                {wrap ? (
                  <IconTextWrap size={16} />
                ) : (
                  <IconTextWrapDisabled size={16} />
                )}
              </ActionIcon>
            </Tooltip>

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
                  aria-label={showSource ? t("Hide source") : t("Show source")}
                >
                  {showSource ? (
                    <IconCodeOff size={16} />
                  ) : (
                    <IconCode size={16} />
                  )}
                </ActionIcon>
              </Tooltip>
            )}

            <CopyButton value={node?.textContent} timeout={2000}>
              {({ copied, copy }) => (
                <Tooltip
                  label={copied ? t("Copied") : t("Copy")}
                  withArrow
                  position="top"
                >
                  <ActionIcon
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

            <Tooltip label={t("Download code")} withArrow position="right">
              <ActionIcon
                color="gray"
                variant="subtle"
                onClick={download}
                aria-label={t("Download code")}
              >
                <IconDownload size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      )}

      {!isEditable && (
        <div
          contentEditable={false}
          className={`${classes.readOnlyHeader} ${!title ? classes.readOnlyHeaderOverlay : ""}`}
        >
          {title && (
            <Text size="xs" fw={500} truncate className={classes.readOnlyTitle}>
              {title}
            </Text>
          )}
          <Group gap={4} wrap="nowrap" className={classes.readOnlyControls}>
            <CopyButton value={node?.textContent} timeout={2000}>
              {({ copied, copy }) => (
                <Tooltip
                  label={copied ? t("Copied") : t("Copy")}
                  withArrow
                  position="left"
                >
                  <ActionIcon
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
            <Tooltip label={t("Download code")} withArrow position="left">
              <ActionIcon
                color="gray"
                variant="subtle"
                onClick={download}
                aria-label={t("Download code")}
              >
                <IconDownload size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </div>
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
                isEditable && node.textContent.length > 0
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
