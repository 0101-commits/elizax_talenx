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
  /* talenx가 로그인시켜 둔 사람 — 역할 전환은 meta.currentUser를 갈아끼우므로 매번 다시 읽는다 */
  function curUser() {
    try {
      var cu = window.TALENX_DATA && window.TALENX_DATA.meta && window.TALENX_DATA.meta.currentUser;
      if (cu && cu.emp_id) return cu;
    } catch (e) { /* ignore */ }
    return CURRENT;
  }
  /* 19차 §5-2 — 대상은 talenx가 정한다.
     예전에는 조직장·경영진 관점이면 첫 직속 부하를 자동으로 골라 헤더 검색창에 띄웠다.
     그래서 talenx는 「최정남」인데 elizax는 남의 이름으로 답하는 어긋남이 생겼다.
     이제 기본 대상은 언제나 로그인한 본인이고, 다른 사람 이야기는 대화 안에서 이름을 말해 정한다. */
  function defaultSubject() {
    var cu = curUser();
    return { emp_id: cu.emp_id, name: cu.name, jobTitle: cu.jobTitle || "" };
  }
  function isSelfSubject() {
    return !state.subject || state.subject.emp_id === curUser().emp_id;
  }
  /* 이름 앞뒤가 말이 끊기는 자리인지 — "이지민님"은 잡고 "이지민수"는 안 잡는다 */
  function nameHit(text, name) {
    var i = text.indexOf(name);
    while (i >= 0) {
      var before = i === 0 ? "" : text.charAt(i - 1);
      var after = text.charAt(i + name.length);
      var okBefore = !before || /[\s,.!?·("'\[]/.test(before);
      var okAfter = !after || /[\s,.!?·)"'\]님씨의은는이가을를과와도만부터에한테께]/.test(after);
      if (okBefore && okAfter) return true;
      i = text.indexOf(name, i + 1);
    }
    return false;
  }
  /* 사용자 문장에서 사원 이름을 찾아 대상을 바꾼다. 바꿨으면 그 사람 정보를 돌려준다.
     이름이 없으면 null — 호출자는 팀 전체 집계로 답한다. */
  function setSubjectByName(text) {
    var t = String(text || "");
    if (!t) return null;
    var rk = roleKey();
    if (rk !== "leader" && rk !== "hr" && rk !== "exec") return null;   /* 조직원은 남의 기록을 못 본다 */
    var best = null;
    for (var i = 0; i < EMPLOYEES.length; i++) {
      var e = EMPLOYEES[i];
      var nm = e && e.name ? String(e.name) : "";
      if (nm.length < 2) continue;
      if (!nameHit(t, nm)) continue;
      if (!best || nm.length > String(best.name).length) best = e;
    }
    if (!best) return null;
    if (state.subject && state.subject.emp_id === best.emp_id) return null;   /* 이미 그 사람 */
    state.subject = { emp_id: best.emp_id, name: best.name, jobTitle: best.jobTitle || "" };
    /* 1:1 화면(드롭다운·미팅 카드)도 같은 사람을 보게 한다 — 대화에서 이름을 말했는데
       옆 화면은 다른 사람이 떠 있으면 한 화면에 두 사람이 동시에 보인다 */
    if (window.EZPeer) EZPeer.set(best.emp_id, "elizax");
    return state.subject;
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
  var DEFAULT_TAB = "chat";  /* 18-2차 R1 — 기본 진입 = 대화(빈 채팅창). 알림은 그 다음 */
  var curTab = DEFAULT_TAB;
  var pastOpen = false;      /* [알림] 탭 「지난 알림」 접힘 상태 */
  var pastTouched = false;   /* 사용자가 직접 접었다 → 자동 펼침(카드 0장 폴백)보다 우선 */
  var pastAll = false;       /* 「지난 알림」 30건 초과 시 「더 보기」를 눌렀는가 */
  var sigOpenId = null;      /* [알림] 탭에서 지금 펼쳐 둔 줄 — 한 번에 하나만 */

  /* ---------------- EZNotif — 알림 단일 스토어 (§6 잔존형 알림: 토스트→FAB 카운트→[알림] 탭) ---------------- */
  var EZNotif = (function () {
    var KEY = "ezk_notif_v1", MIG = "ezk_notif_mig_v19b", MAX = 50, subs = [];
    var migrated = false;
    /* 19차 §5-3 — 「지난 알림」에 쌓여 있던 쓰레기 1회 청소.
       읽을 내용이 없는 항목(제목이 「알림」뿐 · 테스트 알림 · 폴백 확인)이 50건 상한을
       채워 버려서, 정작 사람이 받은 알림은 밀려나 사라지고 목록은 빈 줄만 보였다. */
    function junk(n) {
      if (!n || !n.title) return true;
      var t = String(n.title).replace(/^\s+|\s+$/g, "");
      var b = String(n.body || "").replace(/^\s+|\s+$/g, "");
      if (t === "알림" && (!b || b === "알림")) return true;
      if (/^테스트\s*알림/.test(t) || /^테스트\s*알림/.test(b)) return true;
      if (t.indexOf("폴백 확인") >= 0 || b.indexOf("폴백 확인") >= 0) return true;
      return false;
    }
    /* 이미 쌓인 본문에는 카드 버튼 글자가 문장에 달라붙어 있다
       ("…벌어졌어요열어보기나중에이 밖에 1건 더"). 글자를 키우니 그대로 드러나서
       한 번에 걷어낸다. 새로 들어오는 알림은 tx_proactive가 문장만 담는다. */
    var GLUE = /(열어보기|나중에|이\s*밖에\s*\d+건\s*더|다시\s*실행)+\s*$/;
    function repair(n) {
      if (!n || !n.body) return n;
      var b = String(n.body).replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
      var cut = b.replace(GLUE, "").replace(/^\s+|\s+$/g, "");
      while (GLUE.test(cut)) cut = cut.replace(GLUE, "").replace(/^\s+|\s+$/g, "");
      if (cut && cut !== b) n.body = cut;
      return n;
    }
    function raw() {
      try { var a = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(a) ? a : []; }
      catch (e) { return []; }
    }
    function load() {
      var arr = raw();
      if (migrated) return arr;
      migrated = true;
      var done = false;
      try { done = localStorage.getItem(MIG) === "1"; } catch (e) { done = true; }
      if (done) return arr;
      var before = JSON.stringify(arr);
      var kept = arr.filter(function (n) { return !junk(n); }).map(repair);
      try { localStorage.setItem(MIG, "1"); } catch (e) { /* ignore */ }
      if (JSON.stringify(kept) !== before) { save(kept); return kept; }
      return arr;
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
        if (junk(n)) return null;   /* 읽을 내용이 없는 알림은 애초에 쌓지 않는다 */
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
    /* ⚙(AI 연결 설정) 버튼 삭제 — 18차 요청 4. EZAI.openSettings 함수는 그대로 남는다
       (tx_fix_msf.js 등 외부 호출자용). 🔍(tx_chat_search) 주입 앵커는 .ezx-expand 왼쪽. */
    var xbtn = h("button", "ezx-x", { "aria-label": "닫기", text: "✕" });
    xbtn.addEventListener("click", closePanel);
    top.appendChild(mark); top.appendChild(titles); top.appendChild(exbtn); top.appendChild(xbtn);
    head.appendChild(top);

    /* 2탭 IA — 대화(기본 진입) / 알림 (18-2차 R6: 대화가 먼저, 알림이 그 다음.
       기록 탭은 알림 탭 「지난 알림」으로 접음 — 18차 결정 ③ 유지) */
    var tabs = h("div", "ezx-tabs");
    el.tabBtns = {};
    [["chat", "대화"], ["ntf", "알림"]].forEach(function (d) {
      var b = h("button", "ezx-tab" + (d[0] === DEFAULT_TAB ? " on" : ""), { type: "button", "data-tab": d[0] });
      b.innerHTML = "<span>" + d[1] + "</span><span class=\"ezx-tab-dot\" hidden></span>"
        + (d[0] === "ntf" ? "<span class=\"ezx-tab-n\" hidden></span>" : "");
      b.addEventListener("click", function () { setTab(d[0]); });
      el.tabBtns[d[0]] = b;
      tabs.appendChild(b);
    });

    /* perspective 스트립 제거 — 관점 자동전환 로직(setPerspective)은 유지, 시각 chrome만 삭제 */
    el.persp = null;

    /* 「대상 직원 검색」 입력·드롭다운 삭제 (19차 §5-2).
       elizax에서 사람을 고르지 않는다 — 대상은 talenx가 로그인시킨 사람이고,
       다른 사람 이야기는 대화 안에서 이름을 말하면 그때 바뀐다(setSubjectByName). */
    el.pickerInput = null; el.pickerList = null;

    /* 맥락 칩 행 삭제 — 신원칩·현재 화면칩·「현재 화면 맥락」 토글 3종 제거 (18차 요청 2).
       state.attachContext는 true 고정(buildPayloadMessage 계약 불변).
       단 tx_journey(사이클 칩)·tx_jobcontext(내 직무 칩)가 폴링으로 이 노드에
       appendChild 하므로 — 두 파일은 이번 차 소유가 아니라 고칠 수 없다 —
       빈 숨김 노드를 남겨 두 모듈의 appendChild가 계속 성공하게 한다. */
    var ctx = h("div", "ezx-ctx", { hidden: "hidden", "aria-hidden": "true" });
    el.screenChip = null;

    /* message list */
    var list = h("div", "ezx-list", { role: "log", "aria-live": "polite" });
    el.list = list;

    /* [알림] 패인 — 라이브 알림 한 줄 목록 + 「지난 알림」 접이식.
       성과 기록은 여기 들어오지 않는다 (19차 §5-3) — 자기 패널에서 연다. */
    var ntfPane = h("div", "ezx-pane ezx-ntf-pane");
    el.ntfPane = ntfPane;

    /* footer / composer */
    var foot = h("div", "ezx-foot");
    /* AI 미연결 단일 폴백 줄 — 「● 연결됨 · AI 연결됨」 상태 배너 삭제 (18차 요청 2) */
    var status = h("div", "ezx-note warn ezx-warnline", { hidden: "hidden" });
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
    /* 「대화 초기화」+주입되던 「내보내기」 → 「＋ 새 채팅 시작」 한 칸 (18차 요청 2) */
    var nchat = h("button", "ezx-newchat", { type: "button", text: "＋ 새 채팅 시작" });
    nchat.addEventListener("click", newChat);
    var hint = h("span", "ezx-hint", { text: "Enter 전송 · Shift+Enter 줄바꿈" });
    footRow.appendChild(nchat); footRow.appendChild(hint);
    foot.appendChild(comp); foot.appendChild(footRow);
    el.textarea = ta; el.send = send;

    /* 탭 스트립·패인은 위(el.tabBtns / el.ntfPane)에서 이미 구성됨 —
       구 data-ezx-tab 스트립·.ezx-tabpane 이중 생성은 제거(astryx 리스킨 CSS가 .ezx-mode-* 단일 방식) */
    el.tabs = tabs;

    panel.appendChild(head);
    panel.appendChild(tabs);
    panel.appendChild(ctx);
    panel.appendChild(list);
    panel.appendChild(ntfPane);
    panel.appendChild(foot);

    root.appendChild(fab);
    root.appendChild(panel);
    document.body.appendChild(root);
    el.root = root; el.fab = fab; el.panel = panel;

    // Esc closes
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (el.cat) { closeCatalog(); return; }   /* 질문 브라우저가 먼저 닫힌다 */
      if (state.open) closePanel();
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
    /* 신호 엔진(W1)은 뒤늦게 로드될 수 있다 — 늦은 폴링으로 한 번만 구독 */
    subscribeSignals();
    /* 기본 진입 탭 = 대화(빈 채팅창). 배지는 알림 탭을 실제로 볼 때만 지워진다 */
    curTab = DEFAULT_TAB;
    el.root.classList.toggle("ezx-mode-ntf", curTab === "ntf");
    updateFabCount();
    updateStatus();
    /* 성과 기록이 늘었다 — 알림 탭 안내 줄의 건수만 다시 그린다 */
    document.addEventListener("ezl:changed", function () {
      if (curTab === "ntf") renderNtf(null);
    });
  }

  /* 신호 엔진 변경 구독 — 엔진 부재 시 최대 20회(≈8초) 재시도 후 포기 */
  var _sigSubbed = false;
  function subscribeSignals() {
    if (_sigSubbed) return;
    var tries = 0;
    (function poll() {
      if (_sigSubbed) return;
      if (window.EZSignalEngine && window.EZSignalEngine.onChange) {
        _sigSubbed = true;
        try {
          window.EZSignalEngine.onChange(function (ev) {
            updateFabCount();
            if (curTab === "ntf") renderNtf();
            if (!msgs().length) renderMessages();   /* 추천 대화 버튼 갱신 */
            /* 20-4차 — 처리가 실제로 끝나면 그 결과와 이어 물을 말을 대화에 남긴다.
               낙관적으로 미리 쓰지 않는다. 엔진이 「했다」고 알려 줄 때만 쓴다. */
            if (ev && ev.id && ev.rec && ev.rec.st === "acted") pushSigDone(String(ev.id));
          });
        } catch (e) { /* ignore */ }
        updateFabCount();
        if (curTab === "ntf") renderNtf();
        if (!msgs().length) renderMessages();
        return;
      }
      if (++tries < 20) setTimeout(poll, 400);
    })();
  }

  /* ---------------- 2탭 전환 (알림 · 대화) ----------------
     hl = 성과 기록 하이라이트 대상 entry id.
     외부 계약 유지: showTab("rec", id) → 성과 기록 패널 + 해당 행 하이라이트. */
  /* 19차 §5-3 — 「알림」과 「성과 기록」은 다른 것이다.
     알림 = elizax가 먼저 건넨 말. 성과 기록 = 답변의 근거가 된 내 기록.
     그래서 "rec"은 더 이상 알림 탭으로 접히지 않고 성과 기록 자기 패널을 연다.

     주의(재진입): EZLedger.openPanel은 허브가 닫혀 있으면 다시 Elizax.showTab("rec")을
     부른다. 그대로 두면 무한 왕복이므로, 우리가 연 왕복이라는 표시가 켜져 있을 때만
     throw해서 EZLedger가 자기 폴백(슬라이드 패널)으로 착지하게 한다. 그쪽 호출은
     try/catch 안이라 예외가 밖으로 새지 않는다. */
  var recBusy = false;
  function openLedger(hl) {
    if (recBusy) throw new Error("ezx:rec-reentry");
    if (!(window.EZLedger && EZLedger.openPanel)) return false;
    recBusy = true;
    try { EZLedger.openPanel(hl || null); }
    catch (e) { /* 원장 모듈 오류 — 조용히 무시 */ }
    recBusy = false;
    return true;
  }
  function setTab(k, hl) {
    if (k === "rec") { openLedger(hl); return; }
    if (k !== "chat" && k !== "ntf") k = DEFAULT_TAB;
    curTab = k;
    el.root.classList.toggle("ezx-mode-ntf", k === "ntf");
    for (var t in el.tabBtns) el.tabBtns[t].classList.toggle("on", t === k);
    if (k === "ntf") {
      toggleTabDot("ntf", false);
      renderNtf(hl || null);
      EZNotif.markAllRead();
      if (hl) scrollPastIntoView();
    }
  }
  function toggleTabDot(k, on) {
    var d = el.tabBtns && el.tabBtns[k] && el.tabBtns[k].querySelector(".ezx-tab-dot");
    if (d) d.hidden = !on;
  }

  /* ---- 미처리 알림 수 — 신호 엔진이 있으면 그 수, 없으면 EZNotif 미확인 수 ----
     (배지 폭주 근본원인 = 만료 문맥칩까지 EZNotif로 아카이브되던 것. 기준을 신호로 옮긴다) */
  function signalPending() {
    if (!window.EZSignalEngine || !window.EZSignalEngine.pending) return null;
    try {
      var arr = window.EZSignalEngine.pending(roleKey());
      return (arr && typeof arr.length === "number") ? arr : null;
    } catch (e) { return null; }
  }
  function pendingCount() {
    var arr = signalPending();
    if (arr) return arr.length;
    try { return EZNotif.unreadCount(); } catch (e) { return 0; }
  }
  function updateFabCount() {
    var n = pendingCount();
    var label = "처리하지 않은 알림 " + n + "건";
    var txt = n > 9 ? "9+" : String(n);
    if (el.cnt) {
      el.cnt.hidden = n === 0;
      el.cnt.textContent = txt;
      el.cnt.title = label;
    }
    var tn = el.tabBtns && el.tabBtns.ntf && el.tabBtns.ntf.querySelector(".ezx-tab-n");
    if (tn) { tn.hidden = n === 0; tn.textContent = txt; tn.title = label; }
    if (el.fab) el.fab.title = n ? ("elizax · " + label) : "elizax";
  }

  function scrollPastIntoView() {
    var b = el.ntfPane && el.ntfPane.querySelector(".ezx-past");
    if (b && b.scrollIntoView) { try { b.scrollIntoView({ block: "nearest" }); } catch (e) { /* ignore */ } }
  }

  /* ---- 기존 EZNotif 행 마크업·markRead 동작 그대로 ---- */
  function fillNtfRows(host, arr) {
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
      host.appendChild(row);
    });
  }

  /* 알림 미리보기 두 문장 — 자연문 답변(EZSignalChat.answerText)의 앞머리만 자른다.
     새 문구를 지어내지 않는다: 대화에서 받을 답의 첫 두 문장이 그대로 미리보기다. */
  function previewOf(id) {
    var full = "";
    if (window.EZSignalChat && EZSignalChat.answerText) {
      try { full = String(EZSignalChat.answerText(id) || ""); } catch (e) { full = ""; }
    }
    full = full.replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
    if (!full) return "";
    var out = "", n = 0, i, ch;
    for (i = 0; i < full.length; i++) {
      ch = full.charAt(i);
      out += ch;
      if (ch === "." || ch === "!" || ch === "?") { n++; if (n >= 2) break; }
    }
    out = out.replace(/^\s+|\s+$/g, "");
    if (out.length > 140) out = out.slice(0, 139) + "…";
    return out;
  }
  /* 화면으로 갈 수 있는 알림인지 — 갈 곳이 없으면 그 출구를 아예 만들지 않는다 */
  function screenTargetOf(inst) {
    if (!inst || !(window.EZSignalAct && EZSignalAct.targetOf && EZSignalAct.openScreen)) return null;
    try { return EZSignalAct.targetOf(inst, 0) || null; } catch (e) { return null; }
  }

  /* [알림] 탭 = 한 줄 목록(18-2차 R6) + 접힌 「지난 알림」(EZNotif 행 + 성과 기록).
     한 줄 = 알림 문구 한 문장뿐. 유형칩·단계칩·범위칩·근거·처리 버튼 전부 없다.
     줄을 누르면 제자리에서 펼쳐져 무슨 얘기인지 두 문장 보여 주고, 거기서 두 갈래로
     나간다 — 「대화에서 이어보기」(전체 답변) · 「관련 화면 열기」(갈 곳이 있을 때만).
     한 번에 한 줄만 펼쳐진다. 「지난 알림」의 EZNotif 행은 손대지 않는다.
     성과 기록은 여기 없다 — 맨 아래 한 줄 링크로 자기 패널을 연다(19차 §5-3).
     엔진이 없으면 목록을 비우고 「지난 알림」을 펼쳐 폴백한다 — 어떤 경우에도 throw하지 않는다. */
  function renderNtf(hl) {
    var p = el.ntfPane;
    if (!p) return;
    p.innerHTML = "";

    /* (1) 미처리 알림 — 한 줄 = 문장 하나 */
    var nLive = 0;
    var insts = signalPending();
    if (insts && insts.length) {
      var live = h("div", "ezx-sig-live");
      /* 보는 자리를 한 줄로 밝힌다 — 같은 38건을 받는 HR과 경영진이 왜 다른 순서로
         보는지 사용자가 알 수 있게. 순위 점수·유형 코드는 쓰지 않는다. */
      if (window.EZPersona && EZPersona.lens) {
        var lens = EZPersona.lens(roleKey());
        live.appendChild(h("div", "ezx-sig-lens", { text: lens.title + " · " + lens.hint }));
      }
      insts.forEach(function (inst) {
        var line = inst && (inst.notice || (inst.sig && inst.sig.notice));
        if (!line) return;
        var id = inst.id || "";
        var open = !!id && sigOpenId === id;
        var item = h("div", "ezx-sig-item" + (open ? " open" : ""));
        var row = h("button", "ezx-sig-row", {
          type: "button", text: String(line), "aria-expanded": open ? "true" : "false"
        });
        row.addEventListener("click", function () {
          sigOpenId = (sigOpenId === id) ? null : id;   /* 한 번에 하나만 */
          renderNtf(null);
        });
        item.appendChild(row);
        if (open) {
          var ex = h("div", "ezx-sig-ex");
          var pv = previewOf(id);
          ex.appendChild(h("div", "ezx-sig-pv", {
            text: pv || "무슨 얘기인지는 대화에서 바로 확인할 수 있어요."
          }));
          var exits = h("div", "ezx-sig-exits");
          var goChat = h("button", "ezx-sig-exit", { type: "button", text: "대화에서 이어보기" });
          goChat.addEventListener("click", function () {
            sigOpenId = null;
            askSignal(id, String(line));
          });
          exits.appendChild(goChat);
          if (screenTargetOf(inst)) {
            var goScr = h("button", "ezx-sig-exit go", { type: "button", text: "관련 화면 열기" });
            goScr.addEventListener("click", function () {
              try { EZSignalAct.openScreen(inst, 0); }
              catch (e) { /* 모듈 부재 — 조용하게 무시 */ }
            });
            exits.appendChild(goScr);
          }
          ex.appendChild(exits);
          item.appendChild(ex);
        }
        live.appendChild(item);
        nLive++;
      });
      if (nLive) p.appendChild(live);
    }

    var arr = EZNotif.list();
    if (!nLive) {
      p.appendChild(h("div", "ezx-pane-empty ezx-sig-none", {
        text: arr.length ? "지금 처리할 알림이 없어요. 지난 알림을 아래에 모아 두었어요."
          : "지금 처리할 알림이 없어요."
      }));
    }

    /* (2) 지난 알림 — 접이식. 라이브 줄이 없으면 자동 펼침(구 동작 보존),
       단 사용자가 한 번 접었으면 그 선택을 존중한다 */
    var open = pastOpen || (!nLive && !pastTouched);
    var past = h("div", "ezx-past");
    var hd = h("button", "ezx-past-h", { type: "button", "aria-expanded": open ? "true" : "false" });
    hd.innerHTML = '<span class="ezx-past-ar">' + (open ? "▾" : "▸") + "</span><span>지난 알림</span>"
      + (arr.length ? '<span class="ezx-past-n">' + arr.length + "</span>" : "");
    var bd = h("div", "ezx-past-bd");
    if (!open) bd.hidden = true;
    hd.addEventListener("click", function () {
      pastTouched = true;
      pastOpen = !open;
      pastAll = false;
      renderNtf(null);
    });
    /* 이 서랍이 무엇을 모아 둔 곳인지 한 줄로 밝힌다 — 성과 기록과 헷갈리지 않게 */
    bd.appendChild(h("div", "ezx-past-cap", { text: "elizax가 건넨 알림을 모아 둔 곳이에요." }));
    if (arr.length) {
      /* 30건이 넘으면 최근 20건만 — 나머지는 눌러서 펼친다 */
      var shown = (!pastAll && arr.length > 30) ? arr.slice(0, 20) : arr;
      fillNtfRows(bd, shown);
      if (shown.length < arr.length) {
        var more = h("button", "ezx-past-more", {
          type: "button", text: "더 보기 · 지난 알림 " + (arr.length - shown.length) + "건"
        });
        more.addEventListener("click", function () { pastAll = true; renderNtf(null); });
        bd.appendChild(more);
      }
    } else {
      bd.appendChild(h("div", "ezx-pane-empty", { text: "지난 알림이 아직 없어요." }));
    }
    past.appendChild(hd); past.appendChild(bd);
    p.appendChild(past);

    /* (3) 성과 기록으로 가는 길 한 줄 — 저장소가 다르다는 것을 말로 밝힌다 */
    var lg = h("button", "ezx-ntf-ledger", {
      type: "button", text: "답변의 근거가 된 내 기록은 성과 기록에서 볼 수 있어요"
    });
    lg.addEventListener("click", function () {
      try { openLedger(hl || null); } catch (e) { /* 원장 미로드 — 조용히 무시 */ }
    });
    p.appendChild(lg);

    /* (4) 신호 카탈로그로 가는 길 한 줄 (20차 §1) — 「어떤 알림이 오게 되어 있는가」를
       알림이 오기 전에도 볼 수 있어야 한다. 건수는 카탈로그에서 직접 센다. */
    var catN = 0;
    try { catN = ((window.EZSignalCatalog || {}).signals || []).length; } catch (e0) { catN = 0; }
    if (catN) {
      var cl = h("button", "ezx-ntf-ledger", {
        type: "button", text: "오게 되어 있는 알림 " + catN + "건을 미리 볼 수 있어요"
      });
      cl.addEventListener("click", function () { openCatalog(); });
      p.appendChild(cl);
    }
    updateFabCount();   /* 렌더 시점의 미처리 수와 배지를 항상 일치시킨다 */
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
      state.subject = defaultSubject();   /* 역할이 바뀌면 대상도 그 사람 본인으로 되돌린다 */
      if (window.EZPeer) EZPeer.set(state.subject.emp_id, "elizax");   /* 되돌린 것도 알린다 */
    }
    var lab = el.persp && el.persp.querySelector("[data-ezx-plabel]");
    if (lab) lab.textContent = perspectiveLabel(p);
    syncSubjectUI();
  }
  /* 1:1 화면에서 상대를 바꾸면 대화 대상도 그 사람으로 따라간다.
     단서 둘 — ① 조직원은 남의 기록을 못 보므로 따라가지 않는다(setSubjectByName와 같은 기준).
     ② 꼬리표가 "-init"이면 사람이 고른 게 아니라 화면이 처음 그려지며 알린 기본값이다.
     이걸 받으면 페이지를 열자마자 대화 대상이 첫 팀원으로 밀려 「talenx는 본인인데
     elizax는 남의 이름으로 답하는」 19차 §5-2 어긋남이 되살아난다. */
  if (window.EZPeer) EZPeer.onChange(function (peer, src) {
    if (src === "elizax" || /-init$/.test(src)) return;
    var rk = roleKey();
    if (rk !== "leader" && rk !== "hr" && rk !== "exec") return;
    if (state.subject && state.subject.emp_id === peer.emp_id) return;
    var e = null;
    for (var i = 0; i < EMPLOYEES.length; i++) if (EMPLOYEES[i].emp_id === peer.emp_id) { e = EMPLOYEES[i]; break; }
    if (!e) return;
    state.subject = { emp_id: e.emp_id, name: e.name, jobTitle: e.jobTitle || "" };
    syncSubjectUI();
  });

  /* 대상 선택 UI가 사라졌으므로 남은 일은 화면칩 갱신뿐 —
     호출자 3곳(setPerspective·syncPerspectiveFromRole·build)을 위해 함수는 유지한다. */
  function syncSubjectUI() {
    if (el.root) el.root.classList.remove("ezx-need-subject");
    updateScreenChip();
  }

  /* 화면칩은 18차에 삭제됨 — 호출자 4곳(syncSubjectUI·openPanel·GNB 클릭·build)을
     그대로 두기 위해 함수는 남기고 대상 노드가 없으면 조용히 빠진다. */
  function updateScreenChip() {
    if (!el.screenChip) return;
    var label = activeScreenLabel();
    var txt = "현재 화면 " + label;
    if (!isSelfSubject()) txt = state.subject.name + "님 기준 · " + label;
    el.screenChip.textContent = txt;
  }

  /* 지금 누구 이야기를 하는가 + 묻는 사람은 누구인가.
     기본은 본인이고, 대화에서 이름을 말했을 때만 대상과 요청자가 갈린다. */
  function resolveEmpIds() {
    var me = curUser().emp_id;
    if (state.subject && state.subject.emp_id && state.subject.emp_id !== me) {
      return { emp_id: state.subject.emp_id, actor_emp_id: me };
    }
    return { emp_id: me, actor_emp_id: undefined };
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
    /* pending 신호 답은 아직 그리지 않는다 — 확인 카드가 끝나면 깨어난다 (20-6차) */
    msgs().forEach(function (m) {
      if (m.role === "sig" && m.pending) return;
      list.appendChild(buildMsgNode(m));
    });
    scrollToBottom();
  }
  /* 역할마다 처음 물어보게 되는 세 가지 — 고정 스타터 (19차 §5-6) */
  var FIXED_STARTERS = {
    member: ["내 목표 진행상황 점검", "이번 달 근무기록 확인", "급여명세서 열어줘"],
    leader: ["우리 팀 진척 정리해줘", "이번 주 1:1 안건 잡아줘", "팀 평가 준비 상태 봐줘"],
    hr: ["조직별 목표 진행률 비교해줘", "평가 진행이 밀린 곳 알려줘", "이번 분기 인원 현황 보여줘"],
    exec: ["전사 목표 진행 상황 요약해줘", "조직 간 격차 큰 곳 알려줘", "평가 일정 위험한 곳 알려줘"]
  };
  function buildEmptyState() {
    var role = roleKey();
    var wrap = h("div", "ezx-empty");
    wrap.appendChild(h("div", "eh", { text: "무엇을 도와드릴까요?" }));
    wrap.appendChild(h("div", "es", {
      text: "목표·평가·근무·급여를 실제 기록으로 확인하고, 필요하면 그 화면까지 열어 드려요."
    }));

    /* 연결 상태 문구(● 연결됨 / AI 미연결 배너)는 컴포저 위 단일 폴백 줄(updateStatus)로 일원화 */

    /* (1) 지금 볼 만한 것 — 실제 기록을 보고 고른 질문 6개(2열).
       각 질문은 스스로 답을 만들 수 있는지 검사를 통과한 것만 온다(EZSignalChat.suggested). */
    var sugg = [];
    if (window.EZSignalChat && EZSignalChat.suggested) {
      try {
        var raw = EZSignalChat.suggested(role) || [];
        for (var qi = 0; qi < raw.length && sugg.length < 6; qi++) {
          var it = raw[qi];
          if (it && it.q) sugg.push({ q: String(it.q), id: it.id ? String(it.id) : "" });
        }
      } catch (e) { sugg = []; }
    }
    /* suggested가 아직 없으면 예전 starters로 물러선다 — 빈 화면을 만들지 않는다 */
    if (!sugg.length && window.EZSignalChat && EZSignalChat.starters) {
      try {
        var raw2 = EZSignalChat.starters(role) || [];
        for (var qj = 0; qj < raw2.length && sugg.length < 6; qj++) {
          var it2 = raw2[qj];
          if (it2 && it2.q) sugg.push({ q: String(it2.q), id: it2.id ? String(it2.id) : "" });
        }
      } catch (e2) { /* ignore */ }
    }
    if (sugg.length) {
      wrap.appendChild(h("div", "ezx-scn-lab", { text: "지금 볼 만한 것" }));
      var grid = h("div", "ezx-sugg");
      sugg.forEach(function (x) {
        var b = h("button", "ezx-starter scn", { type: "button", text: x.q });
        b.addEventListener("click", function () { askSignal(x.id, x.q); });
        grid.appendChild(b);
      });
      wrap.appendChild(grid);
    }

    /* (2) 역할별 고정 스타터 3개 */
    var starters = h("div", "ezx-starters");
    (FIXED_STARTERS[role] || FIXED_STARTERS.member).forEach(function (s) {
      var b = h("button", "ezx-starter", { text: s, type: "button" });
      b.addEventListener("click", function () { sendMessage(s); });
      starters.appendChild(b);
    });
    wrap.appendChild(starters);

    /* (3) 신호 카탈로그 열람으로 가는 한 줄 (20차 §1 — 물어볼 수 있는 것 전부와 그 설계) */
    var more = h("button", "ezx-catlink", { type: "button", text: "물어볼 수 있는 것 전부 보기" });
    more.addEventListener("click", function () { openCatalog(); });
    wrap.appendChild(more);
    return wrap;
  }

  /* ---------------- 질문 브라우저 (19차 §5-6) ----------------
     "무엇을 물어보면 되는지 모르겠다"에 대한 답. 지금 역할이 받을 수 있는 질문을
     단계별로 묶어 보여 주고, 누르면 그대로 보낸다. 오른쪽 한 낱말로 지금 답이
     나오는지(지금 확인 가능) 기록이 더 쌓여야 하는지(기록 준비 중) 밝힌다.
     단계 이름은 칩이 아니라 묶음 제목이고, 분류어 대신 일하는 때로 말한다(R2). */
  var CAT_GROUPS = [
    ["목표수립", "목표를 세울 때"],
    ["중간점검", "진행 중간에 볼 때"],
    ["평가", "평가할 때"],
    ["피드백", "피드백을 나눌 때"]
  ];
  function catStageOf(id) {
    var s = String(id || "");
    var cut = s.indexOf("-");
    return cut > 0 ? s.slice(0, cut) : "";
  }
  /* 도킹 패널이 지금 눈에 보이는가 — display·visibility·opacity 로만 판단한다 */
  function panelShown() {
    if (!el.panel) return false;
    var cs = null;
    try { cs = window.getComputedStyle(el.panel); } catch (e) { return false; }
    if (!cs) return false;
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    return parseFloat(cs.opacity || "1") > 0.05;
  }
  function closeCatalog() {
    if (el.cat && el.cat.parentNode) el.cat.parentNode.removeChild(el.cat);
    el.cat = null;
  }
  /* 20차 §1 — 질문 목록을 신호 카탈로그 열람으로 넓힌다.
     여기는 답변 화면이 아니라 설계 원본을 그대로 보는 자리다. 그래서 답변에서는
     감추는 분류 이름(단계·받는 사람·언제 오는 알림인가)을 오히려 밝혀 적는다.
     대신 기계 식별자는 여기서도 내보내지 않는다 — 근거·참조는 scrub()을 지나며
     사람이 읽는 이름으로 바뀌고, 기준값의 내부 코드(TH-…)는 아예 그리지 않는다. */
  var catFilter = { stage: "", live: false, mine: false, q: "" };
  var CAT_STAGE_CHIPS = [["", "전체"], ["목표수립", "목표수립"], ["중간점검", "중간점검"],
    ["평가", "평가"], ["피드백", "피드백"]];
  /* 실계산 가능 여부는 카탈로그 `now`(설계 시점 판단)가 아니라 엔진에게 묻는다 (20-4차) */
  function canEval(id) {
    try {
      if (window.EZSignalEngine && EZSignalEngine.hasEval) return !!EZSignalEngine.hasEval(id);
    } catch (e) { /* 구버전 엔진 */ }
    var s = catSig(id);
    return !!(s && s.now === 1);
  }
  function catSig(id) {
    var cat = window.EZSignalCatalog;
    var list = (cat && cat.signals) || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }
  function catClean(text) {
    var s = String(text == null ? "" : text);
    if (window.EZSignalChat && EZSignalChat.scrub) {
      try { s = EZSignalChat.scrub(s); } catch (e) { /* 원문 유지 */ }
    }
    return s.replace(/\{\{\s*팀원명\s*\}\}/g, "어떤 팀원")
      .replace(/\{\{\s*조직명\s*\}\}/g, "어떤 조직")
      .replace(/\{\{\s*목표명\s*\}\}/g, "어떤 목표")
      .replace(/\{\{[^}]*\}\}/g, "");
  }
  /* 상세 한 묶음 = 제목 + 줄들. 빈 묶음은 만들지 않는다(없는 것을 있는 척하지 않는다) */
  function catBlock(wrap, title, lines) {
    var real = (lines || []).filter(function (t) { return t && String(t).replace(/\s/g, ""); });
    if (!real.length) return;
    wrap.appendChild(h("div", "ezx-cd-h", { text: title }));
    real.forEach(function (t) { wrap.appendChild(h("div", "ezx-cd-l", { text: String(t) })); });
  }
  function catDetail(sig, q) {
    var wrap = h("div", "ezx-cat-det");
    if (!sig) {
      wrap.appendChild(h("div", "ezx-cd-l", { text: "이 알림의 설계 내용을 아직 불러오지 못했어요." }));
      return wrap;
    }
    var meta = h("div", "ezx-cd-meta");
    [sig.stage,
      sig.actor === "HR경영진" ? "HR·경영진" : (sig.actor === "상위조직장" ? "상위 조직장" : sig.actor),
      sig.level,
      canEval(sig.id) ? "지금 확인 가능" : "기록이 더 쌓여야 확인 가능"
    ].forEach(function (t) { if (t) meta.appendChild(h("span", "ezx-cd-chip", { text: String(t) })); });
    wrap.appendChild(meta);

    catBlock(wrap, "이 알림이 오는 때", [catClean(sig.principle)]);
    catBlock(wrap, "화면에 나가는 문장", [catClean(sig.notice)]);

    catBlock(wrap, "무엇을 근거로 말하는가", (sig.evidence || []).map(function (e) {
      var lead = e.axis ? "(" + e.axis + ") " : "";
      return lead + catClean(e.text) + (e.assumed ? " (추정)" : "");
    }));

    catBlock(wrap, "쓰는 기준값 (모두 예시)", (sig.thresholds || []).map(function (t) {
      return t.name + " = " + t.value + (t.range && t.range !== t.value ? " (조정 범위 " + t.range + ")" : "");
    }));
    catBlock(wrap, "무엇과 비교하는가", [sig.compare && sig.compare !== "없음" ? sig.compare : ""]);
    catBlock(wrap, "판단할 때 읽는 기록", [catClean(sig.refs)]);

    var acts = (sig.actions || []).slice().sort(function (a, b) { return (a.rank || 9) - (b.rank || 9); });
    catBlock(wrap, "받은 사람이 할 수 있는 일", acts.map(function (a) {
      return a.kind + " · " + catClean(a.label) + (a.store ? " → 남는 기록 : " + catClean(a.store) : "");
    }));

    var m = sig.mute || {};
    catBlock(wrap, "알림 조절", [
      m.repeat ? "다시 보내기 : " + m.repeat : "",
      m.minCount && m.minCount !== "해당 없음" ? "묶어 보내는 최소 건수 : " + m.minCount : "",
      m.clear ? "그만 보내는 때 : " + m.clear : ""
    ]);

    if (!canEval(sig.id)) {
      catBlock(wrap, "켜기 전에 남은 일", [
        sig.todoDecide ? "사람이 정할 것 : " + catClean(sig.todoDecide) : "",
        sig.todoCreate ? "새로 만들 기록 : " + catClean(sig.todoCreate) : "",
        (!sig.todoDecide && !sig.todoCreate && sig.ai) ? sig.ai + "에 켤 수 있어요" : ""
      ]);
    }

    var go = h("button", "ezx-cd-go", { type: "button", text: "이 질문 보내기" });
    go.addEventListener("click", function () {
      closeCatalog();
      askSignal(sig.id, q);
    });
    wrap.appendChild(go);
    wrap.appendChild(h("div", "ezx-cd-note", {
      text: canEval(sig.id)
        ? "지금 이 질문을 보내면 실제 기록으로 센 답이 옵니다."
        : "지금 보내면 예시 숫자로 답합니다. 무엇이 없어서 못 셌는지도 같이 말해 줍니다."
    }));
    return wrap;
  }

  /* focusId 를 주면 그 신호를 펼친 채로 연다 — 답변 말풍선의 「자세히」가 쓴다 (20-3차).
     걸러 놓은 조건이 그 신호를 숨기면 펼칠 것이 없으므로 조건을 함께 푼다. */
  function openCatalog(focusId) {
    closeCatalog();
    if (focusId) catFilter = { stage: "", live: false, mine: false, q: "" };
    var role = roleKey();
    var rows = [];
    if (window.EZSignalChat && EZSignalChat.catalogQuestions) {
      try { rows = EZSignalChat.catalogQuestions(role) || []; } catch (e) { rows = []; }
    }
    var ov = h("div", "ezx-cat", { role: "dialog", "aria-label": "신호 카탈로그", "aria-modal": "false" });
    var box = h("div", "ezx-cat-box");
    var hd = h("div", "ezx-cat-hd");
    hd.appendChild(h("div", "ezx-cat-t", { text: "신호 카탈로그" }));
    hd.appendChild(h("div", "ezx-cat-n", { text: rows.length + "건" }));
    var x = h("button", "ezx-cat-x", { type: "button", "aria-label": "닫기", text: "✕" });
    x.addEventListener("click", closeCatalog);
    hd.appendChild(x);
    box.appendChild(hd);

    /* 고르는 줄 — 무엇을 물어볼 수 있는지 좁혀 보는 장치 */
    var tools = h("div", "ezx-cat-tools");
    var find = h("input", "ezx-cat-find", {
      type: "search", value: catFilter.q,
      placeholder: "질문·문장으로 찾기", "aria-label": "카탈로그 검색"
    });
    tools.appendChild(find);
    var chips = h("div", "ezx-cat-chips");
    CAT_STAGE_CHIPS.forEach(function (c) {
      var b = h("button", "ezx-cat-chip", { type: "button", text: c[1], "data-stage": c[0] });
      b.addEventListener("click", function () { catFilter.stage = c[0]; draw(); });
      chips.appendChild(b);
    });
    var bLive = h("button", "ezx-cat-chip", { type: "button", text: "지금 확인 가능", "data-flag": "live" });
    bLive.addEventListener("click", function () { catFilter.live = !catFilter.live; draw(); });
    chips.appendChild(bLive);
    var bMine = h("button", "ezx-cat-chip", { type: "button", text: "내가 받는 것", "data-flag": "mine" });
    bMine.addEventListener("click", function () { catFilter.mine = !catFilter.mine; draw(); });
    chips.appendChild(bMine);
    tools.appendChild(chips);
    box.appendChild(tools);

    var cap = h("div", "ezx-cat-cap");
    box.appendChild(cap);
    var bd = h("div", "ezx-cat-bd");
    var openId = focusId ? String(focusId) : "";

    function keep(r) {
      if (!r || !r.q) return false;
      if (catFilter.stage && catStageOf(r.id) !== catFilter.stage) return false;
      if (catFilter.live && !r.live) return false;
      if (catFilter.mine && !r.mine) return false;
      var q = catFilter.q.replace(/\s/g, "").toLowerCase();
      if (q) {
        var sig = catSig(r.id);
        var hay = String(r.q) + " " + (sig ? sig.notice + " " + sig.principle + " " + sig.actor : "");
        if (hay.replace(/\s/g, "").toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    }
    function row(r) {
      var wrap = h("div", "ezx-cat-item" + (openId === r.id ? " open" : ""));
      var b = h("button", "ezx-cat-row", { type: "button", "aria-expanded": openId === r.id ? "true" : "false" });
      var left = h("span", "qwrap");
      left.appendChild(h("span", "q", { text: String(r.q) }));
      var sig = catSig(r.id);
      if (sig) left.appendChild(h("span", "nt", { text: catClean(sig.notice) }));
      b.appendChild(left);
      b.appendChild(h("span", "st" + (r.live ? " on" : ""), { text: r.live ? "지금 확인 가능" : "기록 준비 중" }));
      b.addEventListener("click", function () { openId = (openId === r.id) ? "" : r.id; draw(); });
      wrap.appendChild(b);
      if (openId === r.id) wrap.appendChild(catDetail(sig, String(r.q)));
      return wrap;
    }
    function draw() {
      /* 칩 상태를 다시 그린다 — 목록만 갈아끼우면 눌린 칩이 안 따라온다 */
      var cbs = chips.querySelectorAll(".ezx-cat-chip"), ci, cb, on;
      for (ci = 0; ci < cbs.length; ci++) {
        cb = cbs[ci];
        if (cb.getAttribute("data-flag") === "live") on = catFilter.live;
        else if (cb.getAttribute("data-flag") === "mine") on = catFilter.mine;
        else on = (cb.getAttribute("data-stage") || "") === catFilter.stage;
        cb.className = "ezx-cat-chip" + (on ? " on" : "");
      }
      bd.innerHTML = "";
      var shown = rows.filter(keep), drawn = 0, used = {};
      CAT_GROUPS.forEach(function (g) {
        var list = shown.filter(function (r) {
          if (used[r.id]) return false;
          if (catStageOf(r.id) !== g[0]) return false;
          used[r.id] = 1;
          return true;
        });
        if (!list.length) return;
        bd.appendChild(h("div", "ezx-cat-sec", { text: g[1] }));
        list.forEach(function (r) { bd.appendChild(row(r)); drawn++; });
      });
      var rest = shown.filter(function (r) { return !used[r.id]; });
      if (rest.length) {
        bd.appendChild(h("div", "ezx-cat-sec", { text: "그 밖에" }));
        rest.forEach(function (r) { bd.appendChild(row(r)); drawn++; });
      }
      if (!drawn) {
        bd.appendChild(h("div", "ezx-pane-empty", {
          text: rows.length ? "고른 조건에 맞는 알림이 없어요." : "카탈로그를 아직 불러오지 못했어요."
        }));
      }
      var live = shown.filter(function (r) { return r.live; }).length;
      cap.textContent = rows.length
        ? drawn + "건 보임 · 지금 확인 가능 " + live + "건 · 카탈로그 전체 " + rows.length + "건"
        : "";
    }
    var timer = null;
    find.addEventListener("input", function () {
      catFilter.q = find.value || "";
      if (timer) clearTimeout(timer);
      timer = setTimeout(draw, 120);
    });
    draw();
    box.appendChild(bd);
    ov.appendChild(box);
    ov.addEventListener("click", function (ev) { if (ev.target === ov) closeCatalog(); });
    /* 전체화면(허브)에서는 도킹 패널이 닫혀 있다. 그 안에 붙이면 아무것도 안 보인다.
       패널이 화면에 없으면 문서에 붙이고 fixed 로 띄운다(20차).
       패널은 position:fixed 라 offsetParent 가 늘 null 이다 — 실제 표시값으로 가른다. */
    var host = panelShown() ? el.panel : null;
    if (!host) {
      /* 색 토큰은 astryx `@scope ([data-astryx-theme="talenx"])` 안에서만 산다.
         문서에 그냥 붙이면 배경·글자색이 전부 사라져 뒤 화면이 그대로 비친다.
         오버레이 자신에게 그 표시를 달아 스코프 뿌리로 만든다. */
      ov.className = "ezx-cat fixed";
      ov.setAttribute("data-astryx-theme", "talenx");
      host = document.body;
    }
    host.appendChild(ov);
    el.cat = ov;
  }

  /* 신호를 대화로 연다 — EZSignalChat.ask가 topic을 걸고 Elizax.send로 자연어 질문을 보낸다.
     모듈 부재 시에도 사용자는 답을 받아야 하므로 문장 그대로 대화에 태운다(R6 폴백). */
  function askSignal(id, fallbackText) {
    setTab("chat");
    if (id && window.EZSignalChat && EZSignalChat.ask) {
      try { EZSignalChat.ask(id); return; } catch (e) { /* fall through */ }
    }
    if (fallbackText) sendMessage(String(fallbackText));
  }

  /* ---------------- 새 채팅 시작 (푸터 단일 버튼) ---------------- */
  function newChat() {
    if (state.streaming) stopStreaming();
    if (window.EZChat && EZChat.newSession) {
      try { EZChat.newSession(); renderMessages(); return; } catch (e) { /* fall through */ }
    }
    resetConversation();   /* EZChat 부재 폴백 — 기존 초기화 경로 */
  }

  /* ---------------- 「확인 내역」 = 살아 있는 피드 (19차 §5-4) ----------------
     예전에는 스텝 아이콘(○◉✓)만 갈아끼우고 헤더 글자만 깜빡여서, 네 줄이 처음부터
     전부 떠 있는 정지 화면처럼 보였다. 사용자가 "작업 중인데 멈춰 있는 것 같다"고 한
     그 화면이다. 셋을 바꾼다.
       ① 스텝은 처음부터 다 있지 않다 — 하나씩 아래로 나타난다(380~900ms 난수 간격).
       ② 진행 중인 줄은 타이핑 점 3개로 지금 손이 가 있음을 보인다.
       ③ 끝난 줄은 ✓ 와 함께 「무엇을 봤는지」를 실제 건수로 말한다.
     헤더에는 0.1초 단위 경과 시간과 불확정 진행 막대가 흐르고, 끝나면
     「확인 끝 · 2.4초 · 근거 4건」으로 접힌다(헤더를 누르면 다시 펼쳐진다).
     움직임을 줄이도록 설정한 사용자에게는 CSS가 애니메이션을 끄고 초 단위로만 센다. */

  function reduceMotion() {
    try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
    catch (e) { return false; }
  }
  function nArr(k) { var v = DATA[k]; return Object.prototype.toString.call(v) === "[object Array]" ? v : []; }
  function countBy(k, fn) {
    var a = nArr(k), n = 0;
    for (var i = 0; i < a.length; i++) { if (fn(a[i])) n++; }
    return n;
  }
  function ledgerCount() {
    if (!(window.EZLedger && EZLedger.list)) return 0;
    try { return (EZLedger.list() || []).length; } catch (e) { return 0; }
  }
  /* 대본 스텝 — 각 줄이 실제로 센 건수를 말한다. 못 센 값은 아예 줄을 만들지 않는다. */
  function scriptSteps(p) {
    var me = resolveEmpIds().emp_id;
    var myObjIds = {};
    var myObjs = countBy("objectives", function (o) {
      if (o && o.owner_emp_id === me) { myObjIds[o.objective_id] = 1; return true; }
      return false;
    });
    var myKrs = countBy("keyResults", function (k) { return k && myObjIds[k.objective_id]; });
    var myChk = countBy("checkins", function (c) { return c && c.emp_id === me; });
    var team = countBy("employees", function (e) { return e && e.manager_id === me; });
    var teamIds = {};
    nArr("employees").forEach(function (e) { if (e && e.manager_id === me) teamIds[e.emp_id] = 1; });
    var teamChk = countBy("checkins", function (c) { return c && teamIds[c.emp_id]; });
    var teamObjs = countBy("objectives", function (o) { return o && teamIds[o.owner_emp_id]; });
    var headcount = nArr("employees").length;
    var orgs = nArr("orgs").length;
    var evals = nArr("evaluations").length;
    var allObjs = nArr("objectives").length;
    var lg = ledgerCount();
    var lgFound = lg ? "내 기록 " + lg + "건" : "아직 쌓인 기록 없음";
    var out = [];
    /* run = 지금 하고 있는 말 · done = 끝나고 하는 말. 두 말투를 함께 들고 다닌다 */
    function add(run, done, found) { if (found) out.push({ run: run, done: done, found: found }); }
    if (p === "manager") {
      add("팀원들의 목표를 펼쳐 보는 중", "팀원들의 목표를 펼쳐 봤어요", team + "명 · 목표 " + teamObjs + "건");
      add("최근 체크인을 훑는 중", "최근 체크인을 훑었어요", "체크인 " + teamChk + "건");
      add("평가 기준을 맞춰 보는 중", "평가 기준을 맞춰 봤어요", "평가 기록 " + evals + "건 기준");
      add("지난 대화와 성과 기록을 불러오는 중", "지난 대화와 성과 기록을 불러왔어요", lgFound);
    } else if (p === "hr") {
      add("전사 인원과 조직을 확인하는 중", "전사 인원과 조직을 확인했어요", headcount + "명 · " + orgs + "개 조직");
      add("평가 기록을 모으는 중", "평가 기록을 모아 봤어요", "평가 기록 " + evals + "건");
      add("목표 진행 상황을 대조하는 중", "목표 진행 상황을 대조했어요", "목표 " + allObjs + "건");
      add("지난 대화와 성과 기록을 불러오는 중", "지난 대화와 성과 기록을 불러왔어요", lgFound);
    } else if (p === "executive") {
      add("전사 목표 정렬을 살피는 중", "전사 목표 정렬을 살펴봤어요", "목표 " + allObjs + "건 · " + orgs + "개 조직");
      add("평가 분포를 계산하는 중", "평가 분포를 계산했어요", "평가 기록 " + evals + "건");
      add("조직별 인원을 확인하는 중", "조직별 인원을 확인했어요", headcount + "명");
      add("지난 브리핑과 성과 기록을 불러오는 중", "지난 브리핑과 성과 기록을 불러왔어요", lgFound);
    } else {
      add("내 목표와 핵심 성과를 살피는 중", "내 목표와 핵심 성과를 살펴봤어요", myObjs + "건 · 핵심 성과 " + myKrs + "개");
      add("체크인 기록을 훑는 중", "체크인 기록을 훑었어요", "체크인 " + myChk + "건");
      add("평가 기준을 맞춰 보는 중", "평가 기준을 맞춰 봤어요", "평가 기록 " + evals + "건 기준");
      add("지난 대화와 성과 기록을 불러오는 중", "지난 대화와 성과 기록을 불러왔어요", lgFound);
    }
    if (!out.length) {
      out.push({ run: "지금 볼 수 있는 기록을 확인하는 중", done: "지금 볼 수 있는 기록을 확인했어요", found: "확인 완료" });
    }
    return out;
  }
  function makeWorkMsg(p) {
    return {
      role: "work", steps: [], plan: scriptSteps(p), done: false,
      t0: Date.now(), ms: 0, collapsed: false, _timers: [], _tick: null
    };
  }
  /* ---- 신호 답변용 작업중 카드 (20-6차) ----------------------------------
     신호의 답은 룰베이스로 이미 다 계산돼 있다. 그렇다고 사용자가 묻자마자 통째로
     내려놓으면 「어디서 나온 말인지」가 화면에서 사라진다 — 답이 먼저 뜨고 근거를
     나중에 대는 순서가 되기 때문이다. 그래서 이 카드가 그 신호가 실제로 본
     기록(evidence[].src)을 한 줄씩 세우고, 다 세운 뒤에 답을 앉힌다.
     지어낸 스텝이 아니다: 줄도 값도 판정 함수가 실제로 읽은 것 그대로다. */
  function sigWorkPlan(sid) {
    var inst = null;
    try {
      if (window.EZSignalEngine && EZSignalEngine.evaluate) inst = EZSignalEngine.evaluate(sid, roleKey());
    } catch (e) { inst = null; }
    var out = [], seen = {};
    ((inst && inst.evidence) || []).forEach(function (ev) {
      var src = String((ev && ev.src) || "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
      if (!src || seen[src]) return;
      seen[src] = 1;
      out.push({ run: src + " 확인하는 중", done: src + " 확인했어요", found: String(ev.emph || "") || "확인" });
    });
    var th = (inst && inst.thresholds) || [];
    if (th.length) {
      out.push({
        run: "회사 기준값과 대조하는 중", done: "회사 기준값과 대조했어요",
        found: String(th[0].name || "기준값") + " " + String(th[0].value || "")
      });
    }
    return out.length ? out.slice(0, 5) : null;
  }
  function makeSigWorkMsg(sid, p) {
    var plan = sigWorkPlan(sid);
    return {
      role: "work", steps: [], plan: plan || scriptSteps(p), done: false,
      t0: Date.now(), ms: 0, collapsed: false, _timers: [], _tick: null
    };
  }
  /* ---- 라이브 작업중 카드: Claude tool-use 이벤트로 실제 실행 내역 표시 ---- */
  function makeLiveWorkMsg() {
    return {
      role: "work", live: true, steps: [], plan: [], done: false,
      t0: Date.now(), ms: 0, collapsed: false, _timers: [], _tick: null
    };
  }
  /* 0.1초 아래로는 내려가지 않는다 — 「0초」는 안 센 것처럼 읽힌다 */
  function secText(ms) {
    var s = Math.max(0, ms) / 1000;
    if (reduceMotion()) return Math.max(1, Math.round(s)) + "초";
    return Math.max(0.1, Math.round(s * 10) / 10) + "초";
  }
  function workHTML(m) {
    var elapsed = m.done ? (m.ms || 0) : (Date.now() - (m.t0 || Date.now()));
    var doneN = 0;
    m.steps.forEach(function (s) { if (s.st === 2) doneN++; });
    var html;
    if (m.done) {
      html = '<button type="button" class="ezx-work-hd done" aria-expanded="' + (m.collapsed ? "false" : "true") + '">' +
        '<span class="ezx-work-ar">' + (m.collapsed ? "▸" : "▾") + "</span>" +
        /* 도구를 한 번도 안 부른 답에 「근거 0건」이라고 적으면, 바로 아래 규칙
           영수증에 근거가 여러 줄 보이는 것과 싸운다. 그럴 때는 건수를 뺀다. */
        "<span>확인 끝 · " + esc(secText(elapsed)) + (doneN ? " · 근거 " + doneN + "건" : "") + "</span></button>";
    } else {
      html = '<div class="ezx-work-hd">' +
        '<span class="ezx-work-mk">✦</span><span>elizax가 확인하는 중</span>' +
        '<span class="ezx-work-el" data-ezx-el="1">' + esc(secText(elapsed)) + "</span></div>" +
        '<div class="ezx-work-bar" aria-hidden="true"></div>';
    }
    var body = "";
    if (m.live && !m.steps.length) {
      body += '<div class="ezx-work-ln st1"><span class="ck">·</span>' +
        "<span>무엇부터 볼지 정하는 중</span>" + dotsHTML() + "</div>";
    }
    m.steps.forEach(function (s) {
      if (s.st === 2) {
        body += '<div class="ezx-work-ln st2"><span class="ck">✓</span><span>' + esc(s.label) +
          '</span><span class="fnd">' + esc(s.found || "") + "</span></div>";
      } else {
        body += '<div class="ezx-work-ln st1"><span class="ck">·</span><span>' + esc(s.label) +
          "</span>" + dotsHTML() + "</div>";
      }
    });
    html += '<div class="ezx-work-bd"' + (m.collapsed ? ' hidden="hidden"' : "") + ">" + body + "</div>";
    return html;
  }
  function dotsHTML() {
    return '<span class="ezx-dots" aria-hidden="true"><span></span><span></span><span></span></span>';
  }
  function refreshWork(m) {
    if (m && m._node) { m._node.innerHTML = workHTML(m); scrollToBottom(); }
  }
  /* 경과 시간만 제자리에서 갱신 — 스텝 DOM을 다시 그리면 등장 애니메이션이 매번 재시작한다 */
  function startTick(m) {
    if (m._tick) return;
    var every = reduceMotion() ? 1000 : 100;
    m._tick = setInterval(function () {
      if (m.done) { stopTick(m); return; }
      if (!m._node || !document.body.contains(m._node)) return;
      var n = m._node.querySelector("[data-ezx-el]");
      if (n) n.textContent = secText(Date.now() - (m.t0 || Date.now()));
    }, every);
  }
  function stopTick(m) {
    if (m && m._tick) { clearInterval(m._tick); m._tick = null; }
  }
  /* 진행 중이던 줄을 끝난 줄로 넘긴다 — 말투도 완료형으로 바꾼다 */
  function settleRunning(m) {
    for (var k = 0; k < m.steps.length; k++) {
      if (m.steps[k].st !== 1) continue;
      m.steps[k].st = 2;
      if (m.steps[k].doneLabel) m.steps[k].label = m.steps[k].doneLabel;
    }
  }
  /* 대본 모드 — 계획된 스텝을 하나씩 피드에 밀어 넣는다 (380~900ms 난수 간격) */
  /* 대본 경로 최소 진행 시간 (19-3차).
     답이 10ms 만에 준비돼 버리면 스텝이 하나도 안 보이고 카드가 「확인 끝 · 0.1초」로
     지나갔다 — 사용자가 말한 "정지 화면 같다"가 아예 "안 보인다"가 된 것이다.
     그래서 대본 카드는 **스텝을 다 보여 준 뒤에** 완료한다. 총 1.6~3.5초.
     실 도구 호출(live) 경로와 움직임 최소화 설정에는 이 바닥을 적용하지 않는다 —
     거기서는 실제로 걸린 시간이 정답이고, 가짜 지연을 넣지 않는다. */
  var WORK_MIN_MS = 1600, WORK_MAX_MS = 3500, WORK_LEAD = 240, WORK_TAIL = 260;
  function animateWork(m) {
    startTick(m);
    var plan = m.plan || [];
    var gaps = [], total = 0, i, g;
    for (i = 0; i < plan.length; i++) {
      g = 380 + Math.floor(Math.random() * 520);   /* 계약서 §5-4 — 380~900ms 난수 */
      gaps.push(g); total += g;
    }
    /* 상한을 넘으면 간격을 비례 축소한다(스텝을 버리지 않는다) */
    var budget = WORK_MAX_MS - WORK_LEAD - WORK_TAIL;
    if (total > budget && total > 0) {
      var k = budget / total;
      total = 0;
      for (i = 0; i < gaps.length; i++) { gaps[i] = Math.max(200, Math.round(gaps[i] * k)); total += gaps[i]; }
    }
    var at = WORK_LEAD;
    for (i = 0; i < plan.length; i++) {
      at += gaps[i];
      (function (s, when) {
        m._timers.push(setTimeout(function () {
          if (m.done) return;
          settleRunning(m);
          m.steps.push({ label: s.run, doneLabel: s.done, found: s.found, st: 1 });
          refreshWork(m);
        }, when));
      })(plan[i], at);
    }
    var floor = at + WORK_TAIL;
    if (floor < WORK_MIN_MS) floor = WORK_MIN_MS;
    m.floorAt = (m.t0 || Date.now()) + floor;
  }
  /* 이 답을 화면에 쓰기까지 남은 시간 — 대본 카드가 아직 스텝을 다 못 보여 줬으면 그만큼 */
  function workFloorRemaining(aiMsg) {
    var m = aiMsg && aiMsg._work;
    if (!m || m.done || m.live || !m.floorAt) return 0;
    if (reduceMotion()) return 0;   /* 움직임 최소화 — 바닥 없이 즉시 완료 */
    var left = m.floorAt - Date.now();
    return left > 0 ? left : 0;
  }
  /* 대본 카드가 제 몫을 다 보여 준 다음에 답을 앉힌다 */
  function afterWorkFloor(aiMsg, fn) {
    var wait = workFloorRemaining(aiMsg);
    if (wait <= 0) { fn(); return; }
    setTimeout(fn, wait);
  }
  /* 실 도구 호출 — 도구 이름을 사람 말로 바꿔 한 줄로 세운다.
     EZTools.labelOf는 「목표·KR 조회」처럼 일하는 사람 말이 아니라서 여기서 다시 쓴다. */
  var TOOL_SAY = {
    search_employee: ["누구 이야기인지 찾는 중", "누구 이야기인지 찾았어요"],
    get_employee_profile: ["그 사람의 기록을 여는 중", "그 사람의 기록을 봤어요"],
    get_objectives: ["목표와 핵심 성과를 보는 중", "목표와 핵심 성과를 봤어요"],
    get_checkins: ["체크인 기록을 훑는 중", "체크인 기록을 훑었어요"],
    get_team_status: ["팀원들 상황을 모으는 중", "팀원들 상황을 모았어요"],
    get_org_overview: ["전사 현황을 살피는 중", "전사 현황을 살펴봤어요"],
    get_job_profile: ["직무 기준을 확인하는 중", "직무 기준을 확인했어요"],
    get_upward_feedback: ["상향 피드백을 모으는 중", "상향 피드백을 모았어요"],
    get_context_ledger: ["내 성과 기록을 불러오는 중", "내 성과 기록을 불러왔어요"],
    simulate_whatif: ["숫자를 바꿔 다시 계산하는 중", "숫자를 바꿔 다시 계산했어요"],
    get_org_objectives: ["연결할 상위 목표를 찾는 중", "연결할 상위 목표를 찾았어요"],
    get_prev_cycle: ["지난 사이클을 이어보는 중", "지난 사이클을 이어봤어요"],
    get_strategy_themes: ["회사 전략 방향을 맞춰 보는 중", "회사 전략 방향을 맞춰 봤어요"],
    get_attendance: ["근무 기록을 보는 중", "근무 기록을 봤어요"],
    get_leave_balance: ["연차 기록을 보는 중", "연차 기록을 봤어요"],
    get_payslip: ["급여 명세를 여는 중", "급여 명세를 봤어요"],
    get_screen_context: ["지금 보고 계신 화면을 확인하는 중", "지금 보고 계신 화면을 확인했어요"],
    navigate: ["화면을 여는 중", "화면을 열었어요"]
  };
  function toolSay(name, i) {
    var pair = TOOL_SAY[name];
    if (pair) return pair[i];
    return i === 0 ? "기록을 확인하는 중" : "기록을 확인했어요";
  }
  function addWorkStep(m, name, input) {
    if (!m) return;
    startTick(m);
    settleRunning(m);
    m.steps.push({ label: toolSay(name, 0), doneLabel: toolSay(name, 1), found: "", st: 1 });
    refreshWork(m);
    void input;
  }
  function finishWorkStep(m, summary) {
    if (!m) return;
    for (var i = m.steps.length - 1; i >= 0; i--) {
      if (m.steps[i].st === 1) {
        m.steps[i].st = 2;
        if (m.steps[i].doneLabel) m.steps[i].label = m.steps[i].doneLabel;
        m.steps[i].found = summary ? String(summary) : "";
        break;
      }
    }
    refreshWork(m);
  }
  function completeWork(aiMsg) {
    var m = aiMsg && aiMsg._work;
    if (!m || m.done) return;
    m.ms = Date.now() - (m.t0 || Date.now());
    m.done = true;
    m.collapsed = true;   /* 끝나면 접힌다 — 헤더를 누르면 다시 펼쳐진다 */
    m._timers.forEach(function (t) { clearTimeout(t); });
    m._timers = [];
    stopTick(m);
    settleRunning(m);
    /* 아직 피드에 못 올라간 계획 스텝도 결과만 남긴다 — 이미 센 값을 버리지 않는다 */
    var seen = {};
    m.steps.forEach(function (s) { seen[s.label] = 1; if (s.st !== 2) s.st = 2; });
    (m.plan || []).forEach(function (s) {
      if (!seen[s.done]) m.steps.push({ label: s.done, found: s.found, st: 2 });
    });
    refreshWork(m);
  }
  /* ---------------- 답변은 말풍선이다 ----------------
     이전에는 도구를 부른 답변을 전부 카드(EZKit.receipt)로 감쌌다. 제목줄과 기준시각
     칩·상황 칩·근거 칩이 먼저 오고, 정작 하려던 말은 카드 맨 아래에 묻혔다.
     사용자 지시대로 뒤집는다 — 본문이 곧 메시지다.

       · 본문 = .ezx-bubble. 다른 AI 답변과 똑같은 말풍선, 눈이 가장 먼저 닿는 곳.
       · 수치는 말풍선 아래 작은 타일 띠로만(최대 4개) — 사용자가 남기라고 한
         「직전 등급」·「과업 영역」 같은 데이터만 남긴다.
       · 제목줄·기준시각 칩·「실AI 응답 · 승인 필요」·「추정 근거 N건」·「기록 전」·
         「확인한 데이터 · 도구 N회」는 전부 삭제. 대화가 아니다.
         연결 상황은 이미 컴포저 위 한 줄(updateStatus)과 m.note가 말해 주고,
         근거 표시는 tx_ctx_ledger 스트립 하나로 모은다.
       · 시각 정의는 css/tx_elizax.css(.ezx-rc-*) — 런타임 주입 블록은 없앴다. */

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
  function rcNum(v) { return (typeof v === "number" && isFinite(v)) ? v : null; }
  /* 개인 단위 산출 추출 — EZCalc가 개인 결과를 지원하기 시작해도(다른 담당 작업 중)
     카드가 깨지지 않도록 반환 형상을 방어적으로 읽는다. 인정 형상:
       {before:{grade,weighted_score}, after:{…}} · {grade_change:{before,after}|"S→A"} ·
       {weighted_score:{before,after}} · {personal|me|individual|target_result:{…}}
     전사 분포 형상(before/after가 {S,A,B,C,D})에서는 아무것도 잡히지 않아 null을 돌려준다. */
  function wiPersonal(res) {
    if (!res || typeof res !== "object") return null;
    var out = { bg: null, ag: null, bs: null, as: null, changed: null };
    function side(o, gk, sk) {
      if (!o || typeof o !== "object") return;
      if (o.grade != null && out[gk] == null) out[gk] = o.grade;
      var s = rcNum(o.weighted_score);
      if (s == null) s = rcNum(o.score);
      if (s != null && out[sk] == null) out[sk] = s;
    }
    function grab(o) {
      if (!o || typeof o !== "object") return;
      side(o.before, "bg", "bs");
      side(o.after, "ag", "as");
      var gc = o.grade_change;
      if (typeof gc === "string" && out.ag == null) out.ag = gc;
      else if (gc && typeof gc === "object" && Object.prototype.toString.call(gc) !== "[object Array]") {
        if (out.bg == null) out.bg = (gc.before != null) ? gc.before : gc.from;
        if (out.ag == null) out.ag = (gc.after != null) ? gc.after : gc.to;
        if (gc.changed != null && out.changed == null) out.changed = !!gc.changed;
      }
      var ws = o.weighted_score;
      if (ws && typeof ws === "object") {
        if (out.bs == null && rcNum(ws.before) != null) out.bs = ws.before;
        if (out.as == null && rcNum(ws.after) != null) out.as = ws.after;
      }
      if (o.grade_changed != null && out.changed == null) out.changed = !!o.grade_changed;
    }
    [res.personal, res.me, res.individual, res.target_result, res].forEach(grab);
    if (out.bg == null && out.ag == null && out.bs == null && out.as == null) return null;
    if (out.changed == null && out.bg != null && out.ag != null) out.changed = String(out.bg) !== String(out.ag);
    return out;
  }
  function whatifHTML(res, p) {
    if (!res) return "";
    p = p || {};
    if (res.error || res.blocked) {
      return '<div class="ezx-rc-wirow warn"><span class="lb">불가</span><span>' +
        esc(res.error || res.policy || "시뮬레이션을 실행할 수 없습니다.") + "</span></div>";
    }
    var dist = res.grade_distribution || {};
    var dk = Object.keys(dist).sort();
    var capUsed = (res.cap_pct != null) ? res.cap_pct : p.cap_pct;
    var deltaUsed = (res.achievement_delta != null) ? res.achievement_delta : p.achievement_delta;
    var html = '<div class="ezx-rc-wirow"><span class="lb">가정</span><span>달성률 ' +
      esc(String(deltaUsed == null ? "-" : deltaUsed)) + "%p" +
      (capUsed != null ? " · 상위등급 상한 " + esc(String(capUsed)) + "%" : "") + "</span></div>";
    /* 개인 결과가 있으면 개인 표시가 우선, 없으면 분포 표시 — 둘 다 있으면 둘 다 낸다 */
    var pv = wiPersonal(res);
    var isDist = Object.prototype.toString.call(res.gradeChange) === "[object Array]";
    if (pv && (pv.bg != null || pv.ag != null)) {
      html += '<div class="ezx-rc-wirow"><span class="lb">등급</span><span>' +
        esc(String(pv.bg == null ? "-" : pv.bg)) + " → <b>" + esc(String(pv.ag == null ? "-" : pv.ag)) + "</b> " +
        (pv.changed ? '<em class="chg">변동</em>' : '<em class="keep">유지</em>') + "</span></div>";
    }
    if (pv && (pv.bs != null || pv.as != null)) {
      html += '<div class="ezx-rc-wirow"><span class="lb">종합</span><span>' +
        esc(String(pv.bs == null ? "-" : pv.bs)) + " → <b>" +
        esc(String(pv.as == null ? "-" : pv.as)) + "</b></span></div>";
    }
    var me = null;
    if (isDist) {
      html += '<div class="ezx-rc-wirow"><span class="lb">분포</span><span>' +
        esc(res.gradeChange.map(function (g) {
          return g.grade + " " + g.before_pct + "%→" + g.after_pct + "%(" + (g.delta_pp > 0 ? "+" : "") + g.delta_pp + "pp)";
        }).join(" · ")) + "</span></div>";
      if (res.moved_pp != null) {
        html += '<div class="ezx-rc-wirow"><span class="lb">이동폭</span><span>합계 ' +
          esc(String(res.moved_pp)) + "pp 재배치" +
          (res.basis && res.basis.population_n ? " · 모집단 " + esc(String(res.basis.population_n)) + "명" : "") + "</span></div>";
      }
      (res.people || []).forEach(function (x) {
        if (p.emp_id && x.name && x.name === ((state.subject && state.subject.name) || CURRENT.name)) me = x;
      });
      if (me) {
        html += '<div class="ezx-rc-wirow"><span class="lb">' + esc(me.name) + '</span><span>' +
          esc(String(me.before)) + " → <b>" + esc(String(me.after)) + "</b>점</span></div>";
      }
    } else if (dk.length) {
      html += '<div class="ezx-rc-wirow"><span class="lb">분포</span><span>' +
        esc(dk.map(function (k) { return k + " " + dist[k] + "명"; }).join(" · ")) +
        (res.top_grade_pct != null ? " · 상위 " + esc(String(res.top_grade_pct)) + "%" : "") + "</span></div>";
    }
    if (res.cap_note) {
      html += '<div class="ezx-rc-wirow"><span class="lb">상한</span><span>' + esc(res.cap_note) + "</span></div>";
    }
    var bss = res.basis || {};
    var notes = [];
    if (bss.base_source) notes.push(bss.base_source + (bss.cap_rule_source ? " · " + bss.cap_rule_source : ""));
    notes.push((res.assumptions || "읽기 전용 시뮬레이션 — 실제 데이터는 변경되지 않습니다") + " · 엔진 " + (res.engine || "-"));
    if (isDist && !pv && !me && p.emp_id) {
      notes.push("전사 분포 기준 — 개인 등급 단건은 이 엔진이 산출하지 않습니다");
    }
    html += '<div class="ezx-rc-winote">' + notes.map(esc).join("<br>") + "</div>";
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
    if (btn) btn.textContent = "다시 계산해 볼게";
    /* 실행 사실은 여전히 원장에 남긴다 — 화면에 감사 칩을 달지 않을 뿐이다(위조 ID 금지) */
    if (!res.error && !res.blocked && window.EZLedger && EZLedger.add) {
      try {
        var pv = wiPersonal(res);
        /* 엔진 형상별 요약 — 개인 등급(있으면 우선) vs 전사 분포 */
        var lbl = (pv && (pv.bg != null || pv.ag != null))
          ? ((pv.bg == null ? "-" : pv.bg) + " → " + (pv.ag == null ? "-" : pv.ag))
          : (pv && (pv.bs != null || pv.as != null))
            ? ("종합 " + (pv.bs == null ? "-" : pv.bs) + " → " + (pv.as == null ? "-" : pv.as))
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
          m.meta.ledgerId = ent.id;   /* 기록 흔적은 성과 기록(원장)에서 확인한다 */
        }
      } catch (e) { /* 원장 오류 무시 */ }
    }
    if (m.meta) m.meta.receipt = r;
    saveHistory();
    scrollToBottom();
  }

  /* 원장에 실제로 존재하는 id만 인정 — 근거 스트립(tx_ctx_ledger)과 같은 기준으로 센다.
     칩은 사라졌지만 이 함수는 남긴다 — rcHasCitations(수치 띠를 붙일지 판단)이 쓴다. */
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

  /* 말풍선 아래 작은 데이터 띠 — 사용자가 남기라고 한 부분.
     도구 결과에 실제로 있는 수치만 쓰고(rcMetricsOf), 네 개를 넘기지 않는다. */
  function metricsNode(r) {
    var list = (r && r.metrics) || [];
    if (Object.prototype.toString.call(list) !== "[object Array]" || !list.length) return null;
    var strip = h("div", "ezx-rc-metrics"), n = 0, i, x, tile;
    for (i = 0; i < list.length && n < 4; i++) {
      x = list[i];
      if (!x || x.k == null || x.v == null) continue;
      tile = h("div", "ezx-rc-metric");
      tile.appendChild(h("span", "k", { text: String(x.k) }));
      tile.appendChild(h("span", "v", { text: String(x.v) }));
      if (x.sub) tile.appendChild(h("span", "s", { text: String(x.sub) }));
      strip.appendChild(tile);
      n++;
    }
    return n ? strip : null;
  }

  /* ---- 이 답변이 어떤 알림에서 출발했는지 — 화면 진입을 단 하나만 내주기 위해 ----
     사용자: "인라인으로 한 후에 자세히 확인하고 싶으면 관련 화면으로 넘어가야 하는데
     그 기능은 어떻게 된거야?" — 진입이 없어 못 찾았다. 한 줄만 열어 둔다.
     주제 식별자는 화면에 절대 나오지 않는다(R2) — 내부에만 두는 기억이다. */
  function stampSigTopic(m) {
    if (!m) return;
    var t = null;
    try { t = (window.EZSignalChat && EZSignalChat.topic) ? EZSignalChat.topic() : null; }
    catch (e) { t = null; }
    if (!t) return;
    m._sigInst = t;
    if (!m.meta) m.meta = {};
    if (t.id) m.meta.sigId = String(t.id);
  }
  function sigInstOf(m) {
    if (!m) return null;
    if (m._sigInst) return m._sigInst;
    var id = m.meta && m.meta.sigId;
    if (!id) return null;
    if (window.EZSignalEngine && EZSignalEngine.instance) {
      try { m._sigInst = EZSignalEngine.instance(String(id)) || null; }
      catch (e) { m._sigInst = null; }
    }
    return m._sigInst || null;
  }
  /* 단 하나의 조용한 진입. 처리 버튼 여러 개를 되살리는 것이 아니다.
     실제 이동은 EZSignalAct.openScreen이 한다(이유 한 줄·하이라이트·돌아오는 길 포함). */
  function screenGoBtn(m) {
    var inst = sigInstOf(m);
    if (!inst) return null;
    if (!(window.EZSignalAct && EZSignalAct.openScreen && EZSignalAct.targetOf)) return null;
    var t = null;
    try { t = EZSignalAct.targetOf(inst, 0); } catch (e) { return null; }
    if (!t) return null;
    var b = h("button", "ezx-rc-golink", { type: "button", text: "화면에서 직접 고칠게" });
    b.addEventListener("click", function () {
      try { EZSignalAct.openScreen(inst, 0); } catch (e2) { /* 모듈 부재 — 조용하게 무시 */ }
    });
    return b;
  }

  /* 답변 꼬리의 조용한 한 줄 — 화면 진입과 What-if 재계산.
     둘 다 없으면 띠를 만들지 않는다. */
  function footNode(m, r) {
    var go = screenGoBtn(m);
    var hasWi = !!(r && r.whatif);
    if (!go && !hasWi) return null;
    var foot = h("div", "ezx-rc-foot");
    if (go) foot.appendChild(go);
    if (hasWi) {
      var wb = h("button", "ezx-rc-golink", {
        type: "button", "data-ezx-whatif": "1",
        text: r.wiResult ? "다시 계산해 볼게" : "수치를 바꾸면 어떻게 되는지 보여줘"
      });
      foot.appendChild(wb);
      foot.appendChild(h("span", "ezx-rc-wihint", { text: "읽기 전용 · 실제 데이터는 변하지 않아요" }));
      var out = h("div", "ezx-rc-wiout", { "data-ezx-wiout": "1" });
      if (r.wiResult) out.innerHTML = whatifHTML(r.wiResult, r.wiParams || whatifParams(r));
      foot.appendChild(out);
    }
    return foot;
  }

  /* 도구를 부른 답변 — 평범한 말풍선 + 수치 타일 띠 + 꼬리 한 줄.
     노드 계통은 다른 AI 답변과 동일(.ezx-msg.ai > .ezx-bubble) — tx_ctx_ledger 근거
     스트립·tx_chat_followups 칩·tx_chat_feedback·tx_chat_actions(복사·재생성)이
     모두 그 선택자를 쓴다. 카드일 때는 복사·재생성 버튼이 아예 붙지 못했다. */
  function buildReceiptNode(m) {
    var r = rcptOf(m) || {};
    var node = h("div", "ezx-msg ai ezx-rcptmsg");
    var bubble = h("div", "ezx-bubble");
    bubble.innerHTML = mdToHtml(stripCtxMarker(m.text || ""));
    node.appendChild(bubble);
    var strip = metricsNode(r);
    if (strip) node.appendChild(strip);
    var foot = footNode(m, r);
    if (foot) {
      node.appendChild(foot);
      var wbtn = foot.querySelector("[data-ezx-whatif]");
      if (wbtn) wbtn.addEventListener("click", function () { runWhatIf(m, node); });
    }
    if (m.note) node.appendChild(h("div", "ezx-note" + (m.noteWarn ? " warn" : ""), { text: m.note }));
    if (m.recos && m.recos.length) node.appendChild(buildRecos(m.recos));
    m._node = node;
    m._bubble = bubble;
    return node;
  }

  /* ---------------- 신호 답변 말풍선 (20-3차) ----------------
     카탈로그가 만든 답을 모델을 거치지 않고 그대로 그린다. 순서가 뜻이다 —
     ① 알림 문구(그 신호가 화면에 내보내는 한 문장) ② 그것을 받치는 근거 줄
     ③ 견줘 본 기준값 ④ 그 자리에서 할 수 있는 일.
     카드 크롬은 쓰지 않는다(18-2차 「전부 대화로」) — 말풍선 안의 글 계층뿐이다. */
  function buildSigNode(m) {
    /* sig-rule — 이 말풍선은 모델이 아니라 규칙이 만든 것이다. 계통은 `.ezx-msg.ai`
       그대로 두어야 하위 모듈(근거칩·후속칩·피드백)이 계속 붙는다(1770~1773 주석).
       클래스 하나만 더해 CSS 로 좌측 레일만 다르게 그린다. */
    var node = h("div", "ezx-msg ai sig-rule");
    var bubble = h("div", "ezx-bubble");
    var b = null;
    if (window.EZSignalChat && EZSignalChat.answerBlocks) {
      try { b = EZSignalChat.answerBlocks(m.id, roleKey()); } catch (e) { b = null; }
    }
    if (!b) {
      bubble.textContent = "이 알림을 불러오지 못했어요.";
      node.appendChild(bubble);
      m._node = node;
      return node;
    }
    var wrap = h("div", "ezx-sig-ans");
    /* 어디서 온 답인지 한 줄로 밝힌다 — 이 아래는 규칙이 센 것이고, 더 물으면
       elizax(모델)가 이어서 답한다. 두 층을 사용자가 구분할 수 있어야 한다. */
    wrap.appendChild(h("div", "sg-src", {
      text: b.live ? "규칙으로 확인한 결과 · 지금 기록으로 직접 셌어요"
                   : "규칙으로 확인한 결과 · 아직 기록이 모이는 중이에요"
    }));
    if (b.off) wrap.appendChild(h("div", "sg-off", { text: b.off }));
    if (b.lead) wrap.appendChild(h("div", "sg-lead", { text: b.lead }));
    if (b.notice) wrap.appendChild(h("div", "sg-notice", { text: b.notice }));
    if (b.asof) wrap.appendChild(h("div", "sg-asof", { text: "기준 시점 · " + b.asof }));

    function lines(list, cls, tail) {
      (list || []).forEach(function (t) {
        wrap.appendChild(h("div", "sg-l " + cls, { text: t + (tail || "") }));
      });
    }
    lines(b.sure, "");
    lines(b.soft, "soft", " (추정)");
    lines(b.demo, "demo");
    lines(b.th, "th");
    if (b.note) wrap.appendChild(h("div", "sg-note", { text: b.note }));

    /* 할 수 있는 일 — 카탈로그 처리를 기존 배선(EZSignalAct)으로 그대로 태운다 */
    var row = h("div", "sg-acts");
    (b.actions || []).forEach(function (a) {
      var btn = h("button", "sg-act", { type: "button", text: a.label });
      btn.addEventListener("click", function () { runSigAction(b.id, a.idx); });
      row.appendChild(btn);
    });
    /* 규칙 → 모델로 넘어가는 자리. 위 근거는 규칙이 센 것이고, 이 단추를 누르면
       그 근거를 그대로 물려 elizax 가 이어서 답한다(EZSignalChat.arm 으로 주제 고정). */
    var deep = h("button", "sg-act deep", { type: "button", text: "✦ elizax에게 더 묻기" });
    deep.addEventListener("click", function () {
      try { if (window.EZSignalChat && EZSignalChat.arm) EZSignalChat.arm(b.id); } catch (e) { /* 주제 고정 실패는 무해 */ }
      state.followSig = b.id;
      sendMessage("이 알림이 왜 지금 떴는지, 무엇부터 하면 좋을지 자세히 알려줘");
    });
    row.appendChild(deep);
    var more = h("button", "sg-act ghost", { type: "button", text: "이 알림 자세히" });
    more.addEventListener("click", function () { openCatalog(b.id); });
    row.appendChild(more);
    wrap.appendChild(row);

    bubble.appendChild(wrap);
    node.appendChild(bubble);
    m._node = node;
    return node;
  }
  /* ---------------- 처리 결과 + 이어 물을 말 (20-4차) ----------------
     카탈로그에 이미 「처리 후 안내」(done.title · done.desc)가 적혀 있다. 그 문장을
     그대로 쓰고, 그 아래에 이어 물을 말 세 개를 붙인다. 대화가 여기서 끊기지 않게. */
  function pushSigDone(id) {
    var arr = msgs(), i;
    for (i = arr.length - 1; i >= 0 && i > arr.length - 4; i--) {
      if (arr[i] && arr[i].role === "sigdone" && !arr[i].going
          && String(arr[i].id) === id) return;  /* 같은 결과를 두 번 쓰지 않는다 */
    }
    pushMessage({ role: "sigdone", id: id, at: Date.now() });
    renderMessages();
    scrollToBottom();
  }
  /* 처리 단추를 누른 직후 — 아직 끝나지 않았다. 무엇을 하려는지만 말하고
     이어 물을 말을 붙인다. 「했다」고 말하는 것은 resolve 가 온 뒤(sigdone)다. */
  function pushSigGo(id, idx) {
    pushMessage({ role: "sigdone", id: id, idx: idx, going: 1, at: Date.now() });
    renderMessages();
    scrollToBottom();
  }
  function buildSigDoneNode(m) {
    var node = h("div", "ezx-msg ai");
    var bubble = h("div", "ezx-bubble");
    var sig = null, inst = null;
    try { if (window.EZSignalEngine) inst = EZSignalEngine.instance(m.id, roleKey()); } catch (e) { inst = null; }
    sig = (inst && (inst.sig || inst)) || null;
    var wrap = h("div", "ezx-sig-done");
    if (m.going) {
      /* 아직 안 끝난 단계 — 카탈로그의 확인 단추 이름과 남는 기록으로 말한다 */
      var acts = (sig && sig.actions) || [];
      var a = acts[m.idx] || acts[0] || {};
      var head = a.confirm ? ("[" + a.confirm + "]을 누르면 반영돼요.") : "화면을 열었어요.";
      wrap.appendChild(h("div", "sd-title", { text: head }));
      if (a.store) wrap.appendChild(h("div", "sd-desc", { text: "→ 남는 기록 : " + a.store }));
    } else {
      var done = (sig && sig.done) || {};
      wrap.appendChild(h("div", "sd-title", { text: done.title || "처리했어요." }));
      if (done.desc) wrap.appendChild(h("div", "sd-desc", { text: "→ " + done.desc }));
    }

    /* 이어 물을 말 — 카탈로그 처리에서 뽑은 후속 칩(EZSignalChat.chips) 그대로 */
    var qs = [];
    if (window.EZSignalChat && EZSignalChat.chips) {
      try { qs = EZSignalChat.chips(inst || m.id) || []; } catch (e2) { qs = []; }
    }
    if (qs.length) {
      wrap.appendChild(h("div", "sd-lab", { text: "이어서 물어보기" }));
      var row = h("div", "sd-chips");
      qs.forEach(function (q) {
        var b = h("button", "sd-chip", { type: "button", text: String(q) });
        b.addEventListener("click", function () {
          /* 주제를 물려준다 — 칩 문장만 보내면 낱말이 겹치는 다른 신호로 튄다 (20-4차) */
          state.followSig = String(m.id);
          sendMessage(String(q));
        });
        row.appendChild(b);
      });
      wrap.appendChild(row);
    }
    bubble.appendChild(wrap);
    node.appendChild(bubble);
    m._node = node;
    return node;
  }

  /* 처리 실행 — 신호 인스턴스를 만들어 EZSignalAct.run 에 넘긴다.
     모듈이 없으면 조용히 아무 것도 하지 않는다(가짜 성공을 만들지 않는다). */
  function runSigAction(id, idx) {
    var inst = null;
    try { if (window.EZSignalEngine) inst = EZSignalEngine.instance(id, roleKey()); } catch (e) { inst = null; }
    if (!inst || !(window.EZSignalAct && EZSignalAct.run)) {
      pushMessage({ role: "sysline", text: "이 처리를 아직 연결하지 못했어요." });
      renderMessages();
      return;
    }
    var ok = false;
    try { ok = EZSignalAct.run(inst, idx, "") !== false; } catch (e2) { ok = false; }
    /* 처리가 곧바로 끝나지 않는 것이 많다(화면으로 데려가 사용자가 저장한다).
       그래서 누른 직후에는 「무엇을 하면 반영되는지」만 말하고 이어 물을 말을 붙인다.
       실제로 끝나면 엔진이 알려 주고 그때 결과 문장이 따라온다(pushSigDone). */
    if (ok) pushSigGo(id, idx);
  }

  function buildMsgNode(m) {
    if (m.role === "work") {
      var wnode = h("div", "ezx-msg work ezx-work");
      m._node = wnode;
      wnode.innerHTML = workHTML(m);
      /* 끝난 카드의 헤더를 누르면 확인 내역이 다시 펼쳐진다 */
      wnode.addEventListener("click", function (ev) {
        var hd = ev.target && ev.target.closest ? ev.target.closest(".ezx-work-hd.done") : null;
        if (!hd) return;
        m.collapsed = !m.collapsed;
        refreshWork(m);
      });
      return wnode;
    }
    if (m.role === "sysline") {
      /* 한 줄 알림 — 말풍선이 아니다 (대상이 바뀌었다는 안내 등) */
      var lnode = h("div", "ezx-msg sys");
      lnode.appendChild(h("div", "ezx-sysline", { text: m.text || "" }));
      m._node = lnode;
      return lnode;
    }
    if (m.role === "sig") return buildSigNode(m);
    if (m.role === "sigdone") return buildSigDoneNode(m);
    if (m.role === "nav") return buildNavNode(m);
    if (m.role === "navask") return buildNavAskNode(m);
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
    /* 수치 띠가 붙는 답변 (스트리밍 중에는 띠 없이 말풍선만) */
    if (m.role === "ai" && !m.streaming && rcptOf(m)) return buildReceiptNode(m);
    var node = h("div", "ezx-msg " + (m.role === "user" ? "user" : m.role === "err" ? "err" : "ai")
      /* 알림에서 이어진 모델 답 — 규칙이 센 결과 위에 elizax 가 덧붙인 층임을 표시 */
      + (m.role === "ai" && m._sigId ? " from-sig" : ""));
    var bubble = h("div", "ezx-bubble");
    if (m.role === "user") bubble.textContent = m.text;
    else bubble.innerHTML = mdToHtml(stripCtxMarker(m.text || ""));
    if (m.streaming) bubble.appendChild(h("span", "ezx-caret"));
    node.appendChild(bubble);
    /* 수치 띠가 없는 답변에도 화면 진입 한 줄은 필요하다 — 알림에서 출발한 대화면 붙인다 */
    if (m.role === "ai" && !m.streaming) {
      var pfoot = footNode(m, null);
      if (pfoot) node.appendChild(pfoot);
    }
    if (m.note) node.appendChild(h("div", "ezx-note" + (m.noteWarn ? " warn" : ""), { text: m.note }));
    if (m.recos && m.recos.length) node.appendChild(buildRecos(m.recos));
    m._node = node; m._bubble = bubble;
    return node;
  }
  /* ---- 이동 버블 — 가기 전에 1.2초 물러설 틈을 준다 (19차 §5-5) ----
     화면 키는 두 표기가 돌아다닌다: EZNav는 `perf`, 화면 DOM은 `s-perf`.
     어느 쪽으로 불려도 사람이 읽는 이름으로만 그린다 — 못 바꾸면 코드 대신 「관련 화면」.
     (§1 "모르면 감춘다" — 원문 키를 화면에 대신 쓰지 않는다) */
  var NAV_ALIAS = {
    "s-home": "home", "s-perf": "perf", "s-appr": "appr", "s-msf": "msf", "s-work": "work",
    "s-att": "att", "s-hrm": "hrm", "s-pay": "pay", "s-wf": "wf"
  };
  var NAV_LABEL = {
    home: "홈", perf: "성과관리", appr: "평가관리", msf: "360 진단", work: "업무관리",
    att: "근무관리", hrm: "인사관리", pay: "급여관리", wf: "신청/승인"
  };
  function navKey(s) {
    var k = String(s == null ? "" : s);
    return NAV_ALIAS[k] || k;
  }
  function navLabelOf(s, p, fallback) {
    var k = navKey(s);
    try {
      if (window.EZNav && EZNav.labelOf) {
        var l = EZNav.labelOf(k, p);
        if (l && String(l) !== k) return String(l);
      }
    } catch (e) { /* ignore */ }
    if (fallback && String(fallback) !== String(s) && String(fallback) !== k) return String(fallback);
    return NAV_LABEL[k] || SCREEN_LABELS[s] || "관련 화면";
  }
  function navOpenLabel(s, p, fallback) {
    var k = navKey(s);
    try {
      if (window.EZNav && EZNav.confirmLabel) {
        var c = EZNav.confirmLabel(k, p);
        if (c && String(c).indexOf(k) !== 0) return String(c);
      }
    } catch (e) { /* ignore */ }
    return navLabelOf(s, p, fallback) + " 열기";
  }
  var NAV_HOLD = 1200;   /* 이동 전 물러설 틈 */
  function buildNavNode(m) {
    var t = m.target || {};
    var node = h("div", "ezx-msg ai");
    var card = h("div", "ezx-navcard");
    card.appendChild(h("span", "arr", { text: "➜" }));
    var label = navLabelOf(t.s, t.p, t.label);
    card.appendChild(h("span", "", {
      text: m.cancelled ? "여기서 계속할게요." : label + "(으)로 넘어갈게요."
    }));
    /* 아직 안 갔고 취소도 안 했으면 되돌릴 수 있다 — 재렌더로 버튼이 사라지지 않도록
       "지났는가"는 노드가 아니라 시각(m.at)으로 판단한다 */
    var left = NAV_HOLD - (Date.now() - (m.at || Date.now()));
    if (!m.cancelled && !m.went && left > 0) {
      var cancel = h("button", "ezx-nav-cancel", { type: "button", text: "취소" });
      cancel.addEventListener("click", function () {
        m.cancelled = true;
        renderMessages();
      });
      card.appendChild(cancel);
    }
    node.appendChild(card);
    m._node = node;
    if (!m.fired) {
      m.fired = true;
      setTimeout(function () {
        if (m.cancelled || m.went) return;
        m.went = true;
        var ok = false;
        try { ok = window.EZNav && EZNav.go ? EZNav.go(navKey(t.s), t.p) : false; }
        catch (e) { console.error("[elizax nav]", e); }
        if (!ok) console.warn("[elizax nav] target not found:", t.s, t.p);
        renderMessages();
      }, Math.max(0, left));
    }
    return node;
  }
  /* ---- 물어보는 이동 — 답변을 먼저 내고, 갈지 말지는 사람이 정한다 ---- */
  function buildNavAskNode(m) {
    var node = h("div", "ezx-msg ai");
    var card = h("div", "ezx-navask");
    var label = navLabelOf(m.s, m.p, m.label);
    if (m.answered === "go") {
      card.appendChild(h("div", "ezx-navask-q", { text: label + "(으)로 넘어갈게요." }));
    } else if (m.answered === "stay") {
      card.appendChild(h("div", "ezx-navask-q", { text: "여기서 계속할게요." }));
    } else {
      card.appendChild(h("div", "ezx-navask-q", {
        text: (m.reason ? m.reason + " " : "") + label + "에서 바로 고칠 수 있어요. 열어 드릴까요?"
      }));
      var row = h("div", "ezx-navask-row");
      var go = h("button", "ezx-navask-btn go", { type: "button", text: navOpenLabel(m.s, m.p, m.label) });
      go.addEventListener("click", function () {
        m.answered = "go";
        renderMessages();
        /* onGo 가 있으면 그쪽이 화면 전환까지 책임진다(처리 초안 프리필 등).
           함수는 직렬화되지 않아 새로고침 뒤에는 사라진다 — 그때는 단순 이동으로 떨어진다. */
        try {
          if (typeof m.onGo === "function") { m.onGo(); return; }
          if (window.EZNav && EZNav.go) EZNav.go(m.s, m.p);
        } catch (e) { console.error("[elizax nav]", e); }
      });
      var stay = h("button", "ezx-navask-btn", { type: "button", text: "여기서 계속" });
      stay.addEventListener("click", function () { m.answered = "stay"; renderMessages(); });
      row.appendChild(go); row.appendChild(stay);
      card.appendChild(row);
    }
    node.appendChild(card);
    m._node = node;
    return node;
  }
  /* 공개 API — 처리 모듈(tx_signal_actions 등)이 「열어 드릴까요?」를 띄울 때 부른다 */
  function askNav(s, p, reason) {
    if (!s) return null;
    var m = pushMessage({
      role: "navask", s: navKey(s), p: (p == null ? null : p),
      reason: reason ? String(reason) : "", label: ""
    });
    renderMessages();
    return m;
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
    var me = curUser();
    var line = "[현재 화면: " + label + " / 사용자: " + me.name + "·" + (me.jobTitle || "") + "]";
    if (!isSelfSubject()) {
      line = "[현재 화면: " + label + " / 대상: " + state.subject.name + "·" + (state.subject.jobTitle || "") + " / 요청자: " + me.name + "]";
    }
    var ledger = buildLedgerContext();
    if (ledger) line += "\n" + ledger;
    /* 18-2차 R4 — 신호의 실측 근거를 payload에만 보이지 않게 실어 준다.
       화면에 렌더되는 메시지(m.text)에는 절대 들어가지 않는다: 이 함수의 반환값은
       전송용 문자열 전용이고, 렌더는 원문 userText를 쓴다. */
    var sigCtx = "";
    if (window.EZSignalChat && EZSignalChat.contextFor) {
      try { sigCtx = String(EZSignalChat.contextFor(userText) || ""); } catch (e) { sigCtx = ""; }
    }
    if (sigCtx) {
      line += "\n" + sigCtx;
      /* 20-3차 — 알림 문구·근거·기준값은 이미 화면에 그려서 사용자가 보고 있다.
         모델이 같은 말을 다시 하면 같은 답이 두 번 뜬다. 이어지는 한두 문장만 받는다. */
      line += "\n[이미 화면에 보여 준 것 — 다시 말하지 마세요]\n"
        + "위 참고 자료의 상황 문구·근거 줄·기준값은 화면에 그대로 적혀 사용자가 보고 있습니다.\n"
        + "그 내용을 되풀이하지 말고, 이어서 무엇부터 하면 좋은지만 한두 문장으로 말하세요.\n"
        + "숫자를 다시 늘어놓지 않습니다. 사용자가 물으면 그때 자세히 답합니다.";
    }
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

  /* ---- 19차 §5-5 — 답이 먼저다 ----
     예전에는 `EZNav.resolve`가 맨 앞에 있어서 "1차 평가자 검토가 제대로 되고 있는지
     확인해줘"가 「평**가자**」의 「가자」에 걸려 화면으로 튀었다. 물어본 사람은 답을
     못 받았다. 순서를 뒤집는다 —
       ① 질문이거나(EZNav.askIntent) 아는 신호를 부르는 말이면(EZSignalChat.matchAny)
          → 내비 판정을 아예 건너뛰고 답변 경로
       ② 그 밖에 EZNav.resolve가 「이동」이라고 분명히 말할 때만 → 이동
       ③ 나머지 → 답변 경로
     ①②의 모듈은 다른 담당이 만드는 중이라 없을 수도 있다 — 없으면 조용히 ③으로 간다. */
  function asksQuestion(text) {
    try {
      if (window.EZNav && EZNav.askIntent) return !!EZNav.askIntent(text);
    } catch (e) { /* ignore */ }
    return false;
  }
  function signalHit(text) {
    try {
      if (window.EZSignalChat && EZSignalChat.matchAny) return EZSignalChat.matchAny(text, roleKey()) || null;
    } catch (e) { /* ignore */ }
    return null;
  }
  function explicitNav(text) {
    var hit = null;
    try {
      if (window.EZNav && EZNav.resolve) hit = EZNav.resolve(text) || null;
    } catch (e) { hit = null; }
    if (!hit) return null;
    /* strength를 아직 안 주는 구버전 EZNav와도 함께 돈다 — 없으면 명시로 본다 */
    if (hit.strength && hit.strength !== "explicit") return null;
    return hit;
  }

  function sendMessage(userText) {
    if (state.streaming) return;
    /* 질문이거나 아는 신호를 부르는 말이면 — 이동 판정도, 대본 시나리오도 건너뛰고 답부터 낸다 */
    var wantsAnswer = asksQuestion(userText) || !!signalHit(userText);
    if (!wantsAnswer) {
      var navHit = explicitNav(userText);
      if (navHit) {
        pushMessage({ role: "user", text: userText });
        pushMessage({ role: "nav", target: navHit, at: Date.now() });
        renderMessages();
        return;   /* 실제 이동은 nav 버블이 1.2초 카운트다운 뒤에 한다 (취소 가능) */
      }
    }
    /* 오프라인일 때만 시나리오 가로채기 — 라이브 연결 시 Claude가 우선
       (시나리오 카드는 제안 칩으로 여전히 실행 가능) */
    if (!wantsAnswer && aiMode() === "offline" && window.TXAgent && window.TXAgent.intentFor) {
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
    /* 「대상 직원을 먼저 선택해 주세요」 차단 폐지 (19차 §5-2) — 막지 않는다.
       대신 문장에 사원 이름이 있으면 그때만 대상을 바꾸고 한 줄로 알린다.
       이름이 없으면 팀 전체 집계로 답한다. */
    pushMessage({ role: "user", text: userText });
    var picked = setSubjectByName(userText);
    if (picked) pushMessage({ role: "sysline", text: picked.name + "님 기준으로 볼게요." });

    /* 20-3차 — 아는 신호를 부르는 말이면 카탈로그가 만든 답을 **먼저 그대로** 낸다.
       예전에는 근거를 payload 에만 실어 보내서, 모델이 자기 문장으로 녹이면 카탈로그의
       알림 문구가 화면에서 사라졌다. 이제 알림 문구·근거·기준값은 모델을 거치지 않고
       화면에 남고, 모델은 그 뒤에 덧붙이는 말만 한다. */
    var sigM = signalHit(userText);
    var sigId = (sigM && sigM.id) ? String(sigM.id) : "";
    if (state.followSig) { sigId = state.followSig; state.followSig = null; }
    /* 실 에이전트 가능(연결+키+도구) → 라이브 카드(실 도구 호출 표시),
       그 외 라이브 → 기존 연출 카드, 오프라인 → 신호 턴에만 카드 */
    var agentReady = !!(window.EZAI && EZAI.agent && EZAI.ready && EZAI.ready() && window.EZTools);
    /* 20-6차 — 순서를 바로잡는다. 예전에는 신호 답을 **먼저** 앉히고 확인 카드를
       아예 넣지 않았다(20-3차). 그래서 룰베이스 답이 「띡」 하고 통째로 떨어졌고,
       사용자에게는 아무것도 알아보지 않고 뱉은 말로 보였다. 이제는
       확인 카드 → (스텝을 다 세운 뒤) 신호 답 → 이어가는 말 순서로 간다.
       카드가 세우는 줄은 그 신호가 실제로 읽은 기록이다(sigWorkPlan). */
    /* 인사·감사에는 확인 카드를 붙이지 않는다 (20-7차) — 「고마워」에 기록 네 건을
       뒤졌다고 말하는 것은 안 한 일을 했다고 하는 것이다. */
    var chatty = /^(thanks|greet)$/.test(String(offlineIntent(userText) || ""));
    var workMsg = chatty ? null
      : agentReady ? pushMessage(makeLiveWorkMsg())
      : sigId ? pushMessage(makeSigWorkMsg(sigId, state.perspective))
      : (aiMode() !== "offline") ? pushMessage(makeWorkMsg(state.perspective)) : null;
    /* 20-7차 — 사람은 먼저 답을 듣고 그 다음에 근거를 본다. 그래서 순서는
       확인 카드 → **말로 하는 답** → 알림 카드(문구·근거·기준값·처리 단추)다.
       예전에는 알림 카드를 먼저 앉히고 뒤에 한 줄을 붙여서, 물어본 사람이
       답을 듣기 전에 근거 표부터 읽어야 했다. */
    /* 20-7차 — 알림 카드는 **그 알림이 실제로 뜰 때만** 붙인다. 예전에는 뜰 상태가
       아닌데도 카드를 앉혀서 「지금은 이 알림이 뜰 상태가 아니에요」라는 시스템 말과
       카탈로그 예시 문구(치환되지 않은 {{팀원명}} 까지)를 함께 내보냈다. 물어본
       사람에게는 답도 아니고 근거도 아닌 표만 남았다. 뜰 상태가 아니면 말로만 답한다. */
    var sigNew = !!(sigId && !sigShown(sigId) && sigHits(sigId));
    /* _q = 원문 질문. 영수증 제목·What-if 가정 파싱이 완료 시점에 필요하다(SSE 경로 포함) */
    var aiMsg = { role: "ai", text: "", streaming: true, _work: workMsg, _q: userText, _sigId: sigId, _sigNew: sigNew };
    pushMessage(aiMsg);
    /* 알림 카드는 답 뒤에 놓고 pending 으로 재워 둔다 — 답을 다 하고 나서
       깨운다(finishStreaming). pending 인 동안은 그려지지 않는다. */
    if (sigNew) pushMessage({ role: "sig", id: sigId, at: Date.now(), pending: true });
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
    /* buildPayloadMessage가 EZSignalChat.contextFor로 주제를 이미 걸어 두었다.
       그 주제를 이 답변에 새겨 두면 답변 꼬리에 「화면에서 직접 고칠게」 한 줄을 낼 수 있다. */
    stampSigTopic(aiMsg);

    if (agentReady) agentRespond(body, aiMsg, userText);
    else streamChat(body, aiMsg, userText);   /* 오프라인 의도 분기는 원문 질문이 필요 (G4) */
  }

  function finishStreaming() {
    /* 답을 다 했으면 재워 둔 알림 카드를 깨운다 (20-7차) — 답 아래 근거가 붙는 순서 */
    var mm = msgs(), mi, woke = false;
    for (mi = mm.length - 1; mi >= 0 && mi > mm.length - 6; mi--) {
      if (mm[mi] && mm[mi].role === "sig" && mm[mi].pending) { mm[mi].pending = false; woke = true; }
    }
    if (woke) renderMessages();
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
      if (m.role === "work" && !m.done) completeWork({ _work: m });
      /* 중지해도 이미 계산된 신호 답은 감추지 않는다 — 감추면 확인 내역만 남는다 */
      if (m.role === "sig" && m.pending) m.pending = false;
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
  function agentRespond(body, aiMsg, userText) {
    var work = aiMsg._work;
    /* 실제 호출된 도구를 수집해 응답 완료 시 영수증 서술자로 만든다 (F16) */
    var calls = aiMsg._calls = [];
    window.EZAI.agent({
      messages: buildHistoryMsgs(body, aiMsg),
      onText: function (t) {
        if (aiMsg._stopped) return;
        aiMsg.text += t;
        refreshBubble(aiMsg);
      },
      onTool: function (name, input) {
        calls.push({ name: name, input: input || {}, result: null, summary: null, pending: true });
        addWorkStep(work, name, input);
      },
      onToolResult: function (name, r, summary) {
        for (var i = calls.length - 1; i >= 0; i--) {
          if (calls[i].pending && calls[i].name === name) {
            calls[i].result = r; calls[i].summary = summary || null; calls[i].pending = false;
            break;
          }
        }
        finishWorkStep(work, summary);
        if (name === "navigate" && r && r.ok) aiMsg.note = "화면 전환 · " + (r.moved_to || "");
      },
      onDone: function () {
        completeWork(aiMsg);
        aiMsg.streaming = false;
        /* 도구만 돌리고 한 마디도 안 한 채 끝났다 — 폴백 사다리로 (19-2차) */
        if (unusableAnswer(aiMsg)) { answerFallback(aiMsg, "에이전트가 답을 내지 않았다"); return; }
        extractCtxRefs(aiMsg); /* 실인용 근거 마커 → meta.ctxRefs */
        attachLiveReceipt(aiMsg, calls, userText || aiMsg._q); /* 실AI 응답 → 영수증 카드 */
        /* 모델이 이동 마커를 냈어도 저절로 가지 않는다 (19차 §5-5) — 물어본다 */
        var pending = null;
        if (window.EZNav && window.EZNav.extractMarker) {
          try {
            var ext = window.EZNav.extractMarker(aiMsg.text);
            if (ext.nav) { aiMsg.text = ext.clean; pending = ext.nav; }
          } catch (e) { /* ignore */ }
        }
        finishStreaming();
        renderMessages();
        if (pending) askNav(pending.s, pending.p, "");
      },
      onError: function (m) {
        answerFallback(aiMsg, m);   /* 백엔드 오류 문자열은 화면에 닿지 않는다 */
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
          /* completeWork는 여기서 부르지 않는다 — 대본 카드가 스텝을 다 보여 준 뒤
             afterWorkFloor 안에서 끝낸다 (19-3차) */
          aiMsg.streaming = false;
          /* 백엔드가 폴백을 돌려줬다 = 실제 AI가 답한 게 아니다. 그 문구(자격증명 안내 등)를
             그대로 쓰지 않고 우리 폴백 사다리로 넘긴다 (19-2차). */
          if (j.type === "fallback" || j.source === "fallback") {
            answerFallback(aiMsg, j.response || j.message || "fallback");
            return;
          }
          aiMsg.text = j.response || j.message || "";
          if (unusableAnswer(aiMsg)) { answerFallback(aiMsg, "응답이 비었거나 설정 안내문이다 (json)"); return; }
          /* 스트리밍이 아니라 한 번에 온 답 — 대본 카드가 제 몫을 보여 준 뒤 앉힌다 */
          afterWorkFloor(aiMsg, function () {
            if (aiMsg._stopped) return;
            completeWork(aiMsg);
            extractCtxRefs(aiMsg);
            if (j.recommendations && j.recommendations.length) aiMsg.recos = j.recommendations;
            attachLiveReceipt(aiMsg, aiMsg._calls, aiMsg._q);
            finishStreaming();
            renderMessages();
          });
        });
      }
      return readSSE(res, aiMsg);
    }).catch(function (err) {
      /* 상태코드·네트워크 오류 문구는 화면에 쓰지 않는다 — console.warn 으로만 남는다 */
      answerFallback(aiMsg, (err && err.message) ? err.message : "network");
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
  var OFF_WHATIF_RE = /(만약|가정했|가정하|what\s*-?if|시뮬|재계산|바뀌면|떨어지면|올라가면|[-+]?\d+\s*%\s*p)/i;
  var OFF_INTENTS = [
    ["whatif", OFF_WHATIF_RE],
    /* org·team이 grade보다 앞 — "전사 등급 분포"가 개인 등급으로 새지 않게 */
    ["org", /(전사|회사\s*전체|등급\s*분포|인원\s*현황|조직\s*현황|본부\s*별)/],
    ["team", /(팀원|우리\s*팀|팀\s*현황|팀\s*상황|부서원|구성원\s*현황)/],
    ["grade", /(등급|고과|평가\s*결과|평가\s*점수|종합\s*점수|내\s*평가|평가는|평가\s*근거)/],
    ["checkin", /(체크인|주간\s*보고|진행\s*보고|장애요인|블로커|막힌)/],
    ["goal", /(목표|okr|\bkr\b|진척|진행\s*상황|달성률|달성도|진도)/i],
    ["feedback", /(피드백|360|다면|상향\s*평가|상향\s*피드백)/],
    ["oneonone", /(1\s*on\s*1|1\s*:\s*1|원온원|면담|일대일)/i],
    ["job", /(직무|역량|스킬|과업|커리어|직무\s*기준)/],
    /* pay가 work보다 앞 — "연장근로수당"은 금액 질문이므로 급여로 답해야 한다 */
    ["pay", /(급여|월급|명세서|연말\s*정산|수당|상여|성과급|실지급|공제|세금|4대\s*보험)/],
    /* 근로/근무 표기 혼용 실사용어를 모두 받는다 — "초과근로"가 의도 미매칭으로 새던 버그 */
    ["work", /(근무|근태|출퇴근|출근|퇴근|휴가|연차|반차|병가|초과\s*근[무로]|연장\s*근[무로]|야근|지각|조퇴|재택|근로\s*시간|소정)/]
  ];
  /* 인사와 「고마워」는 다르다 (20-7차) — 감사 인사에 자기소개와 기능 목록을 다시
     펼치면 대화가 처음으로 되감긴다. 짧게 받고 하던 이야기를 이어 간다. */
  var OFF_THANKS = /^(고마|감사|수고|땡큐|thx|thanks)/i;
  var OFF_GREET = /^(안녕|하이|반가|ㅎㅇ|헬로|hi|hello|hey|누구|뭐\s*해|뭐하|테스트|test)/i;

  function offlineIntent(text) {
    var t = String(text || "").trim();
    if (!t) return "unknown";
    if (t.length <= 24 && OFF_THANKS.test(t)) return "thanks";
    if (t.length <= 24 && OFF_GREET.test(t)) return "greet";
    for (var i = 0; i < OFF_INTENTS.length; i++) {
      if (OFF_INTENTS[i][1].test(t)) return OFF_INTENTS[i][0];
    }
    return "unknown";
  }
  /* `offlineNav()` 폐지 (19차 §5-5) — 답변 경로에서는 이동 판정을 하지 않는다.
     여기까지 온 문장은 이미 「이동이 아니다」로 판정된 것이고, 화면 이동 판정을 한 번 더
     느슨하게(“열어줘”만 보고) 하는 바람에 질문이 답 없이 화면으로 튀었다. */

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
        (c.blocker ? " · 장애요인 " + c.blocker : "") +
        (c.comment ? " — " + c.comment : "") + "\n";
    });
    return {
      text: md,
      receipt: offRc({
        title: sname + " · 체크인 기록",
        metrics: [
          { k: "최근 체크인", v: cs.length + "건" },
          { k: "마지막", v: cs[0].date || "-" },
          { k: "장애요인", v: blockers.length + "건" }
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
      md += "\n장애요인가 보고된 팀원 " + blk.length + "명: " + blk.map(function (m) { return m.name + "(" + m.blocker + ")"; }).join(", ") + "\n";
    }
    return {
      text: md,
      receipt: offRc({
        title: "팀 현황",
        metrics: [
          { k: "팀원", v: rows.length + "명" },
          { k: "평균 진척", v: (avg == null ? "-" : avg + "%") },
          { k: "장애요인", v: blk.length + "명" }
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

  /* 질문 텍스트 → 가정치 파싱 (오프라인·온라인 카드 공용). 못 읽으면 null — 기본값은 호출부가 정한다. */
  function parseWhatIfText(text) {
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
    return { delta: delta, cap: cap };
  }

  function offWhatIf(sid, sname, text) {
    var pr = parseWhatIfText(text);
    var delta = pr.delta, cap = pr.cap;
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

  /* ---- 근무·연차·급여 — attendance/leaves/payroll 원천(scripts/enrich_hr_ops.py) 실조회 ----
     열람 규칙(EZTools gateHrOps)이 개인 상세 / 팀·전사 집계 / 차단으로 갈리므로 세 형태를 모두 렌더한다.
     원천이 비어 있으면 offNoData로 되돌려 "없는 수치는 지어내지 않는다"를 유지한다. */
  var OFF_LEAVE_Q = /(휴가|연차|반차|병가|경조|소멸|촉진|잔여)/;
  function won(n) {
    if (n == null || isNaN(Number(n))) return "-";
    return Number(n).toLocaleString("ko-KR") + "원";
  }
  function wonDelta(n) {
    if (n == null || isNaN(Number(n))) return "-";
    if (Number(n) === 0) return "변동 없음";
    return (Number(n) > 0 ? "+" : "−") + Math.abs(Number(n)).toLocaleString("ko-KR") + "원";
  }
  function dayNum(n) { return (n == null) ? "-" : (Math.round(Number(n) * 10) / 10) + "일"; }
  function hourNum(n) { return (n == null) ? "-" : (Math.round(Number(n) * 10) / 10) + "시간"; }

  function offLeaveMine(sname, r) {
    var md = sname + "님의 " + r.year + "년 연차는 부여 **" + dayNum(r.granted_days) + "** 중 **" +
      dayNum(r.used_days) + "** 사용, 잔여 **" + dayNum(r.remaining_days) + "** 입니다.\n\n";
    md += "- 소멸 예정 — " + dayNum(r.expiring_days) + " · " + (r.expiring_at || "-") +
      (r.promotion_target ? " (연차사용촉진 대상)" : "") + "\n";
    if (r.pending_days) md += "- 승인 대기 — " + dayNum(r.pending_days) + "\n";
    var reqs = (r.requests || []).slice(-5).reverse();
    if (reqs.length) {
      md += "\n| 신청 | 기간 | 일수 | 상태 |\n| --- | --- | --- | --- |\n";
      reqs.forEach(function (q) {
        md += "| " + (q.type || "-") + " | " + (q.start || "-") +
          (q.end && q.end !== q.start ? " ~ " + q.end : "") + " | " + dayNum(q.days) + " | " + (q.status || "-") + " |\n";
      });
    }
    if (r.note) md += "\n> " + r.note;
    return {
      text: md,
      receipt: offRc({
        title: sname + " · 연차 현황",
        metrics: [
          { k: "잔여", v: dayNum(r.remaining_days) },
          { k: "부여 / 사용", v: dayNum(r.granted_days) + " / " + dayNum(r.used_days) },
          { k: "소멸 예정", v: dayNum(r.expiring_days) + " · " + (r.expiring_at || "-") }
        ],
        srcs: [offSrc("erp", "연차 대장 " + r.year), offSrc("rule", "근로기준법 §60 부여·§61 사용촉진")]
      })
    };
  }

  function offLeaveTeam(r) {
    var md = "**" + (r.scope || "조직") + "** " + r.year + "년 연차 집계입니다 (대상 " + r.headcount + "명).\n\n" +
      "- 평균 부여 " + dayNum(r.avg_granted_days) + " · 평균 사용 " + dayNum(r.avg_used_days) +
      " · 평균 잔여 " + dayNum(r.avg_remaining_days) + "\n" +
      "- 연차사용촉진 대상 " + r.promotion_target_count + "명 · 승인 대기 신청 " + r.pending_requests + "건\n";
    if (r.policy) md += "\n> " + r.policy;
    return {
      text: md,
      receipt: offRc({
        title: (r.scope || "조직") + " · 연차 집계",
        metrics: [
          { k: "대상", v: r.headcount + "명" },
          { k: "평균 잔여", v: dayNum(r.avg_remaining_days) },
          { k: "촉진 대상", v: r.promotion_target_count + "명" }
        ],
        srcs: [offSrc("erp", "연차 대장 집계"), offSrc("rule", "열람 규칙 — 개인 상세 비공개")]
      })
    };
  }

  function offAttMine(sname, r, lr) {
    var c = r.current || {}, p = r.previous || null;
    var md = sname + "님의 **" + (c.period || "-") + "** 근태입니다" +
      (c.partial ? " (진행 중 · " + (r.as_of || "") + " 기준)" : "") + ".\n\n";
    md += "- 근무 " + dayNum(c.actual_days) + " / 소정 " + dayNum(c.work_days) +
      " · 휴가 " + dayNum(c.leave_days) + " · 재택 " + dayNum(c.remote_days) + "\n";
    md += "- 초과근로 " + hourNum(c.overtime_hours) +
      (p ? " (전월 " + hourNum(p.overtime_hours) + ")" : "") + "\n";
    md += "- 지각 " + (c.late_count || 0) + "회 · 조퇴 " + (c.early_leave_count || 0) + "회 · 평균 " +
      (c.avg_in_time || "-") + " 출근 / " + (c.avg_out_time || "-") + " 퇴근\n";
    var sig = r.signals || [];
    if (sig.length) {
      md += "\n확인이 필요한 신호\n";
      sig.forEach(function (s) { md += "- " + (s.level === "warn" ? "▲ " : "") + s.text + "\n"; });
    } else {
      md += "\n임계값을 넘은 신호는 없습니다 (초과근로 월 52시간 · 지각 3회 기준).\n";
    }
    var lvOk = lr && !lr.error && !lr.blocked && lr.remaining_days != null;
    if (lvOk) md += "\n연차 잔여 " + dayNum(lr.remaining_days) + " · " + (lr.expiring_at || "-") + " 소멸 예정\n";
    if (r.source) md += "\n> " + r.source;
    return {
      text: md,
      receipt: offRc({
        title: sname + " · 근태 " + (c.period || ""),
        metrics: [
          { k: "근무 / 소정", v: dayNum(c.actual_days) + " / " + dayNum(c.work_days) },
          { k: "초과근로", v: hourNum(c.overtime_hours) },
          { k: "일별 기록", v: ((r.daily || []).length) + "일" }
        ],
        srcs: [offSrc("erp", "근태 원장 " + (c.period || "")),
          offSrc("rule", "판정 기준 — 초과근로 월 52시간(주 12시간 환산)")]
      })
    };
  }

  function offAttTeam(r) {
    var md = "**" + (r.scope || "조직") + "** " + (r.period || "") + " 근태 집계입니다 (대상 " + r.headcount + "명).\n\n" +
      "- 평균 초과근로 " + hourNum(r.avg_overtime_hours) + " · 평균 근무 " + dayNum(r.avg_actual_days) +
      " · 평균 재택 " + dayNum(r.avg_remote_days) + "\n" +
      "- 지각 합계 " + r.late_total + "회 · 초과근로 상한 도달 " + r.over_limit_count + "명\n";
    if (r.note) md += "\n> " + r.note;
    return {
      text: md,
      receipt: offRc({
        title: (r.scope || "조직") + " · 근태 집계 " + (r.period || ""),
        metrics: [
          { k: "대상", v: r.headcount + "명" },
          { k: "평균 초과근로", v: hourNum(r.avg_overtime_hours) },
          { k: "상한 도달", v: r.over_limit_count + "명" }
        ],
        srcs: [offSrc("erp", "근태 원장 집계 " + (r.period || "")),
          offSrc("rule", "열람 규칙 — 개인 상세 비공개")]
      })
    };
  }

  function offWork(sid, sname, q) {
    if (OFF_LEAVE_Q.test(String(q || ""))) {
      var lr0 = ezRun("get_leave_balance", { emp_id: sid });
      if (lr0 && lr0.blocked) return offBlocked(sname, lr0.policy);
      if (lr0 && !lr0.error) return lr0.scope ? offLeaveTeam(lr0) : offLeaveMine(sname, lr0);
    }
    var ar = ezRun("get_attendance", { emp_id: sid });
    if (!ar) return offNoData("work");
    if (ar.blocked) return offBlocked(sname, ar.policy);
    if (ar.error) return { text: sname + "님의 근태 기록이 로컬 데이터에 없습니다. 근무관리 화면에서 직접 조회해 주세요." };
    if (ar.scope) return offAttTeam(ar);
    return offAttMine(sname, ar, ezRun("get_leave_balance", { emp_id: sid }));
  }

  function offPay(sid, sname) {
    var r = ezRun("get_payslip", { emp_id: sid });
    if (!r) return offNoData("pay");
    if (r.blocked) return offBlocked(sname, r.policy);
    if (r.error) {
      return { text: sname + "님의 급여 명세가 로컬 데이터에 없습니다" +
        ((r.available_periods || []).length ? " (보유 기간 — " + r.available_periods.join(" · ") + ")" : "") + "." };
    }
    var c = r.current || {}, pol = r.policy || {};
    var md = sname + "님의 **" + (c.period || "-") + "** 급여입니다 (지급일 " + (c.pay_date || "-") + ").\n\n";
    md += "- 지급 합계 **" + won(c.gross) + "** · 공제 " + won(c.deduction_total) + " · 실지급 **" + won(c.net) + "**\n";
    if (r.net_delta != null) md += "- 전월 대비 실지급 " + wonDelta(r.net_delta) + "\n";
    var ch = r.changes || [];
    if (ch.length) {
      md += "\n전월 대비 변동\n";
      ch.forEach(function (x) {
        md += "- **" + x.item + "** " + won(x.prev) + " → " + won(x.current) + " (" + wonDelta(x.delta) + ")" +
          (x.reason ? " — " + x.reason : "") + "\n";
      });
    } else if (r.previous) {
      md += "\n전월과 지급·공제 항목이 동일합니다.\n";
    }
    md += "\n계산 규칙 — 지급일 매월 " + (pol.pay_day || "-") + "일 · 연장 " + (pol.overtime_rate || "-") + "배 · 성과급 " +
      ((pol.bonus_months || []).join("·") || "-") + "월 · " + (pol.tax_table_ref || "간이세액표") + "\n";
    /* r.note는 AI에게 주는 지시문이라 화면에 그대로 내보내지 않는다 */
    md += "\n> 금액은 데모용 합성 데이터입니다.";
    return {
      text: md,
      receipt: offRc({
        title: sname + " · 급여 " + (c.period || ""),
        metrics: [
          { k: "실지급", v: won(c.net) },
          { k: "전월 대비", v: wonDelta(r.net_delta) },
          { k: "연장근로", v: hourNum(c.overtime_hours) }
        ],
        srcs: [offSrc("erp", "급여 원장 " + (c.period || "")),
          offSrc("rule", "급여 계산 규칙 — " + (pol.overtime_formula || "연장수당 산식"))]
      })
    };
  }

  function offNoData(kind) {
    var m = (kind === "pay")
      ? { label: "급여관리", what: "급여 명세·연말정산" }
      : { label: "근무관리", what: "근무·휴가 기록" };
    return {
      text: "AI 미연결 상태입니다. " + m.what + " 원천 데이터는 이 데모의 로컬 데이터셋에 없어 수치로 답할 수 없습니다. 지어내지 않겠습니다.\n\n" +
        "지금 확인 가능한 것\n" +
        "- **" + m.label + " 화면**에서 직접 조회 — \"" + m.label + " 화면으로 가줘\"라고 하면 이동합니다\n" +
        "- 목표·체크인·평가 등급·팀 현황·직무 기준은 로컬 데이터로 바로 답할 수 있습니다"
    };
  }

  function offGreet() {
    return {
      text: "안녕하세요, " + CURRENT.name + "님. elizax입니다.\n\n" +
        "지금은 **AI 미연결** 상태라 로컬 데이터 조회로만 답합니다. 목표 진척 · 체크인 · 평가 등급 · 팀 현황 · 직무 기준 · 근태·연차 · 급여 명세 · What-if 재계산을 물어보세요."
    };
  }

  function offUnknown() {
    return {
      text: "AI 미연결 상태입니다. 이 질문은 연결 후 답할 수 있습니다.\n\n" +
        "지금 확인 가능한 것\n" +
        "- 내 목표·KR 진척 — \"내 목표 진척 알려줘\"\n" +
        "- 최근 체크인·장애요인 — \"최근 체크인 보여줘\"\n" +
        "- 평가 등급과 산출 근거 — \"내 등급 근거가 뭐야\"\n" +
        "- 팀 현황 / 전사 등급 분포 — 조직장·HR 권한\n" +
        "- 직무 기준·기대 역량 — \"내 직무 기준 알려줘\"\n" +
        "- 근태·연차 — \"이번 달 초과근로 얼마야\" / \"연차 며칠 남았어\"\n" +
        "- 급여 명세 — \"지난달 급여 왜 늘었어\"\n" +
        "- What-if 재계산 — \"달성률 -10%p면 등급 어떻게 돼?\"\n" +
        "- 화면 이동 — \"급여 화면으로 가줘\""
    };
  }

  /* 질문 의도 → 로컬 데이터 조회 → 영수증. 미매칭이면 가짜 영수증 대신 정직한 안내. */
  function offlineReceipt(body, userText) {
    var sid = body.emp_id || curUser().emp_id;
    var sname = isSelfSubject() ? curUser().name : state.subject.name;
    var q = String(userText || "");
    var intent = offlineIntent(q);
    var out = null;
    if (intent === "thanks") out = { text: "네, 도움이 되었다니 다행이에요. 더 볼 게 있으면 말씀해 주세요." };
    else if (intent === "greet") out = offGreet();
    else if (intent === "whatif") out = offWhatIf(sid, sname, q);
    else if (intent === "grade") out = offGrade(sid, sname);
    else if (intent === "checkin") out = offCheckin(sid, sname);
    else if (intent === "goal") out = offGoal(sid, sname);
    else if (intent === "team") out = offTeam();
    else if (intent === "org") out = offOrg();
    else if (intent === "feedback") out = offFeedback(sid, sname);
    else if (intent === "oneonone") out = offOneOnOne(sname);
    else if (intent === "job") out = offJob(sid, sname);
    else if (intent === "work") out = offWork(sid, sname, q);
    else if (intent === "pay") out = offPay(sid, sname);
    if (!out) { out = offUnknown(); intent = "unknown"; }
    return {
      text: out.text,
      recos: out.recos || [],
      receipt: out.receipt || null,
      intent: intent
    };
  }

  /* ---------------- 답이 못 나왔을 때 — 단 하나의 문 (19-2차) ----------------
     AI 경로가 오류·빈 응답·자격증명 실패로 끝나면 예전에는 백엔드가 준 문자열을
     말풍선에 그대로 그렸다. 그래서 「ANTHROPIC_API_KEY 또는 AWS 키(AWS_KEYS_CSV…)를
     설정한 뒤 다시 실행해 주세요」가 사용자 화면에 떴다 — §1 「화면에 코드 금지」 위반이고,
     정작 이 질문이 부르던 신호의 답은 나오지 못했다.

     이제 실패는 전부 이 함수 하나를 지난다. 순서:
       ① 이 턴이 부른 신호가 있으면 그 신호의 답(EZSignalChat.answerText)
       ② 로컬 기록으로 답할 수 있는 질문이면 그 조회 결과(offlineReceipt)
       ③ 둘 다 아니면 사람 말 한 문장
     환경변수 이름·URL·상태코드·스택은 console.warn 으로만 남고 화면에 닿지 않는다. */
  var DEAD_END = "지금은 elizax가 회사 데이터에 연결되어 있지 않아 확인해 드리지 못했어요. 잠시 뒤 다시 물어봐 주세요.";

  /* 이 턴에 그 신호의 답 말풍선을 이미 그렸는가 (20-3차) */
  function sigShown(sid) {
    /* 처리를 실행하면 그 사이에 안내 말풍선이 몇 개 끼어든다 — 창을 넉넉히 본다.
       같은 주제를 한 대화 안에서 두 번 펼치지 않는 것이 목적이다. */
    var arr = msgs(), i, stop = Math.max(0, arr.length - 12);
    for (i = arr.length - 1; i >= stop; i--) {
      if (arr[i] && arr[i].role === "sig" && String(arr[i].id) === String(sid)) return true;
    }
    return false;
  }

  /* 무엇으로 답할지만 정한다 — 화면에는 아직 쓰지 않는다 */
  function pickFallbackAnswer(aiMsg) {
    var q = aiMsg._q || "";
    var rk = roleKey();

    /* ① 이 질문이 부른 신호의 답 */
    var sid = aiMsg._sigId || "";      /* 이 턴이 이미 정한 주제 (20-4차) */
    if (!sid) {
      var hit = signalHit(q);
      sid = hit && (hit.id || (hit.sig && hit.sig.id));
    }
    /* 20-3차 — 그 신호의 답(알림 문구·근거·기준값)이 이미 말풍선으로 떠 있으면
       같은 말을 문장으로 다시 쓰지 않는다. 이어받을 한 줄만 남긴다. */
    /* 20-7차 — 아는 신호를 부른 말이면 **언제나** 말로 하는 답(sigContinue)으로 간다.
       예전에는 알림 카드가 안 떴을 때만 `answerText` 로 빠졌는데, 그 함수는 알림
       문구·근거·기준값·처리 초안을 통째로 한 문단에 쏟아 낸다. 뜰 상태가 아닌
       알림에서는 치환되지 않은 자리표시자({{팀원명}})까지 그대로 실려 나왔다. */
    if (sid) {
      var sc = sigContinue({ _sigId: sid, _sigNew: !!aiMsg._sigNew, _q: q });
      if (sc.text) return { text: sc.text, note: "" };
    }

    /* ② 로컬 기록으로 답할 수 있는 질문인가 — 못 알아들은 질문(unknown)이면 넘긴다 */
    var built = null;
    try {
      built = offlineReceipt({ perspective: state.perspective, emp_id: resolveEmpIds().emp_id }, q);
    } catch (e2) { built = null; }
    if (built && built.text && built.intent && built.intent !== "unknown") {
      return {
        text: built.text, note: "지금 보이는 기록으로 확인했어요.",
        recos: built.recos, receipt: built.receipt
      };
    }

    /* ③ 이야기 중인 신호가 있으면 거기서 이어 간다 (20-6차) — 방금 신호 답을 받은
       사람이 자기 말로 되물었을 때 「연결되어 있지 않아요」로 끊기던 자리 */
    var tid = liveTopicId(q);
    if (tid) {
      var scT = sigContinue({ _sigId: tid, _sigNew: false, _q: q });
      if (scT.text) return { text: scT.text, note: "" };
    }

    /* ④ 사람 말 한 문장 */
    return { text: DEAD_END, note: "" };
  }

  /* 못 알아들은 질문이면 확인 카드를 지운다 (20-7차).
     「오늘 점심 뭐 먹지」에 「확인 끝 · 근거 4건」을 남기고 답은 「확인해 드리지
     못했어요」라고 하면, 카드가 하지도 않은 일을 했다고 말하는 셈이다. */
  function dropWork(aiMsg) {
    var m = aiMsg && aiMsg._work;
    if (!m) return;
    (m._timers || []).forEach(function (t) { clearTimeout(t); });
    m._timers = [];
    stopTick(m);
    aiMsg._work = null;
    try {
      if (window.EZChat && EZChat.removeMessage) { EZChat.removeMessage(m); return; }
    } catch (e) { /* 아래 폴백 */ }
    var arr = msgs(), i = arr.indexOf(m);
    if (i >= 0) arr.splice(i, 1);
  }

  function answerFallback(aiMsg, detail) {
    if (!aiMsg) return false;
    if (detail) {
      try { console.warn("[elizax] 답변 경로 실패 — 화면에는 내보내지 않는다:", detail); }
      catch (e) { /* ignore */ }
    }
    var ans = pickFallbackAnswer(aiMsg);
    /* 답은 벌써 준비됐지만, 대본 카드가 스텝을 다 보여 줄 때까지 기다렸다 앉힌다
       (19-3차) — 그래야 "지금 일하고 있다"가 눈에 보인다. */
    afterWorkFloor(aiMsg, function () {
      if (aiMsg._stopped) return;   /* 그 사이 사용자가 중지했다 */
      if (ans.text === DEAD_END) dropWork(aiMsg); else completeWork(aiMsg);
      aiMsg.role = "ai";            /* err 버블로 두면 붉은 상자에 오류처럼 보인다 */
      aiMsg.streaming = false;
      aiMsg.text = ans.text;
      aiMsg.note = ans.note || "";
      aiMsg.noteWarn = false;
      if (ans.recos && ans.recos.length) aiMsg.recos = ans.recos;
      if (ans.receipt) {
        aiMsg.receipt = ans.receipt;
        if (!aiMsg.meta) aiMsg.meta = {};
        aiMsg.meta.receipt = ans.receipt;
      }
      finishStreaming();
      renderMessages();
    });
    return true;
  }
  /* 답으로 쓸 수 없는 응답인가.
     ① 빈 문자열 ② 설정·자격증명 안내문 — 백엔드가 200으로 돌려주기도 해서
     오류 분기만 막아서는 새어 나온다. 환경변수 이름·키 이름이 보이면 답이 아니다. */
  var CONFIG_LEAK = /(ANTHROPIC_API_KEY|AWS_KEYS_CSV|AWS_ACCESS_KEY_ID|AWS_SECRET|API[_\s-]?KEY|자격\s*증명|환경\s*변수|\.env\b)/i;
  function unusableAnswer(aiMsg) {
    var t = String((aiMsg && aiMsg.text) || "");
    if (!t.replace(/\s+/g, "")) return true;
    return CONFIG_LEAK.test(t);
  }

  /* ---- 신호 턴의 이어가는 말 (20-6차) ------------------------------------
     신호 답은 위 말풍선이 이미 다 했다. 여기서는 같은 말을 되풀이하지 않고
     **다음 한 걸음**만 묻는다 — 그 신호가 들고 있는 처리(actions) 가운데 첫째 것.
     예전에는 오프라인 경로가 이 질문을 의도 분기에 넣어 「무엇을 도와드릴까요」
     안내문을 뱉었다. 신호를 묻고 신호 답을 받은 사람에게는 대화가 끊긴 것으로 읽혔다. */
  function eulReul(w) {
    var c = String(w || "").charCodeAt(String(w).length - 1);
    if (!(c >= 0xac00 && c <= 0xd7a3)) return "를";
    return ((c - 0xac00) % 28) ? "을" : "를";
  }
  /* 물어본 사람에게 **말로** 하는 답 (20-7차).
     세 마디로 끝낸다 — ① 무엇이 보이는가(알림 문구 그대로) ② 그래서 지금 어떤
     상태인가(가장 넓은 근거 한 줄) ③ 그럼 무엇을 할까(처리 두 갈래).
     문장은 전부 판정 함수가 실측한 것에서 왔다. 새로 지어낸 숫자는 없다.
     자세한 근거·기준값·처리 단추는 이 말 바로 아래 알림 카드가 맡는다. */
  function sigInst(sid) {
    try {
      if (window.EZSignalEngine && EZSignalEngine.evaluate) return EZSignalEngine.evaluate(sid, roleKey());
    } catch (e) { /* 아래에서 null 처리 */ }
    return null;
  }
  function actLabels(sid) {
    var sig = null, i, all = (window.EZSignalCatalog && EZSignalCatalog.signals) || [];
    for (i = 0; i < all.length; i++) if (all[i].id === sid) { sig = all[i]; break; }
    var acts = ((sig && sig.actions) || []).slice().sort(function (a, b) { return (a.rank || 9) - (b.rank || 9); });
    var out = [];
    acts.forEach(function (a) {
      if (a.type === "A5") return;                    /* 「상세 보기」는 제안이 아니다 */
      var nm = String(a.label || "").replace(/\s*\([^)]*\)\s*$/, "");
      if (window.EZSignalChat && EZSignalChat.scrub) {
        try { nm = String(EZSignalChat.scrub(nm) || nm); } catch (e) { /* 원문 유지 */ }
      }
      if (nm) out.push(nm);
    });
    return out.slice(0, 2);
  }
  function sigHits(sid) {
    var inst = sigInst(sid);
    return !!(inst && inst.ready && inst.hit);
  }
  /* 알림 문구가 짚지 않은 근거를 한 줄 고른다 — 추정으로 표시된 줄은 말로 단정하지 않는다 */
  function sigExtraLine(inst, notice) {
    var rows = (inst && inst.evidence) || [], flat = String(notice || "").replace(/\s+/g, ""), i;
    for (i = 0; i < rows.length; i++) {
      var t = String(rows[i].text || "").replace(/[.\s]+$/, "");
      if (!t || rows[i].assumed) continue;
      if (/\{\{|\}\}/.test(t)) continue;              /* 치환 안 된 자리표시자는 내보내지 않는다 */
      if (flat && flat.indexOf(t.replace(/\s+/g, "")) >= 0) continue;
      return t;
    }
    return "";
  }
  function sigSpeak(sid) {
    var inst = sigInst(sid);
    var P = [];

    /* 셀 수 없는 신호 — 없는 근거를 있는 척하지 않는다 */
    if (!inst || !inst.ready) {
      return "그건 아직 회사 기록으로 세지 못해서 지금 수치로 말씀드리기 어려워요. "
        + "어떤 기록이 쌓이면 알려드릴 수 있는지 대신 짚어 드릴까요?";
    }

    /* 뜰 상태가 아니다 — 할 일이 없는데 처리를 제안하지 않는다 */
    if (!inst.hit) {
      P.push("확인해 보니 지금 챙기실 건 없어요.");
      var ok = sigExtraLine(inst, "");
      if (ok) P.push(ok + ".");
      P.push("다른 것도 봐 드릴까요?");
      return P.join(" ");
    }

    var notice = String(inst.notice || "");
    if (window.EZSignalChat && EZSignalChat.scrub) {
      try { notice = String(EZSignalChat.scrub(notice) || notice); } catch (e) { /* 원문 유지 */ }
    }
    /* ① 무엇이 보이는가 */
    P.push("네, 확인해 보니 " + notice.replace(/[.\s]+$/, "") + ".");
    /* ② 그래서 지금 어떤 상태인가 */
    var add = sigExtraLine(inst, notice);
    if (add) P.push(add + ".");
    /* ③ 그럼 무엇을 할까 — 카탈로그가 들고 있는 처리 그대로 */
    var L = actLabels(sid);
    if (L.length >= 2) {
      P.push("「" + L[0] + "」부터 잡아볼까요, 아니면 「" + L[1] + "」" + eulReul(L[1]) + " 볼까요?");
    } else if (L.length === 1) {
      P.push("「" + L[0] + "」" + eulReul(L[0]) + " 제가 잡아 드릴까요?");
    } else {
      P.push("이어서 무엇을 도와드릴까요?");
    }
    return P.join(" ");
  }
  /* 지금 이야기 중인 신호 — EZSignalChat 이 걸어 둔 주제.
     20-7차 — 아무 말에나 이 주제를 붙이면 안 된다. 「오늘 점심 뭐 먹지」에
     「위에 정리해 둔 내용부터 보시고」가 나오던 근본원인이 이 폴백이었다.
     앞말을 받는 티가 나는 짧은 말일 때만 이어 간다. */
  var FOLLOW_CUE = /(그럼|그거|그건|이거|이건|저거|거기|어디부터|어떻게|어떡|왜|더|자세히|다시|계속|그래서|아까|방금|누구부터|무엇부터|뭐부터)/;
  function liveTopicId(text) {
    try {
      var t = window.EZSignalChat && EZSignalChat.topic && EZSignalChat.topic();
      var id = (t && t.id) ? String(t.id) : "";
      if (!id) return "";
      if (text != null) {
        var q = String(text).replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
        if (q.length > 30 || !FOLLOW_CUE.test(q)) return "";
      }
      return id;
    } catch (e) { return ""; }
  }
  function sigContinue(aiMsg) {
    var sid = aiMsg._sigId, text = "";
    /* 뜰 상태가 아닌 알림에는 「위에 정리해 둔 내용」이 아예 없다 — 없는 것을
       가리키지 않게, 이 경우는 다시 물어도 말로 답한다 (20-7차) */
    if (!aiMsg._sigNew && sigHits(sid)) {
      /* 답을 이미 낸 주제를 다시 물었다 — 카탈로그의 다른 칸으로 답한다 */
      if (window.EZSignalChat && EZSignalChat.followAnswer) {
        try { text = String(EZSignalChat.followAnswer(sid, aiMsg._q || "", roleKey()) || ""); } catch (e) { text = ""; }
      }
      if (!text) text = "위에 정리해 둔 내용부터 보시고, 고치고 싶은 곳이 있으면 말씀해 주세요.";
    } else {
      text = sigSpeak(sid);
    }
    return { text: text, recos: [], receipt: null, intent: "signal" };
  }

  function offlineRespond(body, aiMsg, userText) {
    var built = (aiMsg && aiMsg._sigId) ? sigContinue(aiMsg) : offlineReceipt(body, userText);
    /* 못 알아들은 말인데 이야기 중인 신호가 있으면 거기서 이어 간다 (20-6차) */
    var tid0 = liveTopicId(userText);
    if (built.intent === "unknown" && tid0) {
      built = sigContinue({ _sigId: tid0, _sigNew: false, _q: userText });
    }
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
          : (built.intent === "unknown" ? "AI 미연결 · 연결 후 답변 가능" : "AI 미연결 · 로컬 확인 결과");
        aiMsg.noteWarn = built.intent === "unknown";
        finishStreaming();
        renderMessages();
      }
    }
    /* 확인 카드가 스텝을 다 세운 뒤에 말을 시작한다 (20-6차).
       카드가 없는 턴은 floor 가 0이라 예전과 똑같이 120ms 뒤 시작한다. */
    afterWorkFloor(aiMsg, function () {
      if (aiMsg._stopped) return;
      if (built.intent === "unknown") dropWork(aiMsg); else completeWork(aiMsg);
      setTimeout(tick, 120);
    });
  }

  /* ---------------- 실AI 응답의 수치 서술자 (F16) ----------------
     서술자에는 **실제로 일어난 일만** 담는다 — 호출된 도구와 그 요약, 도구 결과에서
     뽑은 수치. 연출 스텝이나 추정 수치는 넣지 않는다.
     도구를 하나도 안 부른 순수 대화 응답에는 수치 띠를 붙이지 않는다(신호 희석 방지).

     descriptor(msg.meta.receipt) 스키마:
       { title, asOf, offline:false, mode,   // title·asOf는 화면에 렌더하지 않는다(내부 기록용)
         tools:  [{ name, src, label, summary }],   // 실제 호출된 도구 (navigate·화면확인 제외)
         metrics:[{ k, v, sub? }],                  // 말풍선 아래 타일 띠 — 도구 결과에서만 (최대 4)
         srcs:   [{ kind, label }],                 // 렌더하지 않는다 — 근거 표시는
                                                    //   tx_ctx_ledger 스트립 하나로 모았다(중복 폐지)
         whatif: { emp_id?, achievement_delta?, cap_pct? } | null,
         wiParams?, wiResult? }                     // What-if 실행 후 runWhatIf가 채움 */
  var RC_SKIP_TOOLS = { navigate: 1, get_screen_context: 1 };
  /* 도구 원천 어휘 talenx/erp/rule/web — 지금은 서술자에만 남고 화면에는 쓰이지 않는다 */
  var RC_SRC_KIND = {
    get_checkins: "erp", simulate_whatif: "rule", get_strategy_themes: "rule",
    get_context_ledger: "talenx", get_org_overview: "talenx"
  };
  var RC_INTENT_TITLE = {
    goal: "목표 진척", checkin: "체크인 기록", grade: "등급 산출", team: "팀 현황",
    org: "전사 성과 조망", feedback: "피드백", oneonone: "1:1 기록", job: "직무 기준",
    whatif: "What-if 가정", work: "근무 확인", pay: "급여 확인"
  };
  var RC_SELF_INTENT = { team: 1, org: 1 };   /* 대상자 이름을 붙이지 않는 조직 단위 질문 */

  function rcLabelOf(name) {
    return (window.EZTools && EZTools.labelOf) ? EZTools.labelOf(name) : name;
  }
  function rcSrcOf(name) {
    return (window.EZTools && EZTools.srcOf) ? EZTools.srcOf(name) : "talenx";
  }
  /* 도구 결과 → 메트릭 행. 결과에 실제로 있는 값만 쓴다(없으면 행을 만들지 않는다). */
  function rcMetricsOf(name, res) {
    var out = [];
    if (!res || typeof res !== "object" || res.error || res.blocked) return out;
    var i, s, n, o;
    if (name === "get_objectives") {
      var objs = res.objectives || [];
      out.push({ k: "담당 목표", v: (res.count != null ? res.count : objs.length) + "건" });
      s = 0; n = 0;
      for (i = 0; i < objs.length; i++) { if (rcNum(objs[i].progress) != null) { s += objs[i].progress; n++; } }
      if (n) out.push({ k: "평균 진척", v: (Math.round(s / n * 10) / 10) + "%" });
    } else if (name === "get_checkins") {
      var cs = res.checkins || [];
      out.push({ k: "체크인", v: (res.count != null ? res.count : cs.length) + "건" });
      if (cs.length && cs[0].date) out.push({ k: "마지막", v: String(cs[0].date) });
    } else if (name === "get_employee_profile") {
      var ev = res.evaluation;
      if (ev && ev.grade != null) out.push({ k: "등급", v: String(ev.grade) });
      if (ev && rcNum(ev.weighted_score) != null) out.push({ k: "종합 점수", v: ev.weighted_score + "/100" });
      if (ev && ev.period) out.push({ k: "기간", v: String(ev.period) });
    } else if (name === "get_team_status") {
      /* 「팀원 N명」 타일은 폐지 — 머릿수는 어떤 질문에도 답하지 않는다(20-6차) */
      var mem = res.members || [];
      s = 0; n = 0;
      for (i = 0; i < mem.length; i++) { if (rcNum(mem[i].avg_progress) != null) { s += mem[i].avg_progress; n++; } }
      if (n) out.push({ k: "평균 진척", v: (Math.round(s / n * 10) / 10) + "%" });
    } else if (name === "get_org_overview") {
      if (res.employees != null) out.push({ k: "인원", v: res.employees + "명" });
      var d = res.grade_distribution || {}, tot = 0, top = 0;
      for (var g in d) { if (Object.prototype.hasOwnProperty.call(d, g)) { tot += d[g]; if (g === "S" || g === "A") top += d[g]; } }
      if (tot) out.push({ k: "상위등급(S+A)", v: (Math.round(top * 1000 / tot) / 10) + "%" });
    } else if (name === "get_job_profile") {
      o = res.profile || {};
      if ((o.task_areas || []).length) out.push({ k: "과업 영역", v: o.task_areas.length + "개" });
      if ((o.competency_profile || []).length) out.push({ k: "기준 역량", v: o.competency_profile.length + "종" });
      if ((o.skills || []).length) out.push({ k: "기대 스킬", v: o.skills.length + "종" });
    } else if (name === "get_context_ledger") {
      if (res.count != null) out.push({ k: "성과 기록", v: res.count + "건" });
    } else if (name === "get_upward_feedback") {
      if (res.count != null) out.push({ k: "상향 피드백", v: res.count + "건" });
    } else if (name === "get_org_objectives") {
      if (res.count != null) out.push({ k: "상위 목표 후보", v: res.count + "건" });
    } else if (name === "get_strategy_themes") {
      if (res.count != null) out.push({ k: "전략 테마", v: res.count + "건" });
    } else if (name === "get_prev_cycle") {
      if (res.first_cycle) out.push({ k: "이전 사이클", v: "없음" });
      else if (res.prev_evaluation && res.prev_evaluation.grade != null) out.push({ k: "직전 등급", v: String(res.prev_evaluation.grade) });
    } else if (name === "search_employee") {
      if (res.count != null) out.push({ k: "검색 결과", v: res.count + "명" });
    } else if (name === "simulate_whatif") {
      var pv = wiPersonal(res);
      if (pv && (pv.bg != null || pv.ag != null)) {
        out.push({ k: "시뮬 등급", v: (pv.bg == null ? "-" : pv.bg) + " → " + (pv.ag == null ? "-" : pv.ag) });
      } else if (res.moved_pp != null) {
        out.push({ k: "분포 재배치", v: res.moved_pp + "pp" });
      }
    }
    return out;
  }
  function rcTitle(question, calls) {
    var intent = offlineIntent(question);
    var subj = isSelfSubject() ? curUser().name : state.subject.name;
    var t = RC_INTENT_TITLE[intent];
    if (t) return RC_SELF_INTENT[intent] ? t : (subj + " · " + t);
    for (var i = 0; i < calls.length; i++) {
      if (!RC_SKIP_TOOLS[calls[i].name]) return rcLabelOf(calls[i].name) + " 결과";
    }
    var q = String(question || "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
    if (!q) return "확인 결과";
    return q.length > 22 ? q.slice(0, 21) + "…" : q;
  }
  /* What-if 서술자 — simulate_whatif를 실제로 부른 경우가 1순위,
     아니면 질문에 명시된 가정치(예: "-10%p", "상한 30%")가 읽힐 때만. 추정 기본값은 넣지 않는다. */
  function rcWhatIf(calls, question, sid) {
    var i, wi;
    for (i = 0; i < calls.length; i++) {
      if (calls[i].name !== "simulate_whatif") continue;
      var inp = calls[i].input || {};
      wi = { emp_id: inp.emp_id || sid };
      if (rcNum(Number(inp.achievement_delta)) != null && inp.achievement_delta !== "") wi.achievement_delta = Number(inp.achievement_delta);
      if (inp.cap_pct != null && inp.cap_pct !== "") wi.cap_pct = Number(inp.cap_pct);
      return wi;
    }
    if (!OFF_WHATIF_RE.test(String(question || ""))) return null;
    var pr = parseWhatIfText(question);
    if (pr.delta == null && pr.cap == null) return null;
    wi = { emp_id: sid };
    if (pr.delta != null) wi.achievement_delta = pr.delta;
    if (pr.cap != null) wi.cap_pct = pr.cap;
    return wi;
  }
  /* 모델이 실제로 인용한 성과 기록이 있는가 (판정 주체는 tx_ctx_ledger — 여기서 승격 금지) */
  function rcHasCitations(aiMsg) {
    var meta = (aiMsg && aiMsg.meta) || {};
    return meta.ctxCited === true && resolveRefs(meta.ctxRefs).length > 0;
  }
  function buildLiveReceipt(calls, question, aiMsg) {
    calls = Object.prototype.toString.call(calls) === "[object Array]" ? calls : [];
    var data = calls.filter(function (c) { return c && c.name && !RC_SKIP_TOOLS[c.name]; });
    var sid = resolveEmpIds().emp_id;
    var wi = rcWhatIf(data, question, sid);
    /* 카드를 붙일 근거: 실데이터 도구 호출 · 모델 실인용 · 명시된 What-if 가정 중 하나 이상 */
    if (!data.length && !rcHasCitations(aiMsg) && !wi) return null;

    var tools = [], metrics = [], srcs = [], seenM = {}, seenS = {};
    data.forEach(function (c) {
      tools.push({
        name: c.name, src: rcSrcOf(c.name), label: rcLabelOf(c.name),
        summary: c.summary || null
      });
      rcMetricsOf(c.name, c.result).forEach(function (x) {
        if (seenM[x.k] || metrics.length >= 4) return;
        seenM[x.k] = 1; metrics.push(x);
      });
      var kind = RC_SRC_KIND[c.name] || "talenx";
      var label = rcSrcOf(c.name) + " · " + rcLabelOf(c.name);
      if (!seenS[label]) { seenS[label] = 1; srcs.push({ kind: kind, label: label }); }
    });
    return {
      title: rcTitle(question, data),
      asOf: (window.EZKit && EZKit.clock) ? EZKit.clock.asOf() : "",
      offline: false,
      mode: aiMode(),
      tools: tools,
      metrics: metrics,
      srcs: srcs.slice(0, 5),
      whatif: wi
    };
  }
  /* 응답 완료 시 서술자를 msg.meta.receipt에 채운다 — 카드 렌더는 buildReceiptNode가 담당 */
  function attachLiveReceipt(aiMsg, calls, question) {
    if (!aiMsg || aiMsg.role !== "ai" || aiMsg._stopped) return null;
    if (aiMsg.receipt || (aiMsg.meta && aiMsg.meta.receipt)) return rcptOf(aiMsg);
    var r = null;
    try { r = buildLiveReceipt(calls, question, aiMsg); }
    catch (e) { return null; }
    if (!r) return null;
    aiMsg.receipt = r;
    if (!aiMsg.meta) aiMsg.meta = {};
    aiMsg.meta.receipt = r;   /* 세션 복원 후에도 카드로 남도록 */
    return r;
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
          /* 스트림이 한 글자도 안 주고 닫혔다 — 폴백 사다리로 (19-2차) */
          if (unusableAnswer(aiMsg)) { answerFallback(aiMsg, "스트림이 답 없이 닫혔다"); return; }
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
      /* 아무 말도 못 받고 끝났다 = 답이 없는 것 — 폴백 사다리로 (19-2차) */
      if (unusableAnswer(aiMsg)) { answerFallback(aiMsg, "응답이 비었거나 설정 안내문이다 (stream)"); return; }
      extractCtxRefs(aiMsg); /* 실인용 근거 마커 → meta.ctxRefs */
      /* LLM이 화면 이동을 지시했어도 저절로 가지 않는다 (19차 §5-5) — 마커만 걷고 물어본다 */
      var pending2 = null;
      if (window.EZNav && window.EZNav.extractMarker) {
        try {
          var ext = window.EZNav.extractMarker(aiMsg.text);
          if (ext.nav) { aiMsg.text = ext.clean; pending2 = ext.nav; }
        } catch (e) { /* ignore */ }
      }
      if (msg.recommendations && msg.recommendations.length) aiMsg.recos = msg.recommendations;
      if (msg.truncated) { aiMsg.note = "일부 생략됨"; }
      /* 라이브(proxy·direct) 텍스트 경로 — 도구 이벤트는 없지만 모델 실인용·명시 가정이 있으면 영수증 */
      attachLiveReceipt(aiMsg, aiMsg._calls, aiMsg._q);
      saveHistory();
      renderMessages();
      if (pending2) askNav(pending2.s, pending2.p, "");
    } else if (msg.type === "fallback") {
      /* 백엔드 폴백 문구(자격증명 안내 등)를 쓰지 않는다 — 우리 폴백 사다리로 (19-2차) */
      answerFallback(aiMsg, msg.response || "fallback");
    } else if (msg.type === "error") {
      answerFallback(aiMsg, msg.message || "error");
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
  /* 「● 연결됨 · AI 연결됨」 상태 배너 삭제 (18차 요청 2).
     남은 것은 단 하나 — EZAI.ready()가 false일 때만 뜨는 무채색 경고 한 줄.
     함수 자체는 호출자 4곳(build·probe 콜백·openPanel·EZAI 설정 저장) 때문에 유지한다. */
  function updateStatus() {
    var s = el.status;
    if (!s) return;
    var rdy = true;
    try { if (window.EZAI && EZAI.ready) rdy = !!EZAI.ready(); } catch (e) { rdy = true; }
    if (rdy) { s.hidden = true; s.textContent = ""; return; }
    s.hidden = false;
    s.textContent = "AI 미연결 상태예요. 연결 없이 예시 응답으로 보여드립니다.";
  }

  function openPanel() {
    state.open = true;
    el.root.classList.add("ezx-open");
    syncPerspectiveFromRole();
    updateScreenChip();
    updateStatus();
    updateFabCount();
    /* 18-2차 R1 — 열면 대화 탭(빈 채팅창). 알림을 여기서 렌더·markAllRead 하지 않는다:
       패널을 여는 것만으로 배지가 지워지면 「9+가 뭘 뜻하는지 모르겠다」가 되돌아온다.
       배지는 알림 탭을 실제로 눌렀을 때만(setTab) 지워진다. */
    if (curTab === "ntf") renderNtf(null);
    setTimeout(function () { try { el.textarea.focus(); } catch (e) {} }, 220);
  }
  function closePanel() {
    state.open = false;
    el.root.classList.remove("ezx-open");
    closeCatalog();
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
    /* 19차 §5-5 — 이동은 물어보고 간다. 처리 모듈이 이걸 부른다.
       askNav(s, p, reason) → 답변 아래에 [<화면> 열기] [여기서 계속] 두 버튼을 붙인다. */
    askNav: askNav,
    /* 19차 §5-2 — 대화 안에서 대상 바꾸기. 이름을 못 찾으면 null */
    setSubjectByName: setSubjectByName,
    subject: function () { return state.subject ? { emp_id: state.subject.emp_id, name: state.subject.name } : null; },
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
