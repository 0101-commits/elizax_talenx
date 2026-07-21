/* ============================================================
   tx_chatstore.js — elizax 공유 대화 스토어 (window.EZChat)
   FAB 도킹 대화창(tx_elizax)과 전체화면 딥워크(tx_agent)가
   같은 대화를 읽고 쓰는 단일 원장. 계정별·세션별 영속화.

   저장 키: elizax_chat_v2:<emp_id>
     { currentId, sessions:[{ id, title, at, messages:[…] }] }
   메시지 직렬화 규칙(기존 tx_elizax saveHistory와 동일 계약):
     - work(진행중 카드)는 저장 제외
     - user/ai/err: {role,text,note}  nav: {role,target}  scn: {role,key}
     - 확장 모듈용 meta(JSON-safe object)·fb(피드백)는 함께 저장
   이벤트: on(evt, fn) — "messages"(내용 변경) · "sessions"(목록 변경)
           · "switch"(세션 전환). 다른 탭 변경은 storage 이벤트로 수신.
   ============================================================ */
(function () {
  "use strict";

  var DATA = window.TALENX_DATA || {};
  var CURRENT = (DATA.meta && DATA.meta.currentUser) || { emp_id: "anon" };
  var KEY = "elizax_chat_v2:" + (CURRENT.emp_id || "anon");
  var LEGACY_KEY = "elizax_hist_v1:" + (CURRENT.emp_id || "anon");
  var MAX_MSGS = 60;      /* 세션당 저장 상한 */
  var MAX_SESSIONS = 20;  /* 계정당 세션 상한 */

  /* ---------------- in-memory state ---------------- */
  var store = { currentId: null, sessions: [] };
  var listeners = {};      /* evt -> [fn] */

  function uid() {
    return "cs-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  }
  function nowStamp() {
    var t = new Date();
    function z(n) { return (n < 10 ? "0" : "") + n; }
    return (t.getMonth() + 1) + "/" + t.getDate() + " " + z(t.getHours()) + ":" + z(t.getMinutes());
  }

  /* ---------------- (de)serialization ---------------- */
  function serializeMsg(m) {
    if (!m || m.role === "work") return null;
    if (m.role === "nav" && m.target) {
      return { role: "nav", target: { s: m.target.s, p: m.target.p, label: m.target.label } };
    }
    if (m.role === "scn" && m.key) return { role: "scn", key: m.key };
    if ((m.role === "user" || m.role === "ai" || m.role === "err") && m.text) {
      var out = { role: m.role, text: m.text };
      if (m.note) out.note = m.note;
      if (m.fb) out.fb = m.fb;
      if (m.meta) { try { out.meta = JSON.parse(JSON.stringify(m.meta)); } catch (e) { /* skip */ } }
      return out;
    }
    return null;
  }
  function serializeSession(s) {
    var msgs = [];
    (s.messages || []).slice(-MAX_MSGS).forEach(function (m) {
      var sm = serializeMsg(m);
      if (sm) msgs.push(sm);
    });
    return { id: s.id, title: s.title || "", at: s.at || "", messages: msgs };
  }
  function persist() {
    try {
      var out = {
        currentId: store.currentId,
        sessions: store.sessions.slice(0, MAX_SESSIONS).map(serializeSession)
      };
      localStorage.setItem(KEY, JSON.stringify(out));
    } catch (e) { /* storage 불가 환경 무시 */ }
  }

  /* ---------------- load + legacy migration ---------------- */
  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { /* ignore */ }
    if (raw) {
      try {
        var j = JSON.parse(raw);
        if (j && Array.isArray(j.sessions)) {
          store.sessions = j.sessions.filter(function (s) { return s && s.id; });
          store.sessions.forEach(function (s) {
            s.messages = (Array.isArray(s.messages) ? s.messages : []).filter(function (m) { return m && m.role; });
            s.messages.forEach(function (m) { m.streaming = false; });
          });
          store.currentId = j.currentId;
        }
      } catch (e) { /* corrupt → 새로 시작 */ }
    } else {
      /* v1 단일 히스토리 마이그레이션 */
      try {
        var legacy = localStorage.getItem(LEGACY_KEY);
        if (legacy) {
          var arr = JSON.parse(legacy);
          if (Array.isArray(arr) && arr.length) {
            store.sessions = [{ id: uid(), title: "이전 대화", at: nowStamp(), messages: arr.filter(function (m) { return m && m.role; }) }];
            store.currentId = store.sessions[0].id;
            persist();
          }
          localStorage.removeItem(LEGACY_KEY);
        }
      } catch (e) { /* ignore */ }
    }
    ensureCurrent();
  }
  function ensureCurrent() {
    if (!store.sessions.length) {
      store.sessions.unshift({ id: uid(), title: "", at: nowStamp(), messages: [] });
      store.currentId = store.sessions[0].id;
    }
    if (!findSession(store.currentId)) store.currentId = store.sessions[0].id;
  }
  function findSession(id) {
    for (var i = 0; i < store.sessions.length; i++) if (store.sessions[i].id === id) return store.sessions[i];
    return null;
  }
  function current() { ensureCurrent(); return findSession(store.currentId); }

  /* 첫 user 발화로 자동 제목 */
  function autoTitle(s) {
    if (s.title) return;
    for (var i = 0; i < s.messages.length; i++) {
      var m = s.messages[i];
      if (m.role === "user" && m.text) {
        s.title = m.text.length > 24 ? m.text.slice(0, 24) + "…" : m.text;
        return;
      }
    }
  }

  /* ---------------- events ---------------- */
  function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); }
  function off(evt, fn) {
    var a = listeners[evt] || [];
    var i = a.indexOf(fn);
    if (i >= 0) a.splice(i, 1);
  }
  function emit(evt, data) {
    (listeners[evt] || []).slice().forEach(function (fn) {
      try { fn(data || {}); } catch (e) { console.error("[EZChat:" + evt + "]", e); }
    });
  }

  /* 다른 탭에서의 변경 수신 → 메모리 재적재 + 통지 */
  try {
    window.addEventListener("storage", function (e) {
      if (e.key !== KEY) return;
      load();
      emit("sessions", { external: true });
      emit("messages", { external: true });
    });
  } catch (e) { /* ignore */ }

  /* ---------------- public API ---------------- */
  window.EZChat = {
    /* --- 메시지 (현재 세션) --- */
    messages: function () { return current().messages; },
    push: function (m) {
      var s = current();
      s.messages.push(m);
      autoTitle(s);
      persist();
      emit("messages", { op: "push", msg: m });
      return m;
    },
    /* 스트리밍 종료 등 내용 변경 후 저장 + 통지 */
    save: function (opts) {
      autoTitle(current());
      persist();
      emit("messages", { op: (opts && opts.op) || "save" });
    },
    /* 조용한 저장 — 이벤트 없이 영속화만 (호출측이 이미 렌더한 경우) */
    persist: persist,
    setMessages: function (arr) {
      current().messages = Array.isArray(arr) ? arr : [];
      persist();
      emit("messages", { op: "set" });
    },
    removeMessage: function (m) {
      var arr = current().messages;
      var i = arr.indexOf(m);
      if (i >= 0) { arr.splice(i, 1); persist(); emit("messages", { op: "remove" }); return true; }
      return false;
    },
    clearCurrent: function () {
      var s = current();
      s.messages = [];
      s.title = "";
      persist();
      emit("messages", { op: "clear" });
    },

    /* --- 세션 --- */
    sessions: function () {
      return store.sessions.map(function (s) {
        return { id: s.id, title: s.title || "새 대화", at: s.at, count: s.messages.length, current: s.id === store.currentId };
      });
    },
    currentId: function () { return current().id; },
    currentTitle: function () { return current().title || "새 대화"; },
    newSession: function (title) {
      /* 빈 현재 세션이면 재사용 */
      var cur = current();
      if (!cur.messages.length && !cur.title) {
        if (title) { cur.title = title; persist(); emit("sessions", {}); }
        return cur.id;
      }
      var s = { id: uid(), title: title || "", at: nowStamp(), messages: [] };
      store.sessions.unshift(s);
      if (store.sessions.length > MAX_SESSIONS) store.sessions = store.sessions.slice(0, MAX_SESSIONS);
      store.currentId = s.id;
      persist();
      emit("sessions", {});
      emit("switch", { id: s.id });
      return s.id;
    },
    switchSession: function (id) {
      if (!findSession(id) || id === store.currentId) return false;
      store.currentId = id;
      persist();
      emit("switch", { id: id });
      return true;
    },
    renameSession: function (id, title) {
      var s = findSession(id);
      if (!s) return false;
      s.title = String(title || "").slice(0, 60);
      persist();
      emit("sessions", {});
      return true;
    },
    deleteSession: function (id) {
      var idx = -1;
      for (var i = 0; i < store.sessions.length; i++) if (store.sessions[i].id === id) { idx = i; break; }
      if (idx < 0) return false;
      var wasCurrent = store.sessions[idx].id === store.currentId;
      store.sessions.splice(idx, 1);
      ensureCurrent();
      persist();
      emit("sessions", {});
      if (wasCurrent) emit("switch", { id: store.currentId });
      return true;
    },

    /* --- 내보내기/검색용 원시 접근 --- */
    exportSession: function (id) {
      var s = id ? findSession(id) : current();
      return s ? serializeSession(s) : null;
    },
    exportAll: function () { return store.sessions.map(serializeSession); },

    /* --- 이벤트 --- */
    on: on,
    off: off,
    emit: emit
  };

  load();
})();
