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
    var el = document.querySelector("section.screen.on");
    if (!el) return "홈";
    return SCREEN_LABELS[el.id] || "홈";
  }

  var PERSPECTIVES = [
    { key: "subject", label: "본인" },
    { key: "manager", label: "팀장" },
    { key: "hr", label: "HR" },
    { key: "executive", label: "경영진" }
  ];
  function needsSubject(p) { return p === "manager" || p === "executive"; }

  /* ---------------- State ---------------- */
  var state = {
    open: false,
    perspective: "subject",
    subject: null,        // {emp_id,name,jobTitle} chosen for manager/executive
    attachContext: true,
    streaming: false,
    messages: []          // {role:'user'|'ai'|'err', text, recos?, note?}
  };

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
    titles.appendChild(h("div", "ezx-sub", { text: "AI 성과관리 코치" }));
    var xbtn = h("button", "ezx-x", { "aria-label": "닫기", text: "✕" });
    xbtn.addEventListener("click", closePanel);
    top.appendChild(mark); top.appendChild(titles); top.appendChild(xbtn);
    head.appendChild(top);

    /* perspective selector */
    var persp = h("div", "ezx-persp", { role: "tablist", "aria-label": "관점 선택" });
    PERSPECTIVES.forEach(function (p) {
      var b = h("button", p.key === state.perspective ? "on" : "", { text: p.label, "data-p": p.key, role: "tab" });
      b.addEventListener("click", function () { setPerspective(p.key); });
      persp.appendChild(b);
    });
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

    syncSubjectUI();
    renderMessages();
  }

  function autoGrow() {
    var ta = el.textarea;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }

  /* ---------------- Perspective / subject ---------------- */
  function setPerspective(p) {
    state.perspective = p;
    Array.prototype.forEach.call(el.persp.children, function (b) {
      b.classList.toggle("on", b.getAttribute("data-p") === p);
    });
    syncSubjectUI();
  }
  function syncSubjectUI() {
    var need = needsSubject(state.perspective);
    el.root.classList.toggle("ezx-need-subject", need);
    if (need && !state.subject) {
      el.pickerInput.placeholder = "대상 직원 검색 (이름)";
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
  function renderMessages() {
    var list = el.list;
    list.innerHTML = "";
    if (!state.messages.length) {
      list.appendChild(buildEmptyState());
      return;
    }
    state.messages.forEach(function (m) { list.appendChild(buildMsgNode(m)); });
    scrollToBottom();
  }
  function buildEmptyState() {
    var wrap = h("div", "ezx-empty");
    wrap.appendChild(h("div", "eh", { text: "무엇을 도와드릴까요?" }));
    var sub = h("div", "es");
    sub.textContent = "성과관리 · OKR · 평가에 대해 물어보세요.";
    wrap.appendChild(sub);
    var starters = h("div", "ezx-starters");
    ["이번 분기 OKR 추천해줘", "내 목표 진행상황 점검", "동료 피드백 요약", "평가 근거 설명해줘"].forEach(function (s) {
      var b = h("button", "ezx-starter", { text: s, type: "button" });
      b.addEventListener("click", function () { sendMessage(s); });
      starters.appendChild(b);
    });
    wrap.appendChild(starters);
    return wrap;
  }
  function buildMsgNode(m) {
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
    el.list.scrollTop = el.list.scrollHeight;
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

  function sendMessage(userText) {
    if (state.streaming) return;
    // guard: manager/executive needs a subject
    if (needsSubject(state.perspective) && !state.subject) {
      pushMessage({ role: "err", text: "이 관점에서는 대상 직원을 먼저 선택해 주세요." });
      renderMessages();
      el.pickerInput.focus();
      return;
    }
    pushMessage({ role: "user", text: userText });
    var aiMsg = { role: "ai", text: "", streaming: true };
    pushMessage(aiMsg);
    renderMessages();

    state.streaming = true;
    el.send.disabled = true;
    el.textarea.disabled = true;

    var ids = resolveEmpIds();
    var body = {
      emp_id: ids.emp_id,
      message: buildPayloadMessage(userText),
      perspective: state.perspective
    };
    if (ids.actor_emp_id) body.actor_emp_id = ids.actor_emp_id;

    streamChat(body, aiMsg);
  }

  function finishStreaming() {
    state.streaming = false;
    el.send.disabled = false;
    el.textarea.disabled = false;
  }

  function streamChat(body, aiMsg) {
    if (OFFLINE) { offlineRespond(body, aiMsg); return; }
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
      aiMsg.role = "err";
      aiMsg.streaming = false;
      aiMsg.text = "연결에 실패했습니다 (" + (err && err.message ? err.message : "network") +
        "). 백엔드를 실행해 주세요: `demo-app/run.sh` 실행 후 ANTHROPIC_API_KEY 설정.";
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
        "전사 성과 조망입니다. 목표 정합성과 등급 분포 리스크를 요약합니다.\n\n" +
        "**계산·근거 트레이스**\n" +
        "- `talenx` 전사 OKR 트리 정렬 상태\n" +
        "- `ERP` 전사 매출 달성률 대비 진척\n" +
        "- `통계·분포` 본부 간 등급 분포 편차\n\n" +
        "**감사** · 감사 로그 기록됨 · 탐색 범위: 전사\n\n" +
        "**What-if** · 목표 미연결 항목 정렬 시 전사 정합성 지표 재계산.";
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
    if (!msg || !msg.type) {
      // some servers send bare {response:...}
      if (msg && msg.response) { aiMsg.text = msg.response; refreshBubble(aiMsg); }
      return;
    }
    if (msg.type === "chunk") {
      aiMsg.text += (msg.content || "");
      refreshBubble(aiMsg);
    } else if (msg.type === "done") {
      aiMsg.streaming = false;
      if (msg.recommendations && msg.recommendations.length) aiMsg.recos = msg.recommendations;
      if (msg.truncated) { aiMsg.note = "일부 생략됨"; }
      renderMessages();
    } else if (msg.type === "fallback") {
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

  function pushMessage(m) { state.messages.push(m); return m; }

  /* ---------------- Reset ---------------- */
  function resetConversation() {
    state.messages = [];
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
  function openPanel() {
    state.open = true;
    el.root.classList.add("ezx-open");
    updateScreenChip();
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
    }
  };

  /* ---------------- Init ---------------- */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
