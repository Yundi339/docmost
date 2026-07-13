import { notifications } from "@mantine/notifications";
import { useAtomValue, useSetAtom } from "jotai";
import { selectAtom } from "jotai/utils";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  CollaborationSyncPatch,
  collaborationSyncStatesAtom,
  createCollaborationSyncState,
  detachCollaborationSyncState,
  getCollaborationSyncMessageKey,
  updateCollaborationSyncState,
} from "./collaboration-sync-state";

export function useCollaborationSync(pageId: string) {
  const { t } = useTranslation();
  const pageStateAtom = useMemo(
    () => selectAtom(collaborationSyncStatesAtom, (states) => states[pageId]),
    [pageId],
  );
  const state = useAtomValue(pageStateAtom);
  const setStates = useSetAtom(collaborationSyncStatesAtom);
  const stateRef = useRef(state);
  stateRef.current = state;

  const report = useCallback(
    (patch: CollaborationSyncPatch) => {
      setStates((current) => {
        const previous =
          current[pageId] ?? createCollaborationSyncState(pageId);
        return {
          ...current,
          [pageId]: updateCollaborationSyncState(previous, patch),
        };
      });
    },
    [pageId, setStates],
  );

  const remove = useCallback(() => {
    setStates((current) => {
      const previous = current[pageId];
      if (!previous) return current;
      const detached = detachCollaborationSyncState(previous);
      if (detached) {
        return {
          ...current,
          [pageId]: detached,
        };
      }
      const next = { ...current };
      delete next[pageId];
      return next;
    });
  }, [pageId, setStates]);

  useEffect(() => {
    report({});
    return remove;
  }, [remove, report]);

  const handleSaveShortcut = useCallback(() => {
    const state = stateRef.current;
    if (!state) return;

    if (state.phase !== "synced") {
      state.retry?.();
    }

    const message = t(getCollaborationSyncMessageKey(state));

    notifications.show({
      message,
      color:
        state.phase === "error"
          ? "red"
          : state.phase === "synced"
            ? "green"
            : undefined,
    });
  }, [t]);

  return {
    state,
    report,
    handleSaveShortcut,
  };
}
