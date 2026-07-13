// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";

import { collaborationSyncStatesAtom } from "./collaboration-sync-state";
import { useCollaborationSync } from "./use-collaboration-sync";

const { showNotification } = vi.hoisted(() => ({
  showNotification: vi.fn(),
}));

vi.mock("@mantine/notifications", () => ({
  notifications: { show: showNotification },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function wrapper(store: ReturnType<typeof createStore>) {
  return ({ children }: PropsWithChildren) => (
    <Provider store={store}>{children}</Provider>
  );
}

describe("useCollaborationSync", () => {
  it("keeps a detached pending page without retaining its retry closure", () => {
    const store = createStore();
    const retry = vi.fn();
    const hook = renderHook(({ pageId }) => useCollaborationSync(pageId), {
      initialProps: { pageId: "first-page" },
      wrapper: wrapper(store),
    });

    act(() => {
      hook.result.current.report({
        connectionStatus: "connected",
        localReady: true,
        remoteReady: true,
        unsyncedChanges: 1,
        retry,
      });
    });
    hook.rerender({ pageId: "second-page" });

    expect(store.get(collaborationSyncStatesAtom)["first-page"]).toMatchObject({
      phase: "pending",
      connectionStatus: "disconnected",
      unsyncedChanges: 1,
      retry: undefined,
    });
    expect(store.get(collaborationSyncStatesAtom)["second-page"]?.phase).toBe(
      "connecting",
    );
  });

  it("removes a synced page when it detaches", () => {
    const store = createStore();
    const hook = renderHook(({ pageId }) => useCollaborationSync(pageId), {
      initialProps: { pageId: "first-page" },
      wrapper: wrapper(store),
    });
    act(() => {
      hook.result.current.report({
        connectionStatus: "connected",
        localReady: true,
        remoteReady: true,
      });
    });

    hook.rerender({ pageId: "second-page" });
    expect(
      store.get(collaborationSyncStatesAtom)["first-page"],
    ).toBeUndefined();
  });

  it("keeps the same page isolated between browser-tab stores", () => {
    const firstStore = createStore();
    const secondStore = createStore();
    const first = renderHook(() => useCollaborationSync("shared-page"), {
      wrapper: wrapper(firstStore),
    });
    renderHook(() => useCollaborationSync("shared-page"), {
      wrapper: wrapper(secondStore),
    });

    act(() => first.result.current.report({ unsyncedChanges: 2 }));

    expect(
      firstStore.get(collaborationSyncStatesAtom)["shared-page"]
        .unsyncedChanges,
    ).toBe(2);
    expect(
      secondStore.get(collaborationSyncStatesAtom)["shared-page"]
        .unsyncedChanges,
    ).toBe(0);
  });

  it("retries only the current page from the save shortcut", () => {
    showNotification.mockClear();
    const store = createStore();
    const retry = vi.fn();
    const hook = renderHook(() => useCollaborationSync("page-id"), {
      wrapper: wrapper(store),
    });
    act(() => {
      hook.result.current.report({
        connectionStatus: "disconnected",
        unsyncedChanges: 1,
        retry,
      });
    });
    act(() => hook.result.current.handleSaveShortcut());

    expect(retry).toHaveBeenCalledOnce();
    expect(showNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Changes are saved on this device and waiting to sync",
      }),
    );
  });
});
