export type McpMode = 'off' | 'read-only' | 'read-write';

export function resolveMcpMode(aiSettings: unknown): McpMode {
  const settings = aiSettings as
    | { mcp?: boolean; mcpMode?: McpMode }
    | null
    | undefined;

  if (
    settings?.mcpMode === 'read-only' ||
    settings?.mcpMode === 'read-write'
  ) {
    return settings.mcpMode;
  }
  if (settings?.mcpMode === 'off') return 'off';

  return settings?.mcp === true ? 'read-write' : 'off';
}
