import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import {
  DEFAULT_CONFIG,
  EXPORT_NAMES,
  PLUGIN_ID,
  PLUGIN_VERSION,
  SLOT_IDS,
  TOOL_NAMES,
} from "./constants.js";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Engram Memory",
  description:
    "Durable, explainable memory for Paperclip agents. Agents store and recall facts, decisions, and context across heartbeats, runs, and companies using Lumetra's Engram memory service.",
  author: "Lumetra",
  categories: ["connector", "automation", "ui"],
  capabilities: [
    "agent.tools.register",
    "events.subscribe",
    "http.outbound",
    "plugin.state.read",
    "plugin.state.write",
    "instance.settings.register",
    "ui.dashboardWidget.register",
    "activity.log.write",
    // "secrets.read-ref" — re-add once company-scoped plugin config / secret-ref
    // inputs are enabled in the host. The worker also gracefully falls back to
    // the raw config value, so keeping this off means one fewer capability gate
    // to approve.
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      apiKey: {
        type: "string",
        title: "Engram API Key",
        description:
          "Your Lumetra/Engram API key. Stored in plugin config (plaintext, instance-scoped). Leave blank and set ENGRAM_API_KEY in the server env instead if you'd rather not persist it.",
      },
      baseUrl: {
        type: "string",
        title: "Engram API Base URL",
        description: "Override for self-hosted Engram. Defaults to Lumetra cloud.",
        default: DEFAULT_CONFIG.baseUrl,
      },
      bucketStrategy: {
        type: "string",
        title: "Bucket Strategy",
        description:
          "How to scope memory buckets. per-company isolates memory between companies (recommended); per-project narrows further; per-agent gives each agent its own memory; global shares one bucket across the instance.",
        enum: ["per-company", "per-project", "per-agent", "global"],
        default: DEFAULT_CONFIG.bucketStrategy,
      },
      bucketPrefix: {
        type: "string",
        title: "Bucket Name Prefix",
        description:
          "Prefix prepended to every bucket name (e.g. 'paperclip-<companyId>'). Use to disambiguate if this Engram account is shared with other apps.",
        default: DEFAULT_CONFIG.bucketPrefix,
      },
      autoIngestEvents: {
        type: "boolean",
        title: "Auto-ingest Paperclip events",
        description:
          "Subscribe to issue.created / issue.updated / agent.run.finished and write summaries into Engram automatically. Lets agents recall org history without any agent-side code.",
        default: DEFAULT_CONFIG.autoIngestEvents,
      },
    },
  },
  tools: [
    {
      name: TOOL_NAMES.storeMemory,
      displayName: "Engram: Store Memory",
      description:
        "Save a fact, decision, observation, or piece of context to durable memory. Use sparingly — store atomic facts (one concept per call) and prefer specifics over summaries. Returns the stored memory id.",
      parametersSchema: {
        type: "object",
        required: ["content"],
        properties: {
          content: {
            type: "string",
            description:
              "The fact to remember. Atomic and specific. Good: 'Acme prefers vendor invoices in NET-30 not NET-15'. Bad: 'misc notes about acme'.",
          },
          bucket: {
            type: "string",
            description:
              "Optional bucket override. Defaults to the bucket resolved from the configured bucketStrategy and current run context.",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Optional tags to attach (e.g. ['decision','customer:acme']).",
          },
        },
      },
    },
    {
      name: TOOL_NAMES.queryMemory,
      displayName: "Engram: Query Memory",
      description:
        "Semantic + knowledge-graph search across stored memory. Use before answering questions about prior decisions, customer preferences, or accumulated context. Returns the most relevant memories.",
      parametersSchema: {
        type: "object",
        required: ["question"],
        properties: {
          question: {
            type: "string",
            description: "Natural-language question or topic to search for.",
          },
          bucket: {
            type: "string",
            description: "Optional bucket override.",
          },
          k: {
            type: "integer",
            minimum: 1,
            maximum: 50,
            default: 8,
            description: "How many memories to return.",
          },
        },
      },
    },
    {
      name: TOOL_NAMES.listBuckets,
      displayName: "Engram: List Buckets",
      description:
        "List available memory buckets visible to this Engram account. Useful for cross-company recall or auditing.",
      parametersSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: TOOL_NAMES.recallRecent,
      displayName: "Engram: Recall Recent",
      description:
        "Return the most recently stored memories in the current bucket. Use at the start of a heartbeat to re-load 'what was I working on'.",
      parametersSchema: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 50,
            default: 10,
          },
          bucket: { type: "string" },
        },
      },
    },
  ],
  ui: {
    slots: [
      {
        type: "dashboardWidget",
        id: SLOT_IDS.dashboardWidget,
        displayName: "Engram Memory",
        exportName: EXPORT_NAMES.dashboardWidget,
      },
    ],
  },
};

export default manifest;
