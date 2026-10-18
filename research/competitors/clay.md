# Clay.com — Competitor Research

> Source: Official website (clay.com), public product pages, public case studies, public marketing copy, customer testimonials. All findings are public and authorized.
> Last updated: 2026-10-18

---

## 1. USER JOURNEY

**OBSERVED** — Clay positions as "GTM Infrastructure" for engineers and sophisticated operators. The user journey: build a "play" (workflow) on a visual canvas → connect data sources → agents research/enrich/score leads → actions trigger outreach or CRM updates.

**OBSERVED** — Core concept: "Audiences" hold data; "Workflows" act on data. Workflows trigger when records enter or change in a segment.

**OBSERVED** — Clay's ideal user is a "GTM engineer" — someone comfortable with code nodes, visual builders, and AI agent configuration. SOURCE: "Build code into workflows to run complex logic."

**INFERRED** — Less technical users use natural-language prompts or templates to build workflows. SOURCE: "Build and ship workflows using natural language prompts in Clay."

---

## 2. SCORING / QUALIFICATION

**OBSERVED** — Clay has "Account and lead scoring" as a feature. Scoring is configurable via workflow — users define conditions (PLG user, sales roles, revenue thresholds) and assign tiers (T1, T2, T3).

**OBSERVED** — Lead scoring example from Clay's marketing: accounts scored T1/T2/T3 based on PLG user count, revenue, and sales roles. SOURCE: Clay homepage lead scoring tab.

**OBSERVED** — "Enrich, score, and route every lead to the right rep in minutes" — inbound scoring is automated in workflows.

**INFERRED** — Scoring is user-defined (not AI-learned like Apollo). Users build scoring formulas with conditions and weights.

---

## 3. ENRICHMENT / RESEARCH WORKFLOW

**OBSERVED** — Clay has a "Data Marketplace" with 200+ data and AI vendors. One contract covers all providers. SOURCE: "Get data from the most complete data marketplace."

**OBSERVED** — "Claygent" AI research agents: "Run GTM plays with agents that understand your business and accounts. Turn context into research, scoring, and personalized outreach."

**OBSERVED** — Waterfall enrichment is standard — sequential lookup across providers.

**OBSERVED** — CRM enrichment: "Keep CRM records accurate, complete, and continuously refreshed with live data."

**OBSERVED** — Anthropic case study: "3x our enrichment rate with Clay's combination of data providers vs. our previous solution."

---

## 4. MESSAGING / SEQUENCING

**OBSERVED** — Clay has an "Email sequencer" feature (listed in product schema).

**OBSERVED** — Outbound is AI-personalized: "Research each account, find five ICP-fit people, and write an outbound-ready list with a message for each." SOURCE: Clay homepage.

**INFERRED** — Clay does not have its own dialer or calling. It triggers sequences via integrations (to Smartlead, Apollo, etc.).

**OBSERVED** — "Signal-based outbound": build qualification and research steps into signal-based outbound for instant, personalized outreach.

---

## 5. LEAD DETAIL PAGE

**OBSERVED** — Clay's "Audiences" are table views of leads/accounts with custom columns, filters, and segments.

**OBSERVED** — Each record shows enriched data, scoring tier, signals, and last engagement.

**INFERRED** — Detail is likely a side-panel or expanded row rather than a dedicated page, given the spreadsheet-first UX.

---

## 6. REP DASHBOARD

**OBSERVED** — Clay is not rep-centric; it's operator-centric. Reps benefit from Clay via enriched CRM records and triggered outreach, but Clay itself is the builder's tool.

**INFERRED** — Reps do not log into Clay daily. The output of Clay (scored lists, enriched records, triggered sequences) surfaces in their existing tools (CRM, email).

---

## 7. ADMIN / TEAM VISIBILITY

**OBSERVED** — Workflow observability: "Bulk trace records to quickly spot why logic or agents make unexpected decisions."

**OBSERVED** — "Observe to iterate faster" — debugging tools show exact path a record took through a workflow, including agent reasoning at each step.

**INFERRED** — Admins can see workflow run counts, success/failure rates, and credit consumption.

---

## 8. PIPELINE STATES

**OBSERVED** — Clay does not have native pipeline/CRM. It syncs to CRM.

**INFERRED** — Pipeline states are managed in the connected CRM (Salesforce, HubSpot). Clay writes to them via workflow actions.

---

## 9. LOADING / ERROR / EMPTY STATES

**OBSERVED** — Workflow-level error handling: built-in logging and auditability for what happened or failed.

**INFERRED** — Empty states in audiences are likely addressed with "suggested plays" or templates.

---

## 10. STRONGEST UX IDEAS

1. **Visual workflow canvas** — Build GTM plays by connecting nodes. Accessible to non-developers.
2. **Agent observability** — Bulk trace records through workflows with full reasoning visibility. Huge debugging advantage.
3. **Data marketplace** — One contract, 200+ vendors. Eliminates vendor management overhead.
4. **Signal-based triggers** — Workflows fire on real-time events (job changes, intent signals), not just batch schedules.
5. **Rep productivity agents** — "Automate research, prep, and follow-ups to let reps spend time closing deals."
6. **Natural language builder** — Build workflows by describing them in plain English.

---

## 11. WEAK / OVERCOMPLICATED AREAS

1. **Steep learning curve** — Visual workflows + agents + code nodes + 200+ data sources = high complexity. SOURCE: Clay positions for "GTM engineers," not average reps.
2. **Credit-based pricing** — Enrichment and AI usage consume credits; cost is unpredictable at scale.
3. **No native execution** — Clay triggers outreach in other tools (Smartlead, Apollo). It's an orchestration layer, not a standalone.
4. **Cold start** — Workflows require significant setup before delivering value. Not a "sign up and go" product.

---

## 12. WHAT RELAY SHOULD ADOPT

| Idea | Why | Priority |
|------|-----|----------|
| **Agent observability** | Seeing why an agent made a decision (with evidence) is a debugging superpower. Relay's intelligence should expose reasoning. | P0 |
| **Signal-based triggers** | Real-time lead scoring on job changes, intent, etc. — not nightly batch jobs. | P0 |
| **Workflow traceability** | "What happened to this lead?" is a common admin question. Clay answers it well. | P1 |
| **Data marketplace integration** | Relay could aggregate enrichment sources behind one API key. | P1 |
| **Natural language scoring builder** | "Score leads that are VP+ at companies with 50+ engineers" — no formula UI needed. | P2 |

---

## 13. WHAT RELAY SHOULD AVOID

| Idea | Why |
|------|-----|
| **Building a visual workflow canvas** | Clay's core differentiator; Relay should be opinionated, not configurable. |
| **Orchestration-only model** (no native execution) | Relay should own the end-to-end experience for its niche. |
| **Credit-based pricing** | Confusing for customers; hard to predict costs. |
| **Targeting "GTM engineers"** | Relay's users are reps and founders, not ops specialists. |

---

## 14. EVIDENCE / SCREEN REFERENCES

- Clay homepage: "GTM Infrastructure" positioning, workflow canvas visuals
- Clay homepage: Lead scoring tab (T1/T2/T3 tiers with formula builder)
- Clay homepage: Automated inbound tab (enrich, score, route)
- Clay homepage: Rep productivity tab (Slack brief from Clay Agent, agent builder)
- Clay workflows page: "Observe to iterate faster" — bulk trace records
- Clay workflows page: "Build code into workflows" — extensibility
- Case studies: Anthropic (3x enrichment), Intercom (+140% pipeline), Vanta (3x reply rate), Rippling (2x demos)
- Customer quote (Vanta CRO): "Clay should be an essential pillar of every company's GTM stack"
