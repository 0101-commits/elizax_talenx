/* js/ez_signal_eval6.js — 담당 E: 목표수립 단계 중 판정 함수가 없던 신호에 판정 등록 (20-6차)
   ------------------------------------------------------------------------
   이 파일은 `E.registerEval(id, fn)` 만 부른다. 엔진·카탈로그·데이터·화면은 건드리지 않는다.
   반환 스키마는 ez_signal_eval5.js 와 같다 — { hit, facts, notice, ev, th }.
   기준값은 전부 카탈로그 `thresholds[].code` 를 `thv(SID, code, 기본값)` 로 읽는다.
   실데이터에 없는 값은 만들지 않는다. 못 센 근거 줄은 spec 에서 비워 두어
   엔진이 「(추정)」으로 표시하게 둔다.
   ES5 IIFE · zero-dep · 실패해도 던지지 않는다.
   ------------------------------------------------------------------------ */
(function () {
  'use strict';
  var E = window.EZSignalEngine;
  if (!E || !E.registerEval) return;          /* 엔진 없으면 조용히 아무 것도 안 한다 */
  var Hp = E.helpers || {};
  function arr(k) { return (Hp.arr ? Hp.arr(k) : []) || []; }
  function data() { return (Hp.data ? Hp.data() : {}) || {}; }
  var r0 = Hp.r0 || Math.round;
  var r1 = Hp.r1 || function (v) { return Math.round(v * 10) / 10; };
  var pn = Hp.pn || String;
  var avg = Hp.avg || function (l) { return l.length ? l.reduce(function (a, b) { return a + b; }, 0) / l.length : null; };
  var thv = Hp.thv || function (id, code, fb) { return fb; };
  var asofMs = Hp.asofMs || function () { return Date.parse('2026-07-16T00:00:00Z'); };
  var co = Hp.co || function () { return {}; };
  var num = Hp.num || function (v) { var m = /(-?\d+(\.\d+)?)/.exec(String(v == null ? '' : v)); return m ? parseFloat(m[1]) : 0; };

  /* ---------- 공용 도구 ---------- */
  function dateOnly(s) { return s ? String(s).slice(0, 10) : null; }
  function dnum(s) { if (!s) return null; var t = Date.parse(String(s).slice(0, 10) + 'T00:00:00Z'); return isNaN(t) ? null : t; }
  function daysSince(s) { var t = dnum(s); return t == null ? null : Math.round((asofMs() - t) / 86400000); }
  function krsOf(oid) { return arr('keyResults').filter(function (k) { return k.objective_id === oid; }); }
  function objsOf(eid) { return arr('objectives').filter(function (o) { return o.owner_emp_id === eid; }); }
  function empById(id) { var out = null; arr('employees').forEach(function (e) { if (e.emp_id === id) out = e; }); return out; }
  function jpOf(emp) { var m = data().jobProfiles || {}; return (emp && m[emp.jobProfileId]) || null; }
  function taskAreas(jp) {
    var out = [], k;
    if (jp && jp.tasks) for (k in jp.tasks) if (Object.prototype.hasOwnProperty.call(jp.tasks, k)) out.push(k);
    return out;
  }
  /* 직무 역량 가중치 내림차순 — 엔진 compProfile 과 같은 규칙 */
  function compProfile(jp) {
    var p = (jp && Object.prototype.toString.call(jp.competency_profile) === '[object Array]') ? jp.competency_profile : [];
    return p.slice().sort(function (a, b) { return (b.weight || 0) - (a.weight || 0); });
  }
  var COMP_KR = { D1: '리더십', D2: '협업', D3: '직무 전문성', D4: '실행력', D5: '성장 마인드셋' };
  function compKr(id) { return COMP_KR[id] || id || ''; }
  /* 조직 하위 트리(자기 포함) — 엔진 내부 subtreeIds 는 밖에서 못 쓴다 */
  function orgDescendants(rootId) {
    var childMap = {};
    arr('orgs').forEach(function (o) { if (o.parent_id) (childMap[o.parent_id] = childMap[o.parent_id] || []).push(o.org_id); });
    var out = {}, stack = [rootId];
    while (stack.length) {
      var id = stack.pop();
      if (out[id]) continue;
      out[id] = 1;
      (childMap[id] || []).forEach(function (c) { stack.push(c); });
    }
    return out;
  }
  function goalPeriod() {
    var found = null;
    arr('periods').forEach(function (p) { if (!found && p.kind === 'goal' && p.status !== 'closed') found = p; });
    if (!found) arr('periods').forEach(function (p) { if (!found && p.kind === 'goal') found = p; });
    return found;
  }
  /* 핵심결과명 → 그 이름을 쓰는 서로 다른 목표 수 */
  var dupCache = null;
  function dupMap() {
    if (dupCache) return dupCache;
    var m = {};
    arr('keyResults').forEach(function (k) { (m[k.name] = m[k.name] || {})[k.objective_id] = 1; });
    var out = {};
    for (var n in m) if (Object.prototype.hasOwnProperty.call(m, n)) {
      var c = 0, o;
      for (o in m[n]) if (Object.prototype.hasOwnProperty.call(m[n], o)) c++;
      out[n] = c;
    }
    dupCache = out;
    return out;
  }
  function dupCountOf(name) { return dupMap()[name] || 0; }

  /* 팀장 신호의 대상 —
     ① 직속 팀원(manager_id)이 소유한 목표가 1순위 대상이다.
     ② 실데이터에는 개인 목표가 전사 1건뿐이라 ①이 대개 비는데, 그럴 때 팀장이 실제로
        손보는 것은 자기 조직(하위 포함) 목표다. 품질 계열 신호(문장 중복·역량·가중치·
        목표값)는 ②까지 넓혀 봐야 셀 것이 생긴다. 개인 목표 원천이 채워지면 ①이 먼저 잡힌다.
     사람을 지목해야 하는 신호(핵심결과 0건·상위 연결 공백·미완 승계)는 ①만 쓴다. */
  function reportsOf(id) { return arr('employees').filter(function (e) { return e.manager_id === id; }); }
  function memberObjs(ctx) {
    var out = [];
    reportsOf(ctx.emp.emp_id).forEach(function (e) { objsOf(e.emp_id).forEach(function (o) { out.push(o); }); });
    return out;
  }
  function myOrgObjs(ctx) {
    var set = orgDescendants(ctx.emp.org_id);
    return arr('objectives').filter(function (o) { return set[o.org_id]; });
  }
  function teamQualityObjs(ctx) {
    var mine = memberObjs(ctx);
    return mine.length ? { objs: mine, widened: 0 } : { objs: myOrgObjs(ctx), widened: 1 };
  }
  function krsOfObjs(objs) {
    var out = [];
    objs.forEach(function (o) { krsOf(o.objective_id).forEach(function (k) { out.push(k); }); });
    return out;
  }
  /* 조사 고르기 — 이름을 갈아끼우면 「…율는」처럼 어긋나므로 받침으로 가른다.
     한글로 끝나지 않으면(괄호·영문) 가릴 수 없으니 받침 없는 쪽을 쓴다 */
  function josa(word, noBatchim) {
    var pair = { '는': '은', '가': '이', '와': '과', '를': '을' };
    var s = String(word == null ? '' : word), c = s.charCodeAt(s.length - 1);
    if (c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 !== 0) return pair[noBatchim] || noBatchim;
    return noBatchim;
  }
  function ownerNameOf(obj) {
    var e = obj ? empById(obj.owner_emp_id) : null;
    return e ? e.name : (obj ? obj.owner_emp_id : '');
  }

  /* 문장이 이어지는지 — 두 글자 이상 토큰이 두 개 겹치거나, 네 글자 이상 토큰이 하나 겹치면
     같은 일을 가리키는 것으로 본다. 승계 여부를 적을 칸이 따로 없어 문장으로만 판단한다. */
  function tokens(s) {
    var raw = String(s == null ? '' : s).split(/[^0-9A-Za-z가-힣]+/), out = [], i;
    for (i = 0; i < raw.length; i++) if (raw[i].length >= 2) out.push(raw[i]);
    return out;
  }
  function carriedOver(name, pool) {
    var a = tokens(name), i, j, hit;
    for (i = 0; i < pool.length; i++) {
      var b = tokens(pool[i]), share = 0, longShare = 0;
      for (j = 0; j < a.length; j++) {
        hit = b.indexOf(a[j]) >= 0;
        if (!hit) continue;
        share++;
        if (a[j].length >= 4) longShare++;
      }
      if (share >= 2 || longShare >= 1) return true;
    }
    return false;
  }

  /* ==================================================================
     구성원
  ================================================================== */

  /* --- 목표수립-구성원-05 : 직무가 바뀐 뒤에도 이전 직무 과업 참조 잔존 -----
     jobHistory 에는 바뀐 직무만 있고 발령「일자」가 없다. 그래서 카탈로그의
     경과일 조건(TH-발령후경과-구성원)은 켤 수 없고, 잔존 건수만으로 판정한다.
     경과일 근거 줄은 spec 을 비워 (추정)으로 남긴다. */
  E.registerEval('목표수립-구성원-05', function (ctx) {
    var SID = '목표수립-구성원-05';
    var hist = (ctx.emp.jobHistory && ctx.emp.jobHistory.length)
      ? ctx.emp.jobHistory[ctx.emp.jobHistory.length - 1] : null;
    var newJp = ctx.jp, areas = taskAreas(newJp);
    var prevId = hist ? hist.prev_jobProfileId : null;
    /* 이전 직무 참조 = 목표의 직무 연결이 이전 직무를 가리키거나, 그 목표의 핵심결과가 그렇거나 */
    var stale = ctx.myObjs.filter(function (o) {
      if (!prevId) return false;
      if (o.job_ref && o.job_ref.jobProfileId === prevId) return true;
      return krsOf(o.objective_id).some(function (k) { return k.job_task_ref && k.job_task_ref.jobProfileId === prevId; });
    });
    /* 새 직무 과업영역 중 지금 목표·핵심결과가 닿는 곳 */
    var touched = {};
    ctx.myObjs.forEach(function (o) {
      if (o.job_ref && o.job_ref.jobProfileId === (newJp && newJp.job_id) && o.job_ref.task_area) touched[o.job_ref.task_area] = 1;
      krsOf(o.objective_id).forEach(function (k) {
        if (k.job_task_ref && k.job_task_ref.task_area) touched[k.job_task_ref.task_area] = 1;
      });
    });
    var touchedN = 0, a;
    for (a = 0; a < areas.length; a++) if (touched[areas[a]]) touchedN++;
    var prof = ctx.profile || [], top = prof[0] || null;
    var facts = {
      hasHistory: !!hist, objN: ctx.myObjs.length, staleN: stale.length,
      prevLabel: hist ? hist.prev_label : '', newLabel: hist ? hist.new_label : (ctx.emp.jobTitle || ''),
      areaN: areas.length, touchedN: touchedN,
      top1: top ? compKr(top.dimension_id) : '', top1W: top ? top.weight : 0,
      reason: hist ? String(hist.note || '').split('.')[0] : ''
    };
    var hit = !!hist && stale.length >= thv(SID, 'TH-직무참조-잔존', 1);
    var spec = {};
    if (hist) {
      spec[0] = { m: [['2건', stale.length + '건'], ['데이터분석담당', facts.prevLabel]], emph: stale.length + '건',
                  src: ctx.emp.emp_id + ' / ' + (ctx.myObjs.map(function (o) { return o.objective_id; }).join(' · ') || '목표 없음') };
      spec[1] = { m: [['서비스기획담당', facts.newLabel], ['5개', areas.length + '개'],
                      ['어디에도 연결돼 있지 않아요', touchedN ? (touchedN + '곳에 연결돼 있어요') : '어디에도 연결돼 있지 않아요']],
                  emph: touchedN ? (touchedN + '곳') : '어디에도', src: (newJp && newJp.job_id) || ctx.emp.jobProfileId };
      /* [2] 발령일 원천이 없어 경과일은 계산 불가 → 카탈로그 예시값 유지(추정) */
      if (top) spec[3] = { m: [['직무 전문성', facts.top1], ['30%', facts.top1W + '%']], emph: facts.top1W + '%',
                           src: (newJp && newJp.job_id) || ctx.emp.jobProfileId };
      spec[4] = { m: [['데이터분석담당', facts.prevLabel], ['서비스기획담당', facts.newLabel]], emph: facts.newLabel,
                  src: ctx.emp.emp_id + '.jobHistory / ' + (hist.period || '') };
      if (facts.reason) spec[5] = { m: [['데이터 분석 경험을 서비스 기획에 잇기 위한 본인 희망 전환', facts.reason]],
                                    emph: facts.reason, src: ctx.emp.emp_id + '.jobHistory' };
    }
    return {
      hit: hit, facts: facts,
      notice: hist ? [['2건', stale.length + '건']] : [],
      ev: spec,
      th: { 'TH-직무참조-잔존': stale.length + '건' }
    };
  });

  /* --- 목표수립-구성원-11 : 지난 기간 미완 항목이 이번 기간에 안 이어짐 ----- */
  E.registerEval('목표수립-구성원-11', function (ctx) {
    var SID = '목표수립-구성원-11';
    var CUT = thv(SID, 'TH-이월-달성기준', 80);
    var prev = arr('evaluationsPrev').filter(function (e) { return e.emp_id === ctx.emp.emp_id; })[0] || null;
    var prevKrs = prev ? (prev.krs || []) : [];
    var unfinished = prevKrs.filter(function (k) { return (k.achievement_pct != null ? k.achievement_pct : 100) < CUT; });
    /* 이번 기간 문장 = 목표 제목 + 핵심결과 이름 */
    var pool = ctx.myObjs.map(function (o) { return o.title; })
      .concat(ctx.myKrs.map(function (k) { return k.name; }));
    var missed = unfinished.filter(function (k) { return !carriedOver(k.name, pool); });
    var worst = null;
    missed.forEach(function (k) { if (!worst || (k.achievement_pct || 0) < (worst.achievement_pct || 0)) worst = k; });
    var head = missed.length ? missed[0] : null;
    var areas = taskAreas(ctx.jp);
    var facts = {
      hasPrev: !!prev, prevKrN: prevKrs.length, unfinishedN: unfinished.length, missedN: missed.length,
      objN: ctx.myObjs.length, krN: ctx.myKrs.length, cutoff: CUT,
      headName: head ? head.name : '', headPct: head ? head.achievement_pct : null,
      worstName: worst ? worst.name : '', worstPct: worst ? worst.achievement_pct : null,
      jobTitle: ctx.emp.jobTitle || '', taskArea: areas[0] || '',
      summary: prev ? String(prev.rationale_summary || '') : ''
    };
    var hit = !!prev && missed.length >= thv(SID, 'TH-이월-미승계', 1);
    var spec = {};
    if (prev) {
      spec[0] = { m: [['2건', missed.length + '건']], emph: missed.length + '건',
                  src: prev.evaluation_id + ' / 미완 ' + unfinished.length + '건' };
      if (head) spec[1] = { m: [['VOC 데이터 분류 체계 구축 및 태깅 자동화', head.name], ['60%', head.achievement_pct + '%']],
                            emph: head.achievement_pct + '%', src: prev.evaluation_id };
      spec[2] = { m: [['3건', ctx.myObjs.length + '건'],
                      ['모두 새로 쓴 문장이라 겹치는 항목이 없어요',
                       missed.length === unfinished.length ? '모두 새로 쓴 문장이라 겹치는 항목이 없어요'
                                                           : ((unfinished.length - missed.length) + '건만 이어졌어요')]],
                  emph: missed.length === unfinished.length ? '모두 새로 쓴' : (unfinished.length - missed.length) + '건만',
                  src: ctx.myObjs.map(function (o) { return o.objective_id; }).join(' · ') || '목표 없음' };
      if (areas.length) spec[3] = { m: [['2건', missed.length + '건'], ['서비스기획담당', facts.jobTitle], ['서비스 고도화 관리', areas[0]]],
                                    emph: areas[0], src: (ctx.jp && ctx.jp.job_id) || ctx.emp.jobProfileId };
      if (worst && worst !== head) spec[4] = { m: [['유관 조직 합동 데이터 활용 워크숍 2회 운영', worst.name], ['50%', worst.achievement_pct + '%']],
                                               emph: worst.achievement_pct + '%', src: prev.evaluation_id, asof: '2025-12-31' };
      if (facts.summary) spec[5] = { ok: 1, src: prev.evaluation_id + ' / ' + prev.period, asof: '2025-12-31' };
    }
    return {
      hit: hit, facts: facts,
      notice: prev && head ? [['60%', head.achievement_pct + '%'], ['2건', missed.length + '건']] : [],
      ev: spec,
      th: { 'TH-이월-미승계': missed.length + '건', 'TH-이월-달성기준': CUT + '%' }
    };
  });

  /* ==================================================================
     팀장
  ================================================================== */

  /* --- 목표수립-팀장-02 : 목표는 저장됐는데 핵심결과가 0건 ------------------
     목표 기록에 「마지막으로 고친 시각」이 따로 없어 경과일은 목표수립 개시일 기준으로 센다. */
  E.registerEval('목표수립-팀장-02', function (ctx) {
    var SID = '목표수립-팀장-02';
    var per = goalPeriod();
    var objs = memberObjs(ctx);
    var empty = objs.filter(function (o) { return krsOf(o.objective_id).length <= thv(SID, 'TH-핵심결과건수-없음', 0); });
    var target = empty[0] || null;
    var targetName = target ? ownerNameOf(target) : '';
    var mineN = target ? objs.filter(function (o) { return o.owner_emp_id === target.owner_emp_id; }).length : 0;
    var emptyMine = target ? empty.filter(function (o) { return o.owner_emp_id === target.owner_emp_id; }).length : 0;
    /* 팀 평균 = 내 조직(하위 포함) 목표 한 건당 핵심결과 건수 */
    var teamObjs = myOrgObjs(ctx), teamKrN = krsOfObjs(teamObjs).length;
    var teamAvg = teamObjs.length ? r1(teamKrN / teamObjs.length) : null;
    var elapsed = per ? daysSince(per.start) : null;
    var facts = {
      memberObjN: objs.length, emptyN: empty.length, targetName: targetName,
      targetObjN: mineN, targetEmptyN: emptyMine,
      teamObjN: teamObjs.length, teamKrN: teamKrN, teamAvg: teamAvg,
      startDate: per ? dateOnly(per.start) : null, elapsed: elapsed
    };
    var hit = !!target && elapsed != null && elapsed >= thv(SID, 'TH-수립경과-핵심결과공백', 10);
    var spec = {};
    if (target) spec[0] = { m: [['{{팀원명}}', targetName], ['2건', emptyMine + '건'], ['0건', '0건']], emph: '0건',
                            src: target.owner_emp_id + ' / ' + empty.map(function (o) { return o.objective_id; }).join(', ') };
    if (teamAvg != null) spec[1] = { m: [['3.7건', pn(teamAvg) + '건']], emph: pn(teamAvg) + '건',
                                     src: ctx.emp.org_id + ' / 팀 목표 ' + teamObjs.length + '건 · 핵심결과 ' + teamKrN + '건' };
    if (elapsed != null) spec[2] = { m: [['10일', elapsed + '일'], ['0건', empty.length + '건']], emph: elapsed + '일',
                                     src: per.period_id + ' 개시 ' + dateOnly(per.start) };
    return {
      hit: hit, facts: facts,
      notice: [['10일', (elapsed == null ? '?' : elapsed) + '일'], ['{{팀원명}}', targetName || '팀원'],
               ['2건', emptyMine + '건'], ['0건', '0건']],
      ev: spec,
      th: { 'TH-수립경과-핵심결과공백': (elapsed == null ? '?' : elapsed) + '일', 'TH-핵심결과건수-없음': '0건' }
    };
  });

  /* --- 목표수립-팀장-03 : 팀 핵심결과명이 다른 조직과 겹치고 측정 방법이 없음 -
     측정 방법을 적는 칸이 없어 목표값 문자열이 「수치+단위」 한 덩어리인지로 대신 본다
     (예: 「95%」는 방법 없음, 「분기 내 출시 8건의 정시 출시율」처럼 서술이 붙으면 있음). */
  E.registerEval('목표수립-팀장-03', function (ctx) {
    var SID = '목표수립-팀장-03';
    var T = teamQualityObjs(ctx), krs = krsOfObjs(T.objs);
    var dups = krs.filter(function (k) { return dupCountOf(k.name) > 1; });
    var dupPct = krs.length ? r0(dups.length / krs.length * 100) : 0;
    var maxDup = 0, topName = '', second = null;
    dups.forEach(function (k) { var n = dupCountOf(k.name); if (n > maxDup) { maxDup = n; topName = k.name; } });
    dups.forEach(function (k) { if (k.name !== topName && (!second || dupCountOf(k.name) > dupCountOf(second))) second = k.name; });
    var withMethod = dups.filter(function (k) { return /\S\s+\S/.test(String(k.target_value || '')); }).length;
    var cleanN = krs.length - dups.length;
    var target = dups[0] || null;
    var targetObj = target ? arr('objectives').filter(function (o) { return o.objective_id === target.objective_id; })[0] : null;
    var targetEmp = targetObj ? empById(targetObj.owner_emp_id) : null;
    var targetName = targetObj ? ownerNameOf(targetObj) : '';
    /* 겹치는 핵심결과가 붙은 직무 과업영역 */
    var areaSet = {}, areaN = 0, aKey;
    dups.forEach(function (k) { if (k.job_task_ref && k.job_task_ref.task_area) areaSet[k.job_task_ref.task_area] = 1; });
    for (aKey in areaSet) if (Object.prototype.hasOwnProperty.call(areaSet, aKey)) areaN++;
    var facts = {
      krN: krs.length, dupN: dups.length, dupPct: dupPct, maxDup: maxDup, topName: topName,
      secondName: second || '', secondN: second ? dupCountOf(second) : 0,
      withMethod: withMethod, cleanN: cleanN, areaN: areaN, targetName: targetName, widened: T.widened
    };
    var hit = krs.length > 0 && dupPct >= thv(SID, 'TH-문장중복-초과', 50)
      && maxDup >= thv(SID, 'TH-이름공유-초과', 5)
      && withMethod <= thv(SID, 'TH-측정방법-없음', 0);
    var srcKr = dups.map(function (k) { return k.kr_id; }).join(', ') || '해당 없음';
    var spec = {};
    spec[0] = { m: [['{{팀원명}}님', targetName ? (targetName + '님') : '우리 팀'], ['5건', krs.length + '건'], ['3건', dups.length + '건'],
                    ['고객 만족도', topName || '해당 없음'], ['프로젝트 납기 준수율', second || '없음']],
                emph: dups.length + '건', src: (target ? target.objective_id : ctx.emp.org_id) + ' / ' + srcKr };
    spec[1] = { m: [['3건', dups.length + '건'], ['4.5점', dups[0] ? String(dups[0].target_value) : '-'],
                    ['95%', dups[1] ? String(dups[1].target_value) : '-']],
                emph: withMethod ? (withMethod + '건은 방법 있음') : '측정 방법', src: srcKr + ' / 목표값 문자열' };
    spec[2] = { m: [['「고객 만족도」는', '「' + (topName || '해당 없음') + '」' + josa(topName, '는')], ['9번', maxDup + '번'],
                    ['「프로젝트 납기 준수율」은', '「' + (second || '없음') + '」' + josa(second, '는')],
                    ['6번', (second ? dupCountOf(second) : 0) + '번']],
                emph: maxDup + '번', src: '전사 핵심결과 ' + arr('keyResults').length + '건 집계' };
    spec[3] = { m: [['7건', cleanN + '건']], emph: cleanN + '건',
                src: ctx.emp.org_id + ' / 팀 핵심결과 ' + krs.length + '건' };
    /* 과업이 여러 곳이면 「「A」 한 곳에만」이라는 어절 자체가 거짓이 된다 — 통째로 바꾼다 */
    if (areaN) spec[4] = { m: [['3건', dups.length + '건'], ['서비스기획담당', (targetEmp && targetEmp.jobTitle) || ''],
                               ['과업 「출시 및 성과 관리」 한 곳에만',
                                areaN === 1 ? ('과업 「' + Object.keys(areaSet)[0] + '」 한 곳에만') : ('과업 ' + areaN + '곳에 나뉘어')]],
                           emph: areaN === 1 ? '한 곳' : areaN + '곳', src: srcKr + ' / job_task_ref' };
    return {
      hit: hit, facts: facts,
      notice: [['{{팀원명}}님', targetName ? (targetName + '님') : '우리 팀'], ['3건', dups.length + '건'], ['9곳', maxDup + '곳']],
      ev: spec,
      th: { 'TH-문장중복-초과': dupPct + '%', 'TH-이름공유-초과': maxDup + '건', 'TH-측정방법-없음': withMethod + '건' }
    };
  });

  /* --- 목표수립-팀장-04 : 팀원 목표가 우리 팀 목표에 연결되지 않음 --------- */
  E.registerEval('목표수립-팀장-04', function (ctx) {
    var SID = '목표수립-팀장-04';
    var objs = memberObjs(ctx);
    var teamObjIds = {};
    myOrgObjs(ctx).forEach(function (o) { teamObjIds[o.objective_id] = 1; });
    var teamObjN = Object.keys(teamObjIds).length;
    var miss = objs.filter(function (o) { return !o.parent_objective_id || !teamObjIds[o.parent_objective_id]; });
    var target = miss[0] || null;
    var targetName = target ? ownerNameOf(target) : '';
    var mineN = target ? objs.filter(function (o) { return o.owner_emp_id === target.owner_emp_id; }).length : 0;
    var all = arr('objectives'), linked = all.filter(function (o) { return !!o.parent_objective_id; }).length;
    var linkPct = all.length ? r0(linked / all.length * 100) : 0;
    /* 연결 후보 = 우리 팀 목표 중 과업영역이 겹치는 것, 없으면 첫 번째 팀 목표 */
    var cand = null;
    if (target) {
      var tArea = (target.job_ref && target.job_ref.task_area) || null;
      myOrgObjs(ctx).forEach(function (o) {
        if (cand) return;
        if (tArea && o.job_ref && o.job_ref.task_area === tArea) cand = o;
      });
      if (!cand) cand = myOrgObjs(ctx)[0] || null;
    }
    var facts = {
      memberObjN: objs.length, missN: miss.length, targetName: targetName, targetObjN: mineN,
      teamObjN: teamObjN, coLinked: linked, coTotal: all.length, coLinkPct: linkPct,
      candTitle: cand ? cand.title : ''
    };
    var hit = miss.length > thv(SID, 'TH-상위연결-없음', 0);
    var spec = {};
    if (target) spec[0] = { m: [['{{팀원명}}', targetName], ['2건', mineN + '건'], ['1건', miss.length + '건']],
                            emph: miss.length + '건', src: target.owner_emp_id + ' / ' + miss.map(function (o) { return o.objective_id; }).join(', ') };
    spec[1] = { m: [['40건', all.length + '건'], ['38건', linked + '건'], ['95%', linkPct + '%']], emph: linkPct + '%',
                src: '전사 목표 ' + all.length + '건 / parent_objective_id' };
    if (cand) spec[2] = { m: [['3건', teamObjN + '건'], ['FY2026 2Q Package BG 사업 성과 극대화', cand.title]],
                          emph: '「' + cand.title + '」', src: ctx.emp.org_id + ' / ' + cand.objective_id };
    return {
      hit: hit, facts: facts,
      notice: [['{{팀원명}}', targetName || '팀원'], ['1건', miss.length + '건'], ['3건', teamObjN + '건']],
      ev: spec,
      th: { 'TH-상위연결-없음': miss.length + '건' }
    };
  });

  /* --- 목표수립-팀장-05 : 팀원 목표가 이전 조직 목표에 걸린 채 남음 --------
     소속 변경일 원천이 없어 카탈로그의 경과일 조건(TH-발령경과-도래)은 켤 수 없다.
     대신 「상위 목표가 우리 조직 밖에 있는 팀원 목표」를 잔존으로 세어 판정한다. */
  E.registerEval('목표수립-팀장-05', function (ctx) {
    var SID = '목표수립-팀장-05';
    var objs = memberObjs(ctx);
    var teamObjIds = {}, teamObjs = myOrgObjs(ctx);
    teamObjs.forEach(function (o) { teamObjIds[o.objective_id] = 1; });
    var outside = objs.filter(function (o) { return o.parent_objective_id && !teamObjIds[o.parent_objective_id]; });
    var target = outside[0] || null;
    var targetName = target ? ownerNameOf(target) : '';
    var targetEmp = target ? empById(target.owner_emp_id) : null;
    var mineOut = target ? outside.filter(function (o) { return o.owner_emp_id === target.owner_emp_id; }).length : 0;
    /* 우리 팀 목표 중 그 팀원 목표와 이어진 것 */
    var joined = target ? objs.filter(function (o) { return o.owner_emp_id === target.owner_emp_id && teamObjIds[o.parent_objective_id]; }).length : 0;
    var jp = targetEmp ? jpOf(targetEmp) : null, areas = taskAreas(jp);
    var touched = {}, touchedN = 0, tk;
    if (target) {
      objs.filter(function (o) { return o.owner_emp_id === target.owner_emp_id; }).forEach(function (o) {
        if (o.job_ref && o.job_ref.task_area) touched[o.job_ref.task_area] = 1;
        krsOf(o.objective_id).forEach(function (k) { if (k.job_task_ref && k.job_task_ref.task_area) touched[k.job_task_ref.task_area] = 1; });
      });
    }
    for (tk in touched) if (Object.prototype.hasOwnProperty.call(touched, tk)) touchedN++;
    var hist = (targetEmp && targetEmp.jobHistory && targetEmp.jobHistory.length)
      ? targetEmp.jobHistory[targetEmp.jobHistory.length - 1] : null;
    var facts = {
      memberObjN: objs.length, outsideN: outside.length, targetName: targetName, targetOutN: mineOut,
      teamObjN: teamObjs.length, joinedN: joined, areaN: areas.length, touchedN: touchedN,
      prevLabel: hist ? hist.prev_label : '', newLabel: hist ? hist.new_label : (targetEmp ? targetEmp.jobTitle : ''),
      period: target ? target.period : ''
    };
    var hit = outside.length >= thv(SID, 'TH-이전조직연결-잔존', 1);
    var spec = {};
    if (target) {
      spec[0] = { m: [['{{팀원명}}', targetName], ['3건', mineOut + '건']], emph: mineOut + '건',
                  src: target.owner_emp_id + ' / ' + outside.map(function (o) { return o.objective_id; }).join(', ') };
      spec[1] = { m: [['3건', teamObjs.length + '건'], ['{{팀원명}}', targetName], ['0건', joined + '건']], emph: joined + '건',
                  src: ctx.emp.org_id + ' / 팀 목표 ' + teamObjs.length + '건' };
      /* [2] 「같은 기간에 합류한 다른 팀원」은 합류일 원천이 없어 계산 불가 → (추정) 유지 */
      if (areas.length) spec[3] = { m: [['서비스기획담당', facts.newLabel], ['5곳', areas.length + '곳'], ['1곳', touchedN + '곳']],
                                    emph: touchedN + '곳', src: ((jp && jp.job_id) || (targetEmp && targetEmp.jobProfileId)) + ' / 팀원 목표' };
      if (hist) spec[4] = { m: [['데이터분석담당', hist.prev_label]], emph: hist.prev_label,
                            src: target.owner_emp_id + ' / jobHistory ' + (hist.period || '') };
      /* [5] 남은 기간 = 목표 기간 종료일 원천이 없어 (추정) 유지 */
    }
    return {
      hit: hit, facts: facts,
      /* 합류일 원천이 없어 「합류 뒤 N일」은 셀 수 없다 — 문구에서 통째로 뺀다 */
      notice: [['합류 뒤 15일이 지났는데 ', ''], ['{{팀원명}}', targetName || '팀원'], ['3건', mineOut + '건']],
      ev: spec,
      th: { 'TH-이전조직연결-잔존': outside.length + '건' }
    };
  });

  /* --- 목표수립-팀장-06 : 팀 핵심결과 역량 쏠림 + 1순위 역량 공백 ---------- */
  E.registerEval('목표수립-팀장-06', function (ctx) {
    var SID = '목표수립-팀장-06';
    var T = teamQualityObjs(ctx), krs = krsOfObjs(T.objs);
    var owner = T.objs[0] ? empById(T.objs[0].owner_emp_id) : null;
    var targetName = owner ? owner.name : '';
    var jp = owner ? jpOf(owner) : null, prof = compProfile(jp), top = prof[0] || null;
    var dist = {}, dom = null, d;
    krs.forEach(function (k) { if (k.competency_id) dist[k.competency_id] = (dist[k.competency_id] || 0) + 1; });
    for (d in dist) if (Object.prototype.hasOwnProperty.call(dist, d)) { if (!dom || dist[d] > dist[dom]) dom = d; }
    var domN = dom ? dist[dom] : 0;
    var domPct = krs.length ? r0(domN / krs.length * 100) : 0;
    var cover = top ? (dist[top.dimension_id] || 0) : 0;
    /* 연결된 역량의 직무 가중치 합 */
    var linkW = 0, linkNames = [];
    prof.forEach(function (x) {
      if (dist[x.dimension_id]) { linkW += (x.weight || 0); linkNames.push(compKr(x.dimension_id)); }
    });
    var emptyW = Math.max(0, 100 - linkW);
    var areas = taskAreas(jp), areaSet = {}, areaN = 0, aK;
    krs.forEach(function (k) { if (k.job_task_ref && k.job_task_ref.task_area) areaSet[k.job_task_ref.task_area] = 1; });
    for (aK in areaSet) if (Object.prototype.hasOwnProperty.call(areaSet, aK)) areaN++;
    var C = co();
    var fb = owner ? (arr('feedbackHistory').filter(function (f) { return f.emp_id === owner.emp_id && f.source_type === 'leader'; })[0] || null) : null;
    var facts = {
      krN: krs.length, domComp: dom ? compKr(dom) : '', domN: domN, domPct: domPct,
      targetName: targetName, jobTitle: owner ? (owner.jobTitle || '') : '',
      top1: top ? compKr(top.dimension_id) : '', top1W: top ? top.weight : 0, top1Cover: cover,
      linkW: linkW, emptyW: emptyW, areaN: areas.length, areaTouched: areaN,
      coUncov: C.uncovObj, coObjTotal: C.objTotal, coUncovPct: C.uncovPct, widened: T.widened
    };
    var hit = krs.length > 0 && !!top && domPct >= thv(SID, 'TH-역량쏠림-초과', 75)
      && cover <= thv(SID, 'TH-역량커버-없음', 0);
    var srcKr = krs.map(function (k) { return k.kr_id; }).join(' / ') || '핵심결과 없음';
    /* 「모두」는 쏠림이 100%일 때만 참이다 — 아니면 어절째 실제 상태로 바꾼다 */
    var domLabel = facts.domComp || '미지정';
    var allWord = (domN === krs.length && krs.length > 0);
    var evAll = allWord ? [['4건', krs.length + '건'], ['실행력', domLabel]]
                        : [['4건이 모두 역량 「실행력」', krs.length + '건 중 ' + domN + '건이 역량 「' + domLabel + '」']];
    var ntAll = allWord ? [['4건', krs.length + '건'], ['실행력', domLabel]]
                        : [['4건이 모두 실행력', krs.length + '건 중 ' + domN + '건이 ' + domLabel]];
    var spec = {};
    spec[0] = { m: [['{{팀원명}}', targetName || '팀']].concat(evAll),
                emph: domN + '건', src: (owner ? owner.emp_id + ' / ' : '') + srcKr };
    if (top) spec[1] = { m: [['헬프데스크담당', facts.jobTitle], ['협업', facts.top1], ['35%', facts.top1W + '%']],
                         emph: facts.top1W + '%', src: ((jp && jp.job_id) || (owner && owner.jobProfileId)) + ' / 역량 가중치' };
    spec[2] = { m: [['40건', C.objTotal + '건'], ['25건', C.uncovObj + '건'], ['62.5%', pn(C.uncovPct) + '%']],
                emph: C.uncovObj + '건', src: 'objectives ' + C.objTotal + '건 × jobProfiles ' + Object.keys(data().jobProfiles || {}).length + '종 대조' };
    spec[3] = { m: [['「실행력」 30% 한 역량이고',
                     '「' + (linkNames.join('」·「') || '없음') + '」 ' + linkW + '% ' + (linkNames.length === 1 ? '한 역량이고' : (linkNames.length + '개 역량이고'))],
                    ['70%', emptyW + '%']],
                emph: emptyW + '%', src: ((jp && jp.job_id) || (owner && owner.jobProfileId)) + ' / ' + srcKr };
    if (areas.length) spec[4] = { m: [['3곳', areas.length + '곳'],
                                      ['「고객 문의 응대」 한 곳이에요',
                                       areaN === 1 ? ('「' + Object.keys(areaSet)[0] + '」 한 곳이에요') : (areaN + '곳이에요')]],
                                  emph: areaN + '곳',
                                  src: ((jp && jp.job_id) || (owner && owner.jobProfileId)) + ' / ' + srcKr };
    if (fb) spec[5] = { ok: 1, src: fb.fb_id + ' / ' + fb.period };
    return {
      hit: hit, facts: facts,
      notice: [['{{팀원명}}', targetName || '팀']].concat(ntAll)
              .concat([['협업', facts.top1 || '미지정'], ['0건', cover + '건']]),
      ev: spec,
      th: { 'TH-역량커버-없음': cover + '건', 'TH-역량쏠림-초과': domPct + '%' }
    };
  });

  /* --- 목표수립-팀장-07 : 핵심결과 한 건에 가중치 쏠림 -------------------- */
  E.registerEval('목표수립-팀장-07', function (ctx) {
    var SID = '목표수립-팀장-07';
    var T = teamQualityObjs(ctx);
    /* 목표별 최대 가중치 → 팀 평균, 그리고 가장 쏠린 목표 하나 */
    var rows = [];
    T.objs.forEach(function (o) {
      var ks = krsOf(o.objective_id);
      if (!ks.length) return;
      var maxK = null, sum = 0;
      ks.forEach(function (k) {
        var w = num(k.weight);
        sum += w;
        if (!maxK || w > num(maxK.weight)) maxK = k;
      });
      rows.push({ obj: o, krs: ks, maxK: maxK, maxW: num(maxK.weight), sum: r0(sum) });
    });
    if (!rows.length) return { hit: false, facts: { objN: 0, krN: 0 }, ev: {}, th: {} };
    var teamAvg = r0(avg(rows.map(function (r) { return r.maxW; })));
    var worst = rows.slice().sort(function (a, b) { return b.maxW - a.maxW; })[0];
    var rest = worst.krs.filter(function (k) { return k.kr_id !== worst.maxK.kr_id; });
    var restW = 0;
    rest.forEach(function (k) { restW += num(k.weight); });
    var restEach = rest.length ? r0(restW / rest.length) : 0;
    var gap = r0(worst.maxW - teamAvg);
    var facts = {
      objN: rows.length, krN: worst.krs.length, targetName: ownerNameOf(worst.obj),
      topKrName: worst.maxK.name, topW: worst.maxW, restN: rest.length, restEach: restEach, restSum: r0(restW),
      teamAvg: teamAvg, gap: gap, weightSum: worst.sum, widened: T.widened
    };
    var hit = worst.maxW >= thv(SID, 'TH-가중치쏠림-초과', 40) && gap >= thv(SID, 'TH-가중치편차-초과', 12);
    var spec = {};
    spec[0] = { m: [['{{팀원명}}', facts.targetName], ['5건', worst.krs.length + '건'],
                    ['신규 고객 수주 12건', worst.maxK.name], ['40%', worst.maxW + '%']],
                emph: worst.maxW + '%', src: worst.obj.owner_emp_id + ' / ' + worst.maxK.kr_id };
    /* 나머지 가중치가 서로 다르면 「각각 N%」가 거짓이 된다 */
    var evenRest = rest.length > 0 && rest.every(function (k) { return num(k.weight) === num(rest[0].weight); });
    spec[1] = { m: [['4건', rest.length + '건'], ['각각 15%', (evenRest ? '각각 ' : '평균 ') + restEach + '%'],
                    ['60%', r0(restW) + '%']], emph: restEach + '%',
                src: worst.obj.owner_emp_id + ' / ' + (rest.map(function (k) { return k.kr_id; }).join(', ') || '없음') };
    spec[2] = { m: [['6건', rows.length + '건'], ['28%', teamAvg + '%']], emph: teamAvg + '%',
                src: ctx.emp.org_id + ' / 팀 핵심결과 ' + krsOfObjs(T.objs).length + '건' };
    return {
      hit: hit, facts: facts,
      notice: [['40%', worst.maxW + '%'], ['28%', teamAvg + '%'], ['12%p', gap + '%p']],
      ev: spec,
      th: { 'TH-가중치쏠림-초과': worst.maxW + '%', 'TH-가중치편차-초과': gap + '%p' }
    };
  });

  /* --- 목표수립-팀장-09 : 팀원의 지난 기간 미완 항목이 이번 기간에 안 이어짐 - */
  E.registerEval('목표수립-팀장-09', function (ctx) {
    var SID = '목표수립-팀장-09';
    var prevById = {};
    arr('evaluationsPrev').forEach(function (p) { prevById[p.emp_id] = p; });
    var rows = [];
    reportsOf(ctx.emp.emp_id).forEach(function (e) {
      var prev = prevById[e.emp_id];
      if (!prev) return;
      /* 「미완으로 적힌 항목」 = 결산 기록의 done 이 거짓인 것. 달성률만 낮은 건 미완 표시가 아니다 */
      var un = (prev.krs || []).filter(function (k) { return k.done === false; });
      var objs = objsOf(e.emp_id);
      var pool = objs.map(function (o) { return o.title; });
      objs.forEach(function (o) { krsOf(o.objective_id).forEach(function (k) { pool.push(k.name); }); });
      var missed = un.filter(function (k) { return !carriedOver(k.name, pool); });
      rows.push({ emp: e, prev: prev, un: un, missed: missed, objN: objs.length, carried: un.length - missed.length });
    });
    rows.sort(function (a, b) { return b.missed.length - a.missed.length; });
    var target = rows[0] || null;
    var facts = {
      prevN: rows.length, targetName: target ? target.emp.name : '',
      objN: target ? target.objN : 0, unfinishedN: target ? target.un.length : 0,
      missedN: target ? target.missed.length : 0, carriedN: target ? target.carried : 0,
      items: target ? target.missed.map(function (k) { return k.name + ' ' + k.achievement_pct + '%'; }) : []
    };
    var hit = !!target
      && target.carried <= thv(SID, 'TH-미완승계-없음', 0)
      && target.missed.length >= thv(SID, 'TH-미완잔존-도달', 2);
    var spec = {};
    if (target) {
      spec[0] = { m: [['{{팀원명}}', target.emp.name], ['3건', target.objN + '건'], ['0건', target.carried + '건']],
                  emph: target.carried + '건', src: target.emp.emp_id + ' / ' + (objsOf(target.emp.emp_id).map(function (o) { return o.objective_id; }).join(', ') || '목표 없음') };
      spec[1] = { m: [['2건', target.un.length + '건'], ['3건', target.objN + '건'], ['0건', target.carried + '건']],
                  emph: target.carried + '건', src: target.prev.evaluation_id + ' / 미완 ' + target.un.length + '건' };
      /* 항목이 한 건뿐이면 「「A」와 「B」」라는 나열 어절 자체를 한 건짜리로 줄인다 */
      var m2 = target.missed;
      if (m2.length) spec[2] = { m: [['「VOC 분류 자동화」와 「합동 워크숍 운영」',
                                      m2.length > 1 ? ('「' + m2[0].name + '」와 「' + m2[1].name + '」')
                                                    : ('「' + m2[0].name + '」')]],
                                 emph: '그대로', src: target.prev.evaluation_id + ' / ' + (target.emp.jobProfileId || '') };
      var u2 = target.un;
      if (u2.length) spec[3] = { m: [['「VOC 분류 자동화 60%」·「합동 워크숍 50%」',
                                      u2.map(function (k) { return '「' + k.name + ' ' + k.achievement_pct + '%」'; }).join('·')]],
                                 emph: '미완', src: target.prev.evaluation_id + ' / 미완 ' + u2.length + '건', asof: '2025-12-31' };
    }
    return {
      hit: hit, facts: facts,
      notice: [['{{팀원명}}', target ? target.emp.name : '팀원'], ['3건', (target ? target.objN : 0) + '건'],
               ['2건', (target ? target.missed.length : 0) + '건']],
      ev: spec,
      th: { 'TH-미완승계-없음': (target ? target.carried : 0) + '건', 'TH-미완잔존-도달': (target ? target.missed.length : 0) + '건' }
    };
  });

  /* --- 목표수립-팀장-10 : 저장 뒤 경과했는데 핵심결과 목표값이 공백 --------
     경과일은 핵심결과 기록의 저장일(created_at) 기준 — 목표값 칸을 마지막으로 만진 시각은 없다. */
  E.registerEval('목표수립-팀장-10', function (ctx) {
    var SID = '목표수립-팀장-10';
    var T = teamQualityObjs(ctx), krs = krsOfObjs(T.objs);
    function blank(v) { return !String(v == null ? '' : v).replace(/\s/g, ''); }
    var noTarget = krs.filter(function (k) { return blank(k.target_value); });
    var noBoth = noTarget.filter(function (k) { return blank(k.current_value); });
    var target = noTarget[0] || null;
    var owner = target ? arr('objectives').filter(function (o) { return o.objective_id === target.objective_id; })[0] : null;
    var targetName = owner ? ownerNameOf(owner) : '';
    /* 목표값이 빈 핵심결과 중 가장 오래된 저장일 기준 경과 */
    var elapsed = null;
    noTarget.forEach(function (k) {
      var d = daysSince(k.created_at);
      if (d != null && (elapsed == null || d > elapsed)) elapsed = d;
    });
    var areaSet = {}, aK;
    noTarget.forEach(function (k) { if (k.job_task_ref && k.job_task_ref.task_area) areaSet[k.job_task_ref.task_area] = 1; });
    var jp = owner ? jpOf(empById(owner.owner_emp_id)) : null;
    var facts = {
      krN: krs.length, blankN: noTarget.length, blankBothN: noBoth.length,
      targetName: targetName, elapsed: elapsed, teamKrN: krs.length,
      area: Object.keys(areaSet)[0] || '', widened: T.widened
    };
    var hit = noTarget.length >= thv(SID, 'TH-목표값-없음', 1)
      && elapsed != null && elapsed >= thv(SID, 'TH-저장경과-목표값공백', 14);
    var srcKr = noTarget.map(function (k) { return k.kr_id; }).join(', ') || '해당 없음';
    var spec = {};
    spec[0] = { m: [['{{팀원명}}님', targetName ? (targetName + '님') : '우리 팀'], ['5건', krs.length + '건'], ['3건', noTarget.length + '건']],
                emph: noTarget.length + '건', src: (owner ? owner.owner_emp_id + ' / ' : '') + srcKr };
    spec[1] = { m: [['3건', noBoth.length + '건']], emph: '실적값', src: srcKr };
    spec[2] = { m: [['12건', krs.length + '건'], ['3건', noTarget.length + '건']], emph: noTarget.length + '건',
                src: ctx.emp.org_id + ' / 팀 핵심결과 ' + krs.length + '건' };
    if (elapsed != null) spec[3] = { m: [['14일', elapsed + '일']], emph: elapsed + '일', src: srcKr + ' / created_at' };
    if (facts.area) spec[4] = { m: [['3건', noTarget.length + '건'], ['시스템운영담당', (owner && empById(owner.owner_emp_id) ? empById(owner.owner_emp_id).jobTitle : '')],
                                    ['성능 최적화 및 용량 관리', facts.area]], emph: '「' + facts.area + '」',
                                src: ((jp && jp.job_id) || '') + ' / ' + srcKr };
    return {
      hit: hit, facts: facts,
      notice: [['14일', (elapsed == null ? 0 : elapsed) + '일'], ['3건', noTarget.length + '건']],
      ev: spec,
      th: { 'TH-저장경과-목표값공백': (elapsed == null ? 0 : elapsed) + '일', 'TH-목표값-없음': noTarget.length + '건' }
    };
  });

  /* ==================================================================
     상위조직장
  ================================================================== */

  /* 목표 한 건의 「검토 대기일」 — 확정됐으면 저장→확정, 아직이면 저장→기준시점 */
  function waitDaysOf(o) {
    var from = dnum(o.created_at);
    if (from == null) return null;
    var to = (o.confirm_status === 'confirmed' && o.confirmed_at) ? dnum(o.confirmed_at) : asofMs();
    if (to == null) return null;
    return Math.max(0, Math.round((to - from) / 86400000));
  }

  /* --- 목표수립-상위조직장-02 : 1차 평가자 검토가 멈춘 목표 ----------------
     「1차 평가자」를 사람 단위로 묶을 원천(목표별 검토자)이 없어 팀 단위로 본다 —
     팀 목표의 확정 책임자는 그 조직의 장(orgs.head_id)이므로 팀 = 검토자 한 명으로 읽는다. */
  E.registerEval('목표수립-상위조직장-02', function (ctx) {
    var SID = '목표수립-상위조직장-02';
    var s = ctx.scope;
    if (!s) return { hit: false, facts: {}, ev: {}, th: {} };
    var WAIT = thv(SID, 'TH-목표검토-대기일', 14);
    var rows = s.units.map(function (u) {
      var pend = u.objs.filter(function (o) { return o.confirm_status !== 'confirmed'; });
      var maxWait = null;
      pend.forEach(function (o) { var d = waitDaysOf(o); if (d != null && (maxWait == null || d > maxWait)) maxWait = d; });
      var overdue = pend.filter(function (o) { var d = waitDaysOf(o); return d != null && d >= WAIT; });
      return { org: u.org, name: u.name, objN: u.objN, pendN: pend.length, overdueN: overdue.length,
               maxWait: maxWait, pct: u.objN ? r0(pend.length / u.objN * 100) : 0 };
    }).filter(function (r) { return r.objN > 0; });
    if (!rows.length) return { hit: false, facts: {}, ev: {}, th: {} };
    rows.sort(function (a, b) { return (b.overdueN - a.overdueN) || (b.pct - a.pct); });
    var worst = rows[0];
    var waits = [];
    s.units.forEach(function (u) { u.objs.forEach(function (o) { var d = waitDaysOf(o); if (d != null) waits.push(d); }); });
    var scopeAvg = waits.length ? r0(avg(waits)) : null;
    var facts = {
      unitN: s.unitN, scopeObjN: s.unitObjN, scopeAvgWait: scopeAvg,
      worstOrg: worst.org, worstName: worst.name, worstObjN: worst.objN,
      pendN: worst.pendN, overdueN: worst.overdueN, pendPct: worst.pct, maxWait: worst.maxWait
    };
    var hit = worst.overdueN >= 1 && worst.pct >= thv(SID, 'TH-목표검토-미확정비율', 30);
    var spec = {};
    spec[0] = { m: [['9건', worst.objN + '건']], emph: worst.objN + '건', src: worst.org + ' / OBJ ' + worst.objN + '건' };
    spec[1] = { m: [['9건', worst.objN + '건'], ['7건', worst.pendN + '건']], emph: worst.pendN + '건',
                src: worst.org + ' / OBJ 미확정 ' + worst.pendN + '건' };
    spec[2] = { m: [['7건', worst.pendN + '건'], ['78%', worst.pct + '%']], emph: worst.pct + '%',
                src: worst.org + ' / OBJ ' + worst.objN + '건' };
    if (scopeAvg != null) spec[3] = { m: [['8개 팀', s.unitN + '개 팀'], ['3일', scopeAvg + '일']], emph: scopeAvg + '일',
                                      src: s.srcOrg + ' / OBJ ' + s.unitObjN + '건' };
    if (worst.maxWait != null) spec[4] = { m: [['7건', worst.overdueN + '건'], ['14일', worst.maxWait + '일']],
                                           emph: worst.maxWait + '일', src: worst.org + ' / OBJ 미확정 ' + worst.pendN + '건' };
    return {
      hit: hit, facts: facts,
      notice: [['3일', (scopeAvg == null ? '?' : scopeAvg) + '일'], ['14일', WAIT + '일'], ['7건', worst.overdueN + '건']],
      ev: spec,
      th: { 'TH-목표검토-대기일': (worst.maxWait == null ? '?' : worst.maxWait) + '일', 'TH-목표검토-미확정비율': worst.pct + '%' }
    };
  });

  /* --- 목표수립-상위조직장-03 : 한 팀 핵심결과가 최저 난이도에 쏠림 -------- */
  E.registerEval('목표수립-상위조직장-03', function (ctx) {
    var SID = '목표수립-상위조직장-03';
    var s = ctx.scope;
    if (!s) return { hit: false, facts: {}, ev: {}, th: {} };
    /* 최저 난이도 = 실제 쓰인 등급 중 가장 낮은 것 (S > A > B 순, 데이터에 있는 것만) */
    var order = ['S', 'A', 'B', 'C', 'D'];
    var used = {};
    arr('keyResults').forEach(function (k) { if (k.difficulty) used[k.difficulty] = 1; });
    var lowest = null, i;
    for (i = order.length - 1; i >= 0; i--) if (used[order[i]]) { lowest = order[i]; break; }
    if (!lowest) return { hit: false, facts: {}, ev: {}, th: {} };
    var rows = s.units.filter(function (u) { return u.krN > 0; }).map(function (u) {
      var low = u.krs.filter(function (k) { return k.difficulty === lowest; }).length;
      var topN = u.krs.filter(function (k) { return k.difficulty === order[0]; }).length;
      return { org: u.org, name: u.name, krN: u.krN, lowN: low, topN: topN, pct: r0(low / u.krN * 100) };
    });
    if (!rows.length) return { hit: false, facts: {}, ev: {}, th: {} };
    rows.sort(function (a, b) { return b.pct - a.pct; });
    var worst = rows[0];
    var scopeLow = 0, scopeN = 0;
    rows.forEach(function (r) { scopeLow += r.lowN; scopeN += r.krN; });
    var scopePct = scopeN ? r0(scopeLow / scopeN * 100) : 0;
    var gap = r0(worst.pct - scopePct);
    var halfN = rows.filter(function (r) { return r.pct > 50; }).length;
    var dist = {};
    arr('keyResults').forEach(function (k) { if (k.difficulty) dist[k.difficulty] = (dist[k.difficulty] || 0) + 1; });
    var areaSet = {}, areaTop = '', areaTopN = 0, byArea = {};
    s.units.forEach(function (u) {
      if (u.org !== worst.org) return;
      u.krs.forEach(function (k) {
        if (k.difficulty !== lowest || !(k.job_task_ref && k.job_task_ref.task_area)) return;
        var a = k.job_task_ref.task_area;
        areaSet[a] = 1;
        byArea[a] = (byArea[a] || 0) + 1;
        if (byArea[a] > areaTopN) { areaTopN = byArea[a]; areaTop = a; }
      });
    });
    var facts = {
      unitN: s.unitN, scopeKrN: scopeN, lowest: lowest, worstOrg: worst.org, worstName: worst.name,
      worstKrN: worst.krN, worstLowN: worst.lowN, worstPct: worst.pct, worstTopN: worst.topN,
      scopePct: scopePct, gap: gap, halfN: halfN,
      distS: dist.S || 0, distA: dist.A || 0, distB: dist.B || 0,
      areaTop: areaTop, areaTopN: areaTopN
    };
    var hit = worst.pct >= thv(SID, 'TH-난이도쏠림-비중', 70) && gap >= thv(SID, 'TH-난이도쏠림-편차', 25);
    var spec = {};
    spec[0] = { m: [['8개 팀', s.unitN + '개 팀'], ['146건', scopeN + '건']], emph: scopeN + '건', src: s.srcOrg + ' / KR ' + scopeN + '건' };
    spec[1] = { m: [['18건', worst.krN + '건'], ['14건', worst.lowN + '건'], ['B', lowest]], emph: worst.lowN + '건',
                src: worst.org + ' / KR ' + worst.krN + '건' };
    spec[2] = { m: [['S', order[0]], ['0건', worst.topN + '건']], emph: worst.topN + '건', src: worst.org + ' / KR ' + worst.krN + '건' };
    spec[3] = { m: [['B', lowest], ['25%', scopePct + '%'], ['78%', worst.pct + '%'], ['53%p', gap + '%p']], emph: gap + '%p',
                src: s.srcOrg + ' / KR ' + scopeN + '건',
                calcm: [['44건', facts.distS + '건'], ['65건', facts.distA + '건'], ['37건', facts.distB + '건']] };
    spec[4] = { m: [['8개 팀', s.unitN + '개 팀'], ['B', lowest],
                    ['이 팀 하나예요', halfN === 1 ? '이 팀 하나예요' : (halfN + '개 팀이에요')]],
                emph: halfN === 1 ? '이 팀 하나' : halfN + '개 팀', src: s.srcOrg + ' / KR 팀별 집계' };
    if (areaTop) spec[5] = { m: [['B', lowest], ['14건', worst.lowN + '건'], ['구축 단계 품질 관리', areaTop], ['6건', areaTopN + '건']],
                             emph: areaTopN + '건', src: worst.org + ' / job_task_ref' };
    return {
      hit: hit, facts: facts,
      notice: [['18건', worst.krN + '건'], ['14건', worst.lowN + '건'], ['25%', scopePct + '%']],
      ev: spec,
      th: { 'TH-난이도쏠림-비중': worst.pct + '%', 'TH-난이도쏠림-편차': gap + '%p' }
    };
  });

  /* ==================================================================
     HR·경영진
  ================================================================== */

  /* --- 목표수립-HR경영진-02 : 목표 필수 연결 항목(직무 과업) 공백 ---------- */
  E.registerEval('목표수립-HR경영진-02', function (ctx) {
    var SID = '목표수립-HR경영진-02';
    var C = co(), objs = arr('objectives'), krs = arr('keyResults');
    var miss = objs.filter(function (o) { return !(o.job_ref && o.job_ref.task_area); });
    var missPct = objs.length ? r0(miss.length / objs.length * 100) : 0;
    var krLinked = krs.filter(function (k) { return k.job_task_ref && k.job_task_ref.task_area; }).length;
    var krPct = krs.length ? r0(krLinked / krs.length * 100) : 0;
    var TH2 = thv(SID, 'TH-공백목표-건수', 5);
    var facts = {
      objTotal: objs.length, missN: miss.length, missPct: missPct, fillPct: C.jobRefPct,
      krTotal: krs.length, krLinked: krLinked, krPct: krPct, allow: TH2
    };
    var hit = missPct >= thv(SID, 'TH-목표필수항목-공백비율', 15) && miss.length >= TH2;
    var spec = {};
    spec[0] = { m: [['40건', objs.length + '건']], emph: objs.length + '건', src: 'objectives ' + objs.length + '건' };
    spec[1] = { m: [['40건', objs.length + '건'], ['8건', miss.length + '건']], emph: miss.length + '건',
                src: 'objectives.job_ref / 공백 ' + miss.length + '건',
                calcm: [['32건', C.jobRefObj + '건'], ['40건', objs.length + '건'], ['80%', C.jobRefPct + '%']] };
    spec[2] = { m: [['5건', TH2 + '건'], ['8건', miss.length + '건']], emph: miss.length + '건', src: '필수 항목이 빈 목표 기준값' };
    spec[3] = { m: [['146건', krs.length + '건'], ['20%', missPct + '%']], emph: missPct + '%',
                src: 'keyResults.job_task_ref ' + krLinked + '건 / ' + krs.length + '건',
                calcm: [['146건', krLinked + '건'], ['146건', krs.length + '건'], ['100%', krPct + '%']] };
    return {
      hit: hit, facts: facts,
      notice: [['40건', objs.length + '건'], ['8건', miss.length + '건']],
      ev: spec,
      th: { 'TH-목표필수항목-공백비율': missPct + '%', 'TH-공백목표-건수': miss.length + '건' }
    };
  });

  /* 조직별 최저 난이도 비중 — 조직 하위 트리의 목표가 가진 핵심결과를 모아 센다
     (조직 하나가 직접 가진 목표는 1건뿐이라 트리로 묶어야 비교할 건수가 모인다) */
  function lowestGrade() {
    var order = ['S', 'A', 'B', 'C', 'D'], used = {}, i;
    arr('keyResults').forEach(function (k) { if (k.difficulty) used[k.difficulty] = 1; });
    for (i = order.length - 1; i >= 0; i--) if (used[order[i]]) return order[i];
    return null;
  }
  function orgDifficultyRows(minN) {
    var low = lowestGrade();
    if (!low) return { low: null, rows: [] };
    var rows = [];
    arr('orgs').forEach(function (o) {
      var set = orgDescendants(o.org_id);
      var krs = [];
      arr('objectives').forEach(function (ob) {
        if (set[ob.org_id]) krsOf(ob.objective_id).forEach(function (k) { krs.push(k); });
      });
      if (krs.length < minN) return;
      var n = krs.filter(function (k) { return k.difficulty === low; }).length;
      rows.push({ org: o.org_id, name: o.name, krN: krs.length, lowN: n, pct: r0(n / krs.length * 100) });
    });
    rows.sort(function (a, b) { return b.pct - a.pct; });
    return { low: low, rows: rows };
  }

  /* --- 목표수립-HR경영진-03 : 한 조직이 최저 난이도에 쏠림 ---------------- */
  E.registerEval('목표수립-HR경영진-03', function (ctx) {
    var SID = '목표수립-HR경영진-03';
    var MIN = thv(SID, 'TH-난이도대상-최소건수', 10);
    var R = orgDifficultyRows(MIN), rows = R.rows;
    var krs = arr('keyResults');
    var dist = {};
    krs.forEach(function (k) { if (k.difficulty) dist[k.difficulty] = (dist[k.difficulty] || 0) + 1; });
    var coLow = R.low ? (dist[R.low] || 0) : 0;
    var coPct = krs.length ? r0(coLow / krs.length * 100) : 0;
    var top = rows[0] || null;
    var gap = top ? r0(top.pct - coPct) : 0;
    var linkedAll = top ? true : false;
    var facts = {
      lowest: R.low, orgN: rows.length, minN: MIN, coLowN: coLow, coPct: coPct, coKrN: krs.length,
      topOrg: top ? top.org : '', topName: top ? top.name : '', topKrN: top ? top.krN : 0,
      topLowN: top ? top.lowN : 0, topPct: top ? top.pct : 0, gap: gap,
      distS: dist.S || 0, distA: dist.A || 0, distB: dist.B || 0
    };
    var hit = !!top && top.pct >= thv(SID, 'TH-최저난이도비중-초과', 75) && top.krN >= MIN;
    var spec = {};
    spec[0] = { m: [['10건', MIN + '건'], ['12곳', rows.length + '곳']], emph: rows.length + '곳',
                src: 'orgs ' + arr('orgs').length + '곳 / keyResults ' + krs.length + '건' };
    if (top) {
      spec[1] = { m: [['{{조직명}}', top.name], ['18건', top.krN + '건'], ['14건', top.lowN + '건'], ['B', R.low]],
                  emph: top.lowN + '건', src: top.org + ' / difficulty',
                  calcm: [['14건', top.lowN + '건'], ['18건', top.krN + '건'], ['78%', top.pct + '%']] };
      spec[3] = { m: [['B', R.low], ['25%', coPct + '%'], ['53%p', gap + '%p']], emph: gap + '%p',
                  src: 'keyResults ' + krs.length + '건',
                  calcm: [['37건', coLow + '건'], ['146건', krs.length + '건'], ['25.3%', pn(coLow / (krs.length || 1) * 100) + '%']] };
      if (linkedAll) spec[5] = { m: [['18건', top.krN + '건']], emph: '모두 연결', src: top.org + ' / job_task_ref' };
    }
    spec[2] = { m: [['S 44건', 'S ' + (dist.S || 0) + '건'], ['A 65건', 'A ' + (dist.A || 0) + '건'], ['B 37건', 'B ' + (dist.B || 0) + '건']],
                emph: R.low + ' ' + coLow + '건', src: 'keyResults ' + krs.length + '건 / difficulty' };
    /* [4] 지난 사이클 난이도 분포는 원천이 없어 (추정) 유지 */
    return {
      hit: hit, facts: facts,
      notice: [['78%', (top ? top.pct : 0) + '%'], ['25%', coPct + '%']],
      ev: spec,
      th: { 'TH-최저난이도비중-초과': (top ? top.pct : 0) + '%', 'TH-난이도대상-최소건수': (top ? top.krN : 0) + '건' }
    };
  });

  /* --- 목표수립-HR경영진-04 : 조직끼리 난이도 기준이 다름 ----------------- */
  E.registerEval('목표수립-HR경영진-04', function (ctx) {
    var SID = '목표수립-HR경영진-04';
    var MIN = thv(SID, 'TH-난이도대상-최소건수', 10);
    var R = orgDifficultyRows(MIN), rows = R.rows;
    if (rows.length < 2) {
      return { hit: false, facts: { orgN: rows.length, minN: MIN, lowest: R.low }, ev: {}, th: {} };
    }
    var hi = rows[0], lo = rows[rows.length - 1];
    var gap = r0(hi.pct - lo.pct);
    var krs = arr('keyResults');
    var coLow = R.low ? krs.filter(function (k) { return k.difficulty === R.low; }).length : 0;
    var coPct = krs.length ? r0(coLow / krs.length * 100) : 0;
    var facts = {
      lowest: R.low, orgN: rows.length, hiOrg: hi.org, hiName: hi.name, hiPct: hi.pct,
      loOrg: lo.org, loName: lo.name, loPct: lo.pct, gap: gap, coPct: coPct, coLowN: coLow, coKrN: krs.length
    };
    var hit = gap >= thv(SID, 'TH-난이도조직간격차-초과', 40);
    var spec = {};
    spec[0] = { m: [['10건', MIN + '건'], ['12곳', rows.length + '곳']], emph: rows.length + '곳',
                src: 'orgs ' + arr('orgs').length + '곳 / keyResults ' + krs.length + '건' };
    spec[1] = { m: [['78%', hi.pct + '%'], ['25%', lo.pct + '%']], emph: hi.pct + '%',
                src: hi.org + ' / ' + lo.org + ' / difficulty',
                calcm: [['78%', hi.pct + '%'], ['25%', lo.pct + '%'], ['53%p', gap + '%p']] };
    spec[2] = { m: [['25%', coPct + '%'], ['열두 조직', rows.length + '개 조직']], emph: '전사 평균 ' + coPct + '%',
                src: 'keyResults ' + krs.length + '건',
                calcm: [['37건', coLow + '건'], ['146건', krs.length + '건'], ['25.3%', pn(coLow / (krs.length || 1) * 100) + '%']] };
    return {
      hit: hit, facts: facts,
      notice: [['78%', hi.pct + '%'], ['25%', lo.pct + '%']],
      ev: spec,
      th: { 'TH-난이도조직간격차-초과': gap + '%p', 'TH-난이도대상-최소건수': MIN + '건' }
    };
  });

  /* --- 목표수립-HR경영진-05 : 한 조직만 상위 목표 미연결이 쌓임 ----------- */
  E.registerEval('목표수립-HR경영진-05', function (ctx) {
    var SID = '목표수립-HR경영진-05';
    var objs = arr('objectives'), orgs = arr('orgs');
    var linked = objs.filter(function (o) { return !!o.parent_objective_id; }).length;
    var linkPct = objs.length ? r0(linked / objs.length * 100) : 0;
    /* 조직별로 볼 때 전사 최상위 목표(위에 붙을 목표가 없는 자리)는 「미연결」이 아니다 —
       전사 연결률 계산에는 그대로 두고, 조직 지목에서만 뺀다 */
    var byOrg = {};
    objs.forEach(function (o) { if (o.level !== 'company') (byOrg[o.org_id] = byOrg[o.org_id] || []).push(o); });
    var rows = [], g;
    for (g in byOrg) if (Object.prototype.hasOwnProperty.call(byOrg, g)) {
      var list = byOrg[g];
      var miss = list.filter(function (o) { return !o.parent_objective_id; });
      var o2 = orgs.filter(function (x) { return x.org_id === g; })[0];
      rows.push({ org: g, name: (o2 && o2.name) || g, objN: list.length, missN: miss.length,
                  pct: r0(miss.length / list.length * 100),
                  themeN: miss.filter(function (o) { return !!o.strategy_theme_id; }).length });
    }
    rows.sort(function (a, b) { return (b.missN - a.missN) || (b.pct - a.pct); });
    /* 미연결이 한 건도 없으면 지목할 조직 자체가 없다 — 있지도 않은 조직을 세우지 않는다 */
    var worst = (rows[0] && rows[0].missN > 0) ? rows[0] : null;
    var themePct = objs.length ? r0(objs.filter(function (o) { return !!o.strategy_theme_id; }).length / objs.length * 100) : 0;
    var facts = {
      objTotal: objs.length, orgTotal: orgs.length, linked: linked, linkPct: linkPct,
      brokenN: objs.length - linked, themePct: themePct,
      worstOrg: worst ? worst.org : '', worstName: worst ? worst.name : '',
      worstObjN: worst ? worst.objN : 0, worstMissN: worst ? worst.missN : 0, worstPct: worst ? worst.pct : 0,
      worstThemeN: worst ? worst.themeN : 0
    };
    var hit = !!worst && worst.pct >= thv(SID, 'TH-상위목표미연결-비율', 35)
      && worst.missN >= thv(SID, 'TH-미연결목표-최소건수', 5);
    var spec = {};
    spec[0] = { m: [['40건', objs.length + '건'], ['38개', orgs.length + '개']], emph: objs.length + '건',
                src: 'objectives ' + objs.length + '건 / orgs ' + orgs.length + '곳' };
    if (worst) {
      spec[1] = { m: [['{{조직명}}', worst.name], ['17건', worst.objN + '건'], ['7건', worst.missN + '건']], emph: worst.missN + '건',
                  src: worst.org + ' / parent_objective_id',
                  calcm: [['7건', worst.missN + '건'], ['17건', worst.objN + '건'], ['41%', worst.pct + '%']] };
      spec[4] = { m: [['7건', worst.missN + '건'],
                      ['모두 붙어 있어', worst.themeN === worst.missN ? '모두 붙어 있어' : (worst.themeN + '건이 붙어 있어')]],
                  emph: worst.themeN === worst.missN ? '전략 테마에는 모두 붙어' : ('전략 테마 ' + worst.themeN + '건'),
                  src: worst.org + ' / strategy_theme_id',
                  calcm: [['40건', objs.filter(function (o) { return !!o.strategy_theme_id; }).length + '건'],
                          ['40건', objs.length + '건'], ['100%', themePct + '%']] };
    } else {
      spec[1] = { m: [], text: '지금은 조직 안에서 상위 목표 연결이 빈 목표가 한 건도 없어요',
                  emph: '한 건도 없어요', src: 'objectives.parent_objective_id / 최상위 목표 제외' };
      spec[4] = { m: [], text: '조직별로 끊긴 목표가 없어 전략 테마 쪽만 따로 볼 항목도 없어요',
                  emph: '없어요', src: 'objectives.strategy_theme_id' };
    }
    spec[2] = { m: [['95%', linkPct + '%'], ['2건', (objs.length - linked) + '건']], emph: linkPct + '%',
                src: 'objectives.parent_objective_id',
                calcm: [['38건', linked + '건'], ['40건', objs.length + '건'], ['95%', linkPct + '%']] };
    /* [3] 주차별 연결 스냅샷 원천이 없어 (추정) 유지 */
    return {
      hit: hit, facts: facts,
      notice: [['95%', linkPct + '%'], ['41%', (worst ? worst.pct : 0) + '%']],
      ev: spec,
      th: { 'TH-상위목표미연결-비율': (worst ? worst.pct : 0) + '%', 'TH-미연결목표-최소건수': (worst ? worst.missN : 0) + '건' }
    };
  });

  /* --- 목표수립-HR경영진-06 : 지표 미달 전략 테마에 목표가 얇게 걸림 ------
     KPI 는 target·current 가 문자열이라 수를 뽑아 견준다. 「2% 이하」처럼 상한을 적은
     지표는 방향을 뒤집어 본다. 수가 없는 지표(「심사 준비」)는 판단에서 뺀다. */
  E.registerEval('목표수립-HR경영진-06', function (ctx) {
    var SID = '목표수립-HR경영진-06';
    function hasNum(v) { return /\d/.test(String(v == null ? '' : v)); }
    /* 단위 = 수·공백·방향어를 걷어낸 나머지. 목표와 현재의 단위가 다르면(「491억원」 vs
       「진척 61%」) 같은 자로 잰 값이 아니라 견주지 않는다 */
    function unitOf(v) { return String(v == null ? '' : v).replace(/[0-9.,\s]/g, '').replace(/이하|이내|미만|이상/g, ''); }
    var themes = arr('strategyThemes'), objs = arr('objectives');
    var byTheme = {};
    objs.forEach(function (o) { if (o.strategy_theme_id) byTheme[o.strategy_theme_id] = (byTheme[o.strategy_theme_id] || 0) + 1; });
    var rows = themes.map(function (t) {
      var kpis = (t.kpis || []).filter(function (k) {
        return hasNum(k.target) && hasNum(k.current) && unitOf(k.target) === unitOf(k.current);
      });
      var bad = kpis.filter(function (k) {
        var upper = /이하|이내|미만/.test(String(k.target));
        return upper ? (num(k.current) > num(k.target)) : (num(k.current) < num(k.target));
      });
      return { theme: t, id: t.theme_id, name: t.name, kpiN: kpis.length, badN: bad.length,
               bad: bad, objN: byTheme[t.theme_id] || 0 };
    });
    var under = rows.filter(function (r) { return r.badN > 0; });
    var underObjN = 0;
    under.forEach(function (r) { underObjN += r.objN; });
    var perTheme = under.length ? r1(underObjN / under.length) : null;
    var okN = rows.length - under.length;
    var themeLinked = objs.filter(function (o) { return !!o.strategy_theme_id; }).length;
    var facts = {
      themeN: themes.length, objTotal: objs.length, underN: under.length, underObjN: underObjN,
      perTheme: perTheme, okN: okN, themeLinked: themeLinked,
      underNames: under.map(function (r) { return r.name; })
    };
    var MIN = thv(SID, 'TH-테마당목표-최소건수', 5);
    var hit = under.length >= thv(SID, 'TH-전략KPI-미달테마수', 2)
      && perTheme != null && perTheme < MIN;
    function kpiText(r) {
      if (!r || !r.bad.length) return '';
      var k = r.bad[0];
      return '「' + r.name + '」 ' + k.name + ' 목표 ' + k.target + ' · 현재 ' + k.current;
    }
    var spec = {};
    spec[0] = { m: [['전략 테마 5개', '전략 테마 ' + themes.length + '개'], ['40건', objs.length + '건']],
                emph: '전략 테마 ' + themes.length + '개', src: 'strategyThemes ' + themes.length + '개 / objectives ' + objs.length + '건' };
    /* m: [] = 「치환할 자리는 없지만 실측으로 다시 쓴 줄」 — (추정) 딱지를 떼려면 필요하다 */
    if (under[0]) spec[1] = { m: [], text: kpiText(under[0]) + '예요', emph: String(under[0].bad[0].current), src: under[0].id + ' / kpis' };
    if (under[1]) spec[2] = { m: [], text: kpiText(under[1]) + '예요', emph: String(under[1].bad[0].current), src: under[1].id + ' / kpis' };
    if (under[2]) spec[3] = { m: [], text: kpiText(under[2]) + '예요', emph: String(under[2].bad[0].current), src: under[2].id + ' / kpis' };
    spec[4] = { m: [['다섯 테마', themes.length + '개 테마'], ['세 곳', under.length + '곳'], ['두 곳', okN + '곳']],
                emph: under.length + '곳', src: 'strategyThemes / kpis' };
    spec[5] = { m: [['40건', objs.length + '건'], ['세 곳', under.length + '곳'], ['9건', underObjN + '건']], emph: underObjN + '건',
                src: 'objectives.strategy_theme_id',
                calcm: [['40건', themeLinked + '건'], ['40건', objs.length + '건'],
                        ['100%', (objs.length ? r0(themeLinked / objs.length * 100) : 0) + '%']] };
    return {
      hit: hit, facts: facts,
      notice: [['세 곳', under.length + '곳'], ['9건', underObjN + '건']],
      ev: spec,
      th: { 'TH-전략KPI-미달테마수': under.length + '개', 'TH-테마당목표-최소건수': (perTheme == null ? '?' : pn(perTheme)) + '건' }
    };
  });

  /* --- 목표수립-HR경영진-07 : 발령 대상의 목표 재수립률 미달 --------------
     발령 원천은 employees.jobHistory 뿐이고 발령「일자」가 없다. 그래서 경과일
     조건(TH-발령경과-일수)은 켜지 않고, 대상 인원과 재수립 여부만 실제로 센다. */
  E.registerEval('목표수립-HR경영진-07', function (ctx) {
    var SID = '목표수립-HR경영진-07';
    var moved = arr('employees').filter(function (e) { return e.jobHistory && e.jobHistory.length; });
    var orgSet = {}, orgN = 0, ok;
    moved.forEach(function (e) { orgSet[e.org_id] = 1; });
    for (ok in orgSet) if (Object.prototype.hasOwnProperty.call(orgSet, ok)) orgN++;
    /* 재수립 = 목표·핵심결과의 직무 연결이 바뀐 뒤 직무를 가리키는 사람 */
    var redone = moved.filter(function (e) {
      var h = e.jobHistory[e.jobHistory.length - 1];
      var nid = h && h.new_jobProfileId;
      if (!nid) return false;
      return objsOf(e.emp_id).some(function (o) {
        if (o.job_ref && o.job_ref.jobProfileId === nid) return true;
        return krsOf(o.objective_id).some(function (k) { return k.job_task_ref && k.job_task_ref.jobProfileId === nid; });
      });
    });
    var pct = moved.length ? r0(redone.length / moved.length * 100) : null;
    var empTotal = arr('employees').length;
    var fillPct = empTotal ? r1(moved.length / empTotal * 100) : 0;
    var PLAN = thv(SID, 'TH-발령후재수립률-미달', 50);
    var facts = {
      movedN: moved.length, orgN: orgN, redoneN: redone.length, pct: pct,
      planPct: PLAN, empTotal: empTotal, fillPct: fillPct,
      windowDays: thv(SID, 'TH-발령경과-일수', 30)
    };
    var hit = moved.length >= thv(SID, 'TH-발령대상-최소인원', 5)
      && pct != null && pct < PLAN;
    var spec = {};
    spec[0] = { m: [['30일', facts.windowDays + '일'], ['34명', moved.length + '명'], ['4곳', orgN + '곳']], emph: moved.length + '명',
                src: 'employees.jobHistory ' + moved.length + '명 / orgs ' + orgN + '곳' };
    spec[1] = { m: [['34명', moved.length + '명'], ['6명', redone.length + '명']], emph: redone.length + '명',
                src: 'objectives.job_ref / employees.jobHistory',
                calcm: [['6명', redone.length + '명'], ['34명', moved.length + '명'], ['18%', (pct == null ? '?' : pct) + '%']] };
    spec[2] = { m: [['30일', facts.windowDays + '일'], ['50%', PLAN + '%'], ['34명', moved.length + '명'],
                    ['6명', redone.length + '명'], ['18%', (pct == null ? '?' : pct) + '%']],
                emph: (pct == null ? '?' : pct) + '%', src: '발령 대상 목표 재수립률 기준값' };
    spec[3] = { m: [['221명', empTotal + '명'], ['1명', moved.length + '명']], emph: moved.length + '명뿐',
                src: 'employees.jobHistory / ' + empTotal + '명 중 ' + moved.length + '명',
                calcm: [['1명', moved.length + '명'], ['221명', empTotal + '명'], ['0.5%', pn(fillPct) + '%']] };
    return {
      hit: hit, facts: facts,
      notice: [['34명', moved.length + '명'], ['6명', redone.length + '명']],
      ev: spec,
      th: { 'TH-발령후재수립률-미달': (pct == null ? '?' : pct) + '%', 'TH-발령대상-최소인원': moved.length + '명' }
    };
  });

  /* --- 목표수립-HR경영진-08 : 전사 목표의 1순위 역량 미커버 --------------- */
  E.registerEval('목표수립-HR경영진-08', function (ctx) {
    var SID = '목표수립-HR경영진-08';
    var C = co(), objs = arr('objectives'), krs = arr('keyResults');
    var jpMap = data().jobProfiles || {}, jpN = Object.keys(jpMap).length;
    /* 핵심결과 역량 분포 상위 3 */
    var dist = {}, d;
    krs.forEach(function (k) { if (k.competency_id) dist[k.competency_id] = (dist[k.competency_id] || 0) + 1; });
    var order = [];
    for (d in dist) if (Object.prototype.hasOwnProperty.call(dist, d)) order.push({ d: d, n: dist[d] });
    order.sort(function (a, b) { return b.n - a.n; });
    function share(i) { return order[i] ? pn(order[i].n / krs.length * 100) : '0'; }
    function nameAt(i) { return order[i] ? compKr(order[i].d) : '없음'; }
    /* 직무 1순위 역량 분포 */
    var topDist = {}, j, t2;
    for (j in jpMap) if (Object.prototype.hasOwnProperty.call(jpMap, j)) {
      var p = compProfile(jpMap[j]);
      if (p.length) topDist[p[0].dimension_id] = (topDist[p[0].dimension_id] || 0) + 1;
    }
    var topOrder = [];
    for (t2 in topDist) if (Object.prototype.hasOwnProperty.call(topDist, t2)) topOrder.push({ d: t2, n: topDist[t2] });
    topOrder.sort(function (a, b) { return b.n - a.n; });
    function topAt(i) { return topOrder[i] ? (compKr(topOrder[i].d) + ' ' + topOrder[i].n + '곳') : '없음'; }
    var facts = {
      objTotal: objs.length, jpN: jpN, uncovN: C.uncovObj, uncovTot: C.uncovTot, uncovPct: C.uncovPct,
      krTotal: krs.length, comp1: nameAt(0), comp1Pct: share(0), comp2: nameAt(1), comp2Pct: share(1),
      comp3: nameAt(2), comp3Pct: share(2), jobTop1: topAt(0), jobTop2: topAt(1), jobTop3: topAt(2)
    };
    var hit = C.uncovPct >= thv(SID, 'TH-1순위역량미커버-비율', 40)
      && C.uncovObj >= thv(SID, 'TH-역량미커버-최소건수', 10);
    var spec = {};
    spec[0] = { m: [['40건', objs.length + '건'], ['98종', jpN + '종']], emph: jpN + '종',
                src: 'objectives ' + objs.length + '건 / jobProfiles ' + jpN + '종' };
    spec[1] = { m: [['40건', objs.length + '건'], ['25건', C.uncovObj + '건']], emph: C.uncovObj + '건',
                src: 'objectives × keyResults.competency_id',
                calcm: [['25건', C.uncovObj + '건'], ['40건', C.uncovTot + '건'], ['62.5%', pn(C.uncovPct) + '%']] };
    spec[2] = { m: [['146건', krs.length + '건'], ['실행력 61.0%', nameAt(0) + ' ' + share(0) + '%'],
                    ['성장 마인드셋 19.2%', nameAt(1) + ' ' + share(1) + '%'],
                    ['직무 전문성 12.3%', nameAt(2) + ' ' + share(2) + '%']],
                emph: nameAt(0) + ' ' + share(0) + '%', src: 'keyResults.competency_id ' + krs.length + '건' };
    spec[3] = { m: [['직무 전문성 64곳', topAt(0)], ['협업 30곳', topAt(1)], ['실행력 4곳', topAt(2)],
                    ['실행력 쪽에', nameAt(0) + ' 쪽에']],
                emph: topAt(0), src: 'jobProfiles ' + jpN + '종 / competency_profile' };
    return {
      hit: hit, facts: facts,
      notice: [['40건', objs.length + '건'], ['25건', C.uncovObj + '건']],
      ev: spec,
      th: { 'TH-1순위역량미커버-비율': pn(C.uncovPct) + '%', 'TH-역량미커버-최소건수': C.uncovObj + '건' }
    };
  });

  /* --- 목표수립-HR경영진-09 : 같은 지표명이 여러 목표에서 되풀이 ---------- */
  E.registerEval('목표수립-HR경영진-09', function (ctx) {
    var SID = '목표수립-HR경영진-09';
    var krs = arr('keyResults'), map = dupMap();
    var REP = thv(SID, 'TH-지표명중복-반복횟수', 5);
    var rows = [], n;
    for (n in map) if (Object.prototype.hasOwnProperty.call(map, n)) {
      if (map[n] >= REP) rows.push({ name: n, n: map[n] });
    }
    rows.sort(function (a, b) { return b.n - a.n; });
    var top = rows[0] || null;
    var covered = krs.filter(function (k) { return map[k.name] >= REP; });
    var pct = krs.length ? r1(covered.length / krs.length * 100) : 0;
    var others = rows.slice(1, 4);
    var otherNames = others.map(function (r) { return '「' + r.name + '」'; }).join('·') || '없음';
    var otherN = others.length ? others[0].n : 0;
    /* 목표값 단위가 갈리는지 — 같은 이름인데 단위 문자열이 서로 다르면 「섞여 있다」 */
    var mixed = 0;
    rows.forEach(function (r) {
      var units = {}, c = 0, u;
      krs.forEach(function (k) {
        if (k.name !== r.name) return;
        var unit = String(k.target_value || '').replace(/[0-9.\s]/g, '') || '(단위 없음)';
        units[unit] = 1;
      });
      for (u in units) if (Object.prototype.hasOwnProperty.call(units, u)) c++;
      if (c > 1) mixed++;
    });
    var linked = covered.filter(function (k) { return k.job_task_ref && k.job_task_ref.task_area; }).length;
    var facts = {
      krTotal: krs.length, dupKindN: rows.length, topName: top ? top.name : '', topN: top ? top.n : 0,
      otherNames: otherNames, otherN: otherN, coveredN: covered.length, coveredPct: pct,
      mixedKindN: mixed, linkedN: linked
    };
    var hit = !!top && top.n >= REP && covered.length >= thv(SID, 'TH-지표명중복-대상건수', 20);
    var spec = {};
    spec[0] = { m: [['146건', krs.length + '건']], emph: krs.length + '건', src: 'keyResults ' + krs.length + '건 / name' };
    if (top) spec[1] = { m: [['고객 만족도', top.name], ['9개 목표', top.n + '개 목표']], emph: top.n + '개 목표',
                         src: 'keyResults.name 집계 (' + krs.length + '건)' };
    spec[2] = { m: [['「프로젝트 납기 준수율」·「프로젝트 완수율」·「전문 역량 개발(교육/자격)」', otherNames],
                    ['각각 6개 목표', '각각 ' + otherN + '개 목표 안팎']], emph: '각각 ' + otherN + '개 목표 안팎',
                src: 'keyResults.name 집계 (' + krs.length + '건)' };
    spec[3] = { m: [['네 지표', rows.length + '개 지표'], ['27건', covered.length + '건'], ['146건', krs.length + '건'],
                    ['18%', pn(pct) + '%']], emph: pn(pct) + '%', src: 'keyResults ' + krs.length + '건',
                calcm: [['27건', covered.length + '건'], ['146건', krs.length + '건'], ['18.5%', pn(pct) + '%']] };
    spec[4] = { m: [['목표값 단위도 나뉘어 건수·비율·점수가 섞여 있어요',
                     mixed ? ('목표값 단위도 ' + mixed + '개 지표에서 나뉘어 건수·비율·점수가 섞여 있어요')
                           : '목표값 단위만큼은 지표마다 같게 쓰고 있어요']],
                emph: mixed ? (mixed + '개 지표') : '단위는 같아',
                src: 'keyResults.target_value / 중복 지표 ' + rows.length + '종' };
    spec[5] = { m: [['27건', covered.length + '건'],
                    ['모두 연결돼 있어', linked === covered.length ? '모두 연결돼 있어' : (linked + '건이 연결돼 있어')]],
                emph: linked === covered.length ? '모두 연결' : (linked + '건 연결'), src: 'keyResults.job_task_ref' };
    return {
      hit: hit, facts: facts,
      notice: top ? [['고객 만족도', top.name], ['9개', top.n + '개']] : [],
      ev: spec,
      th: { 'TH-지표명중복-반복횟수': (top ? top.n : 0) + '회', 'TH-지표명중복-대상건수': covered.length + '건' }
    };
  });

  /* ==================================================================
     데이터 없음 — 판정 함수를 붙이지 않은 신호
     ------------------------------------------------------------------
     데이터 없음: 목표수립-상위조직장-06 — 필요한 원천 「조직 개편·통합 이력」.
       이 신호의 방아쇠는 「하위 조직이 바뀐 날」과 「그 뒤 목표 소유가 갱신됐는지」다.
       orgs 에는 조직의 지금 모습만 있고 언제 통합·분할됐는지가 없으며,
       objectiveHistory 가 남기는 항목도 progress·title·parent_objective_id 셋뿐이라
       목표 소유(org_id·owner_emp_id) 변경 자체가 기록되지 않는다. 변경 이벤트가 없는데
       「변경 뒤 0건」을 세면 언제나 참이 되는 거짓 신호가 되므로 붙이지 않는다.
       필요한 원천 = 조직 변경 이력(변경일·전후 조직) + 목표 소유 변경 이력.
  ================================================================== */
})();
