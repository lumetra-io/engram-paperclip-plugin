# @lumetra/engram-paperclip-plugin

[![npm](https://img.shields.io/npm/v/@lumetra/engram-paperclip-plugin.svg)](https://www.npmjs.com/package/@lumetra/engram-paperclip-plugin)
[![license](https://img.shields.io/npm/l/@lumetra/engram-paperclip-plugin.svg)](./LICENSE)

Durable, explainable memory for [Paperclip](https://github.com/paperclipai/paperclip) agents — powered by [Engram](https://lumetra.io).

Paperclip agents wake on heartbeats and lose accumulated context between runs. This plugin closes the gap by:

1. **Auto-archiving every issue, agent run, and approval into Engram** — no agent code, no LLM tool calls required. The Paperclip host emits domain events; this plugin's worker subscribes and writes summaries to Engram automatically. You get a permanent, queryable record of the org's work from day one.
2. **Exposing four namespaced agent tools** — `io.lumetra.engram:store_memory`, `:query_memory`, `:list_buckets`, `:recall_recent` — that agents can call during runs to write custom facts or pull prior context.

> **Note on tool calls:** as of Paperclip alpha, plugin-contributed tools are registered with Paperclip's dispatcher and reachable via the `tools/execute` REST endpoint and the widget bridge, but the `claude_local` agent adapter does not yet surface them as MCP tools inside the Claude session. The event-driven auto-archive path is the reliable value today and works regardless of which adapter your agents use. See the [Compatibility](#compatibility) section for details.

## Install

```bash
# In a running Paperclip instance:
paperclipai plugin install @lumetra/engram-paperclip-plugin
paperclipai plugin list
```

Then open the settings page and paste your Engram API key:

```
http://<your-paperclip-host>/instance/settings/plugins/io.lumetra.engram
```

## Get an Engram API key

You'll need a Lumetra/Engram account.

1. Sign up at <https://lumetra.io> — free tier, no credit card required.
2. Grab your API key from the dashboard. Keys are formatted `eng_live_…`.
3. (Recommended) Configure a BYOK provider key on the [models page](https://lumetra.io/models). Engram is bring-your-own-key end-to-end — without one, `store_memory` and `query_memory` return HTTP 412.

Paste the key into the Paperclip settings form, or — if you'd rather not persist it in plugin config — set `ENGRAM_API_KEY` in your Paperclip server's environment and leave the form blank.

## What you get out of the box

With the plugin installed and `autoIngestEvents: true` (the default), the Paperclip host pushes the following events into Engram automatically:

| Paperclip event | Memory written to Engram |
| --- | --- |
| `issue.created` | `Issue created: <title>` |
| `agent.run.finished` | `Agent run finished: <agentName>: <summary>` |
| `approval.decided` | `Approval <decision>: <subject>` |

Memories are scoped by the bucket strategy you configure — by default each company gets its own bucket (`paperclip-company-<companyId>`). Buckets are auto-created on first write.

## Agent tools (when adapter support lands)

The plugin contributes the following tools to Paperclip's tool dispatcher. They're namespaced `io.lumetra.engram:<name>` at runtime so they can't shadow core tools.

| Tool | What it does |
| --- | --- |
| `store_memory` | Save an atomic fact, decision, or observation. |
| `query_memory` | Semantic + knowledge-graph search with a synthesized answer. |
| `list_buckets` | List Engram buckets visible to this account. |
| `recall_recent` | Newest-first dump of the current bucket — great for "what was I working on" at the start of a heartbeat. |

You can exercise them today via the REST API:

```bash
# Validate the live config (Paperclip → worker → Engram round-trip)
curl -X POST http://localhost:3100/api/plugins/io.lumetra.engram/config/test \
  -H 'content-type: application/json' \
  -d '{"configJson":{"apiKey":"eng_live_...","baseUrl":"https://api.lumetra.io"}}'

# Read the widget data (hits the worker's getData handler)
curl -X POST http://localhost:3100/api/plugins/io.lumetra.engram/data/engram-stats \
  -H 'content-type: application/json' \
  -d '{"companyId":"<your-company-id>","params":{"companyId":"<your-company-id>"}}'
```

## Configuration

Configured via the auto-generated settings form at `/instance/settings/plugins/io.lumetra.engram`:

| Field | Default | Notes |
| --- | --- | --- |
| `apiKey` | _(required, or use `ENGRAM_API_KEY` env var)_ | Engram API key (`eng_live_…`). |
| `baseUrl` | `https://api.lumetra.io` | Override for self-hosted Engram. |
| `bucketStrategy` | `per-company` | `per-company`, `per-project`, `per-agent`, or `global`. |
| `bucketPrefix` | `paperclip` | Prefix prepended to every bucket name. |
| `autoIngestEvents` | `true` | Subscribe to `issue.created`, `agent.run.finished`, `approval.decided` and auto-archive to Engram. |

### Bucket strategy

| Strategy | Example bucket name |
| --- | --- |
| `per-company` | `paperclip-company-<companyId>` |
| `per-project` | `paperclip-project-<projectId>` |
| `per-agent` | `paperclip-agent-<agentId>` |
| `global` | `paperclip` |

Agents and event handlers can override the bucket on any call by passing a `bucket` parameter. Buckets are auto-created on first write — if the memories endpoint returns 404, the worker `POST /v1/buckets` and retries once.

## Capabilities requested

Declared statically in the manifest so operators can audit at install time:

- `agent.tools.register` — contribute the 4 agent tools.
- `events.subscribe` — auto-ingest Paperclip domain events.
- `http.outbound` — call the Engram HTTP API.
- `plugin.state.read`, `plugin.state.write` — track per-scope bucket bindings.
- `instance.settings.register` — render the auto-generated settings form.
- `ui.dashboardWidget.register` — render the memory-stats dashboard widget.
- `activity.log.write` — attribute auto-ingested memories in the audit log.

## Compatibility

| Path | Status |
| --- | --- |
| Event auto-archive (`issue.created`, `agent.run.finished`, `approval.decided`) | ✅ Works on every adapter — host-emitted, no LLM involved. |
| `tools/execute` REST + widget bridge | ✅ Works. |
| `onValidateConfig` ("Test connection" in the settings form) | ✅ Works. |
| `claude_local` adapter exposing plugin tools to the Claude session | ⚠️ Not yet — Paperclip surfaces only Claude CLI's own MCP servers. Tools are registered with the dispatcher but the LLM doesn't see them. Tracked upstream. |
| Other adapters (`bash`, `http`, `codex`) | Untested. |

Tested against Paperclip master (`v0.3.1`) and `@paperclipai/plugin-sdk@2026.517.0`.

## Local development

```bash
git clone https://github.com/lumetra-io/engram-paperclip-plugin
cd engram-paperclip-plugin
pnpm install
pnpm dev   # tsc --watch

# in your Paperclip instance:
paperclipai plugin install /absolute/path/to/engram-paperclip-plugin
```

Paperclip watches `dist/` and reloads the worker on rebuild. Run `pnpm test` for the unit tests (bucket-resolver math + auto-create retry behavior).

## Source

- GitHub: <https://github.com/lumetra-io/engram-paperclip-plugin>
- npm: <https://www.npmjs.com/package/@lumetra/engram-paperclip-plugin>

## License

MIT — Lumetra
