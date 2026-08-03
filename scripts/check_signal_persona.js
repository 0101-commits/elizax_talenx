/* 주체별 렌즈가 실제로 다른 것을 먼저 올리는지 센다.
   node scripts/check_signal_persona.js

   지키는 약속 세 개 —
     ① HR과 경영진은 같은 38건을 받지만 **먼저 보는 5건이 다르다** (겹침 2건 이하)
     ② 경영진 상위 5건은 전부 조직 사이 정렬 계열(T4 연결 불일치 · 조직 비교 낱말)
     ③ HR 상위 5건은 전부 평가·피드백 단계의 운영·공정성 계열
        (기준 이탈 T3 · 작성 공백 T2 · 제출 기한 T1 — 제출률 미달도 HR 운영 경보다)
   실패하면 exit 1. */
'use strict';
var path = require('path');
var JS = path.join(__dirname, '..', 'js');
global.window = {};
require(path.join(JS, 'ez_signals.js'));
require(path.join(JS, 'ez_signal_persona.js'));

var CAT = global.window.EZSignalCatalog;
var P = global.window.EZPersona;
var fail = 0;
function byId(id) { return CAT.signals.filter(function (x) { return x.id === id; })[0]; }

function forRole(rk) {
  return CAT.signals.filter(function (s) { return s.roles.indexOf(rk) >= 0; })
    .slice().sort(function (a, b) { return P.compare(a, b, rk); });
}
function top(rk, n) { return forRole(rk).slice(0, n).map(function (s) { return s.id; }); }

['member', 'leader', 'hr', 'exec'].forEach(function (rk) {
  var L = P.lens(rk), t = top(rk, 5);
  console.log('[' + rk + '] ' + L.title + ' — ' + L.hint);
  t.forEach(function (id, i) {
    var s = byId(id);
    console.log('   ' + (i + 1) + '. ' + id + '  (' + P.rank(s, rk) + '점) ' + s.notice.slice(0, 44));
  });
});

/* ① HR ≠ 경영진 */
var th = top('hr', 5), te = top('exec', 5);
var overlap = th.filter(function (id) { return te.indexOf(id) >= 0; });
if (overlap.length > 2) {
  console.log('X HR·경영진 상위 5건이 ' + overlap.length + '건 겹침: ' + overlap.join(', ')); fail++;
} else {
  console.log('OK HR·경영진 상위 5건 갈림 (겹침 ' + overlap.length + '건)');
}

/* ② 경영진 = 조직 사이 정렬 */
var ORG = /정렬|미연결|상위 목표|전략|본부|조직|전사|하위|격차/;
var badE = te.filter(function (id) {
  var s = byId(id);
  return !(s.type === 'T4' || ORG.test(s.notice + s.principle));
});
if (badE.length) { console.log('X 경영진 상위에 정렬 계열 아닌 것: ' + badE.join(', ')); fail++; }
else console.log('OK 경영진 상위 5건 전부 목표 정렬 계열');

/* ③ HR = 평가·피드백 공정성 */
var badH = th.filter(function (id) {
  var s = byId(id);
  return !(/평가|피드백/.test(s.stage) && /T1|T2|T3/.test(s.type));
});
if (badH.length) { console.log('X HR 상위에 공정성 계열 아닌 것: ' + badH.join(', ')); fail++; }
else console.log('OK HR 상위 5건 전부 평가·피드백 운영·공정성 계열');

process.exit(fail ? 1 : 0);
