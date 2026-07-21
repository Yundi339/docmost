import { Button, Group, Modal, Stack } from "@mantine/core";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { IOAuthAuthorization } from "@/ee/oauth";
import { useUpdateOAuthAuthorizationMutation } from "@/ee/oauth/queries/oauth-query";
import {
  isSpaceAccessSelectionValid,
  mergeSpaceAccessOptions,
  SpaceAccessSelector,
  toSpaceAccessInput,
  useSelectableSpaceOptionsQuery,
} from "@/ee/space-access";
import { SpaceAccessInput } from "@/ee/space-access/types/space-access.types";

interface UpdateOAuthAuthorizationModalProps {
  opened: boolean;
  onClose: () => void;
  authorization: IOAuthAuthorization | null;
}

export function UpdateOAuthAuthorizationModal({
  opened,
  onClose,
  authorization,
}: UpdateOAuthAuthorizationModalProps) {
  const { t } = useTranslation();
  const updateMutation = useUpdateOAuthAuthorizationMutation();
  const { data: selectableSpaces = [], isLoading } =
    useSelectableSpaceOptionsQuery({ enabled: opened });
  const [spaceAccess, setSpaceAccess] = useState<SpaceAccessInput>({
    mode: "all",
  });
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (opened && authorization) {
      setSpaceAccess(toSpaceAccessInput(authorization.spaceAccess));
      setError(undefined);
    }
  }, [opened, authorization]);

  const updateAccess = async () => {
    if (!authorization) {
      return;
    }
    if (!isSpaceAccessSelectionValid(spaceAccess)) {
      setError(t("Select at least one space."));
      return;
    }

    try {
      await updateMutation.mutateAsync({
        authorizationId: authorization.id,
        spaceAccess,
      });
      onClose();
    } catch (mutationError) {
      // The mutation displays the API error notification.
    }
  };

  const availableSpaces = mergeSpaceAccessOptions(
    selectableSpaces,
    authorization?.spaceAccess?.spaces,
  );

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("Edit space access")}
      size="md"
      closeButtonProps={{ "aria-label": t("Close") }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          updateAccess();
        }}
      >
        <Stack gap="md">
          <SpaceAccessSelector
            value={spaceAccess}
            onChange={(value) => {
              setSpaceAccess(value);
              setError(undefined);
            }}
            spaces={availableSpaces}
            loading={isLoading}
            error={error}
          />

          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onClose}>
              {t("Cancel")}
            </Button>
            <Button
              type="submit"
              loading={updateMutation.isPending}
              disabled={!isSpaceAccessSelectionValid(spaceAccess)}
            >
              {t("Update")}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
