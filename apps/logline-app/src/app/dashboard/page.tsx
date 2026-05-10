import { getServerSession } from 'next-auth/next';
import Link from 'next/link';
import { authOptions } from '@/lib/auth-options';

export default async function DashboardHomePage() {
  const session = await getServerSession(authOptions);

  return (
    <main style={{ maxWidth: 720, margin: '48px auto', padding: '0 24px', fontFamily: 'ui-sans-serif, system-ui' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Dashboard</h1>
      <p style={{ color: '#4b5563', marginTop: 12 }}>
        {session?.user?.name ? (
          <>Signed in as <strong>{session.user.name}</strong> ({session.user.email ?? session.user.name}). </>
        ) : null}
        Visit your organization or user account dashboard:
      </p>
      <pre style={{ background: '#f3f4f6', padding: 16, borderRadius: 8, fontSize: 13 }}>
        /dashboard/&lt;github-org-or-username&gt;
      </pre>
      <p style={{ marginTop: 16, fontSize: 14, color: '#6b7280' }}>
        Access is limited to members of the GitHub organization (or the user account) where the Logline GitHub App is
        installed.
      </p>
      <p style={{ marginTop: 24 }}>
        <Link href="/" style={{ color: '#4f46e5', fontWeight: 600 }}>
          ← Home
        </Link>
      </p>
    </main>
  );
}
