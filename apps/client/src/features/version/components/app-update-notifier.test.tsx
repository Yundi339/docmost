import { describe, expect, it, vi } from "vitest";
import { refreshWithSyncProtection } from "./app-update-refresh";

const t = (key: string) => key;

describe("refreshWithSyncProtection", () => {
  it("reloads immediately when all changes are synced", () => {
    const reload = vi.fn();
    const openConfirm = vi.fn();
    refreshWithSyncProtection(false, t, reload, openConfirm);
    expect(reload).toHaveBeenCalledOnce();
    expect(openConfirm).not.toHaveBeenCalled();
  });

  it("requires confirmation while changes are waiting to sync", () => {
    const reload = vi.fn();
    const openConfirm = vi.fn();
    refreshWithSyncProtection(true, t, reload, openConfirm);
    expect(reload).not.toHaveBeenCalled();
    expect(openConfirm).toHaveBeenCalledOnce();

    const options = openConfirm.mock.calls[0][0];
    expect(options.title).toBe("Unsynced changes");
    options.onConfirm();
    expect(reload).toHaveBeenCalledOnce();
  });
});
