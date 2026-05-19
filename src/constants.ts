export const PLUGIN_ID = "io.lumetra.engram";
export const PLUGIN_VERSION = "0.1.2";

export const TOOL_NAMES = {
  storeMemory: "store_memory",
  queryMemory: "query_memory",
  listBuckets: "list_buckets",
  recallRecent: "recall_recent",
} as const;

export const SLOT_IDS = {
  dashboardWidget: "engram-stats-widget",
  settingsPage: "engram-settings",
} as const;

export const EXPORT_NAMES = {
  dashboardWidget: "EngramStatsWidget",
  settingsPage: "EngramSettingsPage",
} as const;

export const STATE_NAMESPACE = "engram";
export const STATE_KEYS = {
  bucketMap: "bucket-map",
  stats: "stats",
} as const;

export const DEFAULT_CONFIG = {
  baseUrl: "https://api.lumetra.io",
  bucketStrategy: "per-company" as const,
  bucketPrefix: "paperclip",
  autoIngestEvents: true,
};

export type BucketStrategy = "per-company" | "per-project" | "per-agent" | "global";
