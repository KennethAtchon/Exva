import keytar from "keytar";

const SERVICE = "exva";

export const secretKeys = {
  anthropic: "exva:anthropic",
  brave: "exva:search:brave",
  tavily: "exva:search:tavily",
  alpacaApiKey: "exva:alpaca:api-key",
  alpacaSecretKey: "exva:alpaca:secret-key",
  alpacaMode: "exva:alpaca:mode",
} as const;

export class SecretsService {
  async set(account: string, value: string): Promise<void> {
    await keytar.setPassword(SERVICE, account, value);
  }

  async get(account: string): Promise<string | null> {
    return keytar.getPassword(SERVICE, account);
  }

  async delete(account: string): Promise<void> {
    await keytar.deletePassword(SERVICE, account);
  }

  async has(account: string): Promise<boolean> {
    return Boolean(await this.get(account));
  }
}
