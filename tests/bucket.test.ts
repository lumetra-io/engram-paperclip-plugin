import { describe, expect, it } from "vitest";
import { resolveBucket } from "../src/bucket.js";

describe("resolveBucket", () => {
  it("uses override when provided", () => {
    expect(
      resolveBucket({
        strategy: "per-company",
        prefix: "paperclip",
        runCtx: { companyId: "c-1" },
        override: "custom",
      }),
    ).toBe("custom");
  });

  it("scopes by company by default", () => {
    expect(
      resolveBucket({
        strategy: "per-company",
        prefix: "paperclip",
        runCtx: { companyId: "c-1", projectId: "p-1", agentId: "a-1" },
      }),
    ).toBe("paperclip-company-c-1");
  });

  it("falls through per-project → per-company when no projectId", () => {
    expect(
      resolveBucket({
        strategy: "per-project",
        prefix: "paperclip",
        runCtx: { companyId: "c-1" },
      }),
    ).toBe("paperclip-company-c-1");
  });

  it("returns prefix only for global strategy", () => {
    expect(
      resolveBucket({
        strategy: "global",
        prefix: "paperclip",
        runCtx: { companyId: "c-1" },
      }),
    ).toBe("paperclip");
  });

  it("sanitizes prefix and ids", () => {
    expect(
      resolveBucket({
        strategy: "per-company",
        prefix: "pa per/clip!",
        runCtx: { companyId: "abc$$def" },
      }),
    ).toBe("pa-per-clip--company-abcdef");
  });
});
