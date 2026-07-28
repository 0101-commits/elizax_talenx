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
 *      msg.meta.ctxRefs(id 배열)+ctxCited=실인용, 없으면 답변 텍스트를 규칙
 *      기반(키워드→type/제목 토큰 매칭)으로 "추측" 선택(점선 칩·별도 캡션).
 *      usedCount 증가·체인 승격은 실인용(ctxCited)만 — 추측은 카운트 금지,
 *      키워드 매칭 0건이면 "뒷받침 기록 없음" 상태를 정직하게 표시.
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
  var detailId = null;       /* 상세 뷰 대상 항목 id ("" = 목록) */
  var renderTimer = null;
  var streamingOn = false;
  var seq = 0;

  /* ---------------- type 메타 ---------------- */
  /* 타입색 = astryx 카테고리컬 토큰 (§8.3 — 원장 TYPES 8색 흡수) */
  var TYPES = {
    goal:     { label: "목표",     color: "var(--color-text-blue)" },
    checkin:  { label: "체크인",   color: "var(--color-text-teal)" },
    oneonone: { label: "1on1",     color: "var(--color-text-purple)" },
    feedback: { label: "피드백",   color: "var(--color-text-orange)" },
    eval:     { label: "평가 이력", color: "var(--color-text-red)" },
    org:      { label: "조직 기준", color: "var(--color-text-cyan)" },
    job:      { label: "직무 기준", color: "var(--color-text-secondary)" },
    rule:     { label: "규칙",     color: "var(--color-text-green)" },
    audit:    { label: "감사",     color: "var(--color-text-disabled)" },  /* 허브 감사 로그 (hub.*) */
    asset:    { label: "산출물",   color: "var(--color-text-gray)" }       /* 허브 산출물 (hub.asset.*) */
  };
  var TYPE_ORDER = ["goal", "checkin", "oneonone", "feedback", "eval", "org", "job", "rule", "audit", "asset"];

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
  /* 기준 시점(as-of) 단일 발급 — EZKit.clock이 원천, 미로드 시에만 현재시각 폴백 */
  function asOfStr() {
    return (window.EZKit && EZKit.clock) ? EZKit.clock.asOf() : nowStamp();
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
  function hashStr(s) { return ("00000000" + hashNum(s).toString(16)).slice(-8); }

  /* ---------------- 보존 등급 (F4) ---------------- */
  /* 핀 고정 = 평가에 인용됐거나(usedCount) 기여도 최상(weight 3)이거나 평가 이력 자체 */
  function isPinned(it) {
    return !!it && ((it.usedCount || 0) > 0 || it.weight === 3 || it.type === "eval");
  }
  /* 불변 등급 해시 체인 — 내용 서명은 불변 필드만 (usedCount/weight 변동은 체인 무관) */
  function chainSig(it) {
    return [it.id, it.ts, it.type, it.title, it.summary, it.prev_hash].join("|");
  }
  function ensureChain() {
    var chained = [], fresh = [], i;
    for (i = 0; i < items.length; i++) {
      if (items[i].hash) chained.push(items[i]);
      else if (isPinned(items[i])) fresh.push(items[i]);
    }
    if (!fresh.length) return;
    chained.sort(function (a, b) { return (a.chainSeq || 0) - (b.chainSeq || 0); });
    fresh.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
    var last = chained.length ? chained[chained.length - 1] : null;
    var seqN = last ? (last.chainSeq || 0) : 0;
    for (i = 0; i < fresh.length; i++) {
      var it = fresh[i];
      it.prev_hash = last ? last.hash : "GENESIS";
      it.chainSeq = ++seqN;
      it.hash = hashStr(chainSig(it));
      last = it;
    }
  }
  /* 체인 재계산 대조 — 변조·유실 탐지 */
  function verifyChain() {
    var chained = loadStore().filter(function (it) { return it.hash; });
    chained.sort(function (a, b) { return (a.chainSeq || 0) - (b.chainSeq || 0); });
    var prev = "GENESIS";
    for (var i = 0; i < chained.length; i++) {
      var it = chained[i];
      if (it.prev_hash !== prev || hashStr(chainSig(it)) !== it.hash) {
        return { ok: false, count: chained.length, brokenAt: it.id };
      }
      prev = it.hash;
    }
    return { ok: true, count: chained.length };
  }

  /* ---------------- 열람 규칙 소비 (F5) ---------------- */
  var REC_TYPE_MAP = { goal: "goal_checkin", checkin: "goal_checkin", oneonone: "oneonone", feedback: "peer_feedback", eval: "eval_draft" };
  function policyType(t) { return REC_TYPE_MAP[t] || "history"; }
  function recRelation(it) {
    /* 현 원장은 본인 키 저장이라 대부분 self — emp_id가 붙은 레코드만 관계 판정 */
    return (it && it.emp_id && it.emp_id !== CU.emp_id) ? "team" : "self";
  }
  function polCheck(it) {
    try {
      if (window.EZPolicy && EZPolicy.check) return EZPolicy.check(roleKey(), policyType(it.type), recRelation(it));
    } catch (e) { /* 정책 모듈 미로드 */ }
    return "full";
  }

  /* ================= 스토어 ================= */
  /* v1 스토어 호환 — 구버전 시드에는 seed 플래그가 없고 usedCount가 선탑재돼 있다.
     시드 ts는 seedTs()가 만든 정각(초·밀리초 0), 실사용 기록은 Date.now()라 사실상 겹치지 않는다.
     → 예시 배지가 붙도록 플래그를 채우고, 지어낸 인용 횟수는 0으로 되돌린다 (F15). */
  function backfillSeedFlags(list) {
    var changed = false;
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (it.seed || !it.ts || it.ts % 60000 !== 0) continue;
      it.seed = 1;
      if (it.usedCount) it.usedCount = 0;
      changed = true;
    }
    return changed;
  }

  function loadStore() {
    if (items) return items;
    items = [];
    var migrated = false;
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var obj = JSON.parse(raw);
        if (obj && Object.prototype.toString.call(obj.items) === "[object Array]") {
          items = obj.items.filter(function (it) { return it && it.id && it.type && it.title; });
          if ((obj.v || 1) < 2) migrated = backfillSeedFlags(items);
        }
      }
    } catch (e) { items = []; }
    if (migrated) saveStore();
    /* [Phase1 IA] 시드는 데모 플래그로 격리 — "미스터리 숫자" 해소 (Phase 1 ⑥) */
    if (!items.length && seedOn()) {
      items = buildSeeds();
      saveStore();
    }
    return items;
  }
  /* 데모 시드 게이트 — window.EZX_DEMO 명시값 우선, 없으면 ezx_seed('0'이면 빈 상태 유지) */
  function seedOn() {
    if (window.EZX_DEMO === true) return true;
    if (window.EZX_DEMO === false) return false;
    try { return localStorage.getItem("ezx_seed") !== "0"; } catch (e) { return true; }
  }
  function hasSeed() {
    var a = loadStore();
    for (var i = 0; i < a.length; i++) { if (a[i].seed) return true; }
    return false;
  }
  function saveStore() {
    try {
      ensureChain();
      if (items.length > MAX_ITEMS) {
        /* 80건 롤링은 비핀(임시 맥락)만 — 핀 고정(평가 인용·기여도 3·평가 이력)은 삭제 대상 제외 */
        items.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
        var over = items.length - MAX_ITEMS;
        var kept = [];
        for (var i = 0; i < items.length; i++) {
          if (over > 0 && !isPinned(items[i])) { over--; continue; }
          kept.push(items[i]);
        }
        items = kept;
      }
      localStorage.setItem(KEY, JSON.stringify({ v: 2, items: items }));
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
  /* 시드는 usedCount 선탑재 없이 전부 0 — 인용 횟수는 실제 인용으로만 쌓인다 (F15) */
  function mkSeed(mon, day, hh, mm, type, source, title, summary, weight) {
    return {
      id: uid(), ts: seedTs(mon, day, hh, mm),
      at: mon + "/" + day + " " + z2(hh) + ":" + z2(mm),
      type: type, source: source, title: norm(title), summary: norm(summary),
      weight: weight || 1, usedCount: 0, seed: 1
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
        3));
      g++;
    }
    if (g < 2 && objs[0] && objs[0].parent_objective_id) {
      var parent = (DATA.objectives || []).filter(function (p) { return p.objective_id === objs[0].parent_objective_id; })[0];
      if (parent) {
        out.push(mkSeed(5, 4, 9, 40, "goal", "perf.obj." + parent.objective_id,
          "상위 정렬: " + parent.title, "개인 목표가 정렬된 상위 목표 · 진행률 " + (parent.progress != null ? parent.progress + "%" : "-"), 2));
        g++;
      }
    }
    while (g < 2) {
      out.push(mkSeed(5, 4, 9, 45, "goal", "perf.obj.local." + g,
        "FY2026-2Q " + jobTitle + " 핵심 목표", "분기 목표 수립 · KR 2건 · 가중치 합 100%", 3));
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
        c ? c.comment + (c.confidence ? " · 확신도 " + c.confidence : "") : "진행률 업데이트 · 장애 요인 없음",
        2));
    }

    /* 1on1 노트 2 */
    out.push(mkSeed(5, 28, 15, 0, "oneonone", "1on1.rec.0528",
      mgr + "와 1on1 (5/28)", "분기 목표 우선순위 재확인 · 협업 리소스 요청 1건 합의", 2));
    out.push(mkSeed(6, 30, 16, 30, "oneonone", "1on1.rec.0630",
      mgr + "와 1on1 (6/30)", "리뷰 단계 병목 이슈 논의 · 7월 개선 액션 2건 합의", 2));

    /* 피드백 1 */
    out.push(mkSeed(6, 12, 11, 20, "feedback", "perf.fb.0612",
      "동료 피드백 — 프로젝트 리뷰", "SBI: 검증 프로세스 설계가 협업 품질을 높였다는 동료 2인 피드백", 1));

    /* 직무 기대역량 1 */
    out.push(mkSeed(5, 2, 10, 0, "job", "job.profile." + (CU.job_id || "JOB"),
      jobTitle + " 기대역량 기준", (CU.level_kr || "구성원") + " 레벨 기대치 · 핵심역량 5종 매핑", 2));

    /* 평가 이력 1 */
    out.push(mkSeed(5, 10, 14, 0, "eval", "eval.FY2025H2." + CU.emp_id,
      "FY2025 하반기 평가 이력", "종합 등급·리뷰 코멘트 · 강점: 실행력 / 보완: 위임", 3));

    /* 규칙 1 */
    out.push(mkSeed(5, 1, 9, 0, "rule", "rule.weight.sum",
      "rule.weight.sum — KR 가중치 합 100%", "목표 가중치 검증 규칙 · 위반 시 저장 차단 · 기준 시점 데이터 기준", 3));

    /* leader/hr/exec — 팀/전사 관점 1~2건 */
    if (role === "leader") {
      out.push(mkSeed(7, 7, 9, 10, "org", "org.team.checkin.wk27",
        "팀 체크인 현황 주간 집계", "팀원 체크인 제출률 · 부진 2인 식별 · 진척 변화 요약", 2));
      out.push(mkSeed(7, 14, 10, 0, "org", "org.align.map." + (CU.org_id || "ORG"),
        (CU.orgName || "우리 조직") + " 목표 정렬 맵", "팀 목표-개인 목표 정렬 상태 · 미정렬 1건", 2));
    } else if (role === "hr" || role === "exec") {
      out.push(mkSeed(7, 7, 9, 10, "org", "org.dist.FY2026H1",
        "전사 평가 분포 기준선", "등급 분포 가이드 · 관대화/중심화 편향 모니터링 지표", 3));
      out.push(mkSeed(7, 14, 10, 0, "rule", "rule.calibration.gate",
        "rule.calibration.gate — 등급 조정 승인 단계", "조정은 심의 게이트 통과 후 확정 · 승인 전에는 반영되지 않음", 3));
    }

    return out;
  }

  /* ---------------- 구독 (EZLedger.on) ---------------- */
  var listeners = {};
  function on(evt, fn) {
    if (!evt || typeof fn !== "function") return;
    if (!listeners[evt]) listeners[evt] = [];
    listeners[evt].push(fn);
  }
  function emit(evt, payload) {
    var fns = listeners[evt];
    if (!fns) return;
    for (var i = 0; i < fns.length; i++) {
      try { fns[i](payload); } catch (e) { /* 구독자 오류 격리 */ }
    }
  }

  /* ---------------- add / dedup ---------------- */
  /* 다른 구성원의 원장 키(elizax_ctx_v1:<emp_id>)로 직접 저장 —
     회의 결정 "개인별 전달" 등 수신자 원장 라우팅. 메모리(items)는
     현재 사용자 것이므로 건드리지 않고 localStorage만 갱신한다. */
  function addEntryFor(empId, entry) {
    var key = LS_PREFIX + empId;
    var list = [];
    try {
      var raw = localStorage.getItem(key);
      if (raw) {
        var obj = JSON.parse(raw);
        if (obj && Object.prototype.toString.call(obj.items) === "[object Array]") {
          list = obj.items.filter(function (it) { return it && it.id && it.type && it.title; });
        }
      }
    } catch (e) { list = []; }
    var type = TYPES[entry.type] ? entry.type : "org";
    var title = norm(entry.title);
    var source = norm(entry.source || "app.event");
    /* 60초 내 같은 source+title 재발화는 중복 축적하지 않음 */
    for (var i = list.length - 1; i >= 0; i--) {
      var it = list[i];
      if (it.source === source && it.title === title && Date.now() - (it.ts || 0) < 60000) return it;
    }
    var w = parseInt(entry.weight, 10);
    if (!(w >= 1 && w <= 3)) w = 1;
    var e = {
      id: uid(), ts: Date.now(), at: nowStamp(),
      type: type, source: source, title: title,
      summary: norm(entry.summary || ""), weight: w, usedCount: 0, emp_id: empId
    };
    list.push(e);
    if (list.length > MAX_ITEMS) {
      list.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
      list = list.slice(list.length - MAX_ITEMS);
    }
    try { localStorage.setItem(key, JSON.stringify({ v: 2, items: list })); } catch (e2) { /* storage 불가 무시 */ }
    return e;
  }

  function addEntry(entry) {
    if (!entry || !entry.title) return null;
    /* emp_id가 붙어 있고 현재 사용자와 다르면 수신자 원장으로 라우팅 (개인별 전달 계약) */
    if (entry.emp_id && CU.emp_id && entry.emp_id !== CU.emp_id) return addEntryFor(entry.emp_id, entry);
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
    emit("add", e);
    return e;
  }

  /* ================= 스타일 ================= */
  function injectStyle() {
    if (document.getElementById("ezl-style")) return;
    var css = [
      /* ---- 기록 반응 (FAB bump) — 떠다니는 배지 pill은 폐지, [기록] 탭이 집 (§5.2) ---- */
      ".ezx-fab.ezl-bump{animation:ezlBump .4s cubic-bezier(.32,.72,.24,1);}",
      "@keyframes ezlBump{0%{transform:scale(1)}40%{transform:scale(1.18)}100%{transform:scale(1)}}",
      /* ---- elizax 도킹 패널 [기록] 탭 임베드 (astryx 토큰) ---- */
      ".ezl-embed{background:var(--color-background-surface);color:var(--color-text-primary);font-size:13px;letter-spacing:-.01em;}",
      ".ezl-tabhead{flex:none;padding:12px 16px 10px;border-bottom:1px solid var(--color-border);}",
      ".ezl-tabdef{font-size:11px;color:var(--color-text-secondary);margin-top:3px;line-height:1.5;}",
      ".ezl-demo{font-size:9.5px;font-weight:700;color:var(--color-text-secondary);background:var(--color-background-muted);",
      "border:1px solid var(--color-border-emphasized);",
      "border-radius:var(--radius-full);padding:1.5px 7px;margin-left:6px;vertical-align:2px;}",
      /* ---- 패널 ---- */
      ".ezl-scrim{position:fixed;inset:0;z-index:" + (Z_PANEL - 1) + ";background:var(--color-overlay,rgba(20,24,32,.34));",
      "opacity:0;transition:opacity var(--duration-fast,175ms);pointer-events:none;}",
      ".ezl-scrim.on{opacity:1;pointer-events:auto;}",
      ".ezl-panel{position:fixed;top:0;right:0;bottom:0;z-index:" + Z_PANEL + ";width:430px;max-width:94vw;",
      "background:var(--color-background-surface);color:var(--color-text-primary);display:flex;flex-direction:column;",
      "box-shadow:-18px 0 48px var(--color-shadow);transform:translateX(103%);",
      "transition:transform var(--duration-medium-min,310ms) var(--ease-standard);font-size:13px;letter-spacing:-.01em;}",
      ".ezl-panel.on{transform:translateX(0);}",
      ".ezl-head{flex:none;padding:16px 18px 12px;border-bottom:1px solid var(--color-border);}",
      ".ezl-head-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;}",
      ".ezl-title{font-size:15.5px;font-weight:700;letter-spacing:-.02em;}",
      ".ezl-title small{display:block;font-size:11px;font-weight:500;color:var(--color-text-secondary);margin-top:2px;}",
      ".ezl-x{flex:none;font:inherit;font-size:15px;line-height:1;color:var(--color-text-secondary);background:var(--color-background-muted);",
      "border:none;border-radius:var(--radius-full);width:26px;height:26px;cursor:pointer;}",
      ".ezl-x:hover{background:var(--color-overlay-hover);}",
      ".ezl-sub{margin-top:6px;display:flex;align-items:center;gap:8px;font-size:11px;color:var(--color-text-secondary);}",
      ".ezl-asof{color:var(--color-trust);background:var(--color-background-surface);border:1px solid var(--color-border-emphasized);border-radius:var(--radius-full);padding:2px 9px;font-weight:600;}",
      /* ---- 요약 스트립 ---- */
      ".ezl-strip{flex:none;display:flex;flex-wrap:wrap;gap:5px;padding:10px 18px;border-bottom:1px solid var(--color-border);background:var(--color-background-muted);}",
      ".ezl-tchip{font:inherit;font-size:10.5px;font-weight:600;cursor:pointer;border-radius:var(--radius-full);padding:3px 9px;",
      "background:var(--color-background-surface);border:1px solid var(--color-border-emphasized);color:var(--color-text-secondary);transition:background var(--duration-fast) var(--ease-standard),border-color var(--duration-fast) var(--ease-standard);}",
      ".ezl-tchip b{font-weight:800;margin-left:3px;}",
      ".ezl-tchip.on{color:var(--color-on-accent) !important;border-color:transparent;}",
      /* ---- 타임라인 (rows) ---- */
      ".ezl-body{flex:1;min-height:0;overflow-y:auto;padding:12px 18px 16px;}",
      ".ezl-item{position:relative;padding:9px 10px 9px 14px;border:1px solid var(--color-border);border-radius:var(--radius-container);margin-bottom:8px;background:var(--color-background-card);}",
      ".ezl-item::before{content:'';position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:3px;background:var(--ezl-c,var(--color-accent));}",
      ".ezl-row1{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}",
      ".ezl-tb{font-size:9.5px;font-weight:700;border-radius:var(--radius-inner);padding:1.5px 6px;color:var(--color-on-accent);background:var(--ezl-c,var(--color-accent));}",
      ".ezl-at{font-size:10.5px;color:var(--color-text-secondary);}",
      ".ezl-w{margin-left:auto;font-size:9px;letter-spacing:2px;color:var(--ezl-c,var(--color-accent));white-space:nowrap;}",
      ".ezl-it-title{font-size:12.5px;font-weight:600;margin:5px 0 2px;line-height:1.45;}",
      ".ezl-it-sum{font-size:11.5px;color:var(--color-text-secondary);line-height:1.5;}",
      ".ezl-row2{display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap;}",
      ".ezl-src{font-family:var(--font-family-code);font-size:9.5px;color:var(--color-text-purple);",
      "background:var(--color-background-purple);border:1px solid var(--color-border-purple);border-radius:var(--radius-inner);padding:1.5px 6px;}",
      ".ezl-used{font-size:10px;color:var(--color-text-secondary);}",
      ".ezl-used.hot{color:var(--color-success);font-weight:700;}",
      ".ezl-item{cursor:pointer;}",
      ".ezl-item:hover{border-color:var(--color-border-emphasized);}",
      ".ezl-item.ezl-hl{animation:ezkFlash 1.8s ease-out 2;}",
      /* ---- 예시(시드) 배지 — 실사용 축적분과 구분 (F15) ---- */
      ".ezl-seedb{font-size:9px;font-weight:700;color:var(--color-text-secondary);background:var(--color-background-muted);",
      "border:1px dashed var(--color-border-emphasized);border-radius:var(--radius-inner);padding:1px 5px;}",
      /* ---- 열람 제한 사유 한 줄 ---- */
      ".ezl-why{font-size:10.5px;line-height:1.5;color:var(--color-text-secondary);background:var(--color-background-muted);",
      "border:1px dashed var(--color-border-emphasized);border-radius:var(--radius-element);padding:6px 9px;margin:2px 0 8px;}",
      /* ---- 항목 상세 ---- */
      ".ezl-back{font:inherit;font-size:11px;font-weight:700;cursor:pointer;color:var(--color-accent);background:var(--color-background-surface);",
      "border:1px solid var(--color-border-emphasized);border-radius:var(--radius-full);padding:3px 10px;margin-bottom:10px;}",
      ".ezl-back:hover{background:var(--color-overlay-hover);}",
      ".ezl-dt{font-size:14px;font-weight:700;line-height:1.45;margin:6px 0 4px;letter-spacing:-.02em;}",
      ".ezl-dsum{font-size:12px;line-height:1.65;color:var(--color-text-primary);background:var(--color-background-card);",
      "border:1px solid var(--color-border);border-radius:var(--radius-container);padding:10px 12px;margin-bottom:10px;white-space:pre-wrap;word-break:break-word;}",
      ".ezl-drow{display:flex;gap:8px;font-size:11.5px;line-height:1.55;margin:5px 0;}",
      ".ezl-drow label{flex:none;width:74px;color:var(--color-text-secondary);font-weight:600;}",
      ".ezl-drow div{min-width:0;word-break:break-all;}",
      ".ezl-dhead{font-size:11px;font-weight:700;color:var(--color-text-secondary);margin:14px 0 6px;}",
      ".ezl-cite{display:block;width:100%;text-align:left;font:inherit;font-size:11.5px;line-height:1.5;cursor:pointer;margin-bottom:6px;",
      "color:var(--color-text-primary);background:var(--color-background-card);border:1px solid var(--color-border);border-radius:var(--radius-container);padding:8px 10px;}",
      ".ezl-cite:hover{border-color:var(--color-accent);}",
      ".ezl-cite small{display:block;font-size:10px;color:var(--color-text-secondary);margin-top:3px;}",
      ".ezl-cite .gs{color:var(--color-text-orange);font-weight:700;}",
      ".ezl-empty{padding:30px 8px;text-align:center;color:var(--color-text-secondary);font-size:12px;}",
      ".ezl-foot{flex:none;padding:11px 18px;border-top:1px solid var(--color-border);background:var(--color-background-muted);",
      "font-size:11px;line-height:1.55;color:var(--color-text-secondary);}",
      ".ezl-foot b{color:var(--color-accent);}",
      ".ezl-foot-policy{display:inline-flex;align-items:center;gap:4px;margin-left:6px;font:inherit;",
      "font-size:10.5px;font-weight:700;color:var(--color-accent);background:var(--color-background-surface);border:1px solid var(--color-border-emphasized);",
      "border-radius:var(--radius-full);padding:2px 9px;cursor:pointer;vertical-align:1px;transition:background var(--duration-fast) var(--ease-standard);}",
      ".ezl-foot-policy:hover{background:var(--color-overlay-hover);}",
      ".ezl-foot-row2{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:7px;padding-top:7px;border-top:1px dashed var(--color-border);}",
      ".ezl-chain{font-size:10.5px;font-weight:700;}",
      ".ezl-chain.ok{color:var(--color-success);}",
      ".ezl-chain.bad{color:var(--color-error);}",
      ".ezl-pin{font-size:9.5px;font-weight:700;color:var(--color-text-orange);background:var(--color-background-orange);",
      "border:1px solid var(--color-border-orange);border-radius:var(--radius-inner);padding:1.5px 6px;}",
      ".ezl-lvchip{font-size:9.5px;font-weight:700;color:var(--color-text-blue);background:var(--color-background-blue);",
      "border:1px solid var(--color-border-blue);border-radius:var(--radius-inner);padding:1.5px 6px;}",
      /* ---- 답변 근거 스트립 ---- */
      ".ezl-ev-wrap{display:flex;flex-wrap:wrap;align-items:center;gap:5px;padding:3px 4px 7px;}",
      ".ezl-ev-cap{font-size:10.5px;font-weight:700;color:var(--color-text-secondary);background:var(--color-background-muted);",
      "border:1px solid var(--color-border);border-radius:var(--radius-full);padding:3px 9px;white-space:nowrap;}",
      ".ezl-ev-chip{display:inline-flex;align-items:center;gap:4px;max-width:100%;font-size:10.5px;line-height:1.4;",
      "border-radius:var(--radius-full);padding:3px 9px;border:1px solid var(--color-border-blue);background:var(--color-background-blue);",
      "color:var(--color-text-primary);user-select:none;}",
      ".ezl-ev-chip .tb{font-size:9px;font-weight:800;color:var(--ezl-c,var(--color-accent));}",
      ".ezl-ev-chip .sr{font-family:var(--font-family-code);font-size:9px;color:var(--color-text-secondary);}",
      ".ezl-ev-chip.click{cursor:pointer;}",
      ".ezl-ev-chip.click:hover{background:var(--color-accent-muted);border-color:var(--color-accent);}",
      /* ---- 추측 인용(비실인용) 구분 — 점선 + 중립 톤 (F15) ---- */
      ".ezl-ev-cap.guess{color:var(--color-text-secondary);border-style:dashed;}",
      ".ezl-ev-chip.guess{border-style:dashed;border-color:var(--color-border-emphasized);",
      "background:var(--color-background-surface);color:var(--color-text-secondary);}",
      ".ezl-ev-none{font-size:10.5px;font-weight:700;color:var(--color-text-orange);background:var(--color-background-orange);",
      "border:1px dashed var(--color-border-orange);border-radius:var(--radius-full);padding:3px 10px;}",
      ".ezl-ev-link,.ezl-ev-logic{font:inherit;font-size:10.5px;font-weight:700;cursor:pointer;border-radius:var(--radius-full);",
      "padding:3px 10px;border:1px solid var(--color-border-emphasized);background:var(--color-background-surface);color:var(--color-accent);transition:background var(--duration-fast) var(--ease-standard);}",
      ".ezl-ev-link:hover,.ezl-ev-logic:hover{background:var(--color-overlay-hover);border-color:var(--color-accent);}",
      ".ezl-ev-logic{color:var(--color-text-purple);border-color:var(--color-border-purple);}",
      /* ---- 산출 로직 팝오버 ---- */
      ".ezl-pop{position:fixed;z-index:" + (Z_PANEL + 10) + ";width:330px;max-width:92vw;background:var(--color-background-popover);color:var(--color-text-primary);",
      "border:1px solid var(--color-border);border-radius:var(--radius-container);box-shadow:var(--shadow-high,0 18px 50px var(--color-shadow));padding:13px 14px;",
      "font-size:11.5px;line-height:1.55;}",
      ".ezl-pop h4{margin:0 0 8px;font-size:12.5px;font-weight:700;letter-spacing:-.02em;}",
      ".ezl-step{display:flex;gap:8px;margin-bottom:7px;}",
      ".ezl-step .n{flex:none;width:17px;height:17px;border-radius:var(--radius-full);background:var(--color-trust);color:var(--color-on-accent);",
      "font-size:9.5px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;margin-top:1px;}",
      ".ezl-step .t b{display:block;font-size:11px;}",
      ".ezl-step .t span{color:var(--color-text-secondary);font-size:10.5px;}",
      ".ezl-step .t code{font-family:var(--font-family-code);font-size:9.5px;color:var(--color-text-green);",
      "background:var(--color-background-green);border:1px solid var(--color-border-green);border-radius:var(--radius-inner);padding:0 4px;}",
      ".ezl-pop-ga{margin-top:9px;padding-top:8px;border-top:1px dashed var(--color-border);font-size:10px;color:var(--color-text-secondary);}",
      ".ezl-pop-ga b{color:var(--color-trust);font-family:var(--font-family-code);}",
      "@media (prefers-reduced-motion:reduce){.ezl-panel,.ezl-scrim,.ezx-fab.ezl-bump{transition:none !important;animation:none !important;}}"
    ].join("");
    var st = document.createElement("style");
    st.id = "ezl-style";
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ================= 배지 — 떠다니는 pill 폐지, [기록] 탭 도트가 대체 (§5.2) ================= */
  /* 호출부 보존용 no-op — DOM을 만들지 않는다 */
  function ensureBadge() { return null; }
  /* 기록 변화 반영: 열린 마운트 재렌더 + 변경 통지 + (bump 시) FAB 미세 애니메이션 */
  function updateBadge(bump) {
    refreshMounts(null);
    try { document.dispatchEvent(new CustomEvent("ezl:changed")); } catch (e) { /* 구형 브라우저 무시 */ }
    if (bump) {
      var f = document.querySelector(".ezx-fab");
      if (f) {
        f.classList.remove("ezl-bump");
        void f.offsetWidth; /* reflow로 애니 재시작 */
        f.classList.add("ezl-bump");
      }
    }
  }

  /* [기록] 탭 행 렌더 — rows, not Cards (astryx 원칙). 클릭=기존 슬라이드 패널 딥점프 */
  function renderRows(container) {
    if (!container) return;
    var all = sorted(), rows = "", shown = 0, i;
    for (i = 0; i < all.length; i++) {
      var lv = polCheck(all[i]);
      if (lv === "no") continue;
      var meta = TYPES[all[i].type] || TYPES.org;
      var title = lv === "anon" ? "익명 집계" : all[i].title;
      rows += '<div class="ezx-rec-row" data-ezl-open="' + esc(all[i].id) + '" style="--ezl-c:' + meta.color + '">'
        + '<span class="dot"></span><div class="tt">' + esc(title)
        + "<small>" + esc(meta.label) + " · " + esc(all[i].at || "")
        + (all[i].seed ? " · 예시" : "") + "</small></div></div>";
      shown++;
    }
    container.innerHTML = shown
      ? '<div class="ezx-rec-head"><span>📌 기준 ' + esc(asOfStr()) + "</span><span>총 " + shown + "건</span></div>" + rows
      : '<div class="ezx-pane-empty">목표·체크인·1:1이 확정될 때마다 여기에 쌓입니다.</div>';
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
    p.setAttribute("aria-label", "성과 기록");
    /* body 직속 — astryx 토큰 스코프 명시 부여 */
    p.setAttribute("data-astryx-theme", "talenx");
    scrim.setAttribute("data-astryx-theme", "talenx");
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

  function itemHtml(it, hl, lv) {
    var meta = TYPES[it.type] || TYPES.org;
    var used = it.usedCount || 0;
    lv = lv || "full";
    if (lv === "anon") {
      /* 익명 집계 치환 카드 — 원문·출처 비노출 */
      return '<div class="ezl-item' + (hl ? " ezl-hl" : "") + '" data-ezl-id="' + esc(it.id) + '" style="--ezl-c:var(--color-text-secondary)">'
        + '<div class="ezl-row1"><span class="ezl-tb">' + esc(meta.label) + "</span>"
        + '<span class="ezl-at">' + esc(it.at || "") + "</span></div>"
        + '<div class="ezl-it-title">익명 집계</div>'
        + '<div class="ezl-it-sum">응답자 보호 정책에 따라 익명 집계로만 제공됩니다 (정책 v3.1)</div>'
        + "</div>";
    }
    var pin = isPinned(it) ? '<span class="ezl-pin">평가 인용됨 · 보존 대상</span>' : "";
    return '<div class="ezl-item' + (hl ? " ezl-hl" : "") + '" data-ezl-id="' + esc(it.id) + '" title="클릭하면 원문·출처·인용 이력을 봅니다" style="--ezl-c:' + meta.color + '">'
      + '<div class="ezl-row1"><span class="ezl-tb">' + esc(meta.label) + "</span>"
      + (it.seed ? '<span class="ezl-seedb">예시</span>' : "")
      + '<span class="ezl-at">' + esc(it.at || "") + "</span>"
      + '<span class="ezl-w" title="판단 기여도 ' + it.weight + "/3\">" + weightDots(it.weight || 1) + "</span></div>"
      + '<div class="ezl-it-title">' + esc(it.title) + "</div>"
      + (it.summary ? '<div class="ezl-it-sum">' + esc(it.summary) + "</div>" : "")
      + '<div class="ezl-row2">'
      + (lv === "summ"
        ? '<span class="ezl-lvchip" title="타인 기록이라 열람 규칙상 요약까지만 제공됩니다">요약까지 열람 — 타인 기록</span>'
        : '<span class="ezl-src">' + esc(it.source || "") + "</span>")
      + '<span class="ezl-used' + (used > 0 ? " hot" : "") + '">답변 인용 ' + used + "회</span>" + pin + "</div>"
      + "</div>";
  }

  /* ================= 항목 상세 (F15) =================
     data-ezl-id 클릭 → 원문 전체·출처·인용 이력 + 그 기록을 인용한 답변으로 역추적. */

  /* 이 기록을 인용한 AI 답변 찾기 — 전 세션 스캔(EZChat.exportAll) */
  function citingAnswers(id) {
    var out = [];
    if (!window.EZChat || !EZChat.exportAll) return out;
    var sess;
    try { sess = EZChat.exportAll() || []; } catch (e) { return out; }
    for (var i = 0; i < sess.length; i++) {
      var s = sess[i], msgs = s.messages || [];
      for (var j = 0; j < msgs.length; j++) {
        var m = msgs[j];
        if (!m || m.role !== "ai" || !m.meta) continue;
        var refs = m.meta.ctxRefs;
        if (Object.prototype.toString.call(refs) !== "[object Array]") continue;
        if (refs.indexOf(id) < 0) continue;
        out.push({
          sid: s.id, title: s.title || "새 대화", at: s.at || "",
          text: shorten(m.text || "", 70), cited: m.meta.ctxCited === true
        });
      }
    }
    return out;
  }

  function detailHtml(it, lv) {
    var meta = TYPES[it.type] || TYPES.org;
    var back = '<button type="button" class="ezl-back" data-ezl-back="1">&#8592; 목록으로</button>';
    var head = '<div class="ezl-row1" style="--ezl-c:' + meta.color + '"><span class="ezl-tb">' + esc(meta.label) + "</span>"
      + (it.seed ? '<span class="ezl-seedb">예시</span>' : "")
      + '<span class="ezl-at">' + esc(it.at || "") + "</span>"
      + '<span class="ezl-w" title="판단 기여도 ' + (it.weight || 1) + '/3">' + weightDots(it.weight || 1) + "</span></div>";

    /* 열람 제한 — 차단 시 이유를 한 줄로 밝힌다 (숨김이 아니라 요약 우선) */
    if (lv === "anon") {
      return back + head + '<div class="ezl-dt">익명 집계</div>'
        + '<div class="ezl-why">응답자 보호 정책에 따라 이 기록은 익명 집계로만 제공됩니다 — 원문·출처는 열람 대상이 아닙니다 (보관·열람 규칙 v3.1).</div>';
    }
    var restricted = (lv === "summ");
    var cites = citingAnswers(it.id);
    var used = it.usedCount || 0;

    var rows = '<div class="ezl-drow"><label>기록 시각</label><div>' + esc(it.at || "-") + "</div></div>"
      + '<div class="ezl-drow"><label>출처</label><div>'
      + (restricted ? "타인 기록이라 출처는 비공개입니다" : '<span class="ezl-src">' + esc(it.source || "-") + "</span>")
      + "</div></div>"
      + '<div class="ezl-drow"><label>판단 기여도</label><div>' + (it.weight || 1) + " / 3</div></div>"
      + '<div class="ezl-drow"><label>보존</label><div>'
      + (isPinned(it) ? "평가에 인용됨 · 롤링 삭제 대상 제외" : "임시 기록 · 80건 롤링 보관 대상") + "</div></div>"
      + (it.hash
        ? '<div class="ezl-drow"><label>기록 체인</label><div><span class="ezl-src">#' + esc(it.chainSeq || "-") + " · " + esc(it.hash) + "</span></div></div>"
        : "")
      + (it.seed ? '<div class="ezl-why">데모용 예시 기록입니다 — 실제 사용으로 쌓인 기록과 구분됩니다.</div>' : "");

    var citeBody;
    if (!window.EZChat || !EZChat.exportAll) {
      citeBody = '<div class="ezl-why">대화 저장소를 불러올 수 없어 역추적할 수 없습니다.</div>';
    } else if (!cites.length) {
      citeBody = '<div class="ezl-why">이 기록을 인용한 답변이 아직 없습니다' + (used ? " (인용 카운트 " + used + "회 — 이전 세션 정리분)" : "") + ".</div>";
    } else {
      citeBody = cites.map(function (c) {
        return '<button type="button" class="ezl-cite" data-ezl-goto="' + esc(c.sid) + '">'
          + esc(c.text)
          + "<small>" + esc(c.title) + (c.at ? " · " + esc(c.at) : "")
          + (c.cited ? " · AI 실인용" : ' · <span class="gs">추측 매칭</span>') + "</small></button>";
      }).join("");
    }

    return back + head
      + '<div class="ezl-dt">' + esc(it.title) + "</div>"
      + (it.summary ? '<div class="ezl-dsum">' + esc(it.summary) + "</div>" : "")
      + (restricted ? '<div class="ezl-why">타인 기록이라 열람 규칙상 요약까지만 제공됩니다 — 원문·출처는 비공개 (보관·열람 규칙 v3.1).</div>' : "")
      + rows
      + '<div class="ezl-dhead">인용 이력 · 답변 인용 ' + used + "회</div>"
      + citeBody
      + (window.EZJourney && EZJourney.openLedger
        ? '<button type="button" class="ezl-foot-policy" data-ezl-journey="' + esc(it.id) + '" title="이 기록이 어느 단계의 결정으로 이어졌는지 봅니다" style="margin:10px 0 0">&#9672; 결정 흐름에서 보기</button>'
        : "");
  }

  /* 공통 렌더 코어 — 레거시 슬라이드 패널과 [기록] 탭이 같은 본문을 쓴다 */
  function renderCore(highlightId) {
    var all = sorted();
    /* 상세 뷰 — 목록/필터 대신 단일 항목 전체를 보여준다 */
    if (detailId) {
      var d = byId(detailId);
      var dlv = d ? polCheck(d) : "no";
      if (!d || dlv === "no") {
        detailId = null;
      } else {
        return {
          total: all.length, strip: "",
          body: '<div class="ezl-body">' + detailHtml(d, dlv) + "</div>",
          foot: ""
        };
      }
    }
    /* 열람 규칙 적용 — no는 목록에서 제외, anon/summ은 렌더 시 형태 변환 */
    var arr = [], levels = [], hidden = 0, i;
    for (i = 0; i < all.length; i++) {
      var lv0 = polCheck(all[i]);
      if (lv0 === "no") { hidden++; continue; }
      arr.push(all[i]);
      levels.push(lv0);
    }
    var counts = {};
    for (i = 0; i < arr.length; i++) counts[arr[i].type] = (counts[arr[i].type] || 0) + 1;

    var chips = '<button type="button" class="ezl-tchip' + (filterType ? "" : " on") + '" data-ezl-filter=""'
      + (filterType ? "" : ' style="background:var(--color-background-inverted);border-color:var(--color-background-inverted)"') + ">전체<b>" + arr.length + "</b></button>";
    for (i = 0; i < TYPE_ORDER.length; i++) {
      var t = TYPE_ORDER[i];
      if (counts[t]) chips += typeChipHtml(t, counts[t], filterType === t);
    }

    var list = "";
    var shown = 0;
    for (i = 0; i < arr.length; i++) {
      if (filterType && arr[i].type !== filterType) continue;
      list += itemHtml(arr[i], highlightId && arr[i].id === highlightId, levels[i]);
      shown++;
    }
    if (!shown) list = '<div class="ezl-empty">해당 유형의 기록이 아직 없습니다.<br>기능을 사용하면 자동으로 기록됩니다.</div>';
    /* 차단된 항목이 있으면 "왜 안 보이는지"를 한 줄로 밝힌다 (조용한 누락 금지) */
    if (hidden) {
      list = '<div class="ezl-why">타인·집계 기록 ' + hidden + "건은 보관·열람 규칙에 따라 표시되지 않습니다 — 내 기록은 모두 열람할 수 있습니다.</div>" + list;
    }

    var strip = '<div class="ezl-strip">' + chips + "</div>";
    /* 시드 플래그 off + 빈 스토어 — EmptyState 카드 */
    if (!loadStore().length) {
      strip = "";
      list = '<div class="ezl-empty">아직 기록이 없습니다 — 목표·체크인·1:1이 확정될 때마다 여기에 쌓입니다</div>';
    }

    var vc = verifyChain();
    var chainLine = vc.ok
      ? '<span class="ezl-chain ok">기록 체인 검증 ✓ (' + vc.count + "건 이상 없음)</span>"
      : '<span class="ezl-chain bad">⚠ 기록 체인 불일치 — 위·변조 또는 유실 의심 (' + vc.count + "건 대조)</span>";

    var foot = '<div class="ezl-foot">기능을 쓸수록 성과 기록이 쌓이고, 답변마다 어떤 기록을 인용했는지 남습니다. <b>기록은 자동, 인용은 투명.</b> · 임시 기록만 80건까지 보관, 평가에 인용된 기록은 계속 보존 '
      + '<button type="button" class="ezl-foot-policy" data-ezl-policy="1">🔒 보관·열람 규칙</button>'
      + (window.EZJourney && EZJourney.open
        ? '<button type="button" class="ezl-foot-policy" data-ezl-journey="1" title="이 기록들을 시간순이 아니라 프로세스 단계 순서로 봅니다">&#9672; 프로세스 순서로 보기</button>'
        : "")
      + '<div class="ezl-foot-row2">' + chainLine
      + '<button type="button" class="ezl-foot-policy" data-ezl-export="1" title="성과 기록을 JSON 파일로 내려받습니다">⬇ 내보내기</button>'
      + '<button type="button" class="ezl-foot-policy" data-ezl-import="1" title="내보낸 JSON을 불러와 병합합니다 (중복 기록은 건너뜀)">⬆ 가져오기</button>'
      + "</div></div>";

    return { total: arr.length, strip: strip, body: '<div class="ezl-body">' + list + "</div>", foot: foot };
  }

  function scrollToHl(container, highlightId) {
    if (!highlightId) return;
    setTimeout(function () {
      var node = container.querySelector('[data-ezl-id="' + highlightId + '"]');
      if (node && node.scrollIntoView) {
        try { node.scrollIntoView({ block: "center", behavior: "smooth" }); }
        catch (e) { node.scrollIntoView(); }
      }
    }, 280);
  }

  /* 레거시 슬라이드 패널 렌더 (딥점프 폴백용으로 유지) */
  function renderPanelBody(highlightId) {
    var p = ensurePanel();
    var c = renderCore(highlightId);
    p.innerHTML =
      '<div class="ezl-head"><div class="ezl-head-top">'
      + '<div class="ezl-title">성과 기록<small>확정된 목표·체크인·1:1·평가가 자동으로 쌓이는 원장입니다</small></div>'
      + '<button type="button" class="ezl-x" data-ezl-close="1" aria-label="닫기">×</button></div>'
      + '<div class="ezl-sub"><span class="ezl-asof">📌 기준 ' + esc(asOfStr()) + "</span>"
      + "<span>총 <b>" + c.total + "</b>건 기록</span></div></div>"
      + c.strip + c.body + c.foot;
    scrollToHl(p, highlightId);
  }

  /* ---- [Phase1 IA] elizax 도킹 패널 [기록] 탭 임베드 ---- */
  var tabMount = null;
  function renderInto(container, highlightId) {
    if (!container) return;
    injectStyle();
    tabMount = container;
    container.classList.add("ezl-embed");
    var c = renderCore(highlightId);
    container.innerHTML =
      '<div class="ezl-tabhead">'
      + '<div class="ezl-title">성과 기록' + (hasSeed() ? '<span class="ezl-demo">데모 데이터</span>' : "") + "</div>"
      + '<div class="ezl-tabdef">elizax가 답변 근거로 쓰는 나의 성과 타임라인</div>'
      + '<div class="ezl-sub"><span class="ezl-asof">📌 기준 ' + esc(asOfStr()) + "</span>"
      + "<span>총 <b>" + c.total + "</b>건</span></div></div>"
      + c.strip + c.body + c.foot;
    scrollToHl(container, highlightId);
  }
  /* 살아 있는 마운트(탭·레거시 패널) 일괄 재렌더 */
  function refreshMounts(highlightId) {
    if (tabMount && document.body.contains(tabMount)) renderInto(tabMount, highlightId || null);
    if (isPanelOpen()) renderPanelBody(highlightId || null);
  }

  function openPanel(highlightId) {
    detailId = null;   /* 외부 딥점프는 언제나 목록 + 하이라이트로 착지 */
    /* [Phase1 IA] 기본 경로: elizax 도킹 패널 [기록] 탭으로 착지.
       전체화면 허브가 떠 있으면 레거시 슬라이드 패널 유지(딥점프 폴백). */
    if (!document.querySelector(".agh-root.on") && window.Elizax && Elizax.showTab) {
      try {
        Elizax.open();
        Elizax.showTab("rec", highlightId || null);
        return;
      } catch (e) { /* 레거시 폴백 */ }
    }
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
  /* [F15] 수위 재정의 — "숨김"이 아니라 "요약 우선".
     내 기록(self)은 역할과 무관하게 항상 추적 가능(원장 점프·출처 표기),
     타인·집계 기록만 역할별 수위를 적용한다. */
  function chipLevel(it) {
    if (recRelation(it) === "self") return "trace";
    var lv = evidenceLevel();
    return lv === "logic" ? "trace" : lv;
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
    /* 키워드 매칭이 전혀 없으면 빈 배열 — weight 폴백으로 근거를 지어내지 않는다 (F15) */
    var picked = [];
    if (!scored.length) return picked;
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

  /* 감사 참조 — 답변 텍스트 해시로 GA-번호를 지어내지 않는다(위조 금지).
     원장에 실제로 남은 대응 기록(ctx-… 실 id)이 있을 때만 반환, 없으면 null → "기록 전". */
  function answerAuditRef(msg) {
    var m = msg && msg.meta;
    if (!m) return null;
    var ref = m.auditRef || m.ledgerId || m.auditId || null;
    if (!ref || String(ref).indexOf("ctx-") !== 0) return null;
    return byId(ref) ? ref : null;
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

    /* 실인용 마커 [[ctx:ID1,ID2]] — tx_elizax가 못 걷어낸 경로 대비 폴백 파싱 (표시 전 제거) */
    var i;
    if ((!msg.meta || !msg.meta.ctxRefs) && /\[\[ctx:([^\]]+)\]\]/.test(String(msg.text || ""))) {
      var mk = /\[\[ctx:([^\]]+)\]\]/.exec(String(msg.text || ""));
      msg.text = String(msg.text).replace(/\s*\[\[ctx:[^\]]*\]\]/g, "").replace(/\s+$/, "");
      var parts = mk[1].split(",");
      var mids = [];
      for (i = 0; i < parts.length; i++) {
        var mv = norm(parts[i]);
        if (mv) mids.push(mv);
      }
      if (mids.length) {
        if (!msg.meta) msg.meta = {};
        msg.meta.ctxRefs = mids;
        msg.meta.ctxCited = true;
      }
    }

    /* 근거 선택 — 마커 실인용(ctxRefs+ctxCited) 우선, 없으면 규칙 매칭(추측) 폴백 */
    var refs = (msg.meta && Object.prototype.toString.call(msg.meta.ctxRefs) === "[object Array]")
      ? msg.meta.ctxRefs.slice() : null;
    var cited = !!(msg.meta && msg.meta.ctxCited);
    var fresh = false;
    if (!refs) {
      refs = pickRefs(String(msg.text || ""));
      if (!msg.meta) msg.meta = {};
      msg.meta.ctxRefs = refs.slice();
      cited = false;
      fresh = true;
    }
    var picked = [];
    for (i = 0; i < refs.length; i++) {
      var it = byId(refs[i]);
      if (it) picked.push(it);
    }
    /* 마커 id가 전부 무효(원장에 없음)면 추측 매칭으로 강등 재선정 */
    if (!picked.length && cited) {
      refs = pickRefs(String(msg.text || ""));
      msg.meta.ctxRefs = refs.slice();
      delete msg.meta.ctxCited;
      cited = false;
      fresh = true;
      for (i = 0; i < refs.length; i++) {
        var it2f = byId(refs[i]);
        if (it2f) picked.push(it2f);
      }
    }
    if (fresh) {
      try { if (window.EZChat && EZChat.persist) EZChat.persist(); } catch (eP) { /* 무시 */ }
    }
    if (!picked.length) {
      /* 뒷받침 기록 0건 — 추측으로 채우지 않고 상태를 정직하게 표시 (F15) */
      var none = document.createElement("div");
      none.className = "ezl-ev-wrap";
      none.innerHTML = '<span class="ezl-ev-none">⚠ 이 답변을 뒷받침하는 기록 없음</span>';
      if (anchor.nextSibling) anchor.parentNode.insertBefore(none, anchor.nextSibling);
      else anchor.parentNode.appendChild(none);
      return;
    }

    /* usedCount·체인 승격은 모델 실인용(ctxCited===true)만 — 추측 refs는 카운트 금지 (F15) */
    if (cited && msg.meta && msg.meta.ctxCited === true && !msg.meta.ctxCounted) {
      for (i = 0; i < picked.length; i++) picked[i].usedCount = (picked[i].usedCount || 0) + 1;
      msg.meta.ctxCounted = true;
      saveStore();
      updateBadge();
      try { if (window.EZChat && EZChat.persist) EZChat.persist(); } catch (e) { /* 무시 */ }
    }

    /* 열람 규칙 적용 — no는 근거칩에서도 제외(사유는 아래 한 줄로 고지), anon은 익명 집계 칩 */
    var gated = [], blocked = 0;
    for (i = 0; i < picked.length; i++) {
      var glv = polCheck(picked[i]);
      if (glv === "no") { blocked++; continue; }
      gated.push({ it: picked[i], lv: glv });
    }
    if (!gated.length && !blocked) return;

    /* 실인용(ctxCited)=기존 스타일, 추측=점선 칩 + 별도 캡션 — 인용 정직화 (F15) */
    var guessCls = cited ? "" : " guess";
    var html = '<span class="ezl-ev-cap' + guessCls + '">'
      + (cited ? "근거 · AI가 인용한 기록 " : "관련일 수 있는 기록 ") + gated.length + "건</span>";
    var anyClick = false, summCnt = 0;
    for (i = 0; i < gated.length; i++) {
      var it2 = gated[i].it;
      var lv2 = gated[i].lv;
      /* [F15] 칩 수위는 항목별 — 내 기록이면 member도 원장까지 추적 가능 */
      var chLv = chipLevel(it2);
      var meta = TYPES[it2.type] || TYPES.org;
      if (lv2 === "anon") {
        html += '<span class="ezl-ev-chip' + guessCls + '" style="--ezl-c:var(--color-text-secondary)" title="응답자 보호 정책에 따라 익명 집계로 제공합니다 (정책 v3.1)">'
          + '<span class="tb">' + esc(meta.label) + "</span>익명 집계</span>";
        continue;
      }
      if (lv2 === "summ") summCnt++;
      var clickable = chLv !== "core";
      if (clickable) anyClick = true;
      html += '<span class="ezl-ev-chip' + guessCls + (clickable ? " click" : "") + '" style="--ezl-c:' + meta.color + '"'
        + (clickable ? ' data-ezl-open="' + esc(it2.id) + '" title="성과 기록에서 원문·출처·인용 이력 보기"' : ' title="' + esc(it2.title) + ' — 타인 기록이라 요약까지만 제공됩니다"') + ">"
        + '<span class="tb">' + esc(meta.label) + "</span>" + esc(shorten(it2.title, 14))
        + (clickable && lv2 === "full" ? '<span class="sr">' + esc(it2.source || "") + "</span>" : "")
        + "</span>";
    }
    picked = gated.map(function (g) { return g.it; });
    if (anyClick && picked.length) {
      html += '<button type="button" class="ezl-ev-link" data-ezl-open="' + esc(picked[0].id) + '">성과 기록에서 보기</button>';
      html += '<button type="button" class="ezl-ev-link" data-ezl-journey="1" title="이 근거들이 성과 사이클 어느 단계의 결정으로 이어지는지 봅니다">&#9672; 결정 흐름</button>';
    }
    /* [F15] 산출 로직은 "이 답이 어떻게 만들어졌는가" = 본인 검증 동선 — 역할로 통째 차단하지 않는다 */
    html += '<button type="button" class="ezl-ev-logic" data-ezl-logic="1" data-ezl-refs="'
      + esc(refs.join(",")) + '" data-ezl-ga="' + esc(answerAuditRef(msg) || "") + '">산출 로직 보기</button>';
    /* 제한이 걸린 경우에만 이유를 한 줄로 */
    if (blocked || summCnt) {
      var why = [];
      if (blocked) why.push("타인·집계 기록 " + blocked + "건은 열람 규칙상 제외");
      if (summCnt) why.push("타인 기록 " + summCnt + "건은 요약까지만");
      html += '<span class="ezl-ev-cap guess" title="보관·열람 규칙 v3.1">' + esc(why.join(" · ")) + "</span>";
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
    var ga = norm(btn.getAttribute("data-ezl-ga") || "");
    var cited = [], ruleSrcs = [], citedIds = [], restricted = 0, i, it;
    for (i = 0; i < ids.length; i++) {
      it = byId(ids[i]);
      if (!it) continue;
      /* 열람 규칙 — 타인·집계 기록의 원문·출처는 로직 팝오버에도 노출하지 않는다 */
      var lv = polCheck(it);
      if (lv === "no" || lv === "anon") { restricted++; continue; }
      cited.push(it.title);
      citedIds.push(it.id);
      if (it.type === "rule" && lv === "full") ruleSrcs.push(it.source);
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
      /* 감사 참조는 원장 실 id만 — 대응 기록이 없으면 정직하게 "기록 전" */
      + '<div class="ezl-pop-ga">'
      + (ga
        ? "⛨ 감사 기록됨 · <b>" + esc(ga) + "</b>"
        : "⛨ 기록 전 — 이 답변은 아직 원장에 결정으로 기록되지 않았습니다 (결정 게이트 확정 시 기록)")
      + (citedIds.length ? "<br>인용 기록 id · <b>" + esc(citedIds.join(", ")) + "</b>" : "")
      + (restricted ? "<br>타인·집계 기록 " + restricted + "건은 열람 규칙에 따라 제외됨" : "")
      + "</div>";
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

  /* ================= 내보내기 / 가져오기 (F4) ================= */
  function exportJson() {
    try {
      var blob = new Blob([JSON.stringify({ v: 2, emp_id: CU.emp_id, exported_at: nowStamp(), items: loadStore() }, null, 2)],
        { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "elizax_history_" + (CU.emp_id || "anon") + ".json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      toast("성과 기록 " + loadStore().length + "건 내보냄");
    } catch (e) { toast("내보내기 실패"); }
  }
  function importFile() {
    var inp = document.getElementById("ezl-import-file");
    if (!inp) {
      inp = document.createElement("input");
      inp.type = "file";
      inp.id = "ezl-import-file";
      inp.accept = ".json,application/json";
      inp.style.display = "none";
      document.body.appendChild(inp);
      inp.addEventListener("change", function () {
        var f = inp.files && inp.files[0];
        inp.value = "";
        if (!f || !window.FileReader) return;
        var rd = new FileReader();
        rd.onload = function () {
          var added = 0;
          try {
            var obj = JSON.parse(String(rd.result || ""));
            var list = obj && Object.prototype.toString.call(obj.items) === "[object Array]" ? obj.items : [];
            loadStore();
            for (var i = 0; i < list.length; i++) {
              var it = list[i];
              if (!it || !it.id || !it.type || !it.title) continue;
              if (byId(it.id)) continue; /* id 중복은 건너뜀 */
              items.push(it);
              added++;
            }
            if (added) { saveStore(); updateBadge(true); }
            toast(added ? "기록 " + added + "건 가져옴 (중복 제외)" : "가져올 새 기록이 없습니다");
          } catch (e) { toast("가져오기 실패 — JSON 형식을 확인하세요"); }
        };
        rd.readAsText(f);
      });
    }
    inp.click();
  }

  /* ================= 이벤트 위임 ================= */
  function onDocClick(ev) {
    var t = ev.target;

    /* 팝오버 밖 클릭 → 팝오버 닫기 (로직 버튼 자체는 아래에서 처리) */
    var pop = document.getElementById("ezl-pop");
    if (pop && !pop.contains(t) && !closestAttr(t, "data-ezl-logic")) closeLogicPop();

    /* 닫기 (X·스크림) */
    if (closestAttr(t, "data-ezl-close")) { ev.preventDefault(); closePanel(); return; }

    /* type 필터 칩 */
    var fc = closestAttr(t, "data-ezl-filter");
    if (fc) {
      ev.preventDefault();
      var ft = fc.getAttribute("data-ezl-filter") || "";
      filterType = (filterType === ft) ? "" : ft;
      refreshMounts(null);
      return;
    }

    /* 상세 → 목록 되돌아가기 */
    if (closestAttr(t, "data-ezl-back")) {
      ev.preventDefault();
      detailId = null;
      refreshMounts(null);
      return;
    }

    /* 인용한 답변으로 역추적 — 해당 세션으로 전환하고 대화 탭에 착지 */
    var gt = closestAttr(t, "data-ezl-goto");
    if (gt) {
      ev.preventDefault();
      var sid = gt.getAttribute("data-ezl-goto");
      try { if (window.EZChat && EZChat.switchSession) EZChat.switchSession(sid); } catch (e0) { /* 세션 없음 */ }
      detailId = null;
      closePanel();
      try {
        if (window.Elizax && Elizax.showTab) { Elizax.open(); Elizax.showTab("chat"); }
      } catch (e1) { /* 패널 미탑재 */ }
      return;
    }

    /* 결정 흐름 (tx_journey.js) — 패널을 닫고 맵을 연다.
       값이 원장 항목 id면 그 기록을 인용하는 노드로 딥링크 착지 */
    var jn = closestAttr(t, "data-ezl-journey");
    if (jn) {
      ev.preventDefault();
      var jv = jn.getAttribute("data-ezl-journey");
      closePanel();
      if (window.EZJourney && EZJourney.open) {
        if (jv && jv.indexOf("ctx-") === 0) EZJourney.open({ ledger: jv });
        else EZJourney.open();
      }
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

    /* 내보내기 / 가져오기 */
    if (closestAttr(t, "data-ezl-export")) { ev.preventDefault(); exportJson(); return; }
    if (closestAttr(t, "data-ezl-import")) { ev.preventDefault(); importFile(); return; }

    /* 근거칩·"성과 기록에서 보기" → 패널 열고 해당 항목 하이라이트 */
    var op = closestAttr(t, "data-ezl-open");
    if (op) { ev.preventDefault(); openPanel(op.getAttribute("data-ezl-open") || null); return; }

    /* 원장 항목 행 클릭 → 상세 (원문 전체·출처·인용 이력) */
    var row = closestAttr(t, "data-ezl-id");
    if (row) {
      ev.preventDefault();
      detailId = row.getAttribute("data-ezl-id") || null;
      refreshMounts(null);
      return;
    }

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
    if (detailId) { detailId = null; refreshMounts(null); return; }   /* 상세 → 목록 */
    if (isPanelOpen()) closePanel();
  }

  function onCtxEvent(ev) {
    var d = ev && ev.detail;
    if (!d || !d.title) return;
    var e = addEntry(d);
    if (e) {
      updateBadge(true);
      toast("성과 기록에 저장됨 · " + shorten(e.title, 22));
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
    on: on,                   /* 구독: on("add", fn) — 항목 축적 시 알림 */
    list: function () { return sorted(); },
    openPanel: openPanel,
    closePanel: closePanel,
    renderInto: renderInto,   /* [Phase1 IA] elizax [기록] 탭 임베드 렌더 (필터·푸터 포함 풀뷰) */
    renderRows: renderRows,   /* [기록] 탭 간이 행 렌더 (rows, not Cards) */
    count: function () { return loadStore().length; },
    verifyChain: verifyChain,
    isPinned: isPinned
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
