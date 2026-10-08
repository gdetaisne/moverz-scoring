import { parseJsonLoose, REVIEWS_LLM_MODELS, type LlmClient, type LlmJsonResult } from "./client.js";

/**
 * Clients HTTP réels (OpenAI, Anthropic). La clé est passée explicitement :
 * ce module ne lit aucune configuration. Non utilisés par les tests ni par la
 * démo, qui tournent sans réseau.
 */

function readUsage(input: unknown, output: unknown): LlmJsonResult["usage"] {
  return typeof input === "number" && typeof output === "number" ? { inputTokens: input, outputTokens: output } : null;
}

export function createOpenAiClient(apiKey: string, model: string = REVIEWS_LLM_MODELS.openai): LlmClient {
  return {
    provider: "openai",
    model,
    async completeJson(prompt) {
      try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.1,
            response_format: { type: "json_object" },
          }),
          signal: AbortSignal.timeout(45_000),
        });
        if (!response.ok) return null;
        const raw = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const content = raw.choices?.[0]?.message?.content ?? "";
        const json = content ? parseJsonLoose(content) : null;
        if (json === null) return null;
        return { json, provider: "openai", model, usage: readUsage(raw.usage?.prompt_tokens, raw.usage?.completion_tokens) };
      } catch {
        return null;
      }
    },
  };
}

export function createAnthropicClient(apiKey: string, model: string = REVIEWS_LLM_MODELS.anthropic): LlmClient {
  return {
    provider: "anthropic",
    model,
    async completeJson(prompt, options = {}) {
      try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model,
            max_tokens: options.maxTokens ?? 1200,
            temperature: 0.1,
            messages: [{ role: "user", content: prompt }],
          }),
          signal: AbortSignal.timeout(45_000),
        });
        if (!response.ok) return null;
        const raw = (await response.json()) as {
          content?: Array<{ text?: string }>;
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        const text = raw.content?.[0]?.text ?? "";
        const json = text ? parseJsonLoose(text) : null;
        if (json === null) return null;
        return { json, provider: "anthropic", model, usage: readUsage(raw.usage?.input_tokens, raw.usage?.output_tokens) };
      } catch {
        return null;
      }
    },
  };
}
