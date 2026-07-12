import { useCallback, useEffect, useState } from "react";
import { Editor } from "@tiptap/react";
import {
  ActionIcon,
  Button,
  Group,
  Paper,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { IconTextCaption } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import {
  IMAGE_CAPTION_MAX_LENGTH,
  sanitizeImageCaption,
} from "@docmost/editor-ext";

type UseImageCaptionControlArgs = {
  editor: Editor;
  currentCaption: string;
};

export function useImageCaptionControl({
  editor,
  currentCaption,
}: UseImageCaptionControlArgs) {
  const { t } = useTranslation();
  const [showInput, setShowInput] = useState(false);
  const [draft, setDraft] = useState("");

  const open = useCallback(() => {
    setDraft(currentCaption || "");
    setShowInput(true);
  }, [currentCaption]);

  useEffect(() => {
    const handler = () => {
      if (!editor.isActive("image")) setShowInput(false);
    };
    editor.on("selectionUpdate", handler);
    return () => {
      editor.off("selectionUpdate", handler);
    };
  }, [editor]);

  const cancel = useCallback(() => setShowInput(false), []);
  const save = useCallback(() => {
    editor
      .chain()
      .focus(undefined, { scrollIntoView: false })
      .setImageCaption(sanitizeImageCaption(draft) || undefined)
      .run();
    setShowInput(false);
  }, [draft, editor]);

  const button = (
    <Tooltip position="top" label={t("Image caption")} withinPortal={false}>
      <ActionIcon
        onClick={open}
        size="lg"
        aria-label={t("Image caption")}
        variant="subtle"
      >
        <IconTextCaption size={18} />
      </ActionIcon>
    </Tooltip>
  );

  const panel = showInput ? (
    <Paper
      withBorder
      shadow="md"
      radius={6}
      p="sm"
      w={320}
      style={{ position: "relative", zIndex: 100 }}
    >
      <Text size="sm" fw={600} mb={2}>
        {t("Image caption")}
      </Text>
      <Text size="xs" c="dimmed" mb="xs">
        {t("Add context displayed below the image.")}
      </Text>
      <TextInput
        size="xs"
        placeholder={t("Add a caption")}
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            save();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          }
        }}
        autoFocus
        maxLength={IMAGE_CAPTION_MAX_LENGTH}
      />
      <Group justify="space-between" align="center" mt="xs" wrap="nowrap">
        <Text size="xs" c="dimmed">
          {draft.length}/{IMAGE_CAPTION_MAX_LENGTH}
        </Text>
        <Group gap="xs">
          <Button size="compact-xs" variant="default" onClick={cancel}>
            {t("Cancel")}
          </Button>
          <Button size="compact-xs" onClick={save}>
            {t("Save")}
          </Button>
        </Group>
      </Group>
    </Paper>
  ) : null;

  return { button, panel, isEditing: showInput };
}
