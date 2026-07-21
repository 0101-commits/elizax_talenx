/* ============================================================================
 * tx_ctx_ledger.js — 맥락 원장 Context Ledger (window.EZLedger)
 * ----------------------------------------------------------------------------
 * [기획 스펙]
 * ① 배경/문제
 *    - Agent다운 답을 내려면 Agent가 "무엇을 알고 있는지"가 관건인데,
 *      성과관리 전 과정에서 발생하는 맥락(목표·체크인, 평가 이력, 1on1 로그,
 *      피드백, 조직/직무 기준, 규칙)이 흩어져 있고 사용자에게 보이지 않는다.
 *    - AI 답변이 무엇을 근거로 판단했는지 드러나지 않아 신뢰가 쌓이지 않고,
 *      "기능을 쓸수록 답이 좋아지는" 플라이휠도 체감되지 않는다.
 * ② 사용자 시나리오
 *    - 사용자가 목표 체크인·1on1 기록 등 기능을 쓰면(ez:ctx 이벤트) 맥락이
 *      원장에 자동 축적되고 토스트("맥락 원장에 축적됨 · …")로 알려준다.
 *    - elizax FAB 근처의 "맥락 N" pill을 누르면 우측 슬라이드 원장 패널이
 *      열려 type별 칩 필터·시간 역순 타임라인으로 축적 맥락을 훑어본다.
 *    - elizax AI 답변 아래에는 "근거 · 맥락 N건" 스트립이 붙어 이번 답이
 *      어떤 맥락을 인용했는지 보여주고(역할별 core/trace/logic 노출 수위),
 *      trace 이상에서는 칩 클릭으로 원장의 해당 항목까지 점프한다.
 * ③ 동작 정의
 *    - 스토어: localStorage `elizax_ctx_v1:<emp_id>`, 항목 {id, at, ts, type,
 *      source, title, summary, weight(1~3), usedCount}, 상한 80건(오래된 것 탈락).
 *    - 시드: 스토어가 비면 현재 사용자 기준 9~12건 주입 — 목표 2~3(가능하면
 *      TALENX_DATA.objectives의 실제 owner 목표 제목), 체크인 2(실제 체크인
 *      코멘트), 1on1 2, 피드백 1, 직무 기대역량 1, 평가 이력 1, 규칙 1.
 *      as-of는 5~7월 분산 고정 문자열. leader/hr/exec 역할이면 팀/전사 관점
 *      항목 1~2건 추가.
 *    - `ez:ctx` CustomEvent(detail={type,source,title,summary,weight?}) 수신 →
 *      add + 토스트 + 배지 갱신. 신규 항목 at은 new Date 기반 "M/D HH:MM".
 *    - 근거칩: EZChat.on("messages") 수신 240ms 후(followups 패턴) 보이는
 *      대화 리스트의 마지막 AI 말풍선 아래 근거 스트립 주입.
 *      msg.meta.ctxRefs(id 배열) 있으면 그대로, 없으면 답변 텍스트를 규칙
 *      기반(키워드→type/제목 토큰 매칭) 상위 2~4건 선택 후 meta.ctxRefs 기록
 *      + EZChat.persist() + 해당 항목 usedCount 증가(최초 배정 시 1회만).
 *    - 노출 수위는 window.EZEvidencePolicy[역할] (없으면 전부 "core"):
 *      core=요약칩+미니칩 / trace=+source 표기·"원장에서 보기"(openPanel(id))
 *      / logic=+"산출 로직 보기" 팝오버(①입력 수집 ②규칙 적용 ③모델 판단
 *      ④검증 — 결정 게이트·승인 전 side-effect 0) + "감사 기록됨 · GA-26xxx".
 * ④ 엣지 케이스
 *    - "messages" 재렌더마다 기존 스트립 전부 제거 후 재주입. 스트리밍 중
 *      (streaming {on:true})에는 주입하지 않고 종료 후 렌더.
 *    - 마지막 AI 메시지가 없거나 빈 텍스트·err면, 또 보이는 대화 리스트가
 *      없으면(패널·허브 모두 닫힘) 스킵.
 *    - 화면 재렌더로 DOM이 리셋되므로 클릭은 document 위임만 사용.
 *    - 같은 source+title이 60초 내 재발화되면 중복 축적하지 않는다.
 *    - FAB(.ezx-root)을 못 찾으면 우하단 자체 미니 pill로 폴백. FAB 도킹창이
 *      열리면(.ezx-open) 배지는 숨겨 패널과 겹치지 않게 한다.
 *    - 전역(EZChat/TXRoles/TALENX_DATA/TX.toast)은 존재 확인 후 사용,
 *      EZChat이 늦게 뜨면 300ms 간격 최대 20회 폴링으로 결선한다.
 * ========================================================================== */
(function () {
  "use strict";

  var LS_PREFIX = "elizax_ctx_v1:";
  var MAX_ITEMS = 80;
  var RENDER_DELAY = 240;
  var Z_PANEL = 100020;     /* quickask(100010)·fix_home(100001)보다 위 */

  var DATA = window.TALENX_DATA || {};
  var CU = (DATA.meta && DATA.meta.currentUser) || { emp_id: "anon" };
  var KEY = LS_PREFIX + (CU.emp_id || "anon");

  var items = null;          /* lazy-loaded 배열 */
  var filterType = "";       /* 패널 type 필터 ("" = 전체) */
  var renderTimer = null;
  var streamingOn = false;
  var seq = 0;

  /* ---------------- type 메타 ---------------- */
  var TYPES = {
    goal:     { label: "목표",     color: "#1F7AF0" },
    checkin:  { label: "체크인",   color: "#15803D" },
    oneonone: { label: "1on1",     color: "#6D28D9" },
    feedback: { label: "피드백",   color: "#B45309" },
    eval:     { label: "평가 이력", color: "#B42318" },
    org:      { label: "조직 기준", color: "#0E7490" },
    job:      { label: "직무 기준", color: "#334155" },
    rule:     { label: "규칙",     color: "#166534" }
  };
  var TYPE_ORDER = ["goal", "checkin", "oneonone", "feedback", "eval", "org", "job", "rule"];

  /* ---------------- 유틸 ---------------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function norm(s) { return String(s || "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, ""); }
  function z2(n) { return (n < 10 ? "0" : "") + n; }
  function nowStamp() {
    var t = new Date();
    return (t.getMonth() + 1) + "/" + t.getDate() + " " + z2(t.getHours()) + ":" + z2(t.getMinutes());
  }
  function uid() {
    return "ctx-" + Date.now().toString(36) + "-" + (++seq) + Math.random().toString(36).slice(2, 6);
  }
  function closestAttr(node, attr) {
    var n = node;
    while (n && n !== document) {
      if (n.getAttribute && n.getAttribute(attr) != null) return n;
      n = n.parentNode;
    }
    return null;
  }
  function toast(msg) {
    try { if (window.TX && TX.toast) TX.toast(msg, "ok"); } catch (e) { /* 무시 */ }
  }
  function roleKey() {
    try {
      if (window.TXRoles && TXRoles.current) return (TXRoles.current() || {}).key || "member";
    } catch (e) { /* 역할 미확정 */ }
    return CU.is_leader ? "leader" : "member";
  }
  function shorten(s, n) {
    s = norm(s);
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }
  function hashNum(s) {
    var h = 0, i;
    s = String(s || "");
    for (i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return Math.abs(h);
  }

  /* ================= 스토어 ================= */
  function loadStore() {
    if (items) return items;
    items = [];
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var obj = JSON.parse(raw);
        if (obj && Object.prototype.toString.call(obj.items) === "[object Array]") {
          items = obj.items.filter(function (it) { return it && it.id && it.type && it.title; });
        }
      }
    } catch (e) { items = []; }
    if (!items.length) {
      items = buildSeeds();
      saveStore();
    }
    return items;
  }
  function saveStore() {
    try {
      if (items.length > MAX_ITEMS) {
        items.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
        items = items.slice(items.length - MAX_ITEMS);
      }
      localStorage.setItem(KEY, JSON.stringify({ v: 1, items: items }));
    } catch (e) { /* storage 불가 환경 무시 */ }
  }
  function sorted() {
    return loadStore().slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
  }
  function byId(id) {
    var arr = loadStore();
    for (var i = 0; i < arr.length; i++) { if (arr[i].id === id) return arr[i]; }
    return null;
  }

  /* 시드용 고정 ts — "5/12 10:00" 같은 표시 문자열과 순서 정합만 맞으면 됨 */
  function seedTs(mon, day, hh, mm) {
    return new Date(2026, mon - 1, day, hh, mm, 0, 0).getTime();
  }
  function mkSeed(mon, day, hh, mm, type, source, title, summary, weight, used) {
    return {
      id: uid(), ts: seedTs(mon, day, hh, mm),
      at: mon + "/" + day + " " + z2(hh) + ":" + z2(mm),
      type: type, source: source, title: norm(title), summary: norm(summary),
      weight: weight || 1, usedCount: used || 0
    };
  }

  /* ---------------- 시드 데이터 (현재 사용자 기준 9~12건) ---------------- */
  function buildSeeds() {
    var out = [];
    var objs = (DATA.objectives || []).filter(function (o) { return o && o.owner_emp_id === CU.emp_id; });
    var mgr = CU.managerName ? CU.managerName + " 리더" : "리더";
    var jobTitle = CU.jobTitle || "담당 직무";
    var role = roleKey();

    /* 목표 2~3 — 실제 owner 목표 제목 우선, 부족하면 상위/조직 목표로 보강 */
    var g = 0, i, o;
    for (i = 0; i < objs.length && g < 2; i++) {
      o = objs[i];
      out.push(mkSeed(5, 4, 9, 30 + g, "goal", "perf.obj." + (o.objective_id || ("OWN-" + i)),
        o.title,
        (o.period || "FY2026-2Q") + " · " + (o.status || "진행중") + " · 진행률 " + (o.progress != null ? o.progress + "%" : "-"),
        3, 2 - g));
      g++;
    }
    if (g < 2 && objs[0] && objs[0].parent_objective_id) {
      var parent = (DATA.objectives || []).filter(function (p) { return p.objective_id === objs[0].parent_objective_id; })[0];
      if (parent) {
        out.push(mkSeed(5, 4, 9, 40, "goal", "perf.obj." + parent.objective_id,
          "상위 정렬: " + parent.title, "개인 목표가 정렬된 상위 목표 · 진행률 " + (parent.progress != null ? parent.progress + "%" : "-"), 2, 1));
        g++;
      }
    }
    while (g < 2) {
      out.push(mkSeed(5, 4, 9, 45, "goal", "perf.obj.local." + g,
        "FY2026-2Q " + jobTitle + " 핵심 목표", "분기 목표 수립 · KR 2건 · 가중치 합 100%", 3, 1));
      g++;
    }

    /* 체크인 2 — 실제 체크인 코멘트가 있으면 사용 */
    var cks = (DATA.checkins || []).filter(function (c) { return c && c.emp_id === CU.emp_id && c.comment; });
    cks.sort(function (a, b) { return String(a.checkin_date || "") < String(b.checkin_date || "") ? 1 : -1; });
    var ckSeeds = [
      { mon: 6, day: 20, hh: 17, mm: 40 },
      { mon: 6, day: 27, hh: 18, mm: 10 }
    ];
    for (i = 0; i < 2; i++) {
      var c = cks[i];
      var slot = ckSeeds[i];
      if (c && c.checkin_date) {
        var md = String(c.checkin_date).split("-");
        if (md.length === 3) { slot = { mon: parseInt(md[1], 10) || slot.mon, day: parseInt(md[2], 10) || slot.day, hh: slot.hh, mm: slot.mm }; }
      }
      out.push(mkSeed(slot.mon, slot.day, slot.hh, slot.mm, "checkin",
        "perf.checkin." + z2(slot.mon) + z2(slot.day),
        "주간 체크인 (" + slot.mon + "/" + slot.day + ")",
        c ? c.comment + (c.confidence ? " · 확신도 " + c.confidence : "") : "진행률 업데이트 · 블로커 없음",
        2, i === 0 ? 3 : 1));
    }

    /* 1on1 노트 2 */
    out.push(mkSeed(5, 28, 15, 0, "oneonone", "1on1.rec.0528",
      mgr + "와 1on1 (5/28)", "분기 목표 우선순위 재확인 · 협업 리소스 요청 1건 합의", 2, 1));
    out.push(mkSeed(6, 30, 16, 30, "oneonone", "1on1.rec.0630",
      mgr + "와 1on1 (6/30)", "리뷰 단계 병목 이슈 논의 · 7월 개선 액션 2건 합의", 2, 2));

    /* 피드백 1 */
    out.push(mkSeed(6, 12, 11, 20, "feedback", "perf.fb.0612",
      "동료 피드백 — 프로젝트 리뷰", "SBI: 검증 프로세스 설계가 협업 품질을 높였다는 동료 2인 피드백", 1, 1));

    /* 직무 기대역량 1 */
    out.push(mkSeed(5, 2, 10, 0, "job", "job.profile." + (CU.job_id || "JOB"),
      jobTitle + " 기대역량 기준", (CU.level_kr || "구성원") + " 레벨 기대치 · 핵심역량 5종 매핑", 2, 1));

    /* 평가 이력 1 */
    out.push(mkSeed(5, 10, 14, 0, "eval", "eval.FY2025H2." + CU.emp_id,
      "FY2025 하반기 평가 이력", "종합 등급·리뷰 코멘트 · 강점: 실행력 / 보완: 위임", 3, 2));

    /* 규칙 1 */
    out.push(mkSeed(5, 1, 9, 0, "rule", "rule.weight.sum",
      "rule.weight.sum — KR 가중치 합 100%", "목표 가중치 검증 규칙 · 위반 시 저장 차단 · 기준 시점 데이터 기준", 3, 3));

    /* leader/hr/exec — 팀/전사 관점 1~2건 */
    if (role === "leader") {
      out.push(mkSeed(7, 7, 9, 10, "org", "org.team.checkin.wk27",
        "팀 체크인 커버리지 주간 집계", "팀원 체크인 제출률 · 부진 2인 식별 · 진척 델타 요약", 2, 2));
      out.push(mkSeed(7, 14, 10, 0, "org", "org.align.map." + (CU.org_id || "ORG"),
        (CU.orgName || "우리 조직") + " 목표 정렬 맵", "팀 목표-개인 목표 정렬 상태 · 미정렬 1건", 2, 1));
    } else if (role === "hr" || role === "exec") {
      out.push(mkSeed(7, 7, 9, 10, "org", "org.dist.FY2026H1",
        "전사 평가 분포 기준선", "등급 분포 가이드 · 관대화/중심화 편향 모니터링 지표", 3, 2));
      out.push(mkSeed(7, 14, 10, 0, "rule", "rule.calibration.gate",
        "rule.calibration.gate — 캘리브레이션 게이트", "조정은 심의 게이트 통과 후 확정 · 승인 전에는 반영되지 않음", 3, 1));
    }

    return out;
  }

  /* ---------------- add / dedup ---------------- */
  function addEntry(entry) {
    if (!entry || !entry.title) return null;
    loadStore();
    var type = TYPES[entry.type] ? entry.type : "org";
    var title = norm(entry.title);
    var source = norm(entry.source || "app.event");
    /* 60초 내 같은 source+title 재발화는 중복 축적하지 않음 */
    for (var i = items.length - 1; i >= 0; i--) {
      var it = items[i];
      if (it.source === source && it.title === title && Date.now() - (it.ts || 0) < 60000) return it;
    }
    var w = parseInt(entry.weight, 10);
    if (!(w >= 1 && w <= 3)) w = 1;
    var e = {
      id: uid(), ts: Date.now(), at: nowStamp(),
      type: type, source: source, title: title,
      summary: norm(entry.summary || ""), weight: w, usedCount: 0
    };
    items.push(e);
    saveStore();
    updateBadge();
    if (isPanelOpen()) renderPanelBody(null);
    return e;
  }

  /* ================= 스타일 ================= */
  function injectStyle() {
    if (document.getElementById("ezl-style")) return;
    var css = [
      /* ---- 배지 pill ---- */
      ".ezl-badge{position:fixed;right:18px;bottom:86px;z-index:898;cursor:pointer;",
      "display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;",
      "color:#1F7AF0;background:#fff;border:1px solid rgba(31,122,240,.35);border-radius:999px;",
      "padding:4px 11px;box-shadow:0 4px 14px rgba(0,0,0,.12);user-select:none;",
      "transition:transform .15s cubic-bezier(.32,.72,.24,1),box-shadow .15s;}",
      ".ezl-badge:hover{box-shadow:0 6px 18px rgba(31,122,240,.25);}",
      ".ezl-badge:active{transform:scale(.95);}",
      ".ezl-badge .dot{width:6px;height:6px;border-radius:50%;background:#1F7AF0;}",
      ".ezl-badge.bump{animation:ezlBump .4s cubic-bezier(.32,.72,.24,1);}",
      "@keyframes ezlBump{0%{transform:scale(1)}40%{transform:scale(1.18)}100%{transform:scale(1)}}",
      ".ezx-root.ezx-open .ezl-badge{display:none;}",
      /* ---- 패널 ---- */
      ".ezl-scrim{position:fixed;inset:0;z-index:" + (Z_PANEL - 1) + ";background:rgba(20,24,32,.34);",
      "opacity:0;transition:opacity .22s;pointer-events:none;}",
      ".ezl-scrim.on{opacity:1;pointer-events:auto;}",
      ".ezl-panel{position:fixed;top:0;right:0;bottom:0;z-index:" + Z_PANEL + ";width:430px;max-width:94vw;",
      "background:#fff;color:#1d1d1f;display:flex;flex-direction:column;color-scheme:light;",
      "box-shadow:-18px 0 48px rgba(0,0,0,.2);transform:translateX(103%);",
      "transition:transform .26s cubic-bezier(.32,.72,.24,1);font-size:13px;letter-spacing:-.01em;}",
      ".ezl-panel.on{transform:translateX(0);}",
      ".ezl-head{flex:none;padding:16px 18px 12px;border-bottom:1px solid #e8e8ed;}",
      ".ezl-head-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;}",
      ".ezl-title{font-size:15.5px;font-weight:700;letter-spacing:-.02em;}",
      ".ezl-title small{font-size:11px;font-weight:600;color:#7a7a7a;margin-left:6px;}",
      ".ezl-x{flex:none;font:inherit;font-size:15px;line-height:1;color:#424245;background:#f5f5f7;",
      "border:none;border-radius:999px;width:26px;height:26px;cursor:pointer;}",
      ".ezl-x:hover{background:#e8e8ed;}",
      ".ezl-sub{margin-top:6px;display:flex;align-items:center;gap:8px;font-size:11px;color:#7a7a7a;}",
      ".ezl-asof{color:#1F7AF0;background:#fff;border:1px solid #d2d2d7;border-radius:999px;padding:2px 9px;font-weight:600;}",
      /* ---- 요약 스트립 ---- */
      ".ezl-strip{flex:none;display:flex;flex-wrap:wrap;gap:5px;padding:10px 18px;border-bottom:1px solid #e8e8ed;background:#f5f5f7;}",
      ".ezl-tchip{font:inherit;font-size:10.5px;font-weight:600;cursor:pointer;border-radius:999px;padding:3px 9px;",
      "background:#fff;border:1px solid #d2d2d7;color:#424245;transition:background .12s,border-color .12s;}",
      ".ezl-tchip b{font-weight:800;margin-left:3px;}",
      ".ezl-tchip.on{color:#fff !important;border-color:transparent;}",
      /* ---- 타임라인 ---- */
      ".ezl-body{flex:1;min-height:0;overflow-y:auto;padding:12px 18px 16px;}",
      ".ezl-item{position:relative;padding:9px 10px 9px 14px;border:1px solid #e8e8ed;border-radius:11px;margin-bottom:8px;background:#fff;}",
      ".ezl-item::before{content:'';position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:3px;background:var(--ezl-c,#1F7AF0);}",
      ".ezl-row1{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}",
      ".ezl-tb{font-size:9.5px;font-weight:700;border-radius:5px;padding:1.5px 6px;color:#fff;background:var(--ezl-c,#1F7AF0);}",
      ".ezl-at{font-size:10.5px;color:#7a7a7a;}",
      ".ezl-w{margin-left:auto;font-size:9px;letter-spacing:2px;color:var(--ezl-c,#1F7AF0);white-space:nowrap;}",
      ".ezl-it-title{font-size:12.5px;font-weight:600;margin:5px 0 2px;line-height:1.45;}",
      ".ezl-it-sum{font-size:11.5px;color:#424245;line-height:1.5;}",
      ".ezl-row2{display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap;}",
      ".ezl-src{font-family:ui-monospace,'SFMono-Regular',Consolas,monospace;font-size:9.5px;color:#6D28D9;",
      "background:rgba(109,40,217,.07);border:1px solid rgba(109,40,217,.28);border-radius:5px;padding:1.5px 6px;}",
      ".ezl-used{font-size:10px;color:#7a7a7a;}",
      ".ezl-used.hot{color:#15803D;font-weight:700;}",
      ".ezl-item.ezl-hl{animation:ezlFlash 1.8s ease-out 2;}",
      "@keyframes ezlFlash{0%{background:rgba(31,122,240,.14);border-color:#1F7AF0;}100%{background:#fff;border-color:#e8e8ed;}}",
      ".ezl-empty{padding:30px 8px;text-align:center;color:#7a7a7a;font-size:12px;}",
      ".ezl-foot{flex:none;padding:11px 18px;border-top:1px solid #e8e8ed;background:#f5f5f7;",
      "font-size:11px;line-height:1.55;color:#424245;}",
      ".ezl-foot b{color:#1F7AF0;}",
      ".ezl-foot-policy{display:inline-flex;align-items:center;gap:4px;margin-left:6px;font:inherit;",
      "font-size:10.5px;font-weight:700;color:#1F7AF0;background:#fff;border:1px solid rgba(31,122,240,.35);",
      "border-radius:999px;padding:2px 9px;cursor:pointer;vertical-align:1px;transition:background .12s;}",
      ".ezl-foot-policy:hover{background:rgba(31,122,240,.08);}",
      /* ---- 답변 근거 스트립 ---- */
      ".ezl-ev-wrap{display:flex;flex-wrap:wrap;align-items:center;gap:5px;padding:3px 4px 7px;}",
      ".ezl-ev-cap{font-size:10.5px;font-weight:700;color:#424245;background:#f5f5f7;",
      "border:1px solid #e0e0e0;border-radius:999px;padding:3px 9px;white-space:nowrap;}",
      ".ezl-ev-chip{display:inline-flex;align-items:center;gap:4px;max-width:100%;font-size:10.5px;line-height:1.4;",
      "border-radius:999px;padding:3px 9px;border:1px solid rgba(31,122,240,.3);background:rgba(31,122,240,.06);",
      "color:#1d2433;user-select:none;}",
      ".ezl-ev-chip .tb{font-size:9px;font-weight:800;color:var(--ezl-c,#1F7AF0);}",
      ".ezl-ev-chip .sr{font-family:ui-monospace,Consolas,monospace;font-size:9px;color:#7a7a7a;}",
      ".ezl-ev-chip.click{cursor:pointer;}",
      ".ezl-ev-chip.click:hover{background:rgba(31,122,240,.13);border-color:#1F7AF0;}",
      ".ezl-ev-link,.ezl-ev-logic{font:inherit;font-size:10.5px;font-weight:700;cursor:pointer;border-radius:999px;",
      "padding:3px 10px;border:1px solid #d2d2d7;background:#fff;color:#1F7AF0;transition:background .12s;}",
      ".ezl-ev-link:hover,.ezl-ev-logic:hover{background:#f5f5f7;border-color:#1F7AF0;}",
      ".ezl-ev-logic{color:#6D28D9;border-color:rgba(109,40,217,.35);}",
      /* ---- 산출 로직 팝오버 ---- */
      ".ezl-pop{position:fixed;z-index:" + (Z_PANEL + 10) + ";width:330px;max-width:92vw;background:#fff;color:#1d1d1f;",
      "border:1px solid #e0e0e0;border-radius:13px;box-shadow:0 18px 50px rgba(0,0,0,.24);padding:13px 14px;",
      "font-size:11.5px;line-height:1.55;color-scheme:light;}",
      ".ezl-pop h4{margin:0 0 8px;font-size:12.5px;font-weight:700;letter-spacing:-.02em;}",
      ".ezl-step{display:flex;gap:8px;margin-bottom:7px;}",
      ".ezl-step .n{flex:none;width:17px;height:17px;border-radius:50%;background:#1F7AF0;color:#fff;",
      "font-size:9.5px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;margin-top:1px;}",
      ".ezl-step .t b{display:block;font-size:11px;}",
      ".ezl-step .t span{color:#424245;font-size:10.5px;}",
      ".ezl-step .t code{font-family:ui-monospace,Consolas,monospace;font-size:9.5px;color:#166534;",
      "background:rgba(21,128,61,.07);border:1px solid rgba(21,128,61,.3);border-radius:4px;padding:0 4px;}",
      ".ezl-pop-ga{margin-top:9px;padding-top:8px;border-top:1px dashed #e0e0e0;font-size:10px;color:#7a7a7a;}",
      ".ezl-pop-ga b{color:#B45309;font-family:ui-monospace,Consolas,monospace;}",
      "@media (prefers-reduced-motion:reduce){.ezl-panel,.ezl-scrim,.ezl-badge{transition:none !important;animation:none !important;}}"
    ].join("");
    var st = document.createElement("style");
    st.id = "ezl-style";
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ================= 배지 ================= */
  function ensureBadge() {
    var b = document.getElementById("ezl-badge");
    if (b) return b;
    b = document.createElement("button");
    b.type = "button";
    b.id = "ezl-badge";
    b.className = "ezl-badge";
    b.title = "성과 히스토리 열기";
    var host = document.querySelector(".ezx-root") || document.body;
    host.appendChild(b);
    return b;
  }
  function updateBadge(bump) {
    var b = ensureBadge();
    b.innerHTML = '<span class="dot"></span>히스토리 ' + loadStore().length;
    if (bump) {
      b.classList.remove("bump");
      void b.offsetWidth; /* reflow로 애니 재시작 */
      b.classList.add("bump");
    }
  }

  /* ================= 원장 패널 ================= */
  function panelEl() { return document.getElementById("ezl-panel"); }
  function isPanelOpen() {
    var p = panelEl();
    return !!(p && p.classList.contains("on"));
  }

  function ensurePanel() {
    var p = panelEl();
    if (p) return p;
    var scrim = document.createElement("div");
    scrim.id = "ezl-scrim";
    scrim.className = "ezl-scrim";
    scrim.setAttribute("data-ezl-close", "1");
    document.body.appendChild(scrim);

    p = document.createElement("aside");
    p.id = "ezl-panel";
    p.className = "ezl-panel";
    p.setAttribute("role", "dialog");
    p.setAttribute("aria-label", "성과 히스토리");
    document.body.appendChild(p);
    return p;
  }

  function typeChipHtml(t, n, on) {
    var meta = TYPES[t];
    var style = on ? ' style="background:' + meta.color + ';border-color:' + meta.color + '"' : "";
    return '<button type="button" class="ezl-tchip' + (on ? " on" : "") + '" data-ezl-filter="' + t + '"' + style + ">"
      + esc(meta.label) + "<b>" + n + "</b></button>";
  }

  function weightDots(w) {
    var s = "";
    for (var i = 1; i <= 3; i++) s += (i <= w ? "●" : "○");
    return s;
  }

  function itemHtml(it, hl) {
    var meta = TYPES[it.type] || TYPES.org;
    var used = it.usedCount || 0;
    return '<div class="ezl-item' + (hl ? " ezl-hl" : "") + '" data-ezl-id="' + esc(it.id) + '" style="--ezl-c:' + meta.color + '">'
      + '<div class="ezl-row1"><span class="ezl-tb">' + esc(meta.label) + "</span>"
      + '<span class="ezl-at">' + esc(it.at || "") + "</span>"
      + '<span class="ezl-w" title="판단 기여도 ' + it.weight + "/3\">" + weightDots(it.weight || 1) + "</span></div>"
      + '<div class="ezl-it-title">' + esc(it.title) + "</div>"
      + (it.summary ? '<div class="ezl-it-sum">' + esc(it.summary) + "</div>" : "")
      + '<div class="ezl-row2"><span class="ezl-src">' + esc(it.source || "") + "</span>"
      + '<span class="ezl-used' + (used > 0 ? " hot" : "") + '">답변 인용 ' + used + "회</span></div>"
      + "</div>";
  }

  function renderPanelBody(highlightId) {
    var p = ensurePanel();
    var arr = sorted();
    var counts = {}, i;
    for (i = 0; i < arr.length; i++) counts[arr[i].type] = (counts[arr[i].type] || 0) + 1;

    var chips = '<button type="button" class="ezl-tchip' + (filterType ? "" : " on") + '" data-ezl-filter=""'
      + (filterType ? "" : ' style="background:#1d1d1f;border-color:#1d1d1f"') + ">전체<b>" + arr.length + "</b></button>";
    for (i = 0; i < TYPE_ORDER.length; i++) {
      var t = TYPE_ORDER[i];
      if (counts[t]) chips += typeChipHtml(t, counts[t], filterType === t);
    }

    var list = "";
    var shown = 0;
    for (i = 0; i < arr.length; i++) {
      if (filterType && arr[i].type !== filterType) continue;
      list += itemHtml(arr[i], highlightId && arr[i].id === highlightId);
      shown++;
    }
    if (!shown) list = '<div class="ezl-empty">해당 유형의 기록이 아직 없습니다.<br>기능을 사용하면 자동으로 기록됩니다.</div>';

    p.innerHTML =
      '<div class="ezl-head"><div class="ezl-head-top">'
      + '<div class="ezl-title">성과 히스토리<small>Performance History</small></div>'
      + '<button type="button" class="ezl-x" data-ezl-close="1" aria-label="닫기">×</button></div>'
      + '<div class="ezl-sub"><span class="ezl-asof">기준 시점 2026 상반기 · ' + esc(nowStamp()) + " 기준</span>"
      + "<span>총 <b>" + arr.length + "</b>건 기록</span></div></div>"
      + '<div class="ezl-strip">' + chips + "</div>"
      + '<div class="ezl-body">' + list + "</div>"
      + '<div class="ezl-foot">기능을 쓸수록 성과 기록이 쌓이고, 답변마다 어떤 기록을 인용했는지 남습니다. <b>기록은 자동, 인용은 투명.</b> · 데모: 브라우저에 최근 80건 보관 '
      + '<button type="button" class="ezl-foot-policy" data-ezl-policy="1">🔒 보관·열람 규칙</button>'
      + (window.EZJourney && EZJourney.open
        ? '<button type="button" class="ezl-foot-policy" data-ezl-journey="1" title="이 기록들을 시간순이 아니라 프로세스 단계 순서로 봅니다">&#9672; 프로세스 순서로 보기</button>'
        : "")
      + "</div>";

    if (highlightId) {
      setTimeout(function () {
        var node = p.querySelector('[data-ezl-id="' + highlightId + '"]');
        if (node && node.scrollIntoView) {
          try { node.scrollIntoView({ block: "center", behavior: "smooth" }); }
          catch (e) { node.scrollIntoView(); }
        }
      }, 280);
    }
  }

  function openPanel(highlightId) {
    injectStyle();
    var p = ensurePanel();
    renderPanelBody(highlightId || null);
    var scrim = document.getElementById("ezl-scrim");
    /* transition 발동을 위해 다음 프레임에 .on */
    void p.offsetWidth;
    p.classList.add("on");
    if (scrim) scrim.classList.add("on");
  }
  function closePanel() {
    var p = panelEl();
    var scrim = document.getElementById("ezl-scrim");
    if (p) p.classList.remove("on");
    if (scrim) scrim.classList.remove("on");
    closeLogicPop();
  }

  /* ================= 답변 근거칩 ================= */

  /* 노출 수위: window.EZEvidencePolicy(tx_entry 정의)에서 역할별 조회, 없으면 core */
  function evidenceLevel() {
    var pol = window.EZEvidencePolicy;
    if (!pol || typeof pol !== "object") return "core";
    var lv = pol[roleKey()];
    return (lv === "trace" || lv === "logic" || lv === "core") ? lv : "core";
  }

  /* 키워드 → type 가중 매핑 (규칙 기반, 오프라인 성립) */
  var MATCH_RULES = [
    { re: /등급|평가|리뷰|산출/,            types: ["eval", "rule"] },
    { re: /목표|KR|정렬|가중치|OKR/i,       types: ["goal", "rule"] },
    { re: /체크인|진척|진행률|달성률/,       types: ["checkin", "goal"] },
    { re: /1on1|1:1|원온원|미팅|면담/i,      types: ["oneonone"] },
    { re: /피드백|SBI|코칭/i,               types: ["feedback"] },
    { re: /역량|직무|기대|성장/,             types: ["job"] },
    { re: /팀|조직|전사|분포|캘리브레이션/,  types: ["org", "rule"] }
  ];

  function pickRefs(text) {
    var arr = loadStore();
    if (!arr.length) return [];
    var typeScore = {}, i, j;
    for (i = 0; i < MATCH_RULES.length; i++) {
      if (MATCH_RULES[i].re.test(text)) {
        for (j = 0; j < MATCH_RULES[i].types.length; j++) {
          typeScore[MATCH_RULES[i].types[j]] = (typeScore[MATCH_RULES[i].types[j]] || 0) + 2;
        }
      }
    }
    var scored = [];
    for (i = 0; i < arr.length; i++) {
      var it = arr[i];
      var s = (typeScore[it.type] || 0);
      /* 제목 토큰 매칭 (2자 이상 토큰이 답변에 등장하면 가산) */
      var toks = norm(it.title).split(/[\s·—\-():,/]+/);
      for (j = 0; j < toks.length; j++) {
        if (toks[j].length >= 2 && text.indexOf(toks[j]) >= 0) s += 1.5;
      }
      s += (it.weight || 1) * 0.5;                 /* 판단 기여도 가중 */
      if (s > 0) scored.push({ it: it, s: s });
    }
    scored.sort(function (a, b) { return b.s - a.s || (b.it.ts || 0) - (a.it.ts || 0); });
    /* 키워드 매칭이 전혀 없으면 weight 상위 2건 폴백 (근거 0건 답변 방지) */
    var picked = [];
    if (!scored.length) {
      var byW = arr.slice().sort(function (a, b) { return (b.weight || 0) - (a.weight || 0) || (b.ts || 0) - (a.ts || 0); });
      for (i = 0; i < byW.length && picked.length < 2; i++) picked.push(byW[i].id);
      return picked;
    }
    var max = Math.min(4, Math.max(2, scored.length));
    for (i = 0; i < scored.length && picked.length < max; i++) picked.push(scored[i].it.id);
    return picked;
  }

  function removeStrips() {
    var nodes = document.querySelectorAll(".ezl-ev-wrap");
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
    }
  }

  function isVisible(elm) { return !!(elm && elm.offsetParent !== null); }
  function findVisibleList() {
    var agh = document.querySelector(".agh-root.on [data-agh-chatlist]");
    if (isVisible(agh)) return agh;
    var ezx = document.querySelector(".ezx-root.ezx-open .ezx-list");
    if (isVisible(ezx)) return ezx;
    var anyAgh = document.querySelector("[data-agh-chatlist]");
    if (isVisible(anyAgh)) return anyAgh;
    var anyEzx = document.querySelector(".ezx-list");
    if (isVisible(anyEzx)) return anyEzx;
    return null;
  }
  function lastAiNode(list) {
    var nodes = list.querySelectorAll(".ezx-msg.ai");
    return nodes.length ? nodes[nodes.length - 1] : null;
  }
  /* 스토어 기준 마지막 AI 메시지 객체 (live 참조 — meta 기록용) */
  function lastAiMsg() {
    if (!window.EZChat || !EZChat.messages) return null;
    var arr = EZChat.messages() || [];
    for (var i = arr.length - 1; i >= 0; i--) {
      var m = arr[i];
      if (!m) continue;
      if (m.role === "err") return null;
      if (m.role === "ai") return norm(m.text) ? m : null;
      if (m.role === "user") return null;
    }
    return null;
  }

  function gaId(text) {
    return "GA-26" + String(100 + (hashNum(text) % 900));
  }

  function renderStrip() {
    removeStrips();
    if (streamingOn) return;
    var msg = lastAiMsg();
    if (!msg) return;
    var list = findVisibleList();
    if (!list) return;
    var anchor = lastAiNode(list);
    if (!anchor) return;

    /* 근거 선택 — 기왕 배정된 ctxRefs 재사용, 없으면 규칙 매칭 후 기록 */
    var refs = (msg.meta && Object.prototype.toString.call(msg.meta.ctxRefs) === "[object Array]")
      ? msg.meta.ctxRefs.slice() : null;
    var fresh = false;
    if (!refs) {
      refs = pickRefs(String(msg.text || ""));
      if (!refs.length) return;
      if (!msg.meta) msg.meta = {};
      msg.meta.ctxRefs = refs.slice();
      fresh = true;
    }
    var picked = [];
    for (var i = 0; i < refs.length; i++) {
      var it = byId(refs[i]);
      if (it) picked.push(it);
    }
    if (!picked.length) return;

    if (fresh) {
      for (i = 0; i < picked.length; i++) picked[i].usedCount = (picked[i].usedCount || 0) + 1;
      saveStore();
      updateBadge();
      try { if (window.EZChat && EZChat.persist) EZChat.persist(); } catch (e) { /* 무시 */ }
    }

    var level = evidenceLevel();
    var html = '<span class="ezl-ev-cap">근거 · 기록 ' + picked.length + "건</span>";
    for (i = 0; i < picked.length; i++) {
      var it2 = picked[i];
      var meta = TYPES[it2.type] || TYPES.org;
      var clickable = level !== "core";
      html += '<span class="ezl-ev-chip' + (clickable ? " click" : "") + '" style="--ezl-c:' + meta.color + '"'
        + (clickable ? ' data-ezl-open="' + esc(it2.id) + '" title="히스토리에서 보기"' : ' title="' + esc(it2.title) + '"') + ">"
        + '<span class="tb">' + esc(meta.label) + "</span>" + esc(shorten(it2.title, 14))
        + (level !== "core" ? '<span class="sr">' + esc(it2.source || "") + "</span>" : "")
        + "</span>";
    }
    if (level !== "core") {
      html += '<button type="button" class="ezl-ev-link" data-ezl-open="' + esc(picked[0].id) + '">히스토리에서 보기</button>';
      html += '<button type="button" class="ezl-ev-link" data-ezl-journey="1" title="이 근거들이 성과 사이클 어느 단계의 결정으로 이어지는지 봅니다">&#9672; 프로세스 맵</button>';
    }
    if (level === "logic") {
      html += '<button type="button" class="ezl-ev-logic" data-ezl-logic="1" data-ezl-refs="'
        + esc(refs.join(",")) + '" data-ezl-ga="' + esc(gaId(String(msg.text || ""))) + '">산출 로직 보기</button>';
    }

    var wrap = document.createElement("div");
    wrap.className = "ezl-ev-wrap";
    wrap.innerHTML = html;
    if (anchor.nextSibling) anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
    else anchor.parentNode.appendChild(wrap);
  }

  function scheduleStrip() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(function () {
      renderTimer = null;
      renderStrip();
    }, RENDER_DELAY);
  }

  /* ---------------- 산출 로직 팝오버 ---------------- */
  function closeLogicPop() {
    var pop = document.getElementById("ezl-pop");
    if (pop && pop.parentNode) pop.parentNode.removeChild(pop);
  }
  function openLogicPop(btn) {
    closeLogicPop();
    var ids = (btn.getAttribute("data-ezl-refs") || "").split(",");
    var ga = btn.getAttribute("data-ezl-ga") || "GA-26000";
    var cited = [], ruleSrcs = [], i, it;
    for (i = 0; i < ids.length; i++) {
      it = byId(ids[i]);
      if (!it) continue;
      cited.push(it.title);
      if (it.type === "rule") ruleSrcs.push(it.source);
    }
    if (!ruleSrcs.length) ruleSrcs = ["rule.asof.snapshot"];
    var citedTxt = cited.length
      ? cited.map(function (t) { return shorten(t, 18); }).join(" · ")
      : "인용한 기록 없음";

    var pop = document.createElement("div");
    pop.id = "ezl-pop";
    pop.className = "ezl-pop";
    pop.innerHTML =
      "<h4>산출 로직 — 이 답은 이렇게 만들어졌습니다</h4>"
      + '<div class="ezl-step"><span class="n">1</span><div class="t"><b>입력 수집</b>'
      + "<span>인용 기록 " + cited.length + "건: " + esc(citedTxt) + "</span></div></div>"
      + '<div class="ezl-step"><span class="n">2</span><div class="t"><b>규칙 적용</b>'
      + "<span>" + ruleSrcs.map(function (s) { return "<code>" + esc(s) + "</code>"; }).join(" ") + " 검증 통과</span></div></div>"
      + '<div class="ezl-step"><span class="n">3</span><div class="t"><b>모델 판단</b>'
      + "<span>인용 기록 범위 안에서 요약·초안 생성 (범위 밖 추정 없음)</span></div></div>"
      + '<div class="ezl-step"><span class="n">4</span><div class="t"><b>검증</b>'
      + "<span>기준 시점 데이터 확인 · 승인 대기 — 승인 전 변경 없음</span></div></div>"
      + '<div class="ezl-pop-ga">감사 기록됨 · <b>' + esc(ga) + "</b></div>";
    document.body.appendChild(pop);

    /* 버튼 근처 배치 (뷰포트 밖으로 나가지 않게 보정) */
    var r = btn.getBoundingClientRect();
    var w = 330, h = pop.offsetHeight || 230;
    var left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    var top = r.top - h - 8;
    if (top < 8) top = Math.min(r.bottom + 8, window.innerHeight - h - 8);
    pop.style.left = left + "px";
    pop.style.top = Math.max(8, top) + "px";
  }

  /* ================= 이벤트 위임 ================= */
  function onDocClick(ev) {
    var t = ev.target;

    /* 팝오버 밖 클릭 → 팝오버 닫기 (로직 버튼 자체는 아래에서 처리) */
    var pop = document.getElementById("ezl-pop");
    if (pop && !pop.contains(t) && !closestAttr(t, "data-ezl-logic")) closeLogicPop();

    /* 배지 → 패널 열기 (배지 내부 span 클릭 포함, 부모 체인 탐색) */
    var n = t;
    while (n && n !== document) {
      if (n.id === "ezl-badge") { ev.preventDefault(); openPanel(); return; }
      n = n.parentNode;
    }

    /* 닫기 (X·스크림) */
    if (closestAttr(t, "data-ezl-close")) { ev.preventDefault(); closePanel(); return; }

    /* type 필터 칩 */
    var fc = closestAttr(t, "data-ezl-filter");
    if (fc) {
      ev.preventDefault();
      var ft = fc.getAttribute("data-ezl-filter") || "";
      filterType = (filterType === ft) ? "" : ft;
      renderPanelBody(null);
      return;
    }

    /* 프로세스 순서로 보기 (tx_journey.js) — 패널을 닫고 프로세스 맵을 연다 */
    var jn = closestAttr(t, "data-ezl-journey");
    if (jn) {
      ev.preventDefault();
      closePanel();
      if (window.EZJourney && EZJourney.open) EZJourney.open();
      return;
    }

    /* 보관·열람 규칙 (tx_policy.js) — 패널을 닫고 모달을 연다 (모달 z가 패널보다 낮음) */
    var pol = closestAttr(t, "data-ezl-policy");
    if (pol) {
      ev.preventDefault();
      closePanel();
      if (window.EZPolicy && EZPolicy.open) EZPolicy.open();
      return;
    }

    /* 근거칩·"히스토리에서 보기" → 패널 열고 해당 항목 하이라이트 */
    var op = closestAttr(t, "data-ezl-open");
    if (op) { ev.preventDefault(); openPanel(op.getAttribute("data-ezl-open") || null); return; }

    /* 산출 로직 팝오버 토글 */
    var lg = closestAttr(t, "data-ezl-logic");
    if (lg) {
      ev.preventDefault();
      if (document.getElementById("ezl-pop")) closeLogicPop();
      else openLogicPop(lg);
      return;
    }
  }

  function onKeydown(ev) {
    if (ev.key !== "Escape" && ev.keyCode !== 27) return;
    if (document.getElementById("ezl-pop")) { closeLogicPop(); return; }
    if (isPanelOpen()) closePanel();
  }

  function onCtxEvent(ev) {
    var d = ev && ev.detail;
    if (!d || !d.title) return;
    var e = addEntry(d);
    if (e) {
      updateBadge(true);
      toast("성과 히스토리에 기록됨 · " + shorten(e.title, 22));
    }
  }

  /* ================= 결선 ================= */
  function wireChat() {
    EZChat.on("messages", function () {
      removeStrips();
      scheduleStrip();
    });
    EZChat.on("streaming", function (d) {
      if (d && d.on === false) { streamingOn = false; scheduleStrip(); }
      else {
        streamingOn = true;
        removeStrips();
        if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
      }
    });
    EZChat.on("switch", function () {
      removeStrips();
      if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
      scheduleStrip();
    });
    /* 기존 대화가 이미 떠 있는 경우 최초 1회 */
    scheduleStrip();
  }

  function boot() {
    injectStyle();
    loadStore();
    document.addEventListener("click", onDocClick, true);
    document.addEventListener("keydown", onKeydown, true);
    document.addEventListener("ez:ctx", onCtxEvent, false);

    /* 배지 — .ezx-root(FAB 루트)가 늦게 뜰 수 있어 폴링, 실패 시 body 폴백 pill */
    var tries = 0;
    (function pollFab() {
      if (document.querySelector(".ezx-root")) { updateBadge(); return; }
      if (++tries >= 20) { updateBadge(); return; }  /* 폴백: body에 자체 pill */
      setTimeout(pollFab, 300);
    })();

    /* EZChat 폴링 결선 (300ms × 20회) */
    var ct = 0;
    (function pollChat() {
      if (window.EZChat && EZChat.on) { wireChat(); return; }
      if (++ct >= 20) return;
      setTimeout(pollChat, 300);
    })();
  }

  /* ---------------- 공개 API ---------------- */
  window.EZLedger = {
    add: addEntry,
    list: function () { return sorted(); },
    openPanel: openPanel,
    closePanel: closePanel,
    count: function () { return loadStore().length; }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
