/* js/ez_signal_eval2.js — 신호 판정 함수 A조 (20-4차)
   담당 A · 목표수립 38건 중 EVAL 이 아직 없던 신호에 판정을 붙인다.
   이 파일이 등록하는 것 밖에는 아무 것도 건드리지 않는다 (index.html·엔진·데이터 포함 금지).
   ES5 IIFE · zero-dep · 실패해도 던지지 않는다. */
(function () {
  'use strict';
  var E = window.EZSignalEngine;
  if (!E || !E.registerEval) return;          /* 엔진 없으면 조용히 아무 것도 안 한다 */
  var Hp = E.helpers || {};
  function arr(k) { return (Hp.arr ? Hp.arr(k) : []) || []; }
  function data() { return (Hp.data ? Hp.data() : {}) || {}; }
  var r0 = Hp.r0 || Math.round;
  var pn = Hp.pn || String;
  var thv = Hp.thv || function (id, code, fb) { return fb; };
  var asof = Hp.asof || function () { return '2026-07-16'; };
  var asofMs = Hp.asofMs || function () { return Date.parse(asof() + 'T00:00:00Z'); };
  var co = Hp.co || function () { return {}; };

  /* ---- 이 파일만 쓰는 작은 도구 ---- */
  function dnum(s) { var t = Date.parse(String(s || '')); return isNaN(t) ? null : t; }
  function elapsedDays(iso) { var t = dnum(iso); return t == null ? null : Math.floor((asofMs() - t) / 86400000); }
  function krDate(s) {
    var t = dnum(String(s || '').slice(0, 10) + 'T00:00:00Z');
    if (t == null) return String(s || '');
    var d = new Date(t);
    return d.getUTCFullYear() + '년 ' + (d.getUTCMonth() + 1) + '월 ' + d.getUTCDate() + '일';
  }
  function goalPeriod() {
    var ps = arr('periods').filter(function (p) { return p.kind === 'goal' && p.status !== 'closed'; });
    return ps[0] || null;
  }
  function taskAreaN(jp) {
    var n = 0, k;
    if (jp && jp.tasks) for (k in jp.tasks) if (Object.prototype.hasOwnProperty.call(jp.tasks, k)) n++;
    return n;
  }
  function orgGoalObj(orgId) {
    var os = arr('objectives'), i;
    for (i = 0; i < os.length; i++) if (os[i].org_id === orgId && os[i].type === '조직') return os[i];
    return null;
  }
  function krsOf(oid) { return arr('keyResults').filter(function (k) { return k.objective_id === oid; }); }
  function reportsOf(mgrId) { return arr('employees').filter(function (e) { return e.manager_id === mgrId; }); }

  /* ===================================================================
     목표수립-구성원-01 : 목표 확정 마감 임박 + 저장 목표 0건
     =================================================================== */
  E.registerEval('목표수립-구성원-01', function (ctx) {
    var SID = '목표수립-구성원-01';
    var per = goalPeriod();
    var objN = ctx.myObjs.length;
    var daysLeft = per ? per.days_left : null;
    var goalMin = (data().policy && data().policy.goal_count_per_period) || 3;
    var jp = ctx.jp, areas = taskAreaN(jp);
    var orgObj = orgGoalObj(ctx.emp.org_id);
    var facts = { objN: objN, daysLeft: daysLeft, goalMin: goalMin, areas: areas,
                  confirmDue: per ? per.confirm_due : null, orgObjTitle: orgObj ? orgObj.title : '' };
    if (per == null) return { hit: false, facts: facts, ev: {}, th: {} };
    var TH1 = thv(SID, 'TH-목표마감임박-구성원', 3);
    var hit = daysLeft != null && daysLeft <= TH1 && objN <= thv(SID, 'TH-목표저장-없음', 0);
    var spec = {};
    spec[0] = { m: [['0건', objN + '건']], emph: objN + '건', src: ctx.emp.emp_id + ' / objectives.owner_emp_id' };
    spec[1] = { m: [['2026년 8월 15일', krDate(per.confirm_due)], ['3일', daysLeft + '일']],
                emph: daysLeft + '일', src: per.period_id + ' / ' + per.label };
    spec[2] = { m: [['3건', goalMin + '건'], ['0건', objN + '건']], emph: objN + '건',
                src: 'policy.goal_count_per_period' };
    if (areas > 0) spec[3] = { m: [['서비스기획담당', ctx.emp.jobTitle || ''], ['5개', areas + '개'],
                    ['FY2026 2Q Package BG 사업 성과 극대화', orgObj ? orgObj.title : '없음']],
                emph: areas + '개', src: (jp && jp.job_id || ctx.emp.jobProfileId) + (orgObj ? ' / ' + orgObj.objective_id : '') };
    return {
      hit: hit, facts: facts,
      notice: [['3일', daysLeft + '일'], ['0건', objN + '건']],
      ev: spec,
      th: { 'TH-목표마감임박-구성원': daysLeft + '일', 'TH-목표저장-없음': objN + '건' }
    };
  });

  /* ===================================================================
     목표수립-구성원-02 : 목표 저장 뒤 경과 + 핵심결과 0건
     =================================================================== */
  E.registerEval('목표수립-구성원-02', function (ctx) {
    var SID = '목표수립-구성원-02';
    if (!ctx.myObjs.length) return { hit: false, facts: {}, ev: {}, th: {} };
    var obj = ctx.myObjs[0], krs = krsOf(obj.objective_id), krN = krs.length;
    var C = co(), elapsed = elapsedDays(obj.created_at);
    var avgKr = C.objTotal ? C.krTotal / C.objTotal : 0;
    var facts = { objTitle: obj.title, krN: krN, elapsed: elapsed, coAvg: pn(avgKr), coObjTotal: C.objTotal, coKrTotal: C.krTotal };
    if (elapsed == null) return { hit: false, facts: facts, ev: {}, th: {} };
    var hit = krN <= 0 && elapsed >= thv(SID, 'TH-핵심결과공백-구성원', 7);
    var spec = {};
    spec[0] = { m: [['{{목표명}}', obj.title], ['0건', krN + '건']], emph: krN + '건', src: obj.objective_id };
    spec[1] = { m: [['40건', C.objTotal + '건']], emph: '평균 ' + pn(avgKr) + '건',
                src: 'keyResults ' + C.krTotal + '건 / objectives ' + C.objTotal + '건' };
    spec[2] = (krN > 0)
      ? { text: '목표를 저장한 뒤 ' + elapsed + '일 동안 핵심결과 ' + krN + '건이 이미 붙었어요', emph: krN + '건', src: obj.objective_id }
      : { m: [['10일', elapsed + '일']], emph: elapsed + '일', src: obj.objective_id };
    return {
      hit: hit, facts: facts,
      notice: [['10일', elapsed + '일'], ['0건', krN + '건']],
      ev: spec,
      th: { 'TH-핵심결과공백-구성원': elapsed + '일', 'TH-핵심결과-없음': krN + '건' }
    };
  });

  /* ===================================================================
     목표수립-구성원-03 : 핵심결과 가중치 합 이탈
     =================================================================== */
  E.registerEval('목표수립-구성원-03', function (ctx) {
    var SID = '목표수립-구성원-03';
    if (!ctx.myObjs.length) return { hit: false, facts: {}, ev: {}, th: {} };
    var obj = ctx.myObjs[0], krs = krsOf(obj.objective_id);
    if (!krs.length) return { hit: false, facts: { objTitle: obj.title, krN: 0 }, ev: {}, th: {} };
    var ws = krs.map(function (k) { return parseFloat(k.weight) || 0; });
    var sum = ws.reduce(function (a, b) { return a + b; }, 0);
    var wmin = Math.min.apply(null, ws), wmax = Math.max.apply(null, ws);
    var standard = (data().policy && data().policy.kr_weight_sum) || 100;
    var gap = standard - sum;
    var C = co();
    /* 전사 목표별 가중치 합이 모두 기준과 같은지 실측 */
    var offCount = 0;
    arr('objectives').forEach(function (o) {
      var s2 = krsOf(o.objective_id).reduce(function (a, k) { return a + (parseFloat(k.weight) || 0); }, 0);
      if (krsOf(o.objective_id).length && s2 !== standard) offCount++;
    });
    var facts = { objTitle: obj.title, krN: krs.length, sum: sum, wmin: wmin, wmax: wmax, gap: gap,
                  standard: standard, coObjTotal: C.objTotal, offCount: offCount };
    var hit = Math.abs(gap) >= thv(SID, 'TH-가중치합-이탈', 5);
    var spec = {};
    spec[0] = { m: [['4건', krs.length + '건'], ['85%', sum + '%']], emph: sum + '%',
                src: obj.objective_id + ' / ' + krs[0].kr_id };
    spec[1] = { m: [['15%', wmin + '%'], ['40%', wmax + '%']], emph: wmax + '%', src: krs[0].kr_id };
    spec[2] = (offCount === 0)
      ? { text: '전사 목표 ' + C.objTotal + '건은 모두 가중치 합이 정확히 ' + standard + '%예요', emph: '정확히 ' + standard + '%',
          src: 'keyResults ' + C.krTotal + '건 / objectives ' + C.objTotal + '건' }
      : { m: [['40건', C.objTotal + '건']], emph: offCount + '건 이탈', src: 'objectives 가중치 합 검증' };
    return {
      hit: hit, facts: facts,
      notice: [['85%', sum + '%'], ['15%p', Math.abs(gap) + '%p']],
      ev: spec,
      th: { 'TH-가중치합-이탈': Math.abs(gap) + '%p' }
    };
  });

  /* ===================================================================
     목표수립-구성원-06 : 목표 확정 임박 + 상위 목표 연결 공백
     =================================================================== */
  E.registerEval('목표수립-구성원-06', function (ctx) {
    var SID = '목표수립-구성원-06';
    var per = goalPeriod();
    if (per == null) return { hit: false, facts: {}, ev: {}, th: {} };
    var objN = ctx.myObjs.length;
    var noParent = ctx.myObjs.filter(function (o) { return !o.parent_objective_id; });
    var daysLeft = per.days_left;
    var C = co();
    var linkedN = arr('objectives').filter(function (o) { return !!o.parent_objective_id; }).length;
    var linkPct = C.objTotal ? r0(linkedN / C.objTotal * 100) : 0;
    var facts = { objN: objN, noParentN: noParent.length, daysLeft: daysLeft,
                  linkedN: linkedN, coObjTotal: C.objTotal, linkPct: linkPct };
    var hit = daysLeft != null && daysLeft <= thv(SID, 'TH-목표마감임박-구성원', 3)
      && noParent.length >= thv(SID, 'TH-상위목표-미연결', 1);
    var spec = {};
    if (noParent.length > 0) {
      spec[0] = { m: [['1건', noParent.length + '건']], emph: '비어 있어요', src: noParent[0].objective_id };
    } else if (objN > 0) {
      var p0 = arr('objectives').filter(function (o) { return o.objective_id === ctx.myObjs[0].parent_objective_id; })[0];
      spec[0] = { text: '내 목표 ' + objN + '건 모두 상위 목표' + (p0 ? '「' + p0.title + '」에' : '에') + ' 연결돼 있어요',
                  emph: '모두 연결', src: ctx.myObjs[0].objective_id };
    }
    spec[1] = { m: [['2026년 8월 15일', krDate(per.confirm_due)], ['3일', daysLeft + '일']],
                emph: daysLeft + '일', src: per.period_id };
    spec[2] = { m: [['40건', C.objTotal + '건'], ['38건(95%)', linkedN + '건(' + linkPct + '%)']],
                emph: linkedN + '건(' + linkPct + '%)', src: 'objectives.parent_objective_id' };
    return {
      hit: hit, facts: facts,
      notice: [['3일', daysLeft + '일'], ['1건', noParent.length + '건']],
      ev: spec,
      th: { 'TH-목표마감임박-구성원': daysLeft + '일', 'TH-상위목표-미연결': noParent.length + '건' }
    };
  });

  /* ===================================================================
     목표수립-구성원-07 : 핵심결과 건수 부족 + 경과일
     =================================================================== */
  E.registerEval('목표수립-구성원-07', function (ctx) {
    var SID = '목표수립-구성원-07';
    if (!ctx.myObjs.length) return { hit: false, facts: {}, ev: {}, th: {} };
    var obj = ctx.myObjs[0], krN = krsOf(obj.objective_id).length;
    var C = co(), elapsed = elapsedDays(obj.created_at);
    var avgKr = C.objTotal ? C.krTotal / C.objTotal : 0;
    var minKr = (data().policy && data().policy.kr_count_per_objective && data().policy.kr_count_per_objective.min) || 2;
    var facts = { objTitle: obj.title, krN: krN, elapsed: elapsed, coAvg: pn(avgKr), minKr: minKr };
    if (elapsed == null) return { hit: false, facts: facts, ev: {}, th: {} };
    var hit = krN < minKr && krN >= 1 && elapsed >= thv(SID, 'TH-핵심결과공백-구성원', 7);
    var spec = {};
    spec[0] = { m: [['{{목표명}}', obj.title], ['1건', krN + '건']], emph: krN + '건', src: obj.objective_id };
    spec[1] = { m: [['40건', C.objTotal + '건']], emph: '평균 ' + pn(avgKr) + '건',
                src: 'keyResults ' + C.krTotal + '건 / objectives ' + C.objTotal + '건' };
    spec[2] = (krN >= minKr)
      ? { text: '목표를 저장한 뒤 ' + elapsed + '일 동안 핵심결과가 ' + krN + '건으로 늘었어요', emph: krN + '건', src: obj.objective_id }
      : { m: [['10일', elapsed + '일']], emph: elapsed + '일', src: obj.objective_id };
    return {
      hit: hit, facts: facts,
      notice: [['1건', krN + '건'], ['10일', elapsed + '일']],
      ev: spec,
      th: { 'TH-핵심결과부족-구성원': minKr + '건', 'TH-핵심결과공백-구성원': elapsed + '일' }
    };
  });

  /* ===================================================================
     목표수립-팀장-01 : 목표수립 마감 임박 + 팀원 한 명 목표 0건
     =================================================================== */
  E.registerEval('목표수립-팀장-01', function (ctx) {
    var SID = '목표수립-팀장-01';
    var per = goalPeriod();
    var reports = reportsOf(ctx.emp.emp_id);
    var teamN = reports.length;
    if (!teamN || per == null) return { hit: false, facts: {}, ev: {}, th: {} };
    var zeros = reports.filter(function (e) { return arr('objectives').filter(function (o) { return o.owner_emp_id === e.emp_id; }).length === 0; });
    var daysLeft = per.days_left;
    var target = zeros[0] || null;
    var facts = { teamN: teamN, zeroN: zeros.length, daysLeft: daysLeft, targetName: target ? target.name : '' };
    var hit = !!target && daysLeft != null && daysLeft <= thv(SID, 'TH-마감임박-목표수립', 5);
    var dueStr = per.due ? per.due.slice(0, 10) : '';
    var spec = {};
    spec[0] = { m: [['9명', teamN + '명'], ['1명', zeros.length + '명']], emph: zeros.length + '명',
                src: ctx.emp.org_id + (target ? ' / ' + target.emp_id : '') };
    if (target) spec[1] = { m: [['{{팀원명}}', target.name], ['0건', '0건']], emph: '0건', src: target.emp_id + ' / 저장 목표 0건' };
    spec[2] = { m: [['2026-07-31', dueStr], ['5일', daysLeft + '일']], emph: daysLeft + '일', src: per.period_id + ' 파생 일정' };
    spec[3] = { m: [['9명', teamN + '명'], ['8명', (teamN - zeros.length) + '명']], src: '팀원별 저장 목표 건수' };
    return {
      hit: hit, facts: facts,
      notice: [['5일', daysLeft + '일'], ['{{팀원명}}', target ? target.name : '팀원'], ['0건', '0건']],
      ev: spec,
      th: { 'TH-마감임박-목표수립': daysLeft + '일', 'TH-목표건수-없음': zeros.length + '건' }
    };
  });

  /* ===================================================================
     목표수립-팀장-08 : 목표수립 마감 임박 + 팀원 다수 미저장
     =================================================================== */
  E.registerEval('목표수립-팀장-08', function (ctx) {
    var SID = '목표수립-팀장-08';
    var per = goalPeriod();
    var reports = reportsOf(ctx.emp.emp_id);
    var teamN = reports.length;
    if (!teamN || per == null) return { hit: false, facts: {}, ev: {}, th: {} };
    var zeros = reports.filter(function (e) { return arr('objectives').filter(function (o) { return o.owner_emp_id === e.emp_id; }).length === 0; });
    var missPct = r0(zeros.length / teamN * 100);
    var daysLeft = per.days_left;
    /* 최근 3일 내 새로 생긴 저장(생성일 기준) */
    var recentSaves = 0;
    reports.forEach(function (e) {
      arr('objectives').filter(function (o) { return o.owner_emp_id === e.emp_id; }).forEach(function (o) {
        var ed = elapsedDays(o.created_at);
        if (ed != null && ed <= 3) recentSaves++;
      });
    });
    var facts = { teamN: teamN, missN: zeros.length, missPct: missPct, daysLeft: daysLeft, recentSaves: recentSaves };
    var TH1 = thv(SID, 'TH-마감임박-목표수립', 5), TH2 = thv(SID, 'TH-미수립인원-초과', 30);
    var hit = daysLeft != null && daysLeft <= TH1 && missPct >= TH2 && recentSaves <= thv(SID, 'TH-저장정체-없음', 0);
    var dueStr = per.due ? per.due.slice(0, 10) : '';
    var spec = {};
    spec[0] = { m: [['9명', teamN + '명'], ['4명', zeros.length + '명']], emph: zeros.length + '명',
                src: ctx.emp.org_id + ' / 팀원 ' + teamN + '명' };
    spec[1] = { m: [['2026-07-31', dueStr], ['5일', daysLeft + '일']], emph: daysLeft + '일', src: per.period_id + ' 파생 일정' };
    spec[2] = { m: [['30%', TH2 + '%'], ['9명', teamN + '명'], ['4명', zeros.length + '명'], ['44%', missPct + '%']],
                emph: missPct + '%', src: '목표 미수립 팀원 비율 기준값' };
    spec[3] = { m: [['0건', recentSaves + '건']], emph: recentSaves + '건', src: ctx.emp.org_id + ' / 팀원별 저장 목표 건수' };
    return {
      hit: hit, facts: facts,
      notice: [['5일', daysLeft + '일'], ['9명', teamN + '명'], ['4명', zeros.length + '명']],
      ev: spec,
      th: { 'TH-마감임박-목표수립': daysLeft + '일', 'TH-미수립인원-초과': missPct + '%', 'TH-저장정체-없음': recentSaves + '건' }
    };
  });

  /* ===================================================================
     목표수립-상위조직장-01 : 하위 팀 목표 수립률 저조
     =================================================================== */
  E.registerEval('목표수립-상위조직장-01', function (ctx) {
    var SID = '목표수립-상위조직장-01';
    var per = goalPeriod();
    var s = ctx.scope;
    if (!s || per == null) return { hit: false, facts: {}, ev: {}, th: {} };
    var TH = thv(SID, 'TH-팀목표수립률-저조', 30);
    var rows = s.units.map(function (u) {
      var emps = arr('employees').filter(function (e) { return e.org_id === u.org; });
      var saved = {};
      u.objs.forEach(function (o) { saved[o.owner_emp_id] = 1; });
      var savedN = Object.keys(saved).length;
      return { org: u.org, name: u.name, hc: emps.length, saved: savedN,
               rate: emps.length ? r0(savedN / emps.length * 100) : 0, zero: emps.length - savedN };
    });
    var bad = rows.filter(function (r) { return r.hc > 0 && r.rate < TH; });
    var totalHc = 0, totalSaved = 0;
    rows.forEach(function (r) { totalHc += r.hc; totalSaved += r.saved; });
    var orgAvg = totalHc ? r0(totalSaved / totalHc * 100) : 0;
    var badZero = bad.reduce(function (a, r) { return a + r.zero; }, 0);
    var badHc = bad.reduce(function (a, r) { return a + r.hc; }, 0);
    var badAvgRate = bad.length ? r0(bad.reduce(function (a, r) { return a + r.rate; }, 0) / bad.length) : 0;
    var daysLeft = per.days_left;
    var facts = { unitN: s.unitN, totalHc: totalHc, badN: bad.length, badZero: badZero,
                  badHc: badHc, orgAvg: orgAvg, badAvgRate: badAvgRate, daysLeft: daysLeft,
                  scopeOrgName: s.scopeOrg.name };
    var hit = daysLeft != null && daysLeft <= thv(SID, 'TH-마감임박-목표수립', 7) && bad.length >= 1;
    var badSrc = bad.map(function (r) { return r.org; }).join(' · ') || s.scopeOrg.org_id;
    var spec = {};
    spec[0] = { m: [['8개 팀', s.unitN + '개 팀'], ['62명', totalHc + '명']], emph: s.unitN + '개 팀',
                src: s.scopeOrg.org_id + ' 하위 ' + s.unitN + '개 팀 / 구성원 ' + totalHc + '명' };
    spec[1] = { m: [['8개 팀', s.unitN + '개 팀'], ['3개 팀', bad.length + '개 팀']], emph: bad.length + '개 팀',
                src: badSrc + ' / OBJ 집계' };
    spec[2] = { m: [['3개 팀', bad.length + '개 팀'], ['21명', badZero + '명']], emph: badZero + '명',
                src: badSrc + ' / 구성원 ' + badHc + '명' };
    spec[3] = { m: [['62%', orgAvg + '%'], ['32%p', Math.abs(orgAvg - badAvgRate) + '%p']], emph: orgAvg + '%',
                src: s.scopeOrg.org_id + ' / OBJ ' + s.unitObjN + '건' };
    return {
      hit: hit, facts: facts,
      notice: [['3일', daysLeft + '일'], ['3개 팀', bad.length + '개 팀']],
      ev: spec,
      th: { 'TH-마감임박-목표수립': daysLeft + '일', 'TH-팀목표수립률-저조': badAvgRate + '%' }
    };
  });

  /* ===================================================================
     목표수립-상위조직장-09 : 하위 조직 중 조직 목표 0건
     =================================================================== */
  E.registerEval('목표수립-상위조직장-09', function (ctx) {
    var SID = '목표수립-상위조직장-09';
    var per = goalPeriod();
    var s = ctx.scope;
    if (!s || per == null) return { hit: false, facts: {}, ev: {}, th: {} };
    var rows = s.units.map(function (u) {
      var g = orgGoalObj(u.org);
      var emps = arr('employees').filter(function (e) { return e.org_id === u.org; });
      return { org: u.org, name: u.name, hasGoal: !!g, hc: emps.length,
               objN: arr('objectives').filter(function (o) { return o.org_id === u.org && o.type === '조직'; }).length };
    });
    var missing = rows.filter(function (r) { return !r.hasGoal; });
    var rest = rows.filter(function (r) { return r.hasGoal; });
    var missHc = missing.reduce(function (a, r) { return a + r.hc; }, 0);
    var restAvg = rest.length ? r0(rest.reduce(function (a, r) { return a + r.objN; }, 0) / rest.length * 10) / 10 : 0;
    var daysLeft = per.days_left;
    var facts = { unitN: s.unitN, missN: missing.length, missHc: missHc, restN: rest.length, restAvg: pn(restAvg), daysLeft: daysLeft };
    /* TH-조직목표-부재(0건)는 조직 하나의 「목표 있음·없음」 경계값이지, 몇 곳부터 알릴지의
       기준이 아니다 — 있음·없음 게이트는 1곳 이상이면 그대로 알린다 */
    var hit = daysLeft != null && daysLeft <= thv(SID, 'TH-마감임박-목표수립', 7) && missing.length >= 1;
    var missSrc = missing.map(function (r) { return r.org; }).join(' · ') || '해당 없음';
    var spec = {};
    spec[0] = { m: [['12개 조직', s.unitN + '개 조직']], emph: s.unitN + '개 조직',
                src: s.scopeOrg.org_id + ' 하위 ' + s.unitN + '개 조직' };
    spec[1] = { m: [['12개 조직', s.unitN + '개 조직'], ['4곳', missing.length + '곳']], emph: missing.length + '곳', src: missSrc };
    if (missing.length > 0) spec[2] = { m: [['27명', missHc + '명']], emph: missHc + '명', src: missSrc + ' / 구성원 ' + missHc + '명' };
    spec[3] = { m: [['8개 조직', rest.length + '개 조직'], ['2.8건', pn(restAvg) + '건']], emph: pn(restAvg) + '건',
                src: s.scopeOrg.org_id + ' 하위 ' + rest.length + '개 조직 / OBJ 집계' };
    return {
      hit: hit, facts: facts,
      notice: [['3일', daysLeft + '일'], ['12개 조직', s.unitN + '개 조직'], ['4곳', missing.length + '곳']],
      ev: spec,
      th: { 'TH-마감임박-목표수립': daysLeft + '일', 'TH-조직목표-부재': missing.length + '곳' }
    };
  });

  /* ===================================================================
     목표수립-HR경영진-01 : 전사 목표 확정률 기준 미달
     =================================================================== */
  E.registerEval('목표수립-HR경영진-01', function (ctx) {
    var SID = '목표수립-HR경영진-01';
    var per = goalPeriod();
    if (per == null) return { hit: false, facts: {}, ev: {}, th: {} };
    var objs = arr('objectives'), orgs = arr('orgs');
    var objTotal = objs.length, confirmedN = objs.filter(function (o) { return o.confirm_status === 'confirmed'; }).length;
    var pct = objTotal ? r0(confirmedN / objTotal * 100) : 0;
    var byOrg = {};
    objs.forEach(function (o) { (byOrg[o.org_id] = byOrg[o.org_id] || []).push(o); });
    var zeroOrgs = [];
    Object.keys(byOrg).forEach(function (oid) {
      var conf = byOrg[oid].filter(function (o) { return o.confirm_status === 'confirmed'; }).length;
      if (conf === 0) zeroOrgs.push(oid);
    });
    var daysLeft = per.days_left;
    var TH90 = thv(SID, 'TH-전사확정률-미달', 90);
    var diff = Math.abs(pct - TH90);
    var facts = { objTotal: objTotal, orgTotal: orgs.length, confirmedN: confirmedN, pct: pct,
                  zeroOrgN: zeroOrgs.length, daysLeft: daysLeft, diff: diff };
    var hit = daysLeft != null && daysLeft <= thv(SID, 'TH-마감잔여-임박', 3) && pct < TH90
      && zeroOrgs.length >= thv(SID, 'TH-확정0건조직-건수', 5);
    var spec = {};
    spec[0] = { m: [['38개 조직', orgs.length + '개 조직'], ['40건', objTotal + '건']], emph: orgs.length + '개 조직',
                src: 'ORG-001~ORG-' + String(orgs.length).replace(/^(\d)$/, '0$1') + ' / OBJ ' + objTotal + '건' };
    spec[1] = { m: [['3일', daysLeft + '일'], ['68%', pct + '%']], emph: pct + '%', src: 'objectives.confirm_status' };
    spec[2] = { m: [['38개 조직', orgs.length + '개 조직'], ['9곳', zeroOrgs.length + '곳']], emph: zeroOrgs.length + '곳',
                src: zeroOrgs.join(' · ') };
    spec[3] = { m: [['90%', TH90 + '%'], ['22%p', diff + '%p']], emph: diff + '%p', src: '목표수립 운영 기준(policy)' };
    return {
      hit: hit, facts: facts,
      notice: [['3일', daysLeft + '일'], ['68%', pct + '%'], ['90%', TH90 + '%']],
      ev: spec,
      th: { 'TH-전사확정률-미달': pct + '%', 'TH-마감잔여-임박': daysLeft + '일', 'TH-확정0건조직-건수': zeroOrgs.length + '곳' }
    };
  });
})();
