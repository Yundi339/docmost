import { MouseEvent, RefObject, useEffect } from "react";
import { createRoot, Root } from "react-dom/client";
import { ActionIcon, Tooltip } from "@mantine/core";
import { IconArrowBackUp, IconMaximize } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

const TABLE_CONTROL_CLASS = "table-fullscreen-control-host";
const TABLE_FULLSCREEN_CLASS = "tableWrapperFullscreen";
const TABLE_TOUCHED_CLASS = "tableWrapperTouched";

function TableFullscreenButton({ table }: { table: HTMLElement }) {
  const { t } = useTranslation();
  const isFullscreen = table.classList.contains(TABLE_FULLSCREEN_CLASS);

  const toggleFullscreen = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
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
        onPointerDown={(event) => event.stopPropagation()}
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
    const cleanupCallbacks: Array<() => void> = [];

    const mountControls = () => {
      const tables = root.querySelectorAll<HTMLElement>(".tableWrapper");

      tables.forEach((table) => {
        if (table.querySelector(`.${TABLE_CONTROL_CLASS}`)) return;

        const host = document.createElement("div");
        host.className = TABLE_CONTROL_CLASS;
        host.contentEditable = "false";
        const stopEvent = (event: Event) => event.stopPropagation();
        host.addEventListener("mousedown", stopEvent);
        host.addEventListener("touchstart", stopEvent);
        table.appendChild(host);

        let touchTimer: ReturnType<typeof setTimeout> | null = null;
        const showTouchControl = () => {
          table.classList.add(TABLE_TOUCHED_CLASS);
          if (touchTimer) clearTimeout(touchTimer);
          touchTimer = setTimeout(() => {
            if (!table.classList.contains(TABLE_FULLSCREEN_CLASS)) {
              table.classList.remove(TABLE_TOUCHED_CLASS);
            }
          }, 2500);
        };
        table.addEventListener("touchstart", showTouchControl, { passive: true });

        const reactRoot = createRoot(host);
        const render = () => reactRoot.render(<TableFullscreenButton table={table} />);
        render();
        table.addEventListener("table-fullscreen-toggle", render);
        roots.set(table, reactRoot);
        cleanupCallbacks.push(() => {
          if (touchTimer) clearTimeout(touchTimer);
          host.removeEventListener("mousedown", stopEvent);
          host.removeEventListener("touchstart", stopEvent);
          table.removeEventListener("touchstart", showTouchControl);
          table.removeEventListener("table-fullscreen-toggle", render);
        });
      });
    };

    mountControls();
    const observer = new MutationObserver(mountControls);
    observer.observe(root, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      cleanupCallbacks.forEach((cleanup) => cleanup());
      roots.forEach((reactRoot, table) => {
        table.classList.remove(TABLE_FULLSCREEN_CLASS);
        table.classList.remove(TABLE_TOUCHED_CLASS);
        document.body.classList.remove("table-fullscreen-open");
        reactRoot.unmount();
      });
      roots.clear();
    };
  }, [rootRef]);
}
