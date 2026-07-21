import api from "@/lib/api-client";
import {
  IMcpSessionStatus,
  ISystemDiagnosticDataSourceList,
  ISystemStatus,
  ReleaseMcpSessionsInput,
} from "@/features/system-status/types/system-status.types";

export async function getSystemStatus(): Promise<ISystemStatus> {
  const req = await api.post<ISystemStatus>("/system-status");
  return req.data;
}

export async function getMcpSessionStatus(): Promise<IMcpSessionStatus> {
  const req = await api.post<IMcpSessionStatus>("/system-status/mcp-sessions");
  return req.data;
}

export async function releaseMcpSessions(
  input: ReleaseMcpSessionsInput,
): Promise<{ releasedCount: number }> {
  const req = await api.post<{ releasedCount: number }>(
    "/system-status/mcp-sessions/release",
    input,
  );
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
