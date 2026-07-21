export type SpaceAccessMode = "all" | "selected";

export interface ISpaceAccessSpace {
  id: string;
  name: string;
  slug: string;
}

export type SpaceAccessInput =
  | { mode: "all" }
  | { mode: "selected"; spaceIds: string[] };

export interface ISpaceAccess {
  mode: SpaceAccessMode;
  spaces: ISpaceAccessSpace[];
  selectedCount: number;
  effectiveCount: number;
  status: "active" | "no_effective_spaces";
}
