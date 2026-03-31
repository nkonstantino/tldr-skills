# TLDR Scheduler

Two Claude skills — **Scheduler** and **Ping** — wired together with a Vercel cron that proves they work.

**Vercel URL:** https://tldr-scheduler.vercel.app
**Webhook target:** `https://webhook.site/07ff1583-dbde-4707-b27d-9424128ae442`

---

## Project Structure

```
api/
  mcp.js               POST — MCP server (Streamable HTTP transport)
  ping.js              POST — sends name+timestamp to any webhook
  cron/ping.js         GET  — Vercel cron handler (daily hardcoded ping)
  cron/scheduler.js    GET  — evaluates and fires due tasks from the store
  tasks/index.js       GET/POST — list and create tasks
  tasks/[id].js        GET/PATCH/DELETE — manage individual tasks
lib/
  webhook.js           Shared ping logic (single source of truth)
  store.js             Task store backed by Upstash Redis REST API
  cron-eval.js         Minimal 5-field cron expression evaluator (no deps)
scheduler/SKILL.md     Scheduler skill for Claude (interactive/automated)
ping/SKILL.md          Ping skill for Claude (interactive/automated)
```

---

## Design Decisions

**Dual-mode skills (interactive + automated).** Every SKILL.md defines two invocation paths: interactive (conversational, with confirmations and clarifications) and automated (machine-callable, with an explicit payload contract and no prompting). This directly solves the "must work in both Claude.ai and the Scheduler" requirement without duplicating skill logic. 
Skills are also kept well under a ~500 line limit. 'Length' was listed under the "What we don't care about" section, so this was done as a deliberate discipline to prevent context bloat. A skill that requires a wall of prose to describe is usually a skill that's doing too much.

**Each skill instructs its own setup.** Each SKILL.md includes a Setup section that instructs Claude Code to register the MCP server if it isn't already configured. In Claude.ai, where shell network access isn't available, skills fall back to REST automatically — the MCP connector can still be added manually via Settings → Connectors, but it isn't a hard requirement for read-only access.
If a Claude.ai user wants to make any changes to their task list, the skill will walk them through setting up the MCP server to fully unlock them. This is a hard requirement that Anthropic has put into place, as `web_fetch` only works for GET requests, and anything that requires POST is inaccessible while the network blocks curl. If we were to devise a way to jailbreak Claude and allow curl requests without the MCP server, that would be a serious security concern that could allow unmonitored or malicious skills to run rampant.

**Plain serverless functions, no framework.** Next.js adds routing config, layouts, and build steps that contribute nothing here. Each API file is a self-contained handler — easy to read, easy to deploy, easy to reason about. Every abstraction must earn its place.

**Zero npm dependencies.** Node 18+ on Vercel has native `fetch`, `crypto.randomUUID()`, and JSON parsing. The Upstash Redis client is just `fetch` calls — no SDK needed. Every dependency is a liability: install time, version conflicts, supply-chain risk. For this scope, the standard library is enough.

**Upstash Redis via REST API, not a full ORM.** Tasks need to survive Vercel cold starts, so an in-memory store won't do. Upstash Redis is the right call: Vercel marketplace native, accessible via plain HTTP, no client library. The store interface (`createTask`, `listTasks`, `getTask`, `updateTask`, `deleteTask`) is a clean seam: swap the Redis hash for Postgres or DynamoDB by changing one file.

**`target.skill` + `target.payload` as the composability primitive.** The Scheduler doesn't know what a ping is. It stores a skill name and a payload, then invokes the skill when the schedule fires. This is the Unix pipe philosophy: the scheduler is a generic orchestrator, skills are the units of composition. The scheduler stores skills generically, even though only `ping-webhook` is directly executed today. Currently, `ping-webhook` is the only skill with full execution wired up — other skills return an invocation contract (`{ triggered: true, skill, payload }`) that's ready to be handled as new skills are implemented.

**MCP is thin now, but intentional.** Right now, pinging a webhook isn't complex enough to need a full MCP layer. On the other hand, building it didn't take long and it speaks to the broader vision. As HubSpot and Slack skills get folded in, entire multi-step workflows (fetch → diff → interpret → notify) can be encapsulated as a single MCP tool. This layer is here for when it needs to carry real weight.

**Vercel cron + Redis as the scheduling backbone.** Claude's memory is ephemeral and inaccessible between sessions so it can't be the scheduler's source of truth. Redis stores task definitions as JSON blobs that the cron endpoint reads on every tick. The cron loops through active tasks, fires any that are due, and updates execution metadata (lastRun / runCount). The architecture is correct at any tick frequency; the only knob is `vercel.json`.

---
## Considered, but decided against:

**Pure AI Memory storing Task List** - AI Memory is not reliable or persistent between sessions, but also unreachable from a Vercel cron. At best the Vercel cron endpoint can hit the Claude API, but that won't be reflected in our personal Claude UI and needs to be delivered via third party (Slack, Email, Discord, etc).

**Pure curl requests with Local Storage** - This is probably the lightest weight solution, but the project requirements that Claude.ai users have a way to eventually access/update the task list makes it impossible, as those options are disabled in the Chat mode of Claude by default. Also, the local task list wouldn't be centrally accessible anywhere for monitoring.

**Local / Remote Tasks** - Again, this is an amazing feature built into Claude Code, but inaccessible by people who are using Claude.ai Chat. The task scheduling within Claude Code allows for very powerful setup of all kinds of tasks utilizing set connectors and permissions, but ultimately isn't something that you can set up from Chat. Again, the task list itself wouldn't be centralized and observable anywhere for monitoring/quality assurance.

**Artifacts** - I had toyed with the idea of the frontend available at the Vercel link being an artifact embedded inside of the Scheduler skill (or a normal, sharable artifact to include in the deliverable) but ultimately the goal is to allow users to access and update these features via chat, and creating the artifact would require additional setup or skill lines to interpret and may not reliably resolve into a working view of the dashboard.

**Storing the initializing prompt** - If there is one thing I'm always curious about, it's how people are prompting and the results they're getting. Storing it within the Scheduler context does not seem like the ideal separation of concerns, so I opted against doing so here.
---

## Composability

Every workflow is an MCP tooling opportunity. This setup is straightforward to extend: HubSpot and Slack each have existing MCP servers and API endpoints, so the integration layer is mostly about defining the right skill contracts and wiring them into the Scheduler.

### The Core Convention

For any skill to work in both Claude.ai (interactive) and the Scheduler (automated), it must define:

1. **A trigger description** — tells Claude _when_ to activate (frontmatter `description` field).
2. **An interactive workflow** — step-by-step instructions with user confirmations.
3. **An automated contract** — an input payload schema and a return schema, with no user prompts.
4. **A skill name** — a stable identifier the Scheduler uses in `target.skill`.

The Scheduler references skills by name and passes their expected payload. Skills don't know they're being scheduled. This decoupling means any new skill automatically works with the Scheduler if it follows the convention above.

### Automations with HubSpot and Slack Skills

**1. Check Deal Status + Celebrate Closure**

At a set interval, the Scheduler calls a HubSpot skill to fetch current deal states and diff them against the last stored snapshot in Redis. If a deal moved to Closed/Won, that delta gets passed to Claude via API, not to produce a raw data dump, but to generate something worth reading: a message that puts the win in context (team member, deal size, progress toward quota). Claude's output goes straight to Slack via the Slack skill. The snapshot updates. Next tick, same check.

This pattern (fetch → diff → interpret → notify) is the template for most sales intelligence automations.

**2. Deal Follow-Up Nudge**

Identify deals that have gone cold: no activity in 14+ days, or manually flagged for follow-up by a rep. On a Friday morning schedule, the HubSpot skill surfaces these deals with owner info, and the Slack skill sends a direct message to each owner. The message can include the last activity date, the deal value, and a suggested next step generated by Claude. Optionally chains to calendar or email tooling to make acting on the nudge frictionless.

**3. New Deal Onboarding**

When a deal moves to Closed/Won, schedule a one-shot task 24 hours out. That task pulls company and contact info from HubSpot and uses the Slack skill to notify the onboarding team with everything they need to kick off: company name, deal size, key contacts, and a Claude-generated summary of any notes from the deal record. The `once` schedule type handles the delay; the Scheduler's `lastRun` tracking ensures it fires exactly once.

### What This Gets You

These three patterns (change detection, proactive nudging, and event-triggered one-shots) cover the majority of sales workflow automation. They all compose from the same building blocks: a generic scheduler, skills with standardized contracts, and a task schema that separates "when" from "what." No skill needs to know about any other skill. The Scheduler doesn't need to know what it's scheduling. That's the whole point.

---

## Interactive vs Automated Skill Modes: Making the Scheduler work for any Claude surface

Each skill is written with two execution modes so the same capability can serve both people and systems. **Interactive mode** is conversational: it asks clarifying questions, confirms destructive actions, and explains outcomes in user-friendly language. **Automated mode** is contract-driven: it accepts structured input, executes without back-and-forth, and returns predictable structured output for orchestration.

This split is what makes skills reusable. Claude.ai can use the interactive path when a human is driving, while the Scheduler can use the automated path when a job is running on a timer. One skill definition, two interfaces, no forks or adapter code.

---

## Setup

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod

# Set environment variables in Vercel dashboard:
#   WEBHOOK_URL = https://webhook.site/07ff1583-dbde-4707-b27d-9424128ae442
#   PING_NAME   = Nick Konstantino
#   CRON_SECRET = <any random string>
#   MCP_API_KEY = <any random string>  (optional — secures /api/mcp)
```

**Persistent task store (Upstash Redis):**

Tasks are stored in Upstash Redis so they survive Vercel cold starts. To set it up:

1. In your Vercel project dashboard → **Storage → Connect Store → Upstash Redis** (free tier)
2. Vercel auto-populates `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
3. Run `vercel env pull` to sync them locally for development

The Vercel cron currently runs every 15 minutes (`*/15 * * * *`) — configurable in `vercel.json`. I know the assignment was to use free tier Vercel (which fires a total of once per day in a wide window), but I had to upgrade my Vercel this weekend for my personal project. We can test new tasks during the panel review if you'd like!

To test locally:
```bash
vercel dev
curl -X POST http://localhost:3000/api/ping \
  -H "Content-Type: application/json" \
  -d '{"name":"Nick Konstantino"}'
```

---

## MCP Server (Claude.ai Integration)

The API is also exposed as a remote MCP server, giving Claude structured tool definitions instead of relying on SKILL.md prose. This means more reliable tool calls and no need to describe HTTP contracts in natural language.

**Endpoint:** `https://tldr-scheduler.vercel.app/api/mcp`

**Add to Claude.ai:**
1. Go to **Settings → Connectors**
2. Click **Add custom connector**
3. Enter a name (e.g. `TLDR scheduler`) and paste the endpoint URL above
4. Click **Add**

**Available tools:**

| Tool | Description |
|------|-------------|
| `send_ping` | POST a ping payload to a webhook URL |
| `list_tasks` | Return all scheduled tasks |
| `create_task` | Create a new scheduled task |
| `update_task` | Pause, resume, or modify a task |
| `delete_task` | Permanently delete a task |
| `run_task` | Execute a task immediately, bypassing its schedule |

You can verify the server is healthy at `GET /api/mcp` — it returns a tool manifest without needing a JSON-RPC request.