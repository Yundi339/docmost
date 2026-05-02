import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActionIcon, Tooltip, Text } from "@mantine/core";
import {
  IconMinus,
  IconPlus,
  IconMaximize,
  IconMinimize,
  IconFocusCentered,
  IconArrowBackUp,
  IconRotateClockwise,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import classes from "./zoomable-svg.module.css";
import clsx from "clsx";

interface ZoomableSvgProps {
  children: React.ReactNode;
}

const MIN_SCALE = 0.3;
const MAX_SCALE = 5;
const ZOOM_STEP = 0.15;
type Rotation = 0 | 90 | 180 | 270;

export default function ZoomableSvg({ children }: ZoomableSvgProps) {
  const { t } = useTranslation();
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const nativeFullscreenRef = useRef(false);
  const [scale, setScale] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rotation, setRotation] = useState<Rotation>(0);
  const [showHint, setShowHint] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const dragStartRef = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });
  const touchRef = useRef<{
    startDist: number;
    startScale: number;
    centerX: number;
    centerY: number;
    startOffsetX: number;
    startOffsetY: number;
    isSingleFinger: boolean;
    startX: number;
    startY: number;
  } | null>(null);

  const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

  const getRotatedBounds = useCallback(
    (width: number, height: number, value: Rotation) => {
      switch (value) {
        case 90:
          return { width: height, height: width, minX: -height, minY: 0 };
        case 180:
          return { width, height, minX: -width, minY: -height };
        case 270:
          return { width: height, height: width, minX: 0, minY: -width };
        default:
          return { width, height, minX: 0, minY: 0 };
      }
    },
    [],
  );

  const measureSvg = useCallback(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    const svg = content?.querySelector("svg") as SVGSVGElement | null;
    if (!viewport || !svg) return null;

    svg.style.maxWidth = "none";
    svg.style.height = "auto";
    const prevTransform = svg.style.transform;
    svg.style.transform = "none";
    const viewportRect = viewport.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    svg.style.transform = prevTransform;

    if (!svgRect.width || !svgRect.height || !viewportRect.width || !viewportRect.height) {
      return null;
    }

    return {
      viewportWidth: viewportRect.width,
      viewportHeight: viewportRect.height,
      svgWidth: svgRect.width,
      svgHeight: svgRect.height,
    };
  }, []);

  const fitToViewport = useCallback(
    (nextRotation: Rotation) => {
      const measurement = measureSvg();
      if (!measurement) {
        setScale(1);
        setOffsetX(0);
        setOffsetY(0);
        return false;
      }

      const bounds = getRotatedBounds(
        measurement.svgWidth,
        measurement.svgHeight,
        nextRotation,
      );
      const fit = Math.min(
        measurement.viewportWidth / bounds.width,
        measurement.viewportHeight / bounds.height,
      );
      const nextScale = clampScale(fit);
      setScale(nextScale);
      setOffsetX(
        (measurement.viewportWidth - bounds.width * nextScale) / 2 -
          bounds.minX * nextScale,
      );
      setOffsetY(
        (measurement.viewportHeight - bounds.height * nextScale) / 2 -
          bounds.minY * nextScale,
      );
      return true;
    },
    [getRotatedBounds, measureSvg],
  );

  const applyTransform = useCallback(() => {
    // Apply transform directly to the SVG element (not the wrapper), so its
    // layout is independent of parent max-width/flex constraints.
    const svg = contentRef.current?.querySelector(
      "svg",
    ) as SVGSVGElement | null;
    if (svg) {
      svg.style.transformOrigin = "0 0";
      svg.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale}) rotate(${rotation}deg)`;
    }
  }, [scale, offsetX, offsetY, rotation]);

  useLayoutEffect(() => {
    applyTransform();
  }, [applyTransform]);

  // Auto-fit SVG to viewport after initial mount / when children (SVG) render.
  // useLayoutEffect so the initial fit is computed before the browser paints,
  // avoiding a flash of unscaled SVG.
  const didAutoFitRef = useRef(false);
  const userZoomedRef = useRef(false);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    let cancelled = false;
    const tryFit = (attempt = 0) => {
      if (cancelled) return;
      const svg = content.querySelector("svg") as SVGSVGElement | null;
      if (!svg) {
        if (attempt < 20) setTimeout(() => tryFit(attempt + 1), 50);
        return;
      }
      const measurement = measureSvg();
      if (!measurement) {
        if (attempt < 20) setTimeout(() => tryFit(attempt + 1), 50);
        return;
      }
      fitToViewport(0);
      didAutoFitRef.current = true;
    };
    tryFit();

    // Re-fit when viewport size changes (e.g. page width slider), unless the
    // user has manually zoomed.
    const ro = new ResizeObserver(() => {
      if (userZoomedRef.current) return;
      tryFit();
    });
    ro.observe(viewport);

    // Watch for SVG replacements (mermaid re-renders the SVG via
    // dangerouslySetInnerHTML on content changes, which resets inline
    // max-width and breaks our fit). Observe the direct wrapper of the SVG
    // for childList changes; re-fetch the wrapper each time because it
    // may not exist at the moment this effect runs.
    const mo = new MutationObserver(() => {
      if (userZoomedRef.current) return;
      didAutoFitRef.current = false;
      tryFit();
    });
    const attachMo = () => {
      const svg = content.querySelector("svg");
      const wrapper = svg?.parentElement;
      if (wrapper) {
        mo.observe(wrapper, { childList: true });
        // Run fit once the wrapper exists (in case tryFit missed it during
        // its polling window).
        if (!didAutoFitRef.current) tryFit();
        return true;
      }
      return false;
    };
    if (!attachMo()) {
      // Retry until SVG is present, then attach observer
      const t = setInterval(() => {
        if (attachMo()) clearInterval(t);
      }, 100);
      setTimeout(() => clearInterval(t), 3000);
    }

    return () => {
      cancelled = true;
      ro.disconnect();
      mo.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToViewport, measureSvg]);

  // Show "Click to zoom with scroll" hint when user scrolls without focus or Ctrl
  const flashHint = useCallback(() => {
    setShowHint(true);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    hintTimerRef.current = setTimeout(() => setShowHint(false), 1500);
  }, []);

  // Click outside to un-focus
  useEffect(() => {
    if (!isFocused) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsFocused(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isFocused]);

  // Native wheel listener (need { passive: false } to preventDefault)
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleWheel = (e: WheelEvent) => {
      // Zoom when: Ctrl/Meta held, OR the viewport is focused (clicked)
      if (!e.ctrlKey && !e.metaKey && !isFocused) {
        // Let the page scroll normally; show hint
        flashHint();
        return;
      }

      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const direction = e.deltaY < 0 ? 1 : -1;
      const newScale = clampScale(scale * (1 + direction * ZOOM_STEP));
      const scaleRatio = newScale / scale;

      userZoomedRef.current = true;
      setScale(newScale);
      setOffsetX(mouseX - (mouseX - offsetX) * scaleRatio);
      setOffsetY(mouseY - (mouseY - offsetY) * scaleRatio);
    };

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, [scale, offsetX, offsetY, flashHint, isFocused]);

  // Mouse drag start
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      setIsDragging(true);
      dragStartRef.current = { x: e.clientX, y: e.clientY, offsetX, offsetY };
    },
    [offsetX, offsetY],
  );

  // Mouse drag move & end
  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      userZoomedRef.current = true;
      setOffsetX(dragStartRef.current.offsetX + e.clientX - dragStartRef.current.x);
      setOffsetY(dragStartRef.current.offsetY + e.clientY - dragStartRef.current.y);
    };
    const handleMouseUp = () => setIsDragging(false);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  // Touch gestures
  // - Two-finger pinch: always zoom
  // - Single finger drag: only pan when zoomed in (scale != 1) to preserve page scrolling
  const getTouchDistance = (t1: Touch, t2: Touch) =>
    Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const offsetRef = useRef({ x: offsetX, y: offsetY });
  offsetRef.current = { x: offsetX, y: offsetY };

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const d = getTouchDistance(e.touches[0], e.touches[1]);
        const rect = viewport.getBoundingClientRect();
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
        touchRef.current = {
          startDist: d,
          startScale: scaleRef.current,
          centerX: cx,
          centerY: cy,
          startOffsetX: offsetRef.current.x,
          startOffsetY: offsetRef.current.y,
          isSingleFinger: false,
          startX: 0,
          startY: 0,
        };
      } else if (e.touches.length === 1) {
        // Always allow single-finger pan (touch-action: none prevents browser scroll)
        e.preventDefault();
        touchRef.current = {
          startDist: 0,
          startScale: scaleRef.current,
          centerX: 0,
          centerY: 0,
          startOffsetX: offsetRef.current.x,
          startOffsetY: offsetRef.current.y,
          isSingleFinger: true,
          startX: e.touches[0].clientX,
          startY: e.touches[0].clientY,
        };
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!touchRef.current) return;
      e.preventDefault();

      if (e.touches.length === 2 && !touchRef.current.isSingleFinger) {
        const d = getTouchDistance(e.touches[0], e.touches[1]);
        const ratio = d / touchRef.current.startDist;
        const newScale = clampScale(touchRef.current.startScale * ratio);
        const { centerX, centerY, startOffsetX, startOffsetY, startScale } =
          touchRef.current;
        const scaleRatio = newScale / startScale;
        userZoomedRef.current = true;
        setScale(newScale);
        setOffsetX(centerX - (centerX - startOffsetX) * scaleRatio);
        setOffsetY(centerY - (centerY - startOffsetY) * scaleRatio);
      } else if (e.touches.length === 1 && touchRef.current.isSingleFinger) {
        const dx = e.touches[0].clientX - touchRef.current.startX;
        const dy = e.touches[0].clientY - touchRef.current.startY;
        userZoomedRef.current = true;
        setOffsetX(touchRef.current.startOffsetX + dx);
        setOffsetY(touchRef.current.startOffsetY + dy);
      }
    };

    const handleTouchEnd = () => {
      touchRef.current = null;
    };

    viewport.addEventListener("touchstart", handleTouchStart, { passive: false });
    viewport.addEventListener("touchmove", handleTouchMove, { passive: false });
    viewport.addEventListener("touchend", handleTouchEnd);
    return () => {
      viewport.removeEventListener("touchstart", handleTouchStart);
      viewport.removeEventListener("touchmove", handleTouchMove);
      viewport.removeEventListener("touchend", handleTouchEnd);
    };
  }, [isFullscreen, scale, offsetX, offsetY]);

  // Button zoom (center-based)
  const zoomFromCenter = useCallback(
    (direction: 1 | -1) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const newScale = clampScale(scale * (1 + direction * ZOOM_STEP));
      const scaleRatio = newScale / scale;
      userZoomedRef.current = true;
      setScale(newScale);
      setOffsetX(cx - (cx - offsetX) * scaleRatio);
      setOffsetY(cy - (cy - offsetY) * scaleRatio);
    },
    [scale, offsetX, offsetY],
  );

  const resetView = useCallback(() => {
    userZoomedRef.current = false;
    fitToViewport(rotation);
  }, [fitToViewport, rotation]);

  const rotateView = useCallback(() => {
    userZoomedRef.current = true;
    setRotation((value) => {
      const nextRotation = ((value + 90) % 360) as Rotation;
      requestAnimationFrame(() => fitToViewport(nextRotation));
      return nextRotation;
    });
  }, [fitToViewport]);

  const stopToolbarPointer = useCallback((event: React.PointerEvent) => {
    event.stopPropagation();
  }, []);

  const exitFullscreen = useCallback(() => {
    setRotation(0);
    setIsFullscreen(false);
    requestAnimationFrame(() => fitToViewport(0));

    if (nativeFullscreenRef.current && document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    nativeFullscreenRef.current = false;
    (screen.orientation as any)?.unlock?.();
  }, [fitToViewport]);

  const enterFullscreen = useCallback(() => {
    const wrapper = wrapperRef.current;
    setIsFullscreen(true);
    requestAnimationFrame(() => fitToViewport(rotation));

    if (!wrapper?.requestFullscreen) return;

    wrapper
      .requestFullscreen()
      .then(() => {
        nativeFullscreenRef.current = true;
        return (screen.orientation as any)?.lock?.("landscape");
      })
      .catch(() => {
        nativeFullscreenRef.current = false;
      });
  }, [fitToViewport, rotation]);

  const toggleFullscreen = useCallback(() => {
    if (isFullscreen) {
      exitFullscreen();
    } else {
      enterFullscreen();
    }
  }, [enterFullscreen, exitFullscreen, isFullscreen]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isNativeFullscreen = document.fullscreenElement === wrapperRef.current;
      nativeFullscreenRef.current = isNativeFullscreen;
      if (!isNativeFullscreen && isFullscreen) {
        setRotation(0);
        setIsFullscreen(false);
        requestAnimationFrame(() => fitToViewport(0));
        (screen.orientation as any)?.unlock?.();
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [fitToViewport, isFullscreen]);

  // Lock body scroll while either native fullscreen or CSS fallback is active.
  useEffect(() => {
    if (isFullscreen) {
      document.body.style.overflow = "hidden";
      const handleEsc = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          exitFullscreen();
        }
      };
      document.addEventListener("keydown", handleEsc);
      return () => {
        document.body.style.overflow = "";
        (screen.orientation as any)?.unlock?.();
        document.removeEventListener("keydown", handleEsc);
      };
    } else {
      document.body.style.overflow = "";
    }
  }, [exitFullscreen, isFullscreen]);

  return (
    <div
      ref={wrapperRef}
      className={clsx(classes.wrapper, isFullscreen && classes.fullscreenContainer)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className={clsx(
          classes.toolbar,
          (isHovered || isFullscreen) && classes.toolbarVisible,
        )}
        onPointerDown={stopToolbarPointer}
        onMouseDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
      >
        {isFullscreen && (
          <Tooltip label={t("Back")} position="bottom" withArrow>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                exitFullscreen();
              }}
              aria-label={t("Back")}
            >
              <IconArrowBackUp size={14} />
            </ActionIcon>
          </Tooltip>
        )}

        <Tooltip label={t("Zoom out")} position="bottom" withArrow>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              zoomFromCenter(-1);
            }}
          >
            <IconMinus size={14} />
          </ActionIcon>
        </Tooltip>

        <span className={classes.zoomLabel}>{Math.round(scale * 100)}%</span>

        <Tooltip label={t("Zoom in")} position="bottom" withArrow>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              zoomFromCenter(1);
            }}
          >
            <IconPlus size={14} />
          </ActionIcon>
        </Tooltip>

        <Tooltip label={t("Reset")} position="bottom" withArrow>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              resetView();
            }}
          >
            <IconFocusCentered size={14} />
          </ActionIcon>
        </Tooltip>

        {isFullscreen && (
          <Tooltip label={t("Rotate")} position="bottom" withArrow>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                rotateView();
              }}
              aria-label={t("Rotate")}
            >
              <IconRotateClockwise size={14} />
            </ActionIcon>
          </Tooltip>
        )}

        <Tooltip
          label={isFullscreen ? t("Exit fullscreen") : t("Fullscreen")}
          position="bottom"
          withArrow
        >
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              toggleFullscreen();
            }}
          >
            {isFullscreen ? (
              <IconMinimize size={14} />
            ) : (
              <IconMaximize size={14} />
            )}
          </ActionIcon>
        </Tooltip>
      </div>

      <div
        ref={viewportRef}
        className={clsx(classes.viewport, isFocused && classes.viewportFocused)}
        onMouseDown={(e) => {
          setIsFocused(true);
          handleMouseDown(e);
        }}
      >
        <div ref={contentRef} className={classes.content}>
          {children}
        </div>
        {showHint && (
          <div className={classes.hint}>
            <Text size="xs">{t("Click to enable scroll zoom")}</Text>
          </div>
        )}
      </div>
    </div>
  );
}
