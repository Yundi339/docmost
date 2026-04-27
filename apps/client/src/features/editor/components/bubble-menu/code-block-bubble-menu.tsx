import { BubbleMenu, BubbleMenuProps } from "@tiptap/react/menus";
import { useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { FC, useEffect, useRef, useState } from "react";
import {
  IconCheck,
  IconCopy,
  IconMessage,
  IconSparkles,
} from "@tabler/icons-react";
import { v7 as uuid7 } from "uuid";
import classes from "./bubble-menu.module.css";
import { ActionIcon, Button, rem, Tooltip } from "@mantine/core";
import { useAtom, useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import { copyToClipboard } from "@docmost/editor-ext";
import {
  showAiMenuAtom,
  showLinkMenuAtom,
} from "@/features/editor/atoms/editor-atoms";
import {
  draftCommentIdAtom,
  showCommentPopupAtom,
} from "@/features/comment/atoms/comment-atom";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom";

type CodeBlockBubbleMenuProps = Omit<BubbleMenuProps, "children" | "editor"> & {
  editor: Editor | null;
};

function getSelectedCodeText(editor: Editor): string {
  const { state } = editor;
  const { from, to } = state.selection;
  // textBetween with a "\n" block separator preserves line breaks across
  // hard-break / paragraph splits; inside a single codeBlock the text is
  // already a string with \n, so this is essentially a slice.
  return state.doc.textBetween(from, to, "\n");
}

export const CodeBlockBubbleMenu: FC<CodeBlockBubbleMenuProps> = (props) => {
  const { t } = useTranslation();
  const [showAiMenu, setShowAiMenu] = useAtom(showAiMenuAtom);
  const showLinkMenu = useAtomValue(showLinkMenuAtom);
  const [showCommentPopup, setShowCommentPopup] = useAtom(showCommentPopupAtom);
  const [, setDraftCommentId] = useAtom(draftCommentIdAtom);
  const workspace = useAtomValue(workspaceAtom);
  const isGenerativeAiEnabled = workspace?.settings?.ai?.generative === true;

  const showAiMenuRef = useRef(showAiMenu);
  const showLinkMenuRef = useRef(showLinkMenu);
  const showCommentPopupRef = useRef(showCommentPopup);
  const [copied, setCopied] = useState(false);
  const copyResetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current) {
        window.clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    showAiMenuRef.current = showAiMenu;
  }, [showAiMenu]);
  useEffect(() => {
    showLinkMenuRef.current = showLinkMenu;
  }, [showLinkMenu]);
  useEffect(() => {
    showCommentPopupRef.current = showCommentPopup;
  }, [showCommentPopup]);

  const editorState = useEditorState({
    editor: props.editor,
    selector: (ctx) => {
      const editor = ctx.editor;
      if (!editor) return null;
      return {
        isInCodeBlock: editor.isActive("codeBlock"),
      };
    },
  });

  const bubbleMenuProps: CodeBlockBubbleMenuProps = {
    ...props,
    shouldShow: ({ editor, state }) => {
      if (!editor.isEditable) return false;
      if (!editor.isActive("codeBlock")) return false;
      const { selection } = state;
      if (selection.empty) return false;
      if (!(selection instanceof TextSelection)) return false;
      if (
        showAiMenuRef.current ||
        showLinkMenuRef.current ||
        showCommentPopupRef.current
      ) {
        return false;
      }
      return true;
    },
    options: {
      placement: "top",
      offset: 8,
    },
  };

  if (!props.editor) return null;
  if (showAiMenu || showLinkMenu) return null;

  const handleAskAi = () => {
    setShowAiMenu(true);
  };

  const handleCopy = () => {
    if (!props.editor) return;
    const text = getSelectedCodeText(props.editor);
    if (!text) return;
    copyToClipboard(text);
    setCopied(true);
    if (copyResetTimerRef.current) {
      window.clearTimeout(copyResetTimerRef.current);
    }
    copyResetTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      copyResetTimerRef.current = null;
    }, 1500);
    // Restore editor focus so the selection keeps its focused highlight.
    // Without this, clicking the button briefly transfers DOM focus away
    // from the contenteditable and the selection background flickers.
    props.editor.view.focus();
  };

  const handleComment = () => {
    if (!props.editor) return;
    const commentId = uuid7();
    props.editor.chain().focus().setCommentDecoration().run();
    setDraftCommentId(commentId);
    setShowCommentPopup(true);
  };

  // Prevent buttons from stealing focus / collapsing the editor selection
  // when clicked. Without this, mousedown on the menu blurs the editor and
  // some browsers collapse the visible selection before the click handler
  // runs.
  const preventBlur = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  return (
    <BubbleMenu
      {...bubbleMenuProps}
      editor={props.editor}
      pluginKey="code-block-bubble-menu"
      style={{ zIndex: 199, position: "relative" }}
    >
      <div className={classes.bubbleMenu} onMouseDown={preventBlur}>
        {isGenerativeAiEnabled && (
          <>
            <Button
              variant="default"
              className={clsx(classes.buttonRoot)}
              radius="0"
              leftSection={<IconSparkles size={16} />}
              onMouseDown={preventBlur}
              onClick={handleAskAi}
            >
              {t("Ask AI")}
            </Button>
            <div className={classes.divider} />
          </>
        )}

        <Tooltip
          label={copied ? t("Copied") : t("Copy")}
          withArrow
          withinPortal={false}
        >
          <ActionIcon
            variant="default"
            size="lg"
            radius="0"
            aria-label={t("Copy")}
            style={{ border: "none" }}
            onMouseDown={preventBlur}
            onClick={handleCopy}
          >
            {copied ? (
              <IconCheck style={{ width: rem(16) }} stroke={2} />
            ) : (
              <IconCopy style={{ width: rem(16) }} stroke={2} />
            )}
          </ActionIcon>
        </Tooltip>

        {editorState?.isInCodeBlock && (
          <Tooltip label={t("Comment")} withArrow withinPortal={false}>
            <ActionIcon
              variant="default"
              size="lg"
              radius="0"
              aria-label={t("Comment")}
              style={{ border: "none" }}
              onMouseDown={preventBlur}
              onClick={handleComment}
            >
              <IconMessage style={{ width: rem(16) }} stroke={2} />
            </ActionIcon>
          </Tooltip>
        )}
      </div>
    </BubbleMenu>
  );
};

export default CodeBlockBubbleMenu;
