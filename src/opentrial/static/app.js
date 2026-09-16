(() => {
  "use strict";
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const form = $("#design-form");
  const field = name => form.elements.namedItem(name);
  const value = name => field(name).value.trim();
  const number = name => Number(value(name));
  const checked = name => field(name).checked;
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[c]));
  const percent = (value, digits = 1) => `${(value * 100).toFixed(digits)}%`;
  const fixed = (value, digits = 3) => Number(value).toFixed(digits);
  const sourceNames = {
    "Seeded demo (T2D / HbA1c, offline)": ["Seeded demo", "T2D / HbA1c · Illustrative, offline", null],
    "ClinicalTrials.gov": ["ClinicalTrials.gov", "Trial precedent", "clinicaltrials"],
    "PubMed": ["PubMed", "Published literature", "pubmed"],
    "openFDA (safety)": ["openFDA", "Safety context", "openfda"],
    "DailyMed (labels)": ["DailyMed", "Drug label context", "dailymed"],
    "Semantic Scholar": ["Semantic Scholar", "Academic literature", "semantic_scholar"],
    "Open Targets (biology)": ["Open Targets", "Disease-target biology", "opentargets"],
    "PharmGKB (pharmacogenomics)": ["PharmGKB", "Drug-gene context", "pharmgkb"],
    "You.com (web)": ["You.com", "Exploratory web context", "you"],
  };
  let config = null, result = null, pdf = null, submitted = null, busy = false, toastTimer;
  const initialForm = Object.fromEntries(new FormData(form));

  function route() {
    const view = ["design", "results", "integrations"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "design";
    $$('[data-view]').forEach(section => { section.hidden = section.dataset.view !== view; });
    $$('[data-route]').forEach(link => {
      if (link.dataset.route === view) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    $("#breadcrumb-current").textContent = {design: "Trial design", results: "Design results", integrations: "Integrations"}[view];
    document.title = `OpenTrial | ${{design: "Trial design", results: "Results", integrations: "Integrations"}[view]}`;
    window.scrollTo({top: 0, behavior: "instant"});
  }

  function requestPayload() {
    return {
      design: {
        indication: value("indication"), endpoint: value("endpoint"), endpoint_type: value("endpoint_type"),
        target_effect: number("target_effect"), endpoint_sd: number("endpoint_sd"),
        alpha: number("alpha"), desired_power: number("desired_power") / 100,
        max_n_per_arm: number("max_n_per_arm"), dropout_rate: number("dropout_rate") / 100,
        baseline_proportion: number("baseline_proportion") / 100, decision_threshold: number("decision_threshold"),
      },
      drug_or_class: value("drug_or_class"),
      evidence_sources: $$("input[name='source']:checked").map(input => input.value),
      options: {
        use_mc_operating_characteristics: checked("use_mc_operating_characteristics"),
        use_prior_sensitivity: checked("use_prior_sensitivity"), use_bayesian_prior: checked("use_bayesian_prior"),
        use_gemini_narrative: checked("use_gemini_narrative"), use_group_sequential: checked("use_group_sequential"),
        gs_boundary: value("gs_boundary"), gs_n_looks: number("gs_n_looks"), tau_method: value("tau_method"),
        audit_nct_id: value("audit_nct_id"), audit_pmid: value("audit_pmid"),
      },
    };
  }

  function updateSummary() {
    $("#summary-indication").textContent = value("indication") || "Not specified";
    $("#summary-endpoint").textContent = value("endpoint") || "Not specified";
    $("#summary-type").textContent = `Two-arm · ${value("endpoint_type") === "binary" ? "Binary" : "Continuous"}`;
    $("#summary-power").textContent = `${value("desired_power") || "—"}%`;
    $("#summary-alpha").textContent = value("alpha") || "—";
    $("#summary-n").textContent = value("max_n_per_arm") || "—";
    const sources = $$("input[name='source']:checked").map(input => input.value);
    $("#summary-sources").textContent = sources.length === 1 && sources[0] === config?.demo_source ? "Seeded demo · Offline" : sources.length ? `${sources.length} selected source${sources.length > 1 ? "s" : ""}` : "None · Fallback prior";
    $("#source-note").textContent = !sources.length ? "With no sources selected, the engine uses a weakly informative fallback prior." : sources.includes(config?.demo_source) ? "The seeded demo is illustrative T2D / HbA1c evidence. Use relevant sources for other studies." : "Only usable effect estimates inform the prior. Other records provide context.";
    const rate = number("baseline_proportion") / 100 + number("target_effect");
    const invalidBinary = value("endpoint_type") === "binary" && !(rate > 0 && rate < 1);
    field("target_effect").setCustomValidity(invalidBinary ? "The control event rate plus the target risk difference must be below 100%." : "");
    $("#binary-rate").textContent = `Implied treatment rate: ${percent(rate, 0)}. Must be below 100%.`;
    if (result) {
      const stale = JSON.stringify(requestPayload()) !== submitted;
      $("#stale-notice").hidden = !stale;
      if (!busy) $("#run-status").textContent = stale ? "Inputs changed. Generate an updated report." : "Report ready. You can refine your design.";
    }
  }

  function syncEndpoint(changeDefaults = false) {
    const binary = value("endpoint_type") === "binary";
    $("#sd-field").hidden = binary;
    $("#baseline-field").hidden = !binary;
    field("endpoint_sd").disabled = binary;
    field("baseline_proportion").disabled = !binary;
    $("#effect-label").textContent = binary ? "Target risk difference" : "Target treatment effect";
    $("#effect-hint").textContent = binary ? "Absolute difference in proportions (0.15 = 15 percentage points)." : "Difference to detect, in the endpoint’s own units.";
    field("target_effect").min = binary ? "0.01" : "0.05";
    field("target_effect").max = binary ? "0.95" : "2";
    if (changeDefaults) field("target_effect").value = binary ? "0.15" : "0.50";
  }

  function syncSequential() {
    const enabled = checked("use_group_sequential");
    $("#sequential-options").hidden = !enabled;
    field("gs_boundary").disabled = !enabled;
    field("gs_n_looks").disabled = !enabled;
  }

  function renderSources(names, target) {
    $(target).innerHTML = names.map(name => {
      const [label, description, key] = sourceNames[name];
      const available = !key || config.integrations.some(item => item.key === key && item.connected);
      const note = available ? description : `${description} · Not configured`;
      return `<label class="source-option"><input type="checkbox" name="source" value="${escape(name)}" ${name === config.demo_source ? "checked" : ""} ${available ? "" : "disabled"}><span><strong>${escape(label)}</strong><small>${escape(note)}</small></span></label>`;
    }).join("");
  }

  async function connect() {
    $("#retry-connect").hidden = true;
    $("#form-error").hidden = true;
    try {
      const response = await fetch("/api/config", {signal: AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error("Connection failed");
      config = await response.json();
      renderSources(config.core_sources, "#core-sources");
      renderSources(config.extra_sources, "#extra-sources");
      const gemini = config.integrations.some(item => item.key === "gemini" && item.connected);
      field("use_gemini_narrative").disabled = !gemini;
      $("#gemini-hint").textContent = gemini ? "Add an AI-written narrative. The statistical results remain unchanged." : "Available when a Gemini key is configured.";
      $("#integration-list").innerHTML = config.integrations.map(item => `<article class="integration-card"><div class="integration-card-top"><span class="integration-monogram" aria-hidden="true">${escape({clinicaltrials: "CT", pubmed: "PM", openfda: "FDA", dailymed: "DM", opentargets: "OT", pharmgkb: "PG", semantic_scholar: "S²", you: "Y", gemini: "G"}[item.key])}</span><span class="integration-state ${item.connected ? "available" : ""}">${item.connected ? "Configured" : item.status === "missing key" ? "Key required" : "Disabled"}</span></div><h2>${escape(item.name)}</h2><p>${escape(item.purpose)}</p></article>`).join("");
      $("#generate").disabled = false;
      $("#run-status").textContent = "Ready when you are. Start with the demo.";
      updateSummary();
    } catch {
      $("#run-status").textContent = "Your local engine is not connected.";
      $("#form-error").textContent = "Start the app with python serve.py from your OpenTrial folder, then reconnect.";
      $("#form-error").hidden = false;
      $("#retry-connect").hidden = false;
      $("#integration-list").textContent = "Connect the local engine to view source availability.";
    }
  }

  function notice(message) {
    clearTimeout(toastTimer);
    $("#toast").textContent = message;
    $("#toast").hidden = false;
    toastTimer = setTimeout(() => { $("#toast").hidden = true; }, 4200);
  }

  function metric(label, value, detail = "") {
    return `<div><span class="metric-label">${escape(label)}</span><strong class="metric-value ${String(value).length > 10 ? "word-value" : ""}">${escape(value)}</strong><span class="metric-detail">${escape(detail)}</span></div>`;
  }

  function table(headers, rows, recommendedIndex = -1) {
    return `<table><thead><tr>${headers.map(text => `<th scope="col">${escape(text)}</th>`).join("")}</tr></thead><tbody>${rows.map((row, index) => `<tr ${index === recommendedIndex ? 'class="recommended"' : ""}>${row.map(text => `<td>${escape(text)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }

  function safeLink(url, title) {
    try {
      const parsed = new URL(url);
      if (["http:", "https:"].includes(parsed.protocol)) return `<a href="${escape(parsed.href)}" target="_blank" rel="noopener noreferrer">${escape(title)} <span aria-hidden="true">↗</span></a>`;
    } catch {}
    return escape(title);
  }

  function evidenceCards(records) {
    if (!records.length) return '<p class="muted">No evidence records were gathered for this report.</p>';
    return records.map(record => `<article class="evidence-record"><div class="evidence-meta"><span>${escape(record.source)}</span><span>${record.year}</span><span>${escape(record.evidence_kind.replaceAll("_", " "))}</span></div><h3>${safeLink(record.url, record.title)}</h3><div class="evidence-meta">${record.evidence_kind === "effect_estimate" ? `<span>Effect ${fixed(record.effect)}</span><span>SE ${fixed(record.standard_error)}</span><span>N = ${record.n}</span>` : "<span>Context record · Not an effect estimate</span>"}</div>${record.notes ? `<p>${escape(record.notes)}</p>` : ""}</article>`).join("");
  }

  // Small, safe renderer for the engine's report format. Raw HTML is always escaped.
  function markdown(text) {
    const inline = raw => {
      const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
      let output = "", start = 0;
      for (const match of raw.matchAll(linkPattern)) {
        output += escape(raw.slice(start, match.index));
        output += safeLink(match[2], match[1]);
        start = match.index + match[0].length;
      }
      output += escape(raw.slice(start));
      return output.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
    };
    const lines = text.split("\n");
    let output = "", listOpen = false;
    const closeList = () => { if (listOpen) { output += "</ul>"; listOpen = false; } };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("|")) {
        closeList();
        const rows = [];
        while (i < lines.length && lines[i].trim().startsWith("|")) {
          const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
          if (!cells.every(cell => /^:?-+:?$/.test(cell))) rows.push(cells);
          i++;
        }
        i--;
        const head = rows.shift() || [];
        output += `<div class="table-scroll" tabindex="0" role="region" aria-label="Report data"><table><thead><tr>${head.map(cell => `<th scope="col">${inline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
      } else if (line.startsWith("- ")) {
        if (!listOpen) { output += "<ul>"; listOpen = true; }
        output += `<li>${inline(line.slice(2))}</li>`;
      } else {
        closeList();
        const heading = line.match(/^(#{1,4})\s+(.+)$/);
        if (heading) output += `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`;
        else if (line) output += `<p>${inline(line)}</p>`;
      }
    }
    closeList();
    return output;
  }

  function renderReport() {
    const r = result, d = r.design, rec = r.recommendation;
    $("#results-empty").hidden = true;
    $("#report-content").hidden = false;
    $("#results-dot").hidden = false;
    $("#latest-report").hidden = false;
    $("#stale-notice").hidden = false;
    $("#results-lede").textContent = `${d.indication} · ${d.endpoint}`;
    $("#report-warnings").innerHTML = r.warnings.map(message => `<div class="notice warning">${escape(message)}</div>`).join("");
    $("#result-metrics").innerHTML = metric("Recommended enrollment / arm", rec?.n_per_arm ?? "Not reached", rec ? `${rec.n_per_arm * 2} participants total${d.dropout_rate ? ` · ${percent(d.dropout_rate, 0)} dropout planned` : ""}` : `Up to ${d.max_n_per_arm} per arm tested`) + metric("Power at recommended N", rec ? percent(rec.power) : "—", `${percent(d.desired_power, 0)} target power`) + metric("Bayesian assurance", rec ? percent(rec.assurance) : "—", "Success averaged over the prior") + metric("Evidence records", r.evidence.length, `${r.prior.records_used} used in the prior`);
    $("#calculation-label").textContent = r.request.options.use_mc_operating_characteristics ? "Monte Carlo" : "Analytic";
    window.renderPowerChart($("#power-chart"), r);
    $("#operating-table").innerHTML = table(["N / arm", "Power", "Beta", "Type I error", "Assurance"], r.grid.map(point => [point.n_per_arm, percent(point.power), percent(point.beta), percent(point.type_i_error, 2), percent(point.assurance)]), r.grid.findIndex(point => point.n_per_arm === rec?.n_per_arm));
    $("#decision-section").hidden = !r.decision;
    if (r.decision) {
      const dec = r.decision;
      $("#decision-description").textContent = `Evaluated at ${dec.n_per_arm} participants per arm. Success requires posterior Pr(effect > 0) ≥ ${fixed(dec.decision_threshold)}.`;
      $("#decision-metrics").innerHTML = metric("Posterior Pr(effect > 0)", percent(dec.posterior_success_probability)) + metric("Predictive probability of success", percent(dec.predictive_probability_of_success)) + metric("Meets decision threshold", dec.meets_decision_threshold ? "Yes" : "No");
    }
    $("#sensitivity-section").hidden = !r.sensitivity.length;
    $("#sensitivity-table").innerHTML = table(["Prior", "Mean", "SD", "Assurance", "Predictive success", "Posterior Pr(>0)"], r.sensitivity.map(s => [s.label, fixed(s.prior.mean), fixed(s.prior.sd), percent(s.assurance), percent(s.predictive_probability_of_success), percent(s.posterior_success_probability)]));
    $("#sequential-section").hidden = !r.group_sequential;
    if (r.group_sequential) {
      const gs = r.group_sequential;
      $("#sequential-summary").textContent = `${gs.boundary === "pocock" ? "Pocock" : "O’Brien–Fleming"} · ${gs.n_looks} looks · Simulated Type I error ${fixed(gs.type_i_error)} · Power ${percent(gs.power)} · Expected N/arm ${gs.expected_n_per_arm_alt.toFixed(0)} vs ${gs.fixed_n_per_arm} fixed (${percent(gs.expected_reduction_vs_fixed, 0)} reduction).`;
      $("#sequential-table").innerHTML = table(["Look", "Information", "N / arm", "Efficacy z", "Cumulative stop (alt)"], gs.looks.map(look => [look.look, percent(look.information_fraction, 0), look.n_per_arm, fixed(look.efficacy_z), percent(look.cumulative_stop_prob_alt)]));
    }
    $("#evidence-count").textContent = `${r.evidence.length} records`;
    $("#source-outcomes").innerHTML = r.source_outcomes.map(outcome => `<span class="outcome ${escape(outcome.status)}" title="${escape(outcome.message || "")}">${escape(sourceNames[outcome.name]?.[0] || outcome.name)} · ${outcome.status === "failed" ? "Failed" : `${outcome.n_records} records`}</span>`).join("");
    $("#evidence-records").innerHTML = evidenceCards(r.evidence);
    $("#audit-section").hidden = !r.audit_records.length;
    $("#audit-records").innerHTML = evidenceCards(r.audit_records);
    $("#report-document").innerHTML = markdown(r.report_markdown);
    $("#prior-details").innerHTML = [["Mean", fixed(r.prior.mean)], ["Standard deviation", fixed(r.prior.sd)], ["Records used", r.prior.records_used], ["Duplicates merged", r.prior.records_merged], ["Participants in evidence", r.prior.pooled_participants], ["Method", r.prior.method]].map(([label, text]) => `<div><dt>${escape(label)}</dt><dd>${escape(text)}</dd></div>`).join("");
    $("#report-stamp").textContent = `Generated ${new Date().toLocaleString(undefined, {dateStyle: "medium", timeStyle: "short"})}. Results remain available in this tab until you start a new design or reload.`;
    $('[data-download="pdf"]').disabled = !pdf;
    $("#pdf-note").hidden = Boolean(pdf);
  }

  function toggleBusy(active) {
    busy = active;
    $("#generate").disabled = active || !config;
    $("#generate").setAttribute("aria-busy", String(active));
    $("#generate span").textContent = active ? "Generating report…" : "Generate design report";
    $("#new-design").disabled = active;
    $("#load-demo").disabled = active;
    // Keep the report's submitted assumptions fixed while a run is in progress.
    $$("#design-form input, #design-form select, #design-form fieldset").forEach(input => {
      if (active) { input.dataset.previouslyDisabled = String(input.disabled); input.disabled = true; }
      else { input.disabled = input.dataset.previouslyDisabled === "true"; delete input.dataset.previouslyDisabled; }
    });
  }

  async function generate(event) {
    event.preventDefault();
    if (busy || !config) return;
    const payload = requestPayload();
    $("#form-error").hidden = true;
    toggleBusy(true);
    $("#run-status").textContent = "Gathering evidence and computing your design…";
    const slowTimer = setTimeout(() => { $("#run-status").textContent = "Still working. Live sources and simulations can take a little longer."; }, 8000);
    let succeeded = false;
    try {
      const response = await fetch("/api/design", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload)});
      const data = await response.json();
      if (!response.ok) throw new Error([data.error, ...(data.details || []).map(issue => `${issue.field.replace(/^design\.|^options\./g, "").replaceAll("_", " ")}: ${issue.message}`)].join(" "));
      result = data.result;
      pdf = data.pdf_base64;
      submitted = JSON.stringify(payload);
      renderReport();
      location.hash = "results";
      route();
      $("#results-heading").setAttribute("tabindex", "-1");
      $("#results-heading").focus({preventScroll: true});
      succeeded = true;
    } catch (error) {
      $("#form-error").textContent = error instanceof TypeError ? "Connection lost. Check that the local server is running, then try again." : error.message;
      $("#form-error").hidden = false;
      $("#form-error").focus();
      $("#run-status").textContent = "Report generation did not finish. Your inputs are still here.";
    } finally {
      clearTimeout(slowTimer);
      toggleBusy(false);
      if (succeeded) updateSummary();
    }
  }

  function reset() {
    form.reset();
    Object.entries(initialForm).forEach(([name, val]) => { if (field(name) && field(name).type !== "checkbox") field(name).value = val; });
    result = null; pdf = null; submitted = null;
    $("#report-content").hidden = true;
    $("#results-empty").hidden = false;
    $("#results-dot").hidden = true;
    $("#latest-report").hidden = true;
    $("#form-error").hidden = true;
    $("#results-lede").textContent = "The evidence, assumptions, and numbers behind your next study.";
    $("#run-status").textContent = config ? "Ready when you are. Start with the demo." : "Your local engine is not connected.";
    syncEndpoint(); syncSequential(); updateSummary();
    location.hash = "design"; route();
    notice("Demo defaults loaded. Ready for a new design.");
  }

  function requestReset() {
    const changed = Object.entries(initialForm).some(([name, val]) => field(name)?.value !== val) || $$("input[type='checkbox']:checked").some(input => input.name !== "source") || $$("input[name='source']:checked").map(input => input.value).join("") !== config?.demo_source;
    if (result || changed) $("#reset-dialog").showModal(); else reset();
  }

  function download(format) {
    if (!result) return;
    let data, type, extension;
    if (format === "pdf") {
      if (!pdf) return;
      data = Uint8Array.from(atob(pdf), char => char.charCodeAt(0)); type = "application/pdf"; extension = "pdf";
    } else if (format === "json") {
      data = JSON.stringify(result, null, 2); type = "application/json"; extension = "json";
    } else {
      data = result.report_markdown; type = "text/markdown;charset=utf-8"; extension = "md";
    }
    const url = URL.createObjectURL(new Blob([data], {type}));
    const link = document.createElement("a");
    link.href = url; link.download = `opentrial_design_report.${extension}`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    notice(`${format === "markdown" ? "Markdown" : format.toUpperCase()} download started.`);
  }

  form.addEventListener("submit", generate);
  form.addEventListener("input", updateSummary);
  form.addEventListener("change", updateSummary);
  form.addEventListener("invalid", event => {
    let parent = event.target.parentElement;
    while (parent && parent !== form) { if (parent.tagName === "DETAILS") parent.open = true; parent = parent.parentElement; }
  }, true);
  field("endpoint_type").addEventListener("change", () => { syncEndpoint(true); updateSummary(); });
  field("use_group_sequential").addEventListener("change", syncSequential);
  $("#new-design").addEventListener("click", requestReset);
  $("#load-demo").addEventListener("click", requestReset);
  $("#reset-dialog").addEventListener("close", () => { if ($("#reset-dialog").returnValue === "reset") reset(); });
  $("#retry-connect").addEventListener("click", connect);
  $$("[data-download]").forEach(button => button.addEventListener("click", () => download(button.dataset.download)));
  window.addEventListener("hashchange", route);
  route(); syncEndpoint(); syncSequential(); connect();
})();
