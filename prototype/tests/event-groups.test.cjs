const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert.match(html, /\.event-groups-panel \.event-groups\{grid-template-columns:minmax\(0,1fr\);width:100%\}/, 'event groups stack vertically instead of crowding adjacent columns');
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

const eventKey = 'event_test';
const persisted = new Map();
let inputValue = '';
let clipboardValue = '';
const messages = [];
const context = vm.createContext({
  eventGroupsByEvent: { [eventKey]: [] },
  isMember: () => true,
  document: { querySelector: () => ({ value: inputValue }) },
  localStorage: { setItem: (key, value) => persisted.set(key, value) },
  EVENT_GROUPS_STORAGE_KEY: 'murrclan_event_groups_v1',
  saveEventGroups() { persisted.set('murrclan_event_groups_v1', JSON.stringify(context.eventGroupsByEvent)); },
  render() {}, restoreEventDetails() {}, toast: message => messages.push(message), console,
  attendeeForKey: key => ({ name: key, cls: 'Воин' }),
  escapeText: value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  navigator: { clipboard: { writeText: value => { clipboardValue = value; return Promise.resolve(); } } },
});
for (const name of ['createEventGroup', 'deleteEventGroup', 'readGroupDrag', 'dropIntoEventGroup', 'dropIntoAttendeePool', 'setEventGroupLeader', 'toggleEventDetails', 'renderEventGroups', 'copyEventGroupNames']) {
  vm.runInContext(extractFunction(name), context, { filename: `index.html:${name}` });
}

for (const name of ['Party A', 'Party B', 'Party C', 'Party D']) {
  inputValue = name;
  context.createEventGroup(eventKey, { closest: () => ({ querySelector: () => ({ value: inputValue }) }) });
}
assert.equal(context.eventGroupsByEvent[eventKey].length, 4, 'group count has no fixed limit');
const [first, second] = context.eventGroupsByEvent[eventKey];

function dropEvent(userKey) {
  return {
    preventDefault() {},
    currentTarget: { classList: { remove() {} } },
    dataTransfer: { getData: () => JSON.stringify({ eventKey, userKey }) },
  };
}
context.dropIntoEventGroup(dropEvent('alpha'), eventKey, first.id);
context.dropIntoEventGroup(dropEvent('bravo'), eventKey, second.id);
context.setEventGroupLeader(eventKey, first.id, 'alpha');
assert.deepEqual([...first.members], ['alpha']);
assert.equal(first.leaderKey, 'alpha');
const groupMarkup = context.renderEventGroups(eventKey, [{ key: 'alpha' }, { key: 'bravo' }]);
assert.match(groupMarkup, /Party A · 1/);
assert.match(groupMarkup, /member-number[^>]*>1\./);
assert.match(groupMarkup, /Скопировать ники/);
assert.match(groupMarkup, /alpha · Воин — Пати лидер/);

// Reassigning moves a member, and dragging back to the pool removes membership and leadership.
context.dropIntoEventGroup(dropEvent('alpha'), eventKey, second.id);
assert.deepEqual([...first.members], []);
assert.deepEqual([...second.members], ['bravo', 'alpha']);
const copyPromise = context.copyEventGroupNames(eventKey, second.id);
context.dropIntoAttendeePool(dropEvent('alpha'), eventKey);
assert.deepEqual([...second.members], ['bravo']);
assert.equal(second.leaderKey, null);

// The new event-group key is saved independently; removing a group keeps remaining groups.
assert.equal(JSON.parse(persisted.get('murrclan_event_groups_v1'))[eventKey].length, 4);
context.deleteEventGroup(eventKey, first.id);
assert.equal(context.eventGroupsByEvent[eventKey].length, 3);

let hidden = true, expanded = 'false';
const titleButton = {
  closest: () => ({ querySelector: () => ({ classList: { toggle: cls => { assert.equal(cls, 'hidden'); hidden = !hidden; }, contains: cls => cls === 'hidden' && hidden } }) }),
  setAttribute: (key, value) => { if (key === 'aria-expanded') expanded = value; },
};
context.toggleEventDetails(titleButton);
assert.equal(hidden, false, 'clicking event title opens the panel');
assert.equal(expanded, 'true');
context.toggleEventDetails(titleButton);
assert.equal(hidden, true, 'clicking event title again closes the panel');
copyPromise.then(() => {
  assert.equal(clipboardValue, 'bravo, alpha', 'copy action joins group nicknames as a comma-separated list');
  console.log('PASS: event-title panel toggle, unlimited vertical groups, numbered members, comma-separated copy, drag assignment/removal, leader assignment, persistence, and deletion.');
});
