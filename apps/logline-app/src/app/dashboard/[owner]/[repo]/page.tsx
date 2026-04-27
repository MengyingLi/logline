import { getRepo, getEventCounts, getApiKeysForRepo, getRecentEvents } from '@/lib/db';
import type { DbEvent } from '@/lib/db';
import { notFound } from 'next/navigation';

interface Props {
  params: Promise<{ owner: string; repo: string }>;
}

export default async function RepoDashboard({ params }: Props) {
  const { owner, repo: repoName } = await params;
  const repo = await getRepo(owner, repoName).catch(() => null);
  if (!repo) notFound();

  const [eventCounts, apiKeys, recentEvents] = await Promise.all([
    getEventCounts(repo.id, 30),
    getApiKeysForRepo(repo.id),
    getRecentEvents(repo.id, 50),
  ]);

  const plan = repo.tracking_plan as any;
  const planEvents: PlanEvent[] = plan?.events ?? [];
  const countMap = new Map(eventCounts.map((e) => [e.event_name, e]));

  // Coverage: implemented events that have been seen in the last 30 days
  const instrumentedPlanEvents = planEvents.filter((e) => e.status === 'implemented');
  const seenCount = instrumentedPlanEvents.filter((e) => countMap.has(e.name)).length;
  const coverage = instrumentedPlanEvents.length > 0
    ? Math.round((seenCount / instrumentedPlanEvents.length) * 100)
    : null;

  // Events received but not in the tracking plan (unplanned events)
  const planNames = new Set(planEvents.map((e) => e.name.toLowerCase()));
  const unplannedCounts = eventCounts.filter((e) => !planNames.has(e.event_name));

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <a href={`/dashboard/${owner}`} style={styles.backLink}>
            📊 Logline
          </a>
          <span style={styles.sep}>/</span>
          <span style={styles.repoLabel}>{owner}/{repoName}</span>
        </div>
      </header>

      <div style={styles.content}>
        {/* Stats row */}
        <div style={styles.statsRow}>
          <StatCard
            label="Coverage"
            value={coverage !== null ? `${coverage}%` : '—'}
            sub={`${seenCount}/${instrumentedPlanEvents.length} implemented events seen`}
            color={coverage === null ? '#6b7280' : coverage >= 80 ? '#16a34a' : coverage >= 50 ? '#ca8a04' : '#dc2626'}
          />
          <StatCard
            label="Plan size"
            value={String(planEvents.length)}
            sub={`${planEvents.filter((e) => e.status === 'suggested').length} suggested · ${planEvents.filter((e) => e.status === 'approved').length} approved`}
          />
          <StatCard
            label="Events (30d)"
            value={String(eventCounts.reduce((s, e) => s + e.count, 0))}
            sub={`${eventCounts.length} distinct event names`}
          />
        </div>

        <div style={styles.twoCol}>
          {/* Tracking Plan */}
          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>Tracking Plan</h3>
            {planEvents.length === 0 ? (
              <div style={styles.emptySmall}>
                No tracking plan yet. Open a PR to get suggestions.
              </div>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Event</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Seen (30d)</th>
                  </tr>
                </thead>
                <tbody>
                  {planEvents.map((event) => {
                    const counts = countMap.get(event.name);
                    return (
                      <tr key={event.id} style={styles.tr}>
                        <td style={styles.td}>
                          <code style={styles.eventName}>{event.name}</code>
                          <div style={styles.eventDesc}>{event.description}</div>
                        </td>
                        <td style={styles.td}>
                          <StatusBadge status={event.status} priority={event.priority} />
                        </td>
                        <td style={{ ...styles.td, textAlign: 'right' }}>
                          {counts ? (
                            <span style={styles.count}>{counts.count.toLocaleString()}</span>
                          ) : event.status === 'implemented' ? (
                            <span style={styles.missing}>⚠ 0</span>
                          ) : (
                            <span style={styles.na}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {unplannedCounts.length > 0 && (
              <>
                <h4 style={{ ...styles.sectionTitle, marginTop: 24, fontSize: 13 }}>
                  Unplanned events received
                </h4>
                <table style={styles.table}>
                  <tbody>
                    {unplannedCounts.map((e) => (
                      <tr key={e.event_name} style={styles.tr}>
                        <td style={styles.td}>
                          <code style={styles.eventName}>{e.event_name}</code>
                        </td>
                        <td style={{ ...styles.td, textAlign: 'right' }}>
                          <span style={styles.count}>{e.count.toLocaleString()}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>

          {/* Right column */}
          <div>
            {/* API Keys */}
            <section style={{ ...styles.section, marginBottom: 24 }}>
              <h3 style={styles.sectionTitle}>API Keys</h3>
              <p style={styles.helpText}>
                Use these keys in your <code>track()</code> calls to route events to Logline.
              </p>
              {apiKeys.map((k) => (
                <div key={k.id} style={styles.apiKeyRow}>
                  <code style={styles.apiKey}>{k.key}</code>
                  <span style={styles.keyName}>{k.name}</span>
                </div>
              ))}
              <div style={styles.codeBlock}>
                <pre style={{ margin: 0, fontSize: 12 }}>{`fetch('https://logline.dev/api/v1/events/ingest', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ${apiKeys[0]?.key ?? 'lk_...'}',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    event: 'workflow_created',
    properties: { workflow_id },
  }),
});`}</pre>
              </div>
            </section>

            {/* Recent events */}
            <section style={styles.section}>
              <h3 style={styles.sectionTitle}>Live stream</h3>
              {recentEvents.length === 0 ? (
                <div style={styles.emptySmall}>No events received yet.</div>
              ) : (
                <div style={styles.eventStream}>
                  {recentEvents.slice(0, 20).map((e) => (
                    <EventRow key={e.id} event={e} />
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface PlanEvent {
  id: string;
  name: string;
  description: string;
  status: 'suggested' | 'approved' | 'implemented' | 'deprecated';
  priority: 'critical' | 'high' | 'medium' | 'low';
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statLabel}>{label}</div>
      <div style={{ ...styles.statValue, color: color ?? '#111827' }}>{value}</div>
      <div style={styles.statSub}>{sub}</div>
    </div>
  );
}

function StatusBadge({ status, priority }: { status: string; priority: string }) {
  const colors: Record<string, string> = {
    suggested: '#fef3c7',
    approved: '#dbeafe',
    implemented: '#dcfce7',
    deprecated: '#f3f4f6',
  };
  const textColors: Record<string, string> = {
    suggested: '#92400e',
    approved: '#1e40af',
    implemented: '#166534',
    deprecated: '#6b7280',
  };
  return (
    <span style={{
      background: colors[status] ?? '#f3f4f6',
      color: textColors[status] ?? '#374151',
      borderRadius: 6,
      padding: '2px 8px',
      fontSize: 11,
      fontWeight: 600,
    }}>
      {status}
    </span>
  );
}

function EventRow({ event }: { event: DbEvent }) {
  const ago = timeAgo(event.received_at);
  return (
    <div style={styles.eventStreamRow}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <code style={styles.streamEventName}>{event.event_name}</code>
        <span style={styles.streamTime}>{ago}</span>
      </div>
      {event.properties && Object.keys(event.properties).length > 0 && (
        <div style={styles.streamProps}>
          {Object.entries(event.properties)
            .slice(0, 3)
            .map(([k, v]) => (
              <span key={k} style={styles.streamProp}>
                {k}: <span style={{ color: '#374151' }}>{String(v).slice(0, 30)}</span>
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  main: { minHeight: '100vh', background: '#f9fafb', fontFamily: 'ui-sans-serif, system-ui' },
  header: { background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '0 24px' },
  headerInner: { maxWidth: 1200, margin: '0 auto', height: 56, display: 'flex', alignItems: 'center', gap: 8 },
  backLink: { fontWeight: 700, fontSize: 18, color: 'inherit', textDecoration: 'none' },
  sep: { color: '#9ca3af', fontSize: 18 },
  repoLabel: { color: '#374151', fontSize: 15 },
  content: { maxWidth: 1200, margin: '32px auto', padding: '0 24px' },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 32 },
  statCard: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '20px 24px' },
  statLabel: { fontSize: 12, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 },
  statValue: { fontSize: 32, fontWeight: 700, lineHeight: 1, marginBottom: 4 },
  statSub: { fontSize: 12, color: '#6b7280' },
  twoCol: { display: 'grid', gridTemplateColumns: '1fr 380px', gap: 24, alignItems: 'start' },
  section: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 24 },
  sectionTitle: { margin: '0 0 16px', fontSize: 15, fontWeight: 700 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th: { textAlign: 'left' as const, padding: '6px 8px', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' as const, borderBottom: '1px solid #f3f4f6' },
  tr: { borderBottom: '1px solid #f9fafb' },
  td: { padding: '10px 8px', verticalAlign: 'top' as const },
  eventName: { fontFamily: 'ui-monospace, monospace', fontSize: 12, background: '#f3f4f6', borderRadius: 4, padding: '1px 5px' },
  eventDesc: { fontSize: 11, color: '#9ca3af', marginTop: 2 },
  count: { fontWeight: 600, fontSize: 13 },
  missing: { color: '#dc2626', fontSize: 13, fontWeight: 600 },
  na: { color: '#d1d5db' },
  emptySmall: { color: '#9ca3af', fontSize: 13, padding: '16px 0' },
  apiKeyRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  apiKey: { fontFamily: 'ui-monospace, monospace', fontSize: 11, background: '#f3f4f6', borderRadius: 4, padding: '4px 8px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  keyName: { fontSize: 11, color: '#9ca3af' },
  helpText: { fontSize: 12, color: '#6b7280', marginBottom: 12 },
  codeBlock: { background: '#1e1e2e', color: '#cdd6f4', borderRadius: 8, padding: 16, marginTop: 12, overflow: 'auto' },
  eventStream: { display: 'flex', flexDirection: 'column' as const, gap: 1 },
  eventStreamRow: { padding: '8px 0', borderBottom: '1px solid #f3f4f6' },
  streamEventName: { fontFamily: 'ui-monospace, monospace', fontSize: 12 },
  streamTime: { fontSize: 11, color: '#9ca3af' },
  streamProps: { display: 'flex', flexWrap: 'wrap' as const, gap: 6, marginTop: 4 },
  streamProp: { fontSize: 11, color: '#6b7280', background: '#f9fafb', borderRadius: 4, padding: '1px 6px' },
};
