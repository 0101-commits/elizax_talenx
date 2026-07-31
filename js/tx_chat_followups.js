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
 *
 * ⑤ 18-3차 개정 — 답변 아래는 한 덩어리로 읽힌다 + 신호 주제 배선
 *    사용자 지시(2026-07-31): "이어서 물어보기와 근거/AI가 인용한 기록은
 *    같은 형식으로 구성."
 *
 *    (1) 공용 행 문법 `.ezcx-row` — 이 파일이 단일 원천이다.
 *        답변 말풍선 아래에 붙는 모든 줄은 같은 기하를 쓴다. 근거 스트립
 *        (tx_ctx_ledger.js `.ezl-ev-wrap`)도 아래 클래스를 같이 달아 주면
 *        스타일이 이 한 곳에서 나오므로 두 줄이 한 덩어리로 읽힌다.
 *          .ezcx-row        줄 컨테이너 (flex·wrap·gap 6px·padding 2px 4px 6px)
 *                           연달아 오면 뒤 줄의 위 여백을 0으로 눌러 한 덩어리
 *          .ezcx-row-cap    줄 머리말. 테두리·배경 없음 = 누를 수 없다는 신호
 *          .ezcx-row-chip   누를 수 있는 알약 (12px · 5px 11px · 강조색 글자)
 *          .ezcx-row-token  누를 수 없는 알약. 기하는 chip과 같고 색만 중립
 *        머리말에 테두리를 주지 않는 이유: 알약 셋이 나란한데 일부만 눌린다면
 *        "두 위젯이 경쟁"하는 그 문제가 그대로 남는다. 크기가 아니라 색으로
 *        누름 가능 여부를 가른다 — 그래서 줄 높이가 흔들리지 않는다.
 *    (2) 순서 고정 — 근거 줄(먼저 준 답의 출처)이 위, 이어서 물어보기(다음 걸음)가
 *        아래. 두 모듈이 같은 앵커(anchor.nextSibling)에 넣으므로 렌더 순서에 따라
 *        위아래가 뒤집힌다. settleOrder()가 렌더 후 짧게 두 번 확인해 우리 줄을
 *        근거 줄 뒤로 내린다.
 *    (3) 신호 주제가 걸려 있으면 칩을 EZSignalChat.chips(topic)에서 받는다.
 *        칩 문구가 화면 이동 요청(「화면에서 직접 고칠게」)이면 그 말을 AI에게
 *        보내지 않고 EZSignalAct.fromText(topic, 문구)를 태운다 — R5의
 *        "화면 이동은 사용자가 요청할 때만"이 실제로 작동하는 유일한 경로다.
 * ========================================================================== */
(function () {
  "use strict";

  /* 공용 행 문법 — 근거 스트립도 이 클래스를 달아 쓰는 것이 계약이다 */
  var ROW_CLASS = "ezcx-row";
  var ROW_CAP_CLASS = "ezcx-row-cap";
  var ROW_CHIP_CLASS = "ezcx-row-chip";
  /* 아래 두 이름은 기존 호출자·하네스 보호용 별칭 (스타일은 위 공용 문법이 낸다) */
  var CHIP_WRAP_CLASS = "ezcx-fu-wrap";
  var CHIP_CLASS = "ezcx-fu-chip";
  var EV_WRAP_CLASS = "ezl-ev-wrap";  /* 근거 줄 — 우리 줄은 항상 이것 뒤에 온다 */
  var RENDER_DELAY = 240;   /* finishStreaming 직후 messages 재렌더가 지나간 뒤 주입 */
  var MAX_CHIPS = 3;
  var renderTimer = null;
  var settleTimers = [];

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

  /* 공용 행 문법 1회 주입 — 답변 아래 줄(근거·이어서 물어보기)이 같은 형식을 쓴다 */
  function injectStyle() {
    if (document.getElementById("ezcx-row-style")) return;
    var st = document.createElement("style");
    st.id = "ezcx-row-style";
    st.textContent = [
      /* 줄 컨테이너 */
      "." + ROW_CLASS + "{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:2px 4px 6px;}",
      /* 연달아 오는 줄은 위 여백을 눌러 한 덩어리로 읽히게 한다 */
      "." + ROW_CLASS + "+." + ROW_CLASS + "{padding-top:0;}",
      /* 머리말 — 테두리·배경 없음 = 누를 수 없다는 신호 */
      "." + ROW_CAP_CLASS + "{font-size:11px;font-weight:600;line-height:1.4;color:var(--color-text-secondary);",
      "white-space:nowrap;margin-right:1px;}",
      /* 누를 수 있는 알약 */
      "." + ROW_CHIP_CLASS + "{cursor:pointer;font:inherit;font-size:12px;line-height:1.4;padding:5px 11px;",
      "border-radius:var(--radius-full);border:1px solid var(--color-border);background:var(--color-background-card);",
      "color:var(--color-accent);user-select:none;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;",
      "transition:background var(--duration-fast) var(--ease-standard),border-color var(--duration-fast) var(--ease-standard);}",
      "." + ROW_CHIP_CLASS + ":hover{background:var(--color-background-muted);border-color:var(--color-accent);}",
      /* 누를 수 없는 알약 — 기하는 같고 색만 중립 */
      "." + ROW_CHIP_CLASS + "-token,.ezcx-row-token{font-size:12px;line-height:1.4;padding:5px 11px;",
      "border-radius:var(--radius-full);border:1px solid var(--color-border);background:var(--color-background-muted);",
      "color:var(--color-text-secondary);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}"
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

  /* 대화가 「완료된 AI 답변」으로 끝나 있는가 — 재예약 판정용 */
  function endsWithAnswer() {
    if (!window.EZChat || !EZChat.messages) return false;
    var arr = EZChat.messages() || [];
    var m = arr[arr.length - 1];
    return !!(m && m.role === "ai" && !m.streaming && norm(m.text));
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

  /* ---------------- 신호 주제 (B1) ---------------- */

  /* 지금 대화에 걸린 신호. 없으면 null — 그때는 규칙 기반 칩으로 내려간다. */
  function signalTopic() {
    try {
      if (window.EZSignalChat && typeof EZSignalChat.topic === "function") return EZSignalChat.topic() || null;
    } catch (e) { /* 무시 */ }
    return null;
  }

  /* 주제가 걸려 있으면 칩 문구도 그 주제에서 받는다 — 사용자 말투는 B1이 만든다 */
  function signalChips(inst) {
    if (!inst) return [];
    try {
      if (window.EZSignalChat && typeof EZSignalChat.chips === "function") {
        var arr = EZSignalChat.chips(inst) || [];
        return arr.slice(0, MAX_CHIPS);
      }
    } catch (e) { /* 무시 */ }
    return [];
  }

  function buildQuestions() {
    var text = lastAiText();
    if (!text) return [];
    /* 주제가 걸린 대화라면 그 주제의 칩이 우선 — 규칙 기반은 주제가 없을 때만 */
    var out = signalChips(signalTopic());
    var i, j, q;
    if (!out.length) {
      for (i = 0; i < RULES.length; i++) {
        if (RULES[i].re.test(text)) {
          for (j = 0; j < RULES[i].qs.length; j++) {
            q = RULES[i].qs[j];
            if (out.indexOf(q) < 0) out.push(q);
          }
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

  /* 말풍선 안에 이미 화면으로 넘어가는 장치가 있으면(tx_elizax의 `.ezx-rc-golink`)
     같은 말을 칩으로 한 번 더 내지 않는다. 라이브에서 「화면에서 직접 고칠게」가
     말풍선 링크와 칩으로 두 번 보였다 — 한 덩어리로 읽히려면 같은 말은 한 번만. */
  function dropDupGoLink(anchor, qs) {
    var has = false;
    try { has = !!(anchor && anchor.querySelector && anchor.querySelector(".ezx-rc-golink")); }
    catch (e) { has = false; }
    if (!has) return qs;
    var out = [], i;
    for (i = 0; i < qs.length; i++) if (!isScreenAsk(qs[i])) out.push(qs[i]);
    return out;
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
    qs = dropDupGoLink(anchor, qs);
    if (!qs.length) return;

    var wrap = document.createElement("div");
    /* 공용 행 문법 + 기존 이름(별칭) 둘 다 — 스타일은 .ezcx-row가 낸다 */
    wrap.className = ROW_CLASS + " " + CHIP_WRAP_CLASS;
    var html = '<span class="' + ROW_CAP_CLASS + '">이어서 물어보기</span>';
    for (var i = 0; i < qs.length; i++) {
      html += '<button type="button" class="' + ROW_CHIP_CLASS + " " + CHIP_CLASS + '" data-ezcx-q="'
            + esc(qs[i]) + '" title="' + esc(qs[i]) + '">' + esc(qs[i]) + "</button>";
    }
    wrap.innerHTML = html;

    if (anchor.nextSibling) anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
    else anchor.parentNode.appendChild(wrap);
    settleOrder();

    /* 칩이 리스트 바닥에 붙었으면 보이도록 스크롤 */
    try { list.scrollTop = list.scrollHeight; } catch (e) { /* 무시 */ }
  }

  /* ---------------- 순서 고정 — 근거 줄이 위, 우리 줄이 아래 ---------------- */

  /* 근거 스트립(tx_ctx_ledger)과 우리 칩 줄은 같은 앵커 뒤에 들어간다. 어느 쪽이
     나중에 렌더되든 그쪽이 앵커 바로 뒤를 차지하므로 위아래가 뒤집힌다.
     답이 먼저이고 그 출처가 따라오고 다음 걸음이 마지막 — 이 순서만 사람이 읽는
     순서이므로, 우리 줄이 근거 줄보다 앞서 있으면 뒤로 내린다. (멱등) */
  function settleOrder() {
    var wraps = document.querySelectorAll("." + CHIP_WRAP_CLASS), w, n, last, i;
    for (i = 0; i < wraps.length; i++) {
      w = wraps[i];
      if (!w.parentNode) continue;
      last = null;
      for (n = w.nextSibling; n; n = n.nextSibling) {
        if (n.nodeType !== 1) continue;
        if (n.classList && n.classList.contains(EV_WRAP_CLASS)) { last = n; continue; }
        break;   /* 근거 줄이 아닌 노드(다음 말풍선 등)를 만나면 거기서 멈춘다 */
      }
      if (!last) continue;
      if (last.nextSibling) w.parentNode.insertBefore(w, last.nextSibling);
      else w.parentNode.appendChild(w);
    }
  }

  /* 근거 줄이 우리보다 늦게 렌더되는 경우까지 잡는다 — 짧게 두 번만 확인 */
  function scheduleSettle() {
    var i;
    for (i = 0; i < settleTimers.length; i++) clearTimeout(settleTimers[i]);
    settleTimers = [
      setTimeout(settleOrder, 120),
      setTimeout(settleOrder, 480)
    ];
  }

  function scheduleRender() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(function () {
      renderTimer = null;
      renderChips();
      scheduleSettle();
    }, RENDER_DELAY);
  }

  /* ---------------- 이벤트 결선 ---------------- */
  /* 칩 문구가 "화면에서 직접 고칠게"류인지 — 판정기는 EZSignalAct 하나뿐이다
     (여기에 두 번째 파서를 만들면 둘이 갈라진다). */
  function isScreenAsk(q) {
    try {
      if (window.EZSignalAct && typeof EZSignalAct.wantsScreen === "function") return !!EZSignalAct.wantsScreen(q);
    } catch (e) { /* 무시 */ }
    return false;
  }

  /* 주제가 걸린 대화에서 화면 이동을 요청한 칩은 AI에게 보내지 않는다 —
     그 말을 AI가 다시 설명해 주는 게 아니라 실제로 그 자리로 데려가는 것이 답이다.
     EZSignalAct가 없거나 태우지 못하면 원래대로 대화로 보낸다(조용한 무반응 금지). */
  function routeChip(q) {
    var topic = signalTopic();
    if (topic && isScreenAsk(q)) {
      try {
        if (window.EZSignalAct && typeof EZSignalAct.fromText === "function") {
          /* 사용자가 말한 것은 대화에 남는다 — 이동 사유 한 줄이 그 답으로 이어진다 */
          try { if (window.EZChat && EZChat.push) EZChat.push({ role: "user", text: q }); }
          catch (eP) { /* 대화 저장소 부재 — 이동만 진행 */ }
          if (EZSignalAct.fromText(topic, q) !== false) return true;
        }
      } catch (e) {
        try { console.error("[ezcx-fu]", e); } catch (e2) { /* 무시 */ }
      }
    }
    return false;
  }

  function onChipClick(ev) {
    var chip = closestByClass(ev.target, CHIP_CLASS);
    if (!chip) return;
    ev.preventDefault();
    var q = chip.getAttribute("data-ezcx-q") || "";
    removeChips();
    if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
    if (!q) return;
    if (routeChip(q)) return;                                    /* 화면으로 데려갔다 */
    if (window.Elizax && Elizax.sendRaw) Elizax.sendRaw(q);      /* 기본 = 대화 */
  }

  function wire() {
    injectStyle();
    document.addEventListener("click", onChipClick, true);

    EZChat.on("streaming", function (d) {
      if (d && d.on === false) scheduleRender();          /* 응답 완료 → 지연 렌더 */
      else { removeChips(); if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; } }
    });

    /* 새 메시지 push 등 내용 변경 → 낡은 칩 제거.
       [18-3차 버그] 제거만 하면 칩이 영구히 사라지는 경로가 있었다. 근거 스트립이
       실인용을 세고 EZChat.persist()를 부르는 시점이 우리 렌더(240ms) 뒤라서,
       그 persist가 쏘는 "messages"가 방금 그린 칩을 걷어 가고 재예약이 없었다.
       (라이브 확인: 답변은 왔는데 이어서 물어보기 줄만 없었다.)
       대화가 완료된 AI 답변으로 끝나 있으면 다시 예약한다 — scheduleRender가
       240ms 디바운스이므로 재렌더 폭풍에도 한 번만 주입된다. */
    EZChat.on("messages", function () {
      removeChips();
      if (endsWithAnswer()) scheduleRender();
    });

    /* 세션 전환·삭제 시에도 잔존 칩 제거 */
    EZChat.on("switch", function () {
      removeChips();
      if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
      var i;
      for (i = 0; i < settleTimers.length; i++) clearTimeout(settleTimers[i]);
      settleTimers = [];
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
