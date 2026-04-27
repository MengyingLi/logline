import { getInstallationByLogin, getReposByInstallation, getApiKeysForRepo } from '@/lib/db';
import type { Repo } from '@/lib/db';
import { notFound } from 'next/navigation';

interface Props {
  params: Promise<{ owner: string }>;
}

export default async function OrgDashboard({ params }: Props) {
  const { owner } = await params;
  const installation = await getInstallationByLogin(owner).catch(() => null);
  if (!installation) notFound();

  const repos = await getReposByInstallation(installation.id);

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <h1 style={styles.logo}>📊 Logline</h1>
          <span style={styles.orgBadge}>{owner}</span>
        </div>
      </header>

      <div style={styles.content}>
        <div style={styles.pageHeader}>
          <h2 style={styles.pageTitle}>Repositories</h2>
          <span style={styles.planBadge}>{installation.plan}</span>
        </div>

        {repos.length === 0 ? (
          <div style={styles.empty}>
            <p>No repositories enrolled yet.</p>
            <p style={{ color: '#6b7280', fontSize: 14 }}>
              Repositories are enrolled automatically when you install the GitHub App and open a PR.
            </p>
          </div>
        ) : (
          <div style={styles.repoGrid}>
            {repos.map((repo) => (
              <RepoCard key={repo.id} owner={owner} repo={repo} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

async function RepoCard({ owner, repo }: { owner: string; repo: Repo }) {
  const plan = repo.tracking_plan as any;
  const eventCount = plan?.events?.length ?? 0;
  const implemented = plan?.events?.filter((e: any) => e.status === 'implemented').length ?? 0;
  const coverage = eventCount > 0 ? Math.round((implemented / eventCount) * 100) : null;

  return (
    <a href={`/dashboard/${owner}/${repo.name}`} style={styles.repoCard}>
      <div style={styles.repoName}>{repo.name}</div>
      <div style={styles.repoMeta}>
        {coverage !== null ? (
          <>
            <span style={{ ...styles.coverageBadge, background: coverageColor(coverage) }}>
              {coverage}% coverage
            </span>
            <span style={styles.eventCount}>{eventCount} events</span>
          </>
        ) : (
          <span style={styles.noData}>No tracking plan yet</span>
        )}
      </div>
      <div style={styles.repoFooter}>
        {repo.tracking_plan_updated_at
          ? `Updated ${timeAgo(repo.tracking_plan_updated_at)}`
          : 'Waiting for first PR…'}
      </div>
    </a>
  );
}

function coverageColor(pct: number): string {
  if (pct >= 80) return '#dcfce7';
  if (pct >= 50) return '#fef9c3';
  return '#fee2e2';
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

const styles: Record<string, React.CSSProperties> = {
  main: { minHeight: '100vh', background: '#f9fafb', fontFamily: 'ui-sans-serif, system-ui' },
  header: { background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '0 24px' },
  headerInner: { maxWidth: 1024, margin: '0 auto', height: 56, display: 'flex', alignItems: 'center', gap: 16 },
  logo: { margin: 0, fontSize: 18, fontWeight: 700 },
  orgBadge: { background: '#f3f4f6', borderRadius: 6, padding: '2px 10px', fontSize: 13, color: '#374151' },
  content: { maxWidth: 1024, margin: '32px auto', padding: '0 24px' },
  pageHeader: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 },
  pageTitle: { margin: 0, fontSize: 22, fontWeight: 700 },
  planBadge: { background: '#e0e7ff', color: '#3730a3', borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600, textTransform: 'uppercase' as const },
  repoGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 },
  repoCard: { display: 'block', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 20, textDecoration: 'none', color: 'inherit', transition: 'box-shadow 0.15s' },
  repoName: { fontWeight: 600, fontSize: 16, marginBottom: 8 },
  repoMeta: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
  coverageBadge: { borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 600 },
  eventCount: { fontSize: 12, color: '#6b7280' },
  noData: { fontSize: 12, color: '#9ca3af' },
  repoFooter: { fontSize: 12, color: '#9ca3af' },
  empty: { textAlign: 'center' as const, padding: '60px 0', color: '#374151' },
};
