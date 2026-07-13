import { atom } from "jotai";

export type CollaborationConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected";

export type CollaborationSyncPhase =
  | "connecting"
  | "synced"
  | "pending"
  | "offline"
  | "error";

export type CollaborationSyncError =
  | "authentication"
  | "timeout"
  | "connection";

export type CollaborationSyncState = {
  pageId: string;
  phase: CollaborationSyncPhase;
  connectionStatus: CollaborationConnectionStatus;
  localReady: boolean;
  remoteReady: boolean;
  unsyncedChanges: number;
  errorCode?: CollaborationSyncError;
  lastSyncedAt?: number;
  retry?: () => void;
};

export type CollaborationSyncPatch = Partial<
  Omit<CollaborationSyncState, "pageId" | "phase" | "lastSyncedAt">
>;

export function createCollaborationSyncState(
  pageId: string,
): CollaborationSyncState {
  return {
    pageId,
    phase: "connecting",
    connectionStatus: "connecting",
    localReady: false,
    remoteReady: false,
    unsyncedChanges: 0,
  };
}

export function deriveCollaborationSyncPhase(
  state: Pick<
    CollaborationSyncState,
    | "connectionStatus"
    | "localReady"
    | "remoteReady"
    | "unsyncedChanges"
    | "errorCode"
  >,
): CollaborationSyncPhase {
  if (state.errorCode) return "error";
  if (state.unsyncedChanges > 0) return "pending";
  if (
    state.connectionStatus === "connected" &&
    state.localReady &&
    state.remoteReady
  ) {
    return "synced";
  }
  if (state.connectionStatus === "disconnected") return "offline";
  return "connecting";
}

export function updateCollaborationSyncState(
  state: CollaborationSyncState,
  patch: CollaborationSyncPatch,
  now = Date.now(),
): CollaborationSyncState {
  const next = { ...state, ...patch };
  next.phase = deriveCollaborationSyncPhase(next);
  if (next.phase === "synced" && state.phase !== "synced") {
    next.lastSyncedAt = now;
  }
  return next;
}

export function detachCollaborationSyncState(
  state: CollaborationSyncState,
): CollaborationSyncState | undefined {
  if (state.unsyncedChanges === 0) return undefined;
  return updateCollaborationSyncState(state, {
    connectionStatus: "disconnected",
    retry: undefined,
  });
}

export function getCollaborationSyncMessageKey(
  state: CollaborationSyncState,
): string {
  if (state.phase === "synced") return "All changes are synced";
  if (
    state.phase === "pending" &&
    state.connectionStatus === "disconnected"
  ) {
    return "Changes are saved on this device and waiting to sync";
  }
  if (state.phase === "pending") return "Changes are waiting to sync";
  if (state.phase === "offline") return "You are offline";
  if (state.phase === "error") return "Sync failed. Try reconnecting";
  return "Connecting to the collaboration server";
}

export const collaborationSyncStatesAtom = atom<
  Record<string, CollaborationSyncState>
>({});

export const hasUnsyncedChangesAtom = atom((get) =>
  Object.values(get(collaborationSyncStatesAtom)).some(
    (state) => state.unsyncedChanges > 0,
  ),
);
