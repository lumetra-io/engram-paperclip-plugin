import type { ToolRunContext } from "@paperclipai/plugin-sdk";
import type { BucketStrategy } from "./constants.js";

export interface BucketResolverInput {
  strategy: BucketStrategy;
  prefix: string;
  runCtx?: Pick<ToolRunContext, "companyId" | "projectId" | "agentId">;
  override?: string;
  scopeHint?: { companyId?: string; projectId?: string; agentId?: string };
}

export function resolveBucket(input: BucketResolverInput): string {
  if (input.override && input.override.trim()) return input.override.trim();

  const ctx = input.runCtx ?? input.scopeHint ?? {};
  const prefix = input.prefix.replace(/[^a-zA-Z0-9_-]/g, "-");

  switch (input.strategy) {
    case "global":
      return prefix;
    case "per-agent":
      if (ctx.agentId) return `${prefix}-agent-${shortId(ctx.agentId)}`;
      if (ctx.companyId) return `${prefix}-company-${shortId(ctx.companyId)}`;
      return prefix;
    case "per-project":
      if (ctx.projectId) return `${prefix}-project-${shortId(ctx.projectId)}`;
      if (ctx.companyId) return `${prefix}-company-${shortId(ctx.companyId)}`;
      return prefix;
    case "per-company":
    default:
      if (ctx.companyId) return `${prefix}-company-${shortId(ctx.companyId)}`;
      return prefix;
  }
}

function shortId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24);
}
