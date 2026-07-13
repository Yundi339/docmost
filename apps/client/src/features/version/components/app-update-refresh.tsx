import { Text } from "@mantine/core";
import { modals } from "@mantine/modals";

type Translate = (key: string) => string;

let allowConfirmedUnsyncedReload = false;

export function isConfirmedUnsyncedReloadAllowed() {
  return allowConfirmedUnsyncedReload;
}

export function refreshWithSyncProtection(
  hasUnsyncedChanges: boolean,
  t: Translate,
  reload = () => window.location.reload(),
  openConfirm = modals.openConfirmModal,
) {
  if (!hasUnsyncedChanges) {
    reload();
    return;
  }

  openConfirm({
    title: t("Unsynced changes"),
    children: (
      <Text size="sm">
        {t(
          "Some changes are still waiting to sync. Refreshing now may interrupt synchronization.",
        )}
      </Text>
    ),
    centered: true,
    labels: { confirm: t("Refresh anyway"), cancel: t("Cancel") },
    confirmProps: { color: "orange" },
    onConfirm: () => {
      allowConfirmedUnsyncedReload = true;
      reload();
    },
  });
}
