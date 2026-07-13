// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCollaborationProvider } from "./use-collaboration-provider";

const mocks = vi.hoisted(() => ({
  remotes: [] as any[],
  sockets: [] as any[],
  locals: [] as any[],
  report: vi.fn(),
  handleSaveShortcut: vi.fn(),
  refetch: vi.fn(),
  token: "initial-token",
  tokenError: false,
  tokenExpired: false,
  isIdle: false,
  documentState: "visible",
  resetIdle: vi.fn(),
}));

vi.mock("@hocuspocus/provider", () => {
  class MockSocket {
    connect = vi.fn();
    disconnect = vi.fn();
    destroy = vi.fn();

    constructor(public options: unknown) {
      mocks.sockets.push(this);
    }
  }

  class MockRemote {
    attach = vi.fn();
    destroy = vi.fn();
    forceSync = vi.fn();
    configuration: { token: string };

    constructor(public options: any) {
      this.configuration = { token: options.token };
      mocks.remotes.push(this);
    }
  }

  return {
    HocuspocusProvider: MockRemote,
    HocuspocusProviderWebsocket: MockSocket,
    WebSocketStatus: {
      Connecting: "connecting",
      Connected: "connected",
      Disconnected: "disconnected",
    },
  };
});

vi.mock("y-indexeddb", () => ({
  IndexeddbPersistence: class {
    on = vi.fn();
    off = vi.fn();
    destroy = vi.fn();

    constructor(
      public name: string,
      public document: unknown,
    ) {
      mocks.locals.push(this);
    }
  },
}));

vi.mock("yjs", () => ({ Doc: class {} }));

vi.mock("@/features/auth/queries/auth-query", () => ({
  useCollabToken: () => ({
    data: mocks.token ? { token: mocks.token } : undefined,
    isError: mocks.tokenError,
    refetch: mocks.refetch,
  }),
}));

vi.mock("@/features/editor/hooks/use-collaboration-url", () => ({
  default: () => "wss://docs.example.test/collab",
}));

vi.mock("@/hooks/use-idle", () => ({
  useIdle: () => ({ isIdle: mocks.isIdle, resetIdle: mocks.resetIdle }),
}));

vi.mock("@mantine/hooks", () => ({
  useDocumentVisibility: () => mocks.documentState,
}));

vi.mock("./use-collaboration-sync", () => ({
  useCollaborationSync: () => ({
    report: mocks.report,
    handleSaveShortcut: mocks.handleSaveShortcut,
  }),
}));

vi.mock("./collaboration-token", () => ({
  isCollaborationTokenExpired: () => mocks.tokenExpired,
}));

describe("useCollaborationProvider", () => {
  beforeEach(() => {
    mocks.remotes.length = 0;
    mocks.sockets.length = 0;
    mocks.locals.length = 0;
    mocks.report.mockReset();
    mocks.handleSaveShortcut.mockReset();
    mocks.refetch.mockReset();
    mocks.resetIdle.mockReset();
    mocks.token = "initial-token";
    mocks.tokenError = false;
    mocks.tokenExpired = false;
    mocks.isIdle = false;
    mocks.documentState = "visible";
  });

  it("attaches once and disposes every resource when the page changes", async () => {
    const onStateless = vi.fn();
    const hook = renderHook(
      ({ pageId }) => useCollaborationProvider({ pageId, onStateless }),
      { initialProps: { pageId: "page-one" } },
    );

    await waitFor(() => expect(hook.result.current.providersReady).toBe(true));
    expect(mocks.remotes).toHaveLength(1);
    expect(mocks.remotes[0].attach).toHaveBeenCalledOnce();
    expect(mocks.remotes[0].options.onStateless).toBe(onStateless);
    expect(mocks.locals[0].name).toBe("page.page-one");

    hook.rerender({ pageId: "page-two" });
    await waitFor(() => expect(mocks.remotes).toHaveLength(2));

    expect(mocks.remotes[0].destroy).toHaveBeenCalledOnce();
    expect(mocks.sockets[0].destroy).toHaveBeenCalledOnce();
    expect(mocks.locals[0].destroy).toHaveBeenCalledOnce();
    expect(mocks.remotes[1].attach).toHaveBeenCalledOnce();
    expect(mocks.locals[1].name).toBe("page.page-two");
  });

  it("derives ready state from local and remote sync callbacks", async () => {
    const hook = renderHook(() =>
      useCollaborationProvider({ pageId: "page-one" }),
    );
    await waitFor(() => expect(hook.result.current.providersReady).toBe(true));

    const localSynced = mocks.locals[0].on.mock.calls.find(
      ([event]: [string]) => event === "synced",
    )[1];
    act(() => {
      localSynced();
      mocks.remotes[0].options.onSynced({ state: true });
      mocks.remotes[0].options.onStatus({ status: "connected" });
    });

    expect(hook.result.current.isSynced).toBe(true);
    expect(hook.result.current.connectionStatus).toBe("connected");
    expect(mocks.report).toHaveBeenCalledWith({ localReady: true });
    expect(mocks.report).toHaveBeenCalledWith({ remoteReady: true });
  });

  it("refreshes an expired token and reconnects only the active provider", async () => {
    vi.useFakeTimers();
    mocks.tokenExpired = true;
    mocks.refetch.mockResolvedValue({ data: { token: "refreshed-token" } });
    const hook = renderHook(() =>
      useCollaborationProvider({ pageId: "page-one" }),
    );
    await act(async () => Promise.resolve());

    await act(async () => {
      mocks.remotes[0].options.onAuthenticationFailed();
      await Promise.resolve();
    });
    expect(mocks.remotes[0].configuration.token).toBe("refreshed-token");
    expect(mocks.sockets[0].disconnect).toHaveBeenCalledOnce();

    act(() => vi.advanceTimersByTime(100));
    expect(mocks.sockets[0].connect).toHaveBeenCalledOnce();
    expect(mocks.remotes[0].forceSync).toHaveBeenCalledOnce();
    hook.unmount();
    vi.useRealTimers();
  });

  it("disconnects only while idle and hidden, then reconnects when visible", async () => {
    const hook = renderHook(() =>
      useCollaborationProvider({ pageId: "page-one" }),
    );
    await waitFor(() => expect(hook.result.current.providersReady).toBe(true));
    act(() => mocks.remotes[0].options.onStatus({ status: "connected" }));

    mocks.isIdle = true;
    mocks.documentState = "hidden";
    hook.rerender();
    expect(mocks.sockets[0].disconnect).toHaveBeenCalledOnce();

    act(() => mocks.remotes[0].options.onStatus({ status: "disconnected" }));
    mocks.documentState = "visible";
    hook.rerender();
    expect(mocks.resetIdle).toHaveBeenCalledOnce();
    expect(mocks.sockets[0].connect).toHaveBeenCalledOnce();
  });
});
