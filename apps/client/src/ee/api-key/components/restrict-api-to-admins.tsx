import { Divider, Stack, Text, Switch, Tooltip } from "@mantine/core";
import { useAtom } from "jotai";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom.ts";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { updateWorkspace } from "@/features/workspace/services/workspace-service.ts";
import { notifications } from "@mantine/notifications";
import { useHasFeature } from "@/ee/hooks/use-feature";
import { Feature } from "@/ee/features";
import {
  ResponsiveSettingsRow,
  ResponsiveSettingsContent,
  ResponsiveSettingsControl,
} from "@/components/ui/responsive-settings-row";
import { useUpgradeLabel } from "@/ee/hooks/use-upgrade-label.ts";

export default function RestrictApiToAdmins() {
  const { t } = useTranslation();
  const [workspace, setWorkspace] = useAtom(workspaceAtom);
  const [restrictToAdmins, setRestrictToAdmins] = useState(
    workspace?.settings?.api?.restrictToAdmins === true,
  );
  const [allowMemberAiSettings, setAllowMemberAiSettings] = useState(
    workspace?.settings?.ai?.allowMemberSettings !== false,
  );
  const hasAccess = useHasFeature(Feature.API_KEYS);
  const upgradeLabel = useUpgradeLabel();

  const updateSetting = async (
    payload: {
      restrictApiToAdmins?: boolean;
      allowMemberAiSettings?: boolean;
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

  const handleAllowMemberAiSettingsChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const value = event.currentTarget.checked;
    await updateSetting({ allowMemberAiSettings: value }, () =>
      setAllowMemberAiSettings(value),
    );
  };

  return (
    <Stack gap="md">
      <div>
        <Text fw={600}>{t("Member management")}</Text>
        <Text size="sm" c="dimmed">
          {t("Control which workspace settings members can use.")}
        </Text>
      </div>

      <ResponsiveSettingsRow>
        <ResponsiveSettingsContent>
          <Text size="md">{t("Allow members to use AI settings")}</Text>
          <Text size="sm" c="dimmed">
            {t("Members can open AI settings and update AI feature toggles.")}
          </Text>
        </ResponsiveSettingsContent>

        <ResponsiveSettingsControl>
          <Tooltip label={upgradeLabel} disabled={hasAccess} refProp="rootRef">
            <Switch
              checked={allowMemberAiSettings}
              onChange={handleAllowMemberAiSettingsChange}
              disabled={!hasAccess}
              aria-label={t("Toggle member AI settings")}
            />
          </Tooltip>
        </ResponsiveSettingsControl>
      </ResponsiveSettingsRow>

      <Divider />

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
          <Tooltip label={upgradeLabel} disabled={hasAccess} refProp="rootRef">
            <Switch
              checked={restrictToAdmins}
              onChange={handleRestrictToAdminsChange}
              disabled={!hasAccess}
              aria-label={t("Toggle restrict API keys to admins")}
            />
          </Tooltip>
        </ResponsiveSettingsControl>
      </ResponsiveSettingsRow>
    </Stack>
  );
}
