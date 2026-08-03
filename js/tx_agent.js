/* ============================================================
   tx_agent.js — 성과관리/평가 E2E AI Agent Hub
   W2(마스터 3분할 UI·노드 워크플로우·Calibration·리뷰 co-writing)
   + 채팅 임베드 시나리오(runScenario) · Quick-win 7과제 · 자율성 배지
   perf-agent-verifiable-ui 4원칙 준수: as-of · trace · audit · what-if.

   노출 형태 3종:
     ① 도킹 대화창  — elizax 패널이 TXAgent.runScenario(key, host)로
                      시나리오를 대화 안에 임베드 (host=.ezx-scnhost)
     ② 한 줄 권유   — 메인 앱 위 단일 알림 표면 (scheduleProactive → EZSignalCard.slot,
                      권유 렌더러·엔진 미로드 시에만 .agh-popup 폴백)
     ③ 전체화면 딥워크 — Agent Hub 오버레이 (openHub/openFull)

   Exposes window.TXAgent = {
     openHub, closeHub, open(screen), openFull, closeFull,
     SCENARIOS, runScenario(key, host), intentFor(text)
   }.

   ── window.EZCalc — 등급/점수 what-if 공개 계약 (순수 함수 · DOM 비접촉) ──
   EZCalc.simulate(params)
     · params 없거나 emp_id 없음 → 전사 분포 엔진 (기존 계약 불변)
         before / after = 등급 분포 {S,A,B,C,D}(%)  ·  gradeChange[]  ·  people[]  ·  basis{…}
     · params.emp_id 지정      → 위 결과에 개인 산출을 얹는다. 이때만 형상이 바뀐다:
         before / after            = { weighted_score, score, grade }   (개인)
         distribution_before/after = 등급 분포 (분포는 여기로 계속 제공 · gradeChange[]도 유지)
         person                    = simulatePerson() 전체 결과
         target                    = { emp_id, name, org, period }
         grade_changed             = boolean
         grade_change              = { from, to, changed, cut_used, next_grade, margin_to_next }
         applied_weight            = 달성 축 가중치(실측 적합 추정치, 0~1)
         assumptions               = 가정 요약 문장(데모 가정 표기 포함)
         basis.person_score_source / person_score_model / grade_cuts / grade_cut_source
       ※ 평가 기록이 없으면 person_error만 채우고 분포 형상을 그대로 둔다.
   EZCalc.person({emp_id, achievement_delta}) → 개인 산출만 (분포 계산 없음)
   EZCalc.gradeCuts()  → { cuts:[{grade,min}], source, from_data:false }  ← 등급컷은 항상 데모 가정
   EZCalc.scoreModel() → { ok, w_achievement, w_peer, w_exec, rmse, n }   ← evaluations 실측 적합
   EZCalc.calibDiff() / EZCalc.baseDistribution() — 난이도 보정 원자료 · 기준 분포
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

  /* ============================================================
     실데이터 조회 헬퍼 — 대본(상수) 제거용 공통 원천.
     원칙: 없는 값은 만들지 않는다. 조회가 비면 null/빈 배열을 돌려주고
           호출측이 "기록 없음"으로 정직하게 표기한다.
     ============================================================ */
  function empById(id) {
    if (!id) return null;
    return (D().employees || []).filter(function (e) { return e.emp_id === id; })[0] || null;
  }
  /* 직속 팀원 = employees.manager_id 실 링크 (조직 소속 team()과 다름 — 이름 상수 금지) */
  function directReports(id) {
    var mid = id || CU().emp_id;
    return (D().employees || []).filter(function (e) { return e.manager_id === mid; });
  }
  /* 기준 시점 Date — EZKit.clock 단일 원천 (DEMO_TODAY 하드코딩 폐기) */
  function asOfDate() {
    var s = "2026-07-16";
    try { if (window.EZKit && EZKit.clock && EZKit.clock.asOfDate) s = EZKit.clock.asOfDate(); } catch (e) {}
    var d = new Date(String(s));
    return isNaN(d.getTime()) ? new Date("2026-07-16") : d;
  }
  function dnum(s) { var d = new Date(String(s)); return isNaN(d.getTime()) ? null : d.getTime(); }
  function daysBetween(aMs, bMs) { return Math.round((aMs - bMs) / 86400000); }
  /* 목표 기간 창 — objectives[].period("FY2026-2Q")를 실제로 파싱. 못 읽으면 null(가정하지 않음) */
  function periodWindow(period) {
    var m = /FY(\d{4})[-\s]?([1-4])Q/i.exec(String(period || ""));
    if (!m) return null;
    var y = +m[1], q = +m[2];
    return { start: Date.UTC(y, (q - 1) * 3, 1), end: Date.UTC(y, q * 3, 0), label: "FY" + y + "-" + q + "Q" };
  }
  function krIndex() {
    var m = {};
    (D().keyResults || []).forEach(function (k) { m[k.kr_id] = k; });
    return m;
  }
  function objIndex() {
    var m = {};
    (D().objectives || []).forEach(function (o) { m[o.objective_id] = o; });
    return m;
  }
  /* 진척 신호 임계 — 화면에 기준을 함께 노출해야 하므로 단일 상수로 둔다 */
  var SIG = { GAP_WARN: 14, GAP_BAD: 30, DRIFT_MIN: 20 };
  /* 팀원 1인의 주간 신호 — checkins·keyResults 실집계.
     gap  = 마지막 체크인 이후 경과일 (기록 없으면 null)
     drift= 기간 경과율 − KR 진척률 (%p · 목표 period로 계산, 기간 미상이면 null)
     drop = 진척 하락(progress_delta < 0) 실제 기록 */
  function memberSignals(emp) {
    var d = D(), today = asOfDate().getTime();
    var cks = (d.checkins || []).filter(function (c) { return c.emp_id === emp.emp_id; })
      .sort(function (a, b) { return (a.checkin_date < b.checkin_date) ? 1 : -1; });
    var kmap = krIndex(), omap = objIndex(), krs = [], seen = {};
    cks.forEach(function (c) {
      var k = kmap[c.kr_id];
      if (!k || seen[k.kr_id]) return;
      seen[k.kr_id] = 1;
      var ob = omap[k.objective_id] || null;
      var w = periodWindow(ob && ob.period);
      var elapsed = w ? Math.max(0, Math.min(100, Math.round((today - w.start) / (w.end - w.start) * 100))) : null;
      var prog = Math.round(k.progress || 0);
      krs.push({
        kr_id: k.kr_id, name: k.name, progress: prog, weight: k.weight,
        elapsed: elapsed, drift: (elapsed == null ? null : elapsed - prog),
        period: (ob && ob.period) || null, objective: ob ? ob.title : null
      });
    });
    krs.sort(function (a, b) { return (b.drift == null ? -1 : b.drift) - (a.drift == null ? -1 : a.drift); });
    var last = cks[0] || null;
    return {
      emp: emp, name: emp.name || emp.emp_id, emp_id: emp.emp_id,
      checkins: cks, count: cks.length, last: last,
      gap: last ? daysBetween(today, dnum(last.checkin_date)) : null,
      krs: krs, worst: krs[0] || null,
      blockers: cks.filter(function (c) { return !!c.blocker; }),
      lows: cks.filter(function (c) { return c.confidence === "low"; }),
      drops: cks.filter(function (c) { return typeof c.progress_delta === "number" && c.progress_delta < 0; })
    };
  }
  /* 주간 체크인 실집계 — QW1의 단일 원천. 팀원이 없으면 team:[] 로 빈 상태를 알린다. */
  function qw1Facts() {
    var team = directReports();
    var sigs = team.map(memberSignals);
    var gapped = sigs.filter(function (s) { return s.gap == null || s.gap >= SIG.GAP_WARN; });
    var lag = sigs.filter(function (s) { return s.worst && s.worst.drift != null && s.worst.drift >= SIG.DRIFT_MIN; });
    var flagged = {};
    gapped.concat(lag).forEach(function (s) { flagged[s.emp_id] = 1; });
    var blockerCnt = 0, lowCnt = 0, dropCnt = 0;
    sigs.forEach(function (s) { blockerCnt += s.blockers.length; lowCnt += s.lows.length; dropCnt += s.drops.length; });
    /* 발송 초안 대상 = 드리프트 최대 → 동률이면 체크인 공백 최장 */
    var target = lag.concat(gapped).sort(function (a, b) {
      var da = (a.worst && a.worst.drift) || 0, db = (b.worst && b.worst.drift) || 0;
      if (db !== da) return db - da;
      return ((b.gap == null ? 9999 : b.gap) - (a.gap == null ? 9999 : a.gap));
    })[0] || null;
    return {
      team: sigs, gapped: gapped, lag: lag,
      clean: sigs.filter(function (s) { return !flagged[s.emp_id]; }),
      blockerCnt: blockerCnt, lowCnt: lowCnt, dropCnt: dropCnt,
      target: target, thresholds: SIG
    };
  }
  /* 대상자 단일 원천 — 인계 컨텍스트(openHub(screen,{empId}))가 있으면 그 직원,
     없으면 조직원은 본인 / 조직장·HR은 팀 첫 인원. 화면마다 이름을 하드코딩하지 않는다. */
  /* 명시 컨텍스트가 없으면 지금 열려 있는 평가관리 상세 패널의 대상자를 그대로 이어받는다
     (tx_fix_appr.js의 [data-txdr-panel][data-emp] — 읽기만 하고 수정하지 않음) */
  function inferEmpFromScreen() {
    try {
      var p = document.querySelector("[data-txdr-panel][data-emp]");
      var id = p && p.getAttribute("data-emp");
      return id || null;
    } catch (e) { return null; }
  }
  function targetEmp() {
    var id = (state.ctx && state.ctx.empId) || inferEmpFromScreen();
    if (id) {
      var e = (D().employees || []).filter(function (x) { return x.emp_id === id; })[0];
      if (e) return e;
    }
    if (role().key === "member") return CU();
    return team()[0] || CU();
  }
  function targetNote() {
    var src = state.ctx && state.ctx.source;
    if (src) return " · " + src + "에서 인계";
    return (!(state.ctx && state.ctx.empId) && inferEmpFromScreen()) ? " · 평가관리 화면에서 인계" : "";
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
  /* 기준 시점 단일 원천 — EZKit.clock(P6). 폴백은 킷 부재 시에만 */
  var AS_OF = "2026 상반기 · " + (window.EZKit ? window.EZKit.clock.asOf() : "2026-07-16 06:00") + " 기준";

  /* ---------------- state ---------------- */
  var state = {
    open: false,
    screen: null,
    ctx: null,          // 인계 컨텍스트 {empId, source} — openHub(screen, ctx)
    stack: [],          // 화면 히스토리 (뒤로 가기)
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

  /* 허브 기록을 성과 기록 원장(EZLedger)에도 발행 — 새로고침 복원의 단일 원천.
     EZLedger가 있으면 직접 add(실 id 회수), 아직 안 떴으면 ez:ctx 이벤트 폴백 */
  function ledgerPublish(detail) {
    try {
      if (window.EZLedger && EZLedger.add) {
        var e = EZLedger.add(detail);
        return e && e.id ? e.id : null;
      }
    } catch (e1) { /* 원장 오류 무시 */ }
    try { document.dispatchEvent(new CustomEvent("ez:ctx", { detail: detail })); } catch (e2) { /* 무시 */ }
    return null;
  }
  function logAudit(act, target, ref) {
    /* 참조 ID는 원장 실 id — 호출부가 이미 원장 id(ctx-)를 넘겼으면 재발행하지 않는다.
       GA-순번/해시 위조 폐지(EZKit.gaId 미사용): 원장 미가용이면 정직하게 "기록 전" 표시 */
    var gid = (ref && String(ref).indexOf("ctx-") === 0) ? ref
      : ledgerPublish({ type: "audit", source: "hub.audit", title: act + " — " + target, summary: "실행자 " + CU().name, weight: 1 });
    state.audit.unshift({ at: nowLabel(), actor: CU().name, act: act, target: target, ref: gid || ref || "기록 전" });
    var b = document.querySelector("[data-agh-auditcnt]");
    if (b) b.textContent = state.audit.length;
  }
  function addAsset(kind, title, screen) {
    var gid = ledgerPublish({ type: "asset", source: "hub.asset." + (screen || ""), title: title, summary: kind, weight: 1 });
    state.assets.unshift({ at: nowLabel(), kind: kind, title: title, screen: screen, gid: gid });
  }

  /* ---------------- 자율성 배지 ---------------- */
  function autonomyBadge(mode) {
    /* 자율성 3단 단일 규격(§4.2): ● 자동=success / ◐ 제안만=warning / ○ 승인 필요=trust */
    var map = { auto: ["●", "자동 처리", "집계·데이터 반영은 에이전트가 바로 실행"], suggest: ["◐", "제안만", "등급·문구는 근거와 함께 제안만"], human_approve: ["○", "승인 필요", "확정·전송은 사람 승인 게이트 필수"] };
    var m = map[mode] || map.suggest;
    return '<span class="agh-badge agh-b-' + mode + '" title="' + esc(m[2]) + '">' + m[0] + " " + m[1] + "</span>";
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
  /* 게이트 결정의 진실의 원천 = EZKit.gates(localStorage `ezk_gates_v1` · onChange 구독).
     state.decided는 세션 내 즉시 반영용 캐시일 뿐이라 읽기는 캐시→EZKit.gates 순. */
  function gateDec(key) {
    if (state.decided[key]) return state.decided[key];
    if (window.EZKit) {
      var k = window.EZKit.gates.get(key);
      if (k) return { act: k.decision, note: k.reason || "" };
    }
    return null;
  }
  function gateHTML(key, labels) {
    labels = labels || ["승인", "수정", "보류"];
    var dec = gateDec(key);
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
    if (window.EZKit) window.EZKit.gates.set(key, { decision: act, reason: note || "", by: CU().name, at: window.EZKit.clock.asOf() });
    var scr = SCREENS[key];
    /* 게이트 결정을 원장에 발행(hub.gate)하고, 감사 로그 참조도 같은 실 id로 통일 */
    var gid = ledgerPublish({
      type: "audit", source: "hub.gate",
      title: (scr ? scr.title : key) + " · " + act,
      summary: (note ? note + " · " : "") + "결정자 " + CU().name, weight: 2
    });
    logAudit(act, (scr ? scr.title : key), gid);
    addAsset("결정", (scr ? scr.title : key) + " · " + act + (note ? " — " + note : ""), key);
    /* TXRoles.recordGate 호출 유지 — 진실의 원천은 EZKit.gates지만, recordGate가
       역할별 게이트 키(txr_*)에 되쓰면서 평가관리 영수증을 재렌더하는 부수효과가 있다.
       (tx_roles.js는 이 작업의 소유 파일이 아니므로 호출만 유지하고 위임은 손대지 않음)
       gid = 원장 실 id — 영수증의 감사 참조도 위조 번호 대신 실 id로 찍힌다. */
    try { if (window.TXRoles && TXRoles.recordGate) TXRoles.recordGate(act, note || "", gid || null); } catch (eG) { /* 무시 */ }
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
    connmap: { title: "연결 지도 · 전략–목표–직무–역량–평가", nav: "연결 지도", mode: "suggest", group: "연결·계보" },
    /* procmap = 화면이 아니라 EZJourney(결정 흐름)로 가는 리다이렉트 별칭.
       허브 내비/홈 카드에는 노출하지 않고(showScreen에서 즉시 전환), 명령·팔레트 라우팅만 유지한다. */
    procmap: { title: "결정 흐름",                nav: "결정 흐름",           mode: null,            group: "연결·계보", redirect: "journey" },
    assets:  { title: "산출물 · 기록 보관함",       nav: "산출물",             mode: null,            group: "산출물·감사" },
    audit:   { title: "감사 로그",                nav: "감사 로그",           mode: null,            group: "산출물·감사" }
  };
  var NAV_ORDER = ["home", "chat", "qw2", "qw7", "qw1", "qw4", "qw6", "qw3", "hold", "qw5", "calib", "review", "connmap", "procmap", "assets", "audit"];

  /* ============================================================
     시나리오 메타 — 채팅 임베드/제안 칩의 단일 원장 (tx_elizax 소비)
       chip  : 자연어 제안 라벨   roles: 노출 대상 역할
       heavy : true=340px 도킹엔 넓어 요약 스텁+전체화면 버튼으로 임베드
     ============================================================ */
  var SCENARIOS = [
    { key: "qw1",    chip: "주간 체크인 브리핑 만들어줘",        desc: "직속 팀원(manager_id)의 체크인·KR 진척 기록을 스캔해 체크인 공백·진척 지연 인원을 실집계하고, 실 레코드 id를 근거로 붙인 메시지 초안까지 준비합니다.", roles: ["leader"],        heavy: false, mode: "auto" },
    { key: "qw2",    chip: "이번 분기 목표 초안 잡아줘",         desc: "작년 평가·피드백과 직무 R&R을 이어받아 목표 초안 3안을 만들고 상위목표 정렬을 검증합니다.",                   roles: ["member"],        heavy: false, mode: "suggest" },
    { key: "qw7",    chip: "팀 목표 정렬·중복 점검해줘",         desc: "팀 목표 전건을 문장 품질(중복·미연계·측정불가)과 운영 신호(체크인 공백·진척 정체) 두 축으로 점검합니다.",     roles: ["leader", "exec"], heavy: true,  mode: "suggest" },
    { key: "qw4",    chip: "내 성과 근거 타임라인 보여줘",       desc: "체크인·KR 달성·평가 이력·피드백·성과 기록 원장에 실제로 남은 기록만 남은 시점 순으로 모아 근거 타임라인을 만듭니다. 기록이 없으면 만들지 않습니다.",                        roles: ["member"],        heavy: true,  mode: "suggest" },
    { key: "qw6",    chip: "피드백 문장 다듬어줘",              desc: "SBI 구조로 피드백 문장을 정제합니다. 의도는 유지하고 전달 방식만 다듬습니다.",                              roles: ["leader"],        heavy: false, mode: "suggest" },
    { key: "qw3",    chip: "평가 코멘트 초안 써줘",             desc: "ERP 실적·직무군 분포·평가규정을 대조해 문장별 출처가 붙은 코멘트 초안을 만듭니다.",                          roles: ["leader"],        heavy: false, mode: "human_approve" },
    /* 칩에서 특정 이름을 빼고 대상자는 인계 컨텍스트(targetEmp)가 정한다 — 데이터에 없는 이름 고정 금지 */
    { key: "hold",   chip: "등급 초안 만들어줘",       desc: "근거가 부족하면 추정하지 않고 정지 후 질문합니다. 보강 경로를 고르면 재개됩니다.",                            roles: ["leader"],        heavy: false, mode: "suggest" },
    { key: "qw5",    chip: "평가 편향 점검해줘",                desc: "조직별 등급 분포·근거량을 전사 평균과 실제로 대조해 관대화·엄격화·중심화 의심을 모집단 N과 판정 기준을 밝힌 플래그로만 제시합니다.", roles: ["hr", "exec"],    heavy: true,  mode: "suggest" },
    { key: "calib",  chip: "등급 조정 심의 열어줘",       desc: "4개 관점 에이전트가 조정 논거를 교차 심의하고, 가정 슬라이더로 상한을 즉시 재산출합니다.",                 roles: ["hr"],            heavy: true,  mode: "human_approve" },
    { key: "review", chip: "리뷰 초안 같이 쓰자",               desc: "AI가 근거를 인용해 초안 문장을 제안하고, 사용자가 문장 단위로 반영·무시합니다.",                             roles: ["leader", "hr"],  heavy: true,  mode: "human_approve" },
    { key: "connmap", chip: "연결 지도 보여줘 (전략–목표–직무–역량)", desc: "사업전략·조직목표·개인목표·직무 R&R·스킬·역량·평가가 어떻게 이어지는지 한 장으로 보여주고, 데이터에 없는 연결은 AI가 근거로 잇습니다. 직무 연결률도 표시합니다.", roles: ["hr", "exec", "leader"], heavy: true, mode: "suggest" },
    { key: "procmap", chip: "이 등급이 나온 과정(결정 흐름) 보여줘", desc: "목표수립→중간점검→평가→피드백 각 단계의 결정과 근거를 시간순 계보로 묶고, 앞 근거가 다음 단계로 인용되는 흐름과 차년도 승계를 보여줍니다.", roles: ["leader", "hr", "member"], heavy: true, mode: null }
  ];
  function scenarioOf(key) {
    for (var i = 0; i < SCENARIOS.length; i++) if (SCENARIOS[i].key === key) return SCENARIOS[i];
    return null;
  }
  /* heavy 시나리오 스텁의 핵심 숫자 미리보기 — 전부 실집계 재산출값(상수 폐기).
     조회가 실패하면 빈 문자열이 되어 미리보기 줄이 사라진다 — 틀린 숫자를 남기지 않는다. */
  var STUB_NUMS = {};
  function stubNum(key) {
    try {
      if (key === "qw4") {
        var t4 = targetEmp(), it4 = qw4Items(t4);
        if (!it4.length) return esc(t4.name) + " 기록 0건 — 근거 없음";
        var tg = {};
        it4.forEach(function (x) { tg[x.tag] = (tg[x.tag] || 0) + 1; });
        return "근거 " + it4.length + "건 — " + Object.keys(tg).map(function (k) { return k + " " + tg[k]; }).join(" · ");
      }
      if (key === "calib") {
        var s = simulateCalib({});
        if (s.error) return "기준 분포 없음 — 평가 기록 필요";
        var mv = s.gradeChange.filter(function (g) { return g.delta_pp !== 0; });
        return (mv.length
          ? mv.map(function (g) { return g.grade + " " + g.before_pct + "%→" + g.after_pct + "%"; }).join(" · ")
          : "상한 " + s.cap_pct + "% 이내 — 조정 불필요") + " · 모집단 " + s.basis.population_n + "명";
      }
      if (key === "qw7") {
        var sc = qw7Scope();
        if (!sc.objectives.length) return "범위 내 목표 0건 — 점검 대상 없음";
        var iss = qw7QualityRows(sc).filter(function (r) { return r.issue; }).length;
        return "목표 " + sc.objectives.length + "건 · KR " + sc.krs.length + "건 스캔 · 문장 품질 지적 " + iss +
          "건 · 운영 신호 " + qw7OpsRows(sc).count + "건";
      }
      if (key === "qw5") {
        var st = orgBiasStats();
        if (!st) return "평가 기록 없음 — 편향 판정 불가";
        return "조직 " + st.units.length + "곳 스캔(모집단 " + BIAS.MIN_N + "명 이상) · 편향 플래그 " + st.flagged.length + "곳 · 전사 " + st.company.n + "명";
      }
      if (key === "review") {
        var rf = reviewFacts();
        if (!rf.sigs.length) return "리뷰 대상 0명";
        return "대상 " + rf.sigs.length + "명 · 근거 확보 " + rf.withEv.length + "/" + rf.sigs.length;
      }
      if (key === "connmap") {
        var emps = D().employees || [];
        var withP = emps.filter(function (e) { return e.jobProfileId; }).length;
        return "직무 프로파일 연결 " + withP + "/" + emps.length + " (" + (emps.length ? Math.round(withP / emps.length * 100) : 0) + "%)";
      }
    } catch (e) { /* 조회 실패 시 상수 폴백 */ }
    return STUB_NUMS[key] || "";
  }

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
        '<div class="num">' + esc(stubNum(key)) + "</div>" +
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
    /* 자기 카탈로그 칩 전수 라우팅 — hold 칩("등급 초안 만들어줘")이 null로 빠지던 문제 수정.
       '등급 조정 심의'(calib)와 겹치지 않도록 초안/작성 동사를 함께 요구한다 */
    if (/등급/.test(q) && /초안|만들|작성|산출/.test(q) && !/조정|심의|캘리/.test(q)) return "hold";
    if (/근거 ?부족|정지|멈춰|모르면/.test(q)) return "hold";
    if (/체크인|진척/.test(q)) return "qw1";
    if (/목표/.test(q) && /초안|추천|수립/.test(q)) return "qw2";
    if (/정합|정렬|중복/.test(q)) return "qw7";
    if (/근거|타임라인/.test(q)) return "qw4";
    if (/피드백/.test(q) && /정제|다듬/.test(q)) return "qw6";
    if (/평가/.test(q) && /코멘트|초안/.test(q)) return "qw3";
    if (/코멘트|근거초안/.test(q)) return "qw3";
    if (/편향|관대화/.test(q)) return "qw5";
    if (/캘리|calibration|심의|등급 ?조정/i.test(q)) return "calib";
    if (/리뷰|총평/.test(q)) return "review";
    if (/연결 ?지도|연결률|전략.*목표.*직무|직무.*연결/.test(q)) return "connmap";
    if (/계보|프로세스 ?맵|어떤 과정|왜 이 등급|결정 ?흐름/.test(q)) return "procmap";
    /* 공통 화면도 라우팅 대상 — runCmd에 흩어져 있던 규칙을 여기로 통합 */
    if (/감사|감사 ?로그|누가 ?결정/.test(q)) return "audit";
    if (/산출물|보관함|자산/.test(q)) return "assets";
    if (/오늘|브리핑|홈|처음 ?화면/.test(q)) return "home";
    return null;
  }

  /* 역할 필터 단일 원천 — 내비·홈 카드·명령 라우팅이 같은 판정을 쓴다.
     (홈이 NAV_ORDER 전체를 그려 내비와 목록이 어긋나던 문제의 근본 원인) */
  function allowedScreen(key) {
    var sc = scenarioOf(key);
    if (!sc) return true;                       /* home·chat·assets·audit 등 공통 화면 */
    return sc.roles.indexOf(role().key) >= 0;
  }
  function visibleKeys() {
    return NAV_ORDER.filter(function (k) {
      var s = SCREENS[k];
      return s && !s.redirect && allowedScreen(k);
    });
  }
  function navLabel(k) { return SCREENS[k].nav || SCREENS[k].title; }

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

    /* ① 글로벌바 — astryx on-dark 토큰 스코프 */
    var bar = h("div", "agh-gbar");
    bar.setAttribute("data-astryx-media", "dark");
    bar.innerHTML =
      '<div class="agh-gl"><span class="agh-logo">✦</span><b>elizax</b><span class="agh-brand-sub">워크스페이스</span>' +
      '<button class="agh-gitem" data-agh-back title="이전 화면으로 (Esc)" style="display:none">‹ 뒤로</button>' +
      '<span class="agh-rolechip" data-agh-role></span></div>' +
      '<div class="agh-gr">' +
      '<button class="agh-gitem" data-agh-alerts>🔔 알림 <b data-agh-alertcnt>0</b></button>' +
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
    bar.querySelector("[data-agh-back]").addEventListener("click", goBack);
    bar.querySelector("[data-agh-dock]").addEventListener("click", dockHandoff);
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
    /* Esc는 단계적으로 — 열린 모달 → 팔레트 → 화면 뒤로 → 허브 닫기.
       (한 번에 허브가 닫혀 작업이 사라지지 않게) */
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || !state.open) return;
      if (document.querySelector(".tx-back")) return;   /* 모달이 자기 핸들러로 먼저 닫힌다 */
      if (palEl) { closePalette(); return; }
      if (state.stack.length) { e.preventDefault(); goBack(); return; }
      closeHub();
    });

    renderNav();
  }

  function openGateNote(key, act) {
    if (!(window.TX && TX.modal)) { decideGate(key, act); return; }
    var isEdit = act.indexOf("수정") === 0 || act === "직접 수정";
    var mo = TX.modal({
      title: isEdit ? "수정 지시 입력" : "보류 사유 입력",
      body: '<p style="font-size:12.5px;color:var(--agh-ink-3,#667085);margin:0 0 8px">' +
        (isEdit ? "자연어로 수정을 지시하면 근거와 함께 재작성됩니다. 변경 근거는 감사 로그에 남습니다."
                : "보류 사유는 다음 심의에서 우선 재검토 큐로 들어갑니다.") + "</p>" +
        '<textarea data-note style="width:100%;min-height:80px;border:1px solid var(--agh-line-2,#D0D5DD);border-radius:8px;padding:9px;font:inherit;font-size:13px"></textarea>',
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
    var s = SCREENS[key] || {};
    return '<button class="agh-nitem' + (state.screen === key ? " on" : "") + '" data-agh-nav="' + esc(key) + '"' +
      ' title="' + esc(s.title || label) + '">' +
      esc(label) + (mode ? autonomyBadge(mode) : "") + "</button>";
  }
  /* 내비 = SCREENS[].group 섹션 구조 + 짧은 명사형 제목(자연어 칩 문장 폐기).
     group이 없는 home·chat은 '오늘' 섹션으로 묶는다. */
  function renderNav() {
    var html = '<div class="agh-newchat"><button class="agh-btn primary wide" data-agh-newchat>＋ 새 채팅</button></div>';
    var order = [], byGroup = {};
    visibleKeys().forEach(function (k) {
      var g = SCREENS[k].group || "오늘";
      if (!byGroup[g]) { byGroup[g] = []; order.push(g); }
      byGroup[g].push(k);
    });
    order.forEach(function (g) {
      html += '<div class="agh-ngroup">' + esc(g) + "</div>";
      byGroup[g].forEach(function (k) { html += navItem(k, navLabel(k), SCREENS[k].mode); });
    });
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
  function roleNames(sc) {
    var R = (window.TXRoles && TXRoles.ROLES) || {};
    return sc.roles.map(function (k) { return (R[k] && R[k].label) || k; }).join("/");
  }
  function showScreen(key, opts) {
    opts = opts || {};
    if (!SCREENS[key]) key = "home";
    /* ⑤ procmap 폐기 — 결정 흐름은 EZJourney 단일 화면으로 리다이렉트 (롤 가드보다 먼저) */
    if (SCREENS[key].redirect === "journey") { openJourney(); return; }
    /* 롤 가드 — 딥링크(openHub)로 상위 롤 전용 화면 우회 진입 차단. renderNav와 동일한 판정(allowedScreen) */
    if (!allowedScreen(key)) {
      toast("이 기능은 " + roleNames(scenarioOf(key)) + " 권한에서 열람할 수 있습니다.");
      key = defaultScreen();
    }
    clearTimers();
    /* 대화 스크린을 떠나면 렌더 서피스를 FAB로 반납 */
    if (state.screen === "chat" && key !== "chat" && window.Elizax && Elizax.detachSurface) Elizax.detachSurface();
    /* 화면 스택 — 뒤로 가기용. 되돌아가는 이동(push:false)은 쌓지 않는다 */
    if (opts.push !== false && state.screen && state.screen !== key) {
      state.stack.push(state.screen);
      if (state.stack.length > 20) state.stack.shift();
    }
    state.screen = key;
    renderNav();
    syncBack();
    var fn = RENDER[key] || RENDER.home;
    fn();
  }
  function syncBack() {
    if (!el.root) return;
    var b = el.root.querySelector("[data-agh-back]");
    if (b) b.style.display = state.stack.length ? "" : "none";
  }
  function goBack() {
    if (!state.stack.length) { closeHub(); return; }
    showScreen(state.stack.pop(), { push: false });
  }

  /* ============================================================
     각 화면 렌더러 + 라이브 시뮬레이션
     — 모든 렌더러는 host(컨테이너)를 받는다. 무인자 호출 시 허브 캔버스.
     ============================================================ */
  /* 실AI vs 데모 대본 명시 — EZKit.status 계열 배지(ezk-chip). 어떤 화면이 실호출인지 감춘 채
     "라이브"라고 말하지 않는다. */
  /* 화면별 산출 근거 등급 — 배지 문구가 실제와 어긋나지 않게 3단으로 나눈다.
       calc  : 수치·명단이 전부 talenx 기록 실집계 (AI 미연결이어도 "데모"가 아니다)
       mixed : 실데이터를 인용하되 서술 문장 일부는 예시 대본
       script: 아직 대본 화면 */
  var DATA_GRADE = {
    qw1: "calc", qw4: "calc", qw5: "calc", qw7: "calc", calib: "calc", connmap: "calc", review: "calc",
    qw2: "mixed", qw3: "mixed", qw6: "mixed",
    hold: "script"
  };
  function liveBadge(key) {
    var live = aiLive();
    var g = DATA_GRADE[key] || "script";
    var lab, tip;
    if (live) { lab = "실AI 응답"; tip = "elizax가 실제 데이터를 조회해 응답합니다"; }
    else if (g === "calc") { lab = "실데이터 집계"; tip = "AI 미연결 — 화면의 수치·명단은 talenx 기록 실집계입니다(대본 아님, 실AI 호출 없음)"; }
    else if (g === "mixed") { lab = "실데이터 인용 · 서술 예시"; tip = "AI 미연결 — 인용 근거는 실기록이지만 서술 문장 일부는 준비된 예시입니다"; }
    else { lab = "데모 시나리오"; tip = "AI 미연결 — 준비된 예시 흐름입니다(실호출 없음)"; }
    var mk = (window.EZKit && EZKit.marker) || "✦";
    return '<span class="ezk-chip ezk-status" data-mode="' + (live || g === "calc" ? "auto" : "suggest") +
      '" title="' + esc(tip) + '">' + mk + " " + lab + "</span>";
  }
  function screenHead(key) {
    var s = SCREENS[key];
    return '<div class="agh-shead"><div><h2>' + esc(s.title) + "</h2>" +
      (s.mode ? autonomyBadge(s.mode) : "") + liveBadge(key) +
      '<span class="agh-auditchip">⛨ 감사 기록됨</span></div>' +
      '<span class="agh-asof2">기준 시점 · ' + esc(AS_OF) + " ▾</span></div>";
  }

  var RENDER = {};

  /* ---------- 홈 브리핑 ---------- */
  RENDER.home = function (host) {
    host = host || el.canvas;
    var r = role();
    /* 홈 카드도 내비와 같은 역할 필터 — 권한 없는 카드를 눌러 토스트+리다이렉트되던 문제 해소 */
    var cards = visibleKeys().filter(function (k) { return SCREENS[k].mode; }).map(function (k) {
      var s = SCREENS[k];
      return '<button class="agh-qwcard" data-agh-nav="' + k + '">' + autonomyBadge(s.mode) +
        "<b>" + esc(s.title) + "</b><small>" + esc(s.group || "") + "</small></button>";
    }).join("");
    host.innerHTML =
      '<div class="agh-shead"><div><h2>오늘은 어떤 도움을 드릴까요?</h2>' +
      '<span class="agh-exp">역할 주체 <b>' + esc(r.label) + "</b> 기준으로 화면과 권한이 자동 구성됩니다</span></div></div>" +
      /* 알림 건수·내용은 신호 엔진(있으면) 또는 alertsNow() 실계산 결과 — 상수 폐기 */
      (function () {
        var sig = sigPending();
        var titles = sig ? sig.map(sigNotice) : alertsNow().map(function (a) { return a.title; });
        if (!titles.length) {
          return '<div class="agh-brief"><span class="ic">⚡</span><div><b>알림 0건</b> — 지금 처리할 알림이 없습니다. ' +
            "없는 알림을 만들지 않습니다.</div></div>";
        }
        return '<div class="agh-brief"><span class="ic">⚡</span><div><b>알림 ' + titles.length + "건</b> — " +
          titles.map(function (t) { return esc(t); }).join(" · ") + ". " +
          "호출 없이 먼저 포착했습니다. 🔔 알림 또는 아래 과제 카드에서 확인하세요.</div></div>";
      })() +
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
      { tag: "연동", title: "하나의 대화, 두 개의 화면", body: "도킹 대화창과 전체화면이 <b>같은 세션</b>을 읽고 씁니다. 어디서 묻든 기록·근거·감사가 성과 기록 하나에 남습니다. " + srcChip("talenx", "공유 대화 저장소") },
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
    var cardCss = "flex:1;min-width:190px;background:var(--agh-card,#fff);border:1px solid var(--agh-line,#E4E7EC);border-radius:10px;padding:10px 12px;font-size:12.5px;line-height:1.55";
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
      { tag: "알림", title: "가중치 합계 105%", kind: "warn", body: "전체 목표 가중치 합이 100%보다 <b>5%p</b> 높습니다. 목표3 가중치 15%→10% 조정안을 준비했습니다. " + srcChip("rule", "가중치 합계 규칙") },
      { tag: "알림", title: "전사목표 미연결", kind: "warn", body: "목표 3이 전사 목표 '매출 3조 8,000억'과 연결되지 않았습니다. KR4 연결을 제안합니다. " + srcChip("talenx", "전사 목표체계 FY2026") }
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
      /* 근거 없는 "신뢰도 0.86" 폐기 — 실제로 인용한 근거 건수만 표기(산출 근거 있음) */
      var cited = [carry.prevEval, carry.fb, carry.taskArea, carry.grade].filter(function (x) { return !!x; }).length;
      v.innerHTML = '<span class="conf" title="초안 작성에 실제 인용된 기록 수">인용 근거 ' + cited + "건</span> " + esc(lastYear) + "와 피드백을 이어받아 백지가 아닌 <b>초안 3안</b>을 구성했습니다. " +
        fbAxis + "을 <b>KR2</b>로 반영했고, " + esc(jobBase) + "을 근거로 <b>KR1</b>을 구성했습니다." + pendNote + " " +
        "가중치 합 105%·목표3 미연결이 확인돼 <b>15%→10% 하향 또는 KR4 연결</b> 중 택일을 제안합니다. " +
        srcChip("rule", "원칙 · 전사 정렬") + srcChip("talenx", "맥락 · H1 조직개편") + '<span class="agh-auditchip">⛨ 감사 기록됨</span>';
      ctxAppendIf(host, '<div class="agh-live ok">승인 대기 — 아래 결정 게이트에서 승인/수정/보류를 선택하세요. 승인 전 talenx 반영 없음.</div>');
    }, 3800);
  }

  /* ---------- QW7 · 목표 정렬·중복 점검 — 문장 품질 vs 운영 신호 2분면 ---------- */
  /* 점검 범위 단일 원천 — 내 목표 + 내 조직(및 하위 조직) 목표 + 직속·동료 소유 목표.
     중복 대조군에는 같은 상위목표를 공유하는 형제 조직 목표까지 넣는다(크로스팀 중복 탐지). */
  function qw7Scope() {
    var d = D(), cu = CU();
    var orgSet = {};
    (function () {
      var kids = {};
      (d.orgs || []).forEach(function (o) { (kids[o.parent_id] = kids[o.parent_id] || []).push(o.org_id); });
      var q = [cu.org_id], seen = {};
      while (q.length) {
        var id = q.shift();
        if (!id || seen[id]) continue;
        seen[id] = 1; orgSet[id] = 1;
        (kids[id] || []).forEach(function (c) { q.push(c); });
      }
    })();
    var ids = {};
    ids[cu.emp_id] = 1;
    directReports().forEach(function (e) { ids[e.emp_id] = 1; });
    team().forEach(function (e) { ids[e.emp_id] = 1; });
    var objs = (d.objectives || []).filter(function (o) {
      return ids[o.owner_emp_id] || orgSet[o.org_id];
    });
    var inScope = {};
    objs.forEach(function (o) { inScope[o.objective_id] = 1; });
    var parents = {};
    objs.forEach(function (o) { if (o.parent_objective_id) parents[o.parent_objective_id] = 1; });
    var siblings = (d.objectives || []).filter(function (o) {
      return !inScope[o.objective_id] && o.parent_objective_id && parents[o.parent_objective_id];
    });
    function krsOf(list) {
      var set = {};
      list.forEach(function (o) { set[o.objective_id] = o; });
      return (d.keyResults || []).filter(function (k) { return set[k.objective_id]; });
    }
    return { objectives: objs, krs: krsOf(objs), siblings: siblings, siblingKrs: krsOf(siblings) };
  }
  /* 운영 신호 — 점검 범위 목표별 최근 체크인 공백·진척 드리프트를 실데이터에서 계산.
     기준 시점은 EZKit.clock(asOfDate), 기간 경과율은 objectives[].period 파싱값.
     신호가 없으면 없다고 말한다 — 폴백으로 가짜 목표명을 만들지 않는다. */
  function qw7OpsRows(scope) {
    scope = scope || qw7Scope();
    var today = asOfDate().getTime();
    var lastByObj = {};
    (D().checkins || []).forEach(function (c) {
      if (!lastByObj[c.objective_id] || c.checkin_date > lastByObj[c.objective_id].checkin_date) lastByObj[c.objective_id] = c;
    });
    var gaps = [], drifts = [], stalls = [], elapsedSeen = null;
    scope.objectives.forEach(function (o) {
      var prog = Math.round(o.progress || 0);
      var w = periodWindow(o.period);
      var elapsed = w ? Math.max(0, Math.min(100, Math.round((today - w.start) / (w.end - w.start) * 100))) : null;
      if (elapsed != null && elapsedSeen == null) elapsedSeen = elapsed;
      var last = lastByObj[o.objective_id];
      if (last) {
        var gap = daysBetween(today, dnum(last.checkin_date));
        if (gap >= SIG.GAP_WARN) gaps.push({ id: o.objective_id, title: o.title, gap: gap, progress: prog, ref: last });
      } else {
        gaps.push({ id: o.objective_id, title: o.title, gap: null, progress: prog, ref: null });
      }
      if (elapsed != null && elapsed - prog >= SIG.DRIFT_MIN) {
        drifts.push({ id: o.objective_id, title: o.title, elapsed: elapsed, progress: prog, drift: elapsed - prog, period: o.period });
      }
      if (prog < 30) stalls.push({ id: o.objective_id, title: o.title, progress: prog });
    });
    gaps.sort(function (a, b) { return (b.gap == null ? 99999 : b.gap) - (a.gap == null ? 99999 : a.gap); });
    drifts.sort(function (a, b) { return b.drift - a.drift; });
    stalls.sort(function (a, b) { return a.progress - b.progress; });
    return {
      gaps: gaps.slice(0, 3), drifts: drifts.slice(0, 2), stalls: stalls.slice(0, 1),
      gapTotal: gaps.length, driftTotal: drifts.length, stallTotal: stalls.length,
      elapsed: elapsedSeen, gapWarn: SIG.GAP_WARN, gapBad: SIG.GAP_BAD, driftMin: SIG.DRIFT_MIN,
      count: gaps.length + drifts.length + stalls.length
    };
  }
  /* KR 명칭 토큰 겹침 — "유사도 90%" 같은 근거 없는 퍼센트 대신 겹친 표현 수/겹침비율로만 말한다.
     겹침비율 = 공통 토큰 수 ÷ 짧은 쪽 토큰 수 (2글자 이상 토큰만 계산) */
  var DUP = { MIN_TOKENS: 2, MIN_RATIO: 0.6 };
  function krTokens(s) {
    var seen = {}, out = [];
    String(s == null ? "" : s).toLowerCase().replace(/[^0-9a-z가-힣%]+/g, " ").split(" ").forEach(function (t) {
      if (t.length >= 2 && !seen[t]) { seen[t] = 1; out.push(t); }
    });
    return out;
  }
  function krOverlap(a, b) {
    var ta = krTokens(a), tb = krTokens(b);
    if (!ta.length || !tb.length) return null;
    var set = {}; tb.forEach(function (t) { set[t] = 1; });
    var inter = ta.filter(function (t) { return set[t]; });
    if (inter.length < DUP.MIN_TOKENS) return null;
    var ratio = inter.length / Math.min(ta.length, tb.length);
    if (ratio < DUP.MIN_RATIO) return null;
    return { shared: inter, n: inter.length, denom: Math.min(ta.length, tb.length), ratio: ratio };
  }
  /* 문장 품질 행 — 실 KR 레코드에서만 만든다. 상수 6행 폐기. */
  function qw7QualityRows(scope) {
    var d = D(), rows = [];
    var omap = objIndex();
    var empMap = {};
    (d.employees || []).forEach(function (e) { empMap[e.emp_id] = e; });
    var pool = scope.krs.concat(scope.siblingKrs);
    var inScopeKr = {};
    scope.krs.forEach(function (k) { inScopeKr[k.kr_id] = 1; });
    var NUM = /[0-9]|%|억|만원|건|명|점|배|회/;
    scope.krs.forEach(function (k) {
      var ob = omap[k.objective_id] || {};
      var owner = empMap[ob.owner_emp_id] || {};
      var parent = ob.parent_objective_id ? omap[ob.parent_objective_id] : null;
      var lint = [];
      try { lint = (window.EZLint && EZLint.lint) ? EZLint.lint(k.name, "goal") : []; } catch (e) { lint = []; }
      var dup = null;
      for (var i = 0; i < pool.length && !dup; i++) {
        var o2 = pool[i];
        if (o2.kr_id === k.kr_id || o2.objective_id === k.objective_id) continue;
        var ov = krOverlap(k.name, o2.name);
        if (ov) {
          var ob2 = omap[o2.objective_id] || {};
          dup = { kr: o2, ov: ov, objective: ob2.title || o2.objective_id, cross: !inScopeKr[o2.kr_id] };
        }
      }
      var flags = [];
      if (dup) flags.push("dup");
      if (!parent) flags.push("noparent");
      if (!NUM.test(String(k.name) + " " + String(k.target_value || ""))) flags.push("nonum");
      if (!k.difficulty_basis || !k.difficulty_basis.type) flags.push("nobasis");
      if (lint.length) flags.push("lint");
      var res, cls;
      if (dup) {
        cls = dup.cross ? "dupb" : "dup";
        res = "▲ 중복 후보 — 「" + dup.kr.name + "」(" + dup.objective + ")와 겹친 표현 " + dup.ov.n +
          "개(" + dup.ov.shared.join("·") + ") · 겹침 " + dup.ov.n + "/" + dup.ov.denom;
      } else if (flags.indexOf("noparent") >= 0) {
        cls = "miss"; res = "▲ 미연계 — 상위목표 참조(parent_objective_id)가 비어 있음";
      } else if (flags.indexOf("nonum") >= 0) {
        cls = "dupb"; res = "▲ 측정 불가 — 명칭·목표값에 정량 표현이 없음";
      } else if (flags.indexOf("nobasis") >= 0) {
        cls = "dupb"; res = "▲ 난이도 근거 없음 — 난이도 " + (k.difficulty || "-") + " 판단 근거 미기록";
      } else if (lint.length) {
        cls = "dupb"; res = "▲ 문장 규칙 위반 — " + lint.map(function (h) { return h.tag; }).join(" · ");
      } else {
        cls = "ok"; res = "✓ 점검 통과 — 중복·미연계·측정 불가 신호 없음";
      }
      rows.push({
        kr: k, objective: ob, owner: owner.name || ob.owner_emp_id || "-",
        parentTitle: parent ? parent.title : null,
        lint: lint, dup: dup, cls: cls, res: res, issue: cls !== "ok"
      });
    });
    rows.sort(function (a, b) { return (b.issue ? 1 : 0) - (a.issue ? 1 : 0); });
    return rows;
  }
  RENDER.qw7 = function (host) {
    host = host || el.canvas;
    var T = timerFor(host);
    var scope = qw7Scope();
    var ops = qw7OpsRows(scope);
    var allRows = qw7QualityRows(scope);
    var MAX_ROWS = 8;
    var rows = allRows.slice(0, MAX_ROWS);
    var issueCnt = allRows.filter(function (r) { return r.issue; }).length;
    var dupCnt = allRows.filter(function (r) { return r.dup; }).length;
    var missCnt = allRows.filter(function (r) { return !r.parentTitle; }).length;

    if (!scope.objectives.length) {
      host.innerHTML = screenHead("qw7") +
        '<div class="agh-emptybox"><b>점검할 목표가 조회되지 않았습니다.</b><br>' +
        "범위 = 내 목표 + 내 조직·하위 조직 목표 + 직속·동료 소유 목표. 현재 <b>0건</b>이라 점검 대상이 없습니다 — 예시 목표를 만들지 않습니다.</div>";
      logAudit("판단 정지", "목표 정렬 점검 · 범위 내 목표 0건", "qw7.no-scope");
      return;
    }
    function lintChips(r) {
      return r.lint.map(function (hh) {
        return ' <span class="agh-flag" title="' + esc(hh.tip || "") + '">' + esc(hh.id) + (hh.word ? " · 「" + esc(hh.word) + "」" : "") + "</span>";
      }).join("");
    }
    function qualBtns(r) {
      var nm = r.kr.name;
      return '<button class="agh-btn sm" data-qw7-act="수정 제안 · ' + esc(nm) + '">수정 제안</button> ' +
        (r.dup ? '<button class="agh-btn sm" data-qw7-act="병합 제안 · ' + esc(nm) + '">병합 제안</button> ' : "") +
        '<button class="agh-btn sm" data-qw7-act="elizax 정제 · ' + esc(nm) + '">elizax로 정제</button>';
    }
    function opsBtns(title) {
      return ' <button class="agh-btn sm" data-qw7-act="체크인 리마인드 · ' + esc(title) + '">체크인 리마인드</button> <button class="agh-btn sm" data-qw7-act="1:1 제안 · ' + esc(title) + '">1:1 제안</button>';
    }
    var opsHTML =
      ops.gaps.map(function (g) {
        return '<div class="agh-prow ' + (g.gap == null || g.gap >= ops.gapBad ? "bad" : "warn") + '"><span class="agh-tag">운영 신호</span>「' + esc(g.title) + "」 — " +
          (g.gap == null ? "체크인 <b>기록 없음</b>" : "체크인 <b>" + g.gap + "일</b> 없음 (마지막 " + esc(g.ref.checkin_date) + ")") +
          " · 진행률 " + g.progress + "% " +
          (g.ref ? refChip("talenx", g.ref.checkin_id, g.ref.comment || "") : srcChip("talenx", g.id)) + opsBtns(g.title) + "</div>";
      }).join("") +
      ops.drifts.map(function (dr) {
        return '<div class="agh-prow ' + (dr.drift >= 35 ? "bad" : "warn") + '"><span class="agh-tag">운영 신호</span>진척 드리프트 · 「' + esc(dr.title) + "」 — " +
          esc(dr.period || "") + " 기간 경과 " + dr.elapsed + "% 대비 진행률 " + dr.progress + "% (<b>−" + dr.drift + "%p</b>) " +
          srcChip("talenx", dr.id) + opsBtns(dr.title) + "</div>";
      }).join("") +
      ops.stalls.map(function (s) {
        return '<div class="agh-prow warn"><span class="agh-tag">운영 신호</span>진척 정체 · 「' + esc(s.title) + "」 — 진행률 <b>" + s.progress + "%</b> (30% 미만) " +
          srcChip("talenx", s.id) + opsBtns(s.title) + "</div>";
      }).join("");
    if (!opsHTML) opsHTML = '<div class="agh-emptybox">운영 신호 없음 — 범위 내 목표 ' + scope.objectives.length + "건 모두 체크인 공백 " + ops.gapWarn + "일 미만·드리프트 " + ops.driftMin + "%p 미만·진행률 30% 이상입니다.</div>";

    host.innerHTML = screenHead("qw7") +
      '<p style="font-size:12px;color:var(--agh-ink-3,#667085);margin:2px 0 10px">수립 품질은 목표수립 마감 전 게이트에서, 운영 신호는 주간 점검에서 각각 전달됩니다 — 이 화면은 두 채널의 통합 조망입니다.</p>' +
      '<div class="agh-scanline" data-agh-scan>목표 ' + scope.objectives.length + "건 · KR " + scope.krs.length + "건 스캔 중 <i class=\"agh-spin\"></i></div>" +
      '<div class="agh-brief" style="margin-top:12px"><span class="ic">✎</span><div><b>① 문장 품질 — 잘 쓴 목표인가</b><br>' +
      "목표 <b>문장 자체</b>의 결함(중복·미연계·측정 불가·난이도 근거 누락)입니다. 담당자에게 문장을 고치거나 병합하자고 제안할 일이지, 실행을 독촉할 일이 아닙니다.<br>" +
      "<b>중복 산출식</b> — KR 명칭을 2글자 이상 토큰으로 쪼개 겹친 표현이 <b>" + DUP.MIN_TOKENS + "개 이상</b>이고 겹침비율(공통÷짧은 쪽)이 <b>" +
      Math.round(DUP.MIN_RATIO * 100) + "% 이상</b>일 때만 중복 후보로 봅니다. 근거 없는 '유사도 %'는 쓰지 않습니다. " +
      "대조군은 범위 내 KR " + scope.krs.length + "건 + 같은 상위목표를 공유하는 형제 조직 KR " + scope.siblingKrs.length + "건.</div></div>" +
      '<table class="agh-table" data-agh-tbl style="opacity:.35"><thead><tr><th>담당자 · 목표 · KR</th><th>상위 목표 연계</th><th>점검 결과</th><th>행 처방</th></tr></thead><tbody>' +
      rows.map(function (r, i) {
        return '<tr class="' + r.cls + '" data-ri="' + i + '"><td><span class="agh-tag">수립 품질</span><b>' + esc(r.owner) + "</b> · " +
          esc(r.objective.title || "") + "<br><small>" + esc(r.kr.kr_id) + " · " + esc(r.kr.name) + " (" + esc(r.kr.weight || "-") + " · 난이도 " + esc(r.kr.difficulty || "-") + ")</small></td><td>" +
          (r.parentTitle ? esc(r.parentTitle) : "<b>연결 없음</b>") + '</td><td class="res" data-res>스캔 대기…</td><td style="white-space:nowrap">' + qualBtns(r) + "</td></tr>";
      }).join("") + "</tbody></table>" +
      (allRows.length > MAX_ROWS ? '<p style="font-size:11.5px;color:var(--agh-ink-3,#667085);margin:6px 0 0">KR ' + allRows.length + "건 중 지적 우선 " + MAX_ROWS + "건만 표시 · 전체 지적 " + issueCnt + "건</p>" : "") +
      '<div class="agh-linkrow"><button class="agh-btn" data-qw7-act="수정 제안 일괄 발송">수정 제안 일괄 발송</button> <button class="agh-btn" data-qw7-act="병합 제안 일괄">병합 제안 일괄</button></div>' +
      '<div class="agh-brief" style="margin-top:16px"><span class="ic">⏱</span><div><b>② 운영 신호 — 잘 굴러가는 목표인가</b><br>' +
      "문장은 멀쩡해도 <b>실행이 멈춘</b> 목표입니다. 문장 수정이 아니라 체크인 리마인드나 1:1로 풀어야 하는, 완전히 다른 처방입니다. " +
      "임계 — 체크인 공백 " + ops.gapWarn + "일 주의 · " + ops.gapBad + "일 경고 · 드리프트(기간 경과율−진행률) " + ops.driftMin + "%p 이상. 기준 시점 " +
      esc(asOfDate().toISOString().slice(0, 10)) + " (EZKit.clock).</div></div>" +
      '<div class="agh-rows" data-agh-ops style="opacity:.35">' + opsHTML + "</div>" +
      '<div class="agh-linkrow"><button class="agh-btn" data-qw7-act="체크인 리마인드 일괄 발송">체크인 리마인드 일괄 발송</button> <button class="agh-btn" data-qw7-act="1:1 제안 일괄">1:1 제안 일괄</button></div>' +
      '<div class="agh-verdict" data-agh-verdict style="display:none"></div>' +
      gateHTML("qw7", ["병합·연결 승인", "수정", "보류"]);
    ctxPanelIf(host, [
      { tag: "두 개의 질문", title: "문장 품질 ≠ 운영 신호", body: "'목표 문장이 모호하다'와 '체크인이 두 달째 없다'는 다른 문제입니다. 앞은 <b>수정·병합 제안</b>으로, 뒤는 <b>리마인드·1:1</b>로 — 처방이 달라 섹션을 나눠 제시합니다." },
      { tag: "확인 내역", title: "무엇을 무엇과 대조했나", body: "범위 목표 <b>" + scope.objectives.length + "건</b> · KR <b>" + scope.krs.length + "건</b>, 중복 대조군에 형제 조직 KR <b>" + scope.siblingKrs.length + "건</b> 포함. " +
        "중복 " + dupCnt + "건 · 상위목표 미연계 " + missCnt + "건 · 지적 합계 " + issueCnt + "건. " + srcChip("talenx", "목표·KR 트리") + srcChip("talenx", "체크인 기록") }
    ], "");
    T(function () {
      var tbl = host.querySelector("[data-agh-tbl]"); tbl.style.opacity = "1";
      host.querySelector("[data-agh-scan]").innerHTML = "목표 " + scope.objectives.length + "건 · KR " + scope.krs.length +
        "건 스캔 — <b>문장 품질 지적 " + issueCnt + "건 · 운영 신호 " + ops.count + "건</b> · " +
        srcChip("talenx", "목표 트리·체크인 대조") +
        (dupCnt ? ' <span class="agh-flag">▲ 중복 후보 ' + dupCnt + "건</span>" : "") +
        (missCnt ? ' <span class="agh-flag">▲ 미연계 ' + missCnt + "건</span>" : "") +
        (ops.gaps.length ? ' <span class="agh-flag">▲ 체크인 공백 최장 ' + (ops.gaps[0].gap == null ? "기록 없음" : ops.gaps[0].gap + "일") + "</span>" : "");
      Array.prototype.forEach.call(tbl.querySelectorAll("[data-res]"), function (c, i) {
        T(function () { c.innerHTML = esc(rows[i].res) + lintChips(rows[i]); }, 150 * i);
      });
    }, 1300);
    T(function () {
      var opsEl = host.querySelector("[data-agh-ops]");
      if (opsEl) opsEl.style.opacity = "1";
    }, 1900);
    T(function () {
      var v = host.querySelector("[data-agh-verdict]");
      v.style.display = "";
      var q = issueCnt
        ? "<b>문장 품질</b> — 지적 <b>" + issueCnt + "건</b>(중복 후보 " + dupCnt + " · 미연계 " + missCnt + "). 중복 후보는 <b>병합 또는 지표 분리</b>, 미연계는 <b>상위목표 연결</b>, 측정 불가·난이도 근거 누락은 <b>수정 제안</b>을 권합니다. "
        : "<b>문장 품질</b> — KR " + scope.krs.length + "건에서 중복·미연계·측정 불가 신호가 없습니다. ";
      var o = ops.count
        ? "<b>운영 신호</b> — " +
          (ops.gaps.length ? "체크인이 " + (ops.gaps[0].gap == null ? "한 번도 없는" : ops.gaps[0].gap + "일 끊긴") + " 「" + esc(ops.gaps[0].title) + "」 등 " + ops.gapTotal + "건은 <b>체크인 리마인드</b>, " : "") +
          (ops.drifts.length ? "기간 경과 대비 <b>−" + ops.drifts[0].drift + "%p</b> 뒤처진 「" + esc(ops.drifts[0].title) + "」 등 " + ops.driftTotal + "건은 <b>1:1</b>을 권합니다. " : "") +
          (ops.stalls.length ? "진행률 30% 미만 「" + esc(ops.stalls[0].title) + "」 " + ops.stallTotal + "건도 1:1 대상입니다. " : "")
        : "<b>운영 신호</b> — 임계를 넘는 목표가 없습니다. ";
      v.innerHTML = q + o + "병합·수정 제안·리마인드 발송은 모두 승인 게이트로만 실행됩니다." + '<span class="agh-auditchip">⛨ 감사 기록됨</span>';
    }, 2600);
  };

  /* ---------- QW1 · 주간 체크인 팝업 ----------
     대본 전면 폐기 — 대상 팀원은 employees.manager_id 실 직속, 수치는 checkins·keyResults
     실집계, 근거는 실 레코드 id(checkin_id · kr_id). 신호가 없으면 "확인할 신호 없음"으로 멈춘다. */
  function qw1MsgDraft(t) {
    if (!t) return null;
    var w = t.worst, bl = t.blockers[0] || null, parts = [];
    if (w && w.drift != null && w.drift >= SIG.DRIFT_MIN) {
      parts.push("「" + esc(w.name) + "」 진척이 <b>" + w.progress + "%</b>인데 " +
        (w.period ? esc(w.period) + " " : "") + "기간은 <b>" + w.elapsed + "%</b> 지났습니다(<b>−" + w.drift + "%p</b>)");
    } else if (w) {
      parts.push("「" + esc(w.name) + "」 진척이 <b>" + w.progress + "%</b>로 기록돼 있습니다");
    }
    if (t.gap == null) parts.push("체크인 기록이 아직 한 건도 없습니다");
    else if (t.gap >= SIG.GAP_WARN) parts.push("마지막 체크인이 <b>" + t.gap + "일</b> 전(" + esc(t.last.checkin_date) + ")입니다");
    if (bl) parts.push("직전 체크인에 「" + esc(bl.blocker) + "」가 장애요인으로 남아 있습니다");
    if (!parts.length) return null;
    return parts;
  }
  RENDER.qw1 = function (host) {
    host = host || el.canvas;
    var T = timerFor(host);
    var f = qw1Facts();

    /* 팀원 0명 역할(직속 없음)에서 열리면 빈 상태 — 남의 팀 이름을 지어내지 않는다 */
    if (!f.team.length) {
      host.innerHTML = screenHead("qw1") +
        '<div class="agh-emptybox"><b>직속 팀원이 없어 주간 체크인을 만들 수 없습니다.</b><br>' +
        "이 화면은 <b>" + esc(CU().name) + "</b> 님을 <code>employees.manager_id</code>로 참조하는 구성원을 대상으로 집계합니다. " +
        "현재 조회된 직속 인원은 <b>0명</b>입니다 — 대상이 없으므로 대신할 이름을 가정하지 않습니다.</div>";
      ctxPanelIf(host, [
        { tag: "빈 상태", title: "왜 비어 있나", kind: "warn", body: "대상자는 조직 소속이 아니라 <b>실제 보고선(manager_id)</b>으로 정합니다. 보고선이 비어 있으면 집계 자체를 만들지 않습니다. " + srcChip("talenx", "employees.manager_id") }
      ], "");
      logAudit("판단 정지", "주간 체크인 · 직속 팀원 0명", "qw1.no-team");
      return;
    }

    var scans = [
      ["talenx", "체크인 기록 스캔 (직속 " + f.team.length + "명)",
        f.gapped.length ? "체크인 공백 " + f.gapped.length + "명" : "전원 " + SIG.GAP_WARN + "일 이내 기록"],
      ["talenx", "KR 진척 대비 기간 경과 대조",
        f.lag.length ? "진척 지연 " + f.lag.length + "명" : "드리프트 " + SIG.DRIFT_MIN + "%p 이상 없음"],
      ["rule", "장애요인·확신도·진척 하락 기록 확인",
        "장애요인 " + f.blockerCnt + "건 · 낮은 확신 " + f.lowCnt + "건 · 진척 하락 " + f.dropCnt + "건"]
    ];
    function rowFor(s) {
      var bits = [], cls = "warn";
      if (s.gap == null) { bits.push("체크인 기록 <b>없음</b>"); cls = "bad"; }
      else {
        bits.push("마지막 체크인 <b>" + s.gap + "일</b> 전 (" + esc(s.last.checkin_date) + ")");
        if (s.gap >= SIG.GAP_BAD) cls = "bad";
      }
      if (s.worst) {
        bits.push("「" + esc(s.worst.name) + "」 진척 " + s.worst.progress + "%" +
          (s.worst.drift != null ? " · 기간 경과 " + s.worst.elapsed + "% (−" + s.worst.drift + "%p)" : ""));
        if (s.worst.drift != null && s.worst.drift >= SIG.DRIFT_MIN) cls = "bad";
      } else bits.push("연결된 KR 기록 없음");
      if (s.blockers.length) bits.push("장애요인 " + s.blockers.length + "건");
      var ref = s.last
        ? refChip("talenx", s.last.checkin_id, (s.last.comment || "") + (s.last.blocker ? " · 장애요인: " + s.last.blocker : ""))
        : srcChip("talenx", "체크인 기록 없음");
      var krRef = s.worst ? refChip("erp", s.worst.kr_id, s.worst.objective || s.worst.name) : "";
      return '<div class="agh-prow ' + cls + '"><span class="agh-tag">' +
        (s.worst && s.worst.drift != null && s.worst.drift >= SIG.DRIFT_MIN ? "진척 지연" : "체크인 대상") +
        "</span><b>" + esc(s.name) + "</b> · " + bits.join(" · ") + " " + ref + krRef + "</div>";
    }
    var signaled = f.lag.concat(f.gapped.filter(function (s) { return f.lag.indexOf(s) < 0; }));
    var rowsHTML = signaled.length
      ? signaled.map(rowFor).join("")
      : '<div class="agh-emptybox">이번 주 확인할 신호 없음 — 직속 ' + f.team.length + "명 모두 체크인 공백 " + SIG.GAP_WARN +
        "일 미만이고 드리프트 " + SIG.DRIFT_MIN + "%p 미만입니다. 없는 신호를 만들지 않습니다.</div>";

    var t = f.target, draft = qw1MsgDraft(t);
    var msgHTML = draft
      ? '<div class="agh-draftmsg" data-agh-msg style="display:none"><div class="lab">● 선제 초안 — 리더가 ' + esc(t.name) + " 님에게 보낼 메시지</div>" +
        "<p>" + esc(t.name) + " 님, " + draft.join(". ") + ". 막힌 지점이 있는지 <b>10분 1:1</b>로 같이 정리해볼까요?</p>" +
        "<small>근거 — " +
        (t.last ? refChip("talenx", t.last.checkin_id, t.last.comment || "") : srcChip("talenx", "체크인 기록 없음")) +
        (t.worst ? refChip("erp", t.worst.kr_id, t.worst.name) : "") +
        " · 톤은 질책이 아닌 지원 프레임 · <b>발송 전 리더 승인 필요</b></small></div>"
      : '<div class="agh-draftmsg" data-agh-msg style="display:none"><div class="lab">● 초안 없음</div>' +
        "<p>보낼 만한 신호가 조회되지 않아 메시지를 만들지 않았습니다 — 근거 없는 독촉 문구를 지어내지 않습니다.</p></div>";

    host.innerHTML = screenHead("qw1") +
      '<div class="agh-scanline">직속 팀원 <b>' + f.team.length + "명</b> 대상 · 기준 " + esc(asOfDate().toISOString().slice(0, 10)) +
      " · 임계 체크인 공백 " + SIG.GAP_WARN + "일(경고 " + SIG.GAP_BAD + "일) · 드리프트 " + SIG.DRIFT_MIN + "%p " +
      srcChip("talenx", "employees.manager_id") + "</div>" +
      '<div class="agh-scan3" data-agh-s3>' +
      scans.map(function (r, i) {
        return '<div class="agh-scanrow" data-sr="' + i + '"><span class="agh-src agh-s-' + r[0] + '">' +
          (r[0] === "rule" ? "체크인" : "talenx") + '</span><span class="txt">' + esc(r[1]) + '</span><b class="out" data-out></b></div>';
      }).join("") + "</div>" +
      '<div class="agh-sumgrid" data-agh-sum style="opacity:.3">' +
      '<div class="agh-sumcard warn"><b>' + f.gapped.length + "</b><span>체크인 대상</span></div>" +
      '<div class="agh-sumcard bad"><b>' + f.lag.length + "</b><span>진척 지연</span></div>" +
      '<div class="agh-sumcard ok"><b>' + f.clean.length + "</b><span>신호 없음</span></div></div>" +
      '<div class="agh-rows" data-agh-rows style="display:none">' + rowsHTML + "</div>" +
      msgHTML +
      gateHTML("qw1", ["승인·발송", "수정", "보류"]);
    ctxPanelIf(host, [
      { tag: "자동 처리 배지", title: "집계는 바로, 발송은 게이트", body: "데이터 스캔·요약은 에이전트가 상시 자동 처리하지만, 사람에게 닿는 메시지는 <b>승인 필요</b> — 승인 없이는 발송되지 않습니다." },
      { tag: "산출식", title: "이 수치는 어떻게 나왔나", body:
        "대상 = <code>employees.manager_id</code> = " + esc(CU().name) + " 인 직속 <b>" + f.team.length + "명</b><br>" +
        "체크인 공백 = 기준 시점 − 마지막 <code>checkins.checkin_date</code><br>" +
        "드리프트 = 목표 <code>period</code> 경과율 − <code>keyResults.progress</code><br>" +
        "장애요인·확신도·진척 하락 = <code>checkins.blocker / confidence / progress_delta</code> 실카운트 " +
        srcChip("talenx", "체크인·KR 기록") }
    ], "");
    Array.prototype.forEach.call(host.querySelectorAll("[data-sr]"), function (r, i) {
      T(function () {
        r.classList.add("done");
        r.querySelector("[data-out]").textContent = "→ " + scans[i][2];
      }, 500 + i * 550);
    });
    T(function () { host.querySelector("[data-agh-sum]").style.opacity = "1"; host.querySelector("[data-agh-rows]").style.display = ""; }, 2300);
    T(function () {
      host.querySelector("[data-agh-msg]").style.display = "";
      ctxAppendIf(host, draft
        ? '<div class="agh-live ok">초안 생성됨 — ' + esc(t.name) + ' 님 대상. 근거는 실 체크인·KR 기록입니다. 리더 승인 대기.</div>'
        : '<div class="agh-live warn">발송 초안 없음 — 조회된 신호가 없어 문구를 만들지 않았습니다.</div>');
    }, 3100);
  };

  /* ---------- QW4 · 상시 근거 수집 ----------
     대상자의 실기록만 모은다: 체크인(checkins) · KR 달성(keyResults) · 평가 확정(evalHistory)
     · 수시/상향 피드백(feedbackHistory·upwardFeedback) · 성과 기록 원장(get_context_ledger).
     한 건도 없으면 예시를 만들지 않고 정지한다(qw1·qw5·qw7과 같은 규칙). */
  function z2(n) { return (n < 10 ? "0" : "") + n; }
  function qw4SortKey(s) {
    var t = String(s || "");
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
    if (m) return m[1] + m[2] + m[3];
    var fy = /^FY(\d{4})/.exec(t);
    if (fy) return fy[1] + "1231";
    var md = /^(\d{1,2})\/(\d{1,2})/.exec(t);
    if (md) {
      var y = (asOfDate() || new Date(2026, 6, 16)).getFullYear();
      return String(y) + z2(Number(md[1])) + z2(Number(md[2]));
    }
    return "00000000";
  }
  function qw4Items(emp) {
    var d = D(), id = emp && emp.emp_id, out = [];
    if (!id) return out;
    var ki = krIndex(), oi = objIndex();
    /* 1) 체크인 — 진척 기록·장애요인. 레코드 id를 근거 칩에 그대로 노출 */
    (d.checkins || []).filter(function (c) { return c.emp_id === id; }).forEach(function (c) {
      var kr = ki[c.kr_id], obj = oi[c.objective_id];
      var body = (kr ? "「" + kr.name + "」 " : "") + "진척 " + Math.round(c.progress_snapshot || 0) + "%" +
        (c.progress_delta != null ? " (" + (c.progress_delta > 0 ? "+" : "") + (Math.round(c.progress_delta * 10) / 10) + "%p)" : "") +
        (c.comment ? " — " + c.comment : "");
      out.push({
        date: c.checkin_date, tag: c.blocker ? "장애요인" : "체크인", body: body,
        kind: "erp", src: "체크인 " + (c.checkin_id || ""),
        sub: c.blocker ? "장애요인 · " + c.blocker : (obj ? obj.title : "")
      });
    });
    /* 2) KR 달성 — 진척 100% 또는 status가 완료인 것만 "달성"으로 부른다 */
    (d.keyResults || []).forEach(function (k) {
      var obj = oi[k.objective_id];
      if (!obj || obj.owner_emp_id !== id) return;
      var done = (k.progress != null && k.progress >= 100) || /완료|달성/.test(String(k.status || ""));
      if (!done) return;
      /* 달성 시점은 KR에 없으므로 목표 기간의 종료일로 둔다(파싱 실패 시 기간 표기 그대로) */
      var w = periodWindow(obj.period);
      var wEnd = w ? new Date(w.end).toISOString().slice(0, 10) : null;
      out.push({
        date: wEnd || obj.period || null,
        tag: "달성", body: "「" + k.name + "」 " + (k.current_value || "-") + " / 목표 " + (k.target_value || "-") +
          " · 가중 " + (k.weight || "-"), kind: "talenx", src: "KR " + (k.kr_id || ""), sub: obj.title
      });
    });
    /* 3) 평가 확정 이력 — evalHistory 실값만 */
    var eh = (d.evalHistory || []).filter(function (x) { return x.emp_id === id; })[0];
    ((eh && eh.history) || []).forEach(function (hr) {
      out.push({
        date: hr.period, tag: "평가", body: hr.period + " 확정 등급 " + hr.grade +
          (hr.score != null ? " · 종합 " + hr.score + "점" : ""),
        kind: "talenx", src: "평가 이력 " + hr.period, sub: ""
      });
    });
    /* 4) 수시 피드백 */
    (d.feedbackHistory || []).filter(function (f) { return f.emp_id === id; }).forEach(function (f) {
      var who = f.source_type === "leader" ? "조직장" : (f.source_type === "peer" ? "동료" : (f.source_type || "수시"));
      out.push({
        date: f.period, tag: "피드백", body: who + " 피드백 — " + f.summary,
        kind: "talenx", src: "피드백 " + (f.fb_id || ""), sub: ""
      });
    });
    /* 5) 상향 피드백 — 조직장 본인 것만 (응답자 수 실값).
          응답자가 익명 임계(EZPolicy.ANON_MIN) 미만이면 근거 카드에도 싣지 않는다 —
          소수 응답은 주제 목록만으로도 누가 썼는지 짐작되기 때문(tx_policy와 같은 규칙). */
    var UF_MIN = (window.EZPolicy && EZPolicy.ANON_MIN) || 3;
    (d.upwardFeedback || []).filter(function (u) {
      return u.leader_emp_id === id && (u.respondents || 0) >= UF_MIN;
    }).forEach(function (u) {
      out.push({
        date: u.period, tag: "상향", body: "상향 피드백 응답 " + (u.respondents || 0) + "명 · 주제 " +
          /* themes는 [{label,count}] 객체 배열 — 그대로 join하면 [object Object]가 찍힌다 */
          ((u.themes || []).slice(0, 3).map(function (t) { return t.label || t; }).join(" / ") || "-"),
        kind: "talenx", src: "상향 " + (u.uf_id || ""), sub: ""
      });
    });
    /* 6) 성과 기록 원장 — 결정·합의·근거가 남은 실 레코드 */
    try {
      var lg = (window.EZTools && EZTools.run) ? (EZTools.run("get_context_ledger", { emp_id: id, limit: 8 }) || {}) : {};
      (lg.items || []).forEach(function (it) {
        /* 체크인 원장 항목은 위 1)에서 checkins 원천으로 이미 잡았다 — 같은 사건을 두 줄로 세지 않는다 */
        var src = String((it && it.source) || "");
        if (src.indexOf("perf.checkin.") === 0) return;
        /* 허브 감사 로그는 근거가 아니라 행위 기록 — 감사 로그 화면에서 본다 */
        if (src === "hub.audit" || it.type === "audit") return;
        out.push({
          date: it.at || null, tag: "성과 기록", body: it.title + (it.summary ? " — " + it.summary : ""),
          kind: "rule", src: "원장 " + (it.id || ""), sub: ""
        });
      });
    } catch (e) { /* 원장 조회 실패는 항목 없음으로 취급 */ }
    /* 날짜 표기 3종 혼재(2026-04-25 / FY2025 / 7/14 10:00) — 파싱 가능한 것만 시각축에 정렬 */
    out.forEach(function (x) { x._k = qw4SortKey(x.date); });
    out.sort(function (a, b) { return a._k < b._k ? 1 : (a._k > b._k ? -1 : 0); });
    return out;
  }

  RENDER.qw4 = function (host) {
    host = host || el.canvas;
    var T = timerFor(host);
    var emp = targetEmp();
    var items = qw4Items(emp);
    if (!items.length) {
      host.innerHTML = screenHead("qw4") +
        '<div class="agh-emptybox"><b>' + esc(emp.name) + ' 님 이름으로 기록된 근거가 조회되지 않았습니다.</b><br>' +
        "이 화면은 체크인·KR 달성·평가 이력·피드백·성과 기록 원장의 <b>실기록</b>만 모읍니다. " +
        "현재 <b>0건</b>이라 예시 근거를 만들지 않습니다.</div>";
      ctxPanelIf(host, [
        { tag: "판단 정지", title: "왜 비어 있나", body: "근거 타임라인은 기록에서만 만듭니다. 체크인·피드백이 쌓이면 이 화면이 자동으로 채워집니다." }
      ], "");
      logAudit("판단 정지", "상시 근거 수집 · " + emp.name + " 기록 0건", "qw4.no-record");
      return;
    }
    var byTag = {};
    items.forEach(function (x) { byTag[x.tag] = (byTag[x.tag] || 0) + 1; });
    var tagLine = Object.keys(byTag).map(function (k) { return k + " " + byTag[k]; }).join(" · ");
    var shown = items.slice(0, 8), rest = items.length - shown.length;
    var span = (function () {
      var ks = items.map(function (x) { return x._k; }).filter(function (k) { return k !== "00000000"; });
      if (!ks.length) return "";
      var lo = ks[ks.length - 1], hi = ks[0];
      return lo.slice(0, 4) + "." + lo.slice(4, 6) + " ~ " + hi.slice(0, 4) + "." + hi.slice(4, 6);
    })();
    host.innerHTML = screenHead("qw4") +
      '<div class="agh-brief"><span class="ic">🗂</span><div><b>기억을 소환하지 않습니다. ' + esc(emp.name) +
      ' 님 기록 ' + items.length + '건이 이미 모여 있습니다.</b> 체크인·KR 달성·평가 이력·피드백·성과 기록 원장에 남은 시점 그대로 모았습니다' +
      (span ? " (" + esc(span) + ")" : "") + '. 없는 근거는 만들지 않습니다.</div></div>' +
      '<div class="agh-tl" data-agh-tl>' +
      shown.map(function (it, i) {
        return '<div class="agh-tli" data-ti="' + i + '" style="opacity:0"><span class="dt">' + esc(it.date || "시점 미상") +
          '</span><span class="agh-tag">' + esc(it.tag) + '</span><div class="bd">' + esc(it.body) +
          (it.sub ? '<br><small style="color:var(--agh-ink-3,#667085)">' + esc(it.sub) + "</small>" : "") + "</div>" +
          srcChip(it.kind, it.src) + "</div>";
      }).join("") +
      (rest > 0 ? '<div class="agh-tlmore">↑ 이전 기록 ' + rest + "건 더 있음 · 총 " + items.length + "건</div>" : "") +
      "</div>" +
      '<div class="agh-sidecard"><div class="lab">수집 요약</div><b class="big">' + items.length + '건</b>' +
      '<div class="mini">' + esc(tagLine) + "</div>" +
      '<button class="agh-btn primary wide" data-agh-nav="qw3">이 근거로 등급 초안 만들기 →</button>' +
      "<small>초안 등급 제안 · 최종 결정은 평가자 게이트로</small></div>";
    ctxPanelIf(host, [
      { tag: "기록 보관", title: "과정이 기록으로 남는다", body: "카드마다 원천 레코드 id가 붙어 '등급 초안 만들기'까지 역추적됩니다. 평가 시즌이 열리면 이 " + items.length + "건이 등급 초안의 재료가 됩니다." }
    ], "");
    Array.prototype.forEach.call(host.querySelectorAll("[data-ti]"), function (n, i) {
      T(function () { n.style.transition = "opacity var(--duration-medium, .4s)"; n.style.opacity = "1"; }, 300 + i * 350);
    });
  };

  /* ---------- QW6 · 피드백 문장 정제 ---------- */
  /* 실AI 패턴(tx_fix_msf.js 검증): 오프라인 대본을 먼저 그리고,
     AI 연결 시(EZAI.ready) 원문을 실제로 정제해 교체한다. 오프라인이면 대본 유지. */
  var QW6_SRC = "문서 정리가 계속 늦어요. 여러 번 얘기했는데 개선이 안 보이네요. 좀 더 신경 써 주세요.";
  function aiLive() { return !!(window.EZAI && EZAI.agent && EZAI.ready && EZAI.ready()); }

  /* 확인된 사실 — 상수 문장 폐기. EZTools 도구 조회(get_objectives·get_checkins·get_context_ledger)
     결과에서만 사실을 만든다. 아무것도 못 찾으면 ok:false → 화면은 정지 원칙대로 멈춘다. */
  function qw6Facts(emp) {
    var out = { ok: false, why: "", facts: [], best: null, low: null, blocker: null, target: emp || null };
    if (!(window.EZTools && EZTools.run)) { out.why = "도구 모듈(EZTools)이 로드되지 않았습니다"; return out; }
    var id = emp && emp.emp_id;
    var blocked = false;
    try {
      var ob = EZTools.run("get_objectives", { emp_id: id }) || {};
      if (ob.blocked) blocked = true;
      var objs = ob.objectives || [];
      objs.forEach(function (o) {
        var p = Math.round(o.progress || 0);
        if (!out.best || p > out.best.p) out.best = { t: o.title, p: p, period: o.period };
        if (!out.low || p < out.low.p) out.low = { t: o.title, p: p, period: o.period };
      });
      if (out.best) out.facts.push({ t: "「" + out.best.t + "」 진척 " + out.best.p + "%", kind: "talenx", lab: "목표·KR 기록" });
      if (out.low && out.best && out.low.t !== out.best.t) out.facts.push({ t: "「" + out.low.t + "」 진척 " + out.low.p + "%", kind: "talenx", lab: "목표·KR 기록" });

      var ck = EZTools.run("get_checkins", { emp_id: id, limit: 6 }) || {};
      if (ck.blocked) blocked = true;
      (ck.checkins || []).forEach(function (c) {
        if (!out.blocker && c.blocker) out.blocker = { d: c.date, b: c.blocker };
      });
      if (out.blocker) out.facts.push({ t: out.blocker.d + " 체크인 장애요인 「" + out.blocker.b + "」", kind: "erp", lab: "체크인 기록" });
      else if (ck.count) out.facts.push({ t: "최근 체크인 " + ck.count + "건 기록됨", kind: "erp", lab: "체크인 기록" });

      var lg = EZTools.run("get_context_ledger", { emp_id: id, limit: 3 }) || {};
      (lg.items || []).slice(0, 2).forEach(function (it) {
        if (it && it.title) out.facts.push({ t: "성과 기록 「" + it.title + "」", kind: "rule", lab: "성과 기록 원장" });
      });
    } catch (e) { out.why = "도구 조회 중 오류: " + (e && e.message ? e.message : e); return out; }
    if (!out.facts.length) {
      out.why = blocked
        ? "열람 규칙으로 이 대상자의 목표·체크인 기록에 접근할 수 없습니다"
        : "이 대상자의 목표·체크인·성과 기록이 조회되지 않았습니다";
      return out;
    }
    out.ok = true;
    return out;
  }
  /* 민감 케이스 안전장치 — "등급 하락"을 단정하지 않고 evalHistory 실기록으로 판정 */
  function gradeDropNote(emp) {
    var ORD = { S: 5, A: 4, B: 3, C: 2, D: 1 };
    try {
      var hs = ((D().evalHistory || []).filter(function (x) { return x.emp_id === emp.emp_id; })[0] || {}).history || [];
      if (hs.length >= 2) {
        var prev = hs[hs.length - 2], last = hs[hs.length - 1];
        if (ORD[last.grade] < ORD[prev.grade]) {
          return "<b>저성과 민감 케이스 안전장치</b> — 최근 등급 하락(" + esc(prev.grade) + "→" + esc(last.grade) + " · " +
            esc(last.period || "") + ") 기록이 확인됩니다. 단정·비교 표현을 걸러 사실·행동 중심으로만 정제했고, <b>전송 전 HR 1:1 가이드 확인</b>을 권합니다. " +
            srcChip("talenx", "등급 이력");
        }
      }
    } catch (e) {}
    return "<b>민감 표현 안전장치</b> — 등급 하락 기록은 확인되지 않았습니다. 그래도 단정·비교 표현은 걸러 사실·행동 중심으로 정제합니다. " +
      srcChip("talenx", "등급 이력");
  }
  function factChips(f) {
    return f.facts.slice(0, 4).map(function (x) { return srcChip(x.kind, x.lab); }).join("");
  }
  /* 조회된 사실만으로 SBI 정제문을 구성 — 데이터에 없는 문장은 만들지 않는다 */
  function qw6ScriptText(f) {
    var best = f.best, low = f.low, bl = f.blocker;
    var s = "";
    /* 인정 — 조회된 최고 진척 목표가 있을 때만 */
    if (best) s += "「" + esc(best.t) + "」는 진척 " + best.p + "%로 계획대로 밀고 있습니다<b>(인정)</b>. ";
    /* 상황·행동 — 조회된 사실(저진척 목표 / 체크인 장애요인)만 조합 */
    var sit = "";
    if (low && (!best || low.t !== best.t)) {
      sit = (best ? "다만 " : "") + "「" + esc(low.t) + "」는 진척 " + low.p + "%에 머물러 있고, " +
        (bl ? bl.d + " 체크인에 「" + esc(bl.b) + "」가 기록됐습니다" : "이후 진척 기록이 갱신되지 않았습니다");
    } else if (bl) {
      sit = (best ? "다만 " : "") + bl.d + " 체크인에 「" + esc(bl.b) + "」가 기록됐습니다";
    } else if (low) {
      sit = (best ? "다만 " : "") + "진척이 " + low.p + "%에 머물러 있습니다";
    }
    if (sit) s += sit + "<b>(상황·행동)</b>. ";
    s += "이대로면 " + esc((low && low.period) || (best && best.period) || "이번 주기") + " 마감 기준으로 후속 검토가 밀립니다<b>(영향)</b>. ";
    s += "막힌 지점부터 이번 주 1:1에서 같이 정리해볼까요?";
    return s;
  }

  function qw6Refine(host, tone, facts) {
    if (!aiLive()) return false;
    if (!facts || !facts.ok) return false;
    var p = host.querySelector("[data-agh-refined]");
    if (!p) return false;
    var old = p.querySelector("[data-agh-aiload]");
    if (old) old.remove();
    p.insertAdjacentHTML("beforeend",
      ' <em data-agh-aiload style="color:#98A2B3;font-style:normal"><i class="agh-spin"></i> elizax가 원문을 다시 정제하는 중…</em>');
    EZAI.agent({
      maxTurns: 2, maxTokens: 500,
      system: "당신은 elizax — 피드백 문장 정제 도우미입니다. 매니저의 피드백 원문을 SBI(상황→행동→영향) 구조로 정제합니다. " +
        "성과 인정을 먼저 넣고, 단정·비교 표현을 걸러 사실·행동 중심의 제안형 문장으로 끝냅니다. " +
        /* 확인된 사실은 상수가 아니라 도구 조회 결과 — 여기 없는 사실은 쓰지 않는다 */
        "확인된 사실(talenx 목표·체크인·성과 기록 조회 결과, 이 목록에 없는 사실은 절대 쓰지 마세요): " +
        facts.facts.map(function (x) { return x.t; }).join(" · ") + ". " +
        "요청된 톤을 반영하되 의도는 유지합니다. 정제문 한 단락만 출력 — 머리말·설명 금지. 도구 호출 불필요.",
      messages: [{ role: "user", content: "톤: " + (tone || "직설") + "\n원문: " + QW6_SRC }],
      onDone: function (text) {
        var em = p.querySelector("[data-agh-aiload]");
        if (em) em.remove();
        if (text && text.trim()) {
          p.setAttribute("data-ai-final", "1");
          p.innerHTML = esc(text.trim()).replace(/\n+/g, "<br>") +
            ' <em style="color:#98A2B3;font-style:normal">· elizax 실시간 정제</em>';
          logAudit("초안 생성됨", "피드백 정제 · 톤 " + (tone || "직설"), "qw6.ai");
        }
      },
      onError: function () { var em = p.querySelector("[data-agh-aiload]"); if (em) em.remove(); }
    });
    return true;
  }
  RENDER.qw6 = function (host) {
    host = host || el.canvas;
    var T = timerFor(host);
    var tgt = targetEmp();
    var facts = qw6Facts(tgt);
    host.innerHTML = screenHead("qw6") +
      '<div class="agh-scanline">대상 <b>' + esc(tgt.name || tgt.emp_id) + "</b>" + esc(targetNote()) +
      " · 확인된 사실 <b>" + facts.facts.length + "건</b> 조회 " + (facts.ok ? factChips(facts) : '<span class="agh-flag">근거 없음</span>') + "</div>" +
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
      '<div class="agh-safety" data-agh-safety style="display:none">' + gradeDropNote(tgt) + "</div>" +
      gateHTML("qw6", ["반영", "직접 수정", "무시(원문 유지)"]);
    ctxPanelIf(host, [
      { tag: "무엇을 왜 바꿨나", title: "구조·사실·톤", body: "<b>구조</b> 개선점 나열 → 인정→SBI→제안 순서 재배열<br><b>사실</b> '계속·여러 번' 대신 조회된 기록으로 특정 — " +
        (facts.ok ? facts.facts.map(function (x) { return esc(x.t); }).join(" · ") : "조회 실패 시 정제하지 않고 멈춥니다") +
        "<br><b>톤</b> 지시형 명령을 <b>제안형 질문</b>으로(따뜻 유지). 감정·의도는 그대로 — 문장의 주인은 매니저입니다." }
    ], "");
    T(function () {
      var p = host.querySelector("[data-agh-refined]");
      var rc = host.querySelector("[data-agh-refchips]");
      /* 근거를 못 찾으면 정지 원칙 — 문장을 지어내지 않는다 */
      if (!facts.ok) {
        if (p) p.innerHTML = "⛔ <b>근거를 찾지 못해 멈췄습니다.</b> " + esc(facts.why) +
          " — 정제문을 추정으로 만들지 않습니다. 목표·체크인 기록을 연결한 뒤 다시 실행하세요.";
        if (rc) { rc.style.display = ""; rc.innerHTML = '<span class="agh-flag">근거 0건 · 정지</span>'; }
        logAudit("판단 정지", "피드백 정제 · " + facts.why, "qw6.no-evidence");
        ctxAppendIf(host, '<div class="agh-live warn">근거 조회 실패 — 정제를 진행하지 않았습니다.</div>');
        return;
      }
      /* 실AI 결과가 이미 도착했으면 조회 기반 대본으로 덮지 않는다 */
      if (p && !p.getAttribute("data-ai-final")) p.innerHTML = qw6ScriptText(facts);
      if (rc) { rc.style.display = ""; rc.innerHTML = '<span class="agh-flag ok">S·B·I 구조 채움</span>' + factChips(facts); }
      host.querySelector("[data-agh-safety]").style.display = "";
      /* AI 연결 시 조회된 사실만으로 실제 정제 — 오프라인이면 no-op */
      if (p && !p.getAttribute("data-ai-final")) qw6Refine(host, "직설", facts);
    }, 1400);
    host.addEventListener("click", function (e) {
      var t = e.target.closest("[data-tone]");
      if (!t) return;
      Array.prototype.forEach.call(host.querySelectorAll("[data-tone]"), function (b) { b.classList.toggle("on", b === t); });
      var tone = t.getAttribute("data-tone");
      if (!facts.ok) { toast("근거를 찾지 못해 정제를 멈췄습니다 — 톤만 바꿀 수 없습니다."); return; }
      /* AI 연결 시 선택 톤으로 실제 재정제, 오프라인이면 조회 기반 대본 유지 */
      if (qw6Refine(host, tone, facts)) toast("톤 '" + tone + "' 기준으로 다시 정제하는 중 — 전달 방식만 바뀌고 의도는 유지됩니다.");
      else toast("AI 미연결 — 조회된 근거 기준 정제문을 그대로 둡니다. 톤 반영은 연결 후 가능합니다.");
    });
  };

  /* ---------- QW3 · 평가 코멘트 근거초안 ---------- */
  /* 실AI: 도구(get_objectives·get_checkins)로 실데이터를 조회한 뒤
     문장별 출처 마커 {{src:talenx|라벨}} 가 붙은 코멘트 초안을 생성해
     오프라인 대본의 서술 초안을 교체한다. 오프라인·오류 시 대본 유지. */
  function qw3Draft(host) {
    if (!aiLive() || !(window.EZTools && EZTools.schemas)) return;
    var tgt = targetEmp();   /* 인계 컨텍스트 우선 — 화면마다 이름을 하드코딩하지 않는다 */
    var wlBox = host.querySelector("[data-agh-wl]");
    if (wlBox) wlBox.insertAdjacentHTML("beforeend",
      '<div class="wl" data-agh-qw3live><span class="ck">◐</span><span>elizax 실AI — 실제 데이터 조회 중… <b data-agh-qw3tool></b></span></div>');
    function toolB() { return host.querySelector("[data-agh-qw3tool]"); }
    EZAI.agent({
      maxTurns: 6, maxTokens: 900,
      system: "당신은 elizax — 평가 코멘트 근거초안 작성자입니다. 반드시 도구(get_objectives, get_checkins, 필요 시 get_employee_profile)로 대상자의 실데이터를 먼저 조회하고, " +
        "조회 결과에 있는 수치·사실만 인용해 평가 코멘트 초안 2~4문장을 작성합니다. " +
        "각 문장 끝에 출처 마커를 하나 붙입니다 — 형식: {{src:talenx|근거 라벨}} 또는 {{src:erp|근거 라벨}} 또는 {{src:rule|평가규정 라벨}}. " +
        "근거가 조회되지 않으면 추정하지 말고 '기록이 없어 판단을 멈췄습니다'라고 씁니다(정지 원칙). " +
        "등급 확정 표현 금지 — 제안 어조 유지. 문장과 마커 외 머리말·설명 금지.",
      messages: [{ role: "user", content: "대상자: " + tgt.name + " (" + tgt.emp_id + ") · 평가 항목: 실행력. 목표·체크인 기록을 조회해 근거 인용 코멘트 초안을 작성해줘." }],
      onTool: function (name) {
        var b = toolB();
        if (b) b.textContent = (EZTools.labelOf ? EZTools.labelOf(name) : name) + "…";
      },
      onToolResult: function (name, r, summary) {
        var b = toolB();
        if (b) b.textContent = summary || "";
      },
      onDone: function (text) {
        var row = host.querySelector("[data-agh-qw3live]");
        if (text && text.trim()) {
          var html = esc(text.trim())
            .replace(/\{\{src:(talenx|erp|rule)\|([^}]{1,60})\}\}/g, function (m0, k, lab) { return srcChip(k, lab); })
            .replace(/\n+/g, "<br>");
          var sent = host.querySelector(".agh-sent");
          if (sent) sent.innerHTML = "서술 초안 — " + html + " — 문장별 출처 부착 · elizax 실시간 생성";
          if (row) { row.classList.add("done"); row.querySelector(".ck").textContent = "✓"; }
          logAudit("초안 생성됨", tgt.name + " 평가 코멘트 · 실데이터 근거", "qw3.ai");
          ctxAppendIf(host, '<div class="agh-live ok">elizax가 실제 목표·체크인 기록을 조회해 코멘트 초안을 다시 썼습니다. 확정은 결정 게이트에서.</div>');
        } else if (row) row.remove();
      },
      onError: function () {
        var row = host.querySelector("[data-agh-qw3live]");
        if (row) row.remove(); /* 오프라인 대본 그대로 유지 */
      }
    });
  }
  RENDER.qw3 = function (host) {
    host = host || el.canvas;
    var T = timerFor(host);
    var tgt = targetEmp();
    host.innerHTML = screenHead("qw3") +
      '<div class="agh-workpanel"><div class="lab">⏳ 작업 중 <span class="who">' + esc(tgt.name || tgt.emp_id) + " · 실행력" + esc(targetNote()) + "</span></div>" +
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
    qw3Draft(host); /* AI 연결 시 실데이터 기반 초안으로 교체 — 오프라인이면 no-op */
  };

  /* ---------- HOLD · 근거 부족 시 정지+질문 (확신 없으면 진행하지 않는다) ---------- */
  RENDER.hold = function (host) {
    host = host || el.canvas;
    var T = timerFor(host);
    var tgt = targetEmp();
    var who = tgt.name || tgt.emp_id;
    host.innerHTML = screenHead("hold") +
      '<div class="agh-workpanel"><div class="lab">⏳ 작업 중 <span class="who">' + esc(who) + " · 등급 초안" + esc(targetNote()) + "</span></div>" +
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
      logAudit("판단 정지", who + " 등급 초안 — KR2·KR3 근거 부족", "hold.no-evidence");
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

  /* ---------- QW5 · 평가 편향 점검 ----------
     대본 폐기 — evaluations × orgs × employees 실집계.
     판정 임계는 상수(BIAS)를 쓰되 화면에 기준과 모집단 N을 함께 밝힌다. */
  var BIAS = { MIN_N: 8, DEV_PP: 15, CONC_PCT: 65 };
  function orgBiasStats() {
    var d = D();
    var orgById = {};
    (d.orgs || []).forEach(function (o) { orgById[o.org_id] = o; });
    var evByEmp = {};
    (d.evaluations || []).forEach(function (v) { evByEmp[v.emp_id] = v; });
    var ckByEmp = {};
    (d.checkins || []).forEach(function (c) { ckByEmp[c.emp_id] = (ckByEmp[c.emp_id] || 0) + 1; });

    var comp = { n: 0, counts: { S: 0, A: 0, B: 0, C: 0, D: 0 }, ck: 0, period: null };
    var units = {};
    (d.employees || []).forEach(function (e) {
      var v = evByEmp[e.emp_id];
      if (!v || comp.counts[v.grade] == null) return;
      var ck = ckByEmp[e.emp_id] || 0;
      comp.n++; comp.counts[v.grade]++; comp.ck += ck;
      if (!comp.period && v.period) comp.period = v.period;
      var o = orgById[e.org_id];
      var key = e.org_id || "-";
      var u = units[key] || (units[key] = {
        org_id: key, name: (o && o.name) || e.orgName || key,
        n: 0, counts: { S: 0, A: 0, B: 0, C: 0, D: 0 }, ck: 0, members: []
      });
      u.n++; u.counts[v.grade]++; u.ck += ck;
      u.members.push({ emp_id: e.emp_id, name: e.name, grade: v.grade, score: v.weighted_score, ck: ck });
    });
    if (!comp.n) return null;
    var compTop = (comp.counts.S + comp.counts.A) / comp.n * 100;
    var compCk = comp.ck / comp.n;

    var list = [];
    Object.keys(units).forEach(function (k) {
      var u = units[k];
      if (u.n < BIAS.MIN_N) return;                    /* 모집단이 얇으면 편향을 말하지 않는다 */
      u.topPct = Math.round((u.counts.S + u.counts.A) / u.n * 100);
      u.dev = Math.round(u.topPct - compTop);
      u.ckAvg = Math.round(u.ck / u.n * 100) / 100;
      var mode = GRADES.reduce(function (m, g) { return u.counts[g] > u.counts[m] ? g : m; }, "S");
      u.mode = mode;
      u.modePct = Math.round(u.counts[mode] / u.n * 100);
      /* 이상치 인원 = 판정 대상 등급자 중 근거 기록(체크인)이 전사 평균 미만인 인원 실카운트 */
      if (u.dev >= BIAS.DEV_PP) {
        u.kind = "lenient"; u.tag = "관대화 의심";
        u.pool = u.members.filter(function (m) { return m.grade === "S" || m.grade === "A"; });
      } else if (u.dev <= -BIAS.DEV_PP) {
        u.kind = "strict"; u.tag = "엄격화 의심";
        u.pool = u.members.filter(function (m) { return m.grade !== "S" && m.grade !== "A"; });
      } else if (u.modePct >= BIAS.CONC_PCT) {
        u.kind = "central"; u.tag = "중심화 의심";
        u.pool = u.members.filter(function (m) { return m.grade === mode; });
      } else {
        u.kind = "normal"; u.tag = "정상 범위"; u.pool = [];
      }
      u.outliers = u.pool.filter(function (m) { return m.ck < compCk; }).length;
      list.push(u);
    });
    /* 편차 절댓값이 큰 순 → 같은 값이면 모집단 큰 순 */
    list.sort(function (a, b) {
      var fa = a.kind === "normal" ? 0 : 1, fb = b.kind === "normal" ? 0 : 1;
      if (fa !== fb) return fb - fa;
      var da = Math.abs(a.dev), db = Math.abs(b.dev);
      if (db !== da) return db - da;
      return b.n - a.n;
    });
    return {
      company: { n: comp.n, counts: comp.counts, topPct: Math.round(compTop * 10) / 10, ckAvg: Math.round(compCk * 100) / 100, period: comp.period || "현재 평가 주기" },
      units: list,
      flagged: list.filter(function (u) { return u.kind !== "normal"; }),
      thresholds: BIAS
    };
  }
  RENDER.qw5 = function (host) {
    host = host || el.canvas;
    var T = timerFor(host);
    var st = orgBiasStats();
    if (!st) {
      host.innerHTML = screenHead("qw5") +
        '<div class="agh-emptybox"><b>평가 기록이 없어 편향을 판정할 수 없습니다.</b><br>등급 분포를 만들 모집단이 0명입니다 — 추정하지 않습니다.</div>';
      logAudit("판단 정지", "평가 편향 점검 · 평가 기록 없음", "qw5.no-data");
      return;
    }
    var c = st.company;
    var show = st.flagged.concat(st.units.filter(function (u) { return u.kind === "normal"; })).slice(0, 6);
    var flagged = st.flagged;
    host.innerHTML = screenHead("qw5") +
      '<div class="agh-scanline" data-agh-scan>조직 ' + st.units.length + "곳(모집단 " + BIAS.MIN_N + "명 이상) 등급 분포·근거량 스캔 중 <i class=\"agh-spin\"></i></div>" +
      '<div class="agh-brief" style="margin-top:10px"><span class="ic">📐</span><div><b>판정 기준 — 이 화면의 임계값</b><br>' +
      "전사 상위등급(S+A) 비율 <b>" + c.topPct + "%</b> (모집단 <b>" + c.n + "명</b> · " + esc(c.period) +
      " · S " + c.counts.S + " · A " + c.counts.A + " · B " + c.counts.B + " · C " + c.counts.C + " · D " + c.counts.D + "명)를 기준선으로 두고, " +
      "조직별 상위등급 비율이 <b>±" + BIAS.DEV_PP + "%p</b>를 벗어나면 관대화/엄격화, 단일 등급이 <b>" + BIAS.CONC_PCT + "%</b> 이상이면 중심화로 표시합니다. " +
      "모집단 <b>" + BIAS.MIN_N + "명 미만</b> 조직은 판정하지 않습니다. 이상치 인원 = 해당 등급군 중 근거 기록(체크인)이 전사 평균 <b>" + c.ckAvg + "건/인</b> 미만인 인원 실카운트. " +
      srcChip("talenx", "evaluations × orgs 집계") + srcChip("talenx", "체크인 근거량") + "</div></div>" +
      '<div class="agh-biasgrid" data-agh-bias style="opacity:.3">' +
      show.map(function (u) {
        var cls = u.kind === "normal" ? "ok" : "warn";
        var body = "상위등급(S+A) <b>" + u.topPct + "%</b> · 전사 " + c.topPct + "% 대비 " + (u.dev > 0 ? "+" : "") + u.dev + "%p" +
          " · 최빈 " + u.mode + " " + u.modePct + "%" +
          "<br>모집단 <b>" + u.n + "명</b> (S " + u.counts.S + " · A " + u.counts.A + " · B " + u.counts.B + " · C " + u.counts.C + " · D " + u.counts.D + ")" +
          " · 근거 " + u.ckAvg + "건/인 (전사 " + c.ckAvg + ")" +
          (u.kind === "normal" ? "" : "<br>이상치 인원 <b>" + u.outliers + "명</b> — " + u.pool.length + "명 중 근거 기록 평균 미만");
        return '<div class="agh-bias ' + cls + '"><b>' + esc(u.name) + '</b><span class="tag">' + esc(u.tag) + "</span><p>" + body + "</p></div>";
      }).join("") + "</div>" +
      '<div class="agh-verdict" data-agh-verdict style="display:none">' +
      (flagged.length
        ? flagged.slice(0, 3).map(function (u) {
            return "<b>" + esc(u.name) + "</b>(" + esc(u.tag) + ") — 상위등급 " + u.topPct + "% · 전사 대비 " + (u.dev > 0 ? "+" : "") + u.dev +
              "%p · 근거 부족 인원 <b>" + u.outliers + "명</b>";
          }).join("<br>") +
          "<br>편향 <b>플래그+근거</b>만 제시하며, 등급 수정은 하지 않습니다 — 검토 승인 시 등급 조정 회의 안건으로 전달됩니다."
        : "임계(±" + BIAS.DEV_PP + "%p · 단일등급 " + BIAS.CONC_PCT + "%)를 넘는 조직이 없습니다 — 없는 편향을 만들지 않습니다.") +
      '<span class="agh-auditchip">⛨ 감사 기록됨</span></div>' +
      '<div class="agh-linkrow"><button class="agh-btn" data-agh-nav="calib">→ 등급 조정 심의 회의에서 검토</button></div>' +
      gateHTML("qw5", ["검토 승인", "수정", "보류"]);
    ctxPanelIf(host, [
      { tag: "정치 배제", title: "민감 이슈 처리 원칙", body: "관대화·편향은 <b>재검토 제안</b>만 하며 자동 수정하지 않습니다. 플래그의 모든 판단에는 분포·근거량 원천이 인용됩니다. " + srcChip("rule", "관대화·강제배분 감사") + srcChip("talenx", "평가 기록 집계") },
      { tag: "한계 표기", title: "임계값은 데모 상수", kind: "warn", body: "±" + BIAS.DEV_PP + "%p · 단일등급 " + BIAS.CONC_PCT + "% · 모집단 " + BIAS.MIN_N + "명은 talenx 데이터에 편향 판정 정책이 없어 <b>화면에서 정한 상수</b>입니다. 분포·인원·근거량은 모두 실집계값입니다." }
    ], "");
    T(function () {
      host.querySelector("[data-agh-bias]").style.opacity = "1";
      host.querySelector("[data-agh-scan]").innerHTML = "조직 " + st.units.length + "곳 스캔 완료 · 모집단 " + c.n + "명 " +
        srcChip("talenx", "등급 분포") + srcChip("talenx", "근거 기록량") +
        (flagged.length ? ' <span class="agh-flag">▲ 편향 플래그 ' + flagged.length + "곳</span>" : ' <span class="agh-flag ok">임계 초과 없음</span>');
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
  /* 근거 없는 S 난이도 건수 — 심의 요약에서 재사용 */
  function dcalibSNoBasis() {
    try { return calibDiffData().sNoBasis || 0; } catch (e) { return 0; }
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
        return "<tr><td><b>" + esc(r.name) + "</b></td><td>" + diffTxt + "</td><td>× " + r.coef.toFixed(2) + "</td><td>" + r.before + "</td><td>→</td><td><b>" + r.after + "</b> <small style=\"color:" + (up ? "var(--agh-ok,#15803D)" : "var(--agh-warn,#B45309)") + "\">" + (up ? "▲" : "▼") + "</small></td></tr>";
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
      '<div class="lab">Roundtable 에이전트 4종 <span class="live" data-agh-live>● 심의 진행 중</span></div>' +
      '<div class="agh-rgraph"><div class="agh-orch" data-agh-orch>조정<br>진행자<small data-agh-orchst>조율 중</small></div>' +
      [["증거검증", "자기평가·실적 대조", "tl"], ["정치배제", "관대화·강제배분 감사", "tr"], ["편향필터", "난이도 편차 보정", "bl"], ["전략기여", "전사목표 연계 검증", "br"]].map(function (a, i) {
        return '<div class="agh-ragent ' + a[2] + '" data-ra="' + i + '"><b>' + esc(a[0]) + "</b><small>" + esc(a[1]) + "</small><span class=\"rel\" data-rel></span></div>";
      }).join("") + "</div>" +
      '<div class="agh-rlog" data-agh-rlog></div></div>' +
      '<div class="agh-calside"><div class="lab">등급 분포 · 조정 전 → 후</div><div data-agh-dist></div>' +
      '<div class="agh-whatif"><div class="lab">가정 · 강제배분 상한 <b data-agh-cap>30%</b></div>' +
      '<input type="range" min="20" max="40" step="5" value="30" data-agh-capslider>' +
      "<small>같은 계산 규칙에서 상한만 바꿔 즉시 재산출 · 계산 규칙 재적용</small></div>" +
      '<div class="agh-sumbox" data-agh-calsum style="display:none"><b>심의 결과 요약</b><div data-agh-calsumbody></div></div></div></div>' +
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
      state.whatifCap = cap; /* EZCalc.simulate() 기본값이 현재 슬라이더를 따르도록 동기화 */
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
      /* 요약도 실집계 재산출값으로 — 하드코딩된 "A 25%" 폐기 */
      var sim = simulateCalib({ cap_pct: +slider.value });
      var body = host.querySelector("[data-agh-calsumbody]");
      if (body) {
        if (sim.error) body.innerHTML = "<p>" + esc(sim.error) + "</p>";
        else {
          var moves = sim.gradeChange.filter(function (g) { return g.delta_pp !== 0; });
          body.innerHTML = "<ul>" +
            "<li>상한 " + sim.basis.cap_grades + " ≤ " + sim.cap_pct + "% 적용 → " +
            (moves.length
              ? moves.map(function (g) { return g.grade + " " + g.before_pct + "%→" + g.after_pct + "%"; }).join(" · ")
              : "현재 분포가 이미 상한 이내 — 조정 없음") + "</li>" +
            "<li>이동 폭 <b>" + sim.moved_pp + "%p</b> · 모집단 <b>" + sim.basis.population_n + "명</b> 실집계 기준</li>" +
            (dcalibSNoBasis() ? "<li>근거 없는 S 난이도 <b>" + dcalibSNoBasis() + "건</b> — 심의 안건</li>" : "") +
            "</ul>" + calibBasisHTML(sim);
        }
      }
      renderDist(host, +slider.value, true);
    }, 4500);
  };
  /* ---------------- EZCalc — 등급 조정 실계산 공개 계약 (순수 함수 · DOM 비접촉) ----------------
     다른 모듈(AI 도구 연결 등)이 호출하는 가정 계산(what-if) 엔진.
     원본 weighted_score·데이터는 불변 — 모든 결과는 화면·도구용 계산값.

     EZCalc.simulate(params) → 재산출 결과
       params: {
         cap_pct?:           number  강제배분 상한 % (20~40 권장 · 기본 = 현재 슬라이더 값)
         achievement_delta?: number  달성 가정치 %p — 개인 종합점수에 더해 볼 델타 (기본 0)
         emp_id?:            string  지정 시 개인 산출(person)을 함께 반환 — 아래 참조
       }
       returns(분포 · emp_id 없음 = 기존 계약 불변): {
         cap_pct, achievement_delta,
         before:      { S,A,B,C,D },   // 조정 전 등급 분포 (%)
         after:       { S,A,B,C,D },   // 상한 적용 후 분포 (%)
         distribution_before / distribution_after,  // 위와 동일(개인 호출에서도 유지되는 별칭)
         gradeChange: [ { grade, before_pct, after_pct, delta_pp } ],
         people:      [ { name, coef, before, after } ]  // 난이도 보정계수(coef) × (원점수+델타)
       }
       returns(개인 · emp_id 지정): 위 항목 + {
         before/after: { weighted_score, score, grade },   // ← 개인값으로 대체(분포는 distribution_*)
         person, target, grade_changed, applied_weight, assumptions,
         grade_change: { from, to, changed, cut_used, next_grade, margin_to_next },
         basis: { …, person_score_source, person_score_model, grade_cuts, grade_cut_source }
       }
       평가 기록이 없으면 person_error만 채우고 분포 형상을 유지한다.
     EZCalc.person({emp_id, achievement_delta}) → 개인 산출 단독 호출
     EZCalc.gradeCuts()  → 등급컷(관측 최저점 기반 추정 · from_data:false = 항상 데모 가정)
     EZCalc.scoreModel() → 달성 축 가중치 실측 적합 { ok, w_achievement, w_peer, w_exec, rmse, n }
     EZCalc.calibDiff() → 난이도 보정 원자료 { rows, dist, basisTot, basisHas, sNoBasis } */
  var GRADES = ["S", "A", "B", "C", "D"];
  /* 기준 분포 — 하드코딩 {S:8,A:32,B:44,C:12,D:4} 폐기.
     단일 원천 = TALENX_DATA.evaluations 실 집계(모집단 N 포함). 집계가 비면 null →
     호출부는 "기준 분포를 만들 수 없다"고 정직하게 멈춘다(추정 금지). */
  function baseDistribution() {
    var cnt = { S: 0, A: 0, B: 0, C: 0, D: 0 }, n = 0, period = null;
    (D().evaluations || []).forEach(function (v) {
      if (cnt[v.grade] == null) return;
      cnt[v.grade]++; n++;
      if (!period && v.period) period = v.period;
    });
    if (!n) return null;
    /* 최대잔여법 — 반올림 오차로 합계가 100%를 벗어나지 않게 */
    var raw = {}, pct = {}, sum = 0;
    GRADES.forEach(function (g) { raw[g] = cnt[g] / n * 100; pct[g] = Math.floor(raw[g]); sum += pct[g]; });
    var rest = GRADES.slice().sort(function (a, b) { return (raw[b] - pct[b]) - (raw[a] - pct[a]); });
    for (var i = 0; i < 100 - sum && rest.length; i++) pct[rest[i % rest.length]]++;
    return { pct: pct, count: cnt, n: n, period: period || "현재 평가 주기" };
  }
  /* 등급컷·강제배분 규칙 — 데이터/정책에 있으면 그것을, 없으면 상수를 쓰되 출처를 화면에 밝힌다 */
  function capRule() {
    var d = D();
    var p = (d.meta && d.meta.gradePolicy) || d.gradePolicy || null;
    if (p && p.cap_grades && p.cap_pct != null) {
      return { grades: p.cap_grades, source: p.source || "talenx 평가정책", fromData: true };
    }
    return {
      grades: ["S", "A"], fromData: false,
      source: "데모 가정 — talenx 데이터에 등급 분포 정책이 없어 상위등급(S+A) 상한을 화면 슬라이더로 가정합니다"
    };
  }
  /* ---- 개인 단위 what-if 보조 ----
     종합점수 가중치가 데이터에 기재돼 있지 않아, evaluations 실측으로 최소제곱 적합해
     달성 축 가중치를 추정한다(적합 오차 RMSE를 함께 반환 — 숨기지 않는다). */
  var _achFit = null;
  function achievementWeightFit() {
    if (_achFit) return _achFit;
    var evs = (D().evaluations || []).filter(function (v) {
      return v && v.components && typeof v.weighted_score === "number" &&
        typeof v.components.achievement_norm === "number";
    });
    if (evs.length < 10) { _achFit = { ok: false, n: evs.length }; return _achFit; }
    function mse(a, b) {
      var c = 100 - a - b, s = 0;
      for (var i = 0; i < evs.length; i++) {
        var k = evs[i].components;
        var p = (a * k.achievement_norm + b * (k.peer_strength_norm || 0) + c * (k.exec_consistency_norm || 0)) / 100;
        var d = p - evs[i].weighted_score;
        s += d * d;
      }
      return s / evs.length;
    }
    var best = null, a, b;
    for (a = 0; a <= 100; a += 5) for (b = 0; a + b <= 100; b += 5) {
      var e1 = mse(a, b);
      if (!best || e1 < best.e) best = { a: a, b: b, e: e1 };
    }
    for (a = Math.max(0, best.a - 4); a <= Math.min(100, best.a + 4); a++)
      for (b = Math.max(0, best.b - 4); a + b <= 100 && b <= best.b + 4; b++) {
        var e2 = mse(a, b);
        if (e2 < best.e) best = { a: a, b: b, e: e2 };
      }
    _achFit = {
      ok: true, n: evs.length,
      w_achievement: best.a / 100, w_peer: best.b / 100, w_exec: (100 - best.a - best.b) / 100,
      rmse: Math.round(Math.sqrt(best.e) * 100) / 100
    };
    return _achFit;
  }
  /* 등급컷 — talenx 데이터에 등급 분포 정책이 없다. 평가 기록에서 관측된 등급별 최저
     종합점수를 경계로 "추정"할 뿐이므로 항상 데모 가정으로 표기한다. */
  function gradeCuts() {
    var mins = {}, n = 0;
    (D().evaluations || []).forEach(function (v) {
      if (typeof v.weighted_score !== "number" || GRADES.indexOf(v.grade) < 0) return;
      n++;
      if (mins[v.grade] == null || v.weighted_score < mins[v.grade]) mins[v.grade] = v.weighted_score;
    });
    var cuts = GRADES.filter(function (g) { return mins[g] != null; })
      .map(function (g) { return { grade: g, min: mins[g] }; })
      .sort(function (x, y) { return y.min - x.min; });
    return {
      cuts: cuts, n: n, from_data: false,
      source: cuts.length
        ? "데모 가정 — 등급컷 정책이 talenx 데이터에 없어 평가 기록 " + n + "건에서 관측된 등급별 최저 종합점수(" +
          cuts.map(function (c) { return c.grade + "≥" + c.min; }).join(" · ") + ")를 경계로 추정"
        : "데모 가정 — 등급컷을 만들 평가 기록이 없습니다"
    };
  }
  function gradeOfScore(score, gc) {
    for (var i = 0; i < gc.cuts.length; i++) if (score >= gc.cuts[i].min) return gc.cuts[i].grade;
    return gc.cuts.length ? gc.cuts[gc.cuts.length - 1].grade : null;
  }
  /* 개인 단위 산출 — emp_id의 달성률 변화(%p)를 가정해 종합점수·등급 변화를 계산.
     원본 evaluations는 불변 · 반환값은 화면/도구용 계산값. */
  function simulatePerson(params) {
    params = params || {};
    var id = params.emp_id || (params.employee && params.employee.emp_id) || null;
    var delta = +(params.achievement_delta || 0) || 0;
    if (!id) return { error: "대상 emp_id가 없어 개인 산출을 만들 수 없습니다." };
    var ev = (D().evaluations || []).filter(function (v) { return v.emp_id === id; })[0];
    if (!ev || typeof ev.weighted_score !== "number") {
      return { error: "평가 기록이 없어 개인 산출을 만들 수 없습니다: " + id };
    }
    var emp = empById(id) || {};
    var fit = achievementWeightFit();
    var w = fit.ok ? fit.w_achievement : 0.5;
    var gc = gradeCuts();
    var beforeScore = ev.weighted_score;
    var afterScore = Math.max(0, Math.min(100, Math.round((beforeScore + delta * w) * 10) / 10));
    var beforeGrade = ev.grade, afterGrade = gradeOfScore(afterScore, gc) || ev.grade;
    /* 다음 등급까지 남은 점수 — 현재 등급보다 한 칸 위 경계 기준 */
    var idx = -1, i;
    for (i = 0; i < gc.cuts.length; i++) if (gc.cuts[i].grade === afterGrade) idx = i;
    var next = (idx > 0) ? gc.cuts[idx - 1] : null;
    var cutUsed = (idx >= 0) ? gc.cuts[idx] : null;
    return {
      target: { emp_id: id, name: emp.name || id, org: emp.orgName || null, period: ev.period || null },
      achievement_delta: delta,
      applied_weight: Math.round(w * 1000) / 1000,
      before: { weighted_score: beforeScore, score: beforeScore, grade: beforeGrade },
      after: { weighted_score: afterScore, score: afterScore, grade: afterGrade },
      grade_changed: beforeGrade !== afterGrade,
      grade_change: {
        from: beforeGrade, to: afterGrade, changed: beforeGrade !== afterGrade,
        cut_used: cutUsed ? cutUsed.grade + " ≥ " + cutUsed.min : null,
        next_grade: next ? next.grade : null,
        margin_to_next: next ? Math.round((next.min - afterScore) * 10) / 10 : null
      },
      basis: {
        score_source: "talenx 평가 기록 " + (ev.evaluation_id || id) + " · 종합 " + beforeScore + "점 · " + (ev.period || "기간 미기재"),
        score_model: fit.ok
          ? "달성 축 가중치 " + Math.round(w * 100) + "% — talenx 데이터에 가중치 표가 없어 evaluations " + fit.n +
            "건 최소제곱 적합으로 추정(적합 오차 RMSE " + fit.rmse + "점). 추정값이므로 데모 가정입니다."
          : "달성 축 가중치 50% — 적합할 평가 기록이 부족해 사용한 데모 가정값입니다.",
        score_model_from_data: false,
        grade_cuts: gc.cuts,
        grade_cut_source: gc.source,
        grade_cut_from_data: false
      },
      assumptions: "달성률 " + (delta > 0 ? "+" : "") + delta + "%p 가정 · " +
        "달성 축 가중치 " + Math.round(w * 100) + "%(실측 적합 추정) · " + gc.source +
        " · 읽기 전용 — 실제 데이터는 변경되지 않습니다"
    };
  }
  function simulateCalib(params) {
    params = params || {};
    var cap = (params.cap_pct == null) ? state.whatifCap : +params.cap_pct;
    var delta = +(params.achievement_delta || 0) || 0;
    var bd = baseDistribution(), rule = capRule();
    if (!bd) {
      return {
        error: "평가 기록이 없어 기준 분포를 만들 수 없습니다 — 추정하지 않습니다.",
        cap_pct: cap, achievement_delta: delta
      };
    }
    var base = bd.pct, top = rule.grades;
    var lower = GRADES.filter(function (g) { return top.indexOf(g) < 0; });
    var topSum = 0, lowSum = 0;
    top.forEach(function (g) { topSum += base[g] || 0; });
    lower.forEach(function (g) { lowSum += base[g] || 0; });
    var adj = {}; GRADES.forEach(function (g) { adj[g] = base[g] || 0; });
    var moved = 0;
    if (topSum > cap) {
      /* 상한 초과분은 상위등급을 기존 비중대로 축소해 만든다 (매직넘버 없음) */
      var used = 0;
      top.forEach(function (g, i) {
        adj[g] = (i === top.length - 1) ? Math.max(0, cap - used) : Math.max(0, Math.round(base[g] / topSum * cap));
        used += adj[g];
      });
      moved = topSum - used;
      /* 내려온 몫은 하위등급의 기존 비중에 비례 배분 — 비중이 0이면 최하위 바로 위 등급으로 */
      var placed = 0;
      if (lowSum > 0) {
        lower.forEach(function (g, i) {
          var add = (i === lower.length - 1) ? (moved - placed) : Math.round(moved * (base[g] || 0) / lowSum);
          adj[g] = (base[g] || 0) + add; placed += add;
        });
      } else if (lower.length) {
        adj[lower[0]] = (base[lower[0]] || 0) + moved;
      }
    }
    var gradeChange = GRADES.map(function (g) {
      return { grade: g, before_pct: base[g], after_pct: adj[g], delta_pp: adj[g] - base[g] };
    });
    var people = calibDiffData().rows.map(function (r) {
      var b = Math.round((r.before + delta) * 10) / 10;
      return { name: r.name, coef: r.coef, before: b, after: Math.round(b * r.coef * 10) / 10 };
    });
    var out = {
      cap_pct: cap, achievement_delta: delta, before: base, after: adj,
      distribution_before: base, distribution_after: adj,
      gradeChange: gradeChange, people: people, moved_pp: moved,
      basis: {
        population_n: bd.n, counts: bd.count, period: bd.period,
        cap_grades: top.join("+"),
        base_source: "talenx 평가 기록 " + bd.n + "명 실집계 · " + bd.period,
        cap_rule_source: rule.source, cap_rule_from_data: rule.fromData
      }
    };
    /* emp_id가 오면 개인 산출을 얹는다 — 분포 API(무 emp_id 호출)는 위 형상 그대로 유지.
       개인 호출에서만 before/after를 개인 {weighted_score,grade}로 바꾸고
       분포는 distribution_before/after·gradeChange로 계속 제공한다. */
    var pid = params.emp_id || null;
    if (pid) {
      var p = simulatePerson({ emp_id: pid, achievement_delta: delta });
      if (p.error) {
        out.person_error = p.error;
      } else {
        out.person = p;
        out.target = p.target;
        out.before = p.before;
        out.after = p.after;
        out.grade_changed = p.grade_changed;
        out.grade_change = p.grade_change;
        out.applied_weight = p.applied_weight;
        out.assumptions = p.assumptions;
        out.basis.person_score_source = p.basis.score_source;
        out.basis.person_score_model = p.basis.score_model;
        out.basis.grade_cuts = p.basis.grade_cuts;
        out.basis.grade_cut_source = p.basis.grade_cut_source;
        out.basis.grade_cut_from_data = false;
      }
    }
    return out;
  }
  window.EZCalc = {
    simulate: simulateCalib,
    person: simulatePerson,          /* 개인 단위 전용 — 분포 계산 없이 등급/점수만 */
    gradeCuts: gradeCuts,            /* 관측 기반 등급컷(데모 가정) */
    scoreModel: achievementWeightFit,/* 달성 축 가중치 실측 적합 결과 */
    calibDiff: calibDiffData,
    baseDistribution: baseDistribution
  };

  /* 산출 근거 한 줄 — 모집단 N·기준 분포 출처·상한 규칙 출처 */
  function calibBasisHTML(sim) {
    if (!sim || !sim.basis) return "";
    var b = sim.basis;
    return '<div class="agh-prow" style="margin-top:6px;font-size:11.5px;line-height:1.6">' +
      "기준: <b>" + esc(b.base_source) + "</b> (S " + b.counts.S + " · A " + b.counts.A + " · B " + b.counts.B + " · C " + b.counts.C + " · D " + b.counts.D + "명) " +
      srcChip("talenx", "평가 기록 집계") + "<br>" +
      "상한 규칙: <b>" + esc(b.cap_grades) + " ≤ " + sim.cap_pct + "%</b> · " + esc(b.cap_rule_source) + " " +
      srcChip("rule", b.cap_rule_from_data ? "평가정책" : "데모 가정") + "</div>";
  }

  function renderDist(root, cap, after) {
    var host = root.querySelector("[data-agh-dist]");
    if (!host) return;
    var sim = simulateCalib({ cap_pct: cap });
    if (sim.error) {
      host.innerHTML = '<div class="agh-prow bad">' + esc(sim.error) + "</div>";
      return;
    }
    host.innerHTML = sim.gradeChange.map(function (gc) {
      var b = gc.before_pct, a2 = after ? gc.after_pct : b, d = a2 - b;
      return '<div class="agh-drow"><b>' + gc.grade + '</b><div class="tr"><i style="width:' + b * 2 + 'px"></i></div><span>' + b + "%</span><em>→</em>" +
        '<div class="tr af"><i style="width:' + a2 * 2 + 'px"></i></div><span>' + a2 + "%</span>" +
        '<small class="' + (d < 0 ? "neg" : d > 0 ? "pos" : "") + '">' + (d > 0 ? "+" : "") + d + "%p</small></div>";
    }).join("") + calibBasisHTML(sim);
  }

  /* ---------- 리뷰 초안 co-writing ----------
     [data-agh-revgo]는 원래 숨긴 문단을 다시 보여줄 뿐인 no-op였다.
     이제 입력한 지시(data-agh-revin)를 실제로 반영해 제안 문단을 재생성한다.
     AI 연결 시 EZAI 실호출(도구로 실데이터 인용), 미연결이면 재작성했다고 말하지 않고
     "AI 미연결 — 지시를 반영하려면 연결 필요"를 명시한다. */
  function reviewRegen(host, instr) {
    var p = host.querySelector("[data-agh-prop]");
    if (!p) return;
    var hl = p.querySelector(".hl");
    var note = p.querySelector("[data-agh-revnote]");
    if (!note) {
      p.insertAdjacentHTML("afterbegin", '<div data-agh-revnote class="agh-flag" style="display:block;margin-bottom:6px"></div>');
      note = p.querySelector("[data-agh-revnote]");
    }
    p.style.display = "";
    if (!instr) {
      note.textContent = "지시문이 비어 있습니다 — 무엇을 어떻게 고칠지 적어주세요.";
      return;
    }
    logAudit("지시", "리뷰 co-writing · " + instr, "rev.instr");
    if (!aiLive()) {
      note.innerHTML = "⚠ <b>AI 미연결 — 지시를 반영하려면 연결이 필요합니다.</b> 받은 지시: 「" + esc(instr) +
        "」 · 아래 제안 문단은 <b>재작성된 것이 아니라 기존 제안 그대로</b>입니다.";
      ctxAppendIf(host, '<div class="agh-live warn">지시 수신 — AI 미연결이라 재작성하지 못했습니다. 기존 제안을 유지합니다.</div>');
      return;
    }
    var tgt = targetEmp();
    var cur = "";
    var doc = host.querySelector("[data-agh-doc]");
    if (doc) cur = (doc.textContent || "").trim();
    note.innerHTML = '<i class="agh-spin"></i> 지시를 반영해 다시 쓰는 중 — 「' + esc(instr) + "」";
    if (hl) hl.setAttribute("data-prev", hl.textContent || "");
    EZAI.agent({
      maxTurns: 6, maxTokens: 700,
      system: "당신은 elizax — 성과 리뷰 co-writer입니다. 사용자의 자연어 지시대로 '핵심 성과' 문단에 넣을 제안 문장을 다시 씁니다. " +
        "반드시 도구(get_objectives, get_checkins, 필요 시 get_context_ledger)로 대상자의 실데이터를 먼저 조회하고, 조회된 수치·사실만 인용합니다. " +
        "근거가 조회되지 않으면 지어내지 말고 '근거를 찾지 못해 멈췄습니다'라고만 씁니다. " +
        "출력은 제안 문장 1~2문장만 — 머리말·설명·따옴표 금지.",
      messages: [{
        role: "user",
        content: "대상자: " + tgt.name + " (" + tgt.emp_id + ")\n현재 문단: " + cur + "\n지시: " + instr
      }],
      onTool: function (name) {
        note.innerHTML = '<i class="agh-spin"></i> ' + esc((window.EZTools && EZTools.labelOf) ? EZTools.labelOf(name) : name) + "…";
      },
      onDone: function (text) {
        var t = (text || "").trim();
        if (!t) {
          note.textContent = "AI가 빈 응답을 보냈습니다 — 기존 제안을 유지합니다.";
          return;
        }
        if (hl) hl.textContent = t;
        note.innerHTML = "✓ 지시 「" + esc(instr) + "」를 반영해 재작성했습니다 · elizax 실시간 생성";
        logAudit("초안 재작성", "리뷰 · " + t.slice(0, 40), "rev.regen");
        ctxAppendIf(host, '<div class="agh-live ok">지시를 반영해 제안 문장을 다시 썼습니다. 반영/무시는 문장 단위로 선택하세요.</div>');
      },
      onError: function () {
        note.textContent = "AI 호출에 실패했습니다 — 기존 제안을 유지합니다.";
      }
    });
  }
  /* 리뷰 대상 실집계 — 이름 3명 상수·"5/12" 폐기.
     대상 = 직속 팀원(manager_id) · 없으면 같은 조직 구성원 · 그것도 없으면 빈 상태.
     진행 카운트 = 리뷰 문장을 세울 근거(체크인 기록)가 확보된 인원 / 전체 대상 (실카운트) */
  function reviewFacts() {
    var list = directReports(), src = "직속(manager_id)";
    if (!list.length) { list = team(); src = "같은 조직(org_id)"; }
    var sigs = list.map(memberSignals);
    var withEv = sigs.filter(function (s) { return s.count > 0; });
    var want = (state.ctx && state.ctx.empId) || null;
    var cur = (want && sigs.filter(function (s) { return s.emp_id === want; })[0]) || withEv[0] || sigs[0] || null;
    return { sigs: sigs, withEv: withEv, cur: cur, src: src };
  }
  /* 제안 문장은 조회된 사실로만 구성 — 근거가 없으면 문장을 만들지 않는다(정지 원칙) */
  function reviewProposal(s) {
    if (!s || !s.count) return null;
    var w = s.worst, bits = [];
    if (w) {
      bits.push("「" + w.name + "」를 진척 " + w.progress + "%까지 진행" +
        (w.elapsed != null ? "(" + (w.period || "") + " 기간 경과 " + w.elapsed + "% 대비 " + (w.drift > 0 ? "−" + w.drift : "+" + Math.abs(w.drift)) + "%p)" : ""));
    }
    bits.push("점검 주기 동안 체크인 " + s.count + "건을 기록");
    if (s.blockers.length) bits.push("장애요인 " + s.blockers.length + "건을 조기에 공유(" + s.blockers[0].blocker + " 등)");
    if (s.lows.length) bits.push("확신도 '낮음' " + s.lows.length + "건을 스스로 표시해 리스크를 선공유");
    return bits.join("하고, ") + "함";
  }
  RENDER.review = function (host) {
    host = host || el.canvas;
    var T = timerFor(host);
    var rf = reviewFacts();
    if (!rf.sigs.length) {
      host.innerHTML = screenHead("review") +
        '<div class="agh-emptybox"><b>리뷰 대상이 없습니다.</b><br>' +
        "대상은 <code>employees.manager_id</code> 직속 → 없으면 같은 조직 구성원으로 정합니다. 조회 결과 <b>0명</b>이라 대상 이름을 가정하지 않습니다.</div>";
      logAudit("판단 정지", "리뷰 초안 · 대상 0명", "review.no-target");
      return;
    }
    var cur = rf.cur;
    var prop = reviewProposal(cur);
    var propChips = cur && cur.last
      ? refChip("talenx", cur.last.checkin_id, cur.last.comment || "") +
        (cur.worst ? refChip("erp", cur.worst.kr_id, cur.worst.objective || cur.worst.name) : "")
      : srcChip("talenx", "근거 기록 없음");
    host.innerHTML = screenHead("review") +
      '<div class="agh-revlayout"><div class="agh-revside"><div class="lab">리뷰 대상 <b>' + rf.sigs.length + "명</b> · 근거 확보 <b>" + rf.withEv.length + " / " + rf.sigs.length + "</b></div>" +
      rf.sigs.map(function (s) {
        var cls = (cur && s.emp_id === cur.emp_id) ? "cur" : (s.count ? "done" : "");
        var st = (cur && s.emp_id === cur.emp_id) ? "작성 중" : (s.count ? "근거 " + s.count + "건" : "근거 없음");
        return '<div class="agh-revtgt ' + cls + '"><b>' + esc(s.name) + "</b><span>" + esc(st) + "</span></div>";
      }).join("") +
      '<div class="lab" style="margin-top:12px">대상 산출</div><div class="agh-revsec" style="font-size:11.5px">' +
      esc(rf.src) + " 기준<br>근거 = checkins 기록 유무<br>이름·건수 모두 실조회값</div></div>" +
      '<div class="agh-revmain"><div class="lab">핵심 성과 · ' + esc(cur ? cur.name : "-") + ' <span class="agh-flag ok">AI 작성보조 ON</span></div>' +
      '<div class="agh-revdoc" data-agh-doc><p>' +
      esc(cur && cur.worst && cur.worst.objective ? "「" + cur.worst.objective + "」 과제를 담당함." : "담당 과제 기록이 조회되지 않았습니다.") + "</p></div>" +
      '<div class="agh-revprop" data-agh-prop style="display:none"><div class="lab">AI 제안 및 근거 — 삽입 문장 하이라이트</div>' +
      (prop
        ? '<p class="hl">' + esc(prop) + "</p>" + propChips +
          '<div class="acts"><button class="agh-btn primary" data-rev-apply>반영</button><button class="agh-btn" data-rev-skip>무시</button></div>' +
          "<small>변경 요약 · +1문장, 조회된 KR 진척·체크인 근거만 인용 — 변경 근거 기록</small>"
        : '<p class="hl">⛔ 근거를 찾지 못해 제안 문장을 만들지 않았습니다 — ' + esc(cur ? cur.name : "대상") +
          " 님의 체크인·KR 기록이 조회되지 않습니다.</p>" + srcChip("talenx", "체크인 기록 없음") +
          "<small>추정으로 리뷰 문장을 채우지 않습니다.</small>") + "</div>" +
      '<div class="agh-revcmd"><input type="text" value="핵심 성과를 조회된 KR 진척·체크인 근거로 보강해줘" data-agh-revin>' +
      '<button class="agh-btn primary" data-agh-revgo>지시</button></div></div></div>' +
      gateHTML("review", ["섹션 승인", "수정", "보류"]);
    ctxPanelIf(host, [
      { tag: "문장 단위 통제권", title: "단계·문장 단위 승인", body: "AI가 조회된 KR 진척·체크인 기록을 근거로 초안을 생성하고 삽입 문장을 하이라이트로 표시 — 사용자는 문장 단위로 반영/무시합니다." },
      { tag: "산출식", title: "대상·진행 카운트", body: "대상 <b>" + rf.sigs.length + "명</b> = " + esc(rf.src) + " 실조회 · 근거 확보 <b>" + rf.withEv.length + "명</b> = 체크인 기록 1건 이상. 근거 0건인 대상은 문장을 제안하지 않고 멈춥니다. " + srcChip("talenx", "employees·checkins") },
      { tag: "민감 이슈", title: "인라인 도우미", body: "저성과·민감 문구는 에이전트가 동시에 감지해 문장 옆에서 대안을 제시하고 변경 근거를 기록합니다." }
    ], "");
    T(function () {
      host.querySelector("[data-agh-prop]").style.display = "";
      ctxAppendIf(host, prop
        ? '<div class="agh-live">' + esc(cur.name) + " 님의 KR 진척·체크인 " + cur.count + "건을 인용해 '핵심 성과' 문단 제안을 만들었습니다.</div>"
        : '<div class="agh-live warn">근거 조회 실패 — 제안 문장을 만들지 않았습니다.</div>');
    }, 1300);
    host.addEventListener("click", function (e) {
      if (e.target.closest("[data-rev-apply]")) {
        /* 하드코딩 문장이 아니라 지금 제안 박스에 떠 있는 문장을 그대로 반영 */
        var hl = host.querySelector("[data-agh-prop] .hl");
        var txt = hl ? (hl.textContent || "").trim() : "";
        if (!txt) { toast("반영할 제안 문장이 없습니다."); return; }
        var doc = host.querySelector("[data-agh-doc]");
        doc.insertAdjacentHTML("beforeend", '<p class="ins">' + esc(txt) + "</p>");
        host.querySelector("[data-agh-prop]").style.display = "none";
        logAudit("문장 반영", "리뷰 · 핵심 성과 — " + txt.slice(0, 40), "rev.ins");
        toast("문서에 반영 — 변경 근거가 기록되었습니다.", "ok");
      }
      if (e.target.closest("[data-rev-skip]")) {
        host.querySelector("[data-agh-prop]").style.display = "none";
        logAudit("제안 무시", "리뷰 · 핵심 성과 제안", "rev.skip");
        toast("제안을 무시했습니다. 원문이 유지됩니다.");
      }
      if (e.target.closest("[data-agh-revgo]")) {
        var inp = host.querySelector("[data-agh-revin]");
        reviewRegen(host, inp ? (inp.value || "").trim() : "");
      }
    });
    /* 지시 입력창 Enter로도 실행 */
    var revin = host.querySelector("[data-agh-revin]");
    if (revin) revin.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { var go = host.querySelector("[data-agh-revgo]"); if (go) go.click(); }
    });
  };

  /* ---------- 원장 복원 — 세션 메모리(state)에 없는 허브 발행분(hub.*)을 원장에서 되살린다 ---------- */
  function ledgerHubItems(prefix, exclude) {
    var out = [];
    try {
      if (!(window.EZLedger && EZLedger.list)) return out;
      var have = {}, i;
      for (i = 0; i < state.audit.length; i++) if (state.audit[i].ref) have[state.audit[i].ref] = 1;
      for (i = 0; i < state.assets.length; i++) if (state.assets[i].gid) have[state.assets[i].gid] = 1;
      var arr = EZLedger.list();
      for (i = 0; i < arr.length; i++) {
        var it = arr[i];
        var src = String((it && it.source) || "");
        if (src.indexOf(prefix) !== 0) continue;
        if (exclude && src.indexOf(exclude) === 0) continue;
        if (have[it.id]) continue;
        out.push(it);
      }
    } catch (e) { /* 원장 미로드 무시 */ }
    return out;
  }

  /* ---------- 산출물 (자산화) ---------- */
  RENDER.assets = function (host) {
    host = host || el.canvas;
    /* 이번 세션 기록 + 원장 복원분(hub.asset.*) 병합 — 새로고침에도 산출물이 남는다 */
    var all = state.assets.slice();
    var restored = ledgerHubItems("hub.asset.");
    for (var ri = 0; ri < restored.length; ri++) {
      var rit = restored[ri];
      all.push({ at: rit.at, kind: rit.summary || "기록", title: rit.title, screen: String(rit.source).slice("hub.asset.".length), gid: rit.id });
    }
    var rows = all.length ? all.map(function (a) {
      var nav = (a.screen && SCREENS[a.screen]) ? '<button class="agh-btn sm" data-agh-nav="' + esc(a.screen) + '">다시 열기</button>' : "";
      return '<div class="agh-tli"><span class="dt">' + esc(a.at) + '</span><span class="agh-tag">' + esc(a.kind) + '</span><div class="bd">' + esc(a.title) + '</div>' + nav + '</div>';
    }).join("") : '<div class="agh-emptybox">아직 보관된 산출물이 없습니다. 과제 화면에서 결정 게이트를 통과하면 여기 보관됩니다 — 한 번 만든 근거와 결정이 사라지지 않고 남습니다.</div>';
    host.innerHTML = '<div class="agh-shead"><div><h2>산출물 · 기록 보관함</h2><span class="agh-exp">과정·판단·근거가 기록으로 남아 다음 사이클이 이어받습니다</span></div></div><div class="agh-tl">' + rows + "</div>";
    ctxPanelIf(host, [
      { tag: "기록 보관", title: "왜 남기나", body: "지속되는 평가 사이클을 위한 성과 기록 — 목표/피드백/평가 근거가 휘발되지 않고 다음 사이클이 이어받는 기록으로 남습니다." }
    ], "");
  };

  /* ---------- 감사 로그 ---------- */
  RENDER.audit = function (host) {
    host = host || el.canvas;
    /* 이번 세션 기록 + 원장 복원분(hub.* — 산출물 제외) 병합 — 새로고침 복원 */
    var all = state.audit.slice();
    var restored = ledgerHubItems("hub.", "hub.asset.");
    for (var ri = 0; ri < restored.length; ri++) {
      var rit = restored[ri];
      var t = String(rit.title || ""), ract = t, rtarget = "";
      var p = t.indexOf(" — ");                                  /* hub.audit: "행위 — 대상" */
      if (p >= 0) { ract = t.slice(0, p); rtarget = t.slice(p + 3); }
      else {
        var q = t.lastIndexOf(" · ");                            /* hub.gate: "대상 · 행위" */
        if (q >= 0) { rtarget = t.slice(0, q); ract = t.slice(q + 3); }
      }
      var m = /(?:실행자|결정자)\s*(.+)$/.exec(String(rit.summary || ""));
      all.push({ at: rit.at, actor: m ? m[1] : "-", act: ract, target: rtarget, ref: rit.id });
    }
    var rows = all.length ? all.map(function (a) {
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
    /* 의도 라우팅: 시나리오 키워드 매칭 → 해당 화면 실행 (규칙은 intentFor 단일 원천) */
    var k = intentFor(q);
    if (k && SCREENS[k]) {
      /* 롤 가드는 라우팅 '전에' — 권한 없는 지시가 실행된 것처럼 감사 로그를 오염시키지 않는다 */
      if (!allowedScreen(k)) {
        toast("이 기능은 " + roleNames(scenarioOf(k)) + " 권한에서 열람할 수 있습니다.");
        logAudit("지시 거절 · 권한 없음", q + " → " + SCREENS[k].title + " (실행 안 함)", "cmd.denied");
        return;
      }
      logAudit("지시", q + " → " + SCREENS[k].title, "cmd");
      showScreen(k);
      if (SCREENS[k].redirect) return;   /* 결정 흐름 등 외부 화면으로 넘어간 경우 */
      ctxAppend('<div class="agh-live">지시 수신 · "' + esc(q) + '" → ' + esc(SCREENS[k].title) + " 실행</div>");
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
  /* 알림 = 실계산 신호만 — 조회로 만들 수 없는 항목은 아예 만들지 않는다(빈 배열 허용).
     ① 목표 문장 품질(qw7QualityRows) ② 체크인 공백·드리프트(qw7OpsRows)
     ③ 평가 편향(orgBiasStats) ④ 직무 프로파일 연결(connmap과 같은 집계) */
  function alertsNow() {
    var out = [];
    try {
      var scope = qw7Scope();
      var ops = qw7OpsRows(scope);
      var rows = qw7QualityRows(scope);
      var issues = rows.filter(function (r) { return r.issue; });
      if (issues.length) {
        out.push({
          title: "목표 문장 품질 지적 " + issues.length + "건",
          body: "KR " + scope.krs.length + "건 중 중복·미연계·측정 불가 신호 " + issues.length + "건 — 예: 「" + issues[0].kr.name + "」",
          screen: "qw7"
        });
      }
      if (ops.gaps.length) {
        var g = ops.gaps[0];
        out.push({
          title: "체크인 공백 " + ops.gapTotal + "건",
          body: "「" + g.title + "」 " + (g.gap == null ? "체크인 기록 없음" : g.gap + "일 무체크인") + " · 진행률 " + g.progress + "%",
          screen: "qw1"
        });
      }
      if (ops.drifts.length) {
        var dr = ops.drifts[0];
        out.push({
          title: "진척 드리프트 " + ops.driftTotal + "건",
          body: "「" + dr.title + "」 기간 경과 " + dr.elapsed + "% 대비 진행률 " + dr.progress + "% (−" + dr.drift + "%p)",
          screen: "qw7"
        });
      }
    } catch (e) { /* 조회 실패 시 알림을 지어내지 않는다 */ }
    try {
      var st = orgBiasStats();
      if (st && st.flagged.length) {
        var u = st.flagged[0];
        out.push({
          title: "평가 편향 플래그 " + st.flagged.length + "곳",
          body: u.name + " " + u.tag + " — 상위등급 " + u.topPct + "% (전사 " + st.company.topPct + "%) · 모집단 " + u.n + "명",
          screen: "qw5"
        });
      }
    } catch (e2) { /* 무시 */ }
    try {
      var d = D(), emps = d.employees || [];
      var missing = emps.filter(function (e) { return !e.jobProfileId; }).length;
      if (missing) {
        out.push({
          title: "직무 프로파일 미연결 " + missing + "명",
          body: "목표가 직무에 정박하지 못하면 평가 근거가 흔들립니다 — 연결 지도에서 확인",
          screen: "connmap"
        });
      }
    } catch (e3) { /* 무시 */ }
    return out;
  }
  /* ---------- 신호 엔진(EZSignalEngine)이 있으면 그것이 유일한 알림 원천 ----------
     엔진 미로드 환경(카탈로그 배선 전)에서는 아래 alertsNow() 폴백을 그대로 쓴다. */
  function sigPending() {
    var E = window.EZSignalEngine;
    if (!E || typeof E.pending !== "function") return null;      // null = 엔진 없음
    try {
      var a = E.pending(role().key);
      return a && a.length ? a : [];                             // [] = 처리할 알림 없음
    } catch (e) { return null; }
  }
  /* 알림 문구 한 문장. 신호 id에는 단계·주체 이름이 박혀 있어 화면에 쓰지 않는다(18-2차 R2).
     분류 이름·식별자 제거는 EZSignalChat.scrub / EZSignalCard._scrub이 단일 원천. */
  function sigNotice(inst) {
    var s = (inst && inst.signal) || inst || {};
    var t = s.notice || s.agent || "알림";
    try {
      if (window.EZSignalChat && EZSignalChat.scrub) return EZSignalChat.scrub(t) || "알림";
      if (window.EZSignalCard && EZSignalCard._scrub) return EZSignalCard._scrub(t) || "알림";
    } catch (e) { /* 무시 */ }
    return t;
  }
  function alertCount() {
    var sig = sigPending();
    if (sig) return sig.length;
    try { return alertsNow().length; } catch (e) { return 0; }
  }
  /* 신호 1건을 여는 유일한 경로 — 18-2차부터 화면이 아니라 대화가 열린다(R6).
     대화 진입점이 없으면 우하단 한 줄 권유 → 도킹 패널 순으로 내려간다. */
  function openSignal(inst) {
    var s = (inst && inst.signal) || inst || {};
    try {
      if (s.id && window.EZSignalChat && EZSignalChat.ask) {
        if (window.Elizax && Elizax.open) Elizax.open();
        EZSignalChat.ask(s.id);
        return;
      }
    } catch (e) { /* 아래로 폴백 */ }
    var C = window.EZSignalCard;
    if (C && typeof C.slot === "function") { try { C.slot([inst]); return; } catch (e2) { /* 아래로 폴백 */ } }
    if (window.Elizax && Elizax.showTab) { try { Elizax.showTab("ntf"); } catch (e3) { /* 무해화 */ } }
  }
  function showAlerts() {
    if (!(window.TX && TX.menu)) return;
    var btn = el.root.querySelector("[data-agh-alerts]");
    var sig = sigPending();
    if (sig) {
      if (!sig.length) { toast("처리하지 않은 알림이 없습니다 — 없는 알림을 만들지 않습니다."); return; }
      TX.menu(btn, sig.map(function (s) {
        return { label: "🔔 " + sigNotice(s), onClick: function () { openSignal(s); } };
      }));
      return;
    }
    var al = alertsNow();
    if (!al.length) { toast("지금 조회되는 임계 초과 신호가 없습니다 — 없는 알림을 만들지 않습니다."); return; }
    TX.menu(btn, al.map(function (a) {
      return { label: "▲ " + a.title + " — " + a.body, onClick: function () { showScreen(a.screen); } };
    }));
  }
  /* 메인 앱 위 알림 표면 — 하나만 뜬다(한 줄 권유). 렌더러/엔진 미로드 시에만 폴백 팝업. */
  var popupShown = false;
  function scheduleProactive() {
    if (popupShown) return;
    setTimeout(function () {
      if (popupShown || state.open) return;
      /* elizax 패널이 열려 있으면 띄우지 않는다 — 알림 탭에 같은 카드가 이미 있어 한 신호가 두 번 보인다 */
      if (document.querySelector(".ezx-root.ezx-open")) return;
      var C = window.EZSignalCard, sig = sigPending();
      if (sig && C && typeof C.slot === "function") {
        if (!sig.length) return;                       /* 엔진이 "처리할 알림 없음"이라 답했다 */
        try {
          C.slot(sig);                                 /* 첫 건만 말하고 나머지는 "이 밖에 N건 더" 한 마디 */
          popupShown = true;
          return;
        } catch (e) { /* 권유 렌더 실패 — 아래 폴백으로 내려간다 */ }
      }
      /* 폴백(신호 카드·엔진 미로드) — 알림을 잃지 않기 위해 기존 경로 유지 */
      var al = alertsNow();
      if (!al.length) return;
      popupShown = true;
      var want = { leader: ["qw1", "qw7"], hr: ["qw5", "calib"], exec: ["qw7", "qw5"], member: ["qw2", "qw7"] }[role().key] || [];
      var a = al.filter(function (x) { return want.indexOf(x.screen) >= 0; })[0] || al[0];
      var card = h("div", "agh-popup");
      card.innerHTML = '<div class="hd"><span class="dot"></span>알림</div>' +
        "<b>" + esc(a.title) + "</b><p>" + esc(a.body) + "</p>" +
        '<div class="acts"><button class="agh-btn primary" data-pgo>열어서 확인</button><button class="agh-btn" data-pdis>나중에</button></div><small>1일 뒤 다시 알림 · 승인하면 반영</small>';
      document.body.appendChild(card);
      /* 선제 알림 단일화: 이미 떠 있는 다른 선제 팝업(pill/chip)을 닫고 이 카드로 교체 */
      if (window.EZProactive) EZProactive.claim("agh-popup", function () { if (card.parentNode) card.remove(); });
      requestAnimationFrame(function () { card.classList.add("show"); });
      card.addEventListener("click", function (e) {
        if (e.target.closest("[data-pgo]")) { if (window.EZProactive) EZProactive.release("agh-popup", true); card.remove(); openHub(a.screen); }
        if (e.target.closest("[data-pdis]")) { if (window.EZProactive) EZProactive.release("agh-popup"); card.classList.remove("show"); setTimeout(function () { card.remove(); }, 250); }
      });
    }, 9000);
  }

  /* ============================================================
     open / close / init
     ============================================================ */
  /* openHub(screen, ctx) — ctx {empId, source}로 대상자·진입 출처를 인계받는다.
     (평가관리에서 열면 그 화면에서 보던 직원이 qw3·hold·qw6의 대상자가 된다) */
  function openHub(screen, ctx) {
    buildHub();
    state.open = true;
    /* 인계 컨텍스트는 열 때마다 갱신 — 이전 진입의 대상자가 남아 오염되지 않게 */
    state.ctx = (ctx && (ctx.empId || ctx.source)) ? { empId: ctx.empId || null, source: ctx.source || "" } : null;
    /* 백드롭 클릭으로 닫지 않는다 — 작성 중인 지시·초안이 사라지는 사고 방지(닫기는 ✕ 또는 Esc) */
    el.root.classList.add("on");
    var rc = el.root.querySelector("[data-agh-role]");
    if (rc) rc.textContent = role().label + " 관점 · " + CU().name;
    /* AI 연결 상태 칩 — 실제 EZAI 모드 반영 */
    var ac = el.root.querySelector("[data-agh-alertcnt]");
    if (ac) {
      var an = alertCount();
      ac.textContent = an > 9 ? "9+" : String(an);   /* 도킹 배지와 같은 클램프 */
      ac.setAttribute("title", "처리하지 않은 알림 " + an + "건");
    }
    var ai = el.root.querySelector("[data-agh-ai]");
    if (ai && window.EZAI) {
      var rdy = EZAI.ready && EZAI.ready();
      var md = EZAI.mode ? EZAI.mode() : "offline";
      ai.textContent = rdy ? "● 연결됨" : md === "offline" ? "○ 오프라인 예시 응답" : "◐ AI 연결 전";
      ai.style.color = rdy ? "var(--agh-ok,#15803D)" : md === "offline" ? "" : "var(--agh-warn,#B45309)";
    }
    document.body.style.overflow = "hidden";
    state.stack = [];                 /* 새로 열 때 히스토리 초기화 */
    showScreen(screen || defaultScreen(), { push: false });
  }

  /* ⑤ 결정 흐름 — 허브 자체 procmap 화면 폐기 후 EZJourney로 단일화 */
  function openJourney() {
    if (!(window.EZJourney && EZJourney.open)) {
      toast("결정 흐름 화면(EZJourney)을 불러오지 못했습니다.");
      return false;
    }
    var id = (state.ctx && state.ctx.empId) || null;
    logAudit("결정 흐름 열기", "EZJourney" + (id ? " · " + id : " · 기본 대상"), "journey.open");
    closeHub();
    try { EZJourney.open(id || undefined); } catch (e) { toast("결정 흐름을 열지 못했어요."); return false; }
    return true;
  }

  /* ④ 도킹으로 전환 — 지금 보던 시나리오 요약을 대화에 인계한다 */
  function handoffText() {
    var k = state.screen, s = SCREENS[k];
    if (!s) return "";
    var lines = ["✦ 전체화면 워크스페이스에서 이어옵니다 — <b>" + esc(s.title) + "</b> · " + esc(AS_OF)];
    if (state.ctx && state.ctx.empId) {
      var t = targetEmp();
      lines.push("· 대상자 " + esc(t.name || t.emp_id) + esc(targetNote()));
    }
    var dec = gateDec(k);
    if (dec) lines.push("· 결정 게이트: " + esc(dec.act) + (dec.note ? " — " + esc(dec.note) : ""));
    var v = el.canvas && el.canvas.querySelector("[data-agh-verdict]");
    var vt = v && v.textContent ? v.textContent.trim() : "";
    if (vt) lines.push("· 요약: " + esc(vt.length > 180 ? vt.slice(0, 180) + "…" : vt));
    lines.push("이어서 물어보시면 이 맥락 위에서 답합니다.");
    return lines.join("<br>");
  }
  function dockHandoff() {
    var note = handoffText();
    closeHub();
    if (note && window.EZChat && EZChat.push) {
      try {
        EZChat.push({ role: "ai", text: note.replace(/<br>/g, "\n").replace(/<\/?b>/g, ""), meta: { hubHandoff: true } });
        logAudit("인계", "허브 → 도킹 대화 · " + (SCREENS[state.screen] ? SCREENS[state.screen].title : ""), "hub.handoff");
      } catch (e) { /* 스토어 오류 무시 */ }
    }
    if (window.Elizax && window.Elizax.open) window.Elizax.open();
    if (window.Elizax && window.Elizax.refresh) window.Elizax.refresh();
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
    /* 딥링크로 대상자도 인계 — #ez=hub:qw3&emp=EMP-0123 */
    var empM = window.location.href.match(/[?#&]emp=(EMP-[0-9]+)/i);
    if (hubM) setTimeout(function () {
      openHub(hubM[1] || undefined, empM ? { empId: empM[1].toUpperCase(), source: "딥링크" } : null);
    }, 700);
    if (/[?#&]ez=panel/.test(window.location.href)) setTimeout(function () { if (window.Elizax) Elizax.open(); }, 700);
  }
  if (document.readyState === "complete") setTimeout(init, 400);
  else window.addEventListener("load", function () { setTimeout(init, 400); });

  /* ============================================================
     연결 지도 (데이터의 지도) — 전략–조직목표–개인목표–직무–스킬–역량–평가
     피드백 반영: 기본 HR 데이터-목표 연결이 '보여야' + 연결률 품질지표
     ============================================================ */
  RENDER.connmap = function (host) {
    host = host || el.canvas;
    var d = D(), emps = d.employees || [], objs = d.objectives || [], krs = d.keyResults || [],
        profs = d.jobProfiles || {}, evals = d.evaluations || [], comps = d.competencies || [], co = d.company || {};
    var empById = {}, objById = {}, evalByEmp = {};
    emps.forEach(function (e) { empById[e.emp_id] = e; });
    objs.forEach(function (o) { objById[o.objective_id] = o; });
    evals.forEach(function (v) { evalByEmp[v.emp_id] = v; });
    var withProf = emps.filter(function (e) { return e.jobProfileId; }).length;
    var n = emps.length || 1, rate = Math.round(withProf / n * 100);
    var ownedObjs = objs.filter(function (o) { return o.owner_emp_id; });
    var goalWithProf = ownedObjs.filter(function (o) { return empById[o.owner_emp_id] && empById[o.owner_emp_id].jobProfileId; }).length;
    var goalRate = Math.round(goalWithProf / (ownedObjs.length || 1) * 100);
    var indiv = objs.filter(function (o) { return o.level !== "company" && o.owner_emp_id && empById[o.owner_emp_id] && empById[o.owner_emp_id].jobProfileId; });
    var pick = indiv[0] || ownedObjs[0] || objs[0] || {};
    var owner = empById[pick.owner_emp_id] || {};
    var prof = owner.jobProfileId ? profs[owner.jobProfileId] : null;
    var parent = pick.parent_objective_id ? objById[pick.parent_objective_id] : null;
    var comp = objs.filter(function (o) { return o.level === "company"; })[0] || parent || {};
    var krList = krs.filter(function (k) { return k.objective_id === pick.objective_id; }).slice(0, 3);
    var ev = evalByEmp[owner.emp_id] || {};
    var tasks = prof && prof.tasks ? Object.keys(prof.tasks) : [];
    var skills = prof && prof.skills ? prof.skills.slice(0, 4) : [];
    /* 스킬↔역량 크로스워크(큐레이션 매핑표) — 7축 컬럼 + free-text 키워드 → 역량 D1–D5.
       세 어휘(직무기술서 skills·7축 skills.columns·역량 D1–D5)에 FK가 없어, 매핑표로 연결을 실체화. */
    var XW = { "분석적 사고": "D3", "스크립팅·자동화": "D3", "협업": "D2", "의사소통": "D2", "적극성": "D4", "문제해결력": "D4", "리더십": "D1" };
    function xwalk(s) {
      if (XW[s]) return XW[s];
      if (/리더|leadership|이끌|주도|경영|전략 기획/i.test(s)) return "D1";
      if (/협업|소통|커뮤니|관계|조율|고객/i.test(s)) return "D2";
      if (/분석|데이터|기술|전문|설계|개발|스크립|시장|회계|재무|보안|엔지니어/i.test(s)) return "D3";
      if (/실행|추진|관리|문제 ?해결|운영|프로젝트|기획/i.test(s)) return "D4";
      if (/학습|성장|개선|혁신|변화|육성/i.test(s)) return "D5";
      return "D3";
    }
    var compName = {}; comps.forEach(function (c) { compName[c.dimension_id] = c.name; });
    var skillLinks = skills.map(function (s) { var dd = xwalk(s); return { s: s, d: dd, dn: compName[dd] || dd }; });
    var mappedD = {}; skillLinks.forEach(function (l) { mappedD[l.d] = true; });
    var covPct = skills.length ? Math.round(skillLinks.filter(function (l) { return l.d; }).length / skills.length * 100) : 0;

    function colN(kind, label, inner, inferred) {
      return '<div class="agh-cmcol"><div class="agh-cmh ' + kind + '">' + esc(label) + '</div>' +
        '<div class="agh-cmn' + (inferred ? " inf" : "") + '">' + inner + '</div>' +
        (inferred ? '<div class="agh-cmtag">AI 추론</div>' : '') + '</div>';
    }
    var chain =
      colN("s1", "사업전략", '<b>' + esc(co.revenue_target_2026 || "FY2026 매출 목표") + '</b><span>' + esc((co.business_domains || []).slice(0, 2).join(" · ") || "전사 사업영역") + '</span>') +
      '<div class="agh-cmarrow inf">┈</div>' +
      colN("s2", "조직목표", '<b>' + esc((parent || comp).title || "조직 목표") + '</b><span>' + esc((parent || comp).period || "FY2026") + ' · 진척 ' + (((parent || comp).progress) || 0) + '%</span>') +
      '<div class="agh-cmarrow">→</div>' +
      colN("s3", "개인목표 · KR", '<b>' + esc(pick.title || "개인 목표") + '</b>' + (krList.length ? krList.map(function (k) { return '<span>· ' + esc(k.name) + ' <em>(' + esc(k.weight || "") + ' · 난이도 ' + esc(k.difficulty || "-") + ')</em></span>'; }).join("") : '<span>KR 없음</span>')) +
      '<div class="agh-cmarrow inf">┈</div>' +
      (prof
        ? colN("s4", "직무 (R&R)", '<b>' + esc(prof.title) + '</b><span>' + esc(tasks[0] || "") + (tasks[1] ? " 외 " + (tasks.length - 1) : "") + '</span>', true)
        : colN("s4", "직무 (R&R)", '<b>직무 프로파일 미연결</b><span>' + esc(owner.jobTitle || owner.name || "") + ' — 프로파일 없음</span>', true)) +
      '<div class="agh-cmarrow inf">┈</div>' +
      colN("s5", "스킬", skills.length ? skillLinks.map(function (l) { return '<span>· ' + esc(l.s) + ' <em class="xd">' + l.d + '</em></span>'; }).join("") : '<span>직무 미연결로 스킬 근거 없음</span>', !prof) +
      '<div class="agh-cmarrow xw" title="직무역량 매핑표(큐레이션)">⇢</div>' +
      colN("s6", "역량 (D1–D5)", comps.slice(0, 5).map(function (c) { var on = mappedD[c.dimension_id]; return '<span' + (on ? ' class="xon"' : '') + '>· ' + esc(c.dimension_id) + ' ' + esc(c.name) + (on ? ' ✓' : '') + '</span>'; }).join("") || '<span>역량 사전</span>') +
      '<div class="agh-cmarrow">→</div>' +
      colN("s7", "평가", '<b>' + esc(ev.grade || "-") + '등급</b><span>종합 ' + (ev.weighted_score != null ? ev.weighted_score : "-") + '</span>');

    host.innerHTML = screenHead("connmap") +
      '<div class="agh-cmbar">' +
        '<span class="agh-chip asof">◷ 기준 시점 · ' + esc(AS_OF) + '</span>' +
        '<span class="agh-auditchip">⛨ 감사 기록됨 · 권한 내 전사 조회</span>' +
        '<span class="agh-cmstat">직무 프로파일 연결 <b>' + withProf + '/' + n + ' (' + rate + '%)</b></span>' +
        '<span class="agh-cmstat">직무 근거 있는 목표 <b>' + goalRate + '%</b></span>' +
        '<span class="agh-cmstat">스킬–역량 매핑 <b>' + covPct + '%</b></span>' +
      '</div>' +
      '<div class="agh-cmwrap">' + chain + '</div>' +
      '<div class="agh-cmlegend"><span class="sol">— 실제 데이터 연결(FK)</span><span class="cur">⇢ 큐레이션 매핑(직무역량 매핑표)</span><span class="dsh">┈ AI 추론(FK 부재 · 근거 필요)</span></div>' +
      '<div class="agh-verdict"><b>조직목표→개인목표→평가</b>는 실제 연결(FK), <b>스킬→역량</b>은 직무역량 <b>매핑표(큐레이션)</b>로 실체화(✓ 표시된 ' + Object.keys(mappedD).length + '개 역량 연결). 남은 점선은 <b>전략→목표·목표→직무</b> — 전사 <b>' + (n - withProf) + '명</b> 직무 프로파일 미연결이 근본 원인이라, 목표가 직무에 정박하지 못하면 평가 단계에서 흔들립니다. ' + srcChip("talenx", "objectives.fk") + srcChip("rule", "직무역량 매핑표") + '</div>' +
      '<div class="agh-linkrow"><button class="agh-btn" data-cm-wf>What-if · 직무 프로파일 100% 연결 가정</button><span data-cm-wfout class="agh-cmwfout"></span></div>' +
      gateHTML("connmap", ["AI 추론 연결 승인", "직무 매핑 요청", "보류"]);
    ctxPanelIf(host, [
      { tag: "근거 부재", title: "무엇이 연결되어 있지 않나", body: "objectives는 상위목표·조직·소유자만 참조하고 직무·스킬·전략 참조가 없음. 스킬 어휘 3종(직무기술서 free-text · 7축 · 역량 D1–D5)에 크로스워크 없음. AI 연결의 값어치가 바로 이 지점." },
      { tag: "품질 지표", title: "연결률을 HR 품질 지표로", body: "'직무 근거가 있는 목표 비율'(" + goalRate + "%)을 상시 지표로 노출해 연결 개선을 추적." }
    ]);
    var wf = host.querySelector("[data-cm-wf]");
    if (wf) wf.addEventListener("click", function () {
      var out = host.querySelector("[data-cm-wfout]");
      if (out) out.innerHTML = ' → 연결률 ' + rate + '% → <b>100%</b> 가정 시: 목표의 직무 정박 100%, \'근거 없는 목표\' 0건, 이의제기 대응 근거 충족 <b>+' + (100 - rate) + '%p</b> ' + srcChip("rule", "rule-exec.connfill");
    });
  };

  /* ============================================================
     [폐기] 결정 흐름(procmap) 화면 — EZJourney로 단일화 (F13)
     허브가 자체 계보 화면을 또 그리면서 (a) EZJourney와 두 갈래로 갈라지고
     (b) 대상자가 "evaluations를 가진 첫 직원"이라 조직원이 타인 계보를 보게 되는
     문제가 있었다. SCREENS.procmap.redirect="journey" → showScreen()이 즉시
     window.EZJourney.open(ctx.empId)으로 넘긴다. 내비/홈 카드에는 노출하지 않는다.

     ── 인수인계 메모 (tx_journey.js 담당자에게 · 이 파일에서는 삭제됨) ──
     여기 있던 procmap 고유 자산 3종을 EZJourney 노드 패널로 이관 요청:
       ① What-if 버튼 "중간점검 근거 제외하고 재구성"
          → 중간점검 노드를 빼면 평가 코멘트의 '과정 근거'가 사라져
            '결과만 있는 평가'가 된다는 것을 보여주는 근거-연결 가치 데모.
            (참조 라벨: rule-exec.lineage)
       ② 난이도 근거 경고 (목표수립 노드)
          → keyResults[].difficulty_basis 필드가 비어 있는 KR에 대해
            "난이도 S/A 판단의 근거 필드가 없어 평가 시 분쟁 소지" 경고.
            원자료는 EZCalc.calibDiff().sNoBasis / basisHas 로 이미 계산돼 있음.
       ③ 측정 불가 KR 검사 (목표수립 노드)
          → kr.name·target_value에 정량 기호(숫자·%·억·건·명·점)가 하나도 없으면
            "평가 시점 분쟁 위험 — 작성 시점에 지표화 권고" 경고를 띄우던 검사.
            (동일 규칙 엔진이 EZLint에도 있으니 EZLint.lint(name,"goal") 재사용 권장)
     계보 노드의 감사 표기는 원장 실 id가 있을 때만 — 위조 GA-번호 생성 금지(기존 합의).
     ============================================================ */

  /* ---------------- ⌘K 팔레트 — 슬래시/의도 라우터와 동일 레지스트리(SCREENS·SCENARIOS) 재사용 ---------------- */
  var palEl = null;
  function paletteEntries() {
    var out = NAV_ORDER.map(function (k) { return { key: k, label: SCREENS[k].nav, sub: SCREENS[k].title }; });
    SCENARIOS.forEach(function (sc) { out.push({ key: sc.key, label: sc.chip, sub: SCREENS[sc.key] ? SCREENS[sc.key].nav : "" }); });
    return out;
  }
  function closePalette() { if (palEl) { palEl.remove(); palEl = null; } }
  function openPalette() {
    closePalette();
    palEl = h("div", "agh-pal");
    palEl.innerHTML = '<div class="agh-palbox"><input type="text" placeholder="화면·시나리오 점프… (Esc 닫기)" data-pal-in><div class="agh-pallist" data-pal-list></div></div>';
    document.body.appendChild(palEl);
    var inp = palEl.querySelector("[data-pal-in]"), list = palEl.querySelector("[data-pal-list]"), all = paletteEntries();
    function render(q) {
      q = (q || "").toLowerCase();
      var rows = all.filter(function (e) { return !q || (e.label + " " + e.sub).toLowerCase().indexOf(q) >= 0; }).slice(0, 14);
      list.innerHTML = rows.map(function (e, i) {
        return '<div class="agh-palrow' + (i === 0 ? " sel" : "") + '" data-pal-key="' + esc(e.key) + '">' + esc(e.label) + (e.sub ? ' <small>' + esc(e.sub) + "</small>" : "") + "</div>";
      }).join("") || '<div class="agh-palrow dim">일치 항목 없음</div>';
    }
    render("");
    inp.addEventListener("input", function () { render(inp.value); });
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { closePalette(); return; }
      if (e.key === "Enter") {
        var sel = list.querySelector(".agh-palrow.sel[data-pal-key]") || list.querySelector("[data-pal-key]");
        if (sel) { var k = sel.getAttribute("data-pal-key"); closePalette(); openHub(k); }
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        var rows = Array.prototype.slice.call(list.querySelectorAll("[data-pal-key]"));
        if (!rows.length) return;
        var cur = list.querySelector(".agh-palrow.sel"), idx = rows.indexOf(cur);
        if (cur) cur.classList.remove("sel");
        rows[(idx + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length].classList.add("sel");
      }
    });
    palEl.addEventListener("click", function (e) {
      var r = e.target.closest("[data-pal-key]");
      if (r) { var k = r.getAttribute("data-pal-key"); closePalette(); openHub(k); }
      else if (e.target === palEl) closePalette();
    });
    inp.focus();
  }
  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); palEl ? closePalette() : openPalette(); }
  });

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
