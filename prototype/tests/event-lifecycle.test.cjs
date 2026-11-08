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

const events = [
  { id: 1, uid: 'active_1', name: 'Raid' },
  { id: 2, uid: 'active_2', name: 'Farm' },
  { id: 3, uid: 'done_1', name: 'Old raid', completed: true },
];
const attendanceByEvent = { active_1: { member: 'Приду' }, active_2: { member: '50/50' }, done_1: { member: 'Не приду' } };
const eventGroupsByEvent = { active_1: [{ id: 'g', name: 'Party', members: ['member'] }], active_2: [{ id: 'g2', name: 'Duo', members: [] }] };
const persisted = new Map();
const context = vm.createContext({
  events, attendanceByEvent, eventGroupsByEvent, eventListView: 'active',
  ATTENDANCE_STORAGE_KEY: 'murrclan_attendance_by_event_v7',
  EVENT_GROUPS_STORAGE_KEY: 'murrclan_event_groups_v1',
  localStorage: { setItem: (key, value) => persisted.set(key, value) },
  demoUser: { role: 'member' }, isMember: () => true,
  confirm: () => true, render() {}, toast() {}, console,
});
for (const name of ['saveEvents', 'saveAttendance', 'saveEventGroups', 'completeEvent', 'deleteEvent']) {
  vm.runInContext(extractFunction(name), context, { filename: `index.html:${name}` });
}

context.completeEvent('active_1');
assert.equal(events[0].completed, true);
assert.ok(events[0].completedAt);
assert.equal(context.eventListView, 'completed');
assert.deepEqual(JSON.parse(persisted.get('murrclan_demo_events')).map(event => !!event.completed), [true, false, true]);
assert.equal(attendanceByEvent.active_1.member, 'Приду', 'completion preserves attendance for analysis');
assert.equal(eventGroupsByEvent.active_1[0].members[0], 'member', 'completion preserves group data');

context.deleteEvent('active_2');
assert.deepEqual(context.events.map(event => event.uid), ['active_1', 'done_1']);
assert.equal(attendanceByEvent.active_2, undefined);
assert.equal(eventGroupsByEvent.active_2, undefined);
assert.equal(JSON.parse(persisted.get('murrclan_attendance_by_event_v7')).active_1.member, 'Приду');
context.deleteEvent('done_1');
assert.equal(context.events.some(event => event.uid === 'done_1'), true, 'completed events remain in the analysis section');
console.log('PASS: complete moves events to history and preserves analysis data; delete removes only active events.');
