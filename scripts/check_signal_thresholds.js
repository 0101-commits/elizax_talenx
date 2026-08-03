/* check_signal_thresholds.js — 판정선이 카탈로그를 실제로 읽는지 센다 (20차)
   ------------------------------------------------------------------------
   왜 필요한가
     예전 엔진은 각 EVAL 안에 기준값 숫자를 박아 두었다. 그래서 카탈로그
     기준값을 고치면 화면에 적히는 숫자만 바뀌고 **알림이 뜨는 선은 그대로**였다.
     표와 제품이 갈라지는 가장 조용한 방식이라, 갈라지면 실패하는 검사를 둔다.

   무엇을 세는가
     1) 지금 켤 수 있는 신호(now:1) 전부가 evaluate 를 통과하는가 (ready)
     2) hit 스냅샷 — 몇 건이 참인지 (엔진을 고쳤을 때 눈에 보이는 변화가 여기 뜬다)
     3) **엔진이 판정에 쓰는 기준값이 카탈로그 값과 같은가** — 판정에 쓰이는 그
        함수(`EZSignalEngine.thresholdOf`)를 직접 불러 카탈로그 `thresholds[].value`
        와 한 숫자씩 맞춘다.
     4) **카탈로그를 고치면 따라오는가** — 값을 메모리에서 바꾸고 `flush()` 한 뒤
        같은 함수가 바뀐 값을 돌려주는지 본다. 파일은 건드리지 않는다.

   세지 않는 것
     그 값을 정말 판정 조건에 썼는지는 여기서 못 센다(데이터 상황과 기준값 방향에
     따라 답이 안 바뀌는 신호가 있다 — 「미커버 0건」처럼 값이 커지면 오히려 느슨해지는
     기준, 또는 `zero.length >= 1` 같은 앞단 조건이 먼저 걸리는 신호). 그것은 사람이 읽어
     확인한다. 이 검사가 잡는 것은 「카탈로그와 다른 숫자로 판정하는가」다.

   쓰는 법   node scripts/check_signal_thresholds.js
   끝값      전부 통과 0 · 카탈로그를 안 읽는 신호가 있으면 1
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
['talenx_data.js', 'ez_kit.js', 'ez_signals.js', 'ez_signal_engine.js'].forEach(function (f) {
  require(path.join(JS, f));
});

var cat = window.EZSignalCatalog;
var E = window.EZSignalEngine;
if (!cat || !E || !E.evaluate || !E.flush) {
  console.error('신호 카탈로그 또는 엔진을 읽지 못했습니다');
  process.exit(1);
}

var live = cat.signals.filter(function (s) { return s.now === 1; });

function num(v) { var m = /(-?\d+(\.\d+)?)/.exec(String(v == null ? '' : v)); return m ? parseFloat(m[1]) : null; }
/* 값의 단위(%·건·일·%p·곳·개·회)는 지키고 수만 바꾼다 */
function reValue(value, n) { return String(value).replace(/-?\d+(\.\d+)?/, String(n)); }

var base = {}, notReady = [], errs = [], mismatch = [], stale = [], checked = 0;

live.forEach(function (s) {
  E.flush();
  var r;
  try { r = E.evaluate(s.id); } catch (e) { errs.push(s.id + ' : ' + String(e).slice(0, 80)); return; }
  if (!r.ready) notReady.push(s.id);
  base[s.id] = !!r.hit;
});

live.forEach(function (s) {
  (s.thresholds || []).forEach(function (t) {
    if (!t.code) return;
    var want = num(t.value);
    if (want == null) return;
    checked++;
    E.flush();
    var got = E.thresholdOf(s.id, t.code, null);
    if (got !== want) {
      mismatch.push(s.id + ' · ' + t.code + ' : 카탈로그 ' + t.value + ' → 엔진 ' + got);
      return;
    }
    /* 카탈로그를 고치면 따라오는가 */
    var keep = t.value;
    t.value = reValue(keep, want + 7);
    E.flush();
    var after = E.thresholdOf(s.id, t.code, null);
    t.value = keep;
    E.flush();
    if (after !== want + 7) stale.push(s.id + ' · ' + t.code + ' : 카탈로그를 바꿨는데 ' + after + ' 그대로');
  });
});

var hits = Object.keys(base).filter(function (k) { return base[k]; });

console.log('지금 켤 수 있는 신호 ' + live.length + '건 · 참 ' + hits.length + '건 · 카탈로그 ' + cat.version);
console.log('  참 : ' + (hits.join(' · ') || '없음'));
if (notReady.length) console.log('  계산 못 함 : ' + notReady.join(' · '));

var bad = errs.concat(mismatch).concat(stale);
if (!bad.length) {
  console.log('기준값 ' + checked + '개 : 카탈로그 값과 일치 · 카탈로그를 고치면 판정선도 따라옵니다');
  process.exit(0);
}
console.log('어긋남 ' + bad.length + '건');
errs.forEach(function (t) { console.log('  [오류] ' + t); });
mismatch.forEach(function (t) { console.log('  [값 불일치] ' + t); });
stale.forEach(function (t) { console.log('  [안 따라옴] ' + t); });
process.exit(1);
