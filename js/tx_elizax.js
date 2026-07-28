/* ============================================================
   elizax — floating AI performance-coach overlay for talenx mockup
   Single IIFE. Exposes window.Elizax = { open, close, send }.
   Does NOT modify existing screens; renders its own overlay only.
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- API base resolution ---------------- */
  function resolveApiBase() {
    if (typeof window.ELIZAX_API_BASE === "string") return window.ELIZAX_API_BASE;
    var loc = window.location || {};
    var isFile = loc.protocol === "file:";
    var notServedPort = loc.port !== "8080";
    if (isFile || notServedPort) return "http://localhost:8080";
    return ""; // same-origin → '/api/...'
  }
  var API_BASE = resolveApiBase();
  /* offline = no local backend reachable (file:// or not served on :8080).
     In that case we synthesize a mockup answer-receipt instead of failing. */
  var OFFLINE = (function () {
    if (typeof window.ELIZAX_FORCE_OFFLINE === "boolean") return window.ELIZAX_FORCE_OFFLINE;
    if (typeof window.ELIZAX_API_BASE === "string" && window.ELIZAX_API_BASE) return false;
    var loc = window.location || {};
    return loc.protocol === "file:" || loc.port !== "8080";
  })();

  /* ---------------- Data access ---------------- */
  var DATA = window.TALENX_DATA || {};
  var META = DATA.meta || {};
  var CURRENT = META.currentUser || { emp_id: "EMP-0078", name: "사용자", jobTitle: "", orgName: "", managerName: "", level_kr: "" };
  var EMPLOYEES = Array.isArray(DATA.employees) ? DATA.employees : [];

  /* screen id → friendly Korean label */
  var SCREEN_LABELS = {
    "s-home": "홈",
    "s-perf": "성과관리",
    "s-appr": "평가관리",
    "s-msf": "360진단",
    "s-work": "업무관리",
    "s-att": "근무관리",
    "s-hrm": "인사관리",
    "s-pay": "급여관리",
    "s-wf": "승인결재"
  };
  function activeScreenLabel() {
    var sec = document.querySelector("section.screen.on");
    if (!sec) return "홈";
    var base = SCREEN_LABELS[sec.id] || "홈";
    /* 서브탭까지 포함해 맥락 정밀화 (예: "성과관리 › 목표") */
    try {
      var tab = sec.querySelector(".subnav a.on");
      if (tab && tab.textContent.trim()) base += " › " + tab.textContent.trim();
    } catch (e) { /* ignore */ }
    return base;
  }

  /* 현재 AI 연결 모드: proxy | direct | offline (EZAI 없으면 구식 판정) */
  function aiMode() {
    if (window.EZAI && window.EZAI.mode) { try { return window.EZAI.mode(); } catch (e) { /* ignore */ } }
    return OFFLINE ? "offline" : "proxy";
  }

  var PERSPECTIVES = [
    { key: "subject", label: "본인" },
    { key: "manager", label: "팀장" },
    { key: "hr", label: "HR" },
    { key: "executive", label: "경영진" }
  ];
  function needsSubject(p) { return p === "manager" || p === "executive"; }
  function perspectiveLabel(key) {
    for (var i = 0; i < PERSPECTIVES.length; i++) { if (PERSPECTIVES[i].key === key) return PERSPECTIVES[i].label; }
    return "본인";
  }
  /* elizax 관점은 현재 역할(TXRoles)을 따라간다: 조직원→본인 · 조직장→팀장 · HR→HR · 경영진→경영진 */
  function rolePerspective() {
    try {
      var r = window.TXRoles && window.TXRoles.current && window.TXRoles.current();
      if (r && r.persp) {
        for (var i = 0; i < PERSPECTIVES.length; i++) { if (PERSPECTIVES[i].key === r.persp) return r.persp; }
      }
    } catch (e) { /* ignore */ }
    return "subject";
  }
  /* 조직장/경영진 관점은 대상 직원이 필요 → 역할에 맞는 기본 대상 자동 선택(직속 부하 우선). */
  function defaultSubject() {
    if (!needsSubject(rolePerspective())) return null;
    var reports = EMPLOYEES.filter(function (e) { return e.manager_id === CURRENT.emp_id; });
    var pick = reports[0] ||
      EMPLOYEES.filter(function (e) { return e.org_id === CURRENT.org_id && e.emp_id !== CURRENT.emp_id; })[0];
    return pick ? { emp_id: pick.emp_id, name: pick.name, jobTitle: pick.jobTitle } : null;
  }

  /* ---------------- State ---------------- */
  var state = {
    open: false,
    perspective: rolePerspective(),
    subject: defaultSubject(),   // {emp_id,name,jobTitle} chosen for manager/executive
    attachContext: true,
    streaming: false,
    surface: null         // 외부 마운트 대상(전체화면 허브 등) — null이면 FAB 리스트
  };

  /* 메시지 원장은 공유 스토어(EZChat) — FAB·전체화면이 같은 대화를 본다.
     스토어 부재(스크립트 로드 실패) 시에만 로컬 배열 폴백. */
  var _localMsgs = [];
  function msgs() { return window.EZChat ? EZChat.messages() : _localMsgs; }

  /* ---------------- DOM refs ---------------- */
  var el = {};
  var curTab = "chat";

  /* ---------------- EZNotif — 알림 단일 스토어 (§6 잔존형 알림: 토스트→FAB 카운트→[알림] 탭) ---------------- */
  var EZNotif = (function () {
    var KEY = "ezk_notif_v1", MAX = 50, subs = [];
    function load() {
      try { var a = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(a) ? a : []; }
      catch (e) { return []; }
    }
    function save(arr) {
      try { localStorage.setItem(KEY, JSON.stringify(arr.slice(-MAX))); } catch (e) { /* storage 불가 무시 */ }
    }
    function emit() { subs.forEach(function (cb) { try { cb(); } catch (e) { /* ignore */ } }); }
    function stamp() {
      var t = new Date();
      function z(n) { return (n < 10 ? "0" : "") + n; }
      return (t.getMonth() + 1) + "/" + t.getDate() + " " + z(t.getHours()) + ":" + z(t.getMinutes());
    }
    return {
      push: function (n) {
        if (!n || !n.title) return null;
        var arr = load();
        var item = {
          id: n.id || ("ntf-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
          title: String(n.title), body: n.body ? String(n.body) : "",
          action: n.action ? String(n.action) : null,
          kind: n.kind || "info", read: false, at: stamp(), ts: Date.now()
        };
        arr.push(item); save(arr); emit(); return item;
      },
      list: function () { return load().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); }); },
      markRead: function (id) {
        var arr = load(), hit = false;
        arr.forEach(function (n) { if (n.id === id && !n.read) { n.read = true; hit = true; } });
        if (hit) { save(arr); emit(); }
      },
      markAllRead: function () {
        var arr = load(), hit = false;
        arr.forEach(function (n) { if (!n.read) { n.read = true; hit = true; } });
        if (hit) { save(arr); emit(); }
      },
      unreadCount: function () { return load().filter(function (n) { return !n.read; }).length; },
      onChange: function (cb) { if (typeof cb === "function") subs.push(cb); }
    };
  })();
  window.EZNotif = EZNotif;

  /* ---------------- Helpers ---------------- */
  function h(tag, cls, attrs) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) for (var k in attrs) { if (k === "text") n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]); }
    return n;
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* Light markdown → HTML (headings, bold, code, bullets, tables). Input escaped first. */
  function mdToHtml(src) {
    var lines = String(src).split(/\r?\n/);
    var out = [], i = 0;
    function inline(t) {
      t = esc(t);
      t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
      t = t.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
      return t;
    }
    while (i < lines.length) {
      var line = lines[i];
      // table: header row followed by separator row of ---|---
      if (/\|/.test(line) && i + 1 < lines.length && /^[\s:|-]+$/.test(lines[i + 1]) && /-/.test(lines[i + 1])) {
        var head = line.split("|").map(function (c) { return c.trim(); }).filter(function (c, idx, a) { return !(idx === 0 && c === "") && !(idx === a.length - 1 && c === ""); });
        i += 2;
        var rows = [];
        while (i < lines.length && /\|/.test(lines[i])) {
          rows.push(lines[i].split("|").map(function (c) { return c.trim(); }).filter(function (c, idx, a) { return !(idx === 0 && c === "") && !(idx === a.length - 1 && c === ""); }));
          i++;
        }
        var t = "<table><thead><tr>" + head.map(function (c) { return "<th>" + inline(c) + "</th>"; }).join("") + "</tr></thead><tbody>";
        t += rows.map(function (r) { return "<tr>" + r.map(function (c) { return "<td>" + inline(c) + "</td>"; }).join("") + "</tr>"; }).join("");
        t += "</tbody></table>";
        out.push(t);
        continue;
      }
      var hm = line.match(/^\s*#{1,4}\s+(.*)$/);
      if (hm) { out.push("<h3>" + inline(hm[1]) + "</h3>"); i++; continue; }
      if (/^\s*[-*]\s+/.test(line)) {
        var items = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          items.push("<li>" + inline(lines[i].replace(/^\s*[-*]\s+/, "")) + "</li>");
          i++;
        }
        out.push("<ul>" + items.join("") + "</ul>");
        continue;
      }
      if (line.trim() === "") { i++; continue; }
      // gather paragraph
      var para = [line];
      i++;
      while (i < lines.length && lines[i].trim() !== "" && !/^\s*#{1,4}\s+/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i]) && !/\|/.test(lines[i])) {
        para.push(lines[i]); i++;
      }
      out.push("<p>" + para.map(inline).join("<br>") + "</p>");
    }
    return out.join("");
  }

  /* ---------------- Build UI ---------------- */
  function build() {
    var root = h("div", "ezx-root");
    root.setAttribute("data-theme-host", "1");

    /* FAB */
    var fab = h("button", "ezx-fab", { "aria-label": "elizax 열기", "title": "elizax" });
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2l1.9 5.1L19 9l-5.1 1.9L12 16l-1.9-5.1L5 9l5.1-1.9L12 2z" fill="currentColor"/><circle cx="18.5" cy="16.5" r="2" fill="currentColor" opacity=".85"/></svg>';
    /* FAB 카운트 = 미확인 알림 수 전용 (0이면 숨김) — §5.2 */
    var cnt = h("span", "ezx-cnt");
    cnt.hidden = true;
    fab.appendChild(cnt);
    el.cnt = cnt;
    fab.addEventListener("click", openPanel);

    /* Panel */
    var panel = h("div", "ezx-panel", { role: "dialog", "aria-label": "elizax", "aria-modal": "false" });

    /* Header */
    var head = h("div", "ezx-head");
    var top = h("div", "ezx-head-top");
    var mark = h("div", "ezx-mark");
    mark.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2l1.9 5.1L19 9l-5.1 1.9L12 16l-1.9-5.1L5 9l5.1-1.9L12 2z" fill="currentColor"/></svg>';
    var titles = h("div", "ezx-titles");
    titles.appendChild(h("div", "ezx-title", { text: "elizax" }));
    el.sub = null;   // 서브타이틀(‘AI 성과관리 코치’ 라벨 · ● Claude 모델칩) 제거 — Siri식 최소 헤더
    var exbtn = h("button", "ezx-x ezx-expand", { "aria-label": "전체화면으로 전환", title: "워크스페이스로 전환", text: "⛶" });
    exbtn.addEventListener("click", function () {
      /* 전체화면 전환 시 같은 대화가 이어지도록 대화 스크린으로 진입 */
      if (window.TXAgent && window.TXAgent.openHub) { closePanel(); window.TXAgent.openHub("chat"); }
    });
    var gear = h("button", "ezx-x", { "aria-label": "AI 연결 설정", title: "AI 연결 설정", text: "⚙" });
    gear.addEventListener("click", function () {
      if (window.EZAI && window.EZAI.openSettings) window.EZAI.openSettings(function () { updateStatus(); renderMessages(); });
    });
    var xbtn = h("button", "ezx-x", { "aria-label": "닫기", text: "✕" });
    xbtn.addEventListener("click", closePanel);
    top.appendChild(mark); top.appendChild(titles); top.appendChild(gear); top.appendChild(exbtn); top.appendChild(xbtn);
    head.appendChild(top);

    /* 3탭 IA — 대화 / 기록 / 알림 (§5) */
    var tabs = h("div", "ezx-tabs");
    el.tabBtns = {};
    [["chat", "대화"], ["rec", "기록"], ["ntf", "알림"]].forEach(function (d) {
      var b = h("button", "ezx-tab" + (d[0] === "chat" ? " on" : ""), { type: "button", "data-tab": d[0] });
      b.innerHTML = "<span>" + d[1] + "</span><span class=\"ezx-tab-dot\" hidden></span>"
        + (d[0] === "ntf" ? "<span class=\"ezx-tab-n\" hidden></span>" : "");
      b.addEventListener("click", function () { setTab(d[0]); });
      el.tabBtns[d[0]] = b;
      tabs.appendChild(b);
    });

    /* perspective 스트립 제거 — 관점 자동전환 로직(setPerspective)은 유지, 시각 chrome만 삭제 */
    el.persp = null;

    /* employee picker — [Phase1 IA] leader/hr/exec 역할에만 렌더 (member는 대상 선택 없음) */
    el.pickerInput = null; el.pickerList = null;
    var rk0 = "member";
    try {
      rk0 = (window.CU && CU._role) ||
        (window.TXRoles && TXRoles.current && (TXRoles.current() || {}).key) || "member";
    } catch (e) { rk0 = "member"; }
    if (rk0 === "leader" || rk0 === "hr" || rk0 === "exec") {
      var picker = h("div", "ezx-picker");
      var pin = h("input", "ezx-picker-in", { type: "text", placeholder: "대상 직원 검색 (이름)", "aria-label": "대상 직원 검색" });
      var plist = h("div", "ezx-picker-list");
      pin.addEventListener("input", function () { renderPickerList(pin.value); });
      pin.addEventListener("focus", function () { renderPickerList(pin.value); });
      document.addEventListener("click", function (e) {
        if (!picker.contains(e.target)) plist.classList.remove("on");
      });
      picker.appendChild(pin); picker.appendChild(plist);
      head.appendChild(picker);
      el.pickerInput = pin; el.pickerList = plist;
    }

    /* context chip row */
    var ctx = h("div", "ezx-ctx");
    var userChip = h("span", "ezx-chip");
    userChip.innerHTML = "<b>" + esc(CURRENT.name) + "</b>·" + esc(CURRENT.jobTitle || "");
    var screenChip = h("span", "ezx-chip ezx-chip-screen");
    var ctxToggle = h("button", "ezx-ctx-toggle on", { "aria-pressed": "true", title: "현재 화면 맥락을 메시지에 첨부" });
    ctxToggle.innerHTML = '<span class="ezx-switch"></span><span>현재 화면 맥락</span>';
    ctxToggle.addEventListener("click", function () {
      state.attachContext = !state.attachContext;
      ctxToggle.classList.toggle("on", state.attachContext);
      ctxToggle.setAttribute("aria-pressed", state.attachContext ? "true" : "false");
    });
    ctx.appendChild(userChip); ctx.appendChild(screenChip); ctx.appendChild(ctxToggle);
    el.screenChip = screenChip;

    /* message list */
    var list = h("div", "ezx-list", { role: "log", "aria-live": "polite" });
    el.list = list;

    /* [기록]·[알림] 패인 — 기존 앵커(.ezx-ctx/.ezx-list/.ezx-foot)는 유지, 탭 모드 클래스로만 전환 */
    var recPane = h("div", "ezx-pane ezx-rec-pane");
    var ntfPane = h("div", "ezx-pane ezx-ntf-pane");
    el.recPane = recPane; el.ntfPane = ntfPane;

    /* footer / composer */
    var foot = h("div", "ezx-foot");
    /* 연결 상태 배너 (죽은 updateAiBadge 대체 — proxy/direct/offline 3모드) */
    var status = h("div", "ezx-status");
    el.status = status;
    foot.appendChild(status);
    var comp = h("div", "ezx-composer");
    var ta = h("textarea", "ezx-ta", { rows: "1", placeholder: "메시지를 입력하세요…", "aria-label": "메시지 입력" });
    ta.addEventListener("input", autoGrow);
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
    });
    var send = h("button", "ezx-send", { "aria-label": "전송" });
    send.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12l16-8-6 8 6 8-16-8z" fill="currentColor"/></svg>';
    send.addEventListener("click", submit);
    comp.appendChild(ta); comp.appendChild(send);
    var footRow = h("div", "ezx-foot-row");
    var reset = h("button", "ezx-reset", { text: "대화 초기화" });
    reset.addEventListener("click", resetConversation);
    var hint = h("span", "ezx-hint", { text: "Enter 전송 · Shift+Enter 줄바꿈" });
    footRow.appendChild(reset); footRow.appendChild(hint);
    foot.appendChild(comp); foot.appendChild(footRow);
    el.textarea = ta; el.send = send;

    /* 탭 스트립·패인은 위(el.tabBtns / el.recPane / el.ntfPane)에서 이미 구성됨 —
       구 data-ezx-tab 스트립·.ezx-tabpane 이중 생성은 제거(astryx 리스킨 CSS가 .ezx-mode-* 단일 방식) */
    el.tabs = tabs;

    panel.appendChild(head);
    panel.appendChild(tabs);
    panel.appendChild(ctx);
    panel.appendChild(list);
    panel.appendChild(recPane);
    panel.appendChild(ntfPane);
    panel.appendChild(foot);

    root.appendChild(fab);
    root.appendChild(panel);
    document.body.appendChild(root);
    el.root = root; el.fab = fab; el.panel = panel;

    // Esc closes
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && state.open) closePanel();
    });

    /* 화면 이동(GNB·서브탭·로고) 시 화면칩 실시간 갱신 — 패널 열림 여부 무관 */
    document.addEventListener("click", function (e) {
      if (e.target.closest("#gnb [data-s], .subnav a[data-p], .logo")) {
        setTimeout(updateScreenChip, 140);
      }
    }, true);

    syncSubjectUI();
    renderMessages();       /* 지난 대화는 EZChat 스토어가 이미 복원 */
    /* 스토어 이벤트 구독 — 외부(허브·기능 모듈·타 탭) 변경도 즉시 반영 */
    if (window.EZChat) {
      EZChat.on("messages", function () { renderMessages(); });
      EZChat.on("switch", function () {
        if (state.streaming) stopStreaming();
        renderMessages();
      });
    }
    /* 백엔드 probe는 비동기 — 완료 후 연결 상태 표기를 실제 모드로 갱신 */
    if (window.EZAI && window.EZAI.probe) {
      window.EZAI.probe(function () {
        updateStatus();
        if (!msgs().length) renderMessages();
      });
    }

    /* 알림 스토어 → FAB 카운트·[알림] 탭 카운트 실시간 반영
       (구 ezx:notif document 이벤트 구독은 EZNotif.onChange 구독으로 일원화) */
    EZNotif.onChange(function () {
      updateFabCount();
      if (curTab === "ntf") renderNtf();
    });
    updateFabCount();
    updateStatus();
    /* 성과 기록 변경 → [기록] 탭 도트 또는 즉시 재렌더 */
    document.addEventListener("ezl:changed", function () {
      if (curTab === "rec" && window.EZLedger && EZLedger.renderRows) EZLedger.renderRows(el.recPane);
      else toggleTabDot("rec", true);
    });
  }

  /* ---------------- 3탭 전환 ---------------- */
  /* hl = 성과 기록 하이라이트 대상 entry id (외부 Elizax.showTab("rec", id) 진입용) */
  function setTab(k, hl) {
    if (k !== "chat" && k !== "rec" && k !== "ntf") k = "chat";
    curTab = k;
    el.root.classList.toggle("ezx-mode-rec", k === "rec");
    el.root.classList.toggle("ezx-mode-ntf", k === "ntf");
    for (var t in el.tabBtns) el.tabBtns[t].classList.toggle("on", t === k);
    if (k === "rec") {
      toggleTabDot("rec", false);
      /* 하이라이트가 필요하면 renderInto(=성과 기록 임베드 렌더), 아니면 renderRows */
      if (window.EZLedger && hl && EZLedger.renderInto) EZLedger.renderInto(el.recPane, hl);
      else if (window.EZLedger && EZLedger.renderRows) EZLedger.renderRows(el.recPane);
      else el.recPane.innerHTML = '<div class="ezx-pane-empty">성과 기록 모듈이 아직 로드되지 않았습니다.</div>';
    }
    if (k === "ntf") {
      renderNtf();
      EZNotif.markAllRead();
    }
  }
  function toggleTabDot(k, on) {
    var d = el.tabBtns && el.tabBtns[k] && el.tabBtns[k].querySelector(".ezx-tab-dot");
    if (d) d.hidden = !on;
  }
  function updateFabCount() {
    var n = EZNotif.unreadCount();
    if (el.cnt) { el.cnt.hidden = n === 0; el.cnt.textContent = n > 9 ? "9+" : String(n); }
    var tn = el.tabBtns && el.tabBtns.ntf && el.tabBtns.ntf.querySelector(".ezx-tab-n");
    if (tn) { tn.hidden = n === 0; tn.textContent = String(n); }
  }
  function renderNtf() {
    var p = el.ntfPane;
    if (!p) return;
    var arr = EZNotif.list();
    if (!arr.length) {
      p.innerHTML = '<div class="ezx-pane-empty">알림이 아직 없습니다.<br>제안·감지·응답 도착이 여기에 남아 다시 실행할 수 있습니다.</div>';
      return;
    }
    p.innerHTML = "";
    arr.forEach(function (n) {
      var row = h("div", "ezx-ntf-row" + (n.read ? "" : " unread"));
      row.innerHTML = '<span class="dot"></span><div class="bd"><div class="tt">' + esc(n.title) + "</div>"
        + (n.body ? '<div class="bs">' + esc(n.body) + "</div>" : "")
        + '<div class="ba">' + esc(n.at || "") + "</div></div>";
      if (n.action) {
        var act = h("button", "ezx-ntf-act", { type: "button", text: "다시 실행" });
        act.addEventListener("click", function (ev) {
          ev.stopPropagation();
          EZNotif.markRead(n.id);
          setTab("chat");
          sendMessage(String(n.action));
        });
        row.appendChild(act);
      }
      row.addEventListener("click", function () { EZNotif.markRead(n.id); });
      p.appendChild(row);
    });
  }

  function autoGrow() {
    var ta = el.textarea;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }

  /* ---------------- Perspective / subject ---------------- */
  /* 관점은 역할 주체(TXRoles)에서만 결정된다 — 수동 전환 없음 */
  function setPerspective(p) {
    state.perspective = p;
    var lab = el.persp && el.persp.querySelector("[data-ezx-plabel]");
    if (lab) lab.textContent = perspectiveLabel(p);
    syncSubjectUI();
  }
  function syncPerspectiveFromRole() {
    var p = rolePerspective();
    if (p !== state.perspective) {
      state.perspective = p;
      if (!state.subject) state.subject = defaultSubject();
    }
    var lab = el.persp && el.persp.querySelector("[data-ezx-plabel]");
    if (lab) lab.textContent = perspectiveLabel(p);
    syncSubjectUI();
  }
  function syncSubjectUI() {
    var need = needsSubject(state.perspective);
    el.root.classList.toggle("ezx-need-subject", need);
    if (need && !state.subject && el.pickerInput) {
      el.pickerInput.placeholder = "대상 직원 검색 (이름)";
    }
    if (need && state.subject && el.pickerInput && !el.pickerInput.value) {
      el.pickerInput.value = state.subject.name;   // 자동 선택된 기본 대상 표시
    }
    updateScreenChip();
  }
  function renderPickerList(q) {
    var list = el.pickerList;
    if (!list) return;   /* member 역할 — picker 미렌더 */
    list.innerHTML = "";
    var query = (q || "").trim();
    var pool = EMPLOYEES;
    if (query) pool = pool.filter(function (e) { return (e.name || "").indexOf(query) >= 0 || (e.emp_id || "").indexOf(query) >= 0; });
    pool = pool.slice(0, 30);
    if (!pool.length) { list.classList.remove("on"); return; }
    pool.forEach(function (emp) {
      var b = h("button", "", { type: "button" });
      b.innerHTML = esc(emp.name) + "<small>" + esc(emp.jobTitle || "") + " · " + esc(emp.orgName || "") + "</small>";
      b.addEventListener("click", function () {
        state.subject = { emp_id: emp.emp_id, name: emp.name, jobTitle: emp.jobTitle };
        el.pickerInput.value = emp.name;
        list.classList.remove("on");
        updateScreenChip();
      });
      list.appendChild(b);
    });
    list.classList.add("on");
  }

  function updateScreenChip() {
    var label = activeScreenLabel();
    var txt = "현재 화면 " + label;
    if (needsSubject(state.perspective) && state.subject) {
      txt = "대상 " + state.subject.name + " · " + label;
    }
    el.screenChip.textContent = txt;
  }

  /* who is the subject emp_id + actor */
  function resolveEmpIds() {
    var p = state.perspective;
    if (needsSubject(p) && state.subject) {
      return { emp_id: state.subject.emp_id, actor_emp_id: CURRENT.emp_id };
    }
    // subject / hr / meta / (manager without pick) → current user
    return { emp_id: CURRENT.emp_id, actor_emp_id: undefined };
  }

  /* ---------------- Rendering ---------------- */
  /* 렌더 대상 리스트 — 기본은 FAB, 허브가 attachSurface하면 그쪽 */
  function surfaceEl() { return state.surface || el.list; }
  function renderMessages() {
    var list = surfaceEl();
    if (!list) return;
    list.innerHTML = "";
    if (!msgs().length) {
      list.appendChild(buildEmptyState());
      return;
    }
    msgs().forEach(function (m) { list.appendChild(buildMsgNode(m)); });
    scrollToBottom();
  }
  function buildEmptyState() {
    var wrap = h("div", "ezx-empty");
    wrap.appendChild(h("div", "eh", { text: "무엇을 도와드릴까요?" }));
    var sub = h("div", "es");
    sub.textContent = "목표·평가부터 근무·급여까지, 화면 이동·조회·초안 작성을 도와드립니다.";
    wrap.appendChild(sub);

    var m = aiMode();
    if (m === "offline") {
      var off = h("div", "ezx-agent-off");
      off.innerHTML = "AI 미연결 — 연결 없이 예시 응답을 보여줍니다. ";
      var connect = h("button", "ezx-starter", { type: "button", text: "⚙ AI 연결" });
      connect.style.marginLeft = "6px";
      connect.addEventListener("click", function () {
        if (window.EZAI && window.EZAI.openSettings) window.EZAI.openSettings(function () { updateStatus(); renderMessages(); });
      });
      off.appendChild(connect);
      wrap.appendChild(off);
    } else {
      var ready = !window.EZAI || !window.EZAI.ready || window.EZAI.ready();
      var onNote = h("div", "ezx-persp-note");
      onNote.style.marginTop = "10px";
      onNote.innerHTML = (ready ? "● <b>연결됨</b> · " : "◐ ") + esc(window.EZAI ? window.EZAI.modeLabel() : "확인 중");
      onNote.style.color = ready ? "var(--color-success)" : "var(--color-warning)";
      wrap.appendChild(onNote);
    }

    /* 역할 기반 에이전트 제안 칩 — 클릭하면 대화 안에서 바로 실행 */
    var scns = (window.TXAgent && window.TXAgent.SCENARIOS) || [];
    var rk = "member";
    try { rk = (window.TXRoles && TXRoles.current && TXRoles.current().key) || "member"; } catch (e) { /* ignore */ }
    var mine = scns.filter(function (s) { return (s.roles || []).indexOf(rk) >= 0; }).slice(0, 5);
    if (mine.length) {
      var slab = h("div", "ezx-scn-lab", { text: "지금 도와드릴 수 있는 일" });
      wrap.appendChild(slab);
      var srow = h("div", "ezx-starters");
      mine.forEach(function (s) {
        var b = h("button", "ezx-starter scn", { type: "button" });
        b.innerHTML = "✦ " + esc(s.chip);
        b.addEventListener("click", function () { runScenarioInChat(s.key, s.chip); });
        srow.appendChild(b);
      });
      wrap.appendChild(srow);
    }

    var starters = h("div", "ezx-starters");
    ["내 목표 진행상황 점검", "이번 달 근무기록 확인", "급여명세서 열어줘"].forEach(function (s) {
      var b = h("button", "ezx-starter", { text: s, type: "button" });
      b.addEventListener("click", function () { sendMessage(s); });
      starters.appendChild(b);
    });
    wrap.appendChild(starters);
    return wrap;
  }
  /* ---------------- 작업중 카드 (계획 STEP + 원천 확인 내역 — W3 p6) ---------------- */
  var WORK_STEPS = {
    subject: [["talenx", "내 목표·KR 현황 조회"], ["ERP", "실적·체크인 기록 대조"], ["규정", "평가규정 해당 조항 확인"], ["맥락", "지난 대화·1:1 노트 로드"]],
    manager: [["talenx", "팀 목표·등급 초안 조회"], ["ERP", "팀 실적 대조"], ["규정", "강제배분 상한 확인"], ["맥락", "1:1·피어리뷰 로드"]],
    hr: [["talenx", "전사 등급 분포 스캔"], ["규정", "비율·가중치 규칙 검증"], ["ERP", "실적 대비 상승폭 대조"], ["맥락", "운영 이력 로드"]],
    executive: [["talenx", "전사 목표 정렬 현황 조회"], ["통계", "등급 분포 리스크 산출"], ["ERP", "사업 실적 대조"], ["맥락", "이전 브리핑 로드"]]
  };
  function makeWorkMsg(p) {
    var steps = (WORK_STEPS[p] || WORK_STEPS.subject).map(function (s) {
      return { src: s[0], label: s[1], st: 0 }; // 0 대기 · 1 진행 · 2 완료
    });
    return { role: "work", steps: steps, done: false, _timers: [] };
  }
  function workHTML(m) {
    var head = m.live
      ? (m.steps.length ? "확인 내역 · 도구 " + m.steps.length + "회 실행" : "확인 내역")
      : "확인 내역 · " + m.steps.length + " 원천";
    var html = '<div class="ezx-work-hd">' + head +
      (m.done ? ' · <span class="ok">감사 기록됨</span>' : ' · <span class="run">작업 중</span>') + "</div>";
    if (m.live && !m.steps.length && !m.done) {
      html += '<div class="ezx-work-ln st1"><span class="ck">◉</span><span class="src">elizax</span><span>실데이터 조회 계획 수립 중…</span></div>';
    }
    m.steps.forEach(function (s) {
      html += '<div class="ezx-work-ln st' + s.st + '"><span class="ck">' + (s.st === 2 ? "✓" : s.st === 1 ? "◉" : "○") +
        '</span><span class="src">' + esc(s.src) + "</span><span>" + esc(s.label) + "</span></div>";
    });
    return html;
  }
  /* ---- 라이브 작업중 카드: Claude tool-use 이벤트로 실제 실행 내역 표시 ---- */
  function makeLiveWorkMsg() {
    return { role: "work", live: true, steps: [], done: false, _timers: [] };
  }
  function addWorkStep(m, name, input) {
    if (!m) return;
    var hint = input && (input.name || input.query || input.emp_id || input.section || "");
    m.steps.push({
      src: (window.EZTools && EZTools.srcOf(name)) || "talenx",
      label: ((window.EZTools && EZTools.labelOf(name)) || name) + (hint ? " (" + hint + ")" : ""),
      st: 1
    });
    refreshWork(m);
  }
  function finishWorkStep(m, summary) {
    if (!m) return;
    for (var i = m.steps.length - 1; i >= 0; i--) {
      if (m.steps[i].st === 1) {
        m.steps[i].st = 2;
        if (summary) m.steps[i].label += " → " + summary;
        break;
      }
    }
    refreshWork(m);
  }
  function refreshWork(m) {
    if (m._node) { m._node.innerHTML = workHTML(m); scrollToBottom(); }
  }
  function animateWork(m) {
    m.steps.forEach(function (s, i) {
      m._timers.push(setTimeout(function () {
        if (m.done) return;
        s.st = 1;
        if (i > 0) m.steps[i - 1].st = 2;
        refreshWork(m);
      }, 350 + i * 800));
    });
  }
  function completeWork(aiMsg) {
    var m = aiMsg && aiMsg._work;
    if (!m || m.done) return;
    m.done = true;
    m._timers.forEach(function (t) { clearTimeout(t); });
    m.steps.forEach(function (s) { s.st = 2; });
    refreshWork(m);
  }
  /* ---------------- 영수증 전용 카드 (F15) ----------------
     검증 가능한 답변은 회색 말풍선이 아니라 화면 영수증(tx_roles)과 같은
     시각 언어로 낸다: as-of 칩(EZKit.clock 실값) · 메트릭 행 · 근거 칩 · 감사 칩.
     골격은 EZKit.receipt/asof/src 렌더러를 그대로 쓰고, 카드 내부 레이아웃만
     여기서 정의한다(소유 파일 외 CSS 수정 없이 런타임 주입). */
  function ensureRcptStyles() {
    if (document.getElementById("ezx-rcpt-css")) return;
    var css = [
      ".ezx-msg.ezx-rcptmsg{align-self:stretch;max-width:100%;}",
      ".ezx-rcptmsg .ezk-receipt{margin:0;}",
      /* EZKit 미로드 폴백 골격 */
      ".ezx-rc-fallback{border:1px solid var(--color-border,#e3e5e8);border-left:3px solid var(--color-accent,#1F7AF0);",
      "border-radius:var(--radius-container,12px);background:var(--color-background-card,#fff);padding:12px 14px;}",
      ".ezx-rc-fallback .ezk-receipt-head{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-bottom:8px;}",
      /* 메트릭 행 */
      ".ezx-rc-metrics{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 9px;}",
      ".ezx-rc-metric{display:flex;flex-direction:column;gap:1px;min-width:78px;padding:5px 10px;",
      "border:1px solid var(--ezx-hairline,var(--color-border,#e3e5e8));border-radius:var(--radius-element,8px);",
      "background:var(--color-background-muted,#f5f6f8);}",
      ".ezx-rc-metric .k{font-size:10px;letter-spacing:.02em;color:var(--color-text-secondary,#6b7280);}",
      ".ezx-rc-metric .v{font-size:15px;font-weight:700;letter-spacing:-.02em;color:var(--color-text-primary,#111827);}",
      ".ezx-rc-metric .s{font-size:10px;color:var(--color-text-secondary,#6b7280);}",
      /* 본문 — 말풍선과 동일한 마크다운 그래머 */
      ".ezx-rc-body{font-size:12.5px;line-height:1.58;color:var(--color-text-primary,#111827);}",
      ".ezx-rc-body p{margin:0 0 8px;} .ezx-rc-body p:last-child{margin-bottom:0;}",
      ".ezx-rc-body h3{font-size:13px;font-weight:700;margin:10px 0 6px;} .ezx-rc-body h3:first-child{margin-top:0;}",
      ".ezx-rc-body ul{margin:6px 0;padding-left:17px;} .ezx-rc-body li{margin:2px 0;}",
      ".ezx-rc-body table{border-collapse:collapse;margin:6px 0;font-size:11.5px;width:100%;}",
      ".ezx-rc-body th,.ezx-rc-body td{border:1px solid var(--ezx-hairline,var(--color-border,#e3e5e8));padding:3px 7px;text-align:left;}",
      ".ezx-rc-body th{background:var(--color-background-muted,#f5f6f8);font-weight:600;}",
      ".ezx-rc-body code{background:var(--color-background-muted,#f5f6f8);border-radius:4px;padding:1px 5px;font-size:11.5px;",
      "font-family:var(--font-family-code,monospace);}",
      /* 근거 칩 줄 */
      ".ezx-rc-srcs{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:9px;",
      "padding-top:8px;border-top:1px dashed var(--ezx-hairline,var(--color-border,#e3e5e8));}",
      ".ezx-rc-srcs .lb{font-size:10px;font-weight:700;color:var(--color-text-secondary,#6b7280);margin-right:2px;}",
      /* 감사 칩 — 원장 실 id 없으면 '기록 전' 중립 표기 */
      ".ezx-rc-pre{border-style:dashed !important;color:var(--color-text-secondary,#6b7280) !important;}",
      /* 인용 3등급 — tx_ctx_ledger 스트립과 같은 시각 문법 (실인용/추측 점선/0건) */
      ".ezx-rc-cite.cited{color:var(--color-text-green,#15803d);background:var(--color-background-green,rgba(21,128,61,.08));",
      "border-color:var(--color-border-green,var(--color-border,#e3e5e8));font-weight:700;}",
      ".ezx-rc-cite.guess{border-style:dashed;border-color:var(--color-border-emphasized,#c9ced6);",
      "background:var(--color-background-surface,transparent);color:var(--color-text-secondary,#6b7280);}",
      ".ezx-rc-cite.none{border-style:dashed;border-color:var(--color-border-orange,#f0b27a);",
      "background:var(--color-background-orange,rgba(240,178,122,.12));color:var(--color-text-orange,#c2410c);font-weight:700;}",
      /* What-if 재계산 (읽기 전용) */
      ".ezx-rc-wi{margin-top:9px;padding-top:8px;border-top:1px dashed var(--ezx-hairline,var(--color-border,#e3e5e8));",
      "display:flex;flex-wrap:wrap;align-items:center;gap:7px;}",
      ".ezx-rc-wibtn{font:inherit;font-size:11.5px;font-weight:700;cursor:pointer;padding:4px 11px;",
      "border-radius:var(--radius-full,999px);border:1px solid var(--color-accent,#1F7AF0);",
      "background:var(--color-background-card,#fff);color:var(--color-accent,#1F7AF0);}",
      ".ezx-rc-wibtn:hover{background:var(--color-accent-muted,rgba(31,122,240,.1));}",
      ".ezx-rc-wibtn[disabled]{opacity:.55;cursor:default;}",
      ".ezx-rc-wihint{font-size:10px;color:var(--color-text-secondary,#6b7280);}",
      ".ezx-rc-wiout{flex:1 1 100%;}",
      ".ezx-rc-wiout:empty{display:none;}",
      ".ezx-rc-wiout{margin-top:6px;border:1px solid var(--ezx-hairline,var(--color-border,#e3e5e8));",
      "border-radius:var(--radius-element,8px);background:var(--color-background-muted,#f5f6f8);padding:8px 10px;}",
      ".ezx-rc-wirow{display:flex;gap:8px;align-items:baseline;font-size:11.5px;padding:2px 0;",
      "color:var(--color-text-primary,#111827);}",
      ".ezx-rc-wirow .lb{width:52px;flex:none;font-size:10px;font-weight:700;color:var(--color-text-secondary,#6b7280);}",
      ".ezx-rc-wirow.warn{color:var(--color-warning,#b45309);}",
      ".ezx-rc-wirow .chg{font-style:normal;font-size:10px;font-weight:700;color:var(--color-warning,#b45309);}",
      ".ezx-rc-wirow .keep{font-style:normal;font-size:10px;color:var(--color-text-secondary,#6b7280);}",
      ".ezx-rc-winote{margin-top:5px;font-size:10px;line-height:1.45;color:var(--color-text-secondary,#6b7280);}"
    ].join("");
    var st = document.createElement("style");
    st.id = "ezx-rcpt-css";
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  /* EZKit.status 렌더러 재사용 — 라벨만 상황 문구로 교체(점 색은 data-mode가 결정) */
  function statusChip(mode, label) {
    var base = (window.EZKit && EZKit.status)
      ? EZKit.status(mode)
      : '<span class="ezk-chip ezk-status" data-mode="' + esc(mode) + '">-</span>';
    return base.replace(/>[^<]*<\/span>\s*$/, ">" + esc(label) + "</span>");
  }
  /* 감사 칩 — 원장(EZLedger) 실 id만 "기록됨"으로 단언한다.
     해시 위조 ID(EZKit.gaId) 금지 — 기록이 없으면 정직하게 "기록 전". */
  function auditChip(m) {
    var id = m && m.meta && m.meta.ledgerId;
    if (id) return '<span class="ezk-chip ezk-audit" data-ezx-audit>&#9960; 감사 기록됨 · ' + esc(id) + "</span>";
    return '<span class="ezk-chip ezk-audit ezx-rc-pre" data-ezx-audit>&#9960; 기록 전 — 실행 시 원장 기록</span>';
  }

  /* 영수증 서술자 접근 — meta에도 사본을 두어 세션 복원 후에도 카드로 남는다
     (EZChat.serializeMsg는 role/text/note/fb/meta만 보존) */
  function rcptOf(m) {
    if (!m) return null;
    if (m.receipt) return m.receipt;
    if (m.meta && m.meta.receipt) { m.receipt = m.meta.receipt; return m.receipt; }
    return null;
  }

  /* ---- What-if: EZTools.simulate_whatif 실행 결과를 카드 안에 인라인 표시 (F15) ----
     오프라인에서도 로컬 계산이므로 동작한다. 읽기 전용 — 원본 데이터 불변. */
  function whatifParams(r) {
    var wi = r.whatif || {};
    var p = {};
    if (wi.emp_id) p.emp_id = wi.emp_id;
    if (wi.cap_pct != null) p.cap_pct = wi.cap_pct;
    p.achievement_delta = (wi.achievement_delta != null) ? wi.achievement_delta
      : (wi.cap_pct != null ? 0 : -10);
    return p;
  }
  function whatifHTML(res, p) {
    if (!res) return "";
    if (res.error || res.blocked) {
      return '<div class="ezx-rc-wirow warn"><span class="lb">불가</span><span>' +
        esc(res.error || res.policy || "시뮬레이션을 실행할 수 없습니다.") + "</span></div>";
    }
    var b = res.before || {}, a = res.after || {};
    var dist = res.grade_distribution || {};
    var dk = Object.keys(dist).sort();
    var capUsed = (res.cap_pct != null) ? res.cap_pct : p.cap_pct;
    var deltaUsed = (res.achievement_delta != null) ? res.achievement_delta : p.achievement_delta;
    var html = '<div class="ezx-rc-wirow"><span class="lb">가정</span><span>달성률 ' +
      esc(String(deltaUsed)) + "%p" +
      (capUsed != null ? " · 상위등급 상한 " + esc(String(capUsed)) + "%" : "") + "</span></div>";
    /* 정식 엔진(EZCalc)은 개인 등급 단건이 아니라 전사 분포를 반환한다 — 형상별 렌더 */
    if (Object.prototype.toString.call(res.gradeChange) === "[object Array]") {
      html += '<div class="ezx-rc-wirow"><span class="lb">분포</span><span>' +
        esc(res.gradeChange.map(function (g) {
          return g.grade + " " + g.before_pct + "%→" + g.after_pct + "%(" + (g.delta_pp > 0 ? "+" : "") + g.delta_pp + "pp)";
        }).join(" · ")) + "</span></div>";
      if (res.moved_pp != null) {
        html += '<div class="ezx-rc-wirow"><span class="lb">이동폭</span><span>합계 ' +
          esc(String(res.moved_pp)) + "pp 재배치" +
          (res.basis && res.basis.population_n ? " · 모집단 " + esc(String(res.basis.population_n)) + "명" : "") + "</span></div>";
      }
      var me = null;
      (res.people || []).forEach(function (x) {
        if (p.emp_id && x.name && x.name === ((state.subject && state.subject.name) || CURRENT.name)) me = x;
      });
      if (me) {
        html += '<div class="ezx-rc-wirow"><span class="lb">' + esc(me.name) + '</span><span>' +
          esc(String(me.before)) + " → <b>" + esc(String(me.after)) + "</b>점</span></div>";
      }
      var bs = res.basis || {};
      html += '<div class="ezx-rc-winote">' +
        esc(bs.base_source || "") + (bs.cap_rule_source ? " · " + esc(bs.cap_rule_source) : "") +
        "<br>읽기 전용 시뮬레이션 — 실제 데이터는 변경되지 않습니다 · 엔진 " + esc(res.engine || "-") +
        (p.emp_id && !me ? " (전사 분포 기준 — 개인 등급 단건은 이 엔진이 산출하지 않습니다)" : "") + "</div>";
      return html;
    }
    html += '<div class="ezx-rc-wirow"><span class="lb">등급</span><span>' +
      esc(String(b.grade == null ? "-" : b.grade)) + " → <b>" + esc(String(a.grade == null ? "-" : a.grade)) + "</b> " +
      (res.grade_changed ? '<em class="chg">변동</em>' : '<em class="keep">유지</em>') + "</span></div>";
    html += '<div class="ezx-rc-wirow"><span class="lb">종합</span><span>' +
      esc(String(b.weighted_score == null ? "-" : b.weighted_score)) + " → <b>" +
      esc(String(a.weighted_score == null ? "-" : a.weighted_score)) + "</b></span></div>";
    if (dk.length) {
      html += '<div class="ezx-rc-wirow"><span class="lb">분포</span><span>' +
        esc(dk.map(function (k) { return k + " " + dist[k] + "명"; }).join(" · ")) +
        (res.top_grade_pct != null ? " · 상위 " + esc(String(res.top_grade_pct)) + "%" : "") + "</span></div>";
    }
    if (res.cap_note) {
      html += '<div class="ezx-rc-wirow"><span class="lb">상한</span><span>' + esc(res.cap_note) + "</span></div>";
    }
    html += '<div class="ezx-rc-winote">' +
      esc(res.assumptions || "읽기 전용 시뮬레이션 — 실제 데이터는 변경되지 않습니다") +
      " · 엔진 " + esc(res.engine || "-") + "</div>";
    return html;
  }
  function runWhatIf(m, node) {
    var r = rcptOf(m);
    if (!r || !r.whatif) return;
    var out = node.querySelector("[data-ezx-wiout]");
    var btn = node.querySelector("[data-ezx-whatif]");
    var p = whatifParams(r);
    var res = ezRun("simulate_whatif", p);
    if (!res) res = { error: "시뮬레이션 도구(EZTools)가 로드되지 않았습니다." };
    r.wiParams = p;
    r.wiResult = res;
    if (out) out.innerHTML = whatifHTML(res, p);
    if (btn) btn.textContent = "↺ 다시 계산";
    /* 실행 사실을 원장에 남겨 감사 칩이 실 id를 얻게 한다 (위조 ID 금지) */
    if (!res.error && !res.blocked && window.EZLedger && EZLedger.add) {
      try {
        var b = res.before || {}, a = res.after || {};
        /* 엔진 형상별 요약 — 개인 등급(fallback) vs 전사 분포(EZCalc) */
        var lbl = (a.grade != null || b.grade != null)
          ? ((b.grade || "-") + " → " + (a.grade || "-"))
          : (res.moved_pp != null ? "전사 분포 " + res.moved_pp + "pp 재배치" : "재계산");
        var ent = EZLedger.add({
          type: "audit",
          source: "elizax.whatif",
          title: "What-if 재계산 · " + lbl,
          summary: "달성률 " + p.achievement_delta + "%p" +
            (p.cap_pct != null ? " · 상한 " + p.cap_pct + "%" : "") + " 가정 · 읽기 전용",
          weight: 1
        });
        if (ent && ent.id) {
          if (!m.meta) m.meta = {};
          m.meta.ledgerId = ent.id;
          var ac = node.querySelector("[data-ezx-audit]");
          if (ac) ac.outerHTML = auditChip(m);
        }
      } catch (e) { /* 원장 오류 무시 */ }
    }
    if (m.meta) m.meta.receipt = r;
    saveHistory();
    scrollToBottom();
  }

  /* ---- 인용 3등급을 카드 안에서도 유지 (F15) ----
     판정 주체는 tx_ctx_ledger(실인용 ctxCited / 추측 .guess / 0건 "기록 없음").
     카드는 msg.meta의 그 판정을 그대로 읽어 같은 등급을 표시한다 — 자체 승격 금지. */
  /* 원장에 실제로 존재하는 id만 인정 — 스트립(tx_ctx_ledger)과 같은 기준으로 세지 않으면
     카드는 "추정 근거 4건", 스트립은 "기록 없음"으로 어긋난다. */
  function resolveRefs(refs) {
    if (Object.prototype.toString.call(refs) !== "[object Array]" || !refs.length) return [];
    if (!window.EZLedger || !EZLedger.list) return refs.slice();
    var idx = {}, ok = [], i;
    try {
      (EZLedger.list() || []).forEach(function (it) { if (it && it.id) idx[it.id] = 1; });
    } catch (e) { return refs.slice(); }
    for (i = 0; i < refs.length; i++) if (idx[refs[i]]) ok.push(refs[i]);
    return ok;
  }
  function citeChip(m) {
    var meta = (m && m.meta) || {};
    var refs = resolveRefs(meta.ctxRefs);
    if (meta.ctxCited === true && refs && refs.length) {
      return '<span class="ezk-chip ezx-rc-cite cited" data-ezx-cite title="AI가 실제로 인용한 성과 기록">' +
        "&#10003; 인용 근거 " + refs.length + "건</span>";
    }
    if (refs && refs.length) {
      return '<span class="ezk-chip ezx-rc-cite guess" data-ezx-cite title="관련일 수 있는 기록 — 실인용 아님">' +
        "&#9702; 추정 근거 " + refs.length + "건</span>";
    }
    return '<span class="ezk-chip ezx-rc-cite none" data-ezx-cite title="이 답변을 뒷받침하는 성과 기록이 없습니다">' +
      "&#9888; 뒷받침 기록 없음</span>";
  }
  function syncCiteChip(m) {
    var node = m && m._node;
    if (!node || !node.parentNode) return;
    var cur = node.querySelector("[data-ezx-cite]");
    if (!cur) return;
    var next = citeChip(m);
    if (cur.outerHTML !== next) cur.outerHTML = next;
  }
  function scheduleCiteSync(m) {
    /* tx_ctx_ledger는 messages 이벤트 240ms 뒤에 근거를 판정해 meta에 기록한다 */
    [360, 780, 1500].forEach(function (d) { setTimeout(function () { syncCiteChip(m); }, d); });
  }

  function receiptBodyHTML(m) {
    var r = rcptOf(m) || {};
    var html = "";
    if (r.metrics && r.metrics.length) {
      html += '<div class="ezx-rc-metrics">';
      r.metrics.forEach(function (x) {
        html += '<div class="ezx-rc-metric"><span class="k">' + esc(x.k) + '</span><span class="v">' + esc(x.v) + "</span>" +
          (x.sub ? '<span class="s">' + esc(x.sub) + "</span>" : "") + "</div>";
      });
      html += "</div>";
    }
    html += '<div class="ezx-rc-body">' + mdToHtml(stripCtxMarker(m.text || "")) + "</div>";
    if (r.srcs && r.srcs.length) {
      html += '<div class="ezx-rc-srcs"><span class="lb">근거</span>';
      r.srcs.forEach(function (s) {
        html += (window.EZKit && EZKit.src) ? EZKit.src(s.kind, s.label)
          : '<span class="ezk-chip">' + esc(s.label) + "</span>";
      });
      html += "</div>";
    }
    if (r.whatif) {
      html += '<div class="ezx-rc-wi">' +
        '<button type="button" class="ezx-rc-wibtn" data-ezx-whatif>' +
        (r.wiResult ? "↺ 다시 계산" : "↺ What-if 재계산") + "</button>" +
        '<span class="ezx-rc-wihint">읽기 전용 · 실제 평가 데이터는 변경되지 않습니다</span>' +
        '<div class="ezx-rc-wiout" data-ezx-wiout>' +
        (r.wiResult ? whatifHTML(r.wiResult, r.wiParams || whatifParams(r)) : "") +
        "</div></div>";
    }
    return html;
  }

  function buildReceiptNode(m) {
    ensureRcptStyles();
    var r = rcptOf(m) || {};
    var node = h("div", "ezx-msg ai ezx-rcptmsg");
    var chips = (r.offline ? statusChip("suggest", "AI 미연결 · 로컬 데이터 조회") : statusChip("approve", "승인 필요"))
      + citeChip(m) + auditChip(m);
    var body = receiptBodyHTML(m);
    if (window.EZKit && EZKit.receipt) {
      node.innerHTML = EZKit.receipt({ title: r.title, chips: chips, body: body });
    } else {
      node.innerHTML = '<div class="ezk-receipt ezx-rc-fallback"><div class="ezk-receipt-head">' +
        '<span class="ezk-receipt-title">' + esc(r.title || "확인 결과") + "</span>" +
        '<span class="ezk-chip ezk-asof">&#128204; 기준 ' +
        esc(window.EZKit && EZKit.clock ? EZKit.clock.asOf() : "2026-07-16 06:00") + "</span>" +
        chips + '</div><div class="ezk-receipt-body">' + body + "</div></div>";
    }
    var wbtn = node.querySelector("[data-ezx-whatif]");
    if (wbtn) wbtn.addEventListener("click", function () { runWhatIf(m, node); });
    if (m.note) node.appendChild(h("div", "ezx-note" + (m.noteWarn ? " warn" : ""), { text: m.note }));
    if (m.recos && m.recos.length) node.appendChild(buildRecos(m.recos));
    m._node = node;
    m._bubble = node.querySelector(".ezx-rc-body");
    scheduleCiteSync(m);
    return node;
  }

  function buildMsgNode(m) {
    if (m.role === "work") {
      var wnode = h("div", "ezx-msg work ezx-work");
      wnode.innerHTML = workHTML(m);
      m._node = wnode;
      return wnode;
    }
    if (m.role === "nav") {
      /* 내비게이션 확인 카드 */
      var nnode = h("div", "ezx-msg ai");
      var ncard = h("div", "ezx-navcard");
      ncard.innerHTML = '<span class="arr">➜</span><span>화면 전환 · <b>' + esc(m.target.label) + "</b>(으)로 이동합니다.</span>";
      nnode.appendChild(ncard);
      m._node = nnode;
      return nnode;
    }
    if (m.role === "scn") {
      /* 에이전트 시나리오 카드 — 재렌더 시 DOM 재사용 (애니메이션 재시작 방지) */
      if (m._node) return m._node;
      var snode = h("div", "ezx-msg scn ezx-scnhost");
      m._node = snode;
      if (window.TXAgent && window.TXAgent.runScenario) {
        try { window.TXAgent.runScenario(m.key, snode); }
        catch (e) { snode.textContent = "카드를 불러오지 못했습니다."; }
      } else {
        snode.textContent = "에이전트 모듈이 아직 로드되지 않았습니다.";
      }
      return snode;
    }
    /* 영수증형 답변 → 전용 카드 (스트리밍 중에는 기존 말풍선 유지) */
    if (m.role === "ai" && !m.streaming && rcptOf(m)) return buildReceiptNode(m);
    var node = h("div", "ezx-msg " + (m.role === "user" ? "user" : m.role === "err" ? "err" : "ai"));
    var bubble = h("div", "ezx-bubble");
    if (m.role === "user") bubble.textContent = m.text;
    else bubble.innerHTML = mdToHtml(stripCtxMarker(m.text || ""));
    if (m.streaming) bubble.appendChild(h("span", "ezx-caret"));
    node.appendChild(bubble);
    if (m.note) node.appendChild(h("div", "ezx-note" + (m.noteWarn ? " warn" : ""), { text: m.note }));
    if (m.recos && m.recos.length) node.appendChild(buildRecos(m.recos));
    m._node = node; m._bubble = bubble;
    return node;
  }
  function buildRecos(recos) {
    var wrap = h("div", "ezx-recos");
    recos.forEach(function (r) {
      var card = h("div", "ezx-reco");
      card.appendChild(h("div", "ezx-reco-obj", { text: r.objective || "" }));
      if (r.rationale) card.appendChild(h("div", "ezx-reco-why", { text: r.rationale }));
      (r.krs || []).forEach(function (kr) {
        var krn = h("div", "ezx-kr");
        krn.appendChild(h("span", "knm", { text: kr.name || "" }));
        var meta = [];
        if (kr.target != null) meta.push("목표 " + kr.target);
        if (kr.weight != null) meta.push("가중 " + kr.weight);
        var mspan = h("span", "kmeta", { text: meta.join(" · ") });
        krn.appendChild(mspan);
        if (kr.difficulty != null) krn.appendChild(h("span", "ezx-kr-diff", { text: String(kr.difficulty) }));
        card.appendChild(krn);
      });
      wrap.appendChild(card);
    });
    return wrap;
  }
  function scrollToBottom() {
    var list = surfaceEl();
    if (list) list.scrollTop = list.scrollHeight;
  }

  /* ---------------- Send / stream ---------------- */
  function submit() {
    var v = el.textarea.value.trim();
    if (!v || state.streaming) return;
    el.textarea.value = "";
    autoGrow();
    sendMessage(v);
  }

  /* 성과 히스토리 원장(EZLedger) 요약 — 최근 8건을 시스템 컨텍스트로 주입 */
  function buildLedgerContext() {
    if (!window.EZLedger || !EZLedger.list) return "";
    var list;
    try { list = EZLedger.list() || []; } catch (e) { return ""; }
    if (!list.length) return "";
    var lines = [];
    for (var i = 0; i < list.length && lines.length < 8; i++) {
      var it = list[i];
      if (!it || !it.id || !it.title) continue;
      var one = String(it.title).replace(/\s+/g, " ");
      var sum = String(it.summary || "").replace(/\s+/g, " ");
      if (sum) one += " — " + (sum.length > 60 ? sum.slice(0, 59) + "…" : sum);
      lines.push("- " + it.id + " (" + it.type + ") " + one);
    }
    if (!lines.length) return "";
    return "[성과 히스토리 원장 — 이 사용자의 축적 맥락]\n" + lines.join("\n")
      + "\n(근거로 실제 사용한 원장 항목이 있으면 답변 맨 끝에 [[ctx:ID1,ID2]] 마커를 정확히 한 번 표기하세요. 사용한 항목이 없으면 마커를 생략하세요.)";
  }

  function buildPayloadMessage(userText) {
    if (!state.attachContext) return userText;
    var label = activeScreenLabel();
    var line = "[현재 화면: " + label + " / 사용자: " + CURRENT.name + "·" + (CURRENT.jobTitle || "") + "]";
    if (needsSubject(state.perspective) && state.subject) {
      line = "[현재 화면: " + label + " / 대상: " + state.subject.name + "·" + (state.subject.jobTitle || "") + " / 요청자: " + CURRENT.name + "]";
    }
    var ledger = buildLedgerContext();
    if (ledger) line += "\n" + ledger;
    return line + "\n" + userText;
  }

  /* ---- 실인용 근거 마커 [[ctx:ID1,ID2]] ---- */
  function stripCtxMarker(text) {
    /* 표시용 제거 — 스트리밍 중 꼬리의 미완성 마커도 감춘다 */
    return String(text || "")
      .replace(/\s*\[\[ctx:[^\]]*\]\]/g, "")
      .replace(/\s*\[\[ctx:[^\]]*$/, "");
  }
  function extractCtxRefs(aiMsg) {
    /* 스트림 종료 시 마커를 meta.ctxRefs로 옮기고 본문에서 제거 (원장 근거칩이 우선 사용) */
    if (!aiMsg || !aiMsg.text) return;
    var m = /\[\[ctx:([^\]]+)\]\]/.exec(aiMsg.text);
    if (!m) return;
    aiMsg.text = stripCtxMarker(aiMsg.text).replace(/\s+$/, "");
    var ids = [], parts = m[1].split(",");
    for (var i = 0; i < parts.length; i++) {
      var v = parts[i].replace(/^\s+|\s+$/g, "");
      if (v) ids.push(v);
    }
    if (ids.length) {
      if (!aiMsg.meta) aiMsg.meta = {};
      aiMsg.meta.ctxRefs = ids;
      aiMsg.meta.ctxCited = true; /* 모델 실인용 표시 — 원장에서 usedCount 연동 */
    }
  }

  /* 시나리오 실행을 대화 안에 자연스럽게: 사용자 발화 → 인라인 작업 카드 */
  function runScenarioInChat(key, label) {
    pushMessage({ role: "user", text: label });
    pushMessage({ role: "scn", key: key });
    renderMessages();
    scrollToBottom();
  }

  function sendMessage(userText) {
    if (state.streaming) return;
    /* 화면 이동 의도면 LLM 없이 즉시 내비게이션 ("목표 화면으로 넘어가줘") */
    if (window.EZNav && window.EZNav.resolve) {
      var navHit = null;
      try { navHit = window.EZNav.resolve(userText); } catch (e) { /* ignore */ }
      if (navHit) {
        pushMessage({ role: "user", text: userText });
        pushMessage({ role: "nav", target: navHit });
        renderMessages();
        setTimeout(function () {
          var ok = false;
          try { ok = window.EZNav.go(navHit.s, navHit.p); } catch (e) { console.error("[elizax nav]", e); }
          if (!ok) console.warn("[elizax nav] target not found:", navHit.s, navHit.p);
        }, 380);
        return;
      }
    }
    /* 오프라인일 때만 시나리오 가로채기 — 라이브 연결 시 Claude가 우선
       (시나리오 카드는 제안 칩으로 여전히 실행 가능) */
    if (aiMode() === "offline" && window.TXAgent && window.TXAgent.intentFor) {
      var scnKey = null;
      try { scnKey = window.TXAgent.intentFor(userText); } catch (e) { /* ignore */ }
      /* "오늘 점심 뭐 먹지"가 /오늘/ 한 단어로 home 브리핑 카드에 삼켜지던 오검출 차단 (G4).
         범용 home 라우팅은 홈·브리핑을 명시했을 때만 인정하고, 나머지는 의도 분기로 넘긴다. */
      if (scnKey === "home" && !/(브리핑|홈\s|^홈|홈으로|홈 |처음\s*화면|오늘\s*(할|일정|업무|브리핑))/.test(String(userText))) scnKey = null;
      /* 자기 데이터를 묻는 질문은 대본 시나리오가 가로채지 않는다 — "내 목표 진척"에
         데모 체크인 카드를 띄우면 실제 수치를 물은 사람에게 각본을 답으로 주는 셈이다.
         시나리오는 제안 칩이나 명시적 요청("시나리오/데모/워크스페이스")으로 실행한다. */
      if (scnKey && /(^|\s)(내|나의|제|저의)\s*\S*(목표|KR|핵심\s*성과|진척|체크인|등급|평가|피드백|근거)/.test(String(userText))
          && !/(시나리오|데모|워크스페이스|허브)/.test(String(userText))) scnKey = null;
      if (scnKey) { runScenarioInChat(scnKey, userText); return; }
    }
    // guard: manager/executive needs a subject
    if (needsSubject(state.perspective) && !state.subject) {
      pushMessage({ role: "err", text: "이 관점에서는 대상 직원을 먼저 선택해 주세요." });
      renderMessages();
      if (el.pickerInput) el.pickerInput.focus();
      return;
    }
    pushMessage({ role: "user", text: userText });
    /* 실 에이전트 가능(연결+키+도구) → 라이브 카드(실 도구 호출 표시),
       그 외 라이브 → 기존 연출 카드, 오프라인 → 카드 없음 */
    var agentReady = !!(window.EZAI && EZAI.agent && EZAI.ready && EZAI.ready() && window.EZTools);
    var workMsg = agentReady ? pushMessage(makeLiveWorkMsg())
      : (aiMode() !== "offline") ? pushMessage(makeWorkMsg(state.perspective)) : null;
    var aiMsg = { role: "ai", text: "", streaming: true, _work: workMsg };
    pushMessage(aiMsg);
    renderMessages();
    if (workMsg && !workMsg.live) animateWork(workMsg);

    state.streaming = true;
    el.send.disabled = true;
    el.textarea.disabled = true;
    if (window.EZChat) EZChat.emit("streaming", { on: true });

    var ids = resolveEmpIds();
    var body = {
      emp_id: ids.emp_id,
      message: buildPayloadMessage(userText),
      perspective: state.perspective
    };
    if (ids.actor_emp_id) body.actor_emp_id = ids.actor_emp_id;

    if (agentReady) agentRespond(body, aiMsg);
    else streamChat(body, aiMsg, userText);   /* 오프라인 의도 분기는 원문 질문이 필요 (G4) */
  }

  function finishStreaming() {
    state.streaming = false;
    el.send.disabled = false;
    el.textarea.disabled = false;
    if (window.EZChat) EZChat.emit("streaming", { on: false });
    saveHistory();
  }

  /* ---------------- 생성 중지 / 재생성 (기능 모듈 공개 API) ---------------- */
  function stopStreaming() {
    if (!state.streaming) return false;
    var arr = msgs();
    for (var i = arr.length - 1; i >= 0; i--) {
      var m = arr[i];
      if (m.role === "ai" && m.streaming) {
        m.streaming = false;
        m._stopped = true;
        if (!m.note) m.note = "생성 중지됨";
      }
      if (m.role === "work" && !m.done) {
        m.done = true;
        (m._timers || []).forEach(function (t) { clearTimeout(t); });
        refreshWork(m);
      }
    }
    finishStreaming();
    renderMessages();
    return true;
  }
  function regenerate() {
    if (state.streaming) return false;
    var arr = msgs();
    var lastUserIdx = -1;
    for (var i = arr.length - 1; i >= 0; i--) {
      if (arr[i].role === "user" && arr[i].text) { lastUserIdx = i; break; }
    }
    if (lastUserIdx < 0) return false;
    var text = arr[lastUserIdx].text;
    arr.splice(lastUserIdx, arr.length - lastUserIdx); /* 마지막 질문+응답 제거 후 재전송 */
    saveHistory();
    sendMessage(text);
    return true;
  }

  /* ---------------- 대화 히스토리 → Anthropic messages 규격 ---------------- */
  function buildHistoryMsgs(body, aiMsg) {
    /* user/ai 텍스트만, 마지막 user는 컨텍스트 포함 payload */
    var hist = [];
    msgs().forEach(function (m) {
      if (m === aiMsg || !m.text) return;
      if (m.role === "user") hist.push({ role: "user", content: m.text });
      else if (m.role === "ai") hist.push({ role: "assistant", content: m.text });
    });
    for (var i = hist.length - 1; i >= 0; i--) {
      if (hist[i].role === "user") { hist[i] = { role: "user", content: body.message }; break; }
    }
    /* Anthropic 규격: user 시작 + 역할 교대 — 연속 동일 역할 병합, 선행 assistant 제거 */
    var norm = [];
    hist.slice(-16).forEach(function (m) {
      if (!norm.length && m.role !== "user") return;
      if (norm.length && norm[norm.length - 1].role === m.role) norm[norm.length - 1].content += "\n" + m.content;
      else norm.push({ role: m.role, content: m.content });
    });
    if (!norm.length) norm = [{ role: "user", content: body.message }];
    return norm;
  }

  /* ---------------- 라이브 에이전트: tool-use 루프 (proxy·direct 공용) ----------
     Claude가 talenx 실데이터 도구를 호출하며 답한다.
     도구 이벤트가 작업중 카드에 실제 실행 내역으로 찍힌다. */
  function agentRespond(body, aiMsg) {
    var work = aiMsg._work;
    window.EZAI.agent({
      messages: buildHistoryMsgs(body, aiMsg),
      onText: function (t) {
        if (aiMsg._stopped) return;
        aiMsg.text += t;
        refreshBubble(aiMsg);
      },
      onTool: function (name, input) { addWorkStep(work, name, input); },
      onToolResult: function (name, r, summary) {
        finishWorkStep(work, summary);
        if (name === "navigate" && r && r.ok) aiMsg.note = "화면 전환 · " + (r.moved_to || "");
      },
      onDone: function () {
        if (work) { work.done = true; work.steps.forEach(function (s) { s.st = 2; }); refreshWork(work); }
        aiMsg.streaming = false;
        extractCtxRefs(aiMsg); /* 실인용 근거 마커 → meta.ctxRefs */
        /* 모델이 마커를 낸 경우의 폴백 (navigate 도구가 기본) */
        if (window.EZNav && window.EZNav.extractMarker) {
          try {
            var ext = window.EZNav.extractMarker(aiMsg.text);
            if (ext.nav) {
              aiMsg.text = ext.clean;
              aiMsg.note = "화면 전환 · " + ext.nav.label;
              setTimeout(function () { try { window.EZNav.go(ext.nav.s, ext.nav.p); } catch (e) { /* ignore */ } }, 380);
            }
          } catch (e) { /* ignore */ }
        }
        finishStreaming();
        renderMessages();
      },
      onError: function (m) {
        if (work) { work.done = true; refreshWork(work); }
        aiMsg.role = "err";
        aiMsg.streaming = false;
        aiMsg.text = m || "오류가 발생했습니다.";
        finishStreaming();
        renderMessages();
      }
    });
  }

  /* ---------------- direct 모드: 브라우저 → Anthropic API ---------------- */
  function directRespond(body, aiMsg) {
    var norm = buildHistoryMsgs(body, aiMsg);
    window.EZAI.direct({
      messages: norm,
      onChunk: function (t) { applyEvent({ type: "chunk", content: t }, aiMsg); },
      onDone: function () { applyEvent({ type: "done" }, aiMsg); finishStreaming(); },
      onError: function (msg) { applyEvent({ type: "error", message: msg }, aiMsg); finishStreaming(); }
    });
  }

  function streamChat(body, aiMsg, userText) {
    var m = aiMode();
    if (m === "offline") { offlineRespond(body, aiMsg, userText); return; }
    if (m === "direct") { directRespond(body, aiMsg); return; }
    var url = API_BASE + "/api/chat";
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      var ct = (res.headers.get("Content-Type") || "").toLowerCase();
      if (ct.indexOf("text/event-stream") === -1) {
        // non-streaming JSON fallback
        return res.json().then(function (j) {
          completeWork(aiMsg);
          aiMsg.streaming = false;
          aiMsg.text = j.response || j.message || "(빈 응답)";
          extractCtxRefs(aiMsg);
          if (j.recommendations && j.recommendations.length) aiMsg.recos = j.recommendations;
          if (j.type === "fallback" || j.source === "fallback") { aiMsg.note = "AI 미연결 — 기본 응답"; }
          finishStreaming();
          renderMessages();
        });
      }
      return readSSE(res, aiMsg);
    }).catch(function (err) {
      completeWork(aiMsg);
      aiMsg.role = "err";
      aiMsg.streaming = false;
      aiMsg.text = "연결에 실패했습니다 (" + (err && err.message ? err.message : "network") +
        "). 잠시 후 다시 시도해 주세요. 문제가 계속되면 AI 연결 설정(⚙)을 확인하세요.";
      finishStreaming();
      renderMessages();
    });
  }

  /* ---------------- Offline mockup responder (G4) ----------------
     키/백엔드 미설정 기본 배포 경로. 관점(perspective)만 보고 등급 영수증을
     찍던 예전 동작을 폐기하고, 질문 텍스트의 의도를 읽어 분기한다.
     - 도메인 의도면 EZTools로 로컬 목업 데이터를 실제 조회해 영수증으로 답한다.
     - 화면 이동 요청이면 답변 대신 실제로 이동한다.
     - 어떤 의도에도 맞지 않으면 가짜 영수증을 만들지 않고 "AI 미연결"을 알린다. */
  function evalOf(empId) {
    var evs = Array.isArray(DATA.evaluations) ? DATA.evaluations : [];
    return evs.find(function (e) { return e.emp_id === empId; }) || null;
  }
  /* (구 objsOwnedBy/krsOf 폴백은 EZTools.get_objectives 실조회로 대체돼 제거) */
  /* --- 로컬 도구 실행 래퍼 — 오프라인이어도 목업 데이터는 로컬에 있다 --- */
  function ezRun(name, input) {
    if (!window.EZTools || !EZTools.run) return null;
    try { return EZTools.run(name, input || {}); } catch (e) { return null; }
  }
  function roleKey() {
    try {
      return (window.CU && CU._role) ||
        (window.TXRoles && TXRoles.current && (TXRoles.current() || {}).key) || "member";
    } catch (e) { return "member"; }
  }
  function offSrc(kind, label) { return { kind: kind, label: label }; }
  /* 영수증 카드 서술자 — 렌더는 buildReceiptNode (F15) */
  function offRc(o) {
    o = o || {};
    return {
      title: o.title || "확인 결과",
      metrics: o.metrics || [],
      srcs: o.srcs || [],
      whatif: o.whatif || null,
      offline: true
    };
  }
  function pctOf(v) { return (v == null) ? "-" : v + "%"; }

  /* --- 의도 분기표 (배열 순서 = 우선순위) --- */
  var OFF_INTENTS = [
    ["whatif", /(만약|가정했|가정하|what\s*-?if|시뮬|재계산|바뀌면|떨어지면|올라가면|[-+]?\d+\s*%\s*p)/i],
    /* org·team이 grade보다 앞 — "전사 등급 분포"가 개인 등급으로 새지 않게 */
    ["org", /(전사|회사\s*전체|등급\s*분포|인원\s*현황|조직\s*현황|본부\s*별)/],
    ["team", /(팀원|우리\s*팀|팀\s*현황|팀\s*상황|부서원|구성원\s*현황)/],
    ["grade", /(등급|고과|평가\s*결과|평가\s*점수|종합\s*점수|내\s*평가|평가는|평가\s*근거)/],
    ["checkin", /(체크인|주간\s*보고|진행\s*보고|블로커|막힌)/],
    ["goal", /(목표|okr|\bkr\b|진척|진행\s*상황|달성률|달성도|진도)/i],
    ["feedback", /(피드백|360|다면|상향\s*평가|상향\s*피드백)/],
    ["oneonone", /(1\s*on\s*1|1\s*:\s*1|원온원|면담|일대일)/i],
    ["job", /(직무|역량|스킬|과업|커리어|직무\s*기준)/],
    ["work", /(근무|근태|출퇴근|휴가|연차|초과\s*근무|재택)/],
    ["pay", /(급여|월급|명세서|연말\s*정산|수당|상여)/]
  ];
  var OFF_GREET = /^(안녕|하이|반가|고마|감사|수고|ㅎㅇ|헬로|hi|hello|hey|누구|뭐\s*해|뭐하|테스트|test)/i;
  /* 약한 이동 동사 — "급여명세서 열어줘"처럼 화면 단어 없이 말한 경우 보강 판정 */
  var OFF_NAV_VERB = /(열어|띄워|이동|가\s*줘|가줘|넘어가|바로\s*가)/;

  function offlineIntent(text) {
    var t = String(text || "").trim();
    if (!t) return "unknown";
    if (t.length <= 24 && OFF_GREET.test(t)) return "greet";
    for (var i = 0; i < OFF_INTENTS.length; i++) {
      if (OFF_INTENTS[i][1].test(t)) return OFF_INTENTS[i][0];
    }
    return "unknown";
  }
  function offlineNav(text) {
    if (!window.EZNav || !EZNav.resolve) return null;
    var t = String(text || "");
    var hit = null;
    try { hit = EZNav.resolve(t); } catch (e) { hit = null; }
    if (hit) return hit;
    if (!OFF_NAV_VERB.test(t)) return null;
    /* 화면 단어를 보태 EZNav의 이동 의도 판정을 통과시킨 뒤 동일 라우팅표로 해석 */
    try { return EZNav.resolve(t + " 화면으로") || null; } catch (e2) { return null; }
  }

  /* ---- 의도별 응답 빌더 — 모두 {text, recos?, receipt?} 또는 null ---- */
  function offBlocked(sname, policy) {
    return { text: sname + "님의 해당 기록은 열람 규칙에 따라 표시하지 않습니다.\n\n> " + (policy || "정책 v3.1") };
  }

  function offGoal(sid, sname) {
    var r = ezRun("get_objectives", { emp_id: sid });
    if (!r || r.error) return null;
    if (r.blocked) return offBlocked(sname, r.policy);
    var objs = r.objectives || [];
    if (!objs.length) {
      return { text: sname + "님 이름으로 등록된 목표가 로컬 데이터에 없습니다. 성과관리 › 목표 현황에서 새 목표를 만들 수 있습니다." };
    }
    var sum = 0;
    objs.forEach(function (o) { sum += (o.progress || 0); });
    var avg = Math.round(sum / objs.length * 10) / 10;
    var krCount = 0;
    objs.forEach(function (o) { krCount += (o.key_results || []).length; });
    var md = sname + "님의 담당 목표는 **" + objs.length + "건**, 평균 진척 **" + avg + "%** 입니다.\n\n";
    md += "| 목표 | 진척 | 상태 | KR |\n| --- | --- | --- | --- |\n";
    objs.slice(0, 5).forEach(function (o) {
      md += "| " + o.title + " | " + pctOf(o.progress) + " | " + (o.status || "-") + " | " + ((o.key_results || []).length) + "개 |\n";
    });
    var recos = objs.slice(0, 2).map(function (o) {
      return {
        objective: o.title,
        rationale: "진행률 " + pctOf(o.progress) + " · " + (o.status || ""),
        krs: (o.key_results || []).slice(0, 2).map(function (k) {
          return { name: k.name, target: k.target, weight: k.weight };
        })
      };
    });
    return {
      text: md, recos: recos,
      receipt: offRc({
        title: sname + " · 목표 진척",
        metrics: [
          { k: "담당 목표", v: objs.length + "건" },
          { k: "평균 진척", v: avg + "%" },
          { k: "KR", v: krCount + "개" }
        ],
        srcs: [offSrc("talenx", "talenx 목표·KR"), offSrc("erp", "체크인 진척 스냅샷")],
        whatif: { emp_id: sid, name: sname }
      })
    };
  }

  function offCheckin(sid, sname) {
    var r = ezRun("get_checkins", { emp_id: sid, limit: 5 });
    if (!r || r.error) return null;
    if (r.blocked) return offBlocked(sname, r.policy);
    var cs = r.checkins || [];
    if (!cs.length) return { text: sname + "님의 체크인 기록이 로컬 데이터에 없습니다." };
    var blockers = cs.filter(function (c) { return !!c.blocker; });
    var md = sname + "님의 최근 체크인 **" + cs.length + "건**입니다. 마지막 기록은 **" + (cs[0].date || "-") + "**.\n\n";
    cs.forEach(function (c) {
      md += "- **" + (c.date || "-") + "** · 진척 " + pctOf(c.progress) +
        (c.delta != null ? " (" + (c.delta > 0 ? "+" : "") + c.delta + "%p)" : "") +
        (c.confidence ? " · 확신 " + c.confidence : "") +
        (c.blocker ? " · 블로커 " + c.blocker : "") +
        (c.comment ? " — " + c.comment : "") + "\n";
    });
    return {
      text: md,
      receipt: offRc({
        title: sname + " · 체크인 기록",
        metrics: [
          { k: "최근 체크인", v: cs.length + "건" },
          { k: "마지막", v: cs[0].date || "-" },
          { k: "블로커", v: blockers.length + "건" }
        ],
        srcs: [offSrc("erp", "체크인 원장"), offSrc("talenx", "talenx KR 연결")]
      })
    };
  }

  function offGrade(sid, sname) {
    var r = ezRun("get_employee_profile", { emp_id: sid });
    var ev = r && r.evaluation;
    if (ev && ev.policy) return offBlocked(sname, ev.policy);
    var raw = evalOf(sid);
    if (!ev && !raw) return { text: sname + "님의 확정 평가 기록이 로컬 데이터에 없습니다." };
    var grade = (ev && ev.grade) || (raw && raw.grade);
    var score = (ev && ev.weighted_score) != null ? ev.weighted_score : (raw && raw.weighted_score);
    var period = (ev && ev.period) || (raw && raw.period) || "";
    var c = (raw && raw.components) || {};
    var md = sname + "님 " + period + " 등급은 **" + grade + "** (종합 " + score + "/100)입니다.\n\n";
    if (c.achievement_norm != null) {
      md += "| 구성 요소 | 환산 점수 |\n| --- | --- |\n" +
        "| 목표 달성 | " + c.achievement_norm + " |\n" +
        "| 피어리뷰 | " + c.peer_strength_norm + " |\n" +
        "| 실행 일관성 | " + c.exec_consistency_norm + " |\n";
    }
    if (raw && raw.rationale_summary) md += "\n" + raw.rationale_summary + "\n";
    var rk = roleKey();
    if (rk === "leader" || rk === "hr" || rk === "exec") {
      md += "\n> 강제배분(상위 S~A 상한) 적용 여부에 따라 분포가 달라질 수 있습니다 — 아래 What-if로 재계산하세요.";
    }
    md += "\n> 확정 아님 — 승인·수정·보류는 사람이 결정합니다.";
    return {
      text: md,
      receipt: offRc({
        title: sname + " · 등급 산출",
        metrics: [
          { k: "등급", v: String(grade) },
          { k: "종합 점수", v: score + "/100" },
          { k: "기간", v: period || "-" }
        ],
        srcs: [offSrc("talenx", "평가기록 " + (period || "")), offSrc("rule", "평가규정 v3.1 §12"), offSrc("erp", "실적 대조")],
        whatif: { emp_id: sid, name: sname }
      })
    };
  }

  function offTeam() {
    var r = ezRun("get_team_status", {});
    if (!r || r.error) return null;
    var rows = r.members || [];
    if (!rows.length) return { text: "직속 팀원 데이터가 로컬에 없습니다." };
    var withP = rows.filter(function (m) { return m.avg_progress != null; });
    var avg = withP.length ? Math.round(withP.reduce(function (s, m) { return s + m.avg_progress; }, 0) / withP.length * 10) / 10 : null;
    var blk = rows.filter(function (m) { return !!m.blocker; });
    var md = "팀원 **" + rows.length + "명** 현황입니다. 평균 진척 **" + (avg == null ? "-" : avg + "%") + "**.\n\n";
    md += "| 이름 | 목표 | 평균 진척 | 마지막 체크인 | 등급 초안 |\n| --- | --- | --- | --- | --- |\n";
    rows.slice(0, 10).forEach(function (m) {
      md += "| " + m.name + " | " + m.objectives + "건 | " + pctOf(m.avg_progress) + " | " +
        (m.last_checkin || "-") + " | " + (m.grade_draft || "비노출") + " |\n";
    });
    if (blk.length) {
      md += "\n블로커가 보고된 팀원 " + blk.length + "명: " + blk.map(function (m) { return m.name + "(" + m.blocker + ")"; }).join(", ") + "\n";
    }
    return {
      text: md,
      receipt: offRc({
        title: "팀 현황",
        metrics: [
          { k: "팀원", v: rows.length + "명" },
          { k: "평균 진척", v: (avg == null ? "-" : avg + "%") },
          { k: "블로커", v: blk.length + "명" }
        ],
        srcs: [offSrc("talenx", "talenx 팀 목표"), offSrc("erp", "체크인 대조"), offSrc("rule", "열람 규칙 v3.1")]
      })
    };
  }

  function offOrg() {
    var r = ezRun("get_org_overview", {});
    if (!r || r.error) return null;
    var dist = r.grade_distribution || {};
    var keys = Object.keys(dist).sort();
    var total = 0;
    keys.forEach(function (k) { total += dist[k]; });
    var top = (dist.S || 0) + (dist.A || 0);
    var topPct = total ? Math.round(top * 1000 / total) / 10 : 0;
    var md = (r.company || "전사") + " 인원 **" + r.employees + "명** 기준 등급 분포입니다.\n\n";
    md += "| 등급 | 인원 | 비율 |\n| --- | --- | --- |\n";
    keys.forEach(function (k) {
      md += "| " + k + " | " + dist[k] + "명 | " + (total ? Math.round(dist[k] * 1000 / total) / 10 : 0) + "% |\n";
    });
    var cobj = r.company_objectives || [];
    if (cobj.length) {
      md += "\n전사 목표 " + cobj.length + "건\n";
      cobj.slice(0, 4).forEach(function (o) {
        md += "- " + o.title + " · 진척 " + pctOf(o.progress) + " · " + (o.status || "") + "\n";
      });
    }
    return {
      text: md,
      receipt: offRc({
        title: "전사 성과 조망",
        metrics: [
          { k: "인원", v: r.employees + "명" },
          { k: "상위등급(S+A)", v: topPct + "%" },
          { k: "전사 목표", v: cobj.length + "건" }
        ],
        srcs: [offSrc("talenx", "전사 평가기록"), offSrc("rule", "강제배분 상한 30%"), offSrc("erp", "사업 실적")],
        whatif: { cap_pct: 30 }
      })
    };
  }

  function offFeedback(sid, sname) {
    var rk = roleKey();
    if (rk === "leader" || rk === "hr" || rk === "exec") {
      var uf = ezRun("get_upward_feedback", {});
      if (uf && uf.items && uf.items.length) {
        var md0 = "상향 피드백 **" + uf.items.length + "건**입니다 (응답자 보호 · 익명 집계).\n\n";
        uf.items.forEach(function (it) {
          if (it.note) { md0 += "- " + (it.period || "") + " — " + it.note + "\n"; return; }
          md0 += "- **" + (it.period || "") + "** · 응답 " + (it.respondents || 0) + "명 · " +
            (it.themes || []).map(function (t) { return (t.label || t.theme || t.name || t); }).join(" · ") + "\n";
        });
        return {
          text: md0,
          receipt: offRc({
            title: "상향 피드백",
            metrics: [{ k: "기록", v: uf.items.length + "건" }],
            srcs: [offSrc("talenx", "상향 피드백"), offSrc("rule", "응답자 보호 정책 v3.1")]
          })
        };
      }
    }
    var pc = ezRun("get_prev_cycle", { emp_id: sid });
    if (pc && pc.blocked) return offBlocked(sname, pc.policy);
    var fb = (pc && pc.feedback) || [];
    if (!fb.length) return { text: sname + "님에게 축적된 피드백 기록이 로컬 데이터에 없습니다." };
    var md = sname + "님에게 남은 피드백 **" + fb.length + "건**입니다.\n\n";
    fb.forEach(function (f) {
      md += "- **" + (f.period || "") + "** · " + (f.source_type || "") + " — " + (f.summary || "") + "\n";
    });
    return {
      text: md,
      receipt: offRc({
        title: sname + " · 피드백 이력",
        metrics: [{ k: "피드백", v: fb.length + "건" }],
        srcs: [offSrc("talenx", "피드백 이력")]
      })
    };
  }

  function offOneOnOne(sname) {
    var list = [];
    if (window.EZLedger && EZLedger.list) {
      try {
        list = (EZLedger.list() || []).filter(function (it) { return it && it.type === "oneonone"; });
      } catch (e) { list = []; }
    }
    if (!list.length) {
      return { text: "로컬에 저장된 1:1 기록이 없습니다. 성과관리 › 1:1 미팅에서 기록을 남기면 이후 답변의 근거로 쓰입니다." };
    }
    var md = sname + "님과 연결된 1:1 기록 **" + list.length + "건**입니다.\n\n";
    list.slice(0, 5).forEach(function (it) {
      md += "- **" + (it.at || "") + "** " + it.title + (it.summary ? " — " + it.summary : "") + "\n";
    });
    return {
      text: md,
      receipt: offRc({
        title: "1:1 기록",
        metrics: [{ k: "기록", v: list.length + "건" }],
        srcs: [offSrc("talenx", "성과 기록 원장")]
      })
    };
  }

  function offJob(sid, sname) {
    var r = ezRun("get_job_profile", { emp_id: sid });
    if (!r || r.error) return { text: (r && r.error) || (sname + "님의 직무 프로파일을 찾지 못했습니다.") };
    var p = r.profile || {};
    var md = sname + "님의 직무는 **" + (p.title || r.jobTitle || "-") + "** (" + (p.group || "") + (p.series ? " · " + p.series : "") + ")입니다.\n\n";
    if (p.mission) md += p.mission + "\n\n";
    var areas = p.task_areas || [];
    if (areas.length) {
      md += "주요 과업\n";
      areas.slice(0, 3).forEach(function (a) {
        md += "- **" + a.area + "** — " + (a.tasks || []).slice(0, 3).join(" / ") + "\n";
      });
      md += "\n";
    }
    var comps = p.competency_profile || [];
    if (comps.length) {
      md += "직무 기준 역량\n";
      comps.forEach(function (c) { md += "- " + c.name + " · 가중 " + c.weight + "\n"; });
      md += "\n";
    }
    var sk = (p.skills || []).slice(0, 8).map(function (s) { return s.name; });
    if (sk.length) md += "기대 스킬 — " + sk.join(", ") + "\n";
    return {
      text: md,
      receipt: offRc({
        title: sname + " · 직무 기준",
        metrics: [
          { k: "과업 영역", v: areas.length + "개" },
          { k: "기준 역량", v: comps.length + "종" },
          { k: "기대 스킬", v: (p.skills || []).length + "종" }
        ],
        srcs: [offSrc("talenx", "직무 프로파일 " + (p.job_id || "")), offSrc("rule", "역량 사전")]
      })
    };
  }

  function offWhatIf(sid, sname, text) {
    var t = String(text || "");
    var delta = null, cap = null;
    var dm = /([+-]?\d+(?:\.\d+)?)\s*%\s*p/i.exec(t);
    if (dm) delta = Number(dm[1]);
    if (delta == null) {
      var dm2 = /(달성률|달성도|실적|진척)[^0-9+-]{0,8}([+-]?\d+(?:\.\d+)?)/.exec(t);
      if (dm2) delta = Number(dm2[2]);
    }
    var cm = /(상한|강제\s*배분|배분|캡|cap)[^0-9]{0,8}(\d+(?:\.\d+)?)/i.exec(t);
    if (cm) cap = Number(cm[2]);
    if (delta != null && /하락|떨어|하향|감소|낮아/.test(t) && delta > 0) delta = -delta;
    if (delta == null && cap == null) delta = -10;
    var wi = { emp_id: sid, name: sname };
    if (delta != null) wi.achievement_delta = delta;
    if (cap != null) wi.cap_pct = cap;
    var md = sname + "님 기준으로 " +
      (delta != null ? "달성률 **" + delta + "%p**" : "") +
      (delta != null && cap != null ? " · " : "") +
      (cap != null ? "상위등급 상한 **" + cap + "%**" : "") +
      " 가정의 재계산을 준비했습니다. 아래 **[↺ What-if 재계산]**을 누르면 로컬 엔진이 실계산합니다.\n\n" +
      "> 읽기 전용 — 실제 평가 데이터는 변경되지 않습니다.";
    return {
      text: md,
      receipt: offRc({
        title: sname + " · What-if 가정",
        metrics: [
          { k: "달성률 가정", v: (delta == null ? "-" : delta + "%p") },
          { k: "배분 상한", v: (cap == null ? "미적용" : cap + "%") }
        ],
        srcs: [offSrc("rule", "평가규정 v3.1 등급컷"), offSrc("talenx", "현재 평가기록")],
        whatif: wi
      })
    };
  }

  function offNoData(kind) {
    var m = (kind === "pay")
      ? { label: "급여관리", what: "급여 명세·연말정산" }
      : { label: "근무관리", what: "근무·휴가 기록" };
    return {
      text: "AI 미연결 상태입니다 — " + m.what + " 원천 데이터는 이 데모의 로컬 데이터셋에 없어 수치로 답할 수 없습니다. 지어내지 않겠습니다.\n\n" +
        "지금 확인 가능한 것\n" +
        "- **" + m.label + " 화면**에서 직접 조회 — \"" + m.label + " 화면으로 가줘\"라고 하면 이동합니다\n" +
        "- 목표·체크인·평가 등급·팀 현황·직무 기준은 로컬 데이터로 바로 답할 수 있습니다"
    };
  }

  function offGreet() {
    return {
      text: "안녕하세요, " + CURRENT.name + "님. elizax입니다.\n\n" +
        "지금은 **AI 미연결** 상태라 로컬 데이터 조회로만 답합니다. 목표 진척 · 체크인 · 평가 등급 · 팀 현황 · 직무 기준 · What-if 재계산을 물어보세요."
    };
  }

  function offUnknown() {
    return {
      text: "AI 미연결 상태입니다 — 이 질문은 연결 후 답할 수 있습니다 (헤더 ⚙에서 연결).\n\n" +
        "지금 확인 가능한 것\n" +
        "- 내 목표·KR 진척 — \"내 목표 진척 알려줘\"\n" +
        "- 최근 체크인·블로커 — \"최근 체크인 보여줘\"\n" +
        "- 평가 등급과 산출 근거 — \"내 등급 근거가 뭐야\"\n" +
        "- 팀 현황 / 전사 등급 분포 — 조직장·HR 권한\n" +
        "- 직무 기준·기대 역량 — \"내 직무 기준 알려줘\"\n" +
        "- What-if 재계산 — \"달성률 -10%p면 등급 어떻게 돼?\"\n" +
        "- 화면 이동 — \"급여 화면으로 가줘\""
    };
  }

  /* 질문 의도 → 로컬 데이터 조회 → 영수증. 미매칭이면 가짜 영수증 대신 정직한 안내. */
  function offlineReceipt(body, userText) {
    var p = body.perspective || "subject";
    var sid = body.emp_id || CURRENT.emp_id;
    var sname = (needsSubject(p) && state.subject) ? state.subject.name : CURRENT.name;
    var q = String(userText || "");
    var intent = offlineIntent(q);
    var out = null;
    if (intent === "greet") out = offGreet();
    else if (intent === "whatif") out = offWhatIf(sid, sname, q);
    else if (intent === "grade") out = offGrade(sid, sname);
    else if (intent === "checkin") out = offCheckin(sid, sname);
    else if (intent === "goal") out = offGoal(sid, sname);
    else if (intent === "team") out = offTeam();
    else if (intent === "org") out = offOrg();
    else if (intent === "feedback") out = offFeedback(sid, sname);
    else if (intent === "oneonone") out = offOneOnOne(sname);
    else if (intent === "job") out = offJob(sid, sname);
    else if (intent === "work") out = offNoData("work");
    else if (intent === "pay") out = offNoData("pay");
    if (!out) { out = offUnknown(); intent = "unknown"; }
    return {
      text: out.text,
      recos: out.recos || [],
      receipt: out.receipt || null,
      intent: intent
    };
  }

  function offlineRespond(body, aiMsg, userText) {
    /* ① 화면 이동 요청 — EZNav 1차 판정이 놓친 약한 표현("…열어줘")까지 실제 이동 */
    var nav = offlineNav(userText);
    if (nav) {
      aiMsg.text = "화면 전환 · **" + nav.label + "**(으)로 이동합니다.";
      aiMsg.streaming = false;
      aiMsg.note = "AI 미연결 · 화면 이동은 로컬에서 처리";
      finishStreaming();
      renderMessages();
      setTimeout(function () {
        try { EZNav.go(nav.s, nav.p); } catch (e) { console.warn("[elizax nav]", e); }
      }, 320);
      return;
    }
    var built = offlineReceipt(body, userText);
    var full = built.text;
    var idx = 0;
    var step = Math.max(6, Math.round(full.length / 40));
    function tick() {
      if (!state.streaming) return;
      idx = Math.min(full.length, idx + step);
      aiMsg.text = full.slice(0, idx);
      refreshBubble(aiMsg);
      if (idx < full.length) {
        setTimeout(tick, 24);
      } else {
        aiMsg.streaming = false;
        if (built.recos && built.recos.length) aiMsg.recos = built.recos;
        aiMsg.receipt = built.receipt || null;
        if (built.receipt) {
          if (!aiMsg.meta) aiMsg.meta = {};
          aiMsg.meta.receipt = built.receipt;   /* 세션 복원 후에도 카드로 남도록 */
        }
        aiMsg.note = built.receipt
          ? "AI 미연결 · 로컬 데이터 조회 결과"
          : (built.intent === "unknown" ? "AI 미연결 — 연결 후 답변 가능" : "AI 미연결 · 로컬 확인 결과");
        aiMsg.noteWarn = built.intent === "unknown";
        finishStreaming();
        renderMessages();
      }
    }
    setTimeout(tick, 120);
  }

  function readSSE(res, aiMsg) {
    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";

    function handleEvent(raw) {
      // raw is one SSE event block; collect data: lines
      var dataLines = raw.split(/\r?\n/).filter(function (l) { return l.indexOf("data:") === 0; });
      if (!dataLines.length) return;
      var payload = dataLines.map(function (l) { return l.replace(/^data:\s?/, ""); }).join("\n");
      if (payload === "[DONE]") return;
      var msg;
      try { msg = JSON.parse(payload); } catch (e) { return; }
      applyEvent(msg, aiMsg);
    }

    function pump() {
      return reader.read().then(function (r) {
        if (r.done) {
          if (buffer.trim()) handleEvent(buffer);
          aiMsg.streaming = false;
          finishStreaming();
          renderMessages();
          return;
        }
        buffer += decoder.decode(r.value, { stream: true });
        var parts = buffer.split(/\n\n/);
        buffer = parts.pop(); // keep incomplete tail
        parts.forEach(handleEvent);
        return pump();
      });
    }
    return pump();
  }

  function applyEvent(msg, aiMsg) {
    if (aiMsg && aiMsg._stopped && msg && msg.type === "chunk") return;
    if (!msg || !msg.type) {
      // some servers send bare {response:...}
      if (msg && msg.response) { aiMsg.text = msg.response; refreshBubble(aiMsg); }
      return;
    }
    if (msg.type === "chunk") {
      completeWork(aiMsg);
      aiMsg.text += (msg.content || "");
      refreshBubble(aiMsg);
    } else if (msg.type === "done") {
      completeWork(aiMsg);
      aiMsg.streaming = false;
      extractCtxRefs(aiMsg); /* 실인용 근거 마커 → meta.ctxRefs */
      /* LLM이 화면 이동을 지시했으면 마커 제거 후 실행 */
      if (window.EZNav && window.EZNav.extractMarker) {
        try {
          var ext = window.EZNav.extractMarker(aiMsg.text);
          if (ext.nav) {
            aiMsg.text = ext.clean;
            aiMsg.note = "화면 전환 · " + ext.nav.label;
            setTimeout(function () {
              var ok = false;
              try { ok = window.EZNav.go(ext.nav.s, ext.nav.p); } catch (e) { console.error("[elizax nav]", e); }
              if (!ok) console.warn("[elizax nav] target not found:", ext.nav.s, ext.nav.p);
            }, 380);
          }
        } catch (e) { /* ignore */ }
      }
      if (msg.recommendations && msg.recommendations.length) aiMsg.recos = msg.recommendations;
      if (msg.truncated) { aiMsg.note = "일부 생략됨"; }
      saveHistory();
      renderMessages();
    } else if (msg.type === "fallback") {
      completeWork(aiMsg);
      aiMsg.streaming = false;
      aiMsg.text = msg.response || aiMsg.text || "";
      aiMsg.note = "AI 미연결 — 기본 응답";
      renderMessages();
    } else if (msg.type === "error") {
      aiMsg.role = "err";
      aiMsg.streaming = false;
      aiMsg.text = msg.message || "오류가 발생했습니다.";
      renderMessages();
    }
  }

  /* fast in-place update of the streaming bubble (avoids full re-render) */
  function refreshBubble(aiMsg) {
    if (!aiMsg._bubble) { renderMessages(); return; }
    aiMsg._bubble.innerHTML = mdToHtml(stripCtxMarker(aiMsg.text || ""));
    if (aiMsg.streaming) aiMsg._bubble.appendChild(h("span", "ezx-caret"));
    scrollToBottom();
  }

  /* 영속화·이벤트는 EZChat 스토어가 담당 (push 시 자동 저장+통지) */
  function pushMessage(m) {
    if (window.EZChat) return EZChat.push(m);
    _localMsgs.push(m);
    return m;
  }
  function saveHistory() {
    if (window.EZChat) EZChat.save();
  }

  /* ---------------- Reset ---------------- */
  function resetConversation() {
    if (state.streaming) stopStreaming();
    if (window.EZChat) EZChat.clearCurrent();
    else _localMsgs = [];
    renderMessages();
    var url = API_BASE + "/api/chat/reset";
    try {
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emp_id: resolveEmpIds().emp_id })
      }).catch(function () { /* ignore */ });
    } catch (e) { /* ignore */ }
  }

  /* ---------------- Open / close ---------------- */
  /* 컴포저 상단 연결 상태 배너 — proxy/direct/offline 3모드 */
  function updateStatus() {
    if (!el.status) return;
    var m = aiMode();
    var rdy = !!(window.EZAI && EZAI.ready && EZAI.ready());
    if (m === "offline") {
      el.status.innerHTML = '<span class="off">○ 오프라인 — 예시 응답 · ⚙에서 AI 연결</span>';
    } else if (rdy) {
      el.status.innerHTML = '<span class="ok">● 연결됨</span> · '
        + esc(window.EZAI && EZAI.modeLabel ? EZAI.modeLabel() : m);
    } else {
      el.status.innerHTML = '<span class="wait">◐ 연결 확인 중</span>';
    }
  }

  function openPanel() {
    state.open = true;
    el.root.classList.add("ezx-open");
    syncPerspectiveFromRole();
    updateScreenChip();
    /* updateAiBadge는 폐기됨 — 연결 상태는 ezx-status 배너(updateStatus)로 일원화 */
    updateStatus();
    updateFabCount();
    setTimeout(function () { try { el.textarea.focus(); } catch (e) {} }, 220);
  }
  function closePanel() {
    state.open = false;
    el.root.classList.remove("ezx-open");
    if (el.pickerList) el.pickerList.classList.remove("on");
    try { el.fab.focus(); } catch (e) {}
  }

  /* ---------------- 외부 진입용 탭 API — setTab(단일 구현)에 위임 ----------------
     tx_ctx_ledger 등 외부 호출자의 Elizax.showTab("rec", entryId) 계약 유지 */
  function showTab(key, hl) {
    if (!state.open) openPanel();
    setTab(key, hl || null);
  }

  /* ---------------- Public API ---------------- */
  window.Elizax = {
    open: openPanel,
    close: closePanel,
    send: function (text) {
      if (!state.open) openPanel();
      if (text) sendMessage(String(text));
    },
    /* --- 전체화면 허브·기능 모듈 연동 API --- */
    sendRaw: function (text) {          /* 패널 열지 않고 전송 (허브 컴포저용) */
      if (text) sendMessage(String(text));
    },
    attachSurface: function (listEl) {  /* 대화 렌더 대상을 외부 컨테이너로 전환 */
      state.surface = listEl || null;
      renderMessages();
    },
    detachSurface: function () {        /* FAB 리스트로 복귀 */
      state.surface = null;
      renderMessages();
    },
    isStreaming: function () { return state.streaming; },
    showTab: showTab,                   /* [Phase1 IA] 도킹 패널 탭 전환 ("chat"|"rec"|"ntf"[, highlightId]) */
    stopStreaming: stopStreaming,
    regenerate: regenerate,
    refresh: renderMessages,
    reset: resetConversation,
    perspective: function () { return state.perspective; }
  };

  /* ---------------- Init ---------------- */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
