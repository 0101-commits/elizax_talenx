/* ============================================================================
 * tx_journey.js — 성과 프로세스 맵 (내 등급이 정해지는 과정과 근거를 한 장으로)
 * ----------------------------------------------------------------------------
 * [기획 스펙]
 * ① 배경/문제
 *    - 구성원 입장에서 "내 등급은 어떤 과정을 거쳐, 무엇을 근거로 정해졌는가"를
 *      한 화면에서 확인할 수 있는 조망 뷰가 없다.
 *    - 목표수립 → 실행·중간점검 → 평가 → 피드백/리뷰 4단계 위에 실제 결정
 *      노드(승인 완료 / 승인 대기 / 예정)를 얹고, 각 결정의 인용 근거를
 *      드릴다운으로 보여준다. 근거는 TALENX_DATA + 라이브 스토어(성과 히스토리,
 *      1:1 확정 기록, 승인 대기 게이트 결정)에서 실제로 읽는다.
 * ② 사용자 시나리오
 *    - 성과관리 목표 화면(.perf-head) 또는 평가관리(.ap-head)의
 *      "◈ 프로세스 맵" 버튼 → 전체화면 오버레이.
 *    - 노드 클릭 → 우측 상세 패널: 결정 명칭·시점·결정자·상태 + 인용 근거
 *      (체크인 원문·규칙·직무 기준·1:1·평가 이력, 원천 id 모노스페이스).
 *    - 단계별 "기록 N건" 카운터 → 해당 단계의 성과 히스토리 항목 목록.
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

  var AS_OF = "기준 시점 · 2026 상반기 · 7/16 06:00 기준";
  var LS_1ON1 = "elizax_1on1_v1:";
  var SS_GATE = "txr_gate_";

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
    try {
      var raw = sessionStorage.getItem(SS_GATE + roleKey());
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

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
  /* 성과 히스토리 type → 단계 매핑 */
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
        ex: (c.comment || "진행률 업데이트") + (c.blocker ? " · 블로커: " + c.blocker : ""),
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

    /* 등급 초안 상태 — 승인 대기 게이트 결정(세션) 반영 */
    var e1state = "wait", e1label = "승인 대기", e1date = "7/15",
        e1decider = mgr + " · 승인 필요";
    if (dec && dec.act) {
      e1date = dec.at ? String(dec.at).slice(5, 16) : "7/15";
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
        t: "oneonone", title: "1:1 미팅 요약 · 7/16 (확정 기록)",
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
            date: "4/2", decider: mgr,
            evidence: goalEv, ledgerType: "goal"
          },
          {
            id: "g2", title: "가중치 설정 100%",
            meta: "근거 rule.weight.sum · 평가규정 v3.1",
            state: "done", stateLabel: "승인 완료", ai: false,
            date: "4/2", decider: mgr,
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
            date: "3/30", decider: "— (제안만 · 확정 기록 없음)",
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
            meta: "5/30 · 진척·리스크 요약",
            state: "done", stateLabel: "승인 완료", ai: true,
            date: "5/30", decider: mgr,
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
                src: "perf.mid.0530"
              });
              return arr;
            })(),
            ledgerType: "checkin"
          },
          {
            id: "r3", title: "1:1 미팅 요약 확정",
            meta: confirmed ? "✓ 7/16 확정" : "요약 초안 생성됨 · 확정 전",
            state: confirmed ? "done" : "wait",
            stateLabel: confirmed ? "승인 완료" : "승인 대기",
            ai: true,
            date: "7/16", decider: (subj.name || "구성원") + " (본인 확정)",
            evidence: [
              {
                t: "oneonone", title: "1:1 미팅 요약 · 7/16",
                ex: "KR2 진척 · 외부 API 지연 리스크 · ML 교육 니즈 · 다음 체크인 합의",
                src: "1on1.rec.0716"
              },
              {
                t: "rule", title: "기록 확정 절차",
                ex: confirmed
                  ? "본인 확정 완료 · 성과 히스토리에 기록됨 (확정 전에는 반영되지 않음)"
                  : "확정 전에는 어디에도 기록되지 않습니다 (승인 대기)",
                src: "1on1.gate.confirm"
              }
            ],
            ledgerType: "oneonone"
          }
        ]
      },
      {
        key: "eval", name: "평가", cur: true, nodes: [
          {
            id: "e1", title: "등급 초안" + (ev && ev.grade ? " · " + ev.grade : ""),
            meta: ev
              ? "종합 " + (ev.weighted_score != null ? ev.weighted_score : "-") + "점 → " + (ev.grade || "-") + " 초안 생성됨"
              : "초안 생성됨 · 산출 근거 인용",
            state: e1state, stateLabel: e1label, ai: true,
            date: e1date, decider: e1decider,
            evidence: e1Ev, ledgerType: "eval"
          },
          {
            id: "e2", title: "캘리브레이션 조정",
            meta: "인재 리뷰 세션에서 심의",
            state: "plan", stateLabel: "예정", ai: false,
            date: "7월 말", decider: "인재 리뷰 참여자 (심의)",
            evidence: [
              {
                t: "rule", title: "캘리브레이션 게이트",
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
            date: "8월 초", decider: mgr + " (승인 필요)",
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
            meta: "캘리브레이션 확정 후 개별 통보",
            state: "plan", stateLabel: "예정", ai: false,
            date: "8월 중", decider: "HR 운영 (통보 절차)",
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
            date: "12월", decider: "—",
            note: "이 사이클의 확정 기록이 내년 목표수립의 출발점이 됩니다",
            evidence: [
              {
                t: "eval", title: "사이클 확정 기록 이관",
                ex: "확정 등급·코멘트·성과 히스토리가 다음 사이클 목표 초안의 인용 근거로 이어집니다",
                src: "cycle.carry.FY2027"
              }
            ],
            ledgerType: "eval"
          }
        ]
      }
    ];
    return stages;
  }

  /* ================= 성과 히스토리 연동 ================= */
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
  function ledgerMatch(type) {
    var list = ledgerList();
    if (!list) return null;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].type === type) return list[i];
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
      ".ezpm-root{position:fixed;inset:0;z-index:4100;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:22px;}",
      ".ezpm-card{background:var(--card,#fff);color:var(--ink,#2A2E39);border-radius:18px;max-width:1180px;width:100%;max-height:90vh;",
      "display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(15,23,42,.3);overflow:hidden;}",
      "@media (prefers-reduced-motion:no-preference){.ezpm-card{animation:ezpmIn .18s ease;}}",
      "@keyframes ezpmIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}",
      /* 헤더 */
      ".ezpm-head{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;padding:18px 22px 12px;border-bottom:1px solid var(--line,#ECEEF2);}",
      ".ezpm-head .tl h2{margin:0;font-size:17px;font-weight:800;color:var(--ink,#2A2E39);}",
      ".ezpm-head .tl p{margin:3px 0 0;font-size:12px;color:var(--ink-3,#9096A3);}",
      ".ezpm-asof{font-size:11px;font-weight:600;color:var(--blue,#1F7AF0);background:rgba(31,122,240,.07);",
      "border:1px solid rgba(31,122,240,.3);border-radius:999px;padding:4px 11px;white-space:nowrap;margin-top:2px;}",
      ".ezpm-subj{display:flex;align-items:center;gap:6px;margin-left:auto;margin-top:2px;}",
      ".ezpm-subj label{font-size:11px;color:var(--ink-3,#9096A3);font-weight:600;}",
      ".ezpm-subj select{font:inherit;font-size:12px;color:var(--ink,#2A2E39);background:var(--card,#fff);",
      "border:1px solid var(--line,#ECEEF2);border-radius:8px;padding:5px 8px;max-width:200px;}",
      ".ezpm-subjchip{font-size:11.5px;font-weight:700;color:var(--ink-2,#5C6474);margin-left:auto;margin-top:6px;}",
      ".ezpm-x{cursor:pointer;border:none;background:none;font-size:18px;color:var(--ink-3,#9096A3);line-height:1;padding:2px 6px;margin-top:2px;}",
      ".ezpm-subj+.ezpm-x{margin-left:0;}",
      ".ezpm-head .ezpm-x:only-of-type{margin-left:0;}",
      /* 범례 */
      ".ezpm-legend{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:9px 22px;font-size:11px;color:var(--ink-3,#9096A3);",
      "border-bottom:1px solid var(--line,#ECEEF2);}",
      ".ezpm-legend .flowlab{color:var(--blue,#1F7AF0);font-weight:600;}",
      ".ezpm-st{display:inline-block;font-size:10px;font-weight:700;border-radius:999px;padding:1px 8px;white-space:nowrap;}",
      ".ezpm-st.done{color:#15803D;background:rgba(21,128,61,.08);border:1px solid rgba(21,128,61,.35);}",
      ".ezpm-st.wait{color:#B45309;background:rgba(180,83,9,.08);border:1px solid rgba(180,83,9,.35);}",
      ".ezpm-st.plan{color:var(--ink-3,#9096A3);background:var(--soft,#F5F6F8);border:1px dashed var(--ink-4,#B4B9C4);}",
      ".ezpm-st.sug{color:#6D28D9;background:rgba(109,40,217,.07);border:1px solid rgba(109,40,217,.3);}",
      ".ezpm-ai{display:inline-block;font-size:9.5px;font-weight:700;border-radius:999px;padding:1px 7px;white-space:nowrap;",
      "color:#6D28D9;background:rgba(109,40,217,.07);border:1px solid rgba(109,40,217,.3);}",
      /* 본문 레이아웃 */
      ".ezpm-wrap{display:flex;flex:1;min-height:0;}",
      ".ezpm-flow{flex:1;min-width:0;overflow:auto;padding:18px 22px;}",
      ".ezpm-flowin{position:relative;min-width:960px;}",
      ".ezpm-svg{position:absolute;inset:0;z-index:2;pointer-events:none;}",
      ".ezpm-cols{position:relative;z-index:1;display:grid;grid-template-columns:repeat(4,1fr);gap:26px;}",
      ".ezpm-col{position:relative;background:var(--soft,#F5F6F8);border:1px solid var(--line,#ECEEF2);border-radius:14px;padding:12px;}",
      ".ezpm-col:not(:last-child):after{content:\"\\2192\";position:absolute;right:-21px;top:12px;font-size:15px;font-weight:800;color:var(--ink-4,#B4B9C4);}",
      ".ezpm-col.cur{border:1.5px solid var(--blue,#1F7AF0);box-shadow:0 0 0 3px rgba(31,122,240,.12);}",
      ".ezpm-col>.ch{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12.5px;font-weight:800;margin-bottom:10px;color:var(--ink,#2A2E39);}",
      ".ezpm-col>.ch .step{width:18px;height:18px;border-radius:50%;background:#23408E;color:#fff;font-size:10px;font-weight:800;",
      "display:inline-flex;align-items:center;justify-content:center;flex:none;}",
      ".ezpm-col.cur>.ch .step{background:var(--blue,#1F7AF0);}",
      ".ezpm-curtag{font-size:9.5px;font-weight:700;color:var(--blue,#1F7AF0);background:rgba(31,122,240,.08);",
      "border:1px solid rgba(31,122,240,.35);border-radius:999px;padding:1px 7px;}",
      ".ezpm-cnt{cursor:pointer;margin-left:auto;border:1px solid var(--line,#ECEEF2);border-radius:999px;padding:2px 9px;",
      "font-size:10px;font-weight:700;color:var(--ink-2,#5C6474);background:var(--card,#fff);}",
      ".ezpm-cnt:hover{border-color:var(--blue,#1F7AF0);color:var(--blue,#1F7AF0);}",
      /* 노드 */
      ".ezpm-node{cursor:pointer;background:var(--card,#fff);border:1px solid var(--line,#ECEEF2);border-radius:11px;padding:9px 11px;margin-bottom:8px;}",
      "@media (prefers-reduced-motion:no-preference){.ezpm-node{transition:box-shadow .12s,border-color .12s;}}",
      ".ezpm-node:hover{border-color:var(--blue,#1F7AF0);}",
      ".ezpm-node.sel{border-color:var(--blue,#1F7AF0);box-shadow:0 0 0 3px rgba(31,122,240,.14);}",
      ".ezpm-node.st-plan{border-style:dashed;opacity:.82;}",
      ".ezpm-node .hd{display:flex;align-items:baseline;gap:6px;}",
      ".ezpm-node .ic{flex:none;font-size:11px;font-weight:800;}",
      ".ezpm-node.st-done .ic{color:#15803D;}",
      ".ezpm-node.st-wait .ic{color:#B45309;}",
      ".ezpm-node.st-plan .ic{color:var(--ink-4,#B4B9C4);}",
      ".ezpm-node.st-sug .ic{color:#6D28D9;}",
      ".ezpm-node .tt{font-size:12px;font-weight:700;line-height:1.4;color:var(--ink,#2A2E39);}",
      ".ezpm-node .dt{margin-left:auto;flex:none;font-size:10px;color:var(--ink-3,#9096A3);font-variant-numeric:tabular-nums;}",
      ".ezpm-node .mt2{font-size:11px;color:var(--ink-2,#5C6474);line-height:1.5;margin:3px 0 5px;}",
      ".ezpm-node .bd{display:flex;align-items:center;gap:5px;flex-wrap:wrap;}",
      /* 상세 패널 */
      ".ezpm-pane{width:340px;flex:none;border-left:1px solid var(--line,#ECEEF2);overflow-y:auto;padding:16px 18px;display:none;background:var(--card,#fff);}",
      ".ezpm-pane.open{display:block;}",
      "@media(max-width:860px){.ezpm-pane{width:260px;}}",
      ".ezpm-pane .ph{display:flex;align-items:flex-start;gap:8px;}",
      ".ezpm-pane .ph h3{margin:0;font-size:14px;font-weight:800;flex:1;line-height:1.4;color:var(--ink,#2A2E39);}",
      ".ezpm-pane .px{cursor:pointer;border:none;background:none;font-size:15px;color:var(--ink-3,#9096A3);line-height:1;flex:none;}",
      ".ezpm-krow{display:flex;gap:8px;font-size:11.5px;margin:7px 0;line-height:1.5;}",
      ".ezpm-krow label{flex:none;width:52px;color:var(--ink-3,#9096A3);font-weight:600;}",
      ".ezpm-krow div{color:var(--ink,#2A2E39);min-width:0;}",
      ".ezpm-note{font-size:11px;color:#B45309;background:rgba(180,83,9,.07);border:1px solid rgba(180,83,9,.25);",
      "border-radius:8px;padding:7px 10px;margin:10px 0 0;line-height:1.5;}",
      ".ezpm-evh{font-size:11px;font-weight:700;color:var(--ink-3,#9096A3);margin:14px 0 6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;}",
      ".ezpm-evok{font-size:9.5px;font-weight:700;color:#15803D;}",
      ".ezpm-ev{border:1px solid var(--line,#ECEEF2);border-radius:10px;padding:8px 10px;margin-bottom:7px;background:var(--soft,#F5F6F8);}",
      ".ezpm-ev .et{display:inline-block;font-size:9.5px;font-weight:700;border-radius:5px;padding:1px 7px;margin-bottom:4px;",
      "color:var(--blue,#1F7AF0);background:rgba(31,122,240,.08);border:1px solid rgba(31,122,240,.3);}",
      ".ezpm-ev .evt{font-size:11.5px;font-weight:700;line-height:1.4;color:var(--ink,#2A2E39);}",
      ".ezpm-ev .evx{font-size:11px;color:var(--ink-2,#5C6474);line-height:1.5;margin:3px 0;}",
      ".ezpm-ev .src{display:inline-block;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;",
      "color:var(--ink-3,#9096A3);background:var(--card,#fff);border:1px solid var(--line,#ECEEF2);border-radius:5px;padding:1px 6px;}",
      ".ezpm-lbtn{cursor:pointer;display:inline-block;margin-top:6px;border:1px solid rgba(31,122,240,.4);border-radius:999px;",
      "padding:4px 11px;font-size:10.5px;font-weight:700;color:var(--blue,#1F7AF0);background:var(--card,#fff);}",
      ".ezpm-lbtn:hover{background:rgba(31,122,240,.06);}",
      ".ezpm-lat{font-size:10px;color:var(--ink-3,#9096A3);margin-left:6px;font-variant-numeric:tabular-nums;}",
      ".ezpm-empty{font-size:11.5px;color:var(--ink-3,#9096A3);padding:8px 2px;line-height:1.6;}",
      /* 증거 흐름 선 */
      ".ezpm-line{fill:none;stroke:var(--blue,#1F7AF0);stroke-width:1.6;opacity:.3;}",
      ".ezpm-line.hl{opacity:1;stroke-width:2.4;}",
      "@media (prefers-reduced-motion:no-preference){.ezpm-line{transition:opacity .15s,stroke-width .15s;}}",
      /* 푸터 */
      ".ezpm-foot{padding:11px 22px;border-top:1px solid var(--line,#ECEEF2);font-size:11px;color:var(--ink-3,#9096A3);line-height:1.6;}",
      /* 진입 버튼 */
      ".ezpm-openbtn{white-space:nowrap;}",
      /* 역할 바 상시 사이클 칩 — 지금 어느 단계인지 한 눈에 */
      ".ezpm-cycle{display:inline-flex;align-items:center;gap:6px;margin-left:10px;padding:3px 10px;cursor:pointer;",
      "border:1px solid rgba(31,122,240,.35);border-radius:12px;background:var(--card,#fff);",
      "font:inherit;font-size:11px;font-weight:600;color:var(--ink-2,#5C6474);white-space:nowrap;}",
      ".ezpm-cycle:hover{background:rgba(31,122,240,.06);}",
      ".ezpm-cycle .stp{color:#15803D;}",
      ".ezpm-cycle .cur{color:var(--blue,#1F7AF0);font-weight:800;}",
      ".ezpm-cycle .nxt{color:var(--ink-4,#B4B9C4);}",
      ".ezpm-cycle .sep{color:var(--ink-4,#B4B9C4);font-weight:400;}",
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
        cnt = '<button class="ezpm-cnt" data-ezpm-count="' + esc(st.key) + '" title="성과 히스토리에서 이 단계의 기록 보기">기록 '
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

  function renderFlow() {
    var ov = overlay();
    if (!ov) return;
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
    requestAnimationFrame(drawLines);
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

  function evidenceHTML(evd) {
    return evd.map(function (ev) {
      return '<div class="ezpm-ev">'
        + '<span class="et">' + esc(TYPE_CHIP[ev.t] || ev.t) + "</span>"
        + '<div class="evt">' + esc(ev.title) + "</div>"
        + '<div class="evx">' + esc(ev.ex) + "</div>"
        + '<span class="src">' + esc(ev.src) + "</span>"
        + "</div>";
    }).join("");
  }

  function renderNodePane(id) {
    var n = findNode(id);
    if (!n) return;
    var m = ledgerMatch(n.ledgerType);
    var html = '<div class="ph"><h3>' + esc(n.title)
      + (n.ai ? ' <span class="ezpm-ai">&#10022; AI 초안 · 사람 승인</span>' : "")
      + '</h3><button class="px" data-ezpm-pane-close title="닫기">&#10005;</button></div>'
      + '<div class="ezpm-krow"><label>시점</label><div>' + esc(n.date) + "</div></div>"
      + '<div class="ezpm-krow"><label>결정자</label><div>' + esc(n.decider) + "</div></div>"
      + '<div class="ezpm-krow"><label>상태</label><div><span class="ezpm-st ' + esc(n.state) + '">' + esc(n.stateLabel) + "</span></div></div>"
      + (n.note ? '<div class="ezpm-note">' + esc(n.note) + "</div>" : "")
      + '<div class="ezpm-evh">인용 근거 ' + n.evidence.length + "건"
      + (n.state === "done" ? '<span class="ezpm-evok">&#10003; 근거 확인 완료</span>' : "")
      + "</div>"
      + evidenceHTML(n.evidence)
      + (m ? '<button class="ezpm-lbtn" data-ezpm-ledger="' + esc(m.id) + '">성과 히스토리에서 보기<span class="ezpm-lat">' + esc(m.at || "") + "</span></button>" : "");
    openPane(html);
  }

  function renderStagePane(stageKey) {
    var list = ledgerList() || [];
    var entries = list.filter(function (e) { return e && STAGE_OF_TYPE[e.type] === stageKey; }).slice(0, 12);
    var body = entries.length ? entries.map(function (e) {
      return '<div class="ezpm-ev">'
        + '<span class="et">' + esc(TYPE_CHIP[e.type] || e.type) + "</span>"
        + '<span class="ezpm-lat">' + esc(e.at || "") + "</span>"
        + '<div class="evt">' + esc(e.title) + "</div>"
        + (e.summary ? '<div class="evx">' + esc(e.summary) + "</div>" : "")
        + '<span class="src">' + esc(e.source || "") + "</span><br>"
        + '<button class="ezpm-lbtn" data-ezpm-ledger="' + esc(e.id) + '">성과 히스토리에서 보기</button>'
        + "</div>";
    }).join("") : '<div class="ezpm-empty">이 단계에 쌓인 성과 기록이 아직 없습니다. 체크인·1:1 확정 등 기능을 쓸수록 기록이 쌓입니다.</div>';
    openPane('<div class="ph"><h3>성과 히스토리 · ' + esc(STAGE_NAME[stageKey] || stageKey) + " (" + entries.length + '건)</h3>'
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
      + '<marker id="ezpm-arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4L0 8z" fill="#1F7AF0" opacity=".45"/></marker>'
      + '<marker id="ezpm-arr-hl" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4L0 8z" fill="#1F7AF0"/></marker>'
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
  function open(empId) {
    injectStyle();
    close();
    curSubjectId = (empId && empById(empId)) ? empId : CU().emp_id;
    var ov = document.createElement("div");
    ov.className = "ezpm-root";
    ov.setAttribute("data-ezpm-root", "1");
    ov.innerHTML =
      '<div class="ezpm-card" role="dialog" aria-modal="true" aria-label="성과 프로세스 맵">'
      + '<div class="ezpm-head">'
      + '<div class="tl"><h2>성과 프로세스 맵</h2><p>이번 사이클의 논의와 결정, 그 근거를 한 장으로 봅니다</p></div>'
      + '<span class="ezpm-asof">' + esc(AS_OF) + "</span>"
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
      + ">&#9672; 프로세스 맵</button>";
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
        chip.title = "성과 사이클 — 목표수립·실행 완료, 지금 평가 단계 · 클릭하면 과정과 근거를 한 장으로 봅니다";
        chip.innerHTML = '&#9672; 사이클 <span class="stp">목표 &#10003;</span><span class="sep">&#8250;</span>'
          + '<span class="stp">실행 &#10003;</span><span class="sep">&#8250;</span>'
          + '<span class="cur">평가 진행중</span><span class="sep">&#8250;</span>'
          + '<span class="nxt">리뷰 예정</span>';
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
      dchip.title = "성과 사이클 — 목표수립·실행 완료, 지금 평가 단계 · 클릭하면 과정과 근거를 한 장으로 봅니다";
      dchip.innerHTML = '&#9672; <span class="cur">평가 진행중</span><span class="sep">&#8250;</span><span class="nxt">리뷰</span>';
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
      var id = node.getAttribute("data-ezpm-node");
      selectedNode = id;
      var ov2 = overlay();
      var prev = ov2.querySelector(".ezpm-node.sel");
      if (prev) prev.classList.remove("sel");
      node.classList.add("sel");
      applyLineHL();
      renderNodePane(id);
      return;
    }
  });

  document.addEventListener("change", function (e) {
    var sel = e.target && e.target.closest ? e.target.closest("[data-ezpm-subject]") : null;
    if (!sel) return;
    curSubjectId = sel.value;
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

  /* ================= 부트스트랩 ================= */
  function boot() {
    injectStyle();
    tryInjectButtons();

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
  window.EZJourney = { open: open, close: close };
})();
