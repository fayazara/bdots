# PRD: Bots — AI teammates with their own computer and browser, built on Cloudflare

> Working name: **Bots**. Status: Draft v0.3 (adds Executor as the integration layer; TanStack Start + Kumo for the app). Owner: Fayaz (DevRel). Date: 2026-09-30.

## 1. Summary

A multi-bot "AI teammates" app in the style of [Grok Bot](https://x.ai/bot) and [OpenAI dots](https://openai.com/index/introducing-dots/), built entirely on Cloudflare's developer platform.

A user creates several bots (Chief, Sales Outbound, Inbox Manager, Expense Manager…). Each bot:

- is its **own Durable Object** (an Agents SDK agent) with its own memory, schedule and chat history
- has its **own computer**, meaning a durable file system plus a shell, via [`@cloudflare/computer`](https://github.com/cloudflare/computer)
- reaches the user's apps **through APIs first**, via [Executor](https://executor.sh/) (an MCP gateway self-hosted on Cloudflare). "Anything actionable in my email?" is a Gmail API search, not a browser session.
- has its **own browser** as a fallback, using [Kitesurf](https://developers.cloudflare.com/browser-run/kitesurf/) for fast, cheap browsing and Browser Run Chromium for signed-in sessions and hand-offs to a human
- works 24/7, wakes on schedules and events, asks for approval on sensitive actions, and hands the browser to the user when it needs a login ("Take over" / "I'm done")
- can work with other bots in shared threads

**Why this matters (DevRel angle):** Grok Bot and dots run every user on a cloud VM. We show the same product built on isolates first: Durable Objects, Dynamic Workers, Kitesurf. Containers and Chromium are used only when needed, so the cost per bot is a fraction of a VM and it scales to millions of bots.

---

## 2. Reference products (what we're matching)

| Capability | Grok Bot | OpenAI dots | Us |
|---|---|---|---|
| Multiple named bots, one per job | Yes | Primary dot now, teams later | Yes |
| Own cloud computer | Yes, **one shared per user** | Yes, per dot | Yes, **per bot** (see §6.3) |
| Connects to apps through APIs | Connectors | 4,000+ apps via plugins | Yes, via Executor (MCP / OpenAPI / GraphQL) |
| Own browser, signs into tools | Yes | Yes, saved passwords hidden from the model | Yes (fallback when there's no API) |
| "Take over" / hand browser back | Yes | Yes | Yes (Browser Run Human in the Loop) |
| Runs 24/7 on schedules | Routines | Proactive research | `schedule()` + events |
| Teach a task by demo | "Show a Bot how it's done" | — | v2 (session recording → skill) |
| Memory that improves | "Updated memory for…" | Learns preferences | Yes |
| Bots collaborate in a thread | Yes ("Offsite crew") | Planned | Yes |
| Approvals / auto-review | Auto Review | Auto-review + Custom Rules | Yes (Jev classifier + rules) |
| Channels | Desktop, iOS | ChatGPT, Slack, Teams, voice | Web (desktop-first), email, Slack, voice later |

UI reference: the attached Grok Bot screenshots. Bot list on the left with a status preview ("Typing…", "✓ Salesforce → list pulled · 52 accounts"). Chat on the right with inline **Computer cards** that show a live browser and a status chip (`Working` / `Action needed` / `Done`) plus `Take over` and `I'm done` buttons. A full-screen take-over modal with an "I'm done, continue" bar. A step summary list (✓ Salesforce / ✓ Hex / ✓ LinkedIn / ✓ Sequencer). Notes when other bots post into the thread ("Messages from Account Manager and Chief").

---

## 3. Goals and non-goals

### Goals
1. Create, name and customize multiple bots per user, each with a role prompt.
2. Each bot runs durable, long-running work: it survives deploys, evictions and approval pauses.
3. Each bot has a computer (files + shell) and a browser, visible live in the UI.
3a. **API-first:** reach the user's apps through their APIs (via Executor) whenever possible. Use the browser only when there's no API.
4. Hand-offs between human and agent for logins, MFA and CAPTCHA.
5. Scheduled routines and event-driven wakeups (email, webhooks, app events).
6. Approval gates on any action with external side effects.
7. Multi-bot threads where bots delegate to and message each other.
8. All model traffic goes through **Cloudflare AI Gateway** (observability, spend limits, fallbacks).
9. Publishable as a reference architecture, template and blog post.

### Non-goals (v1)
- Native macOS/iOS apps. Web first; a PWA is fine.
- A full graphical Linux desktop (Thunar-style). We show browser, terminal and files as panes instead.
- A bot marketplace or billing.
- Enterprise controls (SSO, DLP, admin policies).
- Controlling the user's own laptop (dots offers this).

---

## 4. Personas and example jobs

- **Founder / GTM:** Sales Outbound does overnight prospecting from a Google Sheet, researches accounts on the web, pulls CRM context, and drafts email and LinkedIn messages in the user's voice for review.
- **Operator:** Expense Manager collects receipts from email and portals, fills the expense tool, and files the report.
- **Inbox Manager:** triages inbox to zero and leaves drafts for approval.
- **Chief:** a chief-of-staff bot that coordinates the others, books things, and flags priorities.
- **Developer (DevRel demo):** a Bug Repro bot that watches GitHub issues, reproduces in its computer, and opens a PR.

---

## 5. User experience

### 5.1 Core flows
1. **Create bot:** click `+`, and the bot says hello and asks what it's for. From the user's first task, the bot names itself (the "Renamed to Sales Outbound" system event) and gets an avatar color.
2. **Give work:** the user sends a task. The bot plans, checks which apps are connected ("Hex, Gmail, and LinkedIn are signed in. Salesforce isn't."), and starts.
3. **Quick answers from APIs (no browser):** "Anything actionable in my emails?" → the bot searches Gmail through Executor, ranks the messages, and replies with a numbered list. Each item links to its source ("Notice", "Statement", "Email"), and it ends with a suggested priority. This matches the dots reference screenshot. No Computer card appears because no browser was used.
3b. **Computer card:** when the browser *is* needed, an inline card shows it through Live View, with status `Working` → `Action needed` → `Done`.
4. **Take over:** `Action needed` + "Sign in to Salesforce…" → the user clicks **Take over** → a full-screen Live View modal → the user logs in → **I'm done, continue** → the bot resumes in the same session.
5. **Result:** a step summary with counts, and artifacts (drafts, CSVs, PDFs) saved in the bot's files.
6. **Approvals:** "36 drafts queued · 0 sent". Sending needs approval unless a rule allows it.
7. **Bots working together:** bots @mention each other, and cross-bot messages show as "Messages from X and Y".
8. **Background work:** routines run on schedule, and the bot list preview updates live ("report filed. 9 receipts, nothing o…").
9. **Open the computer:** the monitor icon (top right) opens the Browser / Terminal / Files / Activity panes for the bot.

### 5.2 Screens
Built with **TanStack Start** and **Kumo** (Cloudflare's design system). The component map is in §8.3.

- Sidebar: bot list with avatar, last message preview, timestamp, unread dot; search; `+ New bot`; user profile.
- Bot thread: messages, system events, Computer cards, approval cards, cross-bot notes, composer (attach, voice).
- Take-over modal: Live View iframe + instruction bar + `I'm done, continue` / `Failed`.
- Computer panel: tabs for **Browser** (Live View), **Terminal** (stream of `exec`), **Files** (workspace tree + preview), **Activity** (audit log of tool calls and approvals).
- Bot settings: name, role prompt, avatar, connected apps, rules (allow / ask / block), routines, memory viewer.
- Connections (user level): manage integrations and accounts through Executor. Includes several accounts per app (work/personal Gmail) and per-tool policies. Each bot gets a subset (a "toolkit").

---

## 6. Architecture

### 6.1 Which base to build on

**Recommendation: the Cloudflare Agents SDK with the Project Think harness (`@cloudflare/think`).** Don't use Flue as the base for this project.

| Option | What it is | Fit |
|---|---|---|
| **[Agents SDK](https://developers.cloudflare.com/agents/) + [Think](https://developers.cloudflare.com/agents/harnesses/think/)** | Cloudflare's native agent runtime: `Agent` extends Durable Object; Think adds a ready-made agent loop (tools, MCP, skills, durable chat recovery, approvals, tracing) | **Best.** Every first-party piece we need plugs straight in: `@cloudflare/computer` Workspace (its examples use Think), browser tools and Live View (Think's execute tool includes `cdp.*`), `schedule()`, sub-agents, email, voice, messengers, MCP OAuth, Code Mode approvals. |
| **[Flue](https://flueframework.com)** | An open, portable TypeScript agent framework (Pi harness) that *deploys to* Cloudflare. On Cloudflare it builds on the Agents SDK and generates the Durable Object classes for you. | Good if you want portability across clouds (AWS, Docker, Vercel sandboxes…) and a hooks-style API. For us it's an extra layer: Flue owns the generated DO classes, you must not override `alarm()`/`onRequest()`, and native SDK features go through an `extend()` escape hatch. Worth mentioning in the blog post as an alternative, not the base. |

### 6.2 High-level diagram

```
                          ┌───────────────────────── Cloudflare ─────────────────────────┐
 Web app (TanStack Start │                                                              │
 + Kumo UI)      ─────WS──┼─► Worker: TanStack Start SSR + routeAgentRequest ──► UserHub │
 useAgent/useAgentChat    │        │                      • bot directory, threads index │
                          │        │                      • shared connections/vault     │
 Email (Email Routing) ───┼────────┤                      • event router (Jev triage)    │
 Webhooks / app events ───┼─► Queue ──────────────────►   • group threads               │
 Slack (later) ───────────┼────────┘                            │ RPC                    │
                          │                                     ▼                        │
                          │              ┌──────── BotAgent DO (1 per bot) ────────┐     │
                          │              │ Think harness (chat, tools, skills)     │     │
                          │              │ SQLite: messages, memory, rules, runs   │     │
                          │              │ schedule(): routines, follow-ups        │     │
                          │              │ Workspace (@cloudflare/computer)        │     │
                          │              │   ├─ isolate shell / JS (Dynamic Worker)│     │
                          │              │   └─ container backend (on demand)      │     │
                          │              │ Browser tools (Browser Run)             │     │
                          │              │   ├─ Kitesurf: read/research/extract    │     │
                          │              │   └─ Chromium: logged-in + Live View    │     │
                          │              │ MCP client ──► Executor (1st choice)    │     │
                          │              └───────┬───────────────┬─────────────────┘     │
                          │                      │ MCP /mcp      │                       │
                          │                      ▼               │                       │
                          │   Executor Worker (self-hosted)      │                       │
                          │   • D1 catalog + encrypted creds     │                       │
                          │   • per-tool policies, toolkits      │                       │
                          │   • Access (service token / OAuth)   │                       │
                          │   • ──► Gmail, Sheets, Salesforce,   │                       │
                          │         HubSpot, GitHub, Linear …    │                       │
                          │                                      │                       │
                          │   AI Gateway ◄───────────────────────┤ (LLMs + Jev custom provider)
                          │   R2 (artifacts, screenshots, recordings) · D1 (global index)│
                          └──────────────────────────────────────────────────────────────┘
```

### 6.3 Durable Object topology

- **`UserHub` DO**, one per user (`idFromName(userId)`):
  - bot registry (id, name, avatar, role, status, last preview) → powers the sidebar
  - group threads (e.g. "Offsite crew") and fan-out of cross-bot messages
  - **event router:** inbound events → decide which bot(s) should handle them → RPC into those bots
  - **connections map**: which Executor connections/toolkit each bot may use (the API credentials themselves live in Executor, §6.6)
  - **browser login vault**: encrypted browser cookies/storage for sites with no API, shared between bots by policy
- **`BotAgent` DO**, one per bot (`idFromName(`${userId}:${botId}`)`), extends `Think`:
  - its own chat history, memory, rules, routines and run log in DO SQLite
  - its own `Workspace` (computer) and its own browser sessions
- **Why top-level DOs instead of [sub-agents](https://developers.cloudflare.com/agents/runtime/execution/sub-agents/):** sub-agents (facets) share the parent's single alarm slot and are colocated with it. Separate DOs give each bot independent scaling and alarms, and a clean "one bot = one DO" story. Use sub-agents *inside* a bot for short parallel jobs (e.g. research 50 accounts at once) via [agents as tools](https://developers.cloudflare.com/agents/runtime/execution/agent-tools/) / background sub-agents.
- **Decision to confirm:** Grok gives each user one shared computer (bots share files, browser and logins). We're choosing a computer per bot for isolation and a clearer demo, but we share **logins** through the UserHub vault so the user doesn't sign into Salesforce once per bot. Artifacts cross between bots by explicit handoff (copying files over RPC or a shared R2 prefix).

### 6.4 The computer: `@cloudflare/computer`

- `Workspace` on each BotAgent, stored in DO SQLite, with backends:
  - **isolate shell** (just-bash in a Dynamic Worker) and **isolate JS** for most work: file edits, data wrangling, CSV/JSON, git
  - **container backend** ([Cloudflare Containers](https://developers.cloudflare.com/containers/)) only when a task needs real Linux (npm, pandoc, Python, native binaries)
- Tools: `createAITools({ workspace, shell: { backends } })` → read / write / edit / ls / exec. The model picks the backend for each command, and the UI shows which one ran.
- Layout: `/workspace/{inbox,outbox,drafts,artifacts,downloads,scratch}`, `/memory/*.md`, `/.agents/skills/*` (learned routines).
- Egress policy: default `none` for isolate backends, and an allowlist for containers (see the repo's `examples/egress`).
- ⚠️ **Preview only.** The README says it's "NOT suitable for production." Pin the version, and expect API changes (e.g. `useThink: true` is temporary).

### 6.5 The browser: Kitesurf + Chromium

Kitesurf is **stateless** and its docs say it isn't the right choice for "a long-running, authenticated session that requires persistent state" or for bot-challenge handshakes. So we use two tiers and route each task to the right one:

| Tier | Engine | Used for | API |
|---|---|---|---|
| **Fast / cheap (default)** | **Kitesurf** (`browser: "kitesurf"`) | Research, reading public pages, markdown/extract/links/scrape, screenshots, WebMCP tool calls on public sites | Quick Actions via `env.BROWSER.quickAction(...)` and `createQuickActionTools`; CDP with `?browser=kitesurf` |
| **Signed-in / interactive** | Browser Run **Chromium** (default flavor) | Logged-in apps (Salesforce, LinkedIn, expense portals), multi-step forms, **Live View + Take over** | `createBrowserTools({ session: { mode: "dynamic" } })` → `browser_execute` (CDP via Code Mode), `cdp.getLiveViewUrl()`, `Cloudflare.handoff` |

- **The browser is the fallback, not the default.** Before opening any browser, the bot checks the tool order in §6.6: Executor API → WebMCP → Kitesurf → Chromium.
- **Routing rule (once a browser is needed):** public + read-only → Kitesurf. Needs login, persistence, video/WebGL, or fails on Kitesurf → Chromium. Jev can make this call (§7.3), with a fallback to Chromium on error.
- **Hand-off:** the bot calls `Cloudflare.getLiveView` (mode `tab`) + `Cloudflare.handoff({ instructions })`. The UI shows the "Action needed" card. The user completes the login in Live View → `Cloudflare.handoffComplete` → the run resumes. Durable Code Mode keeps the run paused *with the browser session intact*.
- **Login persistence:** Browser Run sessions end after inactivity (`keep_alive` is at most 10 minutes idle; sessions stay alive only while active). To avoid logging in every day: after a successful hand-off, export cookies/storage over CDP, encrypt them, store them in the UserHub vault, and inject them into new sessions. **Prefer MCP/OAuth connectors over browser logins wherever an app has one.** ⚠️ Verify with the Browser Run team: cookie injection into Kitesurf Quick Actions (the `cookies` option) for authenticated *reads*, and whether a persistent-profile feature is coming.
- **Recording:** `recording: true` on Chromium sessions (rrweb, kept 30 days) → Activity pane and "teach a task" input.
- **Bot detection:** Browser Run traffic is always identified as a bot, even during take-over, so some sites will block it. That's a product limitation to state openly.
- **The inline Computer card:** show a Live View iframe while `Working` / `Action needed`. On `Done`, swap it for the final screenshot (stored in R2) so the thread stays lightweight.

### 6.6 Integrations: API-first via Executor

**Principle:** use the cheapest, most reliable path that can do the job. Reading email, calendars, sheets or CRM records should go through the apps' APIs, not a browser. OpenAI dots does the same: it connects to 4,000+ apps through plugins, and its browser is for everything else.

#### Tool order (the bot tries these top to bottom)
| # | Path | When | Why |
|---|---|---|---|
| 1 | **Executor → app API** (MCP / OpenAPI / GraphQL) | The app has an API: Gmail, Calendar, Sheets, Drive, Salesforce, HubSpot, Slack, GitHub, Linear, Notion, Stripe, Sentry… | Fast, structured, no login to keep alive, results link to real objects |
| 2 | **WebMCP** on the site | The site exposes WebMCP tools | Structured calls without an API key |
| 3 | **Kitesurf** | Public, read-only web pages | Cheapest browser |
| 4 | **Chromium + Take over** | Needs a login, no API: expense portals, LinkedIn, banks, insurers | Only option; human hand-off for the login |

The system prompt states the order explicitly, and Jev can check it ("Is there a connected integration that can answer this?", a Choice over connections plus `browser`).

#### What Executor is
[Executor](https://executor.sh/docs) is an open-source MCP gateway ([source](https://github.com/RhysSullivan/executor)):
- **Integrations** (MCP servers, OpenAPI specs, GraphQL endpoints) → **connections** (configured, authenticated instances; several per integration, e.g. work and personal Gmail) → **policies** for each tool (allowed / needs approval / blocked). Policy defaults come from the spec (e.g. OpenAPI `GET` is allowed).
- The agent sees **one `execute` tool**. Model-written TypeScript calls `tools.search()` → `tools.describe.tool()` → `tools[path](input)`, so 50 connected services don't bloat the prompt. It's the same idea as Code Mode.
- **Credentials are attached on the host side at call time.** They never enter the sandbox, the agent, or the model's context.
- **Toolkits:** curated subsets of tools. Each bot gets its own toolkit (Inbox Manager: Gmail + Calendar; Sales Outbound: Sheets + Salesforce + Gmail drafts).

#### Hosting on Cloudflare
- Use the **[Self-Hosted Cloudflare](https://executor.sh/docs/hosted/cloudflare)** target: a single Worker, with **D1** for storage (`EXECUTOR_SECRET_KEY` encrypts credentials), **Cloudflare Access** for auth, tool code running in QuickJS inside the Worker, and the console, API and **MCP endpoint `/mcp`** all on that one Worker. Deploy from `apps/host-cloudflare` with `bun run deploy:setup`.
- **Bot → Executor auth:** an Access **service token** (the headless path). Each `BotAgent` connects with:
  ```ts
  await this.addMcpServer("executor", env.EXECUTOR_MCP_URL, {
    transport: { headers: {
      "CF-Access-Client-Id": env.EXECUTOR_CLIENT_ID,
      "CF-Access-Client-Secret": env.EXECUTOR_CLIENT_SECRET,
    } },
  }); // verify exact option shape against the Agents SDK McpClient docs
  ```
- **Human → Executor console:** a normal Access login. **Managed OAuth** on the Access app also lets the user connect the same Executor to Claude/Cursor. That's a nice "one set of connections for your bots *and* your coding agents" story.
- Executor could also run on a Workers custom domain next to the app (`executor.bots.example.com`), in the same Cloudflare account.

#### Tenancy (decision needed)
The Cloudflare self-host is **single-tenant**: every Access-verified user belongs to one org. Options:

| Option | Good for | Trade-off |
|---|---|---|
| **A. Single self-hosted Executor** | Internal demo, DevRel, a team where everyone sees everyone's connections | Not suitable for a public multi-user product |
| **B. [Executor Cloud](https://executor.sh/docs/hosted/cloud)** | Public beta quickly; multi-tenant, credentials in WorkOS Vault | Data leaves our account; free for up to 3 people, then $15 per member per month |
| **C. Fork, make connections per user** (connections keyed by user in D1, user identity from our auth) | Long-term public product that stays on Cloudflare | Engineering effort; we'd maintain the fork |
| **D. Fall back to the Agents SDK MCP client** for each bot, tokens in DO SQLite | No third-party dependency | We lose OpenAPI/GraphQL import, per-tool policies, and multiple accounts per app |

**Recommendation:** A for M0–M2 (the demo), then decide between B and C before any public launch. Keep D working for one or two first-party MCP servers so we're never fully blocked.

#### Approvals: one owner
- **Executor policy is the hard boundary** (blocked tools can never be called; "needs approval" tools always pause).
- **Our UI owns the approval experience.** An Executor approval request must become an approval card in the bot's thread. Expected mechanism: MCP **elicitation**, which the Agents SDK client supports (see "MCP client elicitation" in the client API docs). ⚠️ This is the first thing to confirm in the M0 spike.
- **Jev auto-review** (§7.3) only runs on calls Executor *allows*. It adds context-aware checks ("this email goes to an external domain", "this looks like a reply to a prompt injection") and can escalate an allowed call to an approval card, but it can never override a block.

#### Other tool surfaces
- **Direct MCP servers (Agents SDK client):** only for first-party or special cases, with the built-in OAuth flow and tokens in DO SQLite.
- **[Code Mode](https://developers.cloudflare.com/agents/tools/codemode/)** for our own internal tools that have side effects, so they can pause for durable approval.
- **WebMCP:** call site tools instead of clicking (Kitesurf and Chromium both support it).
- **Email as a channel:** each bot gets an address (`sales-outbound+<botId>@bots.example.com`) through Email Routing → `onEmail()`; outbound goes through the `send_email` binding with signed reply routing. This is separate from *reading the user's* inbox, which goes through Executor → Gmail.

#### Worked example: "Anything actionable in my emails?"
1. **Plan:** the bot sees that Gmail is connected (Executor toolkit) → no browser needed.
2. **Fetch:** one `execute` call: `gmail.search({ q: "newer_than:14d -category:promotions", max: 100 })`, then `gmail.get` for the metadata and snippets. Also search for *follow-up* messages (payment confirmations, resolutions) so we can tell whether an item is already done.
3. **Score cheaply (Jev):** for each thread, `Noul: needs user action?`, `Noul: already resolved by a later email?`, `Score: urgency (deadline proximity, money, account suspension)`, `Choice: category (billing, finance, legal/HR, travel, subscription, other)`. Drop anything the user told the bot to ignore ("Forget about the Neon db"). That comes from memory as a filter rule.
4. **Write (LLM):** only the top ~5 threads (full text) go to the LLM, which writes one line per item: what to do, why, the deadline, and a link to the Gmail message (`https://mail.google.com/mail/u/0/#inbox/<id>`). It ends with a suggested priority.
5. **Remember:** "User doesn't care about Neon DB alerts" → memory (Jev write-back check).
6. **Routine:** the same flow runs as a weekday 8am `schedule()` digest. It's proactive and read-only by default.

Cost: about 100 emails through Jev for fractions of a cent, plus one LLM call over ~5 threads, instead of an LLM reading 100 emails or a browser scrolling Gmail.

### 6.7 Wakeups: schedules vs events

Clarifying "DO alarms for receiving events": **alarms are for time-based wakeups, not for receiving events.** We use both:

- **Time-based:** `this.schedule(when, "method", payload)` (delay, date, or cron) and `scheduleEvery()`, built on the DO alarm. The SDK multiplexes many schedules onto one alarm. Used for routines ("every weekday 7am: pipeline run"), follow-ups ("check for replies in 2 days"), approval timeouts, session sweeps (`connector.sweep()`), and polling apps that have no webhooks.
- **Event-based:** inbound email (`onEmail`), webhooks (Gmail push, Salesforce, GitHub, Stripe…) → Worker → **Queue** → UserHub → event router → `BotAgent.handleEvent()` RPC. The Queue gives buffering, retries and a dead-letter queue.
- **Long multi-step jobs** (e.g. a 200-contact overnight run): use Think's durable fibers or [Workflows](https://developers.cloudflare.com/agents/runtime/execution/run-workflows/) (`waitForApproval()`), so steps can retry and resume.

### 6.8 Memory
- Structured memory in DO SQLite (preferences, contacts, facts, "Dana approves annual deals") plus human-readable `/memory/*.md` in the workspace.
- A write-back step after each task. Jev decides whether an observation is worth keeping (§7.3). The UI shows "Updated memory for Account Manager".
- Recall: keyword search over SQLite. Add [AI Search](https://developers.cloudflare.com/agents/tools/ai-search/) / Vectorize when memory grows.
- Cross-bot learning: a bot can publish a memory item to the UserHub, and other bots can subscribe.

### 6.9 Safety and approvals
- **Rules for each bot:** `allow` / `ask` / `block`, by tool and action class (send email, post, purchase, delete, change credentials). Some actions are always kept for the user (password changes, payments above a threshold).
- **Auto-review:** every tool call with side effects is classified before it runs (Jev, §7.3). High-confidence allow → run. Low confidence or a risky class → approval card. Blocked class → refuse.
- **Proactive / background work runs read-only by default** (the same principle as dots).
- **Prompt-injection screening** of page and email content before it reaches the planner.
- **Executor policies are the hard boundary** for app APIs (§6.6): blocked stays blocked, and "needs approval" always pauses.
- Secrets never reach the model: app credentials are attached on the host side by Executor; direct MCP OAuth tokens stay in MCP client storage; container egress uses [outbound Workers](https://developers.cloudflare.com/containers/platform-details/outbound-traffic/) to inject credentials at the proxy.
- Full audit trail: tool calls, approvals, browser recordings, workspace operations (Workspace operations are "gated, audited and observed").

---

## 7. AI layer

### 7.1 AI Gateway (all model traffic)
- **Workers AI and third-party models** through the one AI binding: `env.AI.run(model, input, { gateway: { id: "bots" } })`, or the AI SDK with `baseURL: await env.AI.gateway("bots").getUrl("anthropic")`.
- **Unified Billing** for third-party models (no separate provider keys), or BYOK.
- **Spend limits** scoped by metadata (`userId`, `botId`), which matters for bots running 24/7.
- Caching, rate limiting, retries/fallbacks, logs and analytics for each bot.
- **Jev through a [Custom Provider](https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/)** (`custom-typesafe`, using the provider-specific endpoint since it's not OpenAI-compatible), so Jev calls get the same logging and spend controls.

### 7.2 Model roles
| Role | Model class | Notes |
|---|---|---|
| Planner / chat / writing (drafts "in my voice") | Frontier LLM through AI Gateway | Main Think `getModel()` |
| Browser operator (writes CDP code in Code Mode) | Strong coding model | Can match the planner |
| Cheap summarization / extraction | Workers AI (e.g. GLM) | Page → notes, email → summary |
| **Fast decisions and classification** | **Jev (TypeSafe)** | §7.3 |

### 7.3 Where Jev fits
Jev is a *decision* model, not a text generator. It takes a state plus typed questions (Choice / Score / Noul) and returns typed answers with calibrated confidence in about 70–500 ms, at about $0.042 per million input tokens. It fits the many small yes/no and pick-one decisions in a 24/7 agent, where calling a frontier LLM every time is slow and expensive:

1. **Event triage and routing:** inbound email or webhook → `Noul: needs action?` + `Choice: which bot?` (over the user's bots) + `Score: urgency`. Low confidence → the Chief bot or the user decides.
2. **Auto-review of actions:** before a side effect → `Choice: allow | ask | block` against the user's rules + `Noul: irreversible?` + `Noul: shares data externally?`. Confidence decides between running automatically and showing an approval card. This is the most important use.
3. **Prompt-injection guard:** on page, email or document text → `Noul: contains instructions aimed at an AI agent?`, run on every chunk (cheap enough to do so).
4. **Tool-path routing:** `Choice: <connected integration> | webmcp | kitesurf | chromium` from task + URL + connected apps. This enforces "API first" (§6.6).
4a. **Inbox / feed ranking:** score every email or item fetched through Executor (needs action? already resolved? urgency? category?) so only the top few reach the LLM. See the worked example in §6.6.
5. **Proactive research filter:** "Is this worth interrupting the user about?" (Score). This keeps dots-style proactive nudges useful rather than noisy.
6. **Memory write-back:** `Noul: is this a durable preference/fact?` + `Choice: memory category`.
7. **Skill / routine selection:** pick the right learned skill for a turn (TypeSafe has a cookbook for skill suggestion).
8. **Prospect scoring** (Sales Outbound): combine Score questions (ICP fit, intent, recency) in code.

⚠️ Jev is early access, served from the US West Coast, and can't generate text. Keep an LLM fallback for every Jev decision.

---

## 8. Tech stack (what to use)

| Concern | Choice | Link |
|---|---|---|
| Agent runtime | Agents SDK (`agents`) | https://developers.cloudflare.com/agents/ |
| Agent harness | Project Think (`@cloudflare/think`) | https://developers.cloudflare.com/agents/harnesses/think/ |
| Per-bot state | Durable Objects (SQLite) | https://developers.cloudflare.com/durable-objects/ |
| Scheduling | `this.schedule()` / alarms | https://developers.cloudflare.com/agents/runtime/execution/schedule-tasks/ |
| Durable long jobs | Fibers / Workflows | https://developers.cloudflare.com/agents/runtime/execution/durable-execution/ · https://developers.cloudflare.com/agents/runtime/execution/run-workflows/ |
| Parallel sub-work | Sub-agents / agents as tools | https://developers.cloudflare.com/agents/runtime/execution/sub-agents/ · https://developers.cloudflare.com/agents/runtime/execution/agent-tools/ |
| Computer | `@cloudflare/computer` | https://github.com/cloudflare/computer · https://blog.cloudflare.com/cloudflare-computer/ |
| Isolate execution | Dynamic Workers (Worker Loader) | https://developers.cloudflare.com/dynamic-workers/ |
| Container execution | Cloudflare Containers | https://developers.cloudflare.com/containers/ |
| Browser (fast) | Kitesurf on Browser Run | https://developers.cloudflare.com/browser-run/kitesurf/ · https://blog.cloudflare.com/kitesurf-update |
| Browser (signed-in) | Browser Run Chromium | https://developers.cloudflare.com/browser-run/ |
| Agent browser tools | `agents/browser` | https://developers.cloudflare.com/agents/tools/browser/ |
| Take over | Live View + Human in the Loop | https://developers.cloudflare.com/browser-run/features/live-view/ · https://developers.cloudflare.com/browser-run/features/human-in-the-loop/ |
| Recordings | Session Recording | https://developers.cloudflare.com/browser-run/features/session-recording/ |
| Quick Actions | Browser Run Quick Actions | https://developers.cloudflare.com/browser-run/quick-actions/ |
| WebMCP | Browser Run WebMCP | https://developers.cloudflare.com/browser-run/features/webmcp/ |
| **App integrations (primary)** | **Executor**, self-hosted on Cloudflare (Worker + D1 + Access) | https://executor.sh/docs · https://executor.sh/docs/hosted/cloudflare · https://github.com/RhysSullivan/executor |
| Executor policies / connections | Per-tool allow / approve / block; multiple accounts | https://executor.sh/docs/concepts/policies · https://executor.sh/docs/concepts/connections |
| Bot → Executor auth | Access service tokens (headless); Managed OAuth for human MCP clients | https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/secure-mcp-servers/ |
| App connections (fallback) | Agents SDK MCP client + OAuth + elicitation | https://developers.cloudflare.com/agents/model-context-protocol/apis/client-api/ |
| Approvals in tool code | Code Mode (durable runtime) | https://developers.cloudflare.com/agents/tools/codemode/ |
| Human-in-the-loop patterns | Agents docs | https://developers.cloudflare.com/agents/concepts/agentic-patterns/human-in-the-loop/ |
| Email channel | Agents email + Email Service | https://developers.cloudflare.com/agents/communication-channels/email/ · https://developers.cloudflare.com/email-service/ |
| Voice (v2) | Agents voice | https://developers.cloudflare.com/agents/communication-channels/voice/ |
| Slack (v2) | Agents Slack / Think messengers | https://developers.cloudflare.com/agents/communication-channels/slack/ · https://developers.cloudflare.com/agents/harnesses/think/messengers/ |
| Event ingestion | Queues | https://developers.cloudflare.com/queues/ |
| Model gateway | AI Gateway (binding, unified billing, spend limits, custom providers) | https://developers.cloudflare.com/ai-gateway/ · https://developers.cloudflare.com/ai-gateway/usage/worker-binding-methods/ · https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/ |
| Models | Workers AI + third-party via AI Gateway | https://developers.cloudflare.com/workers-ai/ |
| Classifier | TypeSafe Jev | https://typesafe.ai/ · https://docs.typesafe.ai/ |
| Artifacts / screenshots | R2 | https://developers.cloudflare.com/r2/ |
| Global index / search | D1 | https://developers.cloudflare.com/d1/ |
| Memory recall (later) | AI Search | https://developers.cloudflare.com/agents/tools/ai-search/ |
| App framework | **TanStack Start** (React, file-based routing, SSR, server functions) on Workers via the Cloudflare Vite plugin | https://tanstack.com/start/ · https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/ · https://developers.cloudflare.com/workers/vite-plugin/ |
| UI components | **Kumo** (`@cloudflare/kumo`), Cloudflare's open-source design system built on Base UI + Tailwind v4 | https://kumo-ui.com/ · https://kumo-ui.com/installation/ · https://kumo-ui.com/registry/ · https://github.com/cloudflare/kumo |
| Styling | Tailwind CSS v4 (with Kumo tokens) | https://tailwindcss.com/ |
| Icons | Phosphor (`@phosphor-icons/react`, a Kumo peer dependency) | https://phosphoricons.com/ |
| Agent client | `useAgent` (`agents/react`) + `useAgentChat` (Think speaks the same `cf_agent_chat_*` protocol; confirm the import path for Think) | https://developers.cloudflare.com/agents/communication-channels/chat/client-sdk/ |
| Auth | Cloudflare Access (internal demo); an auth library on D1 for a public version | https://developers.cloudflare.com/cloudflare-one/policies/access/ |
| Observability | Workers traces + Agents dashboard + AI Gateway logs | https://developers.cloudflare.com/agents/runtime/operations/observability/ |
| Alternative framework (not chosen) | Flue | https://flueframework.com · https://flueframework.com/docs/ecosystem/deploy/cloudflare/ |

### 8.1 Bindings (sketch)

```jsonc
{
  "name": "bots",
  "compatibility_date": "2026-09-30",
  "compatibility_flags": ["nodejs_compat"],
  // Custom server entry (not "@tanstack/react-start/server-entry") so we can export
  // Durable Object classes and route /agents/* before TanStack Start. See §8.3.
  "main": "./src/server.ts",
  "ai": { "binding": "AI" },
  "browser": { "binding": "BROWSER" },
  "worker_loaders": [{ "binding": "LOADER" }],
  "durable_objects": {
    "bindings": [
      { "name": "UserHub", "class_name": "UserHub" },
      { "name": "BotAgent", "class_name": "BotAgent" }
    ]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["UserHub", "BotAgent"] }],
  "containers": [{ "class_name": "BotAgent", "image": "./Dockerfile" }],   // computer container backend; verify shape against @cloudflare/computer examples
  "queues": { "producers": [{ "binding": "EVENTS", "queue": "bot-events" }],
              "consumers": [{ "queue": "bot-events" }] },
  "r2_buckets": [{ "binding": "ARTIFACTS", "bucket_name": "bot-artifacts" }],
  "d1_databases": [{ "binding": "DB", "database_name": "bots" }],
  "send_email": [{ "name": "EMAIL" }],
  "vars": { "EXECUTOR_MCP_URL": "https://executor.bots.example.com/mcp" },
  // secrets: EXECUTOR_CLIENT_ID, EXECUTOR_CLIENT_SECRET (Access service token), TYPESAFE_API_KEY
  // Executor itself is a separate Worker (apps/host-cloudflare) with its own D1 + EXECUTOR_SECRET_KEY
  // No manual "assets" block: the Cloudflare Vite plugin + TanStack Start produce the client build and asset config.
  "observability": { "enabled": true, "traces": { "enabled": true } }
}
```

### 8.2 BotAgent sketch

```ts
import { Think } from "@cloudflare/think";
import { Workspace } from "@cloudflare/computer";
import { withWorkspaceContainer, CloudflareContainerBackend } from "@cloudflare/computer/backends/container";
import { createAITools } from "@cloudflare/computer/tools";
import { createBrowserTools, createQuickActionTools } from "agents/browser/ai";

export class BotAgent extends withWorkspaceContainer(Think)<Env> {
  workspace = new Workspace({
    storage: this.ctx.storage,
    useThink: true,
    backends: [new CloudflareContainerBackend({ container: () => this, workspace: { binding: "BotAgent", id: this.ctx.id.toString() } })],
  });

  getModel() { /* frontier model through AI Gateway (env.AI.gateway("bots")) */ }
  getSystemPrompt() { /* role prompt + memory digest + rules */ }

  waitForMcpConnections = true; // Executor must be connected before the first turn

  async onStart() {
    // API-first: one MCP connection to Executor gives this bot its toolkit (one `execute` tool)
    await this.addMcpServer("executor", this.env.EXECUTOR_MCP_URL, {
      transport: { headers: {
        "CF-Access-Client-Id": this.env.EXECUTOR_CLIENT_ID,
        "CF-Access-Client-Secret": this.env.EXECUTOR_CLIENT_SECRET,
      } },
    }); // verify option shape; make idempotent across restarts
    await this.schedule("*/30 * * * *", "sweepBrowser");
  }

  getTools() {
    return {
      // Executor tools are auto-merged by Think from the MCP connection (tool order: API → WebMCP → Kitesurf → Chromium)
      ...createAITools({ workspace: this.workspace, shell: { defaultBackend: "isolate" /* container on demand */ } }),
      // Kitesurf: stateless reading/research
      ...createQuickActionTools({ browser: this.env.BROWSER /* browser: "kitesurf" — verify option name */ }),
      // Chromium: signed-in sessions, Live View, hand-off
      ...createBrowserTools({ ctx: this.ctx, browser: this.env.BROWSER, loader: this.env.LOADER,
                              session: { mode: "dynamic", recording: true } }),
      // + request_handoff, + message_bot, + remember
    };
  }
  async handleEvent(evt: BotEvent) { /* from UserHub router */ }
  async onEmail(email) { /* per-bot inbox */ }
}
```

### 8.3 Frontend: TanStack Start + Kumo

**One Worker serves everything.** TanStack Start does SSR and server functions, and the same Worker exports the Durable Objects and routes agent WebSockets. There's no separate API service.

#### Project setup
```bash
npm create cloudflare@latest -- bots --framework=tanstack-start
npm i agents @cloudflare/think @cloudflare/computer @cloudflare/kumo @phosphor-icons/react
npm i -D @cloudflare/vite-plugin wrangler tailwindcss @tailwindcss/vite
```

`vite.config.ts` (the Cloudflare plugin runs the Worker as TanStack Start's SSR environment):
```ts
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart(),
    react(),
    tailwindcss(),
    // + @cloudflare/codemode/vite if we use it to auto-export CodemodeRuntime for browser tools
  ],
});
```

**Custom server entry** `src/server.ts`. This is needed because the default `@tanstack/react-start/server-entry` can't export our DO classes or route `/agents/*`:
```ts
import handler from "@tanstack/react-start/server-entry";
import { routeAgentRequest } from "agents";
import { routeAgentEmail } from "agents";          // inbound email → BotAgent
export { BotAgent } from "./agents/bot-agent";
export { UserHub } from "./agents/user-hub";
export { CodemodeRuntime } from "agents/browser";   // required by browser tools

export default {
  async fetch(request, env, ctx) {
    // 1. auth (Cloudflare Access JWT / session cookie) → userId, then enforce that
    //    /agents/bot-agent/<userId>:<botId> belongs to this user (see routing docs: onBeforeConnect)
    // 2. agent WebSockets + agent HTTP (MCP OAuth callbacks, etc.)
    return (await routeAgentRequest(request, env)) ?? handler.fetch(request, env, ctx);
  },
  async email(message, env, ctx) { /* routeAgentEmail(message, env, { resolver }) */ },
  async queue(batch, env, ctx) { /* bot-events → UserHub.route(evt) */ },
} satisfies ExportedHandler<Env>;
// ⚠️ Verify the exact handler.fetch signature for the current TanStack Start version.
```

#### Routes (TanStack Router, file-based)
| Route | Screen |
|---|---|
| `/` | Redirects to the last-open bot, or the onboarding "create your first bot" screen |
| `/bots/$botId` | Bot thread (sidebar + chat + Computer cards) |
| `/bots/$botId/computer` | Computer panel (Browser / Terminal / Files / Activity); can also open as a side panel |
| `/bots/$botId/settings` | Bot settings (role, rules, routines, memory, toolkit) |
| `/threads/$threadId` | Group thread (several bots) |
| `/connections` | Executor connections and toolkits |

- **Server functions / loaders:** the initial sidebar list and thread history come from D1 / UserHub RPC during SSR for a fast first paint. Live updates then come over the agent WebSocket.
- **WebSockets are client-only:** `useAgent` / `useAgentChat` must run only in the browser (wrap them in a client-only boundary, or mount them after hydration). SSR renders the last-known state from the loader.

#### Kumo setup
- Styles (`src/styles/app.css`). **Order matters:** Kumo before Tailwind, and add `@source` because Tailwind v4 doesn't scan `node_modules`:
  ```css
  @source "../../node_modules/@cloudflare/kumo/dist/**/*.{js,jsx,ts,tsx}";
  @import "@cloudflare/kumo/styles/tailwind";
  @import "tailwindcss";
  ```
- Add `isolate` on the app root element (not `<body>`) so Kumo's popups (Dialog, Dropdown, Tooltip, Select) always stack above our layout.
- Wrap the app in `<LinkProvider component={RouterLink}>` so Kumo's `Link` uses TanStack Router's `Link`.
- Use granular imports (`@cloudflare/kumo/components/button`) for smaller bundles.
- Use the **Kumo component registry** (`npx @cloudflare/kumo ls` / `doc <Component>`, or `https://kumo-ui.com/api/component-registry`) and the [Kumo design skill](https://kumo-ui.com/skill) so coding agents build the UI with the right props and tokens.
- Install blocks with the CLI when useful (`npx @cloudflare/kumo add PageHeader`, `ResourceList`), e.g. for the Connections page.

#### Screen → Kumo component map
| UI element (from the reference screenshots) | Kumo |
|---|---|
| Left bot list, collapsible | `Sidebar` |
| Bot avatar | `Avatar` primitive (`@cloudflare/kumo/primitives/avatar`) + our colored blob SVGs |
| Search bots / quick switch (⌘K) | `CommandPalette` (and `Input` in the sidebar header) |
| Unread dot, status chips (`Working`, `Action needed`, `Done`) | `Badge` (+ `Loader` for the spinning "Working") |
| Chat bubbles, system events ("Renamed to Sales Outbound"), cross-bot notes | **Custom** components with Tailwind + Kumo tokens (`Surface` / `Text`). Kumo has no chat primitives. |
| Computer card (Live View iframe or screenshot + buttons) | `LayerCard` + `Button` (`Take over`, `I'm done`) |
| Full-screen take-over modal with "I'm done, continue" bar | `LayerDialog` / `Dialog` + `Banner` for the instruction bar |
| Step summary (✓ Salesforce → 52 accounts) | Custom list; `Flow` for showing multi-bot handoffs / routines as a diagram |
| Approval card ("Send 36 drafts?") | `LayerCard` + `ButtonGroup` (Approve / Edit / Reject) |
| Composer (attach, text, mic) | `InputArea` + `InputGroup` + `Button` (Phosphor icons) |
| Computer panel tabs | `Tabs` |
| Terminal output | `CodeHighlighted` (streamed `exec` output) |
| Files tree / preview | `Collapsible` tree + `CodeHighlighted` / `Table` |
| Activity / audit log, connections list | `Table`, `Pagination`, `Empty`, `SkeletonLine` |
| Rules (allow / ask / block) | `Select` / `Radio` / `Switch` |
| Routines (cron, next run) | `Input`, `DatePicker`, `Select` |
| Secrets / tokens display | `SensitiveInput`, `ClipboardText` |
| Notifications ("Expense Manager filed the report") | `Toasty` |
| Hover hints | `Tooltip` (+ `TooltipProvider` at the root) |
| Usage / cost per bot | `Meter`, `TimeseriesChart` |

---

## 9. Data model (initial)

- **D1 (global):** `users`, `bots(id, user_id, name, role, avatar, created_at)`, `threads`, and a search index of message previews.
- **UserHub SQLite:** `bots` (status cache), `group_threads`, `thread_members`, `bot_toolkits(bot_id, executor_toolkit, connections_json)`, `browser_vault(site, encrypted_state, updated_at)`, `event_log`.
- **Executor D1 (separate Worker):** integrations, connections, encrypted credentials, and policies. Owned by Executor, not by our app.
- **BotAgent SQLite:** Think messages, `memory(id, kind, text, source, confidence, created_at)`, `rules(action_class, policy)`, `routines(id, cron, skill, last_run)`, `runs(id, status, steps_json, started_at, ended_at)`, `approvals(id, action, args, decision, decided_by, at)`, `handoffs(id, target_url, instructions, state)`.
- **R2:** `/{user}/{bot}/screenshots/*`, `/artifacts/*`, `/recordings/*`.

## 10. Real-time protocol to the UI
- `useAgentChat` for messages and streaming.
- Agent `setState` broadcasts for: bot status (`idle | thinking | typing | working | action_needed`), the current Computer card (`liveViewUrl`, `status`, `title`), the step list, and pending approvals.
- The UserHub broadcasts sidebar updates (previews, unread counts) across all of a user's bots.

---

## 11. Milestones

| Phase | Scope | Rough effort |
|---|---|---|
| **M0 Spike (4–5 days)** | TanStack Start + Kumo shell on Workers (custom server entry exporting the DOs, `routeAgentRequest`, one chat screen). One Think bot + Workspace (isolate) + Kitesurf quick actions + Chromium `browser_execute` + Live View hand-off. **Deploy Executor to Cloudflare, connect Gmail, bot → Executor via service token, answer "anything actionable in my emails?", and confirm an Executor "needs approval" call shows up as an approval card (elicitation).** Confirms the risky parts. | small |
| **M1 MVP (2 weeks)** | Multiple bots (UserHub + BotAgent), sidebar UI, Computer card and take-over modal, AI Gateway, schedules, R2 screenshots, basic rules plus manual approvals, a toolkit per bot in Executor | medium |
| **M2 (2 weeks)** | More Executor integrations (Calendar, Sheets, Salesforce/HubSpot, GitHub, Slack), a morning email-digest routine, email per bot, Queue event ingestion, **Jev** triage + auto-review + injection guard, memory write-back, container backend | medium |
| **M3 (2+ weeks)** | Group threads and bot-to-bot delegation, teach-a-task (recording → skill → routine), login vault persistence, voice, Slack | large |
| **M4 Apps** | Bots build small web apps from their data (itineraries, trackers). Files in the workspace, `server.js` in a Dynamic Worker, collections in bot SQLite, realtime via an `AppLive` DO, sandboxed and served at `/apps/*` with revocable share links. Edits through a link wake the bot. Next: "Publish to Cloudflare" with `cf`, cross-user agents over MCP | medium |
| **Launch** | Template repo, blog post ("Give every agent a computer and a browser — on isolates"), demo video (Sales Outbound overnight run) | — |

## 12. Success metrics
- The demo task (Sales Outbound: sheet → research → CRM → 30+ drafts) completes without help except one login hand-off.
- Median cost per bot per day of mostly idle work, published as a comparison against a VM per user.
- **API first:** at least 70% of tasks that touch a user's app are completed through Executor with no browser session.
- "Anything actionable in my emails?" answers in under 15 s, and every item links to its source message.
- More than 80% of browser page loads served by Kitesurf rather than Chromium.
- More than 90% of shell commands run on isolates rather than containers (matching the `@cloudflare/computer` goal).
- Auto-review: 0 unapproved side effects in the "ask" classes; approval-card rate low enough to stay usable (target under 1 in 5 side effects).
- Hand-off round trip (Action needed → Done) under 60 s when the user is present.

## 13. Risks and open questions
1. **`@cloudflare/computer` is preview only** (unstable APIs, not for production). OK for a demo/template; pin versions.
2. **Kitesurf can't hold signed-in sessions.** Hence the two tiers. Verify: Kitesurf + Live View; the `browser: "kitesurf"` option in agent quick-action tools; cookie injection for authenticated reads.
3. **Login persistence** across Browser Run session expiry is the hardest part of the product. Prefer OAuth/MCP; confirm the cookie re-injection approach with the Browser Run team.
4. **Bot detection:** Browser Run is always flagged as a bot. LinkedIn and similar sites may block it. Use official APIs/MCP where possible, and be careful with scraping terms of service.
5. **Kitesurf beta limits** per account; the 24/7 multi-bot load needs higher limits.
6. **Computer per bot vs shared** (Grok shares one per user). Confirm the choice in §6.3.
7. **Jev** is early access, US-hosted and text-free. Keep an LLM fallback; check that the custom-provider path through AI Gateway works with their API.
8. **Cost runaway** from bots running 24/7. Enforce AI Gateway spend limits per user/bot and a per-bot daily budget in code.
9. **Security:** prompt injection from web and email content driving actions. Mitigate with auto-review, read-only background mode, and the injection guard.
10. **Flue:** revisit only if portability outside Cloudflare becomes a requirement.
11. **The Executor Cloudflare self-host is single-tenant.** Fine for the demo; a public multi-user product needs Executor Cloud, a fork, or a fallback to Agents SDK MCP clients per bot (§6.6 tenancy table).
12. **Showing Executor approvals in our UI** depends on MCP elicitation (or an equivalent callback) working between Executor and the Agents SDK client. Unverified; test in M0.
13. **Two approval systems** (Executor policies and our rules/Jev) could confuse users. Mitigation: Executor is the hard boundary, our UI is the single approval surface, and Jev can only make things stricter.
14. **Third-party dependency:** Executor is open source (YC-backed) but outside Cloudflare. Pin a version, keep the fork option open, and keep the Agents SDK MCP fallback working.
15. **Google OAuth verification:** reading Gmail uses restricted scopes. A public app needs Google's verification and security review. Internal/test users are fine for the demo.
16. **TanStack Start + Agents in one Worker:** the custom server entry (exporting DO classes and running `routeAgentRequest` before the TanStack handler) and client-only WebSocket hooks under SSR need to be proven in M0. Watch for TanStack Start API changes (the server-entry signature).
17. **Kumo has no chat primitives** (bubbles, message list, streaming text). We build those ourselves on Kumo tokens. Consider contributing a chat block upstream to Kumo, which is a nice DevRel story.

## 14. References
- Grok Bot: https://x.ai/bot
- OpenAI dots: https://openai.com/index/introducing-dots/ · safety: https://openai.com/index/how-we-build-safety-security-and-privacy-into-dots/
- Kitesurf update: https://blog.cloudflare.com/kitesurf-update · intro: https://blog.cloudflare.com/kitesurf · playground: https://kitesurf.dev
- `@cloudflare/computer` blog: https://blog.cloudflare.com/cloudflare-computer/ · repo: https://github.com/cloudflare/computer
- Agents SDK: https://developers.cloudflare.com/agents/ · repo: https://github.com/cloudflare/agents · starter: https://github.com/cloudflare/agents-starter
- Browser Run: https://developers.cloudflare.com/browser-run/ · limits: https://developers.cloudflare.com/browser-run/limits/ · reuse sessions: https://developers.cloudflare.com/browser-run/features/reuse-sessions/
- AI Gateway: https://developers.cloudflare.com/ai-gateway/ · unified billing: https://developers.cloudflare.com/ai-gateway/features/unified-billing/ · spend limits: https://developers.cloudflare.com/ai-gateway/features/spend-limits/
- TypeSafe / Jev: https://typesafe.ai/ · docs: https://docs.typesafe.ai/ · confidence routing: https://docs.typesafe.ai/patterns/confidence-routing.md · guardrails: https://docs.typesafe.ai/cookbooks/llm_guardrails.md
- Flue: https://flueframework.com · Cloudflare deploy: https://flueframework.com/docs/ecosystem/deploy/cloudflare/
- Executor: https://executor.sh/ · docs: https://executor.sh/docs · Cloudflare self-host: https://executor.sh/docs/hosted/cloudflare · Docker: https://executor.sh/docs/hosted/docker · Cloud: https://executor.sh/docs/hosted/cloud · MCP proxy: https://executor.sh/docs/mcp-proxy · source: https://github.com/RhysSullivan/executor
- TanStack Start: https://tanstack.com/start/ · on Workers: https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/ · Cloudflare Vite plugin: https://developers.cloudflare.com/workers/vite-plugin/
- Kumo: https://kumo-ui.com/ · installation: https://kumo-ui.com/installation/ · registry: https://kumo-ui.com/registry/ · CLI: https://kumo-ui.com/cli · design skill: https://kumo-ui.com/skill · source: https://github.com/cloudflare/kumo · Base UI: https://base-ui.com
- Secure MCP servers with Access: https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/secure-mcp-servers/
