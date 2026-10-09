import { ETHIOPIA_PHARMACOPEIA_DICTIONARY } from '../prescription/prescription-vision.service';

export interface MedicineSearchQueryTokens {
  originalQuery: string;
  normalizedQuery: string;
  coreBrandOrGeneric: string;
  strengthTokens: string[];
  formTokens: string[];
  allSearchTerms: string[];
}

// Common dosage forms, delivery routes, and packaging terms in Ethiopia
const FORM_TERMS = new Set([
  'tablet', 'tablets', 'tab', 'tabs',
  'capsule', 'capsules', 'cap', 'caps',
  'inhaler', 'inhalers', 'evohaler', 'rotahaler', 'respimat', 'diskus',
  'syrup', 'suspension', 'syr', 'susp',
  'injection', 'inj', 'vial', 'ampoule', 'amp',
  'drops', 'eye drops', 'ear drops',
  'cream', 'ointment', 'gel',
  'suppository', 'infusion', 'solution',
]);

// Strength measurement patterns e.g. 100mcg, 500mg, 1g, 10ml, 20/120mg
const STRENGTH_REGEX = /\b(\d+(\.\d+)?\s*(mg|mcg|g|ml|iu|u|iu\/ml|u\/ml|%))\b/gi;

export class MedicalFuzzyMatcher {
  /**
   * Parses and decomposes user search input into normalized clinical tokens
   * Example: "Ventolin Evohaler 100mcg" ->
   * core: "ventolin", form: ["evohaler"], strength: ["100mcg"], allSearchTerms: ["ventolin evohaler 100mcg", "ventolin", "salbutamol"]
   */
  public static parseQuery(rawQuery: string): MedicineSearchQueryTokens {
    const originalQuery = (rawQuery || '').trim();
    const normalized = originalQuery.toLowerCase().replace(/[,+]/g, ' ').replace(/\s+/g, ' ');

    const strengthMatches = normalized.match(STRENGTH_REGEX) || [];
    const strengthTokens = strengthMatches.map((s) => s.replace(/\s+/g, '').toLowerCase());

    // Remove strengths from string to extract forms and brand tokens
    let cleaned = normalized;
    for (const str of strengthMatches) {
      cleaned = cleaned.replace(str.toLowerCase(), ' ');
    }

    const words = cleaned.split(/\s+/).filter((w) => w.length > 0);
    const formTokens: string[] = [];
    const brandTokens: string[] = [];

    for (const w of words) {
      if (FORM_TERMS.has(w)) {
        formTokens.push(w);
      } else {
        brandTokens.push(w);
      }
    }

    const coreBrandOrGeneric = brandTokens.length > 0 ? brandTokens[0] : (words[0] || normalized);

    // Build hierarchical query terms: [Original, Core Brand, Synonyms]
    const allTermsSet = new Set<string>();
    if (normalized) allTermsSet.add(normalized);
    if (coreBrandOrGeneric && coreBrandOrGeneric !== normalized) allTermsSet.add(coreBrandOrGeneric);

    // Pharmacopeia synonyms cross-referencing
    const matchedDict = ETHIOPIA_PHARMACOPEIA_DICTIONARY.find((entry) => {
      const brandMatch = entry.brandNames.some((b) => b.toLowerCase().includes(coreBrandOrGeneric) || coreBrandOrGeneric.includes(b.toLowerCase()));
      const genericMatch = entry.genericName.toLowerCase().includes(coreBrandOrGeneric) || coreBrandOrGeneric.includes(entry.genericName.toLowerCase());
      return brandMatch || genericMatch;
    });

    if (matchedDict) {
      for (const brand of matchedDict.brandNames) {
        allTermsSet.add(brand.toLowerCase());
      }
      allTermsSet.add(matchedDict.genericName.toLowerCase().split('+')[0].trim());
    }

    return {
      originalQuery,
      normalizedQuery: normalized,
      coreBrandOrGeneric,
      strengthTokens,
      formTokens,
      allSearchTerms: Array.from(allTermsSet),
    };
  }

  /**
   * Check if a pharmacy inventory item matches the search query using multi-tier fuzzy scoring
   */
  public static matchItem(itemText: string, queryTokens: MedicineSearchQueryTokens): {
    matched: boolean;
    matchType: 'EXACT' | 'BRAND_CORE' | 'GENERIC_SYNONYM' | 'TOKEN_OVERLAP' | 'NONE';
    score: number;
  } {
    const target = (itemText || '').trim().toLowerCase();
    if (!target) return { matched: false, matchType: 'NONE', score: 0 };

    // 1. Exact phrase substring match (Highest precision)
    if (target.includes(queryTokens.normalizedQuery) || queryTokens.normalizedQuery.includes(target)) {
      return { matched: true, matchType: 'EXACT', score: 1.0 };
    }

    // 2. Core Brand match (e.g. Target contains "ventolin" when user searched "ventolin evohaler 100mcg")
    if (queryTokens.coreBrandOrGeneric && (target.includes(queryTokens.coreBrandOrGeneric) || queryTokens.coreBrandOrGeneric.includes(target))) {
      return { matched: true, matchType: 'BRAND_CORE', score: 0.9 };
    }

    // 3. Synonym / Pharmacopeia match (e.g. "salbutamol" for "ventolin")
    for (const synonym of queryTokens.allSearchTerms) {
      if (synonym && (target.includes(synonym) || synonym.includes(target))) {
        return { matched: true, matchType: 'GENERIC_SYNONYM', score: 0.85 };
      }
    }

    // 4. Word-level token overlap (At least one significant word of >= 4 chars matches)
    const targetWords = target.split(/\s+/).filter((w) => w.length >= 4);
    const queryWords = queryTokens.normalizedQuery.split(/\s+/).filter((w) => w.length >= 4);

    const hasCommonWord = queryWords.some((qw) => targetWords.some((tw) => tw.includes(qw) || qw.includes(tw)));
    if (hasCommonWord) {
      return { matched: true, matchType: 'TOKEN_OVERLAP', score: 0.75 };
    }

    return { matched: false, matchType: 'NONE', score: 0 };
  }
}
