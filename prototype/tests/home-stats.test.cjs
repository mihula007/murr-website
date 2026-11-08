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

const elements = { statMembers: { textContent: '' }, statEvents: { textContent: '' } };
const context = vm.createContext({
  members: [
    { name: 'MurrValk', cls: 'Воин' },
    { name: 'LunaMurr', cls: 'Жрец' },
    { name: 'MurrValk', cls: 'Воин' },
  ],
  demoAccounts: [
    { name: 'newbie', character: 'NewMage', role: 'member', characterClass: 'Маг' },
    { name: 'duplicate', character: 'lUnAmUrR', role: 'member', characterClass: 'Жрец' },
    { name: 'pending', character: 'Pending', role: 'candidate' },
  ],
  events: [{ id: 1 }, { id: 2 }, { id: 3, completed: true }],
  document: { getElementById: id => elements[id] || null },
});
for (const name of ['getCurrentMemberRoster', 'refreshHomeStats']) {
  vm.runInContext(extractFunction(name), context, { filename: `index.html:${name}` });
}

const roster = context.getCurrentMemberRoster();
assert.deepEqual(Array.from(roster, person => person.name), ['MurrValk', 'LunaMurr', 'NewMage']);
context.refreshHomeStats();
assert.equal(elements.statMembers.textContent, 3, 'member count matches unique roster people');
assert.equal(elements.statEvents.textContent, 2, 'event count excludes completed events');

context.members.push({ name: 'Fourth', cls: 'Мистик' });
context.events.push({ id: 4 });
context.refreshHomeStats();
assert.equal(elements.statMembers.textContent, 4, 'member count updates from latest roster');
assert.equal(elements.statEvents.textContent, 3, 'upcoming count updates from latest active events');
console.log('PASS: homepage statistics use the current unique clan roster and active event list.');
