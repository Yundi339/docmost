// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import {
  collaborationSyncStatesAtom,
  createCollaborationSyncState,
  updateCollaborationSyncState,
} from "./collaboration-sync-state";
import { SyncStatusIndicator } from "./sync-status-indicator";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

function renderIndicator(state: ReturnType<typeof createCollaborationSyncState>) {
  const store = createStore();
  store.set(collaborationSyncStatesAtom, { [state.pageId]: state });
  render(
    <Provider store={store}>
      <MantineProvider>
        <SyncStatusIndicator pageId={state.pageId} />
      </MantineProvider>
    </Provider>,
  );
}

describe("SyncStatusIndicator", () => {
  it("stays quiet after all changes are synced", () => {
    renderIndicator(
      updateCollaborationSyncState(createCollaborationSyncState("page-id"), {
        connectionStatus: "connected",
        localReady: true,
        remoteReady: true,
      }),
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows pending offline changes and retries on selection", () => {
    const retry = vi.fn();
    renderIndicator(
      updateCollaborationSyncState(createCollaborationSyncState("page-id"), {
        connectionStatus: "disconnected",
        localReady: true,
        unsyncedChanges: 1,
        retry,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Changes are saved on this device and waiting to sync",
      }),
    );
    expect(retry).toHaveBeenCalledOnce();
  });
});
