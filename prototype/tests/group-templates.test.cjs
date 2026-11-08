const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function extractFunction(name) {
  const start = script.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Production function ${name} exists`);
  const open = script.indexOf('{', start);
  let depth = 0, quote = null, escaped = false;
  for (let i = open; i < script.length; i++) {
    const c = script[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return script.slice(start, i + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

const accounts = Array.from({ length: 200 }, (_, i) => ({ name: `member${i + 1}`, character: `Murr${i + 1}`, characterClass: 'Воин', role: 'member' }));
const persisted = new Map(), messages = [];
let templateName = 'Рейдовый состав';
const context = vm.createContext({
  members: [], demoAccounts: accounts, demoUser: null, isMember: () => true, isCompletedEvent: () => false,
  templateDraft: { eventKey: 'raid', name: templateName, search: '', groups: [
    { id: 'draft_a', name: 'Основная', members: [], leaderKey: null },
    { id: 'draft_b', name: 'Поддержка', members: [], leaderKey: null },
  ] },
  activeTemplateEventKey: 'raid', groupTemplates: [],
  eventGroupsByEvent: { raid: [{ id: 'old', name: 'Старая группа', members: ['member199'] }] },
  attendanceByEvent: { raid: { member1: 'Приду', member2: 'Приду', member3: '50/50', member5: 'Не приду' } },
  GROUP_TEMPLATES_STORAGE_KEY: 'murrclan_group_templates_v1', EVENT_GROUPS_STORAGE_KEY: 'murrclan_event_groups_v1',
  document: { querySelector: selector => ({ value: selector.includes('group-template-name-input') ? templateName : '' }) },
  escapeText: value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  attendeeForKey: key => ({ name: `Murr${key.replace('member', '')}`, cls: 'Воин' }),
  refreshGroupTemplateManager() {}, closeGroupTemplateManager() { context.templateDraft = null; },
  saveGroupTemplates() { persisted.set('murrclan_group_templates_v1', JSON.stringify(context.groupTemplates)); return true; },
  saveEventGroups() { persisted.set('murrclan_event_groups_v1', JSON.stringify(context.eventGroupsByEvent)); },
  render() {}, restoreEventDetails() {}, toast: (message, placement) => messages.push({ message, placement }), confirm: () => true, console,
});
for (const name of ['getEventPeople', 'renderGroupTemplateManager', 'readTemplateDrag', 'dropIntoTemplateGroup', 'saveGroupTemplate', 'saveEventGroupsAsTemplate', 'applyGroupTemplate', 'deleteGroupTemplate']) {
  vm.runInContext(extractFunction(name), context, { filename: `index.html:${name}` });
}

const builder = context.renderGroupTemplateManager('raid');
assert.match(builder, /Все участники клана · 200/, 'template builder uses the full clan roster');
assert.match(builder, /Создать шаблон|Новый шаблон/);
function dragged(userKey) {
  return { preventDefault() {}, currentTarget: { classList: { remove() {} } }, dataTransfer: { getData: () => JSON.stringify({ templateDraft: true, userKey }) } };
}
context.dropIntoTemplateGroup(dragged('member1'), 'draft_a');
context.dropIntoTemplateGroup(dragged('member2'), 'draft_a');
context.dropIntoTemplateGroup(dragged('member3'), 'draft_b');
context.dropIntoTemplateGroup(dragged('member4'), 'draft_b');
context.dropIntoTemplateGroup(dragged('member5'), 'draft_b');
context.templateDraft.groups[0].leaderKey = 'member1';
context.templateDraft.groups[1].leaderKey = 'member3';
assert.match(context.renderGroupTemplateManager('raid'), /Murr1 · Воин — Пати лидер/);
context.saveGroupTemplate('raid');
assert.equal(context.groupTemplates.length, 1);
assert.equal(context.groupTemplates[0].name, 'Рейдовый состав');
assert.deepEqual([...context.groupTemplates[0].groups[0].members], ['member1', 'member2']);

context.applyGroupTemplate('raid', context.groupTemplates[0].id);
assert.deepEqual(context.eventGroupsByEvent.raid.map(group => group.name), ['Основная', 'Поддержка']);
assert.deepEqual([...context.eventGroupsByEvent.raid[0].members], ['member1', 'member2']);
assert.equal(context.eventGroupsByEvent.raid[0].leaderKey, 'member1');
assert.deepEqual([...context.eventGroupsByEvent.raid[1].members], [], '50/50 and unmarked members are omitted when applying a template');
assert.equal(context.eventGroupsByEvent.raid[1].leaderKey, null, 'a filtered-out leader is not retained');

context.eventGroupsByEvent.raid = [
  { id: 'real_a', name: 'Группа 1', members: ['member1', 'member2'], leaderKey: 'member2' },
  { id: 'real_b', name: 'Группа 2', members: ['member4'], leaderKey: null },
];
context.saveEventGroupsAsTemplate('raid');
assert.equal(context.templateDraft.name, '', 'saving an event setup opens the name field instead of prompting');
assert.deepEqual([...context.templateDraft.groups[0].members], ['member1', 'member2']);
assert.equal(context.templateDraft.groups[0].leaderKey, 'member2', 'saved setup preserves the group leader');
templateName = 'Удачный состав';
context.saveGroupTemplate('raid');
assert.equal(context.groupTemplates[1].name, 'Удачный состав');
assert.equal(context.groupTemplates[1].groups[0].leaderKey, 'member2');
const standaloneManager = context.renderGroupTemplateManager('__standalone__');
assert.doesNotMatch(standaloneManager, /onclick="applyGroupTemplate/ , 'standalone template manager does not offer apply without an event');
assert.match(standaloneManager, /＋ Создать шаблон/, 'standalone manager offers template creation without an event');

for (let i = 1; i < 19; i++) context.groupTemplates.push({ id: `t${i}`, name: `T${i}`, groups: [{ name: 'G', members: [] }] });
context.templateDraft = { eventKey: 'raid', name: 'Twenty first', groups: [{ id: 'g', name: 'G', members: [], leaderKey: null }] };
templateName = 'Twenty first';
context.saveGroupTemplate('raid');
assert.equal(context.groupTemplates.length, 20, 'template limit is 20');
assert.ok(messages.some(item => item.message.includes('лимит')));
context.deleteGroupTemplate('t1');
assert.equal(context.groupTemplates.length, 19);
context.templateDraft = { eventKey: '__standalone__', name: 'Ошибка сохранения', groups: [{ id: 'g', name: 'G', members: [], leaderKey: null }] };
templateName = 'Ошибка сохранения';
const beforeFailedSave = context.groupTemplates.length;
context.saveGroupTemplates = () => false;
context.saveGroupTemplate('__standalone__');
assert.equal(context.groupTemplates.length, beforeFailedSave, 'failed persistence does not falsely add the template');
assert.ok(context.templateDraft, 'failed save keeps the draft available for retry');
assert.ok(messages.some(item => item.message.includes('Не удалось сохранить шаблон') && item.placement === 'high'), 'failure notice is shown at the top');
assert.ok(messages.some(item => item.message === 'Шаблон сохранён' && item.placement === 'high'), 'success notice is shown at the top');
console.log('PASS: full-roster template creation, event-layout save, apply, delete, leader preservation, storage failure handling, and top-positioned feedback.');
