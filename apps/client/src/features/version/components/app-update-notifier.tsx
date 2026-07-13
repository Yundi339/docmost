import { Button, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconRefresh } from "@tabler/icons-react";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { hasUnsyncedChangesAtom } from "@/features/editor/collaboration/collaboration-sync-state";
import {
  isConfirmedUnsyncedReloadAllowed,
  refreshWithSyncProtection,
} from "./app-update-refresh";

const UPDATE_NOTIFICATION_ID = "app-update-available";
const PRELOAD_ERROR_EVENT = "docmost:preload-error";
const VERSION_CHECK_INTERVAL_MS = 60_000;
let preloadFailed = false;

if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    preloadFailed = true;
    window.dispatchEvent(new Event(PRELOAD_ERROR_EVENT));
  });
}

type RuntimeVersion = {
  version?: string;
};

async function getRuntimeVersion(): Promise<string | null> {
  try {
    const response = await fetch(`/version.json?t=${Date.now()}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as RuntimeVersion;
    return typeof data.version === "string" && data.version.length > 0
      ? data.version
      : null;
  } catch {
    return null;
  }
}

export function AppUpdateNotifier() {
  const { t } = useTranslation();
  const hasUnsyncedChanges = useAtomValue(hasUnsyncedChangesAtom);
  const hasUnsyncedChangesRef = useRef(hasUnsyncedChanges);
  hasUnsyncedChangesRef.current = hasUnsyncedChanges;

  const handleRefresh = useCallback(() => {
    refreshWithSyncProtection(hasUnsyncedChangesRef.current, t);
  }, [t]);

  const showUpdateNotification = useCallback(() => {
    notifications.show({
      id: UPDATE_NOTIFICATION_ID,
      position: "top-right",
      title: t("A new version is available"),
      message: (
        <Stack gap="sm">
          <Text size="sm">
            {t("The server has been updated. Refresh to continue using it.")}
          </Text>
          <Button
            size="xs"
            leftSection={<IconRefresh size={16} />}
            onClick={handleRefresh}
          >
            {t("Refresh now")}
          </Button>
        </Stack>
      ),
      autoClose: false,
      withCloseButton: false,
    });
  }, [handleRefresh, t]);

  const checkVersion = useCallback(async () => {
    if (import.meta.env.DEV || !APP_VERSION) {
      return;
    }

    const runtimeVersion = await getRuntimeVersion();
    if (runtimeVersion && runtimeVersion !== APP_VERSION) {
      showUpdateNotification();
    }
  }, [showUpdateNotification]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkVersion();
      }
    };
    const handlePreloadError = () => showUpdateNotification();

    if (preloadFailed) {
      showUpdateNotification();
    }

    void checkVersion();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void checkVersion();
      }
    }, VERSION_CHECK_INTERVAL_MS);

    window.addEventListener("focus", checkVersion);
    window.addEventListener(PRELOAD_ERROR_EVENT, handlePreloadError);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", checkVersion);
      window.removeEventListener(PRELOAD_ERROR_EVENT, handlePreloadError);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [checkVersion, showUpdateNotification]);

  useEffect(() => {
    if (!hasUnsyncedChanges) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isConfirmedUnsyncedReloadAllowed()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsyncedChanges]);

  return null;
}
