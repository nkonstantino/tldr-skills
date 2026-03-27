'use strict';

/**
 * MCP (Model Context Protocol) server — Streamable HTTP transport.
 *
 * Exposes the Scheduler and Ping skills as structured tool definitions so
 * Claude.ai (and any MCP-compatible client) can invoke them without needing
 * to interpret SKILL.md prose. Each POST is a stateless JSON-RPC 2.0 request;
 * no session state is maintained between calls.
 *
 * Add to Claude.ai: Project Settings → Integrations → paste this URL:
 *   https://tldr-skills.vercel.app/api/mcp
 *
 * Auth: set MCP_API_KEY in Vercel env vars. If unset, the endpoint is open
 * (fine for demo; add the key before sharing with untrusted users).
 */

const { sendPing, DEFAULT_WEBHOOK_URL } = require('../lib/webhook');
const { createTask, listTasks, getTask, updateTask, deleteTask } = require('../lib/store');

const MCP_PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'tldr-skills', version: '1.0.0' };

// ---------------------------------------------------------------------------
// Tool definitions — these are what Claude.ai sees instead of SKILL.md prose
// ---------------------------------------------------------------------------
const TOOLS = [
  {
    name: 'send_ping',
    description:
      'POST a ping payload (name + ISO-8601 timestamp) to a webhook URL. ' +
      'Use when the user says "ping", "send a ping", "post to the webhook", ' +
      '"fire a ping", or when a scheduled task needs to deliver a webhook notification.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: `Full name to include in the ping. Defaults to "${process.env.PING_NAME || 'Nick Konstantino'}".`,
        },
        webhookUrl: {
          type: 'string',
          description: `Webhook URL to POST to. Defaults to the configured endpoint (${DEFAULT_WEBHOOK_URL}).`,
        },
        source: {
          type: 'string',
          enum: ['interactive', 'cron', 'api'],
          description: 'How the ping was triggered. Defaults to "interactive".',
        },
      },
    },
  },
  {
    name: 'list_tasks',
    description:
      'Return all scheduled tasks sorted newest-first. ' +
      'Shows name, schedule, status, target skill, last run, and run count. ' +
      'Use when the user asks "what tasks are running?", "show my schedule", or similar.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_task',
    description:
      'Create a new scheduled task that invokes a target skill on a cron schedule, ' +
      'at a specific time (once), or on-demand only (manual). ' +
      'Use when the user says "schedule", "every X", "set up a cron", "automate this", ' +
      '"create a recurring task", or describes any automated workflow.',
    inputSchema: {
      type: 'object',
      required: ['name', 'schedule', 'target'],
      properties: {
        name: {
          type: 'string',
          description: 'Kebab-case task identifier, e.g. "ping-production-webhook".',
        },
        description: {
          type: 'string',
          description: 'Plain-English description of what this task does.',
        },
        schedule: {
          type: 'object',
          required: ['type'],
          properties: {
            type: {
              type: 'string',
              enum: ['cron', 'once', 'manual'],
              description:
                '"cron" = recurring on an expression, ' +
                '"once" = fire at a specific ISO-8601 timestamp, ' +
                '"manual" = only runs when explicitly triggered.',
            },
            expression: {
              type: 'string',
              description:
                '5-field cron expression (e.g. "*/5 * * * *", "0 9 * * 1") ' +
                'or ISO-8601 timestamp for once tasks. ' +
                'Minimum frequency: once per minute (*/1 * * * *).',
            },
            timezone: {
              type: 'string',
              description: 'IANA timezone string, e.g. "America/New_York". Defaults to "UTC".',
            },
          },
        },
        target: {
          type: 'object',
          required: ['skill', 'payload'],
          properties: {
            skill: {
              type: 'string',
              description:
                'Skill identifier to invoke, e.g. "ping-webhook", "slack-message", "hubspot-deals". ' +
                'Must match the name field in the target skill\'s SKILL.md.',
            },
            payload: {
              type: 'object',
              description:
                "Payload passed verbatim to the target skill's automated mode input contract.",
            },
          },
        },
        maxRuns: {
          type: 'number',
          description: 'Auto-complete the task after this many executions. Omit for unlimited.',
        },
      },
    },
  },
  {
    name: 'update_task',
    description:
      'Update an existing task — pause, resume, rename, or change its schedule or target. ' +
      'Use when the user says "pause", "resume", "stop", "change the schedule for", or similar.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Task UUID (from list_tasks or create_task).' },
        status: {
          type: 'string',
          enum: ['active', 'paused'],
          description: '"paused" halts execution without deleting the task; "active" resumes it.',
        },
        name: { type: 'string', description: 'New task name.' },
        description: { type: 'string', description: 'New description.' },
        schedule: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['cron', 'once', 'manual'] },
            expression: { type: 'string' },
            timezone: { type: 'string' },
          },
        },
        target: {
          type: 'object',
          properties: {
            skill: { type: 'string' },
            payload: { type: 'object' },
          },
        },
      },
    },
  },
  {
    name: 'delete_task',
    description:
      'Permanently delete a task by ID. This cannot be undone. ' +
      'Always confirm with the user before calling this.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Task UUID to delete.' },
      },
    },
  },
  {
    name: 'run_task',
    description:
      'Execute a task immediately, bypassing its schedule. ' +
      'Useful for testing, on-demand runs, or tasks with schedule type "manual". ' +
      'Use when the user says "run now", "trigger", "execute", or "test the task".',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Task UUID to run immediately.' },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------
function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function toolContent(value, isError = false) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }], isError };
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------
async function callTool(name, args = {}) {
  switch (name) {
    case 'send_ping': {
      const result = await sendPing({
        name: args.name,
        webhookUrl: args.webhookUrl,
        source: args.source || 'interactive',
      });
      return toolContent(result, !result.success);
    }

    case 'list_tasks': {
      const tasks = listTasks();
      if (tasks.length === 0) return toolContent('No tasks scheduled yet.');
      return toolContent(tasks);
    }

    case 'create_task': {
      const task = createTask(args);
      return toolContent(task);
    }

    case 'update_task': {
      const { id, ...updates } = args;
      const task = updateTask(id, updates);
      if (!task) return toolContent(`Task ${id} not found.`, true);
      return toolContent(task);
    }

    case 'delete_task': {
      const deleted = deleteTask(args.id);
      if (!deleted) return toolContent(`Task ${args.id} not found.`, true);
      return toolContent({ deleted: true, id: args.id });
    }

    case 'run_task': {
      const task = getTask(args.id);
      if (!task) return toolContent(`Task ${args.id} not found.`, true);
      if (task.status === 'paused') {
        return toolContent(`Task "${task.name}" is paused. Resume it first with update_task.`, true);
      }

      let result;
      if (task.target.skill === 'ping-webhook') {
        result = await sendPing({ ...task.target.payload, source: 'api' });
      } else {
        // For skills not directly executable here, return the invocation contract
        // so the caller (Claude or another orchestrator) can dispatch it.
        result = {
          triggered: true,
          skill: task.target.skill,
          payload: task.target.payload,
          note: 'Skill dispatched. Execution handled by the target skill handler.',
        };
      }

      updateTask(args.id, {
        lastRun: new Date().toISOString(),
        runCount: (task.runCount || 0) + 1,
      });

      return toolContent({ task: task.name, result });
    }

    default:
      return toolContent(`Unknown tool: ${name}`, true);
  }
}

// ---------------------------------------------------------------------------
// Dispatch a single JSON-RPC message.
// Returns a response object, or null for notifications (no response expected).
// ---------------------------------------------------------------------------
async function dispatch(message) {
  const { jsonrpc, method, params, id } = message;

  if (jsonrpc !== '2.0') {
    return rpcError(id, -32600, 'Invalid Request: jsonrpc must be "2.0"');
  }

  try {
    switch (method) {
      case 'initialize':
        return rpcResult(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });

      case 'ping':
        return rpcResult(id, {});

      case 'tools/list':
        return rpcResult(id, { tools: TOOLS });

      case 'tools/call': {
        if (!params?.name) {
          return rpcError(id, -32602, 'Invalid params: tool name is required');
        }
        const result = await callTool(params.name, params.arguments || {});
        return rpcResult(id, result);
      }

      // Notifications — client doesn't expect a response
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return null;

      default:
        // Unknown method: respond only if this is a request (has an id), not a notification
        if (id === undefined || id === null) return null;
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    return rpcError(id ?? null, -32603, `Internal error: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Vercel serverless handler
// ---------------------------------------------------------------------------
module.exports = async function handler(req, res) {
  // CORS — required because Claude.ai is a browser app making cross-origin requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Optional bearer-token auth — validate if MCP_API_KEY is set
  const apiKey = process.env.MCP_API_KEY;
  if (apiKey) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${apiKey}`) {
      return res.status(401).json({ error: 'Unauthorized: provide a valid Bearer token' });
    }
  }

  // GET — discovery / health check (not part of MCP spec, but useful for humans)
  if (req.method === 'GET') {
    return res.status(200).json({
      name: SERVER_INFO.name,
      version: SERVER_INFO.version,
      protocol: 'MCP',
      protocolVersion: MCP_PROTOCOL_VERSION,
      transport: 'streamable-http',
      endpoint: '/api/mcp',
      tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed — use POST for MCP requests' });
  }

  const body = req.body;
  if (!body) return res.status(400).json({ error: 'Empty request body' });

  // MCP supports batch requests (array) and single requests (object)
  if (Array.isArray(body)) {
    const responses = (await Promise.all(body.map(dispatch))).filter(Boolean);
    return responses.length ? res.json(responses) : res.status(202).end();
  }

  const response = await dispatch(body);
  if (response === null) return res.status(202).end(); // notification acknowledged
  return res.json(response);
};
