/* ez_signal_eval7.js — 신호 판정 함수 신설 (중간점검 잔여 22건)
   ------------------------------------------------------------------------
   대상 : 중간점검 단계에서 아직 EVAL 이 없던 신호 22건 중 21건.
          (남은 1건은 원천이 없어 못 붙였다 — 파일 맨 아래 「데이터 없음」 참고)
   계약 : js/ez_signal_engine.js 의 registerEval·helpers 로만 계산한다.
          이 파일 밖(index.html·엔진·데이터·다른 eval 파일)은 건드리지 않는다.
          ez_signal_eval3.js 가 이미 맡은 10건(구성원-01/06/09 · 팀장-01/02/06/10/11 ·
          HR경영진-01/06)은 여기서 다시 등록하지 않는다.

   체크인 원천을 가르는 규칙 (eval3 의 판단을 그대로 잇는다)
     · checkins 3357건에는 캐노니컬 360건(confidence 영문)과 나중에 붙은 주간
       체크인(confidence 한글)이 섞여 있다.
     · 「전사·조직·팀 집계」(참여율·보유율·공백·장애요인 분포)는 캐노니컬 360건
       하나로 센다. 두 벌을 합치면 모든 조직이 다 채워진 것처럼 보여 공백 신호가
       영원히 뜨지 않는다. 카탈로그 예시(147명/221명 · 253건/360건)도 이쪽이다.
     · 「내 기록의 흐름」(내 마지막 체크인·연속 회차)은 ctx.myCks 전량을 본다.
       그 사람이 실제로 쓴 기록을 골라 버릴 이유가 없다.

   진척 증감의 원천은 krProgress(2주 단위 week 1~13, delta)다. 여러 핵심결과를
   묶어 볼 때는 합이 아니라 「핵심결과 1건당 평균 증감」을 쓴다. 핵심결과 수가
   다른 조직끼리 합을 견주면 큰 조직이 항상 이기기 때문이다.
   ------------------------------------------------------------------------ */
(function () {
  'use strict';
  var E = window.EZSignalEngine;
  if (!E || !E.registerEval) return;          /* 엔진 없으면 조용히 아무 것도 안 한다 */
  var Hp = E.helpers || {};
  function arr(k) { return (Hp.arr ? Hp.arr(k) : []) || []; }
  var r0 = Hp.r0, r1 = Hp.r1, pn = Hp.pn, thv = Hp.thv, asof = Hp.asof,
      asofMs = Hp.asofMs, avg = Hp.avg, num = Hp.num, cut = Hp.cut, co = Hp.co;

  var NONE = { hit: false, facts: {}, ev: {}, th: {} };

  /* ================= 공용 도구 ================= */
  function dnum(s) { if (!s) return null; var t = Date.parse(String(s).slice(0, 10) + 'T00:00:00Z'); return isNaN(t) ? null : t; }
  function gapDays(s) { var t = dnum(s); return t == null ? null : Math.round((asofMs() - t) / 86400000); }
  function dateOnly(s) { return s ? String(s).slice(0, 10) : null; }
  function fmtDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    return m ? (m[1] + '년 ' + (+m[2]) + '월 ' + (+m[3]) + '일') : String(s || '');
  }
  function fmtMd(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    return m ? ((+m[2]) + '월 ' + (+m[3]) + '일') : String(s || '');
  }
  function fmtMonthFull(key) { var p = String(key).split('-'); return p[0] + '년 ' + (+p[1]) + '월'; }
  function monthKeyShift(key, d) {
    var y = +String(key).slice(0, 4), m = +String(key).slice(5, 7) + d;
    while (m <= 0) { m += 12; y--; }
    while (m > 12) { m -= 12; y++; }
    return y + '-' + (m < 10 ? '0' + m : m);
  }
  function byDateAsc(a, b) { return a.checkin_date < b.checkin_date ? -1 : (a.checkin_date > b.checkin_date ? 1 : 0); }
  function signed(v) { return (v > 0 ? '+' : '') + pn(v); }
  /* 카탈로그 문장의 조사는 예시 낱말(「법무 검토 대기」·「테스트 환경 구축 지연」)에 맞춰
     박혀 있다. 실데이터 낱말로 갈아끼우면 받침이 달라져 「인력 부족가」가 된다 — 받침을
     보고 조사를 함께 바꾼다. */
  function hasJong(w) {
    w = String(w == null ? '' : w);
    var c = w.charCodeAt(w.length - 1);
    if (isNaN(c) || c < 0xAC00 || c > 0xD7A3) return true;   /* 숫자·영문으로 끝나면 받침 있는 쪽으로 둔다 */
    return (c - 0xAC00) % 28 !== 0;
  }
  function josa(w, withJong, noJong) { return hasJong(w) ? withJong : noJong; }

  function empById(id) { var l = arr('employees'), i; for (i = 0; i < l.length; i++) if (l[i].emp_id === id) return l[i]; return null; }
  function empName(id) { var e = empById(id); return e ? e.name : id; }
  function orgById(id) { var l = arr('orgs'), i; for (i = 0; i < l.length; i++) if (l[i].org_id === id) return l[i]; return null; }
  function orgName(id) { var o = orgById(id); return o ? o.name : id; }
  function objById(id) { var l = arr('objectives'), i; for (i = 0; i < l.length; i++) if (l[i].objective_id === id) return l[i]; return null; }
  function krById(id) { var l = arr('keyResults'), i; for (i = 0; i < l.length; i++) if (l[i].kr_id === id) return l[i]; return null; }
  function krsOfObj(oid) { return arr('keyResults').filter(function (k) { return k.objective_id === oid; }); }
  function directReports(id) { return arr('employees').filter(function (e) { return e.manager_id === id; }); }

  /* 조직 하위 트리(자기 자신 포함) — 엔진 내부 subtreeIds 는 밖에서 못 쓴다 */
  function childrenOf(pid) { return arr('orgs').filter(function (o) { return o.parent_id === pid; }); }
  function subtree(rootId) {
    var out = {}, q = [rootId];
    while (q.length) {
      var id = q.shift();
      if (!id || out[id]) continue;
      out[id] = 1;
      childrenOf(id).forEach(function (c) { q.push(c.org_id); });
    }
    return out;
  }
  function empsInOrgSet(set) { return arr('employees').filter(function (e) { return set[e.org_id]; }); }
  function objsInOrgSet(set) { return arr('objectives').filter(function (o) { return set[o.org_id]; }); }
  function krsInOrgSet(set) {
    var out = [];
    objsInOrgSet(set).forEach(function (o) { krsOfObj(o.objective_id).forEach(function (k) { out.push(k); }); });
    return out;
  }
  function idSet(list, key) { var m = {}; list.forEach(function (x) { m[x[key]] = 1; }); return m; }

  /* 캐노니컬 체크인 = confidence 가 영문인 360건 (위 머리말의 규칙) */
  function canon() {
    return arr('checkins').filter(function (c) {
      return c.confidence === 'low' || c.confidence === 'medium' || c.confidence === 'high';
    });
  }
  function confKind(c) {
    var v = c.confidence;
    if (v === 'low' || v === '낮음') return 'low';
    if (v === 'medium' || v === '보통') return 'medium';
    if (v === 'high' || v === '높음') return 'high';
    return '';
  }
  /* 핵심결과별 마지막 체크인 날짜 */
  function lastByKr(list) {
    var m = {};
    list.forEach(function (c) { if (!m[c.kr_id] || c.checkin_date > m[c.kr_id]) m[c.kr_id] = c.checkin_date; });
    return m;
  }
  /* 장애요인 라벨별 건수 */
  function blockerCount(list) {
    var m = {};
    list.forEach(function (c) { if (c.blocker) m[c.blocker] = (m[c.blocker] || 0) + 1; });
    return m;
  }
  function sortedLabels(map) {
    var out = [], k;
    for (k in map) if (Object.prototype.hasOwnProperty.call(map, k)) out.push({ label: k, n: map[k] });
    out.sort(function (a, b) { return b.n - a.n; });
    return out;
  }
  /* 「남의 협조를 기다리는」 장애요인 — 카탈로그 계산식(내부 의사결정·법무·인프라·고객사 승인)을 그대로 옮겼다 */
  var WAIT_BLOCKERS = ['내부 의사결정 대기 중', '법무 검토 대기', '인프라 이슈 해결 대기', '고객사 내부 승인 지연'];
  function isWait(b) { return WAIT_BLOCKERS.indexOf(b) >= 0; }

  /* 목표 기간 창 — objectives.period("FY2026-2Q") 실파싱. 엔진 내부 것과 같은 규칙 */
  function periodWindow(period) {
    var m = /FY(\d{4})[-\s]?([1-4])Q/i.exec(String(period || ''));
    if (!m) return null;
    var y = +m[1], q = +m[2];
    return {
      start: Date.UTC(y, (q - 1) * 3, 1), end: Date.UTC(y, q * 3, 0),
      endDate: new Date(Date.UTC(y, q * 3, 0)).toISOString().slice(0, 10),
      label: y + '년 ' + q + '분기(' + ((q - 1) * 3 + 1) + '~' + (q * 3) + '월)'
    };
  }
  function elapsedPct(period) {
    var w = periodWindow(period);
    if (!w || w.end <= w.start) return null;
    return Math.max(0, Math.min(100, r0((asofMs() - w.start) / (w.end - w.start) * 100)));
  }
  function periodOf(kind) {
    var found = null;
    arr('periods').forEach(function (p) { if (!found && p.kind === kind && p.status !== 'closed') found = p; });
    if (!found) arr('periods').forEach(function (p) { if (!found && p.kind === kind) found = p; });
    return found;
  }

  /* krProgress 주차 — 최근 N주 구간의 「핵심결과 1건당 평균 증감」 */
  function maxWeek() {
    var w = 0;
    arr('krProgress').forEach(function (p) { if ((p.week || 0) > w) w = p.week || 0; });
    return w;
  }
  function deltaPerKr(krIds, wFrom, wTo) {
    var n = 0, sum = 0, seen = {};
    arr('krProgress').forEach(function (p) {
      if (!krIds[p.kr_id] || p.week < wFrom || p.week > wTo) return;
      sum += num(p.delta);
      seen[p.kr_id] = 1;
    });
    for (var k in seen) if (Object.prototype.hasOwnProperty.call(seen, k)) n++;
    return n ? r1(sum / n) : 0;
  }
  /* 조직 목표에 가장 많이 붙은 전략 테마의 첫 지표 — 근거 마지막 줄에 쓴다 */
  function themeKpi(objs) {
    var cnt = {}, best = null, k;
    objs.forEach(function (o) { if (o.strategy_theme_id) cnt[o.strategy_theme_id] = (cnt[o.strategy_theme_id] || 0) + 1; });
    for (k in cnt) if (Object.prototype.hasOwnProperty.call(cnt, k)) { if (!best || cnt[k] > cnt[best]) best = k; }
    if (!best) return null;
    var t = arr('strategyThemes').filter(function (x) { return x.theme_id === best; })[0];
    if (!t || !t.kpis || !t.kpis.length) return null;
    return { id: best, name: t.name, kpi: t.kpis[0] };
  }

  /* ==================================================================
     구성원
  ================================================================== */

  /* --- 중간점검-구성원-02 : 기간 경과율 대비 진척 미달 --------------------- */
  E.registerEval('중간점검-구성원-02', function (ctx) {
    var SID = '중간점검-구성원-02';
    var krs = ctx.myKrs;
    if (!krs.length || !ctx.myObjs.length) return NONE;
    var per = ctx.myObjs[0].period;
    var el = elapsedPct(per), w = periodWindow(per);
    if (el == null) return NONE;
    /* 가장 크게 뒤처진 핵심결과 한 건을 대표로 보여 준다 */
    var rows = krs.map(function (k) { return { kr: k, p: r1(k.progress || 0), gap: r1(el - (k.progress || 0)) }; });
    rows.sort(function (a, b) { return b.gap - a.gap; });
    var top = rows[0];
    /* 그 핵심결과의 직전 체크인 증감 */
    var cks = ctx.myCks.filter(function (c) { return c.kr_id === top.kr.kr_id; }).slice().sort(byDateAsc);
    var lastDelta = cks.length ? r1(num(cks[cks.length - 1].progress_delta)) : null;
    var THgap = thv(SID, 'TH-진척계획 대비 격차-이탈', 15);
    var facts = {
      krName: top.kr.name, progress: top.p, elapsed: el, gap: top.gap,
      periodLabel: w ? w.label : per, lastDelta: lastDelta, behindN: rows.filter(function (r) { return r.gap >= THgap; }).length
    };
    var hit = el >= thv(SID, 'TH-기간경과-하한', 60) && top.gap >= THgap;
    var spec = {};
    spec[0] = { m: [['평균 응답 시간', top.kr.name], ['21.7%', pn(top.p) + '%']], emph: pn(top.p) + '%', src: top.kr.kr_id };
    /* 기간이 아직 안 끝났으면 「이미 끝나」가 사실과 어긋난다 — 어절째로 바꾼다 */
    spec[1] = (el >= 100)
      ? { m: [['2026년 2분기(4~6월)', facts.periodLabel]], emph: '100%', src: ctx.myObjs[0].objective_id }
      : { m: [['2026년 2분기(4~6월)는 이미 끝나 기간 경과율이 100%예요',
               facts.periodLabel + '의 기간 경과율은 ' + el + '%예요']], emph: el + '%', src: ctx.myObjs[0].objective_id };
    spec[2] = { m: [['78%p', pn(top.gap) + '%p'], ['15%p', THgap + '%p'],
                    ['를 넘어요', top.gap >= THgap ? '를 넘어요' : '를 넘지 않아요']],
                emph: pn(top.gap) + '%p', src: top.kr.kr_id };
    if (lastDelta != null) spec[3] = { m: [['+8%p', signed(lastDelta) + '%p']], emph: signed(lastDelta) + '%p',
                src: cks[cks.length - 1].checkin_id };
    return {
      hit: hit, facts: facts,
      notice: [['100%', el + '%'], ['21.7%', pn(top.p) + '%'], ['78%p', pn(top.gap) + '%p']],
      ev: spec,
      th: { 'TH-기간경과-하한': el + '%', 'TH-진척계획 대비 격차-이탈': pn(top.gap) + '%p' }
    };
  });

  /* --- 중간점검-구성원-03 : 진척 증감 0 연속 + 실적값 장기 고정 ------------ */
  E.registerEval('중간점검-구성원-03', function (ctx) {
    var SID = '중간점검-구성원-03';
    var cks = ctx.myCks.slice().sort(byDateAsc);
    if (!cks.length) return NONE;
    var i, streak = 0;
    for (i = cks.length - 1; i >= 0; i--) { if (num(cks[i].progress_delta) === 0) streak++; else break; }
    var target = cks[cks.length - 1];
    var kr = krById(target.kr_id);
    /* 실적값이 마지막으로 바뀐 날 = keyResults.updated_at (실필드) */
    var fixed = kr ? gapDays(dateOnly(kr.updated_at)) : null;
    /* 정체 직전 3회의 평균 증감 — 「원래는 이만큼 움직였다」는 비교선 */
    var before = cks.slice(Math.max(0, cks.length - streak - 3), cks.length - streak);
    var beforeAvg = before.length ? r1(avg(before.map(function (c) { return num(c.progress_delta); }))) : null;
    var stalled = cks.slice(cks.length - Math.max(streak, 1));
    var blk = null;
    stalled.forEach(function (c) { if (!blk && c.blocker) blk = c.blocker; });
    var blkAll = blk && stalled.every(function (c) { return c.blocker === blk; });
    var CK = canon(), bc = blockerCount(CK), withBlk = CK.filter(function (c) { return !!c.blocker; }).length;
    var firstDate = stalled.length ? stalled[0].checkin_date : target.checkin_date;
    var THfix = thv(SID, 'TH-현재값고정-일수', 30);
    var facts = {
      streak: streak, krName: kr ? kr.name : target.kr_id, fixedDays: fixed,
      beforeAvg: beforeAvg, blocker: blkAll ? blk : null, progress: kr ? r1(kr.progress || 0) : null,
      blkTotal: withBlk, ckTotal: CK.length, blkLabelN: blk ? (bc[blk] || 0) : 0
    };
    var hit = streak >= thv(SID, 'TH-진척정체-연속', 2) && fixed != null && fixed >= THfix;
    var spec = {};
    spec[0] = (streak > 0)
      ? { m: [['2회', streak + '회']], emph: streak + '회',
          src: stalled.map(function (c) { return c.checkin_id; }).join(' / ') || '해당 없음' }
      : { m: [['최근 체크인 2회의 진척 증감이 모두 0%p예요',
               '최근 체크인의 진척 증감은 ' + signed(num(target.progress_delta)) + '%p로 멈춰 있지 않아요']],
          emph: signed(num(target.progress_delta)) + '%p', src: target.checkin_id };
    if (kr) spec[1] = { m: [['신규 기능 기획서 사용자 검증 통과율', kr.name], ['32일째', fixed + '일째']],
                emph: fixed + '일째', src: kr.kr_id + ' / updated_at ' + dateOnly(kr.updated_at) };
    if (beforeAvg != null) spec[2] = { m: [['3회', before.length + '회'], ['+6%p', signed(beforeAvg) + '%p']],
                emph: signed(beforeAvg) + '%p', src: before.map(function (c) { return c.checkin_id; }).join(' / ') };
    if (kr) spec[3] = { m: [['4월', (+String(firstDate).slice(5, 7)) + '월'], ['21.7%', pn(kr.progress || 0) + '%']],
                emph: '움직이지 않았어요', src: kr.kr_id };
    if (blkAll) spec[4] = { m: [['내부 의사결정 대기 중', blk]], emph: blk,
                src: stalled.map(function (c) { return c.checkin_id; }).join(' / ') };
    /* 정체 구간에 공통 장애요인이 없으면 「이 라벨」이 가리킬 것이 없다 — 전사 최다 라벨로 바꾼다 */
    var topLabel = blk || (sortedLabels(bc)[0] ? sortedLabels(bc)[0].label : null);
    var topLabelN = topLabel ? (bc[topLabel] || 0) : 0;
    spec[5] = { m: [['360건', CK.length + '건'], ['253건(70.3%)', withBlk + '건(' + pn(CK.length ? withBlk / CK.length * 100 : 0) + '%)'],
                    ['이 라벨은', blk ? '이 라벨은' : ('가장 많은 「' + (topLabel || '없음') + '」은')],
                    ['33건', topLabelN + '건']],
                emph: topLabelN + '건', src: 'checkins(캐노니컬) ' + CK.length + '건 / blocker 집계' };
    return {
      hit: hit, facts: facts,
      notice: [['2회', streak + '회'], ['32일째', (fixed == null ? '?' : fixed) + '일째']],
      ev: spec,
      th: { 'TH-진척정체-연속': streak + '회', 'TH-현재값고정-일수': (fixed == null ? '?' : fixed) + '일' }
    };
  });

  /* --- 중간점검-구성원-04 : 상위 목표가 바뀐 뒤 내 목표 그대로 ------------- */
  E.registerEval('중간점검-구성원-04', function (ctx) {
    var SID = '중간점검-구성원-04';
    var FIELD_KR = { progress: '진척', title: '제목', parent_objective_id: '상위 목표 연결' };
    var best = null;
    ctx.myObjs.forEach(function (o) {
      if (!o.parent_objective_id) return;
      var hist = arr('objectiveHistory').filter(function (h) { return h.objective_id === o.parent_objective_id; })
        .slice().sort(function (a, b) { return a.at < b.at ? -1 : 1; });
      if (!hist.length) return;
      var last = hist[hist.length - 1];
      var changed = dateOnly(last.at), mine = dateOnly(o.updated_at);
      /* 상위가 바뀐 뒤로 내 목표에 손댄 기록이 없을 때만 대상 */
      if (mine && mine >= changed) return;
      var el = gapDays(changed);
      if (!best || el > best.elapsed) best = { obj: o, parent: objById(o.parent_objective_id), hist: last, elapsed: el, changed: changed, mine: mine };
    });
    if (!best) return NONE;
    var linked = arr('objectives').filter(function (o) {
      return o.parent_objective_id === best.obj.parent_objective_id && o.owner_emp_id === ctx.emp.emp_id;
    }).length;
    var krN = krsOfObj(best.obj.objective_id).length;
    var pTitle = best.parent ? best.parent.title : best.obj.parent_objective_id;
    var fkr = FIELD_KR[best.hist.field] || best.hist.field;
    var TH = thv(SID, 'TH-상위변경-반영기한', 7);
    var facts = {
      parentTitle: pTitle, parentField: fkr, changedAt: best.changed, elapsed: best.elapsed,
      myObj: best.obj.objective_id, myUpdated: best.mine, linkedN: linked, krN: krN
    };
    var hit = best.elapsed != null && best.elapsed >= TH;
    var spec = {};
    spec[0] = { m: [['FY2026 2Q hunel Enterprise 매출 150억 달성 및 대형 고객 확대', pTitle],
                    ['의 목표값이 올랐어요', '의 ' + fkr + '이 바뀌었어요']],
                emph: fkr, src: best.obj.parent_objective_id + ' / ' + best.hist.hist_id };
    spec[1] = { m: [['1건', linked + '건']], emph: linked + '건', src: best.obj.objective_id };
    spec[2] = { m: [['2026년 7월 20일', fmtDate(best.changed)], ['7일', TH + '일']],
                emph: best.elapsed + '일째', src: best.hist.hist_id + ' / 내 목표 최종 수정 ' + (best.mine || '기록 없음') };
    spec[3] = { m: [['4건', krN + '건']], emph: krN + '건', src: best.obj.objective_id + ' / KR ' + krN + '건' };
    return {
      hit: hit, facts: facts,
      notice: [['상위 목표값이 150억으로 오른 뒤', '상위 목표 「' + cut(pTitle, 16) + '」가 바뀐 뒤']],
      ev: spec,
      th: { 'TH-상위변경-반영기한': best.elapsed + '일' }
    };
  });

  /* --- 중간점검-구성원-05 : 같은 목표에 동료 체크인만 쌓임 ----------------- */
  E.registerEval('중간점검-구성원-05', function (ctx) {
    var SID = '중간점검-구성원-05';
    var my = ctx.emp.emp_id;
    if (!ctx.myCks.length) return NONE;
    var oids = {};
    ctx.myCks.forEach(function (c) { if (c.objective_id) oids[c.objective_id] = 1; });
    var best = null, oid;
    for (oid in oids) if (Object.prototype.hasOwnProperty.call(oids, oid)) {
      var mineOn = ctx.myCks.filter(function (c) { return c.objective_id === oid; }).slice().sort(byDateAsc);
      var myLast = mineOn[mineOn.length - 1].checkin_date;
      var after = arr('checkins').filter(function (c) {
        return c.objective_id === oid && c.emp_id !== my && c.checkin_date > myLast;
      });
      if (!best || after.length > best.after.length) best = { oid: oid, myLast: myLast, after: after };
    }
    if (!best) return NONE;
    var bc = sortedLabels(blockerCount(best.after));
    var top = bc[0] || null;
    var obj = objById(best.oid);
    var facts = {
      objId: best.oid, objTitle: obj ? obj.title : best.oid, peerN: best.after.length,
      myLast: best.myLast, myGap: gapDays(best.myLast), topBlocker: top ? top.label : '', topBlockerN: top ? top.n : 0
    };
    var hit = best.after.length >= thv(SID, 'TH-동료체크인-누적', 3);
    var spec = {};
    spec[0] = { m: [['3건', best.after.length + '건']], emph: best.after.length + '건',
                src: best.oid + ' / checkins.objective_id' };
    spec[1] = { m: [['3건', best.after.length + '건'], ['0건', '0건']], emph: best.after.length + '건',
                src: best.oid + ' / 내 마지막 기록 ' + best.myLast + ' 이후' };
    if (top) spec[2] = { m: [['3건', best.after.length + '건'], ['2건', top.n + '건'],
                             ['테스트 환경 구축 지연', top.label], ['」이 함께', '」' + josa(top.label, '이', '가') + ' 함께']],
                emph: top.n + '건', src: best.oid + ' / checkins.blocker' };
    spec[3] = { m: [['2026년 6월 27일', fmtDate(best.myLast)]], emph: fmtDate(best.myLast),
                src: best.oid + ' / 내 마지막 체크인' };
    return {
      hit: hit, facts: facts,
      notice: [['3건', best.after.length + '건'], ['6월 27일', fmtMd(best.myLast)]],
      ev: spec,
      th: { 'TH-동료체크인-누적': best.after.length + '건' }
    };
  });

  /* --- 중간점검-구성원-10 : 같은 장애요인 반복 + 요청 기록 없음 ------------ */
  E.registerEval('중간점검-구성원-10', function (ctx) {
    var SID = '중간점검-구성원-10';
    var cks = ctx.myCks.slice().sort(byDateAsc);
    if (!cks.length) return NONE;
    /* 「연속」이 아니라 「같은 라벨이 몇 번 적혔는가」로 센다 — 체크인은 핵심결과별로
       흩어져 쓰이므로 시간순 연속을 요구하면 사실상 잡히지 않는다 */
    var mineBc = sortedLabels(blockerCount(cks));
    if (!mineBc.length) return NONE;
    var top = mineBc[0];
    var rows = cks.filter(function (c) { return c.blocker === top.label; });
    var kr = krById(rows[rows.length - 1].kr_id);
    var wt = kr ? num(kr.weight) : 0;
    var sibs = kr ? krsOfObj(kr.objective_id) : [];
    var isMaxW = sibs.every(function (k) { return num(k.weight) <= wt; });
    var CK = canon(), bc = blockerCount(CK);
    /* 요청 기록 = requestLog 중 장애요인(ref_kind='blocker')을 걸고 내가 낸 것 */
    var reqs = arr('requestLog').filter(function (r) {
      return r.ref_kind === 'blocker' && (r.from_emp === ctx.emp.emp_id || r.to_emp === ctx.emp.emp_id);
    });
    var myOrg = ctx.emp.org_id;
    var orgIds = idSet(arr('employees').filter(function (e) { return e.org_id === myOrg; }), 'emp_id');
    var sameOrg = {};
    arr('checkins').forEach(function (c) {
      if (c.blocker === top.label && orgIds[c.emp_id] && c.emp_id !== ctx.emp.emp_id) sameOrg[c.emp_id] = 1;
    });
    var sameOrgN = Object.keys(sameOrg).length;
    var facts = {
      blocker: top.label, repeatN: top.n, weight: wt, isMaxWeight: isMaxW,
      coLabelN: bc[top.label] || 0, ckTotal: CK.length, reqN: reqs.length, sameOrgN: sameOrgN
    };
    var hit = top.n >= thv(SID, 'TH-장애요인반복-구성원', 3) && reqs.length <= thv(SID, 'TH-장애요인요청-없음', 0);
    var spec = {};
    spec[0] = { m: [['법무 검토 대기', top.label], ['」가 체크인', '」' + josa(top.label, '이', '가') + ' 체크인'], ['3회', top.n + '회']],
                emph: top.n + '회', src: rows.map(function (c) { return c.checkin_id; }).join(' / ') };
    spec[1] = { m: [['360건', CK.length + '건'], ['27건', facts.coLabelN + '건']], emph: facts.coLabelN + '건',
                src: 'checkins(캐노니컬) ' + CK.length + '건 / blocker 집계' };
    if (kr) spec[2] = { m: [['40%', pn(wt) + '%'], ['로 목표 안에서 가장 커요', isMaxW ? '로 목표 안에서 가장 커요' : '예요']],
                emph: pn(wt) + '%', src: kr.kr_id + ' / weight' };
    spec[3] = { m: [['2명', sameOrgN + '명']], emph: sameOrgN + '명', src: myOrg + ' / checkins.blocker' };
    return {
      hit: hit, facts: facts,
      notice: [['법무 검토 대기', top.label], ['」가 체크인', '」' + josa(top.label, '이', '가') + ' 체크인'], ['3회', top.n + '회']],
      ev: spec,
      th: { 'TH-장애요인반복-구성원': top.n + '회', 'TH-장애요인요청-없음': reqs.length + '건' }
    };
  });

  /* ==================================================================
     팀장 — 대상은 직속 팀원(manager_id)이다. eval3 의 팀장 신호와 같은 기준.
     팀원은 목표를 직접 들고 있지 않고 팀 목표의 핵심결과에 체크인한다.
     그래서 「그 팀원의 핵심결과」는 그 사람이 체크인한 핵심결과로 잡는다.
  ================================================================== */

  function krIdsCheckedBy(empId) {
    var m = {};
    arr('checkins').forEach(function (c) { if (c.emp_id === empId && c.kr_id) m[c.kr_id] = 1; });
    return m;
  }
  /* 팀 목표 = 팀원이 소유한 목표 + 팀장 자신이 소유한 팀 조직 목표 */
  function teamObjs(leader, reports) {
    var ids = idSet(reports, 'emp_id');
    return arr('objectives').filter(function (o) {
      return ids[o.owner_emp_id] || (o.owner_emp_id === leader.emp_id && o.org_id === leader.org_id);
    });
  }
  function teamKrs(leader, reports) {
    var out = [];
    teamObjs(leader, reports).forEach(function (o) { krsOfObj(o.objective_id).forEach(function (k) { out.push(k); }); });
    return out;
  }
  function lastMeetingWith(leaderId, memberId) {
    var rows = arr('meetingStore').filter(function (m) { return m.leader_emp_id === leaderId && m.member_emp_id === memberId; })
      .slice().sort(function (a, b) { return String(a.at) < String(b.at) ? -1 : 1; });
    return rows.length ? rows[rows.length - 1] : null;
  }

  /* --- 중간점검-팀장-03 : 팀원 확신도 낮음 연속 + 진척 정체 ---------------- */
  E.registerEval('중간점검-팀장-03', function (ctx) {
    var SID = '중간점검-팀장-03';
    var reports = directReports(ctx.emp.emp_id);
    if (!reports.length) return NONE;
    var rows = reports.map(function (e) {
      var cks = arr('checkins').filter(function (c) { return c.emp_id === e.emp_id; }).slice().sort(byDateAsc);
      var i, st = 0;
      for (i = cks.length - 1; i >= 0; i--) { if (confKind(cks[i]) === 'low') st++; else break; }
      var tail = cks.slice(Math.max(0, cks.length - Math.max(st, 1)));
      var d = tail.length ? r1(avg(tail.map(function (c) { return num(c.progress_delta); }))) : 0;
      return { emp: e, cks: cks, streak: st, delta: d, tail: tail };
    }).filter(function (r) { return r.cks.length; });
    if (!rows.length) return NONE;
    rows.sort(function (a, b) { return b.streak - a.streak || a.delta - b.delta; });
    var w = rows[0];
    var teamCks = [];
    rows.forEach(function (r) { r.cks.forEach(function (c) { teamCks.push(c); }); });
    var teamAvg = teamCks.length ? r1(avg(teamCks.map(function (c) { return num(c.progress_delta); }))) : 0;
    var need = thv(SID, 'TH-확신도낮음-연속', 2);
    var lowTeamN = rows.filter(function (r) { return r.streak >= need; }).length;
    var blk = null;
    w.tail.forEach(function (c) { if (!blk && c.blocker) blk = c.blocker; });
    /* 멈춘 항목의 난이도 근거 — keyResults.difficulty / difficulty_basis */
    var stalledKrs = [];
    w.tail.forEach(function (c) { var k = krById(c.kr_id); if (k && stalledKrs.indexOf(k) < 0) stalledKrs.push(k); });
    var k0 = stalledKrs[0] || null;
    var diff = r1(teamAvg - w.delta);
    var facts = {
      memberName: w.emp.name, streak: w.streak, delta: w.delta, teamAvg: teamAvg, diff: diff,
      blocker: blk, lowTeamN: lowTeamN, teamN: reports.length,
      krDifficulty: k0 ? k0.difficulty : '', krBasis: (k0 && k0.difficulty_basis) ? k0.difficulty_basis.label : ''
    };
    var hit = w.streak >= need && w.delta <= thv(SID, 'TH-진척정체-없음', 0)
      && diff >= thv(SID, 'TH-팀평균편차-확신도', 9);
    var spec = {};
    var tailSrc = w.tail.map(function (c) { return c.checkin_id; }).join(', ') || '체크인 없음';
    spec[0] = (w.streak > 0)
      ? { m: [['{{팀원명}}', w.emp.name], ['2회', w.streak + '회']], emph: w.streak + '회', src: w.emp.emp_id + ' / ' + tailSrc }
      : { m: [['{{팀원명}}', w.emp.name],
              ['님의 최근 체크인 2회가 모두 확신도 낮음으로 적혔어요', '님의 최근 체크인에는 확신도 낮음이 이어지지 않았어요']],
          emph: '0회', src: w.emp.emp_id + ' / ' + tailSrc };
    if (blk) spec[1] = { m: [['두 체크인', w.tail.length + '건의 체크인'], ['내부 의사결정 대기 중', blk],
                             ['」이 장애요인으로', '」' + josa(blk, '이', '가') + ' 장애요인으로']],
                emph: '「' + blk + '」', src: tailSrc + ' / 막힌 지점' };
    spec[2] = { m: [['+9%p', signed(teamAvg) + '%p'], ['{{팀원명}}', w.emp.name], ['0%p', signed(w.delta) + '%p']],
                emph: signed(w.delta) + '%p', src: ctx.emp.org_id + ' / 팀 체크인 ' + teamCks.length + '건' };
    spec[3] = (lowTeamN >= 1)
      ? { m: [['{{팀원명}}', w.emp.name], ['한 사람', lowTeamN === 1 ? '한 사람' : lowTeamN + '명']],
          emph: lowTeamN === 1 ? '한 사람' : lowTeamN + '명', src: ctx.emp.org_id + ' / 팀원 ' + reports.length + '명' }
      : { m: [['{{팀원명}}님 한 사람이에요', '아직 없어요']], emph: '없어요',
          src: ctx.emp.org_id + ' / 팀원 ' + reports.length + '명' };
    if (w.streak >= 2) spec[4] = { m: [['두 회차', w.streak + '회차']], emph: w.streak + '회차', src: w.emp.emp_id + ' / 확신도 흐름' };
    if (k0) spec[5] = { m: [['2건', stalledKrs.length + '건'], ['S', k0.difficulty || '미지정'],
                            ['전년 실적 대비 +20% 상향', facts.krBasis || '근거 없음'],
                            ['」이에요', '」' + josa(facts.krBasis || '근거 없음', '이에요', '예요')]],
                emph: '난이도 ' + (k0.difficulty || '미지정'),
                src: stalledKrs.map(function (k) { return k.kr_id; }).join(', ') + ' / 난이도 근거' };
    return {
      hit: hit, facts: facts,
      notice: [['{{팀원명}}', w.emp.name], ['2회', w.streak + '회'], ['0%p', signed(w.delta) + '%p']],
      ev: spec,
      th: { 'TH-확신도낮음-연속': w.streak + '회', 'TH-진척정체-없음': signed(w.delta) + '%p',
            'TH-팀평균편차-확신도': pn(diff) + '%p' }
    };
  });

  /* --- 중간점검-팀장-04 : 팀원 평균 진척이 팀 평균과 벌어짐 ---------------- */
  E.registerEval('중간점검-팀장-04', function (ctx) {
    var SID = '중간점검-팀장-04';
    var reports = directReports(ctx.emp.emp_id);
    if (!reports.length) return NONE;
    var tKrs = teamKrs(ctx.emp, reports);
    if (!tKrs.length) return NONE;
    var teamAvg = r0(avg(tKrs.map(function (k) { return k.progress || 0; })));
    var rows = reports.map(function (e) {
      var ids = krIdsCheckedBy(e.emp_id);
      var mine = tKrs.filter(function (k) { return ids[k.kr_id]; });
      return { emp: e, krs: mine, avg: mine.length ? r0(avg(mine.map(function (k) { return k.progress || 0; }))) : null };
    }).filter(function (r) { return r.avg != null; });
    if (!rows.length) return NONE;
    rows.sort(function (a, b) { return a.avg - b.avg; });
    var w = rows[0];
    var diff = r0(teamAvg - w.avg);
    /* 「30%에 못 미치는 팀원」은 카탈로그 문장의 예시선이라 기준값 코드가 없다 — 파일 상수로 둔다 */
    var LOW_LINE = 30;
    var lowN = rows.filter(function (r) { return r.avg < LOW_LINE; }).length;
    var minN = thv(SID, 'TH-모집단-팀평균', 5);
    var facts = {
      memberName: w.emp.name, memberKrN: w.krs.length, memberAvg: w.avg,
      teamKrN: tKrs.length, teamAvg: teamAvg, diff: diff, lowN: lowN, reportN: reports.length, minN: minN
    };
    var hit = reports.length >= minN && diff >= thv(SID, 'TH-팀평균편차-진척', 20);
    var spec = {};
    spec[0] = { m: [['{{팀원명}}', w.emp.name], ['4건', w.krs.length + '건'], ['22%', w.avg + '%']], emph: w.avg + '%',
                src: w.emp.emp_id + ' / ' + w.krs.map(function (k) { return k.kr_id; }).join(', ') };
    spec[1] = { m: [['12건', tKrs.length + '건'], ['43%', teamAvg + '%'], ['21%p', Math.abs(diff) + '%p']],
                emph: Math.abs(diff) + '%p', src: ctx.emp.org_id + ' / 팀 핵심결과 ' + tKrs.length + '건' };
    spec[2] = (lowN >= 1)
      ? { m: [['30%', LOW_LINE + '%'], ['{{팀원명}}', w.emp.name], ['한 사람', lowN === 1 ? '한 사람' : lowN + '명']],
          emph: lowN === 1 ? '한 사람' : lowN + '명', src: ctx.emp.org_id + ' / 팀원 ' + reports.length + '명' }
      : { m: [['30%', LOW_LINE + '%'], ['{{팀원명}}님 한 사람이에요', '아직 없어요']], emph: '없어요',
          src: ctx.emp.org_id + ' / 팀원 ' + reports.length + '명' };
    return {
      hit: hit, facts: facts,
      /* 최저 팀원이 팀 평균보다 높게 나올 수도 있다 — 그때 「낮아요」는 사실이 아니다 */
      notice: [['{{팀원명}}', w.emp.name], ['22%', w.avg + '%'], ['43%', teamAvg + '%'],
               ['보다 낮아요', diff > 0 ? '보다 낮아요' : '보다 높아요']],
      ev: spec,
      th: { 'TH-팀평균편차-진척': diff + '%p', 'TH-모집단-팀평균': reports.length + '명' }
    };
  });

  /* --- 중간점검-팀장-05 : 장애요인 반복 + 1on1 공백 ------------------------ */
  E.registerEval('중간점검-팀장-05', function (ctx) {
    var SID = '중간점검-팀장-05';
    var reports = directReports(ctx.emp.emp_id);
    if (!reports.length) return NONE;
    var WIN = thv(SID, 'TH-장애요인반복-누적', 3);   /* 「3회 중 2회」에서 기계가 읽는 건 앞 숫자뿐 */
    var NEED = 2;                                     /* 뒤 숫자는 이 파일 상수로 둔다 */
    var rows = reports.map(function (e) {
      var cks = arr('checkins').filter(function (c) { return c.emp_id === e.emp_id; }).slice().sort(byDateAsc);
      var recent = cks.slice(Math.max(0, cks.length - WIN));
      var blks = recent.filter(function (c) { return !!c.blocker; });
      var mt = lastMeetingWith(ctx.emp.emp_id, e.emp_id);
      return { emp: e, recent: recent, blks: blks, mt: mt, gap: mt ? gapDays(dateOnly(mt.at)) : null };
    }).filter(function (r) { return r.recent.length; });
    if (!rows.length) return NONE;
    rows.sort(function (a, b) { return (b.blks.length - a.blks.length) || ((b.gap || 0) - (a.gap || 0)); });
    var w = rows[0];
    var b1 = w.blks[0] ? w.blks[0].blocker : '', b2 = w.blks[1] ? w.blks[1].blocker : b1;
    var CK = canon();
    var coPct = CK.length ? r1(CK.filter(function (c) { return !!c.blocker; }).length / CK.length * 100) : 0;
    var peerN = 0;
    if (b1) {
      var orgIds = idSet(arr('employees').filter(function (e) { return e.org_id === ctx.emp.org_id; }), 'emp_id');
      peerN = arr('checkins').filter(function (c) {
        return c.blocker === b1 && orgIds[c.emp_id] && c.emp_id !== w.emp.emp_id;
      }).length;
    }
    var open = null;
    if (w.mt) (w.mt.agreements || []).forEach(function (a) { if (!open && a.status !== 'done') open = a; });
    var THgap = thv(SID, 'TH-1on1공백-경고', 21);
    var facts = {
      memberName: w.emp.name, recentN: w.recent.length, blkN: w.blks.length, b1: b1, b2: b2,
      coPct: coPct, peerN: peerN, lastMeeting: w.mt ? dateOnly(w.mt.at) : null, gap: w.gap,
      openAgreement: open ? open.text : ''
    };
    var hit = w.blks.length >= NEED && w.gap != null && w.gap >= THgap;
    var spec = {};
    spec[0] = { m: [['{{팀원명}}', w.emp.name], ['3회', w.recent.length + '회'], ['2회', w.blks.length + '회']],
                emph: w.blks.length + '회', src: w.emp.emp_id + ' / ' + w.recent.map(function (c) { return c.checkin_id; }).join(', ') };
    if (b1) spec[1] = { m: [['외부 API 연동 이슈로 일정 지연', b1], ['내부 의사결정 대기 중', b2]], emph: '「' + b2 + '」',
                src: w.blks.map(function (c) { return c.checkin_id; }).join(', ') + ' / 막힌 지점' };
    spec[2] = { m: [['70.3%', pn(coPct) + '%'], ['세 번', w.recent.length + '번'], ['두 번', w.blks.length + '번']],
                emph: pn(coPct) + '%', src: '전사 체크인(캐노니컬) ' + CK.length + '건 집계' };
    spec[3] = { m: [['1건', peerN + '건']], emph: peerN + '건', src: ctx.emp.org_id + ' / 같은 장애요인 ' + peerN + '건' };
    if (w.mt) spec[4] = { m: [['{{팀원명}}', w.emp.name], ['2026년 6월 25일', fmtDate(dateOnly(w.mt.at))], ['21일', w.gap + '일']],
                emph: w.gap + '일', src: w.emp.emp_id + ' / ' + w.mt.meeting_id };
    if (open) spec[5] = { m: [['연동 담당자 지정', open.text], ['」은 아직', '」' + josa(open.text, '은', '는') + ' 아직']],
                emph: '「' + cut(open.text, 20) + '」',
                src: w.mt.meeting_id + ' / 합의 항목 ' + open.status };
    return {
      hit: hit, facts: facts,
      notice: [['3회', w.recent.length + '회'], ['2회', w.blks.length + '회'], ['21일째', (w.gap == null ? '?' : w.gap) + '일째']],
      ev: spec,
      th: { 'TH-장애요인반복-누적': w.recent.length + '회 중 ' + w.blks.length + '회',
            'TH-1on1공백-경고': (w.gap == null ? '?' : w.gap) + '일' }
    };
  });

  /* --- 중간점검-팀장-07 : 목표 진행률과 핵심결과 가중평균 괴리 ------------- */
  E.registerEval('중간점검-팀장-07', function (ctx) {
    var SID = '중간점검-팀장-07';
    var reports = directReports(ctx.emp.emp_id);
    var objs = teamObjs(ctx.emp, reports);
    if (!objs.length) return NONE;
    var best = null;
    objs.forEach(function (o) {
      var ks = krsOfObj(o.objective_id), ws = 0, sum = 0;
      ks.forEach(function (k) { var w = num(k.weight); ws += w; sum += w * (k.progress || 0); });
      if (!ws) return;
      var wavg = r1(sum / ws), shown = r1(o.progress || 0), d = r1(Math.abs(shown - wavg));
      if (!best || d > best.diff) best = { obj: o, krs: ks, wavg: wavg, shown: shown, diff: d };
    });
    if (!best) return NONE;
    /* 가장 크게 벌어지는 항목 = 가중평균을 가장 많이 끌어내린 핵심결과 */
    var pull = best.krs.slice().sort(function (a, b) {
      return (num(b.weight) * Math.abs(best.shown - (b.progress || 0))) - (num(a.weight) * Math.abs(best.shown - (a.progress || 0)));
    })[0];
    var TH = thv(SID, 'TH-진행률괴리-초과', 20);
    var facts = {
      ownerName: empName(best.obj.owner_emp_id), objTitle: best.obj.title,
      shown: best.shown, wavg: best.wavg, diff: best.diff, krN: best.krs.length,
      topKr: pull ? pull.name : '', topWeight: pull ? pn(num(pull.weight)) : ''
    };
    var hit = best.diff >= TH;
    var spec = {};
    spec[0] = { m: [['{{팀원명}}', facts.ownerName], ['{{목표명}}', best.obj.title], ['64.8%', pn(best.shown) + '%']],
                emph: pn(best.shown) + '%', src: best.obj.owner_emp_id + ' / ' + best.obj.objective_id };
    spec[1] = { m: [['4건', best.krs.length + '건'], ['35.0%', pn(best.wavg) + '%'], ['20%p', TH + '%p'],
                    ['보다 큰', best.diff >= TH ? '보다 큰' : '보다 작은'], ['29.8%p', pn(best.diff) + '%p']],
                emph: pn(best.diff) + '%p', src: best.obj.objective_id + ' / KR ' + best.krs.length + '건 가중평균' };
    if (pull) spec[2] = { m: [['40%', facts.topWeight + '%'], ['평균 응답 시간', pull.name]],
                emph: '가중치 ' + facts.topWeight + '%', src: pull.kr_id + ' / 가중치·진척' };
    return {
      hit: hit, facts: facts,
      notice: [['64.8%', pn(best.shown) + '%'], ['35.0%', pn(best.wavg) + '%']],
      ev: spec,
      th: { 'TH-진행률괴리-초과': pn(best.diff) + '%p' }
    };
  });

  /* --- 중간점검-팀장-08 : 체크인이 핵심결과 한 항목에만 몰림 --------------- */
  E.registerEval('중간점검-팀장-08', function (ctx) {
    var SID = '중간점검-팀장-08';
    var reports = directReports(ctx.emp.emp_id);
    if (!reports.length) return NONE;
    var best = null;
    reports.forEach(function (e) {
      var cks = arr('checkins').filter(function (c) { return c.emp_id === e.emp_id; });
      if (!cks.length) return;
      /* 대상 핵심결과 = 그 팀원이 체크인한 목표가 들고 있는 핵심결과 전량 */
      var oids = {};
      cks.forEach(function (c) { if (c.objective_id) oids[c.objective_id] = 1; });
      var pool = [];
      for (var oid in oids) if (Object.prototype.hasOwnProperty.call(oids, oid)) {
        krsOfObj(oid).forEach(function (k) { pool.push(k); });
      }
      if (!pool.length) return;
      var byKr = {};
      cks.forEach(function (c) { byKr[c.kr_id] = (byKr[c.kr_id] || 0) + 1; });
      var topId = null;
      for (var k in byKr) if (Object.prototype.hasOwnProperty.call(byKr, k)) { if (!topId || byKr[k] > byKr[topId]) topId = k; }
      var zero = pool.filter(function (x) { return !byKr[x.kr_id]; });
      var wsum = 0;
      zero.forEach(function (x) { wsum += num(x.weight); });
      var pct = r0(byKr[topId] / cks.length * 100);
      if (!best || pct > best.pct || (pct === best.pct && wsum > best.wsum)) {
        best = { emp: e, cks: cks, pool: pool, topKr: krById(topId), topN: byKr[topId], pct: pct, zero: zero, wsum: r0(wsum) };
      }
    });
    if (!best) return NONE;
    var THp = thv(SID, 'TH-체크인편중-초과', 75), THw = thv(SID, 'TH-무기록이중치-초과', 50);
    var facts = {
      memberName: best.emp.name, ckN: best.cks.length, topKrName: best.topKr ? best.topKr.name : '',
      topN: best.topN, pct: best.pct, zeroN: best.zero.length, weightSum: best.wsum, poolN: best.pool.length
    };
    var hit = best.pct >= THp && best.wsum >= THw;
    var spec = {};
    spec[0] = (best.pct >= 100)
      ? { m: [['{{팀원명}}', best.emp.name], ['4건', best.cks.length + '건'], ['평균 응답 시간', facts.topKrName]],
          emph: best.cks.length + '건', src: best.emp.emp_id + ' / 체크인 ' + best.cks.length + '건' }
      : { m: [['{{팀원명}}', best.emp.name],
              ['체크인 4건이 모두 핵심결과 「평균 응답 시간」에만 붙어 있어요',
               '체크인 ' + best.cks.length + '건 가운데 ' + best.topN + '건이 핵심결과 「' + facts.topKrName + '」에 붙어 있어요']],
          emph: best.topN + '건', src: best.emp.emp_id + ' / 체크인 ' + best.cks.length + '건' };
    spec[1] = { m: [['3건', best.zero.length + '건']], emph: best.zero.length + '건',
                src: best.zero.map(function (k) { return k.kr_id; }).join(', ') || '해당 없음' };
    spec[2] = { m: [['4건', best.cks.length + '건'], ['100%', best.pct + '%'], ['75%', THp + '%'],
                    ['를 넘어요', best.pct >= THp ? '를 넘어요' : '를 넘지 않아요']],
                emph: best.pct + '%', src: best.emp.emp_id + ' / checkins.kr_id 분포' };
    spec[3] = { m: [['3건', best.zero.length + '건'], ['60%', best.wsum + '%']], emph: best.wsum + '%',
                src: best.zero.map(function (k) { return k.kr_id; }).join(', ') || '해당 없음' };
    return {
      hit: hit, facts: facts,
      notice: [['4건', best.cks.length + '건'], ['3건', best.zero.length + '건']],
      ev: spec,
      th: { 'TH-체크인편중-초과': best.pct + '%', 'TH-무기록이중치-초과': best.wsum + '%' }
    };
  });

  /* --- 중간점검-팀장-09 : 기간 종료 임박 + 팀원 저진척 --------------------- */
  E.registerEval('중간점검-팀장-09', function (ctx) {
    var SID = '중간점검-팀장-09';
    var reports = directReports(ctx.emp.emp_id);
    if (!reports.length) return NONE;
    var objs = teamObjs(ctx.emp, reports);
    if (!objs.length) return NONE;
    var w = periodWindow(objs[0].period);
    if (!w) return NONE;
    var daysLeft = Math.round((w.end - asofMs()) / 86400000);
    var THlow = thv(SID, 'TH-저진척-미달', 30);
    var pool = [];
    objs.forEach(function (o) { krsOfObj(o.objective_id).forEach(function (k) { pool.push(k); }); });
    var best = null;
    reports.forEach(function (e) {
      var ids = krIdsCheckedBy(e.emp_id);
      var low = pool.filter(function (k) { return ids[k.kr_id] && (k.progress || 0) < THlow; })
        .sort(function (a, b) { return (b.progress || 0) - (a.progress || 0); });
      if (!low.length) return;
      if (!best || low.length > best.low.length) best = { emp: e, low: low };
    });
    /* 팀원 중 저진척이 없으면 팀 목표 전체에서 가장 낮은 항목을 대표로 잡는다 */
    if (!best) {
      var low2 = pool.filter(function (k) { return (k.progress || 0) < THlow; })
        .sort(function (a, b) { return (b.progress || 0) - (a.progress || 0); });
      if (!low2.length) return {
        hit: false, facts: { daysLeft: daysLeft, lowN: 0, periodEnd: w.endDate }, ev: {},
        th: { 'TH-기간종료임박-도래': daysLeft + '일', 'TH-저진척-미달': '0건' }
      };
      best = { emp: reports[0], low: low2 };
    }
    var lows = best.low;
    var cks = arr('checkins').filter(function (c) { return c.emp_id === best.emp.emp_id; }).slice().sort(byDateAsc);
    var d1 = cks.length >= 2 ? r1(num(cks[cks.length - 2].progress_delta)) : null;
    var d2 = cks.length >= 1 ? r1(num(cks[cks.length - 1].progress_delta)) : null;
    var facts = {
      memberName: best.emp.name, lowN: lows.length, periodEnd: w.endDate, daysLeft: daysLeft,
      progresses: lows.map(function (k) { return r0(k.progress || 0); }), lastDeltas: [d1, d2]
    };
    var hit = daysLeft >= 0 && daysLeft <= thv(SID, 'TH-기간종료임박-도래', 14) && lows.length >= 1;
    /* 기간이 이미 끝난 뒤일 수 있다 — 그때는 「N일 남았다」가 아니라 「N일 전에 끝났다」로 쓴다 */
    var leftKr = (daysLeft >= 0) ? (daysLeft + '일 남았어요') : (Math.abs(daysLeft) + '일 전에 지났어요');
    var spec = {};
    spec[0] = (lows.length >= 2)
      ? { m: [['{{팀원명}}', best.emp.name], ['2건', lows.length + '건'],
              ['28%', r0(lows[0].progress || 0) + '%'],
              ['22%', r0(lows[lows.length - 1].progress || 0) + '%']],
          emph: r0(lows[0].progress || 0) + '%',
          src: best.emp.emp_id + ' / ' + lows.map(function (k) { return k.kr_id; }).join(', ') }
      : { m: [['{{팀원명}}', best.emp.name],
              ['핵심결과 2건의 진척이 각각 28%·22%예요',
               '핵심결과 1건의 진척이 ' + r0(lows[0].progress || 0) + '%예요']],
          emph: r0(lows[0].progress || 0) + '%', src: best.emp.emp_id + ' / ' + lows[0].kr_id };
    spec[1] = { m: [['2026년 7월 30일', fmtDate(w.endDate)], ['14일 남았어요', leftKr]], emph: leftKr,
                src: objs[0].objective_id + ' / 기간 ' + objs[0].period };
    spec[2] = { m: [['30%', THlow + '%'], ['두 항목', lows.length + '개 항목']], emph: THlow + '%',
                src: '핵심결과 진척률 기준값' };
    if (d2 != null) spec[3] = { m: [['+2%p', signed(d1 == null ? d2 : d1) + '%p'], ['+1%p', signed(d2) + '%p']],
                emph: signed(d2) + '%p', src: best.emp.emp_id + ' / 최근 체크인 증감' };
    return {
      hit: hit, facts: facts,
      notice: [['14일', daysLeft + '일'], ['{{팀원명}}', best.emp.name], ['2건', lows.length + '건'], ['30%', THlow + '%']],
      ev: spec,
      th: { 'TH-기간종료임박-도래': daysLeft + '일', 'TH-저진척-미달': r0(lows[0].progress || 0) + '%' }
    };
  });

  /* ==================================================================
     상위조직장 — ctx.scope(엔진 upperScope)가 기준 조직과 하위 팀을 준다.
     팀별 체크인 집계는 캐노니컬 360건으로 센다(머리말 규칙).
  ================================================================== */

  /* 하위 팀별 체크인 보유 인원·비율 (01·07 공용) */
  function unitCheckinRows(s) {
    var CK = canon();
    var have = idSet(CK, 'emp_id');
    return s.units.map(function (u) {
      var emps = empsInOrgSet(subtree(u.org));
      var withN = emps.filter(function (e) { return have[e.emp_id]; }).length;
      return {
        org: u.org, name: u.name, empN: emps.length, withN: withN,
        zeroN: emps.length - withN,
        rate: emps.length ? r0(withN / emps.length * 100) : null
      };
    });
  }

  /* --- 중간점검-상위조직장-01 : 마감 임박 + 하위 팀 체크인율 저조 ---------- */
  E.registerEval('중간점검-상위조직장-01', function (ctx) {
    var SID = '중간점검-상위조직장-01';
    var s = ctx.scope;
    if (!s) return NONE;
    var per = periodOf('checkin');
    if (!per) return NONE;
    var daysLeft = Math.round((dnum(per.due) - asofMs()) / 86400000);
    var rows = unitCheckinRows(s).filter(function (r) { return r.rate != null; });
    if (!rows.length) return NONE;
    var TH = thv(SID, 'TH-팀체크인율-저조', 30);
    var bad = rows.filter(function (r) { return r.rate < TH; });
    var empN = 0, withN = 0, badZero = 0, badEmp = 0;
    rows.forEach(function (r) { empN += r.empN; withN += r.withN; });
    bad.forEach(function (r) { badZero += r.zeroN; badEmp += r.empN; });
    var scopeRate = empN ? r0(withN / empN * 100) : 0;
    var CK = canon();
    var coHave = Object.keys(idSet(CK, 'emp_id')).length, coEmp = arr('employees').length;
    var coRate = coEmp ? r0(coHave / coEmp * 100) : 0;
    var worst = bad.slice().sort(function (a, b) { return a.rate - b.rate; })[0] || null;
    var facts = {
      unitN: s.unitN, empN: empN, badN: bad.length, badTeams: bad.map(function (r) { return r.name; }),
      badZeroN: badZero, badEmpN: badEmp, scopeRate: scopeRate, coRate: coRate,
      daysLeft: daysLeft, dueDate: per.due, worstRate: worst ? worst.rate : null
    };
    var hit = daysLeft != null && daysLeft >= 0 && daysLeft <= thv(SID, 'TH-마감임박-중간점검', 3) && bad.length >= 1;
    var spec = {};
    spec[0] = { m: [['8개', s.unitN + '개'], ['62명', empN + '명']], emph: empN + '명', src: s.srcOrg + ' / 구성원 ' + empN + '명' };
    spec[1] = { m: [['8개', s.unitN + '개'], ['2개 팀', bad.length + '개 팀'], ['20%', TH + '%']], emph: bad.length + '개 팀',
                src: (bad.map(function (r) { return r.org; }).join(' · ') || '없음') + ' / CHK 집계' };
    spec[2] = { m: [['두 팀', bad.length + '개 팀'], ['14명', badZero + '명']], emph: badZero + '명',
                src: (bad.map(function (r) { return r.org; }).join(' · ') || '없음') + ' / 구성원 ' + badEmp + '명' };
    spec[3] = { m: [['68%', scopeRate + '%'], ['67%', coRate + '%']], emph: scopeRate + '%',
                src: s.scopeOrg.org_id + ' / checkins(캐노니컬) ' + CK.length + '건' };
    return {
      hit: hit, facts: facts,
      notice: [['3일', daysLeft + '일'], ['두 팀', bad.length + '개 팀'], ['20%', (worst ? worst.rate : TH) + '%']],
      ev: spec,
      th: { 'TH-마감임박-중간점검': daysLeft + '일', 'TH-팀체크인율-저조': (worst ? worst.rate : scopeRate) + '%' }
    };
  });

  /* --- 중간점검-상위조직장-02 : 한 팀 핵심결과의 체크인 공백 --------------- */
  E.registerEval('중간점검-상위조직장-02', function (ctx) {
    var SID = '중간점검-상위조직장-02';
    var s = ctx.scope;
    if (!s) return NONE;
    var CK = canon(), last = lastByKr(CK);
    var THd = thv(SID, 'TH-체크인공백-일수', 21), THp = thv(SID, 'TH-체크인공백-팀비율', 30);
    var rows = s.units.map(function (u) {
      var krs = krsInOrgSet(subtree(u.org));
      var gaps = krs.map(function (k) { return last[k.kr_id] ? gapDays(last[k.kr_id]) : null; });
      var stale = [], maxGap = 0, prev = 0;
      krs.forEach(function (k, i) {
        var g = gaps[i];
        if (g == null || g >= THd) { stale.push(k); if (g != null && g > maxGap) maxGap = g; }
        /* 직전 네 주 시점(기준일 −28일)에 이미 멈춰 있던 건수 */
        if (g != null && g - 28 >= THd) prev++;
      });
      return { org: u.org, name: u.name, krN: krs.length, staleN: stale.length, maxGap: maxGap, prev: prev,
               pct: krs.length ? r0(stale.length / krs.length * 100) : null };
    }).filter(function (r) { return r.krN > 0; });
    if (!rows.length) return NONE;
    rows.sort(function (a, b) { return b.pct - a.pct || b.staleN - a.staleN; });
    var w = rows[0];
    var over = rows.filter(function (r) { return r.pct >= THp; });
    /* 조직 평균 체크인 간격 — 사람별 연속 체크인 간격의 평균 */
    var ids = idSet(empsInOrgSet(subtree(s.scopeOrg.org_id)), 'emp_id');
    var byEmp = {};
    CK.forEach(function (c) { if (ids[c.emp_id]) (byEmp[c.emp_id] = byEmp[c.emp_id] || []).push(c.checkin_date); });
    var gapsAll = [];
    for (var e in byEmp) if (Object.prototype.hasOwnProperty.call(byEmp, e)) {
      var ds = byEmp[e].slice().sort();
      for (var i = 1; i < ds.length; i++) gapsAll.push(Math.round((dnum(ds[i]) - dnum(ds[i - 1])) / 86400000));
    }
    var avgGap = gapsAll.length ? r0(avg(gapsAll)) : null;
    var facts = {
      teamName: w.name, teamOrg: w.org, krN: w.krN, staleN: w.staleN, pct: w.pct, maxGap: w.maxGap,
      prevN: w.prev, avgGap: avgGap, unitN: s.unitN, overTeamN: over.length
    };
    var hit = w.pct != null && w.pct >= THp && w.maxGap >= THd;
    var spec = {};
    spec[0] = { m: [['12건', w.krN + '건']], emph: w.krN + '건', src: w.org + ' / KR ' + w.krN + '건' };
    spec[1] = { m: [['12건', w.krN + '건'], ['9건', w.staleN + '건'], ['21일', THd + '일']], emph: w.staleN + '건',
                src: w.org + ' / KR ' + w.staleN + '건 · CHK 최종일' };
    spec[2] = { m: [['9건', w.staleN + '건'], ['75%', w.pct + '%']], emph: w.pct + '%', src: w.org + ' / KR ' + w.krN + '건' };
    if (avgGap != null) spec[3] = { m: [['8개', s.unitN + '개'], ['8일', avgGap + '일']], emph: avgGap + '일',
                src: s.scopeOrg.org_id + ' / checkins(캐노니컬) ' + CK.length + '건' };
    spec[4] = { m: [['30%', THp + '%'], ['8개', s.unitN + '개'],
                    ['이 팀뿐', over.length === 1 ? '이 팀뿐' : over.length + '개 팀']],
                emph: over.length === 1 ? '이 팀뿐' : over.length + '개 팀', src: s.srcOrg + ' / KR 팀별 집계' };
    spec[5] = { m: [['2건', w.prev + '건']], emph: w.prev + '건', src: w.org + ' / CHK 직전 4주' };
    return {
      hit: hit, facts: facts,
      notice: [['8일', (avgGap == null ? '?' : avgGap) + '일'], ['9건', w.staleN + '건'], ['21일째', w.maxGap + '일째']],
      ev: spec,
      th: { 'TH-체크인공백-일수': w.maxGap + '일', 'TH-체크인공백-팀비율': w.pct + '%' }
    };
  });

  /* --- 중간점검-상위조직장-04 : 하위는 오르는데 조직 목표는 멈춤 ----------- */
  E.registerEval('중간점검-상위조직장-04', function (ctx) {
    var SID = '중간점검-상위조직장-04';
    var s = ctx.scope;
    if (!s) return NONE;
    var mw = maxWeek();
    if (!mw) return NONE;
    var unitKrIds = {}, unitObjN = 0;
    s.units.forEach(function (u) {
      unitObjN += u.objN;
      krsInOrgSet(subtree(u.org)).forEach(function (k) { unitKrIds[k.kr_id] = 1; });
    });
    var ownObjs = arr('objectives').filter(function (o) { return o.org_id === s.scopeOrg.org_id; });
    var ownKrs = [];
    ownObjs.forEach(function (o) { krsOfObj(o.objective_id).forEach(function (k) { ownKrs.push(k); }); });
    var ownIds = idSet(ownKrs, 'kr_id');
    var sub = deltaPerKr(unitKrIds, mw - 3, mw);
    var own = deltaPerKr(ownIds, mw - 3, mw);
    var subPrev = deltaPerKr(unitKrIds, mw - 7, mw - 4);
    var ratio = subPrev ? r1(sub / subPrev) : null;
    /* 내 조직 목표의 최근 갱신 폭 — 주차별 최대 증감 */
    var ownWeekMax = 0, ownWeekN = 0;
    for (var wk = mw - 3; wk <= mw; wk++) {
      var d = deltaPerKr(ownIds, wk, wk);
      if (d) { ownWeekN++; if (Math.abs(d) > Math.abs(ownWeekMax)) ownWeekMax = d; }
    }
    /* 지표가 이어진다 = 상·하위 핵심결과 이름이 같다 */
    var unitNames = {};
    for (var kid in unitKrIds) if (Object.prototype.hasOwnProperty.call(unitKrIds, kid)) {
      var kk = krById(kid); if (kk) unitNames[kk.name] = 1;
    }
    var linkN = ownKrs.filter(function (k) { return unitNames[k.name]; }).length;
    var tk = themeKpi(ownObjs.length ? ownObjs : s.objs);
    var TH1 = thv(SID, 'TH-상하진척괴리-하위증가', 15), TH2 = thv(SID, 'TH-상하진척괴리-상위증가', 5);
    var facts = {
      unitN: s.unitN, unitObjN: unitObjN, ownObjN: ownObjs.length, ownKrN: ownKrs.length,
      subDelta: sub, ownDelta: own, subPrev: subPrev, ratio: ratio, ownWeekMax: r1(ownWeekMax),
      ownWeekN: ownWeekN, linkN: linkN, weeks: (mw - 3) + '~' + mw
    };
    var hit = sub >= TH1 && own <= TH2;
    var spec = {};
    spec[0] = { m: [['8개', s.unitN + '개'], ['22건', unitObjN + '건'], ['3건', ownObjs.length + '건']], emph: unitObjN + '건',
                src: s.srcOrg + ' / OBJ ' + unitObjN + '건 · 내 조직 OBJ ' + ownObjs.length + '건' };
    spec[1] = { m: [['18%p', pn(sub) + '%p'], ['2%p', pn(own) + '%p']], emph: pn(own) + '%p',
                src: s.scopeOrg.org_id + ' / krProgress week ' + (mw - 3) + '~' + mw };
    spec[2] = { m: [['15%p', TH1 + '%p'], ['5%p', TH2 + '%p']], emph: pn(sub) + '%p', src: '상하 진척 괴리 기준값 두 갈래' };
    if (ratio != null) spec[3] = { m: [['2.4배', pn(ratio) + '배']], emph: pn(ratio) + '배',
                src: s.scopeOrg.org_id + ' / krProgress week ' + (mw - 7) + '~' + mw };
    spec[4] = { m: [['두 차례', ownWeekN + '차례'], ['1%p', pn(Math.abs(ownWeekMax)) + '%p']], emph: pn(Math.abs(ownWeekMax)) + '%p',
                src: '내 조직 OBJ ' + ownObjs.length + '건 / 진척 갱신 ' + ownWeekN + '회' };
    spec[5] = { m: [['3건', ownObjs.length + '건'], ['11건', ownKrs.length + '건'], ['4건', linkN + '건']], emph: linkN + '건',
                src: '내 조직 OBJ ' + ownObjs.length + '건 / KR ' + ownKrs.length + '건' };
    if (tk) spec[6] = { m: [['제품 경쟁력·품질 강화', tk.name], ['핵심 기능 정시 출시율', tk.kpi.name],
                            ['90%', String(tk.kpi.target)], ['82%', String(tk.kpi.current)]],
                emph: String(tk.kpi.current), src: tk.id + ' / KPI 1' };
    return {
      hit: hit, facts: facts,
      notice: [['18%p', pn(sub) + '%p'], ['2%p', pn(own) + '%p']],
      ev: spec,
      th: { 'TH-상하진척괴리-하위증가': pn(sub) + '%p', 'TH-상하진척괴리-상위증가': pn(own) + '%p' }
    };
  });

  /* --- 중간점검-상위조직장-07 : 팀 안 체크인 미보유 인원 과다 -------------- */
  E.registerEval('중간점검-상위조직장-07', function (ctx) {
    var SID = '중간점검-상위조직장-07';
    var s = ctx.scope;
    if (!s) return NONE;
    var rows = unitCheckinRows(s).filter(function (r) { return r.empN > 0; });
    if (!rows.length) return NONE;
    var THp = thv(SID, 'TH-체크인미보유-팀비율', 50);
    var bad = rows.filter(function (r) { return (100 - r.rate) >= THp; });
    if (!bad.length) bad = [rows.slice().sort(function (a, b) { return a.rate - b.rate; })[0]];
    var empN = 0, zeroN = 0, haveN = 0;
    bad.forEach(function (r) { empN += r.empN; zeroN += r.zeroN; haveN += r.withN; });
    var CK = canon();
    var badIds = {};
    bad.forEach(function (r) { empsInOrgSet(subtree(r.org)).forEach(function (e) { badIds[e.emp_id] = 1; }); });
    var lastDate = null;
    CK.forEach(function (c) { if (badIds[c.emp_id] && (!lastDate || c.checkin_date > lastDate)) lastDate = c.checkin_date; });
    var gap = lastDate ? gapDays(lastDate) : null;
    var coHave = Object.keys(idSet(CK, 'emp_id')).length, coEmp = arr('employees').length;
    var maxMiss = 0;
    bad.forEach(function (r) { if (100 - r.rate > maxMiss) maxMiss = 100 - r.rate; });
    var facts = {
      badN: bad.length, badTeams: bad.map(function (r) { return r.name; }), empN: empN, zeroN: zeroN,
      haveN: haveN, coHave: coHave, coEmp: coEmp, coPct: coEmp ? r0(coHave / coEmp * 100) : 0,
      lastDate: lastDate, gap: gap, maxMissPct: maxMiss
    };
    var hit = maxMiss >= THp && gap != null && gap >= thv(SID, 'TH-체크인공백-일수', 21);
    var srcTeams = bad.map(function (r) { return r.org; }).join(' · ');
    var spec = {};
    spec[0] = { m: [['두 팀', bad.length + '개 팀'], ['34명', empN + '명']], emph: empN + '명', src: srcTeams + ' / 구성원 ' + empN + '명' };
    spec[1] = { m: [['두 팀', bad.length + '개 팀'], ['34명', empN + '명'], ['26명', zeroN + '명']], emph: zeroN + '명',
                src: srcTeams + ' / CHK 보유 ' + haveN + '명' };
    spec[2] = { m: [['221명', coEmp + '명'], ['147명', coHave + '명'], ['67%', facts.coPct + '%'],
                    ['두 팀', bad.length + '개 팀'], ['34명', empN + '명'], ['8명', haveN + '명']],
                emph: zeroN + '명', src: '전사 체크인 보유율 집계 (캐노니컬 ' + CK.length + '건)' };
    if (lastDate) spec[3] = { m: [['두 팀', bad.length + '개 팀'], ['2026년 4월 25일', fmtDate(lastDate)]], emph: fmtDate(lastDate),
                src: srcTeams + ' / CHK 최종일 (공백 ' + gap + '일)' };
    return {
      hit: hit, facts: facts,
      notice: [['두 팀', bad.length + '개 팀'], ['34명', empN + '명'], ['26명', zeroN + '명']],
      ev: spec,
      th: { 'TH-체크인미보유-팀비율': maxMiss + '%', 'TH-체크인공백-일수': (gap == null ? '?' : gap) + '일' }
    };
  });

  /* ==================================================================
     HR경영진 — 전사 집계. 사람 이름은 담지 않는다.
  ================================================================== */

  /* 조직 트리 단위 목표 집계 — 조직 하나가 하위까지 들고 있는 목표를 함께 센다.
     목표는 조직당 1건씩이라 「조직 자기 목표만」으로는 3건 기준을 넘길 수 없다.
     전사 루트(부모 없는 조직)는 「전사 = 한 조직」이 되어 비교가 무의미하므로 뺀다. */
  function orgTreeRows(minObj) {
    var root = arr('orgs').filter(function (o) { return !o.parent_id; })[0];
    var out = [];
    arr('orgs').forEach(function (o) {
      if (root && o.org_id === root.org_id) return;
      var st = subtree(o.org_id);
      var objs = objsInOrgSet(st);
      if (objs.length < minObj) return;
      var emps = empsInOrgSet(st);
      out.push({
        org: o.org_id, name: o.name, objs: objs, objN: objs.length, empN: emps.length,
        avg: r1(avg(objs.map(function (x) { return x.progress || 0; })))
      });
    });
    return out;
  }

  /* --- 중간점검-HR경영진-02 : 한 조직 목표 진행률이 전사 최저 ------------- */
  E.registerEval('중간점검-HR경영진-02', function (ctx) {
    var SID = '중간점검-HR경영진-02';
    var THobj = thv(SID, 'TH-진척대상목표-조직', 3);
    var rows = orgTreeRows(THobj);
    if (!rows.length) return NONE;
    rows.sort(function (a, b) { return a.avg - b.avg; });
    var w = rows[0];
    var krs = arr('keyResults');
    var progs = krs.map(function (k) { return k.progress || 0; });
    var krAvg = progs.length ? r1(avg(progs)) : 0;
    var krMax = progs.length ? r1(Math.max.apply(null, progs)) : 0;
    var krMin = progs.length ? r1(Math.min.apply(null, progs)) : 0;
    var per = w.objs[0].period, el = elapsedPct(per), pw = periodWindow(per);
    if (el == null) return NONE;
    var gap = r1(el - w.avg);
    var behind = krs.filter(function (k) { return (el - (k.progress || 0)) >= 20; }).length;
    var empTotal = arr('employees').length;
    var empPct = empTotal ? r0(w.empN / empTotal * 100) : 0;
    var facts = {
      orgName: w.name, orgId: w.org, objN: w.objN, avg: w.avg, elapsed: el, gap: gap,
      krTotal: krs.length, krAvg: krAvg, krMax: krMax, krMin: krMin,
      empN: w.empN, empPct: empPct, behindN: behind, periodLabel: pw ? pw.label : per
    };
    var hit = gap >= thv(SID, 'TH-진척기간격차-초과', 30)
      && w.objN >= THobj && empPct >= thv(SID, 'TH-진척대상인원-비율', 20);
    var spec = {};
    spec[0] = { m: [['3건', THobj + '건']], emph: '목표 ' + THobj + '건', src: 'orgs ' + arr('orgs').length + '개 / objectives ' + arr('objectives').length + '건' };
    spec[1] = { m: [['146건', krs.length + '건'], ['43.0%', pn(krAvg) + '%'], ['64.7%', pn(krMax) + '%']], emph: pn(krAvg) + '%',
                calcm: [['21.4%', pn(krMin) + '%'], ['43.0%', pn(krAvg) + '%'], ['64.7%', pn(krMax) + '%']],
                src: 'keyResults ' + krs.length + '건 / progress' };
    spec[2] = { m: [['{{조직명}}', w.name], ['21.9%', pn(w.avg) + '%']], emph: pn(w.avg) + '%',
                src: w.org + ' 하위 포함 OBJ ' + w.objN + '건 / progress' };
    spec[3] = (el >= 100)
      ? { m: [['2026년 2분기(4~6월)', facts.periodLabel], ['78%p', pn(gap) + '%p']], emph: pn(gap) + '%p',
          calcm: [['21.9%', pn(w.avg) + '%'], ['100%', el + '%']], src: w.org + ' / period ' + per }
      : { m: [['2026년 2분기(4~6월)는 이미 끝나 기간 경과율이 100%라서', facts.periodLabel + '의 기간 경과율이 ' + el + '%라서'],
              ['78%p', pn(gap) + '%p']], emph: pn(gap) + '%p',
          calcm: [['21.9%', pn(w.avg) + '%'], ['100%', el + '%']], src: w.org + ' / period ' + per };
    spec[4] = (behind === krs.length)
      ? { m: [['146건', krs.length + '건']], emph: krs.length + '건이 모두', src: 'keyResults ' + krs.length + '건 / progress' }
      : { m: [['핵심결과 146건이 모두', '핵심결과 ' + krs.length + '건 가운데 ' + behind + '건이']], emph: behind + '건',
          src: 'keyResults ' + krs.length + '건 / progress' };
    return {
      hit: hit, facts: facts,
      notice: [['21.9%', pn(w.avg) + '%']],
      ev: spec,
      th: { 'TH-진척기간격차-초과': pn(gap) + '%p', 'TH-진척대상목표-조직': w.objN + '건', 'TH-진척대상인원-비율': empPct + '%' }
    };
  });

  /* --- 중간점검-HR경영진-03 : 한 본부에 협조 대기 장애요인 누적 ------------ */
  E.registerEval('중간점검-HR경영진-03', function (ctx) {
    var SID = '중간점검-HR경영진-03';
    var root = arr('orgs').filter(function (o) { return !o.parent_id; })[0];
    if (!root) return NONE;
    var THobj = thv(SID, 'TH-진척대상목표-본부', 5);
    var CK = canon(), mw = maxWeek();
    /* 본부 = 전사 루트 바로 아래 조직 */
    var rows = childrenOf(root.org_id).map(function (o) {
      var st = subtree(o.org_id);
      var objs = objsInOrgSet(st);
      var ids = idSet(empsInOrgSet(st), 'emp_id');
      var cks = CK.filter(function (c) { return ids[c.emp_id]; });
      var wait = cks.filter(function (c) { return isWait(c.blocker); }).length;
      var krIds = idSet(krsInOrgSet(st), 'kr_id');
      return { org: o.org_id, name: o.name, objs: objs, objN: objs.length, cks: cks, waitN: wait,
               d8: mw ? deltaPerKr(krIds, mw - 7, mw) : 0 };
    }).filter(function (r) { return r.objN >= THobj; });
    if (!rows.length) return NONE;
    rows.sort(function (a, b) { return b.waitN - a.waitN; });
    var w = rows[0];
    var withBlk = CK.filter(function (c) { return !!c.blocker; }).length;
    var waitTop = sortedLabels(blockerCount(CK.filter(function (c) { return isWait(c.blocker); })));
    var lowN = CK.filter(function (c) { return c.confidence === 'low'; }).length;
    var tk = themeKpi(w.objs);
    var facts = {
      hqName: w.name, hqOrg: w.org, objN: w.objN, waitN: w.waitN, ckN: w.cks.length,
      blkTotal: withBlk, ckTotal: CK.length, lowN: lowN, delta8: w.d8,
      waitTop: waitTop.slice(0, 3).map(function (x) { return x.label + ' ' + x.n + '건'; })
    };
    var hit = w.waitN >= thv(SID, 'TH-협조대기장애요인-건수', 30)
      && Math.abs(w.d8) <= thv(SID, 'TH-진척정체-증감합', 5);
    var spec = {};
    spec[0] = { m: [['5건', THobj + '건']], emph: '목표 ' + THobj + '건', src: 'orgs / objectives ' + arr('objectives').length + '건' };
    spec[1] = { m: [['360건', CK.length + '건'], ['253건', withBlk + '건']], emph: withBlk + '건',
                calcm: [['253건', withBlk + '건'], ['360건', CK.length + '건'], ['70.3%', pn(CK.length ? withBlk / CK.length * 100 : 0) + '%']],
                src: 'checkins(캐노니컬) ' + CK.length + '건 / blocker' };
    if (waitTop.length >= 3) spec[2] = { m: [['내부 의사결정 대기', waitTop[0].label], ['33건', waitTop[0].n + '건'],
                                             ['법무 검토 대기', waitTop[1].label], ['27건', waitTop[1].n + '건'],
                                             ['인프라 대기', waitTop[2].label], ['25건', waitTop[2].n + '건']],
                emph: waitTop[0].n + '건', src: 'checkins(캐노니컬) / blocker 협조 대기 유형' };
    spec[3] = { m: [['68건', lowN + '건']], emph: lowN + '건',
                calcm: [['68건', lowN + '건'], ['360건', CK.length + '건'], ['18.9%', pn(CK.length ? lowN / CK.length * 100 : 0) + '%']],
                src: 'checkins(캐노니컬) ' + CK.length + '건 / confidence' };
    spec[4] = { m: [['2%p', pn(w.d8) + '%p']], emph: pn(w.d8) + '%p',
                src: w.org + ' / krProgress week ' + (mw - 7) + '~' + mw + ' (핵심결과 1건당)' };
    if (tk) spec[5] = { m: [['제품 경쟁력·품질 강화', tk.name], ['90%', String(tk.kpi.target)], ['82%', String(tk.kpi.current)]],
                emph: String(tk.kpi.current), src: tk.id + ' / kpis / ' + w.org + ' OBJ ' + w.objN + '건' };
    return {
      hit: hit, facts: facts,
      notice: [['78건', w.waitN + '건']],
      ev: spec,
      th: { 'TH-진척정체-증감합': pn(w.d8) + '%p', 'TH-협조대기장애요인-건수': w.waitN + '건', 'TH-진척대상목표-본부': w.objN + '건' }
    };
  });

  /* --- 중간점검-HR경영진-04 : 상하 진척 괴리 조직 다발 --------------------- */
  E.registerEval('중간점검-HR경영진-04', function (ctx) {
    var SID = '중간점검-HR경영진-04';
    var mw = maxWeek();
    if (!mw) return NONE;
    var TH1 = thv(SID, 'TH-하위진척상승-폭', 15), TH2 = thv(SID, 'TH-상위진척정체-폭', 5);
    var rows = [];
    arr('orgs').forEach(function (o) {
      var ownObjs = arr('objectives').filter(function (x) { return x.org_id === o.org_id; });
      if (!ownObjs.length) return;
      var kids = childrenOf(o.org_id);
      if (!kids.length) return;
      var subIds = {};
      kids.forEach(function (u) { krsInOrgSet(subtree(u.org_id)).forEach(function (k) { subIds[k.kr_id] = 1; }); });
      if (!Object.keys(subIds).length) return;
      var ownIds = {};
      ownObjs.forEach(function (x) { krsOfObj(x.objective_id).forEach(function (k) { ownIds[k.kr_id] = 1; }); });
      rows.push({ org: o.org_id, name: o.name, sub: deltaPerKr(subIds, mw - 3, mw), own: deltaPerKr(ownIds, mw - 3, mw) });
    });
    if (!rows.length) return NONE;
    var bad = rows.filter(function (r) { return r.sub >= TH1 && r.own <= TH2; });
    var pick = bad.length ? bad : rows.slice().sort(function (a, b) { return (b.sub - b.own) - (a.sub - a.own); }).slice(0, 1);
    var sub = r1(avg(pick.map(function (r) { return r.sub; })));
    var own = r1(avg(pick.map(function (r) { return r.own; })));
    var C = co();
    var wd = C.wdiffs.slice().sort(function (a, b) { return b.diff - a.diff; })[0] || null;
    var wdKrN = wd ? krsOfObj(wd.id).length : 0;
    var facts = {
      orgN: bad.length, sampleN: pick.length, subDelta: sub, ownDelta: own,
      objTotal: C.objTotal, wdiffAvg: C.wdiffAvg,
      maxObj: wd ? wd.id : '', maxShown: wd ? wd.shown : null, maxWavg: wd ? wd.wavg : null, maxKrN: wdKrN
    };
    var hit = bad.length >= thv(SID, 'TH-어긋난조직-건수', 3);
    var spec = {};
    spec[0] = { ok: 1, src: 'objectives ' + C.objTotal + '건 / parent_objective_id' };
    spec[1] = { m: [['세 조직', bad.length + '곳'], ['18%p', pn(sub) + '%p'], ['1%p', pn(own) + '%p']], emph: pn(own) + '%p',
                src: 'krProgress week ' + (mw - 3) + '~' + mw + ' / 조직 ' + pick.length + '곳' };
    spec[2] = { m: [['40건', C.objTotal + '건'], ['11.1%p', pn(C.wdiffAvg) + '%p']], emph: pn(C.wdiffAvg) + '%p',
                src: 'objectives ' + C.objTotal + '건 / keyResults ' + arr('keyResults').length + '건' };
    if (wd) spec[3] = { m: [['64.8%', pn(wd.shown) + '%'], ['4건', wdKrN + '건'], ['35.0%', pn(wd.wavg) + '%']], emph: pn(wd.wavg) + '%',
                calcm: [['64.8%', pn(wd.shown) + '%'], ['35.0%', pn(wd.wavg) + '%'], ['29.8%p', pn(wd.diff) + '%p']],
                src: wd.id + ' / KR ' + wdKrN + '건' };
    spec[4] = { ok: 1, src: 'objectives / keyResults target_value' };
    return {
      hit: hit, facts: facts,
      notice: [['세 조직', bad.length + '곳'], ['18%p', pn(sub) + '%p'], ['1%p', pn(own) + '%p']],
      ev: spec,
      th: { 'TH-하위진척상승-폭': pn(sub) + '%p', 'TH-상위진척정체-폭': pn(own) + '%p', 'TH-어긋난조직-건수': bad.length + '곳' }
    };
  });

  /* --- 중간점검-HR경영진-05 : 전사 체크인이 끊김 --------------------------- */
  E.registerEval('중간점검-HR경영진-05', function (ctx) {
    var SID = '중간점검-HR경영진-05';
    var CK = canon();
    if (!CK.length) return NONE;
    var dates = CK.map(function (c) { return c.checkin_date; }).sort();
    var first = dates[0], last = dates[dates.length - 1];
    var gap = gapDays(last);
    var curMonth = asof().slice(0, 7);
    var curN = CK.filter(function (c) { return c.checkin_date.slice(0, 7) === curMonth; }).length;
    var empTotal = arr('employees').length;
    var have = Object.keys(idSet(CK, 'emp_id')).length;
    var zeroN = empTotal - have;
    var zeroPct = empTotal ? r1(zeroN / empTotal * 100) : 0;
    var TH = thv(SID, 'TH-체크인미기록-판정일', 14);
    var facts = {
      ckTotal: CK.length, empTotal: empTotal, firstDate: first, lastDate: last, gap: gap,
      curMonth: curMonth, curN: curN, haveN: have, zeroN: zeroN, zeroPct: zeroPct
    };
    var hit = gap != null && gap >= TH && zeroPct >= thv(SID, 'TH-체크인0건인원-비율', 30);
    var mk = (+curMonth.slice(5, 7)) + '월';
    var spec = {};
    spec[0] = { m: [['221명', empTotal + '명'], ['360건', CK.length + '건']], emph: CK.length + '건',
                src: 'checkins(캐노니컬) ' + CK.length + '건 / EMP 전수 ' + empTotal + '명' };
    spec[1] = { m: [['2026년 6월 27일', fmtDate(last)]], emph: fmtDate(last),
                calcm: [['19일', gap + '일']], src: 'checkins(캐노니컬) / checkin_date 최댓값' };
    spec[2] = { m: [['14일', TH + '일'], ['2026년 6월 27일', fmtDate(last)]], emph: gap + '일',
                src: '체크인 미기록 판단 공백일 기준값' };
    spec[3] = { m: [['2026년 4월 4일', fmtDate(first)], ['6월 27일', fmtMd(last)], ['7월', mk], ['0건', curN + '건']],
                emph: mk + '에는 ' + curN + '건',
                calcm: [['2026-04-04', first], ['2026-06-27', last]], src: 'checkins(캐노니컬) / checkin_date' };
    return {
      hit: hit, facts: facts,
      notice: [['2026년 6월 27일', fmtDate(last)], ['7월', mk], ['0건', curN + '건']],
      ev: spec,
      th: { 'TH-체크인미기록-판정일': gap + '일', 'TH-체크인0건인원-비율': pn(zeroPct) + '%' }
    };
  });

  /* --- 중간점검-HR경영진-07 : 같은 장애요인이 여러 조직에 확산 ------------- */
  E.registerEval('중간점검-HR경영진-07', function (ctx) {
    var SID = '중간점검-HR경영진-07';
    var CK = canon();
    var withBlk = CK.filter(function (c) { return !!c.blocker; });
    if (!withBlk.length) return NONE;
    var list = sortedLabels(blockerCount(withBlk));
    var top = list[0];
    var orgOf = {};
    arr('employees').forEach(function (e) { orgOf[e.emp_id] = e.org_id; });
    var orgs = {};
    withBlk.forEach(function (c) { if (c.blocker === top.label && orgOf[c.emp_id]) orgs[orgOf[c.emp_id]] = 1; });
    var orgN = Object.keys(orgs).length;
    var top4 = list.slice(0, 4);
    var top4N = 0;
    top4.forEach(function (x) { top4N += x.n; });
    var pct = withBlk.length ? r0(top4N / withBlk.length * 100) : 0;
    var facts = {
      kindN: list.length, topLabel: top.label, topN: top.n, topOrgN: orgN,
      blkTotal: withBlk.length, top4: top4.map(function (x) { return x.label + ' ' + x.n + '건'; }), top4Pct: pct
    };
    var hit = top.n >= thv(SID, 'TH-장애요인반복-건수', 20) && orgN >= thv(SID, 'TH-장애요인확산-조직수', 3);
    var spec = {};
    spec[0] = { ok: 1, src: 'checkins(캐노니컬) ' + CK.length + '건 / blocker ' + list.length + '가지' };
    spec[1] = { m: [['외부 API 연동 이슈로 일정 지연', top.label], ['45건', top.n + '건']], emph: top.n + '건',
                calcm: [['45건', top.n + '건'], ['253건', withBlk.length + '건'],
                        ['17.8%', pn(withBlk.length ? top.n / withBlk.length * 100 : 0) + '%']],
                src: 'checkins(캐노니컬) / blocker' };
    if (list.length >= 4) spec[2] = { m: [['내부 의사결정 대기 중', list[1].label], ['33건', list[1].n + '건'],
                                          ['고객 요구사항 변경으로 재작업 필요', list[2].label], ['30건', list[2].n + '건'],
                                          ['협력업체 납품 지연', list[3].label], ['28건', list[3].n + '건']],
                emph: list[1].n + '건', src: 'checkins(캐노니컬) / blocker' };
    spec[3] = { m: [['열 가지', list.length + '가지'], ['253건', withBlk.length + '건'], ['54%', pct + '%']], emph: pct + '%',
                calcm: [['45', String(top4[0] ? top4[0].n : 0)], ['33', String(top4[1] ? top4[1].n : 0)],
                        ['30', String(top4[2] ? top4[2].n : 0)], ['28', String(top4[3] ? top4[3].n : 0)],
                        ['136건', top4N + '건']],
                src: 'checkins(캐노니컬) / blocker' };
    spec[4] = { ok: 1, src: 'checkins(캐노니컬) / emp_id → orgs ' + orgN + '곳' };
    return {
      hit: hit, facts: facts,
      notice: [['외부 연동 지연', cut(top.label, 13)], ['45건', top.n + '건']],
      ev: spec,
      th: { 'TH-장애요인반복-건수': top.n + '건', 'TH-장애요인확산-조직수': orgN + '곳' }
    };
  });

  /* --- 중간점검-HR경영진-08 : 초과근무 급증 + 체크인 감소 ------------------ */
  E.registerEval('중간점검-HR경영진-08', function (ctx) {
    var SID = '중간점검-HR경영진-08';
    /* 이번 달은 아직 진행 중이라 평균이 낮게 잡힌다 — 지난 두 달을 견준다 */
    var cur = asof().slice(0, 7);
    var m2 = monthKeyShift(cur, -1), m1 = monthKeyShift(cur, -2);
    var r1rows = arr('attendance').filter(function (a) { return a.period === m1; });
    var r2rows = arr('attendance').filter(function (a) { return a.period === m2; });
    if (!r1rows.length || !r2rows.length) return NONE;
    var a1 = r1(avg(r1rows.map(function (a) { return num(a.overtime_hours); })));
    var a2 = r1(avg(r2rows.map(function (a) { return num(a.overtime_hours); })));
    var delta = r1(a2 - a1);
    var maxOt = r1(Math.max.apply(null, r2rows.map(function (a) { return num(a.overtime_hours); })));
    var CK = canon();
    var last = CK.length ? CK.map(function (c) { return c.checkin_date; }).sort().pop() : null;
    var TH1 = thv(SID, 'TH-초과근무증가-폭', 5), TH2 = thv(SID, 'TH-초과근무-절대수준', 15);
    var facts = {
      prevMonth: m1, curMonth: m2, prevAvg: a1, curAvg: a2, delta: delta,
      maxOt: maxOt, empN: r2rows.length, lastCheckin: last
    };
    var hit = delta >= TH1 && a2 >= TH2;
    var spec = {};
    spec[0] = { m: [['221명', r2rows.length + '명']], emph: '월별', src: 'attendance ' + m1 + '·' + m2 + ' 전수' };
    spec[1] = { m: [['2026년 5월', fmtMonthFull(m1)], ['12.6시간', pn(a1) + '시간'],
                    ['6월', (+m2.slice(5, 7)) + '월'], ['18.2시간', pn(a2) + '시간']], emph: pn(a2) + '시간',
                calcm: [['18.2시간', pn(a2) + '시간'], ['12.6시간', pn(a1) + '시간'], ['5.6시간', pn(delta) + '시간']],
                src: 'attendance ' + m1 + ' / ' + m2 + ' / overtime_hours' };
    spec[2] = { m: [['5시간', TH1 + '시간'], ['15시간', TH2 + '시간'],
                    ['둘 다 넘었어요', (delta >= TH1 && a2 >= TH2) ? '둘 다 넘었어요' : '둘 다 넘지는 않았어요']],
                emph: pn(delta) + '시간', src: '초과근무 두 기준값' };
    if (last) spec[3] = { m: [['6월 27일', fmtMd(last)], ['58.0시간', pn(maxOt) + '시간']], emph: pn(maxOt) + '시간',
                src: 'attendance ' + m2 + ' 전수 / checkins(캐노니컬) ' + CK.length + '건' };
    return {
      hit: hit, facts: facts,
      notice: [['5월', (+m1.slice(5, 7)) + '월'], ['12.6시간', pn(a1) + '시간'],
               ['6월', (+m2.slice(5, 7)) + '월'], ['18.2시간', pn(a2) + '시간']],
      ev: spec,
      th: { 'TH-초과근무증가-폭': pn(delta) + '시간', 'TH-초과근무-절대수준': pn(a2) + '시간' }
    };
  });

  /* ------------------------------------------------------------------
     데이터 없음: 중간점검-구성원-07 — 필요한 원천 「예정된 1on1 일정(다음 면담
     날짜와 그 자리에 올려둘 안건 목록)」. meetingStore 는 이미 끝난 면담 117건만
     들고 있고(at 최댓값 2026-07-13 = 기준 시점 이전), 예정일·안건 등록 필드가
     없다. 카탈로그도 이 줄의 출처를 「1on1 일정(신설 예정)」으로 적어 두었다.
     「마감까지 N일」과 「올려둔 안건 0건」을 둘 다 지어내야 판정이 서므로 붙이지
     않았다. 면담 예정 일정이 데이터에 들어오면 곧바로 붙일 수 있다.
     ------------------------------------------------------------------ */
})();
