/* js/ez_signal_eval5.js — 담당 D: 피드백 32건 중 미등록 신호에 판정 함수 등록 (20-4차) */
(function () {
  'use strict';
  var E = window.EZSignalEngine;
  if (!E || !E.registerEval) return;          /* 엔진 없으면 조용히 아무 것도 안 한다 */
  var Hp = E.helpers || {};
  function arr(k) { return (Hp.arr ? Hp.arr(k) : []) || []; }
  var r0 = Hp.r0, r1 = Hp.r1, thv = Hp.thv, asofMs = Hp.asofMs, avg = Hp.avg;

  /* ---------- 공용 도구 ---------- */
  function dateOnly(s) { return s ? String(s).slice(0, 10) : null; }
  function dnum(s) { if (!s) return null; var t = Date.parse(String(s).slice(0, 10) + 'T00:00:00Z'); return isNaN(t) ? null : t; }
  function policy() { var d = Hp.data ? Hp.data() : null; return (d && d.policy) || {}; }
  function empById(id) { var out = null; arr('employees').forEach(function (e) { if (e.emp_id === id) out = e; }); return out; }
  function empName(id) { var e = empById(id); return e ? e.name : id; }
  /* 이번 기·다음 기 중 아직 안 닫힌 기간을 우선 고르고, 없으면 가장 최근 것이라도 쓴다 */
  function periodOf(kind) {
    var found = null;
    arr('periods').forEach(function (p) { if (!found && p.kind === kind && p.status !== 'closed') found = p; });
    if (!found) arr('periods').forEach(function (p) { if (!found && p.kind === kind) found = p; });
    return found;
  }
  /* 조직 하위 트리(자기 자신 포함) org_id 집합 — 엔진 내부 subtreeIds 는 밖에서 못 쓰므로 직접 만든다 */
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
  /* 상위조직장 scope 의 하위 팀별로 면담 대상·실시 인원을 센다 (01·05 신호 공용) */
  function teamMeetingRows(s) {
    return s.units.map(function (u) {
      var ids = empIdsInOrgSet(orgDescendants(u.org));
      var idN = Object.keys(ids).length;
      var met = {};
      arr('meetingStore').forEach(function (m) { if (ids[m.member_emp_id]) met[m.member_emp_id] = 1; });
      var doneN = Object.keys(met).length;
      return { org: u.org, name: u.name, targetN: idN, doneN: doneN, rate: idN ? r0(doneN / idN * 100) : null };
    });
  }

  /* ==================================================================
     구성원
  ================================================================== */

  /* --- 피드백-구성원-01 : 배정된 다면진단 미제출 --------------------------- */
  E.registerEval('피드백-구성원-01', function (ctx) {
    var SID = '피드백-구성원-01';
    var my = ctx.emp.emp_id;
    var mine = arr('msfAssign').filter(function (a) { return a.rater_emp_id === my; });
    var assignedN = mine.length;
    var missing = mine.filter(function (a) { return !a.submitted_at; });
    var missingN = missing.length;
    var due = mine.length ? dateOnly(mine[0].due) : null;
    /* 이미 마감이 지난 배정도 있어 「N일 남았다」 문구가 음수로 깨지지 않게 0에서 바닥을 둔다 */
    var daysLeftRaw = due ? Math.round((dnum(due) - asofMs()) / 86400000) : null;
    var daysLeft = daysLeftRaw == null ? null : Math.max(0, daysLeftRaw);
    var facts = {
      assignedN: assignedN, missingN: missingN, due: due, daysLeft: daysLeft,
      missNames: missing.map(function (a) { return empName(a.target_emp_id); })
    };
    var hit = assignedN > 0 && missingN >= thv(SID, 'TH-다면진단-미작성', 1)
      && daysLeft != null && daysLeft <= thv(SID, 'TH-다면진단마감임박-구성원', 3);
    var spec = {};
    if (assignedN) spec[0] = { m: [['5명', assignedN + '명'], ['2명', missingN + '명']], emph: missingN + '명',
                src: 'msfAssign rater_emp_id=' + my };
    if (due) spec[1] = { m: [['2026년 8월 5일', due], ['3일', daysLeft + '일']], emph: daysLeft + '일',
                src: 'msfAssign.due' };
    /* 「함께 체크인을 남긴 사이」는 원천이 없어 (추정)으로 두되 인원수만 실측에 맞춘다 */
    if (missingN) spec[2] = { m: [['두 분', missingN + '명']], emph: missingN + '명', assumed: 1,
                src: 'msfAssign 미제출 ' + missingN + '명' };
    return {
      hit: hit, facts: facts,
      notice: assignedN ? [['3일', daysLeft + '일'], ['2명', missingN + '명']] : [],
      ev: spec,
      th: { 'TH-다면진단마감임박-구성원': (daysLeft == null ? '?' : daysLeft) + '일', 'TH-다면진단-미작성': missingN + '명' }
    };
  });

  /* --- 피드백-구성원-04 : 받은 피드백 미열람 + 사이클 종료 임박 ------------- */
  E.registerEval('피드백-구성원-04', function (ctx) {
    var SID = '피드백-구성원-04';
    var my = ctx.emp.emp_id;
    var mine = arr('feedbackLog').filter(function (f) { return f.to_emp === my && f.sent_at; });
    var unread = mine.filter(function (f) { return !f.read_at; });
    var per = periodOf('feedback');
    var close = per ? dateOnly(per.close) : null;
    var daysLeft = close ? Math.round((dnum(close) - asofMs()) / 86400000) : null;
    var facts = { totalReceived: mine.length, unreadN: unread.length, closeDate: close, daysLeft: daysLeft };
    var hit = unread.length >= thv(SID, 'TH-피드백-미열람', 1)
      && daysLeft != null && daysLeft >= 0 && daysLeft <= thv(SID, 'TH-사이클종료임박-구성원', 2);
    var spec = {};
    spec[0] = { m: [['3건', unread.length + '건']], emph: unread.length + '건', src: 'feedbackLog to_emp=' + my + ' / read_at 없음' };
    if (close) spec[1] = { m: [['2026년 7월 31일', close], ['2일', daysLeft + '일']], emph: daysLeft + '일', src: 'periods(feedback).close' };
    /* feedbackLog 에는 본문이 없어 「어느 핵심결과를 언급했는지」는 셀 수 없다 — 셀 수 있는 갈래만 말한다 */
    if (mine.length) {
      var kinds = {}; mine.forEach(function (f) { kinds[f.kind] = (kinds[f.kind] || 0) + 1; });
      var kindStr = Object.keys(kinds).map(function (k) { return '「' + k + '」 ' + kinds[k] + '건'; }).join(' · ');
      spec[2] = { m: [], text: '받은 피드백 ' + mine.length + '건의 갈래는 ' + kindStr + '이고 어느 핵심결과를 가리키는지는 원문에만 있어요',
                  emph: kindStr, src: 'feedbackLog to_emp=' + my + ' / kind', assumed: 0 };
    }
    return {
      hit: hit, facts: facts,
      notice: [['2일', (daysLeft == null ? '?' : daysLeft) + '일'], ['3건', unread.length + '건']],
      ev: spec,
      th: { 'TH-사이클종료임박-구성원': (daysLeft == null ? '?' : daysLeft) + '일', 'TH-피드백-미열람': unread.length + '건' }
    };
  });

  /* --- 피드백-구성원-06 : 상향 피드백 미응답 ------------------------------ */
  E.registerEval('피드백-구성원-06', function (ctx) {
    var SID = '피드백-구성원-06';
    var my = ctx.emp.emp_id, myOrg = ctx.emp.org_id;
    var orgRows = arr('upwardResp').filter(function (u) { return u.org_id === myOrg; });
    var mine = orgRows.filter(function (u) { return u.rater_emp_id === my; })[0] || null;
    var orgDone = orgRows.filter(function (u) { return !!u.submitted_at; }).length;
    var assignedAt = mine ? dateOnly(mine.assigned_at) : null;
    var elapsed = assignedAt ? Math.round((asofMs() - dnum(assignedAt)) / 86400000) : null;
    var minRaters = policy().msf_min_raters || thv(SID, 'TH-익명보호-최소응답', 3);
    var facts = {
      responded: !!(mine && mine.submitted_at), orgTotal: orgRows.length, orgDone: orgDone,
      orgMissing: orgRows.length - orgDone, elapsed: elapsed, minRaters: minRaters
    };
    var hit = !!mine && !mine.submitted_at && (orgRows.length - orgDone) >= 1
      && elapsed != null && elapsed >= thv(SID, 'TH-상향피드백-미응답', 7);
    var spec = {};
    if (mine) spec[0] = { m: [['없어요', mine.submitted_at ? '있어요' : '없어요']], emph: mine.submitted_at ? '있어요' : '없어요',
                src: 'upwardResp rater_emp_id=' + my };
    /* 미응답이 나 혼자가 아니면 「남은 한 사람이 저예요」가 거짓이 된다 — 남은 인원수를 밝힌다 */
    var missTail = (orgRows.length - orgDone) === 1 ? '남은 한 사람이 저예요'
      : '남은 ' + (orgRows.length - orgDone) + '명 가운데 한 사람이 저예요';
    if (orgRows.length) spec[1] = { m: [['5명', orgRows.length + '명'], ['4명', orgDone + '명'], ['남은 한 사람이 저예요', missTail]],
                src: 'upwardResp org_id=' + myOrg };
    /* 「다른 조직」 = 전원 응답했지만 익명 보호 기준에 못 미치는 다른 조직 */
    var byOther = {};
    arr('upwardResp').forEach(function (u) {
      if (u.org_id === myOrg) return;
      var b = byOther[u.org_id] = byOther[u.org_id] || { org: u.org_id, n: 0, d: 0 };
      b.n++; if (u.submitted_at) b.d++;
    });
    var smallOrg = null;
    Object.keys(byOther).forEach(function (o) { var b = byOther[o]; if (!smallOrg && b.n === b.d && b.n < minRaters) smallOrg = b; });
    if (smallOrg) spec[2] = { m: [['2명 중', smallOrg.n + '명 중'], ['2명이 응답', smallOrg.d + '명이 응답'], ['3명에', minRaters + '명에']],
                emph: smallOrg.n + '명', src: smallOrg.org + ' / upwardResp ' + smallOrg.d + '/' + smallOrg.n + '명' };
    if (elapsed != null) spec[3] = { m: [['2026년 7월 20일', assignedAt], ['8일', elapsed + '일']], emph: elapsed + '일',
                src: 'upwardResp.assigned_at' };
    return {
      hit: hit, facts: facts,
      notice: elapsed != null
        ? [['8일', elapsed + '일'], ['5명', orgRows.length + '명'],
           ['내 응답만 없어요', (orgRows.length - orgDone) === 1 ? '내 응답만 없어요' : '내 응답이 아직 없어요']]
        : [],
      ev: spec,
      /* 「원문 공개 최소 응답 수」의 측정값은 기준(3명)이 아니라 우리 조직에 실제로 모인 응답 수다 */
      th: { 'TH-상향피드백-미응답': (elapsed == null ? '?' : elapsed) + '일', 'TH-익명보호-최소응답': orgDone + '명' }
    };
  });

  /* ==================================================================
     팀장
  ================================================================== */

  /* --- 피드백-팀장-01 : 직속 팀원 면담 미실시 ------------------------------ */
  E.registerEval('피드백-팀장-01', function (ctx) {
    var SID = '피드백-팀장-01';
    var my = ctx.emp.emp_id;
    var reports = arr('employees').filter(function (e) { return e.manager_id === my; });
    var metIds = {};
    arr('meetingStore').forEach(function (m) { if (m.leader_emp_id === my) metIds[m.member_emp_id] = 1; });
    var missing = reports.filter(function (e) { return !metIds[e.emp_id]; });
    var target = missing[0] || null;
    /* ponytail: 「면담 기간 개시일」 전용 원천이 없어 이번 사이클 저장된 면담 중 가장 이른 날짜를 개시 근사치로 쓴다.
       면담 기간 필드가 따로 생기면 그걸로 교체한다. */
    var openDate = null;
    arr('meetingStore').forEach(function (m) { var d = dateOnly(m.at); if (d && (!openDate || d < openDate)) openDate = d; });
    var elapsed = openDate ? Math.round((asofMs() - dnum(openDate)) / 86400000) : null;
    var facts = {
      reportN: reports.length, doneN: reports.length - missing.length, missingN: missing.length,
      targetName: target ? target.name : '', openDate: openDate, elapsed: elapsed
    };
    var hit = !!target && elapsed != null && elapsed >= thv(SID, 'TH-면담개시경과-개인', 7);
    var spec = {};
    spec[0] = { m: [['9명', reports.length + '명'], ['3명', missing.length + '명']], emph: missing.length + '명',
                src: '직속 팀원 ' + reports.length + '명 / meetingStore leader_emp_id=' + my };
    if (target) {
      spec[1] = { m: [['{{팀원명}}', target.name], ['0건', '0건']], emph: '0건', src: target.emp_id + ' / 면담 기록 0건' };
      if (elapsed != null) spec[2] = { m: [['7일', elapsed + '일']], emph: elapsed + '일', src: 'meetingStore.at 최솟값(근사)' };
      spec[3] = { m: [['9명', reports.length + '명'], ['6명', facts.doneN + '명'], ['3명', missing.length + '명'], ['{{팀원명}}', target.name]],
                  emph: facts.doneN + '명', src: '직속 팀원 면담 기록 집계' };
    }
    return {
      hit: hit, facts: facts,
      notice: target ? [['7일', (elapsed == null ? '?' : elapsed) + '일'], ['{{팀원명}}', target.name]] : [],
      ev: spec,
      th: { 'TH-면담개시경과-개인': (elapsed == null ? '?' : elapsed) + '일', 'TH-면담기록-없음': '0건' }
    };
  });

  /* --- 피드백-팀장-07 : 팀원 다수 피드백 0건 ------------------------------- */
  E.registerEval('피드백-팀장-07', function (ctx) {
    var SID = '피드백-팀장-07';
    var my = ctx.emp.emp_id;
    var reports = arr('employees').filter(function (e) { return e.manager_id === my; });
    var reportIds = {}; reports.forEach(function (e) { reportIds[e.emp_id] = 1; });
    var teamFb = arr('feedbackLog').filter(function (f) { return reportIds[f.to_emp]; });
    var gotIds = {}; teamFb.forEach(function (f) { gotIds[f.to_emp] = 1; });
    var gotN = Object.keys(gotIds).length;
    var zeroN = reports.length - gotN;
    var recentN = teamFb.filter(function (f) {
      var d = dateOnly(f.draft_at) || dateOnly(f.sent_at);
      return d && Math.round((asofMs() - dnum(d)) / 86400000) <= 7;
    }).length;
    var pct = reports.length ? r0(zeroN / reports.length * 100) : null;
    /* 면담 기간 개시일 = 결과 피드백·면담 기간의 시작일 (팀장-01 의 meetingStore 근사보다 정확한 원천) */
    var perF = periodOf('feedback');
    var openDate = perF ? dateOnly(perF.start) : null;
    var elapsed = openDate ? Math.round((asofMs() - dnum(openDate)) / 86400000) : null;
    var facts = { reportN: reports.length, gotN: gotN, zeroN: zeroN, recentN: recentN, pct: pct,
                  openDate: openDate, elapsed: elapsed };
    var hit = reports.length > 0 && pct != null && pct >= thv(SID, 'TH-미전달인원-초과', 40);
    var spec = {};
    spec[0] = { m: [['9명', reports.length + '명'], ['5명', zeroN + '명']], emph: zeroN + '명',
                src: '직속 팀원 ' + reports.length + '명 / feedbackLog to_emp' };
    if (elapsed != null) spec[1] = { m: [['14일', elapsed + '일']], emph: elapsed + '일', src: 'periods(feedback).start ' + openDate };
    spec[2] = { m: [['9명', reports.length + '명'], ['4명', gotN + '명']], emph: gotN + '명', src: '직속 팀원 feedbackLog 집계' };
    spec[3] = { m: [['0건', recentN + '건']], emph: recentN + '건', src: '최근 7일 feedbackLog 신규 기록' };
    return {
      hit: hit, facts: facts,
      notice: [['14일', (elapsed == null ? '?' : elapsed) + '일'], ['9명', reports.length + '명'], ['5명', zeroN + '명']],
      ev: spec,
      th: { 'TH-면담개시경과-팀집계': (elapsed == null ? '확인 불가' : elapsed + '일'),
            'TH-미전달인원-초과': (pct == null ? 0 : pct) + '%', 'TH-저장정체-없음': recentN + '건' }
    };
  });

  /* --- 피드백-팀장-08 : 팀원 다수 개별 피드백 장기 공백 -------------------- */
  E.registerEval('피드백-팀장-08', function (ctx) {
    var SID = '피드백-팀장-08';
    var my = ctx.emp.emp_id;
    var WIN = thv(SID, 'TH-피드백공백-경고', 45);
    var reports = arr('employees').filter(function (e) { return e.manager_id === my; });
    var lastByEmp = {};
    arr('feedbackLog').forEach(function (f) {
      if (!f.sent_at) return;
      var d = dateOnly(f.sent_at);
      if (!lastByEmp[f.to_emp] || d > lastByEmp[f.to_emp]) lastByEmp[f.to_emp] = d;
    });
    var rows = reports.map(function (e) {
      var last = lastByEmp[e.emp_id] || null;
      var gap = last ? Math.round((asofMs() - dnum(last)) / 86400000) : null;
      return { emp: e, last: last, gap: gap };
    });
    var empty = rows.filter(function (r) { return r.gap == null || r.gap >= WIN; });
    var rest = rows.filter(function (r) { return r.gap != null && r.gap < WIN; });
    var restCounts = rest.map(function (r) {
      return arr('feedbackLog').filter(function (f) { return f.to_emp === r.emp.emp_id && f.sent_at; }).length;
    });
    var restAvg = restCounts.length ? r1(avg(restCounts)) : null;
    var withDate = empty.filter(function (r) { return r.last; }).sort(function (a, b) { return a.last < b.last ? -1 : 1; });
    var oldest = withDate[0] || null;
    var CK_MIN = 2;
    var lowCkN = empty.filter(function (r) {
      return arr('checkins').filter(function (c) { return c.emp_id === r.emp.emp_id; }).length < CK_MIN;
    }).length;
    var maxGap = null;
    rows.forEach(function (r) { if (r.gap != null && (maxGap == null || r.gap > maxGap)) maxGap = r.gap; });
    var pct = reports.length ? r0(empty.length / reports.length * 100) : null;
    var facts = {
      reportN: reports.length, emptyN: empty.length, pct: pct, maxGap: maxGap,
      oldestName: oldest ? oldest.emp.name : '', oldestDate: oldest ? oldest.last : '',
      restN: rest.length, restAvg: restAvg, lowCkN: lowCkN, winDays: WIN
    };
    var hit = reports.length > 0 && pct != null && pct >= thv(SID, 'TH-공백인원-초과', 30);
    var spec = {};
    spec[0] = { m: [['9명', reports.length + '명'], ['60일', WIN + '일'], ['3명', empty.length + '명']], emph: empty.length + '명',
                src: '직속 팀원 ' + reports.length + '명 / feedbackLog to_emp' };
    spec[1] = oldest
      ? { m: [['2026년 5월 17일', oldest.last]], emph: oldest.last, src: oldest.emp.emp_id + ' / 개별 피드백 기록' }
      : { m: [], text: '그중 ' + empty.length + '명은 개별 피드백 기록이 한 건도 남아 있지 않아요', emph: empty.length + '명',
          src: '직속 팀원 ' + reports.length + '명 / feedbackLog 기록 없음', assumed: 0 };
    spec[2] = (restAvg != null)
      ? { m: [['6명', rest.length + '명'], ['2.3건', restAvg + '건']], emph: restAvg + '건', src: '직속 팀원 / feedbackLog 집계' }
      : { m: [], text: '직속 팀원 ' + reports.length + '명이 모두 공백이라 견줘 볼 나머지 인원이 없어요', emph: '0명',
          src: '직속 팀원 ' + reports.length + '명 / 공백 ' + empty.length + '명', assumed: 0 };
    /* 상향 피드백 응답자 수·주제 지목 인원은 내 조직 upwardFeedback 에서 그대로 센다 */
    var uf = arr('upwardFeedback').filter(function (u) { return u.leader_emp_id === my || u.org_id === ctx.emp.org_id; })[0] || null;
    var ufTheme = null;
    if (uf) (uf.themes || []).forEach(function (t) { if (!ufTheme && String(t.label).indexOf('피드백') >= 0) ufTheme = t; });
    if (uf && ufTheme) spec[3] = { m: [['5명', (uf.respondents || 0) + '명'], ['3명', ufTheme.count + '명'],
                      ['개별 피드백 빈도 부족', ufTheme.label]],
                emph: ufTheme.count + '명', src: uf.uf_id + ' / 응답자 ' + (uf.respondents || 0) + '명 · themes' };
    spec[4] = { m: [['3명', empty.length + '명'], ['2명은', lowCkN + '명은'], ['2건 아래', CK_MIN + '건 아래']],
                emph: lowCkN + '명', src: 'checkins 집계 / 기준 ' + CK_MIN + '건' };
    return {
      hit: hit, facts: facts,
      notice: [['9명', reports.length + '명'], ['3명', empty.length + '명'], ['60일째', WIN + '일째']],
      ev: spec,
      /* 공백일 측정값은 기준(45일)이 아니라 팀에서 실제로 가장 긴 공백 — 기록이 아예 없으면 잴 수 없다 */
      th: { 'TH-피드백공백-경고': (maxGap == null ? '기록 없음' : maxGap + '일'),
            'TH-공백인원-초과': (pct == null ? 0 : pct) + '%',
            'TH-익명보호-최소': (uf ? (uf.respondents || 0) + '명' : '확인 불가') }
    };
  });

  /* ==================================================================
     상위조직장
  ================================================================== */

  /* --- 피드백-상위조직장-01 : 하위 팀 면담 완료율 미달 --------------------- */
  E.registerEval('피드백-상위조직장-01', function (ctx) {
    var SID = '피드백-상위조직장-01';
    var s = ctx.scope;
    if (!s) return { hit: false, facts: {}, ev: {}, th: {} };
    var rows = teamMeetingRows(s);
    var zero = rows.filter(function (r) { return r.targetN > 0 && r.doneN === 0; });
    var totTarget = 0, totDone = 0;
    rows.forEach(function (r) { totTarget += r.targetN; totDone += r.doneN; });
    var avgRate = totTarget ? r0(totDone / totTarget * 100) : null;
    var zeroTargetSum = 0; zero.forEach(function (r) { zeroTargetSum += r.targetN; });
    var perF = periodOf('feedback');
    var openDate = perF ? dateOnly(perF.start) : null;
    var elapsed = openDate ? Math.round((asofMs() - dnum(openDate)) / 86400000) : null;
    var facts = {
      unitN: s.unitN, totTarget: totTarget, totDone: totDone, avgRate: avgRate,
      zeroTeamN: zero.length, zeroTeams: zero.map(function (r) { return r.name; }),
      openDate: openDate, elapsed: elapsed
    };
    var hit = zero.length >= thv(SID, 'TH-면담0건조직-건수', 1)
      && avgRate != null && avgRate < (100 - thv(SID, 'TH-팀면담실시율-저조', 30));
    var spec = {};
    spec[0] = { m: [['8개', s.unitN + '개'], ['62명', totTarget + '명']], emph: totTarget + '명', src: s.srcOrg };
    spec[1] = { m: [['2개', zero.length + '개'], ['0건', '0건']], emph: zero.length + '개',
                src: (zero.map(function (r) { return r.org; }).join(' · ') || '없음') + ' / meetingStore' };
    spec[2] = { m: [['두 팀', zero.length + '개 팀'], ['17명', zeroTargetSum + '명']], emph: zeroTargetSum + '명', src: '면담 0건 조직 대상자 집계' };
    if (avgRate != null) spec[3] = { m: [['63%', avgRate + '%']], emph: avgRate + '%', src: s.srcOrg + ' / meetingStore ' + totDone + '건' };
    return {
      hit: hit, facts: facts,
      notice: [['8개', s.unitN + '개'], ['2개', zero.length + '개'], ['10일째', (elapsed == null ? '?' : elapsed) + '일째']],
      ev: spec,
      /* 이름이 「팀 면담 실시율」이므로 측정값도 실시율이어야 한다 — 미실시율(100−49)을 넣으면 근거④와 어긋난다 */
      th: { 'TH-면담기간-경과일': (elapsed == null ? '확인 불가' : elapsed + '일'),
            'TH-팀면담실시율-저조': (avgRate == null ? '확인 불가' : avgRate + '%'), 'TH-면담0건조직-건수': zero.length + '개' }
    };
  });

  /* --- 피드백-상위조직장-05 : 팀별 면담 실시율 격차 ------------------------ */
  E.registerEval('피드백-상위조직장-05', function (ctx) {
    var SID = '피드백-상위조직장-05';
    var s = ctx.scope;
    if (!s) return { hit: false, facts: {}, ev: {}, th: {} };
    var rows = teamMeetingRows(s).filter(function (r) { return r.rate != null; });
    if (!rows.length) return { hit: false, facts: {}, ev: {}, th: {} };
    var sorted = rows.slice().sort(function (a, b) { return b.rate - a.rate; });
    var hi = sorted[0], lo = sorted[sorted.length - 1];
    var totTarget = 0, totDone = 0;
    rows.forEach(function (r) { totTarget += r.targetN; totDone += r.doneN; });
    var avgRate = totTarget ? r0(totDone / totTarget * 100) : null;
    var halfN = rows.filter(function (r) { return r.rate < 50; }).length;
    var gap = r0(hi.rate - lo.rate);
    var diffFromAvg = avgRate != null ? r0(avgRate - lo.rate) : null;
    var facts = {
      unitN: s.unitN, hiName: hi.name, hiRate: hi.rate, loName: lo.name, loRate: lo.rate,
      gap: gap, avgRate: avgRate, halfN: halfN, diffFromAvg: diffFromAvg
    };
    var hit = gap >= thv(SID, 'TH-팀면담격차-폭', 40) && lo.rate < thv(SID, 'TH-팀면담실시율-저조', 30);
    var spec = {};
    spec[0] = { m: [['8개', s.unitN + '개'], ['62명', totTarget + '명']], emph: s.unitN + '개 팀', src: s.srcOrg };
    spec[1] = { m: [['88%', hi.rate + '%'], ['30%', lo.rate + '%']], emph: lo.rate + '%',
                src: hi.org + ' / ' + lo.org + ' / meetingStore' };
    spec[2] = { m: [['여덟 곳', rows.length + '곳'], ['세 곳', halfN + '곳']], emph: halfN + '곳', src: s.srcOrg + ' / meetingStore' };
    if (avgRate != null) spec[3] = { m: [['63%', avgRate + '%'], ['33%p', (diffFromAvg == null ? '?' : diffFromAvg) + '%p']],
                emph: (diffFromAvg == null ? '?' : diffFromAvg) + '%p', src: s.srcOrg + ' / meetingStore ' + totDone + '건' };
    return {
      hit: hit, facts: facts,
      notice: [['8개', s.unitN + '개'], ['88%', hi.rate + '%'], ['30%', lo.rate + '%']],
      ev: spec,
      th: { 'TH-팀면담격차-폭': gap + '%p', 'TH-팀면담실시율-저조': lo.rate + '%' }
    };
  });

  /* --- 피드백-상위조직장-07 : 면담 합의 항목 미이행 ------------------------ */
  E.registerEval('피드백-상위조직장-07', function (ctx) {
    var SID = '피드백-상위조직장-07';
    var s = ctx.scope;
    if (!s) return { hit: false, facts: {}, ev: {}, th: {} };
    var ids = empIdsInOrgSet(orgDescendants(s.scopeOrg.org_id));
    var rows = arr('meetingStore').filter(function (m) { return ids[m.leader_emp_id] || ids[m.member_emp_id]; });
    /* ponytail: 카탈로그는 "합의 항목이 비어 있다"지만 실 데이터는 합의 항목이 늘 채워져 있고
       대신 status='overdue'(약속했지만 안 지켜짐)로 남는다 — 그걸 공백에 준하는 문제로 센다 */
    var bad = rows.filter(function (m) { return (m.agreements || []).some(function (a) { return a.status === 'overdue'; }); });
    var badPct = rows.length ? r0(bad.length / rows.length * 100) : null;
    var byOrg = {};
    bad.forEach(function (m) { var e = empById(m.member_emp_id), o = e ? e.org_id : '?'; byOrg[o] = (byOrg[o] || 0) + 1; });
    var top2 = Object.keys(byOrg).sort(function (a, b) { return byOrg[b] - byOrg[a]; }).slice(0, 2);
    var top2N = 0; top2.forEach(function (o) { top2N += byOrg[o]; });
    var stalest = null;
    bad.forEach(function (m) {
      (m.agreements || []).forEach(function (a) {
        if (a.status !== 'overdue' || !a.due) return;
        var el = Math.round((asofMs() - dnum(a.due)) / 86400000);
        if (stalest == null || el > stalest) stalest = el;
      });
    });
    /* 「이 두 팀은 N%」 = 상위 2개 팀 안에서의 공백 비율 (전사 평균과 다른 값이다) */
    var top2Set = {}; top2.forEach(function (o) { top2Set[o] = 1; });
    var top2Total = rows.filter(function (m) { var e = empById(m.member_emp_id); return e && top2Set[e.org_id]; }).length;
    var top2Pct = top2Total ? r0(top2N / top2Total * 100) : null;
    var facts = { total: rows.length, badN: bad.length, badPct: badPct, top2Orgs: top2, top2N: top2N,
                  top2Total: top2Total, top2Pct: top2Pct, staleDays: stalest };
    var hit = rows.length > 0 && badPct != null && badPct >= thv(SID, 'TH-면담합의항목-공백비율', 50);
    var spec = {};
    spec[0] = { m: [['8개', s.unitN + '개'], ['21건', rows.length + '건']], emph: rows.length + '건', src: s.srcOrg + ' / meetingStore ' + rows.length + '건' };
    spec[1] = { m: [['21건', rows.length + '건'], ['14건', bad.length + '건']], emph: bad.length + '건',
                src: s.srcOrg + ' / agreements.status=overdue 포함 ' + bad.length + '건' };
    if (top2.length) spec[2] = { m: [['14건', top2N + '건'], ['두 팀', top2.length + '개 팀']], emph: top2N + '건',
                src: top2.join(' · ') + ' / meetingStore ' + top2N + '건' };
    if (badPct != null && top2Pct != null) spec[3] = { m: [['31%', badPct + '%'], ['67%', top2Pct + '%']], emph: top2Pct + '%',
                src: s.srcOrg + ' 전체 ' + rows.length + '건 / ' + top2.join(' · ') + ' ' + top2N + '/' + top2Total + '건' };
    if (stalest != null) spec[5] = { m: [['10일', stalest + '일']], emph: stalest + '일', src: s.srcOrg + ' / agreements.due' };
    return {
      hit: hit, facts: facts,
      notice: [['21건', rows.length + '건'], ['14건', bad.length + '건']],
      ev: spec,
      th: { 'TH-면담합의항목-공백비율': (badPct == null ? 0 : badPct) + '%', 'TH-면담합의항목-공백일': (stalest == null ? '?' : stalest) + '일' }
    };
  });

  /* ==================================================================
     HR경영진
  ================================================================== */

  /* --- 피드백-HR경영진-01 : 전사 면담 완료율 미달 -------------------------- */
  E.registerEval('피드백-HR경영진-01', function (ctx) {
    var SID = '피드백-HR경영진-01';
    var withManager = arr('employees').filter(function (e) { return !!e.manager_id; });
    var metIds = {};
    arr('meetingStore').forEach(function (m) { metIds[m.member_emp_id] = 1; });
    var doneN = withManager.filter(function (e) { return metIds[e.emp_id]; }).length;
    var rate = withManager.length ? r0(doneN / withManager.length * 100) : null;
    var byOrg = {};
    withManager.forEach(function (e) { (byOrg[e.org_id] = byOrg[e.org_id] || []).push(e.emp_id); });
    var zeroOrgs = [], minOrgRate = null;
    for (var o in byOrg) if (Object.prototype.hasOwnProperty.call(byOrg, o)) {
      if (!byOrg[o].some(function (id) { return metIds[id]; })) zeroOrgs.push(o);
      var oDone = byOrg[o].filter(function (id) { return metIds[id]; }).length;
      var oRate = r0(oDone / byOrg[o].length * 100);
      if (minOrgRate == null || oRate < minOrgRate) minOrgRate = oRate;
    }
    var per = periodOf('feedback');
    var due = per ? dateOnly(per.due) : null;
    var daysLeft = due ? Math.round((dnum(due) - asofMs()) / 86400000) : null;
    var evalTotal = arr('evaluations').length, orgTotal = arr('orgs').length;
    var cutoff = thv(SID, 'TH-전사면담완료율-미달', 70);
    var facts = {
      empN: evalTotal, orgN: orgTotal, totalTarget: withManager.length, doneN: doneN, rate: rate,
      zeroOrgN: zeroOrgs.length, dueDate: due, daysLeft: daysLeft
    };
    var hit = rate != null && rate < cutoff && zeroOrgs.length >= thv(SID, 'TH-면담0건조직-건수', 5);
    var spec = {};
    spec[0] = { m: [['221명', evalTotal + '명'], ['38개', orgTotal + '개']], emph: evalTotal + '명',
                src: 'evaluations ' + evalTotal + '건 / orgs ' + orgTotal + '곳' };
    if (rate != null) spec[1] = { m: [['5일', (daysLeft == null ? '?' : daysLeft) + '일'], ['23%', rate + '%']],
                emph: rate + '%', src: 'meetingStore / employees(manager_id 보유) ' + withManager.length + '명' };
    spec[2] = { m: [['7곳', zeroOrgs.length + '곳']], emph: zeroOrgs.length + '곳', src: '조직별 면담 0건 집계' };
    if (rate != null) spec[3] = { m: [['70%', cutoff + '%'], ['47%p', r0(cutoff - rate) + '%p']],
                emph: r0(cutoff - rate) + '%p', src: '제도 기준 완료율' };
    return {
      hit: hit, facts: facts,
      notice: [['5일', (daysLeft == null ? '?' : daysLeft) + '일'], ['23%', (rate == null ? '?' : rate) + '%'], ['7곳', zeroOrgs.length + '곳']],
      ev: spec,
      /* 두 완료율 모두 기준값을 되비추고 있었다 — 측정값 자리에는 실측 완료율을 넣는다 */
      th: { 'TH-전사면담완료율-미달': (rate == null ? '확인 불가' : rate + '%'),
            'TH-조직면담완료율-미달': (minOrgRate == null ? '확인 불가' : minOrgRate + '%'),
            'TH-면담0건조직-건수': zeroOrgs.length + '곳' }
    };
  });

  /* --- 피드백-HR경영진-09 : 낮은 등급인데 육성 계획 미등록 ------------------ */
  E.registerEval('피드백-HR경영진-09', function (ctx) {
    var SID = '피드백-HR경영진-09';
    var low = arr('evaluations').filter(function (e) { return e.grade === 'C' || e.grade === 'D'; });
    var dpByEmp = {}; arr('devPlan').forEach(function (p) { dpByEmp[p.emp_id] = p; });
    var missing = low.filter(function (e) { var p = dpByEmp[e.emp_id]; return !p || !p.registered; });
    var missPct = low.length ? r0(missing.length / low.length * 100) : null;
    var gradeCount = {}; arr('evaluations').forEach(function (e) { gradeCount[e.grade] = (gradeCount[e.grade] || 0) + 1; });
    /* 카탈로그 문장은 「등록된」 계획 수를 묻는다 — 미등록 수를 넣으면 뜻이 뒤집힌다 */
    var registeredN = low.length - missing.length;
    /* 결과 확정 시점 = 결과 피드백·면담 기간 개시일(제도상 확정 뒤 열린다) */
    var perF = periodOf('feedback');
    var fixedAt = perF ? dateOnly(perF.start) : null;
    var sinceFix = fixedAt ? Math.round((asofMs() - dnum(fixedAt)) / 86400000) : null;
    var limitD = thv(SID, 'TH-육성계획등록-기한', 14);
    var leftD = sinceFix == null ? null : limitD - sinceFix;
    var facts = { lowN: low.length, missingN: missing.length, registeredN: registeredN, missPct: missPct,
                  cN: gradeCount.C || 0, bN: gradeCount.B || 0, fixedAt: fixedAt, sinceFix: sinceFix, leftDays: leftD };
    var hit = missing.length >= 1 && missPct != null && missPct >= thv(SID, 'TH-육성계획미등록-비율', 50)
      && low.length >= thv(SID, 'TH-육성대상-최소인원', 3);
    var spec = {};
    spec[1] = { m: [['10일', (sinceFix == null ? '?' : sinceFix) + '일'], ['0건', registeredN + '건']], emph: registeredN + '건',
                src: '낮은 등급 ' + low.length + '명 / devPlan 등록 ' + registeredN + '명 · 미등록 ' + missing.length + '명' };
    spec[2] = { m: [['3명', facts.cN + '명'], ['99명', facts.bN + '명']], emph: facts.cN + '명', src: 'evaluations.grade 분포' };
    if (leftD != null) spec[3] = (leftD >= 0)
      ? { m: [['14일', limitD + '일'], ['4일', leftD + '일']], emph: leftD + '일', src: 'periods(feedback).start ' + fixedAt + ' + ' + limitD + '일' }
      : { m: [], text: '제도가 정한 계획 등록 기한은 결과 확정 뒤 ' + limitD + '일이라 기한이 ' + (-leftD) + '일 지났어요',
          emph: (-leftD) + '일', src: 'periods(feedback).start ' + fixedAt + ' + ' + limitD + '일', assumed: 0 };
    return {
      hit: hit, facts: facts,
      notice: [['10일째', (sinceFix == null ? '?' : sinceFix) + '일째'],
               ['등록 기한 4일 전인데', leftD == null ? '등록 기한 확인 전인데'
                 : (leftD >= 0 ? '등록 기한 ' + leftD + '일 전인데' : '등록 기한이 ' + (-leftD) + '일 지났는데')],
               ['0건', registeredN + '건']],
      ev: spec,
      th: { 'TH-육성계획등록-기한': (sinceFix == null ? '확인 불가' : sinceFix + '일 경과'),
            'TH-육성계획미등록-비율': (missPct == null ? 0 : missPct) + '%', 'TH-육성대상-최소인원': low.length + '명' }
    };
  });
})();
