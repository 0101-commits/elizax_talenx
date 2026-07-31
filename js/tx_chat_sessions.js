/* ============================================================
   tx_chat_sessions.js — 세션(대화) 목록 로직 모듈 (표면 없음)

   ── 기획 스펙 (18차 §7 중복 진입점 정리) ────────────────────
   ① 배경/문제
      「대화 목록(≡ 바)」·「기록 탭」·「허브 지난 대화 내비」·「🔍 검색」
      네 표면이 모두 같은 저장소(EZChat = localStorage
      "elizax_chat_v2:<emp>") 위의 껍데기였다. 자체 저장소가 없으므로
      합쳐도 잃는 것이 없는데, 사용자에게는 같은 기능이 네 번 보였다.
   ② 사용자 결정
      지난 대화 관련 진입은 헤더 🔍(대화 찾기) 오버레이 하나로 통일.
      → 이 파일에서 ≡ 바·드롭다운·허브 내비 주입을 전부 삭제하고,
        목록/행/이름변경/삭제 로직만 남겨 🔍 오버레이가 재사용한다.
   ③ 동작 정의
      - 이 모듈은 더 이상 DOM을 주입하지 않는다(표면 0개).
      - window.EZChatSessions 로 다음을 공개(단일 이음새):
          rowHtml(s)            세션 행 HTML 한 줄
          renderList(el)        el 안에 전체 세션 행 렌더(빈 상태 포함)
          askRename(sess)       이름 변경(TX.modal 우선, prompt 폴백)
          askDelete(sess)       삭제 확인(TX.modal 우선, confirm 폴백)
          withSession(id, fn)   id로 세션 요약 찾아 콜백
          onChange(fn)          sessions/switch/messages 변경 통지
          injectStyle()         행 스타일 주입(멱등)
      - 목록 데이터는 EZChat.sessions() 단일 소스. 현재 세션 하이라이트,
        각 행에 제목·시각·메시지 수 표기.
      - 전환/변경/삭제는 전부 EZChat API 위임(switchSession·renameSession·
        deleteSession·newSession).
   ④ 엣지 케이스
      - EZChat 부재(스크립트 로드 실패) 시 전역도 만들지 않고 침묵.
      - 삭제로 현재 세션이 사라지면 EZChat이 switch 이벤트를 쏘고
        대화창(tx_elizax)이 스스로 재렌더 — 여기선 통지만 한다.
      - 세션 1개(현재뿐)여도 삭제 허용: 스토어가 빈 새 세션을 보장.
      - 다른 탭에서의 변경도 storage→"sessions" 이벤트로 통지된다.
      - 구독자(🔍 오버레이)가 아직 없을 때의 이벤트는 그냥 버린다.
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- helpers ---------------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function chat() { return window.EZChat || null; }

  /* ---------------- 스타일 주입 (행·＋ 버튼만) ---------------- */
  /* ≡ 바(.ezcs-bar)·드롭다운(.ezcs-drop*)·허브 내비(.ezcs-navsec) 규칙은
     표면 삭제와 함께 제거했다. 남은 규칙은 🔍 오버레이가 쓰는 것뿐. */
  function injectStyle() {
    if (document.getElementById("ezcs-style")) return;
    var st = document.createElement("style");
    st.id = "ezcs-style";
    st.textContent =
      /* ＋ 새 대화 버튼 */
      ".ezcs-new{border:1px solid var(--color-accent);background:transparent;color:var(--color-accent);" +
      "border-radius:var(--radius-element);padding:4px 10px;font:inherit;font-size:12px;font-weight:700;cursor:pointer;}" +
      ".ezcs-new:hover{background:var(--color-accent);color:var(--color-on-accent);}" +

      /* 세션 행 */
      ".ezcs-row{display:flex;align-items:center;gap:8px;width:100%;padding:7px 8px;border-radius:var(--radius-element);" +
      "cursor:pointer;border:1px solid transparent;box-sizing:border-box;}" +
      ".ezcs-row:hover{background:var(--color-background-muted);}" +
      ".ezcs-row.on{background:color-mix(in srgb, var(--color-accent) 9%, transparent);" +
      "border-color:color-mix(in srgb, var(--color-accent) 32%, transparent);}" +
      ".ezcs-row .ezcs-tt{flex:1;min-width:0;}" +
      ".ezcs-row .ezcs-t1{display:block;font-size:12.5px;font-weight:600;color:var(--color-text-primary);" +
      "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
      ".ezcs-row.on .ezcs-t1{color:var(--color-accent);}" +
      ".ezcs-row .ezcs-t2{display:block;font-size:11px;color:var(--color-text-disabled);margin-top:1px;}" +
      ".ezcs-act{flex:none;border:0;background:transparent;border-radius:var(--radius-inner);padding:3px 5px;" +
      "font-size:12px;line-height:1;color:var(--color-text-disabled);cursor:pointer;}" +
      ".ezcs-act:hover{background:var(--color-background-muted);color:var(--color-text-primary);}" +
      ".ezcs-empty{padding:14px 10px;font-size:12px;color:var(--color-text-disabled);text-align:center;}";
    document.head.appendChild(st);
  }

  /* ---------------- 이름 변경 / 삭제 (TX.modal 우선, 폴백 내장) ---------------- */
  function askRename(sess) {
    var ez = chat();
    if (!ez || !sess) return;
    if (window.TX && TX.modal) {
      TX.modal({
        title: "대화 이름 변경",
        body: '<div data-astryx-theme="talenx"><input type="text" data-ezcs-name value="' + esc(sess.title) + '" maxlength="60" ' +
          'style="width:100%;border:1px solid var(--color-border);border-radius:var(--radius-element);padding:9px;font:inherit;font-size:13px;box-sizing:border-box"></div>',
        actions: [
          { label: "취소" },
          { label: "변경", kind: "primary", onClick: function (box) {
              var inp = box.querySelector("[data-ezcs-name]");
              var v = inp ? inp.value.trim() : "";
              if (v) { ez.renameSession(sess.id, v); if (window.TX && TX.toast) TX.toast("대화 이름을 변경했습니다", "ok"); }
            } }
        ]
      });
    } else {
      var v2 = window.prompt("대화 이름", sess.title || "");
      if (v2 !== null && v2.trim()) ez.renameSession(sess.id, v2.trim());
    }
  }
  function askDelete(sess) {
    var ez = chat();
    if (!ez || !sess) return;
    function doDel() {
      ez.deleteSession(sess.id);
      if (window.TX && TX.toast) TX.toast("대화를 삭제했습니다", "ok");
    }
    if (window.TX && TX.modal) {
      TX.modal({
        title: "대화 삭제",
        body: '<p data-astryx-theme="talenx" style="font-size:13px;color:var(--color-text-secondary);margin:0">"' + esc(sess.title) +
          '" 대화(메시지 ' + esc(sess.count) + '건)를 삭제합니다.<br>삭제한 대화는 복구할 수 없습니다.</p>',
        actions: [
          { label: "취소" },
          { label: "삭제", kind: "primary", onClick: function () { doDel(); } }
        ]
      });
    } else {
      if (window.confirm('"' + (sess.title || "새 대화") + '" 대화를 삭제할까요?')) doDel();
    }
  }

  /* ---------------- 목록 렌더 (호출자가 컨테이너를 준다) ---------------- */
  function rowHtml(s) {
    return '<div class="ezcs-row' + (s.current ? " on" : "") + '" data-ezcs-row="' + esc(s.id) + '" ' +
      'role="button" tabindex="0" title="' + esc(s.title) + '">' +
      '<span class="ezcs-tt"><span class="ezcs-t1">' + esc(s.title) + "</span>" +
      '<span class="ezcs-t2">' + esc(s.at || "") + " · 메시지 " + esc(s.count) + "건</span></span>" +
      '<button class="ezcs-act" data-ezcs-ren="' + esc(s.id) + '" title="이름 변경" aria-label="이름 변경">✎</button>' +
      '<button class="ezcs-act" data-ezcs-del="' + esc(s.id) + '" title="삭제" aria-label="삭제">🗑</button>' +
      "</div>";
  }
  function renderList(el) {
    if (!el || !chat()) return;
    var ss = [];
    try { ss = chat().sessions() || []; } catch (e) { ss = []; }
    var html = "";
    for (var i = 0; i < ss.length; i++) html += rowHtml(ss[i]);
    el.innerHTML = html || '<div class="ezcs-empty">저장된 대화가 없습니다</div>';
  }
  /* id → 목록 스냅샷에서 세션 요약 찾아 콜백 */
  function withSession(id, fn) {
    var ez = chat();
    if (!ez) return;
    var ss = ez.sessions();
    for (var i = 0; i < ss.length; i++) if (ss[i].id === id) { fn(ss[i]); return; }
  }

  /* ---------------- 변경 통지 (구독자 = 🔍 오버레이) ---------------- */
  var subs = [];
  function onChange(fn) { if (typeof fn === "function") subs.push(fn); }
  function fire() {
    for (var i = 0; i < subs.length; i++) {
      try { subs[i](); } catch (e) { /* 구독자 하나가 죽어도 나머지는 통지 */ }
    }
  }
  function bindStore() {
    var ez = chat();
    if (!ez || !ez.on) return;
    ez.on("sessions", fire);
    ez.on("switch", fire);
    ez.on("messages", fire);   /* 메시지 수·자동 제목 변경도 목록에 반영 */
  }

  /* ---------------- 부트스트랩 ---------------- */
  function boot() {
    if (!chat()) return;   /* 스토어 없으면 전역도 만들지 않는다 */
    injectStyle();
    bindStore();
    window.EZChatSessions = {
      rowHtml: rowHtml,
      renderList: renderList,
      askRename: askRename,
      askDelete: askDelete,
      withSession: withSession,
      onChange: onChange,
      injectStyle: injectStyle
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
