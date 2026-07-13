import { useEffect, useState } from "react";
import { useDocumentVisibility } from "@mantine/hooks";
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
  onStatelessParameters,
  onStatusParameters,
  onSyncedParameters,
  onUnsyncedChangesParameters,
  WebSocketStatus,
} from "@hocuspocus/provider";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { useCollabToken } from "@/features/auth/queries/auth-query";
import useCollaborationUrl from "@/features/editor/hooks/use-collaboration-url";
import { useIdle } from "@/hooks/use-idle";
import { FIVE_MINUTES } from "@/lib/constants";
import { isCollaborationTokenExpired } from "./collaboration-token";
import {
  createReconnectController,
  patchForConnectionStatus,
} from "./collaboration-provider-lifecycle";
import { useCollaborationSync } from "./use-collaboration-sync";

type CollaborationResources = {
  local: IndexeddbPersistence;
  remote: HocuspocusProvider;
  socket: HocuspocusProviderWebsocket;
};

type UseCollaborationProviderOptions = {
  pageId: string;
  onStateless?: (event: onStatelessParameters) => void;
};

export function useCollaborationProvider({
  pageId,
  onStateless,
}: UseCollaborationProviderOptions) {
  const collaborationURL = useCollaborationUrl();
  const {
    data: collabQuery,
    isError: collabTokenError,
    refetch: refetchCollabToken,
  } = useCollabToken();
  const { isIdle, resetIdle } = useIdle(FIVE_MINUTES, { initialState: false });
  const documentState = useDocumentVisibility();
  const { report, handleSaveShortcut } = useCollaborationSync(pageId);
  const [resources, setResources] = useState<CollaborationResources | null>(
    null,
  );
  const [isLocalSynced, setIsLocalSynced] = useState(false);
  const [isRemoteSynced, setIsRemoteSynced] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<WebSocketStatus>(
    WebSocketStatus.Connecting,
  );

  useEffect(() => {
    let active = true;
    setResources(null);
    setIsLocalSynced(false);
    setIsRemoteSynced(false);
    setConnectionStatus(WebSocketStatus.Connecting);
    report({
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
    const onLocalSynced = () => {
      if (!active) return;
      setIsLocalSynced(true);
      report({ localReady: true });
    };
    const onStatus = (event: onStatusParameters) => {
      if (!active) return;
      setConnectionStatus(event.status);
      report(patchForConnectionStatus(event.status));
    };
    const onSynced = (event: onSyncedParameters) => {
      if (!active) return;
      setIsRemoteSynced(event.state);
      report({ remoteReady: event.state });
    };
    const onUnsyncedChanges = (event: onUnsyncedChangesParameters) => {
      if (!active) return;
      report({ unsyncedChanges: event.number });
    };
    const onAuthenticationFailed = () => {
      if (!active) return;
      report({ errorCode: "authentication", remoteReady: false });
      if (!isCollaborationTokenExpired(collabQuery.token)) return;

      void refetchCollabToken().then((result) => {
        if (!active || !result.data?.token) return;
        remote.configuration.token = result.data.token;
        reconnectController.retry();
      });
    };

    const remote = new HocuspocusProvider({
      websocketProvider: socket,
      name: documentName,
      document: ydoc,
      token: collabQuery.token,
      onAuthenticationFailed,
      onStatus,
      onSynced,
      onUnsyncedChanges,
      onStateless,
    });
    const reconnectController = createReconnectController({
      socket,
      provider: remote,
      report,
    });

    report({ retry: reconnectController.retry });
    local.on("synced", onLocalSynced);
    remote.attach();
    setResources({ local, remote, socket });

    return () => {
      active = false;
      reconnectController.dispose();
      local.off("synced", onLocalSynced);
      remote.destroy();
      socket.destroy();
      local.destroy();
    };
  }, [
    collaborationURL,
    collabQuery?.token,
    collabTokenError,
    onStateless,
    pageId,
    refetchCollabToken,
    report,
  ]);

  useEffect(() => {
    if (!resources) return;

    if (
      isIdle &&
      documentState === "hidden" &&
      connectionStatus === WebSocketStatus.Connected
    ) {
      resources.socket.disconnect();
      return;
    }
    if (
      documentState === "visible" &&
      connectionStatus === WebSocketStatus.Disconnected
    ) {
      resetIdle();
      resources.socket.connect();
    }
  }, [connectionStatus, documentState, isIdle, resetIdle, resources]);

  return {
    remoteProvider: resources?.remote ?? null,
    providersReady: Boolean(resources),
    isSynced: isLocalSynced && isRemoteSynced,
    connectionStatus,
    handleSaveShortcut,
  };
}
