/* js/ez_signal_eval9.js — 담당 E: 피드백 21건 미등록 신호에 판정 함수 등록 (20-6차)
   ------------------------------------------------------------------------
   eval5 가 이미 맡은 10건(구성원 01·04·06 / 팀장 01·07·08 / 상위조직장 01·05·07 /
   HR경영진 01·09)을 뺀 나머지다. 형식·반환 스키마·공용 도구는 eval5 를 그대로 따른다.

   이 단계에서 새로 쓰는 원천
     · demoSubjects[*].peerReviews — 다면진단(동료 리뷰) 55건이 13명 안에만 있다.
       최상위 배열이 아니라 대상자 아래 묶여 있어 평평하게 펴서 쓴다.
       reviewer_id 가 있어 「받은 리뷰」와 「내가 쓴 리뷰」를 모두 셀 수 있다.
     · feedbackLog(draft_at·sent_at·read_at) · feedbackHistory(FY2025 7건)
     · devPlan(registered·items) · evaluatorMap(first_evaluator)
     · upwardFeedback(respondents) · notifyLog(sent_at·read_at) · evaluationsPrev(krs)

   없는 값은 만들지 않는다. 계산이 닿지 않는 근거 줄은 spec 을 비워 두어
   엔진이 (추정)으로 표시하게 한다. 파일 맨 아래에 그 목록을 남겨 뒀다.
   ------------------------------------------------------------------------ */
(function () {
  'use strict';
  var E = window.EZSignalEngine;
  if (!E || !E.registerEval) return;          /* 엔진 없으면 조용히 아무 것도 안 한다 */
  var Hp = E.helpers || {};
  function arr(k) { return (Hp.arr ? Hp.arr(k) : []) || []; }
  var r0 = Hp.r0, r1 = Hp.r1, pn = Hp.pn, thv = Hp.thv, asofMs = Hp.asofMs, avg = Hp.avg, cut = Hp.cut;

  /* ---------- 공용 도구 (eval5 와 같은 규칙) ---------- */
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function dateOnly(s) { return s ? String(s).slice(0, 10) : null; }
  function dnum(s) { if (!s) return null; var t = Date.parse(String(s).slice(0, 10) + 'T00:00:00Z'); return isNaN(t) ? null : t; }
  function daysSince(s) { var t = dnum(s); return t == null ? null : Math.round((asofMs() - t) / 86400000); }
  function data() { return Hp.data ? Hp.data() : {}; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function empById(id) { var out = null; arr('employees').forEach(function (e) { if (e.emp_id === id) out = e; }); return out; }
  function empName(id) { var e = empById(id); return e ? e.name : id; }
  function orgById(id) { var out = null; arr('orgs').forEach(function (o) { if (o.org_id === id) out = o; }); return out; }
  function periodOf(kind) {
    var found = null;
    arr('periods').forEach(function (p) { if (!found && p.kind === kind && p.status !== 'closed') found = p; });
    if (!found) arr('periods').forEach(function (p) { if (!found && p.kind === kind) found = p; });
    return found;
  }
  /* 조직 하위 트리(자기 자신 포함) — 엔진 내부 subtreeIds 는 밖에서 못 쓴다 */
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
  function empIdsInOrgSet(set) {
    var out = {};
    arr('employees').forEach(function (e) { if (set[e.org_id]) out[e.emp_id] = 1; });
    return out;
  }
  function reportsOf(empId) { return arr('employees').filter(function (e) { return e.manager_id === empId; }); }

  /* 역량 표기 — competencies[].name 은 영문이라 엔진과 같은 dimension_id 표기표를 쓴다 */
  var COMP_KR = { D1: '리더십', D2: '협업', D3: '직무 전문성', D4: '실행력', D5: '성장 마인드셋' };
  function compKr(id) { return COMP_KR[id] || id || ''; }
  function jpOf(emp) { var m = data().jobProfiles || {}; return (emp && m[emp.jobProfileId]) || null; }
  /* 직무 기준 역량 가중치 내림차순 — 엔진 compProfile 과 같은 원천 */
  function compProfile(emp) {
    var jp = jpOf(emp);
    var p = (jp && Object.prototype.toString.call(jp.competency_profile) === '[object Array]') ? jp.competency_profile : [];
    return p.slice().sort(function (a, b) { return (b.weight || 0) - (a.weight || 0); });
  }
  function topComp(emp) { return compProfile(emp)[0] || null; }
  /* 그 사람이 소유한 목표에 달린 핵심결과 */
  function krsOf(empId) {
    var oids = {};
    arr('objectives').forEach(function (o) { if (o.owner_emp_id === empId) oids[o.objective_id] = 1; });
    return arr('keyResults').filter(function (k) { return oids[k.objective_id]; });
  }
  /* 지난 기간 리더 피드백 문장에서 뒷부분만 잘라 쓴다 (엔진이 쓰는 방식과 같다) */
  function fbSnippet(fb) {
    if (!fb) return '';
    return cut(String(fb.summary).split('—').pop().split('.')[0].replace(/^\s+/, ''), 26);
  }
  /* 문장 안에 이름이 등장하는 역량을 찾는다 — 지난 피드백에는 역량 코드가 없고 문장만 있다 */
  function compInText(t) {
    var s = String(t == null ? '' : t), d;
    for (d in COMP_KR) if (has(COMP_KR, d)) { if (s.indexOf(COMP_KR[d]) >= 0) return d; }
    return null;
  }

  /* ---------- 다면진단(동료 리뷰) 도구 ----------
     peerReviews 는 demoSubjects 아래에만 있다. 13명 55건이 전부이며 모두 2026년 4월치다. */
  function allReviews() {
    var out = [];
    arr('demoSubjects').forEach(function (s) {
      (s.peerReviews || []).forEach(function (p) { out.push({ target: s.emp_id, rev: p }); });
    });
    return out;
  }
  function reviewsFor(empId) {
    var out = [];
    allReviews().forEach(function (x) { if (x.target === empId) out.push(x.rev); });
    return out;
  }
  function reviewsBy(empId) { return allReviews().filter(function (x) { return x.rev.reviewer_id === empId; }); }
  function devKeys(rev) { var d = rev.dev_comments || {}, out = [], k; for (k in d) if (has(d, k) && d[k]) out.push(k); return out; }
  function strKeys(rev) { var d = rev.strength_comments || {}, out = [], k; for (k in d) if (has(d, k) && d[k]) out.push(k); return out; }
  function hasDev(rev) { return devKeys(rev).length > 0; }
  function hasStr(rev) { return strKeys(rev).length > 0; }
  /* 리뷰 묶음의 역량 축별 평균 — 오름차순이라 [0] 이 최하 축, 마지막이 최고 축 */
  function dimAvgOf(revs) {
    var acc = {}, out = [], k;
    revs.forEach(function (p) {
      var d = p.dimensions || {}, k2;
      for (k2 in d) if (has(d, k2)) (acc[k2] = acc[k2] || []).push(+(d[k2] && d[k2].raw) || 0);
    });
    for (k in acc) if (has(acc, k)) out.push({ dim: k, v: r2(avg(acc[k])) });
    out.sort(function (a, b) { return a.v - b.v; });
    return out;
  }
  /* 다면진단 결과를 가진 사람 = peerReviews 가 1건이라도 붙은 대상자 */
  function reviewedSubjects() { return arr('demoSubjects').filter(function (s) { return (s.peerReviews || []).length > 0; }); }
  /* 육성 설명이 남아 있는가 — 육성 계획 항목 · 면담 기록 · 다면진단 개발 의견 셋 중 하나 */
  function devPlanOf(empId) { var out = null; arr('devPlan').forEach(function (p) { if (p.emp_id === empId) out = p; }); return out; }
  function devItemsN(empId) { var p = devPlanOf(empId); return (p && p.items) ? p.items.length : 0; }
  function meetingsOf(empId) { return arr('meetingStore').filter(function (m) { return m.member_emp_id === empId; }); }
  function devCommentN(empId) {
    var n = 0;
    reviewsFor(empId).forEach(function (p) { n += devKeys(p).length; });
    return n;
  }

  /* ==================================================================
     구성원
  ================================================================== */

  /* --- 피드백-구성원-02 : 동료 리뷰 최하 역량이 직무 1순위와 겹침 ---------- */
  E.registerEval('피드백-구성원-02', function (ctx) {
    var SID = '피드백-구성원-02';
    var my = ctx.emp.emp_id;
    var revs = reviewsFor(my);
    var dims = dimAvgOf(revs);
    var lo = dims[0] || null, hi = dims.length ? dims[dims.length - 1] : null;
    var gap = (lo && hi) ? r2(hi.v - lo.v) : null;
    var top = topComp(ctx.emp);
    var cover = top ? ctx.myKrs.filter(function (k) { return k.competency_id === top.dimension_id; }).length : 0;
    var fb = arr('feedbackHistory').filter(function (f) { return f.emp_id === my && f.source_type === 'leader'; })[0] || null;
    var loIsTop1 = !!(lo && top && lo.dim === top.dimension_id);
    var facts = {
      reviewN: revs.length, dimN: dims.length,
      loComp: lo ? compKr(lo.dim) : '', loScore: lo ? lo.v : null,
      hiComp: hi ? compKr(hi.dim) : '', hiScore: hi ? hi.v : null, gap: gap,
      top1: top ? compKr(top.dimension_id) : '', top1W: top ? top.weight : 0,
      top1Cover: cover, loIsTop1: loIsTop1
    };
    /* 「가장 낮은 축」이 곧 「직무가 가장 무겁게 두는 축」일 때만 부른다.
       점수 차가 작으면 축 순위가 흔들리므로 최고 축과의 차이도 함께 본다. */
    var hit = revs.length > 0 && loIsTop1
      && gap != null && gap >= thv(SID, 'TH-역량점수-최하', 1)
      && cover <= thv(SID, 'TH-1순위역량-미커버', 0);
    var src = 'demoSubjects.peerReviews ' + revs.length + '건 / ' + my;
    var spec = {};
    if (lo) spec[0] = { m: [['5건', revs.length + '건'], ['협업', facts.loComp], ['3.44점', lo.v + '점']],
                emph: lo.v + '점', src: src, calcm: [['5건', revs.length + '건']] };
    if (hi) spec[1] = { m: [['리더십', facts.hiComp], ['4.79점', hi.v + '점']], emph: hi.v + '점', src: src };
    if (gap != null) spec[2] = { m: [['리더십', facts.hiComp], ['1.35점', gap + '점'], ['1.0점', thv(SID, 'TH-역량점수-최하', 1) + '점']],
                emph: gap + '점', src: '동료 리뷰 역량 점수 차 운영 기준' };
    if (top) {
      spec[3] = { m: [['유지보수담당', ctx.emp.jobTitle || ''], ['협업', facts.top1], ['35%', top.weight + '%']],
                emph: top.weight + '%', src: ctx.emp.jobProfileId };
      spec[4] = { m: [['협업', facts.top1], ['0건', cover + '건']], emph: cover + '건',
                src: ctx.emp.jobProfileId + ' / 핵심결과 ' + ctx.myKrs.length + '건' };
    }
    if (fb) spec[5] = { m: [['협업 리드 경험을 늘려 달라', fbSnippet(fb)]], emph: fbSnippet(fb),
                src: fb.fb_id + ' / ' + fb.period, asof: '2025-12-31' };
    return {
      hit: hit, facts: facts,
      notice: lo ? [['협업', facts.loComp], ['3.44점', lo.v + '점']] : [],
      ev: spec,
      th: { 'TH-역량점수-최하': (gap == null ? '?' : gap) + '점', 'TH-1순위역량-미커버': cover + '건' }
    };
  });

  /* --- 피드백-구성원-03 : 같은 목표에 기록을 남긴 동료의 피드백 도착 ------- */
  E.registerEval('피드백-구성원-03', function (ctx) {
    var SID = '피드백-구성원-03';
    var my = ctx.emp.emp_id;
    var FRESH = thv(SID, 'TH-피드백도착-신선도', 3);
    var got = arr('feedbackLog').filter(function (f) { return f.to_emp === my && f.sent_at && f.from_emp; });
    got.sort(function (a, b) { return dateOnly(a.sent_at) < dateOnly(b.sent_at) ? 1 : -1; });
    var latest = got[0] || null;
    var arrived = dateOnly(latest && latest.sent_at);
    var elapsed = arrived ? daysSince(arrived) : null;
    var freshN = got.filter(function (f) { var d = daysSince(dateOnly(f.sent_at)); return d != null && d <= FRESH; }).length;
    /* 「같은 목표」 = 내가 소유한 목표 + 내가 체크인을 남긴 목표 */
    var myObjIds = {};
    ctx.myObjs.forEach(function (o) { myObjIds[o.objective_id] = 1; });
    ctx.myCks.forEach(function (c) { if (c.objective_id) myObjIds[c.objective_id] = 1; });
    var peerCk = latest ? arr('checkins').filter(function (c) {
      return c.emp_id === latest.from_emp && myObjIds[c.objective_id];
    }).length : 0;
    /* 지난 기간 이 동료와 주고받은 기록 — 이번 건은 빼고 센다 */
    var pastN = latest ? arr('feedbackLog').filter(function (f) {
      if (f.log_id === latest.log_id) return false;
      return (f.to_emp === my && f.from_emp === latest.from_emp) || (f.from_emp === my && f.to_emp === latest.from_emp);
    }).length : 0;
    var facts = {
      receivedN: got.length, arrived: arrived, elapsed: elapsed, freshN: freshN,
      fromName: latest ? empName(latest.from_emp) : '', peerCk: peerCk, pastN: pastN
    };
    /* 방금 도착했고, 보낸 사람이 내 목표에 기록을 남긴 동료일 때만 말을 건다 */
    var hit = !!latest && elapsed != null && elapsed >= 0 && elapsed <= FRESH && peerCk >= 1;
    var spec = {};
    if (latest) {
      spec[0] = { m: [['2026년 7월 25일', arrived], ['1건', (freshN || 1) + '건']], emph: (freshN || 1) + '건',
                src: latest.log_id + ' / feedbackLog to_emp=' + my, assumed: 0 };
      spec[1] = { m: [['체크인 2건', '체크인 ' + peerCk + '건']], emph: '체크인 ' + peerCk + '건',
                src: latest.from_emp + ' / checkins.objective_id' };
      spec[2] = { m: [['1건', pastN + '건']], emph: pastN + '건',
                src: my + ' ↔ ' + latest.from_emp + ' / feedbackLog ' + pastN + '건' };
    }
    return {
      hit: hit, facts: facts,
      notice: latest ? [['1건', (freshN || 1) + '건']] : [],
      ev: spec,
      th: { 'TH-피드백도착-신선도': (elapsed == null ? '?' : elapsed) + '일' }
    };
  });

  /* --- 피드백-구성원-05 : 1on1 합의 항목이 목표에도 체크인에도 없음 -------- */
  E.registerEval('피드백-구성원-05', function (ctx) {
    var SID = '피드백-구성원-05';
    var my = ctx.emp.emp_id;
    var mts = meetingsOf(my).slice();
    mts.sort(function (a, b) { return dateOnly(a.at) < dateOnly(b.at) ? 1 : -1; });
    var last = mts[0] || null;
    var ags = (last && last.agreements) || [];
    /* 반영되지 않은 합의 = 아직 done 이 아닌 항목(open·overdue) */
    var open = ags.filter(function (a) { return a.status !== 'done'; });
    var metDate = dateOnly(last && last.at);
    var elapsed = metDate ? daysSince(metDate) : null;
    /* 면담 뒤 내가 남긴 기록 — 체크인이 하나라도 있으면 「없다」고 말하지 않는다 */
    var afterCk = metDate ? ctx.myCks.filter(function (c) {
      var d = dnum(c.checkin_date), m = dnum(metDate);
      return d != null && m != null && d > m;
    }).length : 0;
    /* 합의 항목이 가리키는 핵심결과 — ref_kr 이 있는 건만 이름을 밝힌다 */
    var refKr = null;
    open.forEach(function (a) {
      if (refKr || !a.ref_kr) return;
      arr('keyResults').forEach(function (k) { if (!refKr && k.kr_id === a.ref_kr) refKr = k; });
    });
    var facts = {
      meetingDate: metDate, agreeN: ags.length, openN: open.length, elapsed: elapsed,
      afterCk: afterCk, refKrName: refKr ? refKr.name : ''
    };
    var hit = !!last && open.length >= thv(SID, 'TH-합의반영-없음', 1)
      && elapsed != null && elapsed >= thv(SID, 'TH-합의반영-기한', 7) && afterCk === 0;
    var spec = {};
    if (last) {
      /* 미반영이 0건이면 「0건이 없어요」가 되어 말이 어긋난다 — 어절째 실제 상태로 바꾼다 */
      spec[0] = open.length
        ? { m: [['2건', open.length + '건']], emph: open.length + '건',
            src: last.meeting_id + ' / agreements ' + ags.length + '건', assumed: 0 }
        : { m: [], text: '지난 1on1에서 합의한 항목 ' + ags.length + '건은 모두 반영됐어요', emph: ags.length + '건 모두',
            src: last.meeting_id + ' / agreements ' + ags.length + '건', assumed: 0 };
      spec[1] = { m: [['2026년 7월 16일', metDate], ['10일', elapsed + '일']], emph: elapsed + '일',
                src: last.meeting_id + ' / meetingStore.at', assumed: 0 };
      if (refKr) spec[2] = { m: [['2건', open.length + '건'], ['평균 응답 시간', refKr.name]], emph: refKr.name,
                src: refKr.kr_id + ' / agreements.ref_kr' };
    }
    return {
      hit: hit, facts: facts,
      notice: last
        ? (open.length
            ? [['10일', (elapsed == null ? '?' : elapsed) + '일'], ['2건', open.length + '건']]
            : [['10일', (elapsed == null ? '?' : elapsed) + '일'],
               ['합의 항목 2건이 목표에도 체크인에도 없어요', '합의 항목 ' + ags.length + '건은 모두 반영됐어요']])
        : [],
      ev: spec,
      th: { 'TH-합의반영-기한': (elapsed == null ? '?' : elapsed) + '일', 'TH-합의반영-없음': open.length + '건' }
    };
  });

  /* --- 피드백-구성원-07 : 받은 리뷰의 개발 의견 비율이 전사 기준선 미달 ---- */
  E.registerEval('피드백-구성원-07', function (ctx) {
    var SID = '피드백-구성원-07';
    var my = ctx.emp.emp_id;
    var revs = reviewsFor(my);
    var devMine = revs.filter(hasDev).length;
    var all = allReviews();
    var devAll = all.filter(function (x) { return hasDev(x.rev); }).length;
    var strAll = all.filter(function (x) { return hasStr(x.rev); }).length;
    var devAllPct = all.length ? r1(devAll / all.length * 100) : null;
    var strAllPct = all.length ? r1(strAll / all.length * 100) : null;
    var myPct = revs.length ? r1(devMine / revs.length * 100) : null;
    var emptyRevs = revs.filter(function (p) { return !hasDev(p); });
    var sameOrg = emptyRevs.filter(function (p) {
      var e = empById(p.reviewer_id);
      return e && e.org_id === ctx.emp.org_id;
    }).length;
    var facts = {
      reviewN: revs.length, devMine: devMine, myPct: myPct,
      allN: all.length, devAll: devAll, devAllPct: devAllPct, strAll: strAll, strAllPct: strAllPct,
      emptyN: emptyRevs.length, sameOrgN: sameOrg
    };
    /* 기준선은 카탈로그가 단일 원천이다. 비율만 보면 리뷰 1건짜리도 걸리므로
       개발 의견 「건수」 하한을 함께 둔다. */
    var hit = revs.length > 0 && myPct != null && myPct < thv(SID, 'TH-개발의견-비율', 52.7)
      && devMine < thv(SID, 'TH-개발의견-최소건수', 2);
    var spec = {};
    spec[0] = { m: [['5건', revs.length + '건'], ['1건', devMine + '건']], emph: devMine + '건',
                src: 'demoSubjects.peerReviews ' + revs.length + '건 / ' + my };
    if (devAllPct != null) spec[1] = { m: [['55건', all.length + '건'], ['29건', devAll + '건'], ['52.7%', pn(devAllPct) + '%']],
                emph: devAll + '건(' + pn(devAllPct) + '%)', src: 'peerReviews.dev_comments (' + all.length + '건)',
                calcm: [['55', String(all.length)]] };
    if (strAllPct != null) spec[2] = { m: [['55건', all.length + '건'], ['39건', strAll + '건'], ['70.9%', pn(strAllPct) + '%']],
                emph: strAll + '건(' + pn(strAllPct) + '%)', src: 'peerReviews.strength_comments (' + all.length + '건)' };
    spec[3] = { m: [['4건', emptyRevs.length + '건'],
                    ['모두', (sameOrg === emptyRevs.length && emptyRevs.length) ? '모두' : (sameOrg + '건이')]],
                emph: (sameOrg === emptyRevs.length && emptyRevs.length) ? '같은 조직' : (sameOrg + '건'),
                src: ctx.emp.org_id + ' / 개발 의견 없는 리뷰 ' + emptyRevs.length + '건' };
    return {
      hit: hit, facts: facts,
      notice: [['5건', revs.length + '건'], ['1건', devMine + '건'], ['52.7%', pn(devAllPct == null ? 0 : devAllPct) + '%']],
      ev: spec,
      th: { 'TH-개발의견-비율': (myPct == null ? '?' : pn(myPct)) + '%', 'TH-개발의견-최소건수': devMine + '건' }
    };
  });

  /* --- 피드백-구성원-08 : 내가 제출한 리뷰에 개발 의견이 비어 있음 --------- */
  E.registerEval('피드백-구성원-08', function (ctx) {
    var SID = '피드백-구성원-08';
    var my = ctx.emp.emp_id;
    var subs = reviewsBy(my);
    var emptyDev = subs.filter(function (x) { return !hasDev(x.rev); });
    var filledStr = subs.filter(function (x) { return hasStr(x.rev); });
    var all = allReviews();
    var devAll = all.filter(function (x) { return hasDev(x.rev); }).length;
    var devAllPct = all.length ? r1(devAll / all.length * 100) : null;
    /* 대상자마다 직무 1순위 역량을 뽑고, 내가 그 축을 가장 낮게 매겼는지 본다 */
    var tops = [], lowestHit = 0;
    subs.forEach(function (x) {
      var te = empById(x.target), t = te ? topComp(te) : null;
      if (!t) return;
      tops.push('「' + compKr(t.dimension_id) + '」 ' + t.weight + '%');
      var dl = dimAvgOf([x.rev]);
      if (dl.length && dl[0].dim === t.dimension_id) lowestHit++;
    });
    var facts = {
      submitN: subs.length, emptyDevN: emptyDev.length, filledStrN: filledStr.length,
      allN: all.length, devAll: devAll, devAllPct: devAllPct,
      topList: tops.join(', '), lowestHit: lowestHit
    };
    /* 「의견 칸이 비었다」만으로는 부를 이유가 약하다. 상대의 1순위 역량을 낮게 매겨
       놓고 설명을 안 적은 건이 함께 있어야 고쳐 쓸 실익이 있다. */
    var hit = subs.length > 0 && emptyDev.length >= thv(SID, 'TH-내리뷰-개발의견없음', 1) && lowestHit >= 1;
    var srcMine = 'demoSubjects.peerReviews reviewer_id=' + my + ' ' + subs.length + '건';
    /* 「3건 모두」 자리를 숫자만 갈아끼우면 조사가 빠져 문장이 깨진다 — 어절째 바꾼다 */
    var emptyPhrase = (emptyDev.length === subs.length && subs.length)
      ? (subs.length + '건 모두') : (subs.length + '건 중 ' + emptyDev.length + '건은');
    var strPhrase = (filledStr.length === subs.length && subs.length)
      ? (subs.length + '건 모두') : (subs.length + '건 중 ' + filledStr.length + '건이');
    var spec = {};
    spec[0] = { m: [['3건 모두', emptyPhrase]], emph: emptyDev.length + '건', src: srcMine, assumed: 0 };
    spec[1] = { m: [['3건 모두', strPhrase]], emph: filledStr.length + '건', src: srcMine, assumed: 0 };
    if (devAllPct != null) spec[2] = { m: [['55건', all.length + '건'], ['29건', devAll + '건'], ['52.7%', pn(devAllPct) + '%']],
                emph: devAll + '건(' + pn(devAllPct) + '%)', src: 'peerReviews.dev_comments (' + all.length + '건)' };
    if (tops.length) spec[3] = { m: [['3명', tops.length + '명'],
                    ['「협업」 35%, 「직무 전문성」 40%, 「협업」 30%', tops.join(', ')]],
                emph: '1순위', src: subs.map(function (x) { return x.target; }).join(' / ') };
    spec[4] = { m: [['2건', lowestHit + '건']], emph: lowestHit + '건', src: srcMine };
    /* [5] 지난 사이클 내 리뷰 — peerReviews 는 2026년 4월치뿐이라 계산 불가 → (추정) */
    return {
      hit: hit, facts: facts,
      notice: [['3건 모두', emptyPhrase]],
      ev: spec,
      th: { 'TH-개발의견-비율': (devAllPct == null ? '?' : pn(devAllPct)) + '%', 'TH-내리뷰-개발의견없음': emptyDev.length + '건' }
    };
  });

  /* --- 피드백-구성원-09 : 지난 사이클 개선 약속이 이번 기간에 없음 --------- */
  E.registerEval('피드백-구성원-09', function (ctx) {
    var SID = '피드백-구성원-09';
    var my = ctx.emp.emp_id;
    var leaderFb = arr('feedbackHistory').filter(function (f) { return f.emp_id === my && f.source_type === 'leader'; });
    /* 개선 약속을 담는 칸이 없어 지난 리더 피드백 문장에서 역량 이름을 찾아 잇는다 */
    var promiseFb = null, promiseDim = null;
    leaderFb.forEach(function (f) {
      if (promiseDim) return;
      var d = compInText(f.summary);
      if (d) { promiseDim = d; promiseFb = f; }
    });
    var cover = promiseDim ? ctx.myKrs.filter(function (k) { return k.competency_id === promiseDim; }).length : null;
    var facts = {
      promiseN: leaderFb.length, promiseComp: promiseDim ? compKr(promiseDim) : '',
      promiseText: fbSnippet(promiseFb), cover: cover,
      objN: ctx.myObjs.length, krN: ctx.myKrs.length
    };
    var hit = leaderFb.length >= thv(SID, 'TH-개선약속-미이행', 1) && !!promiseDim && cover === 0;
    var spec = {};
    spec[0] = { m: [['0건', (cover == null ? 0 : cover) + '건']], emph: (cover == null ? 0 : cover) + '건',
                src: '이번 기간 목표 ' + ctx.myObjs.length + '건 · 핵심결과 ' + ctx.myKrs.length + '건' };
    spec[1] = { m: [['1건', leaderFb.length + '건']], emph: leaderFb.length + '건',
                src: leaderFb.map(function (f) { return f.fb_id; }).join(' / ') || '지난 사이클 기록 없음' };
    if (promiseDim) spec[2] = { m: [['협업', compKr(promiseDim)], ['0건', cover + '건']], emph: cover + '건',
                src: ctx.myKrs.map(function (k) { return k.kr_id; }).join(' / ') || '핵심결과 없음' };
    if (promiseFb) spec[3] = { m: [['협업 리드 경험을 늘려 달라', fbSnippet(promiseFb)]], emph: fbSnippet(promiseFb),
                src: promiseFb.fb_id + ' / ' + promiseFb.period, asof: '2025-12-31' };
    return {
      hit: hit, facts: facts,
      notice: [['1건', leaderFb.length + '건']],
      ev: spec,
      th: { 'TH-개선약속-미이행': leaderFb.length + '건' }
    };
  });

  /* ==================================================================
     팀장
  ================================================================== */

  /* --- 피드백-팀장-02 : 피드백 초안을 저장해 놓고 전달하지 않음 ------------ */
  E.registerEval('피드백-팀장-02', function (ctx) {
    var SID = '피드백-팀장-02';
    var my = ctx.emp.emp_id;
    var ids = {};
    reportsOf(my).forEach(function (e) { ids[e.emp_id] = 1; });
    var drafts = arr('feedbackLog').filter(function (f) { return ids[f.to_emp] && f.draft_at; });
    var unsent = drafts.filter(function (f) { return !f.sent_at; });
    unsent.sort(function (a, b) { return dateOnly(a.draft_at) < dateOnly(b.draft_at) ? -1 : 1; });
    /* 미발송이 없으면 「저장 → 전달」이 가장 오래 걸린 건을 대표로 보여 준다.
       숫자를 지어내지 않고 실제로 몇 일 묵었는지만 말한다. */
    var slow = null, slowLag = -1;
    drafts.forEach(function (f) {
      if (!f.sent_at) return;
      var lag = Math.round((dnum(dateOnly(f.sent_at)) - dnum(dateOnly(f.draft_at))) / 86400000);
      if (lag > slowLag) { slowLag = lag; slow = f; }
    });
    var pick = unsent[0] || slow || null;
    var elapsed = pick ? (pick.sent_at ? slowLag : daysSince(dateOnly(pick.draft_at))) : null;
    var facts = {
      draftN: drafts.length, unsentN: unsent.length,
      targetName: pick ? empName(pick.to_emp) : '', draftDate: dateOnly(pick && pick.draft_at),
      elapsed: elapsed, sentDate: dateOnly(pick && pick.sent_at)
    };
    var hit = unsent.length >= 1 && elapsed != null && elapsed >= thv(SID, 'TH-피드백전달지연-초과', 5);
    var spec = {};
    if (pick) {
      spec[0] = pick.sent_at
        ? { m: [], text: '이 초안은 ' + dateOnly(pick.sent_at) + '에 전달돼 발송 기록이 남아 있어요',
            emph: '발송 기록', src: pick.log_id + ' / feedbackLog.sent_at', assumed: 0 }
        : { m: [], emph: '발송·수신 기록', src: pick.log_id + ' / 전달 기록 0건', assumed: 0 };
      spec[1] = { m: [['{{팀원명}}', facts.targetName], ['5일', elapsed + '일'],
                      ['5일', thv(SID, 'TH-피드백전달지연-초과', 5) + '일']],
                emph: elapsed + '일', src: pick.log_id + ' / feedbackLog.draft_at ' + facts.draftDate };
      /* [2] 초안 수정 이력이 없는 원천이라 「고쳐지지 않았다」는 확인할 수 없다 → (추정) */
    }
    return {
      hit: hit, facts: facts,
      notice: pick ? [['{{팀원명}}', facts.targetName], ['5일', elapsed + '일'],
                      ['0건', (pick.sent_at ? 1 : 0) + '건']] : [],
      ev: spec,
      th: { 'TH-피드백전달지연-초과': (elapsed == null ? '?' : elapsed) + '일', 'TH-전달기록-없음': unsent.length + '건' }
    };
  });

  /* --- 피드백-팀장-03 : 새 동료 리뷰에서 같은 역량이 겹쳐 지적됨 ----------- */
  E.registerEval('피드백-팀장-03', function (ctx) {
    var SID = '피드백-팀장-03';
    var my = ctx.emp.emp_id;
    var best = null;
    reportsOf(my).forEach(function (e) {
      var revs = reviewsFor(e.emp_id);
      if (!revs.length) return;
      var cnt = {}, last = null;
      revs.forEach(function (p) {
        devKeys(p).forEach(function (d) { cnt[d] = (cnt[d] || 0) + 1; });
        var rd = dateOnly(p.review_date);
        if (rd && (!last || rd > last)) last = rd;
      });
      var top = null, second = 0, d2;
      for (d2 in cnt) if (has(cnt, d2)) { if (!top || cnt[d2] > cnt[top]) top = d2; }
      for (d2 in cnt) if (has(cnt, d2)) { if (d2 !== top && cnt[d2] > second) second = cnt[d2]; }
      if (!top) return;
      if (!best || cnt[top] > best.n) {
        var prof = compProfile(e), rank = 0, w = 0, i;
        for (i = 0; i < prof.length; i++) if (prof[i].dimension_id === top) { rank = i + 1; w = prof[i].weight; }
        best = { emp: e, revN: revs.length, dim: top, n: cnt[top], second: second, last: last, rank: rank, w: w };
      }
    });
    var facts = best ? {
      targetName: best.emp.name, reviewN: best.revN, comp: compKr(best.dim), sameN: best.n,
      secondN: best.second, arrived: best.last, jobTitle: best.emp.jobTitle || '',
      compW: best.w, compRank: best.rank
    } : { targetName: '', reviewN: 0, sameN: 0 };
    /* 익명 보호선(응답 3명) 아래에서는 「누가 짚었는지」가 드러나므로 부르지 않는다 */
    var hit = !!best && best.revN >= thv(SID, 'TH-익명보호-최소', 3)
      && best.n >= thv(SID, 'TH-리뷰동일역량-누적', 2);
    var spec = {};
    if (best) {
      var srcPr = best.emp.emp_id + ' / peerReviews ' + best.revN + '건';
      spec[0] = { m: [['{{팀원명}}', best.emp.name], ['3건', best.revN + '건'], ['2026년 7월 14일', best.last]],
                emph: best.revN + '건', src: srcPr };
      spec[1] = { m: [['2건', best.n + '건'], ['직무 전문성', compKr(best.dim)]], emph: best.n + '건',
                src: srcPr + ' / dev_comments' };
      spec[2] = { m: [['1건', best.second + '건']], emph: best.second + '건', src: srcPr + ' / dev_comments' };
      /* [3] 지난 기간 리뷰가 없어 강점↔개발 뒤집힘은 확인 불가 → (추정) */
      if (best.rank) spec[4] = { m: [['시스템운영담당', best.emp.jobTitle || ''], ['20%', best.w + '%'],
                      ['세 번째', best.rank + '번째']], emph: best.w + '%', src: best.emp.jobProfileId };
      /* [5] 피드백 초안 저장 위치가 없어 반영 여부는 확인 불가 → (추정) */
    }
    return {
      hit: hit, facts: facts,
      notice: best ? [['3건', best.revN + '건'], ['2건', best.n + '건'], ['직무 전문성', compKr(best.dim)]] : [],
      ev: spec,
      th: { 'TH-리뷰동일역량-누적': (best ? best.n : 0) + '건', 'TH-초안반영-없음': '확인 불가',
            'TH-익명보호-최소': (best ? best.revN : 0) + '명' }
    };
  });

  /* --- 피드백-팀장-04 : 개발 의견이 직무 1순위 역량을 비껴감 --------------- */
  E.registerEval('피드백-팀장-04', function (ctx) {
    var SID = '피드백-팀장-04';
    var my = ctx.emp.emp_id;
    var rows = [];
    reportsOf(my).forEach(function (e) {
      var revs = reviewsFor(e.emp_id);
      if (!revs.length) return;
      var axes = {};
      revs.forEach(function (p) { devKeys(p).forEach(function (d) { axes[d] = 1; }); });
      var list = [], d;
      for (d in axes) if (has(axes, d)) list.push(d);
      var top = topComp(e);
      rows.push({ emp: e, axes: list, axisN: list.length, top: top,
                  covered: !!(top && axes[top.dimension_id]) });
    });
    var teamAvgAxes = rows.length ? r1(avg(rows.map(function (r) { return r.axisN; }))) : null;
    var LIMIT = thv(SID, 'TH-의견축-없음', 1);
    /* 개발 의견이 아예 없는 사람은 「비껴갔다」가 아니라 「없다」이므로 대상이 아니다 */
    var target = null;
    rows.forEach(function (r) {
      if (target || r.axisN < 1 || r.axisN > LIMIT || r.covered || !r.top) return;
      target = r;
    });
    var facts = target ? {
      targetName: target.emp.name, axisN: target.axisN,
      axisNames: target.axes.map(compKr).join(' · '),
      top1: compKr(target.top.dimension_id), top1W: target.top.weight,
      jobTitle: target.emp.jobTitle || '', teamRevN: rows.length, teamAvgAxes: teamAvgAxes
    } : { targetName: '', axisN: 0, teamRevN: rows.length, teamAvgAxes: teamAvgAxes };
    var hit = !!target;
    var spec = {};
    if (target) {
      spec[0] = { m: [], text: target.emp.name + '님에게 달린 개발 의견이 「' + facts.axisNames + '」 '
                    + (target.axisN === 1 ? '한 축' : target.axisN + '개 축') + '만 다루고 있어요',
                emph: '「' + facts.axisNames + '」', src: target.emp.emp_id + ' / peerReviews.dev_comments', assumed: 0 };
      if (teamAvgAxes != null) spec[1] = { m: [],
                text: '같은 팀에서 개발 의견이 달린 팀원 ' + rows.length + '명은 평균 ' + pn(teamAvgAxes) + '개 축을 다뤘어요',
                emph: pn(teamAvgAxes) + '개 축', src: ctx.emp.org_id + ' / 팀원 ' + rows.length + '명', assumed: 0 };
      spec[2] = { m: [['헬프데스크담당', target.emp.jobTitle || ''], ['협업', facts.top1], ['35%', target.top.weight + '%']],
                emph: target.top.weight + '%', src: target.emp.jobProfileId };
    }
    return {
      hit: hit, facts: facts,
      notice: target ? [['{{팀원명}}', target.emp.name], ['협업', facts.top1]] : [],
      ev: spec,
      th: { 'TH-역량커버-없음': (target ? 0 : '해당 없음') + (target ? '건' : ''),
            'TH-의견축-없음': (target ? target.axisN : 0) + '축' }
    };
  });

  /* --- 피드백-팀장-05 : 팀 최고 성과인데 다음 기간 개발 항목이 없음 -------- */
  E.registerEval('피드백-팀장-05', function (ctx) {
    var SID = '피드백-팀장-05';
    var my = ctx.emp.emp_id;
    var reports = reportsOf(my);
    var evBy = {};
    arr('evaluations').forEach(function (e) { evBy[e.emp_id] = e; });
    var rows = [];
    reports.forEach(function (e) {
      var ev = evBy[e.emp_id];
      if (!ev) return;
      rows.push({ emp: e, ev: ev, score: +ev.weighted_score || 0, items: devItemsN(e.emp_id) });
    });
    rows.sort(function (a, b) { return b.score - a.score; });
    var top = rows[0] || null;
    var teamAvg = rows.length ? r1(avg(rows.map(function (r) { return r.score; }))) : null;
    var diff = (top && teamAvg != null) ? r1(top.score - teamAvg) : null;
    var sa = rows.filter(function (r) { return r.ev.grade === 'S' || r.ev.grade === 'A'; });
    var saEmpty = sa.filter(function (r) { return r.items === 0; });
    var hist = null;
    if (top) arr('evalHistory').forEach(function (h) { if (h.emp_id === top.emp.emp_id) hist = h; });
    var past = (hist && hist.history) ? hist.history.slice(-2) : [];
    var topJob = top ? topComp(top.emp) : null;
    var facts = {
      reportN: reports.length, scoredN: rows.length,
      targetName: top ? top.emp.name : '', score: top ? r1(top.score) : null, grade: top ? top.ev.grade : '',
      teamAvg: teamAvg, diff: diff, items: top ? top.items : null,
      saN: sa.length, saEmptyN: saEmpty.length,
      top1: topJob ? compKr(topJob.dimension_id) : '', top1W: topJob ? topJob.weight : 0
    };
    var hit = rows.length >= thv(SID, 'TH-모집단-팀평균', 5) && !!top
      && diff != null && diff >= thv(SID, 'TH-팀평균편차-점수', 10)
      && top.items <= thv(SID, 'TH-개발항목-없음', 0);
    var spec = {};
    if (top) {
      spec[0] = { m: [['{{팀원명}}', top.emp.name], ['94.9점', r1(top.score) + '점'], ['S등급', top.ev.grade + '등급']],
                emph: r1(top.score) + '점', src: top.emp.emp_id + ' / ' + top.ev.evaluation_id };
      spec[1] = { m: [], text: '육성 계획에 다음 기간 개발 항목이 ' + top.items + '건으로 비어 있어요',
                emph: top.items + '건', src: top.emp.emp_id + ' / devPlan.items', assumed: 0 };
      if (teamAvg != null) spec[2] = { m: [['76.4점', teamAvg + '점'], ['18.5점', diff + '점']], emph: diff + '점',
                src: ctx.emp.org_id + ' / 팀원 ' + rows.length + '명' };
      /* 비어 있는 사람이 여럿이면 「{{팀원명}}님 한 사람」이 거짓이 된다 — 어절째 바꾼다 */
      spec[3] = { m: [['4명', sa.length + '명'],
                      ['{{팀원명}}님 한 사람', saEmpty.length === 1 ? (top.emp.name + '님 한 사람') : (saEmpty.length + '명')]],
                emph: saEmpty.length + '명',
                src: ctx.emp.org_id + ' / S·A등급 ' + sa.length + '명 · devPlan' };
      if (topJob) spec[4] = { m: [['직무 전문성', facts.top1], ['40%', topJob.weight + '%']], emph: topJob.weight + '%',
                src: top.emp.jobProfileId };
      if (past.length === 2) spec[5] = { m: [['C', past[0].grade], ['58.9점', past[0].score + '점'],
                      ['B', past[1].grade], ['68.7점', past[1].score + '점']], emph: past[1].grade,
                src: top.emp.emp_id + ' / evalHistory ' + past.map(function (h) { return h.period; }).join('·') };
    }
    return {
      hit: hit, facts: facts,
      notice: top ? [['{{팀원명}}', top.emp.name], ['S등급', top.ev.grade + '등급'], ['0건', top.items + '건']] : [],
      ev: spec,
      th: { 'TH-팀평균편차-점수': (diff == null ? '?' : diff) + '점',
            'TH-개발항목-없음': (top ? top.items : 0) + '건',
            'TH-모집단-팀평균': rows.length + '명' }
    };
  });

  /* --- 피드백-팀장-06 : 지난 기간과 같은 개발 의견이 되풀이됨 -------------- */
  E.registerEval('피드백-팀장-06', function (ctx) {
    var SID = '피드백-팀장-06';
    var my = ctx.emp.emp_id;
    var best = null;
    reportsOf(my).forEach(function (e) {
      var fbs = arr('feedbackHistory').filter(function (f) { return f.emp_id === e.emp_id && f.source_type === 'leader'; });
      if (!fbs.length) return;
      /* 같은 역량을 짚은 지난 피드백이 몇 개 기간에 걸쳐 있는지 센다 */
      var byDim = {};
      fbs.forEach(function (f) {
        var d = compInText(f.summary);
        if (!d) return;
        (byDim[d] = byDim[d] || { periods: {}, fb: f, n: 0 });
        byDim[d].periods[f.period] = 1;
        byDim[d].n++;
      });
      var pick = null, d2;
      for (d2 in byDim) if (has(byDim, d2)) {
        var rep = Object.keys(byDim[d2].periods).length;
        if (!pick || rep > pick.repeat) pick = { dim: d2, repeat: rep, fb: byDim[d2].fb };
      }
      if (!pick) return;
      var cover = krsOf(e.emp_id).filter(function (k) { return k.competency_id === pick.dim; }).length;
      if (!best || pick.repeat > best.repeat) best = { emp: e, dim: pick.dim, repeat: pick.repeat, fb: pick.fb, cover: cover };
    });
    var facts = best ? {
      targetName: best.emp.name, comp: compKr(best.dim), repeat: best.repeat,
      cover: best.cover, pastText: fbSnippet(best.fb), pastId: best.fb.fb_id
    } : { targetName: '', repeat: 0, cover: null };
    var hit = !!best && best.repeat >= thv(SID, 'TH-피드백반복-연속', 2)
      && best.cover <= thv(SID, 'TH-역량커버-없음', 0);
    var spec = {};
    if (best) {
      /* [0][1] 올해 피드백 초안 저장 위치가 없어 「그대로 담고 있다」는 확인 불가 → (추정) */
      spec[2] = { m: [['협업', compKr(best.dim)], ['0건', best.cover + '건']], emph: best.cover + '건',
                src: best.emp.emp_id + ' / 핵심결과 ' + krsOf(best.emp.emp_id).length + '건' };
      spec[3] = { m: [['분석 결과는 정확하나 실행 단계에서 한 발 물러서는 경향이 있으니 협업 리드 경험을 늘려 달라',
                       cut(String(best.fb.summary), 60)]],
                emph: fbSnippet(best.fb), src: best.fb.fb_id + ' / ' + best.fb.period, asof: '2025-12-31' };
    }
    return {
      hit: hit, facts: facts,
      notice: [],
      ev: spec,
      th: { 'TH-피드백반복-연속': (best ? best.repeat : 0) + '회',
            'TH-역량커버-없음': (best ? best.cover : 0) + '건' }
    };
  });

  /* ==================================================================
     상위조직장
  ================================================================== */

  /* 하위 팀별 결과 면담 실시 현황 — 등급 확정일 뒤에 저장된 면담만 센다 */
  function resultMeetingRows(s, fromDate) {
    var from = dnum(fromDate);
    return s.units.map(function (u) {
      var ids = empIdsInOrgSet(orgDescendants(u.org));
      var targetN = Object.keys(ids).length;
      var met = {};
      arr('meetingStore').forEach(function (m) {
        if (!ids[m.member_emp_id]) return;
        var t = dnum(dateOnly(m.at));
        if (from != null && (t == null || t < from)) return;
        met[m.member_emp_id] = 1;
      });
      var doneN = Object.keys(met).length;
      return { org: u.org, name: u.name, targetN: targetN, doneN: doneN, rate: targetN ? r0(doneN / targetN * 100) : null };
    });
  }

  /* --- 피드백-상위조직장-02 : 등급 확정 뒤 결과 면담 실시율 저조 ----------- */
  E.registerEval('피드백-상위조직장-02', function (ctx) {
    var SID = '피드백-상위조직장-02';
    var s = ctx.scope;
    if (!s) return { hit: false, facts: {}, ev: {}, th: {} };
    var ids = empIdsInOrgSet(orgDescendants(s.scopeOrg.org_id));
    /* 등급 확정일 = 범위 안에서 2차 확정이 찍힌 가장 이른 날 */
    var conf = null;
    arr('evalStatus').forEach(function (e) {
      if (!ids[e.emp_id] || !e.second_confirmed_at) return;
      var d = dateOnly(e.second_confirmed_at);
      if (!conf || d < conf) conf = d;
    });
    var elapsedRaw = conf ? daysSince(conf) : null;
    /* 확정일이 아직 오지 않았으면 「확정 뒤 N일」이 성립하지 않는다.
       그때는 경과일을 비우고 면담 실시율은 기간을 자르지 않은 값으로 센다. */
    var passed = elapsedRaw != null && elapsedRaw >= 0;
    var elapsed = passed ? elapsedRaw : null;
    var rows = resultMeetingRows(s, passed ? conf : null);
    var LOW = thv(SID, 'TH-팀면담실시율-저조', 30);
    var bad = rows.filter(function (r) { return r.targetN > 0 && r.rate != null && r.rate < LOW; });
    var badTarget = 0, badDone = 0;
    bad.forEach(function (r) { badTarget += r.targetN; badDone += r.doneN; });
    /* 확정 뒤 며칠 만에 면담을 마쳐 왔는지 — 확정일 이후 면담이 있어야 계산된다 */
    var lags = [];
    if (passed) arr('meetingStore').forEach(function (m) {
      if (!ids[m.member_emp_id]) return;
      var t = dnum(dateOnly(m.at));
      if (t == null || t < dnum(conf)) return;
      lags.push(Math.round((t - dnum(conf)) / 86400000));
    });
    var avgLag = lags.length ? r0(avg(lags)) : null;
    var facts = {
      unitN: s.unitN, confirmDate: conf, elapsed: elapsed,
      badTeamN: bad.length, badTeams: bad.map(function (r) { return r.name; }),
      badTarget: badTarget, badDone: badDone,
      badRate: badTarget ? r0(badDone / badTarget * 100) : null, avgLag: avgLag
    };
    var hit = bad.length >= 1 && passed
      && elapsed >= thv(SID, 'TH-등급확정후-면담경과일', 21);
    var badSrc = bad.map(function (r) { return r.org; }).join(' · ') || s.scopeOrg.org_id;
    var spec = {};
    spec[0] = { m: [['두 팀', bad.length + '개 팀'], ['17명', badTarget + '명']], emph: badTarget + '명',
                src: badSrc + ' / 대상자 ' + badTarget + '명' };
    spec[1] = { m: [['두 팀', bad.length + '개 팀'], ['17명', badTarget + '명'], ['2명', badDone + '명']],
                emph: badDone + '명', src: badSrc + ' / meetingStore ' + badDone + '건' };
    if (avgLag != null) spec[2] = { m: [['8일', avgLag + '일']], emph: avgLag + '일',
                src: s.srcOrg + ' / 등급 확정 ' + conf + ' 이후 면담 ' + lags.length + '건' };
    if (elapsed != null) spec[3] = { m: [['21일', elapsed + '일']], emph: elapsed + '일',
                src: 'evalStatus.second_confirmed_at ' + conf };
    return {
      hit: hit, facts: facts,
      notice: [['21일', (elapsed == null ? '?' : elapsed) + '일'], ['두 팀', bad.length + '개 팀'],
               ['17명', badTarget + '명'], ['2명', badDone + '명']],
      ev: spec,
      th: { 'TH-등급확정후-면담경과일': (elapsed == null ? '?' : elapsed) + '일',
            'TH-팀면담실시율-저조': (facts.badRate == null ? '?' : facts.badRate) + '%' }
    };
  });

  /* --- 피드백-상위조직장-03 : 최저 등급에 육성 의견이 비어 있음 ------------ */
  var GRADE_ORDER = ['S', 'A', 'B', 'C', 'D'];
  E.registerEval('피드백-상위조직장-03', function (ctx) {
    var SID = '피드백-상위조직장-03';
    var s = ctx.scope;
    if (!s) return { hit: false, facts: {}, ev: {}, th: {} };
    var ids = empIdsInOrgSet(orgDescendants(s.scopeOrg.org_id));
    var evs = arr('evaluations').filter(function (e) { return ids[e.emp_id]; });
    if (!evs.length) return { hit: false, facts: { evalN: 0 }, ev: {}, th: {} };
    /* 「가장 낮은 등급」 = 범위 안에 실제로 존재하는 등급 중 맨 아래 것 */
    var worst = null;
    evs.forEach(function (e) {
      var i = GRADE_ORDER.indexOf(e.grade);
      if (i < 0) return;
      if (worst == null || i > worst) worst = i;
    });
    var lowGrade = worst == null ? '' : GRADE_ORDER[worst];
    var low = evs.filter(function (e) { return e.grade === lowGrade; });
    /* 육성 의견 = 육성 계획 항목 · 면담 기록 · 다면진단 개발 의견 셋 중 하나라도 있으면 채워진 것 */
    var blank = low.filter(function (e) {
      return devItemsN(e.emp_id) === 0 && meetingsOf(e.emp_id).length === 0 && devCommentN(e.emp_id) === 0;
    });
    var scores = low.map(function (e) { return +e.weighted_score || 0; }).sort(function (a, b) { return a - b; });
    var orgAvg = r1(avg(evs.map(function (e) { return +e.weighted_score || 0; })));
    var withPR = low.filter(function (e) { return reviewsFor(e.emp_id).length > 0; }).length;
    var pct = low.length ? r0(blank.length / low.length * 100) : null;
    var jpN = Object.keys(data().jobProfiles || {}).length;
    var facts = {
      scopeOrg: s.scopeOrg.org_id, evalN: evs.length, lowGrade: lowGrade, lowN: low.length,
      blankN: blank.length, blankPct: pct, minScore: scores.length ? r1(scores[0]) : null,
      maxScore: scores.length ? r1(scores[scores.length - 1]) : null, orgAvg: orgAvg,
      withPR: withPR, jobProfileN: jpN
    };
    /* 카탈로그는 「기준 건수를 넘거나 절반을 넘을 때」 — 둘 중 하나면 부른다 */
    var hit = low.length > 0 && (blank.length >= thv(SID, 'TH-육성의견-공백건수', 3)
      || (pct != null && pct >= thv(SID, 'TH-육성의견-공백비율', 50)));
    var srcLow = s.scopeOrg.org_id + ' / ' + lowGrade + '등급 ' + low.length + '건';
    var spec = {};
    spec[0] = { m: [['3건', low.length + '건']], emph: low.length + '건', src: srcLow };
    spec[1] = (blank.length === low.length)
      ? { m: [['3건', low.length + '건']], emph: blank.length + '건', src: srcLow + ' / 육성 의견 없음 ' + blank.length + '건' }
      : { m: [], text: '최저 등급 ' + low.length + '건 가운데 ' + blank.length + '건에 개발·육성 의견이 비어 있어요',
          emph: blank.length + '건', src: srcLow + ' / 육성 의견 없음 ' + blank.length + '건', assumed: 0 };
    if (scores.length) spec[2] = { m: [['세 건', low.length + '건'], ['59.4점', facts.minScore + '점'],
                      ['61.8점', facts.maxScore + '점']],
                emph: facts.minScore + '점', src: srcLow };
    spec[3] = { m: [['76.4점', orgAvg + '점']], emph: orgAvg + '점',
                src: s.scopeOrg.org_id + ' / 평가 ' + evs.length + '건' };
    spec[4] = { m: [['세 건', low.length + '건'], ['1건뿐', withPR + '건']], emph: withPR + '건',
                src: 'peerReviews ' + allReviews().length + '건 / 대상 ' + reviewedSubjects().length + '명' };
    spec[5] = { m: [['98종', jpN + '종']], emph: '가중치 상위 역량', src: 'jobProfiles ' + jpN + '종' };
    return {
      hit: hit, facts: facts,
      notice: [['3건', blank.length + '건']],
      ev: spec,
      th: { 'TH-육성의견-공백건수': blank.length + '건', 'TH-육성의견-공백비율': (pct == null ? 0 : pct) + '%' }
    };
  });

  /* --- 피드백-상위조직장-06 : 결과 면담을 맡을 평가자가 지정되지 않음 ------ */
  E.registerEval('피드백-상위조직장-06', function (ctx) {
    var SID = '피드백-상위조직장-06';
    var s = ctx.scope;
    if (!s) return { hit: false, facts: {}, ev: {}, th: {} };
    var ids = empIdsInOrgSet(orgDescendants(s.scopeOrg.org_id));
    var mapped = {};
    arr('evaluatorMap').forEach(function (m) { if (m.first_evaluator) mapped[m.emp_id] = 1; });
    var missing = [];
    arr('employees').forEach(function (e) { if (ids[e.emp_id] && !mapped[e.emp_id]) missing.push(e); });
    var teams = {};
    missing.forEach(function (e) { teams[e.org_id] = 1; });
    var teamList = Object.keys(teams);
    var mtN = arr('meetingStore').filter(function (m) {
      return missing.some(function (e) { return e.emp_id === m.member_emp_id; });
    }).length;
    var facts = {
      scopeOrg: s.scopeOrg.org_id, scopeN: Object.keys(ids).length,
      missingN: missing.length, teamN: teamList.length, teams: teamList, meetingN: mtN
    };
    /* 조직 변경 이력 원천이 없어 「개편 뒤 며칠」은 못 센다 — 미지정 인원만으로 판정한다 */
    var hit = missing.length >= thv(SID, 'TH-면담담당-미지정', 1);
    var srcTeams = teamList.join(' · ') || s.scopeOrg.org_id;
    var spec = {};
    spec[0] = { m: [['두 팀', teamList.length + '개 팀'], ['19명', missing.length + '명']], emph: missing.length + '명',
                src: srcTeams + ' / 구성원 ' + missing.length + '명' };
    spec[1] = { m: [], emph: '지정되지 않았어요', src: srcTeams + ' / evaluatorMap.first_evaluator 없음', assumed: 0 };
    /* [2] 조직 변경 이력이 없어 개편일·경과일은 계산 불가 → (추정) */
    spec[3] = { m: [['0건', mtN + '건']], emph: mtN + '건', src: srcTeams + ' / meetingStore ' + mtN + '건' };
    return {
      hit: hit, facts: facts,
      /* 개편일을 셀 수 없으므로 알림 문구에서 그 대목을 통째로 걷어낸다 */
      notice: [['7월 1일 조직 개편 뒤 21일인데 ', ''], ['두 팀', teamList.length + '개 팀'],
               ['19명', missing.length + '명']],
      ev: spec,
      th: { 'TH-조직변경-경과일': '확인 불가', 'TH-면담담당-미지정': missing.length + '명' }
    };
  });

  /* ==================================================================
     HR경영진
  ================================================================== */

  /* --- 피드백-HR경영진-02 : 받은 피드백 기록이 새로 쌓이지 않음 ------------ */
  E.registerEval('피드백-HR경영진-02', function (ctx) {
    var SID = '피드백-HR경영진-02';
    var fh = arr('feedbackHistory');
    var leaderN = fh.filter(function (f) { return f.source_type === 'leader'; }).length;
    var peerN = fh.filter(function (f) { return f.source_type === 'peer'; }).length;
    var recv = {};
    fh.forEach(function (f) { recv[f.emp_id] = 1; });
    var recvN = Object.keys(recv).length;
    var empN = arr('employees').length, orgN = arr('orgs').length;
    /* feedbackHistory 에는 날짜 필드가 없고 period(FY2025)만 있다.
       가장 최근 기간의 연말을 마지막 기록 시점으로 보고 공백일을 잰다. */
    var lastYear = 0;
    fh.forEach(function (f) { var m = /(\d{4})/.exec(String(f.period)); if (m && +m[1] > lastYear) lastYear = +m[1]; });
    var gap = lastYear ? daysSince(lastYear + '-12-31') : null;
    var thisYear = String(new Date(asofMs()).getUTCFullYear());
    var newN = fh.filter(function (f) { return String(f.period).indexOf(thisYear) >= 0; }).length;
    /* 인원이 일정 규모 이상인데 기록이 한 건도 없는 조직 */
    var MINP = thv(SID, 'TH-피드백0건조직-최소인원', 5);
    var zeroOrgs = arr('orgs').filter(function (o) {
      if ((o.headcount_direct || o.headcount || 0) < MINP) return false;
      var any = false;
      arr('employees').forEach(function (e) { if (e.org_id === o.org_id && recv[e.emp_id]) any = true; });
      return !any;
    });
    var zeroHead = 0;
    zeroOrgs.forEach(function (o) { zeroHead += (o.headcount_direct || o.headcount || 0); });
    var facts = {
      totalN: fh.length, leaderN: leaderN, peerN: peerN, recvN: recvN,
      empN: empN, orgN: orgN, newN: newN, gapDays: gap, zeroOrgN: zeroOrgs.length, zeroHead: zeroHead,
      perEmp: empN ? Math.round(fh.length / empN * 100) / 100 : 0
    };
    var hit = newN === 0 && gap != null && gap >= thv(SID, 'TH-피드백공백-일수', 60) && zeroOrgs.length >= 1;
    var srcFb = 'feedbackHistory ' + fh.length + '건';
    var spec = {};
    spec[0] = { m: [['221명', empN + '명'], ['38개', orgN + '개']], emph: empN + '명', src: srcFb + ' / employees ' + empN + '명' };
    spec[1] = { m: [['7건', fh.length + '건'], ['3건', leaderN + '건'], ['4건', peerN + '건']], emph: fh.length + '건',
                src: srcFb + ' / source_type',
                calcm: [['7건', fh.length + '건'], ['221명', empN + '명'], ['0.03건', facts.perEmp + '건']] };
    spec[2] = { m: [['7건', fh.length + '건'], ['221명', empN + '명'], ['7명', recvN + '명']], emph: recvN + '명',
                src: srcFb + ' / 수신자 ' + recvN + '명' };
    spec[3] = (newN === 0)
      ? { m: [['7건', fh.length + '건']], emph: '올해 새로 쌓인 피드백은 없어요', src: srcFb + ' / period' }
      : { m: [], text: fh.length + '건 가운데 올해 쌓인 피드백은 ' + newN + '건이에요', emph: newN + '건',
          src: srcFb + ' / period', assumed: 0 };
    return {
      hit: hit, facts: facts,
      notice: [['7건', fh.length + '건']],
      ev: spec,
      /* 이름이 「…조직 소속 인원」(명)인데 조직 수(곳)를 넣고 있었다 — 단위를 맞춰 인원으로 센다 */
      th: { 'TH-피드백공백-일수': (gap == null ? '?' : gap) + '일', 'TH-피드백0건조직-최소인원': zeroHead + '명' }
    };
  });

  /* --- 피드백-HR경영진-03 : 다면진단 결과 보유 비율이 기준 미달 ------------ */
  E.registerEval('피드백-HR경영진-03', function (ctx) {
    var SID = '피드백-HR경영진-03';
    var subs = reviewedSubjects();
    var all = allReviews();
    var empN = arr('employees').length;
    var haveN = subs.length, missN = empN - haveN;
    var rate = empN ? r1(haveN / empN * 100) : null;
    var cutoff = thv(SID, 'TH-다면제출률-미달', 80);
    var facts = { empN: empN, haveN: haveN, missN: missN, reviewN: all.length, rate: rate, cutoff: cutoff };
    var hit = rate != null && rate < cutoff && missN >= thv(SID, 'TH-다면미보유-최소인원', 20);
    var srcPr = 'demoSubjects.peerReviews ' + all.length + '건 / ' + haveN + '명';
    var spec = {};
    spec[0] = { m: [['221명', empN + '명']], emph: empN + '명', src: srcPr + ' / employees ' + empN + '명' };
    spec[1] = { m: [['55건', all.length + '건'], ['13명', haveN + '명'], ['208명', missN + '명']], emph: haveN + '명',
                src: srcPr,
                calcm: [['13명', haveN + '명'], ['221명', empN + '명'], ['5.9%', pn(rate) + '%']] };
    if (rate != null) spec[2] = { m: [['80%', cutoff + '%'], ['74.1%p', pn(r1(cutoff - rate)) + '%p']],
                emph: pn(r1(cutoff - rate)) + '%p', src: '다면진단 제출률 제도 기준' };
    return {
      hit: hit, facts: facts,
      notice: [['221명', empN + '명'], ['13명', haveN + '명']],
      ev: spec,
      th: { 'TH-다면제출률-미달': (rate == null ? '?' : pn(rate)) + '%', 'TH-다면미보유-최소인원': missN + '명' }
    };
  });

  /* --- 피드백-HR경영진-04 : 낮은 등급인데 설명 기록이 비어 있음 ------------ */
  E.registerEval('피드백-HR경영진-04', function (ctx) {
    var SID = '피드백-HR경영진-04';
    var low = arr('evaluations').filter(function (e) { return e.grade === 'C' || e.grade === 'D'; });
    /* 설명 기록 = 개발·육성 계획 항목 · 면담 기록 · 다면진단 개발 의견 */
    var blank = low.filter(function (e) {
      return devItemsN(e.emp_id) === 0 && meetingsOf(e.emp_id).length === 0 && devCommentN(e.emp_id) === 0;
    });
    var pct = low.length ? r0(blank.length / low.length * 100) : null;
    var gc = {};
    arr('evaluations').forEach(function (e) { gc[e.grade] = (gc[e.grade] || 0) + 1; });
    var all = allReviews();
    var devAll = all.filter(function (x) { return hasDev(x.rev); }).length;
    var devPct = all.length ? r1(devAll / all.length * 100) : null;
    var MINP = thv(SID, 'TH-낮은등급대상-최소인원', 5);
    /* 조직별로 낮은 등급이 몇 명인지 — 이름 대신 인원수만 남긴다 */
    var byOrg = {};
    low.forEach(function (e) { var em = empById(e.emp_id); if (em) byOrg[em.org_id] = (byOrg[em.org_id] || 0) + 1; });
    var bigOrgs = Object.keys(byOrg).filter(function (o) { return byOrg[o] >= MINP; });
    var facts = {
      lowN: low.length, blankN: blank.length, blankPct: pct,
      cN: gc.C || 0, bN: gc.B || 0, reviewN: all.length, devPct: devPct,
      orgOverMinN: bigOrgs.length, minPerOrg: MINP
    };
    var hit = low.length >= MINP && pct != null && pct >= thv(SID, 'TH-설명기록공란-비율', 50);
    var srcEval = 'evaluations ' + arr('evaluations').length + '건 / 낮은 등급 ' + low.length + '명';
    var spec = {};
    spec[0] = { m: [['5명', MINP + '명']], emph: MINP + '명', src: srcEval + ' / 조직 ' + bigOrgs.length + '곳' };
    spec[1] = { m: [['14명', low.length + '명'], ['12명', blank.length + '명']], emph: blank.length + '명',
                src: srcEval + ' / devPlan · meetingStore · peerReviews',
                calcm: [['12명', blank.length + '명'], ['14명', low.length + '명'], ['86%', (pct == null ? 0 : pct) + '%']] };
    spec[2] = { m: [['3명', facts.cN + '명'], ['99명', facts.bN + '명']], emph: 'C등급은 ' + facts.cN + '명',
                src: 'evaluations.grade 분포' };
    if (devPct != null) spec[3] = { m: [['55건', all.length + '건'], ['52.7%', pn(devPct) + '%']], emph: pn(devPct) + '%',
                src: 'peerReviews.dev_comments (' + all.length + '건)' };
    spec[4] = { m: [], emph: '잇는 문장이 비어', src: 'evaluations.rationale_summary ' + arr('evaluations').length + '건' };
    return {
      hit: hit, facts: facts,
      notice: [['14명', low.length + '명'], ['12명', blank.length + '명']],
      ev: spec,
      th: { 'TH-설명기록공란-비율': (pct == null ? 0 : pct) + '%', 'TH-낮은등급대상-최소인원': low.length + '명' }
    };
  });

  /* --- 피드백-HR경영진-05 : 상향 피드백이 일부 조직에서만 모임 ------------- */
  E.registerEval('피드백-HR경영진-05', function (ctx) {
    var SID = '피드백-HR경영진-05';
    var uf = arr('upwardFeedback');
    var orgN = arr('orgs').length;
    var rate = orgN ? r1(uf.length / orgN * 100) : null;
    var MINR = thv(SID, 'TH-익명보호-최소응답자', 3);
    var under = uf.filter(function (u) { return (u.respondents || 0) < MINR; });
    var resp = uf.map(function (u) { return u.respondents || 0; });
    var minResp = resp.length ? Math.min.apply(null, resp) : null;
    var facts = {
      orgN: orgN, collectedN: uf.length, rate: rate,
      respondents: resp, underN: under.length, minResp: minResp, minRaters: MINR
    };
    var hit = uf.length >= 1 && rate != null && rate < thv(SID, 'TH-상향수집률-미달', 50);
    var srcUf = uf.map(function (u) { return u.uf_id; }).join(' / ') || '상향 피드백 없음';
    var spec = {};
    spec[0] = { m: [['38개 조직', orgN + '개 조직']], emph: orgN + '개 조직', src: srcUf + ' / orgs ' + orgN + '개' };
    spec[1] = { m: [['두 곳', uf.length + '곳'], ['5명과 2명', resp.join('명과 ') + '명']], emph: uf.length + '곳',
                src: srcUf + ' / respondents',
                calcm: [['2곳', uf.length + '곳'], ['38곳', orgN + '곳'], ['5.3%', pn(rate) + '%']] };
    if (minResp != null) spec[2] = { m: [['3명', MINR + '명'], ['2명', minResp + '명'], ['한 곳', under.length + '곳']],
                emph: '응답자 ' + MINR + '명', src: srcUf + ' / 익명 보호 기준',
                calcm: [['2명', minResp + '명'], ['3명', MINR + '명']] };
    return {
      hit: hit, facts: facts,
      notice: [['38개', orgN + '개'], ['두 곳', uf.length + '곳']],
      ev: spec,
      th: { 'TH-상향수집률-미달': (rate == null ? '?' : pn(rate)) + '%', 'TH-익명보호-최소응답자': (minResp == null ? '?' : minResp) + '명' }
    };
  });

  /* --- 피드백-HR경영진-06 : 직무 1순위 역량이 다면진단 최하위 -------------- */
  E.registerEval('피드백-HR경영진-06', function (ctx) {
    var SID = '피드백-HR경영진-06';
    var subs = reviewedSubjects();
    var all = allReviews();
    var empN = arr('employees').length;
    var MINREV = thv(SID, 'TH-다면응답-최소건수', 3);
    var cases = [], ex = null;
    subs.forEach(function (sj) {
      var revs = sj.peerReviews || [];
      if (revs.length < MINREV) return;
      var e = empById(sj.emp_id), t = e ? topComp(e) : null;
      if (!t) return;
      var dims = dimAvgOf(revs);
      if (!dims.length || dims[0].dim !== t.dimension_id) return;
      var hi = dims[dims.length - 1];
      cases.push(sj.emp_id);
      if (!ex) ex = { emp: e, top1: compKr(t.dimension_id), w: t.weight, low: dims[0].v,
                      hiName: compKr(hi.dim), hi: hi.v };
    });
    /* 직무 프로파일 98종의 1순위 역량 분포 — 어느 역량에 기대가 몰려 있는지 */
    var jps = data().jobProfiles || {}, topCnt = {}, k;
    for (k in jps) if (has(jps, k)) {
      var p = (jps[k].competency_profile || []).slice().sort(function (a, b) { return (b.weight || 0) - (a.weight || 0); });
      if (p[0]) topCnt[p[0].dimension_id] = (topCnt[p[0].dimension_id] || 0) + 1;
    }
    var topList = [];
    for (k in topCnt) if (has(topCnt, k)) topList.push({ d: k, n: topCnt[k] });
    topList.sort(function (a, b) { return b.n - a.n; });
    var topStr = topList.slice(0, 2).map(function (x) { return compKr(x.d) + ' ' + x.n + '곳'; }).join('·');
    /* 리뷰가 언제 쌓였는지 — 한 달에 몰려 있으면 그 뒤 변화를 볼 수 없다 */
    var months = {};
    all.forEach(function (x) { var m = String(x.rev.review_date).slice(0, 7); if (m) months[m] = (months[m] || 0) + 1; });
    var mKeys = Object.keys(months).sort();
    var mLabel = mKeys.length === 1 ? (mKeys[0].slice(0, 4) + '년 ' + (+mKeys[0].slice(5, 7)) + '월')
      : (mKeys.length + '개 월');
    var minRev = null;
    subs.forEach(function (sj) { var n = (sj.peerReviews || []).length; if (minRev == null || n < minRev) minRev = n; });
    var facts = {
      subjectN: subs.length, empN: empN, reviewN: all.length, caseN: cases.length, minRev: minRev,
      exTop1: ex ? ex.top1 : '', exW: ex ? ex.w : null, exLow: ex ? ex.low : null,
      exHiName: ex ? ex.hiName : '', exHi: ex ? ex.hi : null,
      topDist: topStr, monthLabel: mLabel, minReview: MINREV
    };
    var hit = cases.length >= thv(SID, 'TH-역량다면어긋남-인원', 3);
    var srcPr = 'demoSubjects.peerReviews ' + all.length + '건 / ' + subs.length + '명';
    var spec = {};
    spec[0] = { m: [['13명', subs.length + '명'], ['221명', empN + '명']], emph: subs.length + '명', src: srcPr };
    spec[1] = { m: [['5명', cases.length + '명']], emph: cases.length + '명',
                src: srcPr + ' / jobProfiles 역량 가중치', assumed: 0 };
    if (ex) spec[2] = { m: [['협업', ex.top1], ['35%', ex.w + '%'], ['협업', ex.top1], ['3.44점', ex.low + '점']],
                emph: ex.low + '점', src: ex.emp.emp_id + ' / ' + ex.emp.jobProfileId,
                calcm: [['리더십', ex.hiName], ['4.79점', ex.hi + '점']] };
    spec[3] = { m: [['55건', all.length + '건'], ['2026년 4월', mLabel]], emph: mLabel, src: srcPr + ' / review_date' };
    if (topStr) spec[4] = { m: [['직무 전문성 64곳·협업 30곳', topStr]], emph: topList[0] ? (compKr(topList[0].d) + ' ' + topList[0].n + '곳') : '',
                src: 'jobProfiles ' + Object.keys(jps).length + '종 / competency_profile' };
    return {
      hit: hit, facts: facts,
      notice: [['5명', cases.length + '명']],
      ev: spec,
      /* 「1인당 응답 최소 건수」의 측정값은 기준(3건)이 아니라 대상자별 리뷰 건수의 실제 최솟값이다 */
      th: { 'TH-역량다면어긋남-인원': cases.length + '명',
            'TH-다면응답-최소건수': (minRev == null ? '확인 불가' : minRev + '건') }
    };
  });

  /* --- 피드백-HR경영진-07 : 미완 항목이 항목 단위로 남지 않음 -------------- */
  E.registerEval('피드백-HR경영진-07', function (ctx) {
    var SID = '피드백-HR경영진-07';
    var prev = arr('evaluationsPrev');
    var withItems = prev.filter(function (p) { return (p.krs || []).length > 0; });
    var undone = 0;
    withItems.forEach(function (p) { (p.krs || []).forEach(function (k) { if (!k.done) undone++; }); });
    var empN = arr('employees').length;
    var histN = arr('evalHistory').length;
    var rest = empN - withItems.length;
    var rate = empN ? r1(withItems.length / empN * 100) : null;
    var facts = {
      officialN: withItems.length, undoneN: undone, empN: empN, histN: histN,
      restN: rest, rate: rate
    };
    var hit = rate != null && rate < thv(SID, 'TH-이월공식-보유율', 50)
      && empN >= thv(SID, 'TH-이월-대상인원', 20);
    var srcPrev = 'evaluationsPrev ' + prev.length + '건 / evalHistory ' + histN + '명';
    var spec = {};
    spec[0] = { m: [['204명', histN + '명']], emph: '인원수만', src: srcPrev };
    spec[1] = { m: [['세 명뿐', withItems.length + '명']], emph: withItems.length + '명',
                src: 'evaluationsPrev ' + withItems.length + '건 / krs 미완 ' + undone + '건' };
    if (rate != null) spec[2] = { m: [['221명', empN + '명'], ['1.4%', pn(rate) + '%']], emph: pn(rate) + '%',
                src: '지난 사이클 평가 전사 집계 (' + empN + '명)' };
    spec[3] = { m: [['218명', rest + '명'], ['204명', histN + '명']], emph: rest + '명',
                src: 'evalHistory ' + histN + '명',
                calcm: [['3명', withItems.length + '명'], ['218명', rest + '명'], ['221명', empN + '명']] };
    return {
      hit: hit, facts: facts,
      notice: [['세 명', withItems.length + '명']],
      ev: spec,
      th: { 'TH-이월공식-보유율': (rate == null ? '?' : pn(rate)) + '%', 'TH-이월-대상인원': empN + '명' }
    };
  });

  /* --- 피드백-HR경영진-08 : 발송·열람 기록이 남지 않아 도달을 못 봄 -------- */
  E.registerEval('피드백-HR경영진-08', function (ctx) {
    var SID = '피드백-HR경영진-08';
    var nl = arr('notifyLog');
    var sentN = nl.filter(function (n) { return n.sent_at; }).length;
    var readN = nl.filter(function (n) { return n.read_at; }).length;
    var actedN = nl.filter(function (n) { return n.acted_at; }).length;
    var empN = arr('employees').length;
    var reachPct = sentN ? r1(readN / sentN * 100) : null;
    var facts = {
      logN: nl.length, sentN: sentN, readN: readN, actedN: actedN,
      empN: empN, reachPct: reachPct
    };
    /* 「기록이 없다」가 조건이다. 발송·열람 기록이 실제로 남아 있으면 부르지 않는다. */
    var hit = sentN <= thv(SID, 'TH-도달기록-보존건수', 0)
      && empN >= thv(SID, 'TH-도달확인-대상인원', 50);
    var srcNl = 'notifyLog ' + nl.length + '건';
    var spec = {};
    spec[0] = { m: [['221명', empN + '명']], emph: empN + '명', src: srcNl + ' / employees ' + empN + '명' };
    spec[1] = (sentN === 0)
      ? { m: [['0건', sentN + '건']], emph: sentN + '건', src: '알림 발송·열람 기록 없음' }
      : { m: [], text: '발송 기록 ' + sentN + '건과 열람 기록 ' + readN + '건이 남아 있어 도달을 확인할 수 있어요',
          emph: sentN + '건', src: srcNl + ' / sent_at · read_at', assumed: 0 };
    /* [2][3] 브라우저 보관 상한(알림 50건·면담 80건)은 데이터가 아니라 구현 제약이라 계산 불가 → (추정) */
    spec[4] = (reachPct == null)
      ? { m: [], emph: '비교할 도달률도', src: '알림 발송·열람 기록 없음' }
      : { m: [], text: '지금 남은 기록으로는 발송 ' + sentN + '건 가운데 ' + readN + '건이 열려 도달률이 ' + pn(reachPct) + '%예요',
          emph: pn(reachPct) + '%', src: srcNl + ' / read_at ' + readN + '건', assumed: 0 };
    return {
      hit: hit, facts: facts,
      notice: [['221명', empN + '명'], ['0건', sentN + '건']],
      ev: spec,
      th: { 'TH-도달기록-보존건수': sentN + '건', 'TH-도달확인-대상인원': empN + '명' }
    };
  });

  /* ==================================================================
     계산이 닿지 않아 (추정)으로 남긴 근거 줄 — 원천이 생기면 바로 채운다
     ------------------------------------------------------------------
     데이터 없음: 피드백-구성원-08 근거⑤ — 필요한 원천 「지난 사이클 동료 리뷰」.
       peerReviews 55건이 전부 2026년 4월치라 지난 사이클과 견줄 수 없다.
     데이터 없음: 피드백-팀장-02 근거③ — 필요한 원천 「피드백 초안 수정 이력」.
       feedbackLog 에 draft_at 은 있지만 고쳐 쓴 이력은 남지 않는다.
     데이터 없음: 피드백-팀장-03 근거②·⑤ — 필요한 원천 「지난 기간 동료 리뷰」·「피드백 초안 저장 위치」.
     데이터 없음: 피드백-팀장-06 근거①·② — 필요한 원천 「올해 피드백 초안 본문」.
       지난 피드백은 feedbackHistory(FY2025 7건)뿐이라 두 해를 견줄 수 없다.
     데이터 없음: 피드백-상위조직장-02 근거② — 필요한 원천 「하위 팀별 평균 실시 소요일」.
       등급 확정 뒤 저장된 면담이 없으면 소요일을 못 낸다(있으면 실측으로 채운다).
     데이터 없음: 피드백-상위조직장-06 근거⑤(첫 줄) — 필요한 원천 「조직 변경 이력·변경일」.
       개편일이 없어 경과일을 못 세므로 판정은 담당 미지정 인원만으로 한다.
     데이터 없음: 피드백-HR경영진-08 근거①(둘째 줄)·② — 필요한 원천 「알림·면담 기록 보관 상한」.
       보관 상한은 데이터가 아니라 구현 제약이라 값으로 세지 않는다.
  ================================================================== */
})();
