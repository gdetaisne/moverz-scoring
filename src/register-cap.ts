/**
 * Absence confirmée au registre des transporteurs (décision de Guillaume, 14/10/2026).
 *
 * 1. Une absence CONFIRMÉE (verdict « zero » : absent, licence périmée, ou seulement
 *    commissionnaire) plafonne la note globale à 65. Un registre illisible
 *    (`sitr_lookup_failed`, verdict « unknown ») ne pénalise pas.
 * 2. Avant de plafonner, on cherche si l'entreprise exerce sous un autre SIREN : une
 *    société reprise, une entreprise individuelle fermée puis remplacée par une société.
 *    Seul un transporteur de marchandises inscrit compte (jamais un commissionnaire seul).
 *    Correspondance retenue si
 *      a) même raison sociale (normalisée, avec au moins un mot qui n'est ni générique ni un
 *         nom de commune) et même code postal, ou même commune dans le même département ;
 *      b) gestionnaire de transport du registre égal au dirigeant connu, dans le même
 *         département, ET un mot du nom en commun ou la même commune.
 *    Les mots génériques (métier, forme, régions, départements, gentilés) ne comptent
 *    jamais comme mots du nom. UNE correspondance probable lève le plafond : avertissement
 *    `sitr_successor_candidate:<siren>` et signalement à l'équipe pour revue. Plusieurs :
 *    ambiguïté, le plafond reste, `sitr_successor_ambiguous:<siren>+<siren>`, même alerte.
 *    Même gérant et même commune SANS mot du nom en commun (souvent une société sœur) : le
 *    plafond reste, `sitr_successor_to_review:<siren>`, alerte pour vérification (option A,
 *    Guillaume, 15/10/2026).
 * 3. Annuaire du registre illisible au moment de la recherche : pas de plafond (Guillaume,
 *    15/10/2026), le calcul est refait au passage suivant.
 *
 * Pourquoi : un déménageur absent du registre exerce sans l'inscription que la loi
 * exige pour transporter les biens d'un client ; il ne doit plus être présenté sur
 * la seule foi de ses avis. Le plafond (65) le garde noté, mais sous le seuil de 75.
 *
 * Pur : l'annuaire du registre arrive en entrée (`RegistrySnapshot.transportRegisterDirectory`,
 * lu en production dans les CSV ministériels).
 */

export const REGISTER_ABSENT_MAX_SCORE = 65;

/** Combien de correspondances au plus sont gardées pour l'alerte (les premières, par ordre de preuve). */
export const SITR_SUCCESSOR_MAX_CANDIDATES = 5;

export type SitrDirectoryEntry = {
  siren: string;
  raisonSociale: string;
  postalCode: string | null;
  commune: string | null;
  /** Gestionnaire de transport (marchandises) ou attestataire de capacité (commissionnaires). */
  manager: string | null;
  register: "marchandises" | "commissionnaires";
};

/**
 * `same_name_same_place` et `same_manager_same_department` (gérant + mot distinctif du nom en
 * commun) lèvent le plafond. `same_manager_same_commune` (gérant + même commune, sans mot du
 * nom en commun : souvent une société sœur) ne le lève pas : l'équipe vérifie (option A de
 * Guillaume, 15/10/2026).
 */
export type SitrSuccessorReason = "same_name_same_place" | "same_manager_same_department" | "same_manager_same_commune";

/** Une correspondance qui lève le plafond (pas une simple fiche « à vérifier »). */
export function liftsRegisterCap(candidate: Pick<SitrSuccessorCandidate, "reason">): boolean {
  return candidate.reason !== "same_manager_same_commune";
}

export type SitrSuccessorCandidate = {
  siren: string;
  raisonSociale: string;
  postalCode: string | null;
  commune: string | null;
  register: SitrDirectoryEntry["register"];
  reason: SitrSuccessorReason;
  /** Ce qui a fait correspondre, en clair (pour l'équipe). */
  evidence: string;
};

/** Une personne connue de l'entreprise : nom de famille et prénom(s). */
export type KnownPerson = { lastName: string; firstNames: string | null };

const LEGAL_FORM_TOKENS = new Set([
  "SARL",
  "SAS",
  "SASU",
  "EURL",
  "SA",
  "SNC",
  "SCI",
  "SCOP",
  "EI",
  "EIRL",
  "ETS",
  "ETABLISSEMENTS",
  "STE",
  "SOCIETE",
]);

/**
 * Mots qui ne désignent pas une entreprise à eux seuls (relecture du 15/10/2026 :
 * le rejeu sur la production rapprochait six fiches « France Déménagement » de trois SIREN
 * d'un même réseau). Métier, formes, mots de liaison, et noms de régions, de départements
 * et leurs gentilés : un nom fait seulement de ces mots ne correspond à personne par le nom.
 */
const GENERIC_NAME_WORDS = [
  // métier et formes
  "demenagement", "demenagements", "demenageur", "demenageurs", "demenage", "dem", "transport", "transports",
  "transporteur", "france", "service", "services", "groupe", "group", "sas", "sasu", "sarl", "eurl", "sa", "international",
  "internationale", "express", "expres", "logistique", "logistic", "logistics", "garde", "meuble", "meubles",
  "garde-meubles", "stockage", "entreprise", "entreprises", "ets", "et", "de", "du", "des", "la", "le", "les", "en", "au",
  "aux", "sur", "son", "fils", "freres", "national", "nationale", "europe", "european", "moving", "move", "movers",
  "pro", "solution", "solutions", "agence", "reseau", "plus", "no", "and",
  // régions et gentilés
  "auvergne", "rhone", "alpes", "bourgogne", "franche", "comte", "bretagne", "breton", "bretons", "centre", "val",
  "loire", "corse", "grand", "est", "hauts", "ile", "normandie", "normand", "normands", "nouvelle", "aquitaine",
  "occitanie", "pays", "provence", "cote", "azur", "alsace", "alsacien", "lorraine", "champagne", "ardenne", "picardie",
  "limousin", "poitou", "charentes", "languedoc", "roussillon", "midi", "pyrenees", "savoie", "savoyard", "savoyards",
  "dauphine", "basque", "parisien", "parisienne", "francilien", "lyonnais", "marseillais", "nord", "sud", "ouest",
  "outre", "mer", "region", "regional", "regionale", "province", "provinces",
  // départements (mots)
  "ain", "aisne", "allier", "haute", "hautes", "haut", "bas", "basse", "basses", "maritime", "maritimes", "ardeche",
  "ardennes", "ariege", "aube", "aude", "aveyron", "bouches", "calvados", "cantal", "charente", "cher", "correze",
  "cote", "cotes", "armor", "creuse", "dordogne", "doubs", "drome", "eure", "finistere", "gard", "garonne", "gers",
  "gironde", "herault", "vilaine", "indre", "isere", "jura", "landes", "loir", "atlantique", "loiret", "lot", "lozere",
  "maine", "manche", "marne", "mayenne", "meurthe", "moselle", "meuse", "morbihan", "nievre", "oise", "orne", "calais",
  "puy", "dome", "rhin", "saone", "sarthe", "paris", "seine", "yvelines", "sevres", "somme", "tarn", "vaucluse",
  "vendee", "vendeen", "vienne", "vosges", "yonne", "territoire", "belfort", "essonne", "hauts", "denis", "marne",
  "oise", "guadeloupe", "martinique", "guyane", "reunion", "mayotte", "var", "alpes",
];

const GENERIC_NAME_TOKENS = new Set(
  GENERIC_NAME_WORDS.flatMap((word) =>
    foldUpper(word)
      .split(" ")
      .filter(Boolean)
      .map(tokenOf),
  ),
);

/** Les mots d'un nom qui désignent l'entreprise : ni génériques, ni noms de commune, ni trop courts. */
function distinctiveTokens(normalized: string, communeTokens: ReadonlySet<string>): string[] {
  return normalized.split(" ").filter((w) => w.length >= 3 && !GENERIC_NAME_TOKENS.has(w) && !communeTokens.has(w));
}

function foldUpper(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function tokenOf(word: string): string {
  // « DEMENAGEMENTS » et « DEMENAGEMENT » se valent.
  return word.length > 3 && word.endsWith("S") ? word.slice(0, -1) : word;
}

/**
 * Raison sociale comparable : sans accents ni ponctuation, sans forme juridique, mots
 * triés (« EXEMPLE - Déménagement » = « EXEMPLE DEMENAGEMENT »). Vide si rien ne reste.
 */
export function normalizeCompanyName(name: string | null | undefined): string {
  if (!name) return "";
  const words = foldUpper(name)
    .split(" ")
    .filter((w) => w.length > 0 && !LEGAL_FORM_TOKENS.has(w))
    .map(tokenOf);
  return [...new Set(words)].sort().join(" ");
}

/** Département d'un code postal français (2A/2B pour la Corse, 3 chiffres outre-mer). */
export function departmentOfPostalCode(postalCode: string | null | undefined): string | null {
  const cp = (postalCode ?? "").replace(/\D/g, "");
  if (cp.length !== 5) return null;
  if (cp.startsWith("97") || cp.startsWith("98")) return cp.slice(0, 3);
  if (cp.startsWith("20")) return Number(cp) < 20200 ? "2A" : "2B";
  return cp.slice(0, 2);
}

function normalizeCommune(commune: string | null | undefined): string {
  return foldUpper(commune ?? "")
    .replace(/\bST\b/g, "SAINT")
    .replace(/\bSTE\b/g, "SAINTE")
    .replace(/\bCEDEX\b.*$/, "")
    .trim();
}

/**
 * Le nom du registre (« MARTIN PAUL ») désigne-t-il cette personne ? Oui si son nom
 * de famille et son premier prénom figurent tous deux parmi les mots du registre, dans
 * n'importe quel ordre. Un nom seul ne suffit jamais.
 */
export function personMatchesRegisterName(registerName: string | null | undefined, person: KnownPerson): boolean {
  if (!registerName) return false;
  const register = new Set(foldUpper(registerName).split(" ").filter(Boolean));
  const last = foldUpper(person.lastName).split(" ").filter(Boolean);
  const first = foldUpper(person.firstNames ?? "").split(" ").filter(Boolean)[0];
  if (last.length === 0 || !first) return false;
  return last.every((w) => register.has(w)) && register.has(first);
}

export function findSitrSuccessorCandidates(input: {
  directory: readonly SitrDirectoryEntry[];
  /** Le SIREN de la fiche : jamais candidat de lui-même. */
  ownSiren: string | null;
  /** Noms de la fiche : nom commercial, raison sociale, dénomination du registre des entreprises. */
  names: Array<string | null | undefined>;
  /**
   * Lieux de la fiche : l'adresse du déménageur EN PREMIER, puis le siège connu. La preuve
   * par le gérant ne regarde que l'adresse de la fiche (le siège d'un réseau ou d'une
   * holding est ailleurs).
   */
  places: Array<{ postalCode: string | null | undefined; commune: string | null | undefined }>;
  /** Dirigeants connus (registre des entreprises). */
  managers: KnownPerson[];
}): SitrSuccessorCandidate[] {
  const own = (input.ownSiren ?? "").replace(/\D/g, "");
  // Les noms de commune de la fiche ne désignent pas l'entreprise (« Paris Déménagement »).
  const ficheCommuneTokens = new Set(
    input.places.flatMap((p) => normalizeCompanyName(p.commune).split(" ")).filter((w) => w.length > 0)
  );
  const normalizedNames = input.names.map(normalizeCompanyName).filter((n) => n.length > 0);
  const postalCodes = new Set(
    input.places.map((p) => (p.postalCode ?? "").replace(/\D/g, "")).filter((cp) => cp.length === 5)
  );
  const communes = new Set(input.places.map((p) => normalizeCommune(p.commune)).filter((c) => c.length > 0));
  const departments = new Set(
    input.places.map((p) => departmentOfPostalCode(p.postalCode)).filter((d): d is string => d != null)
  );
  const fichePlace = input.places[0];
  const ficheDepartment = departmentOfPostalCode(fichePlace?.postalCode);
  const ficheCommune = normalizeCommune(fichePlace?.commune);
  // Le nom du gérant dans un nom de société ne prouve rien : c'est sa personne, pas son
  // entreprise (rejeu du 15/10/2026 : un gérant à plusieurs sociétés rapprochait chacune).
  const personTokens = new Set(
    input.managers.flatMap((p) => normalizeCompanyName(`${p.lastName} ${p.firstNames ?? ""}`).split(" ")).filter(Boolean)
  );

  const found = new Map<string, SitrSuccessorCandidate>();
  const add = (entry: SitrDirectoryEntry, reason: SitrSuccessorReason, evidence: string) => {
    if (found.has(entry.siren)) return;
    found.set(entry.siren, {
      siren: entry.siren,
      raisonSociale: entry.raisonSociale,
      postalCode: entry.postalCode,
      commune: entry.commune,
      register: entry.register,
      reason,
      evidence,
    });
  };

  for (const entry of input.directory) {
    if (!entry.siren || entry.siren === own) continue;
    // Relecture du 15/10/2026 : seul un transporteur de marchandises inscrit lève le plafond ;
    // un commissionnaire seul ne transporte pas.
    if (entry.register !== "marchandises") continue;
    const department = departmentOfPostalCode(entry.postalCode);
    const sameDepartment = department != null && departments.has(department);
    const sameCommune = entry.commune != null && communes.has(normalizeCommune(entry.commune)) && sameDepartment;
    const samePlace = (entry.postalCode != null && postalCodes.has(entry.postalCode.replace(/\D/g, ""))) || sameCommune;
    const excluded = new Set([...ficheCommuneTokens, ...normalizeCompanyName(entry.commune).split(" ").filter(Boolean)]);
    const entryName = normalizeCompanyName(entry.raisonSociale);
    const entryTokens = new Set(distinctiveTokens(entryName, excluded));
    const sameName = entryTokens.size > 0 && normalizedNames.some((n) => n === entryName && distinctiveTokens(n, excluded).length > 0);
    if (samePlace && sameName) {
      add(entry, "same_name_same_place", `même nom (« ${entry.raisonSociale} »), même ${postalCodes.has((entry.postalCode ?? "").replace(/\D/g, "")) ? "code postal" : "commune"}`);
      continue;
    }
    // Un gérant homonyme ne suffit pas seul : il faut aussi un mot du nom en commun, ou la
    // même commune dans le même département.
    const sharedWord = normalizedNames
      .flatMap((n) => distinctiveTokens(n, excluded))
      .find((w) => entryTokens.has(w) && !personTokens.has(w));
    const nameOverlap = sharedWord != null;
    const managerSameDepartment = department != null && department === ficheDepartment;
    const managerSameCommune =
      managerSameDepartment && entry.commune != null && ficheCommune.length > 0 && normalizeCommune(entry.commune) === ficheCommune;
    if (
      managerSameDepartment &&
      (nameOverlap || managerSameCommune) &&
      input.managers.some((person) => personMatchesRegisterName(entry.manager, person))
    ) {
      add(
        entry,
        nameOverlap ? "same_manager_same_department" : "same_manager_same_commune",
        `même gérant (${entry.manager}), ${nameOverlap ? `mot du nom en commun « ${sharedWord} »` : `même commune (${entry.commune}), aucun mot du nom en commun : à vérifier`}`,
      );
    }
  }

  const all = [...found.values()];
  // Le nom et le lieu d'abord, puis le gérant avec un mot du nom, puis les fiches à vérifier.
  const rank: Record<SitrSuccessorReason, number> = { same_name_same_place: 0, same_manager_same_department: 1, same_manager_same_commune: 2 };
  all.sort((a, b) => rank[a.reason] - rank[b.reason] || a.siren.localeCompare(b.siren));
  return all.slice(0, SITR_SUCCESSOR_MAX_CANDIDATES);
}

/**
 * Le plafond de la note globale. `successors` : null quand la recherche n'a pas pu se
 * faire (annuaire du registre illisible au moment du calcul) : PAS de plafond (Guillaume,
 * 15/10/2026, même logique que les pannes de source) ; le calcul est refait au passage suivant.
 *
 * Un SEUL autre SIREN qui lève le plafond (`liftsRegisterCap`) le lève. Plusieurs (relecture
 * du 15/10/2026 : un réseau, des agences homonymes) : on ne sait pas lequel, le plafond reste,
 * `ambiguous` le dit. Les fiches seulement « à vérifier » (même gérant, même commune, aucun
 * mot du nom en commun) ne lèvent rien. Dans les deux cas l'équipe est prévenue.
 */
export function applyRegisterCap(input: {
  globalScore: number | null;
  verdict: "ok" | "zero" | "unknown";
  successors: SitrSuccessorCandidate[] | null;
}): { score: number | null; capped: boolean; liftedBySuccessor: boolean; ambiguous: boolean } {
  const keep = { score: input.globalScore, capped: false, liftedBySuccessor: false, ambiguous: false };
  if (input.verdict !== "zero") return keep;
  if (input.successors == null) return keep;
  const lifting = input.successors.filter(liftsRegisterCap);
  if (lifting.length === 1) return { ...keep, liftedBySuccessor: true };
  const ambiguous = lifting.length > 1;
  if (input.globalScore == null || input.globalScore <= REGISTER_ABSENT_MAX_SCORE) return { ...keep, ambiguous };
  return { score: REGISTER_ABSENT_MAX_SCORE, capped: true, liftedBySuccessor: false, ambiguous };
}

/** Les avertissements d'une recherche d'autre SIREN : levée, ambiguïté, fiches à vérifier. */
export function registerSuccessorWarnings(successors: SitrSuccessorCandidate[] | null): string[] {
  if (!successors) return [];
  const lifting = successors.filter(liftsRegisterCap);
  const toReview = successors.filter((c) => !liftsRegisterCap(c));
  return [
    ...(lifting.length === 1 ? [`sitr_successor_candidate:${lifting[0].siren}`] : []),
    ...(lifting.length > 1 ? [`sitr_successor_ambiguous:${lifting.map((c) => c.siren).join("+")}`] : []),
    ...toReview.map((c) => `sitr_successor_to_review:${c.siren}`),
  ];
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Dirigeants connus dans la fiche du registre des entreprises (réponse brute) :
 * représentants personnes physiques, et la personne elle-même pour une entreprise
 * individuelle (`nom` / `prenom`).
 */
export function knownPersonsFromRegistry(raw: unknown): KnownPerson[] {
  if (!raw || typeof raw !== "object") return [];
  const record = raw as Record<string, unknown>;
  const persons: KnownPerson[] = [];
  const push = (lastName: string | null, firstNames: string | null) => {
    if (lastName && firstNames) persons.push({ lastName, firstNames });
  };
  const representants = Array.isArray(record.representants) ? record.representants : [];
  for (const rep of representants) {
    if (!rep || typeof rep !== "object") continue;
    const r = rep as Record<string, unknown>;
    if (r.personne_morale === true) continue;
    push(readString(r.nom), readString(r.prenom) ?? readString(r.prenom_usuel));
  }
  push(readString(record.nom), readString(record.prenom) ?? readString(record.prenom_usuel));
  return persons;
}

/** Noms et lieux de l'entreprise dans la fiche du registre des entreprises (réponse brute). */
export function identityFromRegistry(raw: unknown): {
  names: string[];
  places: Array<{ postalCode: string | null; commune: string | null }>;
} {
  if (!raw || typeof raw !== "object") return { names: [], places: [] };
  const record = raw as Record<string, unknown>;
  const names = [record.nom_entreprise, record.denomination, record.nom_complet]
    .map(readString)
    .filter((n): n is string => n != null);
  const siege = record.siege && typeof record.siege === "object" ? (record.siege as Record<string, unknown>) : null;
  const places = siege ? [{ postalCode: readString(siege.code_postal), commune: readString(siege.ville) }] : [];
  return { names, places };
}
