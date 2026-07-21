import type { IWorkspaceAiSettings } from "@/features/workspace/types/workspace.types";

export type McpMode = "off" | "read-only" | "read-write";

export function resolveMcpMode(
  aiSettings?: IWorkspaceAiSettings | null,
): McpMode {
  if (
    aiSettings?.mcpMode === "read-only" ||
    aiSettings?.mcpMode === "read-write"
  ) {
    return aiSettings.mcpMode;
  }
  if (aiSettings?.mcpMode === "off") return "off";

  return aiSettings?.mcp === true ? "read-write" : "off";
}
