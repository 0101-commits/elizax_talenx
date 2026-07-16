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

  var AS_OF = "2026 상반기 · 7/16 06:00 스냅샷";
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
    var MGR = managerName(), MEM = memberName(), OBJ = myObjectiveTitle();
    return [
      { who: "mgr", name: MGR, t: "00:04", text: "지난 체크인 이후 상황부터 볼까요? '" + OBJ + "' 목표의 KR2 진행이 궁금하네요." },
      { who: "mem", name: MEM, t: "00:16", text: "KR2는 신규 기획 3건이 사용자 검증을 통과했고, 잔여 2건은 검증 설계 중입니다. 진행률은 68% 수준이에요." },
      { who: "mgr", name: MGR, t: "00:31", text: "좋네요. 일정 쪽에 리스크는 없나요?" },
      { who: "mem", name: MEM, t: "00:42", text: "하나 있습니다. 외부 API 파트너 응답이 2주째 지연되고 있어서, 이대로면 잔여 2건 검증 일정이 다음 달로 밀릴 수 있어요." },
      { who: "mgr", name: MGR, t: "00:58", text: "그 건은 제가 파트너십 팀에 에스컬레이션할게요. 그 외에 필요한 지원이 있을까요?" },
      { who: "mem", name: MEM, t: "01:10", text: "검증 리뷰어가 한 명 더 붙으면 리드타임을 확실히 줄일 수 있을 것 같습니다." },
      { who: "mem", name: MEM, t: "01:24", text: "그리고 다음 분기에는 추천 로직 쪽 업무를 맡아보고 싶은데, ML 기초 교육을 들을 수 있을까요?" },
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
      /* 주입 바 */
      ".ez1o-bar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:10px 12px;margin:0 0 14px;",
      "border:1px solid var(--line,#E4E7EC);border-radius:12px;background:var(--soft,#F8FAFC);}",
      ".ez1o-btn{cursor:pointer;border:none;border-radius:999px;padding:7px 14px;font-size:12.5px;font-weight:700;",
      "color:#fff;background:var(--blue,#1F7AF0);transition:filter .12s;}",
      ".ez1o-btn:hover{filter:brightness(1.07);}",
      ".ez1o-btn:disabled{opacity:.5;cursor:default;}",
      ".ez1o-badge{font-size:10px;font-weight:600;border-radius:999px;padding:2px 9px;white-space:nowrap;",
      "color:#23408E;background:rgba(31,122,240,.07);border:1px solid rgba(31,122,240,.3);}",
      ".ez1o-note{font-size:11.5px;color:var(--ink-3,#6B7280);}",
      ".ez1o-linkbtn{cursor:pointer;margin-left:auto;border:1px solid var(--line,#E4E7EC);border-radius:999px;",
      "padding:5px 12px;font-size:11.5px;font-weight:600;color:var(--blue,#1F7AF0);background:var(--card,#fff);}",
      ".ez1o-linkbtn:hover{border-color:var(--blue,#1F7AF0);background:rgba(31,122,240,.05);}",
      ".ez1o-donetag{font-size:11px;font-weight:600;color:#15803D;}",
      /* 녹음 패널 */
      ".ez1o-panel{margin:0 0 14px;}",
      ".ez1o-rec{border:1px solid var(--line,#E4E7EC);border-radius:14px;background:var(--card,#fff);overflow:hidden;}",
      ".ez1o-rechead{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--line,#E4E7EC);background:var(--soft,#F8FAFC);}",
      ".ez1o-dot{width:10px;height:10px;border-radius:50%;background:#DC2626;animation:ez1oBlink 1s ease-in-out infinite;flex:none;}",
      "@keyframes ez1oBlink{0%,100%{opacity:1}50%{opacity:.2}}",
      ".ez1o-timer{font-size:13px;font-weight:800;font-variant-numeric:tabular-nums;color:#DC2626;min-width:44px;}",
      ".ez1o-wave{display:flex;align-items:flex-end;gap:2px;height:18px;flex:none;}",
      ".ez1o-wave i{width:3px;border-radius:2px;background:var(--blue,#1F7AF0);animation:ez1oWave 1.1s ease-in-out infinite;}",
      ".ez1o-wave i:nth-child(1){height:6px;animation-delay:0s}.ez1o-wave i:nth-child(2){height:14px;animation-delay:.15s}",
      ".ez1o-wave i:nth-child(3){height:9px;animation-delay:.3s}.ez1o-wave i:nth-child(4){height:16px;animation-delay:.45s}",
      ".ez1o-wave i:nth-child(5){height:7px;animation-delay:.6s}.ez1o-wave i:nth-child(6){height:12px;animation-delay:.75s}",
      "@keyframes ez1oWave{0%,100%{transform:scaleY(.4)}50%{transform:scaleY(1)}}",
      ".ez1o-reclab{font-size:11.5px;color:var(--ink-3,#6B7280);}",
      ".ez1o-stop{cursor:pointer;margin-left:auto;border:1px solid #DC2626;border-radius:999px;padding:5px 13px;",
      "font-size:11.5px;font-weight:700;color:#DC2626;background:var(--card,#fff);}",
      ".ez1o-stop:hover{background:rgba(220,38,38,.06);}",
      ".ez1o-tr{max-height:220px;overflow-y:auto;padding:10px 14px;display:flex;flex-direction:column;gap:8px;}",
      ".ez1o-line{display:flex;gap:8px;font-size:12.5px;line-height:1.55;animation:ez1oIn .25s ease;}",
      "@keyframes ez1oIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}",
      ".ez1o-line .tm{flex:none;font-size:10.5px;color:var(--ink-3,#9CA3AF);font-variant-numeric:tabular-nums;padding-top:2px;}",
      ".ez1o-line .nm{flex:none;font-weight:700;}",
      ".ez1o-line.mgr .nm{color:#6D28D9;}.ez1o-line.mem .nm{color:var(--blue,#1F7AF0);}",
      ".ez1o-gen{display:flex;align-items:center;gap:10px;padding:16px;font-size:12.5px;color:var(--ink-3,#6B7280);}",
      ".ez1o-spin{width:14px;height:14px;border-radius:50%;border:2px solid var(--line,#E4E7EC);border-top-color:var(--blue,#1F7AF0);animation:ez1oSpin .8s linear infinite;flex:none;}",
      "@keyframes ez1oSpin{to{transform:rotate(360deg)}}",
      /* 요약 카드 */
      ".ez1o-sum{border:1px solid var(--line,#E4E7EC);border-radius:14px;background:var(--card,#fff);padding:14px 16px;}",
      ".ez1o-sum.ez1o-collapsed .ez1o-body{display:none;}",
      ".ez1o-sumhead{display:flex;align-items:center;flex-wrap:wrap;gap:8px;}",
      ".ez1o-sumhead .tt{font-size:14px;font-weight:800;}",
      ".ez1o-asof{font-size:10.5px;color:var(--ink-3,#9CA3AF);margin-left:auto;}",
      ".ez1o-h4{font-size:11.5px;font-weight:700;color:var(--ink-3,#6B7280);margin:14px 0 6px;}",
      ".ez1o-topic{display:flex;gap:8px;align-items:baseline;font-size:12.5px;line-height:1.6;margin:4px 0;}",
      ".ez1o-topic .no{flex:none;width:16px;height:16px;border-radius:50%;background:var(--blue-soft,#EAF2FE);color:var(--blue,#1F7AF0);",
      "font-size:10px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;transform:translateY(2px);}",
      ".ez1o-src{display:inline-block;font-size:10px;font-weight:600;border-radius:5px;padding:1px 7px;margin-left:5px;vertical-align:middle;",
      "color:#1F7AF0;background:rgba(31,122,240,.08);border:1px solid rgba(31,122,240,.3);white-space:nowrap;}",
      ".ez1o-act{display:flex;gap:8px;align-items:baseline;font-size:12.5px;line-height:1.6;margin:4px 0;}",
      ".ez1o-act .bx{flex:none;width:12px;height:12px;border:1.5px solid var(--line-2,#CBD5E1);border-radius:3px;transform:translateY(2px);}",
      ".ez1o-act .own{font-size:11px;color:var(--ink-3,#6B7280);}",
      ".ez1o-sig{display:flex;gap:8px;align-items:baseline;font-size:12.5px;line-height:1.6;margin:4px 0;padding:7px 10px;border-radius:8px;}",
      ".ez1o-sig.risk{background:rgba(180,83,9,.07);border:1px solid rgba(180,83,9,.25);}",
      ".ez1o-sig.grow{background:rgba(21,128,61,.06);border:1px solid rgba(21,128,61,.25);}",
      ".ez1o-sig .ic{flex:none;}",
      /* 게이트 (tx_agent 어휘 재사용) */
      ".ez1o-gate{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:14px;padding:11px 13px;",
      "background:var(--card,#fff);border:1px dashed var(--line-2,#CBD5E1);border-radius:14px;}",
      ".ez1o-gate .lab{font-size:11.5px;color:var(--ink-3,#6B7280);margin-right:auto;}",
      ".ez1o-gbtn{cursor:pointer;border:1px solid var(--line,#E4E7EC);border-radius:999px;padding:6px 13px;font-size:12px;",
      "font-weight:600;color:var(--ink,#1D2433);background:var(--card,#fff);transition:background .12s;}",
      ".ez1o-gbtn:hover{background:rgba(31,122,240,.06);}",
      ".ez1o-gbtn.primary{color:#fff;background:#23408E;border-color:#23408E;}",
      ".ez1o-gbtn.primary:hover{background:#1B326F;}",
      ".ez1o-gbtn:disabled{opacity:.45;cursor:default;}",
      ".ez1o-gbtn[data-chosen=\"1\"]{opacity:1!important;box-shadow:0 0 0 2px #C2410C inset;}",
      ".ez1o-dec{font-size:12px;font-weight:600;color:#15803D;}",
      ".ez1o-drop{font-size:11.5px;color:var(--ink-3,#6B7280);margin-top:8px;}",
      /* 커버리지 맵 오버레이 */
      ".ez1o-mapov{position:fixed;inset:0;z-index:1300;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:24px;}",
      ".ez1o-map{background:var(--card,#fff);border-radius:18px;max-width:1080px;width:100%;max-height:88vh;overflow-y:auto;",
      "box-shadow:0 24px 64px rgba(15,23,42,.3);padding:22px 24px;}",
      ".ez1o-maphead{display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;}",
      ".ez1o-maphead .tt{font-size:16.5px;font-weight:800;}",
      ".ez1o-maphead .principle{flex-basis:100%;font-size:12px;color:#B45309;background:rgba(180,83,9,.07);",
      "border:1px solid rgba(180,83,9,.25);border-radius:8px;padding:7px 11px;margin-top:6px;}",
      ".ez1o-mapx{cursor:pointer;margin-left:auto;border:none;background:none;font-size:18px;color:var(--ink-3,#6B7280);line-height:1;}",
      ".ez1o-legend{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--ink-3,#6B7280);margin:10px 0 14px;}",
      ".ez1o-cols{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;}",
      "@media(max-width:920px){.ez1o-cols{grid-template-columns:repeat(2,1fr);}}",
      ".ez1o-col{background:var(--soft,#F8FAFC);border:1px solid var(--line,#E4E7EC);border-radius:14px;padding:12px;}",
      ".ez1o-col>.ch{font-size:12.5px;font-weight:800;margin-bottom:10px;display:flex;align-items:center;gap:6px;}",
      ".ez1o-col>.ch .step{width:18px;height:18px;border-radius:50%;background:#23408E;color:#fff;font-size:10px;font-weight:800;",
      "display:inline-flex;align-items:center;justify-content:center;}",
      ".ez1o-card{background:var(--card,#fff);border:1px solid var(--line,#E4E7EC);border-radius:10px;padding:9px 11px;margin-bottom:8px;}",
      ".ez1o-card.new{border:1.5px solid #C2410C;box-shadow:0 0 0 3px rgba(194,65,12,.08);}",
      ".ez1o-card.cand{border-style:dashed;opacity:.85;}",
      ".ez1o-card .nm{font-size:12px;font-weight:700;line-height:1.4;}",
      ".ez1o-st{font-size:9.5px;font-weight:700;border-radius:999px;padding:1px 8px;white-space:nowrap;display:inline-block;margin-bottom:5px;}",
      ".ez1o-st.live{color:#15803D;background:rgba(21,128,61,.08);border:1px solid rgba(21,128,61,.3);}",
      ".ez1o-st.new{color:#C2410C;background:rgba(194,65,12,.08);border:1px solid rgba(194,65,12,.35);}",
      ".ez1o-st.cand{color:var(--ink-3,#6B7280);background:var(--soft,#F8FAFC);border:1px solid var(--line-2,#CBD5E1);}",
      ".ez1o-stars{display:flex;gap:10px;font-size:10.5px;color:var(--ink-3,#6B7280);margin-top:6px;}",
      ".ez1o-stars b{color:#B45309;font-weight:700;letter-spacing:1px;}"
    ].join("");
    document.head.appendChild(st);
  }

  /* ============================================================
     1) 주입 — .mt-main 상단 바 (MutationObserver + 초기 폴링, 멱등)
     ============================================================ */
  function barHTML() {
    var confirmed = !!loadState().confirmedAt;
    return '<div class="ez1o-bar" data-ez1o-bar>'
      + '<button class="ez1o-btn" data-ez1o="start">&#9210; elizax 녹음·요약</button>'
      + '<span class="ez1o-badge" title="요약은 근거와 함께 제안만 — 확정은 사람">&#9679; suggest</span>'
      + '<span class="ez1o-note">녹음→전사→요약은 자동, 기록 확정은 사람</span>'
      + (confirmed ? '<span class="ez1o-donetag">&#10003; 7/16 요약 확정됨 · 원장 축적</span>' : '')
      + '<button class="ez1o-linkbtn" data-ez1o="map">&#128506; 전주기 커버리지 맵</button>'
      + '</div>'
      + '<div class="ez1o-panel" data-ez1o-panel></div>';
  }

  function tryInject() {
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

  function start(panel) {
    if (sess && !sess.finished) { toast("이미 녹음이 진행 중입니다.", ""); return; }
    if (!panel) {
      tryInject();
      panel = document.querySelector("[data-ez1o-panel]");
      if (!panel) { toast("성과관리 › 1:1 미팅 화면에서 실행할 수 있습니다.", ""); return; }
    }
    killSession();
    sess = { panel: panel, lineTimer: null, secTimer: null, idx: 0, sec: 0, script: buildScript(), finished: false };
    panel.innerHTML =
      '<div class="ez1o-rec">'
      + '<div class="ez1o-rechead">'
      + '<span class="ez1o-dot"></span><span class="ez1o-timer" data-ez1o-timer>00:00</span>'
      + '<span class="ez1o-wave"><i></i><i></i><i></i><i></i><i></i><i></i></span>'
      + '<span class="ez1o-reclab">녹음 중 · 라이브 전사 (' + esc(REC_ID) + ')</span>'
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
    panel.innerHTML = '<div class="ez1o-rec"><div class="ez1o-gen"><span class="ez1o-spin"></span>'
      + '요약 생성 중 — 전사 ' + sess.idx + '줄 분석 · 주제/액션/신호 추출…</div></div>';
    setTimeout(function () {
      if (!document.body.contains(panel)) { killSession(); return; }
      panel.innerHTML = summaryHTML();
      killSession();
    }, 1200);
  }

  /* ---------------- 요약 카드 ---------------- */
  function chip(t) { return '<span class="ez1o-src">' + esc(REC_ID) + ' · ' + esc(t) + '</span>'; }

  function summaryHTML() {
    var MGR = managerName(), MEM = memberName();
    return '<div class="ez1o-sum" data-ez1o-sum>'
      + '<div class="ez1o-sumhead">'
      + '<span class="tt">1:1 미팅 요약 · 7/16</span>'
      + '<span class="ez1o-badge" title="요약은 근거와 함께 제안만 — 확정은 사람">&#9679; suggest</span>'
      + '<span class="ez1o-asof">as-of ' + esc(AS_OF) + '</span>'
      + '</div>'
      + '<div class="ez1o-body">'
      + '<div class="ez1o-h4">논의 주제 3</div>'
      + '<div class="ez1o-topic"><span class="no">1</span><span>KR2 진척 — 신규 기획 3건 사용자 검증 통과, 잔여 2건 설계 중 (진행률 68%)' + chip("00:16") + '</span></div>'
      + '<div class="ez1o-topic"><span class="no">2</span><span>일정 리스크 — 외부 API 파트너 응답 2주 지연, 잔여 검증 일정 순연 가능성' + chip("00:42") + '</span></div>'
      + '<div class="ez1o-topic"><span class="no">3</span><span>성장 니즈 — 추천 로직 업무 희망, ML 기초 교육 수강 요청' + chip("01:24") + '</span></div>'
      + '<div class="ez1o-h4">액션 아이템 2</div>'
      + '<div class="ez1o-act"><span class="bx"></span><span>외부 API 지연 건 파트너십 팀 에스컬레이션 <span class="own">— 담당 ' + esc(MGR) + ' · 기한 7/18</span></span></div>'
      + '<div class="ez1o-act"><span class="bx"></span><span>ML 기초 교육 과정 선정·예산 신청 <span class="own">— 담당 ' + esc(MEM) + ' · 기한 7/22</span></span></div>'
      + '<div class="ez1o-h4">감지 신호 2</div>'
      + '<div class="ez1o-sig risk"><span class="ic">&#9888;</span><span><b>리스크</b> · 일정 지연(외부 API) — 이번 주 체크인 초안에 리스크 항목 반영을 제안합니다' + chip("00:42") + '</span></div>'
      + '<div class="ez1o-sig grow"><span class="ic">&#8599;</span><span><b>성장 니즈</b> · ML 교육 수요 감지 — 교육 신청 연계 후보로 표시했습니다' + chip("01:37") + '</span></div>'
      + '</div>'
      + '<div class="ez1o-gate" data-ez1o-gate>'
      + '<span class="lab">결정 게이트 · 사람이 확정 (승인 전 side-effect 0)</span>'
      + '<button class="ez1o-gbtn primary" data-ez1o-gact="confirm">기록 확정·맥락 축적</button>'
      + '<button class="ez1o-gbtn" data-ez1o-gact="edit">수정</button>'
      + '<button class="ez1o-gbtn" data-ez1o-gact="drop">폐기</button>'
      + '</div>'
      + '</div>';
  }

  /* ---------------- 게이트 결정 ---------------- */
  function decideGate(card, act) {
    var gate = card.querySelector("[data-ez1o-gate]");
    if (!gate) return;

    if (act === "edit") {
      /* 수정 모드: 본문을 직접 고친 뒤 확정 — 게이트는 열린 채 유지 */
      var body = card.querySelector(".ez1o-body");
      if (body && body.getAttribute("contenteditable") !== "true") {
        body.setAttribute("contenteditable", "true");
        body.style.outline = "2px dashed rgba(31,122,240,.4)";
        body.style.borderRadius = "8px";
        toast("수정 모드 — 요약을 직접 고친 뒤 [기록 확정·맥락 축적]을 누르세요.", "");
      }
      return;
    }

    /* confirm / drop → 게이트 잠금 */
    var btns = gate.querySelectorAll("[data-ez1o-gact]");
    for (var i = 0; i < btns.length; i++) {
      btns[i].disabled = true;
      if (btns[i].getAttribute("data-ez1o-gact") === act) btns[i].setAttribute("data-chosen", "1");
    }
    var body2 = card.querySelector(".ez1o-body");
    if (body2) { body2.removeAttribute("contenteditable"); body2.style.outline = ""; }

    if (act === "confirm") {
      document.dispatchEvent(new CustomEvent("ez:ctx", {
        detail: {
          type: "oneonone",
          source: "1on1.rec.0716",
          title: "1:1 미팅 요약 · 7/16",
          summary: "KR2 진척·API 지연 리스크·ML 교육 니즈·다음 체크인 합의",
          weight: 3
        }
      }));
      var dec = document.createElement("span");
      dec.className = "ez1o-dec";
      dec.innerHTML = "&#10003; 확정 · 감사 기록됨";
      gate.appendChild(dec);
      var st = loadState(); st.confirmedAt = "2026-07-16"; saveState(st);
      var bar = document.querySelector("[data-ez1o-bar]");
      if (bar && !bar.querySelector(".ez1o-donetag")) {
        var tag = document.createElement("span");
        tag.className = "ez1o-donetag";
        tag.innerHTML = "&#10003; 7/16 요약 확정됨 · 원장 축적";
        var link = bar.querySelector(".ez1o-linkbtn");
        bar.insertBefore(tag, link || null);
      }
      toast("기록 확정 — 맥락 원장에 축적되었습니다 (감사 로그 기록).", "ok");
    } else { /* drop */
      card.classList.add("ez1o-collapsed");
      var note = document.createElement("div");
      note.className = "ez1o-drop";
      note.textContent = "폐기됨 — 원장에 아무것도 축적되지 않았습니다. 확정되지 않은 요약은 맥락에 섞이지 않습니다(맥락 오염 방지).";
      card.appendChild(note);
      toast("요약 폐기 — 맥락 원장에는 축적되지 않았습니다.", "");
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
      { name: "목표 정합성·중복 점검", st: "live", f: 1, c: 2 },
      { name: "목표 리밸런싱 제안", st: "cand", f: 1, c: 3 }
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
      { name: "등급 Calibration 심의", st: "live", f: 1, c: 3 }
    ]},
    { col: "피드백·리뷰", items: [
      { name: "피드백 문장 정제 (SBI)", st: "live", f: 2, c: 2 },
      { name: "리뷰 초안 co-writing", st: "live", f: 1, c: 2 },
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
    var cols = MAP.map(function (col, ci) {
      var cards = col.items.map(function (it) {
        return '<div class="ez1o-card ' + it.st + '">'
          + '<span class="ez1o-st ' + it.st + '">' + esc(ST_LABEL[it.st]) + '</span>'
          + '<div class="nm">' + esc(it.name) + '</div>'
          + '<div class="ez1o-stars"><span>빈도 <b>' + stars(it.f) + '</b></span><span>맥락기여 <b>' + stars(it.c) + '</b></span></div>'
          + '</div>';
      }).join("");
      return '<div class="ez1o-col"><div class="ch"><span class="step">' + (ci + 1) + '</span>' + esc(col.col) + '</div>' + cards + '</div>';
    }).join("");
    ov.innerHTML =
      '<div class="ez1o-map">'
      + '<div class="ez1o-maphead">'
      + '<span class="tt">성과관리 전 주기 × elizax 기능 커버리지</span>'
      + '<span class="ez1o-asof">as-of ' + esc(AS_OF) + '</span>'
      + '<button class="ez1o-mapx" data-ez1o="mapclose" title="닫기">&#10005;</button>'
      + '<span class="principle">선정 원칙 — 초기엔 <b>맥락 기여도 우선</b>: 축적이 임계치를 넘으면 <b>빈도 우선</b>으로 전환. '
      + '이번 신규 1순위 = 1on1 (빈도 ★★★ · 맥락기여 ★★★, 유일한 미지원 공백)</span>'
      + '</div>'
      + '<div class="ez1o-legend">'
      + '<span class="ez1o-st live">제공중</span><span class="ez1o-st new">신규 ★이번 추가</span><span class="ez1o-st cand">후보</span>'
      + '<span>· 우선순위 2기준: 빈도 ★1~3 / 맥락기여 ★1~3</span>'
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
