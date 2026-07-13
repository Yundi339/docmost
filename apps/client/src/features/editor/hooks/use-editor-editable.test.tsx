// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useEditorEditable } from "./use-editor-editable";

function createEditor(initialEditable: boolean) {
  let editable = initialEditable;
  const listeners = new Set<() => void>();

  return {
    get isEditable() {
      return editable;
    },
    on: vi.fn((event: string, listener: () => void) => {
      if (event === "update") listeners.add(listener);
    }),
    off: vi.fn((event: string, listener: () => void) => {
      if (event === "update") listeners.delete(listener);
    }),
    setEditable(nextEditable: boolean) {
      editable = nextEditable;
      listeners.forEach((listener) => listener());
    },
    listenerCount() {
      return listeners.size;
    },
  };
}

describe("useEditorEditable", () => {
  it("tracks editable changes emitted through the editor update event", () => {
    const editor = createEditor(true);
    const { result } = renderHook(() => useEditorEditable(editor as any));

    expect(result.current).toBe(true);
    act(() => editor.setEditable(false));
    expect(result.current).toBe(false);
    act(() => editor.setEditable(true));
    expect(result.current).toBe(true);
  });

  it("moves the subscription when the editor changes and cleans it up", () => {
    const firstEditor = createEditor(true);
    const secondEditor = createEditor(false);
    const { result, rerender, unmount } = renderHook(
      ({ editor }) => useEditorEditable(editor as any),
      { initialProps: { editor: firstEditor } },
    );

    expect(firstEditor.listenerCount()).toBe(1);
    rerender({ editor: secondEditor });
    expect(result.current).toBe(false);
    expect(firstEditor.listenerCount()).toBe(0);
    expect(secondEditor.listenerCount()).toBe(1);

    unmount();
    expect(secondEditor.listenerCount()).toBe(0);
  });

  it("uses a non-editable snapshot without an editor", () => {
    const { result } = renderHook(() => useEditorEditable(null));
    expect(result.current).toBe(false);
  });
});
