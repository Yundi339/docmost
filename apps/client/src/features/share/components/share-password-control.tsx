import {
  Button,
  Group,
  PasswordInput,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  invalidateShareManagementQueries,
  useRemoveSharePasswordMutation,
} from "@/features/share/queries/share-query.ts";
import { setSharePassword } from "@/features/share/services/share-service.ts";
import { useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";

interface SharePasswordControlProps {
  shareId: string;
  passwordProtected: boolean;
  readOnly: boolean;
}

export function SharePasswordControl({
  shareId,
  passwordProtected,
  readOnly,
}: SharePasswordControlProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const queryClient = useQueryClient();
  const removePasswordMutation = useRemoveSharePasswordMutation();

  const resetEditor = () => {
    setEditing(false);
    setPassword("");
    setConfirmation("");
    setValidationError(null);
  };

  const savePassword = async () => {
    if (password.length < 8) {
      setValidationError(t("Password must be at least 8 characters"));
      return;
    }
    if (password !== confirmation) {
      setValidationError(t("Passwords do not match"));
      return;
    }
    setValidationError(null);
    setIsSaving(true);
    try {
      await setSharePassword(shareId, password);
      await invalidateShareManagementQueries(queryClient);
      notifications.show({ message: t("Share password saved") });
      resetEditor();
    } catch (requestError) {
      notifications.show({
        message:
          requestError?.["response"]?.data?.message ||
          t("Failed to save share password"),
        color: "red",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const confirmRemoval = () => {
    modals.openConfirmModal({
      title: t("Remove password protection?"),
      children: (
        <Text size="sm">
          {t("Anyone with the link will be able to view this shared page.")}
        </Text>
      ),
      labels: { confirm: t("Remove password"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: () => removePasswordMutation.mutate(shareId),
    });
  };

  return (
    <Stack gap="xs" mt="sm">
      <Group justify="space-between" wrap="nowrap" gap="xl">
        <div>
          <Text size="sm">{t("Password protection")}</Text>
          <Text size="xs" c="dimmed">
            {passwordProtected
              ? t("Visitors must enter a password")
              : t("Require a password to view this share")}
          </Text>
        </div>
        <Switch
          checked={passwordProtected}
          disabled={readOnly || isSaving || removePasswordMutation.isPending}
          size="xs"
          onChange={(event) => {
            if (event.currentTarget.checked) {
              setEditing(true);
            } else {
              confirmRemoval();
            }
          }}
          aria-label={t("Password protection")}
        />
      </Group>

      {passwordProtected && !editing && !readOnly && (
        <Button
          variant="subtle"
          size="compact-xs"
          onClick={() => setEditing(true)}
          style={{ alignSelf: "flex-start" }}
        >
          {t("Change password")}
        </Button>
      )}

      {editing && (
        <Stack gap="xs">
          <PasswordInput
            size="xs"
            label={passwordProtected ? t("New password") : t("Password")}
            value={password}
            maxLength={128}
            autoComplete="new-password"
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
          <PasswordInput
            size="xs"
            label={t("Confirm password")}
            value={confirmation}
            maxLength={128}
            autoComplete="new-password"
            error={validationError}
            onChange={(event) => setConfirmation(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void savePassword();
            }}
          />
          <Group justify="flex-end" gap="xs">
            <Button variant="default" size="compact-xs" onClick={resetEditor}>
              {t("Cancel")}
            </Button>
            <Button
              size="compact-xs"
              loading={isSaving}
              onClick={() => void savePassword()}
            >
              {t("Save")}
            </Button>
          </Group>
        </Stack>
      )}
    </Stack>
  );
}
