export default function HomePage() {
  return (
    <main style={{ maxWidth: 680, margin: '80px auto', fontFamily: 'ui-sans-serif, system-ui', padding: '0 24px' }}>
      <h1 style={{ fontSize: 32, fontWeight: 800, marginBottom: 8 }}>📊 Logline</h1>
      <p style={{ fontSize: 18, color: '#374151', marginBottom: 40 }}>
        Automated product analytics instrumentation — from tracking plan to dashboard.
      </p>

      <div style={{ display: 'grid', gap: 16 }}>
        <Card
          title="GitHub App"
          description="Installs in 60 seconds. Logline reviews every PR, suggests analytics events inline, and lets you apply them with one click."
          action="Install on GitHub →"
          href={`https://github.com/apps/logline`}
        />
        <Card
          title="Dashboard"
          description="See your tracking plan coverage, live event stream, and drift alerts — all derived from your tracking plan."
          action="Go to your dashboard →"
          href="/dashboard"
        />
        <Card
          title="CLI"
          description="logline scan · logline spec · logline apply — instrument your entire codebase in minutes."
          action="View docs →"
          href="https://github.com/MengyingLi/logline"
        />
      </div>

      <div style={{ marginTop: 48, padding: 24, background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: '#475569' }}>Ingest API</h3>
        <pre style={{ margin: 0, fontSize: 12, color: '#1e293b', overflow: 'auto' }}>{`POST https://logline.dev/api/v1/events/ingest
Authorization: Bearer lk_...

{ "event": "workflow_created", "properties": { "workflow_id": "abc" } }`}</pre>
        <p style={{ margin: '12px 0 0', fontSize: 12, color: '#64748b' }}>
          Route events to your Logline dashboard and/or fan out to Segment, PostHog, Mixpanel, Amplitude, or a custom endpoint.
        </p>
      </div>
    </main>
  );
}

function Card({ title, description, action, href }: {
  title: string;
  description: string;
  action: string;
  href: string;
}) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 24, background: '#fff' }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700 }}>{title}</h2>
      <p style={{ margin: '0 0 16px', color: '#6b7280', fontSize: 14, lineHeight: 1.6 }}>{description}</p>
      <a href={href} style={{ color: '#4f46e5', fontWeight: 600, fontSize: 14, textDecoration: 'none' }}>{action}</a>
    </div>
  );
}
