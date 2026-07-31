/* ============================================================================
 * tx_chat_unread.js — 미확인 응답 감지 → EZNotif 통합 (elizax 채팅 확장 모듈)
 * ----------------------------------------------------------------------------
 * v2 재편(§5.2·§6): 자체 빨강 배지(#E5484D)·자체 카운트 폐지.
 * 감지(닫힘 중 응답 완료)만 담당하고, 잔존은 EZNotif 단일 스토어로:
 *   토스트/pill → FAB 카운트(EZNotif.unreadCount) → [알림] 탭 아카이브.
 * - 닫힘 판정: .ezx-root에 ezx-open 없음 AND .agh-root에 on 없음.
 * - 닫힘 중 (a) 스트리밍 완료 (b) 비스트리밍 ai push → EZNotif.push(kind:"chat")
 *   + FAB pulse. 이 모듈이 push한 id는 패널/허브 열림 시 일괄 읽음 처리.
 * - 문서 타이틀 "(N) " 프리픽스는 EZNotif.unreadCount() 구독으로 동기화(>9는 "9+"
 *   로 클램프 — FAB 배지와 같은 표기).
 * - 18차: 로드 25초 후 채팅에 밀어 넣던 브리핑 메시지 제거. 알림은 신호 알림
 *   카드(EZSignalCard) 하나로만 뜬다 — 대화창을 읽지 않은 말로 채우지 않는다.
 * ========================================================================== */
(function () {
  "use strict";

  /* ---------- 상태 ---------- */
  var streamingOn = false;  // 스트리밍 생성 중 (ai push 중복 집계 방지)
  var interacted = false;   // 패널/허브 열람 또는 사용자 발화 여부
  var baseTitle = null;     // 프리픽스 제거된 원래 문서 타이틀
  var fabEl = null;
  var rootObserved = false;
  var hubObserved = false;
  var myIds = [];           // 이 모듈이 push한 알림 id — 열람 시 읽음 처리

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
    if (baseTitle === null) baseTitle = document.title.replace(/^\((?:\d+|9\+)\)\s/, "");
    var n = window.EZNotif ? EZNotif.unreadCount() : 0;
    /* 배지와 같은 클램프 — 두 자리 숫자가 타이틀에서만 불어나 보이던 불일치 해소 */
    document.title = (n > 0 ? "(" + (n > 9 ? "9+" : n) + ") " : "") + baseTitle;
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

  /* 18차: 로드 25초 후 채팅에 브리핑 메시지를 밀어 넣던 타이머 제거.
     알림 표면은 신호 알림 카드 하나 — 여기서는 감지·배지 배선만 담당한다. */

  /* ---------- 부트스트랩 ---------- */
  function boot() {
    injectStyle();
    bindChat();
    bindOpenWatchers();
    pollRoots();
    if (window.EZNotif && EZNotif.onChange) EZNotif.onChange(syncTitle);
    syncTitle();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
