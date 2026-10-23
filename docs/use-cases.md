# bdots in real use: four bots, run end to end

Run on 2026-10-23 against local dev (`cf dev`, Workers AI, `@cf/deepseek-ai/deepseek-v4.1-flash-1017`).
No app connections were used (Executor and Cloudflare MCP were not ready),
so every bot worked from the public web, its shell (`curl`, `jq`), its
browser, built apps, routines, memory and other bots. Each result below was
checked against the real source, not taken from the bot's reply.

| Bot | Asked for | Time | Tools it chose | Result |
| --- | --- | ---: | --- | --- |
| Release Radar | Latest releases of `cloudflare/agents` and `cloudflare/workers-sdk`, plus a watch for new ones | 1m 15s | GitHub REST API over `curl` + `jq`, a watch script, a routine | Tags and dates match GitHub. Routine: every 30 min, only new, watch command |
| Pricing Researcher | Compare Workers, Vercel and Netlify function pricing; build a shareable app | 5m 23s | 10 pages via `browser_markdown`, `read`/`grep` on the saved copies, `save_app`, `app_data_put` | Cloudflare numbers match the official page. App renders from app data, with sources and check date |
| Docs QA | Check every link on the Agents docs landing page; CSV, open items, weekly check | 6m 20s | `browser_links`, a parallel `curl` script in batches, `browser_execute` for bot-blocked sites, `remember`, a routine | 196 links, 0 broken. An independent check found the same 196 links |
| Community Researcher → Newsletter Writer | Top 5 HN stories about agents or Cloudflare this week, handed to a writer bot | 89s + 34s | HN Algolia API over `curl`, `message_bot`; the writer re-verified via the HN Firebase API, then `write` | All five stories are real, in range, with matching points and comments. Draft saved (4.3 KB) |

## 1. Release Radar (DevRel)

**Prompt:** what shipped in `cloudflare/agents` and `cloudflare/workers-sdk`,
with a "why it matters for agent builders" line each, then watch for new
releases every 30 minutes at no cost.

**What it did:**
- It skipped the browser and went straight to `api.github.com`. It worked
  out that the API needs a `User-Agent` header and put that in the routine.
- It wrote `/workspace/watch-cf-releases.sh`, which prints repo, tag and
  date for the 10 most recent releases of each repo. It scheduled the
  routine with that script as the watch, so a quiet half hour costs no
  model call.
- It recorded what it had just reported (`mark_reported`), so the first
  real run won't repeat it.
- It pulled "Fayaz, Cloudflare DevRel" from shared memory without being
  told.

**Check:** `agents@0.30.0` (22 Oct), `agents@0.29.0` (20 Oct),
`@cloudflare/vite-plugin@1.65.0` (23 Oct), `wrangler@4.151.3` and
`create-cloudflare@2.74.2` (20 Oct) all match the GitHub API.

**Useful because:** the vite-plugin 1.65.0 note ("v1 now accepts Wrangler
config only; projects on cloudflare.config.ts move to v2 beta") is exactly
the kind of change a DevRel needs to hear about the same day.

## 2. Pricing Researcher

**Prompt:** compare Cloudflare Workers, Vercel Functions and Netlify
Functions pricing from official pages, and build a shareable app with the
numbers kept in app data.

**What it did:**
- It read the three pricing pages and then went one level deeper, into each
  vendor's function-billing and limits docs.
- It worked from saved copies under `/workspace/downloads/web/` (reading
  and grepping them) instead of fetching pages again.
- It built `/workspace/apps/functions-pricing/` with the rows in a
  `vendors` collection and the check date in `meta`, and published it with
  a share link.

**Check:**
- The Cloudflare row matches the official page: 100k requests a day free,
  $5 per month with 10M requests included, $0.30 per extra million, and
  CPU time only (30M CPU-ms included, $0.02 per extra million).
- The app renders fully in Chrome. In the Claude app's browser pane it
  shows "Could not load app data", because that pane blocks the app's
  `_bdots.js` (`ERR_BLOCKED_BY_CLIENT`). That's a pane limitation, not a
  bdots bug.

**Useful because:** it's a link you can send. The bot can refresh the
numbers later by updating the data, without rebuilding the page.

## 3. Docs QA

**Prompt:** check every link on `developers.cloudflare.com/agents/`, save a
CSV, track broken links as open items, and run a weekly check on Mondays
at 9am IST.

**What it did:**
- It collected links with `browser_links` and also parsed the raw HTML, then
  checked them in batches of 40-56 with a small parallel `curl` script.
  Each batch finished under the 60-second `exec` limit.
- Three sites answered `curl` with 403 or 429. It reopened those in its real
  browser, saw them load, and reported them as bot protection, not
  breakage.
- It saved that lesson with `remember`, so future runs won't flag them.
- It wrote `/workspace/artifacts/agents-docs-link-check-2026-10-23.csv`
  (196 rows) and `/workspace/scripts/agents-linkcheck.sh` for the routine.
- It created no open items, correctly, because nothing was broken.

**Check:**
- An independent `curl` pass found the same 196 links and no real
  breakage. Its only non-2xx answers were bot protection: the community
  site and `cloudflare.net` (as the bot found), plus three
  `dash.cloudflare.com` pages that answered 403.
- The routine is `30 3 * * 1` UTC, which is Monday 09:00 IST.

**Useful because:** it tells bot protection apart from real breakage, which
a naive link checker gets wrong. The weekly run only speaks up when
something changes.

## 4. Community Researcher → Newsletter Writer

**Prompt:** find the 5 most discussed HN stories this week about AI agents
or Cloudflare, and hand them to the Newsletter Writer for a draft.

**What it did:**
- **Researcher:**
  - Ran four queries against the HN Algolia API over a 7-day window and
    ranked by points plus comments.
  - Gave each story an angle for Cloudflare developers.
  - Kept a bigger off-topic thread as an alternate rather than padding the
    list.
  - Sent the brief with `message_bot`.
- **Writer:**
  - Woke on the message and re-checked all five IDs against the HN API
    before writing.
  - Saved `/workspace/drafts/2026-10-23-weekly.md` ("Agents, all the way
    down", about 500 words).
  - Raised two decisions: which story should lead, and the missing notes
    file.

**Check:** items 50145337, 50165953, 50198675, 50181175 and 50141657 exist,
were posted between 18 and 22 Oct, and match the reported points and comments.

**Useful because:** two bots with different jobs split the work, and the
second one checked the first one's facts instead of trusting them.

## What these runs exposed

1. **Bots couldn't share files (fixed).**
   - The researcher pointed the writer at a file in its own workspace,
     which the writer can't see because each bot has its own computer.
   - Fix: `message_bot` now takes `files` (up to 10, 5 MB in total). They
     are copied into the recipient's `/workspace/inbox/bots/<sender>/`, and
     the message lists the new paths. The prompt now tells bots never to
     pass a path to another bot.
   - Retest: asked only to "send it the full notes", the researcher
     attached the file without being told to. The writer opened it from
     its inbox and updated the draft.
2. **Slow shell loops sit close to the 60 s `exec` limit.** Docs QA batched
   on its own, and its largest batch took 54.9 s. That works, but a slower
   site would push it onto `shell_job`. A built-in "check these URLs" tool
   (parallel, with status and final URL) would make link checks and domain
   checks faster and cheaper.
3. **No connected apps in this run.** Each of these jobs would be stronger
   with Executor connected (GitHub, a CRM, email), for example opening
   issues for broken links or sending the newsletter draft for review.
