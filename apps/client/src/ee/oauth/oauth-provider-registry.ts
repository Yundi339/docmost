export type OAuthProviderDescriptor = {
  id: string;
  label: string;
  badge: string;
  description?: string;
};

const descriptors: Record<string, OAuthProviderDescriptor> = {
  chatgpt: {
    id: "chatgpt",
    label: "ChatGPT OAuth",
    badge: "GPT",
    description: "ChatGPT OAuth provider for Docmost MCP.",
  },
};

export function getOAuthProviderDescriptor(
  provider: string,
  fallbackName?: string,
): OAuthProviderDescriptor {
  return (
    descriptors[provider] ?? {
      id: provider,
      label: fallbackName || provider,
      badge: provider.slice(0, 3).toUpperCase(),
    }
  );
}
