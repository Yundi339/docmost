import {
  Alert,
  Box,
  Grid,
  Group,
  Loader,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconBug,
  IconHistory,
  IconShieldCheck,
  IconSparkles,
  IconTool,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useUpdateLogQuery } from "@/features/system-status/queries/update-log-query";
import { UpdateLogChangeType } from "@/features/system-status/types/update-log.types";

const changeAppearance: Record<
  UpdateLogChangeType,
  { color: string; icon: typeof IconSparkles }
> = {
  added: { color: "blue", icon: IconSparkles },
  improved: { color: "cyan", icon: IconTool },
  fixed: { color: "green", icon: IconBug },
  security: { color: "orange", icon: IconShieldCheck },
};

function ChangeItem({ type, text }: { type: UpdateLogChangeType; text: string }) {
  const appearance = changeAppearance[type];
  const Icon = appearance.icon;

  return (
    <Group gap="sm" wrap="nowrap" align="flex-start">
      <ThemeIcon
        color={appearance.color}
        variant="light"
        size="sm"
        mt={2}
        aria-hidden
      >
        <Icon size={13} />
      </ThemeIcon>
      <Text size="sm" style={{ overflowWrap: "anywhere" }}>
        {text}
      </Text>
    </Group>
  );
}

export default function UpdateLog() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useUpdateLogQuery();

  return (
    <Box component="section" mt="xl" aria-labelledby="update-log-title">
      <Group gap="xs" mb="md">
        <IconHistory size={20} aria-hidden />
        <Title id="update-log-title" order={3} size="h4">
          {t("Update log")}
        </Title>
      </Group>

      {isLoading && <Loader size="sm" />}

      {isError && (
        <Alert
          color="yellow"
          icon={<IconAlertTriangle size={18} />}
          title={t("Update log is temporarily unavailable")}
        >
          {t("System status is not affected. Please try again later.")}
        </Alert>
      )}

      {data && data.releases.length === 0 && (
        <Text c="dimmed" size="sm">
          {t("No update records yet.")}
        </Text>
      )}

      {data && data.releases.length > 0 && (
        <Stack gap={0}>
          {data.releases.map((release) => (
            <Box
              key={release.version}
              py="lg"
              style={{
                borderTop: "1px solid var(--mantine-color-default-border)",
              }}
            >
              <Grid gutter={{ base: "xs", sm: "xl" }} align="flex-start">
                <Grid.Col span={{ base: 12, sm: 2 }}>
                  <Text size="sm" fw={600} c="dimmed">
                    {release.date}
                  </Text>
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 10 }}>
                  <Title
                    order={4}
                    size="h5"
                    mb="sm"
                    style={{ overflowWrap: "anywhere" }}
                  >
                    {release.title}
                  </Title>
                  <Stack gap="sm">
                    {release.changes.map((change, changeIndex) => (
                      <ChangeItem
                        key={`${change.type}-${changeIndex}`}
                        type={change.type}
                        text={change.text}
                      />
                    ))}
                  </Stack>
                </Grid.Col>
              </Grid>
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  );
}
