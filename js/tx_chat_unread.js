/* ============================================================================
 * tx_chat_unread.js — 미확인 응답 감지 → EZNotif 통합 (elizax 채팅 확장 모듈)
 * ----------------------------------------------------------------------------
 * v2 재편(§5.2·§6): 자체 빨강 배지(#E5484D)·자체 카운트 폐지.
 * 감지(닫힘 중 응답 완료·선제 브리핑)만 담당하고, 잔존은 EZNotif 단일 스토어로:
 *   토스트/pill → FAB 카운트(EZNotif.unreadCount) → [알림] 탭 아카이브.
 * - 닫힘 판정: .ezx-root에 ezx-open 없음 AND .agh-root에 on 없음.
 * - 닫힘 중 (a) 스트리밍 완료 (b) 비스트리밍 ai push → EZNotif.push(kind:"chat")
 *   + FAB pulse. 이 모듈이 push한 id는 패널/허브 열림 시 일괄 읽음 처리.
 * - 문서 타이틀 "(N) " 프리픽스는 EZNotif.unreadCount() 구독으로 동기화.
 * - 선제 브리핑(로드 25초·세션당 1회·미조작 시)은 기존 유지 — EZChat.push가
 *   ai push 경로로 자연히 EZNotif에 적재된다.
 * ========================================================================== */
(function () {
  "use strict";

  /* ---------- 상태 ---------- */
  var streamingOn = false;  // 스트리밍 생성 중 (ai push 중복 집계 방지)
  var interacted = false;   // 패널/허브 열람 또는 사용자 발화 여부
  var briefedMem = false;   // localStorage 불가 환경용 메모리 플래그
  var baseTitle = null;     // 프리픽스 제거된 원래 문서 타이틀
  var fabEl = null;
  var rootObserved = false;
  var hubObserved = false;
  var myIds = [];           // 이 모듈이 push한 알림 id — 열람 시 읽음 처리

  function lsGet(k) {
    try { return window.localStorage.getItem(k); } catch (e) { return null; }
  }
  function lsSet(k, v) {
    try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; }
  }

  /* ---------- 스타일 (FAB pulse만 — 배지는 tx_elizax.js .ezx-cnt가 담당) ---------- */
  function injectStyle() {
    if (document.getElementById("ezcx-unread-style")) return;
    var st = document.createElement("style");
    st.id = "ezcx-unread-style";
    st.textContent = "" +
      "@keyframes ezcx-unread-pulse-kf{" +
      "0%{box-shadow:0 4px 20px var(--color-shadow),0 0 0 0 color-mix(in srgb, var(--color-accent) 45%, transparent);}" +
      "70%{box-shadow:0 4px 20px var(--color-shadow),0 0 0 14px transparent;}" +
      "100%{box-shadow:0 4px 20px var(--color-shadow),0 0 0 0 transparent;}}" +
      ".ezx-fab.ezcx-unread-pulse{animation:ezcx-unread-pulse-kf 1.2s ease-out 2;}" +
      "@media (prefers-reduced-motion:reduce){.ezx-fab.ezcx-unread-pulse{animation:none;}}";
    document.head.appendChild(st);
  }

  /* ---------- 열림/닫힘 판정 ---------- */
  function panelOpen() {
    var r = document.querySelector(".ezx-root");
    return !!(r && r.classList.contains("ezx-open"));
  }
  function hubOpen() {
    var h = document.querySelector(".agh-root");
    return !!(h && h.classList.contains("on"));
  }
  function isClosed() { return !panelOpen() && !hubOpen(); }

  /* ---------- 문서 타이틀 프리픽스 (미확인 알림 수 연동) ---------- */
  function syncTitle() {
    if (baseTitle === null) baseTitle = document.title.replace(/^\(\d+\)\s/, "");
    var n = window.EZNotif ? EZNotif.unreadCount() : 0;
    document.title = (n > 0 ? "(" + n + ") " : "") + baseTitle;
  }

  /* ---------- FAB pulse ---------- */
  function findFab() {
    if (!fabEl || !document.body.contains(fabEl)) {
      fabEl = document.querySelector(".ezx-fab");
    }
    return fabEl;
  }
  function pulseFab() {
    var fab = findFab();
    if (!fab) return;
    fab.classList.remove("ezcx-unread-pulse");
    void fab.offsetWidth;
    fab.classList.add("ezcx-unread-pulse");
  }
  function onPulseEnd(e) {
    if (e && e.animationName === "ezcx-unread-pulse-kf" && e.target) {
      e.target.classList.remove("ezcx-unread-pulse");
    }
  }

  /* ---------- 감지 → EZNotif 적재 ---------- */
  function bump(title, body) {
    if (!isClosed()) return;           // 열람 중 = 읽는 중, 집계 안 함
    if (!window.EZNotif) return;
    var n = EZNotif.push({ kind: "chat", title: title || "elizax 응답 도착", body: body || "" });
    if (n) myIds.push(n.id);
    pulseFab();
  }
  function resetUnread() {
    interacted = true;
    if (!window.EZNotif || !myIds.length) return;
    var ids = myIds.slice();
    myIds = [];
    ids.forEach(function (id) { EZNotif.markRead(id); });
  }

  /* ---------- EZChat 이벤트 구독 ---------- */
  function bindChat() {
    if (!window.EZChat || typeof window.EZChat.on !== "function") return;

    window.EZChat.on("streaming", function (d) {
      var on = !!(d && d.on);
      if (on) { streamingOn = true; return; }
      if (streamingOn) {
        streamingOn = false;
        bump();
      }
    });

    window.EZChat.on("messages", function (d) {
      if (!d || d.op !== "push" || !d.msg) return;
      if (d.msg.role === "user") { interacted = true; return; }
      if (d.msg.role !== "ai") return;
      if (streamingOn) return; // 스트리밍 중 push는 streaming(off)에서 집계
      bump();
    });
  }

  /* ---------- 열림 감시 ---------- */
  function bindOpenWatchers() {
    document.addEventListener("click", function (e) {
      var t = e.target;
      while (t && t !== document) {
        if (t.classList && t.classList.contains("ezx-fab")) { resetUnread(); return; }
        t = t.parentNode;
      }
    }, true);
    document.addEventListener("animationend", onPulseEnd, true);
  }

  function observeClass(el, checkFn) {
    if (!window.MutationObserver) return;
    var mo = new MutationObserver(function () { checkFn(); });
    mo.observe(el, { attributes: true, attributeFilter: ["class"] });
  }

  function pollRoots() {
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      var root = document.querySelector(".ezx-root");
      if (root && !rootObserved) {
        rootObserved = true;
        observeClass(root, function () {
          if (root.classList.contains("ezx-open")) resetUnread();
        });
      }
      var hub = document.querySelector(".agh-root");
      if (hub && !hubObserved) {
        hubObserved = true;
        observeClass(hub, function () {
          if (hub.classList.contains("on")) resetUnread();
        });
      }
      if ((rootObserved && hubObserved) || tries >= 20) clearInterval(timer);
    }, 300);
  }

  /* ---------- 선제 브리핑 (로드 25초 후 1회) ---------- */
  var BRIEF_TEXTS = {
    leader: "팀 체크인 지연 3명을 감지했습니다. '주간 체크인 브리핑 만들어줘'라고 요청하면 초안까지 준비합니다.",
    member: "이번 주 체크인 마감이 다가옵니다. '이번 주 체크인 초안 잡아줘'라고 요청하면 초안까지 준비합니다.",
    hr: "등급 조정 사전 점검 이슈 2건을 감지했습니다. '등급 조정 점검 브리핑 만들어줘'라고 요청하면 초안까지 준비합니다.",
    exec: "조직 성과 신호에 변화가 감지되었습니다. '경영 브리핑 요약 만들어줘'라고 요청하면 초안까지 준비합니다."
  };

  function briefFlagKey() {
    var sid = "default";
    try {
      if (window.EZChat && typeof window.EZChat.currentId === "function") {
        sid = String(window.EZChat.currentId() || "default");
      }
    } catch (e) { /* 무해화 */ }
    return "ezcx.unread.briefed." + sid;
  }
  function alreadyBriefed() {
    if (briefedMem) return true;
    return lsGet(briefFlagKey()) === "1";
  }
  function markBriefed() {
    briefedMem = true;
    lsSet(briefFlagKey(), "1");
  }

  function scheduleProactiveBrief() {
    setTimeout(function () {
      if (!window.EZChat || typeof window.EZChat.push !== "function") return;
      if (!isClosed()) return;
      if (interacted) return;
      if (alreadyBriefed()) return;

      var roleKey = "member";
      try {
        if (window.TXRoles && typeof window.TXRoles.current === "function") {
          var r = window.TXRoles.current();
          if (r && r.key) roleKey = r.key;
        }
      } catch (e) { /* 역할 조회 실패 시 기본 톤 */ }

      var text = BRIEF_TEXTS[roleKey] || BRIEF_TEXTS.member;
      markBriefed();
      window.EZChat.push({
        role: "ai",
        text: "✦ (선제 브리핑) " + text,
        meta: { ezcxProactive: true }
      });
      // EZNotif 적재는 "messages" push 핸들러(bump)가 자동 처리
    }, 25000);
  }

  /* ---------- 부트스트랩 ---------- */
  function boot() {
    injectStyle();
    bindChat();
    bindOpenWatchers();
    pollRoots();
    scheduleProactiveBrief();
    if (window.EZNotif && EZNotif.onChange) EZNotif.onChange(syncTitle);
    syncTitle();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
