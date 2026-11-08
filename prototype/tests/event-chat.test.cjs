const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert.match(html, /\.event-chat-input\{height:128px;min-height:128px/);
assert.match(html, /\.event-chat-send\{flex:0 0 auto;min-width:96px;height:42px/);
assert.match(html, /\.card \.event-chat-send\{width:auto;min-width:96px;max-width:140px;flex:0 0 110px\}/, 'chat button overrides the general full-width card button rule');
assert.match(html, /\.event-chat-input-row \.event-chat-input\{width:100%;min-width:0;box-sizing:border-box;flex:1 1 auto\}/, 'chat input keeps the available row width');
assert.match(html, /\.event-chat-message\.incoming\{align-self:flex-start/);
assert.match(html, /\.event-chat-message\.outgoing\{align-self:flex-end/);
assert.match(html, /\.event-chat-reply-button\{border:0;background:transparent/);
assert.match(html, /\.event-chat-message\.incoming\{[^}]*background:#1b293866/);
assert.match(html, /\.event-chat-message\.outgoing\{[^}]*background:#2b527866/);
assert.match(html, /\.event-chat-send,\.card \.event-chat-send\{width:42px;min-width:42px;max-width:42px;height:42px;flex:0 0 42px/, 'send button is a compact icon button');
assert.match(html, /\.event-chat-input-shell \.event-chat-input\{display:block;width:100%;height:128px;min-height:128px;padding-right:104px;padding-bottom:54px/, 'message input expands across the row with room for inline controls');
assert.match(html, /aria-label="Отправить сообщение" title="Отправить"><svg viewBox="0 0 24 24"/, 'send button uses the requested arrow icon');
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

let input = {
  value: 'hi!', selectionStart: 1, selectionEnd: 2,
  focus() {}, setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
};
let panelHtml = '';
const stored = new Map();
const list = { scrollTop: 0, scrollHeight: 100 };
const panel = { set innerHTML(value) { panelHtml = value; }, querySelector: selector => selector === '.event-chat-messages' ? list : input };
const dialog = {
  querySelector(selector) {
    if (selector === '.event-chat-input') return input;
    if (selector === '.event-chat-panel') return panel;
    return null;
  },
};
const toasts = [];
const context = vm.createContext({
  eventChatsByEvent: {}, eventChatReplyByEvent: {}, EVENT_CHATS_STORAGE_KEY: 'murrclan_event_chats_v1',
  demoUser: { name: 'Elena', character: 'MurrMage' }, isMember: () => true,
  localStorage: { setItem: (key, value) => stored.set(key, value) },
  saveEventChats() { stored.set('murrclan_event_chats_v1', JSON.stringify(context.eventChatsByEvent)); },
  escapeText: value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  toast: message => toasts.push(message), console,
});
for (const name of ['renderEventChatContent', 'sendEventChat', 'insertEventChatEmoji', 'toggleEventEmojiPicker', 'setEventChatReply', 'cancelEventChatReply']) {
  vm.runInContext(extractFunction(name), context, { filename: `index.html:${name}` });
}

context.insertEventChatEmoji({ closest: () => dialog }, '😀');
assert.equal(input.value, 'h😀!');
input.value = 'Сбор в 20:00 <готово> 😀';
context.sendEventChat('event_1', { closest: () => dialog });
assert.equal(context.eventChatsByEvent.event_1.length, 1);
assert.equal(context.eventChatsByEvent.event_1[0].author, 'MurrMage');
assert.equal(context.eventChatsByEvent.event_1[0].text, 'Сбор в 20:00 <готово> 😀');
assert.equal(context.eventChatsByEvent.event_2, undefined, 'chat messages are isolated by event');
assert.equal(JSON.parse(stored.get('murrclan_event_chats_v1')).event_1[0].text, 'Сбор в 20:00 <готово> 😀');
assert.match(panelHtml, /&lt;готово&gt;/, 'message text is safely rendered as text');
assert.match(panelHtml, /😀/);
assert.equal(list.scrollTop, list.scrollHeight, 'the chat scrolls to the newest message');
const firstMessage = context.eventChatsByEvent.event_1[0];
context.setEventChatReply('event_1', firstMessage.id, { closest: () => dialog });
assert.match(panelHtml, /Ответ на: MurrMage/);
input.value = 'Подтверждаю';
context.sendEventChat('event_1', { closest: () => dialog });
assert.equal(context.eventChatsByEvent.event_1[1].replyTo.messageId, firstMessage.id);
assert.equal(context.eventChatsByEvent.event_1[1].replyTo.text, firstMessage.text);
assert.match(panelHtml, /Ответить/);
assert.match(panelHtml, /↶/);
assert.match(panelHtml, /<header class="event-chat-message-head"><strong>[^<]+<\/strong><time>[^<]+<\/time><button[^>]*class="event-chat-reply-button"/, 'time precedes reply arrow beside the nickname');
assert.match(panelHtml, /class="event-chat-emojis hidden"/, 'emoji picker is hidden by default');
assert.match(panelHtml, /class="event-chat-emoji-toggle"[^>]*aria-expanded="false"/, 'emoji picker has a closed toggle button');
assert.match(panelHtml, /class="event-chat-input-shell"><textarea[\s\S]*?class="event-chat-emoji-toggle"[\s\S]*?class="btn event-chat-send"/, 'emoji and send controls sit inside the expanded message field');
assert.match(panelHtml, /event-chat-message outgoing/);
assert.match(panelHtml, /&lt;готово&gt;/, 'reply quote remains rendered after sending');
context.eventChatsByEvent.event_1.unshift({ id: 'incoming_1', author: 'Другой соклан', text: 'Увидимся!', createdAt: Date.now() - 86400000 });
const conversationMarkup = context.renderEventChatContent('event_1');
assert.match(conversationMarkup, /event-chat-message incoming/);
assert.match(conversationMarkup, /event-chat-message outgoing/);
assert.equal((conversationMarkup.match(/class="event-chat-date"/g) || []).length, 2, 'calendar days are separated in the conversation');
const picker = { hidden: true, classList: { contains: () => picker.hidden, toggle: (_name, hide) => { picker.hidden = hide; }, add: () => { picker.hidden = true; } } };
let expanded = 'false';
const emojiToggle = { closest: () => ({ querySelector: () => picker }), setAttribute: (_name, value) => { expanded = value; } };
context.toggleEventEmojiPicker(emojiToggle);
assert.equal(picker.hidden, false, 'clicking the emoji toggle opens the picker');
assert.equal(expanded, 'true');
context.toggleEventEmojiPicker(emojiToggle);
assert.equal(picker.hidden, true, 'clicking the emoji toggle closes the picker');
assert.equal(expanded, 'false');
console.log('PASS: event chat isolates and persists messages, safely renders emoji and reply quotes, supports replying, and scrolls to latest.');
