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
  STATE_KEYS,
  STATE_NAMESPACE,
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

async function loadConfig(ctx: PluginContext): Promise<EngramConfig> {
  const raw = (await ctx.config.get()) as Partial<EngramConfig> & { apiKey?: string };
  if (!raw.apiKey) {
    throw new Error("Engram plugin is not configured: apiKey is required");
  }
  const apiKey = await ctx.secrets.resolve(raw.apiKey).catch(() => raw.apiKey!);
  return {
    apiKey,
    baseUrl: raw.baseUrl ?? DEFAULT_CONFIG.baseUrl,
    bucketStrategy: (raw.bucketStrategy ?? DEFAULT_CONFIG.bucketStrategy) as BucketStrategy,
    bucketPrefix: raw.bucketPrefix ?? DEFAULT_CONFIG.bucketPrefix,
    autoIngestEvents: raw.autoIngestEvents ?? DEFAULT_CONFIG.autoIngestEvents,
  };
}

async function ensureClient(ctx: PluginContext): Promise<{ client: EngramClient; config: EngramConfig }> {
  if (!client || !resolvedConfig) {
    resolvedConfig = await loadConfig(ctx);
    client = new EngramClient({
      baseUrl: resolvedConfig.baseUrl,
      apiKey: resolvedConfig.apiKey,
      http: ctx.http,
    });
  }
  return { client, config: resolvedConfig };
}

function toolError(err: unknown): ToolResult {
  if (err instanceof EngramHttpError) {
    return { error: `Engram API error ${err.status}: ${err.message}` };
  }
  if (err instanceof Error) return { error: err.message };
  return { error: "Unknown error" };
}

async function registerTools(ctx: PluginContext): Promise<void> {
  ctx.tools.register(
    TOOL_NAMES.storeMemory,
    {
      displayName: "Engram: Store Memory",
      description: "Save an atomic fact to durable memory.",
      parametersSchema: {
        type: "object",
        required: ["content"],
        properties: {
          content: { type: "string" },
          bucket: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
        },
      },
    },
    async (params, runCtx: ToolRunContext): Promise<ToolResult> => {
      try {
        const { client, config } = await ensureClient(ctx);
        const payload = params as { content?: string; bucket?: string; tags?: string[] };
        if (!payload.content) return { error: "content is required" };
        const bucket = resolveBucket({
          strategy: config.bucketStrategy,
          prefix: config.bucketPrefix,
          runCtx,
          override: payload.bucket,
        });
        const memory = await client.storeMemory({
          content: payload.content,
          bucket,
          tags: payload.tags,
        });
        return {
          content: `Stored memory ${memory.id} in bucket ${bucket}.`,
          data: { memoryId: memory.id, bucket },
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
      description: "Semantic + graph search across stored memory.",
      parametersSchema: {
        type: "object",
        required: ["question"],
        properties: {
          question: { type: "string" },
          bucket: { type: "string" },
          k: { type: "integer", minimum: 1, maximum: 50 },
        },
      },
    },
    async (params, runCtx: ToolRunContext): Promise<ToolResult> => {
      try {
        const { client, config } = await ensureClient(ctx);
        const payload = params as { question?: string; bucket?: string; k?: number };
        if (!payload.question) return { error: "question is required" };
        const bucket = resolveBucket({
          strategy: config.bucketStrategy,
          prefix: config.bucketPrefix,
          runCtx,
          override: payload.bucket,
        });
        const result = await client.queryMemory({
          question: payload.question,
          bucket,
          k: payload.k,
        });
        const lines = result.memories.map(
          (m, i) => `[${i + 1}] (${m.score?.toFixed(2) ?? "—"}) ${m.content}`,
        );
        return {
          content: lines.length
            ? `Top ${lines.length} memories from ${bucket}:\n${lines.join("\n")}`
            : `No memories found in ${bucket} for: ${payload.question}`,
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
      try {
        const { client } = await ensureClient(ctx);
        const buckets = await client.listBuckets();
        return {
          content: buckets.length
            ? buckets.map((b) => `${b.name} (${b.memoryCount} memories)`).join("\n")
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
      description: "Recent memories in the current bucket.",
      parametersSchema: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 50 },
          bucket: { type: "string" },
        },
      },
    },
    async (params, runCtx: ToolRunContext): Promise<ToolResult> => {
      try {
        const { client, config } = await ensureClient(ctx);
        const payload = params as { limit?: number; bucket?: string };
        const bucket = resolveBucket({
          strategy: config.bucketStrategy,
          prefix: config.bucketPrefix,
          runCtx,
          override: payload.bucket,
        });
        const memories = await client.recallRecent({ bucket, limit: payload.limit });
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

async function registerEventIngestion(ctx: PluginContext, config: EngramConfig): Promise<void> {
  if (!config.autoIngestEvents) return;

  const writeFromEvent = async (event: PluginEvent, summary: string): Promise<void> => {
    try {
      const { client } = await ensureClient(ctx);
      const companyId =
        (event as { companyId?: string }).companyId ??
        (event as { entityCompanyId?: string }).entityCompanyId;
      const projectId = (event as { projectId?: string }).projectId;
      const bucket = resolveBucket({
        strategy: config.bucketStrategy,
        prefix: config.bucketPrefix,
        scopeHint: { companyId, projectId },
      });
      await client.storeMemory({
        content: summary,
        bucket,
        tags: ["paperclip-event", event.eventType ?? "unknown"],
      });
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
    const { client, config } = await ensureClient(ctx);
    const companyId = (params as { companyId?: string }).companyId;
    const bucket = resolveBucket({
      strategy: config.bucketStrategy,
      prefix: config.bucketPrefix,
      scopeHint: { companyId },
    });
    try {
      const stats = await client.bucketStats(bucket);
      const recent = await client.recallRecent({ bucket, limit: 5 });
      return {
        bucket,
        strategy: config.bucketStrategy,
        memoryCount: stats.memoryCount,
        lastWriteAt: stats.lastWriteAt ?? null,
        recent: recent.map((m) => ({ id: m.id, content: m.content, createdAt: m.createdAt })),
      };
    } catch (err) {
      return {
        bucket,
        strategy: config.bucketStrategy,
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
    let config: EngramConfig;
    try {
      config = await loadConfig(ctx);
    } catch (err) {
      ctx.logger.warn("Engram plugin not configured yet — tools will return an error until apiKey is set", {
        error: err instanceof Error ? err.message : err,
      });
      await registerTools(ctx);
      await registerWidgetData(ctx);
      return;
    }
    resolvedConfig = config;
    client = new EngramClient({ baseUrl: config.baseUrl, apiKey: config.apiKey, http: ctx.http });
    await registerTools(ctx);
    await registerEventIngestion(ctx, config);
    await registerWidgetData(ctx);
    ctx.logger.info("Engram plugin ready", {
      baseUrl: config.baseUrl,
      bucketStrategy: config.bucketStrategy,
      autoIngest: config.autoIngestEvents,
    });
  },

  async onValidateConfig(config) {
    const ctx = currentContext;
    if (!ctx) return { ok: false, errors: ["Plugin not initialized"] };
    try {
      const raw = config as Partial<EngramConfig> & { apiKey?: string };
      if (!raw.apiKey) return { ok: false, errors: ["apiKey is required"] };
      const apiKey = await ctx.secrets.resolve(raw.apiKey).catch(() => raw.apiKey!);
      const probe = new EngramClient({
        baseUrl: raw.baseUrl ?? DEFAULT_CONFIG.baseUrl,
        apiKey,
        http: ctx.http,
      });
      await probe.listBuckets();
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        errors: [err instanceof Error ? err.message : "Failed to reach Engram"],
      };
    }
  },

  async onConfigChanged(_newConfig) {
    const ctx = currentContext;
    client = null;
    resolvedConfig = null;
    if (!ctx) return;
    try {
      const config = await loadConfig(ctx);
      resolvedConfig = config;
      client = new EngramClient({ baseUrl: config.baseUrl, apiKey: config.apiKey, http: ctx.http });
      ctx.logger.info("Engram config reloaded");
    } catch (err) {
      ctx.logger.warn("Engram config invalid", { error: err instanceof Error ? err.message : err });
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

// Touch unused exports so the bundler keeps them readable in source.
void STATE_KEYS;
void STATE_NAMESPACE;
