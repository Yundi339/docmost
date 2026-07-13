import { useCallback, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/react";

export function useEditorEditable(editor: Editor | null): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!editor) return () => undefined;

      editor.on("update", onStoreChange);
      return () => editor.off("update", onStoreChange);
    },
    [editor],
  );
  const getSnapshot = useCallback(() => editor?.isEditable ?? false, [editor]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
