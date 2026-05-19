import { describe, expect, it } from "vitest";
import { EngramClient } from "../src/engram-client.js";

interface RecordedCall {
  method: string;
  url: string;
  body: unknown;
}

function fakeHttp(handler: (call: RecordedCall) => { status: number; body: unknown }) {
  const calls: RecordedCall[] = [];
  return {
    calls,
    http: {
      async fetch(url: string, init?: RequestInit): Promise<Response> {
        const call: RecordedCall = {
          method: init?.method ?? "GET",
          url,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        };
        calls.push(call);
        const { status, body } = handler(call);
        return new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });
      },
    },
  };
}

const baseUrl = "https://api.lumetra.io";
const apiKey = "test-key";

describe("EngramClient.storeMemory auto-create", () => {
  it("creates the bucket on 404 and retries the store", async () => {
    const seen = new Set<string>();
    const { calls, http } = fakeHttp(({ method, url, body }) => {
      const isMemoriesPost = method === "POST" && url.includes("/memories");
      const isBucketPost = method === "POST" && url.endsWith("/v1/buckets");
      if (isMemoriesPost) {
        const bucket = decodeURIComponent(url.split("/v1/buckets/")[1].split("/")[0]);
        if (!seen.has(bucket)) {
          return { status: 404, body: { error: "Bucket not found" } };
        }
        return {
          status: 200,
          body: { id: "mem-1", bucket_name: bucket, status: "stored" },
        };
      }
      if (isBucketPost) {
        const name = (body as { name: string }).name;
        seen.add(name);
        return { status: 201, body: { id: "b-1", name } };
      }
      return { status: 500, body: { error: `unexpected ${method} ${url}` } };
    });
    const client = new EngramClient({ baseUrl, apiKey, http });
    const result = await client.storeMemory({ content: "hello", bucket: "new-bucket" });
    expect(result.id).toBe("mem-1");
    expect(calls.map((c) => `${c.method} ${c.url.replace(baseUrl, "")}`)).toEqual([
      "POST /v1/buckets/new-bucket/memories",
      "POST /v1/buckets",
      "POST /v1/buckets/new-bucket/memories",
    ]);
    // Second call must NOT re-create the bucket (cache hit).
    await client.storeMemory({ content: "second", bucket: "new-bucket" });
    expect(calls.map((c) => `${c.method} ${c.url.replace(baseUrl, "")}`)).toEqual([
      "POST /v1/buckets/new-bucket/memories",
      "POST /v1/buckets",
      "POST /v1/buckets/new-bucket/memories",
      "POST /v1/buckets/new-bucket/memories",
    ]);
  });

  it("passes through non-bucket-missing errors", async () => {
    const { http } = fakeHttp(() => ({ status: 401, body: { error: "Unauthorized" } }));
    const client = new EngramClient({ baseUrl, apiKey, http });
    await expect(
      client.storeMemory({ content: "hi", bucket: "anything" }),
    ).rejects.toThrow(/401/);
  });

  it("tolerates a concurrent create conflict (409) on retry", async () => {
    let conflictUsed = false;
    const { http } = fakeHttp(({ method, url, body }) => {
      if (method === "POST" && url.includes("/memories")) {
        if (!conflictUsed) {
          return { status: 404, body: { error: "Bucket not found" } };
        }
        return { status: 200, body: { id: "m-x", bucket_name: "race", status: "stored" } };
      }
      if (method === "POST" && url.endsWith("/v1/buckets")) {
        conflictUsed = true;
        void body;
        return { status: 409, body: { error: "Bucket already exists" } };
      }
      return { status: 500, body: {} };
    });
    const client = new EngramClient({ baseUrl, apiKey, http });
    const result = await client.storeMemory({ content: "race", bucket: "race" });
    expect(result.id).toBe("m-x");
  });
});
