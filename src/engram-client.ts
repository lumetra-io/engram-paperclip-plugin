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

export interface QueryRetrievedMemory {
  memory_id: string;
  bucket_name: string;
  content: string;
  raw_score?: number;
  weighted_score?: number;
}

export interface QueryResponse {
  success?: boolean;
  /** Synthesized natural-language answer over the retrieved memories. */
  answer?: string;
  memories_found?: number;
  explanation?: {
    retrieved_memories?: QueryRetrievedMemory[];
    graph_facts?: Array<{ subject: string; predicate: string; object: string; bucket_name?: string }>;
  };
  usage?: Record<string, number>;
  synthesis_usage?: Record<string, number>;
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
  private readonly knownBuckets = new Set<string>();

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
    const result = await this.request<BucketRecord>("POST", "/v1/buckets", { name });
    this.knownBuckets.add(name);
    return result;
  }

  /**
   * POST a memory; on a 404-bucket-not-found we transparently create the
   * bucket and retry once. Successful bucket names are cached so subsequent
   * stores skip the existence check entirely.
   */
  async storeMemory(input: { content: string; bucket: string; dedup?: "off" | "loose" | "strict" }): Promise<StoredMemory> {
    const path = `/v1/buckets/${encodeURIComponent(input.bucket)}/memories`;
    const body = { content: input.content, ...(input.dedup ? { dedup: input.dedup } : {}) };
    try {
      const result = await this.request<StoredMemory>("POST", path, body);
      this.knownBuckets.add(input.bucket);
      return result;
    } catch (err) {
      if (!this.knownBuckets.has(input.bucket) && isMissingBucketError(err)) {
        try {
          await this.createBucket(input.bucket);
        } catch (createErr) {
          // Concurrent create: ignore conflict, fall through to retry.
          if (!isConflictError(createErr)) throw createErr;
          this.knownBuckets.add(input.bucket);
        }
        const retried = await this.request<StoredMemory>("POST", path, body);
        return retried;
      }
      throw err;
    }
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

export function isMissingBucketError(err: unknown): err is EngramHttpError {
  if (!(err instanceof EngramHttpError)) return false;
  if (err.status === 404) return true;
  const body = err.body;
  if (body && typeof body === "object" && "error" in body) {
    const msg = String((body as { error: unknown }).error).toLowerCase();
    return msg.includes("bucket not found") || msg.includes("no such bucket");
  }
  return false;
}

export function isConflictError(err: unknown): err is EngramHttpError {
  return err instanceof EngramHttpError && (err.status === 409 || err.status === 422);
}
