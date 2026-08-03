/* ============================================================
   ez_source_map.js — 출처(source) → 화면 이름 사전
   대화·성과 기록·알림에 찍히는 원문 source 값을 사람이 읽는 화면 이름으로
   바꾸고, 필요하면 그 화면으로 이동시킨다.
   - EZSource.label(source)  → "목표 상세" | ""   (모르면 반드시 "")
   - EZSource.of(source)     → {label, s, p, ov, oid} | null
   - EZSource.go(source)     → true/false
   - EZSource.chip(source)   → HTMLButtonElement | null
   - EZSource.screenLabel(s,p) → EZNav.labelOf 위임
   - EZSource.selfTest()     → {total, mapped, unmapped:[...]}
   EZNav(window.EZNav)·TALENX_DATA.keyResults에 기대되, 없어도 던지지 않는다.
   외부 노출: window.EZSource 하나뿐. ES5 IIFE.
   ============================================================ */
(function () {
  "use strict";

  /* 앞머리 → 화면 규칙. 앞머리는 "."·"-"·"_" 앞 첫 조각을 소문자로 본다.
     배열 순서와 무관하게 "더 긴 접두가 이긴다" — matchHead()가 가장 긴
     매치를 고른다. s/p가 null이면 화면이 없다(라벨만, go는 false). */
  var RULES = [
    /* 목표 생성 */
    { heads: ["goal.new", "goal.create", "goal.ai.draft", "obj.new"],
      label: "목표 생성", s: "perf", p: 0, ov: "new" },
    /* 목표 상세 (obj./objectives/kr./keyresults 는 goal.detail 계열보다 짧으므로
       순서상 뒤에 두되, 더 긴 접두 "goal.detail" 등이 우선 매치되게 배열한다) */
    { heads: ["goal.detail", "objective.detail"],
      label: "목표 상세", s: "perf", p: 0, ov: "detail" },
    { heads: ["obj", "objectives", "objective", "kr", "keyresults", "keyresult", "perf.obj"],
      label: "목표 상세", s: "perf", p: 0, ov: "detail" },
    /* 목표 현황 */
    { heads: ["goal", "perf.goal"],
      label: "목표 현황", s: "perf", p: 0, ov: null },
    /* 목표 상세 · 체크인 */
    { heads: ["perf.checkin", "checkin", "checkins", "chk"],
      label: "목표 상세 · 체크인", s: "perf", p: 0, ov: "detail" },
    /* 피드백 */
    { heads: ["fb", "feedback", "feedbackhistory", "perf.fb"],
      label: "피드백", s: "perf", p: 1, ov: null },
    /* 1:1 미팅 */
    { heads: ["1on1", "oneonone", "memo", "meeting"],
      label: "1:1 미팅", s: "perf", p: 2, ov: null },
    /* 리뷰 */
    { heads: ["review", "perf.review"],
      label: "리뷰", s: "perf", p: 3, ov: null },
    /* 평가 작성 */
    { heads: ["eval", "evaluation", "evaluations", "appr", "assess"],
      label: "평가 작성", s: "appr", p: 0, ov: null },
    /* 인재 리뷰 */
    { heads: ["talent", "calib"],
      label: "인재 리뷰", s: "appr", p: 1, ov: null },
    /* 360 진단 */
    { heads: ["msf", "peer", "upward", "360"],
      label: "360 진단", s: "msf", p: null, ov: null },
    /* 업무보드 */
    { heads: ["tsk", "task", "wb", "work", "scrum"],
      label: "업무보드", s: "work", p: 0, ov: null },
    /* 근무관리 */
    { heads: ["att", "attendance", "leave", "vacation"],
      label: "근무관리", s: "att", p: 0, ov: null },
    /* 급여관리 */
    { heads: ["pay", "payroll", "salary"],
      label: "급여관리", s: "pay", p: 0, ov: null },
    /* 신청/승인 */
    { heads: ["wf", "approval", "ckreq", "sign"],
      label: "신청/승인", s: "wf", p: 0, ov: null },
    /* 인사관리 */
    { heads: ["hrm", "employee", "employees", "job", "jobprofile", "skill"],
      label: "인사관리", s: "hrm", p: 1, ov: null },
    /* 화면 없음 — 라벨만, go()는 false */
    { heads: ["rule", "policy", "regulation"],
      label: "평가 규정", s: null, p: null, ov: null }
  ];

  /* 신호 단계(signal.<신호ID>....) → 화면. 신호ID는 "<단계>-..." 형태
     (예: 목표수립-구성원-04, signal.목표수립-구성원-04.a3.to.EMP-0030). */
  var SIGNAL_STAGE = [
    { re: /^목표수립/, label: "목표 현황", s: "perf", p: 0, ov: null },
    { re: /^중간점검/, label: "목표 상세", s: "perf", p: 0, ov: "detail" },
    { re: /^평가/, label: "평가 작성", s: "appr", p: 0, ov: null },
    { re: /^피드백/, label: "피드백", s: "perf", p: 1, ov: null }
  ];

  /* heads → RULES 인덱스, 긴 것부터 찾도록 정렬된 flat 목록 */
  var HEAD_INDEX = (function () {
    var out = [];
    for (var i = 0; i < RULES.length; i++) {
      var heads = RULES[i].heads || [];
      for (var j = 0; j < heads.length; j++) out.push({ head: heads[j], rule: RULES[i] });
    }
    out.sort(function (a, b) { return b.head.length - a.head.length; });
    return out;
  })();

  function lc(s) { return String(s || "").toLowerCase(); }

  /* source 문자열에서 신호ID(단계 판정용)를 뽑는다: signal.<id>.<...> */
  function signalIdOf(source) {
    var m = /^signal\.([^.]+)/.exec(String(source || ""));
    return m ? m[1] : null;
  }

  function matchSignalStage(source) {
    var sid = signalIdOf(source);
    if (!sid) return null;
    for (var i = 0; i < SIGNAL_STAGE.length; i++) {
      if (SIGNAL_STAGE[i].re.test(sid)) return SIGNAL_STAGE[i];
    }
    return null;
  }

  /* 앞머리 매치 — 원문 앞부분에서 "."·"-"·"_" 앞 첫 조각뿐 아니라,
     전체 문자열이 그 접두로 시작하는지도 함께 본다(예: "objectives"는
     첫 조각 분리 없이 그 자체가 head). 가장 긴 head가 이긴다. */
  function matchHead(source) {
    var t = lc(source);
    if (!t) return null;
    var first = t.split(/[._-]/)[0];
    var best = null;
    for (var i = 0; i < HEAD_INDEX.length; i++) {
      var head = HEAD_INDEX[i].head;
      if (t === head || t.indexOf(head + ".") === 0 || t.indexOf(head + "-") === 0 ||
          t.indexOf(head + "_") === 0 || first === head) {
        best = HEAD_INDEX[i].rule;
        break; /* HEAD_INDEX는 이미 길이 내림차순 — 첫 매치가 최장 매치 */
      }
    }
    return best;
  }

  /* KR-id → 소유 목표(OBJ-id) 역참조. TALENX_DATA 없으면 null. */
  function ownerObjOf(krId) {
    try {
      var list = window.TALENX_DATA && window.TALENX_DATA.keyResults;
      if (!list || !krId) return null;
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].kr_id === krId) return list[i].objective_id || null;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function extractOid(source) {
    var t = String(source || "");
    var mObj = /\b(OBJ-[A-Za-z0-9]+)\b/.exec(t);
    if (mObj) return mObj[1];
    var mKr = /\b(KR-[A-Za-z0-9]+)\b/.exec(t);
    if (mKr) return ownerObjOf(mKr[1]);
    return null;
  }

  /* source → {label, s, p, ov, oid} | null */
  function of(source) {
    var t = String(source || "").trim();
    if (!t) return null;
    var rule = matchSignalStage(t) || matchHead(t);
    if (!rule) return null;
    if (!rule.label) return null;
    return {
      label: rule.label,
      s: rule.s == null ? null : rule.s,
      p: rule.p == null ? null : rule.p,
      ov: rule.ov || null,
      oid: extractOid(t)
    };
  }

  /* source → "화면 이름" | "" (모르면 반드시 빈 문자열, 코드 그대로 쓰지 않는다) */
  function label(source) {
    var r = of(source);
    return r ? r.label : "";
  }

  function screenLabel(s, p) {
    try {
      if (window.EZNav && typeof window.EZNav.labelOf === "function") return window.EZNav.labelOf(s, p);
    } catch (e) { /* ignore */ }
    return s || "";
  }

  /* 오버레이 진입점 트리거 — 화면 전환 뒤 220ms에 시도한다. 없으면 화면만 연 상태로 둔다. */
  function openOverlay(r) {
    if (!r || !r.ov) return;
    setTimeout(function () {
      try {
        if (r.ov === "detail" && r.oid && window.TXFIX && typeof window.TXFIX.openGoalDetail === "function") {
          window.TXFIX.openGoalDetail(r.oid);
          return;
        }
        if (r.ov === "new") {
          var btn = document.querySelector('[data-txf-ov="new"]');
          if (btn) btn.click();
        }
      } catch (e) { /* 진입점이 없으면 화면만 연 상태로 둔다 */ }
    }, 220);
  }

  /* source → 화면 전환(+오버레이) 시도. true/false만 돌려주고 절대 던지지 않는다. */
  function go(source) {
    try {
      var r = of(source);
      if (!r || r.s == null) return false;
      if (!window.EZNav || typeof window.EZNav.go !== "function") return false;
      var ok = window.EZNav.go(r.s, r.p);
      if (ok) openOverlay(r);
      return !!ok;
    } catch (e) { return false; }
  }

  /* source → 클릭 가능한 칩 버튼 | null (label 없으면 null) */
  function chip(source) {
    var lab = label(source);
    if (!lab) return null;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ez-src-chip";
    btn.setAttribute("data-ez-source", String(source || ""));
    btn.textContent = lab;
    btn.addEventListener("click", function () { go(source); });
    return btn;
  }

  /* 하드코딩된 대표 source ~25건에 대한 자체 커버리지 검사 */
  var SELFTEST_SAMPLES = [
    "perf.checkin.CHK-EMP0078-2",
    "goal.ai.draft",
    "eval.lint",
    "signal.목표수립-구성원-04.a3.to.EMP-0030",
    "signal.중간점검-팀장-02.a4.to.EMP-0012",
    "signal.평가-구성원-07.a6.to.EMP-0099",
    "signal.피드백-팀장-01.a3.to.EMP-0055",
    "objectives",
    "objective.detail.OBJ-0001",
    "obj.new",
    "goal.detail.OBJ-0002",
    "goal.new",
    "kr.KR-0001",
    "keyresults",
    "tsk.wb-0714",
    "memo.0630",
    "rule.평가규정 §4.2",
    "policy.연차촉진",
    "checkin.CHK-EMP0001-1",
    "fb.FB-0012",
    "1on1.rec.0716",
    "review.Q3",
    "appr.EVAL-0007",
    "talent.calib.2026H1",
    "msf.360.EMP-0030",
    "att.leave.req.0012",
    "pay.payroll.202607",
    "wf.approval.CKREQ-0009",
    "hrm.job.JOB-소프트-067",
    "hub.audit",
    "elizax.whatif",
    "entry.pill.goal",
    "app.event",
    "perf.obj.OBJ-0001",
    "perf.fb.FB-0002",
    "org.team.checkin.wk27"
  ];

  function selfTest() {
    var mapped = 0, unmapped = [];
    for (var i = 0; i < SELFTEST_SAMPLES.length; i++) {
      var s = SELFTEST_SAMPLES[i];
      var lab = label(s);
      if (lab) mapped++; else unmapped.push(s);
    }
    return { total: SELFTEST_SAMPLES.length, mapped: mapped, unmapped: unmapped };
  }

  window.EZSource = {
    label: label,
    of: of,
    go: go,
    chip: chip,
    screenLabel: screenLabel,
    selfTest: selfTest
  };
})();
