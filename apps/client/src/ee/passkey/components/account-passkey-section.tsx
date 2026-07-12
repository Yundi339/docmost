import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Menu,
  Modal,
  PasswordInput,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  VisuallyHidden,
} from "@mantine/core";
import {
  IconDots,
  IconEdit,
  IconFingerprint,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { formattedDate } from "@/lib/time";
import {
  PASSKEY_LIST_QUERY_KEY,
  usePasskeysQuery,
} from "@/ee/passkey/queries/passkey-query";
import {
  deletePasskey,
  getPasskeyRegistrationOptions,
  renamePasskey,
  verifyPasskeyRegistration,
} from "@/ee/passkey/services/passkey-service";
import { PasskeyItem } from "@/ee/passkey/types/passkey.types";
import {
  abortPasskeyCeremony,
  browserSupportsPasskeys,
  isPasskeyCancellation,
  startPasskeyRegistration,
  suggestedPasskeyName,
} from "@/ee/passkey/lib/passkey-browser";
import useCurrentUser from "@/features/user/hooks/use-current-user";

export function AccountPasskeySection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: currentUser } = useCurrentUser();
  const { data: passkeys, isLoading } = usePasskeysQuery();
  const [createOpened, createModal] = useDisclosure(false);
  const [editOpened, editModal] = useDisclosure(false);
  const [deleteOpened, deleteModal] = useDisclosure(false);
  const [selected, setSelected] = useState<PasskeyItem | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const supported = useMemo(browserSupportsPasskeys, []);
  const canManage = Boolean(
    currentUser &&
    !currentUser.workspace.enforceSso &&
    !currentUser.user.hasGeneratedPassword,
  );

  useEffect(() => abortPasskeyCeremony, []);

  function openCreate() {
    setName(suggestedPasskeyName());
    setPassword("");
    createModal.open();
  }

  function closeCreate() {
    abortPasskeyCeremony();
    createModal.close();
  }

  function openEdit(passkey: PasskeyItem) {
    setSelected(passkey);
    setName(passkey.name);
    editModal.open();
  }

  function openDelete(passkey: PasskeyItem) {
    setSelected(passkey);
    setPassword("");
    deleteModal.open();
  }

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: PASSKEY_LIST_QUERY_KEY });
  }

  async function create() {
    if (!name.trim() || password.length < 8) return;
    setSubmitting(true);
    try {
      const ceremony = await getPasskeyRegistrationOptions({
        currentPassword: password,
      });
      const credential = await startPasskeyRegistration(ceremony.options);
      await verifyPasskeyRegistration({
        challengeId: ceremony.challengeId,
        name: name.trim(),
        credential,
      });
      await refresh();
      createModal.close();
      notifications.show({ message: t("Passkey added") });
    } catch (error) {
      if (!isPasskeyCancellation(error))
        showError(error, t, "Unable to add passkey");
    } finally {
      setSubmitting(false);
    }
  }

  async function update() {
    if (!selected || !name.trim()) return;
    setSubmitting(true);
    try {
      await renamePasskey({ passkeyId: selected.id, name: name.trim() });
      await refresh();
      editModal.close();
      notifications.show({ message: t("Passkey renamed") });
    } catch (error) {
      showError(error, t, "Unable to rename passkey");
    } finally {
      setSubmitting(false);
    }
  }

  async function remove() {
    if (!selected || password.length < 8) return;
    setSubmitting(true);
    try {
      await deletePasskey({
        passkeyId: selected.id,
        currentPassword: password,
      });
      await refresh();
      deleteModal.close();
      notifications.show({ message: t("Passkey deleted") });
    } catch (error) {
      showError(error, t, "Unable to delete passkey");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start" gap="md">
        <div style={{ minWidth: 0, flex: 1 }}>
          <Text size="md">{t("Passkeys")}</Text>
          <Text size="sm" c="dimmed">
            {!canManage
              ? t("A local password is required to manage passkeys.")
              : supported
                ? t("Use your device screen lock to sign in securely.")
                : t(
                    "Passkeys are not supported in this browser or connection.",
                  )}
          </Text>
        </div>
        <Button
          variant="default"
          leftSection={<IconPlus size={16} />}
          disabled={!supported || !canManage || (passkeys?.length ?? 0) >= 10}
          onClick={openCreate}
          style={{ whiteSpace: "nowrap" }}
        >
          {t("Add passkey")}
        </Button>
      </Group>

      {isLoading ? (
        <Stack gap="sm">
          <Skeleton height={42} />
          <Skeleton height={42} />
        </Stack>
      ) : passkeys?.length ? (
        <Table.ScrollContainer minWidth={620}>
          <Table verticalSpacing="sm">
            <Table.Caption>
              <VisuallyHidden>{t("Passkeys")}</VisuallyHidden>
            </Table.Caption>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t("Name")}</Table.Th>
                <Table.Th>{t("Created")}</Table.Th>
                <Table.Th>{t("Last used")}</Table.Th>
                <Table.Th>
                  <VisuallyHidden>{t("Action")}</VisuallyHidden>
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {passkeys.map((passkey) => (
                <Table.Tr key={passkey.id}>
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <IconFingerprint size={18} />
                      <div>
                        <Text
                          size="sm"
                          style={{ overflowWrap: "anywhere", maxWidth: 220 }}
                        >
                          {passkey.name}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {passkey.backedUp
                            ? t("Synced passkey")
                            : t("Device passkey")}
                        </Text>
                      </div>
                      {passkey.disabled && (
                        <Badge size="xs" color="red" variant="light">
                          {t("Disabled")}
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">
                      {formattedDate(new Date(passkey.createdAt))}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">
                      {passkey.lastUsedAt
                        ? formattedDate(new Date(passkey.lastUsedAt))
                        : t("Never")}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Menu position="bottom-end" withinPortal>
                      <Menu.Target>
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          aria-label={t("Passkey actions for {{name}}", {
                            name: passkey.name,
                          })}
                        >
                          <IconDots size={18} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item
                          leftSection={<IconEdit size={16} />}
                          onClick={() => openEdit(passkey)}
                        >
                          {t("Rename")}
                        </Menu.Item>
                        {canManage && (
                          <Menu.Item
                            color="red"
                            leftSection={<IconTrash size={16} />}
                            onClick={() => openDelete(passkey)}
                          >
                            {t("Delete")}
                          </Menu.Item>
                        )}
                      </Menu.Dropdown>
                    </Menu>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      ) : (
        <Text size="sm" c="dimmed">
          {t("No passkeys added")}
        </Text>
      )}

      <Modal
        opened={createOpened}
        onClose={closeCreate}
        title={t("Add passkey")}
        centered
      >
        <Stack>
          <TextInput
            label={t("Passkey name")}
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.currentTarget.value)}
            data-autofocus
          />
          <PasswordInput
            label={t("Current password")}
            value={password}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button
              onClick={create}
              loading={submitting}
              disabled={!name.trim() || password.length < 8}
            >
              {t("Add passkey")}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={editOpened}
        onClose={editModal.close}
        title={t("Rename passkey")}
        centered
      >
        <Stack>
          <TextInput
            label={t("Passkey name")}
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.currentTarget.value)}
            data-autofocus
          />
          <Group justify="flex-end">
            <Button
              onClick={update}
              loading={submitting}
              disabled={!name.trim()}
            >
              {t("Save")}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={deleteOpened}
        onClose={deleteModal.close}
        title={t("Delete passkey")}
        centered
      >
        <Stack>
          <Text size="sm">
            {t(
              "This passkey will no longer be able to sign in to your account.",
            )}
          </Text>
          <PasswordInput
            label={t("Current password")}
            value={password}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.currentTarget.value)}
            data-autofocus
          />
          <Group justify="flex-end">
            <Button
              color="red"
              onClick={remove}
              loading={submitting}
              disabled={password.length < 8}
            >
              {t("Delete passkey")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

function showError(
  error: unknown,
  t: (key: string) => string,
  fallback: string,
) {
  notifications.show({
    message: error?.["response"]?.data?.message || t(fallback),
    color: "red",
  });
}
