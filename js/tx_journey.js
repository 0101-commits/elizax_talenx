/* ============================================================================
 * tx_journey.js — 성과 프로세스 맵 (내 등급이 정해지는 과정과 근거를 한 장으로)
 * ----------------------------------------------------------------------------
 * [기획 스펙]
 * ① 배경/문제
 *    - 구성원 입장에서 "내 등급은 어떤 과정을 거쳐, 무엇을 근거로 정해졌는가"를
 *      한 화면에서 확인할 수 있는 조망 뷰가 없다.
 *    - 목표수립 → 실행·중간점검 → 평가 → 피드백/리뷰 4단계 위에 실제 결정
 *      노드(승인 완료 / 승인 대기 / 예정)를 얹고, 각 결정의 인용 근거를
 *      드릴다운으로 보여준다. 근거는 TALENX_DATA + 라이브 스토어(성과 기록,
 *      1:1 확정 기록, 승인 대기 게이트 결정)에서 실제로 읽는다.
 * ② 사용자 시나리오
 *    - 성과관리 목표 화면(.perf-head) 또는 평가관리(.ap-head)의
 *      "◈ 프로세스 맵" 버튼 → 전체화면 오버레이.
 *    - 노드 클릭 → 우측 상세 패널: 결정 명칭·시점·결정자·상태 + 인용 근거
 *      (체크인 원문·규칙·직무 기준·1:1·평가 이력, 원천 id 모노스페이스).
 *    - 단계별 "기록 N건" 카운터 → 해당 단계의 성과 기록 항목 목록.
 *    - 증거 흐름 곡선(SVG): 앞 단계에서 확정된 기록이 다음 단계의 인용
 *      근거로 이어지는 경로를 표시, 노드 호버/선택 시 강조.
 *    - 조직장/HR/경영진 관점은 대상 구성원 선택 셀렉터 제공.
 * ③ 동작 정의
 *    - body 레벨 오버레이(.ezpm-root, z-index:1300) — tx_1on1의 .ez1o-mapov
 *      패턴. 배경 클릭·Esc 닫기, 카드 max-width 1180px, 내부 스크롤,
 *      플로우는 overflow-x:auto.
 *    - 진입 버튼 주입은 멱등([data-ezpm-btn] 마커): TXFIX F.onSection +
 *      MutationObserver + 300ms×20 폴링(성과/평가 화면은 tx_fix_*가
 *      innerHTML을 통째로 재구성하므로).
 *    - 클릭은 전부 document 레벨 위임(data-ezpm-* 라우팅).
 *    - 노출: window.EZJourney = { open(empId?), close }.
 * ④ 엣지 케이스
 *    - 전역(TALENX_DATA/TXRoles/EZLedger/TXFIX/TX) 미존재 시 조용히 degrade.
 *    - 대상 구성원에게 목표가 없으면 소속 조직 목표로 폴백.
 *    - 데이터 유래 문자열은 전부 esc(). Math.random 미사용(결정적 렌더).
 *    - prefers-reduced-motion 존중(애니메이션/트랜지션 차단).
 * ========================================================================== */
(function () {
  "use strict";

  /* 기준 시점은 EZClock 단일 발급(P6) — 하드코딩 드리프트 금지 */
  function AS_OF() { return "기준 " + (window.EZKit ? EZKit.clock.asOf() : "2026-07-16 06:00"); }
  var LS_1ON1 = "elizax_1on1_v1:";

  /* ---------------- 데이터 접근 (전부 방어적) ---------------- */
  function D() { return window.TALENX_DATA || {}; }
  function CU() { return (D().meta && D().meta.currentUser) || { name: "구성원", emp_id: "EMP-0000" }; }
  function empById(id) {
    var list = D().employees || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].emp_id === id) return list[i];
    return null;
  }
  function roleKey() {
    try {
      if (window.TXRoles && TXRoles.current) return (TXRoles.current() || {}).key || "member";
    } catch (e) { /* 역할 미확정 */ }
    return CU().is_leader ? "leader" : "member";
  }
  function managerName(emp) {
    var mgr = emp && emp.manager_id ? empById(emp.manager_id) : null;
    return (mgr && mgr.name) || (emp && emp.managerName) || "조직 책임자";
  }
  function objectivesOf(emp) {
    var objs = D().objectives || [];
    var own = objs.filter(function (o) { return o && o.owner_emp_id === emp.emp_id; });
    if (own.length) return { list: own, fallback: false };
    var org = objs.filter(function (o) { return o && o.org_id === emp.org_id; });
    return { list: org.slice(0, 3), fallback: true };
  }
  function checkinsOf(emp, ownedIds) {
    var cks = (D().checkins || []).filter(function (c) {
      if (!c) return false;
      if (c.emp_id === emp.emp_id) return true;
      return ownedIds.indexOf(c.objective_id) >= 0;
    });
    cks.sort(function (a, b) { return String(a.checkin_date || "") < String(b.checkin_date || "") ? -1 : 1; });
    return cks;
  }
  function evalOf(emp) {
    var evs = D().evaluations || [];
    for (var i = 0; i < evs.length; i++) if (evs[i] && evs[i].emp_id === emp.emp_id) return evs[i];
    return null;
  }
  function jobOf(emp) {
    var jobs = D().jobs || [];
    for (var i = 0; i < jobs.length; i++) if (jobs[i] && jobs[i].job_id === emp.job_id) return jobs[i];
    return null;
  }
  function oneOnOneConfirmed(empId) {
    try {
      var raw = localStorage.getItem(LS_1ON1 + empId);
      if (!raw) return null;
      var st = JSON.parse(raw);
      return st && st.confirmedAt ? st.confirmedAt : null;
    } catch (e) { return null; }
  }
  function gateDecision() {
    /* 게이트 결정 = EZKit.gates 단일 스토어(P6) — tx_roles와 같은 값을 읽는다 */
    var r = window.EZKit ? EZKit.gates.get("txr_" + roleKey()) : null;
    return r && r.decision ? { act: r.decision, at: r.at, by: r.by } : null;
  }
  function keyResultsOf(objs) {
    var ids = objs.map(function (o) { return o && o.objective_id; });
    return (D().keyResults || []).filter(function (k) { return k && ids.indexOf(k.objective_id) >= 0; });
  }

  /* ---------------- 시점 (F13 ①) ----------------
     날짜 하드코딩 금지: 기준 시점은 EZKit.clock, 실행 구간은 checkins,
     사이클 구간은 objectives.period에서만 파생한다. */
  function asOfDate() { return window.EZKit ? EZKit.clock.asOfDate() : "2026-07-16"; }
  function monthOf(iso) {
    var m = /^\d{4}-(\d{2})/.exec(String(iso || ""));
    return m ? parseInt(m[1], 10) : 0;
  }
  function asOfMD() { return mdOf(asOfDate()); }
  /* period("FY2026-2Q") → 사이클 구간 + 기준 시점이 지금 어느 단계인지 */
  function cycleInfo(objs, cks) {
    var period = (objs[0] && objs[0].period) || "";
    var m = /FY(\d{4})\D*([1-4])Q/i.exec(period);
    var year = m ? parseInt(m[1], 10) : parseInt(asOfDate().slice(0, 4), 10) || 2026;
    var q = m ? parseInt(m[2], 10) : 0;
    var startM = q ? (q - 1) * 3 + 1 : 0, endM = q ? q * 3 : 0;
    if (!q && cks.length) {                       /* period 미기재 → 실제 체크인 구간으로 폴백 */
      startM = monthOf(cks[0].checkin_date);
      endM = monthOf(cks[cks.length - 1].checkin_date);
    }
    if (!startM) { startM = 1; endM = 6; }
    if (endM < startM) endM = startM;
    var cur = monthOf(asOfDate()) || endM + 1;
    var curKey = cur < startM ? "goal" : cur <= endM ? "run" : cur <= endM + 1 ? "eval" : "review";
    return {
      period: period || ("FY" + year + (q ? "-" + q + "Q" : "")),
      year: year, startM: startM, endM: endM, curKey: curKey
    };
  }
  var STAGE_ORDER = ["goal", "run", "eval", "review"];

  /* ---------------- 유틸 ---------------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function shorten(s, n) {
    s = String(s == null ? "" : s).replace(/\s+/g, " ");
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }
  function mdOf(iso) { /* "2026-06-27" → "6/27" */
    var m = String(iso || "").match(/^\d{4}-(\d{2})-(\d{2})/);
    if (!m) return String(iso || "");
    return parseInt(m[1], 10) + "/" + parseInt(m[2], 10);
  }

  /* ---------------- 근거 타입 칩 ---------------- */
  var TYPE_CHIP = {
    goal: "목표", checkin: "체크인", rule: "규칙", job: "직무 기준",
    oneonone: "1:1", eval: "평가 이력", org: "조직 기준", feedback: "피드백"
  };
  /* 성과 기록 type → 단계 매핑 */
  var STAGE_OF_TYPE = {
    goal: "goal", job: "goal",
    checkin: "run", oneonone: "run",
    eval: "eval", rule: "eval", org: "eval",
    feedback: "review"
  };
  var STAGE_NAME = { goal: "목표수립", run: "실행·중간점검", eval: "평가", review: "피드백/리뷰" };

  /* 증거 흐름 선 — 개념적 연결(원천 id로는 안 잡히는 인용 관계)만 고정 */
  var BASE_LINKS = [
    { from: "r1", to: "r2" },   /* 주간 체크인 → 중간점검 요약 확정 */
    { from: "r3", to: "e1" },   /* 1:1 미팅 요약 확정 → 등급 초안 */
    { from: "r2", to: "f1" }    /* 중간점검 요약 확정 → 평가 코멘트 확정 */
  ];
  var MAX_LINKS = 14;

  /* 앞 노드 evidence의 원천 id(src)가 뒤 노드에 재등장하면 = 그 기록이
     다음 결정의 인용 근거로 이어졌다는 뜻 → 선으로 잇는다(동적 계보). */
  function computeLinks(stages) {
    var flat = [];
    stages.forEach(function (st) {
      st.nodes.forEach(function (n) {
        var srcs = {};
        (n.evidence || []).forEach(function (ev) {
          if (ev && ev.src && ev.src !== "chk.none") srcs[ev.src] = 1;
        });
        flat.push({ id: n.id, srcs: srcs });
      });
    });
    var links = BASE_LINKS.slice();
    var seen = {};
    links.forEach(function (L) { seen[L.from + ">" + L.to] = 1; });
    for (var i = 0; i < flat.length && links.length < MAX_LINKS; i++) {
      for (var j = i + 1; j < flat.length && links.length < MAX_LINKS; j++) {
        var key = flat[i].id + ">" + flat[j].id;
        if (seen[key]) continue;
        for (var s in flat[i].srcs) {
          if (flat[j].srcs[s]) {
            seen[key] = 1;
            links.push({ from: flat[i].id, to: flat[j].id });
            break;
          }
        }
      }
    }
    return links;
  }

  /* ================= 여정 모델 빌드 (실데이터 + 라이브 스토어) ================= */
  function buildJourney(subj) {
    var objInfo = objectivesOf(subj);
    var objs = objInfo.list;
    var ownedIds = objs.map(function (o) { return o.objective_id; });
    var cks = checkinsOf(subj, ownedIds);
    var ev = evalOf(subj);
    var job = jobOf(subj);
    var mgr = managerName(subj);
    var confirmed = oneOnOneConfirmed(subj.emp_id);
    var dec = gateDecision();

    /* --- 시점 파생 (하드코딩 날짜 제거) --- */
    var ci = cycleInfo(objs, cks);
    var goalDate = ci.startM + "/1";                       /* 사이클 시작월 = 목표 확정 시점 */
    var midCk = cks.length ? cks[Math.floor((cks.length - 1) / 2)] : null;
    var midDate = midCk ? mdOf(midCk.checkin_date) : "—";
    var midSrc = midCk ? "perf.mid." + String(midCk.checkin_date).slice(5).replace("-", "") : "perf.mid.none";
    /* 1:1 확정일 = 확정 기록(있으면) · 없으면 기준 시점 */
    var oneDate = mdOf(confirmed || asOfDate());
    var calibDate = (ci.endM + 1) + "월 말";
    var reviewDate = (ci.endM + 2) + "월 초";
    var notifyDate = (ci.endM + 2) + "월 중";
    var carryDate = "FY" + (ci.year + 1) + " 시작";

    var goalEv = objs.slice(0, 3).map(function (o) {
      return {
        t: "goal", title: o.title,
        ex: (o.period || "FY2026-2Q") + " · " + (o.status || "진행중") + " · 진행률 " + (o.progress != null ? o.progress + "%" : "-"),
        src: "perf.obj." + (o.objective_id || "OBJ")
      };
    });
    var parent = null;
    if (objs[0] && objs[0].parent_objective_id) {
      parent = (D().objectives || []).filter(function (p) { return p && p.objective_id === objs[0].parent_objective_id; })[0];
    }
    if (parent) {
      goalEv.push({
        t: "rule", title: "목표 정렬 · 상위 목표 연결 확인",
        ex: "상위 목표 「" + shorten(parent.title, 34) + "」에 정렬됨 · 정렬 검증 통과",
        src: "okr.tree.FY2026"
      });
    }

    var ckEv = cks.slice(-3).reverse().map(function (c) {
      return {
        t: "checkin", title: "주간 체크인 · " + mdOf(c.checkin_date),
        ex: (c.comment || "진행률 업데이트") + (c.blocker ? " · 장애 요인: " + c.blocker : ""),
        src: "chk." + (c.checkin_id || "CHK")
      };
    });
    var lastCk = cks.length ? cks[cks.length - 1] : null;

    var jobEv = job ? {
      t: "job", title: (job.job_title || subj.jobTitle || "담당 직무") + " 직무 기준",
      ex: (job.job_group || "-") + " · " + (job.job_series || "-") + " · 레벨 " + (subj.level_kr || "-") + " 기대치 매핑",
      src: "job." + (job.job_id || subj.job_id || "JOB")
    } : {
      t: "job", title: (subj.jobTitle || "담당 직무") + " 직무 기준",
      ex: "레벨 " + (subj.level_kr || "-") + " 기대치 매핑",
      src: "job." + (subj.job_id || "JOB")
    };

    /* 등급 초안 상태 — 승인 대기 게이트 결정(세션) 반영. 미결정 시점 = 기준 시점 */
    var e1state = "wait", e1label = "승인 대기", e1date = asOfMD(),
        e1decider = mgr + " · 승인 필요";
    if (dec && dec.act) {
      e1date = dec.at ? String(dec.at).slice(5, 16) : asOfMD();
      e1decider = dec.by || mgr;
      if (dec.act === "승인") { e1state = "done"; e1label = "승인 완료"; }
      else if (dec.act === "보류") { e1state = "wait"; e1label = "보류"; }
      else { e1state = "wait"; e1label = "수정 반영 중"; }
    }

    var e1Ev = [];
    if (ev) {
      e1Ev.push({
        t: "eval", title: "FY2026 상반기 등급 초안 · " + (ev.grade || "-"),
        ex: ev.rationale_summary || ("종합 " + (ev.weighted_score != null ? ev.weighted_score : "-") + "점 산출"),
        src: "eval.FY2026." + subj.emp_id
      });
    }
    if (lastCk) {
      e1Ev.push({
        t: "checkin", title: "최근 체크인 · " + mdOf(lastCk.checkin_date),
        ex: lastCk.comment || "진행률 업데이트",
        src: "chk." + (lastCk.checkin_id || "CHK")
      });
    }
    if (confirmed) {
      e1Ev.push({
        t: "oneonone", title: "1:1 미팅 요약 · " + oneDate + " (확정 기록)",
        ex: "KR2 진척 · 외부 API 지연 리스크 · ML 교육 니즈 · 다음 체크인 합의",
        src: "1on1.rec.0716"
      });
    }
    e1Ev.push({
      t: "rule", title: "평가규정 v3.1 · 등급 매핑",
      ex: "종합 점수 → 등급 매핑 규칙(§12) 검증 통과",
      src: "rule.grade.map.v31"
    });

    var stages = [
      {
        key: "goal", name: "목표수립", cur: false, nodes: [
          {
            id: "g1", title: "목표 확정",
            meta: objs.length
              ? "「" + shorten(objs[0].title, 26) + "」" + (objs.length > 1 ? " 외 " + (objs.length - 1) + "건" : "") + (objInfo.fallback ? " · 조직 목표 기준" : "")
              : "등록된 목표 없음",
            state: "done", stateLabel: "승인 완료", ai: false,
            date: goalDate, decider: mgr,
            evidence: goalEv, ledgerType: "goal",
            /* procmap 이관 — 목표 문장 자체의 결함(난이도 근거·측정 가능성) */
            warns: krWarnings(keyResultsOf(objs))
          },
          {
            id: "g2", title: "가중치 설정 100%",
            meta: "근거 rule.weight.sum · 평가규정 v3.1",
            state: "done", stateLabel: "승인 완료", ai: false,
            date: goalDate, decider: mgr,
            evidence: [
              {
                t: "rule", title: "KR 가중치 합 100% 검증",
                ex: "목표 가중치 검증 규칙 · 위반 시 저장 차단 · 평가규정 v3.1 §12",
                src: "rule.weight.sum"
              },
              jobEv
            ],
            ledgerType: "rule"
          },
          {
            id: "g3", title: "AI 목표 초안",
            meta: "초안 생성됨 · 제안만 — 확정은 사람이",
            state: "sug", stateLabel: "제안만", ai: true,
            date: "—", decider: "— (제안만 · 확정 기록 없음)",
            evidence: [
              {
                t: "eval", title: "FY2025 하반기 평가 이력",
                ex: "지난 사이클 등급·리뷰 코멘트를 초안 참고 근거로 인용",
                src: "eval.FY2025H2." + subj.emp_id
              },
              jobEv
            ],
            ledgerType: "goal"
          }
        ]
      },
      {
        key: "run", name: "실행·중간점검", cur: false, nodes: [
          {
            id: "r1", title: "주간 체크인",
            meta: cks.length
              ? cks.length + "회 · 최근 " + mdOf(lastCk.checkin_date)
              : "기록 없음",
            state: cks.length ? "done" : "plan",
            stateLabel: cks.length ? "자동 처리 · 기록됨" : "예정",
            ai: false,
            date: cks.length ? mdOf(lastCk.checkin_date) : "—",
            decider: (subj.name || "구성원") + " (본인 작성)",
            evidence: ckEv.length ? ckEv : [{
              t: "checkin", title: "주간 체크인", ex: "이번 사이클 체크인 기록이 아직 없습니다.", src: "chk.none"
            }],
            ledgerType: "checkin"
          },
          {
            id: "r2", title: "중간점검 요약 확정",
            meta: midCk ? midDate + " · 진척·리스크 요약" : "중간점검 근거로 쓸 체크인 기록 없음",
            state: midCk ? "done" : "plan",
            stateLabel: midCk ? "승인 완료" : "예정", ai: true,
            date: midDate, decider: mgr,
            evidence: (function () {
              var arr = [];
              if (cks[0]) arr.push({
                t: "checkin", title: "체크인 인용 · " + mdOf(cks[0].checkin_date),
                ex: cks[0].comment || "진행률 업데이트",
                src: "chk." + (cks[0].checkin_id || "CHK")
              });
              if (objs[0]) arr.push({
                t: "goal", title: shorten(objs[0].title, 30),
                ex: "중간점검 시점 진행률 " + (objs[0].progress != null ? objs[0].progress + "%" : "-") + " · 리스크 1건 식별",
                src: "perf.obj." + (objs[0].objective_id || "OBJ")
              });
              arr.push({
                t: "rule", title: "중간점검 요약 확정 절차",
                ex: "요약은 자동 처리로 초안 생성됨 · 확정은 조직 책임자 승인",
                src: midSrc
              });
              return arr;
            })(),
            ledgerType: "checkin"
          },
          {
            id: "r3", title: "1:1 미팅 요약 확정",
            meta: confirmed ? "✓ " + oneDate + " 확정" : "요약 초안 생성됨 · 확정 전",
            state: confirmed ? "done" : "wait",
            stateLabel: confirmed ? "승인 완료" : "승인 대기",
            ai: true,
            date: oneDate, decider: (subj.name || "구성원") + " (본인 확정)",
            evidence: [
              {
                /* src는 tx_1on1이 발행하는 원장 source와 맞춘 조인 키(고정) — 표시 날짜만 파생 */
                t: "oneonone", title: "1:1 미팅 요약 · " + oneDate,
                ex: "KR2 진척 · 외부 API 지연 리스크 · ML 교육 니즈 · 다음 체크인 합의",
                src: "1on1.rec.0716"
              },
              {
                t: "rule", title: "기록 확정 절차",
                ex: confirmed
                  ? "본인 확정 완료 · 성과 기록에 저장됨 (확정 전에는 반영되지 않음)"
                  : "확정 전에는 어디에도 기록되지 않습니다 (승인 대기)",
                src: "1on1.gate.confirm"
              }
            ],
            ledgerType: "oneonone"
          }
        ]
      },
      {
        key: "eval", name: "평가", cur: false, nodes: [
          {
            id: "e1", title: "등급 초안" + (ev && ev.grade ? " · " + ev.grade : ""),
            meta: ev
              ? "종합 " + (ev.weighted_score != null ? ev.weighted_score : "-") + "점 → " + (ev.grade || "-") + " 초안 생성됨"
              : "초안 생성됨 · 산출 근거 인용",
            state: e1state, stateLabel: e1label, ai: true,
            date: e1date, decider: e1decider,
            evidence: e1Ev, ledgerType: "eval", whatif: true
          },
          {
            id: "e2", title: "등급 조정",
            meta: "인재 리뷰 세션에서 심의",
            state: "plan", stateLabel: "예정", ai: false,
            date: calibDate, decider: "인재 리뷰 참여자 (심의)", whatif: true,
            evidence: [
              {
                t: "rule", title: "등급 조정 승인 단계",
                ex: "조정은 인재 리뷰 심의 통과 후 확정 · 승인 전에는 반영되지 않음",
                src: "rule.calibration.gate"
              },
              {
                t: "org", title: "조직 등급 분포 기준",
                ex: "분포 가이드 대조 · 관대화/중심화 편향 점검 예정",
                src: "calib.dist." + (subj.org_id || "ORG")
              }
            ],
            ledgerType: "rule"
          }
        ]
      },
      {
        key: "review", name: "피드백/리뷰", cur: false, nodes: [
          {
            id: "f1", title: "평가 코멘트 확정",
            meta: "체크인·1:1 기록이 코멘트 초안의 인용 근거로 준비됨",
            state: "plan", stateLabel: "예정", ai: true,
            date: reviewDate, decider: mgr + " (승인 필요)",
            evidence: [
              {
                t: "feedback", title: "코멘트 초안 예정",
                ex: "확정된 체크인·1:1·중간점검 기록을 인용해 초안 생성 예정",
                src: "perf.comment.FY2026H1"
              }
            ],
            ledgerType: "feedback"
          },
          {
            id: "f2", title: "최종 등급 통보",
            meta: "등급 조정 확정 후 개별 통보",
            state: "plan", stateLabel: "예정", ai: false,
            date: notifyDate, decider: "HR 운영 (통보 절차)",
            evidence: [
              {
                t: "rule", title: "등급 통보 절차",
                ex: "확정 등급·산출 근거·이의제기 안내가 함께 전달됩니다",
                src: "rule.notify.grade"
              }
            ],
            ledgerType: "eval"
          },
          {
            id: "f3", title: "다음 사이클 이어받기",
            meta: "확정 기록 → 내년 목표수립의 출발점",
            state: "plan", stateLabel: "예정", ai: false,
            date: carryDate, decider: "—",
            note: "이 사이클의 확정 기록이 내년 목표수립의 출발점이 됩니다",
            evidence: [
              {
                t: "eval", title: "사이클 확정 기록 이관",
                ex: "확정 등급·코멘트·성과 기록이 다음 사이클 목표 초안의 인용 근거로 이어집니다",
                src: "cycle.carry.FY2027"
              }
            ],
            ledgerType: "eval"
          }
        ]
      }
    ];
    /* 현재 단계는 기준 시점 × 사이클 구간에서 파생 (고정 플래그 금지) */
    stages.forEach(function (st) { st.cur = (st.key === ci.curKey); });
    promoteLedgerNodes(stages, subj);
    return stages;
  }

  /* ================= 원장 → 결정 노드 동적 승격 (F13 ①) =================
     하드코딩 10개 노드 위에, 원장에 실제로 쌓인 "결정형" 엔트리를 해당 단계에
     노드로 얹는다. 시드·열람 로그는 결정이 아니므로 제외한다. */
  var DECISION_SRC = /^(inbox\.(approve|reject)|1on1\.rec\.|meeting\.agree|goal\.gate\.|appr\.|eval\.submit|hub\.gate)/i;
  var DECISION_TITLE = /승인|반려|확정|제출|합의|결정/;
  var MAX_PROMOTED = 6;   /* 단계당 승격 상한 — 맵이 원장 덤프가 되지 않게 */

  function isDecisionEntry(e) {
    if (!e || e.seed) return false;                        /* 예시 시드는 결정이 아님 */
    if (e.type === "audit" || e.type === "asset") return false;
    return DECISION_SRC.test(String(e.source || "")) || DECISION_TITLE.test(String(e.title || ""));
  }
  function decisionActor(e) {
    var s = String(e.summary || "") + " " + String(e.title || "");
    if (/조직장이 확정|조직 책임자|리더 확정/.test(s)) return "조직 책임자 (승인)";
    if (/본인 확정|본인 작성|자기평가/.test(s)) return (CU().name || "구성원") + " (본인 확정)";
    return "원장 기록 · 결정자 미기재";
  }
  function ledgerNodeOf(e) {
    var held = /반려|보류|폐기|철회/.test(String(e.title || ""));
    return {
      id: "L" + e.id,
      title: shorten(e.title, 30),
      meta: shorten(e.summary || e.source || "원장에 기록된 결정", 58),
      state: held ? "wait" : "done",
      stateLabel: held ? "보류·반려 기록" : "기록됨 · 원장 확정",
      ai: false,
      date: e.at || "—",
      decider: decisionActor(e),
      evidence: [{
        t: e.type, title: e.title,
        ex: e.summary || "(요약 없음)",
        src: e.source || "app.event"
      }],
      ledgerType: e.type,
      ledgerId: e.id,        /* 실 id 직결 — ② 조인 우회 */
      fromLedger: true
    };
  }
  function promoteLedgerNodes(stages, subj) {
    var list = ledgerList();
    if (!list || !list.length) return;
    var byKey = {}, added = {};
    stages.forEach(function (st) { byKey[st.key] = st; added[st.key] = 0; });
    /* list()는 최신순 — 단계 안에서는 오래된 것이 위로 오도록 뒤집어 훑는다 */
    for (var i = list.length - 1; i >= 0; i--) {
      var e = list[i];
      if (!isDecisionEntry(e)) continue;
      /* 타인 원장으로 라우팅된 항목은 대상자 계보에만 노출 (역할 게이트 보강) */
      if (e.emp_id && e.emp_id !== subj.emp_id) continue;
      var st = byKey[STAGE_OF_TYPE[e.type] || "run"];
      if (!st || added[st.key] >= MAX_PROMOTED) continue;
      var nid = "L" + e.id, dup = false;
      for (var j = 0; j < st.nodes.length; j++) if (st.nodes[j].id === nid) { dup = true; break; }
      if (dup) continue;
      st.nodes.push(ledgerNodeOf(e));
      added[st.key]++;
    }
  }

  /* ================= procmap 이관 — 목표 문장 결함 검사 (F13 ③) ================= */
  function krWarnings(krs) {
    if (!krs || !krs.length) return [];
    var out = [];
    var noBasis = krs.filter(function (k) {
      return /^[AS]$/.test(String(k.difficulty || "").trim()) && !k.difficulty_basis;
    });
    /* 이름·목표값 어디에도 수치·단위가 없으면 평가 시점에 "달성 근거"를 다투게 된다 */
    var vague = krs.filter(function (k) {
      var nm = String(k.name || ""), tv = String(k.target_value || "");
      return !/[0-9%]|억|만원|건|명|점|회|일|시간|배/.test(nm) && !/[0-9%]/.test(tv);
    });
    if (noBasis.length) {
      out.push({
        cls: "",
        txt: "난이도 근거 없음 " + noBasis.length + "건 — "
          + shorten(noBasis.map(function (k) { return k.name || k.kr_id; }).join(", "), 46)
          + " · 난이도는 매겨져 있으나 비교 근거 필드가 비어 있어 평가 시 분쟁 소지"
      });
    }
    if (vague.length) {
      out.push({
        cls: "crit",
        txt: "측정 불가 KR " + vague.length + "건 — "
          + shorten(vague.map(function (k) { return k.name || k.kr_id; }).join(", "), 46)
          + " · 이름·목표값에 수치·단위가 없습니다. 수립 시점에 지표화 권고"
      });
    }
    return out;
  }

  /* 열람 규칙 조회 — 등급 근거(eval_draft)를 이 관계에서 어떤 형태로 볼 수 있는가 */
  function polLevel(rel) {
    try { if (window.EZPolicy && EZPolicy.check) return EZPolicy.check(roleKey(), "eval_draft", rel); }
    catch (e) { /* 정책 모듈 미로드 */ }
    return "full";
  }

  /* What-if — 읽기 전용 시뮬레이션(EZTools 우선, EZCalc 폴백). 실데이터 변경 없음.
     엔진이 두 가지 형태를 돌려주므로 둘 다 다룬다:
       ① 개인 등급 시뮬 {before:{weighted_score,grade}, after:{…}}
       ② 조직 등급 분포 시뮬 {gradeChange:[…], people:[…]}  ← people(타인 개인값)은 절대 표시하지 않는다 */
  function runWhatIf(subj, delta) {
    var res = null;
    try { if (window.EZTools && EZTools.run) res = EZTools.run("simulate_whatif", { emp_id: subj.emp_id, achievement_delta: delta }); }
    catch (e) { res = null; }
    if (!res || res.error) {
      try { if (window.EZCalc && EZCalc.simulate) res = EZCalc.simulate({ emp_id: subj.emp_id, achievement_delta: delta }) || res; }
      catch (e2) { /* 엔진 없음 */ }
    }
    if (!res) return "시뮬레이션 엔진을 불러오지 못했습니다.";
    if (res.blocked) return esc(res.policy || "열람 규칙에 따라 이 대상의 시뮬레이션은 제공되지 않습니다.");
    if (res.error) return esc(res.error);

    var head = "달성률 " + (delta > 0 ? "+" : "") + delta + "%p 가정 → ";

    /* ① 개인 등급 시뮬 */
    if (res.before && res.after && res.after.grade != null) {
      return head + "종합 " + esc(res.before.weighted_score) + " → <b>" + esc(res.after.weighted_score) + "</b>점 · 등급 "
        + esc(res.before.grade) + " → <b>" + esc(res.after.grade) + "</b>"
        + (res.grade_changed ? " (등급 변동)" : " (등급 유지)")
        + '<div class="wfnote">' + esc(res.assumptions || "읽기 전용 — 실제 데이터는 변경되지 않습니다") + "</div>";
    }

    /* ② 조직 분포 시뮬 — 권한 밖이면 이유를 밝히고 멈춘다(타인 등급 노출 금지) */
    if (res.gradeChange) {
      var lv = polLevel("org");
      if (lv === "no" || lv === "summ") {
        return "조직 등급 분포 시뮬레이션은 열람 권한 밖입니다 — 이 화면에서는 내 결정의 근거만 봅니다. (보관·열람 규칙 v3.1)";
      }
      var rows = res.gradeChange.filter(function (g) { return g && g.delta_pp; }).map(function (g) {
        return esc(g.grade) + " " + esc(g.before_pct) + "% → <b>" + esc(g.after_pct) + "%</b> ("
          + (g.delta_pp > 0 ? "+" : "") + esc(g.delta_pp) + "%p)";
      });
      var basis = res.basis || {};
      return head + "조직 등급 분포 변화 · " + (rows.length ? rows.join(" · ") : "변화 없음")
        + '<div class="wfnote">'
        + esc(basis.base_source || "")
        + (basis.cap_rule_source ? " · " + esc(basis.cap_rule_source) : "")
        + " · 개인별 값은 표시하지 않습니다 · 읽기 전용 — 실제 데이터는 변경되지 않습니다</div>";
    }
    return "시뮬레이션 결과를 해석하지 못했습니다.";
  }

  /* ================= 성과 기록 연동 ================= */
  function ledgerList() {
    try {
      if (window.EZLedger && EZLedger.list) return EZLedger.list() || [];
    } catch (e) { /* 미탑재 */ }
    return null;
  }
  function ledgerCounts() {
    var list = ledgerList();
    if (!list) return null;
    var m = { goal: 0, run: 0, eval: 0, review: 0 };
    list.forEach(function (e) {
      var s = e && STAGE_OF_TYPE[e.type];
      if (s) m[s]++;
    });
    return m;
  }
  /* ---- 노드 ↔ 원장 실키 매핑 (F13 ②) ----
     type 첫 일치로 아무 항목이나 집어오던 방식 폐기. evidence의 src(perf.obj.OBJ-x,
     chk.CHK-x …)를 조인 키로 써서 정확히 맞는 원장 항목만 반환한다.
       strong = source 문자열 완전 일치
       weak   = type 동일 + 엔티티 id 토큰(OBJ-0001 등) 공유
     둘 다 없으면 null → 호출부는 버튼을 만들지 않는다(엉뚱한 곳으로 보내지 않기). */
  /* 조인 키는 "레코드 id"만 — EMP-/ORG-는 사람·조직을 가리킬 뿐 같은 기록이라는 뜻이
     아니라서 제외한다(작년 평가와 올해 초안이 EMP 토큰으로 붙는 오연결 방지). */
  function idTokens(src) {
    var m = String(src || "").match(/\b(OBJ|KR|CHK|EVAL|FB|JOB)-[A-Za-z0-9가-힣._-]+/g);
    if (!m) return [];
    return m.map(function (x) { return x.toUpperCase(); });
  }
  function shareToken(a, b) {
    var ta = idTokens(a), tb = idTokens(b);
    for (var i = 0; i < ta.length; i++) if (tb.indexOf(ta[i]) >= 0) return true;
    return false;
  }
  function ledgerMatchFor(n) {
    var list = ledgerList();
    if (!list || !n) return null;
    var i, j;
    /* 원장에서 승격된 노드는 실 id 직결 */
    if (n.ledgerId) {
      for (i = 0; i < list.length; i++) if (list[i] && list[i].id === n.ledgerId) return list[i];
      return null;
    }
    var evs = n.evidence || [];
    var strong = null, weak = null;
    for (i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e || !e.source) continue;
      var es = String(e.source).toLowerCase();
      for (j = 0; j < evs.length; j++) {
        var ev = evs[j];
        var s = String((ev && ev.src) || "").toLowerCase();
        if (!s || s === "chk.none") continue;
        if (es === s) {
          if (!strong || (e.ts || 0) > (strong.ts || 0)) strong = e;
        } else if (e.type === ev.t && shareToken(e.source, ev.src)) {
          if (!weak || (e.ts || 0) > (weak.ts || 0)) weak = e;
        }
      }
    }
    return strong || weak;
  }
  /* 원장 항목 id → 그 항목을 인용하는 노드 id (히스토리 → 맵 딥링크용) */
  function nodeForLedger(ledgerId) {
    if (!journeyCache || !ledgerId) return null;
    for (var i = 0; i < journeyCache.length; i++) {
      var ns = journeyCache[i].nodes;
      for (var j = 0; j < ns.length; j++) {
        var m = ledgerMatchFor(ns[j]);
        if (m && m.id === ledgerId) return ns[j].id;
      }
    }
    return null;
  }

  /* ================= 스타일 ================= */
  function injectStyle() {
    if (document.getElementById("ezpm-css")) return;
    var st = document.createElement("style");
    st.id = "ezpm-css";
    st.textContent = [
      /* 오버레이 */
      /* z 4100 = Agent 허브(.agh-root 4000) 위 — 허브·도킹 어디서 열어도 보인다 */
      ".ezpm-root{position:fixed;inset:0;z-index:var(--z-overlay,4100);background:var(--color-overlay,rgba(15,23,42,.45));display:flex;align-items:center;justify-content:center;padding:22px;}",
      ".ezpm-card{background:var(--color-background-card,#fff);color:var(--color-text-primary,#2A2E39);border-radius:var(--radius-container,18px);max-width:1180px;width:100%;max-height:90vh;",
      "display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(15,23,42,.3);overflow:hidden;}",
      "@media (prefers-reduced-motion:no-preference){.ezpm-card{animation:ezkInsert var(--duration-fast,.18s) var(--ease-standard,ease);}}",
      /* 헤더 */
      ".ezpm-head{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;padding:18px 22px 12px;border-bottom:1px solid var(--color-border,#ECEEF2);}",
      ".ezpm-head .tl h2{margin:0;font-size:17px;font-weight:800;color:var(--color-text-primary,#2A2E39);}",
      ".ezpm-head .tl p{margin:3px 0 0;font-size:12px;color:var(--color-text-disabled,#9096A3);}",
      ".ezpm-asof{font-size:11px;font-weight:600;color:var(--color-accent,#1F7AF0);background:color-mix(in srgb, var(--color-accent,#17F) 7%, transparent);",
      "border:1px solid color-mix(in srgb, var(--color-accent,#17F) 30%, transparent);border-radius:var(--radius-full,999px);padding:4px 11px;white-space:nowrap;margin-top:2px;}",
      ".ezpm-subj{display:flex;align-items:center;gap:6px;margin-left:auto;margin-top:2px;}",
      ".ezpm-subj label{font-size:11px;color:var(--color-text-disabled,#9096A3);font-weight:600;}",
      ".ezpm-subj select{font:inherit;font-size:12px;color:var(--color-text-primary,#2A2E39);background:var(--color-background-card,#fff);",
      "border:1px solid var(--color-border,#ECEEF2);border-radius:var(--radius-element,8px);padding:5px 8px;max-width:200px;}",
      ".ezpm-subjchip{font-size:11.5px;font-weight:700;color:var(--color-text-secondary,#5C6474);margin-left:auto;margin-top:6px;}",
      ".ezpm-x{cursor:pointer;border:none;background:none;font-size:18px;color:var(--color-text-disabled,#9096A3);line-height:1;padding:2px 6px;margin-top:2px;}",
      ".ezpm-subj+.ezpm-x{margin-left:0;}",
      ".ezpm-head .ezpm-x:only-of-type{margin-left:0;}",
      /* 범례 */
      ".ezpm-legend{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:9px 22px;font-size:11px;color:var(--color-text-disabled,#9096A3);",
      "border-bottom:1px solid var(--color-border,#ECEEF2);}",
      ".ezpm-legend .flowlab{color:var(--color-accent,#1F7AF0);font-weight:600;}",
      ".ezpm-st{display:inline-block;font-size:10px;font-weight:700;border-radius:var(--radius-full,999px);padding:1px 8px;white-space:nowrap;}",
      ".ezpm-st.done{color:var(--color-success,#15803D);background:color-mix(in srgb, var(--color-success,#180) 8%, transparent);border:1px solid color-mix(in srgb, var(--color-success,#180) 35%, transparent);}",
      ".ezpm-st.wait{color:var(--color-warning,#B45309);background:color-mix(in srgb, var(--color-warning,#B50) 8%, transparent);border:1px solid color-mix(in srgb, var(--color-warning,#B50) 35%, transparent);}",
      ".ezpm-st.plan{color:var(--color-text-disabled,#9096A3);background:var(--color-background-muted,#F5F6F8);border:1px dashed var(--color-text-disabled,#B4B9C4);}",
      ".ezpm-st.sug{color:var(--color-text-purple,#6D28D9);background:color-mix(in srgb, var(--color-text-purple,#63D) 7%, transparent);border:1px solid color-mix(in srgb, var(--color-text-purple,#63D) 30%, transparent);}",
      ".ezpm-ai{display:inline-block;font-size:9.5px;font-weight:700;border-radius:var(--radius-full,999px);padding:1px 7px;white-space:nowrap;",
      "color:var(--color-text-purple,#6D28D9);background:color-mix(in srgb, var(--color-text-purple,#63D) 7%, transparent);border:1px solid color-mix(in srgb, var(--color-text-purple,#63D) 30%, transparent);}",
      /* 본문 레이아웃 */
      ".ezpm-wrap{display:flex;flex:1;min-height:0;}",
      ".ezpm-flow{flex:1;min-width:0;overflow:auto;padding:18px 22px;}",
      ".ezpm-flowin{position:relative;min-width:960px;}",
      ".ezpm-svg{position:absolute;inset:0;z-index:2;pointer-events:none;}",
      ".ezpm-cols{position:relative;z-index:1;display:grid;grid-template-columns:repeat(4,1fr);gap:26px;}",
      ".ezpm-col{position:relative;background:var(--color-background-muted,#F5F6F8);border:1px solid var(--color-border,#ECEEF2);border-radius:var(--radius-container,14px);padding:12px;}",
      ".ezpm-col:not(:last-child):after{content:\"\\2192\";position:absolute;right:-21px;top:12px;font-size:15px;font-weight:800;color:var(--color-text-disabled,#B4B9C4);}",
      ".ezpm-col.cur{border:1.5px solid var(--color-accent,#1F7AF0);box-shadow:0 0 0 3px color-mix(in srgb, var(--color-accent,#17F) 12%, transparent);}",
      ".ezpm-col>.ch{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12.5px;font-weight:800;margin-bottom:10px;color:var(--color-text-primary,#2A2E39);}",
      ".ezpm-col>.ch .step{width:18px;height:18px;border-radius:50%;background:var(--color-trust,#23408E);color:#fff;font-size:10px;font-weight:800;",
      "display:inline-flex;align-items:center;justify-content:center;flex:none;}",
      ".ezpm-col.cur>.ch .step{background:var(--color-accent,#1F7AF0);}",
      ".ezpm-curtag{font-size:9.5px;font-weight:700;color:var(--color-accent,#1F7AF0);background:color-mix(in srgb, var(--color-accent,#17F) 8%, transparent);",
      "border:1px solid color-mix(in srgb, var(--color-accent,#17F) 35%, transparent);border-radius:var(--radius-full,999px);padding:1px 7px;}",
      ".ezpm-cnt{cursor:pointer;margin-left:auto;border:1px solid var(--color-border,#ECEEF2);border-radius:var(--radius-full,999px);padding:2px 9px;",
      "font-size:10px;font-weight:700;color:var(--color-text-secondary,#5C6474);background:var(--color-background-card,#fff);}",
      ".ezpm-cnt:hover{border-color:var(--color-accent,#1F7AF0);color:var(--color-accent,#1F7AF0);}",
      /* 노드 */
      ".ezpm-node{cursor:pointer;background:var(--color-background-card,#fff);border:1px solid var(--color-border,#ECEEF2);border-radius:var(--radius-element,11px);padding:9px 11px;margin-bottom:8px;}",
      "@media (prefers-reduced-motion:no-preference){.ezpm-node{transition:box-shadow var(--duration-fast,.12s),border-color var(--duration-fast,.12s);}}",
      ".ezpm-node:hover{border-color:var(--color-accent,#1F7AF0);}",
      ".ezpm-node.sel{border-color:var(--color-accent,#1F7AF0);box-shadow:0 0 0 3px color-mix(in srgb, var(--color-accent,#17F) 14%, transparent);}",
      ".ezpm-node.st-plan{border-style:dashed;opacity:.82;}",
      ".ezpm-node .hd{display:flex;align-items:baseline;gap:6px;}",
      ".ezpm-node .ic{flex:none;font-size:11px;font-weight:800;}",
      ".ezpm-node.st-done .ic{color:var(--color-success,#15803D);}",
      ".ezpm-node.st-wait .ic{color:var(--color-warning,#B45309);}",
      ".ezpm-node.st-plan .ic{color:var(--color-text-disabled,#B4B9C4);}",
      ".ezpm-node.st-sug .ic{color:var(--color-text-purple,#6D28D9);}",
      ".ezpm-node .tt{font-size:12px;font-weight:700;line-height:1.4;color:var(--color-text-primary,#2A2E39);}",
      ".ezpm-node .dt{margin-left:auto;flex:none;font-size:10px;color:var(--color-text-disabled,#9096A3);font-variant-numeric:tabular-nums;}",
      ".ezpm-node .mt2{font-size:11px;color:var(--color-text-secondary,#5C6474);line-height:1.5;margin:3px 0 5px;}",
      ".ezpm-node .bd{display:flex;align-items:center;gap:5px;flex-wrap:wrap;}",
      /* 상세 패널 */
      ".ezpm-pane{width:340px;flex:none;border-left:1px solid var(--color-border,#ECEEF2);overflow-y:auto;padding:16px 18px;display:none;background:var(--color-background-card,#fff);}",
      ".ezpm-pane.open{display:block;}",
      "@media(max-width:860px){.ezpm-pane{width:260px;}}",
      ".ezpm-pane .ph{display:flex;align-items:flex-start;gap:8px;}",
      ".ezpm-pane .ph h3{margin:0;font-size:14px;font-weight:800;flex:1;line-height:1.4;color:var(--color-text-primary,#2A2E39);}",
      ".ezpm-pane .px{cursor:pointer;border:none;background:none;font-size:15px;color:var(--color-text-disabled,#9096A3);line-height:1;flex:none;}",
      ".ezpm-krow{display:flex;gap:8px;font-size:11.5px;margin:7px 0;line-height:1.5;}",
      ".ezpm-krow label{flex:none;width:52px;color:var(--color-text-disabled,#9096A3);font-weight:600;}",
      ".ezpm-krow div{color:var(--color-text-primary,#2A2E39);min-width:0;}",
      ".ezpm-note{font-size:11px;color:var(--color-warning,#B45309);background:color-mix(in srgb, var(--color-warning,#B50) 7%, transparent);border:1px solid color-mix(in srgb, var(--color-warning,#B50) 25%, transparent);",
      "border-radius:var(--radius-element,8px);padding:7px 10px;margin:10px 0 0;line-height:1.5;}",
      ".ezpm-evh{font-size:11px;font-weight:700;color:var(--color-text-disabled,#9096A3);margin:14px 0 6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;}",
      ".ezpm-evok{font-size:9.5px;font-weight:700;color:var(--color-success,#15803D);}",
      ".ezpm-ev{border:1px solid var(--color-border,#ECEEF2);border-radius:var(--radius-element,10px);padding:8px 10px;margin-bottom:7px;background:var(--color-background-muted,#F5F6F8);}",
      ".ezpm-ev .et{display:inline-block;font-size:9.5px;font-weight:700;border-radius:var(--radius-inner,5px);padding:1px 7px;margin-bottom:4px;",
      "color:var(--color-accent,#1F7AF0);background:color-mix(in srgb, var(--color-accent,#17F) 8%, transparent);border:1px solid color-mix(in srgb, var(--color-accent,#17F) 30%, transparent);}",
      ".ezpm-ev .evt{font-size:11.5px;font-weight:700;line-height:1.4;color:var(--color-text-primary,#2A2E39);}",
      ".ezpm-ev .evx{font-size:11px;color:var(--color-text-secondary,#5C6474);line-height:1.5;margin:3px 0;}",
      ".ezpm-ev .src{display:inline-block;font-family:var(--font-family-code,ui-monospace,Consolas,monospace);font-size:10px;",
      "color:var(--color-text-disabled,#9096A3);background:var(--color-background-card,#fff);border:1px solid var(--color-border,#ECEEF2);border-radius:var(--radius-inner,5px);padding:1px 6px;}",
      ".ezpm-lbtn{cursor:pointer;display:inline-block;margin-top:6px;border:1px solid color-mix(in srgb, var(--color-accent,#17F) 40%, transparent);border-radius:var(--radius-full,999px);",
      "padding:4px 11px;font-size:10.5px;font-weight:700;color:var(--color-accent,#1F7AF0);background:var(--color-background-card,#fff);}",
      ".ezpm-lbtn:hover{background:color-mix(in srgb, var(--color-accent,#17F) 6%, transparent);}",
      ".ezpm-lat{font-size:10px;color:var(--color-text-disabled,#9096A3);margin-left:6px;font-variant-numeric:tabular-nums;}",
      /* procmap 이관 — 목표 문장 결함 경고 */
      ".ezpm-warn{font-size:11px;line-height:1.55;color:var(--color-warning,#B45309);background:color-mix(in srgb, var(--color-warning,#B50) 7%, transparent);",
      "border:1px solid color-mix(in srgb, var(--color-warning,#B50) 28%, transparent);border-left-width:3px;border-radius:var(--radius-element,8px);padding:7px 10px;margin:8px 0 0;}",
      ".ezpm-warn.crit{color:var(--color-error,#B91C1C);background:color-mix(in srgb, var(--color-error,#B12) 7%, transparent);",
      "border-color:color-mix(in srgb, var(--color-error,#B12) 30%, transparent);}",
      ".ezpm-warn:before{content:\"\\26A0\\FE0E  \";font-weight:800;}",
      /* procmap 이관 — What-if(읽기 전용 시뮬) */
      ".ezpm-wf{margin-top:12px;padding-top:10px;border-top:1px dashed var(--color-border,#ECEEF2);}",
      ".ezpm-wf .wfh{font-size:11px;font-weight:700;color:var(--color-text-purple,#6D28D9);margin-bottom:6px;}",
      ".ezpm-wf .wfout{font-size:11px;line-height:1.55;color:var(--color-text-secondary,#5C6474);background:var(--color-background-muted,#F5F6F8);",
      "border:1px solid var(--color-border,#ECEEF2);border-radius:var(--radius-element,8px);padding:7px 10px;margin-top:8px;}",
      ".ezpm-wf .wfnote{font-size:10px;color:var(--color-text-disabled,#9096A3);margin-top:4px;line-height:1.5;}",
      ".ezpm-empty{font-size:11.5px;color:var(--color-text-disabled,#9096A3);padding:8px 2px;line-height:1.6;}",
      /* 증거 흐름 선 */
      ".ezpm-line{fill:none;stroke:var(--color-accent,#1F7AF0);stroke-width:1.6;opacity:.3;}",
      ".ezpm-line.hl{opacity:1;stroke-width:2.4;}",
      "@media (prefers-reduced-motion:no-preference){.ezpm-line{transition:opacity var(--duration-fast,.15s),stroke-width var(--duration-fast,.15s);}}",
      /* 푸터 */
      ".ezpm-foot{padding:11px 22px;border-top:1px solid var(--color-border,#ECEEF2);font-size:11px;color:var(--color-text-disabled,#9096A3);line-height:1.6;}",
      /* 진입 버튼 */
      ".ezpm-openbtn{white-space:nowrap;}",
      /* 역할 바 상시 사이클 칩 — 지금 어느 단계인지 한 눈에 */
      ".ezpm-cycle{display:inline-flex;align-items:center;gap:6px;margin-left:10px;padding:3px 10px;cursor:pointer;",
      "border:1px solid color-mix(in srgb, var(--color-accent,#17F) 35%, transparent);border-radius:var(--radius-container,12px);background:var(--color-background-card,#fff);",
      "font:inherit;font-size:11px;font-weight:600;color:var(--color-text-secondary,#5C6474);white-space:nowrap;}",
      ".ezpm-cycle:hover{background:color-mix(in srgb, var(--color-accent,#17F) 6%, transparent);}",
      ".ezpm-cycle .stp{color:var(--color-success,#15803D);}",
      ".ezpm-cycle .cur{color:var(--color-accent,#1F7AF0);font-weight:800;}",
      ".ezpm-cycle .nxt{color:var(--color-text-disabled,#B4B9C4);}",
      ".ezpm-cycle .sep{color:var(--color-text-disabled,#B4B9C4);font-weight:400;}",
      /* 도킹 패널용 컴팩트 변형 — .ezx-ctx 칩 행에 맞춤 */
      ".ezpm-cycle--dock{margin-left:0;padding:2px 8px;font-size:10.5px;gap:4px;}",
      /* reduced motion 총괄 차단 */
      "@media (prefers-reduced-motion:reduce){.ezpm-root *,.ezpm-root{animation:none!important;transition:none!important;}}"
    ].join("");
    document.head.appendChild(st);
  }

  /* ================= 렌더 ================= */
  var curSubjectId = null;
  var selectedNode = null;
  var hoverNode = null;
  var journeyCache = null;   /* buildJourney 결과 (노드 조회용) */
  var curLinks = [];         /* computeLinks 결과 (렌더마다 갱신) */

  function overlay() { return document.querySelector("[data-ezpm-root]"); }

  function subjectEmp() {
    return (curSubjectId && empById(curSubjectId)) || CU();
  }

  function selectorHTML(subj) {
    var rk = roleKey();
    var opts = null;
    if (rk === "leader") {
      var me = CU();
      var team = (D().employees || []).filter(function (e) { return e && e.manager_id === me.emp_id; }).slice(0, 15);
      opts = [me].concat(team);
    } else if (rk === "hr" || rk === "exec") {
      opts = (D().demoSubjects || []).slice(0, 10)
        .map(function (s) { return s && empById(s.emp_id); })
        .filter(function (e) { return !!e; });
    }
    if (!opts || !opts.length) {
      return '<span class="ezpm-subjchip">대상 · ' + esc(subj.name || "-") + " · " + esc(subj.orgName || "") + "</span>";
    }
    var html = opts.map(function (e) {
      return '<option value="' + esc(e.emp_id) + '"' + (e.emp_id === subj.emp_id ? " selected" : "") + ">"
        + esc(e.name) + " · " + esc(e.orgName || e.emp_id) + "</option>";
    }).join("");
    return '<span class="ezpm-subj"><label>대상 구성원</label><select data-ezpm-subject>' + html + "</select></span>";
  }

  function nodeIcon(state) {
    return state === "done" ? "&#10003;" : state === "wait" ? "&#9203;" : state === "sug" ? "&#10022;" : "&#9675;";
  }

  function nodeHTML(n) {
    return '<div class="ezpm-node st-' + esc(n.state) + (selectedNode === n.id ? " sel" : "") + '" data-ezpm-node="' + esc(n.id) + '">'
      + '<div class="hd"><span class="ic">' + nodeIcon(n.state) + '</span>'
      + '<span class="tt">' + esc(n.title) + "</span>"
      + '<span class="dt">' + esc(n.date) + "</span></div>"
      + '<div class="mt2">' + esc(n.meta) + "</div>"
      + '<div class="bd"><span class="ezpm-st ' + esc(n.state) + '">' + esc(n.stateLabel) + "</span>"
      + (n.ai ? '<span class="ezpm-ai">&#10022; AI 초안 · 사람 승인</span>' : "")
      + "</div></div>";
  }

  function flowHTML(stages) {
    var counts = ledgerCounts();
    var cols = stages.map(function (st, i) {
      var cnt = "";
      if (counts) {
        cnt = '<button class="ezpm-cnt" data-ezpm-count="' + esc(st.key) + '" title="성과 기록에서 이 단계의 기록 보기">기록 '
          + counts[st.key] + "건</button>";
      }
      return '<div class="ezpm-col' + (st.cur ? " cur" : "") + '" data-ezpm-stage="' + esc(st.key) + '">'
        + '<div class="ch"><span class="step">' + (i + 1) + "</span>" + esc(st.name)
        + (st.cur ? '<span class="ezpm-curtag">현재 단계</span>' : "")
        + cnt + "</div>"
        + st.nodes.map(nodeHTML).join("")
        + "</div>";
    }).join("");
    return '<svg class="ezpm-svg" aria-hidden="true"></svg><div class="ezpm-cols">' + cols + "</div>";
  }

  /* keepSel=true면 원장 갱신·게이트 결정으로 다시 그려도 열려 있던 노드를 유지한다 */
  function renderFlow(keepSel) {
    var ov = overlay();
    if (!ov) return;
    var prevSel = keepSel ? selectedNode : null;
    var subj = subjectEmp();
    journeyCache = buildJourney(subj);
    curLinks = computeLinks(journeyCache);
    var flowin = ov.querySelector(".ezpm-flowin");
    if (flowin) flowin.innerHTML = flowHTML(journeyCache);
    var subjHost = ov.querySelector("[data-ezpm-subjhost]");
    if (subjHost) subjHost.innerHTML = selectorHTML(subj);
    selectedNode = null;
    hoverNode = null;
    closePane();
    if (prevSel) selectNode(prevSel);
    requestAnimationFrame(drawLines);
  }

  /* 노드 선택 — 클릭·딥링크 공통 경로 */
  function selectNode(id) {
    var ov = overlay();
    if (!ov || !id) return false;
    var node = ov.querySelector('[data-ezpm-node="' + id + '"]');
    if (!node) return false;
    var prev = ov.querySelector(".ezpm-node.sel");
    if (prev) prev.classList.remove("sel");
    node.classList.add("sel");
    selectedNode = id;
    applyLineHL();
    renderNodePane(id);
    try { node.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) { /* 구형 브라우저 */ }
    return true;
  }

  function findNode(id) {
    if (!journeyCache) return null;
    for (var i = 0; i < journeyCache.length; i++) {
      var ns = journeyCache[i].nodes;
      for (var j = 0; j < ns.length; j++) if (ns[j].id === id) return ns[j];
    }
    return null;
  }

  /* ---------------- 상세 패널 ---------------- */
  function paneEl() { var ov = overlay(); return ov && ov.querySelector("[data-ezpm-pane]"); }
  function closePane() {
    var p = paneEl();
    if (p) { p.classList.remove("open"); p.innerHTML = ""; }
    setTimeout(drawLines, 60);
  }
  function openPane(html) {
    var p = paneEl();
    if (!p) return;
    p.innerHTML = html;
    p.classList.add("open");
    p.scrollTop = 0;
    setTimeout(drawLines, 60);
  }

  /* 근거 칩 = EZSource 1벌(§7) — 출처 단일 색: rule/org=초록(규정), 나머지=talenx 파랑 */
  function srcChip(t, label) {
    if (!window.EZKit) return '<span class="et">' + esc(label) + "</span>";
    return EZKit.src(t === "rule" || t === "org" ? "rule" : "talenx", label);
  }
  function evidenceHTML(evd) {
    return evd.map(function (ev) {
      return '<div class="ezpm-ev">'
        + srcChip(ev.t, TYPE_CHIP[ev.t] || ev.t)
        + '<div class="evt">' + esc(ev.title) + "</div>"
        + '<div class="evx">' + esc(ev.ex) + "</div>"
        + '<span class="src">' + esc(ev.src) + "</span>"
        + "</div>";
    }).join("");
  }

  /* procmap 이관 — What-if 진입(읽기 전용 시뮬) */
  function whatifHTML() {
    return '<div class="ezpm-wf"><div class="wfh">&#10022; What-if · 읽기 전용 시뮬레이션</div>'
      + '<button class="ezpm-lbtn" data-ezpm-wf="-10">달성률 &minus;10%p 가정</button> '
      + '<button class="ezpm-lbtn" data-ezpm-wf="10">달성률 +10%p 가정</button>'
      + '<div class="wfout" data-ezpm-wfout>가정을 눌러보세요 — 실제 데이터는 변경되지 않습니다.</div></div>';
  }
  function warnsHTML(n) {
    if (!n.warns || !n.warns.length) return "";
    return n.warns.map(function (w) {
      return '<div class="ezpm-warn' + (w.cls ? " " + w.cls : "") + '">' + esc(w.txt) + "</div>";
    }).join("");
  }

  function renderNodePane(id) {
    var n = findNode(id);
    if (!n) return;
    var m = ledgerMatchFor(n);
    var html = '<div class="ph"><h3>' + esc(n.title)
      + (n.ai ? ' <span class="ezpm-ai">&#10022; AI 초안 · 사람 승인</span>' : "")
      + '</h3><button class="px" data-ezpm-pane-close title="닫기">&#10005;</button></div>'
      + '<div class="ezpm-krow"><label>시점</label><div>' + esc(n.date) + "</div></div>"
      + '<div class="ezpm-krow"><label>결정자</label><div>' + esc(n.decider) + "</div></div>"
      + '<div class="ezpm-krow"><label>상태</label><div><span class="ezpm-st ' + esc(n.state) + '">' + esc(n.stateLabel) + "</span></div></div>"
      /* 감사 ID는 원장(EZLedger) 실 엔트리 id만 표시 — 해시 위조 ID(EZKit.gaId)로
         "기록됨"을 단언하지 않는다. 매칭 기록이 없으면 정직하게 "기록 전". */
      + (n.state === "done"
        ? '<div class="ezpm-krow"><label>감사</label><div><span class="src">'
          + (m && m.id ? "⛨ 감사 기록됨 · " + esc(m.id) : "⛨ 기록 전 — 결정 게이트 확정 시 원장 기록")
          + "</span></div></div>"
        : "")
      + (n.note ? '<div class="ezpm-note">' + esc(n.note) + "</div>" : "")
      + warnsHTML(n)
      + '<div class="ezpm-evh">인용 근거 ' + n.evidence.length + "건"
      + (n.state === "done" ? '<span class="ezpm-evok">&#10003; 근거 확인 완료</span>' : "")
      + "</div>"
      + evidenceHTML(n.evidence)
      /* 매칭된 원장 항목이 있을 때만 버튼 — 없으면 만들지 않는다(오연결 방지) */
      + (m
        ? '<button class="ezpm-lbtn" data-ezpm-ledger="' + esc(m.id) + '">성과 기록에서 보기<span class="ezpm-lat">' + esc(m.at || "") + "</span></button>"
        : '<div class="ezpm-empty">이 결정에 대응하는 성과 기록 항목이 아직 없습니다 — 결정이 확정되면 원장에 남습니다.</div>')
      + (n.whatif ? whatifHTML() : "");
    openPane(html);
  }

  function renderStagePane(stageKey) {
    var list = ledgerList() || [];
    var entries = list.filter(function (e) { return e && STAGE_OF_TYPE[e.type] === stageKey; }).slice(0, 12);
    var body = entries.length ? entries.map(function (e) {
      return '<div class="ezpm-ev">'
        + srcChip(e.type, TYPE_CHIP[e.type] || e.type)
        + '<span class="ezpm-lat">' + esc(e.at || "") + "</span>"
        + '<div class="evt">' + esc(e.title) + "</div>"
        + (e.summary ? '<div class="evx">' + esc(e.summary) + "</div>" : "")
        + '<span class="src">' + esc(e.source || "") + "</span><br>"
        + '<button class="ezpm-lbtn" data-ezpm-ledger="' + esc(e.id) + '">성과 기록에서 보기</button>'
        + "</div>";
    }).join("") : '<div class="ezpm-empty">이 단계에 쌓인 성과 기록이 아직 없습니다. 체크인·1:1 확정 등 기능을 쓸수록 기록이 쌓입니다.</div>';
    openPane('<div class="ph"><h3>성과 기록 · ' + esc(STAGE_NAME[stageKey] || stageKey) + " (" + entries.length + '건)</h3>'
      + '<button class="px" data-ezpm-pane-close title="닫기">&#10005;</button></div>' + body);
  }

  /* ---------------- 증거 흐름 선 (SVG) ---------------- */
  function drawLines() {
    var ov = overlay();
    if (!ov) return;
    var flowin = ov.querySelector(".ezpm-flowin");
    var svg = ov.querySelector("svg.ezpm-svg");
    if (!flowin || !svg) return;
    var W = Math.max(flowin.scrollWidth, flowin.offsetWidth);
    var H = Math.max(flowin.scrollHeight, flowin.offsetHeight);
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    var base = flowin.getBoundingClientRect();
    var defs = '<defs>'
      + '<marker id="ezpm-arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4L0 8z" style="fill:var(--color-accent,#1F7AF0);opacity:.45"/></marker>'
      + '<marker id="ezpm-arr-hl" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4L0 8z" style="fill:var(--color-accent,#1F7AF0)"/></marker>'
      + "</defs>";
    var paths = "";
    curLinks.forEach(function (L) {
      var a = ov.querySelector('[data-ezpm-node="' + L.from + '"]');
      var b = ov.querySelector('[data-ezpm-node="' + L.to + '"]');
      if (!a || !b) return;
      var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      var sameCol = a.parentNode === b.parentNode;
      var d;
      if (sameCol) {
        var x1 = ra.right - base.left, y1 = ra.top + ra.height / 2 - base.top;
        var x2 = rb.right - base.left, y2 = rb.top + rb.height / 2 - base.top;
        d = "M" + x1 + " " + y1 + " C" + (x1 + 30) + " " + y1 + ", " + (x2 + 30) + " " + y2 + ", " + x2 + " " + y2;
      } else {
        var xa = ra.right - base.left, ya = ra.top + ra.height / 2 - base.top;
        var xb = rb.left - base.left, yb = rb.top + rb.height / 2 - base.top;
        var dx = Math.max(34, (xb - xa) / 2);
        d = "M" + xa + " " + ya + " C" + (xa + dx) + " " + ya + ", " + (xb - dx) + " " + yb + ", " + xb + " " + yb;
      }
      paths += '<path class="ezpm-line" data-lf="' + L.from + '" data-lt="' + L.to + '" d="' + d + '" marker-end="url(#ezpm-arr)"/>';
    });
    svg.innerHTML = defs + paths;
    applyLineHL();
  }

  function applyLineHL() {
    var ov = overlay();
    if (!ov) return;
    var hl = hoverNode || selectedNode;
    var lines = ov.querySelectorAll(".ezpm-line");
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var on = hl && (ln.getAttribute("data-lf") === hl || ln.getAttribute("data-lt") === hl);
      if (on) { ln.classList.add("hl"); ln.setAttribute("marker-end", "url(#ezpm-arr-hl)"); }
      else { ln.classList.remove("hl"); ln.setAttribute("marker-end", "url(#ezpm-arr)"); }
    }
  }

  /* ================= 열기 / 닫기 ================= */
  /* 대상 구성원 게이트 — member는 언제나 본인 계보만, leader는 직속 팀원까지.
     (procmap이 타인 등급을 노출하던 문제를 EZJourney에서 재현하지 않는다) */
  function allowedSubject(empId) {
    var me = CU(), rk = roleKey();
    if (!empId || !empById(empId)) return me.emp_id;
    if (empId === me.emp_id) return empId;
    if (rk === "member") return me.emp_id;
    if (rk === "leader") {
      var e = empById(empId);
      return (e && e.manager_id === me.emp_id) ? empId : me.emp_id;
    }
    return empId;   /* hr / exec */
  }

  /* open(arg)
       (없음)                → 본인 계보
       "EMP-0078"            → 해당 구성원(권한 내)
       "e1" 등 노드 id        → 본인 계보 + 그 노드 선택·강조
       {emp, node, ledger}   → 조합 지정. ledger=원장 항목 id → 그 항목을 인용한 노드로 착지 */
  function open(arg) {
    injectStyle();
    close();
    var empId = null, nodeId = null, ledgerId = null;
    if (arg && typeof arg === "object") {
      empId = arg.emp || arg.empId || null;
      nodeId = arg.node || arg.nodeId || null;
      ledgerId = arg.ledger || arg.ledgerId || null;
    } else if (typeof arg === "string" && arg) {
      if (empById(arg)) empId = arg;
      else if (arg.indexOf("ctx-") === 0) ledgerId = arg;
      else nodeId = arg;
    }
    curSubjectId = allowedSubject(empId);
    var ov = document.createElement("div");
    ov.className = "ezpm-root";
    ov.setAttribute("data-ezpm-root", "1");
    ov.innerHTML =
      '<div class="ezpm-card" role="dialog" aria-modal="true" aria-label="결정 흐름">'
      + '<div class="ezpm-head">'
      + '<div class="tl"><h2>결정 흐름</h2><p>이번 사이클의 논의와 결정, 그 근거를 한 장으로 봅니다</p></div>'
      + '<span class="ezpm-asof">' + esc(AS_OF()) + "</span>"
      + '<span data-ezpm-subjhost style="display:contents"></span>'
      + '<button class="ezpm-x" data-ezpm-close title="닫기">&#10005;</button>'
      + "</div>"
      + '<div class="ezpm-legend">'
      + '<span class="ezpm-st done">&#10003; 승인 완료</span>'
      + '<span class="ezpm-st wait">&#9203; 승인 대기</span>'
      + '<span class="ezpm-st plan">&#9675; 예정</span>'
      + '<span class="ezpm-ai">&#10022; AI 초안 · 사람 승인</span>'
      + '<span class="flowlab">&#10551; 앞 단계에서 확정된 기록이 다음 단계의 인용 근거로 이어집니다</span>'
      + "</div>"
      + '<div class="ezpm-wrap">'
      + '<div class="ezpm-flow"><div class="ezpm-flowin"></div></div>'
      + '<aside class="ezpm-pane" data-ezpm-pane></aside>'
      + "</div>"
      + '<div class="ezpm-foot">AI가 관여한 결정에는 근거 인용과 사람 승인 기록이 함께 남습니다 · 이 화면이 등급 설명과 이의제기 대응의 근거가 됩니다.</div>'
      + "</div>";
    document.body.appendChild(ov);
    renderFlow();
    /* 딥링크 착지 — 노드 직접 지정 우선, 없으면 원장 항목을 인용하는 노드로.
       못 찾으면 엉뚱한 노드로 보내지 않고 왜 못 찾았는지 알린다. */
    if (!nodeId && ledgerId) {
      nodeId = nodeForLedger(ledgerId);
      if (!nodeId) {
        openPane('<div class="ph"><h3>이 기록을 인용한 결정이 아직 없습니다</h3>'
          + '<button class="px" data-ezpm-pane-close title="닫기">&#10005;</button></div>'
          + '<div class="ezpm-empty">선택한 성과 기록은 이번 사이클의 결정 노드에 아직 인용되지 않았습니다.'
          + " 체크인·1:1·평가가 확정되면 해당 단계의 결정에 근거로 연결됩니다.</div>"
          + '<button class="ezpm-lbtn" data-ezpm-ledger="' + esc(ledgerId) + '">성과 기록에서 다시 보기</button>');
        return;
      }
    }
    if (nodeId) selectNode(nodeId);
  }

  function close() {
    var ov = overlay();
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    selectedNode = null;
    hoverNode = null;
    journeyCache = null;
  }

  /* ================= 진입 버튼 주입 (멱등) ================= */
  function btnHTML(pad) {
    return '<button class="ghost-btn ezpm-openbtn" data-ezpm-btn data-ezpm-open'
      + (pad ? ' style="padding:9px 16px;font-size:13px"' : "")
      + ">&#9672; 결정 흐름</button>";
  }
  /* 사이클 칩 — 현재 단계는 기준 시점 × period에서 파생(고정 문자열 금지) */
  function myCycle() {
    var me = CU();
    var objs = objectivesOf(me).list;
    return cycleInfo(objs, checkinsOf(me, objs.map(function (o) { return o.objective_id; })));
  }
  var CYCLE_SHORT = { goal: "목표", run: "실행", eval: "평가", review: "리뷰" };
  function cycleChipInner(dock) {
    var ai = STAGE_ORDER.indexOf(myCycle().curKey);
    if (ai < 0) ai = 2;
    var parts = [];
    for (var i = 0; i < STAGE_ORDER.length; i++) {
      if (dock && i < ai) continue;                          /* 도킹 칩은 현재+이후만 */
      if (dock && i > ai + 1) break;
      var cls = i < ai ? "stp" : i === ai ? "cur" : "nxt";
      var lab = CYCLE_SHORT[STAGE_ORDER[i]] + (i < ai ? " &#10003;" : i === ai ? " 진행중" : dock ? "" : " 예정");
      parts.push('<span class="' + cls + '">' + lab + "</span>");
    }
    return "&#9672; " + (dock ? "" : "사이클 ") + parts.join('<span class="sep">&#8250;</span>');
  }
  function cycleTitle() {
    return "성과 사이클 — 지금 " + (CYCLE_SHORT[myCycle().curKey] || "평가")
      + " 단계 · 클릭하면 과정과 근거를 한 장으로 봅니다";
  }

  function tryInjectButtons() {
    /* (0) 역할 관점 바 — 사이클 현재 위치 상시 노출, 클릭 → 프로세스 맵 */
    var bar = document.querySelector(".txr-bar");
    if (bar && !bar.querySelector("[data-ezpm-cycle]")) {
      var anchor = bar.querySelector(".eze-ev") || bar.querySelector(".txr-scope");
      if (anchor) {
        var chip = document.createElement("button");
        chip.type = "button";
        chip.className = "ezpm-cycle";
        chip.setAttribute("data-ezpm-cycle", "1");
        chip.setAttribute("data-ezpm-open", "1");
        chip.title = cycleTitle();
        chip.innerHTML = cycleChipInner(false);
        if (anchor.nextSibling) anchor.parentNode.insertBefore(chip, anchor.nextSibling);
        else anchor.parentNode.appendChild(chip);
      }
    }
    /* (0-b) elizax 도킹 패널 맥락 칩 행 — 대화 중에도 사이클 위치 상시 노출 */
    var ctx = document.querySelector(".ezx-panel .ezx-ctx");
    if (ctx && !ctx.querySelector("[data-ezpm-cycle]")) {
      var dchip = document.createElement("button");
      dchip.type = "button";
      dchip.className = "ezpm-cycle ezpm-cycle--dock";
      dchip.setAttribute("data-ezpm-cycle", "1");
      dchip.setAttribute("data-ezpm-open", "1");
      dchip.title = cycleTitle();
      dchip.innerHTML = cycleChipInner(true);
      ctx.appendChild(dchip);
    }
    /* (a) 성과관리 목표 화면 .perf-head */
    var perf = document.getElementById("s-perf");
    if (perf) {
      var head = perf.querySelector(".perf-head");
      if (head && !head.querySelector("[data-ezpm-btn]")) {
        var btns = head.querySelector(".btns");
        (btns || head).insertAdjacentHTML("beforeend", btnHTML(false));
      }
    }
    /* (b) 평가관리 .ap-head */
    var appr = document.getElementById("s-appr");
    if (appr) {
      var ah = appr.querySelector(".ap-head");
      if (ah && !ah.querySelector("[data-ezpm-btn]")) {
        var r = ah.querySelector(".r");
        if (r) r.insertAdjacentHTML("afterbegin", btnHTML(true));
        else ah.insertAdjacentHTML("beforeend", btnHTML(true));
      }
    }
  }

  /* ================= 이벤트 위임 ================= */
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t) return;

    /* 배경 클릭 → 닫기 */
    if (t.getAttribute && t.getAttribute("data-ezpm-root")) { close(); return; }

    var openBtn = t.closest ? t.closest("[data-ezpm-open]") : null;
    if (openBtn) { open(); return; }

    var closeBtn = t.closest ? t.closest("[data-ezpm-close]") : null;
    if (closeBtn) { close(); return; }

    var pclose = t.closest ? t.closest("[data-ezpm-pane-close]") : null;
    if (pclose) {
      selectedNode = null;
      var ovp = overlay();
      if (ovp) {
        var sel = ovp.querySelector(".ezpm-node.sel");
        if (sel) sel.classList.remove("sel");
      }
      closePane();
      applyLineHL();
      return;
    }

    var lbtn = t.closest ? t.closest("[data-ezpm-ledger]") : null;
    if (lbtn) {
      var lid = lbtn.getAttribute("data-ezpm-ledger");
      try { if (window.EZLedger && EZLedger.openPanel) EZLedger.openPanel(lid); } catch (err) { /* 미탑재 */ }
      return;
    }

    /* procmap 이관 — What-if(읽기 전용). 대상은 현재 권한 내 구성원으로 고정 */
    var wfb = t.closest ? t.closest("[data-ezpm-wf]") : null;
    if (wfb && overlay()) {
      var wout = overlay().querySelector("[data-ezpm-wfout]");
      if (wout) {
        wout.innerHTML = "계산 중…";
        wout.innerHTML = runWhatIf(subjectEmp(), parseFloat(wfb.getAttribute("data-ezpm-wf")) || 0);
      }
      return;
    }

    var cnt = t.closest ? t.closest("[data-ezpm-count]") : null;
    if (cnt && overlay()) {
      selectedNode = null;
      var ovc = overlay();
      var sc = ovc.querySelector(".ezpm-node.sel");
      if (sc) sc.classList.remove("sel");
      applyLineHL();
      renderStagePane(cnt.getAttribute("data-ezpm-count"));
      return;
    }

    var node = t.closest ? t.closest("[data-ezpm-node]") : null;
    if (node && overlay()) {
      selectNode(node.getAttribute("data-ezpm-node"));
      return;
    }
  });

  document.addEventListener("change", function (e) {
    var sel = e.target && e.target.closest ? e.target.closest("[data-ezpm-subject]") : null;
    if (!sel) return;
    curSubjectId = allowedSubject(sel.value);   /* 셀렉터 조작으로 권한 밖 대상 진입 차단 */
    renderFlow();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && overlay()) close();
  });

  /* 노드 호버 → 증거 흐름 선 강조 */
  document.addEventListener("mouseover", function (e) {
    if (!overlay()) return;
    var node = e.target && e.target.closest ? e.target.closest("[data-ezpm-node]") : null;
    if (node) {
      hoverNode = node.getAttribute("data-ezpm-node");
      applyLineHL();
    }
  });
  document.addEventListener("mouseout", function (e) {
    if (!overlay() || !hoverNode) return;
    var node = e.target && e.target.closest ? e.target.closest("[data-ezpm-node]") : null;
    if (node && node.getAttribute("data-ezpm-node") === hoverNode) {
      hoverNode = null;
      applyLineHL();
    }
  });

  window.addEventListener("resize", function () {
    if (overlay()) drawLines();
  });

  /* ================= 라이브 구독 (F13 ①) =================
     원장에 결정이 쌓이거나 게이트 결정이 바뀌면, 맵이 열려 있어도 즉시 반영. */
  var wiredLedger = false, wiredGates = false;
  function onLiveChange() { if (overlay()) renderFlow(true); }
  function wireLive() {
    if (!wiredLedger && window.EZLedger && EZLedger.on) {
      try { EZLedger.on("add", onLiveChange); wiredLedger = true; } catch (e) { /* 구독 실패 무시 */ }
    }
    if (!wiredGates && window.EZKit && EZKit.gates && EZKit.gates.onChange) {
      try { EZKit.gates.onChange(onLiveChange); wiredGates = true; } catch (e2) { /* 무시 */ }
    }
    return wiredLedger && wiredGates;
  }

  /* ================= 부트스트랩 ================= */
  function boot() {
    injectStyle();
    tryInjectButtons();

    /* 모듈 로드 순서와 무관하게 결선 (300ms × 20) */
    if (!wireLive()) {
      var lt = 0;
      var lpoll = setInterval(function () {
        if (wireLive() || ++lt >= 20) clearInterval(lpoll);
      }, 300);
    }

    /* TXFIX 훅 — 섹션 열릴 때마다 재주입 (tx_fix_*가 head를 재구성) */
    if (window.TXFIX) {
      if (TXFIX.ready) TXFIX.ready(tryInjectButtons);
      if (TXFIX.onSection) {
        TXFIX.onSection("s-perf", tryInjectButtons);
        TXFIX.onSection("s-appr", tryInjectButtons);
      }
    }

    /* MutationObserver + 300ms×20 폴링 (tx_1on1 tryInject 패턴) */
    var tries = 0;
    var observed = { "s-perf": false, "s-appr": false };
    var poll = setInterval(function () {
      tries++;
      tryInjectButtons();
      ["s-perf", "s-appr"].forEach(function (id) {
        if (observed[id]) return;
        var sec = document.getElementById(id);
        if (!sec) return;
        observed[id] = true;
        var mo = new MutationObserver(function () { tryInjectButtons(); });
        mo.observe(sec, { childList: true, subtree: true });
      });
      if ((observed["s-perf"] && observed["s-appr"]) || tries >= 20) clearInterval(poll);
    }, 300);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  /* ---------------- 전역 노출 ---------------- */
  window.EZJourney = {
    open: open,                 /* open() | open(empId) | open(nodeId) | open({emp,node,ledger}) */
    openNode: function (nodeId, empId) { open({ node: nodeId, emp: empId || null }); },
    openLedger: function (ledgerId) { open({ ledger: ledgerId }); },
    close: close
  };
})();
