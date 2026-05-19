import type { PluginHttpClient } from "@paperclipai/plugin-sdk";

export interface EngramClientOptions {
  baseUrl: string;
  apiKey: string;
  http: PluginHttpClient;
}

export interface StoredMemory {
  id: string;
  bucket: string;
  content: string;
  createdAt: string;
  tags?: string[];
  score?: number;
}

export interface QueryResult {
  memories: StoredMemory[];
  query: string;
  bucket: string;
}

export interface BucketSummary {
  name: string;
  memoryCount: number;
  lastWriteAt?: string;
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
      throw new EngramHttpError(response.status, `Engram ${method} ${path} failed: ${response.status}`, parsed);
    }
    return parsed as T;
  }

  async storeMemory(input: { content: string; bucket: string; tags?: string[] }): Promise<StoredMemory> {
    return this.request<StoredMemory>("POST", "/v1/memories", {
      content: input.content,
      bucket: input.bucket,
      tags: input.tags,
    });
  }

  async queryMemory(input: { question: string; bucket: string; k?: number }): Promise<QueryResult> {
    return this.request<QueryResult>("POST", "/v1/memories/query", {
      question: input.question,
      bucket: input.bucket,
      k: input.k ?? 8,
    });
  }

  async listBuckets(): Promise<BucketSummary[]> {
    const { buckets } = await this.request<{ buckets: BucketSummary[] }>("GET", "/v1/buckets");
    return buckets;
  }

  async recallRecent(input: { bucket: string; limit?: number }): Promise<StoredMemory[]> {
    const { memories } = await this.request<{ memories: StoredMemory[] }>(
      "GET",
      `/v1/memories?bucket=${encodeURIComponent(input.bucket)}&limit=${input.limit ?? 10}&order=recent`,
    );
    return memories;
  }

  async bucketStats(bucket: string): Promise<BucketSummary> {
    return this.request<BucketSummary>("GET", `/v1/buckets/${encodeURIComponent(bucket)}`);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
