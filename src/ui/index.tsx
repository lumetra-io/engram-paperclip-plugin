import type { PluginWidgetProps } from "@paperclipai/plugin-sdk/ui";
import { usePluginData } from "@paperclipai/plugin-sdk/ui";

interface EngramStats {
  bucket: string;
  strategy: string;
  memoryCount: number;
  lastWriteAt: string | null;
  recent: Array<{ id: string; content: string; createdAt: string }>;
  error?: string;
}

export function EngramStatsWidget({ context }: PluginWidgetProps) {
  const { data, loading, error } = usePluginData<EngramStats>("engram-stats", {
    companyId: context.companyId,
  });

  if (loading) {
    return <section aria-label="Engram Memory"><em>Loading Engram stats…</em></section>;
  }

  if (error) {
    return (
      <section aria-label="Engram Memory">
        <strong>Engram Memory</strong>
        <div style={{ color: "#b00" }}>Error: {error.message}</div>
      </section>
    );
  }

  if (!data) return null;

  return (
    <section aria-label="Engram Memory" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong>Engram Memory</strong>
        <small style={{ opacity: 0.7 }}>{data.strategy}</small>
      </header>
      {data.error ? (
        <div style={{ color: "#b00" }}>{data.error}</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 16 }}>
            <Metric label="Memories" value={data.memoryCount} />
            <Metric label="Bucket" value={data.bucket} small />
            <Metric
              label="Last write"
              value={data.lastWriteAt ? new Date(data.lastWriteAt).toLocaleString() : "never"}
              small
            />
          </div>
          {data.recent.length > 0 && (
            <details>
              <summary>Recent memories</summary>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {data.recent.map((m) => (
                  <li key={m.id} style={{ fontSize: 12, opacity: 0.85 }}>
                    {m.content}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

function Metric({ label, value, small }: { label: string; value: string | number; small?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span style={{ fontSize: 11, textTransform: "uppercase", opacity: 0.6 }}>{label}</span>
      <span style={{ fontSize: small ? 13 : 20, fontWeight: 600 }}>{value}</span>
    </div>
  );
}
