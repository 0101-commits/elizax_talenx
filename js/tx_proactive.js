/* ============================================================================
 * tx_proactive.js — 선제(proactive) 알림 단일 코디네이터 + 알림 보관함(EZNotif)
 * ----------------------------------------------------------------------------
 * 문제: 화면 우하단 FAB 주변에 선제 팝업이 서로를 모르는 채 3곳에서 뜬다.
 *   - tx_agent.js   .agh-popup      선제 감지 카드(열어서 확인/나중에)  right:24 bottom:96
 *   - tx_entry.js   .eze-pill       화면 문맥 제안 pill                 right:24 bottom:94  ← agh-popup과 같은 자리, 겹침
 *   - tx_upgrade.js .ezup-ctxchip   FAB 왼쪽 컨텍스트 칩                right:88 bottom:32
 * eze-pill·ezup-ctxchip는 둘 다 GNB/탭 클릭에 반응하고, agh-popup은 로드 9초 타이머라
 * 조작·타이밍이 겹치면 두 팝업이 동시에 떠 겹쳐 보인다.
 *
 * 해결 1(단일 슬롯): 새 팝업이 뜰 때 앞선 팝업을 닫고(replace) 자기를 active로 등록.
 *       → 어느 순간에도 선제 팝업은 하나만 보인다.
 * 해결 2(보관함): "latest wins"로 밀려나거나 자동소멸한 알림도 다시 볼 수 있게,
 *       코디네이터를 거치는 모든 알림을 localStorage `ezx_notif_v1`에 보관한다.
 *       elizax 도킹 패널의 [알림] 탭(tx_elizax.js)이 이 보관함을 렌더한다.
 *
 * 계약: window.EZProactive.claim(id, dismissFn[, meta]) / release(id).
 *   claim: 다른 id가 active면 그 dismissFn을 호출해 닫고, 자기를 active로 교체.
 *          meta={text,kind,action}이 있으면 그대로 보관, 없으면(구 호출자
 *          tx_agent/tx_upgrade) 방금 붙은 DOM에서 문구를 스크랩해 보관.
 *   release: 자기가 active일 때만 슬롯 비움(dismissFn 안에서 호출해도 안전).
 * window.EZNotif = { add, list, unreadCount, markAllRead, run } — 전역 공개.
 *   항목: {id, ts, text, kind, action:{type:'ask'|'hub'|'screen',payload}, read}
 *   변경 시 document CustomEvent "ezx:notif" {detail:{reason:'add'|'read'}} 발행.
 *
 * ponytail: 단일 전역 슬롯 — 우선순위/큐 없음(가장 최근 것이 이긴다). 특정 알림을
 *           반드시 살려야 하면 claim에 우선도 인자를 추가하는 것이 업그레이드 경로.
 * ========================================================================== */
(function () {
  "use strict";
  if (window.EZProactive) return;

  /* ================= 알림 보관함 (EZNotif) ================= */
  var NKEY = "ezx_notif_v1";
  var NMAX = 50;

  function nload() {
    try {
      var a = JSON.parse(localStorage.getItem(NKEY) || "[]");
      return Object.prototype.toString.call(a) === "[object Array]" ? a : [];
    } catch (e) { return []; }
  }
  function nsave(a) {
    try { localStorage.setItem(NKEY, JSON.stringify(a.slice(-NMAX))); } catch (e) { /* storage 불가 환경 무시 */ }
  }
  function notify(reason) {
    try { document.dispatchEvent(new CustomEvent("ezx:notif", { detail: { reason: reason } })); } catch (e) { /* 무해화 */ }
  }
  function archive(text, kind, action) {
    text = String(text == null ? "" : text).replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
    if (!text) return null;
    var a = nload();
    /* 중복 억제 — 같은 문구가 미열람으로 남아 있거나 60초 내 재발화면 스킵 */
    for (var i = a.length - 1; i >= 0; i--) {
      if (a[i].text === text && (!a[i].read || Date.now() - (a[i].ts || 0) < 60000)) return a[i];
    }
    var e = {
      id: "ntf-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      ts: Date.now(), text: text, kind: kind || "알림",
      action: action || null, read: false
    };
    a.push(e);
    nsave(a);
    notify("add");
    return e;
  }
  /* 직렬화된 액션 실행 — {type:'ask'|'hub'|'screen', payload} */
  function runAction(act) {
    if (!act || !act.type) return;
    try {
      if (act.type === "ask") {
        if (window.Elizax) {
          if (Elizax.open) Elizax.open();
          if (act.payload && Elizax.sendRaw) Elizax.sendRaw(String(act.payload));
        }
      } else if (act.type === "hub") {
        if (window.TXAgent && TXAgent.openHub) TXAgent.openHub(act.payload);
      } else if (act.type === "screen") {
        if (window.EZNav && EZNav.go) EZNav.go(act.payload && act.payload.s, act.payload && act.payload.p);
      }
    } catch (e) { /* 무해화 */ }
  }

  window.EZNotif = {
    add: archive,                                            /* (text, kind, action) */
    list: function () { return nload().slice().reverse(); }, /* 최신순 */
    unreadCount: function () {
      var a = nload(), n = 0;
      for (var i = 0; i < a.length; i++) { if (!a[i].read) n++; }
      return n;
    },
    markAllRead: function () {
      var a = nload(), ch = false;
      for (var i = 0; i < a.length; i++) { if (!a[i].read) { a[i].read = true; ch = true; } }
      if (ch) { nsave(a); notify("read"); }
    },
    run: function (id) {
      var a = nload(), e = null;
      for (var i = 0; i < a.length; i++) { if (a[i].id === id) { e = a[i]; break; } }
      if (!e) return null;
      if (!e.read) { e.read = true; nsave(a); notify("read"); }
      runAction(e.action);
      return e;
    }
  };

  /* ================= 단일 슬롯 코디네이터 ================= */
  /* meta 없는 기존 호출자(tx_agent/tx_upgrade)는 방금 붙인 DOM에서 문구를 스크랩.
     ponytail: agh-popup의 대상 화면(a.screen)은 DOM에 없어 허브 기본 착지 —
     정밀 착지가 필요하면 tx_agent가 claim 3번째 인자로 meta를 넘기는 게 업그레이드 경로. */
  var SCRAPE = {
    "agh-popup": function () {
      var c = document.querySelector(".agh-popup");
      if (!c) return null;
      var b = c.querySelector("b"), p = c.querySelector("p");
      var t = (b ? b.textContent : "") + (p ? " — " + p.textContent : "");
      return { text: t, kind: "감지", action: { type: "hub" } };
    },
    "ezup-ctxchip": function () {
      var c = document.querySelector(".ezup-ctxchip");
      if (!c) return null;
      var ask = c._ask === "__brief__" ? "1:1 미팅 브리핑해줘" : c._ask;
      return { text: c.textContent, kind: "제안", action: ask ? { type: "ask", payload: ask } : null };
    }
  };

  var active = null; // { id, dismiss }
  window.EZProactive = {
    claim: function (id, dismiss, meta) {
      if (active && active.id !== id && typeof active.dismiss === "function") {
        try { active.dismiss(); } catch (e) { /* 무해화 */ }
      }
      active = { id: id, dismiss: (typeof dismiss === "function" ? dismiss : null) };
      /* 코디네이터 경유 알림은 전부 보관함에 축적 — 밀려나도 다시 볼 수 있다 */
      try {
        var m = (meta && meta.text) ? meta : (SCRAPE[id] ? SCRAPE[id]() : null);
        if (m && m.text) archive(m.text, m.kind, m.action);
      } catch (e) { /* 무해화 */ }
    },
    release: function (id) {
      if (active && active.id === id) active = null;
    }
  };
})();
