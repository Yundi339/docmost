import { describe, expect, it, vi } from "vitest";

import {
  createReconnectController,
  patchForConnectionStatus,
} from "./collaboration-provider-lifecycle";
import {
  createCollaborationSyncState,
  updateCollaborationSyncState,
} from "./collaboration-sync-state";

describe("collaboration provider lifecycle", () => {
  it("clears remote readiness while a connection is unavailable", () => {
    expect(patchForConnectionStatus("disconnected")).toEqual({
      connectionStatus: "disconnected",
      remoteReady: false,
    });
    expect(patchForConnectionStatus("connecting")).toEqual({
      connectionStatus: "connecting",
      remoteReady: false,
    });
    expect(patchForConnectionStatus("connected")).toEqual({
      connectionStatus: "connected",
      errorCode: undefined,
    });
  });

  it("does not report synced until a recovered connection handshakes again", () => {
    let state = updateCollaborationSyncState(
      createCollaborationSyncState("page-id"),
      {
        connectionStatus: "connected",
        localReady: true,
        remoteReady: true,
      },
    );
    state = updateCollaborationSyncState(
      state,
      patchForConnectionStatus("disconnected"),
    );
    expect(state.phase).toBe("offline");

    state = updateCollaborationSyncState(state, { unsyncedChanges: 1 });
    expect(state.phase).toBe("pending");
    state = updateCollaborationSyncState(
      state,
      patchForConnectionStatus("connected"),
    );
    state = updateCollaborationSyncState(state, { unsyncedChanges: 0 });
    expect(state.phase).toBe("connecting");

    state = updateCollaborationSyncState(state, { remoteReady: true });
    expect(state.phase).toBe("synced");
  });

  it("retries once and forces a fresh sync", () => {
    vi.useFakeTimers();
    const socket = { connect: vi.fn(), disconnect: vi.fn() };
    const provider = { forceSync: vi.fn() };
    const report = vi.fn();
    const controller = createReconnectController({ socket, provider, report });

    controller.retry();
    controller.retry();
    expect(socket.disconnect).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenLastCalledWith({
      connectionStatus: "connecting",
      remoteReady: false,
      errorCode: undefined,
    });

    vi.advanceTimersByTime(100);
    expect(socket.connect).toHaveBeenCalledOnce();
    expect(provider.forceSync).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("cancels a scheduled reconnect when the page detaches", () => {
    vi.useFakeTimers();
    const socket = { connect: vi.fn(), disconnect: vi.fn() };
    const provider = { forceSync: vi.fn() };
    const controller = createReconnectController({
      socket,
      provider,
      report: vi.fn(),
    });

    controller.retry();
    controller.dispose();
    vi.runAllTimers();

    expect(socket.connect).not.toHaveBeenCalled();
    expect(provider.forceSync).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
