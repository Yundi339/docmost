import api from "@/lib/api-client";
import type { ISpaceAccessSpace } from "@/ee/space-access/types/space-access.types";

export async function getSelectableSpaceOptions(): Promise<
  ISpaceAccessSpace[]
> {
  const req = await api.post<ISpaceAccessSpace[]>("/api-keys/spaces", {});
  return req.data;
}
