/* ============================================================
   tx_upgrade.js — elizax 서비스·UI 고도화 (2025-26 리서치 반영)
   B1 FAB 상태 글로우 오브   (Apple Intelligence Siri glow 패턴)
   B2 컨텍스트 어웨어 FAB 칩 (M365 Copilot Dynamic Action Button)
   A3 리뷰 품질·편향 린트    (Culture Amp "Improve" · SAP Calibration)
      + 목표 스코프 측정 가능성 린트 (목표 생성 overlay 목표명·KR 지표 input 포함)
   A6 AI 관여 고지·이의제기  (EU AI Act 2026.8 · PIPA §37조의2)
   A1 1:1 미팅 코파일럿      (Lattice·15Five·SAP Joule 공통 투자 영역)
   전부 vanilla JS · .ezup-* 스코프 · 기존 화면 미간섭 · 목업 동작.
   ============================================================ */
(function () {
  "use strict";
  var TX = window.TX || {};
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function elizaxSend(t) { if (window.Elizax && window.Elizax.send) window.Elizax.send(t); }

  /* ================= CSS ================= */
  var css = [
    /* ---- B1 글로우 오브: FAB 상태를 색·모션으로만 ---- */
    ".ezx-fab{ isolation:isolate; }",
    ".ezx-fab::before{ content:''; position:absolute; inset:-4px; border-radius:50%; z-index:-1;",
    "  background:conic-gradient(from 0deg, #1F7AF0, #7CC0FF, #B07CFF, #1F7AF0);",
    "  opacity:0; filter:blur(7px); transition:opacity .4s ease; }",
    "body.ezup-glow-work .ezx-fab::before{ opacity:.85; animation:ezupSpin 1.6s linear infinite; }",
    "body.ezup-glow-suggest .ezx-fab::before{ opacity:.7; animation:ezupHalo 1.8s ease-in-out infinite; }",
    "body.ezup-glow-wait .ezx-fab::before{ opacity:.55; filter:blur(4px); animation:none; }",
    "@keyframes ezupSpin{ to{ transform:rotate(360deg); } }",
    "@keyframes ezupHalo{ 0%,100%{ transform:scale(1); opacity:.4; } 50%{ transform:scale(1.18); opacity:.85; } }",
    "@media (prefers-reduced-motion:reduce){ .ezx-fab::before{ animation:none !important; } }",

    /* ---- B2 컨텍스트 칩: FAB 왼쪽에서 잠깐 내미는 제안 pill ---- */
    ".ezup-ctxchip{ position:fixed; right:88px; bottom:32px; z-index:899;",
    "  display:flex; align-items:center; gap:7px; font-family:var(--sans); font-size:12.5px; font-weight:600; letter-spacing:-.01em;",
    "  color:var(--blue-2,#1F7AF0); background:color-mix(in srgb, var(--card,#fff) 86%, transparent);",
    "  backdrop-filter:saturate(180%) blur(20px); -webkit-backdrop-filter:saturate(180%) blur(20px);",
    "  border:1px solid var(--line,#e0e0e0); border-radius:999px; padding:9px 15px; cursor:pointer;",
    "  box-shadow:0 8px 26px rgba(0,0,0,.12); white-space:nowrap;",
    "  opacity:0; transform:translateX(14px) scale(.8); transform-origin:right center;",
    "  transition:opacity .3s ease, transform .38s cubic-bezier(.32,.72,.24,1); }",
    ".ezup-ctxchip.show{ opacity:1; transform:none; }",
    ".ezup-ctxchip:active{ transform:scale(.95); }",
    ".ezup-ctxchip .spark{ color:var(--blue,#1F7AF0); }",

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
    ".ezup-brief .bar i{ display:block; height:100%; background:var(--blue,#1F7AF0); }"
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
  function showCtxChip(key) {
    var cfg = CTX_SUGGEST[key];
    if (!cfg) { hideCtxChip(); return; }
    if (!chipEl) {
      chipEl = document.createElement("button");
      chipEl.className = "ezup-ctxchip";
      chipEl.type = "button";
      chipEl.addEventListener("click", function () {
        var ask = chipEl._ask;
        hideCtxChip();
        if (ask === "__brief__") openMeetingBrief();
        else elizaxSend(ask);
      });
      document.body.appendChild(chipEl);
    }
    chipEl.innerHTML = '<span class="spark">✦</span>' + esc(cfg.chip);
    chipEl._ask = cfg.ask;
    clearTimeout(chipTimer);
    requestAnimationFrame(function () { chipEl.classList.add("show"); });
    chipTimer = setTimeout(hideCtxChip, 6000);
  }
  function hideCtxChip() {
    clearTimeout(chipTimer);
    if (chipEl) chipEl.classList.remove("show");
  }
  document.addEventListener("click", function (e) {
    var gb = e.target.closest("#gnb [data-s]");
    if (gb) { setTimeout(function () { showCtxChip(gb.getAttribute("data-s")); }, 350); return; }
    var sn = e.target.closest(".subnav a[data-p]");
    if (sn) {
      var sec = sn.closest("section.screen");
      if (sec && sec.id === "s-perf") setTimeout(function () { showCtxChip("perf-" + sn.getAttribute("data-p")); }, 250);
    }
    var logo = e.target.closest(".logo");
    if (logo) setTimeout(function () { showCtxChip("home"); }, 350);
  }, true);

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
      html += '<button type="button" class="ezup-lint-fix">✦ elizax로 정제</button>';
      bar.innerHTML = html;
      var fix = bar.querySelector(".ezup-lint-fix");
      if (fix) fix.addEventListener("click", function () {
        var body = (field.value || "").slice(0, 500);
        if (scope === "goal") {
          var ctx = "";
          if (krRow) {
            var kr = krFromRow(krRow);
            var MODES = ["달성률", "절대값", "구간", "여부"];
            ctx = "\n(관리 방식: " + (MODES[kr.mode] || "미선택") + " · 난이도 " + (kr.diff || "-")
              + (kr.basisVal ? " · 비교 근거: " + kr.basisVal : " · 비교 근거 없음") + ")";
          }
          elizaxSend("다음 목표/KR 문장을 측정 가능하게 바꿔줘 — 수치·기한·판정 기준 포함:\n" + body + ctx);
        }
        else elizaxSend("다음 평가/피드백 문장을 SBI 구조로 정제하고 편향 표현을 제거해줘:\n" + body);
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
  function injectAiog() {
    ["#s-appr", "#s-perf"].forEach(function (sel) {
      var sec = document.querySelector(sel);
      if (!sec || sec.querySelector(".ezup-aiog")) return;
      var head = sec.querySelector(".subnav") || sec.querySelector("h1, h2, .page-title") || sec.firstElementChild;
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
     ============================================================ */
  function briefData() {
    var D = window.TALENX_DATA || {};
    var me = (D.meta && D.meta.currentUser) || { name: "사용자", emp_id: "EMP-0078" };
    var objs = (Array.isArray(D.objectives) ? D.objectives : []).filter(function (o) { return o.owner_emp_id === me.emp_id; }).slice(0, 3);
    return { me: me, objs: objs };
  }
  function openMeetingBrief() {
    if (!TX.drawer) return;
    var d = briefData();
    var objHtml = d.objs.length ? d.objs.map(function (o) {
      var pr = (o.progress != null ? o.progress : 60);
      return "<div>" + esc(o.title || o.name || "목표") + ' <span class="src">talenx</span><div class="bar"><i style="width:' + Math.min(100, pr) + '%"></i></div></div>';
    }).join("") : '<div>분기 목표 3건 · 평균 진척 64% <span class="src">talenx</span><div class="bar"><i style="width:64%"></i></div></div>';
    TX.drawer({
      title: "✦ AI 미팅 브리핑 — " + esc(d.me.name),
      subtitle: "1:1 미팅 전 자동 취합 · 기준 시점 오늘 · 감사 기록됨",
      width: "440px",
      body: '<div class="ezup-brief">' +
        '<div class="bsec"><b>목표 진척</b>' + objHtml + "</div>" +
        '<div class="bsec"><b>최근 피드백 시그널</b>동료 피드백 2건 수신(협업 긍정) · 체크인 코멘트 감소 추세 <span class="src">talenx</span></div>' +
        '<div class="bsec"><b>지난 1:1 액션아이템</b><div class="pt"><span class="n">✓</span><span>API 문서화 — 완료</span></div><div class="pt"><span class="n">…</span><span>온보딩 가이드 — 진행 중(70%)</span></div></div>' +
        '<div class="bsec" data-ezup-pts><b>추천 논의 포인트</b>' +
        '<div class="pt"><span class="n">1</span><span>진척 지연 목표의 장애물 — 리소스인지 우선순위인지 확인</span></div>' +
        '<div class="pt"><span class="n">2</span><span>최근 피드백의 협업 강점을 다음 분기 목표와 연결</span></div>' +
        '<div class="pt"><span class="n">3</span><span>미완료 액션아이템 마감 재합의</span></div></div>' +
        '<div class="acts"><button type="button" class="agh-btn primary" data-ezup-chat>elizax에서 이어서</button><button type="button" class="agh-btn" data-ezup-tl>근거 타임라인</button></div>' +
        "</div>"
    });
    setTimeout(function () {
      var c = document.querySelector("[data-ezup-chat]"), t = document.querySelector("[data-ezup-tl]");
      if (c) c.addEventListener("click", function () { elizaxSend("이번 1:1 미팅 아젠다 초안을 만들어줘"); });
      if (t) t.addEventListener("click", function () { if (window.TXAgent && TXAgent.openHub) TXAgent.openHub("qw4"); });
      /* Claude 연결 시: 목표·체크인 실데이터 기반 논의 포인트 실시간 생성 */
      var pts = document.querySelector("[data-ezup-pts]");
      var live = !!(window.EZAI && EZAI.agent && EZAI.ready && EZAI.ready() && window.EZTools);
      if (pts && live) {
        pts.insertAdjacentHTML("beforeend", '<small style="display:block;margin-top:6px;color:#98A2B3">elizax가 목표·체크인 실데이터로 재구성 중…</small>');
        window.EZAI.agent({
          maxTurns: 4, maxTokens: 600,
          messages: [{ role: "user", content:
            d.me.name + "(" + d.me.emp_id + ")의 목표와 최근 체크인을 도구로 조회한 뒤, 1:1 미팅에서 다룰 논의 포인트 3개를 추천해줘. " +
            "반드시 형식: 각 줄 하나의 포인트(번호·머리말 없이), 정확히 3줄. 각 포인트에 조회한 실데이터 근거(수치·블로커)를 포함해." }],
          onDone: function (text) {
            var lines = String(text || "").split(/\r?\n/).map(function (s) { return s.replace(/^\s*[-•\d.)]+\s*/, "").trim(); }).filter(Boolean).slice(0, 3);
            if (lines.length !== 3 || !document.body.contains(pts)) return;
            pts.innerHTML = "<b>추천 논의 포인트</b>" + lines.map(function (ln, i) {
              return '<div class="pt"><span class="n">' + (i + 1) + "</span><span>" + esc(ln) + "</span></div>";
            }).join("") + '<small style="display:block;margin-top:6px;color:#98A2B3">Claude 실시간 생성 · talenx·ERP 근거</small>';
          },
          onError: function () { var s = pts.querySelector("small"); if (s) s.remove(); }
        });
      }
    }, 60);
  }
  function injectBrief() {
    var sec = document.querySelector("#s-perf");
    if (!sec || sec.querySelector(".ezup-brief-btn")) return;
    var head = sec.querySelector(".subnav");
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
