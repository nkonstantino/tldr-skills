---
name: task-scheduler
description: >
  Create, list, update, delete, and run scheduled tasks that execute other skills
  automatically. Use when the user says "schedule", "every hour", "set up a cron",
  "run this on a schedule", "automate this", "create a recurring task", or wants to
  manage any automated workflow.
---

## What This Skill Does

Manages scheduled tasks that execute other skills at defined intervals. Each task has a schedule (cron, one-shot, or manual) and a target (which skill to run, with what payload). The Scheduler is skill-agnostic — it doesn't know what it's scheduling, only when and how to invoke it.

## Core Concepts

- **Task** — A named unit of work: a schedule + a target skill + a payload.
- **Schedule** — When to run: a cron expression, a one-time timestamp, or manual-only.
- **Target** — What to run: a skill name and the payload to pass it.
- **Execution** — The scheduler invokes the target skill with the stored payload and records the result.

## Task Schema

Every task follows this structure. Use it exactly when creating or displaying tasks.

```json
{
  "id": "uuid",
  "name": "ping-production-webhook",
  "description": "Pings the production webhook every 5 minutes",
  "schedule": {
    "type": "cron",
    "expression": "*/5 * * * *",
    "timezone": "UTC"
  },
  "target": {
    "skill": "ping-webhook",
    "payload": {
      "name": "Nick Konstantino",
      "webhookUrl": "https://webhook.site/47cdccd9-78bb-420d-bce2-9f34d05df913"
    }
  },
  "status": "active",
  "lastRun": "2026-03-26T12:00:00.000Z",
  "nextRun": "2026-03-26T12:05:00.000Z",
  "createdAt": "2026-03-26T11:00:00.000Z",
  "runCount": 12,
  "maxRuns": null
}
```

### Field Reference

| Field                | Type                                    | Description                                         |
|----------------------|-----------------------------------------|-----------------------------------------------------|
| `id`                 | string (UUID)                           | Auto-generated unique identifier                    |
| `name`               | string                                  | Human-readable task name (kebab-case recommended)   |
| `description`        | string                                  | What this task does, in plain English               |
| `schedule.type`      | `"cron"` \| `"once"` \| `"manual"`      | Cron = recurring, once = fire-and-forget, manual = API-triggered only |
| `schedule.expression`| string \| null                          | Cron expression (5-field) or ISO-8601 timestamp     |
| `schedule.timezone`  | string                                  | IANA timezone (default: `"UTC"`)                    |
| `target.skill`       | string                                  | Name of the skill to invoke                         |
| `target.payload`     | object                                  | Payload passed to the target skill                  |
| `status`             | `"active"` \| `"paused"` \| `"completed"` \| `"failed"` | Current task state              |
| `lastRun`            | string \| null                          | ISO-8601 timestamp of last execution                |
| `nextRun`            | string \| null                          | ISO-8601 timestamp of next scheduled execution      |
| `createdAt`          | string                                  | ISO-8601 creation timestamp                         |
| `runCount`           | number                                  | Total times this task has executed                   |
| `maxRuns`            | number \| null                          | Stop after this many runs (null = unlimited)        |

## API Methods

Base URL is the deployed Vercel app URL.

| Action         | Method   | Path              | Body                                              |
|----------------|----------|-------------------|----------------------------------------------------|
| List tasks     | `GET`    | `/api/tasks`      | —                                                  |
| Create task    | `POST`   | `/api/tasks`      | `{ name, description, schedule, target }`          |
| Get task       | `GET`    | `/api/tasks/:id`  | —                                                  |
| Update task    | `PATCH`  | `/api/tasks/:id`  | Partial task object (e.g., `{ status: "paused" }`) |
| Delete task    | `DELETE` | `/api/tasks/:id`  | —                                                  |

## Workflow: Creating a Task

When the user asks to schedule something, follow these steps:

1. **Identify the target skill.** What does the user want to run? Match it to a known skill name (e.g., `ping-webhook`, `slack-message`, `hubspot-deals`).
2. **Build the payload.** What parameters does the target skill need? Refer to that skill's automated mode contract.
3. **Determine the schedule.** Translate the user's natural language into a cron expression or timestamp:

   | User says              | Cron expression   |
   |------------------------|-------------------|
   | "every 5 minutes"      | `*/5 * * * *`     |
   | "every hour"           | `0 * * * *`       |
   | "every morning at 9"   | `0 9 * * *`       |
   | "weekdays at noon"     | `0 12 * * 1-5`    |
   | "every Monday at 8am"  | `0 8 * * 1`       |
   | "once at 3pm today"    | Use `type: "once"` with ISO-8601 timestamp |

4. **Confirm with the user** before creating. Show them the task summary:
   > "I'll create a task named **{name}** that runs **{skill}** on schedule **{expression}** ({human-readable}). Does that look right?"
5. **Create the task** via `POST /api/tasks`.
6. **Report success** with the task ID and next scheduled run.

## Workflow: Managing Tasks

**"What tasks are running?"** → `GET /api/tasks` → display as a table:

| Name | Schedule | Target Skill | Status | Last Run | Run Count |
|------|----------|-------------|--------|----------|-----------|

**"Pause the ping task"** → Find the task by name → `PATCH /api/tasks/:id` with `{ "status": "paused" }` → confirm.

**"Delete the ping task"** → Find the task by name → **ask the user to confirm deletion** → `DELETE /api/tasks/:id`.

**"Run the ping task now"** → Find the task → execute the target skill immediately with its stored payload, bypassing the schedule.

## Guardrails

Apply these rules to every task operation:

1. **No cron faster than once per minute.** If the user asks for sub-minute frequency, explain the limitation and suggest `*/1 * * * *` as the minimum.
2. **Validate cron expressions.** Must be exactly 5 space-separated fields. If invalid, ask the user to clarify.
3. **Confirm before deleting.** Always ask "Are you sure you want to delete **{task name}**?" before calling DELETE.
4. **No duplicate tasks.** Before creating, check if a task with the same schedule and target skill already exists. If so, ask the user if they want to update the existing one instead.
5. **Warn on high frequency.** If the cron is every 1-2 minutes, note that this will consume execution budget quickly.

## Composability

The Scheduler works with any skill that defines an automated mode contract — an input payload and a return shape. To add a new skill:

1. The skill defines its payload schema in its own `SKILL.md`.
2. The Scheduler references the skill by name in `target.skill`.
3. The Scheduler passes the skill's expected payload in `target.payload`.

The Scheduler never needs to be modified to support a new skill. This is the core design principle.

## Example Conversations

**User:** Schedule a ping to the webhook every 5 minutes.

**Assistant:** I'll create a scheduled task with these settings:

- **Name:** ping-production-webhook
- **Schedule:** Every 5 minutes (`*/5 * * * *`)
- **Target:** ping-webhook skill
- **Payload:** `{ "name": "Nick Konstantino", "webhookUrl": "https://webhook.site/47cdccd9-78bb-420d-bce2-9f34d05df913" }`

Does that look right?

**User:** Yes.

**Assistant:** Task created! ID: `a1b2c3d4-...`. Next run: 2026-03-26T12:05:00Z.

---

**User:** What tasks do I have?

**Assistant:**

| Name                    | Schedule          | Skill        | Status | Runs |
|-------------------------|-------------------|-------------|--------|------|
| ping-production-webhook | `*/5 * * * *`     | ping-webhook | active | 42   |

---

**User:** Pause the ping task.

**Assistant:** Paused **ping-production-webhook**. It won't run until you resume it. Say "resume the ping task" to reactivate it.
