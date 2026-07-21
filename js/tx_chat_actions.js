/* ============================================================================
 * tx_chat_actions.js — elizax 메시지 호버 액션 바
 * ----------------------------------------------------------------------------
 * [기획 스펙]
 * ① 배경/문제
 *    - FAB 도킹창·전체화면 허브의 대화 메시지에는 복사/재생성/수정 수단이 없다.
 *    - AI 답변을 다른 곳에 옮기거나, 마지막 질문을 고쳐 다시 묻는 기본 UX가
 *      빠져 있어 데모에서 "일반 챗 서비스 대비 미완성" 인상을 준다.
 * ② 사용자 시나리오
 *    - AI 답변 위에 마우스를 올리면 버블 하단 우측에 작은 액션 바가 나타난다.
 *      [⧉ 복사]로 답변 텍스트를 클립보드에 담고, 마지막 AI 답변이면 [↻ 재생성]
 *      으로 같은 질문을 다시 보낸다.
 *    - 내 질문(user) 위에 올리면 [⧉ 복사]가, 마지막 질문이면 [✎ 수정]이 추가로
 *      나타난다. [✎ 수정]을 누르면 그 텍스트가 현재 보이는 입력창(FAB .ezx-ta
 *      또는 허브 [data-agh-chatta])에 채워지고 포커스된다 — 전송은 사용자 몫.
 * ③ 동작 정의
 *    - document 레벨 mouseover 위임: 재렌더로 액션 바가 사라져도 다음 호버 때
 *      해당 .ezx-msg 노드에 다시 append 되므로 안전하다 (계약 규칙 7).
 *    - 메시지 판별: EZChat.messages()의 m._node === 호버된 노드 (렌더러가
 *      buildMsgNode에서 매 렌더마다 _node를 재할당) — 실패 시 리스트 내
 *      .ezx-msg 순번으로 폴백. role이 "user"/"ai"인 메시지만 대상.
 *      (nav 카드도 .ezx-msg.ai로 렌더되므로 role 검사로 걸러낸다.)
 *    - "마지막" 판정: EZChat.messages()에서 role==="ai"/"user"인 마지막 항목.
 *    - 복사: 버블 innerText → navigator.clipboard.writeText, 실패·미지원 시
 *      숨김 textarea + execCommand("copy") 폴백, 성공 시 TX.toast("복사됨").
 *    - 재생성: Elizax.regenerate() 호출. 스트리밍 중에는 버튼 자체를 숨긴다.
 *    - 액션 바는 버블을 가리지 않도록 버블 "아래" 우측 정렬로 흐르게 배치
 *      (11px, 반투명 → 호버 시 진하게). 다른 메시지로 이동하면 이전 바 제거.
 * ④ 엣지 케이스
 *    - work/nav/scn/err 메시지: 액션 없음 (role 검사에서 제외).
 *    - 스트리밍 중(Elizax.isStreaming()): 재생성·수정 숨김, 복사만 노출.
 *      "streaming" 이벤트 수신 시 표시 중인 바를 갱신한다.
 *    - 재렌더("messages" 이벤트 등)로 innerHTML이 리셋되면 바는 자연 소멸 —
 *      전역 상태만 정리하고 다음 호버에서 재생성한다.
 *    - clipboard API가 없는 환경(파일 프로토콜 등)은 textarea 폴백으로 동작.
 *    - 수정 클릭 시 어느 입력창도 보이지 않으면 Elizax.open()으로 FAB을 연다.
 *    - EZChat/Elizax 미로드 시 모듈은 조용히 아무 것도 하지 않는다.
 * ========================================================================== */
(function () {
  "use strict";

  /* ---------------- 유틸 ---------------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function toast(msg, kind) {
    if (window.TX && window.TX.toast) window.TX.toast(msg, kind || "");
  }
  function visible(node) {
    return !!(node && node.offsetParent !== null);
  }

  /* ---------------- 스타일 주입 ---------------- */
  function injectStyle() {
    if (document.getElementById("ezcx-act-style")) return;
    var st = document.createElement("style");
    st.id = "ezcx-act-style";
    st.textContent =
      ".ezcx-act-bar{display:flex;gap:4px;justify-content:flex-end;align-items:center;" +
        "margin-top:3px;font-size:11px;line-height:1;opacity:.72;transition:opacity .12s ease;}" +
      ".ezcx-act-bar:hover{opacity:1;}" +
      ".ezx-msg.user .ezcx-act-bar{justify-content:flex-end;}" +
      ".ezcx-act-btn{display:inline-flex;align-items:center;gap:3px;border:1px solid var(--line,#E4E7EC);" +
        "background:var(--card,#fff);color:var(--ink,#1D2433);border-radius:6px;" +
        "padding:2px 7px;font-size:11px;cursor:pointer;user-select:none;}" +
      ".ezcx-act-btn:hover{border-color:var(--blue,#1F7AF0);color:var(--blue,#1F7AF0);background:var(--soft,#F8FAFC);}" +
      ".ezcx-act-btn[disabled]{opacity:.45;cursor:default;pointer-events:none;}";
    document.head.appendChild(st);
  }

  /* ---------------- 메시지 매칭 ---------------- */
  /* 호버된 .ezx-msg 노드 → EZChat 메시지 객체 (user/ai만, 아니면 null) */
  function msgOfNode(node) {
    if (!window.EZChat || !EZChat.messages) return null;
    var arr;
    try { arr = EZChat.messages() || []; } catch (e) { return null; }
    var i, m;
    /* 1차: 렌더러가 심어둔 _node 역참조 */
    for (i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i]._node === node) { m = arr[i]; break; }
    }
    /* 2차 폴백: 리스트 내 .ezx-msg 순번 매칭 (렌더러는 메시지당 노드 1개) */
    if (!m && node.parentNode) {
      var sibs = node.parentNode.querySelectorAll(".ezx-msg");
      for (i = 0; i < sibs.length; i++) {
        if (sibs[i] === node && arr[i]) { m = arr[i]; break; }
      }
    }
    if (!m) return null;
    if (m.role !== "user" && m.role !== "ai") return null; /* work/nav/scn/err 제외 */
    if (!node.querySelector(".ezx-bubble")) return null;   /* nav 카드 등 방어 */
    return m;
  }
  /* role의 마지막 메시지인가 (EZChat.messages() 기준) */
  function isLastOfRole(m, role) {
    if (!window.EZChat || !EZChat.messages) return false;
    var arr;
    try { arr = EZChat.messages() || []; } catch (e) { return false; }
    for (var i = arr.length - 1; i >= 0; i--) {
      if (arr[i] && arr[i].role === role) return arr[i] === m;
    }
    return false;
  }
  function streaming() {
    try { return !!(window.Elizax && Elizax.isStreaming && Elizax.isStreaming()); }
    catch (e) { return false; }
  }

  /* ---------------- 복사 ---------------- */
  function copyText(text) {
    var t = String(text == null ? "" : text);
    function fallback() {
      try {
        var ta = document.createElement("textarea");
        ta.value = t;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        ta.style.top = "0";
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(ta);
        toast(ok ? "복사됨" : "복사 실패", ok ? "ok" : "warn");
      } catch (e) {
        toast("복사 실패", "warn");
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(
        function () { toast("복사됨", "ok"); },
        function () { fallback(); }
      );
    } else {
      fallback();
    }
  }

  /* ---------------- 수정 후 재전송 (입력창 채우기) ---------------- */
  function editIntoComposer(text) {
    var t = String(text == null ? "" : text);
    /* 현재 보이는 쪽 우선: 허브 → FAB. 둘 다 안 보이면 FAB을 연다. */
    var hubTa = document.querySelector("[data-agh-chatta]");
    var fabTa = document.querySelector(".ezx-ta");
    var target = null;
    if (visible(hubTa)) target = hubTa;
    else if (visible(fabTa)) target = fabTa;
    else if (window.Elizax && Elizax.open) {
      try { Elizax.open(); } catch (e) { /* ignore */ }
      target = document.querySelector(".ezx-ta");
    }
    if (!target) { toast("입력창을 찾지 못했습니다", "warn"); return; }
    target.value = t;
    /* 자동 높이 조절 로직이 있으면 반응하도록 input 이벤트 발생 */
    try {
      var ev = document.createEvent("Event");
      ev.initEvent("input", true, false);
      target.dispatchEvent(ev);
    } catch (e2) { /* ignore */ }
    target.focus();
    try { target.setSelectionRange(t.length, t.length); } catch (e3) { /* ignore */ }
    toast("수정 후 전송하세요", "");
  }

  /* ---------------- 액션 바 ---------------- */
  var cur = { node: null, msg: null, bar: null };

  function removeBar() {
    if (cur.bar && cur.bar.parentNode) cur.bar.parentNode.removeChild(cur.bar);
    cur.node = null; cur.msg = null; cur.bar = null;
  }

  function buildBar(node, m) {
    var bar = document.createElement("div");
    bar.className = "ezcx-act-bar";
    var busy = streaming();
    var html = '<button type="button" class="ezcx-act-btn" data-ezcx-act="copy" title="내용 복사">⧉ 복사</button>';
    if (m.role === "ai" && !busy && isLastOfRole(m, "ai")) {
      html += '<button type="button" class="ezcx-act-btn" data-ezcx-act="regen" title="같은 질문으로 다시 생성">↻ 재생성</button>';
    }
    if (m.role === "user" && !busy && isLastOfRole(m, "user")) {
      html += '<button type="button" class="ezcx-act-btn" data-ezcx-act="edit" title="입력창으로 불러와 수정 후 재전송">✎ 수정</button>';
    }
    bar.innerHTML = html;
    node.appendChild(bar);
    return bar;
  }

  function showBar(node, m) {
    if (cur.node === node && cur.bar && cur.bar.parentNode === node) return; /* 이미 표시 중 */
    removeBar();
    cur.node = node; cur.msg = m;
    cur.bar = buildBar(node, m);
  }

  /* 스트리밍 시작/종료 시 표시 중인 바 갱신 (재생성·수정 표시/숨김) */
  function refreshBar() {
    if (!cur.node || !cur.bar) return;
    if (!cur.bar.parentNode) { removeBar(); return; } /* 재렌더로 이미 소멸 */
    var node = cur.node, m = cur.msg;
    removeBar();
    if (node && m && document.body.contains(node)) {
      cur.node = node; cur.msg = m;
      cur.bar = buildBar(node, m);
    }
  }

  /* ---------------- 이벤트 위임 ---------------- */
  function onMouseOver(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var node = t.closest(".ezx-msg");
    if (!node) {
      /* 메시지 밖으로 나감 — 바 제거 (바 자체는 .ezx-msg 내부라 여기 안 옴) */
      if (cur.bar) removeBar();
      return;
    }
    if (node === cur.node && cur.bar && cur.bar.parentNode === node) return;
    var m = msgOfNode(node);
    if (!m) { if (cur.bar) removeBar(); return; }
    showBar(node, m);
  }

  function onClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var btn = t.closest("[data-ezcx-act]");
    if (!btn) return;
    var host = btn.closest(".ezx-msg");
    var m = host ? msgOfNode(host) : null;
    if (!m) return;
    var act = btn.getAttribute("data-ezcx-act");
    var bubble = host.querySelector(".ezx-bubble");
    if (act === "copy") {
      copyText(bubble ? bubble.innerText : (m.text || ""));
    } else if (act === "regen") {
      if (streaming()) { toast("생성 중에는 재생성할 수 없습니다", "warn"); return; }
      if (window.Elizax && Elizax.regenerate) {
        try { Elizax.regenerate(); } catch (e2) { toast("재생성 실패", "warn"); }
      }
    } else if (act === "edit") {
      if (streaming()) { toast("생성 중에는 수정할 수 없습니다", "warn"); return; }
      editIntoComposer(m.text || (bubble ? bubble.innerText : ""));
    }
  }

  /* ---------------- 부트스트랩 ---------------- */
  function boot() {
    injectStyle();
    document.addEventListener("mouseover", onMouseOver, false);
    document.addEventListener("click", onClick, false);
    /* 스트리밍 상태 변화 → 표시 중인 바의 재생성/수정 버튼 갱신 */
    var tries = 0;
    (function hook() {
      if (window.EZChat && EZChat.on) {
        EZChat.on("streaming", function () { refreshBar(); });
        EZChat.on("messages", function () {
          /* 재렌더로 노드가 갈렸으면 상태만 정리 */
          if (cur.bar && !cur.bar.parentNode) removeBar();
        });
        return;
      }
      if (++tries < 20) setTimeout(hook, 300);
    })();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  /* esc는 현재 innerHTML에 사용자 문자열을 넣지 않아 미사용이지만,
     계약 4항(HTML 삽입 시 이스케이프) 준수를 위해 유지한다. */
  void esc;
})();
