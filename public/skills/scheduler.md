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
      "webhookUrl": "https://webhook.site/81899de5-23f4-4704-a3c0-22795ad6fc06"
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

## Dashboard (React Artifact)

When the user asks for a dashboard, visual UI, or to see their tasks visually, generate a React artifact using exactly this component. It fetches live data from the API and supports all task operations inline.

```jsx
const BASE = 'https://tldr-skills.vercel.app';

function Badge({ status }) {
  const c = { active: '#00c951', paused: '#f59e0b', completed: '#3b82f6', failed: '#ef4444' }[status] || '#888';
  return <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:12, fontSize:11, fontWeight:600, background:c+'22', color:c, border:`1px solid ${c}44` }}>{status}</span>;
}

export default function Dashboard() {
  const [tasks, setTasks] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [creating, setCreating] = React.useState(false);
  const [deleteConfirm, setDeleteConfirm] = React.useState(null);
  const [form, setForm] = React.useState({ name:'', description:'', expression:'*/5 * * * *', skill:'ping-webhook', webhookUrl:'https://webhook.site/81899de5-23f4-4704-a3c0-22795ad6fc06' });

  const load = async () => {
    try {
      const r = await fetch(`${BASE}/api/tasks`);
      const d = await r.json();
      setTasks(d.tasks || []);
      setError(null);
    } catch(e) { setError(e.message); } finally { setLoading(false); }
  };

  React.useEffect(() => { load(); const i = setInterval(load, 30000); return () => clearInterval(i); }, []);

  const run = async (id) => { await fetch(`${BASE}/api/tasks/${id}`, { method:'POST' }); load(); };
  const toggle = async (t) => {
    await fetch(`${BASE}/api/tasks/${t.id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ status: t.status==='active' ? 'paused' : 'active' }) });
    load();
  };
  const del = async (id) => { await fetch(`${BASE}/api/tasks/${id}`, { method:'DELETE' }); setDeleteConfirm(null); load(); };
  const create = async (e) => {
    e.preventDefault();
    await fetch(`${BASE}/api/tasks`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ name:form.name, description:form.description, schedule:{ type:'cron', expression:form.expression, timezone:'UTC' }, target:{ skill:form.skill, payload:{ name:'Nick Konstantino', webhookUrl:form.webhookUrl } } }) });
    setCreating(false);
    setForm({ name:'', description:'', expression:'*/5 * * * *', skill:'ping-webhook', webhookUrl:'https://webhook.site/81899de5-23f4-4704-a3c0-22795ad6fc06' });
    load();
  };

  const S = {
    root: { fontFamily:'system-ui,sans-serif', background:'#0a0a0a', color:'#ededed', minHeight:'100vh', padding:24 },
    hdr: { display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 },
    h1: { fontSize:18, fontWeight:700, letterSpacing:'-0.03em', margin:0 },
    btn: { background:'#0070f3', color:'#fff', border:'none', borderRadius:6, padding:'8px 14px', fontSize:13, cursor:'pointer' },
    ghost: { background:'#111', color:'#888', border:'1px solid #222', borderRadius:6, padding:'8px 14px', fontSize:13, cursor:'pointer' },
    sm: { background:'#111', color:'#888', border:'1px solid #1f1f1f', borderRadius:6, padding:'4px 10px', fontSize:12, cursor:'pointer', marginRight:4 },
    danger: { background:'#111', color:'#ef4444', border:'1px solid #1f1f1f', borderRadius:6, padding:'4px 10px', fontSize:12, cursor:'pointer' },
    table: { width:'100%', borderCollapse:'collapse', fontSize:13 },
    th: { textAlign:'left', padding:'8px 12px', color:'#444', fontWeight:500, borderBottom:'1px solid #1a1a1a' },
    td: { padding:'12px 12px', borderBottom:'1px solid #111', verticalAlign:'middle' },
    mono: { fontFamily:'monospace', fontSize:12, color:'#666' },
    card: { background:'#111', border:'1px solid #1f1f1f', borderRadius:8, padding:20, marginBottom:20 },
    inp: { background:'#0a0a0a', border:'1px solid #222', borderRadius:6, padding:'8px 12px', color:'#ededed', fontSize:13, width:'100%', marginBottom:10, boxSizing:'border-box' },
    lbl: { display:'block', fontSize:11, color:'#555', marginBottom:4 },
    alert: { background:'#ef444420', border:'1px solid #ef444440', borderRadius:6, padding:'10px 14px', marginBottom:16, fontSize:13, display:'flex', alignItems:'center', gap:12 },
  };

  return (
    <div style={S.root}>
      <div style={S.hdr}>
        <h1 style={S.h1}>Task Scheduler</h1>
        <div style={{ display:'flex', gap:8 }}>
          <button style={S.ghost} onClick={load}>Refresh</button>
          <button style={S.btn} onClick={() => setCreating(!creating)}>{creating ? 'Cancel' : '+ New Task'}</button>
        </div>
      </div>

      {deleteConfirm && (() => {
        const t = tasks.find(t => t.id === deleteConfirm);
        return (
          <div style={S.alert}>
            <span>Delete <strong>"{t?.name}"</strong>? This cannot be undone.</span>
            <button style={{...S.sm, color:'#ef4444'}} onClick={() => del(deleteConfirm)}>Confirm</button>
            <button style={S.sm} onClick={() => setDeleteConfirm(null)}>Cancel</button>
          </div>
        );
      })()}

      {creating && (
        <form onSubmit={create} style={S.card}>
          <label style={S.lbl}>Task name</label>
          <input style={S.inp} placeholder="ping-production-webhook" value={form.name} onChange={e => setForm(f => ({...f,name:e.target.value}))} required />
          <label style={S.lbl}>Description</label>
          <input style={S.inp} placeholder="What does this task do?" value={form.description} onChange={e => setForm(f => ({...f,description:e.target.value}))} />
          <label style={S.lbl}>Cron expression</label>
          <input style={S.inp} placeholder="*/5 * * * *" value={form.expression} onChange={e => setForm(f => ({...f,expression:e.target.value}))} required />
          <label style={S.lbl}>Target skill</label>
          <input style={S.inp} placeholder="ping-webhook" value={form.skill} onChange={e => setForm(f => ({...f,skill:e.target.value}))} required />
          <label style={S.lbl}>Webhook URL (for ping-webhook skill)</label>
          <input style={S.inp} placeholder="https://webhook.site/..." value={form.webhookUrl} onChange={e => setForm(f => ({...f,webhookUrl:e.target.value}))} />
          <button type="submit" style={S.btn}>Create Task</button>
        </form>
      )}

      {loading && <p style={{color:'#444',fontSize:13}}>Loading tasks...</p>}
      {error && <p style={{color:'#ef4444',fontSize:13}}>Error: {error}</p>}
      {!loading && !error && tasks.length === 0 && (
        <p style={{color:'#444',fontSize:13}}>No tasks yet. Click "+ New Task" or ask Claude to schedule something.</p>
      )}
      {tasks.length > 0 && (
        <table style={S.table}>
          <thead>
            <tr>{['Name','Schedule','Skill','Status','Last Run','Runs','Actions'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {tasks.map(t => (
              <tr key={t.id}>
                <td style={S.td}><div style={{fontWeight:500}}>{t.name}</div><div style={{...S.mono,fontSize:11,marginTop:2}}>{t.description}</div></td>
                <td style={{...S.td,...S.mono}}>{t.schedule.expression || t.schedule.type}</td>
                <td style={{...S.td,...S.mono}}>{t.target.skill}</td>
                <td style={S.td}><Badge status={t.status} /></td>
                <td style={{...S.td,...S.mono}}>{t.lastRun ? new Date(t.lastRun).toLocaleString() : '—'}</td>
                <td style={S.td}>{t.runCount}</td>
                <td style={S.td}>
                  <button style={S.sm} onClick={() => run(t.id)}>Run</button>
                  <button style={S.sm} onClick={() => toggle(t)}>{t.status === 'active' ? 'Pause' : 'Resume'}</button>
                  <button style={S.danger} onClick={() => setDeleteConfirm(t.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p style={{marginTop:16,fontSize:11,color:'#222'}}>Auto-refreshes every 30s · {BASE}</p>
    </div>
  );
}
```

## Example Conversations

**User:** Schedule a ping to the webhook every 5 minutes.

**Assistant:** I'll create a scheduled task with these settings:

- **Name:** ping-production-webhook
- **Schedule:** Every 5 minutes (`*/5 * * * *`)
- **Target:** ping-webhook skill
- **Payload:** `{ "name": "Nick Konstantino", "webhookUrl": "https://webhook.site/81899de5-23f4-4704-a3c0-22795ad6fc06" }`

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
