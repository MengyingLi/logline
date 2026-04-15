export default function HomePage() {
  return (
    <main style={{ maxWidth: 860, margin: '40px auto', fontFamily: 'ui-sans-serif, system-ui' }}>
      <h1>Logline GitHub App</h1>
      <p>Auto-instrument product analytics on every PR.</p>
      <ul>
        <li>Receives pull request webhooks</li>
        <li>Runs diff-only event analysis using `@logline/cli`</li>
        <li>Posts inline suggestions with review comments</li>
      </ul>
    </main>
  );
}

