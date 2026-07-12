import { atomWithStorage } from "jotai/utils";

export const spaceHomeTabAtom = atomWithStorage<string>(
  "space-home-tab",
  "recent",
);
