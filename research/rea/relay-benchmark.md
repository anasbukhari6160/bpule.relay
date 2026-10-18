# Relay vs. Competitors — REA Benchmark

> Generated from REA analysis of Apollo, Clay, Smartlead, HeyReach (public homepages)
> Plus Relay codebase inspection
> Last updated: 2026-10-18

---

## WHERE RELAY IS ALREADY STRONGER

| Area | Relay's Advantage | Competitor Gap |
|------|-------------------|----------------|
| **Semantic intelligence** | `intelligence-v3/` with orchestrator, decision engine, graph, semantic analysis, latent opportunity | Apollo has behavioral scoring but not semantic parsing |
| **Evidence-based actions** | `action-ledger.ts` with provenance tracking | Clay has observability but not commercial evidence |
| **Explainability** | `normalizeScoreDimensions()` with per-dimension breakdown | Smartlead/HeyReach have none |
| **Decision reasoning** | V3 decision packet with 8 typed questions | Apollo's AI is opaque ("AI that actually executes") |
| **Turn-taking state machine** | `deriveNextLeadAction()` — precise conversation state | Smartlead has sequences but no conversation state |
| **Multi-channel in one model** | `next-best-action.ts` ranks across LINKEDIN/UPWORK/INBOUND | Apollo/HeyReach are channel-specific |
| **Referral system** | `lead-referral.ts` with profile matching | None of the 3 have referral routing |
| **Conversation intent** | `conversation/intent.ts` with hard-stop rules | Smartlead has basic intent classification |

---

## WHERE RELAY IS WEAKER

| Area | Gap | Competitor Reference |
|------|-----|---------------------|
| **Unified inbox** | Replies scattered across leads | Smartlead Master Inbox |
| **AI reply categorization** | No auto-classification of inbound | Smartlead "auto-categorize by intent" |
| **Signal feed** | No real-time "What's hot" | Apollo "What's hot" feed |
| **Workflow observability** | No bulk trace of decisions | Clay "bulk trace records" |
| **Browser extension** | No Apollo Anywhere equivalent | Apollo Chrome Extension |
| **Natural language scoring** | Scoring is code-defined | Clay formula builder |
| **Empty state intelligence** | Basic empty states | Apollo AI-suggested next steps |
| **Admin per-rep queue** | Admin sees aggregates, not rep queue | Clay workflow observability |

---

## TOP 10 IDEAS WORTH ADOPTING

### 1. Master Inbox with AI Reply Categorization
- **Priority:** P0
- **Effort:** MEDIUM
- **Impact:** High — saves 30+ min/day per rep, reduces missed replies
- **Relay has partial:** Queue engine has reply_needed tasks, conversation/intent.ts exists
- **Extend:** `src/components/inbox/unified-inbox.tsx` (already created) + wire to rep dashboard
- **Source:** Smartlead "Centralise every reply, auto-categorize by intent"

### 2. Next-Best-Action Queue
- **Priority:** P0
- **Effort:** LOW (already built)
- **Impact:** High — changes daily UX fundamentally
- **Relay has partial:** `next-best-action.ts` with ranking, `deriveNextLeadAction()` exists
- **Extend:** Wire `rankNextActions()` into `rep-workspace.tsx` data flow
- **Source:** Apollo "AI-guided, context-rich task queue"

### 3. Buying Signal Feed
- **Priority:** P0
- **Effort:** HIGH
- **Impact:** High — urgency-driven outreach
- **Relay has partial:** `signals.ts` in scoring, but no real-time feed UI
- **Extend:** New feed component + signal refresh API (already created `refresh-intelligence/route.ts`)
- **Source:** Apollo "What's hot" feed

### 4. Decision Explainability UI
- **Priority:** P1
- **Effort:** LOW (already built)
- **Impact:** Medium — builds trust in AI
- **Relay has partial:** `decision-explain.tsx` (already created), V3 decision packet exists
- **Extend:** Already integrated into `lead-workspace-simple.tsx`
- **Source:** Clay "Follow the exact path a record takes"

### 5. Workflow Observability / Bulk Trace
- **Priority:** P1
- **Effort:** MEDIUM
- **Impact:** Medium — debugging + trust
- **Relay has partial:** Action ledger exists, but no trace UI
- **Extend:** New admin view using existing `action_events` + `intelligence-v3/decision`
- **Source:** Clay "Bulk trace records to quickly spot why logic or agents make unexpected decisions"

### 6. Signal-Based Triggers
- **Priority:** P0
- **Effort:** MEDIUM
- **Impact:** High — act on events, not schedules
- **Relay has partial:** Scoring engine exists, but no event-driven triggers
- **Extend:** New trigger layer over existing `intelligence-v3/orchestrator`
- **Source:** Clay "Workflows fire on real-time events"

### 7. Intelligent Empty States
- **Priority:** P1
- **Effort:** LOW (already built)
- **Impact:** Medium — eliminates dead ends
- **Relay has partial:** `intelligent-empty-state.tsx` (already created)
- **Extend:** Already integrated into `bd-daily-desk.tsx`
- **Source:** Apollo AI-suggested next steps

### 8. Agent Observability / Decision Trace
- **Priority:** P1
- **Effort:** MEDIUM
- **Impact:** Medium — admins can debug AI decisions
- **Relay has partial:** V3 decision packets store reasoning, but no trace UI
- **Extend:** New admin view showing decision packet + reasoning chain
- **Source:** Clay "Observe to iterate faster"

### 9. Data Marketplace Integration
- **Priority:** P2
- **Effort:** HIGH
- **Impact:** Medium — more complete records
- **Relay has partial:** Enrichment exists, but no marketplace aggregation
- **Extend:** New enrichment provider layer
- **Source:** Clay "One contract, 200+ vendors"

### 10. Admin Per-Rep Ranked Queue
- **Priority:** P1
- **Effort:** LOW (already built)
- **Impact:** Medium — admins see exact rep workload
- **Relay has partial:** `loadRepQueueSnapshot()` in `command-center-v2.ts` (already created)
- **Extend:** Call from admin UI when rep is clicked
- **Source:** Clay workflow observability

---

## WHAT NOT TO COPY

| Idea | Source | Why |
|------|--------|-----|
| Visual workflow canvas | Clay | Wrong audience (reps, not GTM engineers) |
| Unlimited mailboxes at flat price | Smartlead | Race to the bottom, wrong business model |
| White-label/agency focus | Smartlead/HeyReach | Relay serves end-users, not agencies |
| LinkedIn-only execution | HeyReach | Relay needs multi-channel |
| Pure execution without intelligence | Smartlead | Relay's moat IS intelligence |
| Building deliverability infrastructure | Smartlead | Completely different business |
| Credit-based pricing | Clay | Confusing for customers |
| Feature sprawl (200+ integrations) | Apollo | Focus on depth over breadth |

---

## RECOMMENDED ROADMAP

### Phase 1 (P0) — Next 4 weeks
1. **Wire NBA queue into rep dashboard** — Connect `rankNextActions()` to `rep-workspace.tsx`
2. **Unified Inbox** — Integrate `UnifiedInbox` component into BdDailyDesk (already partially done)
3. **Decision Explainability** — Already integrated into lead workspace, verify in browser

### Phase 2 (P1) — Weeks 5-8
4. **Signal Feed** — Build real-time signal feed using refresh-intelligence API
5. **Intelligent Empty States** — Already integrated, expand to all queue views
6. **Admin Per-Rep Queue** — Wire `loadRepQueueSnapshot()` into Command Center UI
7. **Workflow Observability** — Build admin trace view using existing action ledger

### Phase 3 (P2) — Weeks 9-12
8. **Signal-Based Triggers** — Event-driven scoring updates
9. **Data Marketplace** — Aggregate enrichment providers
10. **Agent Observability** — Decision trace UI for admins

---

## RESEARCH STATUS: COMPLETE

All 4 targets analyzed via REA. Findings saved to:
- `research/rea/apollo.md`
- `research/rea/clay.md`
- `research/rea/smartlead.md`
- `research/rea/heyreach.md`
- `research/rea/relay-benchmark.md`
