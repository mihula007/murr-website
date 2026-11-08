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

const now = Date.now();
const context = vm.createContext({
  getCurrentMemberRoster: () => [
    { name: 'PlayerA', cls: 'Воин', joinedAt: new Date(now - 5 * 86400000).toISOString() },
    { name: 'PlayerB', cls: 'Жрец', joinedAt: null },
    { name: 'PlayerC', cls: 'Маг' },
  ],
  demoAccounts: [{ name: 'accountA', character: 'PlayerA', role: 'member' }],
  events: [{ uid: 'done1', completed: true }, { uid: 'done2', completed: true }, { uid: 'future', completed: false }],
  eventGroupsByEvent: {
    done1: [{ members: ['accountA', 'PlayerB'], leaderKey: 'accountA' }],
    done2: [{ members: ['PlayerB'], leaderKey: 'PlayerB' }],
    future: [{ members: ['PlayerC'], leaderKey: 'PlayerC' }],
  },
  attendanceByEvent: {
    done2: { accountA: 'Не приду', PlayerC: '50/50' },
  },
  attendanceRatingSortKey: 'rank', attendanceRatingSortDirection: 'desc',
  renderAttendanceRating() { this.renderCalls = (this.renderCalls || 0) + 1; },
  document: { getElementById: () => ({ value: '' }) },
});
for (const name of ['buildAttendanceRatingRows', 'sortAttendanceRatingRows', 'sortAttendanceRating']) {
  vm.runInContext(extractFunction(name), context, { filename: `index.html:${name}` });
}
const rows = Array.from(context.sortAttendanceRatingRows(context.buildAttendanceRatingRows()), row => ({ ...row }));
assert.equal(rows.length, 3);
const byName = new Map(rows.map(row => [row.name, row]));
assert.deepEqual(rows.map(row => row.name), ['PlayerB', 'PlayerA', 'PlayerC'], 'ranking sorts by attendance percentage');
assert.equal(byName.get('PlayerA').visited, 1);
assert.equal(byName.get('PlayerA').missed, 1);
assert.equal(byName.get('PlayerA').partyLeaders, 1);
assert.equal(byName.get('PlayerA').attendancePercent, 50);
assert.equal(byName.get('PlayerA').daysInGuild, 5);
assert.equal(byName.get('PlayerB').visited, 2);
assert.equal(byName.get('PlayerB').partyLeaders, 1);
assert.equal(byName.get('PlayerB').unmarked, 0);
assert.equal(byName.get('PlayerC').missed, 1, '50/50 is transferred to the did-not-attend count');
assert.equal(byName.get('PlayerC').unmarked, 1);
assert.equal(byName.get('PlayerC').attendancePercent, 0);

assert.match(html, /data-page="kos"[^>]*>Рейтинг посещения/);
assert.match(html, /id="attendanceRatingRows"/);
assert.doesNotMatch(html, /<th>Неопределённо<\/th>/);
for (const key of ['name', 'cls', 'visited', 'missed', 'unmarked', 'attendancePercent', 'partyLeaders', 'daysInGuild']) {
  assert.match(html, new RegExp(`data-rating-sort="${key}"`), `${key} column has a sort control`);
}
assert.match(html, /<th>№<\/th>/, 'rank numbers remain visible without a sort control');
assert.doesNotMatch(html, /data-rating-sort="rank"/);
const sortKeyBeforeRankClick = context.attendanceRatingSortKey;
context.sortAttendanceRating('rank');
assert.equal(context.attendanceRatingSortKey, sortKeyBeforeRankClick, 'rank column is not sortable');
context.sortAttendanceRating('missed');
assert.equal(context.attendanceRatingSortKey, 'missed');
assert.equal(context.attendanceRatingSortDirection, 'desc');
context.sortAttendanceRating('missed');
assert.equal(context.attendanceRatingSortDirection, 'asc', 'clicking the active column reverses its order');
context.demoUser = { email: 'new-member@example.test', applicationStatus: 'vote_approved', role: 'applicant' };
context.demoAccounts = [{ email: context.demoUser.email, name: 'NewMember' }];
context.saveCurrentAccount = () => { context.savedAcceptedAccount = { ...context.demoUser }; };
context.updateAccess = () => {};
context.render = () => {};
context.renderAccountDashboard = () => {};
context.toast = () => {};
vm.runInContext(extractFunction('demoAdminDecision'), context, { filename: 'index.html:demoAdminDecision' });
context.demoAdminDecision(true);
assert.equal(context.demoUser.role, 'member');
assert.ok(context.demoUser.joinedAt, 'guild tenure begins at admin acceptance');
assert.equal(context.savedAcceptedAccount.joinedAt, context.demoUser.joinedAt, 'acceptance date is saved with the account');
console.log('PASS: rating sorts and numbers participants, counts 50/50 as did not attend, and derives current attendance metrics.');
