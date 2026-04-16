const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeScope } = require('../dist/lib/utils/scope-analyzer.js');

test('finds useState variables', () => {
  const code = 'function App() {\n  const [workflow, setWorkflow] = useState({ id: "w1" });\n  return <div />;\n}';
  const scope = analyzeScope(code, 3);
  assert.ok(Array.isArray(scope), 'should return array');
  assert.ok(scope.map(v => v.name).includes('workflow'), `got: ${scope.map(v => v.name)}`);
});

test('finds function parameters', () => {
  const code = 'const handleSubmit = (workflow, index) => {\n  console.log(workflow.id);\n};';
  const scope = analyzeScope(code, 2);
  assert.ok(scope.map(v => v.name).includes('workflow'), `got: ${scope.map(v => v.name)}`);
});

test('finds destructured props', () => {
  const code = 'function Component({ user, onSave }) {\n  return <button onClick={() => onSave(user.id)}>Save</button>;\n}';
  const scope = analyzeScope(code, 2);
  assert.ok(scope.map(v => v.name).includes('user'), `got: ${scope.map(v => v.name)}`);
});

test('returns array for out-of-range line', () => {
  const result = analyzeScope('const x = 1;', 999);
  assert.ok(Array.isArray(result));
});
