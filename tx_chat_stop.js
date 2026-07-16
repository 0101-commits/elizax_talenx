/* =========================================================================
 * tx_chat_stop.js — elizax 채팅 "생성 중지" 버튼 모듈
 * =========================================================================
 * [기획 스펙]
 *
 * ① 배경/문제
 *    - elizax AI가 답변을 스트리밍 생성하는 동안 사용자가 이를 멈출 방법이
 *      화면에 없다. 잘못된 질문을 보냈거나 답변 방향이 어긋났을 때
 *      생성이 끝날 때까지 기다려야 해서 데모/실사용 모두 답답하다.
 *
 * ② 사용자 시나리오
 *    - (FAB) 도킹 대화창에서 질문 전송 → 답변 생성이 시작되면 컴포저 바로
 *      위에 "■ 생성 중지" 필 버튼이 나타남 → 클릭하면 즉시 생성이 멎고
 *      "생성을 중지했습니다" 토스트 → 버튼은 사라짐.
 *    - (허브) 전체화면 허브의 대화 화면에서도 동일한 위치(허브 컴포저 위)에
 *      같은 버튼이 나타나며 동일하게 동작.
 *    - (키보드) 생성 중 Esc 를 누르면 버튼 클릭과 동일하게 중지된다.
 *      생성 중이 아닐 때의 Esc(FAB 패널 닫기 등)는 기존 동작 그대로.
 *
 * ③ 동작 정의
 *    - EZChat.on("streaming", {on}) 구독:
 *        on=true  → FAB(.ezx-composer)와 허브(.agh-chatcomp) 각 컴포저
 *                   "바로 위"에 중앙 정렬 필 버튼 주입 (이중 주입 방지:
 *                   고유 클래스 .ezcx-stop-wrap 존재 체크)
 *        on=false → 주입된 버튼 전부 제거.
 *    - 허브 대화 화면은 수시로 재렌더되어 버튼이 유실될 수 있으므로,
 *      streaming 이벤트마다 "현재 DOM"을 새로 조회해 주입한다. 또한
 *      스트리밍 중 "messages" 이벤트가 올 때도 버튼 존재를 재확인·재주입.
 *    - 클릭/Esc → Elizax.stopStreaming() 호출 후 TX.toast("생성을 중지했습니다").
 *    - Esc 는 document capture 단계에서 처리하며, 스트리밍 중일 때만
 *      stopPropagation() 하여 FAB 의 "Esc=패널 닫기" 동작과 충돌하지 않게 함.
 *
 * ④ 엣지 케이스
 *    - EZChat/Elizax/TX 전역이 아직 없을 수 있다 → 폴링(300ms×최대 20회)으로
 *      EZChat 확보 후 구독. 이후에도 모든 전역은 사용 직전에 존재 확인.
 *    - FAB 패널이 닫혀 있어도 버튼은 컴포저 위에 심어 둔다(패널이 닫혀 있으면
 *      자연히 보이지 않고, 다시 열면 그대로 보임).
 *    - 허브가 닫혀 있거나 대화 화면이 아니면 .agh-chatcomp 가 없다 → 그냥
 *      건너뜀(있을 때만 주입).
 *    - AI 미연결(offline) 목업 모드에서도 streaming 이벤트/stopStreaming 은
 *      동일 계약이므로 그대로 동작한다.
 *    - streaming(on=false) 이벤트가 유실되는 비정상 상황 대비: 클릭/Esc 처리
 *      직후 버튼을 즉시 제거해 잔류 버튼이 남지 않게 한다.
 * ========================================================================= */
(function () {
  "use strict";

  /* ---- 상수 ---- */
  var WRAP_CLS = "ezcx-stop-wrap";   // 이중 주입 방지용 고유 래퍼 클래스
  var BTN_CLS = "ezcx-stop-btn";
  var STYLE_ID = "ezcx-stop-style";
  var LABEL = "■ 생성 중지"; // 버튼 표기 문구

  /* ---- 상태 ---- */
  var streaming = false; // 현재 스트리밍 여부(이벤트 기반 로컬 플래그)

  /* ---- HTML 이스케이프 (계약 규칙 4 — 텍스트 삽입 시 사용) ---- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /* ---- 스타일 주입 (1회) ---- */
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent =
      "." + WRAP_CLS + "{display:flex;justify-content:center;padding:4px 10px 6px;}" +
      "." + BTN_CLS + "{display:inline-flex;align-items:center;gap:6px;" +
        "padding:6px 16px;border-radius:999px;cursor:pointer;" +
        "font-size:12px;font-weight:600;line-height:1;" +
        "color:var(--ink,#1D2433);background:var(--card,#fff);" +
        "border:1px solid var(--line,#E4E7EC);" +
        "box-shadow:0 2px 8px rgba(0,0,0,.08);}" +
      "." + BTN_CLS + ":hover{border-color:var(--blue,#1F7AF0);" +
        "color:var(--blue,#1F7AF0);background:var(--soft,#F8FAFC);}";
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---- 중지 실행 ---- */
  function doStop() {
    if (window.Elizax && typeof window.Elizax.stopStreaming === "function") {
      window.Elizax.stopStreaming();
    }
    if (window.TX && typeof window.TX.toast === "function") {
      window.TX.toast("생성을 중지했습니다");
    }
    // streaming(on=false) 이벤트가 곧 오지만, 유실 대비 즉시 정리
    removeAll();
  }

  /* ---- 버튼 요소 생성 ---- */
  function buildButton() {
    var wrap = document.createElement("div");
    wrap.className = WRAP_CLS;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = BTN_CLS;
    btn.innerHTML = esc(LABEL); // 텍스트뿐이지만 계약 규칙에 따라 이스케이프
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      doStop();
    });
    wrap.appendChild(btn);
    return wrap;
  }

  /* ---- 특정 컴포저 바로 위에 주입 (이중 주입 방지) ---- */
  function injectAbove(composer) {
    if (!composer || !composer.parentNode) return;
    // 바로 앞 형제가 이미 우리 래퍼면 스킵
    var prev = composer.previousElementSibling;
    if (prev && prev.className && String(prev.className).indexOf(WRAP_CLS) >= 0) return;
    // 같은 부모 안 어딘가에 이미 있으면 스킵(재렌더 잔재 방지)
    var exist = composer.parentNode.querySelector("." + WRAP_CLS);
    if (exist) return;
    composer.parentNode.insertBefore(buildButton(), composer);
  }

  /* ---- 현재 DOM 기준으로 필요한 곳 전부 주입 ---- */
  function injectAll() {
    injectStyle();
    var i, list;
    // FAB 도킹창 컴포저 (패널 열림 여부 무관 — 닫혀 있으면 안 보일 뿐)
    list = document.querySelectorAll(".ezx-composer");
    for (i = 0; i < list.length; i++) injectAbove(list[i]);
    // 허브 대화 컴포저 (존재할 때만)
    list = document.querySelectorAll(".agh-chatcomp");
    for (i = 0; i < list.length; i++) injectAbove(list[i]);
  }

  /* ---- 전부 제거 ---- */
  function removeAll() {
    var list = document.querySelectorAll("." + WRAP_CLS);
    for (var i = 0; i < list.length; i++) {
      if (list[i].parentNode) list[i].parentNode.removeChild(list[i]);
    }
  }

  /* ---- Esc 키 처리 (capture 단계) ---- */
  function onKeydown(e) {
    if (e.key !== "Escape" && e.keyCode !== 27) return;
    if (!streaming) return; // 생성 중이 아니면 기존 동작(패널 닫기 등)에 양보
    e.stopPropagation();    // FAB 의 Esc=닫기 핸들러와 충돌 방지
    e.preventDefault();
    doStop();
  }

  /* ---- EZChat 구독 ---- */
  function bind(ez) {
    ez.on("streaming", function (d) {
      streaming = !!(d && d.on);
      if (streaming) injectAll();
      else removeAll();
    });
    // 스트리밍 중 재렌더(messages)로 버튼이 날아가면 재주입
    ez.on("messages", function () {
      if (streaming) injectAll();
    });
    document.addEventListener("keydown", onKeydown, true);
  }

  /* ---- 부트스트랩: EZChat 폴링(300ms × 최대 20회) ---- */
  function boot() {
    var tries = 0;
    (function poll() {
      if (window.EZChat && typeof window.EZChat.on === "function") {
        bind(window.EZChat);
        return;
      }
      tries++;
      if (tries >= 20) return; // EZChat 부재 → 조용히 포기(방어)
      setTimeout(poll, 300);
    })();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
