/* ez_signal_eval3.js — 신호 판정 함수 신설 (20-4차 · 담당 B)
   ------------------------------------------------------------------------
   대상 : 중간점검 38건 중 아직 EVAL 이 없던 신호 10건.
   계약 : js/ez_signal_engine.js 의 registerEval·helpers 로만 계산한다.
   이 파일 밖(index.html·엔진·데이터)은 건드리지 않는다.
   ------------------------------------------------------------------------ */
(function () {
  'use strict';
  var E = window.EZSignalEngine;
  if (!E || !E.registerEval) return;          /* 엔진 없으면 조용히 아무 것도 안 한다 */
  var Hp = E.helpers || {};
  function arr(k) { return (Hp.arr ? Hp.arr(k) : []) || []; }
  var r0 = Hp.r0, r1 = Hp.r1, pn = Hp.pn, thv = Hp.thv, asof = Hp.asof,
      avg = Hp.avg, num = Hp.num, asofMs = Hp.asofMs;

  /* ================= 공용 헬퍼 (이 파일 전용) ================= */
  function findEmp(list, id) {
    var i;
    for (i = 0; i < list.length; i++) if (list[i].emp_id === id) return list[i];
    return null;
  }
  function directReports(leaderId) {
    return arr('employees').filter(function (e) { return e.manager_id === leaderId; });
  }
  function checkinsOf(empId) {
    return arr('checkins').filter(function (c) { return c.emp_id === empId; });
  }
  /* checkins.confidence 는 두 표기(영문 low/medium/high · 한글 낮음/보통/높음)가 섞여
     있다 — 캐노니컬 360건은 영문, 신설 주간 체크인(source=synthetic-26w)은 한글이다.
     전사 집계(canonStats, 아래)는 기존 신호(중간점검-상위조직장-06 등)와 표기를
     맞추기 위해 캐노니컬 360건 하나만 센다. 개인 실측(내 체크인 흐름)은 두 표기를
     함께 인식해야 그 사람의 실제 최근 기록을 놓치지 않는다. */
  function confKind(c) {
    var v = c.confidence;
    if (v === 'low' || v === '낮음') return 'low';
    if (v === 'medium' || v === '보통') return 'medium';
    if (v === 'high' || v === '높음') return 'high';
    return '';
  }
  function byDateAsc(a, b) { return a.checkin_date < b.checkin_date ? -1 : (a.checkin_date > b.checkin_date ? 1 : 0); }
  function dnum(s) { if (!s) return null; var t = Date.parse(String(s).slice(0, 10) + 'T00:00:00Z'); return isNaN(t) ? null : t; }
  function gapDaysFrom(s) { var t = dnum(s); return t == null ? null : Math.round((asofMs() - t) / 86400000); }
  function fmtDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    return m ? (m[1] + '년 ' + (+m[2]) + '월 ' + (+m[3]) + '일') : String(s || '');
  }
  function fmtMonthFull(key) { var p = String(key).split('-'); return p[0] + '년 ' + (+p[1]) + '월'; }
  function fmtMonthShort(key) { var p = String(key).split('-'); return (+p[1]) + '월'; }
  function monthKeyShift(key, delta) {
    var y = +key.slice(0, 4), m = +key.slice(5, 7) + delta;
    while (m <= 0) { m += 12; y--; }
    while (m > 12) { m -= 12; y++; }
    return y + '-' + (m < 10 ? '0' + m : m);
  }
  function periodsCheckin() {
    var ps = arr('periods').filter(function (p) { return p.kind === 'checkin' && p.status !== 'closed'; });
    return ps[0] || null;
  }
  function periodsGoalOpen() {
    var ps = arr('periods').filter(function (p) { return p.kind === 'goal' && p.status !== 'closed'; });
    return ps[0] || null;
  }
  function canonCheckins() {
    return arr('checkins').filter(function (c) { return c.confidence === 'low' || c.confidence === 'medium' || c.confidence === 'high'; });
  }
  /* 전사 확신도 분포 — co() 는 ckTotal 을 전체 체크인(3357건, 캐노니컬+신설 주간분
     혼합)으로 세면서 lowCk 는 영문 표기('low')만 세어 분자·분모 표기가 어긋난다.
     이 파일은 캐노니컬 360건 하나로 분자·분모를 통일해 카탈로그 예시(68건·18.9%)와
     맞춘다 — co() 캐시를 그대로 재사용하지 않는다. */
  function canonStats() {
    var canon = canonCheckins();
    var low = canon.filter(function (c) { return c.confidence === 'low'; }).length;
    var mid = canon.filter(function (c) { return c.confidence === 'medium'; }).length;
    var high = canon.filter(function (c) { return c.confidence === 'high'; }).length;
    var t = canon.length;
    return { total: t, low: low, mid: mid, high: high, lowPct: t ? r1(low / t * 100) : 0, midPct: t ? r1(mid / t * 100) : 0, highPct: t ? r1(high / t * 100) : 0 };
  }

  /* --- 중간점검-구성원-01 : 본인 체크인 공백 경과일 ----------------------- */
  E.registerEval('중간점검-구성원-01', function (ctx) {
    var SID = '중간점검-구성원-01';
    var cks = ctx.myCks.slice().sort(byDateAsc);
    if (!cks.length) return { hit: false, facts: {}, ev: {}, th: {} };
    var last = cks[cks.length - 1];
    var gap = gapDaysFrom(last.checkin_date);
    var warn = thv(SID, 'TH-체크인공백-경고', 14), alertTh = thv(SID, 'TH-체크인공백-경보', 30);
    var canon = canonCheckins();
    var withCk = {}; canon.forEach(function (c) { withCk[c.emp_id] = 1; });
    var withCkN = Object.keys(withCk).length;
    var empTotal = arr('employees').length;
    var pct = empTotal ? r1(withCkN / empTotal * 100) : 0;
    var prevGap = null;
    if (cks.length >= 3) prevGap = Math.round((dnum(cks[cks.length - 2].checkin_date) - dnum(cks[cks.length - 3].checkin_date)) / 86400000);
    var facts = { gap: gap, lastDate: last.checkin_date, warn: warn, alert: alertTh, withCkN: withCkN, empTotal: empTotal, pct: pct, prevGap: prevGap };
    var hit = gap >= warn;
    var spec = {};
    spec[0] = { m: [['2026년 6월 27일', fmtDate(last.checkin_date)], ['19일째', gap + '일째']], emph: gap + '일째', src: last.checkin_id + ' / 공백 ' + gap + '일' };
    spec[1] = { ok: 1, src: 'policy.checkin_gap_days' };
    spec[2] = { m: [['221명', empTotal + '명'], ['147명(66.5%)', withCkN + '명(' + pn(pct) + '%)']], emph: withCkN + '명(' + pn(pct) + '%)', src: 'checkins(캐노니컬) ' + canon.length + '건 / employees ' + empTotal + '명' };
    if (prevGap != null) spec[3] = { m: [['12일 간격', prevGap + '일 간격']], emph: prevGap + '일 간격', src: cks[cks.length - 2].checkin_id + ' / ' + cks[cks.length - 3].checkin_id };
    return { hit: hit, facts: facts, notice: [['19일', gap + '일'], ['14일', warn + '일']], ev: spec, th: { 'TH-체크인공백-경고': gap + '일', 'TH-체크인공백-경보': gap + '일' } };
  });

  /* --- 중간점검-구성원-06 : 분기 마감 임박 + 당월 체크인 0건 -------------- */
  E.registerEval('중간점검-구성원-06', function (ctx) {
    var SID = '중간점검-구성원-06';
    var per = periodsCheckin();
    if (!per) return { hit: false, facts: {}, ev: {}, th: {} };
    var daysLeft = Math.round((dnum(per.due) - asofMs()) / 86400000);
    var monthKey = asof().slice(0, 7);
    var cks = ctx.myCks;
    var thisMonth = cks.filter(function (c) { return c.checkin_date.slice(0, 7) === monthKey; });
    var sum = 0, cnt = 0, i, key;
    for (i = 1; i <= 3; i++) {
      key = monthKeyShift(monthKey, -i);
      sum += cks.filter(function (c) { return c.checkin_date.slice(0, 7) === key; }).length;
      cnt++;
    }
    var prevAvg = cnt ? r1(sum / cnt) : 0;
    var facts = { daysLeft: daysLeft, thisMonthN: thisMonth.length, prevAvg: prevAvg, dueDate: per.due, monthKey: monthKey };
    var hit = daysLeft != null && daysLeft >= 0 && daysLeft <= thv(SID, 'TH-체크인마감임박-구성원', 2) && thisMonth.length === 0;
    var spec = {};
    spec[0] = { m: [['0건', thisMonth.length + '건']], emph: thisMonth.length + '건', src: 'checkins where emp_id=' + ctx.emp.emp_id, assumed: thisMonth.length === 0 ? 0 : 1 };
    spec[1] = { m: [['2026년 7월 31일', fmtDate(per.due)], ['2일', daysLeft + '일']], emph: daysLeft + '일', src: 'periods ' + per.period_id };
    spec[2] = { m: [['1.6건', prevAvg + '건'], ['2026년 7월', fmtMonthFull(monthKey)], ['0건', thisMonth.length + '건']], emph: thisMonth.length + '건', src: '내 월별 체크인 건수 집계' };
    return { hit: hit, facts: facts, notice: [['2일', daysLeft + '일'], ['0건', thisMonth.length + '건']], ev: spec, th: { 'TH-체크인마감임박-구성원': daysLeft + '일', 'TH-당월체크인-없음': thisMonth.length + '건' } };
  });

  /* --- 중간점검-구성원-09 : 확신도 낮음 연속 -------------------------------- */
  E.registerEval('중간점검-구성원-09', function (ctx) {
    var SID = '중간점검-구성원-09';
    var cks = ctx.myCks.slice().sort(byDateAsc);
    if (!cks.length) return { hit: false, facts: {}, ev: {}, th: {} };
    var i, streak = 0;
    for (i = cks.length - 1; i >= 0; i--) { if (confKind(cks[i]) === 'low') streak++; else break; }
    var need = thv(SID, 'TH-저확신-연속', 2);
    var CS = canonStats();
    var recent = cks.slice(Math.max(0, cks.length - streak));
    var deltaSum = 0; recent.forEach(function (c) { deltaSum += num(c.progress_delta); });
    deltaSum = r1(deltaSum);
    var commonBlocker = recent.length ? (recent[0].blocker || null) : null;
    if (commonBlocker) { for (i = 1; i < recent.length; i++) if (recent[i].blocker !== commonBlocker) { commonBlocker = null; break; } }
    var facts = { streak: streak, need: need, lowN: CS.low, ckTotal: CS.total, lowPct: CS.lowPct, midN: CS.mid, midPct: CS.midPct, highN: CS.high, highPct: CS.highPct, deltaSum: deltaSum, commonBlocker: commonBlocker };
    var hit = streak >= need;
    var spec = {};
    spec[0] = { m: [['2회', streak + '회']], emph: streak + '회 연속', src: (recent.map(function (c) { return c.checkin_id; }).join(' / ')) || '해당 없음' };
    spec[1] = { m: [['360건', CS.total + '건'], ['68건(18.9%)', CS.low + '건(' + pn(CS.lowPct) + '%)']], emph: CS.low + '건(' + pn(CS.lowPct) + '%)', src: 'checkins.confidence 집계' };
    spec[2] = { m: [['190건(52.8%)', CS.mid + '건(' + pn(CS.midPct) + '%)'], ['102건(28.3%)', CS.high + '건(' + pn(CS.highPct) + '%)']], emph: CS.mid + '건(' + pn(CS.midPct) + '%)', src: 'checkins.confidence 집계' };
    if (streak > 0) spec[3] = { m: [['세 번', streak + '번'], ['4.8%p', deltaSum + '%p']], emph: deltaSum + '%p', src: recent.map(function (c) { return c.checkin_id; }).join(' / ') };
    if (commonBlocker) spec[4] = { m: [['협력업체 납품 지연', commonBlocker]], emph: commonBlocker, src: recent[0].checkin_id };
    return { hit: hit, facts: facts, notice: [['2회', streak + '회'], ['18.9%', pn(CS.lowPct) + '%']], ev: spec, th: { 'TH-저확신-연속': streak + '회', 'TH-저확신-전사비율': pn(CS.lowPct) + '%' } };
  });

  /* --- 중간점검-팀장-01 : 이번 회차 마감 임박 + 팀원 체크인 0건 ------------ */
  E.registerEval('중간점검-팀장-01', function (ctx) {
    var SID = '중간점검-팀장-01';
    var team = directReports(ctx.emp.emp_id);
    var per = periodsCheckin();
    if (!team.length || !per) return { hit: false, facts: {}, ev: {}, th: {} };
    var daysLeft = Math.round((dnum(per.due) - asofMs()) / 86400000);
    var rows = team.map(function (e) {
      var cks = checkinsOf(e.emp_id).filter(function (c) { return c.checkin_date >= per.start && c.checkin_date <= asof(); });
      return { emp: e, n: cks.length };
    });
    var zero = rows.filter(function (r) { return r.n === 0; });
    var withN = rows.length - zero.length;
    var worst = zero[0] || null;
    var facts = { teamN: team.length, zeroN: zero.length, withN: withN, daysLeft: daysLeft, worstName: worst ? worst.emp.name : '' };
    var hit = !!worst && daysLeft != null && daysLeft >= 0 && daysLeft <= thv(SID, 'TH-마감임박-체크인', 5);
    var spec = {};
    spec[0] = { m: [['9명', team.length + '명'], ['2명', zero.length + '명']], emph: zero.length + '명', src: ctx.emp.org_id + ' / 팀원 ' + team.length + '명' };
    if (worst) spec[1] = { m: [['{{팀원명}}', worst.emp.name], ['0건', '0건']], emph: '0건', src: worst.emp.emp_id + ' / 이번 회차 체크인 0건' };
    spec[2] = { m: [['5일', daysLeft + '일']], emph: daysLeft + '일', src: per.period_id + ' / due ' + per.due };
    spec[3] = { m: [['9명', team.length + '명'], ['7명', withN + '명']], emph: withN + '명', src: '팀원별 이번 회차 체크인 건수' };
    var noticePairs = [['5일', daysLeft + '일']];
    if (worst) noticePairs.push(['{{팀원명}}', worst.emp.name]);
    return { hit: hit, facts: facts, notice: noticePairs, ev: spec, th: { 'TH-마감임박-체크인': daysLeft + '일', 'TH-체크인건수-없음': '0건' } };
  });

  /* --- 중간점검-팀장-02 : 팀원 체크인 공백일 vs 팀 평균 간격 --------------- */
  E.registerEval('중간점검-팀장-02', function (ctx) {
    var SID = '중간점검-팀장-02';
    var team = directReports(ctx.emp.emp_id);
    var goalPer = periodsGoalOpen();
    if (!team.length || !goalPer) return { hit: false, facts: {}, ev: {}, th: {} };
    var rows = [];
    team.forEach(function (e) {
      var cks = checkinsOf(e.emp_id).slice().sort(byDateAsc);
      if (!cks.length) return;
      var last = cks[cks.length - 1];
      var intervals = [], i;
      for (i = 1; i < cks.length; i++) intervals.push(Math.round((dnum(cks[i].checkin_date) - dnum(cks[i - 1].checkin_date)) / 86400000));
      rows.push({ emp: e, cks: cks, last: last, gap: gapDaysFrom(last.checkin_date), intervals: intervals });
    });
    if (!rows.length) return { hit: false, facts: {}, ev: {}, th: {} };
    var allIntervals = [];
    rows.forEach(function (r) { allIntervals = allIntervals.concat(r.intervals); });
    var teamAvgGap = allIntervals.length ? r0(avg(allIntervals)) : 0;
    rows.sort(function (a, b) { return b.gap - a.gap; });
    var worst = rows[0];
    var goalDaysLeft = Math.round((dnum(goalPer.close) - asofMs()) / 86400000);
    var facts = { teamN: team.length, worstName: worst.emp.name, worstGap: worst.gap, teamAvgGap: teamAvgGap, goalDaysLeft: goalDaysLeft };
    var hit = worst.gap >= thv(SID, 'TH-체크인공백-경고', 21) && goalDaysLeft >= thv(SID, 'TH-기간잔여-존재', 1);
    var spec = {};
    spec[0] = { m: [['{{팀원명}}', worst.emp.name], ['2026년 6월 25일', fmtDate(worst.last.checkin_date)], ['21일', worst.gap + '일']], emph: worst.gap + '일', src: worst.emp.emp_id + ' / ' + worst.last.checkin_id };
    spec[1] = { m: [['8일', teamAvgGap + '일']], emph: teamAvgGap + '일', src: ctx.emp.org_id + ' / 팀 체크인 ' + rows.reduce(function (s, r) { return s + r.cks.length; }, 0) + '건' };
    if (worst.intervals.length >= 2) {
      var i1 = worst.intervals[worst.intervals.length - 2], i2 = worst.intervals[worst.intervals.length - 1];
      spec[2] = { m: [['9일', i1 + '일'], ['11일', i2 + '일'], ['21일', worst.gap + '일']], emph: worst.gap + '일', src: worst.emp.emp_id + ' / 체크인 간격' };
    }
    return { hit: hit, facts: facts, notice: [['{{팀원명}}', worst.emp.name], ['21일', worst.gap + '일'], ['8일', teamAvgGap + '일']], ev: spec, th: { 'TH-체크인공백-경고': worst.gap + '일', 'TH-기간잔여-존재': goalDaysLeft + '일' } };
  });

  /* --- 중간점검-팀장-06 : 팀원 핵심결과 진척 정체 연속 --------------------- */
  E.registerEval('중간점검-팀장-06', function (ctx) {
    var SID = '중간점검-팀장-06';
    var team = directReports(ctx.emp.emp_id);
    if (!team.length) return { hit: false, facts: {}, ev: {}, th: {} };
    var teamIds = {}; team.forEach(function (e) { teamIds[e.emp_id] = 1; });
    var kp = arr('krProgress').filter(function (k) { return teamIds[k.emp_id]; });
    var th0 = thv(SID, 'TH-진척정체-없음', 0), needStreak = thv(SID, 'TH-정체회차-연속', 3);
    if (!kp.length) return { hit: false, facts: { teamN: team.length }, ev: {}, th: { 'TH-진척정체-없음': th0 + '%p', 'TH-정체회차-연속': needStreak + '회' } };
    var byKr = {};
    kp.forEach(function (k) { (byKr[k.kr_id] = byKr[k.kr_id] || []).push(k); });
    var best = null, krId;
    for (krId in byKr) if (Object.prototype.hasOwnProperty.call(byKr, krId)) {
      var rows = byKr[krId].slice().sort(function (a, b) { return (a.week || 0) - (b.week || 0); });
      var streak = 0, i;
      for (i = rows.length - 1; i >= 0; i--) { if (num(rows[i].delta) <= th0) streak++; else break; }
      if (streak >= needStreak && (!best || streak > best.streak)) best = { krId: krId, rows: rows, streak: streak };
    }
    if (!best) return { hit: false, facts: { teamN: team.length, krChecked: Object.keys(byKr).length }, ev: {}, th: { 'TH-진척정체-없음': th0 + '%p', 'TH-정체회차-연속': needStreak + '회' } };
    var last = best.rows[best.rows.length - 1];
    var owner = findEmp(team, last.emp_id);
    var krRow = arr('keyResults').filter(function (k) { return k.kr_id === best.krId; })[0] || null;
    var oMap = {}; arr('objectives').forEach(function (o) { oMap[o.objective_id] = o.owner_emp_id; });
    var teamKrs = arr('keyResults').filter(function (k) { return teamIds[oMap[k.objective_id]]; });
    var teamAvg = teamKrs.length ? r0(avg(teamKrs.map(function (k) { return k.progress || 0; }))) : 0;
    var myProgress = krRow ? r0(krRow.progress || 0) : r0(last.progress);
    var diff = r0(teamAvg - myProgress);
    var facts = { teamN: team.length, memberName: owner ? owner.name : '', streak: best.streak, progress: myProgress, teamAvg: teamAvg, diff: diff, krName: krRow ? krRow.name : '' };
    var hit = best.streak >= needStreak;
    var spec = {};
    spec[0] = { m: [['{{팀원명}}', facts.memberName], ['3회', best.streak + '회']], emph: best.streak + '회 연속', src: best.krId + ' / krProgress' };
    spec[1] = { m: [['28%', myProgress + '%']], emph: myProgress + '%', src: best.krId };
    spec[2] = { m: [['43%', teamAvg + '%'], ['15%p', Math.abs(diff) + '%p']], emph: Math.abs(diff) + '%p', src: ctx.emp.org_id + ' / 팀 핵심결과 ' + teamKrs.length + '건' };
    return { hit: hit, facts: facts, notice: [['3회', best.streak + '회'], ['28%', myProgress + '%']], ev: spec, th: { 'TH-진척정체-없음': th0 + '%p', 'TH-정체회차-연속': best.streak + '회' } };
  });

  /* --- 중간점검-팀장-10 : 1on1 합의 항목 미이행 --------------------------- */
  E.registerEval('중간점검-팀장-10', function (ctx) {
    var SID = '중간점검-팀장-10';
    var meetings = arr('meetingStore').filter(function (m) { return m.leader_emp_id === ctx.emp.emp_id; });
    var needN = thv(SID, 'TH-합의미이행-건수', 1), needDays = thv(SID, 'TH-합의미이행-경과', 21);
    if (!meetings.length) return { hit: false, facts: {}, ev: {}, th: { 'TH-합의미이행-건수': needN + '건', 'TH-합의미이행-경과': needDays + '일' } };
    var best = null;
    meetings.forEach(function (m) {
      var overdue = (m.agreements || []).filter(function (a) { return a.status === 'overdue'; });
      if (!overdue.length) return;
      var atDate = String(m.at || '').slice(0, 10);
      var elapsed = gapDaysFrom(atDate);
      if (!best || elapsed > best.elapsed) best = { meeting: m, overdue: overdue, total: (m.agreements || []).length, elapsed: elapsed, atDate: atDate };
    });
    if (!best) return { hit: false, facts: { meetingN: meetings.length }, ev: {}, th: { 'TH-합의미이행-건수': needN + '건', 'TH-합의미이행-경과': needDays + '일' } };
    var team = directReports(ctx.emp.emp_id);
    var member = findEmp(team, best.meeting.member_emp_id);
    var memberName = member ? member.name : best.meeting.member_emp_id;
    var facts = { memberName: memberName, total: best.total, overdueN: best.overdue.length, elapsed: best.elapsed, atDate: best.atDate };
    var hit = best.overdue.length >= needN && best.elapsed >= needDays;
    var spec = {};
    spec[0] = { m: [['{{팀원명}}', memberName], ['3건', best.total + '건'], ['2건', best.overdue.length + '건']], emph: best.overdue.length + '건', src: best.meeting.meeting_id + ' / 합의 항목 ' + best.total + '건' };
    spec[1] = { m: [['21일 안에', needDays + '일 안에'], ['2026년 6월 25일', fmtDate(best.atDate)], ['21일이 지났어요', best.elapsed + '일이 지났어요']], src: 'policy.agreement_followup_days' };
    return { hit: hit, facts: facts, notice: [['2건', best.overdue.length + '건'], ['21일째', best.elapsed + '일째']], ev: spec, th: { 'TH-합의미이행-건수': best.overdue.length + '건', 'TH-합의미이행-경과': best.elapsed + '일' } };
  });

  /* --- 중간점검-팀장-11 : 초과근무 배수 초과 + 체크인 공백 심각 ----------- */
  E.registerEval('중간점검-팀장-11', function (ctx) {
    var SID = '중간점검-팀장-11';
    var team = directReports(ctx.emp.emp_id);
    if (!team.length) return { hit: false, facts: {}, ev: {}, th: {} };
    var curMonth = asof().slice(0, 7);
    var target = monthKeyShift(curMonth, -1);
    var companyRows = arr('attendance').filter(function (a) { return a.period === target; });
    if (!companyRows.length) return { hit: false, facts: {}, ev: {}, th: {} };
    var companyAvg = r1(avg(companyRows.map(function (a) { return num(a.overtime_hours); })));
    var teamIds = {}; team.forEach(function (e) { teamIds[e.emp_id] = 1; });
    var rows = companyRows.filter(function (a) { return teamIds[a.emp_id]; }).map(function (a) {
      var ot = num(a.overtime_hours);
      var ratio = companyAvg ? r1(ot / companyAvg) : 0;
      var cks = checkinsOf(a.emp_id).slice().sort(byDateAsc);
      var last = cks.length ? cks[cks.length - 1] : null;
      return { att: a, ratio: ratio, ot: ot, gap: last ? gapDaysFrom(last.checkin_date) : null, last: last };
    });
    rows.sort(function (a, b) { return b.ratio - a.ratio; });
    var worst = rows[0];
    if (!worst) return { hit: false, facts: {}, ev: {}, th: {} };
    var member = findEmp(team, worst.att.emp_id);
    var over30 = rows.filter(function (r) { return r.ot > 30; }).length;
    var facts = { memberName: member ? member.name : '', targetMonth: target, ot: worst.ot, companyAvg: companyAvg, ratio: worst.ratio, gap: worst.gap, over30N: over30, teamN: team.length };
    var hit = worst.ratio >= thv(SID, 'TH-초과근무배수-초과', 2) && worst.gap != null && worst.gap >= thv(SID, 'TH-체크인공백-심각', 45);
    var spec = {};
    spec[0] = { m: [['{{팀원명}}', facts.memberName], ['2026년 5월', fmtMonthFull(target)], ['41.4시간', worst.ot + '시간']], emph: worst.ot + '시간', src: worst.att.emp_id + ' / ' + target + ' 근태' };
    if (worst.att.avg_out_time) spec[1] = { m: [['20:47', worst.att.avg_out_time], ['5회', (worst.att.late_count || 0) + '회']], emph: worst.att.avg_out_time, src: worst.att.att_id };
    spec[2] = { m: [['12.6시간', companyAvg + '시간'], ['3.3배', worst.ratio + '배']], emph: worst.ratio + '배', src: '전사 근태 ' + companyRows.length + '건 / ' + target };
    spec[3] = { m: [['9명', team.length + '명'], ['한 사람', over30 === 1 ? '한 사람' : (over30 + '명')]], emph: over30 === 1 ? '한 사람' : (over30 + '명'), src: ctx.emp.org_id + ' / 팀원 ' + team.length + '명 근태' };
    if (worst.last) spec[5] = { m: [['2026년 4월 25일', fmtDate(worst.last.checkin_date)]], emph: fmtDate(worst.last.checkin_date) + ' 이후', src: worst.att.emp_id + ' / ' + worst.last.checkin_id };
    return { hit: hit, facts: facts, notice: [['5월', fmtMonthShort(target)], ['3.3배', worst.ratio + '배'], ['82일째', (worst.gap || 0) + '일째']], ev: spec, th: { 'TH-초과근무배수-초과': worst.ratio + '배', 'TH-체크인공백-심각': (worst.gap || 0) + '일' } };
  });

  /* --- 중간점검-HR경영진-01 : 전사 체크인 참여율 vs 기간 경과율 ----------- */
  E.registerEval('중간점검-HR경영진-01', function (ctx) {
    var SID = '중간점검-HR경영진-01';
    var per = periodsCheckin();
    if (!per) return { hit: false, facts: {}, ev: {}, th: {} };
    var emps = arr('employees'), canon = canonCheckins();
    var withCk = {}; canon.forEach(function (c) { withCk[c.emp_id] = 1; });
    var withCkN = Object.keys(withCk).length;
    var empTotal = emps.length;
    var participRate = empTotal ? r1(withCkN / empTotal * 100) : 0;
    var start = dnum(per.start), close = dnum(per.close);
    var elapsed = (start != null && close != null && close > start) ? Math.max(0, Math.min(100, r0((asofMs() - start) / (close - start) * 100))) : null;
    var gap = elapsed != null ? r1(elapsed - participRate) : null;
    var orgTotal = arr('orgs').length;
    var byOrgHasCk = {};
    emps.forEach(function (e) { byOrgHasCk[e.org_id] = false; });
    canon.forEach(function (c) { var e = findEmp(emps, c.emp_id); if (e) byOrgHasCk[e.org_id] = true; });
    var zeroOrgN = 0, ok;
    for (ok in byOrgHasCk) if (Object.prototype.hasOwnProperty.call(byOrgHasCk, ok) && !byOrgHasCk[ok]) zeroOrgN++;
    var facts = { empTotal: empTotal, withCkN: withCkN, participRate: participRate, ckTotal: canon.length, zeroPersonN: empTotal - withCkN, elapsed: elapsed, gap: gap, orgTotal: orgTotal, zeroOrgN: zeroOrgN, period: per.label };
    var hit = elapsed != null && gap != null && gap >= thv(SID, 'TH-체크인참여율-기간대비격차', 20) && zeroOrgN >= thv(SID, 'TH-체크인0건조직-건수', 5);
    var spec = {};
    spec[0] = { m: [['221명', empTotal + '명'], ['38개', orgTotal + '개']], emph: empTotal + '명', src: 'EMP 전수 ' + empTotal + '명 / ORG 전수 ' + orgTotal + '개' };
    spec[1] = { m: [['221명', empTotal + '명'], ['147명', withCkN + '명']], emph: withCkN + '명', src: 'CHK(캐노니컬) ' + canon.length + '건' };
    spec[2] = { m: [['74명', (empTotal - withCkN) + '명']], emph: (empTotal - withCkN) + '명', src: 'CHK(캐노니컬) ' + canon.length + '건 / EMP 전수 ' + empTotal + '명' };
    if (elapsed != null) spec[3] = { m: [['2026년 2분기(4~6월)', per.label], ['100%', elapsed + '%'], ['33.5%p', Math.abs(gap) + '%p']], emph: Math.abs(gap) + '%p', src: per.period_id };
    return { hit: hit, facts: facts, notice: [['66.5%', pn(participRate) + '%']], ev: spec, th: { 'TH-체크인참여율-기간대비격차': (gap == null ? null : pn(gap) + '%p'), 'TH-체크인0건조직-건수': zeroOrgN + '곳' } };
  });

  /* --- 중간점검-HR경영진-06 : 전사 확신도 낮음 비중 ----------------------- */
  E.registerEval('중간점검-HR경영진-06', function (ctx) {
    var SID = '중간점검-HR경영진-06';
    var CS = canonStats();
    var facts = { ckTotal: CS.total, lowN: CS.low, lowPct: CS.lowPct, midN: CS.mid, midPct: CS.midPct, highN: CS.high, highPct: CS.highPct };
    var hit = CS.total >= thv(SID, 'TH-확신도대상-최소건수', 50) && CS.lowPct >= thv(SID, 'TH-저확신비율-초과', 15);
    var spec = {};
    spec[0] = { m: [['360건', CS.total + '건']], emph: CS.total + '건', src: 'checkins(캐노니컬) ' + CS.total + '건 / confidence' };
    spec[1] = { m: [['68건', CS.low + '건']], emph: CS.low + '건', src: 'checkins.confidence 집계' };
    spec[2] = { m: [['52.8%', pn(CS.midPct) + '%'], ['28.3%', pn(CS.highPct) + '%']], src: 'checkins.confidence 집계' };
    spec[3] = { m: [['18.9%', pn(CS.lowPct) + '%'], ['15%', thv(SID, 'TH-저확신비율-초과', 15) + '%']], emph: pn(CS.lowPct) + '%', src: '확신도 낮음 체크인 비율 기준값' };
    return { hit: hit, facts: facts, notice: [['360건', CS.total + '건'], ['68건', CS.low + '건']], ev: spec, th: { 'TH-저확신비율-초과': pn(CS.lowPct) + '%', 'TH-확신도대상-최소건수': CS.total + '건' } };
  });
})();
