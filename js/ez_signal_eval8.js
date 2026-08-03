/* js/ez_signal_eval8.js — 신호 판정 함수 (평가 단계 잔여 29건 · ez_signal_eval4.js 의 뒷부분)
   ------------------------------------------------------------------------
   ez_signal_eval4.js 가 평가 42건 중 11건을 맡았고, 이 파일이 아직 판정 함수가
   없던 나머지를 이어받는다. 같은 id 를 두 번 등록하지 않는다.

   지키는 규칙
     · 반환 스키마는 eval5 와 같다 — {hit, facts, notice, ev, th}
     · 기준값은 전부 카탈로그 `thresholds[].code` 를 thv() 로 읽는다. 코드를 새로 짓지 않는다
     · 평가 마감일은 periods.due 가 아니라 evalStatus.due_self / due_first / due_second 다
     · 원천에 없는 값은 만들지 않는다. 계산 못 한 근거 줄은 spec 에서 빼 두면
       엔진이 (추정)으로 표시한다 — 예시 숫자를 실측인 척 밀어 넣지 않는다

   ES5 IIFE · zero-dep. 엔진이 없으면 조용히 아무 것도 하지 않는다.
   ------------------------------------------------------------------------ */
(function () {
  'use strict';
  var E = window.EZSignalEngine;
  if (!E || !E.registerEval) return;

  var Hp = E.helpers || {};
  function arr(k) { return (Hp.arr ? Hp.arr(k) : []) || []; }
  function data() { return (Hp.data ? Hp.data() : window.TALENX_DATA) || {}; }
  var r0 = Hp.r0 || Math.round;
  var r1 = Hp.r1 || function (v) { return Math.round(v * 10) / 10; };
  var pn = Hp.pn || function (v) { var x = r1(v); return (x === Math.round(x)) ? String(Math.round(x)) : String(x); };
  var thv = Hp.thv || function (id, code, fb) { return fb; };
  var asofMs = Hp.asofMs || function () { return Date.parse('2026-07-16T00:00:00Z'); };
  var num = Hp.num || function (v) { var m = /(-?\d+(\.\d+)?)/.exec(String(v == null ? '' : v)); return m ? parseFloat(m[1]) : 0; };
  var avg = Hp.avg || function (l) { if (!l.length) return null; var s = 0, i; for (i = 0; i < l.length; i++) s += l[i]; return s / l.length; };

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function keys(o) { var out = [], k; for (k in o) if (has(o, k)) out.push(k); return out; }

  /* ---------- 공용 도구 (eval4·eval5 와 같은 규칙을 다시 만든다 — 엔진 파일은 고치지 않는다) ---------- */
  function dateOnly(s) { return s ? String(s).slice(0, 10) : null; }
  function dnum(s) { if (!s) return null; var t = Date.parse(String(s).slice(0, 10) + 'T00:00:00Z'); return isNaN(t) ? null : t; }
  function dayLeft(d) { var t = dnum(d); return t == null ? null : Math.round((t - asofMs()) / 86400000); }
  function elapsedDays(d) { var t = dnum(d); return t == null ? null : Math.round((asofMs() - t) / 86400000); }
  function empById(id) { var e = arr('employees'), i; for (i = 0; i < e.length; i++) if (e[i].emp_id === id) return e[i]; return null; }
  function empName(id) { var e = empById(id); return e ? e.name : id; }
  function orgById(id) { var o = arr('orgs'), i; for (i = 0; i < o.length; i++) if (o[i].org_id === id) return o[i]; return null; }
  function orgName(id) { var o = orgById(id); return o ? o.name : id; }
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
  function empIdsInOrgSet(set) {
    var out = {};
    arr('employees').forEach(function (e) { if (set[e.org_id]) out[e.emp_id] = 1; });
    return out;
  }
  /* manager_id 기준 직속 팀원 — tx_fix_appr.js:reportsOf 와 같은 원천 규칙 */
  function directReports(emp) { return arr('employees').filter(function (e) { return e.manager_id === emp.emp_id; }); }
  function statusIndex() { var m = {}; arr('evalStatus').forEach(function (s) { m[s.emp_id] = s; }); return m; }
  function evalIndex() { var m = {}; arr('evaluations').forEach(function (e) { m[e.emp_id] = e; }); return m; }
  function histIndex() { var m = {}; arr('evalHistory').forEach(function (h) { m[h.emp_id] = h.history || []; }); return m; }
  function mapIndex() { var m = {}; arr('evaluatorMap').forEach(function (x) { m[x.emp_id] = x; }); return m; }
  function policy() { return data().policy || {}; }

  /* 등급 순위 — 「두 단계 이동」 같은 판단에 쓴다 */
  var GRADE_RANK = { S: 5, A: 4, B: 3, C: 2, D: 1 };
  function rankOf(g) { return GRADE_RANK[g] || 0; }
  function isTop(g) { return g === 'S' || g === 'A'; }
  /* 역량 한국어 표기 — 엔진 COMP_KR 과 같은 표 (competencies[].name 은 영문이다) */
  var COMP_KR = { D1: '리더십', D2: '협업', D3: '직무 전문성', D4: '실행력', D5: '성장 마인드셋' };
  function compKr(id) { return COMP_KR[id] || id || ''; }

  function median(list) {
    if (!list.length) return null;
    var s = list.slice().sort(function (a, b) { return a - b; }), n = s.length;
    return (n % 2) ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }
  function ratio(a, b) { return b ? r0(a / b * 100) : null; }
  /* 「세 기간」·「두 단계」처럼 세는 말 앞에 붙는 자리는 한글 수사가 자연스럽다 */
  var KNUM = ['영', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열'];
  function kNum(n) { return (n >= 0 && n <= 10) ? KNUM[n] : String(n); }
  function len(s) { return String(s == null ? '' : s).length; }

  /* 근거 요약문이 몇 개 축을 인용했는가 — evaluations.rationale_summary 는
     「목표 달성 70/100, 피어리뷰 79/100, 실행 일관성 71/100 → 종합 73.3, B등급」 꼴이다 */
  function s0(v) { return String(v == null ? '' : v); }
  function citedAxes(rs) {
    var s = s0(rs), n = 0;
    if (/목표\s*달성/.test(s)) n++;
    if (/피어\s*리뷰|동료\s*리뷰/.test(s)) n++;
    if (/실행\s*일관성/.test(s)) n++;
    return n;
  }
  /* 등급 괴리를 「설명한」 문장이 있는가 — 점수 나열이 아니라 이유를 적은 어절이 있어야 한다 */
  var EXPLAIN_RE = /때문|대비|차이|반면|다만|낮은|높은|지연|보완|사유/;
  function explainSentences(rs) {
    var parts = s0(rs).split(/[.。\n]/), n = 0, i;
    for (i = 0; i < parts.length; i++) if (EXPLAIN_RE.test(parts[i])) n++;
    return n;
  }
  /* 근거 요약문이 담당 핵심결과의 실적을 인용했는가 — 핵심결과명이 문장에 들어 있는지로 본다 */
  function citesKrName(rs, krList) {
    var s = s0(rs), i, nm;
    for (i = 0; i < krList.length; i++) {
      nm = s0(krList[i].name);
      if (nm.length > 3 && s.indexOf(nm) >= 0) return true;
    }
    return false;
  }

  /* 전사 평가 집계 — 한 번 계산해 두고 쓴다 (evaluations 221건이라 부담은 없지만 반복 호출이 잦다) */
  var coCache = null;
  function coEval() {
    var evals = arr('evaluations');
    if (coCache && coCache.n === evals.length) return coCache;
    var dist = {}, scores = [], topN = 0;
    evals.forEach(function (e) {
      dist[e.grade] = (dist[e.grade] || 0) + 1;
      if (isTop(e.grade)) topN++;
      if (e.weighted_score != null) scores.push(e.weighted_score);
    });
    scores.sort(function (a, b) { return a - b; });
    var krs = arr('keyResults');
    coCache = {
      n: evals.length, dist: dist, topN: topN,
      topPct: evals.length ? r1(topN / evals.length * 100) : 0,
      min: scores[0] != null ? scores[0] : null,
      max: scores.length ? scores[scores.length - 1] : null,
      mean: scores.length ? r1(avg(scores)) : null,
      krAvg: krs.length ? r1(avg(krs.map(function (k) { return k.progress || 0; }))) : 0
    };
    return coCache;
  }

  /* 종합점수 산식 역산 — 세 요소 정규화 점수의 가중치를 5%씩 훑어 잔차가 가장 작은 조합을 찾는다.
     제도 안내문에 적힌 세 요소가 실제로 점수에 실려 있는지 확인하는 유일한 방법이다. */
  var wCache = null;
  function solveWeights() {
    var evals = arr('evaluations').filter(function (e) { return e.components && e.components.achievement_norm != null; });
    if (wCache && wCache.n === evals.length) return wCache;
    var best = null, a, p, x, i, s, diff, c;
    for (a = 0; a <= 100; a += 5) {
      for (p = 0; p + a <= 100; p += 5) {
        x = 100 - a - p;
        s = 0;
        for (i = 0; i < evals.length; i++) {
          c = evals[i].components;
          diff = (a * (c.achievement_norm || 0) + p * (c.peer_strength_norm || 0) + x * (c.exec_consistency_norm || 0)) / 100
                 - (evals[i].weighted_score || 0);
          s += diff < 0 ? -diff : diff;
        }
        s = evals.length ? s / evals.length : 0;
        if (!best || s < best.err) best = { ach: a, peer: p, exec: x, err: r1(s) };
      }
    }
    wCache = best || { ach: 0, peer: 0, exec: 0, err: 0 };
    wCache.n = evals.length;
    return wCache;
  }

  /* 등급 경계 역산 — 등급별 종합점수 최저값. 제도 문서(policy.grade_cutoff)와 대조한다 */
  function observedCutoff() {
    var m = {};
    arr('evaluations').forEach(function (e) {
      if (e.weighted_score == null) return;
      if (m[e.grade] == null || e.weighted_score < m[e.grade]) m[e.grade] = e.weighted_score;
    });
    return m;
  }

  /* 평가자별 담당 묶음 — evaluatorMap.first_evaluator 가 단일 원천 */
  function byEvaluator(empIdSet) {
    var out = {};
    arr('evaluatorMap').forEach(function (m) {
      if (!m.first_evaluator) return;
      if (empIdSet && !empIdSet[m.emp_id]) return;
      (out[m.first_evaluator] = out[m.first_evaluator] || []).push(m.emp_id);
    });
    return out;
  }
  /* 조직별 평가 묶음 — 대상자 소속 기준 */
  function evalsByOrg(minPop) {
    var EI = evalIndex(), byOrg = {};
    arr('employees').forEach(function (e) {
      var ev = EI[e.emp_id];
      if (!ev) return;
      (byOrg[e.org_id] = byOrg[e.org_id] || []).push(ev);
    });
    var rows = [];
    keys(byOrg).forEach(function (o) {
      var list = byOrg[o];
      if (list.length < minPop) return;
      var top = list.filter(function (e) { return isTop(e.grade); }).length;
      var dist = {}, domG = null;
      list.forEach(function (e) { dist[e.grade] = (dist[e.grade] || 0) + 1; });
      keys(dist).forEach(function (g) { if (!domG || dist[g] > dist[domG]) domG = g; });
      rows.push({
        org: o, name: orgName(o), n: list.length, list: list,
        topN: top, topPct: r1(top / list.length * 100),
        domGrade: domG, domN: domG ? dist[domG] : 0,
        domPct: domG ? r1(dist[domG] / list.length * 100) : 0,
        dist: dist
      });
    });
    return rows;
  }

  /* ==================================================================
     구성원
  ================================================================== */

  /* --- 평가-구성원-04 : 자기평가 달성 수준 vs 기록된 진척 어긋남 ---------- */
  E.registerEval('평가-구성원-04', function (ctx) {
    var SID = '평가-구성원-04';
    var se = arr('selfEval').filter(function (s) { return s.emp_id === ctx.emp.emp_id; })[0] || null;
    if (!se) return { hit: false, facts: {}, ev: {}, th: {} };
    var krIdx = {}; arr('keyResults').forEach(function (k) { krIdx[k.kr_id] = k; });
    /* selfEval.self_score 는 5점 척도다. 진척률(%)과 견주려면 같은 자로 바꿔야 해서 ×20 한다. */
    var rows = (se.items || []).map(function (it) {
      var k = krIdx[it.kr_id];
      if (!k) return null;
      var selfPct = r0((it.self_score || 0) * 20);
      return { it: it, kr: k, selfPct: selfPct, prog: k.progress || 0, gap: r0(selfPct - (k.progress || 0)) };
    }).filter(function (x) { return !!x; });
    if (!rows.length) return { hit: false, facts: {}, ev: {}, th: {} };
    var worst = rows.slice().sort(function (a, b) { return b.gap - a.gap; })[0];
    var TH = thv(SID, 'TH-자기평가-불일치', 30);
    var hit = worst.gap >= TH;
    /* 그 핵심결과의 체크인 추이 — 첫 기록과 마지막 기록의 진척 스냅숏 */
    var cks = arr('checkins').filter(function (c) { return c.kr_id === worst.kr.kr_id; })
      .sort(function (a, b) { return s0(a.checkin_date) < s0(b.checkin_date) ? -1 : 1; });
    var first = cks[0] || null, last = cks[cks.length - 1] || null;
    var mon = function (c) { var d = dateOnly(c && c.checkin_date); return d ? (+d.slice(5, 7)) + '월' : ''; };
    var facts = {
      krName: worst.kr.name, prog: worst.prog, selfPct: worst.selfPct, gap: worst.gap,
      weight: r0(num(worst.kr.weight)), itemN: rows.length, ckN: cks.length
    };
    var spec = {};
    spec[0] = { m: [['신규 기능 기획서 사용자 검증 통과율', worst.kr.name], ['54%', worst.prog + '%']],
                emph: worst.prog + '%', src: worst.kr.kr_id };
    spec[1] = { text: '자기평가에는 같은 항목이 ' + worst.selfPct + '% 수준으로 적혀 있어요',
                emph: worst.selfPct + '%', src: se.self_id + ' / selfEval.items.self_score' };
    spec[2] = { text: (worst.gap >= TH
                  ? '두 값의 차이는 ' + worst.gap + '%p로 확인 기준 ' + TH + '%p를 넘어요'
                  : '두 값의 차이는 ' + worst.gap + '%p로 확인 기준 ' + TH + '%p 안이에요'),
                emph: worst.gap + '%p', src: worst.kr.kr_id };
    if (first && last && first !== last) {
      spec[3] = { m: [['4월', mon(first)], ['32%', (first.progress_snapshot || 0) + '%'],
                      ['6월', mon(last)], ['54%', (last.progress_snapshot || 0) + '%'],
                      ['22%p', r0((last.progress_snapshot || 0) - (first.progress_snapshot || 0)) + '%p']],
                  emph: r0((last.progress_snapshot || 0) - (first.progress_snapshot || 0)) + '%p',
                  src: (first.checkin_id || '') + ' / ' + (last.checkin_id || '') };
    }
    spec[4] = { m: [['40%', facts.weight + '%']], emph: facts.weight + '%', src: worst.kr.kr_id };
    if (last && last.comment) spec[5] = { m: [['잔여 2건 진행 중', s0(last.comment).slice(0, 30)]],
                emph: s0(last.comment).slice(0, 30), src: last.checkin_id || 'checkins' };
    /* 자기평가가 더 낮게 적힌 경우 「초과 달성인데」는 사실과 어긋난다 — 문장 자체를 바꾼다 */
    var nMap = (worst.gap > 0)
      ? [['자기평가는 초과 달성인데 기록된 진척은 54%예요',
          '자기평가 ' + worst.selfPct + '% 수준인데 기록된 진척은 ' + worst.prog + '%예요']]
      : [['자기평가는 초과 달성인데 기록된 진척은 54%예요',
          '자기평가 ' + worst.selfPct + '%가 기록된 진척 ' + worst.prog + '%보다 낮아요']];
    return {
      hit: hit, facts: facts, notice: nMap, ev: spec,
      th: { 'TH-자기평가-불일치': worst.gap + '%p' }
    };
  });

  /* --- 평가-구성원-05 : 발령 뒤 1차 평가자 매핑 공백 ----------------------
     카탈로그 원문은 「이전 조직에서 보낸 기간 비중」을 판정에 쓴다. 그런데 소속 변경일이
     남는 원천이 없다(evaluatorMap.assigned_at 은 발령 건에서 전부 null). 그래서 이 판정은
     실제로 셀 수 있는 것 — 발령 뒤 평가자 매핑이 비었는지 — 만 본다.
     기간 비중을 말하는 근거 줄은 spec 에서 빼 두어 (추정)으로 남긴다. */
  E.registerEval('평가-구성원-05', function (ctx) {
    var SID = '평가-구성원-05';
    var mine = mapIndex()[ctx.emp.emp_id] || null;
    var moved = !!(mine && mine.source === 'missing');
    var noFirst = !!(mine && !mine.first_evaluator);
    var myCkN = ctx.myCks.length, myKrN = ctx.myKrs.length;
    var hit = moved && noFirst;
    var facts = {
      moved: moved, noEvaluator: noFirst, note: mine ? s0(mine.note) : '',
      myCkN: myCkN, myKrN: myKrN, orgName: ctx.emp.orgName || orgName(ctx.emp.org_id),
      periodRatio: null            /* 소속 변경일 원천이 없어 계산 불가 */
    };
    var spec = {};
    spec[0] = { text: moved
                  ? ('발령 뒤 평가자 매핑이 비어 있다고 「' + orgName(ctx.emp.org_id) + '」 기록에 남아 있어요')
                  : ('이번 평가 기간에 「' + orgName(ctx.emp.org_id) + '」 소속 변경 기록은 없어요'),
                emph: moved ? '발령 뒤' : '변경 없음',
                src: ctx.emp.emp_id + ' / evaluatorMap.source' };
    /* [1][2] 이전 조직 재직 비중 — 소속 변경일 원천 없음 → (추정) 유지 */
    spec[3] = { m: [['2건', myCkN + '건']], emph: myCkN + '건',
                src: 'checkins ' + myCkN + '건 / ' + ctx.emp.emp_id };
    spec[4] = { m: [['2건', myCkN + '건'], ['3건', myKrN + '건']], emph: '기록에 남아',
                src: 'checkins ' + myCkN + '건 / keyResults ' + myKrN + '건' };
    return {
      hit: hit, facts: facts,
      notice: [['평가 기간의 67%를 이전 조직에서 보내 1차 평가자가 바뀌었어요',
                moved ? '발령 뒤 1차 평가자 매핑이 아직 비어 있어요'
                      : '이번 기간 소속 변경으로 잡힌 평가자 공백은 없어요']],
      ev: spec,
      th: { 'TH-조직이동-기간비중': null }
    };
  });

  /* --- 평가-구성원-06 : 확정 근거 열림 + 의견 제출 기한 임박 --------------- */
  E.registerEval('평가-구성원-06', function (ctx) {
    var SID = '평가-구성원-06';
    var vs = statusIndex()[ctx.emp.emp_id] || null;
    var me = evalIndex()[ctx.emp.emp_id] || null;
    var confirmed = !!(vs && vs.second_confirmed_at);
    /* 「의견 제출 기한」 전용 필드는 없다. 2차 확정 마감(due_second)이 의견을 낼 수 있는
       마지막 날과 같은 자리라 그걸 읽는다 — periods.due 가 아니다. */
    var due = vs ? dateOnly(vs.due_second) : null;
    var dleft = dayLeft(due);
    /* 의견 제출 기록 = 평가 건에 붙은 요청 로그 중 내가 낸 것 */
    var opinions = arr('requestLog').filter(function (q) { return q.ref_kind === 'eval' && q.from_emp === ctx.emp.emp_id; }).length;
    var THday = thv(SID, 'TH-의견마감임박-구성원', 3);
    var THn = thv(SID, 'TH-의견-미제출', 0);
    var hit = confirmed && opinions <= THn && dleft != null && dleft >= 0 && dleft <= THday;
    var facts = {
      confirmed: confirmed, due: due, daysLeft: dleft, opinionN: opinions,
      score: me ? me.weighted_score : null, grade: me ? me.grade : '',
      ckN: ctx.myCks.length, krN: ctx.myKrs.length
    };
    var spec = {};
    if (due) spec[0] = { m: [['2026년 8월 20일', due], ['3일', dleft + '일']], emph: dleft + '일',
                src: 'evalStatus.due_second / ' + ctx.emp.emp_id };
    spec[1] = { text: (confirmed && me)
                  ? ('확정 근거 「' + s0(me.rationale_summary) + '」이 열려 있어요')
                  : (me ? ('평가 근거 「' + s0(me.rationale_summary) + '」이 아직 확정 전이에요')
                        : '확정된 평가 근거가 아직 없어요'),
                emph: me ? ('종합 ' + me.weighted_score) : '없어요',
                src: me ? me.evaluation_id : 'evaluations' };
    if (dleft != null && dleft === THday) spec[2] = { ok: 1, src: 'HR 평가 운영 기준(신설 예정)' };
    spec[3] = { m: [['체크인 2건', '체크인 ' + ctx.myCks.length + '건'],
                    ['핵심결과 진척 4건', '핵심결과 진척 ' + ctx.myKrs.length + '건']],
                emph: '체크인 ' + ctx.myCks.length + '건',
                src: 'checkins × keyResults (' + ctx.emp.emp_id + ')' };
    return {
      hit: hit, facts: facts,
      notice: dleft == null ? [] : [['3일', dleft + '일']],
      ev: spec,
      th: { 'TH-의견마감임박-구성원': (dleft == null ? null : dleft + '일'), 'TH-의견-미제출': opinions + '건' }
    };
  });

  /* --- 평가-구성원-08 : 난이도 최상위 핵심결과의 난이도 근거 공백 ---------- */
  E.registerEval('평가-구성원-08', function (ctx) {
    var SID = '평가-구성원-08';
    var DIFF_RANK = { S: 3, A: 2, B: 1, C: 0 };
    var krs = ctx.myKrs;
    if (!krs.length) return { hit: false, facts: {}, ev: {}, th: {} };
    /* 「난이도를 가장 높게 잡은」 = 내 핵심결과 안에서의 최상위 난이도 */
    var topDiff = null;
    krs.forEach(function (k) { if (topDiff == null || (DIFF_RANK[k.difficulty] || 0) > (DIFF_RANK[topDiff] || 0)) topDiff = k.difficulty; });
    var topKrs = krs.filter(function (k) { return k.difficulty === topDiff; });
    var missing = topKrs.filter(function (k) { return !k.difficulty_basis; });
    var wsum = 0; missing.forEach(function (k) { wsum += num(k.weight); });
    var all = arr('keyResults');
    var coMissing = all.filter(function (k) { return !k.difficulty_basis; }).length;
    /* 전사 근거 유형 분포 — 사람 말 라벨은 difficulty_basis.label 이 원천 */
    var typeN = {}, typeLabel = {};
    all.forEach(function (k) {
      var b = k.difficulty_basis;
      if (!b || !b.type) return;
      typeN[b.type] = (typeN[b.type] || 0) + 1;
      if (!typeLabel[b.type]) typeLabel[b.type] = s0(b.label).split('—')[0].replace(/\s+$/, '');
    });
    var withBasis = all.length - coMissing;
    var typeStr = keys(typeN).sort(function (a, b) { return typeN[b] - typeN[a]; }).map(function (t) {
      return typeLabel[t] + ' ' + typeN[t] + '건(' + pn(typeN[t] / (withBasis || 1) * 100) + '%)';
    }).join(', ');
    var THn = thv(SID, 'TH-난이도근거-미기재', 1);
    var hit = missing.length >= THn;
    var facts = {
      topDiff: topDiff, topN: topKrs.length, missingN: missing.length, wsum: r0(wsum),
      krTotal: all.length, coMissing: coMissing, typeStr: typeStr
    };
    var spec = {};
    spec[0] = { m: [['S', s0(topDiff)], ['2건', missing.length + '건']], emph: missing.length + '건',
                src: (missing.map(function (k) { return k.kr_id; }).join(' / ')
                      || topKrs.map(function (k) { return k.kr_id; }).join(' / ') || '해당 없음') };
    spec[1] = { m: [['146건', all.length + '건'], ['2건', coMissing + '건']], emph: coMissing + '건',
                src: 'keyResults.difficulty_basis' };
    if (typeStr) spec[2] = { text: '전사 근거 유형은 ' + typeStr + '이에요', emph: typeStr.split(',')[0],
                src: 'keyResults.difficulty_basis 집계 (' + withBasis + '건)' };
    spec[3] = { m: [['2건', missing.length + '건'], ['55%', r0(wsum) + '%']], emph: r0(wsum) + '%',
                src: missing.map(function (k) { return k.kr_id; }).join(' / ') || '해당 없음' };
    /* [4] 지난 기간 같은 항목의 난이도 근거 — 핵심결과 단위 과거 기록이 없어 (추정) 유지 */
    return {
      hit: hit, facts: facts,
      notice: missing.length
        ? [['S', s0(topDiff)], ['2건', missing.length + '건']]
        : [['난이도 S로 잡은 핵심결과 2건에 난이도 근거가 비어 있어요',
            '난이도 ' + s0(topDiff) + '로 잡은 핵심결과 ' + topKrs.length + '건에는 난이도 근거가 다 적혀 있어요']],
      ev: spec,
      th: { 'TH-난이도근거-미기재': missing.length + '건', 'TH-미기재가중치-합': r0(wsum) + '%' }
    };
  });

  /* --- 평가-구성원-09 : 지난 기간 리더 의견이 이번 자기평가에 없음 --------- */
  E.registerEval('평가-구성원-09', function (ctx) {
    var SID = '평가-구성원-09';
    var fbs = arr('feedbackHistory').filter(function (f) { return f.emp_id === ctx.emp.emp_id && f.source_type === 'leader'; });
    if (!fbs.length) return { hit: false, facts: {}, ev: {}, th: {} };
    var se = arr('selfEval').filter(function (s) { return s.emp_id === ctx.emp.emp_id; })[0] || null;
    var seText = se ? (se.items || []).map(function (it) { return s0(it.text); }).join(' ') : '';
    /* ponytail: 「반영됐는가」를 가릴 원천 표시가 없다. 의견 문장에서 핵심 낱말을 뽑아
       자기평가 서술에 그 낱말이 들어 있는지로 본다 — 낱말 단위의 거친 대조다.
       자기평가 항목에 「반영한 피드백」 참조가 생기면 그걸로 갈아탄다. */
    function phraseOf(f) { return s0(f.summary).split('—').pop().split('.')[0].replace(/^\s+|\s+$/g, ''); }
    function keyOf(f) { var p = phraseOf(f).replace(/^\s+/, ''); return p.split(/\s+/)[0] || ''; }
    var reflected = fbs.filter(function (f) { var k = keyOf(f); return k && seText.indexOf(k) >= 0; }).length;
    var miss = fbs.length - reflected;
    var THn = thv(SID, 'TH-지난의견-미반영', 1);
    var hit = !!se && miss >= THn;
    /* 내 핵심결과가 몰린 역량 — 그 의견과 닿는 항목이 있는지 보는 자리 */
    var dist = {}, dom = null;
    ctx.myKrs.forEach(function (k) { if (k.competency_id) dist[k.competency_id] = (dist[k.competency_id] || 0) + 1; });
    keys(dist).forEach(function (d) { if (!dom || dist[d] > dist[dom]) dom = d; });
    var f0 = fbs[0];
    var facts = {
      fbN: fbs.length, reflectedN: reflected, missN: miss, phrase: phraseOf(f0),
      krN: ctx.myKrs.length, domComp: dom ? compKr(dom) : '', period: s0(f0.period)
    };
    var spec = {};
    spec[0] = { m: [['협업 리드 경험을 늘려 달라', facts.phrase]],
                emph: reflected ? '서술이 있어요' : '서술이 없어요', src: f0.fb_id, asof: '2025-12-31' };
    spec[1] = { m: [['1건', fbs.length + '건'], ['0건', reflected + '건']], emph: reflected + '건',
                src: fbs.map(function (f) { return f.fb_id; }).join(' / ') };
    spec[2] = { m: [['4건', ctx.myKrs.length + '건'], ['실행력', facts.domComp || '미지정']],
                emph: reflected ? '닿는 항목이 있어요' : '닿는 항목이 없어요',
                src: ctx.myKrs.map(function (k) { return k.kr_id; }).join(' / ') || '핵심결과 없음' };
    spec[3] = { m: [['2025년', facts.period]], emph: facts.period, src: f0.fb_id, asof: '2025-12-31' };
    return {
      hit: hit, facts: facts,
      notice: [['1건', miss + '건']],
      ev: spec,
      th: { 'TH-지난의견-미반영': miss + '건' }
    };
  });

  /* ==================================================================
     팀장
  ================================================================== */

  /* 팀원별 체크인 건수 — 팀장 신호 여러 개가 같은 집계를 쓴다 */
  function ckCountBy() {
    var m = {};
    arr('checkins').forEach(function (c) { m[c.emp_id] = (m[c.emp_id] || 0) + 1; });
    return m;
  }
  /* 동료 리뷰 건수 — demoSubjects[*].peerReviews 가 유일한 원천이라 있는 사람만 센다 */
  function peerReviewCount(empId) {
    var ds = arr('demoSubjects').filter(function (d) { return d.emp_id === empId; })[0];
    return (ds && ds.peerReviews) ? ds.peerReviews.length : 0;
  }

  /* --- 평가-팀장-02 : 팀원 기록이 팀 평균에 크게 못 미침 ------------------ */
  E.registerEval('평가-팀장-02', function (ctx) {
    var SID = '평가-팀장-02';
    var team = directReports(ctx.emp);
    if (!team.length) return { hit: false, facts: {}, ev: {}, th: {} };
    var ck = ckCountBy();
    var counts = team.map(function (e) { return ck[e.emp_id] || 0; });
    var teamAvg = r1(avg(counts));
    var rows = team.map(function (e, i) { return { emp: e, n: counts[i] }; })
      .sort(function (a, b) { return a.n - b.n; });
    var target = rows[0];
    var pctOfAvg = teamAvg ? r0(target.n / teamAvg * 100) : null;
    var st = statusIndex()[target.emp.emp_id] || null;
    var dleft = dayLeft(st ? st.due_first : null);
    var prN = peerReviewCount(target.emp.emp_id);
    var THn = thv(SID, 'TH-근거건수-미달', 3);
    var THr = thv(SID, 'TH-팀평균비율-미달', 50);
    var THd = thv(SID, 'TH-마감임박-평가근거점검', 14);
    var hit = target.n <= THn && pctOfAvg != null && pctOfAvg <= THr
      && dleft != null && dleft <= THd;
    var facts = {
      teamN: team.length, targetName: target.emp.name, targetCk: target.n,
      teamAvg: teamAvg, pctOfAvg: pctOfAvg, peerReviewN: prN, daysLeft: dleft
    };
    var spec = {};
    spec[0] = { m: [['{{팀원명}}', target.emp.name], ['2건', target.n + '건']], emph: target.n + '건',
                src: target.emp.emp_id + ' / 체크인 ' + target.n + '건' };
    spec[1] = { text: '같은 팀 평균은 ' + teamAvg + '건으로 ' + target.emp.name + '님은 팀 평균의 '
                  + (pctOfAvg == null ? '?' : pctOfAvg) + '% 수준이에요',
                emph: teamAvg + '건',
                src: ctx.emp.org_id + ' / 팀 체크인 ' + counts.reduce(function (a, b) { return a + b; }, 0) + '건' };
    spec[2] = { m: [['14일', THd + '일'], ['0건', prN + '건']], emph: prN + '건',
                src: target.emp.emp_id + ' / 동료 리뷰 ' + prN + '건' };
    return {
      hit: hit, facts: facts,
      notice: [['{{팀원명}}', target.emp.name], ['2건', target.n + '건'], ['9건', teamAvg + '건']],
      ev: spec,
      th: { 'TH-근거건수-미달': target.n + '건', 'TH-팀평균비율-미달': (pctOfAvg == null ? '?' : pctOfAvg) + '%',
            'TH-마감임박-평가근거점검': (dleft == null ? null : dleft + '일') }
    };
  });

  /* --- 평가-팀장-03 : 등급 대비 달성률이 같은 등급 평균과 크게 벌어짐 ------ */
  E.registerEval('평가-팀장-03', function (ctx) {
    var SID = '평가-팀장-03';
    var team = directReports(ctx.emp);
    var EI = evalIndex();
    var rows = team.map(function (e) { return { emp: e, ev: EI[e.emp_id] }; }).filter(function (x) { return !!x.ev; });
    if (!rows.length) return { hit: false, facts: {}, ev: {}, th: {} };
    function ach(ev) { return (ev.components && ev.components.achievement_norm) || 0; }
    var byGrade = {};
    rows.forEach(function (x) { (byGrade[x.ev.grade] = byGrade[x.ev.grade] || []).push(x); });
    var MINPOP = thv(SID, 'TH-모집단-등급비교', 3);
    var THgap = thv(SID, 'TH-등급달성률괴리-초과', 20);
    var THex = thv(SID, 'TH-근거설명-없음', 0);
    /* 같은 등급 평균보다 가장 많이 아래로 벌어진 한 사람을 고른다.
       모집단이 얕은 등급도 근거는 실측으로 채우고, 모집단 기준은 hit 에서만 건다 —
       비교 인원이 모자란다고 카탈로그 예시 숫자를 화면에 흘리지 않기 위해서다. */
    var target = null, groupN = 0, groupAvg = null, gap = null;
    keys(byGrade).forEach(function (g) {
      var list = byGrade[g];
      var gAvg = r1(avg(list.map(function (x) { return ach(x.ev); })));
      list.forEach(function (x) {
        var d = r1(gAvg - ach(x.ev));
        if (gap == null || d > gap) { gap = d; target = x; groupN = list.length; groupAvg = gAvg; }
      });
    });
    if (!target) return { hit: false, facts: {}, ev: {}, th: {} };
    var rs = s0(target.ev.rationale_summary);
    var explainN = explainSentences(rs);
    var hit = groupN >= MINPOP && gap >= THgap && explainN <= THex;
    /* 전사 같은 등급 중 달성률 60% 미만 인원 */
    var coSame = arr('evaluations').filter(function (e) { return e.grade === target.ev.grade; });
    var coLow = coSame.filter(function (e) { return ach(e) < 60; }).length;
    /* 달성률이 낮은 항목의 장애요인 */
    var blockers = arr('checkins').filter(function (c) { return c.emp_id === target.emp.emp_id && c.blocker; });
    var hist = (histIndex()[target.emp.emp_id] || []);
    var prev = hist.length ? hist[hist.length - 1] : null;
    var peer = (target.ev.components && target.ev.components.peer_strength_norm) || 0;
    var facts = {
      targetName: target.emp.name, grade: target.ev.grade, ach: r1(ach(target.ev)),
      groupN: groupN, groupAvg: groupAvg, gap: gap, rsLen: len(rs), explainN: explainN,
      coSameN: coSame.length, coLowN: coLow, peer: r1(peer),
      blockerN: blockers.length, prevGrade: prev ? prev.grade : ''
    };
    var spec = {};
    spec[0] = { m: [['{{팀원명}}', target.emp.name], ['A', target.ev.grade], ['52%', pn(ach(target.ev)) + '%']],
                emph: pn(ach(target.ev)) + '%', src: target.emp.emp_id + ' / ' + target.ev.evaluation_id };
    spec[1] = { m: [['46자', len(rs) + '자'], ['없어요', explainN ? '있어요' : '없어요']], emph: len(rs) + '자',
                src: target.ev.evaluation_id + ' / 근거 요약문' };
    spec[2] = { m: [['A등급 4명', target.ev.grade + '등급 ' + groupN + '명'], ['84%', pn(groupAvg) + '%'],
                    ['32%p', pn(gap) + '%p']], emph: pn(gap) + '%p',
                src: ctx.emp.org_id + ' / ' + target.ev.grade + '등급 ' + groupN + '명' };
    spec[3] = { m: [['A등급 108명', target.ev.grade + '등급 ' + coSame.length + '명'], ['7명', coLow + '명']],
                emph: coLow + '명', src: '전사 평가 ' + arr('evaluations').length + '건' };
    spec[4] = { text: '두 축 정규화 점수는 목표 달성 ' + pn(ach(target.ev)) + ', 동료 리뷰 ' + pn(peer)
                  + '이라 등급을 끌어올린 축은 ' + (peer > ach(target.ev) ? '동료 리뷰' : '목표 달성') + '예요',
                emph: '동료 리뷰 ' + pn(peer), src: target.ev.evaluation_id + ' / components' };
    if (blockers.length) spec[5] = { m: [['2건', blockers.length + '건'],
                    ['외부 API 연동 이슈로 일정 지연', s0(blockers[0].blocker)]],
                emph: '「' + s0(blockers[0].blocker) + '」',
                src: blockers.map(function (c) { return c.checkin_id; }).slice(0, 2).join(', ') + ' / 막힌 지점' };
    if (prev) spec[6] = { m: [['A', prev.grade]], emph: prev.grade,
                src: target.emp.emp_id + ' / ' + prev.period, asof: '2025-12-31' };
    return {
      hit: hit, facts: facts,
      notice: [['{{팀원명}}', target.emp.name], ['A등급', target.ev.grade + '등급'],
               ['52%', pn(ach(target.ev)) + '%'], ['A등급', target.ev.grade + '등급'], ['84%', pn(groupAvg) + '%']],
      ev: spec,
      th: { 'TH-등급달성률괴리-초과': pn(gap) + '%p', 'TH-근거설명-없음': explainN + '건',
            'TH-모집단-등급비교': groupN + '명' }
    };
  });

  /* --- 평가-팀장-04 : 전입 팀원의 자체 근거 부족 --------------------------
     원문은 「이전 조직 소속 개월 수 ÷ 평가 대상 개월」로 판정한다. 소속 변경일이 남는
     원천이 없어(evaluatorMap.assigned_at 은 발령 건에서 null) 그 비율은 세지 못한다.
     대신 셀 수 있는 두 가지 — 발령 표시가 있는가, 전입 뒤 팀 체크인이 몇 건인가 — 로 본다. */
  E.registerEval('평가-팀장-04', function (ctx) {
    var SID = '평가-팀장-04';
    var team = directReports(ctx.emp);
    if (!team.length) return { hit: false, facts: {}, ev: {}, th: {} };
    var MI = mapIndex(), ck = ckCountBy();
    var moved = team.filter(function (e) { var m = MI[e.emp_id]; return m && m.source === 'missing'; });
    var counts = team.map(function (e) { return ck[e.emp_id] || 0; });
    var teamAvg = r1(avg(counts));
    var rows = moved.map(function (e) { return { emp: e, n: ck[e.emp_id] || 0 }; })
      .sort(function (a, b) { return a.n - b.n; });
    var target = rows[0] || null;
    var THck = thv(SID, 'TH-자체근거-미달', 3);
    var hit = !!target && target.n < THck;
    var facts = {
      teamN: team.length, movedN: moved.length,
      targetName: target ? target.emp.name : '', targetCk: target ? target.n : null,
      teamAvg: teamAvg, monthsBefore: null      /* 소속 변경일 원천 없음 */
    };
    var spec = {};
    if (target) spec[0] = { m: [['{{팀원명}}', target.emp.name], ['1건', target.n + '건']], emph: target.n + '건',
                src: target.emp.emp_id + ' / 체크인 ' + target.n + '건' };
    /* [1] 이전 조직 재직 개월 — 원천 없음 → (추정) 유지 */
    spec[2] = { m: [['9건', teamAvg + '건']], emph: teamAvg + '건',
                src: ctx.emp.org_id + ' / 팀 체크인 ' + counts.reduce(function (a, b) { return a + b; }, 0) + '건' };
    /* [3] 이전 조직 목표와 현 직무 과업 겹침 — 이전 조직 목표를 가릴 원천 없음 → (추정) 유지 */
    if (target) spec[4] = { text: '평가자 매핑에 「' + s0((MI[target.emp.emp_id] || {}).note) + '」로 남아 있어요',
                emph: '발령 뒤', src: target.emp.emp_id + ' / evaluatorMap.source' };
    if (target) {
      var h = histIndex()[target.emp.emp_id] || [];
      if (h.length >= 2) spec[5] = { m: [['B(63.7점)', h[h.length - 1].grade + '(' + h[h.length - 1].score + '점)'],
                    ['A(77.8점)', h[h.length - 2].grade + '(' + h[h.length - 2].score + '점)']],
                emph: h[h.length - 1].grade + '(' + h[h.length - 1].score + '점)',
                src: target.emp.emp_id + ' / evalHistory', asof: '2025-12-31' };
    }
    return {
      hit: hit, facts: facts,
      notice: [['{{팀원명}}님 평가 대상 6개월 중 4개월이 이전 조직 소속이에요',
                target ? (target.emp.name + '님은 발령 뒤 평가자 공백이고 체크인이 ' + target.n + '건이에요')
                       : '이번 기간 발령으로 평가자가 빈 팀원은 없어요']],
      ev: spec,
      th: { 'TH-전입기간-초과': null, 'TH-자체근거-미달': (target ? target.n : 0) + '건' }
    };
  });

  /* --- 평가-팀장-05 : 근거 요약문이 짧은 채로 정체 ------------------------ */
  E.registerEval('평가-팀장-05', function (ctx) {
    var SID = '평가-팀장-05';
    var team = directReports(ctx.emp);
    var EI = evalIndex(), ST = statusIndex();
    var rows = team.map(function (e) { return { emp: e, ev: EI[e.emp_id], st: ST[e.emp_id] }; })
      .filter(function (x) { return !!x.ev; });
    if (!rows.length) return { hit: false, facts: {}, ev: {}, th: {} };
    var lens = rows.map(function (x) { return len(x.ev.rationale_summary); });
    var teamAvgLen = r0(avg(lens));
    var sorted = rows.slice().sort(function (a, b) { return len(a.ev.rationale_summary) - len(b.ev.rationale_summary); });
    var target = sorted[0];
    var tLen = len(target.ev.rationale_summary);
    /* 「초안이 저장된 뒤」의 저장 시점 = 1차 평가 제출 시각. 아직 제출 전이면 셀 수 없다. */
    var savedAt = target.st ? target.st.first_submitted_at : null;
    var stale = elapsedDays(savedAt);
    var THlen = thv(SID, 'TH-근거분량-미달', 80);
    var THday = thv(SID, 'TH-초안정체-경과', 5);
    var hit = tLen < THlen && stale != null && stale >= THday;
    var facts = {
      teamN: team.length, savedN: rows.length, targetName: target.emp.name,
      rsLen: tLen, teamAvgLen: teamAvgLen, staleDays: stale, savedAt: dateOnly(savedAt)
    };
    var spec = {};
    spec[0] = { m: [['{{팀원명}}', target.emp.name], ['46자', tLen + '자']], emph: tLen + '자',
                src: target.emp.emp_id + ' / ' + target.ev.evaluation_id };
    spec[1] = { m: [['6건', rows.length + '건'], ['168자', teamAvgLen + '자']], emph: teamAvgLen + '자',
                src: ctx.emp.org_id + ' / 저장된 평가 ' + rows.length + '건' };
    if (stale != null) spec[2] = { m: [['5일', stale + '일']], emph: stale + '일',
                src: target.ev.evaluation_id + ' / evalStatus.first_submitted_at' };
    return {
      hit: hit, facts: facts,
      notice: (stale == null)
        ? [['{{팀원명}}님 평가 근거 요약문이 46자로 5일째 그대로예요',
            target.emp.name + '님 평가 근거 요약문이 ' + tLen + '자인데 1차 제출 전이에요']]
        : [['{{팀원명}}', target.emp.name], ['46자', tLen + '자'], ['5일째', stale + '일째']],
      ev: spec,
      th: { 'TH-근거분량-미달': tLen + '자', 'TH-초안정체-경과': (stale == null ? null : stale + '일') }
    };
  });

  /* --- 평가-팀장-07 : 같은 등급 반복 + 점수 하락 -------------------------- */
  E.registerEval('평가-팀장-07', function (ctx) {
    var SID = '평가-팀장-07';
    var team = directReports(ctx.emp);
    var EI = evalIndex(), HI = histIndex();
    var THrep = thv(SID, 'TH-등급반복-연속', 3);
    var THdrop = thv(SID, 'TH-점수하락-기간간', 5);
    /* 과거 이력 + 이번 평가를 이어 붙여 「연속 같은 등급」과 「그 사이 점수 변화」를 본다 */
    var rows = team.map(function (e) {
      var ev = EI[e.emp_id];
      if (!ev) return null;
      var seq = (HI[e.emp_id] || []).map(function (h) { return { period: h.period, grade: h.grade, score: h.score }; });
      seq.push({ period: ev.period, grade: ev.grade, score: ev.weighted_score });
      var run = 1, i;
      for (i = seq.length - 2; i >= 0; i--) { if (seq[i].grade === seq[seq.length - 1].grade) run++; else break; }
      var head = seq[seq.length - run], tail = seq[seq.length - 1];
      return { emp: e, seq: seq, run: run, drop: r1((head.score || 0) - (tail.score || 0)), grade: tail.grade };
    }).filter(function (x) { return !!x; });
    if (!rows.length) return { hit: false, facts: {}, ev: {}, th: {} };
    var cands = rows.filter(function (x) { return x.run >= THrep && x.drop >= THdrop; });
    var repeaters = rows.filter(function (x) { return x.run >= THrep; });
    var target = cands.sort(function (a, b) { return b.drop - a.drop; })[0] || null;
    var hit = !!target;
    var show = target || repeaters[0] || rows.slice().sort(function (a, b) { return b.run - a.run; })[0];
    var seq = show.seq;
    var facts = {
      teamN: team.length, targetName: show.emp.name, grade: show.grade, run: show.run,
      drop: show.drop, repeaterN: repeaters.length,
      scores: seq.map(function (s) { return s.score; })
    };
    var spec = {};
    spec[0] = { m: [['{{팀원명}}', show.emp.name], ['B등급', show.grade + '등급']], emph: show.grade + '등급',
                src: show.emp.emp_id + ' / evaluations' };
    spec[1] = { m: [['6.3점', pn(show.drop) + '점']], emph: pn(show.drop) + '점',
                src: show.emp.emp_id + ' / evalHistory · evaluations' };
    spec[2] = { m: [['{{팀원명}}', show.emp.name], ['한 사람', repeaters.length + '명']], emph: repeaters.length + '명',
                src: ctx.emp.org_id + ' / 팀원 ' + team.length + '명' };
    if (seq.length >= 3) spec[3] = { m: [['B', seq[seq.length - 3].grade],
                    ['67.1점', seq[seq.length - 3].score + '점'], ['60.8점', seq[seq.length - 2].score + '점']],
                emph: seq[seq.length - 2].score + '점', src: show.emp.emp_id + ' / evalHistory', asof: '2025-12-31' };
    return {
      hit: hit, facts: facts,
      notice: [['{{팀원명}}', show.emp.name], ['세 기간', kNum(show.run) + ' 기간'],
               ['B등급', show.grade + '등급'], ['6.3점', pn(show.drop) + '점']],
      ev: spec,
      th: { 'TH-등급반복-연속': show.run + '회', 'TH-점수하락-기간간': pn(show.drop) + '점' }
    };
  });

  /* --- 평가-팀장-08 : 두 축 중 한 축만 등급에 실림 ------------------------ */
  E.registerEval('평가-팀장-08', function (ctx) {
    var SID = '평가-팀장-08';
    var team = directReports(ctx.emp);
    var EI = evalIndex();
    var rows = team.map(function (e) {
      var ev = EI[e.emp_id];
      if (!ev || !ev.components) return null;
      return { emp: e, ev: ev, ach: ev.components.achievement_norm || 0, peer: ev.components.peer_strength_norm || 0 };
    }).filter(function (x) { return !!x; });
    if (!rows.length) return { hit: false, facts: {}, ev: {}, th: {} };
    var maxPeer = rows.slice().sort(function (a, b) { return b.peer - a.peer; })[0];
    var gap = r1(maxPeer.peer - maxPeer.ach);
    var cited = citedAxes(maxPeer.ev.rationale_summary);
    var THgap = thv(SID, 'TH-축간격차-초과', 25);
    var THax = thv(SID, 'TH-인용축-없음', 1);
    /* 동료 리뷰가 팀에서 가장 높은데 등급은 상위가 아니고, 두 축 격차가 기준을 넘을 때 */
    var hit = gap >= THgap && !isTop(maxPeer.ev.grade);
    var topRows = rows.filter(function (x) { return isTop(x.ev.grade); });
    var topPeerAvg = topRows.length ? r1(avg(topRows.map(function (x) { return x.peer; }))) : null;
    var hist = histIndex()[maxPeer.emp.emp_id] || [];
    var prev = hist.length ? hist[hist.length - 1] : null;
    var facts = {
      teamN: team.length, targetName: maxPeer.emp.name, peer: r1(maxPeer.peer), ach: r1(maxPeer.ach),
      grade: maxPeer.ev.grade, gap: gap, citedAxes: cited, rsLen: len(maxPeer.ev.rationale_summary),
      topGradeN: topRows.length, topPeerAvg: topPeerAvg
    };
    var spec = {};
    spec[0] = { m: [['{{팀원명}}', maxPeer.emp.name], ['88점', pn(maxPeer.peer) + '점'], ['B', maxPeer.ev.grade]],
                emph: pn(maxPeer.peer) + '점', src: maxPeer.emp.emp_id + ' / ' + maxPeer.ev.evaluation_id };
    spec[1] = { m: [['46자', len(maxPeer.ev.rationale_summary) + '자'],
                    ['인용한 문장이 없어요', cited >= 2 ? '인용한 문장이 있어요' : '인용한 문장이 없어요']],
                emph: cited + '축', src: maxPeer.ev.evaluation_id + ' / 근거 요약문' };
    spec[2] = { m: [['9명', rows.length + '명'], ['{{팀원명}}', maxPeer.emp.name]], emph: '가장 높은',
                src: ctx.emp.org_id + ' / 팀원 ' + team.length + '명' };
    if (topPeerAvg != null) spec[3] = { m: [['A등급 4명', '상위 등급 ' + topRows.length + '명'],
                    ['79점', pn(topPeerAvg) + '점'], ['9점', pn(maxPeer.peer - topPeerAvg) + '점']],
                emph: pn(topPeerAvg) + '점', src: ctx.emp.org_id + ' / 상위 등급 ' + topRows.length + '명' };
    var W = solveWeights();
    spec[4] = { m: [['반씩', W.ach + '% 대 ' + W.peer + '%']], emph: W.ach + '% 대 ' + W.peer + '%',
                calcm: [['50%', W.ach + '%'], ['50%', W.peer + '%']],
                src: '전사 평가 ' + W.n + '건 역산' };
    if (prev) spec[6] = { m: [['B', prev.grade]], emph: prev.grade,
                src: maxPeer.emp.emp_id + ' / evalHistory', asof: '2025-12-31' };
    return {
      hit: hit, facts: facts,
      notice: isTop(maxPeer.ev.grade)
        ? [['동료 리뷰 88점이 팀 9명 중 가장 높은데 등급은 B예요',
            '동료 리뷰 ' + pn(maxPeer.peer) + '점이 팀 ' + rows.length + '명 중 가장 높고 등급도 '
            + maxPeer.ev.grade + '예요']]
        : [['88점', pn(maxPeer.peer) + '점'], ['9명', rows.length + '명'], ['B', maxPeer.ev.grade]],
      ev: spec,
      th: { 'TH-축간격차-초과': pn(gap) + '점', 'TH-인용축-없음': cited + '축' }
    };
  });

  /* --- 평가-팀장-10 : 근거가 한 축만 인용한 채 정체 ----------------------- */
  E.registerEval('평가-팀장-10', function (ctx) {
    var SID = '평가-팀장-10';
    var team = directReports(ctx.emp);
    var EI = evalIndex(), ST = statusIndex();
    var rows = team.map(function (e) {
      var ev = EI[e.emp_id];
      if (!ev) return null;
      return { emp: e, ev: ev, st: ST[e.emp_id], axes: citedAxes(ev.rationale_summary) };
    }).filter(function (x) { return !!x; });
    if (!rows.length) return { hit: false, facts: {}, ev: {}, th: {} };
    var teamAvgAxes = r1(avg(rows.map(function (x) { return x.axes; })));
    var target = rows.slice().sort(function (a, b) { return a.axes - b.axes; })[0];
    var stale = elapsedDays(target.st ? target.st.first_submitted_at : null);
    var THax = thv(SID, 'TH-인용축-없음', 1);
    var THday = thv(SID, 'TH-초안정체-경과', 5);
    var hit = target.axes <= THax && stale != null && stale >= THday;
    var facts = {
      teamN: team.length, savedN: rows.length, targetName: target.emp.name,
      axes: target.axes, teamAvgAxes: teamAvgAxes, staleDays: stale
    };
    var spec = {};
    spec[0] = { m: [['{{팀원명}}', target.emp.name], ['한 축', target.axes + '개 축']], emph: target.axes + '개 축',
                src: target.emp.emp_id + ' / ' + target.ev.evaluation_id };
    spec[1] = { m: [['6건', rows.length + '건'], ['두 축', teamAvgAxes + '개 축']], emph: teamAvgAxes + '개 축',
                src: ctx.emp.org_id + ' / 저장된 평가 ' + rows.length + '건' };
    if (stale != null) spec[2] = { m: [['5일', stale + '일']], emph: stale + '일',
                src: target.ev.evaluation_id + ' / evalStatus.first_submitted_at' };
    return {
      hit: hit, facts: facts,
      notice: (stale == null)
        ? [['{{팀원명}}님 평가 근거가 달성률 한 축만 인용한 채 5일째예요',
            target.emp.name + '님 평가 근거는 ' + kNum(target.axes) + ' 축을 인용했고 1차 제출 전이에요']]
        : [['{{팀원명}}', target.emp.name], ['달성률 한 축', kNum(target.axes) + ' 축'], ['5일째', stale + '일째']],
      ev: spec,
      th: { 'TH-인용축-없음': target.axes + '축', 'TH-초안정체-경과': (stale == null ? null : stale + '일') }
    };
  });

  /* --- 평가-팀장-11 : 점수 연속 하락 + 최하 등급 + 개선 계획 공백 ---------- */
  E.registerEval('평가-팀장-11', function (ctx) {
    var SID = '평가-팀장-11';
    var team = directReports(ctx.emp);
    var EI = evalIndex(), HI = histIndex();
    var dp = {}; arr('devPlan').forEach(function (p) { dp[p.emp_id] = p; });
    var THdrop = thv(SID, 'TH-점수하락-2기간누적', 15);
    var THrun = thv(SID, 'TH-하락기간-연속', 2);
    var THplan = thv(SID, 'TH-개선계획-없음', 0);
    var rows = team.map(function (e) {
      var ev = EI[e.emp_id];
      if (!ev) return null;
      var seq = (HI[e.emp_id] || []).map(function (h) { return h.score; });
      seq.push(ev.weighted_score);
      var run = 0, i;
      for (i = seq.length - 1; i > 0; i--) { if (seq[i] < seq[i - 1]) run++; else break; }
      var cum = r1((seq[Math.max(0, seq.length - 1 - THrun)] || 0) - (seq[seq.length - 1] || 0));
      var plan = dp[e.emp_id];
      var planN = (plan && plan.registered) ? ((plan.items || []).length || 1) : 0;
      return { emp: e, ev: ev, seq: seq, run: run, cum: cum, planN: planN };
    }).filter(function (x) { return !!x; });
    if (!rows.length) return { hit: false, facts: {}, ev: {}, th: {} };
    var cands = rows.filter(function (x) {
      return x.cum >= THdrop && x.run >= THrun && x.planN <= THplan && rankOf(x.ev.grade) <= rankOf('C');
    });
    var target = cands.sort(function (a, b) { return b.cum - a.cum; })[0] || null;
    var show = target || rows.slice().sort(function (a, b) { return b.cum - a.cum; })[0];
    var hit = !!target;
    var C = coEval();
    var coC = arr('evaluations').filter(function (e) { return e.grade === show.ev.grade; }).length;
    var teamSame = rows.filter(function (x) { return x.ev.grade === show.ev.grade; }).length;
    var facts = {
      teamN: team.length, targetName: show.emp.name, score: show.ev.weighted_score, grade: show.ev.grade,
      run: show.run, cumDrop: show.cum, planN: show.planN,
      coSameN: coC, teamSameN: teamSame, coTotal: C.n, seq: show.seq
    };
    var spec = {};
    spec[0] = { m: [['{{팀원명}}', show.emp.name], ['56.5점', show.ev.weighted_score + '점'], ['C등급', show.ev.grade + '등급']],
                emph: show.ev.weighted_score + '점', src: show.emp.emp_id + ' / ' + show.ev.evaluation_id };
    spec[1] = { m: [['0건', show.planN + '건']], emph: show.planN + '건',
                src: show.emp.emp_id + ' / devPlan.registered' };
    spec[2] = { m: [['221명', C.n + '명'], ['C등급은 3명', show.ev.grade + '등급은 ' + coC + '명'],
                    ['{{팀원명}}', show.emp.name], ['한 사람', teamSame + '명']], emph: coC + '명',
                src: '전사 평가 ' + C.n + '건' };
    spec[3] = { m: [['21.3점', pn(show.cum) + '점'], ['15점', THdrop + '점']], emph: pn(show.cum) + '점',
                src: show.emp.emp_id + ' / evalHistory · evaluations' };
    if (show.seq.length >= 3) spec[4] = { m: [['77.8점', show.seq[show.seq.length - 3] + '점'],
                    ['63.7점', show.seq[show.seq.length - 2] + '점'],
                    ['56.5점', show.seq[show.seq.length - 1] + '점'],
                    ['두 기간 연속', show.run + '기간 연속']], emph: show.run + '기간 연속',
                src: show.emp.emp_id + ' / evalHistory' };
    return {
      hit: hit, facts: facts,
      notice: [['{{팀원명}}', show.emp.name], ['21.3점', pn(show.cum) + '점'], ['C등급', show.ev.grade + '등급']],
      ev: spec,
      th: { 'TH-점수하락-2기간누적': pn(show.cum) + '점', 'TH-하락기간-연속': show.run + '회',
            'TH-개선계획-없음': show.planN + '건' }
    };
  });

  /* ==================================================================
     상위조직장 — ctx.scope(상위 조직 관점)를 기준 범위로 쓴다
  ================================================================== */

  function scopeEmpSet(s) { return empIdsInOrgSet(subtreeIds(s.scopeOrg.org_id)); }

  /* --- 평가-상위조직장-02 : 한 평가자의 근거 문장이 기준 길이 미달 --------- */
  E.registerEval('평가-상위조직장-02', function (ctx) {
    var SID = '평가-상위조직장-02';
    var s = ctx.scope;
    if (!s) return { hit: false, facts: {}, ev: {}, th: {} };
    var set = scopeEmpSet(s), EI = evalIndex();
    var groups = byEvaluator(set);
    var THlen = thv(SID, 'TH-평가근거-최소길이', 40);
    var THpct = thv(SID, 'TH-평가근거-부족비율', 30);
    var rows = keys(groups).map(function (ev) {
      var list = groups[ev].map(function (id) { return EI[id]; }).filter(function (x) { return !!x; });
      if (!list.length) return null;
      var short = list.filter(function (e) { return len(e.rationale_summary) < THlen; });
      var noCite = short.filter(function (e) { return citedAxes(e.rationale_summary) === 0; }).length;
      return {
        evaluator: ev, n: list.length, shortN: short.length, noCiteN: noCite,
        pct: r0(short.length / list.length * 100),
        avgLen: r0(avg(list.map(function (e) { return len(e.rationale_summary); })))
      };
    }).filter(function (x) { return !!x; });
    if (!rows.length) return { hit: false, facts: {}, ev: {}, th: {} };
    var worst = rows.slice().sort(function (a, b) { return b.pct - a.pct || b.n - a.n; })[0];
    /* 내 조직 전체 근거 길이 평균 — 이 평가자와 견주는 기준선 */
    var scopeEvals = [];
    keys(set).forEach(function (id) { if (EI[id]) scopeEvals.push(EI[id]); });
    var scopeAvgLen = scopeEvals.length ? r0(avg(scopeEvals.map(function (e) { return len(e.rationale_summary); }))) : null;
    var hit = worst.shortN >= 1 && worst.pct >= THpct;
    var facts = {
      evaluatorN: rows.length, targetN: worst.n, shortN: worst.shortN, pct: worst.pct,
      noCiteN: worst.noCiteN, evalAvgLen: worst.avgLen, scopeAvgLen: scopeAvgLen, scopeN: scopeEvals.length
    };
    var spec = {};
    spec[0] = { m: [['11건', worst.n + '건']], emph: worst.n + '건',
                src: s.srcOrgIncl + ' / 1차 평가자 ' + rows.length + '명 중 최다 ' + worst.n + '건' };
    spec[1] = { m: [['11건', worst.n + '건'], ['8건', worst.shortN + '건']], emph: worst.shortN + '건',
                src: '1차 평가자 담당 ' + worst.n + '건 / 근거 ' + THlen + '자 미만 ' + worst.shortN + '건' };
    spec[2] = { m: [['여덟 건', worst.shortN + '건'], ['0건', worst.noCiteN + '건']], emph: worst.noCiteN + '건',
                src: '근거 짧은 ' + worst.shortN + '건 / 축 인용 0건 ' + worst.noCiteN + '건' };
    if (scopeAvgLen != null) spec[3] = { m: [['180자', scopeAvgLen + '자'], ['34자', worst.avgLen + '자']],
                emph: scopeAvgLen + '자', src: s.srcOrgIncl + ' / 평가 ' + scopeEvals.length + '건' };
    spec[4] = { m: [['73%', worst.pct + '%'], ['30%', THpct + '%']], emph: worst.pct + '%',
                src: '1차 평가자 담당 ' + worst.n + '건' };
    /* [5] 지난 사이클 평균 근거 길이 — evalHistory 에 근거 문장이 없어 (추정) 유지 */
    return {
      hit: hit, facts: facts,
      notice: worst.shortN
        ? [['11건', worst.n + '건'], ['8건', worst.shortN + '건'], ['40자', THlen + '자']]
        : [['한 평가자가 제출한 평가 11건 중 8건의 근거가 40자 미만이에요',
            '가장 많이 맡은 평가자의 평가 ' + worst.n + '건은 근거가 모두 ' + THlen + '자를 넘어요']],
      ev: spec,
      th: { 'TH-평가근거-최소길이': worst.avgLen + '자', 'TH-평가근거-부족비율': worst.pct + '%' }
    };
  });

  /* --- 평가-상위조직장-03 : 한 평가자의 상위 등급 비중이 전사보다 높음 ----- */
  E.registerEval('평가-상위조직장-03', function (ctx) {
    var SID = '평가-상위조직장-03';
    var s = ctx.scope;
    if (!s) return { hit: false, facts: {}, ev: {}, th: {} };
    var set = scopeEmpSet(s), EI = evalIndex(), HI = histIndex();
    var groups = byEvaluator(set);
    var MINPOP = thv(SID, 'TH-등급편중-모수', 8);
    var THloose = thv(SID, 'TH-등급편중-관대', 15);
    var THconc = thv(SID, 'TH-등급편중-중심화', 65);
    var C = coEval();
    var rows = keys(groups).map(function (ev) {
      var ids = groups[ev];
      var list = ids.map(function (id) { return EI[id]; }).filter(function (x) { return !!x; });
      if (list.length < MINPOP) return null;
      var dist = {}, domG = null;
      list.forEach(function (e) { dist[e.grade] = (dist[e.grade] || 0) + 1; });
      keys(dist).forEach(function (g) { if (!domG || dist[g] > dist[domG]) domG = g; });
      var top = list.filter(function (e) { return isTop(e.grade); }).length;
      return {
        evaluator: ev, ids: ids, n: list.length, dist: dist, topN: top,
        topPct: r1(top / list.length * 100), domGrade: domG,
        domPct: r1(dist[domG] / list.length * 100)
      };
    }).filter(function (x) { return !!x; });
    if (!rows.length) return { hit: false, facts: { reason: '모수 미달' }, ev: {}, th: {} };
    var worst = rows.slice().sort(function (a, b) { return b.topPct - a.topPct; })[0];
    var diff = r1(worst.topPct - C.topPct);
    var hit = diff >= THloose || worst.domPct >= THconc;
    /* 하위 팀 평균 상위 등급 비율 */
    var unitPcts = s.units.map(function (u) {
      var ids = empIdsInOrgSet(subtreeIds(u.org)), list = [];
      keys(ids).forEach(function (id) { if (EI[id]) list.push(EI[id]); });
      if (!list.length) return null;
      return r1(list.filter(function (e) { return isTop(e.grade); }).length / list.length * 100);
    }).filter(function (x) { return x != null; });
    var unitAvg = unitPcts.length ? r1(avg(unitPcts)) : null;
    /* 같은 평가자 담당의 지난 두 사이클 상위 등급 비율 */
    var pastPct = {};
    worst.ids.forEach(function (id) {
      (HI[id] || []).forEach(function (h) {
        var b = pastPct[h.period] = pastPct[h.period] || { n: 0, top: 0 };
        b.n++; if (isTop(h.grade)) b.top++;
      });
    });
    var pastStr = keys(pastPct).sort().map(function (p) { return pn(pastPct[p].top / pastPct[p].n * 100) + '%'; }).join('와 ');
    var facts = {
      evaluatorN: rows.length, targetN: worst.n, topN: worst.topN, topPct: worst.topPct,
      domGrade: worst.domGrade, domPct: worst.domPct, coTopPct: C.topPct, diff: diff,
      unitAvg: unitAvg, pastStr: pastStr
    };
    var spec = {};
    spec[0] = { m: [['11명', worst.n + '명']], emph: worst.n + '명',
                src: s.srcOrgIncl + ' / 1차 평가자 담당 ' + worst.n + '건' };
    spec[1] = { m: [['9건', worst.topN + '건'], ['82%', pn(worst.topPct) + '%']], emph: pn(worst.topPct) + '%',
                src: '1차 평가자 담당 ' + worst.n + '건' };
    spec[2] = { m: [['B는 2건', 'B는 ' + (worst.dist.B || 0) + '건'], ['C는 0건', 'C는 ' + (worst.dist.C || 0) + '건']],
                emph: (worst.dist.C || 0) + '건', src: '1차 평가자 담당 ' + worst.n + '건' };
    spec[3] = { m: [['221명', C.n + '명'], ['54%', pn(C.topPct) + '%']], emph: pn(C.topPct) + '%',
                calcm: [['S 11명', 'S ' + (C.dist.S || 0) + '명'], ['A 108명', 'A ' + (C.dist.A || 0) + '명'],
                        ['221명', C.n + '명']],
                src: 'evaluations ' + C.n + '건' };
    if (unitAvg != null) spec[4] = { m: [['8개 팀', s.unitN + '개 팀'], ['41%', pn(unitAvg) + '%'],
                    ['41%p', pn(worst.topPct - unitAvg) + '%p']], emph: pn(worst.topPct - unitAvg) + '%p',
                src: s.srcOrg + ' / evaluations' };
    if (pastStr) spec[5] = { m: [['48%와 55%', pastStr]], emph: pastStr, src: 'evalHistory', asof: '2025-12-31' };
    return {
      hit: hit, facts: facts,
      notice: [['82%', pn(worst.topPct) + '%'], ['54%', pn(C.topPct) + '%']],
      ev: spec,
      th: { 'TH-등급편중-관대': pn(diff) + '%p', 'TH-등급편중-중심화': pn(worst.domPct) + '%',
            'TH-등급편중-모수': worst.n + '명' }
    };
  });

  /* --- 평가-상위조직장-04 : 상위 등급인데 점수가 조직 평균보다 낮음 -------- */
  E.registerEval('평가-상위조직장-04', function (ctx) {
    var SID = '평가-상위조직장-04';
    var s = ctx.scope;
    if (!s) return { hit: false, facts: {}, ev: {}, th: {} };
    var set = scopeEmpSet(s), EI = evalIndex();
    var scopeEvals = [];
    keys(set).forEach(function (id) { if (EI[id]) scopeEvals.push(EI[id]); });
    if (!scopeEvals.length) return { hit: false, facts: {}, ev: {}, th: {} };
    function ach(e) { return (e.components && e.components.achievement_norm) || 0; }
    var scopeMedian = median(scopeEvals.map(ach));
    var scopeAvgScore = r1(avg(scopeEvals.map(function (e) { return e.weighted_score || 0; })));
    /* 상위 등급인데 목표 달성 점수가 조직 중위값 아래인 건 */
    var bad = scopeEvals.filter(function (e) { return isTop(e.grade) && ach(e) < scopeMedian; });
    var badAvg = bad.length ? r1(avg(bad.map(function (e) { return e.weighted_score || 0; }))) : null;
    var diff = badAvg == null ? null : r1(scopeAvgScore - badAvg);
    var THn = thv(SID, 'TH-등급점수괴리-건수', 3);
    var THs = thv(SID, 'TH-등급점수괴리-점수차', 10);
    var hit = bad.length >= THn && diff != null && diff >= THs;
    /* 점수가 더 높은데 아래 등급에 머문 사람 */
    var badMax = bad.length ? Math.max.apply(null, bad.map(function (e) { return e.weighted_score || 0; })) : 0;
    var overlooked = scopeEvals.filter(function (e) { return !isTop(e.grade) && (e.weighted_score || 0) > badMax; }).length;
    var cut = observedCutoff();
    var cutStr = ['S', 'A', 'B', 'C'].filter(function (g) { return cut[g] != null; })
      .map(function (g) { return g + ' ' + pn(cut[g]) + '점'; }).join(' · ');
    var underS = bad.filter(function (e) { return cut.S != null && (e.weighted_score || 0) < cut.S; }).length;
    var facts = {
      scopeN: scopeEvals.length, badN: bad.length, badAvg: badAvg, scopeAvg: scopeAvgScore,
      diff: diff, median: scopeMedian == null ? null : r1(scopeMedian),
      overlookedN: overlooked, cutStr: cutStr, underCutN: underS
    };
    var spec = {};
    spec[0] = { m: [['11건', scopeEvals.length + '건']], emph: scopeEvals.length + '건',
                src: s.srcOrgIncl + ' / evaluations ' + scopeEvals.length + '건' };
    spec[1] = { m: [['S등급 3건', '상위 등급 ' + bad.length + '건']], emph: bad.length + '건',
                src: s.scopeOrg.org_id + ' / 목표 달성 중위값 ' + pn(scopeMedian) + '점 미만' };
    if (badAvg != null) spec[2] = { m: [['62.4점', pn(badAvg) + '점'], ['76.4점', pn(scopeAvgScore) + '점'],
                    ['14점', pn(diff) + '점']], emph: pn(badAvg) + '점',
                src: s.scopeOrg.org_id + ' / 대상 ' + bad.length + '건 · 전체 ' + scopeEvals.length + '건' };
    spec[3] = { m: [['5명', overlooked + '명']], emph: overlooked + '명',
                src: s.srcOrgIncl + ' / evaluations ' + scopeEvals.length + '건' };
    if (cutStr) spec[4] = { m: [['221건', coEval().n + '건']], emph: '추정값',
                calcm: [['S 86.0점 · A 75.0점 · B 62.0점 · C 59.4점', cutStr]],
                src: 'evaluations ' + coEval().n + '건 / 등급별 최저 종합점수' };
    if (cut.S != null) spec[5] = { m: [['세 건', bad.length + '건'], ['86.0점', pn(cut.S) + '점']],
                emph: pn(cut.S) + '점', src: s.scopeOrg.org_id + ' / 대상 ' + bad.length + '건' };
    return {
      hit: hit, facts: facts,
      notice: bad.length
        ? [['S등급 3건', '상위 등급 ' + bad.length + '건'], ['14점', pn(diff) + '점']]
        : [['S등급 3건의 종합점수가 조직 평균보다 14점 낮아요',
            '상위 등급 가운데 목표 달성 점수가 조직 중위값 아래인 건은 없어요']],
      ev: spec,
      th: { 'TH-등급점수괴리-건수': bad.length + '건',
            'TH-등급점수괴리-점수차': (diff == null ? null : pn(diff) + '점') }
    };
  });

  /* --- 평가-상위조직장-06 : 한 팀의 상위 등급 비중이 전사보다 낮음 --------- */
  E.registerEval('평가-상위조직장-06', function (ctx) {
    var SID = '평가-상위조직장-06';
    var s = ctx.scope;
    if (!s) return { hit: false, facts: {}, ev: {}, th: {} };
    var EI = evalIndex();
    var MINPOP = thv(SID, 'TH-등급편중-모수', 8);
    var TH = thv(SID, 'TH-등급편중-엄격', 15);
    var C = coEval();
    var rows = s.units.map(function (u) {
      var ids = empIdsInOrgSet(subtreeIds(u.org)), list = [];
      keys(ids).forEach(function (id) { if (EI[id]) list.push(EI[id]); });
      if (list.length < MINPOP) return null;
      var dist = {};
      list.forEach(function (e) { dist[e.grade] = (dist[e.grade] || 0) + 1; });
      var top = list.filter(function (e) { return isTop(e.grade); }).length;
      return { org: u.org, name: u.name, n: list.length, topN: top, topPct: r1(top / list.length * 100), dist: dist };
    }).filter(function (x) { return !!x; });
    if (!rows.length) return { hit: false, facts: { reason: '모수 미달' }, ev: {}, th: {} };
    var lo = rows.slice().sort(function (a, b) { return a.topPct - b.topPct; })[0];
    var gap = r1(C.topPct - lo.topPct);
    var hit = gap >= TH;
    var domG = null;
    keys(lo.dist).forEach(function (g) { if (!domG || lo.dist[g] > lo.dist[domG]) domG = g; });
    var facts = {
      teamName: lo.name, teamOrg: lo.org, n: lo.n, topN: lo.topN, topPct: lo.topPct,
      domGrade: domG, domN: lo.dist[domG], domPct: r1(lo.dist[domG] / lo.n * 100),
      coTopPct: C.topPct, gap: gap, unitN: rows.length
    };
    var spec = {};
    spec[0] = { m: [['10명', lo.n + '명']], emph: lo.n + '명', src: lo.org + ' / evaluations ' + lo.n + '건' };
    spec[1] = { m: [['10명', lo.n + '명'], ['3명', lo.topN + '명'], ['30%', pn(lo.topPct) + '%']],
                emph: pn(lo.topPct) + '%', src: lo.org + ' / evaluations ' + lo.n + '건' };
    spec[2] = { m: [['B등급이 7명', domG + '등급이 ' + lo.dist[domG] + '명'],
                    ['70%', pn(lo.dist[domG] / lo.n * 100) + '%']], emph: lo.dist[domG] + '명',
                src: lo.org + ' / evaluations ' + lo.n + '건' };
    spec[3] = { m: [['221명', C.n + '명'], ['54%', pn(C.topPct) + '%'], ['24%p', pn(gap) + '%p']],
                emph: pn(gap) + '%p',
                calcm: [['S 11명', 'S ' + (C.dist.S || 0) + '명'], ['A 108명', 'A ' + (C.dist.A || 0) + '명'],
                        ['221명', C.n + '명']],
                src: 'evaluations ' + C.n + '건' };
    return {
      hit: hit, facts: facts,
      notice: [['10명', lo.n + '명'], ['3명', lo.topN + '명'], ['24%p', pn(gap) + '%p']],
      ev: spec,
      th: { 'TH-등급편중-엄격': pn(gap) + '%p', 'TH-등급편중-모수': lo.n + '명' }
    };
  });

  /* --- 평가-상위조직장-07 : 한 팀에서 등급이 여러 단계 움직인 사람이 많음 -- */
  E.registerEval('평가-상위조직장-07', function (ctx) {
    var SID = '평가-상위조직장-07';
    var s = ctx.scope;
    if (!s) return { hit: false, facts: {}, ev: {}, th: {} };
    var EI = evalIndex(), HI = histIndex();
    var THstep = thv(SID, 'TH-등급이동-단계폭', 2);
    var THpct = thv(SID, 'TH-등급이동-팀비율', 25);
    function lastHist(id) { var h = HI[id] || []; return h.length ? h[h.length - 1] : null; }
    var rows = s.units.map(function (u) {
      var ids = empIdsInOrgSet(subtreeIds(u.org)), pop = [], moved = [];
      keys(ids).forEach(function (id) {
        var ev = EI[id], h = lastHist(id);
        if (!ev || !h) return;
        pop.push(id);
        var step = Math.abs(rankOf(ev.grade) - rankOf(h.grade));
        if (step >= THstep) moved.push({ id: id, step: step });
      });
      if (!pop.length) return null;
      return { org: u.org, name: u.name, n: pop.length, movedN: moved.length,
               pct: r1(moved.length / pop.length * 100), moved: moved };
    }).filter(function (x) { return !!x; });
    if (!rows.length) return { hit: false, facts: {}, ev: {}, th: {} };
    var worst = rows.slice().sort(function (a, b) { return b.pct - a.pct || b.movedN - a.movedN; })[0];
    var hit = worst.movedN >= 1 && worst.pct >= THpct;
    /* 전사 비교 — 과거 이력이 남은 사람 기준 */
    var coPop = 0, coMoved = 0, maxUp = 0, maxDown = 0;
    arr('evalHistory').forEach(function (h) {
      var ev = EI[h.emp_id], last = (h.history || [])[(h.history || []).length - 1];
      if (!ev || !last) return;
      coPop++;
      if (Math.abs(rankOf(ev.grade) - rankOf(last.grade)) >= THstep) coMoved++;
      var d = r1((ev.weighted_score || 0) - (last.score || 0));
      if (d > maxUp) maxUp = d;
      if (-d > maxDown) maxDown = r1(-d);
    });
    /* 대상자들이 같은 1차 평가자에게 묶여 있는가 */
    var MI = mapIndex(), evs = {};
    worst.moved.forEach(function (m) { var x = MI[m.id]; if (x && x.first_evaluator) evs[x.first_evaluator] = 1; });
    var facts = {
      teamName: worst.name, n: worst.n, movedN: worst.movedN, pct: worst.pct,
      sameEvaluator: keys(evs).length === 1, evaluatorN: keys(evs).length,
      coPop: coPop, coMoved: coMoved, coPct: coPop ? r1(coMoved / coPop * 100) : null,
      maxUp: maxUp, maxDown: maxDown
    };
    var spec = {};
    spec[0] = { m: [['11명', worst.n + '명']], emph: worst.n + '명',
                src: worst.org + ' / evalHistory · evaluations ' + worst.n + '건' };
    spec[1] = { m: [['두 단계', THstep + '단계'], ['4명', worst.movedN + '명']], emph: worst.movedN + '명',
                src: worst.org + ' / evalHistory · evaluations' };
    spec[2] = { m: [['네 건', worst.movedN + '건'],
                    ['같은 1차 평가자가 매긴 등급이에요',
                     facts.sameEvaluator ? '같은 1차 평가자가 매긴 등급이에요'
                                         : ('1차 평가자 ' + keys(evs).length + '명에게 나뉘어 있어요')]],
                emph: facts.sameEvaluator ? '같은 1차 평가자' : (keys(evs).length + '명'),
                src: worst.org + ' / evaluatorMap.first_evaluator' };
    spec[3] = { m: [['204명', coPop + '명'], ['10명', coMoved + '명'], ['5%', pn(facts.coPct) + '%']],
                emph: pn(facts.coPct) + '%', src: 'evalHistory ' + coPop + '건 / evaluations' };
    spec[5] = { m: [['20.9점', pn(maxUp) + '점'], ['21.3점', pn(maxDown) + '점']], emph: pn(maxUp) + '점',
                src: 'evalHistory ' + coPop + '건', asof: '2025-12-31' };
    return {
      hit: hit, facts: facts,
      notice: [['11명', worst.n + '명'], ['4명', worst.movedN + '명'], ['두 단계', kNum(THstep) + ' 단계']],
      ev: spec,
      th: { 'TH-등급이동-단계폭': THstep + '단계', 'TH-등급이동-팀비율': pn(worst.pct) + '%' }
    };
  });

  /* --- 평가-상위조직장-09 : 하위 팀 사이 상위 등급 비율 격차 --------------- */
  E.registerEval('평가-상위조직장-09', function (ctx) {
    var SID = '평가-상위조직장-09';
    var s = ctx.scope;
    if (!s) return { hit: false, facts: {}, ev: {}, th: {} };
    var EI = evalIndex();
    var MINPOP = thv(SID, 'TH-등급편중-모수', 8);
    var THgap = thv(SID, 'TH-팀등급커브-격차', 30);
    var C = coEval();
    var rows = s.units.map(function (u) {
      var ids = empIdsInOrgSet(subtreeIds(u.org)), list = [];
      keys(ids).forEach(function (id) { if (EI[id]) list.push(EI[id]); });
      if (list.length < MINPOP) return null;
      var top = list.filter(function (e) { return isTop(e.grade); }).length;
      return { org: u.org, name: u.name, n: list.length, topPct: r1(top / list.length * 100) };
    }).filter(function (x) { return !!x; });
    if (rows.length < 2) return { hit: false, facts: { reason: '비교 가능한 팀 부족' }, ev: {}, th: {} };
    var sorted = rows.slice().sort(function (a, b) { return b.topPct - a.topPct; });
    var hi = sorted[0], lo = sorted[sorted.length - 1];
    var gap = r1(hi.topPct - lo.topPct);
    var hit = gap >= THgap;
    var totalN = 0; rows.forEach(function (r) { totalN += r.n; });
    var farN = rows.filter(function (r) { return Math.abs(r.topPct - C.topPct) >= 15; }).length;
    var facts = {
      unitN: rows.length, totalN: totalN, hiName: hi.name, hiPct: hi.topPct,
      loName: lo.name, loPct: lo.topPct, gap: gap, coTopPct: C.topPct, farN: farN
    };
    var spec = {};
    spec[0] = { m: [['여덟 명', MINPOP + '명'], ['6개 팀', rows.length + '개 팀'], ['72건', totalN + '건']],
                emph: rows.length + '개 팀', src: s.srcOrg + ' / evaluations ' + totalN + '건' };
    spec[1] = { m: [['77%', pn(hi.topPct) + '%'], ['30%', pn(lo.topPct) + '%']], emph: pn(hi.topPct) + '%',
                src: hi.org + ' / ' + lo.org + ' / evaluations 팀별 집계' };
    spec[2] = { m: [['47%p', pn(gap) + '%p'], ['30%p', THgap + '%p']], emph: pn(gap) + '%p',
                src: hi.org + ' / ' + lo.org };
    spec[3] = { m: [['54%', pn(C.topPct) + '%'], ['여섯 팀', rows.length + '개 팀'], ['넷', farN + '곳']],
                emph: farN + '곳', src: 'evaluations ' + C.n + '건 / 하위 ' + rows.length + '개 팀' };
    return {
      hit: hit, facts: facts,
      notice: [['6개', rows.length + '개'], ['77%', pn(hi.topPct) + '%'], ['30%', pn(lo.topPct) + '%']],
      ev: spec,
      th: { 'TH-팀등급커브-격차': pn(gap) + '%p', 'TH-등급편중-모수': MINPOP + '명' }
    };
  });

  /* --- 평가-상위조직장-10 : 근거가 핵심결과 실적을 인용하지 않음 ----------- */
  E.registerEval('평가-상위조직장-10', function (ctx) {
    var SID = '평가-상위조직장-10';
    var s = ctx.scope;
    if (!s) return { hit: false, facts: {}, ev: {}, th: {} };
    var set = scopeEmpSet(s), EI = evalIndex();
    var scopeEvals = [];
    keys(set).forEach(function (id) { if (EI[id]) scopeEvals.push(EI[id]); });
    if (!scopeEvals.length) return { hit: false, facts: {}, ev: {}, th: {} };
    var scopeKrs = s.krs || [];
    var noCite = scopeEvals.filter(function (e) { return !citesKrName(e.rationale_summary, scopeKrs); });
    var pct = r0(noCite.length / scopeEvals.length * 100);
    var THpct = thv(SID, 'TH-근거실적인용-누락비율', 50);
    var THn = thv(SID, 'TH-근거실적인용-건수', 5);
    var hit = noCite.length >= THn && pct >= THpct;
    var axesAvg = r1(avg(scopeEvals.map(function (e) { return citedAxes(e.rationale_summary); })));
    var scopeCkN = (s.cks || []).length;
    var W = solveWeights();
    var facts = {
      scopeN: scopeEvals.length, noCiteN: noCite.length, pct: pct,
      axesAvg: axesAvg, ckN: scopeCkN, krN: scopeKrs.length,
      wAch: W.ach, wPeer: W.peer, wExec: W.exec, wErr: W.err
    };
    var spec = {};
    spec[0] = { m: [['62건', scopeEvals.length + '건']], emph: scopeEvals.length + '건',
                src: s.srcOrgIncl + ' / evaluations ' + scopeEvals.length + '건' };
    spec[1] = { m: [['62건', noCite.length + '건']], emph: noCite.length + '건',
                src: s.scopeOrg.org_id + ' / 근거 요약문 ' + scopeEvals.length + '건' };
    spec[2] = { m: [['세 점수', pn(axesAvg) + '개 축']], emph: pn(axesAvg) + '개 축',
                src: 'evaluations.rationale_summary 형식' };
    spec[3] = { m: [['360건', scopeCkN + '건'], ['0건', (scopeEvals.length - noCite.length) + '건']],
                emph: (scopeEvals.length - noCite.length) + '건',
                src: s.srcOrgIncl + ' / checkins ' + scopeCkN + '건' };
    spec[4] = { m: [['100%', pct + '%'], ['50%', THpct + '%']], emph: pct + '%',
                src: s.scopeOrg.org_id + ' / 근거 요약문 ' + scopeEvals.length + '건' };
    spec[5] = { m: [['50%', W.ach + '%'], ['50%', W.peer + '%'], ['0%', W.exec + '%']], emph: W.exec + '%',
                calcm: [['3.78', pn(W.err)]], src: 'evaluations ' + W.n + '건 / 가중치 역산' };
    spec[6] = { m: [['38건', scopeKrs.length + '건']], emph: scopeKrs.length + '건',
                src: s.srcOrgIncl + ' / keyResults ' + scopeKrs.length + '건' };
    return {
      hit: hit, facts: facts,
      notice: [['62건', scopeEvals.length + '건'], ['0건', (scopeEvals.length - noCite.length) + '건']],
      ev: spec,
      th: { 'TH-근거실적인용-누락비율': pct + '%', 'TH-근거실적인용-건수': noCite.length + '건' }
    };
  });

  /* ==================================================================
     HR경영진 — 전사 집계
  ================================================================== */

  /* --- 평가-HR경영진-02 : 한 조직에 근거 부실 평가가 쌓임 ----------------- */
  E.registerEval('평가-HR경영진-02', function (ctx) {
    var SID = '평가-HR경영진-02';
    var THlen = thv(SID, 'TH-평가근거-최소글자수', 40);
    var THpct = thv(SID, 'TH-근거부실-조직내비율', 35);
    var THn = thv(SID, 'TH-근거부실-최소건수', 5);
    var rows = evalsByOrg(6);      /* 「평가 대상이 5명을 넘는 조직」 = 6명 이상 */
    if (!rows.length) return { hit: false, facts: { reason: '모집단 미달' }, ev: {}, th: {} };
    rows.forEach(function (r) {
      r.shortN = r.list.filter(function (e) { return len(e.rationale_summary) < THlen; }).length;
      r.shortPct = r1(r.shortN / r.n * 100);
      r.noCiteN = r.list.filter(function (e) { return citedAxes(e.rationale_summary) === 0; }).length;
    });
    var worst = rows.slice().sort(function (a, b) { return b.shortN - a.shortN || b.shortPct - a.shortPct; })[0];
    var hit = worst.shortN >= THn && worst.shortPct >= THpct;
    var C = coEval();
    var ckN = arr('checkins').length, histN = arr('evalHistory').length;
    var facts = {
      orgN: rows.length, orgName: worst.name, orgId: worst.org, n: worst.n,
      shortN: worst.shortN, shortPct: worst.shortPct, noCiteN: worst.noCiteN,
      ckN: ckN, histN: histN, coTotal: C.n
    };
    var spec = {};
    spec[0] = { m: [['5명', '5명']], emph: '5명',
                src: 'evaluations ' + C.n + '건 / orgs ' + arr('orgs').length + '개 중 ' + rows.length + '곳' };
    spec[1] = { m: [['{{조직명}}', worst.name], ['40자', THlen + '자'], ['9건', worst.shortN + '건']],
                emph: worst.shortN + '건',
                calcm: [['9건', worst.shortN + '건'], ['26명', worst.n + '명'], ['35%', pn(worst.shortPct) + '%']],
                src: worst.org + ' / rationale_summary ' + worst.n + '건' };
    spec[2] = { m: [['이 9건', '이 ' + worst.shortN + '건'], ['한 건도', worst.noCiteN + '건이']],
                emph: worst.noCiteN + '건', src: worst.org + ' / rationale_summary · checkins' };
    spec[3] = { m: [['9건', worst.shortN + '건'], ['5건', THn + '건']], emph: worst.shortN + '건',
                src: 'HR 평가 운영 기준(신설 예정)' };
    spec[4] = { m: [['221건', C.n + '건']], emph: '세 요소 점수', src: 'evaluations.rationale_summary ' + C.n + '건' };
    spec[5] = { m: [['360건', ckN + '건'], ['204명분', histN + '명분']], emph: histN + '명분',
                src: 'checkins ' + ckN + '건 / evalHistory ' + histN + '명' };
    return {
      hit: hit, facts: facts,
      notice: worst.shortN
        ? [['{{조직명}}', worst.name], ['40자', THlen + '자'], ['9건', worst.shortN + '건']]
        : [['{{조직명}}에서 근거 40자에 못 미치는 평가가 9건 쌓였어요',
            '조직 ' + rows.length + '곳 모두 평가 근거가 ' + THlen + '자를 넘겨 쌓인 건이 없어요']],
      ev: spec,
      th: { 'TH-평가근거-최소글자수': THlen + '자', 'TH-근거부실-조직내비율': pn(worst.shortPct) + '%',
            'TH-근거부실-최소건수': worst.shortN + '건' }
    };
  });

  /* --- 평가-HR경영진-03 : 한 조직의 상위 등급 비중이 전사보다 크게 높음 ---- */
  E.registerEval('평가-HR경영진-03', function (ctx) {
    var SID = '평가-HR경영진-03';
    var MINPOP = thv(SID, 'TH-등급판단-최소모집단', 8);
    var TH = thv(SID, 'TH-상위등급편차-초과', 25);
    var rows = evalsByOrg(MINPOP);
    if (!rows.length) return { hit: false, facts: { reason: '모집단 미달' }, ev: {}, th: {} };
    var C = coEval();
    var hi = rows.slice().sort(function (a, b) { return b.topPct - a.topPct; })[0];
    var diff = r1(hi.topPct - C.topPct);
    var hit = diff >= TH;
    /* 어느 쪽으로든 편차 기준을 넘은 조직 수 — 「이미 치우친 곳이 몇 곳인가」 */
    var loose = rows.filter(function (r) { return r1(r.topPct - C.topPct) >= TH; }).length;
    var strict = rows.filter(function (r) { return r1(C.topPct - r.topPct) >= TH; }).length;
    var conc = rows.filter(function (r) { return r.domPct >= 65; }).length;
    var facts = {
      orgN: rows.length, orgName: hi.name, orgId: hi.org, n: hi.n,
      topPct: hi.topPct, coTopPct: C.topPct, diff: diff,
      looseN: loose, strictN: strict, concN: conc, dist: C.dist
    };
    var spec = {};
    spec[0] = { m: [['8명', MINPOP + '명'], ['14곳', rows.length + '곳']], emph: rows.length + '곳',
                src: 'evaluations ' + C.n + '건 / orgs ' + arr('orgs').length + '개' };
    spec[1] = { m: [['{{조직명}}', hi.name], ['80.0%', pn(hi.topPct) + '%']], emph: pn(hi.topPct) + '%',
                src: hi.org + ' / evaluations ' + hi.n + '건' };
    spec[2] = { m: [['A 108명', 'A ' + (C.dist.A || 0) + '명'], ['B 99명', 'B ' + (C.dist.B || 0) + '명'],
                    ['S 11명', 'S ' + (C.dist.S || 0) + '명'], ['C 3명', 'C ' + (C.dist.C || 0) + '명']],
                emph: 'A ' + (C.dist.A || 0) + '명', src: 'evaluations ' + C.n + '건 / grade' };
    spec[3] = { m: [['53.8%', pn(C.topPct) + '%'], ['26.2%p', pn(diff) + '%p']], emph: pn(diff) + '%p',
                calcm: [['11명', (C.dist.S || 0) + '명'], ['108명', (C.dist.A || 0) + '명'],
                        ['221명', C.n + '명'], ['53.8%', pn(C.topPct) + '%']],
                src: 'evaluations ' + C.n + '건' };
    spec[4] = { m: [['8명', MINPOP + '명'], ['14곳', rows.length + '곳'], ['9곳', (loose + strict + conc) + '곳']],
                emph: (loose + strict + conc) + '곳',
                calcm: [['3곳', loose + '곳'], ['5곳', strict + '곳'], ['1곳', conc + '곳']],
                src: 'evaluations ' + C.n + '건 / 조직별 등급 분포' };
    return {
      hit: hit, facts: facts,
      notice: [['{{조직명}}', hi.name], ['80%', pn(hi.topPct) + '%'], ['26.2%p', pn(diff) + '%p']],
      ev: spec,
      th: { 'TH-상위등급편차-초과': pn(diff) + '%p', 'TH-등급판단-최소모집단': hi.n + '명' }
    };
  });

  /* --- 평가-HR경영진-04 : 조직 간 상위 등급 비중 격차 --------------------- */
  E.registerEval('평가-HR경영진-04', function (ctx) {
    var SID = '평가-HR경영진-04';
    var MINPOP = thv(SID, 'TH-등급판단-최소모집단', 8);
    var TH = thv(SID, 'TH-등급조직간격차-초과', 40);
    var rows = evalsByOrg(MINPOP);
    if (rows.length < 2) return { hit: false, facts: { reason: '비교 조직 부족' }, ev: {}, th: {} };
    var C = coEval();
    var sorted = rows.slice().sort(function (a, b) { return b.topPct - a.topPct; });
    var hi = sorted[0], lo = sorted[sorted.length - 1];
    var gap = r1(hi.topPct - lo.topPct);
    var hit = gap >= TH;
    var loose = rows.filter(function (r) { return r1(r.topPct - C.topPct) >= 25; }).length;
    var strict = rows.filter(function (r) { return r1(C.topPct - r.topPct) >= 25; }).length;
    var facts = {
      orgN: rows.length, hiName: hi.name, hiPct: hi.topPct, loName: lo.name, loPct: lo.topPct,
      gap: gap, coTopPct: C.topPct, looseN: loose, strictN: strict
    };
    var spec = {};
    spec[0] = { m: [['8명', MINPOP + '명'], ['14곳', rows.length + '곳']], emph: rows.length + '곳',
                src: 'evaluations ' + C.n + '건 / orgs ' + arr('orgs').length + '개' };
    spec[1] = { m: [['80.0%', pn(hi.topPct) + '%'], ['25.0%', pn(lo.topPct) + '%']], emph: pn(lo.topPct) + '%',
                calcm: [['80.0%', pn(hi.topPct) + '%'], ['25.0%', pn(lo.topPct) + '%'], ['55.0%p', pn(gap) + '%p']],
                src: hi.org + ' / ' + lo.org + ' / evaluations 조직별 집계' };
    spec[2] = { m: [['55%p', pn(gap) + '%p'], ['40%p', TH + '%p']], emph: pn(gap) + '%p',
                src: hi.org + ' / ' + lo.org };
    spec[3] = { m: [['53.8%', pn(C.topPct) + '%'], ['3곳', loose + '곳'], ['5곳', strict + '곳']],
                emph: pn(C.topPct) + '%',
                calcm: [['11명', (C.dist.S || 0) + '명'], ['108명', (C.dist.A || 0) + '명'], ['221명', C.n + '명']],
                src: 'evaluations ' + C.n + '건' };
    return {
      hit: hit, facts: facts,
      notice: [['14곳', rows.length + '곳'], ['80%', pn(hi.topPct) + '%'], ['25%', pn(lo.topPct) + '%']],
      ev: spec,
      th: { 'TH-등급조직간격차-초과': pn(gap) + '%p', 'TH-등급판단-최소모집단': MINPOP + '명' }
    };
  });

  /* --- 평가-HR경영진-05 : 진척은 낮은데 상위 등급 비중은 높은 조직 --------- */
  E.registerEval('평가-HR경영진-05', function (ctx) {
    var SID = '평가-HR경영진-05';
    var THprog = thv(SID, 'TH-진척전사대비-미달', 20);
    var THtop = thv(SID, 'TH-상위등급편차-초과', 25);
    var THn = thv(SID, 'TH-어긋난대상자-최소인원', 5);
    var rows = evalsByOrg(6);
    if (!rows.length) return { hit: false, facts: { reason: '모집단 미달' }, ev: {}, th: {} };
    var C = coEval();
    /* 조직별 핵심결과 평균 진척 — objectives.org_id → keyResults */
    var objByOrg = {};
    arr('objectives').forEach(function (o) { (objByOrg[o.org_id] = objByOrg[o.org_id] || []).push(o.objective_id); });
    var krByObj = {};
    arr('keyResults').forEach(function (k) { (krByObj[k.objective_id] = krByObj[k.objective_id] || []).push(k); });
    rows.forEach(function (r) {
      var progs = [];
      (objByOrg[r.org] || []).forEach(function (oid) {
        (krByObj[oid] || []).forEach(function (k) { progs.push(k.progress || 0); });
      });
      r.krN = progs.length;
      r.krAvg = progs.length ? r1(avg(progs)) : null;
    });
    var cands = rows.filter(function (r) {
      return r.krAvg != null && r1(C.krAvg - r.krAvg) >= THprog && r1(r.topPct - C.topPct) >= THtop && r.n >= THn;
    });
    var target = cands.sort(function (a, b) { return (b.topPct - b.krAvg) - (a.topPct - a.krAvg); })[0] || null;
    var show = target || rows.filter(function (r) { return r.krAvg != null; })
      .sort(function (a, b) { return (b.topPct - b.krAvg) - (a.topPct - a.krAvg); })[0] || rows[0];
    var hit = !!target;
    var W = solveWeights();
    var facts = {
      orgN: rows.length, orgName: show.name, orgId: show.org, n: show.n,
      krAvg: show.krAvg, topPct: show.topPct, coKrAvg: C.krAvg, coTopPct: C.topPct,
      progGap: show.krAvg == null ? null : r1(C.krAvg - show.krAvg), topGap: r1(show.topPct - C.topPct),
      wAch: W.ach, wPeer: W.peer, wExec: W.exec
    };
    var spec = {};
    spec[0] = { m: [['5명', '5명']], emph: '5명',
                src: 'evaluations ' + C.n + '건 / orgs ' + arr('orgs').length + '개 중 ' + rows.length + '곳' };
    spec[1] = { m: [['{{조직명}}', show.name], ['22%', (show.krAvg == null ? '?' : pn(show.krAvg)) + '%'],
                    ['80%', pn(show.topPct) + '%']], emph: pn(show.topPct) + '%',
                src: show.org + ' / keyResults ' + show.krN + '건 · evaluations ' + show.n + '건' };
    spec[2] = { m: [['43.0%', pn(C.krAvg) + '%'], ['53.8%', pn(C.topPct) + '%']], emph: pn(C.krAvg) + '%',
                src: 'keyResults ' + arr('keyResults').length + '건 / evaluations ' + C.n + '건' };
    spec[4] = { m: [['두 축으로만', W.ach + '% 대 ' + W.peer + '%로']], emph: W.ach + '% 대 ' + W.peer + '%',
                calcm: [['달성 50%', '달성 ' + W.ach + '%'], ['동료 리뷰 50%', '동료 리뷰 ' + W.peer + '%'],
                        ['실행 일관성 0%', '실행 일관성 ' + W.exec + '%']],
                src: 'evaluations ' + W.n + '건 / components' };
    return {
      hit: hit, facts: facts,
      notice: [['{{조직명}}', show.name], ['22%', (show.krAvg == null ? '?' : pn(show.krAvg)) + '%'],
               ['80%', pn(show.topPct) + '%']],
      ev: spec,
      th: { 'TH-진척전사대비-미달': (facts.progGap == null ? null : pn(facts.progGap) + '%p'),
            'TH-상위등급편차-초과': pn(facts.topGap) + '%p', 'TH-어긋난대상자-최소인원': show.n + '명' }
    };
  });

  /* --- 평가-HR경영진-06 : 발령 인원에 평가자가 지정되지 않음 --------------- */
  E.registerEval('평가-HR경영진-06', function (ctx) {
    var SID = '평가-HR경영진-06';
    /* 「평가 기간에 소속이 바뀐 사람」의 원천은 evaluatorMap.source='missing'
       (note: 「발령 뒤 매핑이 비어 있습니다」)이 유일하다. 발령 이력 표는 아직 없다. */
    var maps = arr('evaluatorMap');
    var moved = maps.filter(function (m) { return m.source === 'missing'; });
    var noEval = moved.filter(function (m) { return !m.first_evaluator; });
    var coNoEval = maps.filter(function (m) { return !m.first_evaluator; }).length;
    var pct = moved.length ? r0(noEval.length / moved.length * 100) : null;
    var THpct = thv(SID, 'TH-평가자미지정-비율', 50);
    var THn = thv(SID, 'TH-평가기간이동-최소인원', 5);
    var hit = moved.length >= THn && pct != null && pct >= THpct;
    var emps = arr('employees');
    var jhN = emps.filter(function (e) { return e.jobHistory && e.jobHistory.length; }).length;
    var facts = {
      movedN: moved.length, noEvalN: noEval.length, pct: pct, coNoEvalN: coNoEval,
      empN: emps.length, jobHistN: jhN, jobHistPct: emps.length ? r1(jhN / emps.length * 100) : 0
    };
    var spec = {};
    spec[0] = { m: [['17명', moved.length + '명']], emph: moved.length + '명',
                src: 'evaluatorMap.source=missing ' + moved.length + '건' };
    spec[1] = { m: [['11명', noEval.length + '명']], emph: noEval.length + '명',
                calcm: [['11명', noEval.length + '명'], ['17명', moved.length + '명'], ['65%', pct + '%']],
                src: 'evaluatorMap.first_evaluator 공백 ' + noEval.length + '건' };
    spec[2] = { m: [['65%', (pct == null ? '?' : pct) + '%'], ['50%', THpct + '%']], emph: (pct == null ? '?' : pct) + '%',
                src: 'HR 평가 운영 기준(신설 예정)' };
    spec[3] = { m: [['221명', emps.length + '명'], ['1명뿐', jhN + '명뿐']], emph: jhN + '명뿐',
                calcm: [['1명', jhN + '명'], ['221명', emps.length + '명'], ['0.5%', pn(facts.jobHistPct) + '%']],
                src: 'employees.jobHistory ' + jhN + '건' };
    return {
      hit: hit, facts: facts,
      notice: [['17명', moved.length + '명'], ['11명', noEval.length + '명']],
      ev: spec,
      th: { 'TH-평가자미지정-비율': (pct == null ? null : pct + '%'), 'TH-평가기간이동-최소인원': moved.length + '명' }
    };
  });

  /* --- 평가-HR경영진-07 : 한 조직의 등급이 한 칸에 쏠림 -------------------- */
  E.registerEval('평가-HR경영진-07', function (ctx) {
    var SID = '평가-HR경영진-07';
    var MINPOP = thv(SID, 'TH-등급판단-최소모집단', 8);
    var CAP = thv(SID, 'TH-등급쏠림-상한', 65);
    var rows = evalsByOrg(MINPOP);
    if (!rows.length) return { hit: false, facts: { reason: '모집단 미달' }, ev: {}, th: {} };
    var C = coEval();
    var worst = rows.slice().sort(function (a, b) { return b.domPct - a.domPct; })[0];
    var hit = worst.domPct >= CAP;
    var coDomG = null;
    keys(C.dist).forEach(function (g) { if (!coDomG || C.dist[g] > C.dist[coDomG]) coDomG = g; });
    var coDomPct = r1(C.dist[coDomG] / C.n * 100);
    var facts = {
      orgN: rows.length, orgName: worst.name, orgId: worst.org, n: worst.n,
      domGrade: worst.domGrade, domPct: worst.domPct, cap: CAP, over: r1(worst.domPct - CAP),
      coDomGrade: coDomG, coDomN: C.dist[coDomG], coDomPct: coDomPct,
      coMin: C.min, coMean: C.mean, coMax: C.max
    };
    var spec = {};
    spec[0] = { m: [['8명', MINPOP + '명'], ['14곳', rows.length + '곳']], emph: rows.length + '곳',
                src: 'evaluations ' + C.n + '건 / orgs ' + arr('orgs').length + '개' };
    spec[1] = { m: [['{{조직명}}', worst.name], ['A등급', worst.domGrade + '등급'], ['66.7%', pn(worst.domPct) + '%']],
                emph: pn(worst.domPct) + '%', src: worst.org + ' / evaluations ' + worst.n + '건' };
    spec[2] = { m: [['A등급이 108명', coDomG + '등급이 ' + C.dist[coDomG] + '명'], ['48.9%', pn(coDomPct) + '%']],
                emph: pn(coDomPct) + '%', src: 'evaluations ' + C.n + '건 / grade' };
    spec[3] = { m: [['65%', CAP + '%'], ['1.7%p', pn(worst.domPct - CAP) + '%p']], emph: CAP + '%',
                calcm: [['66.7%', pn(worst.domPct) + '%'], ['65%', CAP + '%']],
                src: '등급 분포 권고값(신설 대상)' };
    spec[4] = { calcm: [['59.4', pn(C.min)], ['75.8', pn(C.mean)], ['94.9', pn(C.max)]], ok: 1,
                src: 'evaluations ' + C.n + '건 / weighted_score' };
    return {
      hit: hit, facts: facts,
      notice: [['{{조직명}}', worst.name], ['A등급', worst.domGrade + '등급'],
               ['66.7%', pn(worst.domPct) + '%'], ['65%', CAP + '%']],
      ev: spec,
      th: { 'TH-등급쏠림-상한': pn(worst.domPct) + '%', 'TH-등급판단-최소모집단': worst.n + '명' }
    };
  });

  /* --- 평가-HR경영진-08 : 제도가 밝힌 요소가 산식에서 빠져 있음 ------------ */
  E.registerEval('평가-HR경영진-08', function (ctx) {
    var SID = '평가-HR경영진-08';
    var W = solveWeights();
    var FLOOR = thv(SID, 'TH-요소가중치-하한', 10);
    var MINSAMPLE = thv(SID, 'TH-산식역산-표본수', 100);
    var below = [];
    if (W.ach < FLOOR) below.push('목표 달성');
    if (W.peer < FLOOR) below.push('동료 리뷰');
    if (W.exec < FLOOR) below.push('실행 일관성');
    var hit = below.length >= 1 && W.n >= MINSAMPLE;
    var minW = Math.min(W.ach, Math.min(W.peer, W.exec));
    var facts = {
      sampleN: W.n, wAch: W.ach, wPeer: W.peer, wExec: W.exec, residual: W.err,
      belowN: below.length, belowNames: below, floor: FLOOR, minWeight: minW
    };
    var spec = {};
    spec[0] = { m: [['221건', W.n + '건']], emph: W.n + '건', src: 'evaluations ' + W.n + '건 / components' };
    spec[1] = { m: [['목표 달성 50%', '목표 달성 ' + W.ach + '%'], ['동료 리뷰 50%', '동료 리뷰 ' + W.peer + '%'],
                    ['실행 일관성 0%', '실행 일관성 ' + W.exec + '%']],
                emph: '실행 일관성 ' + W.exec + '%',
                calcm: [['3.78', pn(W.err)], ['221건', W.n + '건']],
                src: 'evaluations ' + W.n + '건 / weighted_score' };
    spec[2] = { m: [['두 축만', below.length ? ((3 - below.length) + '개 축만') : '세 축 모두']],
                emph: below.length ? ((3 - below.length) + '개 축만') : '세 축 모두',
                src: '제도 안내문 / evaluations ' + W.n + '건' };
    return {
      hit: hit, facts: facts,
      notice: [['221건', W.n + '건'], ['실행 일관성', below[0] || '세 요소'], ['0%', minW + '%']],
      ev: spec,
      th: { 'TH-요소가중치-하한': minW + '%', 'TH-산식역산-표본수': W.n + '건' }
    };
  });

  /* --- 평가-HR경영진-09 : 등급 경계값의 제도 근거 부재 --------------------- */
  E.registerEval('평가-HR경영진-09', function (ctx) {
    var SID = '평가-HR경영진-09';
    var obs = observedCutoff();
    var grades = ['S', 'A', 'B', 'C', 'D'].filter(function (g) { return obs[g] != null; });
    var docCut = policy().grade_cutoff || {};
    /* 제도 문서(policy.grade_cutoff)에 근거가 남아 있는 경계가 몇 개인가 */
    var documented = grades.filter(function (g) { return docCut[g] != null; });
    var mismatch = documented.filter(function (g) { return r1(docCut[g]) !== r1(obs[g]); });
    var TH = thv(SID, 'TH-등급경계-원천부재', 0);
    var THn = thv(SID, 'TH-등급경계-대상건수', 100);
    var C = coEval();
    var hit = documented.length <= TH && C.n >= THn;
    var obsStr = grades.map(function (g) { return g + ' ' + pn(obs[g]) + '점'; }).join('·');
    var histN = arr('evalHistory').length;
    var facts = {
      evalN: C.n, cutN: grades.length, documentedN: documented.length, mismatchN: mismatch.length,
      observed: obsStr, policySource: policy().source || '', histN: histN
    };
    var spec = {};
    spec[0] = { m: [['221건', C.n + '건']], emph: C.n + '건', src: 'evaluations ' + C.n + '건 / grade · weighted_score' };
    spec[1] = { m: [['S 86.0점·A 75.0점·B 62.0점·C 59.4점', obsStr]], emph: obsStr,
                src: 'evaluations ' + C.n + '건 / 등급별 최저 종합점수' };
    spec[2] = { text: documented.length
                  ? ('제도 문서에서 근거를 확인할 수 있는 등급 경계값은 ' + documented.length + '개이고, 그중 '
                     + mismatch.length + '개가 역산값과 어긋나요')
                  : ('제도 문서에서 근거를 확인할 수 있는 등급 경계값은 0개이고, 화면은 역산해 얻은 이 '
                     + grades.length + '개 값을 쓰고 있어요'),
                emph: documented.length + '개', src: (policy().policy_id || 'policy') + ' / grade_cutoff' };
    spec[3] = { m: [['204명분', histN + '명분']], emph: histN + '명분', src: 'evalHistory ' + histN + '명', asof: '2025-12-31' };
    return {
      hit: hit, facts: facts,
      notice: documented.length
        ? [['등급 경계 4개가 제도 문서에 없어 역산값을 쓰고 있어요',
            '등급 경계 ' + documented.length + '개는 제도 문서에 있지만 ' + mismatch.length + '개가 역산값과 달라요']]
        : [['4개', grades.length + '개']],
      ev: spec,
      th: { 'TH-등급경계-원천부재': documented.length + '개', 'TH-등급경계-대상건수': C.n + '건' }
    };
  });

  /* --- 평가-HR경영진-11 : 전년 대비 점수가 크게 움직인 인원의 조직 집중 ---- */
  E.registerEval('평가-HR경영진-11', function (ctx) {
    var SID = '평가-HR경영진-11';
    var TH = thv(SID, 'TH-등급급변-점수폭', 20);
    var THn = thv(SID, 'TH-등급급변-집중인원', 3);
    var EI = evalIndex();
    var pop = 0, big = [], maxUp = 0, maxDown = 0, upCase = null, downCase = null;
    arr('evalHistory').forEach(function (h) {
      var ev = EI[h.emp_id], hist = h.history || [];
      var last = hist.length ? hist[hist.length - 1] : null;
      if (!ev || !last) return;
      pop++;
      var d = r1((ev.weighted_score || 0) - (last.score || 0));
      if (d > maxUp) { maxUp = d; upCase = { from: last.grade, to: ev.grade, d: d }; }
      if (-d > maxDown) { maxDown = r1(-d); downCase = { from: last.grade, to: ev.grade, d: r1(-d) }; }
      if (Math.abs(d) >= TH) big.push({ emp_id: h.emp_id, delta: d });
    });
    var byOrg = {};
    big.forEach(function (b) { var e = empById(b.emp_id); var o = e ? e.org_id : '?'; byOrg[o] = (byOrg[o] || 0) + 1; });
    var topOrg = null;
    keys(byOrg).forEach(function (o) { if (!topOrg || byOrg[o] > byOrg[topOrg]) topOrg = o; });
    var topOrgN = topOrg ? byOrg[topOrg] : 0;
    var hit = big.length >= 1 && topOrgN >= THn;
    var C = coEval();
    var cut = observedCutoff();
    var cutStr = ['S', 'A', 'B', 'C'].filter(function (g) { return cut[g] != null; })
      .map(function (g) { return g + ' ' + pn(cut[g]); }).join(' · ');
    var facts = {
      histN: pop, bigN: big.length, topOrg: topOrg, topOrgName: topOrg ? orgName(topOrg) : '', topOrgN: topOrgN,
      threshold: TH, maxUp: maxUp, maxDown: maxDown,
      coMin: C.min, coMean: C.mean, coMax: C.max, cutStr: cutStr
    };
    var spec = {};
    spec[0] = { m: [['204명분', pop + '명분']], emph: pop + '명분', src: 'evalHistory ' + pop + '명' };
    spec[1] = { m: [['12명', big.length + '명']], emph: big.length + '명',
                src: 'evaluations × evalHistory / 조직 최다 ' + topOrgN + '명' };
    spec[2] = { m: [['12명', big.length + '명'], ['20점', TH + '점']], emph: big.length + '명',
                src: 'evalHistory ' + pop + '명분' };
    spec[3] = { m: [['59.4점', pn(C.min) + '점'], ['75.8점', pn(C.mean) + '점'], ['94.9점', pn(C.max) + '점'],
                    ['20점', TH + '점']], emph: TH + '점 폭',
                calcm: [['S 86.0 · A 75.0 · B 62.0 · C 59.4', cutStr]],
                src: 'evaluations ' + C.n + '건 / weighted_score' };
    if (downCase && upCase) spec[4] = { m: [['21.3점', pn(maxDown) + '점'], ['A에서 C로', downCase.from + '에서 ' + downCase.to + '로'],
                    ['20.9점', pn(maxUp) + '점'], ['C에서 B로', upCase.from + '에서 ' + upCase.to + '로']],
                emph: pn(maxDown) + '점', src: 'evalHistory ' + pop + '명분', asof: '2025-12-31' };
    return {
      hit: hit, facts: facts,
      notice: [['20점', TH + '점'], ['12명', big.length + '명']],
      ev: spec,
      th: { 'TH-등급급변-점수폭': TH + '점', 'TH-등급급변-집중인원': topOrgN + '명' }
    };
  });

  /* ==================================================================
     원천이 모자라 「그대로는」 못 세는 값 — 판정은 셀 수 있는 부분으로만 했다
     ------------------------------------------------------------------
     · 평가-구성원-05 / 평가-팀장-04 — 「이전 조직에서 보낸 기간 비중·개월 수」
       필요한 원천: 소속 변경일이 남는 발령 이력.
       evaluatorMap.source='missing' 으로 「발령이 있었다」까지는 알 수 있지만
       그 행의 assigned_at 이 전부 null 이라 기간을 나눌 수 없다. 그래서 두 신호는
       발령 표시 + 전입 뒤 자체 기록(체크인)만으로 판정하고, 기간 비중을 말하는
       근거 줄은 spec 에서 빼 (추정)으로 남겼다.
     · 평가-구성원-08 [4] 「지난 기간 같은 항목의 난이도 근거」 — 핵심결과 단위
       과거 기록이 없다. 필요한 원천: 전기 keyResults 스냅숏.
     · 평가-상위조직장-02 [5] 「같은 평가자의 지난 사이클 평균 근거 길이」 —
       evalHistory 에는 등급·점수만 있고 근거 문장이 없다.
     · 평가-팀장-05 / 평가-팀장-10 「초안 저장 뒤 경과일」 — 초안 저장 시각 필드가
       없어 evalStatus.first_submitted_at(1차 제출 시각)을 저장 시점으로 읽는다.
       아직 제출 전인 대상은 경과일을 null 로 두고 판정에서 뺀다.
  ================================================================== */
})();
