/* check_signal_demo.js — 데모에서 실제로 몇 건이 뜨는지 센다 (20-5차)
   ------------------------------------------------------------------------
   왜 필요한가
     판정 함수를 붙이는 것과 그 알림이 화면에 뜨는 것은 다른 일이다. 조건이
     참이 되는 데이터가 없으면 사람이 보는 것은 늘 「지금은 뜰 상태가 아니에요」다.
     엔진은 역할 대표 인물 4명(`ROLE_EMP`)을 기준으로 판단하고, 역할 스위처가
     그 4명으로 화면을 바꾸므로 **데모에서 보이는 것은 이 4명 기준의 결과**다.
     그래서 그 기준으로 참·거짓을 세어 데이터를 심을 자리를 찾는다.

   무엇을 세는가
     1) 판정 함수가 붙은 신호 수 (실계산 가능)
     2) 대표 인물 기준으로 참이 되는 신호 — 단계 × 수신 대상 표로
     3) 한 번도 참이 되지 않는 신호 목록 (= 데이터를 심어야 할 자리)

   쓰는 법   node scripts/check_signal_demo.js
   끝값      항상 0 — 이것은 계기판이고 통과·실패를 가르지 않는다.
             (--strict 를 주면 참이 한 건도 없을 때만 1)
   ------------------------------------------------------------------------ */
'use strict';

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
['talenx_data.js', 'ez_kit.js', 'ez_signals.js', 'ez_signal_engine.js',
 'ez_signal_eval2.js', 'ez_signal_eval3.js', 'ez_signal_eval4.js', 'ez_signal_eval5.js',
 'ez_signal_eval6.js', 'ez_signal_eval7.js', 'ez_signal_eval8.js', 'ez_signal_eval9.js']
  .forEach(function (f) {
    try { require(path.join(JS, f)); } catch (e) { /* 아직 없는 판정 파일은 건너뛴다 */ }
  });

var cat = window.EZSignalCatalog;
var E = window.EZSignalEngine;
if (!cat || !E || !E.evaluate) {
  console.error('신호 카탈로그 또는 엔진을 읽지 못했습니다');
  process.exit(1);
}

/* 수신 대상 → 그 신호를 받는 역할. 상위조직장은 별도 롤이 없어 조직장이 상위 관점으로 받는다. */
var ROLE = { '구성원': 'member', '팀장': 'leader', '상위조직장': 'leader', 'HR경영진': 'hr' };
var STAGES = ['목표수립', '중간점검', '평가', '피드백'];
var ACTORS = ['구성원', '팀장', '상위조직장', 'HR경영진'];

var ids = E.liveIds ? E.liveIds() : [];
var idset = {};
ids.forEach(function (id) { idset[id] = 1; });

var hitOf = {}, notReady = [], errs = [];
ids.forEach(function (id) {
  var s = null, i;
  for (i = 0; i < cat.signals.length; i++) if (cat.signals[i].id === id) { s = cat.signals[i]; break; }
  if (!s) return;
  var r;
  E.flush();
  try { r = E.evaluate(id, ROLE[s.actor] || 'member'); } catch (e) {
    errs.push(id + ' : ' + String(e && e.message || e).slice(0, 60));
    return;
  }
  if (!r.ready) { notReady.push(id); return; }
  hitOf[id] = !!r.hit;
});

function pad(s, n) {
  s = String(s);
  var w = 0, i;
  for (i = 0; i < s.length; i++) w += (s.charCodeAt(i) > 127 ? 2 : 1);
  while (w < n) { s += ' '; w++; }
  return s;
}
function cell(stage, actor) {
  var on = 0, off = 0, i, s;
  for (i = 0; i < cat.signals.length; i++) {
    s = cat.signals[i];
    if (s.stage !== stage || s.actor !== actor) continue;
    if (!idset[s.id] || !(s.id in hitOf)) continue;
    if (hitOf[s.id]) on++; else off++;
  }
  return { on: on, off: off };
}

var hitIds = Object.keys(hitOf).filter(function (id) { return hitOf[id]; });
var coldIds = Object.keys(hitOf).filter(function (id) { return !hitOf[id]; });

console.log('신호 ' + cat.signals.length + '건 · 판정 함수 ' + ids.length + '건 · 대표 인물 기준 참 '
  + hitIds.length + '건 / 거짓 ' + coldIds.length + '건');
console.log('');
console.log('단계 × 수신 대상 (참/판정있음)');
var head = pad('', 12), a;
for (a = 0; a < ACTORS.length; a++) head += pad(ACTORS[a], 12);
console.log(head);
STAGES.forEach(function (st) {
  var line = pad(st, 12), i, c;
  for (i = 0; i < ACTORS.length; i++) {
    c = cell(st, ACTORS[i]);
    line += pad((c.on + c.off) ? (c.on + '/' + (c.on + c.off)) : '-', 12);
  }
  console.log(line);
});

console.log('');
console.log('뜨는 신호 ' + hitIds.length + '건');
hitIds.sort().forEach(function (id) { console.log('  ● ' + id); });
console.log('');
console.log('안 뜨는 신호 ' + coldIds.length + '건 — 데이터를 심을 자리');
coldIds.sort().forEach(function (id) { console.log('  ○ ' + id); });
if (notReady.length) console.log('\n계산 못 함 ' + notReady.length + '건 : ' + notReady.join(' · '));
if (errs.length) {
  console.log('\n예외 ' + errs.length + '건');
  errs.forEach(function (t) { console.log('  ' + t); });
}

if (process.argv.indexOf('--strict') >= 0 && !hitIds.length) process.exit(1);
process.exit(0);
