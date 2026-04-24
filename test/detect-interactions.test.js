const test = require('node:test');
const assert = require('node:assert/strict');
const { detectInteractions } = require('../dist/lib/pipeline/04-detect-interactions.js');

test('detects onClick handlers', () => {
  const files = [{ path: 'src/App.tsx', content: `
    function App() {
      const handleCreateWorkflow = () => { console.log('create'); };
      return <button onClick={handleCreateWorkflow}>Create</button>;
    }` }];
  const r = detectInteractions(files);
  assert.ok(r.length > 0, 'should detect at least one interaction');
  assert.ok(r.some(i => i.type === 'click_handler'), `expected click_handler, got: ${[...new Set(r.map(i => i.type))]}`);
});

test('detects form submits', () => {
  const files = [{ path: 'src/Form.tsx', content: `
    function Form() {
      const handleSubmit = (e) => { e.preventDefault(); };
      return <form onSubmit={handleSubmit}><button>Go</button></form>;
    }` }];
  assert.ok(detectInteractions(files).some(i => i.type === 'form_submit'));
});

test('detects Express routes', () => {
  const files = [{ path: 'src/routes.ts', content: `
    router.post('/api/tasks', async (req, res) => { res.json({}); });
    router.delete('/api/tasks/:id', async (req, res) => { res.json({}); });
  ` }];
  assert.ok(detectInteractions(files).filter(i => i.type === 'route_handler').length >= 2);
});

test('detects Next.js App Router handlers', () => {
  const files = [{ path: 'src/app/api/users/route.ts', content: `
    export async function POST(request) {
      return new Response(JSON.stringify({ ok: true }));
    }` }];
  assert.ok(detectInteractions(files).some(i => i.type === 'route_handler'));
});

test('detects Prisma mutations', () => {
  const files = [{ path: 'src/service.ts', content: `
    await prisma.workflow.create({ data: { name: 'test' } });
    await prisma.task.delete({ where: { id: taskId } });
  ` }];
  assert.ok(detectInteractions(files).filter(i => i.type === 'mutation').length >= 2);
});

test('detects Supabase mutations', () => {
  const files = [{ path: 'src/db.ts', content: `await supabase.from('workflows').insert({ name: 'test' });` }];
  assert.ok(detectInteractions(files).some(i => i.type === 'mutation'));
});

test('ignores node_modules and dist', () => {
  const files = [
    { path: 'node_modules/lib/index.ts', content: 'const handleClick = () => {};' },
    { path: 'dist/app.js', content: 'const handleSubmit = () => {};' },
  ];
  assert.equal(detectInteractions(files).length, 0);
});

test('deduplicates same handler', () => {
  const files = [{ path: 'src/App.tsx', content: `
    const handleSave = () => { console.log('save'); };
    return <button onClick={handleSave}>Save</button>;
  ` }];
  const saves = detectInteractions(files).filter(i =>
    (i.functionName || '').toLowerCase().includes('save')
  );
  assert.ok(saves.length <= 1, `should dedupe, got ${saves.length}`);
});

test('detects try/catch as error_boundary', () => {
  const files = [{ path: 'src/service.ts', content: `
    async function processWorkflow(id) {
      try {
        const result = await doWork(id);
        return result;
      } catch (error) {
        logger.error(error);
      }
    }
  ` }];
  assert.ok(detectInteractions(files).some(i => i.type === 'error_boundary'));
});

test('detects fetch/axios as api_call', () => {
  const files = [{ path: 'src/api.ts', content: `
    async function syncData() {
      await fetch('https://api.example.com/workflows');
      await axios.post('https://api.service.com/sync', { id: 1 });
    }
  ` }];
  assert.ok(detectInteractions(files).filter(i => i.type === 'api_call').length >= 2);
});

test('detects retry logic', () => {
  const files = [{ path: 'src/retry.ts', content: `
    async function executeWithRetry(fn) {
      let attempt = 0;
      while (attempt < 3) {
        try { return await fn(); } catch { attempt++; }
      }
    }
    async function syncWithRetry() {
      return withRetry(doSync, { retries: 3 });
    }
  ` }];
  assert.ok(detectInteractions(files).some(i => i.type === 'retry_logic'));
});

// ─── Generic CRUD detector tests ───

test('multi-line Supabase chain: entity resolved from .from() across lines', () => {
  const files = [{ path: 'src/db.ts', content: `
    async function deleteUser(id) {
      await supabase
        .from('users')
        .delete()
        .eq('id', id);
    }
  ` }];
  const mutations = detectInteractions(files).filter(i => i.type === 'mutation');
  assert.ok(mutations.length > 0, 'should detect at least one mutation');
  assert.ok(
    mutations.some(i => (i.relatedEntities ?? []).includes('user')),
    `should resolve entity "user" from .from('users'), got: ${JSON.stringify(mutations.map(i => i.relatedEntities))}`
  );
});

test('Prisma model.create: entity resolved from prisma.user.create chain', () => {
  const files = [{ path: 'src/service.ts', content: `
    await prisma.user.create({ data: { name: 'Alice' } });
  ` }];
  const mutations = detectInteractions(files).filter(i => i.type === 'mutation');
  assert.ok(mutations.length > 0, 'should detect mutation');
  assert.ok(
    mutations.some(i => (i.relatedEntities ?? []).includes('user')),
    `should resolve entity "user", got: ${JSON.stringify(mutations.map(i => i.relatedEntities))}`
  );
});

test('generic ORM db.insert(table): entity resolved from argument', () => {
  const files = [{ path: 'src/repo.ts', content: `
    await db.insert(users).values({ name: 'Alice' });
  ` }];
  const mutations = detectInteractions(files).filter(i => i.type === 'mutation');
  assert.ok(mutations.length > 0, 'should detect mutation');
  assert.ok(
    mutations.some(i => (i.relatedEntities ?? []).includes('user')),
    `should resolve entity "user" from argument "users", got: ${JSON.stringify(mutations.map(i => i.relatedEntities))}`
  );
});

test('useMutation wrapping Supabase: entity extracted from mutationFn body', () => {
  const files = [{ path: 'src/hooks/useIssue.ts', content: `
    function useDeleteIssue() {
      return useMutation({
        mutationFn: async (id) => {
          await supabase.from('issues').delete().eq('id', id);
        },
      });
    }
  ` }];
  const mutations = detectInteractions(files).filter(i => i.triggerExpression === 'useMutation(');
  assert.ok(mutations.length > 0, 'should detect useMutation');
  assert.ok(
    mutations.some(i => (i.relatedEntities ?? []).includes('issue')),
    `should resolve entity "issue" from mutationFn body, got: ${JSON.stringify(mutations.map(i => i.relatedEntities))}`
  );
});

test('.delete() inside comment or string is not detected as mutation', () => {
  const files = [{ path: 'src/service.ts', content: `
    // await supabase.from('users').delete()
    /* prisma.user.delete({ where: { id } }) */
    const sql = "db.delete(orders)";
  ` }];
  const mutations = detectInteractions(files).filter(i => i.type === 'mutation');
  assert.equal(
    mutations.length, 0,
    `should not detect mutations inside comments/strings, got: ${JSON.stringify(mutations.map(i => i.triggerExpression))}`
  );
});
