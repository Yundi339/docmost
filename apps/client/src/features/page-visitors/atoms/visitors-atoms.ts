import { atom } from "jotai";

// Open / close state for the Visitor Records modal (owner-only).
export const visitorsModalAtom = atom<boolean>(false);
