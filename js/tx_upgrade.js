/* ============================================================
   tx_upgrade.js — elizax 서비스·UI 고도화 (2025-26 리서치 반영)
   B1 FAB 상태 글로우 오브   (Apple Intelligence Siri glow 패턴)
   B2 컨텍스트 어웨어 FAB 칩 (M365 Copilot Dynamic Action Button)
   A3 리뷰 품질·편향 린트    (Culture Amp "Improve" · SAP Calibration)
      + 목표 스코프 측정 가능성 린트 (목표 생성 overlay 목표명·KR 지표 input 포함)
   A6 AI 관여 고지·이의제기  (EU AI Act 2026.8 · PIPA §37조의2)
   A1 1:1 미팅 코파일럿      (Lattice·15Five·SAP Joule 공통 투자 영역)
   F6 인라인 결과 착지 표준  (window.EZApply — 아래 계약)
   F10 역할 관점 주입        (member/leader/hr/exec 별 프롬프트·문구)
   전부 vanilla JS · .ezup-* 스코프 · 기존 화면 미간섭 · 목업 동작.

   ------------------------------------------------------------
   [계약] window.EZApply.popover(opts) → handle          (ez:apply 규약)
   ------------------------------------------------------------
   인라인 AI 트리거(✦ 정제·초안)가 결과를 채팅에 흘려보내지 않고, 원 필드
   옆 미니 팝오버로 되돌려 [적용] 한 번에 필드에 반영시키기 위한 공용 API.
   tx_fix_perf·tx_fix_appr·tx_meeting 등 다른 파일도 그대로 호출하면 된다.

   opts (모두 선택, 단 field/fieldSel 또는 draft/run 중 하나는 필요)
     field     : HTMLElement  결과가 착지할 input/textarea
     fieldSel  : string       field 대신 CSS 선택자(적용 시점에 재조회 — 재렌더 안전)
     anchor    : HTMLElement  위치 기준 요소 (기본 field)
     original  : string       원문 (기본 field.value). 없으면 "초안" 단일행 모드
     title     : string       팝오버 제목 (기본 "elizax 정제안")
     note      : string       제목 아래 한 줄 설명 (역할 관점 등)
     draft     : string       즉시 표시할 결과 (run 없이 쓸 때)
     run       : fn(ctx)      결과 생성기. ctx.done(text) / ctx.fail(msg) 호출.
                              지정 시 팝오버는 로딩 상태로 열리고 [재생성]이 붙는다
     applyLabel: string       적용 버튼 라벨 (기본 "적용")
     onApply   : fn(text, field) → false를 반환하면 기본 반영(값 대입) 생략
     chat      : {label, prompt} | string
                              "대화로 계속" 보조 링크. 기본 동작이 아니라 보조 링크로만 노출
     audit     : {source, title, summary}  적용 시 ez:ctx(type:"audit") 실발행
     onClose   : fn()
   handle
     { el, done(text), fail(msg), close() }
   동작 규칙
     · 팝오버는 화면에 항상 1개(단일 슬롯) — 새로 열면 이전 것은 닫힌다
     · Esc·바깥 클릭·스크롤 이탈 시 닫힘. 적용 전에는 필드를 건드리지 않는다
     · 실패는 감춘 채 통과시키지 않고 문구로 노출하며 [재생성]을 남긴다
   ============================================================ */
(function () {
  "use strict";
  var TX = window.TX || {};
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function elizaxSend(t) { if (window.Elizax && window.Elizax.send) window.Elizax.send(t); }

  /* ================= CSS ================= */
  var css = [
    /* ---- B1 글로우 오브: FAB 상태를 색·모션으로만 ---- */
    /* 색은 accent 토큰 유도(§8) — .ezx-fab이 astryx 테마 루트라 var 해석됨. keyframes는 ez_kit 단일 정의(ezkSpin/ezkPulse) 참조 */
    ".ezx-fab{ isolation:isolate; }",
    ".ezx-fab::before{ content:''; position:absolute; inset:-4px; border-radius:50%; z-index:-1;",
    "  background:conic-gradient(from 0deg, var(--color-accent), color-mix(in srgb, var(--color-accent) 45%, white), color-mix(in srgb, var(--color-accent) 55%, var(--color-text-purple)), var(--color-accent));",
    "  opacity:0; filter:blur(7px); transition:opacity var(--duration-medium) var(--ease-standard); }",
    "body.ezup-glow-work .ezx-fab::before{ opacity:.85; animation:ezkSpin var(--duration-slow-max) linear infinite; }",
    "body.ezup-glow-suggest .ezx-fab::before{ opacity:.7; animation:ezkPulse var(--duration-slow) ease-in-out infinite; }",
    "body.ezup-glow-wait .ezx-fab::before{ opacity:.55; filter:blur(4px); animation:none; }",

    /* ---- B2 컨텍스트 칩: FAB 왼쪽에서 잠깐 내미는 제안 pill ---- */
    /* 단일 pill 슬롯(§6): FAB 위 1좌표(r24 b94) — eze-pill·agh-popup과 동일 슬롯을 시간 공유. astryx 토큰만(chipEl에 data-astryx-theme 스탬프) */
    ".ezup-ctxchip{ position:fixed; right:24px; bottom:94px; z-index:var(--z-badge);",
    "  display:flex; align-items:center; gap:7px; font-family:var(--font-family-body); font-size:12.5px; font-weight:600; letter-spacing:-.01em;",
    "  color:var(--color-accent); background:color-mix(in srgb, var(--color-background-surface) 86%, transparent);",
    "  backdrop-filter:saturate(180%) blur(20px); -webkit-backdrop-filter:saturate(180%) blur(20px);",
    "  border:1px solid var(--color-border); border-radius:var(--radius-full); padding:9px 15px; cursor:pointer;",
    "  box-shadow:0 8px 26px var(--color-shadow); white-space:nowrap;",
    "  opacity:0; transform:translateY(10px) scale(.85); transform-origin:right bottom;",
    "  transition:opacity var(--duration-medium-min) var(--ease-standard), transform var(--duration-medium) var(--ease-standard); }",
    ".ezup-ctxchip.show{ opacity:1; transform:none; }",
    ".ezup-ctxchip:active{ transform:scale(.95); }",
    ".ezup-ctxchip .spark{ color:var(--color-accent); }",

    /* ---- A3 품질 린트 바 ---- */
    ".ezup-lint{ display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-top:7px; font-family:var(--sans); font-size:11px; }",
    ".ezup-lint .lab{ font-weight:600; color:var(--ink-3,#7a7a7a); }",
    ".ezup-lint-chip{ display:inline-flex; align-items:center; gap:4px; border-radius:999px; padding:3px 10px; font-weight:600; border:1px solid; }",
    ".ezup-lint-chip.warn{ color:#B45309; background:rgba(180,83,9,.07); border-color:rgba(180,83,9,.3); }",
    ".ezup-lint-chip.bad{ color:#B42318; background:rgba(180,35,24,.06); border-color:rgba(180,35,24,.3); }",
    ".ezup-lint-chip.ok{ color:#15803D; background:rgba(21,128,61,.07); border-color:rgba(21,128,61,.3); }",
    ".ezup-lint-fix{ margin-left:auto; font-weight:600; color:var(--blue-2,#1F7AF0); background:none; border:1px solid var(--blue,#1F7AF0); border-radius:999px; padding:3px 12px; cursor:pointer; font-size:11px; transition:transform .15s cubic-bezier(.32,.72,.24,1); }",
    ".ezup-lint-fix:active{ transform:scale(.95); }",

    /* ---- A6 AI 관여 고지 배지 ---- */
    ".ezup-aiog{ display:inline-flex; align-items:center; gap:5px; font-family:var(--sans); font-size:11px; font-weight:600;",
    "  color:var(--ink-2,#424245); background:var(--card,#fff); border:1px solid var(--line,#e0e0e0); border-radius:999px; padding:4px 12px; cursor:pointer; margin-left:10px; vertical-align:middle;",
    "  transition:border-color .12s, transform .15s cubic-bezier(.32,.72,.24,1); }",
    ".ezup-aiog:hover{ border-color:var(--blue,#1F7AF0); color:var(--blue-2,#1F7AF0); }",
    ".ezup-aiog:active{ transform:scale(.95); }",
    ".ezup-aiog .i{ color:var(--blue,#1F7AF0); }",
    ".ezup-aiog-body{ font-size:13px; line-height:1.7; color:var(--ink,#1d1d1f); }",
    ".ezup-aiog-body .sec{ margin-bottom:13px; }",
    ".ezup-aiog-body .sec b{ display:block; margin-bottom:3px; font-weight:600; letter-spacing:-.02em; }",
    ".ezup-aiog-body .reg{ font-size:11.5px; color:var(--ink-3,#7a7a7a); background:var(--soft,#f5f5f7); border-radius:8px; padding:8px 11px; }",
    ".ezup-aiog-policy{ display:inline-flex; align-items:center; gap:5px; margin-top:11px; font-family:var(--sans); font-size:11.5px; font-weight:600;",
    "  color:var(--blue-2,#1F7AF0); background:none; border:1px solid var(--line,#e0e0e0); border-radius:999px; padding:5px 13px; cursor:pointer;",
    "  transition:border-color .12s, transform .15s cubic-bezier(.32,.72,.24,1); }",
    ".ezup-aiog-policy:hover{ border-color:var(--blue,#1F7AF0); }",
    ".ezup-aiog-policy:active{ transform:scale(.95); }",

    /* ---- A1 1:1 브리핑 ---- */
    ".ezup-brief-btn{ display:inline-flex; align-items:center; gap:6px; font-family:var(--sans); font-size:12px; font-weight:600;",
    "  color:#fff; background:var(--blue,#1F7AF0); border:none; border-radius:999px; padding:6px 14px; cursor:pointer; margin-left:10px; vertical-align:middle;",
    "  transition:background .12s, transform .15s cubic-bezier(.32,.72,.24,1); }",
    ".ezup-brief-btn:hover{ background:var(--blue-2,#186AD4); }",
    ".ezup-brief-btn:active{ transform:scale(.95); }",
    ".ezup-brief{ font-family:var(--sans); font-size:13px; color:var(--ink,#1d1d1f); line-height:1.65; }",
    ".ezup-brief .bsec{ border:1px solid var(--line,#e8e8ed); border-radius:11px; padding:12px 14px; margin-bottom:10px; }",
    ".ezup-brief .bsec > b{ display:block; font-weight:600; letter-spacing:-.02em; margin-bottom:6px; }",
    ".ezup-brief .src{ display:inline-block; font-size:10px; font-weight:600; color:#1F7AF0; background:rgba(31,122,240,.08); border:1px solid rgba(31,122,240,.3); border-radius:5px; padding:1px 6px; margin-left:5px; vertical-align:1px; }",
    ".ezup-brief .pt{ display:flex; gap:8px; padding:4px 0; }",
    ".ezup-brief .pt .n{ flex:none; width:18px; height:18px; border-radius:50%; background:var(--soft,#f5f5f7); color:var(--blue-2,#1F7AF0); font-size:10.5px; font-weight:600; display:flex; align-items:center; justify-content:center; margin-top:2px; }",
    ".ezup-brief .acts{ display:flex; gap:8px; margin-top:12px; }",
    ".ezup-brief .bar{ height:5px; background:var(--soft,#f5f5f7); border-radius:3px; overflow:hidden; margin-top:4px; }",
    ".ezup-brief .bar i{ display:block; height:100%; background:var(--blue,#1F7AF0); }",
    ".ezup-brief select{ width:100%; border:1px solid var(--line,#e0e0e0); border-radius:8px; padding:7px 10px; font:inherit; font-size:12.5px; margin-top:2px; }",
    ".ezup-spin{ display:inline-block; width:11px; height:11px; border:2px solid rgba(31,122,240,.25); border-top-color:var(--blue,#1F7AF0); border-radius:50%; animation:ezupSpin2 .8s linear infinite; vertical-align:-2px; margin-right:4px; }",
    "@keyframes ezupSpin2{ to{ transform:rotate(360deg); } }",
    ".ezup-retry{ font:inherit; font-size:11px; font-weight:600; color:var(--blue-2,#1F7AF0); background:none; border:1px solid var(--blue,#1F7AF0); border-radius:999px; padding:2px 10px; cursor:pointer; margin-left:4px; }",

    /* ---- F6 인라인 착지 팝오버 (EZApply) ---- */
    ".ezup-ap{ position:fixed; z-index:calc(var(--z-badge, 900) + 5); width:380px; max-width:calc(100vw - 24px);",
    "  font-family:var(--sans); background:var(--card,#fff); border:1px solid var(--line,#e0e0e0); border-radius:12px;",
    "  box-shadow:0 14px 40px rgba(0,0,0,.14); padding:13px 15px 12px;",
    "  opacity:0; transform:translateY(-6px); transition:opacity .14s ease, transform .14s cubic-bezier(.32,.72,.24,1); }",
    ".ezup-ap.show{ opacity:1; transform:none; }",
    ".ezup-ap-h{ display:flex; align-items:center; gap:6px; font-size:12.5px; font-weight:700; color:var(--ink,#1d1d1f); }",
    ".ezup-ap-h .sp{ color:var(--blue,#1F7AF0); }",
    ".ezup-ap-h .x{ margin-left:auto; border:none; background:none; color:var(--ink-4,#98A2B3); font-size:14px; cursor:pointer; line-height:1; padding:2px 4px; }",
    ".ezup-ap-note{ font-size:11px; color:var(--ink-3,#7a7a7a); margin-top:3px; }",
    ".ezup-ap-row{ margin-top:9px; }",
    ".ezup-ap-lab{ font-size:10.5px; font-weight:700; color:var(--ink-4,#98A2B3); margin-bottom:3px; }",
    ".ezup-ap-txt{ font-size:12.5px; line-height:1.6; color:var(--ink-2,#424245); background:var(--soft,#f5f5f7); border-radius:8px; padding:8px 11px; max-height:132px; overflow:auto; white-space:pre-wrap; }",
    ".ezup-ap-row.new .ezup-ap-txt{ color:var(--ink,#1d1d1f); background:rgba(31,122,240,.06); border:1px solid rgba(31,122,240,.22); }",
    ".ezup-ap-row.old .ezup-ap-txt{ text-decoration:none; opacity:.8; }",
    ".ezup-ap-acts{ display:flex; align-items:center; gap:7px; margin-top:11px; }",
    ".ezup-ap-btn{ font:inherit; font-size:12px; font-weight:700; border-radius:999px; padding:6px 14px; cursor:pointer; border:1px solid var(--line,#e0e0e0); background:var(--card,#fff); color:var(--ink,#1d1d1f); transition:transform .15s cubic-bezier(.32,.72,.24,1); }",
    ".ezup-ap-btn.primary{ background:var(--blue,#1F7AF0); border-color:var(--blue,#1F7AF0); color:#fff; }",
    ".ezup-ap-btn:disabled{ opacity:.5; cursor:default; }",
    ".ezup-ap-btn:active:not(:disabled){ transform:scale(.96); }",
    ".ezup-ap-chat{ margin-left:auto; font:inherit; font-size:11px; font-weight:600; color:var(--ink-3,#7a7a7a); background:none; border:none; text-decoration:underline; text-underline-offset:2px; cursor:pointer; }",
    ".ezup-ap-chat:hover{ color:var(--blue-2,#1F7AF0); }",

    /* ---- 액션 영역 분리: subnav 탭과 섞이지 않게 하단 구분 블록 ---- */
    ".ezup-navacts{ margin-top:14px; padding:12px 16px 6px; border-top:1px solid var(--line,#e8e8ed); display:flex; flex-direction:column; align-items:stretch; gap:8px; }",
    ".ezup-navacts .ezup-navlab{ font-family:var(--sans); font-size:10.5px; font-weight:700; letter-spacing:.03em; color:var(--ink-4,#98A2B3); }",
    ".ezup-navacts > button{ margin-left:0; width:100%; justify-content:center; }"
  ].join("\n");
  var st = document.createElement("style");
  st.id = "ezup-css";
  st.textContent = css;
  document.head.appendChild(st);

  /* ============================================================
     B1 — FAB 글로우 오브 상태기계
     idle(없음) · work(회전 shimmer) · suggest(halo pulse) · wait(고정 링)
     ============================================================ */
  var GLOWS = ["ezup-glow-work", "ezup-glow-suggest", "ezup-glow-wait"];
  var curGlow = null;
  function setGlow(state) {
    if (state === curGlow) return; /* observer 재트리거·무한 루프 방지 */
    curGlow = state;
    GLOWS.forEach(function (c) { document.body.classList.remove(c); });
    if (state) document.body.classList.add("ezup-glow-" + state);
  }
  /* 스트리밍 감지: 도킹 리스트 안 .ezx-caret 존재 → work */
  var glowObs = new MutationObserver(function () {
    var caret = document.querySelector(".ezx-list .ezx-caret");
    var popup = document.querySelector(".agh-popup.show");
    var gate = document.querySelector(".ezx-list .agh-gate .agh-btn[data-chosen]") ? null : document.querySelector(".ezx-list .agh-gate");
    if (caret) setGlow("work");
    else if (popup) setGlow("suggest");
    else if (gate) setGlow("wait");
    else setGlow(null);
  });
  glowObs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });

  /* ============================================================
     B2 — 컨텍스트 어웨어 FAB 칩 (탭 전환 시 제안이 바뀜)
     ============================================================ */
  var CTX_SUGGEST = {
    home: { chip: "이번 주 성과 브리핑", ask: "이번 주 내 성과 현황을 브리핑해줘" },
    perf: { chip: "목표 정렬 점검", ask: "팀 목표 정렬·중복 점검해줘" },
    "perf-1": { chip: "피드백 문장 정제", ask: "피드백 문장 정제해줘" },
    "perf-2": { chip: "1:1 미팅 브리핑", ask: "__brief__" },
    "perf-3": { chip: "리뷰 초안 지원", ask: "리뷰 초안 작성 도와줘" },
    appr: { chip: "평가 문장 품질 린트", ask: "평가 코멘트 근거 초안 도와줘" },
    msf: { chip: "360 피드백 요약", ask: "동료 피드백 요약해줘" },
    work: { chip: "주간 체크인 요약", ask: "주간 중간점검 요약해줘" }
  };
  var chipEl = null, chipTimer = null;
  function showChip(cfg) {
    if (!chipEl) {
      chipEl = document.createElement("button");
      chipEl.className = "ezup-ctxchip";
      chipEl.type = "button";
      chipEl.setAttribute("data-astryx-theme", "talenx"); /* astryx 토큰 스코프 — body 직속이라 직접 스탬프 */
      chipEl.addEventListener("click", function () {
        var ask = chipEl._ask;
        hideCtxChip(true); /* acted — [알림] 적재 생략 */
        if (ask === "__brief__") openMeetingBrief();
        else elizaxSend(ask);
      });
      document.body.appendChild(chipEl);
    }
    chipEl.innerHTML = '<span class="spark">✦</span>' + esc(cfg.chip);
    chipEl._ask = cfg.ask;
    clearTimeout(chipTimer);
    /* 단일 슬롯 선점 — 상위 우선순위(감지 카드·pill)가 점유 중이면 표시하지 않고 [알림]에만 적재됨 */
    if (window.EZProactive && !EZProactive.claim("ezup-ctxchip", hideCtxChip)) return;
    requestAnimationFrame(function () { chipEl.classList.add("show"); });
    chipTimer = setTimeout(hideCtxChip, 6000); /* 자연 소멸 → 코디네이터가 [알림] 탭 적재 */
  }
  function showCtxChip(key) {
    var cfg = CTX_SUGGEST[key];
    if (!cfg) { hideCtxChip(); return; }
    showChip(cfg);
  }
  function hideCtxChip(acted) {
    if (window.EZProactive) EZProactive.release("ezup-ctxchip", acted === true);
    clearTimeout(chipTimer);
    if (chipEl) chipEl.classList.remove("show");
  }
  /* §6 온보딩: AI 진입점 0인 4화면 최초 1회 안내 pill */
  var ONBOARD_SCREENS = { wf: 1, att: 1, hrm: 1, pay: 1 };
  function maybeOnboard(key) {
    if (!ONBOARD_SCREENS[key]) return false;
    var seen = {};
    try { seen = JSON.parse(localStorage.getItem("ezup_onboard_v1") || "{}"); } catch (e) {}
    if (seen[key]) return false;
    seen[key] = 1;
    try { localStorage.setItem("ezup_onboard_v1", JSON.stringify(seen)); } catch (e) {}
    showChip({ chip: "이 화면에서도 elizax에게 물어볼 수 있어요", ask: "이 화면에서 도와줄 수 있는 일을 알려줘" });
    return true;
  }
  document.addEventListener("click", function (e) {
    var gb = e.target.closest("#gnb [data-s]");
    if (gb) { setTimeout(function () { var k = gb.getAttribute("data-s"); if (!maybeOnboard(k)) showCtxChip(k); }, 350); return; }
    var sn = e.target.closest(".subnav a[data-p]");
    if (sn) {
      var sec = sn.closest("section.screen");
      if (sec && sec.id === "s-perf") setTimeout(function () { showCtxChip("perf-" + sn.getAttribute("data-p")); }, 250);
    }
    var logo = e.target.closest(".logo");
    if (logo) setTimeout(function () { showCtxChip("home"); }, 350);
  }, true);

  /* ============================================================
     F10 — 역할 관점 (공통 롤키 → 프롬프트·문구 렌즈)
     생성 계층이 역할 무관이면 leader가 팀 관점 문장을, hr이 전사 정합성
     문장을 못 받는다. 프롬프트 앞단과 UI 문구에 같은 렌즈를 주입한다.
     ============================================================ */
  var ROLE_LENS = {
    member: { label: "조직원", short: "본인", prompt: "관점: 본인(조직원). 내가 무엇을 했고 어떤 근거가 남았는지를 1인칭 기여 중심으로 정리한다." },
    leader: { label: "조직장", short: "팀", prompt: "관점: 조직장(팀 리더). 팀 목표 정합·팀원 간 형평·리더가 할 개입을 기준으로 정리한다. 특정 팀원을 깎아내리는 표현은 쓰지 않는다." },
    hr: { label: "HR", short: "전사 정합성", prompt: "관점: HR(전사). 전사 정합성·평가규정 준수·부서 간 형평과 재현 가능한 기준을 우선한다. 개인 신상 추측은 하지 않는다." },
    exec: { label: "경영진", short: "전략", prompt: "관점: 경영진. 전략 정렬과 조직 단위 리스크를 우선하고 개인 단위 서술은 최소화한다." }
  };
  function roleLens() { return ROLE_LENS[upRole()] || ROLE_LENS.member; }

  /* ============================================================
     F6 — window.EZApply : 인라인 결과 착지 표준 (ez:apply 규약)
     계약 전문은 파일 상단 주석 참조. 여기서는 단일 슬롯 팝오버 1개만 관리.
     ============================================================ */
  var apCur = null; /* 단일 슬롯 — 새 팝오버가 열리면 이전 것 닫힘 */
  function apClose() {
    if (!apCur) return;
    var h = apCur;
    apCur = null;
    document.removeEventListener("keydown", h._key, true);
    document.removeEventListener("mousedown", h._out, true);
    window.removeEventListener("scroll", h._pos, true);
    window.removeEventListener("resize", h._pos);
    h.el.classList.remove("show");
    setTimeout(function () { if (h.el.parentNode) h.el.remove(); }, 160);
    if (h._onClose) { try { h._onClose(); } catch (e) {} }
  }
  function apPlace(el, anchor) {
    if (!anchor || !anchor.getBoundingClientRect) return;
    var r = anchor.getBoundingClientRect();
    var w = el.offsetWidth || 380, hgt = el.offsetHeight || 200;
    var left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    var top = r.bottom + 8;
    if (top + hgt > window.innerHeight - 8) top = Math.max(8, r.top - hgt - 8);
    el.style.left = left + "px";
    el.style.top = top + "px";
  }
  function popover(opts) {
    opts = opts || {};
    apClose();
    var field = opts.field || (opts.fieldSel ? document.querySelector(opts.fieldSel) : null);
    var anchor = opts.anchor || field;
    if (!anchor) return null;
    var original = opts.original != null ? opts.original : (field ? (field.value != null ? field.value : field.textContent) : "");
    var el = document.createElement("div");
    el.className = "ezup-ap";
    el.setAttribute("data-astryx-theme", "talenx");
    var K = window.EZKit;
    el.innerHTML =
      '<div class="ezup-ap-h"><span class="sp">' + ((K && K.marker) || "✦") + "</span>" + esc(opts.title || "elizax 정제안") +
      (K && K.status ? '<span style="margin-left:6px;font-weight:500">' + K.status("suggest") + "</span>" : "") +
      '<button type="button" class="x" aria-label="닫기">✕</button></div>' +
      (opts.note ? '<div class="ezup-ap-note">' + esc(opts.note) + "</div>" : "") +
      (original ? '<div class="ezup-ap-row old"><div class="ezup-ap-lab">원문</div><div class="ezup-ap-txt">' + esc(original) + "</div></div>" : "") +
      '<div class="ezup-ap-row new"><div class="ezup-ap-lab">' + (original ? "정제안" : "초안") + '</div><div class="ezup-ap-txt" data-ap-new></div></div>' +
      '<div class="ezup-ap-acts">' +
      '<button type="button" class="ezup-ap-btn primary" data-ap-apply disabled>' + esc(opts.applyLabel || "적용") + "</button>" +
      '<button type="button" class="ezup-ap-btn" data-ap-cancel>닫기</button>' +
      (opts.run ? '<button type="button" class="ezup-ap-btn" data-ap-regen hidden>재생성</button>' : "") +
      (opts.chat ? '<button type="button" class="ezup-ap-chat" data-ap-chat>' + esc((typeof opts.chat === "string" ? "대화로 계속" : (opts.chat.label || "대화로 계속"))) + "</button>" : "") +
      "</div>";
    document.body.appendChild(el);
    var box = el.querySelector("[data-ap-new]");
    var bApply = el.querySelector("[data-ap-apply]");
    var bRegen = el.querySelector("[data-ap-regen]");
    var text = "";

    var h = {
      el: el,
      _onClose: opts.onClose,
      _pos: function () { apPlace(el, anchor); },
      _key: function (e) { if (e.key === "Escape") { e.stopPropagation(); apClose(); } },
      _out: function (e) { if (!el.contains(e.target) && e.target !== anchor) apClose(); },
      close: apClose,
      done: function (t) {
        text = String(t == null ? "" : t).trim();
        if (!text) { h.fail("빈 응답"); return; }
        box.textContent = text;
        bApply.disabled = false;
        if (bRegen) bRegen.hidden = false;
        h._pos();
      },
      fail: function (msg) {
        text = "";
        box.textContent = "생성 실패 — " + (msg || "응답을 받지 못했습니다.") + (original ? " (원 문장은 그대로 둡니다)" : "");
        bApply.disabled = true;
        if (bRegen) bRegen.hidden = false;
        h._pos();
      }
    };
    apCur = h;

    el.querySelector(".x").addEventListener("click", apClose);
    el.querySelector("[data-ap-cancel]").addEventListener("click", apClose);
    bApply.addEventListener("click", function () {
      if (!text) return;
      var tgt = opts.fieldSel ? document.querySelector(opts.fieldSel) : field; /* 재렌더 대비 재조회 */
      var handled = false;
      if (opts.onApply) handled = (opts.onApply(text, tgt) === false);
      if (!handled && tgt) {
        if ("value" in tgt) {
          tgt.value = text;
          tgt.dispatchEvent(new Event("input", { bubbles: true }));
          tgt.dispatchEvent(new Event("change", { bubbles: true }));
        } else tgt.textContent = text;
        try { tgt.focus(); } catch (e) {}
      }
      if (opts.audit) {
        try {
          document.dispatchEvent(new CustomEvent("ez:ctx", { detail: {
            type: "audit", source: opts.audit.source || "ez:apply", weight: 1,
            title: opts.audit.title || "elizax 초안 적용",
            summary: opts.audit.summary || String(text).slice(0, 80)
          } }));
        } catch (e) { /* 원장 미탑재 */ }
      }
      if (window.TX && TX.toast) TX.toast("적용했습니다 · 확정 전이며 되돌릴 수 있습니다", "ok");
      apClose();
    });
    if (bRegen) bRegen.addEventListener("click", function () { start(); });
    var chatBtn = el.querySelector("[data-ap-chat]");
    if (chatBtn) chatBtn.addEventListener("click", function () {
      var p = typeof opts.chat === "string" ? opts.chat : opts.chat.prompt;
      try { if (window.Elizax && Elizax.open) Elizax.open(); } catch (e) {}
      if (p) elizaxSend(p);
      apClose();
    });

    function start() {
      box.innerHTML = '<span class="ezup-spin"></span>elizax가 작성 중…';
      bApply.disabled = true;
      if (bRegen) bRegen.hidden = true;
      try {
        opts.run({ done: function (t) { if (apCur === h) h.done(t); }, fail: function (m) { if (apCur === h) h.fail(m); } });
      } catch (e) { h.fail(e && e.message ? e.message : String(e)); }
    }
    if (opts.run) start();
    else h.done(opts.draft || "");

    document.addEventListener("keydown", h._key, true);
    setTimeout(function () { document.addEventListener("mousedown", h._out, true); }, 0);
    window.addEventListener("scroll", h._pos, true);
    window.addEventListener("resize", h._pos);
    requestAnimationFrame(function () { apPlace(el, anchor); el.classList.add("show"); });
    return h;
  }
  window.EZApply = { popover: popover, close: apClose };

  /* EZAI 단발 호출을 EZApply.run 규격으로 감싼 헬퍼 (이 파일 내부용) */
  function aiRunner(system, user) {
    return function (ctx) {
      if (!(window.EZAI && EZAI.direct && EZAI.ready && EZAI.ready())) {
        ctx.fail("elizax 미연결 — 아래 “대화로 계속”로 이어가거나 ⚙ 설정에서 키를 등록하세요.");
        return;
      }
      window.EZAI.direct({
        system: system,
        messages: [{ role: "user", content: user }],
        onDone: function (t) { ctx.done(t); },
        onError: function (e) { ctx.fail(e && e.message ? e.message : String(e || "")); }
      });
    };
  }

  /* ============================================================
     A3 — 품질 린트 (스코프별 규칙)
     review: 평가·피드백 문장 편향 검사 (기존 4 규칙)
     goal:   목표/KR 측정 가능성 검사 — 목표 생성 overlay·KR 목록 안 필드.
             "업계 Top 수준 달성" 류는 쓰는 시점에 잡아야 평가 갈등이 안 생긴다.
     ============================================================ */
  function isBinaryMode(mode) { return mode === 3 || mode === "3" || mode === "여부" || String(mode).toLowerCase() === "binary"; }
  var LINT_RULES = {
    review: [
      { id: "review-1", re: /(항상|절대|전혀|결코|맨날)/, tag: "단정 표현", cls: "bad", tip: "근거 없는 일반화 — 구체 사례로 교체" },
      { id: "review-2", re: /(열심히|성실히|많이 노력|태도가 좋|잘함|잘 함)/, tag: "모호 표현", cls: "warn", tip: "측정 불가 — 행동·결과 중심으로" },
      { id: "review-3", re: /(최근|요즘|지난달부터)/, tag: "최신 편향 위험", cls: "warn", tip: "평가 기간 전체 근거를 인용했는지 확인" },
      { id: "review-4", re: /(여직원|남직원|여자|남자)\s*(치고|답게|라서)/, tag: "성별화 표현", cls: "bad", tip: "속성 언급 제거" }
    ],
    goal: [
      { id: "goal-1", re: /업계\s*(Top|톱|최고|선도)|최고\s*수준|세계적\s*수준|글로벌\s*(리더|Top|수준)/i, tag: "측정 불가 표현", cls: "bad", tip: '평가 시점에 "달성 근거"를 다투게 됩니다 — 수치·순위·기한으로 바꾸세요' },
      { id: "goal-2", re: /(체계|기반|프로세스|시스템)\s*(구축|마련|정착)\s*완료?|고도화\s*완료/, tag: "완료 판정 기준 없음", cls: "warn", tip: "무엇이 되면 완료인지 검증 조건을 명시하세요 (예: 적용 조직 3곳·만족도 80점)" },
      { id: "goal-3", re: /(향상|개선|강화|확대|제고)\s*$/, tag: "측정 기준 없음", cls: "warn", tip: "얼마나·언제까지인지 목표 수치와 기준선을 붙이세요" },
      { id: "goal-4", re: /(적극|최선|열심히|노력)/, tag: "행동·결과 아님", cls: "warn", tip: "노력 표현 대신 결과 지표로" },
      /* goal-5~7 구조 규칙 — 문장이 아니라 KR 구조 필드를 검사(lintKR 전용, re 없음) */
      { id: "goal-5", tag: "목표 수치 없음", cls: "bad", tip: "목표 수치가 없습니다 — 달성을 판정할 숫자를 넣으세요",
        check: function (kr) {
          if (isBinaryMode(kr.mode)) return false; /* 여부형은 goal-7이 판정 조건을 검사 */
          var tv = (kr.targetValue != null && String(kr.targetValue).trim()) ? kr.targetValue : kr.name;
          return !/\d/.test(String(tv || ""));
        } },
      { id: "goal-6", tag: "기준선 없음", cls: "warn", tip: "무엇에서 출발하는지 없으면 달성률을 다툽니다 — 현재값·전년 실적을 남기세요",
        check: function (kr) { return !String(kr.baseline == null ? "" : kr.baseline).trim(); } },
      { id: "goal-7", tag: "판정 조건 없음", cls: "warn", tip: "무엇이 되면 완료인지 판정 조건 필수",
        check: function (kr) { return isBinaryMode(kr.mode) && !String(kr.verifyCond == null ? "" : kr.verifyCond).trim(); } }
    ]
  };
  /* 필드 위치로 스코프 판정 — 목표 생성 overlay 또는 KR 목록 안이면 goal */
  function lintScopeOf(field) {
    if (!field || !field.closest) return "review";
    if (field.closest('[data-txf-ov="new"]') || field.closest('[data-txf="kr-list"]')) return "goal";
    return "review";
  }
  function lintText(v, scope) {
    var hits = [];
    var rules = LINT_RULES[scope] || LINT_RULES.review;
    rules.forEach(function (r) { if (!r.re) return; var m = String(v || "").match(r.re); if (m) hits.push({ id: r.id, tag: r.tag, cls: r.cls, tip: r.tip, word: m[0] }); });
    return hits;
  }
  /* KR 구조 전체 검사 — kr={name, targetValue, baseline, mode, verifyCond} */
  function lintKR(kr) {
    kr = kr || {};
    var hits = lintText(String(kr.name || ""), "goal");
    LINT_RULES.goal.forEach(function (r) { if (r.check && r.check(kr)) hits.push({ id: r.id, tag: r.tag, cls: r.cls, tip: r.tip }); });
    return hits;
  }
  /* 목표 생성 overlay의 KR 행(.txf-kr) DOM → kr 객체.
     전용 target/기준선 필드가 없는 화면이라 name·난이도 근거 입력을 폴백으로 쓴다. */
  function krFromRow(row) {
    if (!row || !row.querySelector) return { name: "" };
    var nameInp = row.querySelector("input.txf-inp"); /* 행 첫 input = 성과 지표 */
    var desc = row.querySelector("textarea");
    var mode = -1;
    var radios = row.querySelectorAll('input[type="radio"]');
    Array.prototype.forEach.call(radios, function (r, i) { if (r.checked) mode = i; });
    var diffSel = row.querySelector(".txf-krdiff");
    var basisSel = row.querySelector(".txf-krdiffbasis");
    var basisInp = row.querySelector(".txf-krdiffwhy");
    var basisVal = basisInp ? (basisInp.value || "") : "";
    return {
      name: nameInp ? (nameInp.value || "") : "",
      targetValue: null,               /* 전용 필드 없음 — lintKR가 name으로 폴백 */
      baseline: basisVal,              /* 비교 근거(전년 실적 등)를 기준선으로 간주 */
      mode: mode,                      /* 0 달성률 · 1 절대값 · 2 구간 · 3 여부 */
      verifyCond: desc ? (desc.value || "") : "",
      diff: diffSel ? diffSel.value : "",
      basisType: basisSel ? basisSel.value : "",
      basisVal: basisVal
    };
  }
  window.EZLint = { RULES: LINT_RULES, lint: lintText, lintKR: lintKR, krFromRow: krFromRow };
  function attachLint(field) {
    if (field._ezupLint) return;
    field._ezupLint = true;
    var scope = lintScopeOf(field);
    var bar = document.createElement("div");
    bar.className = "ezup-lint";
    bar.style.display = "none";
    /* textarea는 기존과 동일하게 바로 뒤, input도 폭 100% 블록이라 바로 뒤 삽입이 레이아웃 안전 */
    field.insertAdjacentElement("afterend", bar);
    var deb = null;
    /* KR 이름 input이면 같은 행의 구조 필드(관리 방식·근거)까지 goal-5~7로 검사 */
    var krRow = (scope === "goal" && field.closest) ? field.closest(".txf-kr") : null;
    var isKrName = !!(krRow && field === krRow.querySelector("input.txf-inp"));
    function run() {
      var v = field.value || "";
      var hits = isKrName ? lintKR(krFromRow(krRow)) : lintText(v, scope);
      if (!v.trim()) { bar.style.display = "none"; return; }
      bar.style.display = "flex";
      var html = '<span class="lab">품질 린트</span>';
      if (!hits.length) html += '<span class="ezup-lint-chip ok">' + (scope === "goal" ? "✓ 측정 가능한 표현입니다" : "✓ 문제 없음") + "</span>";
      else hits.forEach(function (hi) {
        html += '<span class="ezup-lint-chip ' + hi.cls + '" title="' + esc(hi.tip) + '">' + esc(hi.tag) + (hi.word ? " · “" + esc(hi.word) + "”" : "") + "</span>";
      });
      var lens = roleLens();
      html += '<button type="button" class="ezup-lint-fix" title="' + esc(lens.label) + ' 관점으로 정제 — 결과는 이 필드 옆에서 [적용]">✦ elizax로 정제</button>';
      bar.innerHTML = html;
      var fix = bar.querySelector(".ezup-lint-fix");
      /* F6 — 결과를 채팅에 흘리지 않고 이 필드 옆 팝오버로 착지시킨다.
         F10 — 역할 렌즈를 프롬프트·문구 양쪽에 주입. */
      if (fix) fix.addEventListener("click", function () {
        var lz = roleLens();
        var body = (field.value || "").slice(0, 500);
        var tagList = hits.map(function (hi) { return hi.tag; }).join(", ") || "없음";
        var ctx = "";
        if (scope === "goal" && krRow) {
          var kr = krFromRow(krRow);
          var MODES = ["달성률", "절대값", "구간", "여부"];
          ctx = "\n(관리 방식: " + (MODES[kr.mode] || "미선택") + " · 난이도 " + (kr.diff || "-")
            + (kr.basisVal ? " · 비교 근거: " + kr.basisVal : " · 비교 근거 없음") + ")";
        }
        var ask = scope === "goal"
          ? "다음 목표/KR 문장을 측정 가능하게 바꿔줘 — 수치·기한·판정 기준 포함:\n" + body + ctx
          : "다음 평가/피드백 문장을 SBI 구조로 정제하고 편향 표현을 제거해줘:\n" + body;
        popover({
          field: field,
          anchor: fix,
          original: body,
          title: "elizax 정제안",
          note: lz.label + " 관점 · 지적된 항목: " + tagList,
          run: aiRunner(
            "당신은 elizax — HR 성과관리 문장 코치입니다. " + lz.prompt +
            " 사용자가 준 문장 하나만 고쳐서 돌려줍니다. 설명·머리말·따옴표 없이 고친 문장만 출력합니다. " +
            "원문에 없는 수치·사실은 만들지 말고, 채울 값이 필요하면 [   ] 자리표시자로 남깁니다.",
            ask + "\n\n지적된 문제: " + tagList + "\n고친 문장만 한 줄로."),
          chat: { label: "대화로 계속", prompt: ask },
          audit: { source: "lint.apply", title: "품질 린트 정제안 적용", summary: (scope === "goal" ? "목표/KR" : "평가·피드백") + " 문장 정제 — " + lz.label + " 관점" }
        });
      });
    }
    field.addEventListener("input", function () { clearTimeout(deb); deb = setTimeout(run, 350); });
    field.addEventListener("focus", run);
    if (isKrName) krRow.addEventListener("change", run); /* 관리 방식 라디오·근거 변경 시 구조 칩 갱신 */
    run();
  }
  /* 평가·성과 화면 안 textarea 전부 (모달/드로어 포함 — 상위 감시)
     + 목표 스코프 text input: KR 성과지표([data-txf="kr-list"] 안)·목표명([data-txf="new-name"]) */
  document.addEventListener("focusin", function (e) {
    var f = e.target;
    if (!f || f.nodeType !== 1 || !f.tagName) return;
    if (f.tagName === "TEXTAREA") {
      if (f.closest("#s-appr, #s-perf, .tx-modal, .tx-drawer")) attachLint(f);
      return;
    }
    if (f.tagName === "INPUT") {
      var ty = (f.getAttribute("type") || "text").toLowerCase();
      if (ty !== "text") return;
      var isGoalInput = false;
      try { isGoalInput = !!(f.closest('[data-txf="kr-list"]') || (f.matches && f.matches('[data-txf="new-name"]'))); } catch (err) { isGoalInput = false; }
      if (isGoalInput) attachLint(f);
    }
  }, true);

  /* ============================================================
     A6 — AI 관여 고지 · 이의제기 (EU AI Act·PIPA 투명성 레이어)
     ============================================================ */
  function aiogModal() {
    if (!TX.modal) return;
    var m = TX.modal({
      title: "AI 관여 고지",
      body: '<div class="ezup-aiog-body">' +
        '<div class="sec"><b>이 화면의 AI 관여 범위</b>평가 코멘트·등급 <u>초안 작성</u>과 근거 수집에 elizax가 관여했습니다. 최종 판단·확정은 담당 리더와 HR이 수행하며, AI는 어떤 결정도 자동 확정하지 않습니다.</div>' +
        '<div class="sec"><b>인간 검토 기록</b>초안 생성 → 조직장 수정 2회 → 등급 조정 심의 → HR 승인. 전 과정이 감사 기록에 남아 있습니다.</div>' +
        '<div class="sec reg">근거 규정: EU AI Act Annex III(고용·근로자 관리 = 고위험, 2026.8 전면 시행) · 개인정보보호법 §37조의2(자동화된 결정에 대한 설명 요구·거부권)</div>' +
        '<button type="button" class="ezup-aiog-policy">🔒 기록 보관·열람 규칙 보기</button>' +
        "</div>",
      actions: [
        { label: "설명 요구", kind: "ghost", onClick: function () { elizaxSend("내 평가 결과 산출 과정을 근거와 함께 설명해줘"); } },
        { label: "이의 신청", kind: "ghost", onClick: function () { if (TX.toast) TX.toast("이의 신청이 접수되었습니다 · HR 검토 후 기준 시점 재조회로 처리됩니다", "ok"); } },
        { label: "닫기", kind: "primary" }
      ]
    });
    var pb = m && m.body && m.body.querySelector ? m.body.querySelector(".ezup-aiog-policy") : null;
    if (pb) pb.addEventListener("click", function () {
      if (window.EZPolicy && EZPolicy.open) EZPolicy.open();
    });
  }
  /* ④ .subnav는 세로 탭 목록(220px aside)이다 — 액션 버튼을 그대로 append하면 탭 사이에 섞인다.
     구분선 + "AI 도구" 라벨이 붙은 전용 블록을 탭 목록 아래에 만들어 분리 배치한다.
     subnav가 없는 화면은 기존 헤더 폴백을 유지. */
  function actionHost(sec) {
    var nav = sec.querySelector(".subnav");
    if (!nav) return sec.querySelector("h1, h2, .page-title") || sec.firstElementChild;
    var box = nav.querySelector(".ezup-navacts");
    if (!box) {
      box = document.createElement("div");
      box.className = "ezup-navacts";
      box.innerHTML = '<span class="ezup-navlab">AI 도구</span>';
      nav.appendChild(box);
    }
    return box;
  }
  function injectAiog() {
    ["#s-appr", "#s-perf"].forEach(function (sel) {
      var sec = document.querySelector(sel);
      if (!sec || sec.querySelector(".ezup-aiog")) return;
      var head = actionHost(sec);
      if (!head) return;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "ezup-aiog";
      b.innerHTML = '<span class="i">ⓘ</span>AI 관여 고지';
      b.addEventListener("click", aiogModal);
      head.appendChild(b);
    });
  }

  /* ============================================================
     A1 — 1:1 미팅 코파일럿 (미팅 전 브리핑 드로어)
     - 실데이터만 렌더: 피드백 시그널=D.feedbackHistory, 지난 액션아이템=
       EZLedger.list()의 1on1/체크인 기록 파생. 없으면 섹션 비표시(더미 금지).
     - leader면 팀원 select(reportsOf 패턴)로 대상자를 바꿔 재렌더.
     - "감사 기록됨"은 드로어 오픈 시 실제 ez:ctx 발행 후에만 표기.
     ============================================================ */
  function upRole() {
    var D0 = window.TALENX_DATA || {};
    var cu = (D0.meta && D0.meta.currentUser) || {};
    return (cu._role) || (window.TXRoles && TXRoles.current && (TXRoles.current() || {}).key) || "member";
  }
  /* ④ 근거 화면 딥링크의 역할 매핑 — tx_agent SCENARIOS.roles가 단일 원천.
     qw4("내 성과 근거 타임라인")는 roles:["member"]라 조직장·HR이 누르면 롤가드에 막혀
     기본 화면으로 튕긴다. 역할별로 열리는 화면을 주거나, 없으면 버튼을 내린다. */
  function timelineTarget() {
    var r = upRole();
    if (r === "member") return { key: "qw4", label: "근거 타임라인" };
    if (r === "leader" || r === "hr") return { key: "procmap", label: "근거 계보 (결정 흐름)" };
    return null; /* exec — 대응 화면 없음 → 버튼 미노출 */
  }
  function reportsOf() {
    var D0 = window.TALENX_DATA || {};
    var cu = (D0.meta && D0.meta.currentUser) || {};
    return (D0.employees || []).filter(function (e) { return e.manager_id === cu.emp_id; });
  }
  function briefData(emp) {
    var D0 = window.TALENX_DATA || {};
    var me = emp || (D0.meta && D0.meta.currentUser) || { name: "사용자", emp_id: "EMP-0078" };
    var objs = (Array.isArray(D0.objectives) ? D0.objectives : []).filter(function (o) { return o.owner_emp_id === me.emp_id; }).slice(0, 3);
    var fbs = (D0.feedbackHistory || []).filter(function (f) { return f.emp_id === me.emp_id; }).slice(0, 2);
    var acts = [];
    try {
      if (window.EZLedger && EZLedger.list) {
        acts = (EZLedger.list() || []).filter(function (it) {
          return it && (it.type === "oneonone" || it.type === "1on1" || it.type === "checkin");
        }).slice(0, 3);
      }
    } catch (e) { /* 원장 미탑재 — 섹션 비표시 */ }
    return { me: me, objs: objs, fbs: fbs, acts: acts };
  }
  function openMeetingBrief() {
    if (!TX.drawer) return;
    var D0 = window.TALENX_DATA || {};
    var me0 = (D0.meta && D0.meta.currentUser) || { name: "사용자" };
    /* 부제의 "감사 기록됨"은 실제 발행이 성공했을 때만 표기 */
    var audited = false;
    try {
      document.dispatchEvent(new CustomEvent("ez:ctx", { detail: {
        type: "audit", source: "brief.open", weight: 1,
        title: "1:1 미팅 브리핑 열람",
        summary: (me0.name || "사용자") + " · 미팅 전 자동 취합 브리핑 조회"
      } }));
      audited = true;
    } catch (e) { /* 원장 부재 — 표기 생략 */ }
    var isLeader = upRole() === "leader";
    var team = isLeader ? reportsOf() : [];
    var tl = timelineTarget();
    var wrap = document.createElement("div");
    wrap.className = "ezup-brief";
    TX.drawer({
      title: "✦ AI 미팅 브리핑",
      subtitle: roleLens().label + " 관점 · 1:1 미팅 전 자동 취합 · 기준 시점 오늘" + (audited ? " · 감사 기록됨" : ""),
      width: "440px",
      body: wrap
    });
    function renderBody(emp) {
      var d = briefData(emp);
      var selHtml = "";
      if (isLeader && team.length) {
        selHtml = '<div class="bsec"><b>브리핑 대상</b><select data-ezup-emp>' +
          '<option value="">' + esc(me0.name || "본인") + " (본인)</option>" +
          team.map(function (e) {
            return '<option value="' + esc(e.emp_id) + '"' + (emp && emp.emp_id === e.emp_id ? " selected" : "") + ">" +
              esc(e.name) + (e.jobTitle ? " · " + esc(e.jobTitle) : "") + "</option>";
          }).join("") + "</select></div>";
      }
      var objHtml = d.objs.length ? d.objs.map(function (o) {
        var pr = Math.min(100, o.progress != null ? o.progress : 0);
        return "<div>" + esc(o.title || o.name || "목표") + ' <span class="src">talenx</span><div class="bar"><i style="width:' + pr + '%"></i></div></div>';
      }).join("") : '<div style="color:var(--ink-3,#7a7a7a)">등록된 목표가 없습니다.</div>';
      /* 실데이터 있을 때만 섹션 표시 — 더미·위장 배지 금지 */
      var fbHtml = d.fbs.length ? '<div class="bsec"><b>최근 피드백 시그널</b>' +
        d.fbs.map(function (f) {
          return '<div class="pt"><span class="n">' + (f.source_type === "leader" ? "리" : "동") + "</span><span>" +
            esc(f.summary) + ' <span class="src">talenx' + (f.fb_id ? " " + esc(f.fb_id) : "") + "</span></span></div>";
        }).join("") + "</div>" : "";
      var actHtml = d.acts.length ? '<div class="bsec"><b>지난 액션아이템</b>' +
        d.acts.map(function (a, i) {
          return '<div class="pt"><span class="n">' + (i + 1) + "</span><span>" + esc(a.title || "") +
            (a.summary ? " — " + esc(String(a.summary).slice(0, 60)) : "") +
            ' <span class="src">기록' + (a.at ? " " + esc(a.at) : "") + "</span></span></div>";
        }).join("") + "</div>" : "";
      wrap.innerHTML = selHtml +
        '<div class="bsec"><b>목표 진척 — ' + esc(d.me.name || "") + "</b>" + objHtml + "</div>" +
        fbHtml + actHtml +
        '<div class="bsec" data-ezup-pts><b>추천 논의 포인트</b>' +
        '<div class="pt"><span class="n">1</span><span>진척 지연 목표의 장애물 — 리소스인지 우선순위인지 확인</span></div>' +
        '<div class="pt"><span class="n">2</span><span>피드백에서 확인된 강점을 다음 분기 목표와 연결</span></div>' +
        '<div class="pt"><span class="n">3</span><span>미완료 액션아이템 마감 재합의</span></div></div>' +
        '<div class="acts"><button type="button" class="agh-btn primary" data-ezup-draft>✦ 아젠다 초안</button>' +
        (tl ? '<button type="button" class="agh-btn" data-ezup-tl>' + esc(tl.label) + "</button>" : "") + "</div>";
      var sel = wrap.querySelector("[data-ezup-emp]");
      if (sel) sel.addEventListener("change", function () {
        var id = sel.value, hit = null;
        team.forEach(function (x) { if (x.emp_id === id) hit = x; });
        renderBody(hit);
      });
      var c = wrap.querySelector("[data-ezup-draft]"), t = wrap.querySelector("[data-ezup-tl]");
      /* F6 — 기본 동작은 드로어 안 착지(아젠다 섹션 삽입). 채팅은 팝오버 안 보조 링크로 강등. */
      if (c) c.addEventListener("click", function () {
        var lz = roleLens();
        /* 현재 브리핑 요약(대상자명 + 목표 진척 라인)을 프롬프트에 포함 */
        var lines = d.objs.map(function (o) {
          return "- " + (o.title || "") + " · 진척 " + (o.progress != null ? o.progress : "?") + "%";
        }).join("\n");
        var who = (d.me.name || "") + (d.me.emp_id ? " (" + d.me.emp_id + ")" : "");
        var ask = "1:1 미팅 아젠다 초안을 만들어줘.\n대상: " + who + "\n목표 진척:\n" + (lines || "- 등록된 목표 없음");
        popover({
          anchor: c,
          title: "1:1 아젠다 초안",
          note: lz.label + " 관점 · 대상 " + (d.me.name || "본인") + " · 적용하면 브리핑에 삽입됩니다",
          applyLabel: "브리핑에 삽입",
          run: aiRunner(
            "당신은 elizax — 1:1 미팅 코치입니다. " + lz.prompt +
            " 아젠다 항목 4개 이내를 각 줄 하나씩, 번호·머리말 없이 출력합니다. " +
            "주어진 목표 진척 데이터에 없는 수치·사실은 만들지 않습니다.",
            ask),
          chat: { label: "대화로 계속", prompt: ask },
          onApply: function (text) {
            if (!document.body.contains(wrap)) return false; /* 드로어가 이미 닫힘 */
            var host = wrap.querySelector("[data-ezup-agenda]");
            if (!host) {
              var acts = wrap.querySelector(".acts");
              host = document.createElement("div");
              host.className = "bsec";
              host.setAttribute("data-ezup-agenda", "1");
              if (acts) wrap.insertBefore(host, acts); else wrap.appendChild(host);
            }
            host.innerHTML = "<b>미팅 아젠다 — elizax 초안 (" + esc(lz.label) + " 관점)</b>" +
              String(text).split(/\r?\n/).filter(Boolean).slice(0, 6).map(function (ln, i) {
                return '<div class="pt"><span class="n">' + (i + 1) + "</span><span>" + esc(ln.replace(/^\s*[-•\d.)]+\s*/, "")) + "</span></div>";
              }).join("");
            return false; /* 기본 필드 반영 생략 — 드로어에 직접 착지시켰다 */
          },
          audit: { source: "brief.agenda", title: "1:1 아젠다 초안 삽입", summary: (d.me.name || "본인") + " · " + lz.label + " 관점 아젠다 브리핑 반영" }
        });
      });
      if (t) t.addEventListener("click", function () {
        if (window.TXAgent && TXAgent.openHub) TXAgent.openHub(tl.key);
      });
      runBriefAI(d);
    }
    /* Claude 연결 시: 목표·체크인 실데이터 기반 논의 포인트 실시간 생성.
       3줄 파싱 실패·오류 시 "생성 실패 · 다시 시도"로 교체(로딩 문구 잔존 방지) */
    function runBriefAI(d) {
      var pts = wrap.querySelector("[data-ezup-pts]");
      var live = !!(window.EZAI && EZAI.agent && EZAI.ready && EZAI.ready() && window.EZTools);
      if (!pts || !live) return;
      function setStatus(html) {
        var s = pts.querySelector("[data-ezup-ai]");
        if (s) s.innerHTML = html;
        else pts.insertAdjacentHTML("beforeend", '<small data-ezup-ai style="display:block;margin-top:6px;color:#98A2B3">' + html + "</small>");
      }
      function fail() {
        if (!document.body.contains(pts)) return;
        setStatus('생성 실패 · <button type="button" class="ezup-retry" data-ezup-retry>다시 시도</button>');
        var rb = pts.querySelector("[data-ezup-retry]");
        if (rb) rb.addEventListener("click", start);
      }
      function start() {
        var lz = roleLens(); /* F10 — 같은 데이터라도 조직장은 팀 관점, HR은 전사 정합성 관점 */
        setStatus('<span class="ezup-spin"></span>elizax가 목표·체크인 실데이터로 ' + esc(lz.label) + " 관점으로 재구성 중…");
        window.EZAI.agent({
          maxTurns: 4, maxTokens: 600,
          messages: [{ role: "user", content:
            lz.prompt + "\n" +
            d.me.name + "(" + d.me.emp_id + ")의 목표와 최근 체크인을 도구로 조회한 뒤, 1:1 미팅에서 다룰 논의 포인트 3개를 추천해줘. " +
            "반드시 형식: 각 줄 하나의 포인트(번호·머리말 없이), 정확히 3줄. 각 포인트에 조회한 실데이터 근거(수치·블로커)를 포함해." }],
          onDone: function (text) {
            if (!document.body.contains(pts)) return;
            var lines = String(text || "").split(/\r?\n/).map(function (s) { return s.replace(/^\s*[-•\d.)]+\s*/, "").trim(); }).filter(Boolean).slice(0, 3);
            if (lines.length !== 3) { fail(); return; }
            pts.innerHTML = "<b>추천 논의 포인트</b>" + lines.map(function (ln, i) {
              return '<div class="pt"><span class="n">' + (i + 1) + "</span><span>" + esc(ln) + "</span></div>";
            }).join("") + '<small style="display:block;margin-top:6px;color:#98A2B3">Claude 실시간 생성 · talenx·ERP 근거</small>';
          },
          onError: function () { fail(); }
        });
      }
      start();
    }
    renderBody(null);
  }
  function injectBrief() {
    var sec = document.querySelector("#s-perf");
    if (!sec || sec.querySelector(".ezup-brief-btn")) return;
    var head = actionHost(sec);
    if (!head) return;
    var b = document.createElement("button");
    b.type = "button";
    b.className = "ezup-brief-btn";
    b.innerHTML = "✦ AI 미팅 브리핑";
    b.addEventListener("click", openMeetingBrief);
    head.appendChild(b);
  }

  /* ============================================================
     init — 섹션 재렌더에도 살아남게 이벤트 시점마다 재주입
     ============================================================ */
  function injectAll() { injectAiog(); injectBrief(); }
  document.addEventListener("click", function (e) {
    if (e.target.closest("#gnb [data-s], .subnav a[data-p], .logo")) setTimeout(injectAll, 400);
  }, true);
  if (document.readyState === "complete") setTimeout(injectAll, 600);
  else window.addEventListener("load", function () { setTimeout(injectAll, 600); });

  window.EZUpgrade = { openMeetingBrief: openMeetingBrief, aiogModal: aiogModal, setGlow: setGlow };
})();
