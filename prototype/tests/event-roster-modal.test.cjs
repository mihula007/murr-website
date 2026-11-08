const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert.match(html, /\.event-roster-body\{grid-template-columns:minmax\(300px,\.85fr\) minmax\(360px,1fr\) minmax\(320px,400px\)/, 'desktop event window has a dedicated right-side chat column');
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

const accounts = Array.from({ length: 200 }, (_, i) => ({
  name: `member${String(i + 1).padStart(3, '0')}`,
  character: `Murr${String(i + 1).padStart(3, '0')}`,
  characterClass: i % 2 ? 'Маг' : 'Воин',
  role: 'member',
}));
const attendance = {};
accounts.slice(0, 25).forEach(account => attendance[account.name] = 'Приду');
accounts.slice(25, 55).forEach(account => attendance[account.name] = 'Не приду');
accounts.slice(55, 100).forEach(account => attendance[account.name] = '50/50');
let managerInputCount = 0;
const context = vm.createContext({
  members: [], demoAccounts: accounts, demoUser: null,
  eventGroupsByEvent: { event_big: [{ id: 'group_1', name: 'Party', members: ['member001', 'member026', 'member056'] }] },
  eventChatsByEvent: {},
  isMember: () => true,
  escapeText: value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  renderEventGroups: (eventKey, people) => { managerInputCount = people.length; return '<section class="event-groups-panel">groups</section>'; },
  renderEventChatPanel: () => '<section class="event-chat-panel">chat</section>',
});
for (const name of ['getEventPeople', 'renderEventDetails']) vm.runInContext(extractFunction(name), context);

const markup = context.renderEventDetails('event_big', attendance, 'Большой рейд');
assert.equal(managerInputCount, 200, 'group panel receives all 200 people');
assert.match(markup, /<div class="event-roster-body">[\s\S]*?<section class="event-chat-panel">/, 'chat is embedded in the event layout beside roster and groups');
assert.match(markup, /Придут · 24/);
assert.match(markup, /Не придут · 29/);
assert.match(markup, /50\/50 · 44/);
assert.match(markup, /Не отметились · 100/);
assert.equal((markup.match(/class="event-person-row"/g) || []).length, 197, 'members assigned to groups disappear from the available category lists');
assert.doesNotMatch(markup, /Murr001/, 'assigned people disappear from the unassigned category lists');
assert.match(markup, /Murr002/);
assert.match(markup, /Маг/);
console.log('PASS: large event window categorizes and exposes all 200 people, including unmarked members.');
