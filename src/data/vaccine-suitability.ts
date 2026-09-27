/**
 * Asia-Pacific databases suitable for vaccine-safety surveillance.
 *
 * Source: Duszynski KM, Stark JH, Cohet C, et al. Suitability of databases in
 * the Asia-Pacific for collaborative monitoring of vaccine safety.
 * Pharmacoepidemiol Drug Saf. 2021;30(7):843-857. doi:10.1002/pds.5214
 * PMID 33634545.
 *
 *   SURVEY   — Figure 1 (survey distribution and response).
 *   DATABASES — Table 1 (database characteristics). `outcome` reads the
 *               table's two outcome columns: "integrated" where vaccine and
 *               outcome data sit in the same database, "linkage" where the
 *               two must be joined across databases. Four of the five are
 *               registries with no outcomes; Korea's NHIS is the reverse, with
 *               outcomes but no vaccination (Table 3, footnote a).
 *   RECORDED — Table 3 (availability of vaccination variables), totals row.
 *
 * Nothing here is estimated. Where the paper left a value unstated, it is
 * left out rather than filled in.
 *
 * Known discrepancy in the source: the abstract gives vaccine brand as 7/11,
 * Table 3's total gives 6/11. ATC code (5) and manufacturer (5) agree across
 * both, so the column reading is sound; RECORDED follows the table.
 *
 * This paper is filed under the Infection & Vaccine theme. The /focus/vaccine/
 * page visualises it; it does not re-file it.
 */

export type OutcomeAccess = "integrated" | "linkage";

export interface VaccineDb {
  /** Region as the paper names it. */
  region: string;
  /** flagcdn.com code. */
  flag: string;
  /** Marker position. One per region; several databases share it. */
  lat: number;
  lng: number;
  name: string;
  /** Short label for tight rows. */
  short: string;
  /** Data source kind, from Table 1's "Source records" column. */
  kind: "Immunisation registry" | "Claims" | "EHR";
  coverage: "National" | "Regional";
  outcome: OutcomeAccess;
  /** Path on this site (no base prefix) where the database already has a page. */
  href?: string;
}

// Figure 1. Each stage keeps its own unit; this is a pipeline, not a funnel.
export const SURVEY = [
  { label: "Surveyed", value: 19, unit: "countries", note: "37 screening invitations" },
  { label: "Responded", value: 11, unit: "countries", note: "20 respondents, 54%" },
  { label: "Completed", value: 10, unit: "countries", note: "11 full surveys" },
  { label: "Suitable", value: 8, unit: "regions", note: "11 databases" },
] as const;

// Why the pipeline narrows, in the paper's own terms (Figure 1 notes).
export const SURVEY_EXCLUSIONS = [
  "Philippines and Vietnam: surveys described spontaneous pharmacovigilance-report databases, not person-level records",
  "Japan: the database lacked systematic immunisation records",
];

export const DATABASES: VaccineDb[] = [
  { region: "Australia",   flag: "au", lat: -25.27, lng: 133.78, name: "Australian Immunisation Register",          short: "AIR",       kind: "Immunisation registry", coverage: "National", outcome: "linkage" },
  { region: "China",       flag: "cn", lat: 29.82,  lng: 121.55, name: "Yinzhou Electronic Health Record",          short: "Yinzhou",   kind: "EHR",                   coverage: "Regional", outcome: "integrated" },
  { region: "Hong Kong",   flag: "hk", lat: 22.32,  lng: 114.17, name: "Clinical Data Analysis and Reporting System", short: "CDARS",   kind: "EHR",                   coverage: "National", outcome: "integrated",
    href: "/databases/#db-clinical-data-analysis-and-reporting-system-cdars-" },
  { region: "South Korea", flag: "kr", lat: 36.5,   lng: 127.8,  name: "Immunization Registry System",              short: "Registry",  kind: "Immunisation registry", coverage: "National", outcome: "linkage" },
  { region: "South Korea", flag: "kr", lat: 36.5,   lng: 127.8,  name: "National Health Insurance Database, with health screening", short: "NHIS", kind: "Claims", coverage: "National", outcome: "linkage",
    href: "/databases/#db-national-health-insurance-service-national-health-information-database-nhis-nhid-" },
  { region: "Malaysia",    flag: "my", lat: 3.14,   lng: 101.69, name: "QUEST3+",                                   short: "QUEST3+",   kind: "EHR",                   coverage: "National", outcome: "integrated" },
  { region: "New Zealand", flag: "nz", lat: -41.29, lng: 174.78, name: "National Immunisation Register",            short: "NIR",       kind: "Immunisation registry", coverage: "National", outcome: "linkage" },
  { region: "Thailand",    flag: "th", lat: 13.76,  lng: 100.5,  name: "Hospital Information",                      short: "HI",        kind: "EHR",                   coverage: "Regional", outcome: "integrated" },
  { region: "Thailand",    flag: "th", lat: 13.76,  lng: 100.5,  name: "Hospital Information Management professional", short: "HIMpro", kind: "EHR",                   coverage: "Regional", outcome: "integrated" },
  { region: "Taiwan",      flag: "tw", lat: 23.7,   lng: 121.0,  name: "National Health Insurance Databases",       short: "NHIRD",     kind: "Claims",                coverage: "National", outcome: "integrated",
    href: "/databases/#db-national-health-insurance-research-database-nhird-" },
  { region: "Taiwan",      flag: "tw", lat: 23.7,   lng: 121.0,  name: "National Immunization Information System",  short: "NIIS",      kind: "Immunisation registry", coverage: "National", outcome: "linkage",
    href: "/nhird/#registry-niis" },
];

// Table 3, totals row: how many of the 11 databases record each variable.
export const RECORDED: { variable: string; n: number }[] = [
  { variable: "Date of vaccination",   n: 9 },
  { variable: "Country-specific code", n: 8 },
  { variable: "Dose",                  n: 8 },
  { variable: "Route",                 n: 7 },
  { variable: "Setting",               n: 7 },
  { variable: "Brand",                 n: 6 },
  { variable: "Batch number",          n: 5 },
  { variable: "ATC code",              n: 5 },
  { variable: "Manufacturer",          n: 5 },
  { variable: "Body site",             n: 3 },
];

export const TOTAL_DBS = DATABASES.length;

// ── Deductions ──────────────────────────────────────────────────────
// One terse line per region, read off the paper the way Sherlock reads a
// stranger: observation, then what follows. Each is backed by the paper:
//   Korea      — Table 1 (both databases need linkage); Table 3 note a
//                (the insurance database holds no vaccine data).
//   Hong Kong  — Discussion: CDARS recorded two vaccines and no EPI
//                vaccines, because childhood vaccination is run by the
//                Department of Health, not the Hospital Authority.
//   Australia  — Results: probabilistic linkage was needed to join datasets.
//   others     — Table 1 coverage, source records and outcome columns.
export const DEDUCTIONS: Record<string, string> = {
  "South Korea": "Registry holds the vaccines. NHIS holds the outcomes. Join them.",
  Taiwan: "NIIS holds the vaccines; NHIRD, the outcomes. Linkage joins them.",
  "Hong Kong": "Two vaccines recorded, none of the childhood schedule — that sits with the Department of Health.",
  Australia: "Registry only. Outcomes by probabilistic linkage.",
  "New Zealand": "Registry only. Outcomes need linkage.",
  China: "One district. Every setting. One record.",
  Malaysia: "Vaccine and outcome in the same system.",
  Thailand: "Two regional systems. Outcomes built in.",
};

// Countries surveyed but excluded. Their absence is evidence too, so the map
// shows them as empty rings. Figure 1 notes.
export const EXCLUDED = [
  { region: "Japan", lat: 36.2, lng: 138.25, note: "Excluded: no systematic immunisation records." },
  { region: "Philippines", lat: 12.88, lng: 121.77, note: "Excluded: spontaneous reports only, not person-level." },
  { region: "Vietnam", lat: 14.06, lng: 108.28, note: "Excluded: spontaneous reports only, not person-level." },
];
