/* ============================================================================
 * tx_chat_slash.js — elizax 대화 입력창 슬래시 커맨드 + 자동완성
 * ----------------------------------------------------------------------------
 * [기획 스펙]
 * ① 배경/문제
 *    - elizax 대화 진입점이 두 곳(FAB 도킹창 textarea.ezx-ta, 전체화면 허브
 *      textarea[data-agh-chatta])으로 나뉘어 있고, 자주 쓰는 동작(새 대화·초기화·
 *      중지·재생성·전체화면 전환)과 대표 시나리오 실행이 버튼·칩 위치를 찾아
 *      눌러야만 가능하다. 키보드만으로 빠르게 명령을 내릴 수단이 없다.
 * ② 사용자 시나리오
 *    - 사용자가 입력창에 "/"를 치면 입력창 바로 위에 명령 자동완성 팝업이 뜬다.
 *      "/체"까지 치면 /체크인만 남는다. ↑↓로 고르고 Enter(또는 Tab)로 확정한다.
 *    - /새대화 같은 액션형은 즉시 실행되고 입력창이 비워진다. /체크인 같은
 *      시나리오형은 해당 시나리오 칩 문구가 그대로 elizax에 전송된다.
 *    - Esc를 누르면 팝업만 닫히고 입력값은 남는다.
 * ③ 동작 정의
 *    - 대상: textarea.ezx-ta(FAB) · textarea[data-agh-chatta](허브). 허브 쪽은
 *      화면 전환마다 재렌더되므로 요소에 직접 바인딩하지 않고 document 레벨
 *      input/keydown 위임(e.target.matches 검사)으로 처리한다.
 *    - 입력값 전체가 "/"로 시작하고 공백·줄바꿈이 없을 때만 팝업을 연다.
 *      "/" 뒤 문자열로 명령 이름·설명을 부분일치 필터링한다.
 *    - keydown은 capture 단계에서 처리해 기존 Enter 전송 핸들러보다 먼저
 *      가로챈다. 팝업이 열려 있을 때만 ↑↓/Enter/Tab/Esc를 소비
 *      (preventDefault + stopPropagation)하고, 닫혀 있으면 일절 개입하지 않는다.
 *    - 확정 시: 액션형(/새대화 /초기화 /중지 /재생성 /전체화면)은 즉시 실행 후
 *      입력창을 비운다. 시나리오형(/체크인 /목표 /정합성 /근거 /피드백정제
 *      /코멘트 /편향 /캘리브레이션 /리뷰)은 TXAgent.SCENARIOS에서 해당 key
 *      (qw1,qw2,qw7,qw4,qw6,qw3,qw5,calib,review)의 chip 문구를 찾아
 *      Elizax.sendRaw()로 전송한다.
 *    - 팝업은 싱글턴 1개를 body에 두고, 대상 입력창의 getBoundingClientRect
 *      기준으로 입력창 위에 붙인다(스크롤·리사이즈 시 재배치).
 *    - 마우스로 항목을 눌러도 확정된다(mousedown 시 포커스 이탈 방지).
 * ④ 엣지 케이스
 *    - 스트리밍 중: /재생성·시나리오형은 전송하지 않고 경고 토스트. /중지는
 *      스트리밍이 아닐 때 "진행 중인 생성이 없습니다" 안내.
 *    - 필터 결과 0건이면 팝업을 닫아 Enter가 평소처럼 일반 전송으로 동작한다.
 *    - TXAgent.SCENARIOS에서 chip을 못 찾으면 내장 폴백 문구를 전송한다.
 *    - 전역(EZChat/Elizax/TXAgent/TX)이 없으면 해당 명령은 조용히 무시하고
 *      토스트로만 알린다. 입력창 밖 클릭·포커스 이탈 시 팝업을 닫는다.
 *    - 기존 파일은 일절 수정하지 않는다(문서 위임 + 스타일 주입만 사용).
 * ========================================================================== */
(function () {
  "use strict";

  /* ---------- 유틸 ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function toast(msg, kind) {
    if (window.TX && typeof TX.toast === "function") TX.toast(msg, kind || "");
  }
  function isStreaming() {
    return !!(window.Elizax && Elizax.isStreaming && Elizax.isStreaming());
  }
  /* TXAgent.SCENARIOS에서 key로 칩 문구 조회 (없으면 폴백) */
  function chipOf(key, fallback) {
    var list = window.TXAgent && TXAgent.SCENARIOS;
    if (list && list.length) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].key === key && list[i].chip) return list[i].chip;
      }
    }
    return fallback;
  }
  /* 시나리오 칩 문구 전송 (스트리밍 중이면 차단) */
  function sendScenario(key, fallback) {
    if (!(window.Elizax && Elizax.sendRaw)) { toast("elizax 모듈을 찾을 수 없습니다", "warn"); return; }
    if (isStreaming()) { toast("응답 생성 중에는 전송할 수 없습니다", "warn"); return; }
    Elizax.sendRaw(chipOf(key, fallback));
  }

  /* ---------- 명령 정의 ---------- */
  /* type:"action"=즉시 실행 / type:"scn"=시나리오 칩 문구 전송 */
  var COMMANDS = [
    { name: "새대화",       type: "action", desc: "현재 대화를 보관하고 새 세션을 시작합니다",
      run: function () {
        if (!(window.EZChat && EZChat.newSession)) { toast("대화 스토어를 찾을 수 없습니다", "warn"); return; }
        EZChat.newSession();
        toast("새 대화를 시작했습니다", "ok");
      } },
    { name: "초기화",       type: "action", desc: "현재 대화 내용을 초기화합니다",
      run: function () {
        if (!(window.Elizax && Elizax.reset)) { toast("elizax 모듈을 찾을 수 없습니다", "warn"); return; }
        Elizax.reset();
      } },
    { name: "중지",         type: "action", desc: "생성 중인 응답을 중지합니다",
      run: function () {
        if (!(window.Elizax && Elizax.stopStreaming)) { toast("elizax 모듈을 찾을 수 없습니다", "warn"); return; }
        if (!isStreaming()) { toast("진행 중인 생성이 없습니다", ""); return; }
        Elizax.stopStreaming();
      } },
    { name: "재생성",       type: "action", desc: "마지막 질문을 다시 전송해 응답을 재생성합니다",
      run: function () {
        if (!(window.Elizax && Elizax.regenerate)) { toast("elizax 모듈을 찾을 수 없습니다", "warn"); return; }
        if (isStreaming()) { toast("응답 생성 중에는 재생성할 수 없습니다", "warn"); return; }
        Elizax.regenerate();
      } },
    { name: "전체화면",     type: "action", desc: "전체화면 허브(공유 대화)를 엽니다",
      run: function () {
        if (!(window.TXAgent && TXAgent.openHub)) { toast("허브 모듈을 찾을 수 없습니다", "warn"); return; }
        TXAgent.openHub("chat");
      } },
    { name: "프로세스맵",   type: "action", desc: "성과 사이클의 과정과 근거를 한 장으로 봅니다",
      run: function () {
        if (!(window.EZJourney && EZJourney.open)) { toast("프로세스 맵 모듈을 찾을 수 없습니다", "warn"); return; }
        EZJourney.open();
      } },
    { name: "체크인",       type: "scn", key: "qw1",    fb: "주간 체크인 브리핑 만들어줘" },
    { name: "목표",         type: "scn", key: "qw2",    fb: "이번 분기 목표 초안 잡아줘" },
    { name: "정렬점검",     type: "scn", key: "qw7",    fb: "팀 목표 정렬·중복 점검해줘" },
    { name: "근거",         type: "scn", key: "qw4",    fb: "내 성과 근거 타임라인 보여줘" },
    { name: "피드백정제",   type: "scn", key: "qw6",    fb: "피드백 문장 다듬어줘" },
    { name: "코멘트",       type: "scn", key: "qw3",    fb: "평가 코멘트 초안 써줘" },
    { name: "편향",         type: "scn", key: "qw5",    fb: "평가 편향 점검해줘" },
    { name: "캘리브레이션", type: "scn", key: "calib",  fb: "등급 캘리브레이션 심의 열어줘" },
    { name: "리뷰",         type: "scn", key: "review", fb: "리뷰 초안 같이 쓰자" }
  ];
  /* 시나리오형 설명 = 실제 전송될 칩 문구(런타임 조회) */
  function descOf(c) {
    if (c.type === "scn") return "“" + chipOf(c.key, c.fb) + "” 전송";
    return c.desc;
  }

  /* ---------- 스타일 주입 ---------- */
  function injectStyle() {
    if (document.getElementById("ezcx-slash-style")) return;
    var css = "" +
      ".ezcx-slash-pop{position:fixed;z-index:100000;min-width:260px;max-width:420px;" +
        "background:var(--card,#fff);border:1px solid var(--line,#E4E7EC);border-radius:12px;" +
        "box-shadow:0 12px 32px rgba(15,23,42,.18);overflow:hidden;font-size:13px;" +
        "color:var(--ink,#1D2433);display:none;}" +
      ".ezcx-slash-pop.on{display:block;}" +
      ".ezcx-slash-cap{padding:7px 12px 5px;font-size:11px;font-weight:700;letter-spacing:.02em;" +
        "color:var(--blue,#1F7AF0);background:var(--soft,#F8FAFC);" +
        "border-bottom:1px solid var(--line,#E4E7EC);}" +
      ".ezcx-slash-list{max-height:264px;overflow-y:auto;padding:4px;}" +
      ".ezcx-slash-item{display:flex;align-items:baseline;gap:8px;padding:7px 9px;border-radius:8px;" +
        "cursor:pointer;line-height:1.4;}" +
      ".ezcx-slash-item.sel{background:var(--soft,#F8FAFC);" +
        "box-shadow:inset 0 0 0 1px var(--blue,#1F7AF0);}" +
      ".ezcx-slash-name{flex:0 0 auto;font-weight:700;color:var(--blue,#1F7AF0);white-space:nowrap;}" +
      ".ezcx-slash-desc{flex:1 1 auto;min-width:0;color:var(--ink,#1D2433);opacity:.62;" +
        "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}" +
      ".ezcx-slash-tag{flex:0 0 auto;font-size:10px;font-weight:700;padding:1px 6px;border-radius:99px;" +
        "border:1px solid var(--line,#E4E7EC);color:var(--ink,#1D2433);opacity:.55;}";
    var st = document.createElement("style");
    st.id = "ezcx-slash-style";
    st.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------- 팝업 싱글턴 ---------- */
  var pop = { el: null, open: false, anchor: null, items: [], sel: 0 };

  function ensurePop() {
    if (pop.el) return pop.el;
    var el = document.createElement("div");
    el.className = "ezcx-slash-pop";
    el.setAttribute("role", "listbox");
    el.innerHTML = '<div class="ezcx-slash-cap">슬래시 명령</div><div class="ezcx-slash-list"></div>';
    /* mousedown: 입력창 포커스 이탈(=팝업 닫힘) 전에 확정 처리 */
    el.addEventListener("mousedown", function (e) {
      var it = e.target && e.target.closest ? e.target.closest(".ezcx-slash-item") : null;
      if (!it) { e.preventDefault(); return; }
      e.preventDefault();
      var idx = parseInt(it.getAttribute("data-idx"), 10);
      if (!isNaN(idx)) { pop.sel = idx; confirmSel(); }
    });
    document.body.appendChild(el);
    pop.el = el;
    return el;
  }

  /* 대상 입력창 위에 배치 (fixed — 입력창 rect 기준) */
  function place(anchor) {
    if (!pop.el || !anchor) return;
    var r = anchor.getBoundingClientRect();
    var w = Math.min(Math.max(r.width, 260), 420);
    var left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    pop.el.style.left = left + "px";
    pop.el.style.width = w + "px";
    pop.el.style.bottom = Math.max(8, window.innerHeight - r.top + 6) + "px";
    pop.el.style.top = "auto";
  }

  function renderItems() {
    var listEl = pop.el.querySelector(".ezcx-slash-list");
    var html = "";
    for (var i = 0; i < pop.items.length; i++) {
      var c = pop.items[i];
      html += '<div class="ezcx-slash-item' + (i === pop.sel ? " sel" : "") + '" data-idx="' + i + '" role="option">' +
        '<span class="ezcx-slash-name">/' + esc(c.name) + "</span>" +
        '<span class="ezcx-slash-desc">' + esc(descOf(c)) + "</span>" +
        '<span class="ezcx-slash-tag">' + (c.type === "scn" ? "시나리오" : "액션") + "</span></div>";
    }
    listEl.innerHTML = html;
    var selEl = listEl.querySelector(".ezcx-slash-item.sel");
    if (selEl && selEl.scrollIntoView) selEl.scrollIntoView({ block: "nearest" });
  }

  function openPop(anchor, items) {
    injectStyle();
    ensurePop();
    /* 앵커가 바뀌거나 목록이 갱신되면 선택 인덱스 보정 */
    if (pop.anchor !== anchor) pop.sel = 0;
    if (pop.sel >= items.length) pop.sel = 0;
    pop.anchor = anchor;
    pop.items = items;
    pop.open = true;
    pop.el.classList.add("on");
    renderItems();
    place(anchor);
  }

  function closePop() {
    if (!pop.open) return;
    pop.open = false;
    pop.anchor = null;
    pop.items = [];
    pop.sel = 0;
    if (pop.el) pop.el.classList.remove("on");
  }

  function moveSel(delta) {
    if (!pop.items.length) return;
    pop.sel = (pop.sel + delta + pop.items.length) % pop.items.length;
    renderItems();
  }

  /* 입력창 비우기 (autoGrow 등 기존 input 리스너에도 알림) */
  function clearTa(ta) {
    ta.value = "";
    try {
      var ev = new Event("input", { bubbles: true });
      ta.dispatchEvent(ev);
    } catch (e) { /* 구형 환경 폴백: 생략해도 기능엔 지장 없음 */ }
  }

  /* 선택 항목 확정 실행 */
  function confirmSel() {
    var c = pop.items[pop.sel];
    var ta = pop.anchor;
    closePop();
    if (!c || !ta) return;
    clearTa(ta);
    if (c.type === "action") { c.run(); return; }
    sendScenario(c.key, c.fb);
  }

  /* ---------- 필터링 ---------- */
  /* 값 전체가 "/"로 시작하고 공백·줄바꿈 없는 단일 토큰일 때만 명령 모드 */
  function queryOf(value) {
    if (!value || value.charAt(0) !== "/") return null;
    var body = value.slice(1);
    if (/[\s\/]/.test(body)) return null; /* 공백·줄바꿈·중복 슬래시 → 일반 입력 */
    return body;
  }
  function filterCommands(q) {
    if (!q) return COMMANDS.slice();
    var out = [];
    var i, c;
    /* 1순위: 이름이 q로 시작 */
    for (i = 0; i < COMMANDS.length; i++) {
      c = COMMANDS[i];
      if (c.name.indexOf(q) === 0) out.push(c);
    }
    /* 2순위: 이름·설명에 q 포함 */
    for (i = 0; i < COMMANDS.length; i++) {
      c = COMMANDS[i];
      if (out.indexOf(c) >= 0) continue;
      if (c.name.indexOf(q) >= 0 || descOf(c).indexOf(q) >= 0) out.push(c);
    }
    return out;
  }

  /* ---------- 대상 판별 ---------- */
  function isTargetTa(el) {
    if (!el || el.nodeType !== 1 || !el.matches) return false;
    return el.matches("textarea.ezx-ta") || el.matches("textarea[data-agh-chatta]");
  }

  /* 입력값 변화 → 팝업 갱신/개폐 */
  function update(ta) {
    var q = queryOf(ta.value || "");
    if (q === null) { if (pop.anchor === ta || !pop.open) closePop(); return; }
    var items = filterCommands(q);
    if (!items.length) { closePop(); return; } /* 0건이면 닫아 Enter 일반 전송 허용 */
    openPop(ta, items);
  }

  /* ---------- 이벤트 바인딩 (전부 document 위임 — 재렌더에 안전) ---------- */
  function bind() {
    injectStyle();

    /* 입력 위임: 허브 textarea는 재렌더되므로 요소 바인딩 금지 */
    document.addEventListener("input", function (e) {
      if (isTargetTa(e.target)) update(e.target);
    });

    /* 포커스 진입 시 "/" 입력값이 남아 있으면 재오픈 */
    document.addEventListener("focusin", function (e) {
      if (isTargetTa(e.target)) update(e.target);
    });

    /* 포커스 이탈 시 닫기 (팝업 자체 클릭은 mousedown preventDefault로 이탈 안 됨) */
    document.addEventListener("focusout", function (e) {
      if (pop.open && e.target === pop.anchor) closePop();
    });

    /* keydown: capture 단계 — 기존 Enter 전송 핸들러(요소 바인딩)보다 먼저 실행.
       팝업이 열려 있고 대상이 앵커 입력창일 때만 키를 소비한다. */
    document.addEventListener("keydown", function (e) {
      if (!pop.open) return;
      if (e.target !== pop.anchor) { closePop(); return; }
      var k = e.key;
      if (k === "ArrowDown") { e.preventDefault(); e.stopPropagation(); moveSel(1); }
      else if (k === "ArrowUp") { e.preventDefault(); e.stopPropagation(); moveSel(-1); }
      else if (k === "Enter" || k === "Tab") { e.preventDefault(); e.stopPropagation(); confirmSel(); }
      else if (k === "Escape") { e.preventDefault(); e.stopPropagation(); closePop(); }
    }, true);

    /* 입력창·팝업 밖 클릭 시 닫기 */
    document.addEventListener("mousedown", function (e) {
      if (!pop.open) return;
      var t = e.target;
      if (t === pop.anchor) return;
      if (pop.el && pop.el.contains(t)) return;
      closePop();
    });

    /* 스크롤·리사이즈 시 재배치 (내부 스크롤 포착 위해 capture) */
    document.addEventListener("scroll", function () {
      if (pop.open) place(pop.anchor);
    }, true);
    window.addEventListener("resize", function () {
      if (pop.open) place(pop.anchor);
    });
  }

  /* DOM 준비 후 바인딩 — 위임 방식이라 FAB/허브 생성 시점과 무관하게 동작 */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
