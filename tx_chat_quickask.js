/* =========================================================================
 * tx_chat_quickask.js — "텍스트 선택 → elizax에게 묻기" 퀵애스크 모듈
 * =========================================================================
 * [기획 스펙]
 *
 * ① 배경/문제
 *    - 사용자가 메인 앱 화면(성과·평가·승인 등)에서 낯선 용어나 수치를
 *      발견해도, 이를 elizax 에게 물어보려면 FAB 를 열고 내용을 직접
 *      타이핑/복붙해야 한다. "보고 있는 그 자리에서 바로 묻기" 동선이 없어
 *      AI 활용 문턱이 높다.
 *
 * ② 사용자 시나리오
 *    - 화면 본문에서 텍스트를 드래그 선택(8자 이상) → 선택 영역 바로 위에
 *      "✦ elizax에게 묻기" 플로팅 버튼이 뜬다 → 클릭하면 FAB 대화창이
 *      열리면서 "다음 내용에 대해 설명해줘: > (선택 텍스트)" 질문이 자동
 *      전송된다 → 선택을 해제하거나, 다른 곳을 클릭하거나, 스크롤하면
 *      버튼은 조용히 사라진다.
 *
 * ③ 동작 정의
 *    - document mouseup 감지 → setTimeout(0) 뒤 window.getSelection() 검사:
 *        · 비어있지 않고(collapsed 아님) trim 길이 8자 이상
 *        · 선택 시작점이 section.screen 내부일 것 (메인 앱 화면 한정)
 *        · .ezx-root / .agh-root 내부(자기 대화창·허브) 선택은 제외
 *        · input / textarea 내부 선택은 제외 (mouseup target 기준)
 *      통과 시 getRangeAt(0).getBoundingClientRect() 로 선택 영역 위치를
 *      구해, 그 위쪽 중앙에 버튼을 fixed 배치(위 공간 부족 시 아래쪽,
 *      좌우는 뷰포트 안으로 클램프).
 *    - 버튼은 싱글턴(1개 재사용), z-index 100010 (FAB·기존 오버레이보다 위).
 *    - 클릭 → Elizax.send("다음 내용에 대해 설명해줘:\n> " + 선택텍스트)
 *      (선택텍스트는 공백 정리 후 200자 컷, 초과 시 "…" 부착.
 *       send 가 패널 오픈까지 처리) → 버튼 제거 + 선택 해제.
 *    - 제거 트리거: 새 mousedown(버튼 자신 제외) · 스크롤(capture, 내부
 *      스크롤 포함) · selectionchange 로 선택이 사라졌을 때 · 창 리사이즈.
 *    - 버튼 mousedown 은 preventDefault 하여 클릭 순간 브라우저가 선택을
 *      지워버리는 것을 막는다.
 *
 * ④ 엣지 케이스
 *    - Elizax 전역이 아직 없을 수 있다 → 클릭 시점에 존재 확인, 없으면
 *      TX.toast 로 안내(그마저 없으면 무동작). DOM 의존이 거의 없는 모듈이라
 *      부트는 즉시 하되 모든 전역은 사용 직전에 재확인.
 *    - 선택이 여러 화면 요소에 걸치거나 rect 가 0×0(빈 rect)인 경우 → 미표시.
 *    - Elizax.isStreaming() 이 true 인 동안 클릭 → 기존 생성과 충돌하지
 *      않도록 토스트로 "생성 중" 안내만 하고 전송하지 않는다.
 *    - contenteditable/입력 필드 안의 선택: target 이 input/textarea 이면
 *      제외. (본 목업에 contenteditable 본문은 없어 별도 처리 불필요.)
 *    - 모바일 터치는 데스크톱 데모 범위 밖 — touch 이벤트는 다루지 않는다.
 *    - AI 미연결(offline) 모드에서도 Elizax.send 는 목업 응답을 돌려주므로
 *      기능이 그대로 성립한다.
 * ========================================================================= */
(function () {
  "use strict";

  /* ---- 상수 ---- */
  var BTN_ID = "ezcx-quickask-btn";     // 싱글턴 버튼 id
  var STYLE_ID = "ezcx-quickask-style";
  var MIN_LEN = 8;                      // 최소 선택 길이
  var MAX_LEN = 200;                    // 질문에 싣는 최대 길이
  var GAP = 8;                          // 선택 영역과 버튼 사이 간격(px)
  var LABEL = "✦ elizax에게 묻기"; // 버튼 표기 문구

  /* ---- 상태 ---- */
  var btn = null;        // 싱글턴 버튼 요소
  var pendingText = "";  // 버튼 클릭 시 전송할 선택 텍스트

  /* ---- HTML 이스케이프 (계약 규칙 4) ---- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /* ---- closest 대용: node 에서 위로 올라가며 selector 매칭 (방어적) ---- */
  function closestFrom(node, selector) {
    // 텍스트 노드면 부모 요소부터 시작
    var el = node && node.nodeType === 1 ? node : (node ? node.parentNode : null);
    while (el && el.nodeType === 1) {
      var match = el.matches || el.msMatchesSelector || el.webkitMatchesSelector;
      if (match && match.call(el, selector)) return el;
      el = el.parentNode;
    }
    return null;
  }

  /* ---- 스타일 주입 (1회) ---- */
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent =
      "#" + BTN_ID + "{position:fixed;z-index:100010;display:none;" +
        "align-items:center;gap:6px;padding:7px 14px;border-radius:999px;" +
        "cursor:pointer;font-size:12px;font-weight:700;line-height:1;" +
        "white-space:nowrap;user-select:none;" +
        "color:#fff;background:var(--blue,#1F7AF0);" +
        "border:1px solid var(--blue,#1F7AF0);" +
        "box-shadow:0 6px 18px rgba(31,122,240,.35);}" +
      "#" + BTN_ID + ":hover{filter:brightness(1.08);}" +
      "#" + BTN_ID + ".on{display:inline-flex;}";
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---- 싱글턴 버튼 확보 ---- */
  function ensureBtn() {
    if (btn && btn.parentNode) return btn;
    injectStyle();
    btn = document.createElement("button");
    btn.type = "button";
    btn.id = BTN_ID;
    btn.innerHTML = esc(LABEL);
    // mousedown 에서 선택이 지워지는 것을 방지 (클릭 전에 selection 유지)
    btn.addEventListener("mousedown", function (e) {
      e.preventDefault();
      e.stopPropagation();
    });
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      ask();
    });
    (document.body || document.documentElement).appendChild(btn);
    return btn;
  }

  /* ---- 버튼 표시 (선택 영역 rect 기준 위치 계산) ---- */
  function showAt(rect) {
    var b = ensureBtn();
    b.className = "on";
    // 실측을 위해 우선 붙인 뒤 크기 취득
    var bw = b.offsetWidth || 150;
    var bh = b.offsetHeight || 30;
    var vw = window.innerWidth || document.documentElement.clientWidth;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    // 기본: 선택 영역 위 중앙. 위 공간이 부족하면 아래쪽.
    var top = rect.top - bh - GAP;
    if (top < 4) top = rect.bottom + GAP;
    if (top + bh > vh - 4) top = Math.max(4, vh - bh - 4);
    var left = rect.left + (rect.width - bw) / 2;
    if (left < 4) left = 4;
    if (left + bw > vw - 4) left = vw - bw - 4;
    b.style.top = Math.round(top) + "px";
    b.style.left = Math.round(left) + "px";
  }

  /* ---- 버튼 숨김 ---- */
  function hide() {
    if (btn) btn.className = "";
    pendingText = "";
  }

  /* ---- 질문 전송 ---- */
  function ask() {
    var text = pendingText;
    hide();
    if (!text) return;
    var ez = window.Elizax;
    if (!ez || typeof ez.send !== "function") {
      if (window.TX && typeof window.TX.toast === "function") {
        window.TX.toast("elizax 대화창을 아직 쓸 수 없습니다", "warn");
      }
      return;
    }
    // 생성 중이면 충돌 방지: 안내만 하고 전송하지 않음
    if (typeof ez.isStreaming === "function" && ez.isStreaming()) {
      if (window.TX && typeof window.TX.toast === "function") {
        window.TX.toast("답변 생성 중입니다. 잠시 후 다시 시도해 주세요", "warn");
      }
      return;
    }
    ez.send("다음 내용에 대해 설명해줘:\n> " + text);
    // 전송 후 화면 선택은 정리
    try {
      var sel = window.getSelection();
      if (sel && sel.removeAllRanges) sel.removeAllRanges();
    } catch (e2) { /* 무시 */ }
  }

  /* ---- 현재 선택을 검사해 유효하면 {text, rect} 반환 ---- */
  function readSelection() {
    var sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.isCollapsed || sel.rangeCount < 1) return null;
    var raw = String(sel.toString() || "");
    var text = raw.replace(/\s+/g, " ").replace(/^\s+|\s+$/g, ""); // 공백 정리
    if (text.length < MIN_LEN) return null;
    // 위치·소속 판정은 선택 시작 노드 기준
    var anchor = sel.anchorNode;
    if (!anchor) return null;
    // 제외 영역: 자기 대화창(FAB)·전체화면 허브 내부
    if (closestFrom(anchor, ".ezx-root") || closestFrom(anchor, ".agh-root")) return null;
    // 메인 앱 화면(section.screen) 내부 선택만 대상
    if (!closestFrom(anchor, "section.screen")) return null;
    var rect;
    try {
      rect = sel.getRangeAt(0).getBoundingClientRect();
    } catch (e) {
      return null;
    }
    if (!rect || (rect.width === 0 && rect.height === 0)) return null; // 빈 rect 방어
    // 200자 컷 (초과 시 말줄임 표시)
    if (text.length > MAX_LEN) text = text.slice(0, MAX_LEN) + "…";
    return { text: text, rect: rect };
  }

  /* ---- mouseup: 선택 확정 후 버튼 표시 판단 ---- */
  function onMouseUp(e) {
    // 버튼 자신 위에서의 mouseup 은 무시 (클릭 처리에 맡김)
    if (btn && e && e.target && (e.target === btn || btn.contains(e.target))) return;
    // input/textarea 안에서의 드래그 선택은 제외
    var tag = e && e.target && e.target.tagName ? String(e.target.tagName).toUpperCase() : "";
    if (tag === "INPUT" || tag === "TEXTAREA") { hide(); return; }
    // 브라우저가 selection 을 확정할 시간을 준 뒤 검사
    setTimeout(function () {
      var got = readSelection();
      if (!got) { hide(); return; }
      pendingText = got.text;
      showAt(got.rect);
    }, 0);
  }

  /* ---- mousedown: 다른 곳 클릭 시 즉시 제거 ---- */
  function onMouseDown(e) {
    if (btn && e && e.target && (e.target === btn || btn.contains(e.target))) return;
    hide();
  }

  /* ---- 스크롤/리사이즈: 위치가 어긋나므로 제거 ---- */
  function onScrollOrResize() {
    if (btn && btn.className === "on") hide();
  }

  /* ---- selectionchange: 선택이 사라지면 제거 ---- */
  function onSelectionChange() {
    if (!btn || btn.className !== "on") return;
    var sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.isCollapsed || String(sel.toString()).replace(/\s+/g, "").length === 0) hide();
  }

  /* ---- 부트스트랩 ---- */
  function boot() {
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("mousedown", onMouseDown);
    // capture=true: 내부 스크롤 컨테이너(허브 캔버스 등)의 스크롤도 감지
    document.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("selectionchange", onSelectionChange);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
