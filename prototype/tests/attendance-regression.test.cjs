const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function extractFunction(name) {
  const start = script.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Production function ${name} exists`);
  const open = script.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let escaped = false;
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
  { id: 1, uid: 'event_1', name: 'Raid' },
  { id: 2, uid: 'event_2', name: 'Farm' },
  { id: 3, uid: 'event_3', name: 'Arena' },
];
let attendanceByEvent = {
  event_1: { member: 'Приду' },
  event_2: { member: 'Не приду' },
  event_3: { member: '50/50' },
};
const editingEvents = new Set();
const stored = new Map();
const cards = new Map();
let renderCount = 0;
const context = vm.createContext({
  events, attendanceByEvent, editingEvents,
  ATTENDANCE_STORAGE_KEY: 'murrclan_attendance_by_event_v7',
  localStorage: { setItem: (key, value) => stored.set(key, value), getItem: key => stored.get(key) },
  console, document: { querySelectorAll: () => [] }, renderEventDetails: () => '', demoUser: { name: 'Member' }, isMember: () => true,
  toast: () => {}, render: () => {
    renderCount++;
    cards.clear();
    for (const event of events) cards.set(event.uid, { uid: event.uid });
  },
});
for (const name of ['eventCard', 'saveAttendance', 'debugAttendance', 'chooseAttendance', 'changeAttendance']) {
  vm.runInContext(extractFunction(name), context, { filename: `index.html:${name}` });
}

function buttonFor(uid) {
  return { closest: selector => selector === '[data-event-uid]' ? {
    getAttribute: attr => attr === 'data-event-uid' ? uid : null,
  } : null };
}
function choices() {
  return JSON.parse(JSON.stringify(context.attendanceByEvent));
}

// Initial event rendering and persisted answers are distinct for every UID.
assert.match(context.eventCard(events[0]), /Твоё решение: <strong>Приду/);
assert.match(context.eventCard(events[1]), /Твоё решение: <strong>Не приду/);
assert.match(context.eventCard(events[2]), /Твоё решение: <strong>50\/50/);
const before = choices();

// Enable editing for every event; each action triggers the production rerender path.
for (const event of events) context.changeAttendance(buttonFor(event.uid));
assert.deepEqual([...context.editingEvents].sort(), ['event_1', 'event_2', 'event_3']);
assert.equal(renderCount, 3);

// Change one event only and verify the others before and after a simulated reload.
context.chooseAttendance(buttonFor('event_2'), 'Приду');
const after = choices();
assert.deepEqual(after, {
  event_1: before.event_1,
  event_2: { member: 'Приду' },
  event_3: before.event_3,
});
assert.equal(JSON.parse(stored.get('murrclan_attendance_by_event_v7')).event_1.member, 'Приду');
assert.equal(JSON.parse(stored.get('murrclan_attendance_by_event_v7')).event_2.member, 'Приду');
assert.equal(JSON.parse(stored.get('murrclan_attendance_by_event_v7')).event_3.member, '50/50');

// Recreate the page's storage load and verify the rendered cards after reload.
const reloaded = JSON.parse(stored.get('murrclan_attendance_by_event_v7'));
const reloadContext = vm.createContext({ ...context, attendanceByEvent: reloaded });
vm.runInContext(extractFunction('eventCard'), reloadContext);
assert.match(reloadContext.eventCard(events[0]), /Твоё решение: <strong>Приду/);
assert.match(reloadContext.eventCard(events[1]), /Твоё решение: <strong>Приду/);
assert.match(reloadContext.eventCard(events[2]), /Твоё решение: <strong>50\/50/);

console.log('PASS: independent answers survive editing another event and reload.');
