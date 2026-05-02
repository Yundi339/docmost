import { Modal, Button, Group, Text, Progress } from "@mantine/core";
import { movePageToSpace } from "@/features/page/services/page-service.ts";
import { useState } from "react";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import { ISpace } from "@/features/space/types/space.types.ts";
import { queryClient } from "@/main.tsx";
import { SpaceSelect } from "@/features/space/components/sidebar/space-select.tsx";

interface BulkMovePageModalProps {
  pageIds: string[];
  currentSpaceSlug: string;
  open: boolean;
  onClose: () => void;
  onMoved?: () => void;
}

export default function BulkMovePageModal({
  pageIds,
  currentSpaceSlug,
  open,
  onClose,
  onMoved,
}: BulkMovePageModalProps) {
  const { t } = useTranslation();
  const [targetSpace, setTargetSpace] = useState<ISpace>(null);
  const [isMoving, setIsMoving] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleMove = async () => {
    if (!targetSpace || pageIds.length === 0) return;

    setIsMoving(true);
    setProgress(0);
    let failed = 0;
    for (let i = 0; i < pageIds.length; i++) {
      try {
        await movePageToSpace({
          pageId: pageIds[i],
          spaceId: targetSpace.id,
        });
      } catch (err) {
        failed++;
        console.error("Bulk move failed for", pageIds[i], err);
      }
      setProgress(((i + 1) / pageIds.length) * 100);
    }

    queryClient.removeQueries({
      predicate: (item) =>
        ["pages", "sidebar-pages", "root-sidebar-pages"].includes(
          item.queryKey[0] as string,
        ),
    });

    setIsMoving(false);
    if (failed > 0) {
      notifications.show({
        message: t("{{ok}} moved, {{failed}} failed", {
          ok: pageIds.length - failed,
          failed,
        }),
        color: "orange",
      });
    } else {
      notifications.show({ message: t("Pages moved successfully") });
    }

    onMoved?.();
    onClose();
    setTargetSpace(null);
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
            {t("Move {{count}} pages", { count: pageIds.length })}
          </Modal.Title>
          <Modal.CloseButton />
        </Modal.Header>
        <Modal.Body>
          <Text mb="xs" c="dimmed" size="sm">
            {t("Move selected pages to a different space.")}
          </Text>

          <SpaceSelect
            value={currentSpaceSlug}
            clearable={false}
            onChange={setTargetSpace}
          />

          {isMoving && (
            <Progress value={progress} mt="md" size="sm" animated />
          )}

          <Group justify="end" mt="md">
            <Button onClick={onClose} variant="default" disabled={isMoving}>
              {t("Cancel")}
            </Button>
            <Button onClick={handleMove} loading={isMoving} disabled={!targetSpace}>
              {t("Move")}
            </Button>
          </Group>
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}
