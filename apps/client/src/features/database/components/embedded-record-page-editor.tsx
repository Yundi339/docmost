import "@/features/editor/styles/index.css";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
  onStatusParameters,
  onSyncedParameters,
  onUnsyncedChangesParameters,
  WebSocketStatus,
} from "@hocuspocus/provider";
import {
  Editor,
  EditorContent,
  EditorProvider,
  useEditor,
  useEditorState,
} from "@tiptap/react";
import { useAtomValue } from "jotai";
import { useDebouncedCallback, useDocumentVisibility } from "@mantine/hooks";
import { collabExtensions, mainExtensions } from "@/features/editor/extensions/extensions";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom";
import { currentPageEditModeAtom } from "@/features/editor/atoms/editor-atoms";
import useCollaborationUrl from "@/features/editor/hooks/use-collaboration-url";
import {
  handleFileDrop,
  handlePaste,
} from "@/features/editor/components/common/editor-paste-handler";
import { useCollabToken } from "@/features/auth/queries/auth-query";
import { queryClient } from "@/main";
import { IPage } from "@/features/page/types/page.types";
import { updatePage } from "@/features/page/services/page-service";
import { FIVE_MINUTES } from "@/lib/constants";
import { useIdle } from "@/hooks/use-idle";
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
import { useCollaborationSync } from "@/features/editor/collaboration/use-collaboration-sync";
import {
  createReconnectController,
  patchForConnectionStatus,
} from "@/features/editor/collaboration/collaboration-provider-lifecycle";
import { isCollaborationTokenExpired } from "@/features/editor/collaboration/collaboration-token";

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
  const collaborationURL = useCollaborationUrl();
  const isComponentMounted = useRef(false);
  const editorRef = useRef<Editor | null>(null);
  const currentUser = useAtomValue(currentUserAtom);
  const currentPageEditMode = useAtomValue(currentPageEditModeAtom);
  const { report: reportSync, handleSaveShortcut } =
    useCollaborationSync(pageId);
  const [menuContainer, setMenuContainer] = useState<HTMLDivElement | null>(null);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);
  const setMenuContainerRef = useCallback((node: HTMLDivElement | null) => {
    menuContainerRef.current = node;
    setMenuContainer(node);
  }, []);
  useTableFullscreenControls(menuContainer);

  const {
    data: collabQuery,
    isError: collabTokenError,
    refetch: refetchCollabToken,
  } = useCollabToken();
  const { isIdle, resetIdle } = useIdle(FIVE_MINUTES, { initialState: false });
  const documentState = useDocumentVisibility();
  const userSpellcheckPref =
    currentUser?.user?.settings?.preferences?.spellcheck ?? true;

  const providersRef = useRef<{
    local: IndexeddbPersistence;
    remote: HocuspocusProvider;
    socket: HocuspocusProviderWebsocket;
  } | null>(null);
  const [providersReady, setProvidersReady] = useState(false);
  const [isLocalSynced, setIsLocalSynced] = useState(false);
  const [isRemoteSynced, setIsRemoteSynced] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<WebSocketStatus>(
    WebSocketStatus.Connecting,
  );

  useEffect(() => {
    isComponentMounted.current = true;
    return () => {
      isComponentMounted.current = false;
    };
  }, []);

  useEffect(() => {
    setProvidersReady(false);
    setIsLocalSynced(false);
    setIsRemoteSynced(false);
    setConnectionStatus(WebSocketStatus.Connecting);
    reportSync({
      connectionStatus: WebSocketStatus.Connecting,
      localReady: false,
      remoteReady: false,
      errorCode: collabTokenError ? "connection" : undefined,
    });

    if (!collabQuery?.token) return;

    const documentName = `page.${pageId}`;
    const ydoc = new Y.Doc();
    const local = new IndexeddbPersistence(documentName, ydoc);
    const socket = new HocuspocusProviderWebsocket({
      url: collaborationURL,
    });

    const onLocalSyncedHandler = () => {
      if (!isComponentMounted.current) return;
      setIsLocalSynced(true);
      reportSync({ localReady: true });
    };
    const onStatusHandler = (event: onStatusParameters) => {
      if (!isComponentMounted.current) return;
      setConnectionStatus(event.status);
      reportSync(patchForConnectionStatus(event.status));
    };
    const onSyncedHandler = (event: onSyncedParameters) => {
      if (!isComponentMounted.current) return;
      setIsRemoteSynced(event.state);
      reportSync({ remoteReady: event.state });
    };
    const onUnsyncedChangesHandler = (event: onUnsyncedChangesParameters) => {
      if (!isComponentMounted.current) return;
      reportSync({ unsyncedChanges: event.number });
    };
    const onAuthenticationFailedHandler = () => {
      if (!isComponentMounted.current) return;
      reportSync({ errorCode: "authentication", remoteReady: false });
      if (!isCollaborationTokenExpired(collabQuery.token)) return;

      void refetchCollabToken().then((result) => {
        if (!isComponentMounted.current || !result.data?.token) return;
        remote.configuration.token = result.data.token;
        reconnectController.retry();
      });
    };

    const remote = new HocuspocusProvider({
      websocketProvider: socket,
      name: documentName,
      document: ydoc,
      token: collabQuery?.token,
      onAuthenticationFailed: onAuthenticationFailedHandler,
      onStatus: onStatusHandler,
      onSynced: onSyncedHandler,
      onUnsyncedChanges: onUnsyncedChangesHandler,
    });
    const reconnectController = createReconnectController({
      socket,
      provider: remote,
      report: reportSync,
    });

    reportSync({
      retry: reconnectController.retry,
    });

    local.on("synced", onLocalSyncedHandler);
    providersRef.current = { socket, local, remote };
    remote.attach();
    setProvidersReady(true);

    return () => {
      onEditorReady?.(null);
      reconnectController.dispose();
      local.off("synced", onLocalSyncedHandler);
      socket.destroy();
      remote.destroy();
      local.destroy();
      providersRef.current = null;
      editorRef.current = null;
    };
  }, [
    collaborationURL,
    collabQuery?.token,
    collabTokenError,
    onEditorReady,
    pageId,
    refetchCollabToken,
    reportSync,
  ]);

  useEffect(() => {
    if (!providersReady || !providersRef.current) return;
    const socket = providersRef.current.socket;

    if (
      isIdle &&
      documentState === "hidden" &&
      connectionStatus === WebSocketStatus.Connected
    ) {
      socket.disconnect();
      return;
    }

    if (
      documentState === "visible" &&
      connectionStatus === WebSocketStatus.Disconnected
    ) {
      resetIdle();
      socket.connect();
    }
  }, [connectionStatus, documentState, isIdle, providersReady, resetIdle]);

  const extensions = useMemo(() => {
    if (!providersReady || !providersRef.current || !currentUser?.user) {
      return mainExtensions;
    }

    return [
      ...mainExtensions,
      ...collabExtensions(providersRef.current.remote, currentUser.user),
    ];
  }, [providersReady, currentUser?.user]);

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
              ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"].includes(
                event.key,
              )
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

  const isSynced = isLocalSynced && isRemoteSynced;
  const [showStatic, setShowStatic] = useState(true);

  useEffect(() => {
    setShowStatic(true);
  }, [pageId]);

  useEffect(() => {
    if (connectionStatus === WebSocketStatus.Connected && isSynced) {
      setShowStatic(false);
    }
  }, [connectionStatus, isSynced]);

  useEffect(() => {
    if (!showStatic || !providersReady || !currentUser?.user) return;

    const timeout = setTimeout(() => {
      setShowStatic(false);
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
        <EditorContent editor={editor} translate="yes" spellCheck={userSpellcheckPref} />

        {editor && <SearchAndReplaceDialog editor={editor} editable={editable} />}

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

        {editor && !editorIsEditable && (editable || canComment) && providersRef.current && (
          <ReadonlyBubbleMenu editor={editor} />
        )}
      </div>
      <div
        onClick={() => editor?.commands.focus("end")}
        style={{ paddingBottom: "16vh" }}
      />
    </div>
  );
}
