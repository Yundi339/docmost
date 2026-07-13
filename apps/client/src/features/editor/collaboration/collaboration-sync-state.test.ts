import { describe, expect, it, vi } from "vitest";
import { createStore } from "jotai";
import {
  collaborationSyncStatesAtom,
  createCollaborationSyncState,
  detachCollaborationSyncState,
  deriveCollaborationSyncPhase,
  getCollaborationSyncMessageKey,
  hasUnsyncedChangesAtom,
  updateCollaborationSyncState,
} from "./collaboration-sync-state";

describe("collaboration sync state", () => {
  it("requires local and remote readiness before reporting synced", () => {
    expect(
      deriveCollaborationSyncPhase({
        connectionStatus: "connected",
        localReady: true,
        remoteReady: true,
        unsyncedChanges: 0,
      }),
    ).toBe("synced");
    expect(
      deriveCollaborationSyncPhase({
        connectionStatus: "connected",
        localReady: false,
        remoteReady: true,
        unsyncedChanges: 0,
      }),
    ).toBe("connecting");
  });

  it("prioritizes errors and pending local changes", () => {
    expect(
      deriveCollaborationSyncPhase({
        connectionStatus: "disconnected",
        localReady: true,
        remoteReady: false,
        unsyncedChanges: 2,
      }),
    ).toBe("pending");
    expect(
      deriveCollaborationSyncPhase({
        connectionStatus: "connected",
        localReady: true,
        remoteReady: true,
        unsyncedChanges: 2,
        errorCode: "authentication",
      }),
    ).toBe("error");
  });

  it("records the first transition to synced", () => {
    const initial = createCollaborationSyncState("page-id");
    const synced = updateCollaborationSyncState(
      initial,
      {
        connectionStatus: "connected",
        localReady: true,
        remoteReady: true,
      },
      123,
    );
    expect(synced.phase).toBe("synced");
    expect(synced.lastSyncedAt).toBe(123);
    expect(updateCollaborationSyncState(synced, {}, 456).lastSyncedAt).toBe(
      123,
    );
  });

  it("preserves the retry command without invoking it", () => {
    const retry = vi.fn();
    const next = updateCollaborationSyncState(
      createCollaborationSyncState("page-id"),
      { retry },
    );
    expect(next.retry).toBe(retry);
    expect(retry).not.toHaveBeenCalled();
  });

  it("detects pending changes across active page editors", () => {
    const store = createStore();
    store.set(collaborationSyncStatesAtom, {
      first: createCollaborationSyncState("first"),
      second: updateCollaborationSyncState(
        createCollaborationSyncState("second"),
        { unsyncedChanges: 1 },
      ),
    });
    expect(store.get(hasUnsyncedChangesAtom)).toBe(true);
  });

  it("keeps pending state without a stale retry command after detach", () => {
    const retry = vi.fn();
    const pending = updateCollaborationSyncState(
      createCollaborationSyncState("page-id"),
      { unsyncedChanges: 1, retry },
    );
    expect(detachCollaborationSyncState(pending)).toMatchObject({
      phase: "pending",
      connectionStatus: "disconnected",
      retry: undefined,
    });
    expect(
      detachCollaborationSyncState(createCollaborationSyncState("synced")),
    ).toBeUndefined();
  });

  it("distinguishes offline pending feedback from an idle offline state", () => {
    const offline = updateCollaborationSyncState(
      createCollaborationSyncState("page-id"),
      { connectionStatus: "disconnected" },
    );
    const pending = updateCollaborationSyncState(offline, {
      unsyncedChanges: 1,
    });
    expect(getCollaborationSyncMessageKey(offline)).toBe("You are offline");
    expect(getCollaborationSyncMessageKey(pending)).toBe(
      "Changes are saved on this device and waiting to sync",
    );
  });
});
