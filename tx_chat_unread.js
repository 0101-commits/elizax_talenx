/* ============================================================================
 * tx_chat_unread.js — FAB 미읽음 배지 + 선제 알림 유입 (elizax 채팅 확장 모듈)
 * ----------------------------------------------------------------------------
 * [기획 스펙]
 *
 * ① 배경/문제
 *    - elizax FAB 도킹창을 닫아둔 채 다른 화면을 보는 동안 AI 응답이 완료되면
 *      사용자가 이를 인지할 방법이 없다. 응답을 놓치면 "AI가 일하고 있다"는
 *      체감이 끊기고, 선제(proactive) 에이전트 경험도 성립하지 않는다.
 *    - 또한 사용자가 먼저 말을 걸기 전에는 elizax가 아무것도 하지 않는 것처럼
 *      보인다. 역할 기반 선제 브리핑을 대화에 먼저 적재해 "에이전트가 나를
 *      지켜보다 먼저 제안한다"는 데모 내러티브를 완성한다.
 *
 * ② 사용자 시나리오
 *    - 시나리오 A: 사용자가 질문 후 패널을 닫고 다른 화면 탐색 → AI 생성 완료
 *      → FAB 우상단에 빨간 배지 "1" + FAB 은은한 pulse(2회) + 문서 타이틀에
 *      "(1) " 프리픽스 → FAB 클릭(또는 패널/허브 열림) 즉시 배지·타이틀 원복.
 *    - 시나리오 B: 페이지 로드 후 25초간 패널·허브를 한 번도 열지 않고 대화도
 *      하지 않으면, 현재 역할(팀장/조직원/HR/경영진)에 맞는 선제 브리핑 1건이
 *      ai 메시지로 대화 원장에 적재되고 배지 +1 → 열어보면 브리핑이 놓여 있다.
 *
 * ③ 동작 정의
 *    - "닫힘" 판정: .ezx-root에 ezx-open 없음 AND .agh-root에 on 없음.
 *    - 카운트 증가: 닫힘 상태에서
 *      (a) EZChat "streaming" {on:false} 수신(스트리밍 생성 완료) → +1
 *      (b) EZChat "messages" {op:"push", msg.role:"ai"} 수신 → +1
 *          단, 스트리밍 진행 중의 ai push는 (a)에서 집계하므로 제외(중복 방지).
 *    - 배지 리셋: .ezx-fab 클릭(문서 레벨 위임) / .ezx-root에 ezx-open 부여 /
 *      .agh-root에 on 부여 — 각각 MutationObserver(class 속성)로 감시.
 *    - 배지 표시 중 FAB에 pulse 애니메이션(CSS keyframes, 2회만) — animationend
 *      에서 클래스 제거, 새 증가 때마다 재기동(reflow 트릭).
 *    - 문서 타이틀: 배지 있을 때만 "(N) " 프리픽스, 원래 타이틀은 보존·복원.
 *    - 선제 브리핑: 로드 25초 후 1회 검사. (패널·허브 닫힘 + 그때까지 미조작 +
 *      localStorage 플래그 없음)일 때만 EZChat.push({role:"ai", ...}) 1건 적재.
 *      플래그 키는 대화 세션 id 기준(ezcx.unread.briefed.<sessionId>)으로
 *      세션당 1회 제한. 텍스트는 TXRoles.current().key 기준 역할별 1문장.
 *
 * ④ 엣지 케이스
 *    - FAB(.ezx-root)는 DOMContentLoaded 이후 생성 → 300ms 간격 최대 20회 폴링.
 *    - .agh-root(허브)는 최초 오픈 시점에 늦게 생길 수 있음 → 별도 폴링으로
 *      발견 즉시 감시 부착(못 찾아도 FAB 클릭/패널 오픈 리셋은 정상 동작).
 *    - 패널이 이미 열려 있는 동안의 응답 완료는 집계하지 않는다(읽는 중이므로).
 *    - Elizax.refresh() 재렌더는 .ezx-list 내부만 리셋 → 배지는 .ezx-fab 직속
 *      자식이라 영향 없음. 그래도 매 갱신 시 배지 존재를 확인 후 재부착한다.
 *    - EZChat/TXRoles 등 전역 부재 시 해당 기능만 조용히 생략(전체 모듈 무해화).
 *    - 문서 타이틀에 이미 "(N) "이 있으면 정규식으로 벗겨 기준 타이틀을 잡는다.
 *    - localStorage 접근 불가(사생활 모드 등) 시 브리핑은 이번 로드에 한해
 *      메모리 플래그로만 1회 제한.
 * ========================================================================== */
(function () {
  "use strict";

  /* ---------- 유틸 ---------- */

  // HTML 이스케이프 (계약 필수 규칙 — 본 모듈은 배지 숫자에 textContent를 쓰지만
  // 문자열을 HTML로 넣을 일이 생기면 반드시 이 함수를 거친다)
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function lsGet(k) {
    try { return window.localStorage.getItem(k); } catch (e) { return null; }
  }
  function lsSet(k, v) {
    try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; }
  }

  /* ---------- 상태 ---------- */

  var count = 0;            // 미읽음 개수
  var streamingOn = false;  // 현재 스트리밍 생성 중인지 (ai push 중복 집계 방지)
  var interacted = false;   // 사용자가 패널/허브를 열었거나 대화를 시작했는지
  var briefedMem = false;   // localStorage 불가 환경용 메모리 플래그
  var baseTitle = null;     // 프리픽스 제거된 원래 문서 타이틀
  var fabEl = null;         // .ezx-fab 캐시
  var rootObserved = false; // .ezx-root 감시 부착 여부
  var hubObserved = false;  // .agh-root 감시 부착 여부

  /* ---------- 스타일 주입 ---------- */

  function injectStyle() {
    if (document.getElementById("ezcx-unread-style")) return;
    var st = document.createElement("style");
    st.id = "ezcx-unread-style";
    st.textContent = "" +
      /* 빨간 미읽음 배지 — FAB 우상단 */
      ".ezcx-unread-badge{" +
      "position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;" +
      "padding:0 5px;box-sizing:border-box;border-radius:10px;" +
      "background:#E5484D;color:#fff;border:2px solid var(--card,#fff);" +
      "font-size:11px;font-weight:700;line-height:16px;text-align:center;" +
      "font-variant-numeric:tabular-nums;pointer-events:none;" +
      "box-shadow:0 2px 8px rgba(229,72,77,.4);z-index:2;}" +
      /* 은은한 pulse — 링이 퍼지는 box-shadow 애니메이션, 정확히 2회 */
      "@keyframes ezcx-unread-pulse-kf{" +
      "0%{box-shadow:0 4px 20px rgba(0,0,0,.18),0 0 0 0 rgba(31,122,240,.45);}" +
      "70%{box-shadow:0 4px 20px rgba(0,0,0,.18),0 0 0 14px rgba(31,122,240,0);}" +
      "100%{box-shadow:0 4px 20px rgba(0,0,0,.18),0 0 0 0 rgba(31,122,240,0);}}" +
      ".ezx-fab.ezcx-unread-pulse{" +
      "animation:ezcx-unread-pulse-kf 1.2s ease-out 2;}";
    document.head.appendChild(st);
  }

  /* ---------- 열림/닫힘 판정 ---------- */

  function panelOpen() {
    var r = document.querySelector(".ezx-root");
    return !!(r && r.classList.contains("ezx-open"));
  }
  function hubOpen() {
    var h = document.querySelector(".agh-root");
    return !!(h && h.classList.contains("on"));
  }
  function isClosed() { return !panelOpen() && !hubOpen(); }

  /* ---------- 문서 타이틀 프리픽스 ---------- */

  function captureBaseTitle() {
    // 이미 "(N) " 프리픽스가 붙어 있으면 벗겨서 기준 타이틀로 삼는다
    if (baseTitle === null) baseTitle = document.title.replace(/^\(\d+\)\s/, "");
  }
  function syncTitle() {
    captureBaseTitle();
    document.title = (count > 0 ? "(" + count + ") " : "") + baseTitle;
  }

  /* ---------- 배지 렌더 ---------- */

  function findFab() {
    if (!fabEl || !document.body.contains(fabEl)) {
      fabEl = document.querySelector(".ezx-fab");
    }
    return fabEl;
  }

  function renderBadge() {
    var fab = findFab();
    if (!fab) return;
    var badge = fab.querySelector(".ezcx-unread-badge");
    if (count > 0) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "ezcx-unread-badge";
        badge.setAttribute("aria-label", "읽지 않은 elizax 응답");
        fab.appendChild(badge);
      }
      badge.textContent = count > 9 ? "9+" : String(count);
    } else if (badge && badge.parentNode) {
      badge.parentNode.removeChild(badge);
    }
    syncTitle();
  }

  function pulseFab() {
    var fab = findFab();
    if (!fab) return;
    // 이미 도는 중이면 리셋 후 재기동 (reflow 트릭)
    fab.classList.remove("ezcx-unread-pulse");
    void fab.offsetWidth;
    fab.classList.add("ezcx-unread-pulse");
  }

  function onPulseEnd(e) {
    // 2회 반복이 끝나면 클래스 정리 (다음 증가 때 다시 붙는다)
    if (e && e.animationName === "ezcx-unread-pulse-kf" && e.target) {
      e.target.classList.remove("ezcx-unread-pulse");
    }
  }

  /* ---------- 카운트 증감 ---------- */

  function bump() {
    if (!isClosed()) return; // 패널/허브가 열려 있으면 "읽는 중" — 집계 안 함
    count += 1;
    renderBadge();
    pulseFab();
  }

  function resetUnread() {
    interacted = true;
    if (count === 0) return;
    count = 0;
    renderBadge();
    var fab = findFab();
    if (fab) fab.classList.remove("ezcx-unread-pulse");
  }

  /* ---------- EZChat 이벤트 구독 ---------- */

  function bindChat() {
    if (!window.EZChat || typeof window.EZChat.on !== "function") return;

    window.EZChat.on("streaming", function (d) {
      var on = !!(d && d.on);
      if (on) { streamingOn = true; return; }
      // 생성 완료 시점 — 닫혀 있으면 미읽음 +1
      if (streamingOn) {
        streamingOn = false;
        bump();
      }
    });

    window.EZChat.on("messages", function (d) {
      if (!d || d.op !== "push" || !d.msg) return;
      if (d.msg.role === "user") { interacted = true; return; } // 사용자 발화 = 조작
      if (d.msg.role !== "ai") return;
      // 스트리밍 중의 ai push는 streaming(off)에서 집계하므로 여기선 제외
      if (streamingOn) return;
      bump();
    });
  }

  /* ---------- 열림 감시 (클릭 위임 + MutationObserver) ---------- */

  function bindOpenWatchers() {
    // FAB 클릭 — 문서 레벨 위임(FAB이 늦게 생기거나 교체되어도 안전)
    document.addEventListener("click", function (e) {
      var t = e.target;
      while (t && t !== document) {
        if (t.classList && t.classList.contains("ezx-fab")) { resetUnread(); return; }
        t = t.parentNode;
      }
    }, true);

    // pulse 종료 정리 — 문서 레벨 위임
    document.addEventListener("animationend", onPulseEnd, true);
  }

  function observeClass(el, checkFn) {
    if (!window.MutationObserver) return;
    var mo = new MutationObserver(function () { checkFn(); });
    mo.observe(el, { attributes: true, attributeFilter: ["class"] });
  }

  // .ezx-root / .agh-root 는 늦게 생긴다 — 폴링으로 발견 즉시 감시 부착
  function pollRoots() {
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;

      var root = document.querySelector(".ezx-root");
      if (root && !rootObserved) {
        rootObserved = true;
        observeClass(root, function () {
          if (root.classList.contains("ezx-open")) resetUnread();
        });
        renderBadge(); // FAB 등장 시점에 밀린 배지가 있으면 즉시 표시
      }

      var hub = document.querySelector(".agh-root");
      if (hub && !hubObserved) {
        hubObserved = true;
        observeClass(hub, function () {
          if (hub.classList.contains("on")) resetUnread();
        });
      }

      // FAB은 필수, 허브는 최초 오픈 전엔 없을 수 있음 → 20회까지만 대기
      if ((rootObserved && hubObserved) || tries >= 20) clearInterval(timer);
    }, 300);
  }

  /* ---------- 선제 브리핑 (로드 25초 후 1회) ---------- */

  var BRIEF_TEXTS = {
    leader: "팀 체크인 지연 3명을 감지했습니다. '주간 체크인 브리핑 만들어줘'라고 요청하면 초안까지 준비합니다.",
    member: "이번 주 체크인 마감이 다가옵니다. '이번 주 체크인 초안 잡아줘'라고 요청하면 초안까지 준비합니다.",
    hr: "캘리브레이션 사전 점검 이슈 2건을 감지했습니다. '캘리브레이션 점검 브리핑 만들어줘'라고 요청하면 초안까지 준비합니다.",
    exec: "조직 성과 신호에 변화가 감지되었습니다. '경영 브리핑 요약 만들어줘'라고 요청하면 초안까지 준비합니다."
  };

  function briefFlagKey() {
    var sid = "default";
    try {
      if (window.EZChat && typeof window.EZChat.currentId === "function") {
        sid = String(window.EZChat.currentId() || "default");
      }
    } catch (e) { /* 무해화 */ }
    return "ezcx.unread.briefed." + sid;
  }

  function alreadyBriefed() {
    if (briefedMem) return true;
    return lsGet(briefFlagKey()) === "1";
  }
  function markBriefed() {
    briefedMem = true;
    lsSet(briefFlagKey(), "1");
  }

  function scheduleProactiveBrief() {
    setTimeout(function () {
      // 발화 조건: 패널·허브 닫힘 + 그때까지 미조작 + 세션당 1회
      if (!window.EZChat || typeof window.EZChat.push !== "function") return;
      if (!isClosed()) return;
      if (interacted) return;
      if (alreadyBriefed()) return;

      var roleKey = "member";
      try {
        if (window.TXRoles && typeof window.TXRoles.current === "function") {
          var r = window.TXRoles.current();
          if (r && r.key) roleKey = r.key;
        }
      } catch (e) { /* 역할 조회 실패 시 기본 톤 */ }

      var text = BRIEF_TEXTS[roleKey] || BRIEF_TEXTS.member;
      markBriefed(); // push 이벤트 재진입 전에 먼저 마킹
      window.EZChat.push({
        role: "ai",
        text: "(선제 브리핑) " + text,
        meta: { ezcxProactive: true }
      });
      // 배지 증가는 "messages" push 핸들러(bump)가 자동 처리한다
    }, 25000);
  }

  /* ---------- 부트스트랩 ---------- */

  function boot() {
    injectStyle();
    bindChat();
    bindOpenWatchers();
    pollRoots();
    scheduleProactiveBrief();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
