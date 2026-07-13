import "@/features/editor/styles/index.css";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { WebSocketStatus } from "@hocuspocus/provider";
import {
  Editor,
  EditorContent,
  EditorProvider,
  useEditor,
  useEditorState,
} from "@tiptap/react";
import { useAtomValue } from "jotai";
import { useDebouncedCallback } from "@mantine/hooks";
import {
  collabExtensions,
  mainExtensions,
} from "@/features/editor/extensions/extensions";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom";
import { currentPageEditModeAtom } from "@/features/editor/atoms/editor-atoms";
import {
  handleFileDrop,
  handlePaste,
} from "@/features/editor/components/common/editor-paste-handler";
import { queryClient } from "@/main";
import { IPage } from "@/features/page/types/page.types";
import { updatePage } from "@/features/page/services/page-service";
import { platformModifierKey } from "@/lib";
import { searchSpotlight } from "@/features/search/constants";
import { PageEditMode } from "@/features/user/types/user.types";
import SearchAndReplaceDialog from "@/features/editor/components/search-and-replace/search-and-replace-dialog";
import { EditorLinkMenu } from "@/features/editor/components/link/link-menu";
import { EditorBubbleMenu } from "@/features/editor/components/bubble-menu/bubble-menu";
import { CodeBlockBubbleMenu } from "@/features/editor/components/bubble-menu/code-block-bubble-menu";
import { ReadonlyBubbleMenu } from "@/features/editor/components/bubble-menu/readonly-bubble-menu";
import TableMenu from "@/features/editor/components/table/table-menu";
import TableCellMenu from "@/features/editor/components/table/table-cell-menu";
import ImageMenu from "@/features/editor/components/image/image-menu";
import VideoMenu from "@/features/editor/components/video/video-menu";
import PdfMenu from "@/features/editor/components/pdf/pdf-menu";
import CalloutMenu from "@/features/editor/components/callout/callout-menu";
import SubpagesMenu from "@/features/editor/components/subpages/subpages-menu";
import ExcalidrawMenu from "@/features/editor/components/excalidraw/excalidraw-menu";
import DrawioMenu from "@/features/editor/components/drawio/drawio-menu";
import ColumnsMenu from "@/features/editor/components/columns/columns-menu";
import { useTableFullscreenControls } from "@/features/editor/components/table/use-table-fullscreen-controls";
import { useCollaborationProvider } from "@/features/editor/collaboration/use-collaboration-provider";

interface EmbeddedRecordPageEditorProps {
  pageId: string;
  slugId: string;
  editable: boolean;
  content: unknown;
  canComment?: boolean;
  onEditorReady?: (editor: Editor | null) => void;
}

export function EmbeddedRecordPageEditor({
  pageId,
  slugId,
  editable,
  content,
  canComment,
  onEditorReady,
}: EmbeddedRecordPageEditorProps) {
  const editorRef = useRef<Editor | null>(null);
  const currentUser = useAtomValue(currentUserAtom);
  const currentPageEditMode = useAtomValue(currentPageEditModeAtom);
  const {
    remoteProvider,
    providersReady,
    isSynced,
    connectionStatus,
    handleSaveShortcut,
  } = useCollaborationProvider({ pageId });
  const [menuContainer, setMenuContainer] = useState<HTMLDivElement | null>(
    null,
  );
  const menuContainerRef = useRef<HTMLDivElement | null>(null);
  const setMenuContainerRef = useCallback((node: HTMLDivElement | null) => {
    menuContainerRef.current = node;
    setMenuContainer(node);
  }, []);
  useTableFullscreenControls(menuContainer);

  const userSpellcheckPref =
    currentUser?.user?.settings?.preferences?.spellcheck ?? true;

  useEffect(
    () => () => {
      onEditorReady?.(null);
      editorRef.current = null;
    },
    [onEditorReady],
  );

  const extensions = useMemo(() => {
    if (!providersReady || !remoteProvider || !currentUser?.user) {
      return mainExtensions;
    }

    return [
      ...mainExtensions,
      ...collabExtensions(remoteProvider, currentUser.user),
    ];
  }, [currentUser?.user, providersReady, remoteProvider]);

  const debouncedUpdateContent = useDebouncedCallback((newContent: unknown) => {
    const pageById = queryClient.getQueryData<IPage>(["pages", pageId]);
    if (pageById) {
      queryClient.setQueryData(["pages", pageId], {
        ...pageById,
        content: newContent,
        updatedAt: new Date(),
      });
    }

    const pageBySlug = queryClient.getQueryData<IPage>(["pages", slugId]);
    if (pageBySlug) {
      queryClient.setQueryData(["pages", slugId], {
        ...pageBySlug,
        content: newContent,
        updatedAt: new Date(),
      });
    }

    void updatePage({
      pageId,
      content: newContent,
      operation: "replace",
      format: "json",
    } as Parameters<typeof updatePage>[0] & {
      content: unknown;
      operation: "replace";
      format: "json";
    }).catch(() => undefined);
  }, 3000);

  const editor = useEditor(
    {
      extensions,
      editable,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      editorProps: {
        scrollThreshold: 80,
        scrollMargin: 80,
        handleDOMEvents: {
          keydown: (_view, event) => {
            if (platformModifierKey(event) && event.code === "KeyS") {
              event.preventDefault();
              handleSaveShortcut();
              return true;
            }
            if (event.key === "Tab") {
              const editor = editorRef.current;
              if (!editor) return false;
              event.preventDefault();
              return editor.view.someProp("handleKeyDown", (f) =>
                f(editor.view, event),
              );
            }
            if (platformModifierKey(event) && event.code === "KeyK") {
              searchSpotlight.open();
              return true;
            }
            if (["ArrowUp", "ArrowDown", "Enter"].includes(event.key)) {
              const slashCommand = document.querySelector("#slash-command");
              if (slashCommand) return true;
            }
            if (
              [
                "ArrowUp",
                "ArrowDown",
                "ArrowLeft",
                "ArrowRight",
                "Enter",
              ].includes(event.key)
            ) {
              const emojiCommand = document.querySelector("#emoji-command");
              if (emojiCommand) return true;
            }
            return false;
          },
        },
        handlePaste: (_view, event) => {
          if (!editorRef.current) return false;
          return handlePaste(
            editorRef.current,
            event,
            pageId,
            currentUser?.user.id,
          );
        },
        handleDrop: (_view, event, _slice, moved) => {
          if (!editorRef.current) return false;
          return handleFileDrop(
            editorRef.current,
            event,
            moved,
            pageId,
            currentUser?.user.id,
          );
        },
      },
      onCreate({ editor }) {
        if (!editor) return;
        // @ts-ignore keep parity with the main editor storage contract.
        editor.storage.pageId = pageId;
        editorRef.current = editor;
        onEditorReady?.(editor);
      },
      onUpdate({ editor }) {
        if (editor.isEmpty) return;
        debouncedUpdateContent(editor.getJSON());
      },
    },
    [pageId, editable, extensions, onEditorReady, handleSaveShortcut],
  );

  const editorIsEditable = useEditorState({
    editor,
    selector: (ctx) => ctx.editor?.isEditable ?? false,
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable && currentPageEditMode === PageEditMode.Edit);
  }, [currentPageEditMode, editor, editable]);

  const [connectedPageId, setConnectedPageId] = useState<string | null>(null);
  const showStatic = connectedPageId !== pageId;

  useEffect(() => {
    if (connectionStatus === WebSocketStatus.Connected && isSynced) {
      setConnectedPageId(pageId);
    }
  }, [connectionStatus, isSynced, pageId]);

  useEffect(() => {
    if (!showStatic || !providersReady || !currentUser?.user) return;

    const timeout = setTimeout(() => {
      setConnectedPageId(pageId);
    }, 1500);

    return () => clearTimeout(timeout);
  }, [currentUser?.user, pageId, providersReady, showStatic]);

  if (showStatic) {
    return (
      <EditorProvider
        editable={false}
        immediatelyRender={true}
        extensions={mainExtensions}
        content={content}
      />
    );
  }

  return (
    <div className="editor-container" style={{ position: "relative" }}>
      <div ref={setMenuContainerRef}>
        <EditorContent
          editor={editor}
          translate="yes"
          spellCheck={userSpellcheckPref}
        />

        {editor && (
          <SearchAndReplaceDialog editor={editor} editable={editable} />
        )}

        {editor && editorIsEditable && (
          <div>
            <EditorLinkMenu editor={editor} />
            <EditorBubbleMenu editor={editor} />
            <CodeBlockBubbleMenu editor={editor} />
            <TableMenu editor={editor} />
            <TableCellMenu editor={editor} appendTo={menuContainerRef} />
            <ImageMenu editor={editor} />
            <VideoMenu editor={editor} />
            <PdfMenu editor={editor} />
            <CalloutMenu editor={editor} />
            <SubpagesMenu editor={editor} />
            <ExcalidrawMenu editor={editor} />
            <DrawioMenu editor={editor} />
            <ColumnsMenu editor={editor} />
          </div>
        )}

        {editor &&
          !editorIsEditable &&
          (editable || canComment) &&
          remoteProvider && <ReadonlyBubbleMenu editor={editor} />}
      </div>
      <div
        onClick={() => editor?.commands.focus("end")}
        style={{ paddingBottom: "16vh" }}
      />
    </div>
  );
}
