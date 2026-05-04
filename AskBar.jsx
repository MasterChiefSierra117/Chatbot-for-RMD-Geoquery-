// ============================================================================
// AskBar — Natural Language → SQL → Filters
// ============================================================================
// Standalone chatbot component for the GeoQuery RMT dashboard.
//
// USAGE:
//   <AskBar
//     onApply={(filters) => setDashboardFilters(filters)}
//     currentFilterCount={activeFilterCount}
//   />
//
// REPLACING THE PARSER WITH A REAL LLM:
//   The parseQuery() function is the only thing to swap. Replace its body
//   with a fetch() to your LLM endpoint that returns the same shape:
//     { filters, sql, summary, matched }
//   The UI doesn't change.
// ============================================================================

import React, { useState } from "react";
import {
  Search, X, RefreshCw, ArrowUpRight, ChevronRight,
  CheckCircle2, AlertTriangle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Color tokens — replace these with your own design system if needed
// ---------------------------------------------------------------------------
const C = {
  panel:    "#eef0e8",
  panelHi:  "#c9cec0",
  rule:     "#8a9974",
  ruleHi:   "#3d5a1a",
  text:     "#0a1530",
  textDim:  "#2d3a5e",
  textFaint:"#4d5a78",
  amber:    "#16307a",   // primary accent — brand blue
  emerald:  "#2f5418",
  rust:     "#8e2f15",
};

// ---------------------------------------------------------------------------
// Domain vocabularies — adapt to your own schema
// ---------------------------------------------------------------------------
const FOUNDATION_DOMAINS = ["TOPO", "AERO", "MARITIME", "HUMAN_GEO", "TARGET"];
const NSG_MEMBERS = ["NGA", "DIA", "NRO", "USAF", "USA", "USN", "USMC", "USSF", "DOS"];

// ---------------------------------------------------------------------------
// PARSER — pattern-matched NL → structured query.
// Returns { filters, sql, summary, matched }.
// In production, replace the body with an LLM call returning this same shape.
// ---------------------------------------------------------------------------
export function parseQuery(rawInput) {
  const input = rawInput.toLowerCase().trim();
  if (!input) return null;

  const result = {
    filters: { domain: [], aor: [], country: [], fy: [], nsg: [], priority: [], status: [] },
    matched: [],
    sqlWhere: [],
    summary: "",
  };

  // ---- Foundation domains ----
  FOUNDATION_DOMAINS.forEach((d) => {
    const variants = [d.toLowerCase(), d.toLowerCase().replace("_", " "), d.toLowerCase().replace("_", "-")];
    if (variants.some((v) => new RegExp(`\\b${v}\\b`, "i").test(input))) {
      result.filters.domain.push(d);
      result.matched.push({ type: "Domain", value: d });
      result.sqlWhere.push(`foundation_domain = '${d}'`);
    }
  });

  // ---- AORs (combatant commands) ----
  const aorAliases = {
    AFRICOM:   ["africom", "africa", "african"],
    CENTCOM:   ["centcom", "central command", "middle east"],
    EUCOM:     ["eucom", "europe", "european"],
    INDOPACOM: ["indopacom", "pacific", "indo-pacific", "indopac", "asia"],
    NORTHCOM:  ["northcom", "north america"],
    SOUTHCOM:  ["southcom", "south america", "latin america", "caribbean"],
  };
  Object.entries(aorAliases).forEach(([aor, aliases]) => {
    if (aliases.some((a) => new RegExp(`\\b${a}\\b`, "i").test(input))) {
      result.filters.aor.push(aor);
      result.matched.push({ type: "AOR", value: aor });
      result.sqlWhere.push(`aor = '${aor}'`);
    }
  });

  // ---- Countries (by name, GENC alpha-3) ----
  const countryNames = {
    UKR: ["ukraine", "ukrainian"], CHN: ["china", "chinese"], IRN: ["iran", "iranian"],
    PRK: ["north korea", "dprk"],  RUS: ["russia", "russian"], IRQ: ["iraq"],
    SYR: ["syria"],                AFG: ["afghanistan"],       YEM: ["yemen"],
    NGA: ["nigeria"],              KEN: ["kenya"],             ETH: ["ethiopia"],
    COD: ["congo"],                ZAF: ["south africa"],
    DEU: ["germany"],              FRA: ["france"],            GBR: ["united kingdom", "britain", "uk"],
    JPN: ["japan"],                TWN: ["taiwan"],            PHL: ["philippines"],
    VNM: ["vietnam"],              MEX: ["mexico"],            CAN: ["canada"],
    BRA: ["brazil"],               COL: ["colombia"],          VEN: ["venezuela"],
  };
  Object.entries(countryNames).forEach(([code, names]) => {
    if (names.some((n) => new RegExp(`\\b${n}\\b`, "i").test(input))) {
      result.filters.country.push(code);
      result.matched.push({ type: "Country", value: code });
      result.sqlWhere.push(`country = '${code}'`);
    }
  });

  // ---- Unsatisfied / unplanned (computed first so 'unplanned' doesn't match 'planned') ----
  const isUnplanned = /\b(unplanned|deviation|intrusion|off.?plan|not in plan)\b/i.test(input);
  const isUnsatisfied = /\b(unsatisfied|not satisfied|unmet|gap)\b/i.test(input);

  // ---- Status ----
  const statusAliases = {
    "Complete":  ["complete", "completed", "finished", "done"],
    "In Work":   ["in work", "in-work", "in progress", "ongoing", "active"],
    "Planned":   ["planned", "scheduled"],
    "Cancelled": ["cancelled", "canceled"],
    "On Hold":   ["on hold", "paused", "stalled"],
    "Initiated": ["initiated", "started", "kicked off"],
  };
  Object.entries(statusAliases).forEach(([status, aliases]) => {
    if (status === "Planned" && isUnplanned) return; // suppress false match
    if (aliases.some((a) => new RegExp(`\\b${a}\\b`, "i").test(input))) {
      result.filters.status.push(status);
      result.matched.push({ type: "Status", value: status });
      result.sqlWhere.push(`cur_prod_stat = '${status}'`);
    }
  });

  // ---- Fiscal years ----
  ["FY24", "FY25", "FY26"].forEach((fy) => {
    const variants = [fy.toLowerCase(), fy.toLowerCase().replace("fy", "fy "), fy.toLowerCase().replace("fy", "20")];
    if (variants.some((v) => input.includes(v))) {
      result.filters.fy.push(fy);
      result.matched.push({ type: "FY", value: fy });
      result.sqlWhere.push(`fy_cur_prod_stat_code = '${fy}'`);
    }
  });

  // ---- NSG members ----
  NSG_MEMBERS.forEach((m) => {
    if (new RegExp(`\\b${m.toLowerCase()}\\b`, "i").test(input)) {
      result.filters.nsg.push(m);
      result.matched.push({ type: "NSG", value: m });
      result.sqlWhere.push(`nsg_member = '${m}'`);
    }
  });

  // ---- Priority intent ----
  if (/\b(high.?priority|high.?pri|critical|urgent|top.?priority)\b/i.test(input)) {
    result.filters.priority.push("High");
    result.matched.push({ type: "Priority", value: "High Priority" });
    result.sqlWhere.push(`derived_pri = 1`);
  }

  // ---- Append Unsatisfied / Unplanned filter chips ----
  if (isUnsatisfied) {
    result.matched.push({ type: "Filter", value: "Unsatisfied" });
    result.sqlWhere.push(`req_satisfaction <> 'Fully Satisfied'`);
  }
  if (isUnplanned) {
    result.matched.push({ type: "Filter", value: "Unplanned" });
    result.sqlWhere.push(`deviation = 1`);
  }

  // ---- Detect target service from query intent ----
  let targetService = "dash_ProductLines";
  let targetFields = "*";
  if (/\b(requirements?|reqs?|needs?)\b/i.test(input)) {
    targetService = "dash_Requirements";
    targetFields = "requirement_id, nsg_member, need_type, cust_pri, risk_factor, req_satisfaction, derived_pri";
  } else if (/\b(missions?)\b/i.test(input)) {
    targetService = "dash_Missions";
    targetFields = "requirement_id, mission_name, cust_pri, cur_prod_stat";
  } else if (/\b(monthly?|burndown|velocity|trend|over time)\b/i.test(input)) {
    targetService = "dash_Counts";
    targetFields = "month, count_in_work, count_complete, cumulative_complete";
  }

  // ---- Schema-aware SQL: drop clauses that don't apply to the target service ----
  const FIELDS_BY_SERVICE = {
    dash_ProductLines: ["foundation_domain", "aor", "country", "fy_cur_prod_stat_code", "cur_prod_stat", "deviation"],
    dash_Requirements: ["nsg_member", "cur_prod_stat", "derived_pri", "req_satisfaction"],
    dash_Missions:     ["cur_prod_stat", "mission_name"],
    dash_Counts:       ["month"],
  };
  const validFields = FIELDS_BY_SERVICE[targetService];
  const filteredWhere = result.sqlWhere.filter((clause) =>
    validFields.some((f) => clause.startsWith(f))
  );

  // ---- Build SQL ----
  const where = filteredWhere.length ? `\nWHERE ${filteredWhere.join("\n  AND ")}` : "";
  result.sql = `SELECT ${targetFields}\nFROM ${targetService}${where};`;

  // ---- Human-readable summary ----
  if (result.matched.length === 0) {
    result.summary = "I couldn't extract specific filters from that. Try mentioning an AOR, country, status, or domain.";
  } else {
    const parts = result.matched.map((m) => `${m.type}: ${m.value}`).join(" · ");
    result.summary = `Filtering ${targetService.replace("dash_", "").toLowerCase()} by ${parts}.`;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Example queries shown in the dropdown — customize these to fit your demo
// ---------------------------------------------------------------------------
const EXAMPLE_QUERIES = [
  "Show me unplanned production in EUCOM this fiscal year",
  "High-priority unsatisfied requirements from DIA",
  "Complete TOPO products in INDOPACOM",
  "All in-work missions for Ukraine",
  "Monthly burndown for AERO domain",
];

// ---------------------------------------------------------------------------
// AskBar component
// ---------------------------------------------------------------------------
export default function AskBar({ onApply, currentFilterCount = 0 }) {
  const [input, setInput] = useState("");
  const [parsed, setParsed] = useState(null);
  const [thinking, setThinking] = useState(false);
  const [showExamples, setShowExamples] = useState(false);

  const handleSubmit = (queryText) => {
    const q = queryText !== undefined ? queryText : input;
    if (!q.trim()) return;
    setInput(q);
    setThinking(true);
    setParsed(null);
    setShowExamples(false);
    // Realistic delay so the AI feels like it's "thinking"
    setTimeout(() => {
      const result = parseQuery(q);
      setParsed(result);
      setThinking(false);
    }, 650);
  };

  const handleApply = () => {
    if (!parsed) return;
    onApply(parsed.filters);
    setInput("");
    setParsed(null);
  };

  const handleClear = () => {
    setInput("");
    setParsed(null);
    setShowExamples(false);
  };

  return (
    <div
      className="relative"
      style={{
        background: C.panel,
        border: `1.5px solid ${C.ruleHi}`,
        borderRadius: "10px",
      }}
    >
      {/* Input row */}
      <div className="flex items-center gap-3 px-5 py-4">
        <div
          className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-md"
          style={{ background: C.amber }}
        >
          <Search size={18} color="#ffffff" strokeWidth={2.4} />
        </div>
        <div className="flex-shrink-0">
          <div className="text-[11px] font-mono uppercase tracking-[0.16em] font-bold" style={{ color: C.amber }}>
            Ask GeoQuery
          </div>
          <div className="text-[11px] font-mono" style={{ color: C.textDim }}>
            Natural language → SQL → filters
          </div>
        </div>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setShowExamples(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
            if (e.key === "Escape") handleClear();
          }}
          placeholder='e.g. "Show me high-priority unsatisfied requirements in EUCOM"'
          className="flex-1 bg-transparent outline-none text-[15px] px-3 py-2 font-medium"
          style={{
            color: C.text,
            borderLeft: `1px solid ${C.rule}`,
          }}
        />
        {input && !thinking && (
          <button
            onClick={handleClear}
            className="flex-shrink-0 p-1.5 hover:opacity-70"
            style={{ color: C.textDim }}
            aria-label="Clear"
          >
            <X size={16} />
          </button>
        )}
        <button
          onClick={() => handleSubmit()}
          disabled={!input.trim() || thinking}
          className="flex-shrink-0 flex items-center gap-2 px-4 py-2 text-[12px] font-mono uppercase tracking-wider font-bold"
          style={{
            background: input.trim() && !thinking ? C.amber : C.rule,
            color: input.trim() && !thinking ? "#ffffff" : C.textFaint,
            border: "none",
            cursor: input.trim() && !thinking ? "pointer" : "not-allowed",
            borderRadius: "6px",
          }}
        >
          {thinking ? (
            <>
              <RefreshCw size={13} className="animate-spin" />
              Parsing
            </>
          ) : (
            <>
              <ArrowUpRight size={13} strokeWidth={2.5} />
              Run
            </>
          )}
        </button>
      </div>

      {/* Example queries dropdown */}
      {showExamples && !parsed && !thinking && (
        <div
          className="absolute left-0 right-0 mt-1 z-50 px-5 py-3"
          style={{
            background: C.panel,
            border: `1px solid ${C.ruleHi}`,
            borderRadius: "8px",
            boxShadow: "0 6px 20px rgba(13,31,71,0.18)",
          }}
        >
          <div className="text-[11px] font-mono uppercase tracking-[0.16em] font-bold mb-2" style={{ color: C.textDim }}>
            Try one of these
          </div>
          <div className="space-y-1">
            {EXAMPLE_QUERIES.map((q, i) => (
              <button
                key={i}
                onClick={() => handleSubmit(q)}
                onMouseDown={(e) => e.preventDefault()}
                className="w-full text-left px-3 py-2 text-[13px] hover:bg-black/5 flex items-center gap-2 group"
                style={{ color: C.text, borderRadius: "4px" }}
              >
                <ChevronRight size={13} style={{ color: C.amber }} />
                <span className="font-medium">{q}</span>
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowExamples(false)}
            className="text-[11px] font-mono uppercase tracking-wider mt-2 font-semibold"
            style={{ color: C.textFaint }}
          >
            Close
          </button>
        </div>
      )}

      {/* Parsed result */}
      {parsed && (
        <div style={{ borderTop: `1px solid ${C.rule}`, background: C.panelHi }}>
          <div className="px-5 py-4">
            {/* Summary */}
            <div className="flex items-start gap-3 mb-3">
              <div
                className="flex-shrink-0 mt-0.5 w-5 h-5 flex items-center justify-center rounded-full"
                style={{ background: parsed.matched.length > 0 ? C.emerald : C.rust }}
              >
                {parsed.matched.length > 0 ? (
                  <CheckCircle2 size={12} color="#ffffff" strokeWidth={3} />
                ) : (
                  <AlertTriangle size={12} color="#ffffff" strokeWidth={2.5} />
                )}
              </div>
              <div className="flex-1">
                <div className="text-[11px] font-mono uppercase tracking-[0.16em] font-bold mb-1" style={{ color: C.textDim }}>
                  Interpreted Query
                </div>
                <div className="text-[14px] font-serif" style={{ color: C.text }}>
                  {parsed.summary}
                </div>
              </div>
            </div>

            {/* Matched filter chips */}
            {parsed.matched.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {parsed.matched.map((m, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono font-semibold uppercase tracking-wider"
                    style={{
                      background: "#ffffff",
                      border: `1px solid ${C.amber}`,
                      color: C.amber,
                      borderRadius: "4px",
                    }}
                  >
                    <span style={{ color: C.textFaint, fontWeight: 500 }}>{m.type}:</span>
                    {m.value}
                  </span>
                ))}
              </div>
            )}

            {/* Generated SQL */}
            <div className="mb-3">
              <div className="text-[11px] font-mono uppercase tracking-[0.16em] font-bold mb-1.5" style={{ color: C.textDim }}>
                Generated SQL
              </div>
              <pre
                className="text-[12px] font-mono leading-relaxed overflow-x-auto px-3 py-2.5"
                style={{
                  background: "#0a1530",
                  color: "#c6d4a8",
                  borderRadius: "6px",
                  border: `1px solid ${C.ruleHi}`,
                }}
              >
                {parsed.sql.split("\n").map((line, i) => {
                  // Naive SQL syntax highlight
                  const highlighted = line
                    .replace(/(SELECT|FROM|WHERE|AND|OR|=|<>|IN|LIKE)/g, '§KW§$1§/KW§')
                    .replace(/('[^']*')/g, '§ST§$1§/ST§');
                  const segments = highlighted.split(/(§(?:KW|ST)§.*?§\/(?:KW|ST)§)/);
                  return (
                    <div key={i}>
                      {segments.map((seg, j) => {
                        if (seg.startsWith("§KW§")) {
                          return <span key={j} style={{ color: "#e6c547", fontWeight: 600 }}>{seg.replace(/§\/?KW§/g, "")}</span>;
                        }
                        if (seg.startsWith("§ST§")) {
                          return <span key={j} style={{ color: "#9bbf3f" }}>{seg.replace(/§\/?ST§/g, "")}</span>;
                        }
                        return <span key={j}>{seg}</span>;
                      })}
                    </div>
                  );
                })}
              </pre>
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-mono" style={{ color: C.textFaint, fontStyle: "italic" }}>
                {parsed.matched.length > 0
                  ? `${parsed.matched.length} filter${parsed.matched.length === 1 ? "" : "s"} extracted${currentFilterCount > 0 ? ` · will replace ${currentFilterCount} active filter${currentFilterCount === 1 ? "" : "s"}` : ""}`
                  : "Refine your question and try again"}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleClear}
                  className="px-3 py-1.5 text-[12px] font-mono uppercase tracking-wider font-semibold hover:opacity-70"
                  style={{ color: C.textDim, background: "transparent", border: `1px solid ${C.rule}`, borderRadius: "4px" }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleApply}
                  disabled={parsed.matched.length === 0}
                  className="flex items-center gap-2 px-4 py-1.5 text-[12px] font-mono uppercase tracking-wider font-bold"
                  style={{
                    background: parsed.matched.length > 0 ? C.amber : C.rule,
                    color: parsed.matched.length > 0 ? "#ffffff" : C.textFaint,
                    border: "none",
                    cursor: parsed.matched.length > 0 ? "pointer" : "not-allowed",
                    borderRadius: "4px",
                  }}
                >
                  Apply Filters
                  <ArrowUpRight size={13} strokeWidth={2.5} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
