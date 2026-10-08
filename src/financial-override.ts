import { computeLegacyFinancialScore } from "./formulas.js";
import { completeJsonWithFallback, type LlmClient } from "./llm/client.js";

/**
 * Le bilan téléversé par le déménageur (PDF) remplace la note financière du
 * registre quand celui-ci ne publie rien (TPE, comptes confidentiels) ou un
 * bilan ancien.
 *
 * Chaîne : texte du PDF (extracteur injecté — `pdf-parse` en production) →
 * modèle de langage qui extrait les chiffres → validations STRICTES ici → la
 * MÊME formule financière que pour le registre. Le modèle lit ; il ne note pas.
 * Un seul rejet et rien n'est appliqué, avec un message clair au déménageur.
 *
 * Et le registre reprend la main dès qu'il publie un bilan plus récent
 * (`shouldSupersedeOverride`).
 */

export type AiConfidence = "low" | "medium" | "high";

export interface AnalyzedExercise {
  year: number | null;
  dateCloture: string | null;
  dureeMois: number | null;
  chiffreAffaires: number | null;
  resultatNet: number | null;
  fondsPropres: number | null;
  tresorerie: number | null;
  dettesFinancieres: number | null;
  effectif: number | null;
}

export interface BilanAnalysis {
  matchesCompany: boolean;
  detectedCompanyName: string | null;
  detectedSiren: string | null;
  isValidBilan: boolean;
  confidence: AiConfidence;
  anomalies: string[];
  summary: string;
  exercises: AnalyzedExercise[];
  aiModel: string | null;
}

export type BilanRejectionReason =
  | "pdf_text_too_short"
  | "ai_unavailable"
  | "ai_invalid_json"
  | "ai_company_mismatch"
  | "ai_not_bilan"
  | "ai_low_confidence"
  | "ai_no_figures"
  | "bilan_too_old"
  | "score_not_computable";

export type BilanDecision =
  | { ok: true; computedScore: number; dateCloture: string; exerciseYear: number | null; anomalies: string[] }
  | { ok: false; reason: BilanRejectionReason; partnerMessage: string };

export const BILAN_MAX_AGE_MONTHS = 12;
export const MIN_PDF_TEXT_CHARS = 200;
const MAX_TEXT_FOR_AI = 20_000;

/** Extraction du texte d'un PDF ; rend "" si illisible. */
export type PdfTextExtractor = (pdf: Uint8Array) => Promise<string>;

export function buildBilanPrompt(input: {
  company: { name: string; siren: string | null };
  extractedText: string;
}): string {
  return `Tu es un analyste financier qui traite un document PDF transmis par un demenageur francais.

OBJECTIF
Verifier que ce document est bien un BILAN COMPTABLE (liasse fiscale, comptes annuels, bilan publie) appartenant a l'entreprise attendue, puis extraire les chiffres cles.

Reponds UNIQUEMENT en JSON valide avec cette structure:
{
  "matchesCompany": true,
  "detectedCompanyName": "string ou null",
  "detectedSiren": "string ou null",
  "isValidBilan": true,
  "confidence": "low" | "medium" | "high",
  "anomalies": ["exercice 6 mois", "montants illisibles", "..."],
  "summary": "phrase courte decrivant le document",
  "exercises": [
    { "year": 2025, "dateCloture": "2025-12-31", "dureeMois": 12, "chiffreAffaires": 450000, "resultatNet": 25000,
      "fondsPropres": 120000, "tresorerie": 35000, "dettesFinancieres": 40000, "effectif": 5 }
  ]
}

REGLES STRICTES
1. matchesCompany = true uniquement si tu retrouves le nom de l'entreprise OU son SIREN/SIRET dans le document.
2. isValidBilan = true uniquement si c'est un vrai bilan / comptes annuels / liasse fiscale (pas un KBIS, une attestation, un devis, une facture).
3. confidence = "high" si tu es tres sur des chiffres; "medium" si quelques doutes; "low" si extraction douteuse.
4. anomalies liste tout ce qui rend le bilan non standard : exercice different de 12 mois, bilan intermediaire, incoherence.
5. Montants en euros (si le bilan est en kEUR, multiplie par 1000 et precise-le dans anomalies).
6. Plusieurs exercices (N et N-1) : renvoie-les tous, le plus recent en premier.
7. resultatNet peut etre negatif.
8. Champ introuvable : null. Ne devine PAS.

ENTREPRISE ATTENDUE
Nom: ${input.company.name}
SIREN: ${input.company.siren ?? "inconnu"}

TEXTE EXTRAIT DU DOCUMENT (peut etre partiel):
${input.extractedText.slice(0, MAX_TEXT_FOR_AI)}`;
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/\s/g, "").replace(/,/g, "."));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeInteger(value: unknown): number | null {
  const num = normalizeNumber(value);
  return num == null ? null : Math.round(num);
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Une confiance absente ou inconnue vaut « low » : elle sera rejetée. */
function normalizeConfidence(value: unknown): AiConfidence {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

/** Relit la réponse du modèle champ par champ ; les « 12 345,67 » deviennent des nombres. */
export function normalizeBilanAnswer(json: unknown, aiModel: string | null): BilanAnalysis | null {
  if (!json || typeof json !== "object") return null;
  const parsed = json as Record<string, unknown>;
  const exercises = Array.isArray(parsed.exercises)
    ? parsed.exercises
        .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
        .map((item) => ({
          year: normalizeInteger(item.year),
          dateCloture: normalizeString(item.dateCloture),
          dureeMois: normalizeInteger(item.dureeMois),
          chiffreAffaires: normalizeNumber(item.chiffreAffaires),
          resultatNet: normalizeNumber(item.resultatNet),
          fondsPropres: normalizeNumber(item.fondsPropres),
          tresorerie: normalizeNumber(item.tresorerie),
          dettesFinancieres: normalizeNumber(item.dettesFinancieres),
          effectif: normalizeInteger(item.effectif),
        }))
        .sort((a, b) => (b.dateCloture ? Date.parse(b.dateCloture) : 0) - (a.dateCloture ? Date.parse(a.dateCloture) : 0))
    : [];
  return {
    matchesCompany: parsed.matchesCompany === true,
    detectedCompanyName: normalizeString(parsed.detectedCompanyName),
    detectedSiren: normalizeString(parsed.detectedSiren),
    isValidBilan: parsed.isValidBilan === true,
    confidence: normalizeConfidence(parsed.confidence),
    anomalies: Array.isArray(parsed.anomalies)
      ? parsed.anomalies.map(normalizeString).filter((a): a is string => a !== null).slice(0, 20)
      : [],
    summary: normalizeString(parsed.summary) ?? "",
    exercises,
    aiModel,
  };
}

function hasAnyFigure(ex: AnalyzedExercise) {
  return [ex.chiffreAffaires, ex.resultatNet, ex.fondsPropres, ex.tresorerie, ex.dettesFinancieres].some((v) => v != null);
}

function toFormulaInput(ex: AnalyzedExercise): Record<string, unknown> {
  return {
    annee: ex.year ?? undefined,
    chiffre_affaires: ex.chiffreAffaires,
    resultat: ex.resultatNet,
    fonds_propres: ex.fondsPropres,
    tresorerie: ex.tresorerie,
    dettes_financieres: ex.dettesFinancieres,
  };
}

function monthsBetween(later: Date, earlier: Date) {
  return (later.getTime() - earlier.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
}

const reject = (reason: BilanRejectionReason, partnerMessage: string): BilanDecision => ({ ok: false, reason, partnerMessage });

/**
 * Les validations, dans l'ordre. Chacune a un motif et un message pour le
 * déménageur : un refus sans explication ne serait pas un contrôle, mais un mur.
 */
export function decideBilan(analysis: BilanAnalysis, now: Date = new Date()): BilanDecision {
  if (!analysis.matchesCompany) {
    return reject("ai_company_mismatch", "Ce document ne semble pas appartenir à votre entreprise (nom/SIREN non détectés).");
  }
  if (!analysis.isValidBilan) {
    return reject("ai_not_bilan", "Ce document n'est pas reconnu comme un bilan comptable (comptes annuels / liasse fiscale).");
  }
  if (analysis.confidence === "low") {
    return reject("ai_low_confidence", "L'analyse n'est pas assez sûre pour valider ce bilan. Essayez un PDF texte plutôt qu'un scan.");
  }
  const latest = analysis.exercises.find((ex) => ex.dateCloture != null && hasAnyFigure(ex));
  const dateCloture = latest?.dateCloture ? new Date(latest.dateCloture) : null;
  if (!latest || !dateCloture || Number.isNaN(dateCloture.getTime())) {
    return reject("ai_no_figures", "Les chiffres clés (CA, résultat, fonds propres) ou la date de clôture sont illisibles.");
  }
  if (monthsBetween(now, dateCloture) > BILAN_MAX_AGE_MONTHS) {
    return reject("bilan_too_old", `Ce bilan a été clôturé il y a plus de ${BILAN_MAX_AGE_MONTHS} mois. Merci d'en transmettre un plus récent.`);
  }
  const previous = analysis.exercises.find((ex) => ex !== latest && ex.dateCloture != null && hasAnyFigure(ex));
  const computedScore = computeLegacyFinancialScore([toFormulaInput(latest), ...(previous ? [toFormulaInput(previous)] : [])]);
  if (computedScore == null) {
    return reject("score_not_computable", "Les chiffres extraits ne suffisent pas à calculer une note financière.");
  }
  return {
    ok: true,
    computedScore,
    dateCloture: dateCloture.toISOString().slice(0, 10),
    exerciseYear: latest.year,
    anomalies: analysis.anomalies,
  };
}

/** La chaîne complète, avec ses deux ports (extracteur PDF, modèles). */
export async function analyzeBilanPdf(input: {
  pdf: Uint8Array;
  company: { name: string; siren: string | null };
  extractText: PdfTextExtractor;
  llm: readonly LlmClient[];
  now?: Date;
}): Promise<BilanDecision> {
  let text = "";
  try {
    text = (await input.extractText(input.pdf)).trim();
  } catch {
    text = "";
  }
  if (text.length < MIN_PDF_TEXT_CHARS) {
    return reject("pdf_text_too_short", "Le PDF n'a pas pu être lu (image scannée sans OCR, fichier vide ou protégé).");
  }
  const answer = await completeJsonWithFallback(input.llm, buildBilanPrompt({ company: input.company, extractedText: text }), {
    maxTokens: 2000,
  });
  if (!answer) return reject("ai_unavailable", "Le service d'analyse est momentanément indisponible.");
  const analysis = normalizeBilanAnswer(answer.json, answer.model);
  if (!analysis) return reject("ai_invalid_json", "Le document n'a pas pu être analysé.");
  return decideBilan(analysis, input.now);
}

/** Le registre reprend la main dès qu'il publie un exercice clôturé APRÈS celui du bilan téléversé. */
export function shouldSupersedeOverride(overrideDateCloture: Date, registryLatestDateCloture: Date | null): boolean {
  return registryLatestDateCloture != null && registryLatestDateCloture > overrideDateCloture;
}
