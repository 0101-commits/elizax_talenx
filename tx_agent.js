/* ============================================================
   tx_agent.js — 성과관리/평가 E2E AI Agent Hub
   W2(마스터 3분할 UI·노드 워크플로우·Calibration·리뷰 co-writing)
   + W3(S1~S8 응답 프로토콜·3대 UX 형태·Quick-win 7과제·자율성 배지)
   perf-agent-verifiable-ui 4원칙 준수: as-of · trace · audit · what-if.

   노출 형태 3종:
     ① 도킹 대화창  — elizax 패널(기존)과 명령어 입력창
     ② 선제 팝업    — 메인 앱 위 감지 카드 (schedureProactive)
     ③ 전체화면 딥워크 — Agent Hub 오버레이 (openHub)

   Exposes window.TXAgent = { openHub, closeHub, open(screen) }.
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- data ---------------- */
  function D() { return window.TALENX_DATA || {}; }
  function CU() { return (D().meta && D().meta.currentUser) || { name: "사용자", emp_id: "EMP-0000" }; }
  function role() {
    try { return (window.TXRoles && TXRoles.current()) || { key: "member", label: "조직원" }; }
    catch (e) { return { key: "member", label: "조직원" }; }
  }
  function team() {
    var cu = CU();
    return (D().employees || []).filter(function (e) { return e.org_id === cu.org_id && e.emp_id !== cu.emp_id; });
  }
  function myObjectives() {
    var cu = CU();
    return (D().objectives || []).filter(function (o) { return o.owner_emp_id === cu.emp_id; });
  }

  /* ---------------- helpers ---------------- */
  function h(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function toast(m, k) { if (window.TX && TX.toast) TX.toast(m, k || ""); }
  function nowLabel() {
    var t = new Date();
    function z(n) { return (n < 10 ? "0" : "") + n; }
    return z(t.getHours()) + ":" + z(t.getMinutes());
  }
  var AS_OF = "2026 상반기 · 7/15 06:00 스냅샷";

  /* ---------------- state ---------------- */
  var state = {
    open: false,
    screen: null,
    timers: [],
    audit: [],          // {at, actor, act, target, ref}
    assets: [],         // {at, kind, title, screen}
    decided: {},        // screenKey -> {act, note}
    whatifCap: 30       // 강제배분 상한 %
  };
  function clearTimers() {
    state.timers.forEach(function (t) { clearTimeout(t); clearInterval(t); });
    state.timers = [];
  }
  function later(fn, ms) { var t = setTimeout(fn, ms); state.timers.push(t); return t; }

  function logAudit(act, target, ref) {
    state.audit.unshift({ at: nowLabel(), actor: CU().name, act: act, target: target, ref: ref || ("GA-" + (26000 + state.audit.length)) });
    var b = document.querySelector("[data-agh-auditcnt]");
    if (b) b.textContent = state.audit.length;
  }
  function addAsset(kind, title, screen) {
    state.assets.unshift({ at: nowLabel(), kind: kind, title: title, screen: screen });
  }

  /* ---------------- 자율성 배지 (W3 p16 ⑧) ---------------- */
  function autonomyBadge(mode) {
    var map = { auto: ["auto", "집계·데이터 반영은 에이전트가 바로 실행"], suggest: ["suggest", "등급·문구는 근거와 함께 제안만"], human_approve: ["human_approve", "확정·전송은 사람 승인 게이트 필수"] };
    var m = map[mode] || map.suggest;
    return '<span class="agh-badge agh-b-' + mode + '" title="' + esc(m[1]) + '">● ' + m[0] + "</span>";
  }

  /* ---------------- S1~S8 프로토콜 스트립 (W3 p5) ---------------- */
  var PROTO = [
    ["S1 감지", "선제 트리거"], ["S2 정합", "맥락 로드"], ["S3 계획", "노드 표출"], ["S4 수행", "병렬 조회"],
    ["S5 정초", "원천 인용"], ["S6 객체화", "구조화 객체"], ["S7 게이팅", "승인 후 commit"], ["S8 자산화", "검증 상태 인수"]
  ];
  function protoStrip(key) {
    var cells = PROTO.map(function (p, i) {
      return '<div class="agh-ps" data-ps="' + i + '"><span class="dot"></span><b>' + p[0] + "</b><small>" + p[1] + "</small></div>";
    }).join("");
    return '<div class="agh-proto" data-proto="' + key + '">' + cells + "</div>";
  }
  function protoTo(rootEl, idx) {
    var cells = rootEl.querySelectorAll(".agh-ps");
    Array.prototype.forEach.call(cells, function (c, i) {
      c.classList.toggle("done", i < idx);
      c.classList.toggle("cur", i === idx);
    });
  }

  /* ---------------- 근거 칩 (원천 인용 · trace) ---------------- */
  function srcChip(kind, label) {
    return '<span class="agh-src agh-s-' + kind + '">' + esc(label) + "</span>";
  }

  /* ---------------- 승인 게이트 (공통 · S7) ---------------- */
  function gateHTML(key, labels) {
    labels = labels || ["승인", "수정", "보류"];
    var dec = state.decided[key];
    var btns = labels.map(function (l, i) {
      return '<button class="agh-btn' + (i === 0 ? " primary" : "") + '" data-gact="' + esc(l) + '" data-gkey="' + esc(key) + '"' +
        (dec ? " disabled" : "") + (dec && dec.act === l ? ' data-chosen="1"' : "") + ">" + esc(l) + "</button>";
    }).join("");
    return '<div class="agh-gate" data-gate="' + esc(key) + '">' +
      '<span class="lab">결정 게이트 · 사람이 확정 (승인 전 side-effect 0)</span>' + btns +
      (dec ? '<span class="agh-dec">✓ ' + esc(dec.act) + " · 감사 기록됨</span>" : "") + "</div>";
  }
  function decideGate(key, act, note) {
    state.decided[key] = { act: act, note: note || "" };
    var scr = SCREENS[key];
    logAudit(act, (scr ? scr.title : key), null);
    addAsset("결정", (scr ? scr.title : key) + " · " + act + (note ? " — " + note : ""), key);
    var g = document.querySelector('[data-gate="' + key + '"]');
    if (g) {
      Array.prototype.forEach.call(g.querySelectorAll("[data-gact]"), function (b) {
        b.disabled = true;
        if (b.getAttribute("data-gact") === act) b.setAttribute("data-chosen", "1");
      });
      if (!g.querySelector(".agh-dec")) g.appendChild(h("span", "agh-dec", "✓ " + esc(act) + " · 감사 기록됨"));
    }
    var pr = document.querySelector('[data-proto="' + key + '"]');
    if (pr) protoTo(pr, 8); // S8 자산화 완료
    toast(act + " 처리 — 감사 로그 기록 · 산출물로 자산화되었습니다.", act.indexOf("승인") === 0 ? "ok" : "");
  }

  /* ============================================================
     화면 정의 — Quick-win 7과제 + W2 심화 2종 + 자산/감사
     ============================================================ */
  var SCREENS = {
    home:    { title: "오늘 브리핑",              nav: "홈",                       mode: null },
    qw2:     { title: "개인맥락 목표 초안 · 정렬 검증", nav: "① 목표 초안+정렬",     mode: "suggest",       group: "목표관리" },
    qw7:     { title: "목표 정합성·중복 점검",      nav: "② 목표 정합성 점검",       mode: "suggest",       group: "목표관리" },
    qw1:     { title: "주간 체크인 팝업 · 진척 요약", nav: "③ 주간 체크인",          mode: "auto",          group: "성과관리" },
    qw4:     { title: "상시 근거 수집 타임라인",     nav: "④ 상시 근거 수집",        mode: "suggest",       group: "성과관리" },
    qw6:     { title: "피드백 문장 정제 (SBI)",     nav: "⑤ 피드백 정제",           mode: "suggest",       group: "성과관리" },
    qw3:     { title: "평가 코멘트 근거초안",       nav: "⑥ 평가 코멘트 초안",       mode: "human_approve", group: "평가관리" },
    hold:    { title: "HOLD · 근거 부족 시 정지",   nav: "⑧ HOLD 데모",             mode: "suggest",       group: "평가관리" },
    qw5:     { title: "평가 편향 점검",            nav: "⑦ 편향 점검",             mode: "suggest",       group: "평가관리" },
    calib:   { title: "등급 Calibration 라운드테이블", nav: "Calibration 심의",     mode: "human_approve", group: "평가관리" },
    review:  { title: "리뷰 초안 co-writing",      nav: "리뷰 초안 작성",           mode: "human_approve", group: "평가관리" },
    assets:  { title: "산출물 · 프로세스 자산",     nav: "산출물",                   mode: null,            group: "자산" },
    audit:   { title: "감사 로그",                nav: "감사 로그",                mode: null,            group: "자산" }
  };
  var NAV_ORDER = ["home", "qw2", "qw7", "qw1", "qw4", "qw6", "qw3", "hold", "qw5", "calib", "review", "assets", "audit"];

  /* 역할별 기본 화면 (역할 주체 자동 연동) */
  function defaultScreen() {
    var k = role().key;
    if (k === "leader") return "qw1";
    if (k === "hr") return "qw5";
    if (k === "exec") return "qw7";
    return "qw2";
  }

  /* ============================================================
     HUB 골격 — W2 p10 마스터 UI: 글로벌바/내비/캔버스/컨텍스트패널/상태바/명령어
     ============================================================ */
  var el = {};
  function buildHub() {
    if (el.root) return;
    var root = h("div", "agh-root");

    /* ① 글로벌바 */
    var bar = h("div", "agh-gbar");
    bar.innerHTML =
      '<div class="agh-gl"><span class="agh-logo">◆</span><b>Performance AI Agent</b>' +
      '<span class="agh-rolechip" data-agh-role></span></div>' +
      '<div class="agh-gr">' +
      '<button class="agh-gitem" data-agh-alerts>🔔 알림 <b data-agh-alertcnt>3</b></button>' +
      '<span class="agh-gitem">⚙ 백그라운드 작업 <b>2건</b></span>' +
      '<button class="agh-gitem" data-agh-close>메인으로 ✕</button></div>';

    /* ② 내비 */
    var nav = h("nav", "agh-nav");

    /* ③ 캔버스 */
    var canvas = h("main", "agh-canvas");

    /* ④ 컨텍스트 패널 */
    var ctx = h("aside", "agh-ctx");

    /* ⑤ 상태바 (연동 소스 상시 표시 — W3 p16 ⑩) */
    var status = h("div", "agh-status");
    status.innerHTML =
      '<div class="agh-srcs"><span class="lab">연결 소스</span>' +
      '<span class="agh-conn on">● talenx</span><span class="agh-conn on">● ERP</span>' +
      '<span class="agh-conn on">● Slack</span><span class="agh-conn dim">○ MS 365</span></div>' +
      '<span class="agh-asof">📌 ' + esc(AS_OF) + "</span>" +
      '<span class="agh-audit-mini">감사 기록 <b data-agh-auditcnt>0</b>건</span>';

    /* ⑥ 명령어 입력창 */
    var cmd = h("div", "agh-cmd");
    cmd.innerHTML =
      '<input type="text" placeholder="에이전트에게 지시… (예: 3팀 체크인 요약해줘)" data-agh-cmdin>' +
      '<button class="agh-btn primary" data-agh-cmdgo>실행</button>';

    var mid = h("div", "agh-mid");
    mid.appendChild(nav); mid.appendChild(canvas); mid.appendChild(ctx);
    root.appendChild(bar); root.appendChild(mid);
    var bottom = h("div", "agh-bottom");
    bottom.appendChild(cmd); bottom.appendChild(status);
    root.appendChild(bottom);
    document.body.appendChild(root);

    el.root = root; el.nav = nav; el.canvas = canvas; el.ctx = ctx;

    /* events */
    bar.querySelector("[data-agh-close]").addEventListener("click", closeHub);
    bar.querySelector("[data-agh-alerts]").addEventListener("click", showAlerts);
    cmd.querySelector("[data-agh-cmdgo]").addEventListener("click", runCmd);
    cmd.querySelector("[data-agh-cmdin]").addEventListener("keydown", function (e) {
      if (e.key === "Enter") runCmd();
    });
    root.addEventListener("click", function (e) {
      var g = e.target.closest("[data-gact]");
      if (g && !g.disabled) {
        var key = g.getAttribute("data-gkey"), act = g.getAttribute("data-gact");
        if (act === "승인" || act === "승인·발송" || act === "병합·연결 승인" || act === "반영") decideGate(key, act);
        else openGateNote(key, act);
        return;
      }
      var nv = e.target.closest("[data-agh-nav]");
      if (nv) { showScreen(nv.getAttribute("data-agh-nav")); return; }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && state.open) closeHub();
    });

    renderNav();
  }

  function openGateNote(key, act) {
    if (!(window.TX && TX.modal)) { decideGate(key, act); return; }
    var isEdit = act.indexOf("수정") === 0 || act === "직접 수정";
    var mo = TX.modal({
      title: isEdit ? "수정 지시 입력" : "보류 사유 입력",
      body: '<p style="font-size:12.5px;color:#667085;margin:0 0 8px">' +
        (isEdit ? "자연어로 수정을 지시하면 근거와 함께 재작성됩니다. 변경 근거는 감사 로그에 남습니다."
                : "보류 사유는 다음 심의에서 우선 재검토 큐로 들어갑니다.") + "</p>" +
        '<textarea data-note style="width:100%;min-height:80px;border:1px solid #D0D5DD;border-radius:8px;padding:9px;font:inherit;font-size:13px"></textarea>',
      actions: [
        { label: "취소" },
        { label: isEdit ? "수정 반영" : "보류 확정", kind: "primary", onClick: function (box) {
            var ta = box.querySelector("[data-note]");
            decideGate(key, act, ta ? ta.value.trim() : "");
          } }
      ]
    });
  }

  function renderNav() {
    var groups = {};
    var html = '<div class="agh-newchat"><button class="agh-btn primary wide" data-agh-nav="home">＋ 새 채팅 / 브리핑</button></div>';
    NAV_ORDER.forEach(function (k) {
      var s = SCREENS[k];
      if (k === "home") return;
      var g = s.group || "기타";
      if (!groups[g]) { groups[g] = true; html += '<div class="agh-ngroup">' + esc(g) + "</div>"; }
      html += '<button class="agh-nitem' + (state.screen === k ? " on" : "") + '" data-agh-nav="' + k + '">' +
        esc(s.nav) + (s.mode ? autonomyBadge(s.mode) : "") + "</button>";
    });
    html += '<div class="agh-ngroup">최근 항목</div>' +
      '<div class="agh-recent">평가 질문 형식 · 목표설정 초안 · 타산업 벤치마킹</div>';
    el.nav.innerHTML = html;
  }

  /* ---------------- 컨텍스트 패널 공통 ---------------- */
  function ctxPanel(items, chatNote) {
    var html = '<div class="agh-ctx-h">컨텍스트 패널 <small>판단 근거 · Human-in-the-loop</small></div>';
    items.forEach(function (it) {
      html += '<div class="agh-ctxcard ' + (it.kind || "") + '">' +
        (it.tag ? '<span class="tag">' + esc(it.tag) + "</span>" : "") +
        "<b>" + esc(it.title) + "</b><p>" + it.body + "</p>" +
        (it.actions ? '<div class="acts">' + it.actions + "</div>" : "") + "</div>";
    });
    html += '<div class="agh-ctxchat" data-agh-ctxchat>' + (chatNote || "") + "</div>";
    el.ctx.innerHTML = html;
  }
  function ctxAppend(html) {
    var c = el.ctx.querySelector("[data-agh-ctxchat]");
    if (c) { c.insertAdjacentHTML("beforeend", html); c.scrollTop = c.scrollHeight; }
  }

  /* ---------------- 화면 전환 ---------------- */
  function showScreen(key) {
    if (!SCREENS[key]) key = "home";
    clearTimers();
    state.screen = key;
    renderNav();
    var fn = RENDER[key] || RENDER.home;
    fn();
  }

  /* ============================================================
     각 화면 렌더러 + 라이브 시뮬레이션
     ============================================================ */
  function screenHead(key, exposure) {
    var s = SCREENS[key];
    return '<div class="agh-shead"><div><h2>' + esc(s.title) + "</h2>" +
      '<span class="agh-exp">' + esc(exposure) + "</span>" + (s.mode ? autonomyBadge(s.mode) : "") +
      '<span class="agh-auditchip">⛨ 감사 기록됨</span></div>' +
      '<span class="agh-asof2">as-of · ' + esc(AS_OF) + " ▾</span></div>" + protoStrip(key);
  }

  var RENDER = {};

  /* ---------- 홈 브리핑 ---------- */
  RENDER.home = function () {
    var r = role();
    var cards = NAV_ORDER.filter(function (k) { return SCREENS[k].mode; }).map(function (k) {
      var s = SCREENS[k];
      return '<button class="agh-qwcard" data-agh-nav="' + k + '">' + autonomyBadge(s.mode) +
        "<b>" + esc(s.title) + "</b><small>" + esc(s.group) + " · 클릭하면 라이브 시뮬 실행</small></button>";
    }).join("");
    el.canvas.innerHTML =
      '<div class="agh-shead"><div><h2>오늘은 어떤 도움을 드릴까요?</h2>' +
      '<span class="agh-exp">역할 주체 <b>' + esc(r.label) + "</b> 기준으로 화면과 권한이 자동 구성됩니다</span></div></div>" +
      '<div class="agh-brief"><span class="ic">⚡</span><div><b>선제 감지 3건</b> — 가중치 합 105% · 전사목표 미연결 1건 · 체크인 지연 3명. ' +
      "호출 없이 에이전트가 먼저 포착했습니다. 아래 과제 카드에서 확인하세요.</div></div>" +
      '<div class="agh-qwgrid">' + cards + "</div>";
    ctxPanel([
      { tag: "챗봇 vs 에이전트", title: "이 허브가 다른 점 (9축)", body: "촉발=선제 · 산출물=편집 가능한 객체 · 과정=노드 표출 · 근거=원천 인용 · 통제권=단계·문장 단위 승인 게이트 · 동시성=Sub-agent 병렬 실행" },
      { tag: "프로토콜", title: "모든 응답은 S1~S8 상태기계", body: "읽기·계획·산출은 자율, 발송·확정·삭제는 propose→approve→commit. 승인 전 side-effect 0." }
    ], "");
  };

  /* ---------- QW2 · 개인맥락 목표 초안 + 정렬 검증 (W2 p11 + W3 p19) ---------- */
  RENDER.qw2 = function () {
    var cu = CU();
    var objs = myObjectives().slice(0, 3);
    var pads = [{ title: "추천모델 v2 배포 · CTR +8%" }, { title: "온보딩 전환율 개선 +5%p" }, { title: "ML 온보딩 교육자료 (초안 제안)" }];
    var names = objs.concat(pads.slice(0, Math.max(0, 3 - objs.length))).slice(0, 3);
    el.canvas.innerHTML = screenHead("qw2", "노출 · ①도킹 → ③전체화면") +
      '<div class="agh-flow">' +
      ["지침수립", "자기목표", "검토회의", "피드백", "목표확정"].map(function (s, i) {
        return '<div class="agh-fstep" data-fs="' + i + '"><span class="n">' + (i + 1) + "</span>" + esc(s) + "</div>";
      }).join('<span class="agh-farrow">→</span>') + "</div>" +
      '<div class="agh-nodes" data-agh-nodes>' +
      [["지침/R&R 검증", "완료"], ["목표초안 생성", "대기"], ["상위목표 정렬", "대기"], ["난이도 벤치마크", "대기"], ["규칙/이상치 검증", "대기"], ["목표안 통합", "대기"]].map(function (n, i) {
        return '<div class="agh-node" data-nd="' + i + '"><b>' + esc(n[0]) + '</b><span class="st">' + esc(n[1]) + '</span><div class="bar"><i></i></div></div>';
      }).join("") + "</div>" +
      '<div class="agh-draft" data-agh-goals>' +
      names.map(function (o, i) {
        return '<div class="agh-goal" data-gi="' + i + '"><span class="no">' + (i + 1) + '</span><div class="tt">' + esc(o.title) +
          '<div class="chips" data-gchips></div></div><span class="wt" data-gwt>-</span><span class="al" data-gal>검증 대기</span></div>';
      }).join("") + "</div>" +
      '<div class="agh-verdict" data-agh-verdict style="display:none"></div>' +
      gateHTML("qw2");
    ctxPanel([
      { tag: "S1 감지", title: "가중치 합계 105%", kind: "warn", body: "전체 목표 가중치 합이 100%보다 <b>5%p</b> 높습니다. 목표3 가중치 15%→10% 조정안을 준비했습니다. " + srcChip("rule", "rule.weight.sum") },
      { tag: "S1 감지", title: "전사목표 미연결", kind: "warn", body: "목표 3이 전사 목표 '매출 3조 8,000억'과 연결되지 않았습니다. KR4 연결을 제안합니다. " + srcChip("talenx", "okr.tree.FY2026") }
    ], "");
    simQw2(names);
  };
  function simQw2(names) {
    var proto = el.canvas.querySelector("[data-proto]");
    var steps = el.canvas.querySelectorAll(".agh-fstep");
    var nodes = el.canvas.querySelectorAll(".agh-node");
    function node(i, st, pct) {
      var n = nodes[i]; if (!n) return;
      n.querySelector(".st").textContent = st;
      n.classList.toggle("run", st.indexOf("진행") === 0);
      n.classList.toggle("done", st === "완료" || st.indexOf("이상치") === 0);
      n.querySelector(".bar i").style.width = (pct || 0) + "%";
    }
    protoTo(proto, 0); steps[0].classList.add("done"); steps[1].classList.add("cur");
    node(0, "완료", 100);
    later(function () { protoTo(proto, 2); node(1, "진행중", 40); ctxAppend('<div class="agh-live">S3 계획 — 3종 Agent 병렬 실행 계획 수립</div>'); }, 700);
    later(function () { protoTo(proto, 3); node(1, "완료", 100); node(2, "진행중", 30); node(3, "진행중 62%", 62); ctxAppend('<div class="agh-live">S4 수행 — 직무 R&R·4Q 목표이력 ' + srcChip("talenx", "talenx") + ' · 타산업 벤치마크 ' + srcChip("web", "web") + " 병렬 조회</div>"); }, 1600);
    later(function () {
      protoTo(proto, 4); node(2, "완료", 100); node(3, "완료", 100); node(4, "이상치 2건", 100);
      var gs = el.canvas.querySelectorAll(".agh-goal");
      var wts = ["40%", "45%", "15%"], als = ["● 정렬됨", "● 정렬됨", "▲ 미연결"];
      Array.prototype.forEach.call(gs, function (g, i) {
        g.querySelector("[data-gwt]").textContent = wts[i] || "10%";
        var al = g.querySelector("[data-gal]");
        al.textContent = als[i] || "● 정렬됨";
        al.classList.add(i === 2 ? "warn" : "ok");
        g.querySelector("[data-gchips]").innerHTML = srcChip("talenx", "직무 R&R") + srcChip("erp", "4Q 목표이력") + (i === 2 ? srcChip("rule", "전사 KR4 후보") : srcChip("talenx", "전사 KR2 ↥125%"));
      });
      ctxAppend('<div class="agh-live warn">S5 정초 — 이상치 2건: 가중치 합 105% · 목표3 미연결. 근거 원천 인용 완료</div>');
    }, 2700);
    later(function () {
      protoTo(proto, 6); node(5, "완료", 100);
      var v = el.canvas.querySelector("[data-agh-verdict]");
      v.style.display = "";
      v.innerHTML = '<span class="conf">confidence 0.86</span> 모델링 R&R과 4Q 초과달성 이력(KR2 125%)을 반영해 <b>초안 3안</b>을 구성했습니다. ' +
        "가중치 합 90%·목표3 미연결이 확인돼 <b>15%→25% 상향 또는 KR4 연결</b> 중 택일을 제안합니다. " +
        srcChip("rule", "원칙 · 전사 정렬") + srcChip("talenx", "맥락 · H1 조직개편") + '<span class="agh-auditchip">⛨ 감사 기록됨</span>';
      ctxAppend('<div class="agh-live ok">S7 게이팅 대기 — 아래 결정 게이트에서 승인/수정/보류를 선택하세요. 승인 전 talenx 반영 없음.</div>');
    }, 3800);
  }

  /* ---------- QW7 · 목표 정합성·중복 점검 (W3 p24) ---------- */
  RENDER.qw7 = function () {
    var tm = team().slice(0, 5);
    var fallback = ["김서연", "박도윤", "이준호", "최민아", "정하람"];
    var rows = [
      { n: 0, goal: "온보딩 전환율 개선", kr: "KR2 · 활성화율 +8%p", res: "▲ 중복 A — 2번 목표와 90% 유사", cls: "dup" },
      { n: 1, goal: "신규 유저 온보딩 개선", kr: "KR2 · 활성화율 +8%p", res: "▲ 중복 A — 병합 대상", cls: "dup" },
      { n: 2, goal: "리텐션 대시보드 구축", kr: "KR3 · 4주 잔존 62%", res: "✓ 정합", cls: "ok" },
      { n: 3, goal: "실험 파이프라인 자동화", kr: "연결 없음", res: "▲ 미연계 — 어느 팀 KR에도 안 걸림", cls: "miss" },
      { n: 4, goal: "A/B 테스트 속도 2배", kr: "KR1 · 실험 velocity", res: "▲ 중복 B — 76% 유사 (관점 상이)", cls: "dupb" }
    ];
    el.canvas.innerHTML = screenHead("qw7", "노출 · ③전체화면 딥워크") +
      '<div class="agh-scanline" data-agh-scan>팀 목표 8건 스캔 중 <i class="agh-spin"></i></div>' +
      '<table class="agh-table" data-agh-tbl style="opacity:.35"><thead><tr><th>담당자 · 개인목표</th><th>상위 KR 연계</th><th>점검 결과</th></tr></thead><tbody>' +
      rows.map(function (r, i) {
        var nm = (tm[i] && tm[i].name) || fallback[i];
        return '<tr class="' + r.cls + '" data-ri="' + i + '"><td><b>' + esc(nm) + "</b> · " + esc(r.goal) + "</td><td>" + esc(r.kr) + '</td><td class="res" data-res>스캔 대기…</td></tr>';
      }).join("") + "</tbody></table>" +
      '<div class="agh-verdict" data-agh-verdict style="display:none"></div>' +
      gateHTML("qw7", ["병합·연결 승인", "수정", "보류"]);
    ctxPanel([
      { tag: "확인 내역", title: "talenx OKR 트리 대조", body: "김서연·박도윤 목표 문구·지표(KR2) <b>90% 일치</b> — 사실상 같은 일 " + srcChip("talenx", "okr.diff") },
      { tag: "제안", title: "병합 + KR1 연결", body: "중복 A 두 건은 1건으로 병합(담당: 공동), 최민아 목표는 KR1(실험 velocity)에 연결 제안. 중복 B는 관점이 갈려 <b>사람 판단으로 보류</b> 권고." }
    ], "");
    var proto = el.canvas.querySelector("[data-proto]");
    protoTo(proto, 0);
    later(function () { protoTo(proto, 3); }, 500);
    later(function () {
      protoTo(proto, 5);
      var tbl = el.canvas.querySelector("[data-agh-tbl]"); tbl.style.opacity = "1";
      el.canvas.querySelector("[data-agh-scan]").innerHTML = "팀 목표 8건 스캔 완료 · <b>0.9s</b> · " + srcChip("talenx", "talenx OKR 트리 대조") + ' <span class="agh-flag">▲ 중복 의심 2쌍</span><span class="agh-flag">▲ 상위목표 미연계 1건</span>';
      Array.prototype.forEach.call(tbl.querySelectorAll("[data-res]"), function (c, i) {
        later(function () { c.textContent = rows[i].res; }, 150 * i);
      });
    }, 1300);
    later(function () {
      protoTo(proto, 6);
      var v = el.canvas.querySelector("[data-agh-verdict]");
      v.style.display = "";
      v.innerHTML = "중복 A 두 건은 <b>1건 병합</b>(담당: 공동), 최민아 목표는 <b>KR1(실험 velocity) 연결</b>을 제안합니다. 중복 B는 관점이 갈려 검토가 필요해 <b>보류로 남깁니다</b>. 병합·연결은 승인 게이트로만 실행됩니다." + '<span class="agh-auditchip">⛨ 감사 기록됨</span>';
    }, 2600);
  };

  /* ---------- QW1 · 주간 체크인 팝업 (W3 p22) ---------- */
  RENDER.qw1 = function () {
    el.canvas.innerHTML = screenHead("qw1", "노출 · ②선제 팝업 → ①도킹") +
      '<div class="agh-scan3" data-agh-s3>' +
      [["talenx", "KR 업데이트 로그 스캔", "7일 무변동 3명"], ["ERP", "달성률 대비 잔여기간 대조", "진척 지연 1명"], ["1:1", "최근 체크인 이력 확인", "14일+ 미실시 2명"]].map(function (r, i) {
        return '<div class="agh-scanrow" data-sr="' + i + '"><span class="agh-src agh-s-' + (i === 0 ? "talenx" : i === 1 ? "erp" : "rule") + '">' + r[0] + '</span><span class="txt">' + esc(r[1]) + '</span><b class="out" data-out></b></div>';
      }).join("") + "</div>" +
      '<div class="agh-sumgrid" data-agh-sum style="opacity:.3">' +
      '<div class="agh-sumcard warn"><b>3</b><span>체크인 대상</span></div>' +
      '<div class="agh-sumcard bad"><b>1</b><span>부진 (지연)</span></div>' +
      '<div class="agh-sumcard ok"><b>8</b><span>정상 진행</span></div></div>' +
      '<div class="agh-rows" data-agh-rows style="display:none">' +
      '<div class="agh-prow bad">부진 · 정민서 — KR2 달성 41% (잔여 3주)</div>' +
      '<div class="agh-prow warn">대상 · 김도현 — 업데이트 9일 무변동</div>' +
      '<div class="agh-prow warn">대상 · 한유진 — 1:1 16일 미실시</div></div>' +
      '<div class="agh-draftmsg" data-agh-msg style="display:none"><div class="lab">● 선제 초안 — 리더가 정민서 님에게 보낼 메시지</div>' +
      "<p>민서 님, 이번 주 <b>KR2(신규 온보딩 자동화)</b> 진척이 지연 구간에 들어왔어요. 잔여 3주 기준 계획 대비 약 <b>-24%p</b>입니다. " +
      "막힌 지점이 있는지 <b>10분 1:1</b>로 같이 정리해볼까요? 화·수 오후 중 편한 시간 알려주세요.</p>" +
      '<small>talenx 진척·1:1 이력과 ERP 달성률 근거 · 톤은 질책이 아닌 지원 프레임 · <b>발송 전 리더 승인 필요</b></small></div>' +
      gateHTML("qw1", ["승인·발송", "수정", "보류"]);
    ctxPanel([
      { tag: "auto 배지", title: "집계는 바로, 발송은 게이트", body: "데이터 스캔·요약(auto)은 에이전트가 상시 실행하지만, 사람에게 닿는 메시지는 <b>human_approve</b> — 승인 없이는 발송되지 않습니다." },
      { tag: "S1 감지", title: "이번 주 트리거", body: "월요일 06:00 정기 스캔에서 지연 신호 포착 → 리더에게 선제 팝업으로 먼저 말 걸었습니다. " + srcChip("rule", "cron.weekly.checkin") }
    ], "");
    var proto = el.canvas.querySelector("[data-proto]");
    protoTo(proto, 0);
    var outs = ["7일 무변동 3명", "진척 지연 1명", "14일+ 미실시 2명"];
    Array.prototype.forEach.call(el.canvas.querySelectorAll("[data-sr]"), function (r, i) {
      later(function () {
        r.classList.add("done");
        r.querySelector("[data-out]").textContent = "→ " + outs[i];
        protoTo(proto, Math.min(3, i + 1));
      }, 500 + i * 550);
    });
    later(function () { protoTo(proto, 5); el.canvas.querySelector("[data-agh-sum]").style.opacity = "1"; el.canvas.querySelector("[data-agh-rows]").style.display = ""; }, 2300);
    later(function () { protoTo(proto, 6); el.canvas.querySelector("[data-agh-msg]").style.display = ""; ctxAppend('<div class="agh-live ok">S6 객체화 — 발송 초안을 편집 가능한 객체로 생성. S7 승인 대기.</div>'); }, 3100);
  };

  /* ---------- QW4 · 상시 근거 수집 (W3 p23) ---------- */
  RENDER.qw4 = function () {
    var items = [
      ["2025 · 11", "달성", "KR2 신규계약 유지율 112% 달성 (목표 105%)", "erp", "ERP · 실적 리포트"],
      ["2025 · 09", "프로젝트", "'온보딩 개편' 리드 완료, 활성화율 +9%p", "talenx", "Jira · 완료 이슈"],
      ["2025 · 07", "1:1", "'발표 자신감 부족' 개선 합의 → 4회 이행 확인", "talenx", "1:1 노트 · talenx"],
      ["2025 · 04", "피드백", "동료 3인 '협업 리드십 탁월' 수시 피드백 수신", "rule", "동료피드백 · 3건"]
    ];
    el.canvas.innerHTML = screenHead("qw4", "노출 · ③전체화면 · 상시 수집") +
      '<div class="agh-brief"><span class="ic">🗂</span><div><b>기억을 소환하지 않습니다. 1년치 근거가 이미 모여 있습니다.</b> 달성·프로젝트·피드백·1:1 기록이 발생 시점에 자동 적재됩니다(suggest · 자동 축적).</div></div>' +
      '<div class="agh-tl" data-agh-tl>' +
      items.map(function (it, i) {
        return '<div class="agh-tli" data-ti="' + i + '" style="opacity:0"><span class="dt">' + esc(it[0]) + '</span><span class="agh-tag">' + esc(it[1]) + "</span><div class=\"bd\">" + esc(it[2]) + "</div>" + srcChip(it[3], it[4]) + "</div>";
      }).join("") + '<div class="agh-tlmore">↑ 이전 8개월 · 총 24건 적재됨</div></div>' +
      '<div class="agh-sidecard"><div class="lab">수집 요약</div><b class="big">24건</b>' +
      '<div class="mini">목표·달성 8 · 프로젝트 6 · 수시 피드백 7 · 1:1 기록 3</div>' +
      '<button class="agh-btn primary wide" data-agh-nav="qw3">이 근거로 등급 초안 만들기 →</button>' +
      "<small>초안 등급 제안 · 최종 결정은 평가자 게이트로</small></div>";
    ctxPanel([
      { tag: "자산화", title: "S8 — 과정이 자산이 된다", body: "카드마다 원천(citation)이 붙어 '등급 초안 만들기'까지 역추적됩니다. 평가 시즌이 열리면 이 24건이 등급 초안의 재료가 됩니다." }
    ], "");
    var proto = el.canvas.querySelector("[data-proto]");
    protoTo(proto, 7);
    Array.prototype.forEach.call(el.canvas.querySelectorAll("[data-ti]"), function (n, i) {
      later(function () { n.style.transition = "opacity .4s"; n.style.opacity = "1"; }, 300 + i * 350);
    });
  };

  /* ---------- QW6 · 피드백 문장 정제 (W3 p25) ---------- */
  RENDER.qw6 = function () {
    el.canvas.innerHTML = screenHead("qw6", "노출 · ①도킹 · 작성 컴포저") +
      '<div class="agh-tones">' +
      ["톤", "담백", "따뜻", "직설"].map(function (t, i) {
        return i === 0 ? '<span class="lab">' + t + "</span>" : '<button class="agh-tone' + (i === 2 ? " on" : "") + '" data-tone="' + esc(t) + '">' + esc(t) + "</button>";
      }).join("") + '<span class="sbi">SBI · 상황 → 행동 → 영향</span></div>' +
      '<div class="agh-diff">' +
      '<div class="agh-dcol src"><div class="lab">원문 · 매니저 초안</div>' +
      '<p><del>문서 정리가 계속 늦어요. 여러 번 얘기했는데</del> 개선이 안 보이네요. 좀 더 신경 써 주세요.</p>' +
      '<div class="flags"><span class="agh-flag">개선점만 나열</span><span class="agh-flag">성과 인정 없음</span><span class="agh-flag">막연한 요구</span></div></div>' +
      '<div class="agh-dcol out"><div class="lab">정제안 · 성과 인정 먼저 → 실행 제안형</div>' +
      '<p data-agh-refined><i class="agh-spin"></i> 정제 중…</p>' +
      '<div class="flags" data-agh-refchips style="display:none"></div></div></div>' +
      '<div class="agh-safety" data-agh-safety style="display:none"><b>저성과 민감 케이스 안전장치</b> — 최근 2분기 등급 하락(B→C) 대상자입니다. 단정·비교 표현을 자동으로 걸러 사실·행동 중심으로만 정제했고, <b>전송 전 HR 1:1 가이드 확인</b>을 권합니다.</div>' +
      gateHTML("qw6", ["반영", "직접 수정", "무시(원문 유지)"]);
    ctxPanel([
      { tag: "무엇을 왜 바꿨나", title: "구조·사실·톤", body: "<b>구조</b> 개선점 나열 → 인정→SBI→제안 순서 재배열<br><b>사실</b> '계속·여러 번' 대신 보드에서 확인된 <b>지연 3건</b>으로 특정<br><b>톤</b> 지시형 명령을 <b>제안형 질문</b>으로(따뜻 유지). 감정·의도는 그대로 — 문장의 주인은 매니저입니다." }
    ], "");
    var proto = el.canvas.querySelector("[data-proto]");
    protoTo(proto, 2);
    later(function () {
      protoTo(proto, 5);
      el.canvas.querySelector("[data-agh-refined]").innerHTML =
        "지난 스프린트 릴리스 노트는 팀에서 가장 참고가 많이 됐어요<b>(인정)</b>. 다만 공유 문서 3건이 마감 하루 뒤 올라와<b>(상황·행동)</b> 후속 리뷰가 밀렸습니다<b>(영향)</b>. 다음엔 마감 반나절 전 초안 공유부터 같이 잡아볼까요?";
      var rc = el.canvas.querySelector("[data-agh-refchips]");
      rc.style.display = ""; rc.innerHTML = '<span class="agh-flag ok">S·B·I 구조 채움</span>' + srcChip("talenx", "근거 · 스프린트 보드 3건");
      el.canvas.querySelector("[data-agh-safety]").style.display = "";
    }, 1400);
    el.canvas.addEventListener("click", function (e) {
      var t = e.target.closest("[data-tone]");
      if (!t) return;
      Array.prototype.forEach.call(el.canvas.querySelectorAll("[data-tone]"), function (b) { b.classList.toggle("on", b === t); });
      toast("톤 '" + t.getAttribute("data-tone") + "' 기준으로 재정제했습니다. 전달 방식만 바뀌고 의도는 유지됩니다.");
    });
  };

  /* ---------- QW3 · 평가 코멘트 근거초안 (W3 p20, 도킹 에이전트 패널) ---------- */
  RENDER.qw3 = function () {
    el.canvas.innerHTML = screenHead("qw3", "노출 · ①도킹 · 에이전트 패널") +
      '<div class="agh-workpanel"><div class="lab">⏳ 작업 중 <span class="who">김도현 · 실행력</span></div>' +
      '<div class="agh-worklines" data-agh-wl>' +
      [["ERP 실적을 확인하는 중…", "목표3 달성률 125% 확인"], ["동일 직무군 분포 대조 중 —", "상위 32%"], ["평가규정 §4.2 등급 기준을 대조하는 중…", ""]].map(function (l, i) {
        return '<div class="wl" data-wl="' + i + '"><span class="ck">○</span><span>' + esc(l[0]) + ' <b data-wlb></b></span></div>';
      }).join("") + "</div>" +
      '<div class="agh-workbar"><span>병렬 · 규정 확인</span><div class="bar"><i data-agh-wbar></i></div><b data-agh-wpct>0%</b></div></div>' +
      '<div class="agh-done" data-agh-done style="display:none"><div class="lab">✅ 완료</div>' +
      "<p>ERP 실적에서 <b>달성률 125%</b>를 확인했고, 직무군 <b>상위 32%</b>에 들었습니다. 규정상 초과달성 구간에 해당해 실행력 등급을 아래와 같이 제안합니다.</p>" +
      '<div class="agh-gradecard"><span class="g">B+</span><div><b>실행력 · B+ 제안</b><small>달성률 125% · 직무군 상위 32% · 규정상 초과달성</small></div></div>' +
      '<p class="agh-sent">서술 초안 — "<span data-s="1">상반기 목표3(온보딩 자동화)을 125% 달성해 계획 대비 초과 성과를 확인함</span>' + srcChip("erp", "ERP") +
      ' <span data-s="2">동일 직무군 대비 상위 32% 수준의 실행 일관성을 유지함</span>' + srcChip("talenx", "talenx 360°") +
      ' <span data-s="3">평가규정 §4.2 초과달성 구간 기준을 충족함</span>' + srcChip("rule", "규정 v3.1 §4.2") + '" — 문장별 출처 부착</p></div>' +
      gateHTML("qw3");
    ctxPanel([
      { tag: "human_approve", title: "백지 부담 제거, 결정은 사람", body: "근거+등급 포착 → 서술 초안·문장별 출처 → 편집·승인. '작업 중' 패널이 어디까지 갔는지(62%) 상주시키고, 완료 카드에 근거를 남겨 승인·수정·보류 게이트로 확정합니다." }
    ], "");
    var proto = el.canvas.querySelector("[data-proto]");
    protoTo(proto, 1);
    var wl = el.canvas.querySelectorAll("[data-wl]");
    var outs = ["목표3 달성률 125% 확인", "상위 32%", "규정 §4.2 대조 완료"];
    var pct = 0;
    var iv = setInterval(function () {
      pct = Math.min(100, pct + 7);
      var bar = el.canvas.querySelector("[data-agh-wbar]"), pt = el.canvas.querySelector("[data-agh-wpct]");
      if (bar) { bar.style.width = pct + "%"; pt.textContent = pct + "%"; }
      if (pct >= 100) clearInterval(iv);
    }, 180);
    state.timers.push(iv);
    Array.prototype.forEach.call(wl, function (w, i) {
      later(function () {
        w.querySelector(".ck").textContent = "✓"; w.classList.add("done");
        w.querySelector("[data-wlb]").textContent = outs[i];
        protoTo(proto, 3 + i);
      }, 700 + i * 800);
    });
    later(function () { protoTo(proto, 6); el.canvas.querySelector("[data-agh-done]").style.display = ""; ctxAppend('<div class="agh-live ok">S6 객체화 — 문장 단위 출처가 붙은 편집 가능 초안 생성. 승인·수정·보류로 확정.</div>'); }, 3400);
  };

  /* ---------- HOLD · 근거 부족 시 정지+질문 (W3 p9 — 확신 없으면 진행하지 않는다) ---------- */
  RENDER.hold = function () {
    el.canvas.innerHTML = screenHead("hold", "노출 · ①도킹 · 정지 상태") +
      '<div class="agh-workpanel"><div class="lab">⏳ 작업 중 <span class="who">박지훈 · 등급 초안</span></div>' +
      '<div class="agh-worklines" data-agh-wl>' +
      [["KR1 체크인 기록 확인 중…", ""], ["KR2 실적 근거 탐색 중…", ""], ["KR3 실적 근거 탐색 중…", ""]].map(function (l, i) {
        return '<div class="wl" data-wl="' + i + '"><span class="ck">○</span><span>' + esc(l[0]) + ' <b data-wlb></b></span></div>';
      }).join("") + "</div></div>" +
      '<div class="agh-holdcard" data-agh-hold style="display:none">' +
      '<div class="hd">⛔ 근거가 부족해 판단을 멈췄습니다 <span class="tag">HOLD</span></div>' +
      "<p>KR 3개 중 <b>1개만 기록</b>이 있습니다. KR2·KR3은 체크인·실적 근거가 없어 <b>판단 불가</b> — 임의로 추정하지 않습니다.</p>" +
      '<p class="q">나머지 2개 KR 실적을 어디서 볼까요?</p>' +
      '<div class="opts">' +
      '<button class="agh-btn" data-hold-opt="talenx">talenx 체크인 기록 연결</button>' +
      '<button class="agh-btn" data-hold-opt="erp">ERP 실적 재조회</button>' +
      '<button class="agh-btn" data-hold-opt="manual">직접 입력</button></div></div>' +
      '<div class="agh-done" data-agh-done style="display:none"><div class="lab">✅ 재개 · 완료</div>' +
      "<p data-agh-holdsum></p>" +
      '<div class="agh-gradecard"><span class="g">B0</span><div><b>등급 초안 · B0 제안</b><small>KR1 112% · KR2 96% · KR3 88% (보강된 근거 기준)</small></div></div></div>' +
      gateHTML("hold");
    ctxPanel([
      { tag: "HOLD 원칙", title: "확신이 없으면 진행하지 않는다", kind: "warn", body: "근거 부족 시 스피너 대신 <b>정지 + 질문</b>. 추정으로 채워 넣은 판단은 감사도 재현도 불가능하므로, 부족분은 사용자에게 되묻습니다. 정지·재개도 감사 로그에 남습니다. " + srcChip("rule", "invariant.no-guess") }
    ], "");
    var proto = el.canvas.querySelector("[data-proto]");
    protoTo(proto, 1);
    var wl = el.canvas.querySelectorAll("[data-wl]");
    later(function () {
      wl[0].querySelector(".ck").textContent = "✓"; wl[0].classList.add("done");
      wl[0].querySelector("[data-wlb]").textContent = "체크인 2건 · 달성률 112%";
      protoTo(proto, 3);
    }, 700);
    [1, 2].forEach(function (i) {
      later(function () {
        wl[i].querySelector(".ck").textContent = "✗"; wl[i].classList.add("hold");
        wl[i].querySelector("[data-wlb]").textContent = "기록 없음 · 판단 불가";
      }, 1400 + (i - 1) * 600);
    });
    later(function () {
      el.canvas.querySelector("[data-agh-hold]").style.display = "";
      logAudit("HOLD 정지", "박지훈 등급 초안 — KR2·KR3 근거 부족", "hold.no-evidence");
      ctxAppend('<div class="agh-live warn">S4 수행 중 정지 — 근거 2건 부족. 사용자 응답 대기.</div>');
    }, 2700);
    el.canvas.addEventListener("click", function (e) {
      var b = e.target.closest("[data-hold-opt]");
      if (!b) return;
      var opt = b.getAttribute("data-hold-opt");
      var label = opt === "talenx" ? "talenx 체크인 기록 연결" : opt === "erp" ? "ERP 실적 재조회" : "직접 입력";
      el.canvas.querySelector("[data-agh-hold]").style.display = "none";
      logAudit("HOLD 재개", "근거 보강 경로 · " + label, "hold.resume");
      [1, 2].forEach(function (i, j) {
        later(function () {
          wl[i].classList.remove("hold"); wl[i].classList.add("done");
          wl[i].querySelector(".ck").textContent = "✓";
          wl[i].querySelector("[data-wlb]").textContent = (i === 1 ? "달성률 96%" : "달성률 88%") + " · " + label;
          protoTo(proto, 4 + j);
        }, 500 + j * 700);
      });
      later(function () {
        protoTo(proto, 6);
        el.canvas.querySelector("[data-agh-holdsum]").innerHTML =
          "<b>" + esc(label) + "</b> 경로로 KR2·KR3 근거를 보강해 판단을 재개했습니다. 정지→질문→재개 전 과정이 감사 로그에 남았습니다. " +
          srcChip("talenx", "체크인") + srcChip("erp", "ERP 실적");
        el.canvas.querySelector("[data-agh-done]").style.display = "";
        ctxAppend('<div class="agh-live ok">S6 객체화 — 보강 근거 기준 등급 초안 생성. 게이트에서 확정하세요.</div>');
      }, 2100);
    });
  };

  /* ---------- QW5 · 평가 편향 점검 (W3 p18 #5) ---------- */
  RENDER.qw5 = function () {
    el.canvas.innerHTML = screenHead("qw5", "노출 · ③전체화면 (횡단)") +
      '<div class="agh-scanline" data-agh-scan>본부 4곳 등급 분포·근거량 스캔 중 <i class="agh-spin"></i></div>' +
      '<div class="agh-biasgrid" data-agh-bias style="opacity:.3">' +
      [["개발본부", "관대화 의심", "A비율 41% (전사 28%) · 근거량 평균 이하", "warn"],
       ["컨설팅본부", "정상", "분포·근거량 균형", "ok"],
       ["마케팅본부", "중심화 의심", "B 집중 71% · 변별 근거 부족", "warn"],
       ["UX본부", "정상", "분포·근거량 균형", "ok"]].map(function (b) {
        return '<div class="agh-bias ' + b[3] + '"><b>' + esc(b[0]) + '</b><span class="tag">' + esc(b[1]) + "</span><p>" + esc(b[2]) + "</p></div>";
      }).join("") + "</div>" +
      '<div class="agh-verdict" data-agh-verdict style="display:none">개발본부는 실적 대비 등급 상승폭 설명력이 낮은 인원이 <b>3명</b>, 마케팅본부는 등급 변별 근거가 부족합니다. ' +
      "편향 <b>플래그+근거</b>만 제시하며, 등급 수정은 하지 않습니다 — 검토 승인 시 캘리브레이션 회의 안건으로 전달됩니다." +
      '<span class="agh-auditchip">⛨ 감사 기록됨</span></div>' +
      '<div class="agh-linkrow"><button class="agh-btn" data-agh-nav="calib">→ Calibration 라운드테이블에서 심의</button></div>' +
      gateHTML("qw5", ["검토 승인", "수정", "보류"]);
    ctxPanel([
      { tag: "정치 배제", title: "민감 이슈 처리 원칙", body: "관대화·편향은 <b>재검토 제안</b>만 하며 자동 수정하지 않습니다. 플래그의 모든 판단에는 분포·근거량 원천이 인용됩니다. " + srcChip("rule", "관대화·강제배분 감사") + srcChip("erp", "실적 대조") }
    ], "");
    var proto = el.canvas.querySelector("[data-proto]");
    protoTo(proto, 0);
    later(function () { protoTo(proto, 3); }, 600);
    later(function () {
      protoTo(proto, 5);
      el.canvas.querySelector("[data-agh-bias]").style.opacity = "1";
      el.canvas.querySelector("[data-agh-scan]").innerHTML = "본부 4곳 스캔 완료 · " + srcChip("talenx", "등급 분포") + srcChip("erp", "실적 대비 상승폭") + ' <span class="agh-flag">▲ 편향 플래그 2본부</span>';
    }, 1500);
    later(function () { protoTo(proto, 6); el.canvas.querySelector("[data-agh-verdict]").style.display = ""; }, 2400);
  };

  /* ---------- Calibration 라운드테이블 (W2 p13) + What-if 슬라이더 ---------- */
  RENDER.calib = function () {
    el.canvas.innerHTML = screenHead("calib", "노출 · ③전체화면 · 다자 심의") +
      '<div class="agh-callayout"><div class="agh-round">' +
      '<div class="lab">Roundtable 에이전트 4종 <span class="live" data-agh-live>● LIVE 실시간 심의</span></div>' +
      '<div class="agh-rgraph"><div class="agh-orch" data-agh-orch>조정<br>오케스트레이터<small data-agh-orchst>조율 중</small></div>' +
      [["증거검증", "자기평가·실적 대조", "tl"], ["정치배제", "관대화·강제배분 감사", "tr"], ["편향필터", "난이도 편차 보정", "bl"], ["전략기여", "전사목표 연계 검증", "br"]].map(function (a, i) {
        return '<div class="agh-ragent ' + a[2] + '" data-ra="' + i + '"><b>' + esc(a[0]) + "</b><small>" + esc(a[1]) + "</small><span class=\"rel\" data-rel></span></div>";
      }).join("") + "</div>" +
      '<div class="agh-rlog" data-agh-rlog></div></div>' +
      '<div class="agh-calside"><div class="lab">등급 분포 · 조정 전 → 후</div><div data-agh-dist></div>' +
      '<div class="agh-whatif"><div class="lab">What-if · 강제배분 상한 <b data-agh-cap>30%</b></div>' +
      '<input type="range" min="20" max="40" step="5" value="30" data-agh-capslider>' +
      "<small>동일 룰 엔진에서 상한만 바꿔 즉시 재산출 · rule-exec.cal7</small></div>" +
      '<div class="agh-sumbox" data-agh-calsum style="display:none"><b>심의 결과 요약</b><ul><li>강제배분 상한 준수 → A 25%</li><li>이상치 3건 → 0건으로 해소</li></ul></div></div></div>' +
      gateHTML("calib", ["조정안 승인", "수정", "보류"]);
    ctxPanel([
      { tag: "발의/보강/합의/충돌", title: "다자 심의 구조", body: "4개 관점 에이전트가 조정 논거를 교차 심의하고 오케스트레이터가 합의로 수렴합니다. 충돌 논거도 기록에 남아 <b>사람이 단일 요약이 아닌 심의 과정</b>을 봅니다." },
      { tag: "인간 최종 승인", title: "조정안 확정은 사람", kind: "warn", body: "심의 결과는 제안일 뿐 — 조정안 확정 지점은 아래 게이트입니다." }
    ], "");
    renderDist(30, false);
    var slider = el.canvas.querySelector("[data-agh-capslider]");
    slider.addEventListener("input", function () {
      var cap = +slider.value;
      el.canvas.querySelector("[data-agh-cap]").textContent = cap + "%";
      renderDist(cap, true);
      logAudit("What-if 재계산", "강제배분 상한 " + cap + "%", "rule-exec.cal7");
    });
    var proto = el.canvas.querySelector("[data-proto]");
    protoTo(proto, 3);
    var seq = [
      [0, "발의", "S 2명 하향 조정 발의 — 실적 대조 결과 설명력 부족"],
      [1, "충돌/반박", "정치배제: 일괄 하향 반대 (개발팀 난이도 타팀 대비 -0.4단계 고려)"],
      [2, "보강", "편향필터: 난이도 보정계수 반영 시 1명만 하향 타당"],
      [3, "합의", "전략기여: 전사 KR 직결 1명 유지 동의 — 합의 수렴"]
    ];
    seq.forEach(function (s, i) {
      later(function () {
        var ra = el.canvas.querySelector('[data-ra="' + s[0] + '"]');
        if (ra) { ra.classList.add("act"); ra.querySelector("[data-rel]").textContent = s[1]; }
        var lg = el.canvas.querySelector("[data-agh-rlog]");
        if (lg) lg.insertAdjacentHTML("beforeend", '<div class="rl"><b>' + esc(s[1]) + "</b> " + esc(s[2]) + "</div>");
        protoTo(proto, Math.min(5, 3 + i));
      }, 800 + i * 900);
    });
    later(function () {
      protoTo(proto, 6);
      var o = el.canvas.querySelector("[data-agh-orchst]"); if (o) o.textContent = "합의 수렴";
      var lv = el.canvas.querySelector("[data-agh-live]"); if (lv) { lv.textContent = "● 심의 수렴"; lv.classList.add("done"); }
      el.canvas.querySelector("[data-agh-calsum]").style.display = "";
      renderDist(+slider.value, true);
    }, 4500);
  };
  function renderDist(cap, after) {
    var host = el.canvas.querySelector("[data-agh-dist]");
    if (!host) return;
    var base = { S: 8, A: 32, B: 44, C: 12, D: 4 };
    var adj = { S: Math.min(base.S, Math.round(cap * 0.2)), A: Math.min(base.A, cap - Math.min(base.S, Math.round(cap * 0.2))) };
    adj.B = base.B + (base.S - adj.S) + (base.A - adj.A) - 2; adj.C = base.C + 2; adj.D = base.D;
    host.innerHTML = Object.keys(base).map(function (g) {
      var b = base[g], a2 = after ? adj[g] : b, d = a2 - b;
      return '<div class="agh-drow"><b>' + g + '</b><div class="tr"><i style="width:' + b * 2 + 'px"></i></div><span>' + b + "%</span><em>→</em>" +
        '<div class="tr af"><i style="width:' + a2 * 2 + 'px"></i></div><span>' + a2 + "%</span>" +
        '<small class="' + (d < 0 ? "neg" : d > 0 ? "pos" : "") + '">' + (d > 0 ? "+" : "") + d + "%p</small></div>";
    }).join("");
  }

  /* ---------- 리뷰 초안 co-writing (W2 p14) ---------- */
  RENDER.review = function () {
    el.canvas.innerHTML = screenHead("review", "노출 · ①도킹 + 편집 캔버스") +
      '<div class="agh-revlayout"><div class="agh-revside"><div class="lab">리뷰 대상 <b>5 / 12</b></div>' +
      [["김지훈 책임", "작성 중", "cur"], ["이수민 선임", "작성 완료", "done"], ["박도현 책임", "대기", ""]].map(function (r) {
        return '<div class="agh-revtgt ' + r[2] + '"><b>' + esc(r[0]) + "</b><span>" + esc(r[1]) + "</span></div>";
      }).join("") +
      '<div class="lab" style="margin-top:12px">섹션</div><div class="agh-revsec">핵심 성과 ✓<br>개선 영역 ●<br>역량 평가 ·<br>차년도 방향 ·<br>종합 총평 ·</div></div>' +
      '<div class="agh-revmain"><div class="lab">핵심 성과 <span class="agh-flag ok">AI 작성보조 ON</span></div>' +
      '<div class="agh-revdoc" data-agh-doc><p>상반기 talenx 직무모듈 통합설계를 담당하며 팀 내 핵심 전력으로 기여함.</p></div>' +
      '<div class="agh-revprop" data-agh-prop style="display:none"><div class="lab">AI 제안 및 근거 — 삽입 문장 하이라이트</div>' +
      '<p class="hl">분기 중 3개 유관부서(마케팅본부, 컨설팅본부, UX 디자인팀)와의 연동 과제를 무중단으로 완료해 대규모 업그레이드 배포 안정성을 높인 점이 확인됨</p>' +
      srcChip("talenx", "talenx 업무보드") + srcChip("rule", "Slack 협의 로그") + srcChip("erp", "ERP 배포 이력") +
      '<div class="acts"><button class="agh-btn primary" data-rev-apply>반영</button><button class="agh-btn" data-rev-skip>무시</button></div>' +
      '<small>변경 요약 · +2문장, 지표 신규 인용 — 변경 근거 기록</small></div>' +
      '<div class="agh-revcmd"><input type="text" value="핵심 성과를 정량 근거와 함께 보강해줘. talenx, Slack 데이터 참고" data-agh-revin>' +
      '<button class="agh-btn primary" data-agh-revgo>지시</button></div></div></div>' +
      gateHTML("review", ["섹션 승인", "수정", "보류"]);
    ctxPanel([
      { tag: "문장 단위 통제권", title: "단계·문장 단위 승인", body: "AI가 ERP 실적·자기평가서를 근거로 초안을 실시간 생성하고 삽입 문장을 하이라이트로 표시 — 사용자는 문장 단위로 반영/무시합니다." },
      { tag: "민감 이슈", title: "인라인 Assist", body: "저성과·민감 문구는 Agent가 병렬로 감지해 인라인에서 대안을 제시하고 변경 근거를 기록합니다." }
    ], "");
    var proto = el.canvas.querySelector("[data-proto]");
    protoTo(proto, 2);
    later(function () { protoTo(proto, 5); el.canvas.querySelector("[data-agh-prop]").style.display = ""; ctxAppend('<div class="agh-live">talenx, Slack, ERP 데이터를 인용해 \'핵심 성과\' 문단에 2문장을 제안했습니다.</div>'); }, 1300);
    el.canvas.addEventListener("click", function (e) {
      if (e.target.closest("[data-rev-apply]")) {
        var doc = el.canvas.querySelector("[data-agh-doc]");
        doc.insertAdjacentHTML("beforeend", '<p class="ins">분기 중 3개 유관부서(마케팅본부, 컨설팅본부, UX 디자인팀)와의 연동 과제를 무중단으로 완료해 대규모 업그레이드 배포 안정성을 높임.</p>');
        el.canvas.querySelector("[data-agh-prop]").style.display = "none";
        logAudit("문장 반영", "리뷰 · 핵심 성과 +2문장", "rev.ins.2");
        toast("문서에 반영 — 변경 근거가 기록되었습니다.", "ok");
        protoTo(el.canvas.querySelector("[data-proto]"), 6);
      }
      if (e.target.closest("[data-rev-skip]")) {
        el.canvas.querySelector("[data-agh-prop]").style.display = "none";
        logAudit("제안 무시", "리뷰 · 핵심 성과 제안", "rev.skip");
        toast("제안을 무시했습니다. 원문이 유지됩니다.");
      }
      if (e.target.closest("[data-agh-revgo]")) {
        var p = el.canvas.querySelector("[data-agh-prop]");
        p.style.display = "";
        ctxAppend('<div class="agh-live">자연어 지시 수신 — 문서를 재작성하고 근거를 다시 인용했습니다.</div>');
      }
    });
  };

  /* ---------- 산출물 (자산화 · S8) ---------- */
  RENDER.assets = function () {
    var rows = state.assets.length ? state.assets.map(function (a) {
      return '<div class="agh-tli"><span class="dt">' + esc(a.at) + '</span><span class="agh-tag">' + esc(a.kind) + '</span><div class="bd">' + esc(a.title) + '</div><button class="agh-btn sm" data-agh-nav="' + esc(a.screen) + '">다시 열기</button></div>';
    }).join("") : '<div class="agh-emptybox">아직 자산화된 산출물이 없습니다. 과제 화면에서 결정 게이트를 통과하면 여기 축적됩니다 — 매 상호작용이 소모되지 않고 남습니다.</div>';
    el.canvas.innerHTML = '<div class="agh-shead"><div><h2>산출물 · 프로세스 자산</h2><span class="agh-exp">과정/판단/근거가 구조화 데이터로 축적 · 다음 사이클이 이어받음 (S8)</span></div></div><div class="agh-tl">' + rows + "</div>";
    ctxPanel([
      { tag: "프로세스 자산화", title: "왜 축적하나", body: "지속되는 평가 사이클이 이어받을 성과 자산 — 목표/피드백/평가 근거가 휘발되지 않고 재사용 객체로 남습니다." }
    ], "");
  };

  /* ---------- 감사 로그 ---------- */
  RENDER.audit = function () {
    var rows = state.audit.length ? state.audit.map(function (a) {
      return '<tr><td>' + esc(a.at) + "</td><td>" + esc(a.actor) + "</td><td>" + esc(a.act) + "</td><td>" + esc(a.target) + '</td><td class="ref">' + esc(a.ref) + "</td></tr>";
    }).join("") : '<tr><td colspan="5" class="agh-emptycell">기록된 행위가 없습니다. 모든 결정·재계산·문장 반영이 여기에 남습니다.</td></tr>';
    el.canvas.innerHTML = '<div class="agh-shead"><div><h2>감사 로그</h2><span class="agh-exp">전 행위 추적 가능한 기록 — 승인·정책·감사는 요청 계약 계층에 결합</span></div></div>' +
      '<table class="agh-table"><thead><tr><th>시각</th><th>행위자</th><th>행위</th><th>대상</th><th>참조</th></tr></thead><tbody>' + rows + "</tbody></table>";
    ctxPanel([
      { tag: "환각 통제", title: "감사가 신뢰를 만든다", body: "결과가 아니라 <b>보여준 과정</b>이 신뢰를 만듭니다. What-if 재계산·게이트 결정·문장 반영까지 전부 기록됩니다." }
    ], "");
  };

  /* ============================================================
     명령어 입력창 — 온라인이면 실제 /api/chat, 아니면 화면 라우팅
     ============================================================ */
  function runCmd() {
    var input = el.root.querySelector("[data-agh-cmdin]");
    var q = (input.value || "").trim();
    if (!q) return;
    input.value = "";
    /* 의도 라우팅: 화면 키워드 매칭 → 해당 시뮬 실행 */
    var routes = [
      [/체크인|진척|주간/, "qw1"], [/목표.*(초안|추천|수립)/, "qw2"], [/코멘트|등급.*초안|근거초안/, "qw3"],
      [/근거.*(수집|타임라인)|타임라인/, "qw4"], [/편향|관대화/, "qw5"], [/피드백.*(정제|다듬)/, "qw6"],
      [/정합|중복/, "qw7"], [/캘리|calibration|심의/i, "calib"], [/리뷰|총평/, "review"], [/감사|로그/, "audit"], [/산출물|자산/, "assets"]
    ];
    for (var i = 0; i < routes.length; i++) {
      if (routes[i][0].test(q)) {
        showScreen(routes[i][1]);
        ctxAppend('<div class="agh-live">지시 수신 · "' + esc(q) + '" → ' + esc(SCREENS[routes[i][1]].title) + " 실행</div>");
        logAudit("지시", q, "cmd");
        return;
      }
    }
    /* 백엔드 라이브 응답 (있으면) */
    ctxAppend('<div class="agh-live">지시 수신 · "' + esc(q) + '"</div>');
    logAudit("지시", q, "cmd");
    var base = (window.location.port === "8080") ? "" : "http://localhost:8080";
    fetch(base + "/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emp_id: CU().emp_id, message: q, perspective: (role().persp || "subject") })
    }).then(function (r) {
      if (!r.ok) throw 0;
      var ct = (r.headers.get("Content-Type") || "");
      if (ct.indexOf("event-stream") >= 0) {
        var reader = r.body.getReader(), dec = new TextDecoder(), buf = "", acc = "";
        var node = h("div", "agh-live ai", "…");
        var host = el.ctx.querySelector("[data-agh-ctxchat]");
        if (host) host.appendChild(node);
        (function pump() {
          reader.read().then(function (x) {
            if (x.done) return;
            buf += dec.decode(x.value, { stream: true });
            var parts = buf.split("\n\n"); buf = parts.pop();
            parts.forEach(function (p) {
              var m = p.match(/data:\s*(\{.*\})/);
              if (m) { try { var j = JSON.parse(m[1]); if (j.type === "chunk") { acc += j.content || ""; node.textContent = acc.slice(0, 700); } } catch (e) {} }
            });
            if (host) host.scrollTop = host.scrollHeight;
            pump();
          });
        })();
      } else { r.json().then(function (j) { ctxAppend('<div class="agh-live ai">' + esc((j.response || "").slice(0, 700)) + "</div>"); }); }
    }).catch(function () {
      ctxAppend('<div class="agh-live ai">오프라인 — 과제 키워드(체크인·목표 초안·편향·정합성·캘리·리뷰…)로 지시하면 해당 화면을 실행합니다.</div>');
    });
  }

  /* ============================================================
     선제 알림 (W3 형태② — 에이전트가 먼저 말 건다)
     ============================================================ */
  var ALERTS = [
    { title: "가중치 합계 105%", body: "목표 가중치 합이 상한을 5%p 초과 — 조정안 준비됨", screen: "qw2" },
    { title: "체크인 지연 3명", body: "7일+ 무변동 3명 · 진척 지연 1명 — 초안 발송 대기", screen: "qw1" },
    { title: "캘리브레이션 D-3", body: "개발본부 관대화 의심 — 심의 안건 검토 필요", screen: "calib" }
  ];
  function showAlerts() {
    if (!(window.TX && TX.menu)) return;
    var btn = el.root.querySelector("[data-agh-alerts]");
    TX.menu(btn, ALERTS.map(function (a) {
      return { label: "▲ " + a.title + " — " + a.body, onClick: function () { showScreen(a.screen); } };
    }));
  }
  /* 메인 앱 위 선제 팝업 카드 */
  var popupShown = false;
  function scheduleProactive() {
    if (popupShown) return;
    setTimeout(function () {
      if (popupShown || state.open) return;
      popupShown = true;
      var a = ALERTS[role().key === "leader" ? 1 : role().key === "hr" ? 2 : 0];
      var card = h("div", "agh-popup");
      card.innerHTML = '<div class="hd"><span class="dot"></span>Agent 알림 · 선제 감지</div>' +
        "<b>" + esc(a.title) + "</b><p>" + esc(a.body) + "</p>" +
        '<div class="acts"><button class="agh-btn primary" data-pgo>열어서 확인</button><button class="agh-btn" data-pdis>나중에</button></div><small>스누즈 1일 · 승인 후 승격</small>';
      document.body.appendChild(card);
      requestAnimationFrame(function () { card.classList.add("show"); });
      card.addEventListener("click", function (e) {
        if (e.target.closest("[data-pgo]")) { card.remove(); openHub(a.screen); }
        if (e.target.closest("[data-pdis]")) { card.classList.remove("show"); setTimeout(function () { card.remove(); }, 250); }
      });
    }, 9000);
  }

  /* ============================================================
     open / close / init
     ============================================================ */
  function openHub(screen) {
    buildHub();
    state.open = true;
    el.root.classList.add("on");
    var rc = el.root.querySelector("[data-agh-role]");
    if (rc) rc.textContent = role().label + " 관점 · " + CU().name;
    document.body.style.overflow = "hidden";
    showScreen(screen || defaultScreen());
  }
  function closeHub() {
    state.open = false;
    clearTimers();
    if (el.root) el.root.classList.remove("on");
    document.body.style.overflow = "";
  }

  /* GNB 진입점 주입: elizax 랜딩 버튼 외에 상단에서도 바로 진입 */
  function injectGnbEntry() {
    if (document.querySelector(".agh-entry")) return;
    var b = h("button", "agh-entry", "⚡ AI Agent Hub");
    b.title = "성과관리/평가 E2E AI Agent Hub";
    b.addEventListener("click", function () { openHub(); });
    var bar = document.querySelector(".txr-bar");
    if (bar) { b.classList.add("inbar"); bar.appendChild(b); return; }
    var right = document.querySelector(".gnb .gnb-right");
    if (right) right.insertBefore(b, right.firstChild);
  }

  function init() {
    injectGnbEntry();
    scheduleProactive();
  }
  if (document.readyState === "complete") setTimeout(init, 400);
  else window.addEventListener("load", function () { setTimeout(init, 400); });

  window.TXAgent = { openHub: openHub, closeHub: closeHub, open: showScreen };
})();
