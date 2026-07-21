import { Button, Group, Modal, Stack, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { IApiKey } from "@/ee/api-key";
import { ApiKeyScopeSelector } from "@/ee/api-key/components/api-key-scope-selector";
import {
  getDefaultApiKeyScopes,
  getApiKeyConfigurationError,
  restrictApiKeyScopesToType,
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

interface FormValues {
  name: string;
}

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
    useSelectableSpaceOptionsQuery({
      enabled: opened && !nameOnly && apiKey?.keyType === "mcp",
    });
  const [scopes, setScopes] = useState<ApiKeyScope[]>([]);
  const [spaceAccess, setSpaceAccess] = useState<SpaceAccessInput>({
    mode: "all",
  });
  const [spaceAccessError, setSpaceAccessError] = useState<string>();
  const [scopeError, setScopeError] = useState<string>();

  const form = useForm<FormValues>({
    validate: {
      name: (value) => (value.trim() ? null : t("Name is required")),
    },
    initialValues: {
      name: "",
    },
  });

  useEffect(() => {
    if (!opened || !apiKey) {
      return;
    }

    const nextSpaceAccess =
      apiKey.keyType === "rest"
        ? ({ mode: "all" } as const)
        : toSpaceAccessInput(apiKey.spaceAccess);
    const nextScopes = restrictApiKeyScopesToType(
      apiKey.keyType,
      apiKey.scopes || getDefaultApiKeyScopes(apiKey.keyType),
    );

    form.setValues({ name: apiKey.name });
    setSpaceAccess(nextSpaceAccess);
    setScopes(nextScopes);
    setSpaceAccessError(undefined);
    setScopeError(undefined);
  }, [opened, apiKey]);

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

    const configurationError = getApiKeyConfigurationError(
      apiKey.keyType,
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
              {apiKey?.keyType === "mcp" && (
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

              {apiKey && (
                <ApiKeyScopeSelector
                  keyType={apiKey.keyType}
                  scopes={scopes}
                  error={scopeError}
                  onChange={(value) => {
                    setScopes(value);
                    setScopeError(undefined);
                  }}
                />
              )}
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
