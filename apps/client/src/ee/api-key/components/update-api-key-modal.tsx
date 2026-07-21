import { Button, Group, Modal, Stack, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { zod4Resolver } from "mantine-form-zod-resolver";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod/v4";
import { IApiKey } from "@/ee/api-key";
import { ApiKeyScopeSelector } from "@/ee/api-key/components/api-key-scope-selector";
import {
  getApiKeyConfigurationError,
  getApiKeyScopePresetValue,
  resolveApiKeyScopes,
  restrictApiKeyScopesToMcp,
} from "@/ee/api-key/lib/api-key-scopes";
import { useUpdateApiKeyMutation } from "@/ee/api-key/queries/api-key-query";
import { ApiKeyScope } from "@/ee/api-key/types/api-key.types";
import { buildApiKeyUpdateRequest } from "@/ee/api-key/lib/api-key-update";
import {
  mergeSpaceAccessOptions,
  SpaceAccessSelector,
  toSpaceAccessInput,
  useSelectableSpaceOptionsQuery,
} from "@/ee/space-access";
import { SpaceAccessInput } from "@/ee/space-access/types/space-access.types";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
});
type FormValues = z.infer<typeof formSchema>;

interface UpdateApiKeyModalProps {
  opened: boolean;
  onClose: () => void;
  apiKey: IApiKey | null;
  nameOnly?: boolean;
}

export function UpdateApiKeyModal({
  opened,
  onClose,
  apiKey,
  nameOnly = false,
}: UpdateApiKeyModalProps) {
  const { t } = useTranslation();
  const updateApiKeyMutation = useUpdateApiKeyMutation();
  const { data: selectableSpaces = [], isLoading: spacesLoading } =
    useSelectableSpaceOptionsQuery({ enabled: opened && !nameOnly });
  const [scopePreset, setScopePreset] = useState("full");
  const [customScopes, setCustomScopes] = useState<ApiKeyScope[]>([]);
  const [spaceAccess, setSpaceAccess] = useState<SpaceAccessInput>({
    mode: "all",
  });
  const [spaceAccessError, setSpaceAccessError] = useState<string>();
  const [scopeError, setScopeError] = useState<string>();

  const form = useForm<FormValues>({
    validate: zod4Resolver(formSchema),
    initialValues: {
      name: "",
    },
  });

  useEffect(() => {
    if (!opened || !apiKey) {
      return;
    }

    const nextSpaceAccess = toSpaceAccessInput(apiKey.spaceAccess);
    const nextScopes =
      nextSpaceAccess.mode === "selected"
        ? restrictApiKeyScopesToMcp(apiKey.scopes || [])
        : apiKey.scopes || [];

    form.setValues({ name: apiKey.name });
    setSpaceAccess(nextSpaceAccess);
    setCustomScopes(nextScopes);
    setScopePreset(getApiKeyScopePresetValue(nextScopes));
    setSpaceAccessError(undefined);
    setScopeError(undefined);
  }, [opened, apiKey]);

  const getScopes = () => resolveApiKeyScopes(scopePreset, customScopes);

  const handleSpaceAccessChange = (value: SpaceAccessInput) => {
    setSpaceAccess(value);
    setSpaceAccessError(undefined);
    setScopeError(undefined);

    if (value.mode === "selected") {
      const mcpScopes = restrictApiKeyScopesToMcp(getScopes());
      setCustomScopes(mcpScopes);
      setScopePreset(getApiKeyScopePresetValue(mcpScopes));
    }
  };

  const handleSubmit = async (data: FormValues) => {
    if (!apiKey) {
      return;
    }

    if (nameOnly) {
      try {
        await updateApiKeyMutation.mutateAsync({
          ...buildApiKeyUpdateRequest({
            apiKeyId: apiKey.id,
            name: data.name,
            nameOnly: true,
          }),
        });
        onClose();
      } catch (error) {
        // The mutation displays the API error notification.
      }
      return;
    }

    const scopes = getScopes();
    const configurationError = getApiKeyConfigurationError(scopes, spaceAccess);
    if (configurationError === "missing_space") {
      setSpaceAccessError(t("Select at least one space."));
      return;
    }
    if (configurationError === "missing_scope") {
      setScopeError(t("Select at least one scope."));
      return;
    }
    if (configurationError === "rest_scope_with_selected_spaces") {
      setScopeError(
        t(
          "REST scopes cannot be used when access is limited to specific spaces.",
        ),
      );
      return;
    }

    try {
      await updateApiKeyMutation.mutateAsync(
        buildApiKeyUpdateRequest({
          apiKeyId: apiKey.id,
          name: data.name,
          scopes,
          spaceAccess,
        }),
      );
      onClose();
    } catch (error) {
      // The mutation displays the API error notification.
    }
  };

  const availableSpaces = mergeSpaceAccessOptions(
    selectableSpaces,
    apiKey?.spaceAccess?.spaces,
  );

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("Update API key")}
      size={nameOnly ? "md" : "lg"}
      closeButtonProps={{ "aria-label": t("Close") }}
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="md">
          <TextInput
            label={t("Name")}
            placeholder={t("Enter a descriptive token name")}
            required
            {...form.getInputProps("name")}
          />

          {!nameOnly && (
            <>
              <SpaceAccessSelector
                value={spaceAccess}
                onChange={handleSpaceAccessChange}
                spaces={availableSpaces}
                loading={spacesLoading}
                error={spaceAccessError}
              />

              <ApiKeyScopeSelector
                scopePreset={scopePreset}
                customScopes={customScopes}
                mcpOnly={spaceAccess.mode === "selected"}
                error={scopeError}
                onScopePresetChange={(value) => {
                  setScopePreset(value);
                  setScopeError(undefined);
                }}
                onCustomScopesChange={(value) => {
                  setCustomScopes(value);
                  setScopeError(undefined);
                }}
              />
            </>
          )}

          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onClose}>
              {t("Cancel")}
            </Button>
            <Button type="submit" loading={updateApiKeyMutation.isPending}>
              {t("Update")}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
