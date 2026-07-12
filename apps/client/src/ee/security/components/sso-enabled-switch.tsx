import { Group, Switch, Text } from "@mantine/core";
import { ChangeEventHandler } from "react";
import { useTranslation } from "react-i18next";
import classes from "@/ee/security/components/sso.module.css";

interface SsoEnabledSwitchProps {
  checked: boolean;
  loginAvailable: boolean;
  onChange: ChangeEventHandler<HTMLInputElement>;
}

export function SsoEnabledSwitch({
  checked,
  loginAvailable,
  onChange,
}: SsoEnabledSwitchProps) {
  const { t } = useTranslation();

  return (
    <Group justify="space-between" align="flex-start" wrap="nowrap">
      <div>
        <Text size="sm">{t("Enabled")}</Text>
        {!loginAvailable && (
          <Text size="xs" c="dimmed" maw={420}>
            {t(
              "Login is not available for this SSO provider type in this server version.",
            )}
          </Text>
        )}
      </div>
      <Switch
        className={classes.switch}
        checked={checked}
        disabled={!loginAvailable && !checked}
        onChange={onChange}
        aria-label={t("Enabled")}
      />
    </Group>
  );
}
