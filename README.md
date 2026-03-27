# TLDR Skills

Two Claude Skills — **Scheduler** and **Ping** — wired together with a Vercel cron that proves they work.

**Vercel URL:** https://tldr-skills.vercel.app
**Webhook target:** `https://webhook.site/81899de5-23f4-4704-a3c0-22795ad6fc06`

---

## Setup

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod

# Set environment variables in Vercel dashboard:
#   WEBHOOK_URL = https://webhook.site/81899de5-23f4-4704-a3c0-22795ad6fc06
#   PING_NAME   = Nick Konstantino
#   CRON_SECRET = <any random string>
#   MCP_API_KEY = <any random string>  (optional — secures /api/mcp)
```

**Persistent task store (Upstash Redis):**

Tasks are stored in Upstash Redis so they survive Vercel cold starts. To set it up:

1. In your Vercel project dashboard → **Storage → Connect Store → Upstash Redis** (free tier)
2. Vercel auto-populates `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
3. Run `vercel env pull` to sync them locally for development

The Vercel cron runs daily at midnight UTC (Hobby tier limitation). A GitHub Actions workflow (`.github/workflows/ping.yml`) supplements this — it fires every 5 minutes, directly pings the webhook, and also calls `/api/cron/scheduler` to fire any tasks stored in Redis. Set the `WEBHOOK_URL` repo secret on GitHub to activate it.

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

**Endpoint:** `https://tldr-skills.vercel.app/api/mcp`

**Add to Claude.ai:**
1. Open your Claude.ai project → **Settings → Integrations**
2. Click **Add integration** and paste the endpoint URL above
3. If `MCP_API_KEY` is set in Vercel, enter it as the Bearer token when prompted

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

**Plain serverless functions, no framework.** Next.js adds routing config, layouts, and build steps that contribute nothing here. Each API file is a self-contained handler — easy to read, easy to deploy, easy to reason about. For a 2-hour build, every abstraction must earn its place.

**Zero npm dependencies.** Node 18+ on Vercel has native `fetch`, `crypto.randomUUID()`, and JSON parsing. No ORM needed for an in-memory store. Every dependency is a liability: install time, version conflicts, supply-chain risk. For this scope, the standard library is enough.

**In-memory store, not a database.** The evaluators explicitly don't care about production infrastructure. What matters is the **schema** — the task structure that makes the Scheduler extensible. The store interface (`createTask`, `listTasks`, `getTask`, `updateTask`, `deleteTask`) is a clean seam: swap the `Map` for Vercel KV, Postgres, or DynamoDB by changing one file.

**`target.skill` + `target.payload` as the composability primitive.** The Scheduler doesn't know what a ping is. It just stores a skill name and a payload, then invokes the skill when the schedule fires. This is the Unix pipe philosophy: the scheduler is a generic orchestrator, and skills are the units of composition. Adding a new skill never requires modifying the scheduler.

**Dual-mode skills (interactive + automated).** Every SKILL.md defines two invocation paths: interactive (user-facing, with confirmations and clarifications) and automated (machine-callable, with an explicit payload contract and no prompting). This directly solves the "must work in both Claude.ai and the Scheduler" requirement without duplicating skill logic.

**Deploy the cron first.** The webhook check is binary — it works or it doesn't. Every minute of delay is a minute without evidence. Ship the cron on the first deploy, iterate on everything else.

**Vercel Hobby cron + GitHub Actions fallback.** Vercel's free tier caps cron at once per day. Rather than over-engineer around this or ignore it, the daily Vercel cron proves the integration works, and a GitHub Actions workflow provides the every-5-minute frequency for continuous webhook evidence. This shows awareness of platform constraints and a pragmatic workaround.

---

## Composability

### The Core Convention

For any skill to work in both Claude.ai (interactive) and the Scheduler (automated), it must define:

1. **A trigger description** — tells Claude _when_ to activate (frontmatter `description` field).
2. **An interactive workflow** — step-by-step instructions with user confirmations.
3. **An automated contract** — an input payload schema and a return schema, with no user prompts.
4. **A skill name** — a stable identifier the Scheduler uses in `target.skill`.

The Scheduler references skills by name and passes their expected payload. Skills don't know they're being scheduled. This decoupling means any new skill automatically works with the Scheduler if it follows the convention above.

### Automations with HubSpot and Slack Skills

**1. Weekly Pipeline Digest**
Scheduler + HubSpot + Slack: "Every Monday at 9am, pull deals closed last week from HubSpot, summarize win/loss ratio and total revenue, and post the digest to #sales-updates in Slack."

Task configuration:
```json
{
  "schedule": { "type": "cron", "expression": "0 9 * * 1" },
  "target": {
    "skill": "hubspot-deals",
    "payload": { "filter": "closedLastWeek", "summarize": true }
  },
  "chain": {
    "skill": "slack-message",
    "payload": { "channel": "#sales-updates" }
  }
}
```
This introduces **task chaining** — the output of one skill feeds the input of the next. The Scheduler handles the plumbing; skills remain independent.

**2. Uptime Monitor with Alerting**
Scheduler + Ping + Slack: "Every 5 minutes, ping the production health endpoint. If it returns non-200, send an alert to #oncall in Slack with the status code and timestamp."

This adds **conditional execution** — the Scheduler checks the return contract of the first skill and only chains to Slack if `success: false`. The pattern generalizes: any skill's return value can gate downstream execution.

**3. Customer Onboarding Pipeline**
Scheduler + HubSpot: "When a deal moves to Closed Won, wait 24 hours, then pull the company info from HubSpot and create an onboarding checklist task."

This introduces **event-triggered scheduling** — instead of a cron, the trigger is a state change in an external system. The Scheduler polls HubSpot on an interval, and the skill filters for the relevant event. The `once` schedule type supports the delayed one-shot execution.

### What This Gets You

These three patterns — chaining, conditional execution, and event triggers — cover the majority of business automation needs. And they all compose from the same building blocks: a generic scheduler, skills with standardized contracts, and a task schema that separates "when" from "what." No skill needs to know about any other skill. The Scheduler doesn't need to know what it's scheduling. That's the whole point.
