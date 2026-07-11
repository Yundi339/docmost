export type UpdateLogChangeType =
  | "added"
  | "improved"
  | "fixed"
  | "security";

export interface IUpdateLogChange {
  type: UpdateLogChangeType;
  text: string;
}

export interface IUpdateLogRelease {
  version: string;
  date: string;
  title: string;
  changes: IUpdateLogChange[];
}

export interface IUpdateLog {
  schemaVersion: 1;
  updatedAt: string;
  releases: IUpdateLogRelease[];
}
