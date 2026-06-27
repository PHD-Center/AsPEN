// Standard STROBE 22-item reporting checklist (combined cohort / case-control /
// cross-sectional version; von Elm E et al., PLoS Med 2007;4:e296). Shared by
// the SCCS, case-crossover, and descriptive-analysis protocol builders, which
// inject it into their client scripts via `define:vars` and pre-fill the
// "where addressed" column from the protocol fields (mirroring how the ACNU
// builder maps its fields to the TARGET checklist).
export interface StrobeSection {
  section: string;
  /** [item number, recommendation text] */
  items: [string, string][];
}

export const STROBE_ITEMS: StrobeSection[] = [
  {
    section: "Title and abstract",
    items: [
      ["1a", "Indicate the study's design with a commonly used term in the title or the abstract."],
      ["1b", "Provide in the abstract an informative and balanced summary of what was done and what was found."],
    ],
  },
  {
    section: "Introduction",
    items: [
      ["2", "Background / rationale: explain the scientific background and rationale for the investigation being reported."],
      ["3", "Objectives: state specific objectives, including any prespecified hypotheses."],
    ],
  },
  {
    section: "Methods",
    items: [
      ["4", "Study design: present key elements of the study design early in the paper."],
      ["5", "Setting: describe the setting, locations, and relevant dates, including periods of recruitment, exposure, follow-up, and data collection."],
      ["6", "Participants: give the eligibility criteria, and the sources and methods of selection of participants (and case ascertainment / follow-up as applicable)."],
      ["7", "Variables: clearly define all outcomes, exposures, predictors, potential confounders, and effect modifiers; give diagnostic criteria, if applicable."],
      ["8", "Data sources / measurement: for each variable of interest, give the sources of data and details of methods of assessment."],
      ["9", "Bias: describe any efforts to address potential sources of bias."],
      ["10", "Study size: explain how the study size was arrived at."],
      ["11", "Quantitative variables: explain how quantitative variables were handled in the analyses; describe which groupings were chosen and why."],
      ["12", "Statistical methods: describe all methods, including those used to control for confounding, to examine subgroups and interactions, to address missing data, and any sensitivity analyses."],
    ],
  },
  {
    section: "Results",
    items: [
      ["13", "Participants: report numbers at each stage of the study and reasons for non-participation; consider a flow diagram."],
      ["14", "Descriptive data: give characteristics of participants and information on exposures and potential confounders; indicate missing data."],
      ["15", "Outcome data: report numbers of outcome events or summary measures (by exposure category, as applicable)."],
      ["16", "Main results: give unadjusted and confounder-adjusted estimates with 95% confidence intervals; translate relative risk into absolute risk where relevant."],
      ["17", "Other analyses: report other analyses done, e.g. subgroups and interactions, and sensitivity analyses."],
    ],
  },
  {
    section: "Discussion",
    items: [
      ["18", "Key results: summarise key results with reference to the study objectives."],
      ["19", "Limitations: discuss limitations, taking into account sources of potential bias or imprecision, and their likely direction and magnitude."],
      ["20", "Interpretation: give a cautious overall interpretation considering objectives, limitations, multiplicity, results from similar studies, and other evidence."],
      ["21", "Generalisability: discuss the generalisability (external validity) of the study results."],
    ],
  },
  {
    section: "Other information",
    items: [
      ["22", "Funding: give the source of funding and the role of the funders for the present study."],
    ],
  },
];
