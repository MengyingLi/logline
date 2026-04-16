const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidEventName,
  isBusinessEvent,
  toSnakeCaseFromPascalOrCamel,
  extractLikelyObjectFromPath,
} = require('../dist/lib/utils/event-name.js');

test('rejects garbage names', () => {
  for (const g of ['save_saved', 'add_added', 'click_clicked', 'delete_deleted', 'update_updated', 'remove_removed']) {
    assert.equal(isValidEventName(g), false, `should reject "${g}"`);
  }
});

test('rejects too-short object', () => {
  assert.equal(isValidEventName('ab_created'), false);
});

test('rejects single-word names', () => {
  assert.equal(isValidEventName('clicked'), false);
});

test('accepts valid names', () => {
  for (const v of ['workflow_created', 'template_selected', 'step_config_saved', 'user_signed_up']) {
    assert.equal(isValidEventName(v), true, `should accept "${v}"`);
  }
});

test('filters non-business events', () => {
  for (const nb of ['key_pressed', 'mouse_moved', 'scroll_started', 'focus_gained', 'drag_started']) {
    assert.equal(isBusinessEvent(nb), false, `should filter "${nb}"`);
  }
  assert.equal(isBusinessEvent('workflow_created'), true);
});

test('converts PascalCase to snake_case', () => {
  assert.equal(toSnakeCaseFromPascalOrCamel('WorkflowEditor'), 'workflow_editor');
  assert.equal(toSnakeCaseFromPascalOrCamel('StepConfigPanel'), 'step_config_panel');
});

test('extracts object from meaningful path', () => {
  assert.ok(extractLikelyObjectFromPath('src/components/WorkflowEditor.tsx'));
});

test('returns null for generic index path', () => {
  assert.equal(extractLikelyObjectFromPath('src/pages/index.tsx'), null);
});
