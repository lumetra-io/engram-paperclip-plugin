import type { PluginHttpClient } from "@paperclipai/plugin-sdk";

export interface EngramClientOptions {
  baseUrl: string;
  apiKey: string;
  http: PluginHttpClient;
}

export interface StoredMemory {
  id: string;
  bucket?: string;
  content: string;
  created_at?: string;
  status?: "stored" | "merged";
  merge_reason?: string;
}

export interface QueryResponse {
  query: string;
  buckets: string[];
  result?: string;
  sources?: Array<{ id: string; bucket: string; content: string; score?: number }>;
}

export interface BucketRecord {
  name: string;
  memory_count?: number;
  last_write_at?: string | null;
}

export class EngramHttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly body?: unknown) {
    super(message);
    this.name = "EngramHttpError";
  }
}

export class EngramClient {
  constructor(private readonly opts: EngramClientOptions) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.opts.baseUrl.replace(/\/$/, "")}${path}`;
    const response = await this.opts.http.fetch(url, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.opts.apiKey}`,
        "user-agent": "engram-paperclip-plugin/0.1.0",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const parsed: unknown = text ? safeJson(text) : undefined;
    if (!response.ok) {
      throw new EngramHttpError(response.status, `Engram ${method} ${path} → ${response.status}`, parsed);
    }
    return parsed as T;
  }

  async listBuckets(): Promise<BucketRecord[]> {
    const raw = await this.request<unknown>("GET", "/v1/buckets");
    if (Array.isArray(raw)) return raw as BucketRecord[];
    if (raw && typeof raw === "object" && Array.isArray((raw as { buckets?: unknown }).buckets)) {
      return (raw as { buckets: BucketRecord[] }).buckets;
    }
    return [];
  }

  async createBucket(name: string): Promise<BucketRecord> {
    return this.request<BucketRecord>("POST", "/v1/buckets", { name });
  }

  async storeMemory(input: { content: string; bucket: string; dedup?: "off" | "loose" | "strict" }): Promise<StoredMemory> {
    return this.request<StoredMemory>(
      "POST",
      `/v1/buckets/${encodeURIComponent(input.bucket)}/memories`,
      { content: input.content, ...(input.dedup ? { dedup: input.dedup } : {}) },
    );
  }

  async listMemories(input: { bucket: string; limit?: number }): Promise<StoredMemory[]> {
    const raw = await this.request<unknown>(
      "GET",
      `/v1/buckets/${encodeURIComponent(input.bucket)}/memories?limit=${input.limit ?? 10}`,
    );
    if (Array.isArray(raw)) return raw as StoredMemory[];
    if (raw && typeof raw === "object" && Array.isArray((raw as { memories?: unknown }).memories)) {
      return (raw as { memories: StoredMemory[] }).memories;
    }
    return [];
  }

  async query(input: { query: string; buckets: string[]; k?: number }): Promise<QueryResponse> {
    return this.request<QueryResponse>("POST", "/v1/query", {
      query: input.query,
      buckets: input.buckets,
      ...(input.k ? { options: { top_k: input.k } } : {}),
    });
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
