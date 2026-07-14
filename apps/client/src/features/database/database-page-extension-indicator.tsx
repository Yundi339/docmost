import { Tooltip } from "@mantine/core";
import { IconLayoutKanban, IconListCheck } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import type { PageExtensionRendererProps } from "@/features/page/tree/extensions/page-extension-registry";

export function DatabasePageExtensionIndicator({
  extension,
}: PageExtensionRendererProps) {
  const { t } = useTranslation();
  const isHost = extension.role === "host";
  const label = isHost ? t("Board page") : t("Board work item");
  const Icon = isHost ? IconLayoutKanban : IconListCheck;

  return (
    <Tooltip label={label} withArrow openDelay={300}>
      <span
        aria-label={label}
        style={{
          alignItems: "center",
          color: "var(--mantine-color-dimmed)",
          display: "inline-flex",
          flexShrink: 0,
          height: 18,
          justifyContent: "center",
          width: 18,
        }}
      >
        <Icon size={14} stroke={1.8} />
      </span>
    </Tooltip>
  );
}
