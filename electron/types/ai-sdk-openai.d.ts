import type { LanguageModel } from "ai";

declare module "@ai-sdk/openai" {
  export function createOpenAI(options: {
    apiKey: string;
    baseURL?: string;
  }): (model: string) => LanguageModel;
}
