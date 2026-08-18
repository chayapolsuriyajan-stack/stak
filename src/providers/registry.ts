import type { ResolvedConfig } from "../config/types.js";
import { AnthropicProvider } from "./anthropic.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAIProvider } from "./openai.js";
import type { Provider } from "./types.js";

/**
 * Instantiates only the selected provider, so a missing key for one provider
 * never blocks a session that uses another.
 */
export function createProvider(config: ResolvedConfig): Provider {
  switch (config.provider) {
    case "anthropic": {
      if (!config.anthropicApiKey) {
        throw new Error(
          "No Anthropic API key. Set ANTHROPIC_API_KEY or add anthropicApiKey to ~/.stak/config.json.",
        );
      }
      return new AnthropicProvider({ apiKey: config.anthropicApiKey });
    }

    case "openai": {
      if (!config.openaiApiKey) {
        throw new Error(
          "No OpenAI API key. Set OPENAI_API_KEY or add openaiApiKey to ~/.stak/config.json.",
        );
      }
      return new OpenAIProvider({ apiKey: config.openaiApiKey });
    }

    case "ollama":
      return new OllamaProvider({ host: config.ollamaHost });
  }
}
