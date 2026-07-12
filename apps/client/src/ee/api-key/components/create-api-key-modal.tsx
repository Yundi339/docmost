import { lazy, Suspense, useState } from "react";
import {
  Modal,
  TextInput,
  Button,
  Group,
  Stack,
  Select,
  MultiSelect,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { zod4Resolver } from "mantine-form-zod-resolver";
import { z } from "zod/v4";
import { useTranslation } from "react-i18next";
import { useCreateApiKeyMutation } from "@/ee/api-key/queries/api-key-query";
import { IconCalendar } from "@tabler/icons-react";
import { IApiKey } from "@/ee/api-key";
import { API_KEY_SCOPE_PRESETS } from "@/ee/api-key/lib/api-key-scopes";
import { ApiKeyScope } from "@/ee/api-key/types/api-key.types";

const DateInput = lazy(() =>
  import("@mantine/dates").then((module) => ({
    default: module.DateInput,
  })),
);

interface CreateApiKeyModalProps {
  opened: boolean;
  onClose: () => void;
  onSuccess: (response: IApiKey) => void;
}

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  expiresAt: z.string().optional(),
});
type FormValues = z.infer<typeof formSchema>;
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
}: CreateApiKeyModalProps) {
  const { t, i18n } = useTranslation();
  const [expirationOption, setExpirationOption] =
    useState<ExpirationOption>("30");
  const [scopePreset, setScopePreset] = useState<string>("full");
  const [customScopes, setCustomScopes] = useState<ApiKeyScope[]>([
    "rest:read",
    "rest:write",
  ]);
  const createApiKeyMutation = useCreateApiKeyMutation();

  const form = useForm<FormValues>({
    validate: zod4Resolver(formSchema),
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
    return `${days} days (${formatted})`;
  };

  const expirationOptions = [
    { value: "30", label: getExpirationLabel(30) },
    { value: "60", label: getExpirationLabel(60) },
    { value: "90", label: getExpirationLabel(90) },
    { value: "365", label: getExpirationLabel(365) },
    { value: "custom", label: t("Custom") },
  ];

  const scopePresetOptions = API_KEY_SCOPE_PRESETS.map((preset) => ({
    value: preset.value,
    label: t(preset.label),
  }));

  const scopeOptions = [
    { value: "rest:read", label: "rest:read" },
    { value: "rest:write", label: "rest:write" },
    { value: "mcp:read", label: "mcp:read" },
    { value: "mcp:write", label: "mcp:write" },
    { value: "mcp:destructive", label: "mcp:destructive" },
  ];

  const getScopes = (): ApiKeyScope[] => {
    if (scopePreset === "custom") {
      return customScopes;
    }

    return (
      API_KEY_SCOPE_PRESETS.find((preset) => preset.value === scopePreset)
        ?.scopes || []
    );
  };

  const handleSubmit = async (data: FormValues) => {
    const expiresAt = getExpirationDate();
    if (!expiresAt) {
      form.setFieldError("expiresAt", "Expiration date is required");
      return;
    }

    const groupData = {
      name: data.name,
      expiresAt,
      scopes: getScopes(),
    };

    try {
      const createdKey = await createApiKeyMutation.mutateAsync(groupData);
      onSuccess(createdKey);
      form.reset();
      onClose();
    } catch (err) {
      //
    }
  };

  const handleClose = () => {
    form.reset();
    setExpirationOption("30");
    setScopePreset("full");
    setCustomScopes(["rest:read", "rest:write"]);
    onClose();
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={t("Create API Key")}
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

          <Select
            label={t("Usage type")}
            data={scopePresetOptions}
            value={scopePreset}
            onChange={(value) => setScopePreset(value || "full")}
            allowDeselect={false}
          />

          {scopePreset === "custom" && (
            <MultiSelect
              label={t("Scopes")}
              data={scopeOptions}
              value={customScopes}
              onChange={(value) => setCustomScopes(value as ApiKeyScope[])}
              required
            />
          )}

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
