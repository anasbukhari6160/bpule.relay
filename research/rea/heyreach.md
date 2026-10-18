# HeyReach.io — REA Analysis

> REA USED: YES
> Tool: `rea inspect-web-page` + `rea list-browser-targets`
> Target: https://www.heyreach.io/ (public homepage, no auth)
> Evidence: accessibility tree, navigation (46 items), public text
> Last updated: 2026-10-18

---

## PRODUCT ARCHITECTURE

**OBSERVED** (accessibility tree, navigation):
- Positioned as "LinkedIn Automation Tool For Agencies, Sales & Growth teams"
- Tagline: "10x your LinkedIn outbound. Unlimited senders, one fixed cost"
- Products/features: Multichannel outreach, HeyReach MCP, API, Webhooks, Integrations
- Segments: For Agencies, For Sales, For Growth
- Resources: Content Hub, Outbound Outliers, Clay templates, N8N templates, Help Center
- Key differentiator: "2026 Fastest Growing Product" badge

**OBSERVED** (navigation): Strong API/MCP focus — "HeyReach MCP", "HeyReach CLI", "Powerful API"
**OBSERVED** (accessibility): "Your choice, your rules" — consent/anti-spam focus

---

## LEAD / SIGNAL INTELLIGENCE

**OBSERVED** — No dedicated lead intelligence/scoring product visible on homepage.
**INFERRED** — HeyReach is execution-focused. Intelligence likely comes from integrations (Clay templates visible in navigation).

---

## SCORING / PRIORITIZATION

**OBSERVED** — No scoring product visible.
**INFERRED** — Not a focus area. HeyReach executes outreach; scoring is delegated.

---

## REP WORKFLOW

**OBSERVED** (accessibility text):
- "Power up your LinkedIn outbound"
- "Multichannel outreach"
- "Start building for free"

**INFERRED** — Reps use HeyReach for LinkedIn automation. The workflow is: connect → message → follow-up. Unlimited senders = scale.

---

## MESSAGING / SEQUENCING

**OBSERVED** (accessibility): "Multichannel outreach"
**INFERRED** — Sequences are LinkedIn-focused (connection requests → DMs → follow-ups). Multichannel suggests email + LinkedIn.

---

## INBOX / REPLIES

**OBSERVED** — No inbox feature visible on homepage.
**INFERRED** — Replies likely handled via CRM sync or webhook integrations.

---

## ADMIN / TEAM VISIBILITY

**OBSERVED** (navigation): "For Agencies" segment → agency-focused features.
**INFERRED** — Agency features likely include client workspaces, white-label, team management.

---

## AUTOMATION

**OBSERVED** (DOM): "10x your LinkedIn outbound. Unlimited senders, one fixed cost"
**INFERRED** — Automation is the core value prop. Unlimited senders = scale without per-seat cost. Fixed cost = predictable pricing.

---

## EXPLAINABILITY

**OBSERVED** — No public explainability UI.
**INFERRED** — Execution-focused product; explainability likely minimal.

---

## EMPTY / LOADING / ERROR UX

**OBSERVED** — No explicit empty states visible.

---

## STRONG UX PATTERNS

1. **Unlimited senders at fixed cost** — Predictable pricing, scale without penalty
2. **API-first approach** — MCP, CLI, Webhooks for developers
3. **Template ecosystem** — Clay templates, N8N templates (integrations)
4. **Anti-spam positioning** — "Your choice, your rules", Anti-Spam Policy
5. **Agency focus** — Dedicated agency segment

---

## WEAKNESSES

1. **Narrow focus** — LinkedIn-only outbound, no scoring, no intelligence
2. **No native inbox** — Reply handling is external
3. **No CRM** — Relies on integrations for pipeline management

---

## WHAT RELAY SHOULD ADOPT

| Idea | Priority | Source |
|------|----------|--------|
| API-first positioning | P2 | "Powerful API, MCP, CLI" |
| Fixed-cost unlimited model | P2 | "Unlimited senders, one fixed cost" |
| Anti-spam trust positioning | P2 | "Your choice, your rules" |

---

## WHAT RELAY SHOULD AVOID

| Idea | Why |
|------|-----|
| LinkedIn-only execution | Relay needs multi-channel |
| No scoring/intelligence | Relay's moat IS intelligence |
| Agency-only focus | Relay serves reps/founders directly |
