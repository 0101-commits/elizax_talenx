/* ============================================================================
 * tx_chat_followups.js — elizax 후속 질문 제안 칩 (follow-up suggestion chips)
 * ----------------------------------------------------------------------------
 * [기획 스펙]
 * ① 배경/문제
 *    - elizax 대화(FAB 도킹창·TXAgent 허브 공유 원장)에서 AI 응답이 끝나면
 *      사용자는 "다음에 무엇을 물어볼지"를 스스로 떠올려야 한다.
 *    - 성과관리 도메인은 후속 탐색 경로(근거 확인 → 가정 → 조치)가 정형적인데
 *      이를 안내하는 장치가 없어 대화가 1문 1답에서 끊기는 문제가 있다.
 * ② 사용자 시나리오
 *    - 사용자가 elizax에게 질문 → AI 응답 스트리밍 완료(streaming {on:false})
 *      → 마지막 AI 말풍선 아래에 후속 질문 칩이 최대 3개 나타난다.
 *    - 칩을 클릭하면 칩 묶음이 사라지고 해당 질문이 그대로 elizax에 전송된다.
 *    - 새 메시지가 쌓이면(질문 전송·시나리오 실행 등) 이전 칩은 자동 제거되어
 *      과거 위치에 낡은 제안이 남지 않는다.
 * ③ 동작 정의
 *    - EZChat.on("streaming", {on:false}) 수신 시 마지막 AI 메시지 텍스트를
 *      규칙 기반(키워드 → 질문 풀 매핑)으로 분석해 후보를 뽑는다. (오프라인 성립)
 *      · 등급/평가 → 계산 근거·가정 / 목표/KR → 정렬 점검·가중치 조정
 *      · 체크인/진척 → 부진 인원 메시지 초안 / 피드백 → SBI 다듬기
 *      · 편향/분포 → 캘리브레이션 심의 안건
 *    - 매칭이 하나도 없으면 현재 역할(TXRoles.current().key)에 맞는
 *      TXAgent.SCENARIOS의 chip 문구를 기본 3종으로 사용한다.
 *    - 렌더 대상: 현재 화면에 보이는 대화 리스트(.ezx-list 또는
 *      [data-agh-chatlist]) 안, 마지막 AI 말풍선(.ezx-msg.ai) 바로 아래.
 *    - 칩 클릭 → 칩 컨테이너 제거 → Elizax.sendRaw(질문).
 * ④ 엣지 케이스
 *    - "messages" 이벤트(내용 변경)마다 기존 칩 전부 제거. 단, 스트리밍 종료
 *      직후 finishStreaming()이 saveHistory()로 "messages"를 곧바로 쏘므로
 *      칩 렌더는 짧게 지연(240ms)시켜 재렌더 폭풍이 가라앉은 뒤 1회 주입한다.
 *    - 재렌더 시 리스트 innerHTML이 통째로 리셋되므로 클릭 처리는
 *      document 레벨 이벤트 위임으로만 한다.
 *    - 직전 대화에서 사용자가 이미 던진 질문과 동일한 문구의 칩은 제외한다.
 *      (최근 사용자 메시지 8건과 대조) 후보끼리의 중복도 제거한다.
 *    - 마지막 AI 메시지가 없거나 빈 텍스트·에러(err)면 칩을 만들지 않는다.
 *    - 보이는 리스트가 없으면(패널·허브 모두 닫힘) 렌더를 건너뛴다.
 *    - 모든 전역(EZChat/Elizax/TXAgent/TXRoles)은 존재 확인 후 사용,
 *      EZChat이 늦게 뜨는 경우 300ms 간격 최대 20회 폴링으로 결선한다.
 * ========================================================================== */
(function () {
  "use strict";

  var CHIP_WRAP_CLASS = "ezcx-fu-wrap";
  var CHIP_CLASS = "ezcx-fu-chip";
  var RENDER_DELAY = 240;   /* finishStreaming 직후 messages 재렌더가 지나간 뒤 주입 */
  var MAX_CHIPS = 3;
  var renderTimer = null;

  /* ---------------- 키워드 → 후속 질문 매핑 (규칙 기반, 오프라인 성립) ------- */
  var RULES = [
    { re: /등급|평가/,          qs: ["이 등급의 계산 근거를 자세히 보여줘", "가정: 달성률이 10%p 낮았다면?"] },
    { re: /목표|KR/i,           qs: ["이 목표의 정렬 상태 점검해줘", "가중치 조정안 제안해줘"] },
    { re: /체크인|진척|진행률/,  qs: ["부진 인원에게 보낼 메시지 초안 써줘"] },
    { re: /피드백/,             qs: ["이 피드백을 SBI 구조로 다듬어줘"] },
    { re: /편향|분포|관대화|중심화/, qs: ["등급 조정 심의 안건으로 올려줘"] }
  ];

  /* ---------------- 유틸 ---------------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function norm(s) { return String(s || "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, ""); }

  /* element.closest 폴백 (위임 클릭 처리용) */
  function closestByClass(node, cls) {
    var n = node;
    while (n && n !== document) {
      if (n.classList && n.classList.contains(cls)) return n;
      n = n.parentNode;
    }
    return null;
  }

  function injectStyle() {
    if (document.getElementById("ezcx-fu-style")) return;
    var st = document.createElement("style");
    st.id = "ezcx-fu-style";
    st.textContent = [
      "." + CHIP_WRAP_CLASS + "{display:flex;flex-wrap:wrap;gap:6px;padding:2px 4px 6px;align-items:center;}",
      "." + CHIP_WRAP_CLASS + " .ezcx-fu-cap{font-size:11px;color:var(--ink,#1D2433);opacity:.55;margin-right:2px;}",
      "." + CHIP_CLASS + "{cursor:pointer;font-size:12px;line-height:1.4;padding:5px 11px;border-radius:999px;",
      "border:1px solid var(--line,#E4E7EC);background:var(--card,#fff);color:var(--blue,#1F7AF0);",
      "transition:background .12s,border-color .12s;user-select:none;max-width:100%;",
      "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      "." + CHIP_CLASS + ":hover{background:var(--soft,#F8FAFC);border-color:var(--blue,#1F7AF0);}"
    ].join("");
    document.head.appendChild(st);
  }

  /* ---------------- 칩 제거 ---------------- */
  function removeChips() {
    var nodes = document.querySelectorAll("." + CHIP_WRAP_CLASS);
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
    }
  }

  /* ---------------- 현재 보이는 대화 리스트 탐색 ---------------- */
  function isVisible(elm) {
    return !!(elm && elm.offsetParent !== null);
  }

  function findVisibleList() {
    /* 허브가 열려 있으면 허브 대화 리스트 우선 */
    var agh = document.querySelector(".agh-root.on [data-agh-chatlist]");
    if (isVisible(agh)) return agh;
    var ezx = document.querySelector(".ezx-root.ezx-open .ezx-list");
    if (isVisible(ezx)) return ezx;
    /* 클래스 상태와 무관하게 실제로 보이는 쪽 폴백 */
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

  /* ---------------- 후보 질문 생성 ---------------- */
  function lastAiText() {
    if (!window.EZChat || !EZChat.messages) return "";
    var arr = EZChat.messages() || [];
    for (var i = arr.length - 1; i >= 0; i--) {
      var m = arr[i];
      if (m && m.role === "ai" && norm(m.text)) return String(m.text);
      if (m && m.role === "err") return ""; /* 마지막이 에러면 제안하지 않음 */
      if (m && m.role === "user") break;    /* AI 응답 없이 사용자 메시지가 마지막 */
    }
    return "";
  }

  /* 최근 사용자 질문(중복 칩 제외용) */
  function recentUserTexts() {
    var out = {};
    if (!window.EZChat || !EZChat.messages) return out;
    var arr = EZChat.messages() || [];
    var seen = 0;
    for (var i = arr.length - 1; i >= 0 && seen < 8; i--) {
      var m = arr[i];
      if (m && m.role === "user" && m.text) { out[norm(m.text)] = true; seen++; }
    }
    return out;
  }

  function roleDefaultChips() {
    var out = [];
    var roleKey = "";
    try {
      if (window.TXRoles && TXRoles.current) roleKey = (TXRoles.current() || {}).key || "";
    } catch (e) { /* 역할 미확정이면 전체에서 선별 */ }
    var scs = (window.TXAgent && TXAgent.SCENARIOS) ? TXAgent.SCENARIOS : [];
    var i, sc;
    for (i = 0; i < scs.length && out.length < MAX_CHIPS; i++) {
      sc = scs[i];
      if (!sc || !sc.chip) continue;
      if (roleKey && sc.roles && sc.roles.length && sc.roles.indexOf(roleKey) < 0) continue;
      out.push(sc.chip);
    }
    /* 역할 매칭 결과가 부족하면 역할 무관하게 채움 */
    for (i = 0; i < scs.length && out.length < MAX_CHIPS; i++) {
      sc = scs[i];
      if (sc && sc.chip && out.indexOf(sc.chip) < 0) out.push(sc.chip);
    }
    return out;
  }

  function buildQuestions() {
    var text = lastAiText();
    if (!text) return [];
    var out = [];
    var i, j, q;
    for (i = 0; i < RULES.length; i++) {
      if (RULES[i].re.test(text)) {
        for (j = 0; j < RULES[i].qs.length; j++) {
          q = RULES[i].qs[j];
          if (out.indexOf(q) < 0) out.push(q);
        }
      }
    }
    if (!out.length) out = roleDefaultChips();

    /* 직전 대화와 동일 질문·후보 간 중복 제외 후 최대 3개 */
    var asked = recentUserTexts();
    var picked = [];
    for (i = 0; i < out.length && picked.length < MAX_CHIPS; i++) {
      q = norm(out[i]);
      if (!q || asked[q] || picked.indexOf(out[i]) >= 0) continue;
      picked.push(out[i]);
    }
    return picked;
  }

  /* ---------------- 렌더 ---------------- */
  function renderChips() {
    removeChips(); /* 이중 렌더 방지 */
    var qs = buildQuestions();
    if (!qs.length) return;
    var list = findVisibleList();
    if (!list) return;
    var anchor = lastAiNode(list);
    if (!anchor) return;

    var wrap = document.createElement("div");
    wrap.className = CHIP_WRAP_CLASS;
    var html = '<span class="ezcx-fu-cap">이어서 물어보기</span>';
    for (var i = 0; i < qs.length; i++) {
      html += '<button type="button" class="' + CHIP_CLASS + '" data-ezcx-q="' + esc(qs[i]) + '" title="' + esc(qs[i]) + '">'
            + esc(qs[i]) + "</button>";
    }
    wrap.innerHTML = html;

    if (anchor.nextSibling) anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
    else anchor.parentNode.appendChild(wrap);

    /* 칩이 리스트 바닥에 붙었으면 보이도록 스크롤 */
    try { list.scrollTop = list.scrollHeight; } catch (e) { /* 무시 */ }
  }

  function scheduleRender() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(function () {
      renderTimer = null;
      renderChips();
    }, RENDER_DELAY);
  }

  /* ---------------- 이벤트 결선 ---------------- */
  function onChipClick(ev) {
    var chip = closestByClass(ev.target, CHIP_CLASS);
    if (!chip) return;
    ev.preventDefault();
    var q = chip.getAttribute("data-ezcx-q") || "";
    removeChips();
    if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
    if (q && window.Elizax && Elizax.sendRaw) Elizax.sendRaw(q);
  }

  function wire() {
    injectStyle();
    document.addEventListener("click", onChipClick, true);

    EZChat.on("streaming", function (d) {
      if (d && d.on === false) scheduleRender();          /* 응답 완료 → 지연 렌더 */
      else { removeChips(); if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; } }
    });

    /* 새 메시지 push 등 내용 변경 → 낡은 칩 제거 (렌더 예약 중이면 예약이 다시 주입) */
    EZChat.on("messages", function () {
      removeChips();
    });

    /* 세션 전환·삭제 시에도 잔존 칩 제거 */
    EZChat.on("switch", function () {
      removeChips();
      if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
    });
  }

  /* EZChat은 늦게 뜰 수 있다 — 300ms 간격 최대 20회 폴링 */
  function boot() {
    var tries = 0;
    (function poll() {
      if (window.EZChat && EZChat.on) { wire(); return; }
      if (++tries >= 20) return;
      setTimeout(poll, 300);
    })();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
