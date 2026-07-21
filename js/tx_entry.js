/* ============================================================================
 * tx_entry.js — 단일 진입점 + 화면 문맥 proactive 제안 + 근거 노출 정책
 * ----------------------------------------------------------------------------
 * [기획 스펙]
 *
 * ① 배경/문제
 *    - AI 기능 진입 버튼이 화면 곳곳에 분산되면 사용자는 "어디서 AI를 불러야
 *      하는지"를 화면마다 다시 학습해야 한다. 모든 AI 진입은 사용자의 시선이
 *      모이는 단일 기준점(FAB) 한 곳으로 수렴해야 한다.
 *    - 사용자가 먼저 부르기 전에는 Agent가 화면 문맥을 읽고 있다는 사실이
 *      드러나지 않는다. 화면/탭 전환 순간이야말로 "지금 이 화면에서 도와줄 수
 *      있는 일"을 선제 제안할 최적 타이밍인데 이를 살리는 장치가 없다.
 *    - proactive 제안조차 "왜 이 제안이 떴는지" 근거를 밝혀야 한다는 원칙
 *      (verifiable answer)과, 역할별로 근거를 어느 깊이까지 노출할지의 정책이
 *      코드 어디에도 정의돼 있지 않다.
 *
 * ② 사용자 시나리오
 *    - 사용자가 GNB에서 성과관리 → 목표 탭으로 이동 → 0.8초 뒤 FAB 바로 위에
 *      작은 말풍선 pill: "마지막 체크인 후 12일 — 체크인 초안 만들까요?"
 *      (하단에 아주 작게 "근거: 화면 문맥 · 맥락 원장") → 문구 클릭 시 elizax
 *      패널이 열리며 체크인 초안 요청이 자동 전송된다.
 *    - pill 우측 "⋯" 클릭 → 미니 메뉴 [대화 열기 / Agent 허브 / 맥락 원장 /
 *      전주기 맵] — 존재하는 진입점만 나열. "모든 AI 진입은 이 한 점"을 시연.
 *    - pill은 ×로 닫거나 8초 뒤 부드럽게 사라지고, 같은 화면에서는 세션당
 *      1회만 뜬다(다른 화면으로 가면 그 화면의 제안이 새로 1회).
 *    - GNB 우측 역할 스위처 옆에 현재 역할의 근거 노출 레벨 라벨이 붙는다:
 *      구성원 "근거 노출 · 핵심 근거" / 조직장 "근거+출처" / HR·경영진
 *      "산출 로직까지" — 역할을 바꾸면(리로드) 라벨도 바뀐다.
 *
 * ③ 동작 정의
 *    - [정책] window.EZEvidencePolicy = {member:"core", leader:"trace",
 *      hr:"logic", exec:"logic"} 를 IIFE 첫 줄에서 동기 정의(로드 순서 무관).
 *      렌더는 tx_ctx_ledger.js 담당 — 본 모듈은 정의+인디케이터 라벨만.
 *    - [감지] document 클릭 위임(#gnb [data-s], .subnav a) → 800ms 디바운스 →
 *      section.screen.on(+s-perf는 .subnav a.on의 data-p)으로 화면 키 확정.
 *      로드 직후에도 1회 검사(초기 화면 s-home 제안).
 *    - [제안 맵] s-home=오늘 브리핑(TXAgent.openHub) / s-perf:0=체크인 초안
 *      (Elizax.sendRaw) / s-perf:1=피드백 초안(Elizax.sendRaw) / s-perf:2=
 *      1:1 녹음·요약(EZOneOnOne.start, 부재 시 Elizax 폴백) / s-appr=평가
 *      코멘트 근거초안(TXAgent.openHub("qw3")). 문구는 역할(TXRoles)별 톤 차등.
 *    - [규칙] 세션당 화면별 1회(sessionStorage), × 닫기, 8s 후 fade-out
 *      (hover 시 타이머 일시정지), FAB(.ezx-fab) 없으면 미표시.
 *      pill 하단에 근거 표기 "근거: 화면 문맥 · 맥락 원장" 고정 노출.
 *      자율성 어휘 재사용: pill 헤더에 "제안" 배지(승인 전 side-effect 0).
 *    - [맥락 축적] 제안 수락(문구 클릭) 시 CustomEvent "ez:ctx" 발행 —
 *      tx_ctx_ledger.js가 수신해 원장에 기록(제안→수락도 감사 가능하게).
 *    - [노출 API] window.EZEntry = { suggest(screenKey), openMenu() }.
 *      suggest는 세션 1회 제한을 우회해 강제 표시(데모/디버그용).
 *
 * ④ 엣지 케이스
 *    - FAB·역할 스위처(.txr-switch)는 로드 후 늦게 생성 → 300ms 간격 최대
 *      20회 폴링으로 발견 후 부착. 못 찾으면 해당 기능만 조용히 생략.
 *    - elizax 패널/허브가 열려 있으면 제안을 띄우지 않는다(이미 대화 중).
 *      FAB 클릭 순간 pill·메뉴는 즉시 닫는다(대화로 진입했으므로).
 *    - 화면 재렌더로 DOM이 리셋되므로 클릭 처리는 전부 document 위임.
 *    - 제안의 필수 전역(Elizax/TXAgent)이 없으면 그 화면 제안은 스킵.
 *      메뉴 항목도 렌더 시점에 전역 존재를 확인해 있는 것만 나열.
 *    - sessionStorage 접근 불가(사생활 모드) 시 메모리 플래그로 폴백.
 *    - 같은 화면 키로 디바운스 검사가 연달아 와도(탭 재클릭) 1회 제한이 막는다.
 *    - innerHTML 조립 문자열은 전부 esc() 통과(제안 문구·라벨 포함).
 * ========================================================================== */
(function () {
  "use strict";

  /* [요구 1] 근거 노출 정책 — 최우선 동기 정의 (tx_ctx_ledger.js가 읽음) */
  window.EZEvidencePolicy = { member: "core", leader: "trace", hr: "logic", exec: "logic" };

  /* ---------------- 상수/유틸 ---------------- */

  var DEBOUNCE_MS = 800;
  var AUTOHIDE_MS = 8000;
  var POLL_MS = 300, POLL_MAX = 20;

  var EV_LABELS = {
    core: "핵심 근거",
    trace: "근거+출처",
    logic: "산출 로직까지"
  };
  var EV_TITLES = {
    core: "결과와 핵심 근거 칩만 노출됩니다",
    trace: "근거 칩과 원천 출처 목록까지 노출됩니다",
    logic: "근거·출처에 더해 산출 로직(입력→규칙→모델→검증)까지 노출됩니다"
  };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function empId() {
    try {
      var d = window.TALENX_DATA || {};
      return (d.meta && d.meta.currentUser && d.meta.currentUser.emp_id) || "EMP-0000";
    } catch (e) { return "EMP-0000"; }
  }

  function roleKey() {
    try {
      if (window.TXRoles && typeof window.TXRoles.current === "function") {
        var r = window.TXRoles.current();
        if (r && r.key) return r.key;
      }
    } catch (e) { /* 무해화 */ }
    return "member";
  }

  /* sessionStorage 폴백 포함 (사생활 모드 등) */
  var SS_KEY = "elizax_entry_v1:" + empId();
  var shownMem = {};
  function shownMap() {
    try {
      var raw = window.sessionStorage.getItem(SS_KEY);
      if (raw) return JSON.parse(raw) || {};
    } catch (e) { /* 폴백 */ }
    return shownMem;
  }
  function markShown(key) {
    var m = shownMap();
    m[key] = 1;
    shownMem = m;
    try { window.sessionStorage.setItem(SS_KEY, JSON.stringify(m)); } catch (e) { /* 메모리로만 */ }
  }
  function wasShown(key) { return !!shownMap()[key]; }

  /* ---------------- 화면 키 판정 ---------------- */

  function currentScreenKey() {
    var sec = document.querySelector("section.screen.on");
    if (!sec || !sec.id) return null;
    if (sec.id === "s-perf") {
      var tab = sec.querySelector(".subnav a.on");
      var p = tab ? tab.getAttribute("data-p") : null;
      return "s-perf:" + (p == null ? "0" : p);
    }
    return sec.id;
  }

  /* ---------------- 열림/닫힘 판정 (unread 모듈과 동일 규약) ---------------- */

  function chatSurfaceOpen() {
    var r = document.querySelector(".ezx-root");
    if (r && r.classList.contains("ezx-open")) return true;
    var hub = document.querySelector(".agh-root");
    if (hub && hub.classList.contains("on")) return true;
    return false;
  }

  function findFab() { return document.querySelector(".ezx-fab"); }

  /* ---------------- 안전 호출 래퍼 ---------------- */

  function openChatAndSend(text) {
    if (!(window.Elizax && typeof window.Elizax.sendRaw === "function")) return;
    try {
      if (typeof window.Elizax.open === "function") window.Elizax.open();
      window.Elizax.sendRaw(text);
    } catch (e) { /* 무해화 */ }
  }

  /* ---------------- [요구 2] 화면별 제안 맵 ----------------
     text: 역할 키를 받아 문구 반환(톤 차등). need(): 필수 전역 존재 확인.
     run(): 제안 수락 시 실행. ctxType: ez:ctx 이벤트의 type. */

  var SUGGESTIONS = {
    "s-home": {
      ctxType: "org",
      text: function (rk) {
        if (rk === "leader") return "팀 신호 브리핑 준비됨 — 열어볼까요?";
        if (rk === "hr") return "운영 점검 브리핑 준비됨 — 열어볼까요?";
        if (rk === "exec") return "경영 브리핑 준비됨 — 열어볼까요?";
        return "오늘 브리핑 준비됨 — 열어볼까요?";
      },
      need: function () { return !!(window.TXAgent && typeof window.TXAgent.openHub === "function"); },
      run: function () { window.TXAgent.openHub(); }
    },
    "s-perf:0": {
      ctxType: "checkin",
      text: function (rk) {
        if (rk === "leader") return "팀 체크인 지연 3명 — 리마인드 초안 준비할까요?";
        return "마지막 체크인 후 12일 — 체크인 초안 만들까요?";
      },
      need: function () { return !!(window.Elizax && typeof window.Elizax.sendRaw === "function"); },
      run: function (rk) {
        openChatAndSend(rk === "leader"
          ? "체크인 지연 인원에게 보낼 리마인드 초안 만들어줘"
          : "주간 체크인 초안 만들어줘");
      }
    },
    "s-perf:1": {
      ctxType: "feedback",
      text: function () { return "최근 1:1 논의 기반으로 피드백 초안 어때요?"; },
      need: function () { return !!(window.Elizax && typeof window.Elizax.sendRaw === "function"); },
      run: function () { openChatAndSend("최근 1:1 논의를 바탕으로 피드백 초안 만들어줘"); }
    },
    "s-perf:2": {
      ctxType: "oneonone",
      text: function () { return "이 미팅, 녹음하고 요약해 드릴까요?"; },
      need: function () {
        return !!(window.EZOneOnOne && typeof window.EZOneOnOne.start === "function") ||
               !!(window.Elizax && typeof window.Elizax.sendRaw === "function");
      },
      run: function () {
        if (window.EZOneOnOne && typeof window.EZOneOnOne.start === "function") {
          try { window.EZOneOnOne.start(); return; } catch (e) { /* 폴백 */ }
        }
        openChatAndSend("1:1 미팅 녹음·요약을 도와줘");
      }
    },
    "s-appr": {
      ctxType: "eval",
      text: function (rk) {
        if (rk === "member") return "평가 코멘트에 쓸 근거초안 준비돼 있어요";
        return "평가 코멘트 근거초안 준비돼 있어요 — 열어볼까요?";
      },
      need: function () { return !!(window.TXAgent && typeof window.TXAgent.openHub === "function"); },
      run: function () { window.TXAgent.openHub("qw3"); }
    }
  };

  /* ---------------- 스타일 주입 (self-contained) ---------------- */

  function injectStyle() {
    if (document.getElementById("eze-style")) return;
    var st = document.createElement("style");
    st.id = "eze-style";
    st.textContent = "" +
      /* proactive pill — FAB(우하단 24/24, 56px) 바로 위 */
      ".eze-pill{position:fixed;right:24px;bottom:94px;z-index:899;max-width:280px;" +
      "background:var(--card,#fff);border:1px solid var(--line,#E5E7EB);border-radius:14px;" +
      "box-shadow:0 10px 32px rgba(0,0,0,.14),0 2px 8px rgba(0,0,0,.06);" +
      "padding:10px 12px 9px;font-family:var(--sans,sans-serif);color:var(--ink,#111);" +
      "opacity:0;transform:translateY(10px) scale(.97);" +
      "transition:opacity .28s ease,transform .28s cubic-bezier(.32,.72,.24,1);}" +
      ".eze-pill.eze-show{opacity:1;transform:translateY(0) scale(1);}" +
      ".eze-pill.eze-hide{opacity:0;transform:translateY(6px) scale(.98);}" +
      /* 말풍선 꼬리 — FAB 방향(우하단) */
      ".eze-pill:after{content:\"\";position:absolute;right:22px;bottom:-6px;width:12px;height:12px;" +
      "background:var(--card,#fff);border-right:1px solid var(--line,#E5E7EB);" +
      "border-bottom:1px solid var(--line,#E5E7EB);transform:rotate(45deg);}" +
      ".eze-hd{display:flex;align-items:center;gap:6px;margin-bottom:5px;}" +
      ".eze-dot{width:7px;height:7px;border-radius:50%;background:var(--blue,#1F7AF0);flex:none;" +
      "box-shadow:0 0 0 3px rgba(31,122,240,.15);}" +
      ".eze-who{font-size:11px;font-weight:700;color:var(--ink-2,#333);letter-spacing:-.01em;}" +
      ".eze-badge{font-size:10px;font-weight:700;color:#B45309;background:rgba(180,83,9,.09);" +
      "border:1px solid rgba(180,83,9,.25);border-radius:8px;padding:1px 6px;line-height:1.5;}" +
      ".eze-hd .sp{flex:1;}" +
      ".eze-ib{border:0;background:transparent;color:var(--ink-3,#888);cursor:pointer;" +
      "font-size:14px;line-height:1;padding:2px 4px;border-radius:6px;}" +
      ".eze-ib:hover{background:var(--soft,#F3F4F6);color:var(--ink,#111);}" +
      ".eze-txt{display:block;width:100%;text-align:left;border:0;background:transparent;cursor:pointer;" +
      "font-size:13px;font-weight:600;line-height:1.45;color:var(--ink,#111);padding:0;" +
      "letter-spacing:-.01em;font-family:inherit;}" +
      ".eze-txt:hover{color:var(--blue,#1F7AF0);}" +
      ".eze-txt .go{color:var(--blue,#1F7AF0);font-weight:700;}" +
      ".eze-src{margin-top:6px;font-size:10px;color:var(--ink-3,#999);letter-spacing:-.01em;}" +
      ".eze-src b{font-weight:600;color:var(--ink-3,#999);}" +
      /* ⋯ 미니 메뉴 — 단일 진입점 허브 */
      ".eze-menu{position:fixed;right:24px;bottom:94px;z-index:910;min-width:176px;" +
      "background:var(--card,#fff);border:1px solid var(--line,#E5E7EB);border-radius:12px;" +
      "box-shadow:0 14px 40px rgba(0,0,0,.16);padding:6px;font-family:var(--sans,sans-serif);" +
      "opacity:0;transform:translateY(8px);transition:opacity .2s ease,transform .2s ease;}" +
      ".eze-menu.eze-show{opacity:1;transform:translateY(0);}" +
      ".eze-menu .mhd{font-size:10px;font-weight:700;color:var(--ink-3,#999);padding:5px 9px 4px;" +
      "letter-spacing:.02em;}" +
      ".eze-mi{display:flex;align-items:center;gap:8px;width:100%;border:0;background:transparent;" +
      "cursor:pointer;font-size:12.5px;font-weight:600;color:var(--ink-2,#333);padding:8px 9px;" +
      "border-radius:8px;text-align:left;font-family:inherit;letter-spacing:-.01em;}" +
      ".eze-mi:hover{background:var(--soft,#F3F4F6);color:var(--ink,#111);}" +
      ".eze-mi .ic{width:16px;text-align:center;flex:none;}" +
      /* 역할 스위처 옆 근거 레벨 인디케이터 */
      ".eze-ev{display:inline-flex;align-items:center;gap:5px;margin-left:10px;padding:3px 9px;" +
      "border:1px solid var(--line,#E5E7EB);border-radius:12px;background:var(--soft,#F6F7F9);" +
      "font-size:11px;font-weight:600;color:var(--ink-3,#777);white-space:nowrap;cursor:default;}" +
      ".eze-ev .lv{color:var(--blue,#1F7AF0);font-weight:700;}";
    document.head.appendChild(st);
  }

  /* ---------------- proactive pill 렌더 ---------------- */

  var pillEl = null;
  var hideTimer = null;
  var currentSg = null;   /* 표시 중인 제안 {key, sg} */

  function clearHideTimer() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  }

  function dismissPill(instant) {
    clearHideTimer();
    currentSg = null;
    if (!pillEl) return;
    var el = pillEl;
    pillEl = null;
    if (instant) {
      if (el.parentNode) el.parentNode.removeChild(el);
      return;
    }
    el.classList.remove("eze-show");
    el.classList.add("eze-hide");
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 320);
  }

  function armAutoHide(ms) {
    clearHideTimer();
    hideTimer = setTimeout(function () { dismissPill(false); }, ms);
  }

  function showPill(key, force) {
    var sg = SUGGESTIONS[key];
    if (!sg) return false;
    if (!force && wasShown(key)) return false;
    if (!findFab()) return false;              /* FAB 없으면 기준점이 없다 — 미표시 */
    if (chatSurfaceOpen()) return false;       /* 이미 대화 중 — 방해 금지 */
    if (!sg.need()) return false;              /* 실행 수단 부재 — 빈 제안 금지 */

    dismissPill(true);
    closeMenu();
    markShown(key);

    var rk = roleKey();
    var pill = document.createElement("div");
    pill.className = "eze-pill";
    pill.setAttribute("role", "dialog");
    pill.setAttribute("aria-label", "elizax 선제 제안");
    pill.setAttribute("data-eze-key", key);
    pill.innerHTML =
      '<div class="eze-hd">' +
        '<span class="eze-dot"></span>' +
        '<span class="eze-who">elizax</span>' +
        '<span class="eze-badge" title="자율성 수준: 제안 — 승인 전에는 아무것도 반영되지 않음">제안</span>' +
        '<span class="sp"></span>' +
        '<button class="eze-ib" data-eze-menu title="AI 진입점 메뉴" aria-label="진입점 메뉴">⋯</button>' +
        '<button class="eze-ib" data-eze-close title="닫기" aria-label="닫기">×</button>' +
      "</div>" +
      '<button class="eze-txt" data-eze-act>' + esc(sg.text(rk)) + ' <span class="go">›</span></button>' +
      '<div class="eze-src">근거: <b>화면 문맥</b> · <b>성과 히스토리</b></div>';
    document.body.appendChild(pill);
    currentSg = { key: key, sg: sg };

    /* hover 시 자동소멸 일시정지 */
    pill.addEventListener("mouseenter", clearHideTimer);
    pill.addEventListener("mouseleave", function () { if (pillEl === pill) armAutoHide(4000); });

    requestAnimationFrame(function () { pill.classList.add("eze-show"); });
    pillEl = pill;
    armAutoHide(AUTOHIDE_MS);
    return true;
  }

  function acceptSuggestion() {
    if (!currentSg) return;
    var key = currentSg.key, sg = currentSg.sg;
    dismissPill(true);
    /* proactive 수락도 맥락 원장에 축적 (모듈 간 계약: ez:ctx) */
    try {
      document.dispatchEvent(new CustomEvent("ez:ctx", {
        detail: {
          type: sg.ctxType,
          source: "entry.pill." + key,
          title: "선제 제안 수락",
          summary: sg.text(roleKey()),
          weight: 1
        }
      }));
    } catch (e) { /* 원장 부재/구형 브라우저 — 무해화 */ }
    try { sg.run(roleKey()); } catch (e) { /* 무해화 */ }
  }

  /* ---------------- [요구 3] 단일 진입점 미니 메뉴 ---------------- */

  var menuEl = null;
  var menuActions = [];   /* 렌더 시점 스냅샷 — data-eze-mi 인덱스로 실행 */

  function closeMenu() {
    if (!menuEl) return;
    var el = menuEl;
    menuEl = null;
    menuActions = [];
    el.classList.remove("eze-show");
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
  }

  function menuItems() {
    var items = [];
    if (window.Elizax && typeof window.Elizax.open === "function") {
      items.push({ ic: "💬", label: "대화 열기", run: function () { window.Elizax.open(); } });
    }
    if (window.TXAgent && typeof window.TXAgent.openHub === "function") {
      items.push({ ic: "◎", label: "Agent 허브", run: function () { window.TXAgent.openHub(); } });
    }
    if (window.EZLedger && typeof window.EZLedger.openPanel === "function") {
      items.push({ ic: "▤", label: "성과 히스토리", run: function () { window.EZLedger.openPanel(); } });
    }
    if (window.EZJourney && typeof window.EZJourney.open === "function") {
      items.push({ ic: "◈", label: "프로세스 맵", run: function () { window.EZJourney.open(); } });
    }
    if (window.EZCycle && typeof window.EZCycle.openMap === "function") {
      items.push({ ic: "◇", label: "전주기 커버리지 맵", run: function () { window.EZCycle.openMap(); } });
    }
    return items;
  }

  function openMenu() {
    if (menuEl) { closeMenu(); return; }
    var items = menuItems();
    if (!items.length) return;

    var menu = document.createElement("div");
    menu.className = "eze-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "AI 진입점");
    /* pill이 떠 있으면 pill 위로, 아니면 FAB 위로 */
    if (pillEl) {
      var r = pillEl.getBoundingClientRect();
      menu.style.bottom = Math.round(window.innerHeight - r.top + 8) + "px";
    }
    var html = '<div class="mhd">AI 진입점 — 모든 진입은 이 한 점으로</div>';
    for (var i = 0; i < items.length; i++) {
      html += '<button class="eze-mi" role="menuitem" data-eze-mi="' + i + '">' +
        '<span class="ic">' + esc(items[i].ic) + "</span>" + esc(items[i].label) + "</button>";
    }
    menu.innerHTML = html;
    document.body.appendChild(menu);
    menuActions = items;
    menuEl = menu;
    requestAnimationFrame(function () { menu.classList.add("eze-show"); });
  }

  /* ---------------- [요구 4] 역할 스위처 옆 근거 레벨 인디케이터 ---------------- */

  function injectEvidenceIndicator() {
    if (document.querySelector(".eze-ev")) return true;
    /* GNB 우측은 폭이 좁아 메뉴와 겹침 — 역할 관점 바(.txr-bar)의 범위 표기 옆에 부착 */
    var bar = document.querySelector(".txr-bar");
    var anchor = bar && bar.querySelector(".txr-scope");
    if (!anchor) return false;   /* 바가 아직 없으면 재시도 */
    var lv = (window.EZEvidencePolicy || {})[roleKey()] || "core";
    var chip = document.createElement("span");
    chip.className = "eze-ev";
    chip.title = "역할별 근거 노출 정책 — " + (EV_TITLES[lv] || EV_TITLES.core);
    chip.innerHTML = "근거 노출 <span class=\"lv\">" + esc(EV_LABELS[lv] || EV_LABELS.core) + "</span>";
    if (anchor.nextSibling) anchor.parentNode.insertBefore(chip, anchor.nextSibling);
    else anchor.parentNode.appendChild(chip);
    return true;
  }

  /* ---------------- 화면 전환 감지 (클릭 위임 + 디바운스) ---------------- */

  var debounceTimer = null;
  var lastKey = null;

  function scheduleCheck() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      debounceTimer = null;
      var key = currentScreenKey();
      if (!key) return;
      /* 같은 화면 재클릭이어도 wasShown이 이중 표시를 막는다 */
      lastKey = key;
      showPill(key, false);
    }, DEBOUNCE_MS);
  }

  function bindDelegation() {
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      /* --- pill 내부 --- */
      if (t.closest(".eze-pill [data-eze-close]")) { dismissPill(false); return; }
      if (t.closest(".eze-pill [data-eze-menu]")) { openMenu(); return; }
      if (t.closest(".eze-pill [data-eze-act]")) { acceptSuggestion(); return; }

      /* --- 미니 메뉴 --- */
      var mi = t.closest(".eze-menu [data-eze-mi]");
      if (mi) {
        var idx = parseInt(mi.getAttribute("data-eze-mi"), 10);
        var act = menuActions[idx];
        closeMenu();
        dismissPill(true);
        if (act) { try { act.run(); } catch (err) { /* 무해화 */ } }
        return;
      }
      if (menuEl && !t.closest(".eze-menu")) closeMenu();   /* 바깥 클릭 → 닫기 */

      /* --- FAB 클릭 = 대화 진입 → 선제 UI 정리 --- */
      if (t.closest(".ezx-fab")) { dismissPill(true); closeMenu(); return; }

      /* --- 화면/탭 전환 감지 --- */
      if (t.closest("#gnb [data-s]") || t.closest(".subnav a")) scheduleCheck();
    }, true);
  }

  /* ---------------- 부트스트랩 (늦게 뜨는 DOM 폴링 결선) ---------------- */

  function boot() {
    injectStyle();
    bindDelegation();

    var tries = 0;
    var fabSeen = false, evDone = false;
    var timer = setInterval(function () {
      tries += 1;
      if (!fabSeen && findFab()) {
        fabSeen = true;
        /* 초기 화면(보통 s-home) 제안 1회 */
        scheduleCheck();
      }
      if (!evDone) evDone = injectEvidenceIndicator();
      if ((fabSeen && evDone) || tries >= POLL_MAX) clearInterval(timer);
    }, POLL_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  /* ---------------- [요구 5] 공개 API ---------------- */

  window.EZEntry = {
    /* 화면 키("s-home"|"s-perf:0".."s-perf:3"|"s-appr"...)의 제안을 강제 표시.
       인자 생략 시 현재 화면 기준. 세션 1회 제한을 우회한다(데모용). */
    suggest: function (screenKey) {
      return showPill(screenKey || currentScreenKey(), true);
    },
    openMenu: openMenu
  };
})();
