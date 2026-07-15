import api from "@/lib/api-client";
import {
  ISystemDiagnosticDataSourceList,
  ISystemStatus,
} from "@/features/system-status/types/system-status.types";

export async function getSystemStatus(): Promise<ISystemStatus> {
  const req = await api.post<ISystemStatus>("/system-status");
  return req.data;
}

export async function getSystemDiagnosticDataSources(input: {
  filter: "issues" | "all";
  limit?: number;
  cursor?: string;
}): Promise<ISystemDiagnosticDataSourceList> {
  const req = await api.post<ISystemDiagnosticDataSourceList>(
    "/system-status/diagnostics/data-sources",
    input,
  );
  return req.data;
}
