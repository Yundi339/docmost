import { FC } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { Button, Menu } from "@mantine/core";
import {
  IconBlockquote,
  IconBraces,
  IconChevronDown,
  IconH1,
  IconH2,
  IconH3,
  IconH4,
  IconH5,
  IconH6,
  IconMenu4,
  IconPageBreak,
  IconTypography,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

interface Props {
  editor: Editor;
}

export const BlockTypeGroup: FC<Props> = ({ editor }) => {
  const { t } = useTranslation();

  const state = useEditorState({
    editor,
    selector: (ctx) => ({
      isHeading1: ctx.editor.isActive("heading", { level: 1 }),
      isHeading2: ctx.editor.isActive("heading", { level: 2 }),
      isHeading3: ctx.editor.isActive("heading", { level: 3 }),
      isHeading4: ctx.editor.isActive("heading", { level: 4 }),
      isHeading5: ctx.editor.isActive("heading", { level: 5 }),
      isHeading6: ctx.editor.isActive("heading", { level: 6 }),
      isBlockquote: ctx.editor.isActive("blockquote"),
      isCodeBlock: ctx.editor.isActive("codeBlock"),
    }),
  });

  let label = t("Normal text");
  if (state.isHeading1) label = t("Heading 1");
  else if (state.isHeading2) label = t("Heading 2");
  else if (state.isHeading3) label = t("Heading 3");
  else if (state.isHeading4) label = t("Heading 4");
  else if (state.isHeading5) label = t("Heading 5");
  else if (state.isHeading6) label = t("Heading 6");
  else if (state.isBlockquote) label = t("Quote");
  else if (state.isCodeBlock) label = t("Code block");

  return (
    <Menu shadow="md" position="bottom-start" withArrow={false}>
      <Menu.Target>
        <Button
          variant="subtle"
          color="dark"
          size="xs"
          rightSection={<IconChevronDown size={14} />}
        >
          {label}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          leftSection={<IconTypography size={16} />}
          onClick={() =>
            editor.chain().focus().toggleNode("paragraph", "paragraph").run()
          }
        >
          {t("Text")}
        </Menu.Item>
        <Menu.Item
          leftSection={<IconH1 size={16} />}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 1 }).run()
          }
        >
          {t("Heading 1")}
        </Menu.Item>
        <Menu.Item
          leftSection={<IconH2 size={16} />}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
        >
          {t("Heading 2")}
        </Menu.Item>
        <Menu.Item
          leftSection={<IconH3 size={16} />}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 3 }).run()
          }
        >
          {t("Heading 3")}
        </Menu.Item>
        <Menu.Item
          leftSection={<IconH4 size={16} />}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 4 }).run()
          }
        >
          {t("Heading 4")}
        </Menu.Item>
        <Menu.Item
          leftSection={<IconH5 size={16} />}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 5 }).run()
          }
        >
          {t("Heading 5")}
        </Menu.Item>
        <Menu.Item
          leftSection={<IconH6 size={16} />}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 6 }).run()
          }
        >
          {t("Heading 6")}
        </Menu.Item>
        <Menu.Item
          leftSection={<IconBlockquote size={16} />}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          {t("Quote")}
        </Menu.Item>
        <Menu.Item
          leftSection={<IconBraces size={16} />}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          {t("Code block")}
        </Menu.Item>
        <Menu.Item
          leftSection={<IconMenu4 size={16} />}
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        >
          {t("Divider")}
        </Menu.Item>
        <Menu.Item
          leftSection={<IconPageBreak size={16} />}
          onClick={() => editor.chain().focus().setPageBreak().run()}
        >
          {t("Page break")}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
};
