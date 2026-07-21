import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Container,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconCheck, IconX } from "@tabler/icons-react";
import { Helmet } from "react-helmet-async";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getAppName } from "@/lib/config";
import {
  useApproveOAuthAuthorizationMutation,
  useDenyOAuthAuthorizationMutation,
  useOAuthAuthorizeInfoQuery,
} from "@/ee/oauth/queries/oauth-query";
import { OAuthScope } from "@/ee/oauth";
import {
  isSpaceAccessSelectionValid,
  mergeSpaceAccessOptions,
  SpaceAccessSelector,
  toSpaceAccessInput,
} from "@/ee/space-access";
import { SpaceAccessInput } from "@/ee/space-access/types/space-access.types";

export default function OAuthAuthorize() {
  const { t } = useTranslation();
  const location = useLocation();
  const query = useMemo(
    () => Object.fromEntries(new URLSearchParams(location.search).entries()),
    [location.search],
  );
  const hasRequest = Boolean(query.client_id && query.redirect_uri);
  const { data, isLoading, error } = useOAuthAuthorizeInfoQuery(query, {
    enabled: hasRequest,
  });
  const approveMutation = useApproveOAuthAuthorizationMutation();
  const denyMutation = useDenyOAuthAuthorizationMutation();
  const [spaceAccess, setSpaceAccess] = useState<SpaceAccessInput>({
    mode: "all",
  });
  const [spaceAccessError, setSpaceAccessError] = useState<string>();

  useEffect(() => {
    if (data) {
      setSpaceAccess(toSpaceAccessInput(data.spaceAccess));
      setSpaceAccessError(undefined);
    }
  }, [data]);

  const redirect = (response?: { redirectUri?: string }) => {
    if (response?.redirectUri) {
      window.location.href = response.redirectUri;
    }
  };

  const errorMessage =
    approveMutation.error?.["response"]?.data?.message ||
    error?.["response"]?.data?.message ||
    (!hasRequest ? t("Invalid OAuth authorization request.") : null);
  const availableSpaces = mergeSpaceAccessOptions(
    data?.availableSpaces,
    data?.spaceAccess?.spaces,
  );

  const approve = () => {
    if (!isSpaceAccessSelectionValid(spaceAccess)) {
      setSpaceAccessError(t("Select at least one space."));
      return;
    }

    approveMutation.mutate({ ...query, spaceAccess }, { onSuccess: redirect });
  };

  return (
    <>
      <Helmet>
        <title>
          {t("Authorize OAuth application")} - {getAppName()}
        </title>
      </Helmet>

      <Container size="sm" py="xl">
        <Paper withBorder radius="sm" p="lg">
          <Stack gap="md">
            <div>
              <Text size="sm" c="dimmed" fw={500}>
                {getAppName()}
              </Text>
              <Title order={1} size="h3">
                {data
                  ? t("Authorize {{clientName}}", {
                      clientName: data.clientName,
                    })
                  : t("Authorize OAuth application")}
              </Title>
            </div>

            {isLoading && (
              <Group justify="center" py="xl">
                <Loader size="sm" />
              </Group>
            )}

            {errorMessage && (
              <Alert
                variant="light"
                color="red"
                icon={<IconAlertCircle />}
                p="sm"
              >
                {errorMessage}
              </Alert>
            )}

            {data && (
              <>
                <div>
                  <Text size="sm" c="dimmed">
                    {t("Signed in as")}
                  </Text>
                  <Text fw={500}>{data.user.name || data.user.email}</Text>
                  <Text size="sm" c="dimmed">
                    {data.user.email}
                  </Text>
                </div>

                <SpaceAccessSelector
                  value={spaceAccess}
                  onChange={(value) => {
                    setSpaceAccess(value);
                    setSpaceAccessError(undefined);
                  }}
                  spaces={availableSpaces}
                  description={t(
                    "Choose which spaces this application can access.",
                  )}
                  error={spaceAccessError}
                />

                <div>
                  <Text size="sm" c="dimmed" mb={4}>
                    {t("Requested access")}
                  </Text>
                  <Group gap="xs">
                    {data.scopes.map((scope) => (
                      <Badge
                        key={scope}
                        variant="light"
                        color={scopeColor(scope)}
                      >
                        {t(scopeLabel(scope))}
                      </Badge>
                    ))}
                  </Group>
                </div>

                <div>
                  <Text size="sm" c="dimmed">
                    {t("Redirect host")}
                  </Text>
                  <Text size="sm" ff="monospace">
                    {data.redirectHost}
                  </Text>
                </div>

                <Group justify="flex-end" mt="sm">
                  <Button
                    variant="default"
                    leftSection={<IconX size={16} />}
                    loading={denyMutation.isPending}
                    disabled={approveMutation.isPending}
                    onClick={() =>
                      denyMutation.mutate(query, { onSuccess: redirect })
                    }
                  >
                    {t("Cancel")}
                  </Button>
                  <Button
                    leftSection={<IconCheck size={16} />}
                    loading={approveMutation.isPending}
                    disabled={
                      denyMutation.isPending ||
                      !isSpaceAccessSelectionValid(spaceAccess)
                    }
                    onClick={approve}
                  >
                    {t("Authorize")}
                  </Button>
                </Group>
              </>
            )}
          </Stack>
        </Paper>
      </Container>
    </>
  );
}

function scopeLabel(scope: OAuthScope) {
  if (scope === "mcp:destructive") return "Destructive MCP tools";
  if (scope === "mcp:write") return "MCP write";
  return "MCP read";
}

function scopeColor(scope: OAuthScope) {
  if (scope === "mcp:destructive") return "red";
  if (scope === "mcp:write") return "orange";
  return "blue";
}
