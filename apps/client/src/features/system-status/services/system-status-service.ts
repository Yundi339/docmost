import api from "@/lib/api-client";
import { ISystemStatus } from "@/features/system-status/types/system-status.types";

export async function getSystemStatus(): Promise<ISystemStatus> {
  const req = await api.post<ISystemStatus>("/system-status");
  return req.data;
}
