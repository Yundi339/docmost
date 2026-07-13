import { ChatGptOAuthClientProvider } from './chatgpt-oauth-client.provider';

describe('ChatGptOAuthClientProvider', () => {
  const provider = new ChatGptOAuthClientProvider();

  it.each([
    'https://chatgpt.com/connector/oauth/callback-id',
    'https://chatgpt.com/connector_platform_oauth_redirect',
  ])('accepts a supported ChatGPT redirect URI: %s', (redirectUri) => {
    expect(() => provider.assertRedirectUri(redirectUri)).not.toThrow();
  });

  it.each([
    'http://chatgpt.com/connector/oauth/callback-id',
    'https://attacker.example.test/connector/oauth/callback-id',
    'https://chatgpt.com:444/connector/oauth/callback-id',
    'https://user@chatgpt.com/connector/oauth/callback-id',
    'https://chatgpt.com/untrusted/callback',
  ])('rejects an untrusted redirect URI: %s', (redirectUri) => {
    expect(() => provider.assertRedirectUri(redirectUri)).toThrow(
      'OAuth redirect_uri is not trusted',
    );
  });
});
