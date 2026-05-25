/**
 * Curated research themes for AsPEN publications.
 *
 * Used by:
 *  - /publications/themes/         (magazine flip-through overview)
 *  - /publications/themes/[id]/    (per-theme chronological list)
 *
 * Each theme bundles a story (editorial lede), an optional cover image,
 * and a list of publication tags. A publication belongs to a theme when
 * any of its tags (case-insensitive) match the theme's `tags` list.
 */
export interface Theme {
  id: string;
  /** Two-digit display number, e.g. "01". */
  number: string;
  name: string;
  /** Short editorial story — 1–3 sentences, the lede of the spread. */
  story: string;
  /**
   * 3–5 word pull-quote shown on the magazine cover as the main headline.
   * Drawn from the theme's most representative paper or topic.
   */
  headline: string;
  /** Cover image path under public/images/ (e.g. "themes/foo.jpg"). Optional. */
  cover?: string;
  /** Caption shown under the cover, e.g. "From: Nature Medicine, 2024". */
  coverCaption?: string;
  /**
   * Optional manual override of the highlight paper. When set, the magazine
   * spread shows the publication with this PMID instead of the auto-picked
   * "featured > blurbed > newest" choice. Used for editorial curation.
   */
  highlightPmid?: string;
  /**
   * Abstract visual rendered on the editorial cover when no `cover` image
   * is supplied. Each key maps to a distinct inline SVG illustration —
   * network, wave, rings, dots, bars, target, or cluster — keeping the
   * cover graphic without resorting to figurative or playful imagery.
   */
  coverVisual?: "network" | "wave" | "rings" | "dots" | "bars" | "target" | "cluster";
  /** Tags from publications.json that map into this theme. */
  tags: string[];
}

export const THEMES: Theme[] = [
  {
    id: "methods-infrastructure",
    number: "01",
    name: "Methods & infrastructure",
    headline: "15 databases · 4 continents",
    story: "The scaffolding that makes the rest of this work possible. PSSA, SCCS, target-trial emulation, common data models, and the NeuroGEN platform that now spans 15 databases on four continents — the methodological foundation every other AsPEN study sits on.",
    coverVisual: "network",
    tags: ["sequence symmetry", "PSSA", "sccs", "target trial emulation", "CDM", "NeuroGEN", "infrastructure", "databases", "data sources", "distributed network", "methodology", "drug utilization", "drug safety", "overview", "review", "accessibility"],
  },
  {
    id: "neuropsychiatric",
    number: "02",
    name: "Neuropsychiatric & cognitive",
    headline: "Psychotropics through a pandemic",
    story: "AsPEN's longest-running thread, anchored by the 2013 PSSA on antipsychotics and acute hyperglycaemia. The 2024 Lancet Psychiatry study of psychotropic prescribing across the COVID-19 pandemic typifies the network's current reach; ongoing work spans dementia survival trajectories, ADHD / methylphenidate utilisation, and post-COVID neuropsychiatric sequelae.",
    highlightPmid: "39241791",
    coverVisual: "wave",
    tags: ["antipsychotics", "psychotropic", "psychiatry", "mental health", "neurology", "dementia", "ADHD", "methylphenidate", "depression", "anxiety", "antiseizure", "epilepsy", "cholinesterase", "lithium"],
  },
  {
    id: "diabetes-cardiometabolic",
    number: "03",
    name: "Diabetes & cardiometabolic",
    headline: "Diabetes drugs in Asia",
    story: "From the second PSSA (thiazolidinediones and cardiovascular risk) through current GLP-1 utilisation studies — characterising how new and old diabetes drugs behave in Asian populations where the underlying epidemiology often differs from Western trial cohorts.",
    coverVisual: "rings",
    tags: ["diabetes", "antidiabetic", "GLP 1", "thiazolidinediones", "metabolic", "cardiovascular", "heart failure", "myocardial infarction"],
  },
  {
    id: "pregnancy-paediatric",
    number: "04",
    name: "Pregnancy & paediatric",
    headline: "3.6 million mother–child pairs",
    story: "Drug safety in populations that are chronically under-represented in trials. The 2024 Nature Medicine study of 3.6 million mother–child pairs across AsPEN sites is the clearest demonstration to date of what multi-country observational data can do for this question.",
    coverVisual: "dots",
    tags: ["pregnancy", "pediatric"],
  },
  {
    id: "pain-opioids",
    number: "05",
    name: "Pain & opioids",
    headline: "Opioids across health systems",
    story: "Comparative drug utilisation across health systems with very different prescribing cultures — opioids, gabapentinoids, NSAIDs, and the downstream gastrointestinal effects (PPIs, C. difficile) that follow.",
    coverVisual: "bars",
    tags: ["opioid", "gabapentinoid", "NSAIDs", "PPI", "gastrointestinal", "C. difficile"],
  },
  {
    id: "oncology-endocrine",
    number: "06",
    name: "Oncology & endocrine",
    headline: "Real-world cancer safety",
    story: "Long-tail safety questions in cancer and endocrine therapy where AsPEN's claims data captures real-world prescribing patterns that single-trial datasets miss — including androgen deprivation, biologics, and bone-targeting agents.",
    coverVisual: "target",
    tags: ["oncology", "thyroid cancer", "prostate cancer", "androgen deprivation", "5 alpha reductase", "biologics", "bone targeting"],
  },
  {
    id: "older-adults",
    number: "07",
    name: "Older adults & frailty",
    headline: "Polypharmacy at scale",
    story: "Polypharmacy, falls, and hip fracture — questions where Asian healthcare systems with universal coverage offer some of the cleanest population-level evidence anywhere.",
    coverVisual: "cluster",
    tags: ["older adults", "polypharmacy", "falls", "hip fracture"],
  },
];

/** Find the theme whose tags match this publication; null if none. */
export function themeForPub(pubTags: string[] | undefined): Theme | null {
  if (!pubTags) return null;
  const lower = pubTags.map((t) => t.toLowerCase());
  for (const t of THEMES) {
    const tagSet = new Set(t.tags.map((x) => x.toLowerCase()));
    if (lower.some((tg) => tagSet.has(tg))) return t;
  }
  return null;
}
