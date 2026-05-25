/**
 * NHIRD ecosystem registry data — used by /databases/nhird/.
 *
 * Modelled on the PHDc diagram (https://www.phdcenter.org.tw/database/):
 * NHIRD sits at the centre; satellite Taiwan registries / databases / CDMs
 * link in. Descriptions are paraphrased; nothing is fetched from PHDc at
 * build time so this stays self-contained.
 *
 * Layout zones on the diagram:
 *   top    — surveys / lab / pandemic / genomics
 *   left   — reproductive / birth / immunisation
 *   right  — cancer / mortality / catastrophic illness
 *   bottom — CDM mappings + Chang Gung EHR
 */

export interface Registry {
  id: string;
  name: string;
  /** sub-line, e.g. "Claims · All citizens · ~23 million individuals" */
  meta: string;
  /** 1–2 sentence description shown in tooltip + on the in-page list */
  description: string;
  /** Optional external link (PHDc page, official site, etc.) */
  link?: string;
  /** Tailwind background / border colour for the card */
  tone:
    | "teal"     // NHIRD core
    | "orange"   // surveys / reproductive
    | "amber"    // lab
    | "green"    // pandemic / CGRD
    | "sky"      // genomics
    | "pink"     // birth / immunisation
    | "indigo"   // cancer / CDM
    | "slate"    // mortality / catastrophic
    | "brown";   // maternal & child
  /** CSS grid-area name on the diagram (kept for future bento layout, unused for image-map) */
  area: string;
  /**
   * Bounding box (percentage of the image) for the hotspot overlay.
   * top / left / width / height as strings ending in "%".
   * Initial values are visual estimates — tweak if a hotspot drifts off
   * the box on the imported diagram.
   */
  bbox: { top: string; left: string; width: string; height: string };
}

export const NHIRD: Registry = {
  id: "nhird",
  name: "NHIRD",
  meta: "Claims · All citizens · ~23 million individuals",
  description: "National Health Insurance Research Database — universal single-payer claims covering essentially the entire Taiwanese population since 1995. 70+ billion records and 3.4 billion medical images as of 2024, now including structured laboratory and imaging data.",
  link: "https://www.phdcenter.org.tw/national-health-insurance-research-database-nhird/",
  tone: "teal",
  area: "nhird",
  bbox: { top: "26.5%", left: "30%", width: "40%", height: "6%" },
};

/** Inner satellites of NHIRD (rendered inside the central card) */
export const NHIRD_INNER: { name: string; meta?: string }[] = [
  { name: "Demographic info." },
  { name: "Medical records" },
  { name: "Intervention", meta: "Drugs · Vaccines · Procedures · Medical devices" },
  { name: "Healthcare Facility Info." },
  { name: "HCPs' info." },
];

export const MATERNAL_CHILD: Registry = {
  id: "mch",
  name: "Maternal & Child Health Database",
  meta: "Linked Mother · Father · Child records",
  description: "Multi-generational linkage joining birth certificate data with NHI claims for mother, father, and child — enabling perinatal exposure / paediatric outcome studies.",
  tone: "brown",
  area: "mch",
  bbox: { top: "32%", left: "20%", width: "27%", height: "45%" },
};

export const SATELLITES: Registry[] = [
  // ── TOP ROW ────────────────────────────────────────────────
  {
    id: "nhis",
    name: "NHIS",
    meta: "Exercises · Diets · Health behaviors",
    description: "National Health Interview Survey — population-based survey on lifestyle factors (physical activity, diet, smoking, alcohol, sleep) conducted by the Health Promotion Administration.",
    link: "https://www.phdcenter.org.tw/national-health-interview-survey-nhis/",
    tone: "orange",
    area: "top1",
    bbox: { top: "3.7%", left: "20.4%", width: "12.0%", height: "14.3%" },
  },
  {
    id: "hex",
    name: "Health Examination",
    meta: "Laboratory",
    description: "Adult preventive health examination records covered by NHI — biochemistry, haematology, urinalysis, and lifestyle interview data.",
    tone: "amber",
    area: "top2",
    bbox: { top: "3.7%", left: "35.7%", width: "12.0%", height: "14.3%" },
  },
  {
    id: "covid",
    name: "COVID-19",
    meta: "Vaccine · Confirmed cases",
    description: "Taiwan CDC pandemic data — national COVID-19 vaccination records and confirmed-case surveillance, linkable to NHIRD via national identifier.",
    link: "https://www.phdcenter.org.tw/registry-for-covid-19-vaccine-and-record-database-covid-19/",
    tone: "green",
    area: "top3",
    bbox: { top: "3.7%", left: "51.1%", width: "12.0%", height: "14.3%" },
  },
  {
    id: "twb",
    name: "Taiwan Biobank",
    meta: "Gene · ~200k individuals",
    description: "Population-based biomedical biobank linking genomic, lifestyle, and clinical data from community participants. Target: 1 million individuals.",
    link: "https://www.phdcenter.org.tw/taiwan-biobank-twb/",
    tone: "sky",
    area: "top4",
    bbox: { top: "3.7%", left: "65.0%", width: "13.5%", height: "14.3%" },
  },

  // ── LEFT COLUMN ────────────────────────────────────────────
  {
    id: "ard",
    name: "ARD",
    meta: "ART · IVF · ~400k records",
    description: "Assisted Reproductive Database — national registry of assisted reproductive technology procedures including IVF, conducted by the Health Promotion Administration.",
    link: "https://www.phdcenter.org.tw/assisted-reproduction-database-ard/",
    tone: "orange",
    area: "left1",
    bbox: { top: "26.2%", left: "3.1%", width: "11.8%", height: "13.9%" },
  },
  {
    id: "birth",
    name: "Birth Certificate",
    meta: "~100k records / year",
    description: "National birth registration — captures every live birth in Taiwan with maternal / paternal identifiers, anchor record for the Maternal & Child Health linkage.",
    link: "https://www.phdcenter.org.tw/birth-certificate-application-database-bca/",
    tone: "pink",
    area: "left2",
    bbox: { top: "44.5%", left: "2.9%", width: "12.1%", height: "14.4%" },
  },
  {
    id: "niis",
    name: "NIIS",
    meta: "Vaccine",
    description: "National Immunization Information System — centralised individual-level vaccination records (childhood, adult, travel, COVID-19).",
    tone: "pink",
    area: "left3",
    bbox: { top: "62.9%", left: "2.9%", width: "12.1%", height: "14.4%" },
  },

  // ── RIGHT COLUMN ───────────────────────────────────────────
  {
    id: "cancer",
    name: "Taiwan Cancer Registry",
    meta: "National cancer surveillance",
    description: "National cancer surveillance registry maintained by the Health Promotion Administration — captures incident cancer diagnoses with staging, histology, and treatment, nationwide since 2003.",
    link: "https://www.phdcenter.org.tw/taiwan-cancer-registry-database-tcrd/",
    tone: "indigo",
    area: "right1",
    bbox: { top: "26.4%", left: "84.2%", width: "12.0%", height: "14.4%" },
  },
  {
    id: "death",
    name: "Cause of Death",
    meta: "National death registry",
    description: "National death registration data with ICD-coded underlying and contributing causes of death — administered by the Ministry of Health and Welfare.",
    link: "https://www.phdcenter.org.tw/death-registry/",
    tone: "slate",
    area: "right2",
    bbox: { top: "44.5%", left: "84.2%", width: "12.0%", height: "14.4%" },
  },
  {
    id: "cir",
    name: "Catastrophic Illness Registry",
    meta: "Severe / chronic disease status",
    description: "Registry of patients qualifying for catastrophic-illness status under NHI (cancers, autoimmune disease, severe mental illness, end-stage renal disease, etc.) — confers fee waivers and is widely used as an outcome gold-standard.",
    link: "https://www.phdcenter.org.tw/registry-for-catastrophic-illness-patients-rfcip/",
    tone: "slate",
    area: "right3",
    bbox: { top: "62.9%", left: "84.2%", width: "12.0%", height: "16.0%" },
  },

  // ── BOTTOM ROW ─────────────────────────────────────────────
  {
    id: "ohdsi",
    name: "OHDSI CDM",
    meta: "OMOP Common Data Model",
    description: "NHIRD mapped to the OMOP Common Data Model (Observational Health Data Sciences and Informatics) — enables federated analyses across the global OHDSI network.",
    link: "https://www.phdcenter.org.tw/common-data-model-cdm/",
    tone: "indigo",
    area: "bot1",
    bbox: { top: "85.2%", left: "2.3%", width: "22.1%", height: "14.4%" },
  },
  {
    id: "sentinel",
    name: "Sentinel CDM",
    meta: "FDA Sentinel Common Data Model",
    description: "NHIRD mapped to the FDA Sentinel Common Data Model — supports drug-safety surveillance studies using protocols harmonised with the US Sentinel System.",
    link: "https://www.phdcenter.org.tw/common-data-model-cdm/",
    tone: "indigo",
    area: "bot2",
    bbox: { top: "85.1%", left: "27.3%", width: "22.1%", height: "14.4%" },
  },
  {
    id: "cgrd",
    name: "CGRD",
    meta: "EHR · ~1 million individuals",
    description: "Chang Gung Research Database — standardised multi-institutional electronic medical records from seven Chang Gung Memorial Hospitals, available since 2000 with ~1-month data latency.",
    link: "https://www.phdcenter.org.tw/chang-gung-research-database-cgrd/",
    tone: "green",
    area: "bot3",
    bbox: { top: "85.1%", left: "56.9%", width: "22.1%", height: "14.4%" },
  },
];

/** Tone → Tailwind class fragments (kept as plain strings for Astro class:list) */
export const TONE_CLASSES: Record<Registry["tone"], { bg: string; border: string; chip: string }> = {
  teal:   { bg: "bg-teal-50",   border: "border-teal-200",   chip: "text-teal-700" },
  orange: { bg: "bg-orange-50", border: "border-orange-200", chip: "text-orange-700" },
  amber:  { bg: "bg-amber-50",  border: "border-amber-200",  chip: "text-amber-700" },
  green:  { bg: "bg-green-50",  border: "border-green-200",  chip: "text-green-700" },
  sky:    { bg: "bg-sky-50",    border: "border-sky-200",    chip: "text-sky-700" },
  pink:   { bg: "bg-pink-50",   border: "border-pink-200",   chip: "text-pink-700" },
  indigo: { bg: "bg-indigo-50", border: "border-indigo-200", chip: "text-indigo-700" },
  slate:  { bg: "bg-slate-100", border: "border-slate-300",  chip: "text-slate-700" },
  brown:  { bg: "bg-stone-100", border: "border-stone-300",  chip: "text-stone-700" },
};
