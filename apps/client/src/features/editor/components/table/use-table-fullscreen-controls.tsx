import { MouseEvent, useCallback, useEffect, useRef, useState } from "react";
import { createRoot, Root } from "react-dom/client";
import { ActionIcon, Tooltip } from "@mantine/core";
import {
  IconArrowBackUp,
  IconMaximize,
  IconMinimize,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

const TABLE_CONTROL_CLASS = "table-fullscreen-control-host";
const TABLE_FULLSCREEN_CLASS = "tableWrapperFullscreen";
const TABLE_TOUCHED_CLASS = "tableWrapperTouched";
const BODY_OPEN_CLASS = "table-fullscreen-open";

function TableFullscreenButton({ table }: { table: HTMLElement }) {
  const { t } = useTranslation();
  // UI-level state (toolbar appearance: maximize ↔ back/minimize).
  const [isFullscreen, setIsFullscreen] = useState(false);
  // True only when CSS fallback is in use (native fullscreen unsupported
  // or rejected). Native fullscreen relies on browser :fullscreen styling.
  const [cssFullscreen, setCssFullscreen] = useState(false);
  const nativeFullscreenRef = useRef(false);

  // Toggle CSS-fallback class on the wrapper when needed.
  useEffect(() => {
    table.classList.toggle(TABLE_FULLSCREEN_CLASS, cssFullscreen);
    document.body.classList.toggle(BODY_OPEN_CLASS, cssFullscreen);
  }, [cssFullscreen, table]);

  const cleanupFullscreen = useCallback(() => {
    setIsFullscreen(false);
    setCssFullscreen(false);
    nativeFullscreenRef.current = false;
    (screen.orientation as any)?.unlock?.();
  }, []);

  const exitFullscreen = useCallback(() => {
    if (nativeFullscreenRef.current && document.fullscreenElement) {
      // The fullscreenchange handler runs cleanup once exit completes.
      document.exitFullscreen().catch(() => {
        cleanupFullscreen();
      });
      return;
    }
    cleanupFullscreen();
  }, [cleanupFullscreen]);

  const enterFullscreen = useCallback(async () => {
    // Priority path: native fullscreen + lock orientation to landscape.
    if (table.requestFullscreen) {
      try {
        await table.requestFullscreen();
        nativeFullscreenRef.current = true;
        setIsFullscreen(true);
        try {
          await (screen.orientation as any)?.lock?.("landscape");
        } catch {
          // Orientation lock unsupported (iOS Safari, desktop) — leave
          // current orientation. User can rotate device manually.
        }
        return;
      } catch {
        nativeFullscreenRef.current = false;
      }
    }

    // CSS fallback (no Fullscreen API support).
    setIsFullscreen(true);
    setCssFullscreen(true);
  }, [table]);

  const toggleFullscreen = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (isFullscreen) exitFullscreen();
      else void enterFullscreen();
    },
    [enterFullscreen, exitFullscreen, isFullscreen],
  );

  // Sync state when user exits native fullscreen via Esc / browser UI.
  useEffect(() => {
    const onChange = () => {
      const stillNative = document.fullscreenElement === table;
      if (!stillNative && nativeFullscreenRef.current) {
        cleanupFullscreen();
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [cleanupFullscreen, table]);

  // Esc to exit (CSS fallback path only — native handles its own Esc).
  useEffect(() => {
    if (!cssFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitFullscreen();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [cssFullscreen, exitFullscreen]);

  return (
    <>
      {isFullscreen && (
        <Tooltip label={t("Back")} position="bottom" withArrow>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={toggleFullscreen}
            aria-label={t("Back")}
          >
            <IconArrowBackUp size={14} />
          </ActionIcon>
        </Tooltip>
      )}

      <Tooltip
        label={isFullscreen ? t("Exit fullscreen") : t("Fullscreen")}
        position={isFullscreen ? "bottom" : "left"}
        withArrow
      >
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? t("Exit fullscreen") : t("Fullscreen")}
        >
          {isFullscreen ? <IconMinimize size={14} /> : <IconMaximize size={14} />}
        </ActionIcon>
      </Tooltip>
    </>
  );
}

export function useTableFullscreenControls(root: HTMLElement | null) {
  useEffect(() => {
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
        reactRoot.render(<TableFullscreenButton table={table} />);
        roots.set(table, reactRoot);
        cleanupCallbacks.push(() => {
          if (touchTimer) clearTimeout(touchTimer);
          host.removeEventListener("mousedown", stopEvent);
          host.removeEventListener("touchstart", stopEvent);
          table.removeEventListener("touchstart", showTouchControl);
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
        document.body.classList.remove(BODY_OPEN_CLASS);
        reactRoot.unmount();
      });
      roots.clear();
    };
  }, [root]);
}
