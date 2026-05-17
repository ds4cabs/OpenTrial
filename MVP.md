# OpenTrial — MVP Version (Gemini AI Agent · Computation Engine)

**Intern:** Reuben N Addison
**Level:** Assistant Professor (DePauw University), PhD, Advanced Python
**Timeline:** 2–3 weeks (~52 hours)
**Paradigm:** **Computation Engine** — Streamlit form → Bayesian trial-design report with cited prior provenance.
**Database count:** **7** (expanded from 4 because Reuben is the highest-level intern in the cohort and his trial-design work benefits from international trial coverage, full FDA labels, and pharmacogenomic context).

---

## The Agent

**What the agent does (autonomous workflow on submit):** Agent autonomously pulls US + international trial precedent, published effect estimates, full FDA labels, post-market safety signals, drug-gene interactions, and target-disease evidence — builds a Bayesian prior in PyMC, runs adaptive simulation, writes a design report.

**Input:** Form — indication, effect, alpha, power, max N, optional NCT-ID for audit.
**Output:** Design report (Markdown + PDF) with prior summary, power curve, recommended sample size, operating characteristics, citation list.

**Tools (7 public databases):**

1. `get_trials_ct_gov(indication, n=30)` — **ClinicalTrials.gov**: US trial precedent.
2. `get_pubmed_effects(condition, intervention, n=10)` — **PubMed E-utilities**.
3. `get_safety_signals(drug_or_class)` — **openFDA FAERS**.
4. `get_disease_target_context(disease_efo, target)` — **Open Targets GraphQL**.
5. `get_trials_who_ictrp(indication, n=20)` — **WHO ICTRP**: international (EU, Asia, RoW) trial precedent for global development planning.
6. `get_dailymed_full_label(drug_class)` — **DailyMed API**: full structured prescribing label for drug-class benchmarking on dosing, AE rates, monitoring requirements.
7. `get_pharmgkb_drug_gene(drug_or_gene)` — **PharmGKB API**: pharmacogenomic biomarkers, FDA PGx labels, dosing-relevant variants for trial population stratification.

Plus computation utilities: `build_prior(effects_df)` and `simulate_gs_design(n, prior, looks=2)`.

**Example runs (≥3):**

- *Form:* indication="T2D", endpoint=HbA1c, effect=0.5%, alpha=0.025, power=0.8. *Output:* design report drawing prior from 30 US trials + 20 international trials + 10 PubMed meta-analyses, with PGx considerations (PharmGKB) for SGLT2 / GLP-1 variants and full-label benchmark dosing (DailyMed).
- *Form:* indication="MASLD", endpoint=NAS resolution, effect=0.15, alpha=0.05, power=0.9. *Output:* design with Beta-Binomial prior, international trial precedent, no FDA-approved drugs yet (DailyMed empty → noted), PGx context from PharmGKB.
- *Form:* audit mode, NCT-ID=NCT02065791. *Output:* audit report scoring sample size against the literature-derived prior, with reviewer-style critique.

---

## Week-by-Week

**Week 1 (~18h):** Build 7 tool functions + computation utilities. Pull 30 US + 20 international trials.

**Week 2 (~22h):** Clone computation-engine sub-template. Build form (with audit-mode toggle). Wire up Gemini.

**Week 3 (~12h):** Test 5 design queries; tune for rigorous citation-heavy reports; PDF export; demo.

## What's OUT

12,000+ trial records, 40+ indication-endpoint prior library, response-adaptive randomization, full Bayesian futility/efficacy continuous monitoring, ChEMBL drug-class pharmacology depth.

## Stretch Goals

- 8th tool: `get_clinvar_biomarkers(disease)` for variant-based stratification.

## Realistic CV Entry

*Built OpenTrial, a working Gemini AI computation-engine agent for Bayesian clinical trial design integrating 7 public databases spanning US + international trial registries, literature, regulatory, target biology, and pharmacogenomics.*

- Wrapped 7 public databases (ClinicalTrials.gov, PubMed E-utilities, openFDA FAERS, Open Targets, WHO ICTRP, DailyMed, PharmGKB) plus PyMC-based prior elicitation and group-sequential simulation utilities into a Gemini agent.
- Delivered downloadable design reports anchored in global trial precedent with pharmacogenomic and label-derived AE-rate context.

## Tech Stack

Python, `google-generativeai`, Streamlit, PyMC, NumPy, pandas, scipy.stats, matplotlib, markdown-pdf, ClinicalTrials.gov, PubMed E-utilities, openFDA, Open Targets GraphQL, WHO ICTRP, DailyMed API, PharmGKB API.

---

## Shared Agent Skeleton (three paradigms, one Gemini primitive)

Every intern's agent uses Gemini's automatic function calling, but the interface layer differs by paradigm. The cohort uses **one starter repo with three sub-templates** that interns clone in week 1:

- **Dossier-generator template** — CLI script: takes structured args, runs the agent workflow autonomously, writes `*.md` + `*.json` to disk. Used by Beyza, Chin Hung, Christina, Shucheng, Xiaoxue.
- **Dashboard template** — Streamlit page with selectors and tables; the agent is invoked on button-click for specific synthesis tasks. Used by Aaron, Jason, Shawn.
- **Computation-engine template** — Streamlit form (or CLI) that takes structured analytical inputs, runs the agent workflow, produces a downloadable analytical report with plots. Used by Reuben, Kening, Natalie.

**Why no chat interfaces?** Scientists need reproducible, shareable artifacts. The agent dimension (Gemini-as-orchestrator, autonomous tool-calling across multiple public databases, synthesis across sources) is preserved in all three paradigms; only the deliverable shape changes.

**Christina** (OpenRepurpose evidence-and-validation module) owns the starter repo with all three sub-templates. The shared repo should also include pre-built wrappers for the most heavily-used databases (ChEMBL, openFDA FAERS, Open Targets, ClinVar) so multiple interns don't redo the same boilerplate.

### Reference snippet — Gemini function calling (same across all three paradigms)

```python
import google.generativeai as genai
import os
genai.configure(api_key=os.environ["GEMINI_API_KEY"])

def my_tool(arg: str) -> dict:
    """One-line docstring Gemini uses to decide when to call this tool."""
    return {"result": ...}

model = genai.GenerativeModel(
    model_name="gemini-2.5-flash",
    tools=[my_tool, other_tool, ...],   # 4-8 tools per agent
    system_instruction=open("system_prompt.md").read(),
)
chat = model.start_chat(enable_automatic_function_calling=True)
response = chat.send_message("structured request — one shot, not a conversation")
```
