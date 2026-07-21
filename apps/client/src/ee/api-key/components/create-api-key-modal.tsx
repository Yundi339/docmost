import { lazy, Suspense, useEffect, useState } from "react";
import { Modal, TextInput, Button, Group, Stack, Select } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useTranslation } from "react-i18next";
import { useCreateApiKeyMutation } from "@/ee/api-key/queries/api-key-query";
import { IconCalendar } from "@tabler/icons-react";
import { IApiKey } from "@/ee/api-key";
import {
  buildApiKeyCreateRequest,
  getDefaultApiKeyScopes,
  getApiKeyConfigurationError,
} from "@/ee/api-key/lib/api-key-scopes";
import { ApiKeyScope, ApiKeyType } from "@/ee/api-key/types/api-key.types";
import { ApiKeyScopeSelector } from "@/ee/api-key/components/api-key-scope-selector";
import {
  SpaceAccessSelector,
  useSelectableSpaceOptionsQuery,
} from "@/ee/space-access";
import { SpaceAccessInput } from "@/ee/space-access/types/space-access.types";
import { useAtomValue } from "jotai";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom";
import { resolveMcpMode } from "@/features/workspace/lib/mcp-mode";

const DateInput = lazy(() =>
  import("@mantine/dates").then((module) => ({
    default: module.DateInput,
  })),
);

interface CreateApiKeyModalProps {
  opened: boolean;
  onClose: () => void;
  onSuccess: (response: IApiKey) => void;
  keyType: ApiKeyType;
}

interface FormValues {
  name: string;
  expiresAt: string;
}
type ExpirationOption = "30" | "60" | "90" | "365" | "custom";

function addDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

function toEndOfDayIso(value?: string) {
  if (!value) return null;

  let date: Date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    date = new Date(year, month - 1, day);
  } else {
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) return null;

  date.setHours(23, 59, 59, 999);
  return date.toISOString();
}

export function CreateApiKeyModal({
  opened,
  onClose,
  onSuccess,
  keyType,
}: CreateApiKeyModalProps) {
  const { t, i18n } = useTranslation();
  const [expirationOption, setExpirationOption] =
    useState<ExpirationOption>("30");
  const [scopes, setScopes] = useState<ApiKeyScope[]>(
    getDefaultApiKeyScopes(keyType),
  );
  const [spaceAccess, setSpaceAccess] = useState<SpaceAccessInput>({
    mode: "all",
  });
  const [spaceAccessError, setSpaceAccessError] = useState<string>();
  const [scopeError, setScopeError] = useState<string>();
  const createApiKeyMutation = useCreateApiKeyMutation();
  const workspace = useAtomValue(workspaceAtom);
  const mcpMode = resolveMcpMode(workspace?.settings?.ai);
  const allowWrite = keyType !== "mcp" || mcpMode === "read-write";
  const { data: availableSpaces = [], isLoading: spacesLoading } =
    useSelectableSpaceOptionsQuery({ enabled: opened && keyType === "mcp" });

  useEffect(() => {
    if (!opened) {
      setScopes(getDefaultApiKeyScopes(keyType));
      setSpaceAccess({ mode: "all" });
    } else if (!allowWrite) {
      setScopes(getDefaultApiKeyScopes(keyType));
    }
  }, [allowWrite, keyType, opened]);

  const form = useForm<FormValues>({
    validate: {
      name: (value) => (value.trim() ? null : t("Name is required")),
    },
    initialValues: {
      name: "",
      expiresAt: "",
    },
  });

  const getExpirationDate = (): string | null => {
    if (expirationOption === "custom") {
      return toEndOfDayIso(form.values.expiresAt);
    }
    const days = parseInt(expirationOption);
    return addDays(days).toISOString();
  };

  const getExpirationLabel = (days: number) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    const formatted = date.toLocaleDateString(i18n.language, {
      month: "short",
      day: "2-digit",
      year: "numeric",
    });
    return t("{{count}} days ({{date}})", { count: days, date: formatted });
  };

  const expirationOptions = [
    { value: "30", label: getExpirationLabel(30) },
    { value: "60", label: getExpirationLabel(60) },
    { value: "90", label: getExpirationLabel(90) },
    { value: "365", label: getExpirationLabel(365) },
    { value: "custom", label: t("Custom") },
  ];

  const handleSubmit = async (data: FormValues) => {
    const expiresAt = getExpirationDate();
    if (!expiresAt) {
      form.setFieldError("expiresAt", t("Expiration date is required"));
      return;
    }

    const configurationError = getApiKeyConfigurationError(
      keyType,
      scopes,
      spaceAccess,
    );
    if (configurationError === "missing_space") {
      setSpaceAccessError(t("Select at least one space."));
      return;
    }
    if (configurationError === "missing_scope") {
      setScopeError(t("Select at least one scope."));
      return;
    }
    if (
      configurationError === "invalid_scope" ||
      configurationError === "rest_space_access"
    ) {
      setScopeError(t("The selected access is invalid for this API key type."));
      return;
    }

    const apiKeyData = buildApiKeyCreateRequest({
      name: data.name,
      expiresAt,
      keyType,
      scopes,
      spaceAccess,
    });

    try {
      const createdKey = await createApiKeyMutation.mutateAsync(apiKeyData);
      onSuccess(createdKey);
      resetFields();
      onClose();
    } catch (error) {
      // The mutation displays the API error notification.
    }
  };

  const resetFields = () => {
    form.reset();
    setExpirationOption("30");
    setScopes(getDefaultApiKeyScopes(keyType));
    setSpaceAccess({ mode: "all" });
    setSpaceAccessError(undefined);
    setScopeError(undefined);
  };

  const handleClose = () => {
    resetFields();
    onClose();
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={t(keyType === "rest" ? "Create REST API key" : "Create MCP key")}
      size="md"
      closeButtonProps={{ "aria-label": t("Close") }}
    >
      <form onSubmit={form.onSubmit((values) => handleSubmit(values))}>
        <Stack gap="md">
          <TextInput
            label={t("Name")}
            placeholder={t("Enter a descriptive name")}
            data-autofocus
            required
            {...form.getInputProps("name")}
          />

          {keyType === "mcp" && (
            <SpaceAccessSelector
              value={spaceAccess}
              onChange={(value) => {
                setSpaceAccess(value);
                setSpaceAccessError(undefined);
              }}
              spaces={availableSpaces}
              loading={spacesLoading}
              error={spaceAccessError}
            />
          )}

          <ApiKeyScopeSelector
            keyType={keyType}
            scopes={scopes}
            allowWrite={allowWrite}
            error={scopeError}
            onChange={(value) => {
              setScopes(value);
              setScopeError(undefined);
            }}
          />

          <Select
            label={t("Expiration")}
            data={expirationOptions}
            value={expirationOption}
            onChange={(value) =>
              setExpirationOption((value as ExpirationOption) || "30")
            }
            leftSection={<IconCalendar size={16} />}
            allowDeselect={false}
          />

          {expirationOption === "custom" && (
            <Suspense fallback={null}>
              <DateInput
                label={t("Custom expiration date")}
                placeholder={t("Select expiration date")}
                minDate={addDays(1)}
                required
                {...form.getInputProps("expiresAt")}
              />
            </Suspense>
          )}

          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={handleClose}>
              {t("Cancel")}
            </Button>
            <Button type="submit" loading={createApiKeyMutation.isPending}>
              {t("Create")}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
