import type {
  CollaborationConnectionStatus,
  CollaborationSyncPatch,
} from "./collaboration-sync-state";

type ReconnectableSocket = {
  connect: () => void;
  disconnect: () => void;
};

type SyncableProvider = {
  forceSync: () => unknown;
};

type ReconnectControllerOptions = {
  socket: ReconnectableSocket;
  provider: SyncableProvider;
  report: (patch: CollaborationSyncPatch) => void;
  delayMs?: number;
};

export function patchForConnectionStatus(
  connectionStatus: CollaborationConnectionStatus,
): CollaborationSyncPatch {
  return {
    connectionStatus,
    ...(connectionStatus === "connected"
      ? { errorCode: undefined }
      : { remoteReady: false }),
  };
}

export function createReconnectController({
  socket,
  provider,
  report,
  delayMs = 100,
}: ReconnectControllerOptions) {
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const retry = () => {
    if (disposed) return;
    report({
      connectionStatus: "connecting",
      remoteReady: false,
      errorCode: undefined,
    });
    socket.disconnect();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      if (disposed) return;
      socket.connect();
      provider.forceSync();
    }, delayMs);
  };

  const dispose = () => {
    disposed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  };

  return { retry, dispose };
}
