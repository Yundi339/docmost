import { Group, Stack, Text, Tooltip, Badge } from "@mantine/core";
import { CustomAvatar } from "@/components/ui/custom-avatar";
import { IPageVisitor } from "@/features/page-visitors/types/page-visitor.types";
import { useTranslation } from "react-i18next";
import { useTimeAgo } from "@/hooks/use-time-ago";
import { formattedDate } from "@/lib/time";

interface Props {
  visitor: IPageVisitor;
}

export default function VisitorItem({ visitor }: Props) {
  const { t } = useTranslation();
  const lastAgo = useTimeAgo(visitor.lastVisitedAt);
  const firstAgo = useTimeAgo(visitor.firstVisitedAt);

  // The user may have been hard-deleted; render a stub so the visit row
  // is still visible to the owner for audit purposes.
  const userName =
    visitor.user?.name ?? t("Deleted user");
  const isDeactivated = !!visitor.user?.deactivatedAt;
  const isDeleted = !visitor.user;

  return (
    <Group
      wrap="nowrap"
      align="center"
      px="md"
      py="sm"
      gap="md"
      style={{ borderBottom: "1px solid var(--mantine-color-gray-2)" }}
    >
      <CustomAvatar
        avatarUrl={visitor.user?.avatarUrl ?? undefined}
        name={userName}
        size="md"
      />
      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
        <Group gap="xs" wrap="nowrap">
          <Text fw={500} truncate>
            {userName}
          </Text>
          {isDeleted && (
            <Badge size="xs" color="gray" variant="light">
              {t("Deleted")}
            </Badge>
          )}
          {isDeactivated && (
            <Badge size="xs" color="orange" variant="light">
              {t("Deactivated")}
            </Badge>
          )}
        </Group>
        {visitor.user?.email && (
          <Text size="xs" c="dimmed" truncate>
            {visitor.user.email}
          </Text>
        )}
      </Stack>

      <Stack gap={2} align="flex-end" style={{ minWidth: 140 }}>
        <Tooltip label={formattedDate(new Date(visitor.lastVisitedAt))}>
          <Text size="sm">{t("Last visit: {{when}}", { when: lastAgo })}</Text>
        </Tooltip>
        <Tooltip label={formattedDate(new Date(visitor.firstVisitedAt))}>
          <Text size="xs" c="dimmed">
            {t("First visit: {{when}}", { when: firstAgo })}
          </Text>
        </Tooltip>
      </Stack>

      <Badge size="lg" variant="light">
        {visitor.visitCount} {t("visits")}
      </Badge>
    </Group>
  );
}
