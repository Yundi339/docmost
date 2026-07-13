import { ActionIcon, Loader, Tooltip } from "@mantine/core";
import {
  IconAlertTriangle,
  IconCloudUpload,
  IconWifiOff,
} from "@tabler/icons-react";
import { useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { collaborationSyncStatesAtom } from "./collaboration-sync-state";

type SyncStatusIndicatorProps = {
  pageId?: string;
};

export function SyncStatusIndicator({ pageId }: SyncStatusIndicatorProps) {
  const { t } = useTranslation();
  const pageStateAtom = useMemo(
    () =>
      selectAtom(collaborationSyncStatesAtom, (states) =>
        pageId ? states[pageId] : undefined,
      ),
    [pageId],
  );
  const state = useAtomValue(pageStateAtom);
  const [showConnecting, setShowConnecting] = useState(false);

  useEffect(() => {
    if (state?.phase !== "connecting") {
      setShowConnecting(false);
      return;
    }
    const timeout = window.setTimeout(() => setShowConnecting(true), 1500);
    return () => window.clearTimeout(timeout);
  }, [state?.phase]);

  if (!state || state.phase === "synced") return null;
  if (state.phase === "connecting" && !showConnecting) return null;

  const label =
    state.phase === "connecting"
      ? t("Connecting to the collaboration server")
      : state.phase === "pending" && state.connectionStatus === "disconnected"
        ? t("Changes are saved on this device and waiting to sync")
        : state.phase === "pending"
          ? t("Changes are waiting to sync")
          : state.phase === "offline"
            ? t("You are offline. Select to reconnect")
            : t("Sync failed. Select to reconnect");

  const icon =
    state.phase === "connecting" ? (
      <Loader size={16} />
    ) : state.phase === "pending" ? (
      <IconCloudUpload size={19} />
    ) : state.phase === "offline" ? (
      <IconWifiOff size={19} />
    ) : (
      <IconAlertTriangle size={19} />
    );

  return (
    <Tooltip label={label} openDelay={250} withArrow>
      <ActionIcon
        size="md"
        variant="subtle"
        color={
          state.phase === "error"
            ? "red"
            : state.phase === "connecting"
              ? "gray"
              : "orange"
        }
        onClick={state.retry}
        disabled={!state.retry}
        aria-label={label}
      >
        {icon}
      </ActionIcon>
    </Tooltip>
  );
}
