import {
  Modal,
  Button,
  Group,
  Text,
  Switch,
  Divider,
  Progress,
  Select,
} from "@mantine/core";
import { exportPage } from "@/features/page/services/page-service.ts";
import { useState } from "react";
import { ExportFormat } from "@/features/page/types/page.types.ts";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";

interface BulkExportModalProps {
  pageIds: string[];
  open: boolean;
  onClose: () => void;
}

export default function BulkExportModal({
  pageIds,
  open,
  onClose,
}: BulkExportModalProps) {
  const [format, setFormat] = useState<ExportFormat>(ExportFormat.Markdown);
  const [includeChildren, setIncludeChildren] = useState<boolean>(true);
  const [includeAttachments, setIncludeAttachments] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const { t } = useTranslation();

  const handleExport = async () => {
    if (pageIds.length === 0) return;
    setIsExporting(true);
    setProgress(0);
    let failed = 0;
    for (let i = 0; i < pageIds.length; i++) {
      try {
        await exportPage({
          pageId: pageIds[i],
          format,
          includeChildren,
          includeAttachments,
        });
      } catch (err) {
        failed++;
        console.error("Bulk export failed for", pageIds[i], err);
      }
      setProgress(((i + 1) / pageIds.length) * 100);
    }
    setIsExporting(false);
    if (failed > 0) {
      notifications.show({
        message: t("{{ok}} exported, {{failed}} failed", {
          ok: pageIds.length - failed,
          failed,
        }),
        color: "orange",
      });
    } else {
      notifications.show({ message: t("Export successful") });
    }
    onClose();
  };

  return (
    <Modal.Root
      opened={open}
      onClose={onClose}
      size={500}
      padding="xl"
      yOffset="10vh"
      xOffset={0}
      mah={400}
      onClick={(e) => e.stopPropagation()}
    >
      <Modal.Overlay />
      <Modal.Content style={{ overflow: "hidden" }}>
        <Modal.Header py={0}>
          <Modal.Title fw={500}>
            {t("Export {{count}} pages", { count: pageIds.length })}
          </Modal.Title>
          <Modal.CloseButton />
        </Modal.Header>
        <Modal.Body>
          <Group justify="space-between" wrap="nowrap">
            <Text size="md">{t("Format")}</Text>
            <Select
              data={[
                { value: "markdown", label: "Markdown" },
                { value: "html", label: "HTML" },
              ]}
              defaultValue={format}
              onChange={(v) => setFormat(v as ExportFormat)}
              styles={{ wrapper: { maxWidth: 120 } }}
              comboboxProps={{ width: "120" }}
              allowDeselect={false}
              withCheckIcon={false}
              aria-label={t("Select export format")}
            />
          </Group>

          <Divider my="sm" />

          <Group justify="space-between" wrap="nowrap">
            <Text size="md">{t("Include subpages")}</Text>
            <Switch
              onChange={(e) => setIncludeChildren(e.currentTarget.checked)}
              checked={includeChildren}
            />
          </Group>

          <Group justify="space-between" wrap="nowrap" mt="md">
            <Text size="md">{t("Include attachments")}</Text>
            <Switch
              onChange={(e) => setIncludeAttachments(e.currentTarget.checked)}
              checked={includeAttachments}
            />
          </Group>

          {isExporting && (
            <Progress value={progress} mt="md" size="sm" animated />
          )}

          <Group justify="end" mt="md">
            <Button onClick={onClose} variant="default" disabled={isExporting}>
              {t("Cancel")}
            </Button>
            <Button onClick={handleExport} loading={isExporting}>
              {t("Export")}
            </Button>
          </Group>
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}
