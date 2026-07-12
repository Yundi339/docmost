import {
  Modal,
  TextInput,
  Button,
  Text,
  Group,
  PasswordInput,
  Stack,
} from "@mantine/core";
import { z } from "zod/v4";
import { useEffect, useState } from "react";
import { useAtom } from "jotai";
import {
  currentUserAtom,
  userAtom,
} from "@/features/user/atoms/current-user-atom.ts";
import { useDisclosure } from "@mantine/hooks";
import { useForm } from "@mantine/form";
import { zod4Resolver } from "mantine-form-zod-resolver";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import { useSearchParams } from "react-router-dom";
import {
  confirmEmailChange,
  requestEmailChange,
} from "@/features/user/services/user-service.ts";
import {
  EMAIL_CHANGE_CONFIRM_PARAM,
  takeEmailChangeToken,
} from "@/features/user/email-change-token.ts";

export default function ChangeEmail() {
  const { t } = useTranslation();
  const [currentUser] = useAtom(currentUserAtom);
  const [searchParams, setSearchParams] = useSearchParams();
  const [confirmationToken, setConfirmationToken] = useState<string | null>(
    null,
  );
  const [opened, { open, close }] = useDisclosure(false);
  const ssoEnforced = currentUser?.workspace.enforceSso === true;

  useEffect(() => {
    if (searchParams.get(EMAIL_CHANGE_CONFIRM_PARAM) !== "1") return;

    const token = takeEmailChangeToken();
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete(EMAIL_CHANGE_CONFIRM_PARAM);
    setSearchParams(nextParams, { replace: true });
    if (!token) return;

    setConfirmationToken(token);
    open();
  }, [open, searchParams, setSearchParams]);

  const handleClose = () => {
    setConfirmationToken(null);
    close();
  };

  return (
    <Group justify="space-between" wrap="nowrap" gap="xl">
      <div style={{ minWidth: 0, flex: 1 }}>
        <Text size="md">{t("Email")}</Text>
        <Text size="sm" c="dimmed">
          {currentUser?.user.email}
        </Text>
        {ssoEnforced && (
          <Text size="xs" c="dimmed" mt={4}>
            {t("Email changes are unavailable while SSO is enforced.")}
          </Text>
        )}
      </div>

      <Button
        onClick={() => {
          setConfirmationToken(null);
          open();
        }}
        variant="default"
        disabled={ssoEnforced}
        style={{ whiteSpace: "nowrap" }}
      >
        {t("Change email")}
      </Button>

      <Modal
        opened={opened}
        onClose={handleClose}
        title={
          confirmationToken ? t("Confirm email change") : t("Change email")
        }
        centered
        closeButtonProps={{ "aria-label": t("Close") }}
      >
        {confirmationToken ? (
          <ConfirmEmailChange token={confirmationToken} onClose={handleClose} />
        ) : (
          <ChangeEmailForm onClose={handleClose} />
        )}
      </Modal>
    </Group>
  );
}

type FormValues = { email: string; password: string };

function ChangeEmailForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const formSchema = z.object({
    email: z.email({ error: t("New email is required") }),
    password: z
      .string({ error: t("Current password is required") })
      .min(8, t("Current password is required")),
  });

  const form = useForm<FormValues>({
    validate: zod4Resolver(formSchema),
    initialValues: {
      password: "",
      email: "",
    },
  });

  async function handleSubmit(data: FormValues) {
    setIsLoading(true);
    try {
      await requestEmailChange(data);
      notifications.show({
        message: t(
          "Check your new email and use the confirmation link within 30 minutes.",
        ),
      });
      onClose();
    } catch (error) {
      const message = error?.response?.data?.message;
      notifications.show({
        message: message ? t(message) : t("Failed to request email change"),
        color: "red",
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={form.onSubmit(handleSubmit)}>
      <Text mb="md">
        {t(
          "Enter your current password. We will send a confirmation link to your new email.",
        )}
      </Text>

      <PasswordInput
        label={t("Current password")}
        placeholder={t("Enter your current password")}
        autoComplete="current-password"
        variant="filled"
        mb="md"
        data-autofocus
        visibilityToggleButtonProps={{
          "aria-label": t("Toggle password visibility"),
          "aria-hidden": false,
          tabIndex: 0,
        }}
        {...form.getInputProps("password")}
      />

      <TextInput
        id="new-email"
        label={t("New email")}
        placeholder={t("New email")}
        autoComplete="email"
        variant="filled"
        mb="md"
        {...form.getInputProps("email")}
      />

      <Group justify="flex-end" mt="md">
        <Button type="submit" disabled={isLoading} loading={isLoading}>
          {t("Send confirmation link")}
        </Button>
      </Group>
    </form>
  );
}

function ConfirmEmailChange({
  token,
  onClose,
}: {
  token: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [user, setUser] = useAtom(userAtom);
  const [isLoading, setIsLoading] = useState(false);

  async function handleConfirm() {
    setIsLoading(true);
    try {
      const result = await confirmEmailChange(token);
      if (user) {
        setUser({
          ...user,
          email: result.email,
          emailVerifiedAt: new Date(),
        });
      }
      notifications.show({ message: t("Email changed successfully") });
      onClose();
    } catch (error) {
      const message = error?.response?.data?.message;
      notifications.show({
        message: message ? t(message) : t("Failed to change email"),
        color: "red",
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Stack gap="md">
      <Text>
        {t(
          "Confirm this change to start using the new email for future sign-ins.",
        )}
      </Text>
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose} disabled={isLoading}>
          {t("Cancel")}
        </Button>
        <Button onClick={handleConfirm} loading={isLoading}>
          {t("Confirm email change")}
        </Button>
      </Group>
    </Stack>
  );
}
