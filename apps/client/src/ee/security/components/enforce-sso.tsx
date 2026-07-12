import { Group, Text, Switch, MantineSize, Tooltip } from "@mantine/core";
import { useAtom } from "jotai";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom.ts";
import React from "react";
import { useTranslation } from "react-i18next";
import { updateWorkspace } from "@/features/workspace/services/workspace-service.ts";
import { notifications } from "@mantine/notifications";
import { useHasFeature } from "@/ee/hooks/use-feature.ts";
import { Feature } from "@/ee/features.ts";
import { useUpgradeLabel } from "@/ee/hooks/use-upgrade-label.ts";
import { useWorkspaceQuery } from "@/features/workspace/queries/workspace-query.ts";
import { useQueryClient } from "@tanstack/react-query";

export default function EnforceSso() {
  const { t } = useTranslation();
  const { data: workspace } = useWorkspaceQuery();

  return (
    <Group justify="space-between" wrap="nowrap" gap="xl">
      <div>
        <Text size="md">{t("Enforce SSO")}</Text>
        <Text size="sm" c="dimmed">
          {t(
            "Once enforced, members will not be able to login with email and password.",
          )}
        </Text>
        {workspace && !workspace.ssoEnforcementAvailable && (
          <Text size="xs" c="orange.7" mt={4}>
            {t(
              "SSO enforcement requires an enabled provider with a login handler and a workspace owner with a local password.",
            )}
          </Text>
        )}
      </div>

      <EnforceSsoToggle />
    </Group>
  );
}

interface EnforceSsoToggleProps {
  size?: MantineSize;
  label?: string;
}
export function EnforceSsoToggle({ size, label }: EnforceSsoToggleProps) {
  const { t } = useTranslation();
  const [, setWorkspace] = useAtom(workspaceAtom);
  const { data: workspace } = useWorkspaceQuery();
  const queryClient = useQueryClient();
  const checked = workspace?.enforceSso ?? false;
  const enforcementAvailable = workspace?.ssoEnforcementAvailable ?? false;
  const hasAccess = useHasFeature(Feature.SSO_CUSTOM);
  const upgradeLabel = useUpgradeLabel();
  const unavailableLabel = t(
    "SSO enforcement requires an enabled provider with a login handler and a workspace owner with a local password.",
  );

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.currentTarget.checked;
    try {
      const updatedWorkspace = await updateWorkspace({ enforceSso: value });
      setWorkspace(updatedWorkspace);
      queryClient.setQueryData(["workspace"], updatedWorkspace);
    } catch (err) {
      notifications.show({
        message: err?.response?.data?.message,
        color: "red",
      });
    }
  };

  return (
    <Tooltip
      label={!hasAccess ? upgradeLabel : unavailableLabel}
      disabled={hasAccess && (checked || enforcementAvailable)}
      refProp="rootRef"
    >
      <Switch
        size={size}
        label={label}
        labelPosition="left"
        checked={checked}
        onChange={handleChange}
        disabled={!hasAccess || (!checked && !enforcementAvailable)}
        aria-label={t("Toggle sso enforcement")}
      />
    </Tooltip>
  );
}
