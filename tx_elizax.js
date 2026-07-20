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
    var fab = h("button", "ezx-fab", { "aria-label": "elizax AI 코치 열기", "title": "elizax" });
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2l1.9 5.1L19 9l-5.1 1.9L12 16l-1.9-5.1L5 9l5.1-1.9L12 2z" fill="currentColor"/><circle cx="18.5" cy="16.5" r="2" fill="currentColor" opacity=".85"/></svg>';
    fab.addEventListener("click", openPanel);

    /* Panel */
    var panel = h("div", "ezx-panel", { role: "dialog", "aria-label": "elizax AI 성과관리 코치", "aria-modal": "false" });

    /* Header */
    var head = h("div", "ezx-head");
    var top = h("div", "ezx-head-top");
    var mark = h("div", "ezx-mark");
    mark.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2l1.9 5.1L19 9l-5.1 1.9L12 16l-1.9-5.1L5 9l5.1-1.9L12 2z" fill="currentColor"/></svg>';
    var titles = h("div", "ezx-titles");
    titles.appendChild(h("div", "ezx-title", { text: "elizax" }));
    var sub = h("div", "ezx-sub", { text: "AI 성과관리 코치" });
    titles.appendChild(sub);
    el.sub = sub;
    var exbtn = h("button", "ezx-x ezx-expand", { "aria-label": "전체화면으로 전환", title: "워크스페이스로 전환", text: "⛶" });
    exbtn.addEventListener("click", function () {
      /* 전체화면 전환 시 같은 대화가 이어지도록 대화 스크린으로 진입 */
      if (window.TXAgent && window.TXAgent.openHub) { closePanel(); window.TXAgent.openHub("chat"); }
    });
    var gear = h("button", "ezx-x", { "aria-label": "AI 연결 설정", title: "AI 연결 설정 (API 키)", text: "⚙" });
    gear.addEventListener("click", function () {
      if (window.EZAI && window.EZAI.openSettings) window.EZAI.openSettings(function () { updateAiBadge(); renderMessages(); });
    });
    var xbtn = h("button", "ezx-x", { "aria-label": "닫기", text: "✕" });
    xbtn.addEventListener("click", closePanel);
    top.appendChild(mark); top.appendChild(titles); top.appendChild(gear); top.appendChild(exbtn); top.appendChild(xbtn);
    head.appendChild(top);

    /* perspective: 수동 탭 제거 — 역할 주체(TXRoles)에 따라 자동 전환 */
    var persp = h("div", "ezx-persp ezx-persp-auto", { "aria-label": "관점 (역할 자동 연동)" });
    persp.innerHTML =
      '<span class="ezx-persp-chip"><span class="dot"></span><b data-ezx-plabel>' +
      esc(perspectiveLabel(state.perspective)) + "</b> 관점</span>" +
      '<span class="ezx-persp-note">역할 주체에 따라 자동 전환 · 상단 관점 스위처 연동</span>';
    head.appendChild(persp);
    el.persp = persp;

    /* employee picker */
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

    /* footer / composer */
    var foot = h("div", "ezx-foot");
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

    panel.appendChild(head);
    panel.appendChild(ctx);
    panel.appendChild(list);
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
        updateAiBadge();
        if (!msgs().length) renderMessages();
      });
    }
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
    if (need && !state.subject) {
      el.pickerInput.placeholder = "대상 직원 검색 (이름)";
    }
    if (need && state.subject && el.pickerInput && !el.pickerInput.value) {
      el.pickerInput.value = state.subject.name;   // 자동 선택된 기본 대상 표시
    }
    updateScreenChip();
  }
  function renderPickerList(q) {
    var list = el.pickerList;
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
    sub.textContent = "성과관리 · OKR · 평가에 대해 물어보세요.";
    wrap.appendChild(sub);

    var m = aiMode();
    if (m === "offline") {
      var off = h("div", "ezx-agent-off");
      off.innerHTML = "AI 미연결 — 오프라인 목업 응답 모드. ";
      var connect = h("button", "ezx-starter", { type: "button", text: "⚙ Claude API 연결" });
      connect.style.marginLeft = "6px";
      connect.addEventListener("click", function () {
        if (window.EZAI && window.EZAI.openSettings) window.EZAI.openSettings(function () { updateAiBadge(); renderMessages(); });
      });
      off.appendChild(connect);
      wrap.appendChild(off);
    } else {
      var ready = !window.EZAI || !window.EZAI.ready || window.EZAI.ready();
      var onNote = h("div", "ezx-persp-note");
      onNote.style.marginTop = "10px";
      onNote.innerHTML = (ready ? "● <b>Claude 연결됨</b> · " : "◐ ") + esc(window.EZAI ? window.EZAI.modeLabel() : "프록시");
      onNote.style.color = ready ? "#15803D" : "#B45309";
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
    ["내 목표 진행상황 점검", "평가 근거 설명해줘", "동료 피드백 요약"].forEach(function (s) {
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
    var node = h("div", "ezx-msg " + (m.role === "user" ? "user" : m.role === "err" ? "err" : "ai"));
    var bubble = h("div", "ezx-bubble");
    if (m.role === "user") bubble.textContent = m.text;
    else bubble.innerHTML = mdToHtml(m.text || "");
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

  function buildPayloadMessage(userText) {
    if (!state.attachContext) return userText;
    var label = activeScreenLabel();
    var line = "[현재 화면: " + label + " / 사용자: " + CURRENT.name + "·" + (CURRENT.jobTitle || "") + "]";
    if (needsSubject(state.perspective) && state.subject) {
      line = "[현재 화면: " + label + " / 대상: " + state.subject.name + "·" + (state.subject.jobTitle || "") + " / 요청자: " + CURRENT.name + "]";
    }
    return line + "\n" + userText;
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
      if (scnKey) { runScenarioInChat(scnKey, userText); return; }
    }
    // guard: manager/executive needs a subject
    if (needsSubject(state.perspective) && !state.subject) {
      pushMessage({ role: "err", text: "이 관점에서는 대상 직원을 먼저 선택해 주세요." });
      renderMessages();
      el.pickerInput.focus();
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
    else streamChat(body, aiMsg);
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

  function streamChat(body, aiMsg) {
    var m = aiMode();
    if (m === "offline") { offlineRespond(body, aiMsg); return; }
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
          if (j.recommendations && j.recommendations.length) aiMsg.recos = j.recommendations;
          if (j.type === "fallback" || j.source === "fallback") { aiMsg.note = "AI 키 미설정 — 기본 응답"; }
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
        "). 백엔드를 실행해 주세요: `node server/server.js` (환경변수 ANTHROPIC_API_KEY 설정).";
      finishStreaming();
      renderMessages();
    });
  }

  /* ---------------- Offline mockup responder ----------------
     No backend → build a verifiable answer-receipt (as-of / 근거 트레이스 /
     감사 / What-if) from TALENX_DATA and stream it in char-batches. */
  function evalOf(empId) {
    var evs = Array.isArray(DATA.evaluations) ? DATA.evaluations : [];
    return evs.find(function (e) { return e.emp_id === empId; }) || null;
  }
  function objsOwnedBy(empId) {
    var objs = Array.isArray(DATA.objectives) ? DATA.objectives : [];
    return objs.filter(function (o) { return o.owner_emp_id === empId; });
  }
  function krsOf(objId) {
    var krs = Array.isArray(DATA.keyResults) ? DATA.keyResults : [];
    return krs.filter(function (k) { return k.objective_id === objId; });
  }
  function offlineReceipt(body) {
    var p = body.perspective || "subject";
    var subjName = (needsSubject(p) && state.subject) ? state.subject.name : CURRENT.name;
    var subjId = body.emp_id || CURRENT.emp_id;
    var ev = evalOf(subjId);
    var grade = ev ? ev.grade : "B+";
    var score = ev ? ev.weighted_score : 73.3;
    var owned = objsOwnedBy(subjId);
    var objCount = owned.length;
    var asof = "2026 상반기 · 6/30 마감 실적 기준";
    var md = "", recos = [];

    if (p === "manager") {
      md =
        "**기준 시점** · " + asof + "\n\n" +
        "**" + subjName + "**님 등급 초안은 **" + grade + "** (종합 " + score + "/100)입니다. 팀 대비 실행 일관성이 안정적입니다.\n\n" +
        "**계산·근거 트레이스**\n" +
        "- `ERP` 목표 달성률 집계 → 종합 " + score + "/100 `eval.FY2026." + subjId + "`\n" +
        "- `평가규정 v3.1` 등급 매핑 · §12\n" +
        "- `talenx` 팀 내 1:1·피어리뷰 대조\n\n" +
        "**감사** · 감사 로그 기록됨 · 탐색 범위: 권한 내 우리 팀\n\n" +
        "**What-if** · 강제배분(상위 S~A ≤ 30%) 적용 시 팀 등급 분포를 재계산할 수 있습니다.\n\n" +
        "> ⚠ 자동 확정 아님 — 승인/수정/보류는 조직장이 결정합니다.";
    } else if (p === "hr") {
      md =
        "**기준 시점** · " + asof + "\n\n" +
        "전사 평가 운영 관점 요약입니다. 관대화·미연결 신호를 먼저 보고합니다.\n\n" +
        "**계산·근거 트레이스**\n" +
        "- `평가규정 v3.1` 등급 비율 규칙 · 강제배분 상한 30%\n" +
        "- `talenx` 목표 정렬·가중치 합 검증 `rule.weight.sum`\n" +
        "- `ERP` 실적 대조 → 등급 상승폭 설명력 점검\n\n" +
        "**감사** · 감사 로그 기록됨 · 탐색 범위: 권한 내 전사\n\n" +
        "**What-if** · 특정 본부에 강제배분 적용 시 전사 분포 변화를 재계산할 수 있습니다.\n\n" +
        "> 민감 이슈(관대화·편향)는 재검토만 제안하며 자동 수정하지 않습니다.";
    } else if (p === "executive") {
      md =
        "**기준 시점** · " + asof + "\n\n" +
        "전사 성과 조망입니다. 목표 정렬 상태와 등급 분포 리스크를 요약합니다.\n\n" +
        "**계산·근거 트레이스**\n" +
        "- `talenx` 전사 OKR 트리 정렬 상태\n" +
        "- `ERP` 전사 매출 달성률 대비 진척\n" +
        "- `통계·분포` 본부 간 등급 분포 편차\n\n" +
        "**감사** · 감사 로그 기록됨 · 탐색 범위: 전사\n\n" +
        "**What-if** · 목표 미연결 항목 정렬 시 전사 정렬률 지표 재계산.";
    } else {
      md =
        "**기준 시점** · " + asof + "\n\n" +
        subjName + "님 상반기 등급 초안은 **" + grade + "** (종합 " + score + "/100)입니다. 목표 달성률과 피어리뷰가 안정적입니다.\n\n" +
        "**계산·근거 트레이스**\n" +
        "- `ERP` 목표 달성률 집계 → 종합 " + score + "/100 `eval.FY2026." + subjId + "`\n" +
        "- `평가규정 v3.1` 등급 매핑 (초과달성 120%↑) · §12\n" +
        "- `talenx` 중간 1:1 기록 대조\n\n" +
        "**감사** · 감사 로그 기록됨 · 탐색 범위: 권한 내 본인\n\n" +
        "**What-if** · 달성률 -10%p 가정 시 등급이 한 단계 하향될 수 있습니다(재계산 가능).\n\n" +
        "현재 담당 목표 " + objCount + "건 기준입니다.";
      owned.slice(0, 2).forEach(function (o) {
        recos.push({
          objective: o.title,
          rationale: "진행률 " + (o.progress != null ? o.progress + "%" : "-") + " · " + (o.status || ""),
          krs: krsOf(o.objective_id).slice(0, 2).map(function (k) {
            return { name: k.name, target: k.target_value, weight: k.weight, difficulty: k.difficulty };
          })
        });
      });
    }
    return { text: md, recos: recos };
  }
  function offlineRespond(body, aiMsg) {
    var built = offlineReceipt(body);
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
        aiMsg.note = "오프라인 목업 응답 · 백엔드 미연결 (실시간 AI는 demo-app/run.sh 필요)";
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
      aiMsg.note = "AI 키 미설정 — 기본 응답";
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
    aiMsg._bubble.innerHTML = mdToHtml(aiMsg.text || "");
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
  /* 헤더 서브타이틀에 AI 연결 상태 상시 표시 */
  function updateAiBadge() {
    if (!el.sub) return;
    var rdy = window.EZAI && EZAI.ready && EZAI.ready();
    var m = aiMode();
    var dot = rdy ? '<span style="color:#15803D">● Claude</span>'
      : m === "offline" ? '<span style="color:#98A2B3">○ 오프라인</span>'
      : '<span style="color:#B45309">◐ 키 미설정</span>';
    el.sub.innerHTML = "AI 성과관리 코치 · " + dot;
  }

  function openPanel() {
    state.open = true;
    el.root.classList.add("ezx-open");
    syncPerspectiveFromRole();
    updateScreenChip();
    updateAiBadge();
    setTimeout(function () { try { el.textarea.focus(); } catch (e) {} }, 220);
  }
  function closePanel() {
    state.open = false;
    el.root.classList.remove("ezx-open");
    el.pickerList.classList.remove("on");
    try { el.fab.focus(); } catch (e) {}
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
