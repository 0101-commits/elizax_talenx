/* js/ez_signal_eval4.js — 신호 판정 함수 (20-4차 · 담당 C · 평가 단계)
   ------------------------------------------------------------------------
   ez_signal_engine.js 에 「평가」 42건 중 아직 EVAL 이 없는 신호의 판정 함수를 붙인다.
   등록은 EZSignalEngine.registerEval 로 한다 — 엔진·데이터 파일은 건드리지 않는다.
   ES5 IIFE · zero-dep · 엔진·카탈로그가 없으면 조용히 아무 것도 하지 않는다.
   ------------------------------------------------------------------------ */
(function () {
  'use strict';
  var E = window.EZSignalEngine;
  if (!E || !E.registerEval) return;

  var Hp = E.helpers || {};
  function arr(k) { return (Hp.arr ? Hp.arr(k) : []) || []; }
  var r0 = Hp.r0 || Math.round;
  var r1 = Hp.r1 || function (v) { return Math.round(v * 10) / 10; };
  var pn = Hp.pn || function (v) { var x = r1(v); return (x === Math.round(x)) ? String(Math.round(x)) : String(x); };
  var thv = Hp.thv || function (id, code, fb) { return fb; };
  var asofMs = Hp.asofMs || function () { return Date.parse('2026-07-16T00:00:00Z'); };
  var num = Hp.num || function (v) { var m = /(-?\d+(\.\d+)?)/.exec(String(v == null ? '' : v)); return m ? parseFloat(m[1]) : 0; };

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  /* ---- 엔진 비공개 헬퍼를 이 파일 안에서 다시 만든다 (엔진 파일은 고치지 않는다) ---- */
  function empById(id) { var e = arr('employees'), i; for (i = 0; i < e.length; i++) if (e[i].emp_id === id) return e[i]; return null; }
  function orgById(id) { var o = arr('orgs'), i; for (i = 0; i < o.length; i++) if (o[i].org_id === id) return o[i]; return null; }
  function orgChildren(pid) { return arr('orgs').filter(function (o) { return o.parent_id === pid; }); }
  function subtreeIds(rootId) {
    var out = {}, q = [rootId];
    while (q.length) {
      var id = q.shift();
      if (!id || out[id]) continue;
      out[id] = 1;
      orgChildren(id).forEach(function (c) { q.push(c.org_id); });
    }
    return out;
  }
  function krById(id) { var k = arr('keyResults'), i; for (i = 0; i < k.length; i++) if (k[i].kr_id === id) return k[i]; return null; }
  function dayLeft(dueDate) {
    if (!dueDate) return null;
    var t = Date.parse(String(dueDate).slice(0, 10) + 'T00:00:00Z');
    return isNaN(t) ? null : Math.round((t - asofMs()) / 86400000);
  }
  /* 지금 열린 평가 기간 하나 — kind='eval' · status!=='closed' */
  function curPeriod() {
    var ps = arr('periods').filter(function (p) { return p.kind === 'eval' && p.status !== 'closed'; });
    return ps[0] || null;
  }
  /* "FY2026 상반기" → "2026년 상반기" (기계 표기를 사람 말로) */
  function periodKr(label) {
    var m = /FY(\d{4})\s*(상반기|하반기)/.exec(String(label || ''));
    return m ? (m[1] + '년 ' + m[2]) : String(label || '');
  }
  function statusIndex() {
    var m = {};
    arr('evalStatus').forEach(function (s) { m[s.emp_id] = s; });
    return m;
  }
  /* manager_id 기준 직속 팀원 — tx_fix_appr.js:reportsOf 와 같은 원천 규칙 */
  function directReports(emp) { return arr('employees').filter(function (e) { return e.manager_id === emp.emp_id; }); }

  /* --- 평가-구성원-01 : 자기평가 제출 기한 임박·지남 --------------------- */
  E.registerEval('평가-구성원-01', function (ctx) {
    var SID = '평가-구성원-01';
    var per = curPeriod();
    var vs = statusIndex()[ctx.emp.emp_id] || null;
    var submitted = !!(vs && vs.self_submitted_at);
    var due = vs ? vs.due_self : (per ? per.due : null);
    var dleft = dayLeft(due);
    var periodLabel = per ? periodKr(per.label) : (vs ? periodKr(vs.period) : '');
    var myCkN = ctx.myCks.length, myKrN = ctx.myKrs.length;
    var TH = thv(SID, 'TH-자기평가마감임박-구성원', 5);
    var hit = !submitted && dleft != null && dleft <= TH;
    var facts = { submitted: submitted, due: due, daysLeft: dleft, periodLabel: periodLabel, myCkN: myCkN, myKrN: myKrN };
    var spec = {};
    if (dleft != null) spec[0] = { m: [['2026년 8월 10일', String(due)], ['5일', dleft + '일']], emph: dleft + '일',
                                   src: '평가 기간 일정 / ' + (per ? per.period_id : '기간 미상') };
    spec[1] = submitted
      ? { m: [['제출한 기록이 없어요', '이미 제출했어요'], ['2026년 2분기(4~6월)', periodLabel]], emph: '이미 제출했어요',
          src: 'evalStatus.self_submitted_at / ' + ctx.emp.emp_id }
      : { m: [['2026년 2분기(4~6월)', periodLabel]], emph: '없어요', src: 'evalStatus.self_submitted_at / ' + ctx.emp.emp_id };
    if (dleft != null && dleft === TH) spec[2] = { ok: 1, src: 'HR 평가 운영 기준(신설 예정)' };
    spec[3] = { m: [['체크인 2건', '체크인 ' + myCkN + '건'], ['핵심결과 4건', '핵심결과 ' + myKrN + '건']],
                emph: myCkN + '건 · ' + myKrN + '건', src: 'checkins × keyResults (' + ctx.emp.emp_id + ')' };
    return {
      hit: hit, facts: facts,
      notice: dleft != null ? (submitted ? [['5일', dleft + '일'], ['제출 기록이 0건이에요', '제출을 이미 마쳤어요']] : [['5일', dleft + '일']]) : [],
      ev: spec,
      th: { 'TH-자기평가마감임박-구성원': (dleft == null ? null : dleft + '일'), 'TH-자기평가-미제출': submitted ? '1건' : '0건' }
    };
  });

  /* --- 평가-구성원-03 : 자기평가에 달성 수치 인용 없는 항목 --------------- */
  E.registerEval('평가-구성원-03', function (ctx) {
    var SID = '평가-구성원-03';
    var se = arr('selfEval').filter(function (s) { return s.emp_id === ctx.emp.emp_id; })[0] || null;
    if (!se) return { hit: false, facts: {}, ev: {}, th: {} };
    var items = se.items || [], n = items.length;
    var noNum = items.filter(function (it) { return !it.has_number; });
    var wsum = 0;
    noNum.forEach(function (it) { var k = krById(it.kr_id); if (k) wsum += num(k.weight); });
    var THn = thv(SID, 'TH-자기평가근거-미기재', 1);
    var hit = n > 0 && noNum.length >= THn;
    var facts = { itemN: n, noNumN: noNum.length, wsum: r0(wsum), period: se.period };
    var spec = {};
    spec[0] = { m: [['5개', n + '개'], ['3개', noNum.length + '개']], emph: noNum.length + '개', src: se.self_id + ' / selfEval.items' };
    spec[1] = { m: [['3개', noNum.length + '개'], ['65%', r0(wsum) + '%']], emph: r0(wsum) + '%',
                src: noNum.map(function (it) { return it.kr_id; }).join(' / ') || '해당 없음' };
    spec[2] = { ok: 1, src: '자기평가 작성 기준(신설 예정)' };
    spec[3] = { m: [['체크인 2건과 핵심결과 진척 4건이 이미 있어요',
                     '체크인 ' + ctx.myCks.length + '건과 핵심결과 진척 ' + ctx.myKrs.length + '건이 ' + (ctx.myCks.length ? '이미 있어요' : '부족해요')]],
                emph: ctx.myCks.length ? '이미 있어요' : '부족해요', src: 'checkins × keyResults (' + ctx.emp.emp_id + ')' };
    return {
      hit: hit, facts: facts,
      notice: [['5개', n + '개'], ['3개', noNum.length + '개']],
      ev: spec,
      th: { 'TH-자기평가근거-미기재': noNum.length + '개', 'TH-미기재가중치-합': r0(wsum) + '%' }
    };
  });

  /* --- 평가-구성원-07 : 자기평가 서술 공백 핵심결과 ----------------------- */
  E.registerEval('평가-구성원-07', function (ctx) {
    var SID = '평가-구성원-07';
    var se = arr('selfEval').filter(function (s) { return s.emp_id === ctx.emp.emp_id; })[0] || null;
    if (!se) return { hit: false, facts: {}, ev: {}, th: {} };
    var items = se.items || [];
    var thinN = se.thin_count || 0;
    /* 어떤 항목이 「빈」 항목인지는 원천에 표시가 없다 — char_len 오름차순 상위 thin_count 건을 그 대상으로 잡는다 */
    var sorted = items.slice().sort(function (a, b) { return a.char_len - b.char_len; });
    var thin = sorted.slice(0, thinN);
    var wsum = 0;
    thin.forEach(function (it) { var k = krById(it.kr_id); if (k) wsum += num(k.weight); });
    var vs = statusIndex()[ctx.emp.emp_id] || null;
    var dleft = dayLeft(vs ? vs.due_self : null);
    var THn = thv(SID, 'TH-자기평가서술-공백', 1);
    var hit = thinN >= THn;
    var facts = { itemN: items.length, thinN: thinN, wsum: r0(wsum), daysLeft: dleft };
    var spec = {};
    spec[0] = { m: [['2건', thinN + '건']], emph: thinN + '건', src: se.self_id + ' / selfEval.items.char_len' };
    spec[1] = { m: [['1건', THn + '건'], ['2건', thinN + '건']], emph: thinN + '건', src: se.self_id + ' / selfEval.thin_count' };
    if (dleft != null) spec[2] = { m: [['5일', dleft + '일']], emph: dleft + '일', src: 'evalStatus.due_self / ' + ctx.emp.emp_id };
    spec[3] = { m: [['2건', thinN + '건'], ['55%', r0(wsum) + '%']], emph: r0(wsum) + '%',
                src: thin.map(function (it) { return it.kr_id; }).join(' / ') || '해당 없음' };
    return {
      hit: hit, facts: facts,
      notice: [['2건', thinN + '건']],
      ev: spec,
      th: { 'TH-자기평가서술-공백': thinN + '건', 'TH-미기재가중치-합': r0(wsum) + '%' }
    };
  });

  /* --- 평가-팀장-01 : 팀원 한 사람 평가 미작성 + 마감 임박 --------------- */
  E.registerEval('평가-팀장-01', function (ctx) {
    var SID = '평가-팀장-01';
    var team = directReports(ctx.emp);
    if (!team.length) return { hit: false, facts: {}, ev: {}, th: {} };
    var st = statusIndex();
    var missing = team.filter(function (e) { var s = st[e.emp_id]; return !s || !s.first_submitted_at; });
    var vs0 = st[team[0].emp_id] || null;
    var dleft = dayLeft(vs0 ? vs0.due_first : null);
    var target = missing[0] || null;
    var TH = thv(SID, 'TH-마감임박-평가작성', 5);
    var hit = missing.length >= 1 && dleft != null && dleft <= TH;
    var facts = { teamN: team.length, missingN: missing.length, targetName: target ? target.name : '', daysLeft: dleft };
    var spec = {};
    spec[0] = { m: [['9명', team.length + '명'], ['3명분', missing.length + '명분']], emph: missing.length + '명분',
                src: ctx.emp.org_id + ' / 팀원 ' + team.length + '명' };
    if (target) spec[1] = { m: [['{{팀원명}}님의 평가가 아직 작성되지 않았어요', target.name + '님의 평가가 아직 작성되지 않았어요']],
                            emph: '작성되지 않았어요', src: target.emp_id + ' / evalStatus.first_submitted_at' };
    if (dleft != null) spec[2] = { m: [['5일', dleft + '일']], emph: dleft + '일', src: '평가 기간 FY2026 파생 일정' };
    if (dleft != null && dleft === TH) spec[3] = { ok: 1, src: 'HR 평가 운영 기준(신설 예정)' };
    return {
      hit: hit, facts: facts,
      notice: (target && dleft != null) ? [['5일', dleft + '일'], ['{{팀원명}}', target.name]] : [],
      ev: spec,
      th: { 'TH-마감임박-평가작성': (dleft == null ? null : dleft + '일'), 'TH-평가작성-없음': missing.length + '건' }
    };
  });

  /* --- 평가-팀장-06 : 팀 등급이 한 등급에 쏠림 --------------------------- */
  E.registerEval('평가-팀장-06', function (ctx) {
    var SID = '평가-팀장-06';
    var team = directReports(ctx.emp);
    var evalByEmp = {}; arr('evaluations').forEach(function (e) { evalByEmp[e.emp_id] = e; });
    var graded = team.map(function (e) { return evalByEmp[e.emp_id]; }).filter(function (x) { return !!x; });
    var MINPOP = thv(SID, 'TH-모집단-등급분포', 8);
    var dist = {}, i;
    graded.forEach(function (e) { dist[e.grade] = (dist[e.grade] || 0) + 1; });
    var domGrade = null;
    for (var g in dist) if (has(dist, g)) { if (!domGrade || dist[g] > dist[domGrade]) domGrade = g; }
    var domN = domGrade ? dist[domGrade] : 0;
    var domPct = graded.length ? r0(domN / graded.length * 100) : 0;
    var topN = (dist.S || 0) + (dist.A || 0);
    var topPct = graded.length ? r0(topN / graded.length * 100) : 0;
    var coDist = {}; arr('evaluations').forEach(function (e) { coDist[e.grade] = (coDist[e.grade] || 0) + 1; });
    var coTotal = arr('evaluations').length;
    var coTopPct = coTotal ? r1(((coDist.S || 0) + (coDist.A || 0)) / coTotal * 100) : 0;
    var gap = r1(topPct - coTopPct);
    var THconc = thv(SID, 'TH-등급집중-초과', 65);
    var THgap = thv(SID, 'TH-상위등급편차-초과', 15);
    var hit = graded.length >= MINPOP && domPct >= THconc && gap >= THgap;
    var facts = { teamN: team.length, gradedN: graded.length, minPop: MINPOP, domGrade: domGrade || '', domN: domN,
                  domPct: domPct, topPct: topPct, coTopPct: coTopPct, gap: gap };
    var spec = {};
    var distStr = [];
    for (var g2 in dist) if (has(dist, g2)) distStr.push(g2 + '등급이 ' + dist[g2] + '명');
    spec[0] = { m: [['9명', team.length + '명'], ['A등급이 6명, S등급이 1명, B등급이 2명', distStr.join(', ') || '평가 기록 없음']],
                emph: domN + '명', src: ctx.emp.org_id + ' / 팀원 ' + team.length + '명' };
    spec[1] = { m: [['67%', domPct + '%'], ['65%', THconc + '%']], emph: domPct + '%', src: ctx.emp.org_id + ' / 등급 분포' };
    spec[2] = { m: [['78%', topPct + '%']], emph: topPct + '%', src: ctx.emp.org_id + ' / 등급 분포' };
    spec[3] = { m: [['53.8%', pn(coTopPct) + '%'], ['24.2%p', pn(gap) + '%p']], emph: pn(gap) + '%p', src: '전사 평가 ' + coTotal + '건' };
    return {
      hit: hit, facts: facts,
      notice: domGrade ? [['9명', team.length + '명'], ['6명', domN + '명'], ['A등급', domGrade + '등급'], ['67%', domPct + '%']] : [],
      ev: spec,
      th: { 'TH-등급집중-초과': domPct + '%', 'TH-상위등급편차-초과': pn(gap) + '%p', 'TH-모집단-등급분포': graded.length + '명' }
    };
  });

  /* --- 평가-팀장-09 : 팀원 다수 평가 미작성 + 마감 임박 ------------------ */
  E.registerEval('평가-팀장-09', function (ctx) {
    var SID = '평가-팀장-09';
    var team = directReports(ctx.emp);
    if (!team.length) return { hit: false, facts: {}, ev: {}, th: {} };
    var st = statusIndex();
    var missing = team.filter(function (e) { var s = st[e.emp_id]; return !s || !s.first_submitted_at; });
    var pct = r0(missing.length / team.length * 100);
    var vs0 = st[team[0].emp_id] || null;
    var dleft = dayLeft(vs0 ? vs0.due_first : null);
    var THrate = thv(SID, 'TH-미작성인원-초과', 30);
    var THday = thv(SID, 'TH-마감임박-평가작성', 5);
    var hit = missing.length >= 1 && pct >= THrate && dleft != null && dleft <= THday;
    var facts = { teamN: team.length, missingN: missing.length, missingPct: pct, daysLeft: dleft };
    var spec = {};
    spec[0] = { m: [['9명', team.length + '명'], ['4명', missing.length + '명']], emph: missing.length + '명',
                src: ctx.emp.org_id + ' / 팀원 ' + team.length + '명' };
    if (dleft != null) spec[1] = { m: [['5일', dleft + '일']], emph: dleft + '일', src: '평가 기간 FY2026 파생 일정' };
    spec[2] = { m: [['44%', pct + '%'], ['30%', THrate + '%']], emph: pct + '%', src: ctx.emp.org_id + ' / 평가 저장 현황' };
    return {
      hit: hit, facts: facts,
      notice: [['5일', dleft == null ? '기간 미상' : dleft + '일'], ['9명', team.length + '명'], ['4명', missing.length + '명']],
      ev: spec,
      th: { 'TH-미작성인원-초과': pct + '%', 'TH-마감임박-평가작성': (dleft == null ? null : dleft + '일') }
    };
  });

  /* --- 평가-상위조직장-01 : 하위 팀 1차 평가 제출률 0% ------------------- */
  E.registerEval('평가-상위조직장-01', function (ctx) {
    var SID = '평가-상위조직장-01';
    var s = ctx.scope;
    if (!s) return { hit: false, facts: {}, ev: {}, th: {} };
    var st = statusIndex();
    var scopeIds = subtreeIds(s.scopeOrg.org_id);
    var scopeEmpIds = []; arr('employees').forEach(function (e) { if (scopeIds[e.org_id]) scopeEmpIds.push(e.emp_id); });
    var scopeSub = scopeEmpIds.filter(function (id) { var x = st[id]; return x && x.first_submitted_at; }).length;
    var scopeRate = scopeEmpIds.length ? r0(scopeSub / scopeEmpIds.length * 100) : 0;
    var unitRows = s.units.map(function (u) {
      var ut = subtreeIds(u.org), ids = [];
      arr('employees').forEach(function (e) { if (ut[e.org_id]) ids.push(e.emp_id); });
      var subN = ids.filter(function (id) { var x = st[id]; return x && x.first_submitted_at; }).length;
      return { org: u.org, n: ids.length, subN: subN, rate: ids.length ? r0(subN / ids.length * 100) : null, missN: ids.length - subN };
    }).filter(function (r) { return r.n > 0; });
    var badTeams = unitRows.filter(function (r) { return r.rate === 0; });
    var missSum = 0; badTeams.forEach(function (r) { missSum += r.missN; });
    var vs0 = st[scopeEmpIds[0]] || null;
    var dleft = dayLeft(vs0 ? vs0.due_first : null);
    var THday = thv(SID, 'TH-마감임박-평가제출', 2);
    var hit = badTeams.length >= 1 && dleft != null && dleft <= THday;
    var facts = { unitN: unitRows.length, scopeN: scopeEmpIds.length, badTeamN: badTeams.length, missSum: missSum,
                  scopeRate: scopeRate, daysLeft: dleft };
    var spec = {};
    spec[0] = { m: [['8개', unitRows.length + '개'], ['62명', scopeEmpIds.length + '명']], emph: scopeEmpIds.length + '명',
                src: s.srcOrg + ' / evalStatus ' + scopeEmpIds.length + '건' };
    spec[1] = { m: [['8개', unitRows.length + '개'], ['2개', badTeams.length + '개']], emph: badTeams.length + '개 팀',
                src: (badTeams.map(function (r) { return r.org; }).join(' · ') || '해당 없음') + ' / 1차 미제출' };
    spec[2] = { m: [['17건', missSum + '건']], emph: missSum + '건',
                src: (badTeams.map(function (r) { return r.org; }).join(' · ') || '해당 없음') + ' / evalStatus 미제출' };
    spec[3] = { m: [['74%', scopeRate + '%']], emph: scopeRate + '%', src: s.srcOrgIncl + ' / evalStatus ' + scopeEmpIds.length + '건' };
    return {
      hit: hit, facts: facts,
      notice: [['2일', dleft == null ? '기간 미상' : dleft + '일'], ['2개', badTeams.length + '개']],
      ev: spec,
      th: { 'TH-마감임박-평가제출': (dleft == null ? null : dleft + '일'), 'TH-팀평가제출률-저조': scopeRate + '%' }
    };
  });

  /* --- 평가-상위조직장-05 : 등급 변경 사유 공백 -------------------------- */
  E.registerEval('평가-상위조직장-05', function (ctx) {
    var SID = '평가-상위조직장-05';
    var s = ctx.scope;
    if (!s) return { hit: false, facts: {}, ev: {}, th: {} };
    var scopeIds = subtreeIds(s.scopeOrg.org_id);
    var scopeEmpIds = {}; arr('employees').forEach(function (e) { if (scopeIds[e.org_id]) scopeEmpIds[e.emp_id] = 1; });
    var gh = arr('gradeHistory').filter(function (g) { return scopeEmpIds[g.emp_id]; });
    var noReason = gh.filter(function (g) { return !g.reason; });
    var evalByEmp = {}; arr('evaluations').forEach(function (e) { evalByEmp[e.emp_id] = e; });
    var scopeGraded = [];
    for (var eid in scopeEmpIds) if (has(scopeEmpIds, eid) && evalByEmp[eid]) scopeGraded.push(evalByEmp[eid]);
    var scopeTop = scopeGraded.filter(function (e) { return e.grade === 'S' || e.grade === 'A'; }).length;
    var scopeTopPct = scopeGraded.length ? r0(scopeTop / scopeGraded.length * 100) : 0;
    var TH = thv(SID, 'TH-등급변경-사유공백', 1);
    var hit = noReason.length >= TH;
    var facts = { ghN: gh.length, noReasonN: noReason.length, scopeTopPct: scopeTopPct };
    /* 원문 "바뀐 2건 모두 ~ 비어 있어요"는 noReason===gh 일 때만 성립하는 문장이라
       건수가 어긋나면(0건·일부만) 문장 자체를 실제 상태로 다시 쓴다 */
    var origPhrase = '제출 뒤 등급이 바뀐 2건 모두 변경 사유 기록이 비어 있어요';
    var phrase;
    if (!gh.length) phrase = '변경 이력이 없어 등급 변경 사유를 확인할 대상이 없어요';
    else if (noReason.length === gh.length) phrase = '제출 뒤 등급이 바뀐 ' + gh.length + '건 모두 변경 사유 기록이 비어 있어요';
    else if (!noReason.length) phrase = '제출 뒤 등급이 바뀐 ' + gh.length + '건 모두 변경 사유가 채워져 있어요';
    else phrase = '제출 뒤 등급이 바뀐 ' + gh.length + '건 중 ' + noReason.length + '건은 변경 사유 기록이 비어 있어요';
    var spec = {};
    spec[0] = { m: [['1차 평가자 한 명이 제출한 평가 11건', s.scopeOrg.org_id + ' 범위의 평가 변경 ' + gh.length + '건']],
                emph: gh.length + '건', src: s.srcOrgIncl + ' / gradeHistory ' + gh.length + '건' };
    spec[1] = { m: [[origPhrase, phrase]], emph: noReason.length + '건',
                src: s.scopeOrg.org_id + ' / gradeHistory 사유 공백 ' + noReason.length + '건' };
    spec[3] = { m: [['82%', scopeTopPct + '%']], emph: scopeTopPct + '%', src: s.scopeOrg.org_id + ' / evaluations 등급' };
    return {
      hit: hit, facts: facts,
      notice: [[origPhrase, phrase]],
      ev: spec,
      th: { 'TH-등급변경-사유공백': noReason.length + '건' }
    };
  });

  /* --- 평가-상위조직장-08 : 2차 확정 대기 쌓임 --------------------------- */
  E.registerEval('평가-상위조직장-08', function (ctx) {
    var SID = '평가-상위조직장-08';
    var s = ctx.scope;
    if (!s) return { hit: false, facts: {}, ev: {}, th: {} };
    var st = statusIndex();
    var scopeIds = subtreeIds(s.scopeOrg.org_id);
    var scopeEmpIds = []; arr('employees').forEach(function (e) { if (scopeIds[e.org_id]) scopeEmpIds.push(e.emp_id); });
    var scopeStatus = scopeEmpIds.map(function (id) { return st[id]; }).filter(function (x) { return !!x; });
    var pending = scopeStatus.filter(function (x) { return x.first_submitted_at && !x.second_confirmed_at; });
    var pendingOrgIds = {};
    pending.forEach(function (x) { var e = empById(x.emp_id); if (e) pendingOrgIds[e.org_id] = 1; });
    var pendingTeamN = 0;
    s.units.forEach(function (u) {
      var ut = subtreeIds(u.org), hitTeam = false;
      for (var oid in pendingOrgIds) if (has(pendingOrgIds, oid) && ut[oid]) { hitTeam = true; break; }
      if (hitTeam) pendingTeamN++;
    });
    var confirmed = scopeStatus.filter(function (x) { return x.second_confirmed_at; }).length;
    var confirmRate = scopeStatus.length ? r0(confirmed / scopeStatus.length * 100) : 0;
    var coConfirmed = arr('evalStatus').filter(function (x) { return x.second_confirmed_at; }).length;
    var coTotal = arr('evalStatus').length;
    var coRate = coTotal ? r0(coConfirmed / coTotal * 100) : 0;
    var vs0 = scopeStatus[0] || null;
    var dleft = dayLeft(vs0 ? vs0.due_second : null);
    var THday = thv(SID, 'TH-마감임박-2차확정', 4);
    var THn = thv(SID, 'TH-2차확정-대기건수', 10);
    var hit = pending.length >= THn && dleft != null && dleft <= THday;
    var facts = { scopeN: scopeStatus.length, pendingN: pending.length, pendingTeamN: pendingTeamN,
                  confirmRate: confirmRate, coRate: coRate, daysLeft: dleft };
    var spec = {};
    spec[0] = { m: [['62건', scopeStatus.length + '건']], emph: scopeStatus.length + '건',
                src: s.srcOrgIncl + ' / evalStatus ' + scopeStatus.length + '건' };
    spec[1] = { m: [['18건', pending.length + '건']], emph: pending.length + '건',
                src: s.scopeOrg.org_id + ' / evalStatus 2차 대기 ' + pending.length + '건' };
    spec[2] = { m: [['8개', s.unitN + '개'], ['5개', pendingTeamN + '개']], emph: pendingTeamN + '개 팀',
                src: s.srcOrg + ' / 대기 ' + pending.length + '건 분포' };
    spec[3] = { m: [['71%', confirmRate + '%'], ['84%', coRate + '%']], emph: confirmRate + '%',
                src: s.scopeOrg.org_id + ' / evalStatus ' + scopeStatus.length + '건' };
    return {
      hit: hit, facts: facts,
      notice: [['4일', dleft == null ? '기간 미상' : dleft + '일'], ['18건', pending.length + '건']],
      ev: spec,
      th: { 'TH-마감임박-2차확정': (dleft == null ? null : dleft + '일'), 'TH-2차확정-대기건수': pending.length + '건' }
    };
  });

  /* --- 평가-HR경영진-01 : 전사 1차 평가 제출률 미달 ---------------------- */
  E.registerEval('평가-HR경영진-01', function (ctx) {
    var SID = '평가-HR경영진-01';
    var vs = arr('evalStatus');
    var total = vs.length;
    var subN = vs.filter(function (x) { return x.first_submitted_at; }).length;
    var rate = total ? r0(subN / total * 100) : 0;
    var empOrg = {}; arr('employees').forEach(function (e) { empOrg[e.emp_id] = e.org_id; });
    var byOrg = {};
    vs.forEach(function (x) { var o = empOrg[x.emp_id] || '?'; (byOrg[o] = byOrg[o] || []).push(x); });
    var lowOrgs = 0;
    for (var o in byOrg) if (has(byOrg, o)) {
      var list = byOrg[o], s2 = list.filter(function (x) { return x.first_submitted_at; }).length;
      if ((s2 / list.length * 100) < 50) lowOrgs++;
    }
    var vs0 = vs[0] || null;
    var dleft = dayLeft(vs0 ? vs0.due_first : null);
    var THrate = thv(SID, 'TH-전사제출률-미달', 85);
    var hit = rate < THrate;
    var orgN = Object.keys(byOrg).length;
    var facts = { total: total, subN: subN, rate: rate, orgN: orgN, lowOrgs: lowOrgs, daysLeft: dleft };
    var spec = {};
    spec[0] = { m: [['221명', total + '명'], ['38개', orgN + '개']], emph: total + '명', src: 'evalStatus ' + total + '건 / orgs ' + orgN + '개' };
    spec[1] = { m: [['2일', dleft == null ? '기간 미상' : dleft + '일'], ['52%', rate + '%']], emph: rate + '%',
                src: 'evalStatus.first_submitted_at (' + total + '건)' };
    spec[2] = { m: [['5곳', lowOrgs + '곳']], emph: lowOrgs + '곳', src: 'evalStatus 조직별 집계 (' + orgN + '개)' };
    spec[3] = { m: [['85%', THrate + '%'], ['33%p', pn(THrate - rate) + '%p']], emph: pn(THrate - rate) + '%p',
                src: '제도 기준값 원천(신설 대상)' };
    return {
      hit: hit, facts: facts,
      notice: [['2일', dleft == null ? '기간 미상' : dleft + '일'], ['52%', rate + '%'], ['85%', THrate + '%']],
      ev: spec,
      th: { 'TH-전사제출률-미달': THrate + '%', 'TH-조직제출률-미달': '50%', 'TH-저조직-건수': lowOrgs + '곳' }
    };
  });

  /* --- 평가-HR경영진-10 : 체크인 0건인데 등급 받은 인원 ------------------ */
  E.registerEval('평가-HR경영진-10', function (ctx) {
    var SID = '평가-HR경영진-10';
    var ckByEmp = {}; arr('checkins').forEach(function (c) { ckByEmp[c.emp_id] = (ckByEmp[c.emp_id] || 0) + 1; });
    var evals = arr('evaluations');
    var zero = evals.filter(function (e) { return !ckByEmp[e.emp_id]; });
    var pct = evals.length ? r0(zero.length / evals.length * 100) : 0;
    var THn = thv(SID, 'TH-근거기록없는평가-인원', 20);
    var hit = zero.length >= THn;
    var ckTotal = arr('checkins').length;
    var ratio = zero.length ? Math.max(1, Math.round(evals.length / zero.length)) : 0;
    var facts = { evalN: evals.length, ckN: ckTotal, zeroN: zero.length, zeroPct: pct };
    var spec = {};
    spec[0] = { m: [['221건', evals.length + '건'], ['360건', ckTotal + '건']], emph: evals.length + '건',
                src: 'evaluations ' + evals.length + '건 / checkins ' + ckTotal + '건' };
    spec[1] = { m: [['74명', zero.length + '명']], emph: zero.length + '명', src: 'checkins × evaluations.emp_id (' + evals.length + '건)' };
    spec[2] = { m: [['221건', evals.length + '건'], ['74명', zero.length + '명'], ['셋 중 한 명꼴', '약 ' + ratio + '명 중 1명꼴']],
                emph: '약 ' + ratio + '명 중 1명꼴', src: '평가·체크인 전사 집계' };
    spec[3] = { ok: 1, src: 'evaluations.rationale_summary' };
    return {
      hit: hit, facts: facts,
      notice: [['221건', evals.length + '건'], ['74명', zero.length + '명']],
      ev: spec,
      th: { 'TH-근거기록없는평가-비율': pct + '%', 'TH-근거기록없는평가-인원': zero.length + '명' }
    };
  });
})();
