import keytar from "keytar";
import { createLogger } from "./log";
import { textMeta } from "./log-safety";

const SERVICE = "exva";
const logger = createLogger("secrets-service");

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
    const meta = textMeta(value, 256);
    logger.info(
      {
        account,
        secretLength: meta.length,
        secretTooLong: meta.tooLong,
        sensitivePatternDetected: meta.looksSensitive,
      },
      "setting secret in keychain",
    );
    await keytar.setPassword(SERVICE, account, value);
  }

  async get(account: string): Promise<string | null> {
    const secret = await keytar.getPassword(SERVICE, account);
    logger.debug({ account, exists: Boolean(secret), secretLength: secret?.length ?? 0 }, "read secret from keychain");
    return secret;
  }

  async delete(account: string): Promise<void> {
    logger.info({ account }, "deleting secret from keychain");
    await keytar.deletePassword(SERVICE, account);
  }

  async has(account: string): Promise<boolean> {
    return Boolean(await this.get(account));
  }
}
