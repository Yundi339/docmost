import { Stack, Text, Switch } from "@mantine/core";
import { useAtom } from "jotai";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom.ts";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { updateWorkspace } from "@/features/workspace/services/workspace-service.ts";
import { notifications } from "@mantine/notifications";
import {
  ResponsiveSettingsRow,
  ResponsiveSettingsContent,
  ResponsiveSettingsControl,
} from "@/components/ui/responsive-settings-row";

export default function RestrictApiToAdmins() {
  const { t } = useTranslation();
  const [workspace, setWorkspace] = useAtom(workspaceAtom);
  const [restrictToAdmins, setRestrictToAdmins] = useState(
    workspace?.settings?.api?.restrictToAdmins === true,
  );

  const updateSetting = async (
    payload: {
      restrictApiToAdmins?: boolean;
    },
    onSuccess: () => void,
  ) => {
    try {
      const updatedWorkspace = await updateWorkspace(payload);
      onSuccess();
      setWorkspace(updatedWorkspace);
    } catch (err) {
      notifications.show({
        message: err?.response?.data?.message,
        color: "red",
      });
    }
  };

  const handleRestrictToAdminsChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const value = event.currentTarget.checked;
    await updateSetting({ restrictApiToAdmins: value }, () =>
      setRestrictToAdmins(value),
    );
  };

  return (
    <Stack gap="md">
      <div>
        <Text fw={600}>{t("API management")}</Text>
        <Text size="sm" c="dimmed">
          {t("Control API key creation for this workspace.")}
        </Text>
      </div>

      <ResponsiveSettingsRow>
        <ResponsiveSettingsContent>
          <Text size="md">{t("Restrict API key creation to admins")}</Text>
          <Text size="sm" c="dimmed">
            {t(
              "Only admins and owners can create new API keys. Existing member keys will continue to work.",
            )}
          </Text>
        </ResponsiveSettingsContent>

        <ResponsiveSettingsControl>
          <Switch
            checked={restrictToAdmins}
            onChange={handleRestrictToAdminsChange}
            aria-label={t("Toggle restrict API keys to admins")}
          />
        </ResponsiveSettingsControl>
      </ResponsiveSettingsRow>
    </Stack>
  );
}
