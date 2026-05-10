import Link from 'next/link';

export default function SignInPage() {
  const configured =
    process.env.GITHUB_OAUTH_CLIENT_ID && process.env.GITHUB_OAUTH_CLIENT_SECRET && process.env.NEXTAUTH_SECRET;

  return (
    <main style={{ maxWidth: 480, margin: '80px auto', fontFamily: 'ui-sans-serif, system-ui', padding: '0 24px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 12 }}>Sign in to Logline</h1>
      <p style={{ color: '#4b5563', marginBottom: 24 }}>
        Dashboard and billing require GitHub sign-in. Your account must have access to the GitHub organization or user
        account where the Logline app is installed.
      </p>
      {!configured ? (
        <div style={{ padding: 16, background: '#fef3c7', borderRadius: 8, fontSize: 14 }}>
          NextAuth is not configured. Set <code>NEXTAUTH_SECRET</code>,{' '}
          <code>GITHUB_OAUTH_CLIENT_ID</code>, and <code>GITHUB_OAUTH_CLIENT_SECRET</code> (GitHub OAuth App).
        </div>
      ) : (
        <a
          href="/api/auth/signin/github"
          style={{
            display: 'inline-block',
            background: '#111827',
            color: '#fff',
            padding: '12px 20px',
            borderRadius: 8,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Continue with GitHub
        </a>
      )}
      <p style={{ marginTop: 24, fontSize: 14 }}>
        <Link href="/" style={{ color: '#4f46e5' }}>
          ← Home
        </Link>
      </p>
    </main>
  );
}
