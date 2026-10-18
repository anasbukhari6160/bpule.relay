# Clay.com — REA Analysis

> REA USED: YES
> Tool: `rea inspect-web-page` + `rea list-browser-targets`
> Target: https://www.clay.com/ (public homepage, no auth)
> Evidence: accessibility tree (4252 DOM nodes), scripts (30), navigation (76 items), public text
> Last updated: 2026-10-18

---

## PRODUCT ARCHITECTURE

**OBSERVED** (accessibility tree, navigation):
- Positioned as "GTM Infrastructure" — "Infrastructure to get any data, run agentic workflows, and launch GTM plays"
- 500,000+ GTM teams trusted
- Core tabs on homepage: TAM Sourcing, Automated Inbound, Lead Scoring, Automated Outbound, CRM Enrichment, Launch Ads, Rep Productivity
- Sub-products: Claygent AI (research agents), Account Agents, Ads, Sequencer, Audiences, Signals, Workflows, Functions
- Data Marketplace (200+ providers), Visual Workflows canvas, Agent system

**OBSERVED** (scripts): 30 scripts on homepage, inline scripts dominate (Webflow-hosted)
**OBSERVED** (storage): Minimal client-side state on homepage

---

## LEAD / SIGNAL INTELLIGENCE

**OBSERVED** (accessibility text):
- "Personalize outreach with live intent signals to reach the right buyers at the right time"
- "Signals tracking" as a dedicated feature
- "Enrich, score, and route every lead to the right rep in minutes"
- "Find companies with 30+ sales reps, $10M+ revenue, and a free trial button on their website"

**OBSERVED** (DOM):
- "Get data from the most complete data marketplace — one contract to buy data from 200+ data and AI vendors"
- "Create intent signals from anything on the internet"

**INFERRED** — Signals are first-party + third-party combined. Users can create custom intent signals from any web data. "Promotions" example: detect job title changes (VP/Director + Sales) → trigger outreach.

---

## SCORING / PRIORITIZATION

**OBSERVED** (accessibility text, Lead Scoring tab):
- "Prioritize the highest-converting leads using real-time intent and engagement signals"
- Scoring tiers: T1, T2, T3 (visual formula builder shown in marketing)
- Score conditions based on: PLG user count, sales roles, revenue thresholds

**OBSERVED** (DOM): "Lead Score Formula with conditions for T1, T2, and T3 accounts based on PLG user, sales roles, and revenue"

**INFERRED** — Scoring is user-defined (formula builder), not AI-learned. Admins set conditions → leads get tiered. This is deterministic, transparent scoring.

---

## REP WORKFLOW

**OBSERVED** (accessibility text, Rep Productivity tab):
- "Automate research, prep, and follow-ups to let reps spend time closing deals"
- "Slack message from Clay Agent with a brief for an 11am demo and buttons to approve and send or edit"
- "Agent builder interface with prompt to prep reps for first call"

**OBSERVED** (DOM): "Reps can self-serve the best prospecting data. Chat to get full account context in natural language"

**INFERRED** — Reps interact via Slack (agent briefs) and natural language chat. Pre-call prep is automated by agents. Reps don't log into Clay directly for daily work — Clay pushes to their tools.

---

## MESSAGING / SEQUENCING

**OBSERVED** (navigation): "Sequencer" as a dedicated sub-product
**OBSERVED** (accessibility text): "Automated outbound — personalize outreach with live intent signals"
**OBSERVED** (DOM): "Hyper-personalized cold emails crafted in Clay seamlessly integrate with Smartlead campaigns"

**INFERRED** — Clay has its own sequencer but also integrates with Smartlead for execution. Clay is the intelligence layer; Smartlead is the sending infrastructure.

---

## INBOX / REPLIES

**OBSERVED** — No inbox feature visible on homepage.
**INFERRED** — Clay doesn't handle replies. It enriches CRM records and triggers sequences. Reply handling is delegated to connected tools.

---

## ADMIN / TEAM VISIBILITY

**OBSERVED** (accessibility text, ABM tab):
- "Trace a prospect's path to fine-tune ABM campaigns"
- "Follow the exact path a record takes through a workflow, including exactly what deterministic or agentic reasoning was applied at each step"

**OBSERVED** (DOM): "Observe to iterate faster — bulk trace records to quickly spot why logic or agents make unexpected decisions"

**INFERRED** — Admins get workflow observability (bulk trace). They can see exactly why an agent made a decision and debug unexpected behavior.

---

## AUTOMATION

**OBSERVED** (DOM):
- "Put agents that know your business to work — Run GTM plays with agents that understand your business and accounts"
- "Build code into workflows to run complex logic, or extend workflows outside of Clay with no limits"
- "Trigger emails, ads, and more with integrations to your existing GTM tools"
- "Build and ship workflows using natural language prompts in Clay, or via CLI with any coding agent"

**INFERRED** — Automation is workflow-based with visual canvas + code nodes + natural language. Agents run in background. Triggers fire on signals.

---

## EXPLAINABILITY

**OBSERVED** (DOM): "Observe to iterate faster — bulk trace records to quickly spot why logic or agents make unexpected decisions, and fix it fast"
**OBSERVED** (accessibility text): "Follow the exact path a record takes through a workflow, including exactly what deterministic or agentic reasoning was applied at each step"

**INFERRED** — Explainability is Clay's standout feature. Admins can trace any record through a workflow, seeing the exact reasoning at each step. This is a debugging/trust superpower.

---

## EMPTY / LOADING / ERROR UX

**OBSERVED** — No explicit empty state patterns visible on homepage.
**INFERRED** — Given the "natural language builder" approach, empty states likely offer prompt templates.

---

## STRONG UX PATTERNS

1. **Agent observability / bulk trace** — See why an agent made a decision
2. **Data marketplace** — One contract, 200+ vendors
3. **Signal-based triggers** — Workflows fire on real-time events
4. **Natural language workflow builder** — Describe what you want, get a workflow
5. **Rep productivity via Slack** — Push briefs to Slack, not another tool
6. **Visual workflow canvas** — Build GTM plays by connecting nodes

---

## WEAKNESSES

1. **Steep learning curve** — Visual workflows + agents + code nodes + 200+ data sources
2. **Credit-based pricing** — Unpredictable costs at scale
3. **No native execution** — Clay triggers outreach in other tools
4. **Cold start** — Significant setup before delivering value
5. **Not rep-centric** — Built for "GTM engineers", not average reps

---

## WHAT RELAY SHOULD ADOPT

| Idea | Priority | Source |
|------|----------|--------|
| Agent observability / trace | P0 | "Bulk trace records" |
| Signal-based triggers | P0 | "Workflows fire on signals" |
| Workflow traceability | P1 | "What happened to this lead?" |
| Data marketplace integration | P1 | "200+ providers, one contract" |
| Natural language scoring builder | P2 | "Describe what you want" |

---

## WHAT RELAY SHOULD AVOID

| Idea | Why |
|------|-----|
| Visual workflow canvas | Relay's users are reps, not GTM engineers |
| Orchestration-only model | Relay should own end-to-end for its niche |
| Credit-based pricing | Confusing for customers |
| Targeting "GTM engineers" | Relay's users are reps/founders |
