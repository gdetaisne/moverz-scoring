/**
 * Le modèle de langage est un port, pas une dépendance : le score se calcule
 * entièrement sans lui (heuristique par mots-clés), et il ne fait que
 * remplacer cette heuristique quand il répond une réponse exploitable.
 *
 * Dans le produit : OpenAI d'abord (gpt-4o-mini), Claude à défaut de clé ou si
 * OpenAI répond en erreur. Ici, n'importe quelle liste de clients.
 */

export type LlmUsage = { inputTokens: number; outputTokens: number };

export type LlmJsonResult = {
  json: unknown;
  provider: string;
  model: string;
  usage: LlmUsage | null;
};

export interface LlmClient {
  readonly provider: string;
  readonly model: string;
  /** Rend `null` en cas d'échec (réseau, HTTP, JSON illisible) : jamais d'exception. */
  completeJson(prompt: string, options?: { maxTokens?: number }): Promise<LlmJsonResult | null>;
}

/** Les modèles utilisés en production pour lire les avis et les bilans. */
export const REVIEWS_LLM_MODELS = { openai: "gpt-4o-mini", anthropic: "claude-haiku-4-5" } as const;

/** Prix publics au 05/10/2026, en dollars par million de jetons (à revérifier avant un gros lot). */
export const REVIEWS_LLM_PRICES_USD_PER_M = {
  openai: { input: 0.15, output: 0.6 },
  anthropic: { input: 1, output: 5 },
} as const;

/**
 * Essaie les clients dans l'ordre ; le premier qui rend une réponse lisible
 * gagne. Aucun client, ou aucun qui réponde : `null`, et l'appelant garde son
 * heuristique.
 */
export async function completeJsonWithFallback(
  clients: readonly LlmClient[],
  prompt: string,
  options: { maxTokens?: number } = {},
): Promise<LlmJsonResult | null> {
  for (const client of clients) {
    try {
      const result = await client.completeJson(prompt, options);
      if (result) return result;
    } catch {
      // Un client qui lève malgré le contrat est traité comme un échec : on passe au suivant.
    }
  }
  return null;
}

/** Retire les clôtures ```json que certains modèles ajoutent autour du JSON. */
export function parseJsonLoose(text: string): unknown | null {
  const cleaned = text.replace(/```json\s*/g, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    return null;
  }
}
