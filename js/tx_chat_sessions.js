/* ============================================================
   tx_chat_sessions.js — 세션(대화) 관리 UI (EZChat 세션 스토어의 얼굴)

   ── 기획 스펙 ──────────────────────────────────────────────
   ① 배경/문제
      EZChat(tx_chatstore)은 계정별 다중 세션을 이미 저장하지만,
      화면에는 "현재 세션" 하나만 보인다. 지난 대화로 돌아가거나
      새 주제를 분리해 시작할 UI가 없어 세션 기능이 사장된 상태.
   ② 사용자 시나리오
      - FAB 도킹창: 헤더의 ≡(대화 목록) 버튼 → 패널 상단 드롭다운에
        세션 목록. 행 클릭=해당 세션으로 전환, ✎=이름 변경, 🗑=삭제,
        상단 "＋ 새 대화"=빈 세션 생성. 바깥 클릭 시 닫힘.
      - 전체화면 허브: 좌측 내비 하단에 "세션" 그룹(최근 5개).
        클릭하면 세션 전환 후 chat 화면 유지 — 딥워크 중 대화 갈아타기.
   ③ 동작 정의
      - 목록 데이터는 EZChat.sessions() 단일 소스. 현재 세션 하이라이트,
        각 행에 제목·시각·메시지 수 표기.
      - 전환/변경/삭제는 전부 EZChat API 위임(switchSession·renameSession·
        deleteSession·newSession). 렌더 갱신은 "sessions"/"switch" 이벤트 구독.
      - 허브 내비는 renderNav()가 innerHTML을 통째로 갈아끼우므로
        .agh-nav에 MutationObserver를 걸어 재생성 감지 후 재주입.
        (주입 자체도 mutation을 일으키지만 "이미 있으면 no-op" 가드로 루프 차단)
      - 이름 변경/삭제 확인은 TX.modal 우선, 부재 시 prompt/confirm 폴백.
   ④ 엣지 케이스
      - .ezx-root / .agh-root 는 늦게 생성 → FAB는 폴링(300ms×20),
        허브는 body childList 감시로 등장 시점 포착.
      - EZChat 부재(스크립트 로드 실패) 시 아무것도 하지 않음.
      - 삭제로 현재 세션이 사라지면 EZChat이 switch 이벤트를 쏘고
        기존 대화창(tx_elizax)이 스스로 재렌더 — 여기선 목록만 갱신.
      - 세션 1개(현재뿐)여도 삭제 허용: 스토어가 빈 새 세션을 보장.
      - 다른 탭에서의 변경도 storage→"sessions" 이벤트로 목록에 반영.
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- helpers ---------------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function h(tag, cls, attrs) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) for (var k in attrs) { if (k === "text") n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]); }
    return n;
  }
  function chat() { return window.EZChat || null; }

  /* ---------------- 스타일 주입 ---------------- */
  function injectStyle() {
    if (document.getElementById("ezcs-style")) return;
    var st = document.createElement("style");
    st.id = "ezcs-style";
    st.textContent =
      /* 헤더 세션 버튼 — 기존 .ezx-x 룩앤필을 따르되 접두사로 구분 */
      ".ezcs-hbtn{font-size:15px;line-height:1;}" +

      /* 드롭다운 — 패널(.ezx-panel, position:fixed) 기준 절대배치 */
      ".ezcs-drop{position:absolute;top:52px;left:10px;right:10px;z-index:40;" +
      "background:var(--card,#fff);border:1px solid var(--line,#E4E7EC);border-radius:12px;" +
      "box-shadow:0 12px 32px rgba(16,24,40,.16);overflow:hidden;display:none;" +
      "max-height:min(46vh,340px);flex-direction:column;}" +
      ".ezcs-drop.on{display:flex;}" +
      ".ezcs-drop-h{flex:none;display:flex;align-items:center;justify-content:space-between;" +
      "padding:8px 10px;border-bottom:1px solid var(--line,#E4E7EC);background:var(--soft,#F8FAFC);}" +
      ".ezcs-drop-h b{font-size:12px;color:var(--ink,#1D2433);letter-spacing:-.01em;}" +
      ".ezcs-new{border:1px solid var(--blue,#1F7AF0);background:transparent;color:var(--blue,#1F7AF0);" +
      "border-radius:8px;padding:4px 10px;font:inherit;font-size:12px;font-weight:700;cursor:pointer;}" +
      ".ezcs-new:hover{background:var(--blue,#1F7AF0);color:#fff;}" +
      ".ezcs-drop-list{flex:1;overflow-y:auto;padding:4px;}" +

      /* 세션 행 */
      ".ezcs-row{display:flex;align-items:center;gap:8px;width:100%;padding:7px 8px;border-radius:8px;" +
      "cursor:pointer;border:1px solid transparent;}" +
      ".ezcs-row:hover{background:var(--soft,#F8FAFC);}" +
      ".ezcs-row.on{background:color-mix(in srgb, var(--blue,#1F7AF0) 9%, transparent);" +
      "border-color:color-mix(in srgb, var(--blue,#1F7AF0) 32%, transparent);}" +
      ".ezcs-row .ezcs-tt{flex:1;min-width:0;}" +
      ".ezcs-row .ezcs-t1{font-size:12.5px;font-weight:600;color:var(--ink,#1D2433);" +
      "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
      ".ezcs-row.on .ezcs-t1{color:var(--blue,#1F7AF0);}" +
      ".ezcs-row .ezcs-t2{font-size:11px;color:#98A2B3;margin-top:1px;}" +
      ".ezcs-act{flex:none;border:0;background:transparent;border-radius:6px;padding:3px 5px;" +
      "font-size:12px;line-height:1;color:#98A2B3;cursor:pointer;visibility:hidden;}" +
      ".ezcs-row:hover .ezcs-act{visibility:visible;}" +
      ".ezcs-act:hover{background:var(--line,#E4E7EC);color:var(--ink,#1D2433);}" +
      ".ezcs-empty{padding:14px 10px;font-size:12px;color:#98A2B3;text-align:center;}" +

      /* 허브 내비 세션 그룹 — .agh-nitem 룩을 상속하고 폭만 관리 */
      ".ezcs-navsec .agh-nitem{display:flex;align-items:center;gap:6px;width:100%;text-align:left;}" +
      ".ezcs-navsec .ezcs-nt{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
      ".ezcs-navsec .ezcs-nc{flex:none;font-size:10px;color:#98A2B3;font-weight:400;}";
    document.head.appendChild(st);
  }

  /* ---------------- 이름 변경 / 삭제 (TX.modal 우선, 폴백 내장) ---------------- */
  function askRename(sess) {
    var ez = chat();
    if (!ez) return;
    if (window.TX && TX.modal) {
      TX.modal({
        title: "대화 이름 변경",
        body: '<input type="text" data-ezcs-name value="' + esc(sess.title) + '" maxlength="60" ' +
          'style="width:100%;border:1px solid #D0D5DD;border-radius:8px;padding:9px;font:inherit;font-size:13px">',
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
    if (!ez) return;
    function doDel() {
      ez.deleteSession(sess.id);
      if (window.TX && TX.toast) TX.toast("대화를 삭제했습니다", "ok");
    }
    if (window.TX && TX.modal) {
      TX.modal({
        title: "대화 삭제",
        body: '<p style="font-size:13px;color:#475467;margin:0">"' + esc(sess.title) +
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

  /* ============================================================
     A. FAB 패널 — 헤더 ≡ 버튼 + 드롭다운 목록
     ============================================================ */
  var fab = { btn: null, drop: null };

  function rowHtml(s) {
    return '<div class="ezcs-row' + (s.current ? " on" : "") + '" data-ezcs-row="' + esc(s.id) + '" ' +
      'role="button" tabindex="0" title="' + esc(s.title) + '">' +
      '<span class="ezcs-tt"><span class="ezcs-t1">' + esc(s.title) + "</span>" +
      '<span class="ezcs-t2">' + esc(s.at || "") + " · 메시지 " + esc(s.count) + "건</span></span>" +
      '<button class="ezcs-act" data-ezcs-ren="' + esc(s.id) + '" title="이름 변경" aria-label="이름 변경">✎</button>' +
      '<button class="ezcs-act" data-ezcs-del="' + esc(s.id) + '" title="삭제" aria-label="삭제">🗑</button>' +
      "</div>";
  }
  function renderDrop() {
    if (!fab.drop || !chat()) return;
    var list = fab.drop.querySelector("[data-ezcs-list]");
    if (!list) return;
    var ss = chat().sessions();
    var html = "";
    for (var i = 0; i < ss.length; i++) html += rowHtml(ss[i]);
    list.innerHTML = html || '<div class="ezcs-empty">저장된 대화가 없습니다</div>';
  }
  function openDrop() { if (fab.drop) { renderDrop(); fab.drop.classList.add("on"); } }
  function closeDrop() { if (fab.drop) fab.drop.classList.remove("on"); }
  function dropOpen() { return !!(fab.drop && fab.drop.classList.contains("on")); }

  function buildFabUI(root) {
    var top = root.querySelector(".ezx-head-top");
    var panel = root.querySelector(".ezx-panel");
    if (!top || !panel || top.querySelector("[data-ezcs-toggle]")) return;

    /* ≡ 버튼 — 닫기(✕, 헤더행 마지막 버튼) 바로 왼쪽에 주입 */
    var btn = h("button", "ezx-x ezcs-hbtn", { "aria-label": "대화 목록", title: "대화 목록", text: "≡", "data-ezcs-toggle": "1" });
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (dropOpen()) closeDrop(); else openDrop();
    });
    var closeBtn = top.lastElementChild; /* build() 순서상 마지막 = ✕ */
    if (closeBtn) top.insertBefore(btn, closeBtn); else top.appendChild(btn);
    fab.btn = btn;

    /* 드롭다운 본체 */
    var drop = h("div", "ezcs-drop", { role: "menu", "aria-label": "대화 목록" });
    drop.innerHTML =
      '<div class="ezcs-drop-h"><b>대화 목록</b>' +
      '<button class="ezcs-new" data-ezcs-new>＋ 새 대화</button></div>' +
      '<div class="ezcs-drop-list" data-ezcs-list></div>';
    panel.appendChild(drop);
    fab.drop = drop;

    /* 드롭다운 내부 위임 — 행 클릭=전환 / ✎=이름변경 / 🗑=삭제 / ＋=새 대화 */
    drop.addEventListener("click", function (e) {
      var ez = chat();
      if (!ez) return;
      e.stopPropagation();
      var t = e.target;
      if (t.closest("[data-ezcs-new]")) { ez.newSession(); closeDrop(); return; }
      var ren = t.closest("[data-ezcs-ren]");
      if (ren) { withSession(ren.getAttribute("data-ezcs-ren"), askRename); return; }
      var del = t.closest("[data-ezcs-del]");
      if (del) { withSession(del.getAttribute("data-ezcs-del"), askDelete); return; }
      var row = t.closest("[data-ezcs-row]");
      if (row) { ez.switchSession(row.getAttribute("data-ezcs-row")); closeDrop(); }
    });
    /* 키보드 접근성 — 행에서 Enter로 전환 */
    drop.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var row = e.target.closest && e.target.closest("[data-ezcs-row]");
      if (row && chat()) { chat().switchSession(row.getAttribute("data-ezcs-row")); closeDrop(); }
    });
  }
  /* id → 목록 스냅샷에서 세션 요약 찾아 콜백 */
  function withSession(id, fn) {
    var ez = chat();
    if (!ez) return;
    var ss = ez.sessions();
    for (var i = 0; i < ss.length; i++) if (ss[i].id === id) { fn(ss[i]); return; }
  }

  /* 바깥 클릭 시 드롭다운 닫힘 (버튼·드롭다운 내부는 stopPropagation으로 제외) */
  document.addEventListener("click", function () { if (dropOpen()) closeDrop(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && dropOpen()) closeDrop(); });

  /* ============================================================
     B. 전체화면 허브 내비 — "세션" 그룹 주입 (최근 5개)
     ============================================================ */
  var NAV_MAX = 5;
  var navObserved = null;   /* 관찰 중인 .agh-nav 요소 */

  function navSecHtml() {
    var ez = chat();
    if (!ez) return "";
    var ss = ez.sessions().slice(0, NAV_MAX);
    var html = '<div class="agh-ngroup">지난 대화</div>';
    for (var i = 0; i < ss.length; i++) {
      var s = ss[i];
      html += '<button class="agh-nitem' + (s.current ? " on" : "") + '" data-ezcs-sid="' + esc(s.id) + '" title="' + esc(s.title) + '">' +
        '<span class="ezcs-nt">' + esc(s.title) + "</span>" +
        '<span class="ezcs-nc">' + esc(s.count) + "</span></button>";
    }
    return html;
  }
  function injectNavSec() {
    var nav = document.querySelector(".agh-nav");
    if (!nav || !chat()) return;
    var sec = nav.querySelector(".ezcs-navsec");
    if (!sec) {
      sec = h("div", "ezcs-navsec");
      nav.appendChild(sec);   /* 내비 하단 */
    }
    sec.innerHTML = navSecHtml();
  }
  /* renderNav()가 innerHTML을 통째로 갈아끼우면 섹션이 사라진다 → 재주입.
     주입도 mutation을 만들지만 "섹션 존재 시 갱신만" 하므로 무한 루프 없음. */
  function observeNav(nav) {
    if (navObserved === nav) return;
    navObserved = nav;
    try {
      new MutationObserver(function () {
        if (!nav.querySelector(".ezcs-navsec")) injectNavSec();
      }).observe(nav, { childList: true });
    } catch (e) { /* MutationObserver 미지원 환경 무시 */ }
    injectNavSec();
  }
  /* 허브(.agh-root)는 첫 openHub 시점에야 body에 생긴다 → body childList 감시 */
  function watchHub() {
    var nav = document.querySelector(".agh-nav");
    if (nav) { observeNav(nav); return; }
    try {
      var bodyObs = new MutationObserver(function () {
        var n = document.querySelector(".agh-nav");
        if (n) { observeNav(n); bodyObs.disconnect(); }
      });
      bodyObs.observe(document.body, { childList: true });
    } catch (e) { /* ignore */ }
  }
  /* 내비 세션 클릭 — 전환 후 chat 화면 유지 (허브 root 위임과 충돌 없는 자체 속성) */
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-ezcs-sid]");
    if (!b || !chat()) return;
    chat().switchSession(b.getAttribute("data-ezcs-sid"));
    /* 전환 후에도 대화 화면에 머문다 — TXAgent.open = showScreen */
    if (window.TXAgent && TXAgent.open) { try { TXAgent.open("chat"); } catch (e2) { /* ignore */ } }
  });

  /* ============================================================
     부트스트랩 — 스토어 이벤트 구독 + 늦게 생기는 DOM 폴링
     ============================================================ */
  function bindStore() {
    var ez = chat();
    if (!ez) return;
    function refresh() {
      if (dropOpen()) renderDrop();
      injectNavSec();   /* 내비 섹션이 있으면 하이라이트·목록 갱신 */
    }
    ez.on("sessions", refresh);
    ez.on("switch", refresh);
    /* 메시지 수·자동 제목 변경도 목록에 반영 (열려 있을 때만 비용 발생) */
    ez.on("messages", function () { if (dropOpen()) renderDrop(); });
  }

  function boot() {
    if (!chat()) return;   /* 스토어 없으면 전체 기능 비활성 */
    injectStyle();
    bindStore();
    watchHub();
    /* FAB(.ezx-root)는 DOMContentLoaded 이후 생성 → 폴링(300ms×20) */
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      var root = document.querySelector(".ezx-root");
      if (root) { clearInterval(t); buildFabUI(root); return; }
      if (tries >= 20) clearInterval(t);
    }, 300);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
