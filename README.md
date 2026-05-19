# @lumetra/engram-paperclip-plugin

Durable, explainable memory for [Paperclip](https://github.com/paperclipai/paperclip) agents — powered by [Engram](https://lumetra.io).

Paperclip agents wake on heartbeats and lose accumulated context between runs. This plugin gives every Paperclip agent four tools that persist facts, decisions, and observations across heartbeats, runs, and companies — using Engram's semantic + knowledge-graph memory.

## Tools

The plugin contributes the following tools to every Paperclip agent (namespaced as `io.lumetra.engram:<tool>` at runtime):

| Tool | What it does |
| --- | --- |
| `store_memory` | Save an atomic fact, decision, or observation to durable memory. |
| `query_memory` | Semantic + knowledge-graph search across stored memory. |
| `list_buckets` | List Engram buckets visible to this account. |
| `recall_recent` | Load the most recent memories — great for "what was I working on" at the start of a heartbeat. |

Memory is automatically bucketed by Paperclip's scopes (company / project / agent) so different companies never see each other's memory.

## Optional auto-ingestion

When `autoIngestEvents` is enabled, the plugin subscribes to Paperclip's domain events and writes summaries to Engram automatically — no agent-side code needed. Agents that later call `query_memory` can recall org history (issues created, approvals decided, agent runs finished).

## Configuration

Configured via the auto-generated settings form at `/settings/plugins/io.lumetra.engram`:

| Field | Default | Notes |
| --- | --- | --- |
| `apiKey` | _(required)_ | Engram API key. Stored as a secret reference. |
| `baseUrl` | `https://api.engram.lumetra.io` | Override for self-hosted Engram. |
| `bucketStrategy` | `per-company` | `per-company`, `per-project`, `per-agent`, or `global`. |
| `bucketPrefix` | `paperclip` | Prefix for every bucket name. |
| `autoIngestEvents` | `true` | Subscribe to `issue.*`, `agent.run.*`, `approval.*` events. |

## Install

### From a local checkout (development)

```bash
git clone https://github.com/lumetra/engram-paperclip-plugin
cd engram-paperclip-plugin
pnpm install
pnpm build

# in your Paperclip instance:
paperclipai plugin install /absolute/path/to/engram-paperclip-plugin
paperclipai plugin list
```

Then leave `pnpm dev` running for live worker reload while you iterate.

### From npm (once published)

```bash
paperclipai plugin install @lumetra/engram-paperclip-plugin
```

## Capabilities requested

This plugin requests the following Paperclip capabilities (declared statically in the manifest):

- `agent.tools.register` — contribute the four agent tools above.
- `events.subscribe` — auto-ingest Paperclip domain events.
- `http.outbound` — call the Engram HTTP API.
- `secrets.read-ref` — resolve the API key from Paperclip's secret provider.
- `plugin.state.read`, `plugin.state.write` — track per-scope bucket bindings.
- `instance.settings.register` — render the auto-generated settings form.
- `ui.dashboardWidget.register` — render the memory-stats dashboard widget.
- `activity.log.write` — attribute auto-ingested memories in the audit log.

## How bucket strategy works

| Strategy | Bucket name (example) |
| --- | --- |
| `per-company` | `paperclip-company-<companyId>` |
| `per-project` | `paperclip-project-<projectId>` |
| `per-agent` | `paperclip-agent-<agentId>` |
| `global` | `paperclip` |

Agents can override the bucket on any tool call by passing a `bucket` parameter explicitly.

## Status

Alpha. The Paperclip plugin runtime itself is alpha and treats plugin code as trusted. The Engram HTTP endpoints used here (`/v1/memories`, `/v1/memories/query`, `/v1/buckets`) follow Lumetra's public API surface.

## License

MIT — Lumetra
