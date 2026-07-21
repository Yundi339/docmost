import {
  ISpaceAccess,
  ISpaceAccessSpace,
  SpaceAccessInput,
} from "@/ee/space-access/types/space-access.types";

export function toSpaceAccessInput(
  access?: ISpaceAccess | SpaceAccessInput | null,
): SpaceAccessInput {
  if (access?.mode !== "selected") {
    return { mode: "all" };
  }

  const spaceIds =
    "spaceIds" in access
      ? access.spaceIds
      : access.spaces.map((space) => space.id);

  return { mode: "selected", spaceIds: [...new Set(spaceIds)] };
}

export function isSpaceAccessSelectionValid(access: SpaceAccessInput) {
  return access.mode === "all" || access.spaceIds.length > 0;
}

export function mergeSpaceAccessOptions(
  ...spaceGroups: Array<readonly ISpaceAccessSpace[] | null | undefined>
): ISpaceAccessSpace[] {
  const spacesById = new Map<string, ISpaceAccessSpace>();

  for (const spaces of spaceGroups) {
    for (const space of spaces || []) {
      if (!spacesById.has(space.id)) {
        spacesById.set(space.id, space);
      }
    }
  }

  return [...spacesById.values()];
}

export function getSelectedSpaceCount(access?: ISpaceAccess | null) {
  if (!access || access.mode === "all") {
    return 0;
  }

  return access.selectedCount ?? access.spaces.length;
}
