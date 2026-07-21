import { Badge, Stack, Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { getSelectedSpaceCount } from "@/ee/space-access/lib/space-access";
import { ISpaceAccess } from "@/ee/space-access/types/space-access.types";

interface SpaceAccessSummaryProps {
  access?: ISpaceAccess | null;
  showStatus?: boolean;
}

export function SpaceAccessSummary({
  access,
  showStatus = true,
}: SpaceAccessSummaryProps) {
  const { t } = useTranslation();

  if (!access || access.mode === "all") {
    return (
      <Stack gap={2} align="flex-start">
        <Text fz="sm" fw={500}>
          {t("All spaces")}
        </Text>
        {showStatus && access?.status === "no_effective_spaces" && (
          <Badge variant="light" color="red" size="sm">
            {t("No effective spaces")}
          </Badge>
        )}
      </Stack>
    );
  }

  return (
    <Stack gap={2} align="flex-start">
      <Text fz="sm" fw={500}>
        {t("Selected spaces: {{count}}", {
          count: getSelectedSpaceCount(access),
        })}
      </Text>
      {access.spaces.length > 0 && (
        <Text fz="xs" c="dimmed" lineClamp={2}>
          {access.spaces.map((space) => space.name).join(", ")}
        </Text>
      )}
      {showStatus && access.status === "no_effective_spaces" && (
        <Badge variant="light" color="red" size="sm">
          {t("No effective spaces")}
        </Badge>
      )}
    </Stack>
  );
}
