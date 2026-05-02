import { atomWithStorage } from "jotai/utils";

export const PAGE_WIDTH_MIN = 700;
export const PAGE_WIDTH_MAX = 1600;
export const PAGE_WIDTH_DEFAULT = 1100;
export const PAGE_FONT_SCALE_MIN = 85;
export const PAGE_FONT_SCALE_MAX = 130;
export const PAGE_FONT_SCALE_DEFAULT = 100;

// Custom page max width in px. Applied when fullPageWidth preference is off.
export const pageMaxWidthAtom = atomWithStorage<number>(
  "page-max-width",
  PAGE_WIDTH_DEFAULT,
);

export type PageAlign = "center" | "left";

// Horizontal alignment of the page content when narrower than viewport.
export const pageAlignAtom = atomWithStorage<PageAlign>(
  "page-align",
  "center",
);

export const pageFontScaleAtom = atomWithStorage<number>(
  "page-font-scale",
  PAGE_FONT_SCALE_DEFAULT,
);
