/**
 * Rattacher une fiche Google à une entreprise du registre.
 *
 * L'erreur à ne jamais commettre : noter un déménageur avec les avis d'un
 * autre. Le rapprochement est donc volontairement étroit. On compare des noms
 * dé-accentués (« Déménagements Élysée » doit retrouver « DEMENAGEMENTS ELYSEE » :
 * sans la normalisation NFD, ça ne matchait jamais), puis, à défaut, des jetons — mais
 * un mot générique du secteur ou un nom de commune ne suffit jamais.
 */

function normalizeCompanyName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/** Mots trop courants pour porter à eux seuls un rapprochement d'entreprise. */
const GENERIC_NAME_TOKENS = new Set([
  "demenagement",
  "demenagements",
  "demenageur",
  "demenageurs",
  "transport",
  "transports",
  "logistique",
  "stockage",
  "garde",
  "meuble",
  "meubles",
  "service",
  "services",
  "societe",
  "groupe",
  "france",
  "sarl",
  "sas",
  "sasu",
  "eurl",
  "ets",
  "etablissements",
  "les",
  "des",
  "und",
  "der",
  "the",
]);

/** Découpe un nom en jetons alphanumériques (accents et ponctuation retirés). */
function tokenizeCompanyName(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((token) => token.length >= 3);
}

export function nameOverlap(a: string, b: string, cityHint?: string | null): boolean {
  const an = normalizeCompanyName(a);
  const bn = normalizeCompanyName(b);
  if (!an || !bn) return false;
  if (an === bn) return true;
  if (an.includes(bn) || bn.includes(an)) return true;
  const shorter = an.length < bn.length ? an : bn;
  const longer = shorter === an ? bn : an;
  if (shorter.length >= 6 && longer.includes(shorter)) return true;

  // Google intercale souvent des mots au milieu de l'enseigne
  // (« Exemplum Réseau National Déménagement Lyon » contre « EXEMPLUM LYON »).
  // La comparaison sur chaîne concaténée échoue alors ; on retombe sur une
  // comparaison par jetons, volontairement étroite : tous les jetons du nom le
  // plus court doivent être présents dans l'autre, et au moins l'un d'eux doit
  // être distinctif (ni mot générique du secteur, ni simple nom de commune).
  const aTokens = tokenizeCompanyName(a);
  const bTokens = tokenizeCompanyName(b);
  if (aTokens.length < 2 || bTokens.length < 2) return false;
  const [shortTokens, longTokens] = aTokens.length <= bTokens.length ? [aTokens, bTokens] : [bTokens, aTokens];
  const longSet = new Set(longTokens);
  if (!shortTokens.every((token) => longSet.has(token))) return false;
  const cityToken = cityHint ? normalizeCompanyName(cityHint) : null;
  return shortTokens.some((token) => token.length >= 4 && !GENERIC_NAME_TOKENS.has(token) && token !== cityToken);
}
