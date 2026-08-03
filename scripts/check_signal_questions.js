/* check_signal_questions.js — 「이 알림을 부르는 질문」 150건 회귀 검사
   ------------------------------------------------------------------------
   왜 필요한가
     신호 카탈로그 엑셀(W5 제출본)의 「이 알림을 부르는 질문」 열은 이 리포의
     `js/ez_signal_chat.js` QMAP 을 그대로 옮긴 것이다. 표에 적힌 문장을
     사용자가 그대로 입력하면 그 알림이 열린다는 약속이 엑셀에 적혀 있으므로,
     QMAP 이나 낱말 사전(KEYS·HINT)을 고칠 때마다 그 약속이 아직 참인지 센다.

   무엇을 세는가
     1) 신호 150건 전부에 질문이 있는가 (빠짐 0)
     2) 질문 문장이 서로 겹치지 않는가 (중복 0)
     3) 질문을 그대로 입력했을 때 `matchAny` 가 그 신호를 고르는가 (어긋남 0)
     4) 길이가 사람이 읽을 만한 범위인가 (18~36자)

   쓰는 법   node scripts/check_signal_questions.js
   끝값      전부 통과 0 · 하나라도 어긋나면 1
   ------------------------------------------------------------------------ */
'use strict';

/* 브라우저 전역만 쓰는 파일들을 노드에서 읽으려고 최소한만 흉내낸다 */
global.window = global;
global.MutationObserver = function () { this.observe = function () {}; this.disconnect = function () {}; };
global.document = {
  readyState: 'complete',
  addEventListener: function () {},
  querySelector: function () { return null; },
  querySelectorAll: function () { return []; },
  createElement: function () {
    return { style: {}, appendChild: function () {}, setAttribute: function () {}, addEventListener: function () {} };
  },
  body: { appendChild: function () {} }
};
global.localStorage = {
  _d: {},
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem: function (k, v) { this._d[k] = String(v); },
  removeItem: function (k) { delete this._d[k]; }
};

var path = require('path');
var JS = path.join(__dirname, '..', 'js');
['talenx_data.js', 'ez_kit.js', 'ez_signals.js', 'ez_signal_engine.js', 'ez_signal_chat.js']
  .forEach(function (f) { require(path.join(JS, f)); });

var cat = window.EZSignalCatalog;
var chat = window.EZSignalChat;
var ROLE = { '구성원': 'member', '팀장': 'leader', '상위조직장': 'leader', 'HR경영진': 'hr' };
var MIN = 18, MAX = 36;

var fail = [];
function bad(kind, id, detail) { fail.push({ kind: kind, id: id, detail: detail }); }

if (!cat || !cat.signals || !cat.signals.length) {
  console.error('신호 카탈로그를 읽지 못했습니다 (js/ez_signals.js)');
  process.exit(1);
}
if (!chat || !chat.questionFor || !chat.matchAny) {
  console.error('질문 사전을 읽지 못했습니다 (js/ez_signal_chat.js)');
  process.exit(1);
}

var seen = {}, live = 0;
cat.signals.forEach(function (s) {
  var q = chat.questionFor(s.id);
  if (!q) { bad('질문 없음', s.id, ''); return; }
  if (seen[q]) bad('질문 중복', s.id, '「' + q + '」 = ' + seen[q]);
  seen[q] = s.id;
  if (q.length < MIN || q.length > MAX) bad('길이 이탈', s.id, q.length + '자 「' + q + '」');

  var m = null;
  try { m = chat.matchAny(q, ROLE[s.actor] || 'member'); } catch (e) { m = null; }
  if (!m) bad('안 걸림', s.id, '「' + q + '」');
  else if (m.id !== s.id) bad('다른 신호', s.id, '→ ' + m.id + ' 「' + q + '」');
  if (s.now === 1) live++;
});

var n = cat.signals.length;
console.log('신호 ' + n + '건 · 지금 확인 가능 ' + live + '건 · 카탈로그 ' + cat.version);
if (!fail.length) {
  console.log('질문 ' + n + '건 : 빠짐 0 · 중복 0 · 어긋남 0 · 길이 ' + MIN + '~' + MAX + '자 통과');
  process.exit(0);
}
console.log('어긋남 ' + fail.length + '건');
fail.forEach(function (f) { console.log('  [' + f.kind + '] ' + f.id + ' ' + f.detail); });
process.exit(1);
