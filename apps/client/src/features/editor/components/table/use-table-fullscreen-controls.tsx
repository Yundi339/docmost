import { RefObject, useEffect } from "react";
import { createRoot, Root } from "react-dom/client";
import { ActionIcon, Tooltip } from "@mantine/core";
import { IconArrowBackUp, IconMaximize } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

const TABLE_CONTROL_CLASS = "table-fullscreen-control-host";
const TABLE_FULLSCREEN_CLASS = "tableWrapperFullscreen";

function TableFullscreenButton({ table }: { table: HTMLElement }) {
  const { t } = useTranslation();
  const isFullscreen = table.classList.contains(TABLE_FULLSCREEN_CLASS);

  const toggleFullscreen = () => {
    table.classList.toggle(TABLE_FULLSCREEN_CLASS);
    document.body.classList.toggle(
      "table-fullscreen-open",
      table.classList.contains(TABLE_FULLSCREEN_CLASS),
    );
    table.dispatchEvent(new CustomEvent("table-fullscreen-toggle"));
  };

  return (
    <Tooltip
      label={isFullscreen ? t("Back") : t("Fullscreen")}
      position="left"
      withArrow
    >
      <ActionIcon
        variant="subtle"
        color="gray"
        size="sm"
        onClick={toggleFullscreen}
        aria-label={isFullscreen ? t("Back") : t("Fullscreen")}
      >
        {isFullscreen ? <IconArrowBackUp size={14} /> : <IconMaximize size={14} />}
      </ActionIcon>
    </Tooltip>
  );
}

export function useTableFullscreenControls(rootRef: RefObject<HTMLElement>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const roots = new Map<HTMLElement, Root>();

    const mountControls = () => {
      const tables = root.querySelectorAll<HTMLElement>(".tableWrapper");

      tables.forEach((table) => {
        if (table.querySelector(`.${TABLE_CONTROL_CLASS}`)) return;

        const host = document.createElement("div");
        host.className = TABLE_CONTROL_CLASS;
        host.contentEditable = "false";
        table.appendChild(host);

        const reactRoot = createRoot(host);
        const render = () => reactRoot.render(<TableFullscreenButton table={table} />);
        render();
        table.addEventListener("table-fullscreen-toggle", render);
        roots.set(table, reactRoot);
      });
    };

    mountControls();
    const observer = new MutationObserver(mountControls);
    observer.observe(root, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      roots.forEach((reactRoot, table) => {
        table.classList.remove(TABLE_FULLSCREEN_CLASS);
        document.body.classList.remove("table-fullscreen-open");
        reactRoot.unmount();
      });
      roots.clear();
    };
  }, [rootRef]);
}
