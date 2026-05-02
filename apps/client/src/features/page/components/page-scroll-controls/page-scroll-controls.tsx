import { ActionIcon, Paper, Tooltip } from "@mantine/core";
import { IconArrowDown, IconArrowUp } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import classes from "./page-scroll-controls.module.css";

type Position = {
  x: number;
  y: number;
};

const STORAGE_KEY = "page-scroll-controls-position";
const DEFAULT_POSITION: Position = { x: 24, y: 24 };
const EDGE_PADDING = 8;
const CLICK_DRAG_THRESHOLD = 5;

function clampPosition(position: Position, element?: HTMLElement | null) {
  if (typeof window === "undefined") return position;

  const width = element?.offsetWidth ?? 48;
  const height = element?.offsetHeight ?? 96;

  return {
    x: Math.min(
      Math.max(position.x, EDGE_PADDING),
      Math.max(EDGE_PADDING, window.innerWidth - width - EDGE_PADDING),
    ),
    y: Math.min(
      Math.max(position.y, EDGE_PADDING),
      Math.max(EDGE_PADDING, window.innerHeight - height - EDGE_PADDING),
    ),
  };
}

function getInitialPosition(): Position {
  if (typeof window === "undefined") return DEFAULT_POSITION;

  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (!saved) return DEFAULT_POSITION;

  try {
    const parsed = JSON.parse(saved) as Position;
    return clampPosition(parsed);
  } catch {
    return DEFAULT_POSITION;
  }
}

export default function PageScrollControls() {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    dragged: boolean;
  } | null>(null);
  const [position, setPosition] = useState<Position>(getInitialPosition);

  useEffect(() => {
    const handleResize = () => {
      setPosition((current) => clampPosition(current, ref.current));
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
  }, [position]);

  const scrollTo = useCallback((top: number) => {
    window.scrollTo({ top, behavior: "smooth" });
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button")) return;

    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
      dragged: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleButtonPointerDown = (event: React.PointerEvent) => {
    event.stopPropagation();
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    if (
      Math.abs(deltaX) > CLICK_DRAG_THRESHOLD ||
      Math.abs(deltaY) > CLICK_DRAG_THRESHOLD
    ) {
      dragState.dragged = true;
    }

    if (!dragState.dragged) return;

    setPosition(
      clampPosition(
        {
          x: dragState.originX - deltaX,
          y: dragState.originY - deltaY,
        },
        ref.current,
      ),
    );
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    event.currentTarget.releasePointerCapture(event.pointerId);
    window.setTimeout(() => {
      dragStateRef.current = null;
    }, 0);
  };

  const preventClickAfterDrag = (event: React.MouseEvent) => {
    if (dragStateRef.current?.dragged) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  return (
    <Paper
      ref={ref}
      shadow="md"
      radius="md"
      withBorder
      className={classes.controls}
      style={{ right: position.x, bottom: position.y }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      aria-label={t("Page scroll controls")}
    >
      <Tooltip label={t("Back to top")} position="left" withArrow>
        <ActionIcon
          variant="subtle"
          color="dark"
          onPointerDown={handleButtonPointerDown}
          onClick={(event) => {
            preventClickAfterDrag(event);
            if (!event.defaultPrevented) scrollTo(0);
          }}
          aria-label={t("Back to top")}
        >
          <IconArrowUp size={18} />
        </ActionIcon>
      </Tooltip>

      <Tooltip label={t("Go to bottom")} position="left" withArrow>
        <ActionIcon
          variant="subtle"
          color="dark"
          onPointerDown={handleButtonPointerDown}
          onClick={(event) => {
            preventClickAfterDrag(event);
            if (!event.defaultPrevented) {
              scrollTo(
                Math.max(
                  document.documentElement.scrollHeight,
                  document.body.scrollHeight,
                ),
              );
            }
          }}
          aria-label={t("Go to bottom")}
        >
          <IconArrowDown size={18} />
        </ActionIcon>
      </Tooltip>
    </Paper>
  );
}
