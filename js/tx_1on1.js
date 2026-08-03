/* ============================================================================
 * tx_1on1.js — 1on1 자동 녹음·요약 + 성과관리 전주기 커버리지 맵
 * ----------------------------------------------------------------------------
 * [기획 스펙]
 * ① 배경/문제
 *    - elizax는 성과관리 전 주기(목표수립→실행/중간점검→평가→피드백/리뷰)를
 *      커버하지만 1:1 미팅(1on1)은 AI 미지원 공백이다.
 *    - 1on1은 사용 빈도가 높고 살아있는 대화 맥락이 흐르는 접점이라
 *      "맥락 축적 기여도"가 전 기능 중 최상 — 신규 기능 1순위로 선정.
 *    - 녹음→전사→요약→사람 확정→맥락 원장(ez:ctx) 축적 파이프라인을
 *      전부 오프라인 시뮬로 보여준다.
 * ② 사용자 시나리오
 *    - 성과관리 › 1:1 미팅 탭 → 미팅 상세 상단의 "⏺ elizax 녹음·요약" 클릭.
 *    - 녹음 바(REC 점멸·경과 타이머·파형)가 뜨고 라이브 전사가 1.4~2s 간격으로
 *      쌓인다(관리자↔구성원 9줄: KR2 진행·외부 API 지연 리스크·지원 요청·
 *      ML 교육 니즈·다음 체크인 합의 — 이름은 TALENX_DATA에서 실제로 읽음).
 *    - "종료·요약 생성" 클릭(또는 대본 소진 시 자동) → 1.2s "요약 생성 중"
 *      → 요약 카드: 논의 주제 3(원천 전사 줄 인용 칩 "rec.0716 · 00:42") +
 *      액션 아이템 2(담당·기한) + 감지 신호 2(일정 리스크·성장 니즈) +
 *      as-of 스탬프 + suggest 배지.
 *    - 확정 게이트(tx_agent 어휘 재사용: "결정 게이트 · 사람이 확정 (승인 전
 *      side-effect 0)")에서 [기록 확정·맥락 축적] → ez:ctx CustomEvent 발행
 *      (tx_ctx_ledger가 수신·저장) + 토스트 + "✓ 확정 · 감사 기록됨".
 *      [폐기] → 카드 접힘, 아무것도 축적하지 않음(맥락 오염 방지).
 *    - "전주기 커버리지 맵" 링크(주입 바) 또는 EZCycle.openMap() →
 *      4단계 컬럼 × 기능 카드(제공중/신규/후보) + 우선순위 2기준
 *      (빈도 ★1~3 · 맥락기여 ★1~3) 오버레이.
 * ③ 동작 정의
 *    - 주입 지점: #s-perf .subpage[data-p="2"] .mt-main 상단.
 *      tx_fix_perf가 탭 전환·미팅 클릭마다 .mt-main innerHTML을 통째로
 *      재구성하므로 MutationObserver(#s-perf 서브트리) + 초기 300ms×20회
 *      폴링으로 ".mt-main이 있고 내 바가 없으면 주입"을 반복한다(멱등).
 *    - 클릭 처리는 전부 document 레벨 이벤트 위임(data-ez1o 속성 라우팅).
 *    - 확정 시 localStorage(elizax_1on1_v1:<emp_id>)에 확정 기록을 남겨
 *      재진입 시 "✓ 요약 확정됨" 상태 줄을 보여준다.
 *    - 아젠다 추천은 고정 문자열이 아니라 대상자의 실데이터(TALENX_DATA의
 *      objectives/keyResults/checkins + feedbackHistory + 원장)에서만 도출하고,
 *      각 항목에 원본 레코드 id 근거 칩을 붙인다(원장 항목은 클릭 시 openPanel).
 *      실데이터가 없으면 채우지 않고 "기록이 아직 없습니다"로 정직하게 비운다.
 *    - 받아쓰기 대본은 데모 자산 — 화면에 "데모 전사문"으로 계속 명시한다.
 *      실AI 요약에는 대상자 실데이터 컨텍스트를 함께 주입하고, 기존 요약을
 *      덮어쓰기 전 스냅샷을 [이전 버전] 토글로 남긴다(비가역 덮어쓰기 금지).
 *    - 합의 항목은 [체크인 초안으로](ez:1on1-agreement 발행) / [다음 아젠다로]
 *      (localStorage nextAgenda 이월)로 착지한다 — 이벤트 계약은 본문 주석 참조.
 *    - 역할 관점(F10): leader는 팀 관점(리스크·정체 우선), member는 본인 관점
 *      (내 약속·지원 요청 우선)으로 아젠다 문구·순서와 요약 프롬프트가 달라진다.
 *    - 노출: window.EZOneOnOne = {start, openMap}, window.EZCycle = {openMap}.
 * ④ 엣지 케이스
 *    - 녹음 중 화면 재렌더로 DOM이 사라지면 타이머 틱마다
 *      document 포함 여부를 검사해 세션을 조용히 종료한다(고아 타이머 0).
 *    - 녹음 중 재클릭 방지(세션 단일화), 게이트 결정 후 버튼 비활성.
 *    - 전역(TALENX_DATA/TX/EZLedger) 미존재 시 조용히 degrade:
 *      이름은 폴백("김수민"/"구성원"), ez:ctx는 수신자가 없어도 발행만 한다.
 *    - innerHTML 조립 시 데이터 유래 문자열은 전부 esc().
 * ========================================================================== */
(function () {
  "use strict";

  /* 기준 시점은 EZClock 단일 발급(P6) — 하드코딩 드리프트 금지 */
  function AS_OF() { return (window.EZKit ? EZKit.clock.asOf() : "2026-07-16 06:00") + " 기준"; }
  var REC_ID = "rec.0716";
  var LS_PREFIX = "elizax_1on1_v1:";

  /* ---------------- 데이터 접근 ---------------- */
  function D() { return window.TALENX_DATA || {}; }
  function CU() { return (D().meta && D().meta.currentUser) || { name: "구성원", emp_id: "EMP-0000" }; }
  function empById(id) {
    var list = D().employees || [];
    for (var i = 0; i < list.length; i++) if (list[i].emp_id === id) return list[i];
    return null;
  }
  function memberName() { return CU().name || "구성원"; }
  function managerName() {
    var cu = CU();
    var mgr = cu.manager_id ? empById(cu.manager_id) : null;
    return (mgr && mgr.name) || cu.managerName || "김수민";
  }
  function myObjectiveTitle() {
    var cu = CU(), objs = D().objectives || [];
    for (var i = 0; i < objs.length; i++) {
      if (objs[i].owner_emp_id === cu.emp_id && objs[i].title) return objs[i].title;
    }
    return "서비스 기획 품질 및 사용자 만족도 향상";
  }
  /* ---------------- 롤/팀/원장 헬퍼 ---------------- */
  function roleKey() {
    var cu = CU();
    if (cu && cu._role) return cu._role;
    try { if (window.TXRoles && TXRoles.current) return TXRoles.current().key || "member"; } catch (e) { /* ignore */ }
    return "member";
  }
  function teamMembers() {
    var my = CU().emp_id, list = D().employees || [], out = [];
    for (var i = 0; i < list.length; i++) if (list[i].manager_id === my) out.push(list[i]);
    return out;
  }
  var selMemId = null; /* leader가 드롭다운에서 고른 팀원 */
  function selMember() {
    var tm = teamMembers();
    if (!tm.length) return null;
    for (var i = 0; i < tm.length; i++) if (tm[i].emp_id === selMemId) return tm[i];
    return tm[0];
  }
  function objTitleFor(empId) {
    var objs = D().objectives || [];
    for (var i = 0; i < objs.length; i++) if (objs[i].owner_emp_id === empId && objs[i].title) return objs[i].title;
    return "담당 업무 품질 및 협업 만족도 향상";
  }

  /* ---------------- 실데이터 접근 (TALENX_DATA objectives/keyResults/checkins) ----------------
     아젠다·요약 컨텍스트의 단일 원천. 시연용 고정 문자열은 여기서 만들지 않는다. */
  function asOfDate() { return window.EZKit ? EZKit.clock.asOfDate() : "2026-07-16"; }
  function dayDiff(from, to) {           /* "YYYY-MM-DD" 두 개 → 경과 일수(음수 가능) */
    var a = Date.parse(String(from || "") + "T00:00:00"), b = Date.parse(String(to || "") + "T00:00:00");
    if (isNaN(a) || isNaN(b)) return NaN;
    return Math.round((b - a) / 86400000);
  }
  /* period 문자열("FY2026-2Q"/"FY2026-1H"/"FY2026") → 종료일. 데이터에 마감일 필드가 없어 기간에서 도출 */
  function periodEnd(period) {
    var s = String(period || ""), y = (s.match(/(20\d\d)/) || [])[1];
    if (!y) return "";
    if (/1Q/.test(s)) return y + "-03-31";
    if (/2Q/.test(s)) return y + "-06-30";
    if (/3Q/.test(s)) return y + "-09-30";
    if (/4Q/.test(s)) return y + "-12-31";
    if (/1H/.test(s)) return y + "-06-30";
    return y + "-12-31";
  }
  function objectivesOwned(empId) {
    return (D().objectives || []).filter(function (o) { return o.owner_emp_id === empId; });
  }
  function objById(id) {
    var objs = D().objectives || [];
    for (var i = 0; i < objs.length; i++) if (objs[i].objective_id === id) return objs[i];
    return null;
  }
  function krById(id) {
    var ks = D().keyResults || [];
    for (var i = 0; i < ks.length; i++) if (ks[i].kr_id === id) return ks[i];
    return null;
  }
  /* 대상자가 실제로 관여한 KR 집합 — 본인 소유 목표의 KR ∪ 본인이 체크인한 KR
     (팀원은 조직 목표에 체크인만 하는 경우가 있어 소유 목표만 보면 데이터가 비어 보인다) */
  function krsInvolved(empId) {
    var seen = {}, out = [], i, ks;
    objectivesOwned(empId).forEach(function (o) {
      ks = (D().keyResults || []).filter(function (k) { return k.objective_id === o.objective_id; });
      for (i = 0; i < ks.length; i++) if (!seen[ks[i].kr_id]) { seen[ks[i].kr_id] = 1; out.push(ks[i]); }
    });
    (D().checkins || []).forEach(function (c) {
      if (c.emp_id !== empId || !c.kr_id || seen[c.kr_id]) return;
      var k = krById(c.kr_id);
      if (k) { seen[k.kr_id] = 1; out.push(k); }
    });
    return out;
  }
  /* 해당 KR에 대한 대상자의 체크인 — 날짜 오름차순. 본인 체크인이 없으면 KR 전체로 폴백 */
  function checkinsFor(empId, krId) {
    var all = (D().checkins || []).filter(function (c) { return c.kr_id === krId; });
    var mine = all.filter(function (c) { return c.emp_id === empId; });
    var use = mine.length ? mine : all;
    return use.slice().sort(function (a, b) { return String(a.checkin_date) < String(b.checkin_date) ? -1 : 1; });
  }
  function primaryObjectiveId(empId) {
    var owned = objectivesOwned(empId);
    if (owned.length) return owned[0].objective_id;
    var ks = krsInvolved(empId);
    return ks.length ? ks[0].objective_id : "";
  }
  /* 대화 화자 짝 — member: 상사(관리자)↔본인 / leader: 본인(주관)↔선택 팀원 */
  function pair() {
    if (roleKey() === "leader") {
      var m = selMember();
      if (m) return { mgr: CU().name || "조직장", mem: m.name || "팀원", obj: objTitleFor(m.emp_id), memId: m.emp_id };
    }
    return { mgr: managerName(), mem: memberName(), obj: myObjectiveTitle(), memId: null };
  }
  function cut(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function ledgerList() {
    try { if (window.EZLedger && EZLedger.list) return EZLedger.list() || []; } catch (e) { /* 미로드 */ }
    return [];
  }
  /* leader — 팀원별 최근 1:1(확정 원장 기준, source에 emp_id 명시) */
  function lastOneOnOneAt(empId) {
    var L = ledgerList();
    for (var i = 0; i < L.length; i++) {
      var it = L[i];
      if (it.type === "oneonone" && it.source && String(it.source).indexOf("." + empId) >= 0) {
        return String(it.at || "").split(" ")[0];
      }
    }
    return "";
  }
  function lastOneOnOneEntry() {
    var L = ledgerList();
    for (var i = 0; i < L.length; i++) if (L[i].type === "oneonone") return L[i];
    return null;
  }

  function lsKey() { return LS_PREFIX + CU().emp_id; }
  function loadState() {
    try { return JSON.parse(localStorage.getItem(lsKey()) || "{}"); } catch (e) { return {}; }
  }
  function saveState(s) {
    try { localStorage.setItem(lsKey(), JSON.stringify(s)); } catch (e) { /* quota 등 무시 */ }
  }

  /* ---------------- 유틸 ---------------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function toast(m, k) { if (window.TX && TX.toast) TX.toast(m, k || ""); }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  /* ---------------- 대본 (오프라인 시뮬 · 이름은 데이터에서) ---------------- */
  function buildScript() {
    var p = pair(), MGR = p.mgr, MEM = p.mem, OBJ = p.obj;
    return [
      { who: "mgr", name: MGR, t: "00:04", text: "지난 체크인 이후 상황부터 볼까요? '" + OBJ + "' 목표의 KR2 진행이 궁금하네요." },
      { who: "mem", name: MEM, t: "00:16", text: "KR2는 신규 기획 3건이 사용자 검증을 통과했고, 잔여 2건은 검증 설계 중입니다. 진행률은 68% 수준이에요." },
      { who: "mgr", name: MGR, t: "00:31", text: "좋네요. 일정 쪽에 리스크는 없나요?" },
      { who: "mem", name: MEM, t: "00:42", text: "하나 있습니다. 외부 연동 파트너 응답이 2주째 지연되고 있어서, 이대로면 잔여 2건 검증 일정이 다음 달로 밀릴 수 있어요." },
      { who: "mgr", name: MGR, t: "00:58", text: "그 건은 제가 파트너십 팀에 에스컬레이션할게요. 그 외에 필요한 지원이 있을까요?" },
      { who: "mem", name: MEM, t: "01:10", text: "검증 리뷰어가 한 명 더 붙으면 리드타임을 확실히 줄일 수 있을 것 같습니다." },
      { who: "mem", name: MEM, t: "01:24", text: "그리고 다음 분기에는 추천 로직 쪽 업무를 맡아보고 싶은데, 머신러닝 기초 교육을 들을 수 있을까요?" },
      { who: "mgr", name: MGR, t: "01:37", text: "좋은 방향이에요. 교육 예산 승인을 올려볼 테니 HR 교육 카탈로그에서 과정을 골라 공유해 주세요." },
      { who: "mgr", name: MGR, t: "01:49", text: "그럼 다음 체크인은 다음 주 화요일로 하고, 그때 KR2 잔여 2건 일정을 다시 봅시다." }
    ];
  }

  /* ---------------- 스타일 주입 (self-contained) ---------------- */
  function injectStyle() {
    if (document.getElementById("ez1o-style")) return;
    var st = document.createElement("style");
    st.id = "ez1o-style";
    st.textContent = [
      /* 주입 바 — §9(PLAN-19): .ezsurf(공통 표시) + 제목줄/버튼줄 분리(.ez1o-barrow) */
      ".ez1o-bar{display:flex;flex-direction:column;gap:8px;margin:0 0 14px;}",
      ".ez1o-barrow{display:flex;align-items:center;flex-wrap:wrap;gap:8px;}",
      ".ez1o-btn{cursor:pointer;border:none;border-radius:var(--radius-full,999px);padding:7px 14px;font-size:12.5px;font-weight:700;",
      "color:var(--color-on-accent,#fff);background:var(--color-accent,#1F7AF0);transition:filter var(--duration-fast,.12s);}",
      ".ez1o-btn:hover{filter:brightness(1.07);}",
      ".ez1o-btn:disabled{opacity:.5;cursor:default;}",
      ".ez1o-badge{font-size:10px;font-weight:600;border-radius:var(--radius-full,999px);padding:2px 9px;white-space:nowrap;",
      "color:var(--color-trust,#23408E);background:color-mix(in srgb, var(--color-accent,#17F) 7%, transparent);border:1px solid color-mix(in srgb, var(--color-accent,#17F) 30%, transparent);}",
      ".ez1o-note{font-size:12.5px;color:var(--color-text-secondary,#6B7280);}",
      ".ez1o-linkbtn{cursor:pointer;margin-left:auto;border:1px solid var(--color-border,#E4E7EC);border-radius:var(--radius-full,999px);",
      "padding:5px 12px;font-size:11.5px;font-weight:600;color:var(--color-accent,#1F7AF0);background:var(--color-background-card,#fff);}",
      ".ez1o-linkbtn:hover{border-color:var(--color-accent,#1F7AF0);background:color-mix(in srgb, var(--color-accent,#17F) 5%, transparent);}",
      ".ez1o-donetag{font-size:11px;font-weight:600;color:var(--color-success,#15803D);}",
      /* 녹음 패널 */
      ".ez1o-panel{margin:0 0 14px;}",
      ".ez1o-rec{border:1px solid var(--color-border,#E4E7EC);border-radius:var(--radius-container,14px);background:var(--color-background-card,#fff);overflow:hidden;}",
      ".ez1o-rechead{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--color-border,#E4E7EC);background:var(--color-background-muted,#F8FAFC);}",
      ".ez1o-dot{width:10px;height:10px;border-radius:50%;background:var(--color-error,#DC2626);animation:ezkBlink 1s ease-in-out infinite;flex:none;}",
      ".ez1o-timer{font-size:13px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--color-error,#DC2626);min-width:44px;}",
      ".ez1o-wave{display:flex;align-items:flex-end;gap:2px;height:18px;flex:none;}",
      ".ez1o-wave i{width:3px;border-radius:2px;background:var(--color-accent,#1F7AF0);animation:ez1oWave 1.1s ease-in-out infinite;}",
      ".ez1o-wave i:nth-child(1){height:6px;animation-delay:0s}.ez1o-wave i:nth-child(2){height:14px;animation-delay:.15s}",
      ".ez1o-wave i:nth-child(3){height:9px;animation-delay:.3s}.ez1o-wave i:nth-child(4){height:16px;animation-delay:.45s}",
      ".ez1o-wave i:nth-child(5){height:7px;animation-delay:.6s}.ez1o-wave i:nth-child(6){height:12px;animation-delay:.75s}",
      "@keyframes ez1oWave{0%,100%{transform:scaleY(.4)}50%{transform:scaleY(1)}}",
      ".ez1o-reclab{font-size:12.5px;color:var(--color-text-secondary,#6B7280);}",
      ".ez1o-stop{cursor:pointer;margin-left:auto;border:1px solid var(--color-error,#DC2626);border-radius:var(--radius-full,999px);padding:5px 13px;",
      "font-size:11.5px;font-weight:700;color:var(--color-error,#DC2626);background:var(--color-background-card,#fff);}",
      ".ez1o-stop:hover{background:color-mix(in srgb, var(--color-error,#d32) 6%, transparent);}",
      ".ez1o-tr{max-height:220px;overflow-y:auto;padding:10px 14px;display:flex;flex-direction:column;gap:8px;}",
      ".ez1o-line{display:flex;gap:8px;font-size:12.5px;line-height:1.55;animation:ezkInsert var(--duration-fast,.25s) var(--ease-standard,ease);}",
      ".ez1o-line .tm{flex:none;font-size:10.5px;color:var(--color-text-secondary,#9CA3AF);font-variant-numeric:tabular-nums;padding-top:2px;}",
      ".ez1o-line .nm{flex:none;font-weight:700;}",
      ".ez1o-line.mgr .nm{color:var(--color-text-purple,#6D28D9);}.ez1o-line.mem .nm{color:var(--color-accent,#1F7AF0);}",
      ".ez1o-gen{display:flex;align-items:center;gap:10px;padding:16px;font-size:12.5px;color:var(--color-text-secondary,#6B7280);}",
      ".ez1o-spin{width:14px;height:14px;border-radius:50%;border:2px solid var(--color-border,#E4E7EC);border-top-color:var(--color-accent,#1F7AF0);animation:ezkSpin .8s linear infinite;flex:none;}",
      /* 요약 카드 */
      ".ez1o-sum{border:1px solid var(--color-border,#E4E7EC);border-radius:var(--radius-container,14px);background:var(--color-background-card,#fff);padding:14px 16px;}",
      ".ez1o-sum.ez1o-collapsed .ez1o-body,.ez1o-sum.ez1o-collapsed .ezk-receipt-body{display:none;}",
      ".ez1o-sumhead{display:flex;align-items:center;flex-wrap:wrap;gap:8px;}",
      ".ez1o-sumhead .tt{font-size:14px;font-weight:800;}",
      ".ez1o-asof{font-size:10.5px;color:var(--color-text-secondary,#9CA3AF);margin-left:auto;}",
      ".ez1o-h4{font-size:11.5px;font-weight:700;color:var(--color-text-secondary,#6B7280);margin:14px 0 6px;}",
      ".ez1o-topic{display:flex;gap:8px;align-items:baseline;font-size:12.5px;line-height:1.6;margin:4px 0;}",
      ".ez1o-topic .no{flex:none;width:16px;height:16px;border-radius:50%;background:var(--color-accent-muted,#EAF2FE);color:var(--color-accent,#1F7AF0);",
      "font-size:10px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;transform:translateY(2px);}",
      ".ez1o-src{display:inline-block;font-size:10px;font-weight:600;border-radius:var(--radius-inner,5px);padding:1px 7px;margin-left:5px;vertical-align:middle;",
      "color:var(--color-accent,#1F7AF0);background:color-mix(in srgb, var(--color-accent,#17F) 8%, transparent);border:1px solid color-mix(in srgb, var(--color-accent,#17F) 30%, transparent);white-space:nowrap;}",
      ".ez1o-act{display:flex;gap:8px;align-items:baseline;font-size:12.5px;line-height:1.6;margin:4px 0;}",
      ".ez1o-act .bx{flex:none;width:12px;height:12px;border:1.5px solid var(--color-border-emphasized,#CBD5E1);border-radius:3px;transform:translateY(2px);}",
      ".ez1o-act .own{font-size:11px;color:var(--color-text-secondary,#6B7280);}",
      ".ez1o-sig{display:flex;gap:8px;align-items:baseline;font-size:12.5px;line-height:1.6;margin:4px 0;padding:7px 10px;border-radius:var(--radius-element,8px);}",
      ".ez1o-sig.risk{background:color-mix(in srgb, var(--color-warning,#B50) 7%, transparent);border:1px solid color-mix(in srgb, var(--color-warning,#B50) 25%, transparent);}",
      ".ez1o-sig.grow{background:color-mix(in srgb, var(--color-success,#180) 6%, transparent);border:1px solid color-mix(in srgb, var(--color-success,#180) 25%, transparent);}",
      ".ez1o-sig .ic{flex:none;}",
      /* 게이트 (tx_agent 어휘 재사용) */
      ".ez1o-gate{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:14px;padding:11px 13px;",
      "background:var(--color-background-card,#fff);border:1px dashed var(--color-border-emphasized,#CBD5E1);border-radius:var(--radius-container,14px);}",
      ".ez1o-gate .lab{font-size:11.5px;color:var(--color-text-secondary,#6B7280);margin-right:auto;}",
      ".ez1o-gbtn{cursor:pointer;border:1px solid var(--color-border,#E4E7EC);border-radius:var(--radius-full,999px);padding:6px 13px;font-size:12px;",
      "font-weight:600;color:var(--color-text-primary,#1D2433);background:var(--color-background-card,#fff);transition:background var(--duration-fast,.12s);}",
      ".ez1o-gbtn:hover{background:color-mix(in srgb, var(--color-accent,#17F) 6%, transparent);}",
      ".ez1o-gbtn.primary{color:var(--color-on-accent,#fff);background:var(--color-trust,#23408E);border-color:var(--color-trust,#23408E);}",
      ".ez1o-gbtn.primary:hover{background:color-mix(in srgb, var(--color-trust,#23408E) 85%, black);}",
      ".ez1o-gbtn:disabled{opacity:.45;cursor:default;}",
      ".ez1o-gbtn[data-chosen=\"1\"]{opacity:1!important;box-shadow:0 0 0 2px var(--color-trust-warm,#C2410C) inset;}",
      ".ez1o-dec{font-size:12px;font-weight:600;color:var(--color-success,#15803D);}",
      ".ez1o-drop{font-size:11.5px;color:var(--color-text-secondary,#6B7280);margin-top:8px;}",
      /* 커버리지 맵 오버레이 */
      ".ez1o-mapov{position:fixed;inset:0;z-index:1300;background:var(--color-overlay,rgba(15,23,42,.45));display:flex;align-items:center;justify-content:center;padding:24px;}",
      ".ez1o-map{background:var(--color-background-card,#fff);border-radius:var(--radius-container,18px);max-width:1080px;width:100%;max-height:88vh;overflow-y:auto;",
      "box-shadow:0 24px 64px rgba(15,23,42,.3);padding:22px 24px;}",
      ".ez1o-maphead{display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;}",
      ".ez1o-maphead .tt{font-size:16.5px;font-weight:800;}",
      ".ez1o-maphead .principle{flex-basis:100%;font-size:12px;color:var(--color-warning,#B45309);background:color-mix(in srgb, var(--color-warning,#B50) 7%, transparent);",
      "border:1px solid color-mix(in srgb, var(--color-warning,#B50) 25%, transparent);border-radius:var(--radius-element,8px);padding:7px 11px;margin-top:6px;}",
      ".ez1o-mapx{cursor:pointer;margin-left:auto;border:none;background:none;font-size:18px;color:var(--color-text-secondary,#6B7280);line-height:1;}",
      ".ez1o-legend{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--color-text-secondary,#6B7280);margin:10px 0 14px;}",
      ".ez1o-cols{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;}",
      "@media(max-width:920px){.ez1o-cols{grid-template-columns:repeat(2,1fr);}}",
      ".ez1o-col{background:var(--color-background-muted,#F8FAFC);border:1px solid var(--color-border,#E4E7EC);border-radius:var(--radius-container,14px);padding:12px;}",
      ".ez1o-col>.ch{font-size:12.5px;font-weight:800;margin-bottom:10px;display:flex;align-items:center;gap:6px;}",
      ".ez1o-col>.ch .step{width:18px;height:18px;border-radius:50%;background:var(--color-trust,#23408E);color:var(--color-on-accent,#fff);font-size:10px;font-weight:800;",
      "display:inline-flex;align-items:center;justify-content:center;}",
      ".ez1o-card{background:var(--color-background-card,#fff);border:1px solid var(--color-border,#E4E7EC);border-radius:var(--radius-element,10px);padding:9px 11px;margin-bottom:8px;}",
      ".ez1o-card.new{border:1.5px solid var(--color-trust-warm,#C2410C);box-shadow:0 0 0 3px color-mix(in srgb, var(--color-trust-warm,#C40) 8%, transparent);}",
      ".ez1o-card.cand{border-style:dashed;opacity:.85;}",
      ".ez1o-card .nm{font-size:12px;font-weight:700;line-height:1.4;}",
      ".ez1o-st{font-size:9.5px;font-weight:700;border-radius:var(--radius-full,999px);padding:1px 8px;white-space:nowrap;display:inline-block;margin-bottom:5px;}",
      ".ez1o-st.live{color:var(--color-success,#15803D);background:color-mix(in srgb, var(--color-success,#180) 8%, transparent);border:1px solid color-mix(in srgb, var(--color-success,#180) 30%, transparent);}",
      ".ez1o-st.new{color:var(--color-trust-warm,#C2410C);background:color-mix(in srgb, var(--color-trust-warm,#C40) 8%, transparent);border:1px solid color-mix(in srgb, var(--color-trust-warm,#C40) 35%, transparent);}",
      ".ez1o-st.cand{color:var(--color-text-secondary,#6B7280);background:var(--color-background-muted,#F8FAFC);border:1px solid var(--color-border-emphasized,#CBD5E1);}",
      ".ez1o-stars{display:flex;gap:10px;font-size:10.5px;color:var(--color-text-secondary,#6B7280);margin-top:6px;}",
      ".ez1o-stars b{color:var(--color-warning,#B45309);font-weight:700;letter-spacing:1px;}",
      /* 아젠다·팀원 선택 */
      ".ez1o-agenda{padding:12px 14px;}",
      ".ez1o-agrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;}",
      ".ez1o-aglist{display:flex;flex-direction:column;gap:9px;}",
      ".ez1o-agitem{display:flex;align-items:center;gap:7px;flex-wrap:wrap;}",
      /* ↓ 이 규칙은 닫는 중괄호가 빠져 있어 .ez1o-chip.on(선택 표시)이 전혀 먹지 않았다 */
      ".ez1o-chip{cursor:pointer;border:1px solid var(--color-border,#E4E7EC);border-radius:999px;padding:5px 12px;font-size:11.5px;",
      "font-weight:600;color:var(--color-text-primary,#1D2433);background:var(--color-background-card,#fff);text-align:left;}",
      ".ez1o-chip.on{color:var(--color-on-accent,#fff);background:var(--color-accent,#1F7AF0);border-color:var(--color-accent,#1F7AF0);}",
      ".ez1o-evs{display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap;}",
      ".ez1o-ev{font-size:10px;font-weight:600;font-variant-numeric:tabular-nums;border-radius:var(--radius-inner,5px);padding:2px 7px;",
      "color:var(--color-text-secondary,#6B7280);background:var(--color-background-muted,#F8FAFC);border:1px solid var(--color-border,#E4E7EC);}",
      ".ez1o-ev.lk{cursor:pointer;color:var(--color-accent,#1F7AF0);border-color:color-mix(in srgb, var(--color-accent,#17F) 35%, transparent);}",
      ".ez1o-ev.lk:hover{background:color-mix(in srgb, var(--color-accent,#17F) 8%, transparent);}",
      ".ez1o-why{flex-basis:100%;font-size:11px;color:var(--color-text-secondary,#6B7280);padding-left:2px;}",
      ".ez1o-empty{font-size:12.5px;line-height:1.6;color:var(--color-text-secondary,#6B7280);padding:10px 12px;border-radius:var(--radius-element,8px);",
      "background:var(--color-background-muted,#F8FAFC);border:1px dashed var(--color-border-emphasized,#CBD5E1);}",
      ".ez1o-xag{cursor:pointer;border:none;background:none;font-size:11px;color:var(--color-text-secondary,#9CA3AF);padding:0 4px;}",
      ".ez1o-agin{flex:1;min-width:180px;border:1px solid var(--color-border,#E4E7EC);border-radius:var(--radius-element,8px);padding:6px 10px;font-size:12.5px;}",
      ".ez1o-sel{border:1px solid var(--color-border,#E4E7EC);border-radius:var(--radius-full,999px);padding:5px 10px;font-size:11.5px;",
      "background:var(--color-background-card,#fff);color:var(--color-text-primary,#1D2433);}",
      ".ez1o-prom{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px;padding:8px 11px;font-size:11.5px;",
      "border-radius:var(--radius-element,8px);background:var(--color-background-muted,#F8FAFC);border:1px solid var(--color-border,#E4E7EC);}",
      ".ez1o-prom .tg{cursor:pointer;margin-left:auto;border:1px solid var(--color-border,#E4E7EC);border-radius:var(--radius-full,999px);",
      "padding:4px 11px;font-size:11px;font-weight:600;background:var(--color-background-card,#fff);color:var(--color-text-primary,#1D2433);}",
      ".ez1o-prom .tg.done{color:var(--color-success,#15803D);border-color:color-mix(in srgb, var(--color-success,#180) 35%, transparent);}",
      /* 데모 자산 고지 · 합의 착지 · 이전 버전 토글 */
      ".ez1o-demo{font-size:10px;font-weight:600;border-radius:var(--radius-full,999px);padding:2px 9px;white-space:nowrap;",
      "color:var(--color-warning,#B45309);background:color-mix(in srgb, var(--color-warning,#B50) 8%, transparent);",
      "border:1px solid color-mix(in srgb, var(--color-warning,#B50) 30%, transparent);}",
      ".ez1o-agree{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12.5px;line-height:1.6;margin:6px 0;padding:7px 10px;",
      "border-radius:var(--radius-element,8px);background:var(--color-background-muted,#F8FAFC);border:1px solid var(--color-border,#E4E7EC);}",
      ".ez1o-agree .tx{flex:1;min-width:180px;}",
      ".ez1o-lbtn{cursor:pointer;border:1px solid var(--color-border,#E4E7EC);border-radius:var(--radius-full,999px);padding:4px 11px;font-size:11px;",
      "font-weight:600;color:var(--color-accent,#1F7AF0);background:var(--color-background-card,#fff);white-space:nowrap;}",
      ".ez1o-lbtn:hover{background:color-mix(in srgb, var(--color-accent,#17F) 7%, transparent);}",
      ".ez1o-lbtn:disabled{opacity:.5;cursor:default;color:var(--color-text-secondary,#6B7280);}",
      ".ez1o-prev{margin-top:10px;font-size:11.5px;}",
      ".ez1o-prev summary{cursor:pointer;color:var(--color-text-secondary,#6B7280);font-weight:600;}",
      ".ez1o-prevbody{margin-top:8px;padding:10px 12px;border-radius:var(--radius-element,8px);background:var(--color-background-muted,#F8FAFC);",
      "border:1px solid var(--color-border,#E4E7EC);opacity:.9;}",
    ].join("");
    document.head.appendChild(st);
  }

  /* ============================================================
     1) 주입 — .mt-main 상단 바 (MutationObserver + 초기 폴링, 멱등)
     ============================================================ */
  function memSelectHTML() {
    var tm = teamMembers(), cur = selMember(), opts = "";
    for (var i = 0; i < tm.length; i++) {
      var m = tm[i], last = lastOneOnOneAt(m.emp_id);
      opts += '<option value="' + esc(m.emp_id) + '"' + (cur && m.emp_id === cur.emp_id ? " selected" : "") + '>'
        + esc(m.name) + " · " + (last ? "최근 1:1 " + esc(last) : "1:1 기록 없음") + "</option>";
    }
    return '<select class="ez1o-sel" data-ez1o-mem title="1:1 대상 팀원 선택">' + opts + "</select>";
  }

  /* barHTML — §9-2(PLAN-19): .ezsurf 공통 표시를 두른다. 제목 줄(.ezsurf-hd = "elizax ...")과
     동작 줄(.ez1o-barrow = 버튼·안내·링크)을 분리해 배너가 talenx 화면과 뚜렷이 구분되게 한다.
     .ezsurf가 참조하는 astryx 토큰(--color-accent 등)은 `[data-astryx-theme="talenx"] .ezsurf`로
     스코프돼 있다 — 이건 "자손" 선택자라 같은 엘리먼트에 속성과 클래스를 같이 찍으면 매치되지
     않는다(별개 노드여야 함). 그래서 바깥 `.ez1o-bar`에 속성을 찍고, `.ezsurf`는 그 자식으로 둔다.
     3역할 분기 모두 통일 — 이전엔 member 분기에만 속성이 있어 hr·leader 배너는 토큰 스코프 밖이었다. */
  function barHTML() {
    var rk = roleKey();
    var mapBtn = '<button class="ez1o-linkbtn" data-ez1o="map">&#128506; 지원 범위 맵</button>';
    if (rk === "hr") {
      /* HR — 녹음 바 대신 실시율 요약 칩. ponytail: 실시율=시드 수치, 부서별 집계는 후속 */
      var n = 0, L = ledgerList();
      for (var i = 0; i < L.length; i++) if (L[i].type === "oneonone") n++;
      return '<div class="ez1o-bar" data-ez1o-bar data-astryx-theme="talenx"><div class="ezsurf">'
        + '<div class="ezsurf-hd">elizax 1:1 실시 현황</div>'
        + '<div class="ez1o-barrow">'
        + '<span class="ez1o-badge">받아쓰기 기록 ' + n + '건</span>'
        + '<span class="ezsurf-note">최근 30일 실시율 62% (예시 수치) · 부서별 상세는 준비 중입니다</span>'
        + mapBtn + '</div></div></div>'
        + '<div class="ez1o-panel" data-ez1o-panel data-astryx-theme="talenx"></div>';
    }
    if (rk === "leader") {
      var tm = teamMembers();
      return '<div class="ez1o-bar" data-ez1o-bar data-astryx-theme="talenx"><div class="ezsurf">'
        + '<div class="ezsurf-hd">elizax 녹음·요약'
        + '<span class="ez1o-badge" title="요약은 근거와 함께 제안만 합니다. 확정은 사람이 합니다">◐ 제안만</span></div>'
        + '<div class="ez1o-barrow">'
        + '<button class="ez1o-btn" data-ez1o="start">녹음 시작</button>'
        + (tm.length ? memSelectHTML() : '<span class="ezsurf-note">1:1 대상 팀원이 없습니다</span>')
        + '<span class="ezsurf-note">팀원을 선택해 1:1을 주관하세요 · 기록 확정은 사람</span>'
        + mapBtn + '</div></div></div>'
        + '<div class="ez1o-panel" data-ez1o-panel data-astryx-theme="talenx"></div>';
    }
    var confirmed = !!loadState().confirmedAt;
    /* AI 관여 마커는 ✦ 하나(§4, .ezsurf-hd::before가 그린다) — ⏺는 녹음(REC) 상태 인디케이터로만 존속 */
    return '<div class="ez1o-bar" data-ez1o-bar data-astryx-theme="talenx"><div class="ezsurf">'
      + '<div class="ezsurf-hd">elizax 녹음·요약'
      + (window.EZKit ? EZKit.status("suggest") : '<span class="ez1o-badge" title="요약은 근거와 함께 제안만 합니다. 확정은 사람이 합니다">&#9684; 제안만</span>')
      + '</div>'
      + '<div class="ez1o-barrow">'
      + '<button class="ez1o-btn" data-ez1o="start">녹음 시작</button>'
      + '<span class="ezsurf-note">녹음→받아쓰기→요약은 자동, 기록 확정은 사람</span>'
      + (confirmed ? '<span class="ez1o-donetag">&#10003; 요약 확정됨 · 성과 기록 저장</span>' : '')
      + mapBtn
      + '</div></div></div>'
      + '<div class="ez1o-panel" data-ez1o-panel data-astryx-theme="talenx"></div>';
  }

  function tryInject() {
    if (roleKey() === "exec") return; /* 경영진 — 1:1 실무 도구 미주입 */
    var sec = document.getElementById("s-perf");
    if (!sec) return;
    var main = sec.querySelector('.subpage[data-p="2"] .mt-main');
    if (!main || main.querySelector("[data-ez1o-bar]")) return;
    main.insertAdjacentHTML("afterbegin", barHTML());
  }

  /* ============================================================
     2) 녹음 세션 (전부 시뮬)
     ============================================================ */
  var sess = null;   /* {panel, lineTimer, secTimer, idx, sec, script, finished} */

  function stopTimers() {
    if (!sess) return;
    if (sess.lineTimer) clearTimeout(sess.lineTimer);
    if (sess.secTimer) clearInterval(sess.secTimer);
    sess.lineTimer = null; sess.secTimer = null;
  }
  function killSession() { stopTimers(); sess = null; }
  function alive() { return !!(sess && sess.panel && document.body.contains(sess.panel)); }

  var lastRun = null; /* {agenda:[], memId, memName, aiText} — 마지막 녹음 회차 정보(게이트·AI 요약에서 참조) */

  /* ---------------- 아젠다 준비 단계 (Pain T19) ----------------
     대상자의 실제 목표·핵심성과·체크인·피드백·원장에서만 도출한다.
     ④ 역할 관점: 같은 사실이라도 leader는 팀 관점(리스크·정체 우선),
                  member는 본인 관점(내 약속·지원 요청 우선)으로 문구·순서가 달라진다. */
  function targetEmpId() {
    if (roleKey() === "leader") {
      var m = selMember();
      if (m) return m.emp_id;
    }
    return CU().emp_id;
  }
  function targetName(empId) {
    if (empId === CU().emp_id) return roleKey() === "leader" ? (CU().name || "본인") : memberName();
    var e = empById(empId);
    return (e && e.name) || "대상자";
  }
  /* 신호별 우선순위 — 낮을수록 먼저 */
  var SIG_ORDER = {
    leader: { blocker: 0, stall: 1, due: 2, low: 3, promise: 4, feedback: 5 },
    member: { promise: 0, blocker: 1, stall: 2, due: 3, low: 4, feedback: 5 }
  };
  var SIG_TEXT = {
    leader: {
      promise: "지난 1:1 약속 확인 — ", blocker: "블로커 해소 지원 — ", stall: "진척 정체 점검 — ",
      due: "기간 마감 리스크 — ", low: "달성률 점검 — ", feedback: "피드백 후속 코칭 — "
    },
    member: {
      promise: "지난 1:1 약속 이행 — ", blocker: "막힌 곳 지원 요청 — ", stall: "제 진척 공유 — ",
      due: "기간 마감 대응 — ", low: "달성률 만회 방안 — ", feedback: "받은 피드백 실행 — "
    }
  };
  var STALL_DAYS = 21;   /* 체크인 공백 판정 기준 */
  var LOW_PROGRESS = 60; /* 달성률 낮음 판정 기준(%) */
  var MAX_AGENDA = 4;

  /* 실데이터 사실 수집 → [{sig, text, why, refs:[{label,id,ledgerId}]}] */
  function agendaFacts(empId) {
    var rk = roleKey() === "leader" ? "leader" : "member";
    var TXT = SIG_TEXT[rk], today = asOfDate(), out = [], seen = {};
    function push(sig, label, why, refs) {
      var key = sig + "|" + label;
      if (seen[key]) return;
      seen[key] = 1;
      out.push({ sig: sig, text: TXT[sig] + cut(label, 22), why: why, refs: refs || [] });
    }

    /* (1) 원장 — 지난 1:1 합의 중 이행 확인이 안 된 건 */
    var prom = lastOneOnOneEntry();
    if (prom && !(loadState().promiseDone || {})[prom.id]) {
      push("promise", prom.summary || prom.title, "이행 확인이 아직 표시되지 않은 지난 1:1 합의",
        [{ label: "기록 " + String(prom.at || "").split(" ")[0], id: prom.id, ledgerId: prom.id }]);
    }

    /* (2) 핵심성과 — 블로커 / 진척 정체 / 낮은 달성률 */
    krsInvolved(empId).forEach(function (k) {
      var cks = checkinsFor(empId, k.kr_id), last = cks.length ? cks[cks.length - 1] : null;
      var krRef = { label: k.kr_id, id: k.kr_id };
      if (last && String(last.blocker || "").trim()) {
        /* 블로커 원문은 근거(why)로 — 제목에 붙이면 핵심성과 이름이 잘려 나간다 */
        push("blocker", k.name,
          "최근 체크인(" + last.checkin_date + ")에 기록된 블로커: " + last.blocker,
          [krRef, { label: last.checkin_id, id: last.checkin_id }]);
      }
      if (!last) {
        push("stall", k.name, "이 핵심성과에 체크인 기록이 없습니다", [krRef]);
      } else {
        var gap = dayDiff(last.checkin_date, today);
        if (!isNaN(gap) && gap >= STALL_DAYS) {
          push("stall", k.name, "마지막 체크인 " + last.checkin_date + " · " + gap + "일 경과",
            [krRef, { label: last.checkin_id, id: last.checkin_id }]);
        } else if (Number(last.progress_delta) <= 0) {
          push("stall", k.name, "최근 체크인 진척 변화 없음 (Δ" + Number(last.progress_delta || 0) + "%p)",
            [krRef, { label: last.checkin_id, id: last.checkin_id }]);
        }
      }
      var prog = Number(k.progress);
      if (!isNaN(prog) && prog < LOW_PROGRESS) {
        push("low", k.name, "현재 달성률 " + prog + "% (기준 " + LOW_PROGRESS + "% 미만)"
          + (k.target_value ? " · 목표값 " + k.target_value : ""), [krRef]);
      }
    });

    /* (3) 목표 — 기간 마감 임박·경과 (데이터에 마감일 필드가 없어 period에서 도출) */
    var objSeen = {};
    objectivesOwned(empId).concat(krsInvolved(empId).map(function (k) { return objById(k.objective_id); }))
      .forEach(function (o) {
        if (!o || objSeen[o.objective_id]) return;
        objSeen[o.objective_id] = 1;
        var end = periodEnd(o.period);
        if (!end) return;
        var left = dayDiff(today, end);
        if (isNaN(left) || left > 30) return;
        push("due", o.title,
          left < 0 ? o.period + " 기간 종료(" + end + ") 후 " + (-left) + "일 경과 · 마무리 정리 필요"
                   : o.period + " 마감 " + end + " · D-" + left,
          [{ label: o.objective_id, id: o.objective_id }]);
      });

    /* (4) 받은 피드백 */
    (D().feedbackHistory || []).forEach(function (f) {
      if (f.emp_id !== empId) return;
      push("feedback", f.summary || "", (f.period || "") + " " + (f.source_type || "") + " 피드백",
        [{ label: f.fb_id, id: f.fb_id }]);
    });

    /* 우선순위 0은 falsy — `ord[sig] || 9`로 쓰면 최우선 신호(leader:blocker,
       member:promise)가 꼴찌로 밀려 상한에서 잘려 나간다. 반드시 null 검사로 판단. */
    var ord = SIG_ORDER[rk];
    function rank(sig) { var v = ord[sig]; return v == null ? 9 : v; }
    out.sort(function (a, b) { return rank(a.sig) - rank(b.sig); });
    return out.slice(0, MAX_AGENDA);
  }

  /* 근거 칩 — 원장 항목 id가 있는 건만 클릭 가능(EZLedger.openPanel). 없으면 조용히 정적 칩 */
  function refChipsHTML(refs) {
    if (!refs || !refs.length) return "";
    var h = '<span class="ez1o-evs">', i, r, live = !!(window.EZLedger && EZLedger.openPanel);
    for (i = 0; i < refs.length; i++) {
      r = refs[i];
      if (r.ledgerId && live) {
        h += '<button class="ez1o-ev lk" data-ez1o-ev="' + esc(r.ledgerId) + '" title="성과 기록에서 보기">'
          + esc(r.label) + "</button>";
      } else {
        h += '<span class="ez1o-ev" title="원본 레코드 ' + esc(r.id) + '">' + esc(r.label) + "</span>";
      }
    }
    return h + "</span>";
  }

  function renderAgenda(panel) {
    var empId = targetEmpId(), facts = agendaFacts(empId), chips = "", i;
    for (i = 0; i < facts.length; i++) {
      chips += '<div class="ez1o-agitem">'
        + '<button class="ez1o-chip' + (i === 0 ? " on" : "") + '" data-ez1o-chip>' + esc(facts[i].text) + "</button>"
        + refChipsHTML(facts[i].refs)
        + '<div class="ez1o-why">' + esc(facts[i].why) + "</div></div>";
    }
    /* 직전 1:1에서 [다음 아젠다로] 착지시킨 항목 — 실데이터 신호와 함께 노출 */
    var carry = loadState().nextAgenda || [];
    for (i = 0; i < carry.length; i++) {
      chips += '<div class="ez1o-agitem">'
        + '<button class="ez1o-chip on" data-ez1o-chip>' + esc(cut(carry[i], 34)) + "</button>"
        + '<span class="ez1o-evs"><span class="ez1o-ev">지난 1:1 합의</span></span>'
        + '<button class="ez1o-xag" data-ez1o="unag" data-i="' + i + '" title="이 아젠다 빼기">&#10005;</button></div>';
    }
    if (!chips) {
      /* 고정 문자열로 채우지 않는다 — 없으면 없다고 말한다 */
      chips = '<div class="ez1o-empty">이번 사이클 기록이 아직 없습니다. 목표 기준으로 시작하세요.'
        + (objectivesOwned(empId).length
            ? ' 현재 목표: <b>' + esc(objTitleFor(empId)) + "</b>"
            : " 등록된 목표도 아직 없습니다.")
        + " 아래에 아젠다를 직접 입력할 수 있습니다.</div>";
    }
    /* 지난 약속 이행 체크 — 직전 1:1 원장 항목 + 완료 토글 */
    var prom = lastOneOnOneEntry(), promHTML = "";
    if (prom) {
      var done = !!(loadState().promiseDone || {})[prom.id];
      promHTML = '<div class="ez1o-prom" data-ez1o-prom="' + esc(prom.id) + '">'
        + '<span>&#128203; 지난 약속 (' + esc(String(prom.at || "").split(" ")[0]) + ' 1:1) : ' + esc(cut(prom.summary || prom.title, 56)) + "</span>"
        + '<button class="tg' + (done ? " done" : "") + '" data-ez1o="promise">' + (done ? "&#10003; 이행 완료" : "이행 확인") + "</button></div>";
    }
    var who = "";
    if (roleKey() === "leader") {
      var m = selMember();
      if (m) who = '<span class="ez1o-reclab">대상 팀원: <b>' + esc(m.name) + "</b></span>";
    }
    var srcNote = facts.length
      ? '<div class="ez1o-note" style="margin:0 0 8px">' + esc(targetName(empId))
        + '님의 실제 목표·핵심성과·체크인·피드백 기록에서 도출했습니다 · 기준 ' + esc(asOfDate())
        + ' · 각 근거 칩은 원본 레코드 id입니다</div>'
      : "";
    panel.innerHTML =
      '<div class="ez1o-rec"><div class="ez1o-rechead">'
      + '<b style="font-size:12.5px">1:1 준비 · 아젠다 선택</b>' + who
      + '<button class="ez1o-stop" data-ez1o="cancel" style="border-color:var(--line,#E4E7EC);color:var(--ink-3,#6B7280)">닫기</button>'
      + "</div>"
      + '<div class="ez1o-agenda">' + srcNote
      + '<div class="ez1o-aglist">' + chips + "</div>"
      + '<div class="ez1o-agrow"><input class="ez1o-agin" data-ez1o-agin type="text" maxlength="60" placeholder="아젠다 직접 입력 (선택)">'
      + '<button class="ez1o-btn" data-ez1o="rec">&#9210; 녹음 시작</button></div>'
      + promHTML
      + "</div></div>";
  }

  function start(panel) {
    if (sess && !sess.finished) { toast("이미 녹음이 진행 중입니다.", ""); return; }
    var rk = roleKey();
    if (rk === "hr" || rk === "exec") { toast("이 관점에서는 1:1 녹음을 시작할 수 없습니다.", ""); return; }
    if (!panel) {
      tryInject();
      panel = document.querySelector("[data-ez1o-panel]");
      if (!panel) { toast("성과관리 › 1:1 미팅 화면에서 실행할 수 있습니다.", ""); return; }
    }
    renderAgenda(panel);
  }

  function beginRec(panel, agenda) {
    if (sess && !sess.finished) { toast("이미 녹음이 진행 중입니다.", ""); return; }
    killSession();
    var p = pair();
    lastRun = { agenda: agenda || [], memId: p.memId, memName: p.memId ? p.mem : null, aiText: "",
                empId: targetEmpId() };
    sess = { panel: panel, lineTimer: null, secTimer: null, idx: 0, sec: 0, script: buildScript(), finished: false };
    panel.innerHTML =
      '<div class="ez1o-rec">'
      + '<div class="ez1o-rechead">'
      + '<span class="ez1o-dot"></span><span class="ez1o-timer" data-ez1o-timer>00:00</span>'
      + '<span class="ez1o-wave"><i></i><i></i><i></i><i></i><i></i><i></i></span>'
      + '<span class="ez1o-reclab">녹음 중 · 실시간 받아쓰기 (' + esc(REC_ID) + ')</span>'
      /* 대본은 데모 자산 — 실제 대화로 오인하지 않도록 녹음 중에도 계속 표시한다 */
      + '<span class="ez1o-demo" title="받아쓰기 줄은 시연용 고정 대본입니다. 실제 녹음이 아닙니다">데모 전사문</span>'
      + '<button class="ez1o-stop" data-ez1o="stop">&#9632; 종료·요약 생성</button>'
      + '</div>'
      + '<div class="ez1o-tr" data-ez1o-tr></div>'
      + '</div>';
    var startBtn = document.querySelector('[data-ez1o="start"]');
    if (startBtn) startBtn.disabled = true;

    /* 경과 타이머 */
    sess.secTimer = setInterval(function () {
      if (!alive()) { killSession(); return; }
      sess.sec++;
      var t = sess.panel.querySelector("[data-ez1o-timer]");
      if (t) t.textContent = pad2(Math.floor(sess.sec / 60)) + ":" + pad2(sess.sec % 60);
    }, 1000);

    /* 전사 줄 추가 (1.4~2s 랜덤 간격) */
    function nextLine() {
      if (!alive()) { killSession(); return; }
      var tr = sess.panel.querySelector("[data-ez1o-tr]");
      if (!tr) { killSession(); return; }
      var L = sess.script[sess.idx];
      tr.insertAdjacentHTML("beforeend",
        '<div class="ez1o-line ' + L.who + '">'
        + '<span class="tm">' + esc(L.t) + '</span>'
        + '<span class="nm">' + esc(L.name) + '</span>'
        + '<span>' + esc(L.text) + '</span></div>');
      tr.scrollTop = tr.scrollHeight;
      sess.idx++;
      if (sess.idx >= sess.script.length) {
        /* 대본 소진 → 잠깐 여운 후 자동 종료 */
        sess.lineTimer = setTimeout(function () { finish(); }, 1000);
        return;
      }
      sess.lineTimer = setTimeout(nextLine, 1400 + Math.floor(Math.random() * 600));
    }
    sess.lineTimer = setTimeout(nextLine, 700);
  }

  function finish() {
    if (!sess) return;
    stopTimers();
    if (!alive()) { killSession(); return; }
    var panel = sess.panel;
    sess.finished = true;
    /* AI 요약용 받아쓰기 원문 — 세션 종료 전에 캡처 */
    var lines = sess.script.slice(0, sess.idx), transcript = "";
    for (var i = 0; i < lines.length; i++) transcript += lines[i].t + " " + lines[i].name + ": " + lines[i].text + "\n";
    panel.innerHTML = '<div class="ez1o-rec"><div class="ez1o-gen"><span class="ez1o-spin"></span>'
      + '요약을 만들고 있습니다. 받아쓰기 ' + sess.idx + '줄 분석 · 주제/액션/신호 추출…</div></div>';
    setTimeout(function () {
      if (!document.body.contains(panel)) { killSession(); return; }
      panel.innerHTML = summaryHTML();
      killSession();
      liveSummary(panel, transcript); /* AI 연결 시 고정 요약을 실시간 요약으로 교체 (msf 패턴) */
    }, 1200);
  }

  /* 대상자의 실데이터 컨텍스트 — 요약 프롬프트에 함께 주입해 요약이 실제 목표·수치를 인용하게 한다 */
  function ctxLines(empId) {
    var out = [], today = asOfDate();
    objectivesOwned(empId).forEach(function (o) {
      out.push("목표 " + o.objective_id + " " + o.title + " (진행률 " + o.progress + "%, 기간 " + o.period + ")");
    });
    krsInvolved(empId).slice(0, 6).forEach(function (k) {
      var cks = checkinsFor(empId, k.kr_id), last = cks.length ? cks[cks.length - 1] : null;
      out.push("핵심성과 " + k.kr_id + " " + k.name
        + " · 달성률 " + k.progress + "%" + (k.target_value ? " / 목표값 " + k.target_value : "")
        + (last ? " · 최근 체크인 " + last.checkin_id + " " + last.checkin_date
                  + " (Δ" + last.progress_delta + "%p, " + (dayDiff(last.checkin_date, today)) + "일 경과"
                  + (String(last.blocker || "").trim() ? ", 블로커: " + last.blocker : "") + ")"
                : " · 체크인 기록 없음"));
    });
    (D().feedbackHistory || []).forEach(function (f) {
      if (f.emp_id === empId) out.push("받은 피드백 " + f.fb_id + " (" + f.source_type + ") " + f.summary);
    });
    return out;
  }

  /* AI 요약 텍스트에서 합의(액션) 줄만 추출 — '액션' 섹션 우선, 없으면 담당/기한 포함 줄 */
  function extractAgreements(text) {
    var lines = String(text || "").split(/\r?\n/).map(function (s) {
      return s.replace(/^\s*[-•*\d.)]+\s*/, "").trim();
    }).filter(Boolean);
    var inAct = false, act = [], loose = [], i, ln;
    for (i = 0; i < lines.length; i++) {
      ln = lines[i];
      if (/^\W*액션/.test(ln)) { inAct = true; continue; }
      if (/^\W*(논의\s*주제|감지\s*신호|요약)/.test(ln)) { inAct = false; continue; }
      if (inAct) act.push(ln);
      else if (/담당|기한/.test(ln)) loose.push(ln);
    }
    return (act.length ? act : loose).slice(0, 4);
  }

  /* ---------------- 요약 실AI화 — 먼저 고정 요약 렌더 후, 연결돼 있으면 교체 ---------------- */
  function liveSummary(panel, transcript) {
    var live = !!(window.EZAI && EZAI.agent && EZAI.ready && EZAI.ready());
    /* EZKit 영수증으로 렌더되면 본문 클래스가 .ezk-receipt-body — 둘 다 잡아야 한다
       (.ez1o-body만 보면 EZKit 로드 시 실AI 요약이 조용히 착지하지 못했다) */
    var body = panel.querySelector(".ezk-receipt-body,.ez1o-body");
    if (!live || !body || !transcript) return;
    var rk = roleKey() === "leader" ? "leader" : "member";
    var empId = (lastRun && lastRun.empId) || targetEmpId();
    var ag = (lastRun && lastRun.agenda && lastRun.agenda.length) ? "아젠다: " + lastRun.agenda.join(" / ") + "\n" : "";
    var ctx = ctxLines(empId);
    var ctxBlock = ctx.length ? "대상자 실제 성과 데이터(talenx):\n" + ctx.join("\n") + "\n\n" : "";
    body.insertAdjacentHTML("afterbegin",
      '<div class="ez1o-note" data-ez1o-live style="margin-bottom:8px"><span class="ez1o-spin" style="display:inline-block;vertical-align:middle;margin-right:6px"></span>elizax가 받아쓰기 원문을 다시 요약하는 중…</div>');
    function clearNote() {
      var n = body.querySelector("[data-ez1o-live]");
      if (n && n.parentNode) n.parentNode.removeChild(n);
    }
    EZAI.agent({
      maxTurns: 2, maxTokens: 700,
      system: "당신은 elizax — 1:1 미팅 요약가입니다. 받아쓰기 원문과 함께 제공된 대상자 실제 성과 데이터를 근거로 한국어 요약을 씁니다. "
        + (rk === "leader"
            ? "읽는 사람은 이 1:1을 주관한 조직장입니다. 팀 운영 관점에서 리스크·지원 필요·후속 코칭 포인트를 우선하세요. "
            : "읽는 사람은 본인(구성원)입니다. 본인 관점에서 내가 할 일·요청한 지원·성장 계획을 우선하세요. ")
        + "형식: '논의 주제' 최대 3줄 / '액션 아이템' 2~3줄(담당·기한 포함) / '감지 신호' 1~2줄. "
        + "각 줄 끝에 (" + REC_ID + " · MM:SS) 형태로 근거 시각을 인용하세요. "
        + "실제 성과 데이터를 인용할 때는 해당 레코드 id(KR-… / CHK-… / OBJ-…)를 괄호에 함께 적으세요. "
        + "제공되지 않은 수치를 지어내지 마세요. 아젠다가 주어지면 해당 항목을 우선 반영하세요. "
        + "머리말·다른 텍스트 금지. 도구 호출 불필요.",
      messages: [{ role: "user", content: ag + ctxBlock + "받아쓰기 원문(시연용 고정 대본):\n" + transcript }],
      onDone: function (text) {
        if (!document.body.contains(body)) return;
        clearNote();
        if (text && text.trim()) {
          if (lastRun) lastRun.aiText = text.trim();
          /* 되돌릴 수 없는 덮어쓰기 금지 — 교체 직전 본문을 스냅샷해 [이전 버전]으로 남긴다 */
          var prev = inertSnapshot(body.innerHTML);
          var found = extractAgreements(text);
          setAgreements(found.length ? found.map(function (s) { return { text: s }; }) : lastAgreements);
          body.innerHTML = '<div class="ez1o-h4">elizax 실시간 요약</div>'
            + '<div style="font-size:12.5px;line-height:1.75">' + esc(text.trim()).replace(/\n+/g, "<br>") + "</div>"
            + agendaSectionHTML()
            + agreementsSectionHTML()
            + '<details class="ez1o-prev"><summary>이전 버전 (규칙 기반 요약) 보기</summary>'
            + '<div class="ez1o-prevbody">' + prev + "</div></details>";
        }
      },
      onError: function () { clearNote(); } /* 오프라인·오류 → 고정 요약 유지(폴백) */
    });
  }

  /* 스냅샷은 보기 전용 — 옛 버튼이 다시 눌리지 않도록 라우팅 속성을 떼고 비활성화한다 */
  function inertSnapshot(html) {
    var d = document.createElement("div");
    d.innerHTML = html;
    var els = d.querySelectorAll("[data-ez1o],[data-ez1o-ev],[data-ez1o-chip],[data-ez1o-gact]"), i, el;
    for (i = 0; i < els.length; i++) {
      el = els[i];
      el.removeAttribute("data-ez1o");
      el.removeAttribute("data-ez1o-ev");
      el.removeAttribute("data-ez1o-chip");
      el.removeAttribute("data-ez1o-gact");
      if (el.tagName === "BUTTON") el.disabled = true;
    }
    return d.innerHTML;
  }

  /* ---------------- 요약 카드 ---------------- */
  function chip(t) { return '<span class="ez1o-src">' + esc(REC_ID) + ' · ' + esc(t) + '</span>'; }

  function agendaSectionHTML() {
    if (!lastRun || !lastRun.agenda || !lastRun.agenda.length) return "";
    var h = '<div class="ez1o-h4">이번 1:1 아젠다</div><div class="ez1o-agrow" style="margin:4px 0">';
    for (var i = 0; i < lastRun.agenda.length; i++) h += '<span class="ez1o-chip on" style="cursor:default">' + esc(lastRun.agenda[i]) + "</span>";
    return h + "</div>";
  }

  /* ---------------- 합의 사항 착지 ----------------
     요약이 원장 축적으로만 끝나지 않도록, 합의 항목마다 다음 단계로 보내는 경로를 준다.
     [체크인 초안으로] 는 아래 이벤트를 발행한다 — 수신측(체크인 화면)은 후속 작업이다.

       이벤트 계약 (contract)
       ─────────────────────────────────────────────────────────────
       document.addEventListener("ez:1on1-agreement", function (e) { ... })
         e.detail = {
           emp_id:       String  // 합의 대상자 사번. 조직장이 주관한 1:1이면 팀원 사번,
                                 // 본인 1:1이면 현재 사용자 사번. 항상 채워진다.
           objective_id: String  // 대상자의 대표 목표 id. 없으면 빈 문자열("").
           text:         String  // 합의 문장 원문(요약 카드에 표시된 그대로).
         }
       - 발행 시점: 사용자가 [체크인 초안으로]를 클릭한 순간 (사람의 명시적 행동)
       - 발행 측은 side-effect를 만들지 않는다 — 초안 생성·저장은 전적으로 수신측 책임
       - 수신자가 없어도 발행만 하고 조용히 지나간다(현재 상태)
       ───────────────────────────────────────────────────────────── */
  var lastAgreements = [];   /* [{text}] — 마지막 요약에서 뽑은 합의 항목 */
  function setAgreements(list) { lastAgreements = list || []; }
  function agreementsSectionHTML() {
    if (!lastAgreements.length) return "";
    var h = '<div class="ez1o-h4">합의 사항 착지 — 사람이 고른 것만 다음 단계로</div>', i;
    for (i = 0; i < lastAgreements.length; i++) {
      h += '<div class="ez1o-agree"><span class="tx">' + esc(lastAgreements[i].text) + "</span>"
        + '<button class="ez1o-lbtn" data-ez1o="ck-draft" data-i="' + i + '">체크인 초안으로</button>'
        + '<button class="ez1o-lbtn" data-ez1o="ag-next" data-i="' + i + '">다음 아젠다로</button></div>';
    }
    return h;
  }

  function summaryHTML() {
    var p = pair(), MGR = p.mgr, MEM = p.mem;
    var K = window.EZKit;
    var title = '✦ 1:1 미팅 요약' + (lastRun && lastRun.memName ? ' · ' + lastRun.memName : '');
    /* 고정 요약의 액션 아이템 2건이 곧 합의 사항 — 착지 버튼의 원천 */
    setAgreements([
      { text: "외부 연동 지연 건 파트너십 팀 에스컬레이션 : 담당 " + MGR + " · 기한 7/18" },
      { text: "머신러닝 기초 교육 과정 선정·예산 신청 : 담당 " + MEM + " · 기한 7/22" }
    ]);
    var demoNote = '<div class="ez1o-note" style="margin:2px 0 6px">'
      + '<span class="ez1o-demo">데모 전사문 기반</span> 아래 요약의 인용 시각(' + esc(REC_ID)
      + ')은 시연용 고정 대본에서 나온 것입니다. 실제 녹음 기록이 아닙니다. '
      + '실AI가 연결되면 대상자의 실제 목표·체크인 데이터를 함께 참조해 다시 요약합니다.</div>';
    var body = demoNote
      + agendaSectionHTML()
      + '<div class="ez1o-h4">논의 주제 3</div>'
      + '<div class="ez1o-topic"><span class="no">1</span><span>KR2 진척 : 신규 기획 3건 사용자 검증 통과, 잔여 2건 설계 중 (진행률 68%)' + chip("00:16") + '</span></div>'
      + '<div class="ez1o-topic"><span class="no">2</span><span>일정 리스크 : 외부 연동 파트너 응답 2주 지연, 잔여 검증 일정 순연 가능성' + chip("00:42") + '</span></div>'
      + '<div class="ez1o-topic"><span class="no">3</span><span>성장 니즈 : 추천 로직 업무 희망, 머신러닝 기초 교육 수강 요청' + chip("01:24") + '</span></div>'
      + '<div class="ez1o-h4">액션 아이템 2</div>'
      + '<div class="ez1o-act"><span class="bx"></span><span>외부 연동 지연 건 파트너십 팀 에스컬레이션 <span class="own">담당 : ' + esc(MGR) + ' · 기한 7/18</span></span></div>'
      + '<div class="ez1o-act"><span class="bx"></span><span>머신러닝 기초 교육 과정 선정·예산 신청 <span class="own">담당 : ' + esc(MEM) + ' · 기한 7/22</span></span></div>'
      + '<div class="ez1o-h4">감지 신호 2</div>'
      + '<div class="ez1o-sig risk"><span class="ic">&#9888;</span><span><b>리스크</b> · 일정 지연(외부 연동) : 이번 주 체크인 초안에 리스크 항목 반영을 제안합니다' + chip("00:42") + '</span></div>'
      + '<div class="ez1o-sig grow"><span class="ic">&#8599;</span><span><b>성장 니즈</b> · 머신러닝 교육 수요 감지 : 교육 신청 연계 후보로 표시했습니다' + chip("01:37") + '</span></div>'
      + agreementsSectionHTML();
    var gate = '<div class="ez1o-gate" data-ez1o-gate>'
      + '<span class="lab">결정 게이트 · 사람이 확정 (승인 전에는 아무것도 반영되지 않음)</span>'
      + '<button class="ez1o-gbtn primary" data-ez1o-gact="confirm">기록 확정·성과 기록 저장</button>'
      + '<button class="ez1o-gbtn" data-ez1o-gact="edit">수정</button>'
      + '<button class="ez1o-gbtn" data-ez1o-gact="drop">폐기</button>'
      + '</div>';
    /* 요약 카드 = EZReceipt 1벌(§7) — 헤더 칩 순서: as-of → 출처 → 상태 */
    if (K) {
      return '<div class="ez1o-sum" data-ez1o-sum>'
        + K.receipt({ title: title, chips: K.asof() + K.src('talenx', REC_ID) + K.status('suggest'), body: body })
        + gate + '</div>';
    }
    return '<div class="ez1o-sum" data-ez1o-sum>'
      + '<div class="ez1o-sumhead"><span class="tt">' + esc(title) + '</span>'
      + '<span class="ez1o-badge">&#9684; 제안만</span></div>'
      + '<div class="ez1o-body">' + body + '</div>' + gate + '</div>';
  }

  /* ---------------- 게이트 결정 ---------------- */
  function decideGate(card, act) {
    var gate = card.querySelector("[data-ez1o-gate]");
    if (!gate) return;

    if (act === "edit") {
      /* 수정 모드: 본문을 직접 고친 뒤 확정 — 게이트는 열린 채 유지 */
      var body = card.querySelector(".ezk-receipt-body,.ez1o-body");
      if (body && body.getAttribute("contenteditable") !== "true") {
        body.setAttribute("contenteditable", "true");
        body.style.outline = "2px dashed color-mix(in srgb, var(--color-accent,#17F) 40%, transparent)";
        body.style.borderRadius = "8px";
        toast("수정 모드입니다. 요약을 직접 고친 뒤 [기록 확정·성과 기록 저장]을 누르세요.", "");
      }
      return;
    }

    /* confirm / drop → 게이트 잠금 */
    var btns = gate.querySelectorAll("[data-ez1o-gact]");
    for (var i = 0; i < btns.length; i++) {
      btns[i].disabled = true;
      if (btns[i].getAttribute("data-ez1o-gact") === act) btns[i].setAttribute("data-chosen", "1");
    }
    var body2 = card.querySelector(".ezk-receipt-body,.ez1o-body");
    if (body2) { body2.removeAttribute("contenteditable"); body2.style.outline = ""; }

    /* 게이트 결정 → EZKit.gates 단일 스토어 기록 (P6) */
    if (window.EZKit && (act === "confirm" || act === "drop")) {
      EZKit.gates.set(REC_ID, { decision: act === "confirm" ? "승인" : "폐기", by: memberName() });
    }

    if (act === "confirm") {
      var isLead = !!(lastRun && lastRun.memId);
      var agTxt = (lastRun && lastRun.agenda && lastRun.agenda.length) ? "아젠다: " + lastRun.agenda.join(", ") + " · " : "";
      var sumTxt = (lastRun && lastRun.aiText)
        ? cut(lastRun.aiText.replace(/\n+/g, " "), 90)
        : "KR2 진척·외부 연동 지연 리스크·머신러닝 교육 니즈·다음 체크인 합의";
      document.dispatchEvent(new CustomEvent("ez:ctx", {
        detail: {
          type: "oneonone",
          source: "1on1.rec.0716" + (isLead ? "." + lastRun.memId : ""),
          title: (isLead ? lastRun.memName + " 1:1 " : "1:1 ") + "미팅 요약 · 7/16",
          summary: agTxt + sumTxt,
          weight: 3
        }
      }));
      var dec = document.createElement("span");
      dec.className = "ez1o-dec";
      dec.innerHTML = "&#10003; 확정 · ⛨ " + (window.EZKit ? esc(EZKit.gaId(REC_ID)) : "감사 기록됨");
      gate.appendChild(dec);
      if (isLead) {
        /* leader — 드롭다운의 팀원별 최근 1:1 라벨 갱신(원장 재조회) */
        var selEl = document.querySelector("[data-ez1o-mem]");
        if (selEl) selEl.outerHTML = memSelectHTML();
      } else {
        var st = loadState(); st.confirmedAt = (window.EZKit ? EZKit.clock.asOfDate() : "2026-07-16"); saveState(st);
        var bar = document.querySelector("[data-ez1o-bar]");
        if (bar && !bar.querySelector(".ez1o-donetag")) {
          var tag = document.createElement("span");
          tag.className = "ez1o-donetag";
          tag.innerHTML = "&#10003; 요약 확정됨 · 성과 기록 저장";
          var link = bar.querySelector(".ez1o-linkbtn");
          bar.insertBefore(tag, link || null);
        }
      }
      toast("기록을 확정했습니다. 성과 기록에 저장되었습니다 (감사 기록 남김).", "ok");
    } else { /* drop */
      card.classList.add("ez1o-collapsed");
      var note = document.createElement("div");
      note.className = "ez1o-drop";
      note.textContent = "폐기했습니다. 성과 기록에 아무것도 남지 않았습니다. 확정되지 않은 요약은 기록에 섞이지 않습니다.";
      card.appendChild(note);
      toast("폐기했습니다. 성과 기록에는 남지 않았습니다.", "");
    }
    var startBtn = document.querySelector('[data-ez1o="start"]');
    if (startBtn) startBtn.disabled = false;
  }

  /* ============================================================
     3) 전주기 커버리지 맵
     ============================================================ */
  var MAP = [
    { col: "목표수립", items: [
      { name: "개인맥락 목표 초안 + 정렬 검증", st: "live", f: 2, c: 2 },
      { name: "목표 정렬·중복 점검", st: "live", f: 1, c: 2 },
      { name: "목표 재조정 제안", st: "cand", f: 1, c: 3 }
    ]},
    { col: "실행·중간점검", items: [
      { name: "주간 체크인 · 진척 요약", st: "live", f: 3, c: 2 },
      { name: "상시 근거 수집 타임라인", st: "live", f: 3, c: 3 },
      { name: "1on1 자동 녹음·요약", st: "new", f: 3, c: 3 },
      { name: "팀 회고 요약", st: "cand", f: 2, c: 2 }
    ]},
    { col: "평가", items: [
      { name: "평가 코멘트 근거초안", st: "live", f: 1, c: 2 },
      { name: "평가 편향 점검", st: "live", f: 1, c: 2 },
      { name: "등급 조정 심의", st: "live", f: 1, c: 3 }
    ]},
    { col: "피드백·리뷰", items: [
      { name: "피드백 문장 정제", st: "live", f: 2, c: 2 },
      { name: "리뷰 초안 함께 작성", st: "live", f: 1, c: 2 },
      { name: "승계·이동 시사점", st: "cand", f: 1, c: 3 },
      { name: "보상 리뷰 시사점", st: "cand", f: 1, c: 2 }
    ]}
  ];
  var ST_LABEL = { live: "제공중", "new": "신규 ★이번 추가", cand: "후보" };

  function stars(n) {
    var s = "";
    for (var i = 1; i <= 3; i++) s += (i <= n ? "★" : "☆");
    return s;
  }

  function openMap() {
    closeMap();
    var ov = document.createElement("div");
    ov.className = "ez1o-mapov";
    ov.setAttribute("data-ez1o-mapov", "1");
    ov.setAttribute("data-astryx-theme", "talenx");
    var cols = MAP.map(function (col, ci) {
      var cards = col.items.map(function (it) {
        return '<div class="ez1o-card ' + it.st + '">'
          + '<span class="ez1o-st ' + it.st + '">' + esc(ST_LABEL[it.st]) + '</span>'
          + '<div class="nm">' + esc(it.name) + '</div>'
          + '<div class="ez1o-stars"><span>빈도 <b>' + stars(it.f) + '</b></span><span>기록 기여 <b>' + stars(it.c) + '</b></span></div>'
          + '</div>';
      }).join("");
      return '<div class="ez1o-col"><div class="ch"><span class="step">' + (ci + 1) + '</span>' + esc(col.col) + '</div>' + cards + '</div>';
    }).join("");
    ov.innerHTML =
      '<div class="ez1o-map">'
      + '<div class="ez1o-maphead">'
      + '<span class="tt">지원 범위 맵 · 성과관리 전 주기 × elizax 기능 지원 범위</span>'
      + '<span class="ez1o-asof">📌 기준 시점 ' + esc(AS_OF()) + '</span>'
      + '<button class="ez1o-mapx" data-ez1o="mapclose" title="닫기">&#10005;</button>'
      + '<span class="principle">선정 원칙 : 초기엔 <b>기록 기여도 우선</b>: 기록이 충분히 쌓이면 <b>빈도 우선</b>으로 전환. '
      + '이번 신규 1순위 = 1on1 (빈도 ★★★ · 기록 기여 ★★★, 유일한 미지원 공백)</span>'
      + '</div>'
      + '<div class="ez1o-legend">'
      + '<span class="ez1o-st live">제공중</span><span class="ez1o-st new">신규 ★이번 추가</span><span class="ez1o-st cand">후보</span>'
      + '<span>· 우선순위 2기준: 빈도 ★1~3 / 기록 기여 ★1~3</span>'
      + '</div>'
      + '<div class="ez1o-cols">' + cols + '</div>'
      + '</div>';
    document.body.appendChild(ov);
  }
  function closeMap() {
    var ov = document.querySelector("[data-ez1o-mapov]");
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
  }

  /* ============================================================
     4) 이벤트 위임 + 부트스트랩
     ============================================================ */
  document.addEventListener("click", function (e) {
    var t = e.target;

    /* 맵 배경 클릭 → 닫기 */
    if (t && t.getAttribute && t.getAttribute("data-ez1o-mapov")) { closeMap(); return; }

    /* 근거 칩 → 성과 기록(원장) 해당 항목으로 이동. 원장 미로드면 조용히 무시 */
    var evEl = t && t.closest ? t.closest("[data-ez1o-ev]") : null;
    if (evEl) {
      var eid = evEl.getAttribute("data-ez1o-ev");
      try { if (window.EZLedger && EZLedger.openPanel) EZLedger.openPanel(eid); } catch (e2) { /* 무해화 */ }
      return;
    }

    /* 아젠다 칩 토글 */
    var chipEl = t && t.closest ? t.closest("[data-ez1o-chip]") : null;
    if (chipEl) {
      if (chipEl.className.indexOf("on") >= 0) chipEl.className = chipEl.className.replace(/\s*\bon\b/, "");
      else chipEl.className += " on";
      return;
    }

    var act = t && t.closest ? t.closest("[data-ez1o]") : null;
    if (act) {
      var kind = act.getAttribute("data-ez1o");
      if (kind === "start") {
        var bar = act.closest("[data-ez1o-bar]");
        var panel = bar && bar.nextElementSibling && bar.nextElementSibling.hasAttribute("data-ez1o-panel")
          ? bar.nextElementSibling
          : document.querySelector("[data-ez1o-panel]");
        start(panel);
      }
      else if (kind === "rec") {
        var pnl = act.closest("[data-ez1o-panel]");
        if (pnl) {
          var ag = [], ons = pnl.querySelectorAll(".ez1o-chip.on"), ci;
          for (ci = 0; ci < ons.length; ci++) ag.push(ons[ci].textContent);
          var inp = pnl.querySelector("[data-ez1o-agin]");
          if (inp && inp.value && inp.value.replace(/\s/g, "")) ag.push(inp.value.trim());
          beginRec(pnl, ag);
        }
      }
      else if (kind === "cancel") {
        var pnl2 = act.closest("[data-ez1o-panel]");
        if (pnl2) pnl2.innerHTML = "";
      }
      else if (kind === "unag") {          /* 이월 아젠다 제거 */
        var stU = loadState(), ix = +act.getAttribute("data-i");
        if (stU.nextAgenda && stU.nextAgenda.length > ix) {
          stU.nextAgenda.splice(ix, 1); saveState(stU);
          var pnlU = act.closest("[data-ez1o-panel]");
          if (pnlU) renderAgenda(pnlU);
        }
      }
      else if (kind === "promise") {
        var row = act.closest("[data-ez1o-prom]");
        if (row) {
          var pid = row.getAttribute("data-ez1o-prom");
          var st2 = loadState(); st2.promiseDone = st2.promiseDone || {};
          st2.promiseDone[pid] = !st2.promiseDone[pid]; saveState(st2);
          if (st2.promiseDone[pid]) { act.className = "tg done"; act.innerHTML = "&#10003; 이행 완료"; }
          else { act.className = "tg"; act.innerHTML = "이행 확인"; }
          toast(st2.promiseDone[pid] ? "지난 약속을 이행 완료로 표시했습니다." : "이행 확인을 취소했습니다.", "");
        }
      }
      else if (kind === "ck-draft") {      /* 합의 → 체크인 초안 (이벤트 발행만, side-effect 0) */
        var agC = lastAgreements[+act.getAttribute("data-i")];
        if (agC) {
          var eid2 = (lastRun && lastRun.empId) || targetEmpId();
          document.dispatchEvent(new CustomEvent("ez:1on1-agreement", {
            detail: { emp_id: eid2, objective_id: primaryObjectiveId(eid2) || "", text: agC.text }
          }));
          act.disabled = true; act.textContent = "✓ 체크인 초안으로 보냄";
          toast("체크인 초안으로 보냈습니다. 확정은 체크인 화면에서 합니다.", "ok");
        }
      }
      else if (kind === "ag-next") {       /* 합의 → 다음 1:1 아젠다로 이월 */
        var agN = lastAgreements[+act.getAttribute("data-i")];
        if (agN) {
          var stN = loadState();
          stN.nextAgenda = stN.nextAgenda || [];
          if (stN.nextAgenda.indexOf(agN.text) < 0) stN.nextAgenda.push(agN.text);
          stN.nextAgenda = stN.nextAgenda.slice(-5);
          saveState(stN);
          act.disabled = true; act.textContent = "✓ 다음 아젠다에 추가됨";
          toast("다음 1:1 아젠다에 추가했습니다.", "ok");
        }
      }
      else if (kind === "stop") finish();
      else if (kind === "map") openMap();
      else if (kind === "mapclose") closeMap();
      return;
    }

    var g = t && t.closest ? t.closest("[data-ez1o-gact]") : null;
    if (g && !g.disabled) {
      var card = g.closest("[data-ez1o-sum]");
      if (card) decideGate(card, g.getAttribute("data-ez1o-gact"));
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeMap();
  });

  /* leader — 팀원 드롭다운 선택 */
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t && t.getAttribute && t.hasAttribute && t.hasAttribute("data-ez1o-mem")) selMemId = t.value;
  });

  function boot() {
    injectStyle();
    tryInject();

    /* #s-perf 서브트리 감시 — tx_fix_perf 재렌더 후 재주입 (300ms×20 폴링으로 결선) */
    var tries = 0;
    var poll = setInterval(function () {
      tries++;
      var sec = document.getElementById("s-perf");
      tryInject();
      if (sec) {
        clearInterval(poll);
        var mo = new MutationObserver(function () { tryInject(); });
        mo.observe(sec, { childList: true, subtree: true });
      } else if (tries >= 20) clearInterval(poll);
    }, 300);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  /* ---------------- 전역 노출 ---------------- */
  window.EZOneOnOne = { start: function () { start(null); }, openMap: openMap };
  window.EZCycle = { openMap: openMap };
})();
