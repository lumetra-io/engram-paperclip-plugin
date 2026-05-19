import {
  definePlugin,
  runWorker,
  type PluginContext,
  type PluginEvent,
  type ToolResult,
  type ToolRunContext,
} from "@paperclipai/plugin-sdk";
import {
  DEFAULT_CONFIG,
  PLUGIN_ID,
  TOOL_NAMES,
  type BucketStrategy,
} from "./constants.js";
import { EngramClient, EngramHttpError } from "./engram-client.js";
import { resolveBucket } from "./bucket.js";

interface EngramConfig {
  apiKey: string;
  baseUrl: string;
  bucketStrategy: BucketStrategy;
  bucketPrefix: string;
  autoIngestEvents: boolean;
}

let client: EngramClient | null = null;
let resolvedConfig: EngramConfig | null = null;
let currentContext: PluginContext | null = null;

function readConfig(raw: Record<string, unknown> | null | undefined): EngramConfig | null {
  const envKey = process.env.ENGRAM_API_KEY?.trim();
  const cfg = (raw ?? {}) as Partial<EngramConfig> & { apiKey?: string };
  const configKey = cfg.apiKey?.trim();
  const apiKey = envKey || configKey;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (cfg.baseUrl?.trim() || DEFAULT_CONFIG.baseUrl),
    bucketStrategy: (cfg.bucketStrategy ?? DEFAULT_CONFIG.bucketStrategy) as BucketStrategy,
    bucketPrefix: cfg.bucketPrefix ?? DEFAULT_CONFIG.bucketPrefix,
    autoIngestEvents: cfg.autoIngestEvents ?? DEFAULT_CONFIG.autoIngestEvents,
  };
}

async function loadConfig(ctx: PluginContext): Promise<EngramConfig | null> {
  const raw = (await ctx.config.get()) as Record<string, unknown> | null | undefined;
  return readConfig(raw);
}

function bindClient(ctx: PluginContext, cfg: EngramConfig): EngramClient {
  client = new EngramClient({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, http: ctx.http });
  resolvedConfig = cfg;
  return client;
}

function ensure(): { client: EngramClient; config: EngramConfig } | { error: string } {
  if (!client || !resolvedConfig) {
    return { error: "Engram plugin is not configured. Set apiKey in plugin settings or ENGRAM_API_KEY in the server env." };
  }
  return { client, config: resolvedConfig };
}

function toolError(err: unknown): ToolResult {
  if (err instanceof EngramHttpError) {
    const detail = typeof err.body === "string" ? err.body : JSON.stringify(err.body);
    return { error: `Engram API ${err.status}: ${err.message}${detail ? ` — ${detail.slice(0, 300)}` : ""}` };
  }
  if (err instanceof Error) return { error: err.message };
  return { error: "Unknown error" };
}

async function registerTools(ctx: PluginContext): Promise<void> {
  ctx.tools.register(
    TOOL_NAMES.storeMemory,
    {
      displayName: "Engram: Store Memory",
      description: "Save an atomic fact to durable Engram memory.",
      parametersSchema: {
        type: "object",
        required: ["content"],
        properties: {
          content: { type: "string" },
          bucket: { type: "string" },
          dedup: { type: "string", enum: ["off", "loose", "strict"] },
        },
      },
    },
    async (params, runCtx: ToolRunContext): Promise<ToolResult> => {
      const ready = ensure();
      if ("error" in ready) return { error: ready.error };
      try {
        const payload = params as { content?: string; bucket?: string; dedup?: "off" | "loose" | "strict" };
        if (!payload.content) return { error: "content is required" };
        const bucket = resolveBucket({
          strategy: ready.config.bucketStrategy,
          prefix: ready.config.bucketPrefix,
          runCtx,
          override: payload.bucket,
        });
        const memory = await ready.client.storeMemory({
          content: payload.content,
          bucket,
          dedup: payload.dedup,
        });
        return {
          content: `Stored memory ${memory.id ?? ""} in bucket ${bucket} (${memory.status ?? "stored"}).`,
          data: { memoryId: memory.id, bucket, status: memory.status, merge_reason: memory.merge_reason },
        };
      } catch (err) {
        return toolError(err);
      }
    },
  );

  ctx.tools.register(
    TOOL_NAMES.queryMemory,
    {
      displayName: "Engram: Query Memory",
      description: "Semantic + graph search across stored Engram memory with synthesized answer.",
      parametersSchema: {
        type: "object",
        required: ["question"],
        properties: {
          question: { type: "string" },
          bucket: { type: "string" },
          buckets: { type: "array", items: { type: "string" } },
          k: { type: "integer", minimum: 1, maximum: 50 },
        },
      },
    },
    async (params, runCtx: ToolRunContext): Promise<ToolResult> => {
      const ready = ensure();
      if ("error" in ready) return { error: ready.error };
      try {
        const payload = params as { question?: string; bucket?: string; buckets?: string[]; k?: number };
        if (!payload.question) return { error: "question is required" };
        const buckets =
          payload.buckets && payload.buckets.length > 0
            ? payload.buckets
            : [
                resolveBucket({
                  strategy: ready.config.bucketStrategy,
                  prefix: ready.config.bucketPrefix,
                  runCtx,
                  override: payload.bucket,
                }),
              ];
        const result = await ready.client.query({ query: payload.question, buckets, k: payload.k });
        const summary = result.result?.trim();
        const sourceLines = (result.sources ?? [])
          .map((s, i) => `[${i + 1}] (${s.score?.toFixed(2) ?? "—"}) ${s.content}`)
          .join("\n");
        return {
          content: summary
            ? `${summary}${sourceLines ? `\n\nSources:\n${sourceLines}` : ""}`
            : sourceLines || `No memories found in [${buckets.join(", ")}] for: ${payload.question}`,
          data: result,
        };
      } catch (err) {
        return toolError(err);
      }
    },
  );

  ctx.tools.register(
    TOOL_NAMES.listBuckets,
    {
      displayName: "Engram: List Buckets",
      description: "List all Engram buckets visible to this account.",
      parametersSchema: { type: "object", properties: {} },
    },
    async (): Promise<ToolResult> => {
      const ready = ensure();
      if ("error" in ready) return { error: ready.error };
      try {
        const buckets = await ready.client.listBuckets();
        return {
          content: buckets.length
            ? buckets
                .map((b) => `${b.name}${b.memory_count != null ? ` (${b.memory_count} memories)` : ""}`)
                .join("\n")
            : "No buckets yet.",
          data: { buckets },
        };
      } catch (err) {
        return toolError(err);
      }
    },
  );

  ctx.tools.register(
    TOOL_NAMES.recallRecent,
    {
      displayName: "Engram: Recall Recent",
      description: "Recent memories in the current bucket. Use at start of a heartbeat to load 'what was I working on'.",
      parametersSchema: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 50 },
          bucket: { type: "string" },
        },
      },
    },
    async (params, runCtx: ToolRunContext): Promise<ToolResult> => {
      const ready = ensure();
      if ("error" in ready) return { error: ready.error };
      try {
        const payload = params as { limit?: number; bucket?: string };
        const bucket = resolveBucket({
          strategy: ready.config.bucketStrategy,
          prefix: ready.config.bucketPrefix,
          runCtx,
          override: payload.bucket,
        });
        const memories = await ready.client.listMemories({ bucket, limit: payload.limit });
        return {
          content: memories.length
            ? memories.map((m) => `• ${m.content}`).join("\n")
            : `No recent memories in ${bucket}.`,
          data: { bucket, memories },
        };
      } catch (err) {
        return toolError(err);
      }
    },
  );
}

async function registerEventIngestion(ctx: PluginContext): Promise<void> {
  // Subscriptions are registered once at setup() and remain live even before
  // the plugin is configured. Each handler reads the current resolvedConfig at
  // dispatch time so a later config save activates ingestion without restart.
  const writeFromEvent = async (event: PluginEvent, summary: string): Promise<void> => {
    if (!client || !resolvedConfig || !resolvedConfig.autoIngestEvents) return;
    try {
      const companyId =
        (event as { companyId?: string }).companyId ??
        (event as { entityCompanyId?: string }).entityCompanyId;
      const projectId = (event as { projectId?: string }).projectId;
      const bucket = resolveBucket({
        strategy: resolvedConfig.bucketStrategy,
        prefix: resolvedConfig.bucketPrefix,
        scopeHint: { companyId, projectId },
      });
      await client.storeMemory({ content: summary, bucket });
    } catch (err) {
      ctx.logger.warn("auto-ingest failed", { error: err instanceof Error ? err.message : err });
    }
  };

  ctx.events.on("issue.created", async (event) => {
    const e = event as PluginEvent & { payload?: { title?: string } };
    await writeFromEvent(e, `Issue created: ${e.payload?.title ?? e.entityId ?? "(no title)"}`);
  });

  ctx.events.on("agent.run.finished", async (event) => {
    const e = event as PluginEvent & { payload?: { agentName?: string; summary?: string } };
    await writeFromEvent(
      e,
      `Agent run finished${e.payload?.agentName ? ` (${e.payload.agentName})` : ""}: ${
        e.payload?.summary ?? e.entityId ?? "(no summary)"
      }`,
    );
  });

  ctx.events.on("approval.decided", async (event) => {
    const e = event as PluginEvent & { payload?: { decision?: string; subject?: string } };
    await writeFromEvent(e, `Approval ${e.payload?.decision ?? "decided"}: ${e.payload?.subject ?? e.entityId}`);
  });
}

async function registerWidgetData(ctx: PluginContext): Promise<void> {
  ctx.data.register("engram-stats", async (params): Promise<unknown> => {
    const ready = ensure();
    if ("error" in ready) {
      return { bucket: null, strategy: null, memoryCount: 0, lastWriteAt: null, recent: [], error: ready.error };
    }
    const companyId = (params as { companyId?: string }).companyId;
    const bucket = resolveBucket({
      strategy: ready.config.bucketStrategy,
      prefix: ready.config.bucketPrefix,
      scopeHint: { companyId },
    });
    try {
      const recent = await ready.client.listMemories({ bucket, limit: 5 });
      return {
        bucket,
        strategy: ready.config.bucketStrategy,
        memoryCount: recent.length,
        lastWriteAt: recent[0]?.created_at ?? null,
        recent: recent.map((m) => ({ id: m.id, content: m.content, createdAt: m.created_at ?? null })),
      };
    } catch (err) {
      return {
        bucket,
        strategy: ready.config.bucketStrategy,
        memoryCount: 0,
        lastWriteAt: null,
        recent: [],
        error: err instanceof Error ? err.message : "Failed to load Engram stats",
      };
    }
  });
}

const plugin = definePlugin({
  async setup(ctx) {
    currentContext = ctx;
    ctx.logger.info(`${PLUGIN_ID} starting up`);
    const config = await loadConfig(ctx);
    if (config) {
      bindClient(ctx, config);
      ctx.logger.info("Engram plugin ready", {
        baseUrl: config.baseUrl,
        bucketStrategy: config.bucketStrategy,
        autoIngest: config.autoIngestEvents,
      });
    } else {
      ctx.logger.warn("Engram plugin not configured yet — tools will return an error until apiKey is set");
    }
    await registerTools(ctx);
    await registerEventIngestion(ctx);
    await registerWidgetData(ctx);
  },

  async onValidateConfig(config) {
    const ctx = currentContext;
    if (!ctx) return { ok: false, errors: ["Plugin not initialized"] };
    const cfg = readConfig(config as Record<string, unknown>);
    if (!cfg) {
      return {
        ok: false,
        errors: ["apiKey is required (or set ENGRAM_API_KEY in the server env)"],
      };
    }
    try {
      const probe = new EngramClient({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, http: ctx.http });
      await probe.listBuckets();
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        errors: [err instanceof Error ? err.message : "Failed to reach Engram"],
      };
    }
  },

  async onConfigChanged(newConfig) {
    const ctx = currentContext;
    client = null;
    resolvedConfig = null;
    if (!ctx) return;
    const cfg = readConfig(newConfig);
    if (cfg) {
      bindClient(ctx, cfg);
      ctx.logger.info("Engram config reloaded", { baseUrl: cfg.baseUrl });
    } else {
      ctx.logger.warn("Engram config invalid after reload — apiKey missing");
    }
  },

  async onHealth() {
    if (!client) {
      return { status: "degraded", message: "Engram client not initialized (missing apiKey?)" };
    }
    try {
      await client.listBuckets();
      return { status: "ok", message: "Engram reachable" };
    } catch (err) {
      return {
        status: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      };
    }
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
