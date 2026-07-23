/* ============================================================
   tx_agent.js — 성과관리/평가 E2E AI Agent Hub
   W2(마스터 3분할 UI·노드 워크플로우·Calibration·리뷰 co-writing)
   + 채팅 임베드 시나리오(runScenario) · Quick-win 7과제 · 자율성 배지
   perf-agent-verifiable-ui 4원칙 준수: as-of · trace · audit · what-if.

   노출 형태 3종:
     ① 도킹 대화창  — elizax 패널이 TXAgent.runScenario(key, host)로
                      시나리오를 대화 안에 임베드 (host=.ezx-scnhost)
     ② 선제 팝업    — 메인 앱 위 감지 카드 (scheduleProactive)
     ③ 전체화면 딥워크 — Agent Hub 오버레이 (openHub/openFull)

   Exposes window.TXAgent = {
     openHub, closeHub, open(screen), openFull, closeFull,
     SCENARIOS, runScenario(key, host), intentFor(text)
   }.
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
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function toast(m, k) { if (window.TX && TX.toast) TX.toast(m, k || ""); }
  function nowLabel() {
    var t = new Date();
    function z(n) { return (n < 10 ? "0" : "") + n; }
    return z(t.getHours()) + ":" + z(t.getMinutes());
  }
  var AS_OF = "2026 상반기 · 7/15 06:00 기준";

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
  /* 도킹 임베드용 로컬 타이머 — 허브 타이머 풀(state.timers)과 분리해
     showScreen/closeHub의 clearTimers()가 채팅 카드 애니메이션을 끊지 않게 한다 */
  function laterLocal(fn, ms) { return setTimeout(fn, ms); }
  function timerFor(host) { return host === el.canvas ? later : laterLocal; }

  function logAudit(act, target, ref) {
    state.audit.unshift({ at: nowLabel(), actor: CU().name, act: act, target: target, ref: ref || ("GA-" + (26000 + state.audit.length)) });
    var b = document.querySelector("[data-agh-auditcnt]");
    if (b) b.textContent = state.audit.length;
  }
  function addAsset(kind, title, screen) {
    state.assets.unshift({ at: nowLabel(), kind: kind, title: title, screen: screen });
  }

  /* ---------------- 자율성 배지 ---------------- */
  function autonomyBadge(mode) {
    var map = { auto: ["자동 처리", "집계·데이터 반영은 에이전트가 바로 실행"], suggest: ["제안만", "등급·문구는 근거와 함께 제안만"], human_approve: ["승인 필요", "확정·전송은 사람 승인 게이트 필수"] };
    var m = map[mode] || map.suggest;
    return '<span class="agh-badge agh-b-' + mode + '" title="' + esc(m[1]) + '">● ' + m[0] + "</span>";
  }

  /* ---------------- 근거 칩 (원천 인용 · trace) ---------------- */
  function srcChip(kind, label) {
    return '<span class="agh-src agh-s-' + kind + '">' + esc(label) + "</span>";
  }
  /* 실 기록 ID가 붙은 근거 칩 — 클릭하면 원본 요약을 토스트로 보여준다 */
  function refChip(kind, label, note) {
    if (!note) return srcChip(kind, label);
    return '<span class="agh-src agh-s-' + kind + '" data-src-note="' + esc(note) + '" style="cursor:pointer" title="클릭하면 원본 요약을 봅니다">' + esc(label) + "</span>";
  }

  /* ---------------- 승인 게이트 (공통) ---------------- */
  function gateHTML(key, labels) {
    labels = labels || ["승인", "수정", "보류"];
    var dec = state.decided[key];
    var btns = labels.map(function (l, i) {
      return '<button class="agh-btn' + (i === 0 ? " primary" : "") + '" data-gact="' + esc(l) + '" data-gkey="' + esc(key) + '"' +
        (dec ? " disabled" : "") + (dec && dec.act === l ? ' data-chosen="1"' : "") + ">" + esc(l) + "</button>";
    }).join("");
    return '<div class="agh-gate" data-gate="' + esc(key) + '">' +
      '<span class="lab">결정 게이트 · 사람이 확정 (승인 전에는 아무것도 반영되지 않음)</span>' + btns +
      (dec ? '<span class="agh-dec">✓ ' + esc(dec.act) + " · 감사 기록됨</span>" : "") + "</div>";
  }
  function decideGate(key, act, note) {
    state.decided[key] = { act: act, note: note || "" };
    var scr = SCREENS[key];
    logAudit(act, (scr ? scr.title : key), null);
    addAsset("결정", (scr ? scr.title : key) + " · " + act + (note ? " — " + note : ""), key);
    /* 같은 키의 게이트가 허브·채팅 카드 양쪽에 있을 수 있어 document 전역으로 모두 갱신 */
    Array.prototype.forEach.call(document.querySelectorAll('[data-gate="' + key + '"]'), function (g) {
      Array.prototype.forEach.call(g.querySelectorAll("[data-gact]"), function (b) {
        b.disabled = true;
        if (b.getAttribute("data-gact") === act) b.setAttribute("data-chosen", "1");
      });
      if (!g.querySelector(".agh-dec")) g.appendChild(h("span", "agh-dec", "✓ " + esc(act) + " · 감사 기록됨"));
    });
    toast(act + " 처리 — 감사 로그 기록 · 기록으로 보관되었습니다.", act.indexOf("승인") >= 0 ? "ok" : "");
  }

  /* ============================================================
     화면 정의 — Quick-win 7과제 + W2 심화 2종 + 자산/감사
     ============================================================ */
  var SCREENS = {
    home:    { title: "오늘 브리핑",              nav: "오늘 브리핑",         mode: null },
    chat:    { title: "elizax 대화",             nav: "대화 이어가기",       mode: null },
    qw2:     { title: "개인맥락 목표 초안 · 정렬 검증", nav: "목표 초안+정렬",   mode: "suggest",       group: "목표관리" },
    qw7:     { title: "목표 정렬·중복 점검",        nav: "목표 정렬 점검",      mode: "suggest",       group: "목표관리" },
    qw1:     { title: "주간 체크인 팝업 · 진척 요약", nav: "주간 체크인",       mode: "auto",          group: "성과관리" },
    qw4:     { title: "상시 근거 수집 타임라인",     nav: "상시 근거 수집",     mode: "suggest",       group: "성과관리" },
    qw6:     { title: "피드백 문장 정제 (SBI)",     nav: "피드백 정제",        mode: "suggest",       group: "성과관리" },
    qw3:     { title: "평가 코멘트 근거초안",       nav: "평가 코멘트 초안",    mode: "human_approve", group: "평가관리" },
    hold:    { title: "근거 부족 시 정지",         nav: "정지 데모",          mode: "suggest",       group: "평가관리" },
    qw5:     { title: "평가 편향 점검",            nav: "편향 점검",          mode: "suggest",       group: "평가관리" },
    calib:   { title: "등급 조정 심의 회의", nav: "등급 조정 심의", mode: "human_approve", group: "평가관리" },
    review:  { title: "리뷰 초안 함께 쓰기",       nav: "리뷰 초안 작성",      mode: "human_approve", group: "평가관리" },
    assets:  { title: "산출물 · 기록 보관함",       nav: "산출물",             mode: null,            group: "자산" },
    audit:   { title: "감사 로그",                nav: "감사 로그",           mode: null,            group: "자산" }
  };
  var NAV_ORDER = ["home", "chat", "qw2", "qw7", "qw1", "qw4", "qw6", "qw3", "hold", "qw5", "calib", "review", "assets", "audit"];

  /* ============================================================
     시나리오 메타 — 채팅 임베드/제안 칩의 단일 원장 (tx_elizax 소비)
       chip  : 자연어 제안 라벨   roles: 노출 대상 역할
       heavy : true=340px 도킹엔 넓어 요약 스텁+전체화면 버튼으로 임베드
     ============================================================ */
  var SCENARIOS = [
    { key: "qw1",    chip: "주간 체크인 브리핑 만들어줘",        desc: "talenx·ERP·1:1 기록을 스캔해 체크인 대상과 부진 인원을 요약하고, 리더가 보낼 메시지 초안까지 준비합니다.", roles: ["leader"],        heavy: false, mode: "auto" },
    { key: "qw2",    chip: "이번 분기 목표 초안 잡아줘",         desc: "작년 평가·피드백과 직무 R&R을 이어받아 목표 초안 3안을 만들고 상위목표 정렬을 검증합니다.",                   roles: ["member"],        heavy: false, mode: "suggest" },
    { key: "qw7",    chip: "팀 목표 정렬·중복 점검해줘",         desc: "팀 목표 전건을 문장 품질(중복·미연계·측정불가)과 운영 신호(체크인 공백·진척 정체) 두 축으로 점검합니다.",     roles: ["leader", "exec"], heavy: true,  mode: "suggest" },
    { key: "qw4",    chip: "내 성과 근거 타임라인 보여줘",       desc: "달성·프로젝트·피드백·1:1 기록이 발생 시점에 자동으로 기록된 1년치 근거 타임라인입니다.",                        roles: ["member"],        heavy: true,  mode: "suggest" },
    { key: "qw6",    chip: "피드백 문장 다듬어줘",              desc: "SBI 구조로 피드백 문장을 정제합니다. 의도는 유지하고 전달 방식만 다듬습니다.",                              roles: ["leader"],        heavy: false, mode: "suggest" },
    { key: "qw3",    chip: "평가 코멘트 초안 써줘",             desc: "ERP 실적·직무군 분포·평가규정을 대조해 문장별 출처가 붙은 코멘트 초안을 만듭니다.",                          roles: ["leader"],        heavy: false, mode: "human_approve" },
    { key: "hold",   chip: "박지훈 등급 초안 만들어줘",          desc: "근거가 부족하면 추정하지 않고 정지 후 질문합니다. 보강 경로를 고르면 재개됩니다.",                            roles: ["leader"],        heavy: false, mode: "suggest" },
    { key: "qw5",    chip: "평가 편향 점검해줘",                desc: "본부별 등급 분포·근거량을 대조해 관대화·중심화 의심을 플래그와 근거로만 제시합니다.",                        roles: ["hr", "exec"],    heavy: true,  mode: "suggest" },
    { key: "calib",  chip: "등급 조정 심의 열어줘",       desc: "4개 관점 에이전트가 조정 논거를 교차 심의하고, 가정 슬라이더로 상한을 즉시 재산출합니다.",                 roles: ["hr"],            heavy: true,  mode: "human_approve" },
    { key: "review", chip: "리뷰 초안 같이 쓰자",               desc: "AI가 근거를 인용해 초안 문장을 제안하고, 사용자가 문장 단위로 반영·무시합니다.",                             roles: ["leader", "hr"],  heavy: true,  mode: "human_approve" }
  ];
  function scenarioOf(key) {
    for (var i = 0; i < SCENARIOS.length; i++) if (SCENARIOS[i].key === key) return SCENARIOS[i];
    return null;
  }
  /* heavy 시나리오 스텁의 핵심 숫자 미리보기 */
  var STUB_NUMS = {
    calib:  "S 8%→6% · A 32%→25% 조정안",
    qw7:    "8건 스캔 · 문장 품질 3건 · 운영 신호 5건",
    qw4:    "근거 24건 기록",
    qw5:    "4본부 스캔 · 편향 플래그 2",
    review: "5/12 작성 · AI 보조 ON"
  };

  /* ---------------- 채팅 임베드 실행 ---------------- */
  function runScenario(key, host) {
    var sc = scenarioOf(key);
    if (!sc || !host) return null;
    if (sc.heavy) {
      var s = SCREENS[key] || { title: key };
      host.innerHTML =
        '<div class="agh-scnstub" data-scn="' + esc(key) + '">' +
        '<div class="hd"><b class="tt">' + esc(s.title) + "</b>" + (sc.mode ? autonomyBadge(sc.mode) : "") +
        '<span class="agh-auditchip">⛨ 감사 기록됨</span></div>' +
        "<p>" + esc(sc.desc) + "</p>" +
        '<div class="num">' + esc(STUB_NUMS[key] || "") + "</div>" +
        '<div class="acts"><button class="agh-btn primary" data-scn-full="' + esc(key) + '">⛶ 전체화면에서 열기</button></div></div>';
    } else if (RENDER[key]) {
      RENDER[key](host);
    }
    logAudit("시나리오 실행", sc.chip, key);
    return sc;
  }

  /* ---------------- 의도 라우터 ---------------- */
  function intentFor(text) {
    var q = String(text == null ? "" : text);
    if (!q) return null;
    if (/HOLD|홀드/i.test(q)) return "hold";
    if (/체크인|진척/.test(q)) return "qw1";
    if (/목표/.test(q) && /초안|추천|수립/.test(q)) return "qw2";
    if (/정합|정렬|중복/.test(q)) return "qw7";
    if (/근거|타임라인/.test(q)) return "qw4";
    if (/피드백/.test(q) && /정제|다듬/.test(q)) return "qw6";
    if (/평가/.test(q) && /코멘트|초안/.test(q)) return "qw3";
    if (/코멘트|근거초안/.test(q)) return "qw3";
    if (/편향|관대화/.test(q)) return "qw5";
    if (/캘리|calibration|심의/i.test(q)) return "calib";
    if (/리뷰|총평/.test(q)) return "review";
    return null;
  }

  /* 역할별 기본 화면 (역할 주체 자동 연동) */
  function defaultScreen() {
    var k = role().key;
    if (k === "leader") return "qw1";
    if (k === "hr") return "qw5";
    if (k === "exec") return "qw7";
    return "qw2";
  }

  /* ============================================================
     전역 위임 — 게이트·전체화면 버튼은 허브 밖(채팅 카드)에서도 동작
     ============================================================ */
  document.addEventListener("click", function (e) {
    if (!e.target || !e.target.closest) return;
    var scNote = e.target.closest("[data-src-note]");
    if (scNote) { toast("원본 요약 — " + scNote.getAttribute("data-src-note")); return; }
    var g = e.target.closest("[data-gact]");
    if (g && !g.disabled) {
      var key = g.getAttribute("data-gkey"), act = g.getAttribute("data-gact");
      if (act.indexOf("승인") >= 0 || act === "반영") decideGate(key, act);
      else openGateNote(key, act);
      return;
    }
    var qa = e.target.closest("[data-qw7-act]");
    if (qa) {
      var qact = qa.getAttribute("data-qw7-act");
      logAudit("제안 준비", "목표 정렬 점검 · " + qact, "qw7.act");
      toast("'" + qact + "' 초안이 준비되었습니다 — 확정은 아래 결정 게이트에서 하세요.");
      return;
    }
    var f = e.target.closest("[data-scn-full]");
    if (f) {
      if (window.Elizax && window.Elizax.close) { try { window.Elizax.close(); } catch (err) {} }
      openHub(f.getAttribute("data-scn-full"));
    }
  });

  /* ============================================================
     HUB 골격 — 마스터 UI: 글로벌바/내비/캔버스/컨텍스트패널/상태바/명령어
     ============================================================ */
  var el = {};
  function buildHub() {
    if (el.root) return;
    var root = h("div", "agh-root");

    /* ① 글로벌바 */
    var bar = h("div", "agh-gbar");
    bar.innerHTML =
      '<div class="agh-gl"><span class="agh-logo">✦</span><b>elizax</b><span class="agh-brand-sub">워크스페이스</span>' +
      '<span class="agh-rolechip" data-agh-role></span></div>' +
      '<div class="agh-gr">' +
      '<button class="agh-gitem" data-agh-alerts>🔔 알림 <b data-agh-alertcnt>3</b></button>' +
      '<button class="agh-gitem" data-agh-ctxtoggle title="판단 근거·사람 확인 패널 열기/닫기">☰ 근거</button>' +
      '<span class="agh-gitem" data-agh-ai title="AI 연결 상태">◐ AI 상태 확인 중</span>' +
      '<button class="agh-gitem" data-agh-dock title="도킹 대화창으로 전환">◱ 도킹으로</button>' +
      '<button class="agh-gitem" data-agh-close>닫기 ✕</button></div>';

    /* ② 내비 */
    var nav = h("nav", "agh-nav");

    /* ③ 캔버스 */
    var canvas = h("main", "agh-canvas");

    /* ④ 컨텍스트 패널 */
    var ctx = h("aside", "agh-ctx");

    /* ⑤ 상태바 (연동 소스 상시 표시) */
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
    bar.querySelector("[data-agh-dock]").addEventListener("click", function () {
      closeHub();
      if (window.Elizax && window.Elizax.open) window.Elizax.open();
    });
    bar.querySelector("[data-agh-alerts]").addEventListener("click", showAlerts);
    /* 컨텍스트 패널은 필요할 때만 — 수동 토글 + 라이브 이벤트 시 자동 오픈 */
    bar.querySelector("[data-agh-ctxtoggle]").addEventListener("click", function () {
      root.classList.toggle("agh-ctx-on");
    });
    cmd.querySelector("[data-agh-cmdgo]").addEventListener("click", runCmd);
    cmd.querySelector("[data-agh-cmdin]").addEventListener("keydown", function (e) {
      if (e.key === "Enter") runCmd();
    });
    /* 내비 이동만 허브 루트 스코프 — 게이트는 document 전역 위임에서 처리 */
    root.addEventListener("click", function (e) {
      var nv = e.target.closest("[data-agh-nav]");
      if (nv) { showScreen(nv.getAttribute("data-agh-nav")); return; }
      if (e.target.closest("[data-agh-newchat]")) {
        if (window.EZChat) EZChat.newSession();
        showScreen("chat");
        logAudit("새 채팅", "대화 생성", "chat.new");
        return;
      }
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

  /* ---------------- 내비 — 오늘 / 제안(역할 맞춤 자연어 칩) / 기록 ---------------- */
  function navItem(key, label, mode) {
    return '<button class="agh-nitem' + (state.screen === key ? " on" : "") + '" data-agh-nav="' + esc(key) + '">' +
      esc(label) + (mode ? autonomyBadge(mode) : "") + "</button>";
  }
  function renderNav() {
    var rk = role().key;
    var html = '<div class="agh-newchat"><button class="agh-btn primary wide" data-agh-newchat>＋ 새 채팅</button></div>';
    html += '<div class="agh-ngroup">오늘</div>' + navItem("home", "오늘 브리핑", null) + navItem("chat", "💬 대화 이어가기", null);
    html += '<div class="agh-ngroup">제안</div>';
    SCENARIOS.forEach(function (sc) {
      if (sc.roles.indexOf(rk) >= 0) html += navItem(sc.key, sc.chip, sc.mode);
    });
    html += '<div class="agh-ngroup">기록</div>' + navItem("assets", "산출물", null) + navItem("audit", "감사 로그", null);
    el.nav.innerHTML = html;
  }

  /* ---------------- 컨텍스트 패널 공통 (허브 캔버스 렌더 시에만) ---------------- */
  function ctxPanel(items, chatNote) {
    var html = '<div class="agh-ctx-h">맥락 패널 <small>판단 근거 · 사람 확인</small></div>';
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
    if (!el.ctx) return;
    /* 라이브 이벤트(지시·AI 응답·경고)가 오면 패널 자동 오픈 */
    if (el.root) el.root.classList.add("agh-ctx-on");
    var c = el.ctx.querySelector("[data-agh-ctxchat]");
    if (c) { c.insertAdjacentHTML("beforeend", html); c.scrollTop = c.scrollHeight; }
  }
  /* host가 허브 캔버스일 때만 컨텍스트 패널을 건드린다 (채팅 임베드는 패널 없음) */
  function ctxPanelIf(host, items, chatNote) { if (host === el.canvas) ctxPanel(items, chatNote); }
  function ctxAppendIf(host, html) { if (host === el.canvas) ctxAppend(html); }

  /* ---------------- 화면 전환 ---------------- */
  function showScreen(key) {
    if (!SCREENS[key]) key = "home";
    /* 롤 가드 — 딥링크(openHub)로 상위 롤 전용 화면 우회 진입 차단. renderNav와 동일한 sc.roles/role().key 사용 */
    var sc = scenarioOf(key);
    if (sc && sc.roles.indexOf(role().key) < 0) {
      var R = (window.TXRoles && TXRoles.ROLES) || {};
      var names = sc.roles.map(function (k) { return (R[k] && R[k].label) || k; }).join("/");
      toast("이 기능은 " + names + " 권한에서 열람할 수 있습니다.");
      key = defaultScreen();
    }
    clearTimers();
    /* 대화 스크린을 떠나면 렌더 서피스를 FAB로 반납 */
    if (state.screen === "chat" && key !== "chat" && window.Elizax && Elizax.detachSurface) Elizax.detachSurface();
    state.screen = key;
    renderNav();
    var fn = RENDER[key] || RENDER.home;
    fn();
  }

  /* ============================================================
     각 화면 렌더러 + 라이브 시뮬레이션
     — 모든 렌더러는 host(컨테이너)를 받는다. 무인자 호출 시 허브 캔버스.
     ============================================================ */
  function screenHead(key) {
    var s = SCREENS[key];
    return '<div class="agh-shead"><div><h2>' + esc(s.title) + "</h2>" +
      (s.mode ? autonomyBadge(s.mode) : "") +
      '<span class="agh-auditchip">⛨ 감사 기록됨</span></div>' +
      '<span class="agh-asof2">기준 시점 · ' + esc(AS_OF) + " ▾</span></div>";
  }

  var RENDER = {};

  /* ---------- 홈 브리핑 ---------- */
  RENDER.home = function (host) {
    host = host || el.canvas;
    var r = role();
    var cards = NAV_ORDER.filter(function (k) { return SCREENS[k].mode; }).map(function (k) {
      var s = SCREENS[k];
      return '<button class="agh-qwcard" data-agh-nav="' + k + '">' + autonomyBadge(s.mode) +
        "<b>" + esc(s.title) + "</b><small>" + esc(s.group) + " · 클릭하면 라이브 시뮬 실행</small></button>";
    }).join("");
    host.innerHTML =
      '<div class="agh-shead"><div><h2>오늘은 어떤 도움을 드릴까요?</h2>' +
      '<span class="agh-exp">역할 주체 <b>' + esc(r.label) + "</b> 기준으로 화면과 권한이 자동 구성됩니다</span></div></div>" +
      '<div class="agh-brief"><span class="ic">⚡</span><div><b>선제 감지 3건</b> — 가중치 합 105% · 전사목표 미연결 1건 · 체크인 지연 3명. ' +
      "호출 없이 에이전트가 먼저 포착했습니다. 아래 과제 카드에서 확인하세요.</div></div>" +
      '<div class="agh-qwgrid">' + cards + "</div>";
    ctxPanelIf(host, [
      { tag: "챗봇 vs 에이전트", title: "이 워크스페이스가 다른 점 (9축)", body: "촉발=선제 · 산출물=편집 가능한 결과물 · 과정=진행 단계 표시 · 근거=원천 인용 · 통제권=단계·문장 단위 승인 게이트 · 동시성=여러 에이전트 동시 실행" },
      { tag: "실행 규율", title: "읽기는 자율, 확정은 게이트", body: "읽기·계획·산출은 자율, 발송·확정·삭제는 제안→승인→실행 순서로만 진행됩니다. 승인 전에는 아무것도 반영되지 않습니다." }
    ], "");
  };

  /* ---------- 대화 (FAB 도킹 대화와 동일 스레드 — EZChat 공유 스토어) ---------- */
  RENDER.chat = function (host) {
    host = host || el.canvas;
    host.innerHTML =
      '<div class="agh-shead"><div><h2>elizax 대화</h2>' +
      '<span class="agh-exp">도킹 대화창과 같은 대화가 이어집니다 · 제목 <b data-agh-chattitle></b></span></div>' +
      '<span class="agh-asof2">기준 시점 · ' + esc(AS_OF) + " ▾</span></div>" +
      '<div class="agh-chatwrap">' +
      '<div class="ezx-list agh-chatlist" data-agh-chatlist role="log" aria-live="polite"></div>' +
      '<div class="agh-chatcomp"><textarea rows="1" placeholder="elizax에게 메시지… (Enter 전송 · Shift+Enter 줄바꿈)" data-agh-chatta></textarea>' +
      '<button class="agh-btn primary" data-agh-chatsend>전송</button></div></div>';
    var titleEl = host.querySelector("[data-agh-chattitle]");
    function syncTitle() { if (titleEl && window.EZChat) titleEl.textContent = EZChat.currentTitle(); }
    syncTitle();
    var list = host.querySelector("[data-agh-chatlist]");
    if (window.Elizax && Elizax.attachSurface) Elizax.attachSurface(list);
    var ta = host.querySelector("[data-agh-chatta]");
    var send = host.querySelector("[data-agh-chatsend]");
    function submit() {
      var v = (ta.value || "").trim();
      if (!v || (window.Elizax && Elizax.isStreaming && Elizax.isStreaming())) return;
      ta.value = "";
      if (window.Elizax && Elizax.sendRaw) Elizax.sendRaw(v);
      logAudit("지시", v, "chat");
    }
    send.addEventListener("click", submit);
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
    });
    /* 스트리밍 동안 컴포저 잠금 + 세션 전환 시 제목 갱신 */
    if (window.EZChat) {
      var onStream = function (d) { ta.disabled = !!d.on; send.disabled = !!d.on; };
      var onSwitch = function () { syncTitle(); };
      EZChat.on("streaming", onStream);
      EZChat.on("switch", onSwitch);
      EZChat.on("messages", onSwitch);
    }
    ctxPanelIf(host, [
      { tag: "연동", title: "하나의 대화, 두 개의 화면", body: "도킹 대화창과 전체화면이 <b>같은 세션</b>을 읽고 씁니다. 어디서 묻든 기록·근거·감사가 성과 히스토리 하나에 남습니다. " + srcChip("talenx", "공유 대화 저장소") },
      { tag: "전환", title: "◱ 도킹으로 / ⛶ 전체화면으로", body: "우상단 버튼으로 언제든 형태를 바꿔도 대화가 끊기지 않습니다." }
    ], "");
  };

  /* ---------- QW2 · 개인맥락 목표 초안 + 정렬 검증 ---------- */
  /* 이어받은 출발점 — 작년 평가(evalHistory)·평가 근거(evaluations)·올해 직무(jobProfiles)를
     실데이터에서 인용한다. 조회가 비면(프로파일 미연결 등) 안전한 폴백 문구로 대체. */
  function qw2Carry() {
    var cu = CU(), d = D();
    var c = { grade: null, score: null, improve: null, profTitle: null, taskArea: null, jobLabel: cu.jobTitle || "직무 미지정" };
    try {
      var eh = (d.evalHistory || []).filter(function (r) { return r.emp_id === cu.emp_id; })[0];
      var fy = eh && (eh.history || []).filter(function (p) { return p.period === "FY2025"; })[0];
      if (fy) { c.grade = fy.grade; c.score = fy.score; }
      var ev = (d.evaluations || []).filter(function (r) { return r.emp_id === cu.emp_id; })[0];
      if (ev && ev.components) {
        var axes = [["achievement_norm", "목표 달성"], ["peer_strength_norm", "피어 협업"], ["exec_consistency_norm", "실행 일관성"]];
        var low = null;
        axes.forEach(function (a) {
          var v2 = ev.components[a[0]];
          if (typeof v2 === "number" && (!low || v2 < low.v)) low = { v: v2, nm: a[1] };
        });
        if (low) c.improve = low.nm + " " + Math.round(low.v) + "/100";
      }
      var prof = cu.jobProfileId && (d.jobProfiles || {})[cu.jobProfileId];
      if (prof) {
        c.profTitle = prof.title || c.jobLabel;
        c.jobLabel = c.profTitle;
        c.taskArea = Object.keys(prof.tasks || {})[0] || null;
      }
      /* 작년 평가 상세(evaluationsPrev) — 미완 KR이 올해 초안의 이월 후보가 된다 */
      var prev = (d.evaluationsPrev || []).filter(function (r) { return r.emp_id === cu.emp_id; })[0];
      if (prev) {
        c.prevEval = prev;
        if (!c.grade) c.grade = prev.grade;
        if (c.score == null) c.score = prev.score;
        c.pendKrs = (prev.krs || []).filter(function (k) { return !k.done; });
      }
      /* 작년 피드백(feedbackHistory) — 리더 피드백 우선, 없으면 첫 건 */
      var fbs = (d.feedbackHistory || []).filter(function (r) { return r.emp_id === cu.emp_id; });
      c.fb = fbs.filter(function (f) { return f.source_type === "leader"; })[0] || fbs[0] || null;
      if (c.fb) {
        var qm = String(c.fb.summary || "").match(/—\s*([^.]{4,40})/);
        c.fbQuote = qm ? qm[1].trim() : String(c.fb.summary || "").slice(0, 24);
      }
      /* 직무 전환 이력(jobHistory) — 출발점이 전년과 달라졌는지 */
      var emp = (d.employees || []).filter(function (x) { return x.emp_id === cu.emp_id; })[0];
      c.jobChange = (emp && emp.jobHistory && emp.jobHistory[0]) || null;
    } catch (e) {}
    return c;
  }
  RENDER.qw2 = function (host) {
    host = host || el.canvas;
    var cu = CU();
    var carry = qw2Carry();
    var objs = myObjectives().slice(0, 3);
    var pads = [{ title: "추천모델 v2 배포 · CTR +8%" }, { title: "온보딩 전환율 개선 +5%p" }, { title: "ML 온보딩 교육자료 (초안 제안)" }];
    var names = objs.concat(pads.slice(0, Math.max(0, 3 - objs.length))).slice(0, 3);
    var cardCss = "flex:1;min-width:190px;background:#fff;border:1px solid #E4E7EC;border-radius:10px;padding:10px 12px;font-size:12.5px;line-height:1.55";
    var carryHTML =
      '<div class="agh-brief" data-agh-carry><span class="ic">⟳</span><div style="flex:1"><b>이어받은 출발점</b> — 매년 백지에서 다시 시작하지 않습니다. 작년 기록과 올해 직무 기준이 초안의 재료가 됩니다.' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:9px">' +
      '<div style="' + cardCss + '"><b>① 작년 평가</b><br>' +
      (carry.grade ? "FY2025 <b>" + esc(carry.grade) + "등급</b>" + (carry.score != null ? " · " + esc(carry.score) + "점" : "") : "작년 평가 기록 없음") +
      (carry.improve ? "<br>개선 영역: <b>" + esc(carry.improve) + "</b>" : "") +
      "<br>" + (carry.prevEval
        ? refChip("talenx", carry.prevEval.evaluation_id, carry.prevEval.rationale_summary)
        : srcChip("talenx", "평가 이력 FY2025")) + "</div>" +
      '<div style="' + cardCss + '"><b>② 작년 피드백 요지</b><br>' +
      (carry.fb
        ? '"' + esc(carry.fb.summary.length > 70 ? carry.fb.summary.slice(0, 70) + "…" : carry.fb.summary) + '" 올해 초안의 개선 축으로 반영합니다.' +
          "<br>" + refChip("talenx", carry.fb.fb_id + " · " + (carry.fb.source_type === "leader" ? "리더" : "동료"), carry.fb.summary)
        : '작년 피드백 기록이 없습니다. 올해부터 수시 피드백이 초안의 재료로 쌓입니다.<br>' + srcChip("talenx", "피드백 이력")) + "</div>" +
      (carry.pendKrs && carry.pendKrs.length
        ? '<div style="' + cardCss + '"><b>③ 미완으로 남은 KR</b><br>' +
          carry.pendKrs.slice(0, 2).map(function (k) {
            return "· " + esc(k.name.length > 22 ? k.name.slice(0, 22) + "…" : k.name) + " <b>" + k.achievement_pct + "%</b>";
          }).join("<br>") +
          "<br>이월 또는 재설계 후보로 초안에 반영합니다. " +
          refChip("talenx", carry.prevEval.evaluation_id, carry.prevEval.rationale_summary) + "</div>"
        : "") +
      '<div style="' + cardCss + '"><b>' + (carry.pendKrs && carry.pendKrs.length ? "④" : "③") + " 올해 직무 기준</b><br>" +
      (carry.profTitle
        ? "<b>" + esc(carry.profTitle) + "</b>" + (carry.taskArea ? " · 대표 과업 「" + esc(carry.taskArea) + "」" : "")
        : "직무 <b>" + esc(carry.jobLabel) + "</b> (직무 프로파일 연결 전)") +
      (carry.jobChange
        ? "<br>직무 전환: " + esc(carry.jobChange.prev_label) + " → <b>" + esc(carry.jobChange.new_label) + "</b> — 출발점이 전년과 달라졌습니다. " +
          refChip("rule", "직무 이력 " + carry.jobChange.period, carry.jobChange.note)
        : "<br>직무 과업이 목표의 기초가 됩니다. " + srcChip("rule", "직무 프로파일")) + "</div>" +
      "</div></div></div>";
    host.innerHTML = screenHead("qw2") + carryHTML +
      '<div class="agh-flow">' +
      ["지침수립", "자기목표", "검토회의", "피드백", "목표확정"].map(function (s, i) {
        return '<div class="agh-fstep" data-fs="' + i + '"><span class="n">' + (i + 1) + "</span>" + esc(s) + "</div>";
      }).join('<span class="agh-farrow">→</span>') + "</div>" +
      '<div class="agh-nodes" data-agh-nodes>' +
      [["작년 기록 로드", "완료"], ["직무 R&R 대조", "대기"], ["목표초안 생성", "대기"], ["상위목표 정렬", "대기"], ["규칙/이상치 검증", "대기"], ["목표안 통합", "대기"]].map(function (n, i) {
        return '<div class="agh-node" data-nd="' + i + '"><b>' + esc(n[0]) + '</b><span class="st">' + esc(n[1]) + '</span><div class="bar"><i></i></div></div>';
      }).join("") + "</div>" +
      '<div class="agh-draft" data-agh-goals>' +
      names.map(function (o, i) {
        return '<div class="agh-goal" data-gi="' + i + '"><span class="no">' + (i + 1) + '</span><div class="tt">' + esc(o.title) +
          '<div class="chips" data-gchips></div></div><span class="wt" data-gwt>-</span><span class="al" data-gal>검증 대기</span></div>';
      }).join("") + "</div>" +
      '<div class="agh-verdict" data-agh-verdict style="display:none"></div>' +
      gateHTML("qw2");
    ctxPanelIf(host, [
      { tag: "선제 감지", title: "가중치 합계 105%", kind: "warn", body: "전체 목표 가중치 합이 100%보다 <b>5%p</b> 높습니다. 목표3 가중치 15%→10% 조정안을 준비했습니다. " + srcChip("rule", "가중치 합계 규칙") },
      { tag: "선제 감지", title: "전사목표 미연결", kind: "warn", body: "목표 3이 전사 목표 '매출 3조 8,000억'과 연결되지 않았습니다. KR4 연결을 제안합니다. " + srcChip("talenx", "전사 목표체계 FY2026") }
    ], "");
    simQw2(names, host, carry);
  };
  function simQw2(names, host, carry) {
    carry = carry || qw2Carry();
    var T = timerFor(host);
    var steps = host.querySelectorAll(".agh-fstep");
    var nodes = host.querySelectorAll(".agh-node");
    function node(i, st, pct) {
      var n = nodes[i]; if (!n) return;
      n.querySelector(".st").textContent = st;
      n.classList.toggle("run", st.indexOf("진행") === 0);
      n.classList.toggle("done", st === "완료" || st.indexOf("이상치") === 0);
      n.querySelector(".bar i").style.width = (pct || 0) + "%";
    }
    steps[0].classList.add("done"); steps[1].classList.add("cur");
    node(0, "완료", 100);
    var taskChip = carry.taskArea ? "직무 과업 · " + carry.taskArea : "직무 R&R";
    T(function () { node(1, "진행중", 40); ctxAppendIf(host, '<div class="agh-live">작년 기록 로드 완료 — FY2025 평가 ' + esc(carry.grade ? carry.grade + "등급" : "기록 없음") + " · 피드백 요지 확보. 직무 R&R 대조 시작</div>"); }, 700);
    T(function () { node(1, "완료", 100); node(2, "진행중", 30); node(3, "진행중 62%", 62); ctxAppendIf(host, '<div class="agh-live">수행 — 작년 평가·피드백 ' + srcChip("talenx", "talenx") + ' · 직무 R&R·타산업 벤치마크 ' + srcChip("web", "웹") + " 병렬 대조</div>"); }, 1600);
    T(function () {
      node(2, "완료", 100); node(3, "완료", 100); node(4, "이상치 2건", 100);
      var gs = host.querySelectorAll(".agh-goal");
      var wts = ["40%", "45%", "15%"], als = ["● 정렬됨", "● 정렬됨", "▲ 미연결"];
      var evChip = carry.prevEval
        ? refChip("erp", carry.prevEval.evaluation_id, carry.prevEval.rationale_summary)
        : srcChip("erp", "작년 평가 FY2025");
      var fbChip = carry.fb
        ? refChip("talenx", carry.fb.fb_id, carry.fb.summary)
        : srcChip("talenx", "작년 피드백 FY2025");
      var chipSets = [
        srcChip("talenx", taskChip) + evChip + srcChip("talenx", "전사 KR2 ↥125%"),
        fbChip + srcChip("talenx", taskChip) + srcChip("talenx", "전사 KR2 ↥125%"),
        evChip + srcChip("rule", "전사 KR4 후보")
      ];
      Array.prototype.forEach.call(gs, function (g, i) {
        g.querySelector("[data-gwt]").textContent = wts[i] || "10%";
        var al = g.querySelector("[data-gal]");
        al.textContent = als[i] || "● 정렬됨";
        al.classList.add(i === 2 ? "warn" : "ok");
        g.querySelector("[data-gchips]").innerHTML = chipSets[i] || chipSets[0];
      });
      ctxAppendIf(host, '<div class="agh-live warn">근거 확인 완료 — 이상치 2건: 가중치 합 105% · 목표3 미연결. 근거 원천 인용 완료</div>');
    }, 2700);
    T(function () {
      node(5, "완료", 100);
      var v = host.querySelector("[data-agh-verdict]");
      v.style.display = "";
      var lastYear = carry.grade ? "작년 평가(FY2025 " + carry.grade + "등급" + (carry.score != null ? " · " + carry.score + "점" : "") + ")" : "작년 기록";
      var jobBase = carry.taskArea ? "직무 과업 「" + carry.taskArea + "」" : "직무 기준(" + carry.jobLabel + ")";
      var fbAxis = carry.fbQuote ? "작년 피드백(「" + esc(carry.fbQuote) + "」)" : "작년 피드백의 개선 영역(협업 리드)";
      var pendNote = (carry.pendKrs && carry.pendKrs.length)
        ? " 미완 KR " + carry.pendKrs.length + "건은 이월 후보로 표시했습니다."
        : "";
      v.innerHTML = '<span class="conf">신뢰도 0.86</span> ' + esc(lastYear) + "와 피드백을 이어받아 백지가 아닌 <b>초안 3안</b>을 구성했습니다. " +
        fbAxis + "을 <b>KR2</b>로 반영했고, " + esc(jobBase) + "을 근거로 <b>KR1</b>을 구성했습니다." + pendNote + " " +
        "가중치 합 105%·목표3 미연결이 확인돼 <b>15%→10% 하향 또는 KR4 연결</b> 중 택일을 제안합니다. " +
        srcChip("rule", "원칙 · 전사 정렬") + srcChip("talenx", "맥락 · H1 조직개편") + '<span class="agh-auditchip">⛨ 감사 기록됨</span>';
      ctxAppendIf(host, '<div class="agh-live ok">승인 대기 — 아래 결정 게이트에서 승인/수정/보류를 선택하세요. 승인 전 talenx 반영 없음.</div>');
    }, 3800);
  }

  /* ---------- QW7 · 목표 정렬·중복 점검 — 문장 품질 vs 운영 신호 2분면 ---------- */
  /* 운영 신호 — 팀 목표별 최근 체크인 공백을 checkins 실데이터에서 계산.
     데모 기준일 = 2026-07-16 (체크인 데이터는 2026-04-04~06-27 범위).
     팀 목표가 얇으면 결정적 폴백 행으로 3행을 보장한다. */
  function qw7OpsRows() {
    var DEMO_TODAY = new Date("2026-07-16");
    /* 운영 신호 임계 — 체크인 공백 14일 warn / 30일 bad · 진척 드리프트(기간 경과율-진행률) 20%p */
    var GAP_WARN = 14, GAP_BAD = 30, DRIFT_MIN = 20;
    /* 목표 기간은 FY2026-2Q(2026-04-01~06-30)로 가정하고 경과율을 계산한다 */
    var P_START = new Date("2026-04-01"), P_END = new Date("2026-06-30");
    var elapsed = Math.max(0, Math.min(100, Math.round((DEMO_TODAY - P_START) / (P_END - P_START) * 100)));
    var ids = {};
    team().forEach(function (e) { ids[e.emp_id] = 1; });
    var gaps = [], drifts = [], stall = null;
    try {
      (D().objectives || []).forEach(function (o) {
        if (!ids[o.owner_emp_id]) return;
        var latest = null;
        (D().checkins || []).forEach(function (c) {
          if (c.objective_id === o.objective_id && (!latest || c.checkin_date > latest)) latest = c.checkin_date;
        });
        var prog = Math.round(o.progress || 0);
        if (latest) {
          var gap = Math.round((DEMO_TODAY - new Date(latest)) / 86400000);
          if (gap >= GAP_WARN) gaps.push({ title: o.title, gap: gap, progress: prog });
        }
        var drift = elapsed - prog;
        if (drift >= DRIFT_MIN) drifts.push({ title: o.title, elapsed: elapsed, progress: prog, drift: drift });
        if (!stall && (o.progress || 0) < 30) stall = { title: o.title, progress: prog };
      });
    } catch (e) {}
    gaps.sort(function (a, b) { return b.gap - a.gap; });
    drifts.sort(function (a, b) { return b.drift - a.drift; });
    var pads = [
      { title: "실험 파이프라인 자동화", gap: 41, progress: 34 },
      { title: "리텐션 대시보드 구축", gap: 19, progress: 46 },
      { title: "온보딩 전환율 개선", gap: 15, progress: 51 }
    ];
    for (var i = 0; gaps.length < 3 && i < pads.length; i++) gaps.push(pads[i]);
    if (!drifts.length) drifts.push({ title: "리텐션 대시보드 구축", elapsed: elapsed, progress: 46, drift: Math.max(DRIFT_MIN, elapsed - 46) });
    if (!stall) stall = { title: "A/B 테스트 속도 2배", progress: 24 };
    return { gaps: gaps.slice(0, 3), drifts: drifts.slice(0, 2), stall: stall, elapsed: elapsed, gapWarn: GAP_WARN, gapBad: GAP_BAD };
  }
  RENDER.qw7 = function (host) {
    host = host || el.canvas;
    var T = timerFor(host);
    var tm = team().slice(0, 6);
    var fallback = ["김서연", "박도윤", "이준호", "최민아", "정하람", "서지우"];
    var rows = [
      { n: 0, goal: "온보딩 전환율 개선", kr: "KR2 · 활성화율 +8%p", res: "▲ 중복 A — 2번 목표와 90% 유사", cls: "dup" },
      { n: 1, goal: "신규 유저 온보딩 개선", kr: "KR2 · 활성화율 +8%p", res: "▲ 중복 A — 병합 대상", cls: "dup" },
      { n: 2, goal: "리텐션 대시보드 구축", kr: "KR3 · 4주 잔존 62%", res: "✓ 정렬됨", cls: "ok" },
      { n: 3, goal: "실험 파이프라인 자동화", kr: "연결 없음", res: "▲ 미연계 — 어느 팀 KR에도 안 걸림", cls: "miss" },
      { n: 4, goal: "A/B 테스트 속도 2배", kr: "KR1 · 실험 velocity", res: "▲ 중복 B — 76% 유사 (관점 상이)", cls: "dupb" },
      { n: 5, goal: "업계 Top 수준 달성", kr: "KR 미지정", res: "▲ 측정 불가 표현 — 평가 시점에 달성 근거를 다툴 위험", cls: "dupb" }
    ];
    var ops = qw7OpsRows();
    /* 문장 품질 행을 EZLint 규칙 엔진(tx_upgrade.js)으로 실제 검사 — 걸리는 행에만 규칙 ID 칩 */
    var lintHits = rows.map(function (r) {
      try { return (window.EZLint && EZLint.lint) ? EZLint.lint(r.goal, "goal") : []; }
      catch (e2) { return []; }
    });
    function lintChips(i) {
      return lintHits[i].map(function (hh) {
        return ' <span class="agh-flag" title="' + esc(hh.tip || "") + '">' + esc(hh.id) + (hh.word ? " · 「" + esc(hh.word) + "」" : "") + "</span>";
      }).join("");
    }
    function qualBtns(r, nm) {
      return '<button class="agh-btn sm" data-qw7-act="수정 제안 · ' + esc(nm) + '">수정 제안</button> ' +
        (r.cls === "dup" ? '<button class="agh-btn sm" data-qw7-act="병합 제안 · ' + esc(nm) + '">병합 제안</button> ' : "") +
        '<button class="agh-btn sm" data-qw7-act="elizax 정제 · ' + esc(nm) + '">elizax로 정제</button>';
    }
    function opsBtns(title) {
      return ' <button class="agh-btn sm" data-qw7-act="체크인 리마인드 · ' + esc(title) + '">체크인 리마인드</button> <button class="agh-btn sm" data-qw7-act="1:1 제안 · ' + esc(title) + '">1:1 제안</button>';
    }
    var opsCount = ops.gaps.length + ops.drifts.length + 1;
    host.innerHTML = screenHead("qw7") +
      '<p style="font-size:12px;color:#667085;margin:2px 0 10px">수립 품질은 목표수립 마감 전 게이트에서, 운영 신호는 주간 점검에서 각각 전달됩니다 — 이 화면은 두 채널의 통합 조망입니다.</p>' +
      '<div class="agh-scanline" data-agh-scan>팀 목표 8건 스캔 중 <i class="agh-spin"></i></div>' +
      '<div class="agh-brief" style="margin-top:12px"><span class="ic">✎</span><div><b>① 문장 품질 — 잘 쓴 목표인가</b><br>' +
      "목표 <b>문장 자체</b>의 결함(중복·미연계·측정 불가)입니다. 담당자에게 문장을 고치거나 병합하자고 제안할 일이지, 실행을 독촉할 일이 아닙니다.</div></div>" +
      '<table class="agh-table" data-agh-tbl style="opacity:.35"><thead><tr><th>담당자 · 개인목표</th><th>상위 KR 연계</th><th>점검 결과</th><th>행 처방</th></tr></thead><tbody>' +
      rows.map(function (r, i) {
        var nm = (tm[i] && tm[i].name) || fallback[i];
        return '<tr class="' + r.cls + '" data-ri="' + i + '"><td><span class="agh-tag">수립 품질</span><b>' + esc(nm) + "</b> · " + esc(r.goal) + "</td><td>" + esc(r.kr) + '</td><td class="res" data-res>스캔 대기…</td><td style="white-space:nowrap">' + qualBtns(r, r.goal) + "</td></tr>";
      }).join("") + "</tbody></table>" +
      '<div class="agh-linkrow"><button class="agh-btn" data-qw7-act="수정 제안 일괄 발송">수정 제안 일괄 발송</button> <button class="agh-btn" data-qw7-act="병합 제안 일괄">병합 제안 일괄</button></div>' +
      '<div class="agh-brief" style="margin-top:16px"><span class="ic">⏱</span><div><b>② 운영 신호 — 잘 굴러가는 목표인가</b><br>' +
      "문장은 멀쩡해도 <b>실행이 멈춘</b> 목표입니다. 문장 수정이 아니라 체크인 리마인드나 1:1로 풀어야 하는, 완전히 다른 처방입니다. " +
      "임계 — 체크인 공백 " + ops.gapWarn + "일 주의 · " + ops.gapBad + "일 경고 · 드리프트(기간 경과율−진행률) 20%p 이상.</div></div>" +
      '<div class="agh-rows" data-agh-ops style="opacity:.35">' +
      ops.gaps.map(function (g) {
        return '<div class="agh-prow ' + (g.gap >= ops.gapBad ? "bad" : "warn") + '"><span class="agh-tag">운영 신호</span>「' + esc(g.title) + "」 — 체크인 <b>" + g.gap + "일</b> 없음 · 진행률 " + g.progress + "%" + opsBtns(g.title) + "</div>";
      }).join("") +
      ops.drifts.map(function (dr) {
        return '<div class="agh-prow ' + (dr.drift >= 35 ? "bad" : "warn") + '"><span class="agh-tag">운영 신호</span>진척 드리프트 · 「' + esc(dr.title) + "」 — 기간 경과 " + dr.elapsed + "% 대비 진행률 " + dr.progress + "% (<b>−" + dr.drift + "%p</b>)" + opsBtns(dr.title) + "</div>";
      }).join("") +
      '<div class="agh-prow warn"><span class="agh-tag">운영 신호</span>진척 정체 · 「' + esc(ops.stall.title) + "」 — 진행률 <b>" + ops.stall.progress + "%</b> (30% 미만)" + opsBtns(ops.stall.title) + "</div></div>" +
      '<div class="agh-linkrow"><button class="agh-btn" data-qw7-act="체크인 리마인드 일괄 발송">체크인 리마인드 일괄 발송</button> <button class="agh-btn" data-qw7-act="1:1 제안 일괄">1:1 제안 일괄</button></div>' +
      '<div class="agh-verdict" data-agh-verdict style="display:none"></div>' +
      gateHTML("qw7", ["병합·연결 승인", "수정", "보류"]);
    ctxPanelIf(host, [
      { tag: "두 개의 질문", title: "문장 품질 ≠ 운영 신호", body: "'목표 문장이 모호하다'와 '체크인이 두 달째 없다'는 다른 문제입니다. 앞은 <b>수정·병합 제안</b>으로, 뒤는 <b>리마인드·1:1</b>로 — 처방이 달라 섹션을 나눠 제시합니다." },
      { tag: "확인 내역", title: "talenx 목표 트리·체크인 대조", body: "김서연·박도윤 목표 문구·지표(KR2) <b>90% 일치</b> — 사실상 같은 일 " + srcChip("talenx", "목표 대조") + " 체크인 공백은 목표별 최근 체크인 기록으로 계산했습니다 " + srcChip("talenx", "체크인 기록") }
    ], "");
    T(function () {
      var tbl = host.querySelector("[data-agh-tbl]"); tbl.style.opacity = "1";
      host.querySelector("[data-agh-scan]").innerHTML = "팀 목표 8건 스캔 — <b>문장 품질 3건 · 운영 신호 " + opsCount + "건</b> · 0.9s · " + srcChip("talenx", "목표 트리·체크인 대조") + ' <span class="agh-flag">▲ 중복 2쌍</span><span class="agh-flag">▲ 미연계 1건</span><span class="agh-flag">▲ 체크인 공백 최장 ' + ops.gaps[0].gap + "일</span>";
      Array.prototype.forEach.call(tbl.querySelectorAll("[data-res]"), function (c, i) {
        T(function () { c.innerHTML = esc(rows[i].res) + lintChips(i); }, 150 * i);
      });
    }, 1300);
    T(function () {
      var opsEl = host.querySelector("[data-agh-ops]");
      if (opsEl) opsEl.style.opacity = "1";
    }, 1900);
    T(function () {
      var v = host.querySelector("[data-agh-verdict]");
      v.style.display = "";
      v.innerHTML = "<b>문장 품질</b> — 중복 A 두 건은 <b>1건 병합</b>(담당: 공동), 미연계 목표는 <b>KR1(실험 velocity) 연결</b>, '업계 Top 수준'은 측정 지표로 바꾸는 <b>수정 제안</b>을 권합니다. " +
        "<b>운영 신호</b> — 체크인이 " + ops.gaps[0].gap + "일 끊긴 「" + esc(ops.gaps[0].title) + "」 등 " + ops.gaps.length + "건은 <b>체크인 리마인드</b>를, 기간 경과 대비 <b>−" + ops.drifts[0].drift + "%p</b> 뒤처진 「" + esc(ops.drifts[0].title) + "」와 진행률 30% 미만 「" + esc(ops.stall.title) + "」는 <b>1:1</b>을 권합니다. " +
        "병합·수정 제안·리마인드 발송은 모두 승인 게이트로만 실행됩니다." + '<span class="agh-auditchip">⛨ 감사 기록됨</span>';
    }, 2600);
  };

  /* ---------- QW1 · 주간 체크인 팝업 ---------- */
  RENDER.qw1 = function (host) {
    host = host || el.canvas;
    var T = timerFor(host);
    /* 운영 신호 채널 연결 — QW7과 같은 계산(qw7OpsRows)을 주간 점검에서도 재사용 */
    var ops = qw7OpsRows();
    var opsRows =
      '<div class="agh-prow ' + (ops.gaps[0].gap >= ops.gapBad ? "bad" : "warn") + '"><span class="agh-tag">운영 신호</span>「' + esc(ops.gaps[0].title) + "」 — 체크인 <b>" + ops.gaps[0].gap + "일</b> 없음 · 진행률 " + ops.gaps[0].progress + "%</div>" +
      '<div class="agh-prow warn"><span class="agh-tag">운영 신호</span>진척 드리프트 · 「' + esc(ops.drifts[0].title) + "」 — 기간 경과 " + ops.drifts[0].elapsed + "% 대비 진행률 " + ops.drifts[0].progress + "% (<b>−" + ops.drifts[0].drift + "%p</b>)</div>";
    host.innerHTML = screenHead("qw1") +
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
      '<div class="agh-prow warn">대상 · 한유진 — 1:1 16일 미실시</div>' + opsRows + "</div>" +
      '<div class="agh-draftmsg" data-agh-msg style="display:none"><div class="lab">● 선제 초안 — 리더가 정민서 님에게 보낼 메시지</div>' +
      "<p>민서 님, 이번 주 <b>KR2(신규 온보딩 자동화)</b> 진척이 지연 구간에 들어왔어요. 잔여 3주 기준 계획 대비 약 <b>-24%p</b>입니다. " +
      "막힌 지점이 있는지 <b>10분 1:1</b>로 같이 정리해볼까요? 화·수 오후 중 편한 시간 알려주세요.</p>" +
      '<small>talenx 진척·1:1 이력과 ERP 달성률 근거 · 톤은 질책이 아닌 지원 프레임 · <b>발송 전 리더 승인 필요</b></small></div>' +
      gateHTML("qw1", ["승인·발송", "수정", "보류"]);
    ctxPanelIf(host, [
      { tag: "자동 처리 배지", title: "집계는 바로, 발송은 게이트", body: "데이터 스캔·요약은 에이전트가 상시 자동 처리하지만, 사람에게 닿는 메시지는 <b>승인 필요</b> — 승인 없이는 발송되지 않습니다." },
      { tag: "선제 감지", title: "이번 주 감지 계기", body: "월요일 06:00 정기 스캔에서 지연 신호 포착 → 리더에게 선제 팝업으로 먼저 말 걸었습니다. " + srcChip("rule", "매주 정기 스캔") }
    ], "");
    var outs = ["7일 무변동 3명", "진척 지연 1명", "14일+ 미실시 2명"];
    Array.prototype.forEach.call(host.querySelectorAll("[data-sr]"), function (r, i) {
      T(function () {
        r.classList.add("done");
        r.querySelector("[data-out]").textContent = "→ " + outs[i];
      }, 500 + i * 550);
    });
    T(function () { host.querySelector("[data-agh-sum]").style.opacity = "1"; host.querySelector("[data-agh-rows]").style.display = ""; }, 2300);
    T(function () { host.querySelector("[data-agh-msg]").style.display = ""; ctxAppendIf(host, '<div class="agh-live ok">초안 생성됨 — 발송 초안을 바로 편집할 수 있게 준비했습니다. 리더 승인 대기.</div>'); }, 3100);
  };

  /* ---------- QW4 · 상시 근거 수집 ---------- */
  RENDER.qw4 = function (host) {
    host = host || el.canvas;
    var T = timerFor(host);
    var items = [
      ["2025 · 11", "달성", "KR2 신규계약 유지율 112% 달성 (목표 105%)", "erp", "ERP · 실적 리포트"],
      ["2025 · 09", "프로젝트", "'온보딩 개편' 리드 완료, 활성화율 +9%p", "talenx", "Jira · 완료 이슈"],
      ["2025 · 07", "1:1", "'발표 자신감 부족' 개선 합의 → 4회 이행 확인", "talenx", "1:1 노트 · talenx"],
      ["2025 · 04", "피드백", "동료 3인 '협업 리드십 탁월' 수시 피드백 수신", "rule", "동료피드백 · 3건"]
    ];
    host.innerHTML = screenHead("qw4") +
      '<div class="agh-brief"><span class="ic">🗂</span><div><b>기억을 소환하지 않습니다. 1년치 근거가 이미 모여 있습니다.</b> 달성·프로젝트·피드백·1:1 기록이 발생 시점에 자동으로 기록됩니다(제안만 모드).</div></div>' +
      '<div class="agh-tl" data-agh-tl>' +
      items.map(function (it, i) {
        return '<div class="agh-tli" data-ti="' + i + '" style="opacity:0"><span class="dt">' + esc(it[0]) + '</span><span class="agh-tag">' + esc(it[1]) + "</span><div class=\"bd\">" + esc(it[2]) + "</div>" + srcChip(it[3], it[4]) + "</div>";
      }).join("") + '<div class="agh-tlmore">↑ 이전 8개월 · 총 24건 기록됨</div></div>' +
      '<div class="agh-sidecard"><div class="lab">수집 요약</div><b class="big">24건</b>' +
      '<div class="mini">목표·달성 8 · 프로젝트 6 · 수시 피드백 7 · 1:1 기록 3</div>' +
      '<button class="agh-btn primary wide" data-agh-nav="qw3">이 근거로 등급 초안 만들기 →</button>' +
      "<small>초안 등급 제안 · 최종 결정은 평가자 게이트로</small></div>";
    ctxPanelIf(host, [
      { tag: "기록 보관", title: "과정이 기록으로 남는다", body: "카드마다 원천(citation)이 붙어 '등급 초안 만들기'까지 역추적됩니다. 평가 시즌이 열리면 이 24건이 등급 초안의 재료가 됩니다." }
    ], "");
    Array.prototype.forEach.call(host.querySelectorAll("[data-ti]"), function (n, i) {
      T(function () { n.style.transition = "opacity .4s"; n.style.opacity = "1"; }, 300 + i * 350);
    });
  };

  /* ---------- QW6 · 피드백 문장 정제 ---------- */
  RENDER.qw6 = function (host) {
    host = host || el.canvas;
    var T = timerFor(host);
    host.innerHTML = screenHead("qw6") +
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
    ctxPanelIf(host, [
      { tag: "무엇을 왜 바꿨나", title: "구조·사실·톤", body: "<b>구조</b> 개선점 나열 → 인정→SBI→제안 순서 재배열<br><b>사실</b> '계속·여러 번' 대신 보드에서 확인된 <b>지연 3건</b>으로 특정<br><b>톤</b> 지시형 명령을 <b>제안형 질문</b>으로(따뜻 유지). 감정·의도는 그대로 — 문장의 주인은 매니저입니다." }
    ], "");
    T(function () {
      host.querySelector("[data-agh-refined]").innerHTML =
        "지난 스프린트 릴리스 노트는 팀에서 가장 참고가 많이 됐어요<b>(인정)</b>. 다만 공유 문서 3건이 마감 하루 뒤 올라와<b>(상황·행동)</b> 후속 리뷰가 밀렸습니다<b>(영향)</b>. 다음엔 마감 반나절 전 초안 공유부터 같이 잡아볼까요?";
      var rc = host.querySelector("[data-agh-refchips]");
      rc.style.display = ""; rc.innerHTML = '<span class="agh-flag ok">S·B·I 구조 채움</span>' + srcChip("talenx", "근거 · 스프린트 보드 3건");
      host.querySelector("[data-agh-safety]").style.display = "";
    }, 1400);
    host.addEventListener("click", function (e) {
      var t = e.target.closest("[data-tone]");
      if (!t) return;
      Array.prototype.forEach.call(host.querySelectorAll("[data-tone]"), function (b) { b.classList.toggle("on", b === t); });
      toast("톤 '" + t.getAttribute("data-tone") + "' 기준으로 재정제했습니다. 전달 방식만 바뀌고 의도는 유지됩니다.");
    });
  };

  /* ---------- QW3 · 평가 코멘트 근거초안 ---------- */
  RENDER.qw3 = function (host) {
    host = host || el.canvas;
    var T = timerFor(host);
    host.innerHTML = screenHead("qw3") +
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
    ctxPanelIf(host, [
      { tag: "승인 필요", title: "백지 부담 제거, 결정은 사람", body: "근거+등급 포착 → 서술 초안·문장별 출처 → 편집·승인. '작업 중' 패널이 어디까지 갔는지(62%) 상주시키고, 완료 카드에 근거를 남겨 승인·수정·보류 게이트로 확정합니다." }
    ], "");
    var wl = host.querySelectorAll("[data-wl]");
    var outs = ["목표3 달성률 125% 확인", "상위 32%", "규정 §4.2 대조 완료"];
    var pct = 0;
    var iv = setInterval(function () {
      pct = Math.min(100, pct + 7);
      var bar = host.querySelector("[data-agh-wbar]"), pt = host.querySelector("[data-agh-wpct]");
      if (bar) { bar.style.width = pct + "%"; pt.textContent = pct + "%"; }
      if (pct >= 100) clearInterval(iv);
    }, 180);
    if (host === el.canvas) state.timers.push(iv);
    Array.prototype.forEach.call(wl, function (w, i) {
      T(function () {
        w.querySelector(".ck").textContent = "✓"; w.classList.add("done");
        w.querySelector("[data-wlb]").textContent = outs[i];
      }, 700 + i * 800);
    });
    T(function () { host.querySelector("[data-agh-done]").style.display = ""; ctxAppendIf(host, '<div class="agh-live ok">초안 생성됨 — 문장 단위 출처가 붙은 편집 가능한 초안입니다. 승인·수정·보류로 확정.</div>'); }, 3400);
  };

  /* ---------- HOLD · 근거 부족 시 정지+질문 (확신 없으면 진행하지 않는다) ---------- */
  RENDER.hold = function (host) {
    host = host || el.canvas;
    var T = timerFor(host);
    host.innerHTML = screenHead("hold") +
      '<div class="agh-workpanel"><div class="lab">⏳ 작업 중 <span class="who">박지훈 · 등급 초안</span></div>' +
      '<div class="agh-worklines" data-agh-wl>' +
      [["KR1 체크인 기록 확인 중…", ""], ["KR2 실적 근거 탐색 중…", ""], ["KR3 실적 근거 탐색 중…", ""]].map(function (l, i) {
        return '<div class="wl" data-wl="' + i + '"><span class="ck">○</span><span>' + esc(l[0]) + ' <b data-wlb></b></span></div>';
      }).join("") + "</div></div>" +
      '<div class="agh-holdcard" data-agh-hold style="display:none">' +
      '<div class="hd">⛔ 근거가 부족해 판단을 멈췄습니다 <span class="tag">정지</span></div>' +
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
    ctxPanelIf(host, [
      { tag: "정지 원칙", title: "확신이 없으면 진행하지 않는다", kind: "warn", body: "근거 부족 시 로딩만 돌리지 않고 <b>정지 + 질문</b>. 추정으로 채워 넣은 판단은 감사도 재현도 불가능하므로, 부족분은 사용자에게 되묻습니다. 정지·재개도 감사 로그에 남습니다. " + srcChip("rule", "원칙 · 추정하지 않음") }
    ], "");
    var wl = host.querySelectorAll("[data-wl]");
    T(function () {
      wl[0].querySelector(".ck").textContent = "✓"; wl[0].classList.add("done");
      wl[0].querySelector("[data-wlb]").textContent = "체크인 2건 · 달성률 112%";
    }, 700);
    [1, 2].forEach(function (i) {
      T(function () {
        wl[i].querySelector(".ck").textContent = "✗"; wl[i].classList.add("hold");
        wl[i].querySelector("[data-wlb]").textContent = "기록 없음 · 판단 불가";
      }, 1400 + (i - 1) * 600);
    });
    T(function () {
      host.querySelector("[data-agh-hold]").style.display = "";
      logAudit("판단 정지", "박지훈 등급 초안 — KR2·KR3 근거 부족", "hold.no-evidence");
      ctxAppendIf(host, '<div class="agh-live warn">수행 중 정지 — 근거 2건 부족. 사용자 응답 대기.</div>');
    }, 2700);
    host.addEventListener("click", function (e) {
      var b = e.target.closest("[data-hold-opt]");
      if (!b) return;
      var opt = b.getAttribute("data-hold-opt");
      var label = opt === "talenx" ? "talenx 체크인 기록 연결" : opt === "erp" ? "ERP 실적 재조회" : "직접 입력";
      host.querySelector("[data-agh-hold]").style.display = "none";
      logAudit("판단 재개", "근거 보강 경로 · " + label, "hold.resume");
      [1, 2].forEach(function (i, j) {
        T(function () {
          wl[i].classList.remove("hold"); wl[i].classList.add("done");
          wl[i].querySelector(".ck").textContent = "✓";
          wl[i].querySelector("[data-wlb]").textContent = (i === 1 ? "달성률 96%" : "달성률 88%") + " · " + label;
        }, 500 + j * 700);
      });
      T(function () {
        host.querySelector("[data-agh-holdsum]").innerHTML =
          "<b>" + esc(label) + "</b> 경로로 KR2·KR3 근거를 보강해 판단을 재개했습니다. 정지→질문→재개 전 과정이 감사 로그에 남았습니다. " +
          srcChip("talenx", "체크인") + srcChip("erp", "ERP 실적");
        host.querySelector("[data-agh-done]").style.display = "";
        ctxAppendIf(host, '<div class="agh-live ok">초안 생성됨 — 보강 근거 기준 등급 초안입니다. 게이트에서 확정하세요.</div>');
      }, 2100);
    });
  };

  /* ---------- QW5 · 평가 편향 점검 ---------- */
  RENDER.qw5 = function (host) {
    host = host || el.canvas;
    var T = timerFor(host);
    host.innerHTML = screenHead("qw5") +
      '<div class="agh-scanline" data-agh-scan>본부 4곳 등급 분포·근거량 스캔 중 <i class="agh-spin"></i></div>' +
      '<div class="agh-biasgrid" data-agh-bias style="opacity:.3">' +
      [["개발본부", "관대화 의심", "A비율 41% (전사 28%) · 근거량 평균 이하", "warn"],
       ["컨설팅본부", "정상", "분포·근거량 균형", "ok"],
       ["마케팅본부", "중심화 의심", "B 집중 71% · 변별 근거 부족", "warn"],
       ["UX본부", "정상", "분포·근거량 균형", "ok"]].map(function (b) {
        return '<div class="agh-bias ' + b[3] + '"><b>' + esc(b[0]) + '</b><span class="tag">' + esc(b[1]) + "</span><p>" + esc(b[2]) + "</p></div>";
      }).join("") + "</div>" +
      '<div class="agh-verdict" data-agh-verdict style="display:none">개발본부는 실적 대비 등급 상승폭 설명력이 낮은 인원이 <b>3명</b>, 마케팅본부는 등급 변별 근거가 부족합니다. ' +
      "편향 <b>플래그+근거</b>만 제시하며, 등급 수정은 하지 않습니다 — 검토 승인 시 등급 조정 회의 안건으로 전달됩니다." +
      '<span class="agh-auditchip">⛨ 감사 기록됨</span></div>' +
      '<div class="agh-linkrow"><button class="agh-btn" data-agh-nav="calib">→ 등급 조정 심의 회의에서 검토</button></div>' +
      gateHTML("qw5", ["검토 승인", "수정", "보류"]);
    ctxPanelIf(host, [
      { tag: "정치 배제", title: "민감 이슈 처리 원칙", body: "관대화·편향은 <b>재검토 제안</b>만 하며 자동 수정하지 않습니다. 플래그의 모든 판단에는 분포·근거량 원천이 인용됩니다. " + srcChip("rule", "관대화·강제배분 감사") + srcChip("erp", "실적 대조") }
    ], "");
    T(function () {
      host.querySelector("[data-agh-bias]").style.opacity = "1";
      host.querySelector("[data-agh-scan]").innerHTML = "본부 4곳 스캔 완료 · " + srcChip("talenx", "등급 분포") + srcChip("erp", "실적 대비 상승폭") + ' <span class="agh-flag">▲ 편향 플래그 2본부</span>';
    }, 1500);
    T(function () { host.querySelector("[data-agh-verdict]").style.display = ""; }, 2400);
  };

  /* ---------- Calibration 라운드테이블 + 가정 슬라이더 ---------- */
  /* 난이도 보정 데모 — 합의 상수(계약): 원본 weighted_score는 불변, 화면 계산으로만 병기 */
  var DIFF_COEF = { S: 1.15, A: 1.0, B: 0.9 };
  function calibDiffData() {
    var d = D();
    var byObj = {};
    (d.objectives || []).forEach(function (o) { if (o.owner_emp_id) byObj[o.objective_id] = o.owner_emp_id; });
    var krByEmp = {};
    (d.keyResults || []).forEach(function (k) {
      var emp = byObj[k.objective_id];
      if (emp) (krByEmp[emp] = krByEmp[emp] || []).push(k);
    });
    var rows = [], dist = { S: 0, A: 0, B: 0 }, basisTot = 0, basisHas = 0, sNoBasis = 0;
    try {
      (d.evaluations || []).forEach(function (ev) {
        if (rows.length >= 5) return;
        var krs = krByEmp[ev.emp_id];
        if (!krs || !krs.length || typeof ev.weighted_score !== "number") return;
        var emp = (d.employees || []).filter(function (x) { return x.emp_id === ev.emp_id; })[0];
        var wsum = 0, csum = 0, mix = { S: 0, A: 0, B: 0 };
        krs.forEach(function (k) {
          var wgt = parseFloat(String(k.weight || "0")) || 0; /* "40%" → 40 */
          csum += wgt * (DIFF_COEF[k.difficulty] || 1);
          wsum += wgt;
          if (mix[k.difficulty] != null) { mix[k.difficulty]++; dist[k.difficulty]++; }
          basisTot++;
          var b = k.difficulty_basis;
          if (b && b.type) basisHas++;
          else if (k.difficulty === "S") sNoBasis++;
        });
        var coef = wsum ? csum / wsum : 1;
        rows.push({
          name: (emp && emp.name) || ev.emp_id, mix: mix,
          coef: Math.round(coef * 100) / 100,
          before: ev.weighted_score,
          after: Math.round(ev.weighted_score * coef * 10) / 10
        });
      });
    } catch (e) {}
    return { rows: rows, dist: dist, basisTot: basisTot, basisHas: basisHas, sNoBasis: sNoBasis };
  }
  function calibDiffHTML() {
    var dd = calibDiffData();
    if (!dd.rows.length) return "";
    var distTot = dd.dist.S + dd.dist.A + dd.dist.B || 1;
    function pctOf(n) { return Math.round(n / distTot * 100); }
    var basisRate = Math.round(dd.basisHas / (dd.basisTot || 1) * 100);
    return '<div class="agh-brief" style="margin-top:14px"><span class="ic">⚖</span><div><b>난이도 보정 — 보정 전 → 후 병기 (데모 계수)</b><br>' +
      "수립 시점에 기록된 KR 난이도(S/A/B)를 가중치 평균해 개인 보정계수를 만들고, 종합 점수에 곱해 봅니다. " +
      "계수는 <b>데모 계수</b>(S 1.15 · A 1.00 · B 0.90)이며 <b>원본 점수는 바꾸지 않습니다</b> — 화면 계산으로만 병기합니다. " +
      srcChip("talenx", "KR 난이도·가중치") + srcChip("erp", "평가 종합점수") + "</div></div>" +
      '<table class="agh-table" style="margin-top:8px"><thead><tr><th>평가 대상</th><th>KR 난이도 구성</th><th>보정계수</th><th>보정 전</th><th></th><th>보정 후</th></tr></thead><tbody>' +
      dd.rows.map(function (r) {
        var diffTxt = ["S", "A", "B"].filter(function (g) { return r.mix[g]; }).map(function (g) { return g + " " + r.mix[g]; }).join(" · ");
        var up = r.after > r.before;
        return "<tr><td><b>" + esc(r.name) + "</b></td><td>" + diffTxt + "</td><td>× " + r.coef.toFixed(2) + "</td><td>" + r.before + "</td><td>→</td><td><b>" + r.after + "</b> <small style=\"color:" + (up ? "#15803D" : "#B45309") + "\">" + (up ? "▲" : "▼") + "</small></td></tr>";
      }).join("") + "</tbody></table>" +
      '<div class="agh-rows" style="margin-top:8px">' +
      '<div class="agh-prow">난이도 분포 · S <b>' + pctOf(dd.dist.S) + "%</b> · A <b>" + pctOf(dd.dist.A) + "%</b> · B <b>" + pctOf(dd.dist.B) + "%</b> <small>(표시 대상 " + dd.rows.length + "명 · KR " + distTot + "건)</small></div>" +
      '<div class="agh-prow">난이도 근거 기록률 · <b>' + basisRate + "%</b> — 수립 시점에 남긴 난이도 근거 기준</div>" +
      '<div class="agh-prow ' + (dd.sNoBasis ? "bad" : "") + '">근거 없는 S 난이도 · <b>' + dd.sNoBasis + "건</b> — 근거 없는 S는 등급 조정 리스크입니다" + (dd.sNoBasis ? "" : " (현재 전 건 근거 확인됨)") + "</div></div>";
  }
  RENDER.calib = function (host) {
    host = host || el.canvas;
    var T = timerFor(host);
    host.innerHTML = screenHead("calib") +
      '<div class="agh-callayout"><div class="agh-round">' +
      '<div class="lab">Roundtable 에이전트 4종 <span class="live" data-agh-live>● LIVE 실시간 심의</span></div>' +
      '<div class="agh-rgraph"><div class="agh-orch" data-agh-orch>조정<br>진행자<small data-agh-orchst>조율 중</small></div>' +
      [["증거검증", "자기평가·실적 대조", "tl"], ["정치배제", "관대화·강제배분 감사", "tr"], ["편향필터", "난이도 편차 보정", "bl"], ["전략기여", "전사목표 연계 검증", "br"]].map(function (a, i) {
        return '<div class="agh-ragent ' + a[2] + '" data-ra="' + i + '"><b>' + esc(a[0]) + "</b><small>" + esc(a[1]) + "</small><span class=\"rel\" data-rel></span></div>";
      }).join("") + "</div>" +
      '<div class="agh-rlog" data-agh-rlog></div></div>' +
      '<div class="agh-calside"><div class="lab">등급 분포 · 조정 전 → 후</div><div data-agh-dist></div>' +
      '<div class="agh-whatif"><div class="lab">가정 · 강제배분 상한 <b data-agh-cap>30%</b></div>' +
      '<input type="range" min="20" max="40" step="5" value="30" data-agh-capslider>' +
      "<small>같은 계산 규칙에서 상한만 바꿔 즉시 재산출 · 계산 규칙 재적용</small></div>" +
      '<div class="agh-sumbox" data-agh-calsum style="display:none"><b>심의 결과 요약</b><ul><li>강제배분 상한 준수 → A 25%</li><li>이상치 3건 → 0건으로 해소</li></ul></div></div></div>' +
      calibDiffHTML() +
      gateHTML("calib", ["조정안 승인", "수정", "보류"]);
    ctxPanelIf(host, [
      { tag: "발의/보강/합의/충돌", title: "다자 심의 구조", body: "4개 관점 에이전트가 조정 논거를 교차 심의하고 진행자 에이전트가 합의로 수렴합니다. 충돌 논거도 기록에 남아 <b>사람이 단일 요약이 아닌 심의 과정</b>을 봅니다." },
      { tag: "인간 최종 승인", title: "조정안 확정은 사람", kind: "warn", body: "심의 결과는 제안일 뿐 — 조정안 확정 지점은 아래 게이트입니다." }
    ], "");
    renderDist(host, 30, false);
    var slider = host.querySelector("[data-agh-capslider]");
    slider.addEventListener("input", function () {
      var cap = +slider.value;
      host.querySelector("[data-agh-cap]").textContent = cap + "%";
      renderDist(host, cap, true);
      logAudit("가정 재계산", "강제배분 상한 " + cap + "%", "rule-exec.cal7");
    });
    var seq = [
      [0, "발의", "S 2명 하향 조정 발의 — 실적 대조 결과 설명력 부족"],
      [1, "충돌/반박", "정치배제: 일괄 하향 반대 (개발팀 난이도 타팀 대비 -0.4단계 고려)"],
      [2, "보강", "편향필터: 난이도 보정계수(아래 보정 전→후 데모 표) 반영 시 1명만 하향 타당"],
      [3, "합의", "전략기여: 전사 KR 직결 1명 유지 동의 — 합의 수렴"]
    ];
    seq.forEach(function (s, i) {
      T(function () {
        var ra = host.querySelector('[data-ra="' + s[0] + '"]');
        if (ra) { ra.classList.add("act"); ra.querySelector("[data-rel]").textContent = s[1]; }
        var lg = host.querySelector("[data-agh-rlog]");
        if (lg) lg.insertAdjacentHTML("beforeend", '<div class="rl"><b>' + esc(s[1]) + "</b> " + esc(s[2]) + "</div>");
      }, 800 + i * 900);
    });
    T(function () {
      var o = host.querySelector("[data-agh-orchst]"); if (o) o.textContent = "합의 수렴";
      var lv = host.querySelector("[data-agh-live]"); if (lv) { lv.textContent = "● 심의 수렴"; lv.classList.add("done"); }
      host.querySelector("[data-agh-calsum]").style.display = "";
      renderDist(host, +slider.value, true);
    }, 4500);
  };
  function renderDist(root, cap, after) {
    var host = root.querySelector("[data-agh-dist]");
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

  /* ---------- 리뷰 초안 co-writing ---------- */
  RENDER.review = function (host) {
    host = host || el.canvas;
    var T = timerFor(host);
    host.innerHTML = screenHead("review") +
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
    ctxPanelIf(host, [
      { tag: "문장 단위 통제권", title: "단계·문장 단위 승인", body: "AI가 ERP 실적·자기평가서를 근거로 초안을 실시간 생성하고 삽입 문장을 하이라이트로 표시 — 사용자는 문장 단위로 반영/무시합니다." },
      { tag: "민감 이슈", title: "인라인 도우미", body: "저성과·민감 문구는 에이전트가 동시에 감지해 문장 옆에서 대안을 제시하고 변경 근거를 기록합니다." }
    ], "");
    T(function () { host.querySelector("[data-agh-prop]").style.display = ""; ctxAppendIf(host, '<div class="agh-live">talenx, Slack, ERP 데이터를 인용해 \'핵심 성과\' 문단에 2문장을 제안했습니다.</div>'); }, 1300);
    host.addEventListener("click", function (e) {
      if (e.target.closest("[data-rev-apply]")) {
        var doc = host.querySelector("[data-agh-doc]");
        doc.insertAdjacentHTML("beforeend", '<p class="ins">분기 중 3개 유관부서(마케팅본부, 컨설팅본부, UX 디자인팀)와의 연동 과제를 무중단으로 완료해 대규모 업그레이드 배포 안정성을 높임.</p>');
        host.querySelector("[data-agh-prop]").style.display = "none";
        logAudit("문장 반영", "리뷰 · 핵심 성과 +2문장", "rev.ins.2");
        toast("문서에 반영 — 변경 근거가 기록되었습니다.", "ok");
      }
      if (e.target.closest("[data-rev-skip]")) {
        host.querySelector("[data-agh-prop]").style.display = "none";
        logAudit("제안 무시", "리뷰 · 핵심 성과 제안", "rev.skip");
        toast("제안을 무시했습니다. 원문이 유지됩니다.");
      }
      if (e.target.closest("[data-agh-revgo]")) {
        var p = host.querySelector("[data-agh-prop]");
        p.style.display = "";
        ctxAppendIf(host, '<div class="agh-live">자연어 지시 수신 — 문서를 재작성하고 근거를 다시 인용했습니다.</div>');
      }
    });
    /* 지시 입력창 Enter로도 실행 */
    var revin = host.querySelector("[data-agh-revin]");
    if (revin) revin.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { var go = host.querySelector("[data-agh-revgo]"); if (go) go.click(); }
    });
  };

  /* ---------- 산출물 (자산화) ---------- */
  RENDER.assets = function (host) {
    host = host || el.canvas;
    var rows = state.assets.length ? state.assets.map(function (a) {
      return '<div class="agh-tli"><span class="dt">' + esc(a.at) + '</span><span class="agh-tag">' + esc(a.kind) + '</span><div class="bd">' + esc(a.title) + '</div><button class="agh-btn sm" data-agh-nav="' + esc(a.screen) + '">다시 열기</button></div>';
    }).join("") : '<div class="agh-emptybox">아직 보관된 산출물이 없습니다. 과제 화면에서 결정 게이트를 통과하면 여기 보관됩니다 — 한 번 만든 근거와 결정이 사라지지 않고 남습니다.</div>';
    host.innerHTML = '<div class="agh-shead"><div><h2>산출물 · 기록 보관함</h2><span class="agh-exp">과정·판단·근거가 기록으로 남아 다음 사이클이 이어받습니다</span></div></div><div class="agh-tl">' + rows + "</div>";
    ctxPanelIf(host, [
      { tag: "기록 보관", title: "왜 남기나", body: "지속되는 평가 사이클을 위한 성과 히스토리 — 목표/피드백/평가 근거가 휘발되지 않고 다음 사이클이 이어받는 기록으로 남습니다." }
    ], "");
  };

  /* ---------- 감사 로그 ---------- */
  RENDER.audit = function (host) {
    host = host || el.canvas;
    var rows = state.audit.length ? state.audit.map(function (a) {
      return '<tr><td>' + esc(a.at) + "</td><td>" + esc(a.actor) + "</td><td>" + esc(a.act) + "</td><td>" + esc(a.target) + '</td><td class="ref">' + esc(a.ref) + "</td></tr>";
    }).join("") : '<tr><td colspan="5" class="agh-emptycell">기록된 행위가 없습니다. 모든 결정·재계산·문장 반영이 여기에 남습니다.</td></tr>';
    host.innerHTML = '<div class="agh-shead"><div><h2>감사 로그</h2><span class="agh-exp">모든 행위를 추적할 수 있는 기록 — 승인·정책·감사가 모든 요청에 함께 남습니다</span></div></div>' +
      '<table class="agh-table"><thead><tr><th>시각</th><th>행위자</th><th>행위</th><th>대상</th><th>참조</th></tr></thead><tbody>' + rows + "</tbody></table>";
    ctxPanelIf(host, [
      { tag: "환각 통제", title: "감사가 신뢰를 만든다", body: "결과가 아니라 <b>보여준 과정</b>이 신뢰를 만듭니다. 가정 재계산·게이트 결정·문장 반영까지 전부 기록됩니다." }
    ], "");
  };

  /* ============================================================
     명령어 입력창 — intentFor 라우팅 → 없으면 실제 /api/chat
     ============================================================ */
  function runCmd() {
    var input = el.root.querySelector("[data-agh-cmdin]");
    var q = (input.value || "").trim();
    if (!q) return;
    input.value = "";
    /* 의도 라우팅: 시나리오 키워드 매칭 → 해당 시뮬 실행 */
    var k = intentFor(q);
    if (!k) {
      if (/감사|로그/.test(q)) k = "audit";
      else if (/산출물|자산/.test(q)) k = "assets";
    }
    if (k && SCREENS[k]) {
      showScreen(k);
      ctxAppend('<div class="agh-live">지시 수신 · "' + esc(q) + '" → ' + esc(SCREENS[k].title) + " 실행</div>");
      logAudit("지시", q, "cmd");
      return;
    }
    /* 시나리오 키워드가 아니면 공유 대화 스레드로 라우팅 —
       FAB와 같은 세션에 기록되고, 오프라인이면 목업 영수증으로 응답 */
    logAudit("지시", q, "cmd");
    showScreen("chat");
    if (window.Elizax && Elizax.sendRaw) Elizax.sendRaw(q);
    else ctxAppend('<div class="agh-live ai">elizax 모듈이 아직 로드되지 않았습니다.</div>');
  }

  /* ============================================================
     선제 알림 (형태② — 에이전트가 먼저 말 건다)
     ============================================================ */
  var ALERTS = [
    { title: "가중치 합계 105%", body: "목표 가중치 합이 상한을 5%p 초과 — 조정안 준비됨", screen: "qw2" },
    { title: "체크인 지연 3명", body: "7일+ 무변동 3명 · 진척 지연 1명 — 초안 발송 대기", screen: "qw1" },
    { title: "등급 조정 D-3", body: "개발본부 관대화 의심 — 심의 안건 검토 필요", screen: "calib" }
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
      card.innerHTML = '<div class="hd"><span class="dot"></span>에이전트 알림 · 선제 감지</div>' +
        "<b>" + esc(a.title) + "</b><p>" + esc(a.body) + "</p>" +
        '<div class="acts"><button class="agh-btn primary" data-pgo>열어서 확인</button><button class="agh-btn" data-pdis>나중에</button></div><small>1일 뒤 다시 알림 · 승인하면 반영</small>';
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
    /* 블러 백드롭(패딩 영역) 클릭 시 닫기 */
    if (!el.root._ezBackdrop) {
      el.root._ezBackdrop = true;
      el.root.addEventListener("click", function (e) { if (e.target === el.root) closeHub(); });
    }
    el.root.classList.add("on");
    var rc = el.root.querySelector("[data-agh-role]");
    if (rc) rc.textContent = role().label + " 관점 · " + CU().name;
    /* AI 연결 상태 칩 — 실제 EZAI 모드 반영 */
    var ac = el.root.querySelector("[data-agh-alertcnt]");
    if (ac) ac.textContent = ALERTS.length;
    var ai = el.root.querySelector("[data-agh-ai]");
    if (ai && window.EZAI) {
      var rdy = EZAI.ready && EZAI.ready();
      var md = EZAI.mode ? EZAI.mode() : "offline";
      ai.textContent = rdy ? "● 연결됨" : md === "offline" ? "○ 오프라인 예시 응답" : "◐ AI 연결 전";
      ai.style.color = rdy ? "#15803D" : md === "offline" ? "" : "#B45309";
    }
    document.body.style.overflow = "hidden";
    showScreen(screen || defaultScreen());
  }
  function closeHub() {
    if (!state.open) return; /* 허브 미오픈 시 clearTimers로 도킹 카드를 건드리지 않음 */
    state.open = false;
    clearTimers();
    /* 대화 서피스를 FAB로 반납 — 대화는 그대로 이어짐 */
    if (window.Elizax && Elizax.detachSurface) Elizax.detachSurface();
    if (el.root) {
      /* FAB로 되돌아가는 morph-out */
      el.root.classList.remove("on");
      el.root.classList.add("closing");
      (function (r) { setTimeout(function () { r.classList.remove("closing"); }, 420); })(el.root);
    }
    document.body.style.overflow = "";
  }

  /* 진입점은 elizax 안에만 둔다: 패널 헤더 ⛶ 전체화면 + 랜딩 CTA. 별도 GNB 버튼 없음. */
  function init() {
    scheduleProactive();
    /* 디버그/스크린샷용 자동 오픈: index.html#ez=hub */
    var hubM = window.location.href.match(/[?#&]ez=hub(?::([a-z0-9]+))?/);
    if (hubM) setTimeout(function () { openHub(hubM[1] || undefined); }, 700);
    if (/[?#&]ez=panel/.test(window.location.href)) setTimeout(function () { if (window.Elizax) Elizax.open(); }, 700);
  }
  if (document.readyState === "complete") setTimeout(init, 400);
  else window.addEventListener("load", function () { setTimeout(init, 400); });

  window.TXAgent = {
    openHub: openHub,
    closeHub: closeHub,
    open: showScreen,
    openFull: openHub,
    closeFull: closeHub,
    SCENARIOS: SCENARIOS,
    runScenario: runScenario,
    intentFor: intentFor
  };
})();
