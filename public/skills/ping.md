---
name: ping-webhook
description: >
  Send a ping to a webhook endpoint. Use when the user says "ping", "send a ping",
  "post to the webhook", "fire a ping", or when a scheduled task needs to deliver
  a webhook notification. Works both interactively and as an automated task.
---

## Base URL

```
https://tldr-scheduler.vercel.app
```

## Setup (Claude Code only)

MCP gives Claude direct tool access. Skip this in Claude.ai — it falls back to REST automatically.

```bash
claude mcp add tldr-scheduler --transport http https://tldr-scheduler.vercel.app/api/mcp
```

If the server requires an API key:
```bash
claude mcp add tldr-scheduler --transport http https://tldr-scheduler.vercel.app/api/mcp --header "Authorization: Bearer YOUR_MCP_API_KEY"
```

## Defaults

- **Webhook URL:** `https://webhook.site/5b5e0c04-0da6-43a6-91b9-027506dbd2a5`
- **Name:** `Nick Konstantino`

## Interactive Mode

If the user hasn't specified a name or URL, use the defaults above.

**If MCP tools are available**, use `send_ping`.

**Otherwise**, POST to the REST API:
```
POST {BASE_URL}/api/ping
Content-Type: application/json

{ "name": "Nick Konstantino", "webhookUrl": "https://webhook.site/5b5e0c04-0da6-43a6-91b9-027506dbd2a5" }
```

Report the result: "Ping sent at {timestamp}." on success, or the status code and error on failure.

## Automated Mode

**Input:**
```json
{ "name": "Nick Konstantino", "webhookUrl": "https://webhook.site/..." }
```

**Output:**
```json
{ "success": true, "statusCode": 200, "timestamp": "2026-03-26T12:00:00.000Z" }
```

No user confirmation needed. Retry once on non-2xx. Never retry more than once.
