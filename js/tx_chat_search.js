/* ============================================================
   tx_chat_search.js — 전 세션 대화 검색 (FAB 도킹창 전용)

   [기획 스펙]
   ① 배경/문제
      - elizax 대화는 세션(최대 20개)별로 쌓이는데, "지난번에 그
        얘기 어디서 했더라?"를 찾으려면 세션을 하나씩 열어봐야 한다.
      - 세션 제목은 첫 발화 24자 요약이라 본문 내용 검색이 안 된다.
   ② 사용자 시나리오
      - 사용자가 FAB 패널 헤더의 🔍 버튼을 누르면 패널 위에 검색
        오버레이가 뜬다. 검색어를 입력하는 즉시(150ms 디바운스)
        전 세션의 user/ai 메시지를 훑어 매치 목록이 갱신된다.
      - 결과 행(세션 제목 · 역할 아이콘 · 하이라이트 스니펫)을
        클릭하면 해당 세션으로 전환되고 오버레이가 닫히며
        "'<세션 제목>' 대화로 이동" 토스트가 뜬다.
   ③ 동작 정의
      - 주입 위치: .ezx-head-top 내 ⚙(AI 연결 설정) 버튼 왼쪽.
      - 검색 대상: EZChat.exportAll() 반환 전 세션의 role이
        user/ai인 메시지 text. 대소문자 무시(lowercase indexOf).
      - 스니펫: 첫 매치어 앞뒤 약 28자, 매치어는 <mark>로 강조.
        메시지당 1행, 전체 최대 40행(과다 시 안내 문구).
      - 닫힘: Esc 키, 오버레이 바깥(반투명 배경) 클릭, ✕ 버튼.
      - 허브(전체화면)에서는 미노출 — FAB 헤더 전용 기능.
   ④ 엣지 케이스
      - EZChat/TX 미존재 → 기능 전체를 조용히 비활성화.
      - .ezx-root가 늦게 생성됨 → 300ms 간격 최대 20회 폴링.
      - 검색어 비어 있음 → 안내 문구, 0건 → "일치하는 대화 없음".
      - 현재 세션이 결과로 클릭됨 → switchSession은 false를
        반환하지만 오버레이 닫기 + 토스트는 동일하게 수행.
      - nav/scn/err/work 등 텍스트 대화가 아닌 메시지는 검색 제외.
      - HTML 삽입 텍스트(제목·스니펫)는 전부 esc() 이스케이프.
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- 공통 유틸 ---------------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  var CTX_CHARS = 28;   /* 매치어 앞뒤로 남길 글자 수 */
  var MAX_ROWS = 40;    /* 결과 목록 상한 */

  /* ---------------- 스타일 주입 ---------------- */
  function injectStyle() {
    if (document.getElementById("ezcx-search-style")) return;
    var st = document.createElement("style");
    st.id = "ezcx-search-style";
    st.textContent =
      /* 오버레이: 패널 전체를 덮는 반투명 배경 + 상단 카드 */
      ".ezcx-search-ov{position:absolute;inset:0;z-index:60;display:none;" +
      "background:rgba(15,23,42,.28);backdrop-filter:blur(1px);" +
      "border-radius:inherit;overflow:hidden;}" +
      ".ezcx-search-ov.on{display:block;}" +
      ".ezcx-search-card{margin:10px 10px 0;background:var(--card,#fff);" +
      "border:1px solid var(--line,#E4E7EC);border-radius:12px;" +
      "box-shadow:0 12px 32px rgba(15,23,42,.18);display:flex;" +
      "flex-direction:column;max-height:calc(100% - 20px);}" +
      /* 입력행 */
      ".ezcx-search-inrow{display:flex;align-items:center;gap:8px;" +
      "padding:10px 12px;border-bottom:1px solid var(--line,#E4E7EC);}" +
      ".ezcx-search-ico{font-size:14px;line-height:1;flex:none;}" +
      ".ezcx-search-in{flex:1;min-width:0;border:0;outline:0;background:transparent;" +
      "font:inherit;font-size:13px;color:var(--ink,#1D2433);}" +
      ".ezcx-search-in::placeholder{color:var(--mut,#98A2B3);}" +
      ".ezcx-search-x{flex:none;border:0;background:transparent;cursor:pointer;" +
      "font-size:13px;line-height:1;padding:4px;border-radius:6px;" +
      "color:var(--mut,#667085);}" +
      ".ezcx-search-x:hover{background:var(--soft,#F8FAFC);color:var(--ink,#1D2433);}" +
      /* 결과 목록 */
      ".ezcx-search-list{overflow-y:auto;padding:6px;}" +
      ".ezcx-search-row{display:block;width:100%;text-align:left;border:0;" +
      "background:transparent;cursor:pointer;padding:8px 10px;border-radius:9px;" +
      "font:inherit;color:var(--ink,#1D2433);}" +
      ".ezcx-search-row:hover{background:var(--soft,#F8FAFC);}" +
      ".ezcx-search-sess{display:flex;align-items:center;gap:6px;font-size:11px;" +
      "color:var(--mut,#667085);margin-bottom:3px;}" +
      ".ezcx-search-sess b{color:var(--blue,#1F7AF0);font-weight:600;" +
      "max-width:70%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}" +
      ".ezcx-search-role{flex:none;font-style:normal;}" +
      ".ezcx-search-snip{font-size:12.5px;line-height:1.5;color:var(--ink,#1D2433);" +
      "word-break:break-word;}" +
      ".ezcx-search-snip mark{background:rgba(31,122,240,.16);" +
      "color:var(--blue,#1F7AF0);font-weight:600;padding:0 1px;border-radius:3px;}" +
      /* 빈 상태/안내 */
      ".ezcx-search-empty{padding:18px 12px;text-align:center;font-size:12px;" +
      "color:var(--mut,#98A2B3);}" +
      ".ezcx-search-more{padding:6px 10px 10px;text-align:center;font-size:11px;" +
      "color:var(--mut,#98A2B3);}" +
      /* 헤더 🔍 버튼 — 기존 .ezx-x 버튼 톤에 맞춤 */
      ".ezcx-search-btn{font-size:13px;}";
    document.head.appendChild(st);
  }

  /* ---------------- 검색 로직 ---------------- */
  /* 스니펫 생성: 매치 위치 앞뒤 CTX_CHARS자 + <mark> 하이라이트 */
  function buildSnippet(text, q) {
    var flat = String(text).replace(/\s+/g, " ");
    var low = flat.toLowerCase();
    var idx = low.indexOf(q);
    if (idx < 0) return null;
    var start = idx - CTX_CHARS; if (start < 0) start = 0;
    var end = idx + q.length + CTX_CHARS; if (end > flat.length) end = flat.length;
    var frag = flat.slice(start, end);
    var fragLow = low.slice(start, end);
    /* 스니펫 내 모든 매치어를 <mark>로 감싸며 이스케이프 조립 */
    var html = "";
    var pos = 0;
    while (pos < frag.length) {
      var hit = fragLow.indexOf(q, pos);
      if (hit < 0) { html += esc(frag.slice(pos)); break; }
      html += esc(frag.slice(pos, hit));
      html += "<mark>" + esc(frag.slice(hit, hit + q.length)) + "</mark>";
      pos = hit + q.length;
    }
    if (start > 0) html = "…" + html;
    if (end < flat.length) html += "…";
    return html;
  }

  /* 전 세션 검색 → [{sid, title, role, snippetHtml}] */
  function search(qRaw) {
    var q = String(qRaw || "").trim().toLowerCase();
    if (!q || !window.EZChat || !window.EZChat.exportAll) return { q: q, rows: [], over: false };
    var rows = [];
    var over = false;
    var sessions = [];
    try { sessions = window.EZChat.exportAll() || []; } catch (e) { sessions = []; }
    for (var i = 0; i < sessions.length; i++) {
      var s = sessions[i];
      if (!s) continue;
      var msgs = s.messages || [];
      for (var j = 0; j < msgs.length; j++) {
        var m = msgs[j];
        if (!m || (m.role !== "user" && m.role !== "ai") || !m.text) continue;
        if (String(m.text).toLowerCase().indexOf(q) < 0) continue;
        if (rows.length >= MAX_ROWS) { over = true; break; }
        var snip = buildSnippet(m.text, q);
        if (!snip) continue;
        rows.push({
          sid: s.id,
          title: s.title || "새 대화",
          role: m.role,
          snippetHtml: snip
        });
      }
      if (over) break;
    }
    return { q: q, rows: rows, over: over };
  }

  /* ---------------- 오버레이 UI ---------------- */
  var ov = null;        /* 오버레이 루트 */
  var inEl = null;      /* 검색 입력 */
  var listEl = null;    /* 결과 목록 */
  var debTimer = null;  /* 디바운스 타이머 */

  function ensureOverlay(panel) {
    if (ov && ov.parentNode) return ov;
    /* 패널이 static이면 absolute 자식이 어긋나므로 방어적으로 보정 */
    try {
      var cs = window.getComputedStyle(panel);
      if (cs && cs.position === "static") panel.style.position = "relative";
    } catch (e) { /* ignore */ }

    ov = document.createElement("div");
    ov.className = "ezcx-search-ov";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-label", "지난 대화 검색");

    var card = document.createElement("div");
    card.className = "ezcx-search-card";

    var row = document.createElement("div");
    row.className = "ezcx-search-inrow";
    var ico = document.createElement("span");
    ico.className = "ezcx-search-ico";
    ico.textContent = "🔍";
    inEl = document.createElement("input");
    inEl.className = "ezcx-search-in";
    inEl.type = "text";
    inEl.placeholder = "지난 대화 검색";
    inEl.setAttribute("aria-label", "지난 대화 검색어 입력");
    var xbtn = document.createElement("button");
    xbtn.className = "ezcx-search-x";
    xbtn.setAttribute("aria-label", "검색 닫기");
    xbtn.textContent = "✕";
    row.appendChild(ico); row.appendChild(inEl); row.appendChild(xbtn);

    listEl = document.createElement("div");
    listEl.className = "ezcx-search-list";

    card.appendChild(row);
    card.appendChild(listEl);
    ov.appendChild(card);
    panel.appendChild(ov);

    /* 입력: 150ms 디바운스 실시간 검색 */
    inEl.addEventListener("input", function () {
      if (debTimer) clearTimeout(debTimer);
      debTimer = setTimeout(function () { render(inEl.value); }, 150);
    });
    /* Esc로 닫기 (입력창 포커스 중) */
    inEl.addEventListener("keydown", function (e) {
      if (e.key === "Escape" || e.keyCode === 27) { e.stopPropagation(); closeOverlay(); }
    });
    /* 바깥(반투명 배경) 클릭으로 닫기 — 카드 내부 클릭은 유지 */
    ov.addEventListener("mousedown", function (e) {
      if (e.target === ov) closeOverlay();
    });
    xbtn.addEventListener("click", closeOverlay);

    /* 결과 클릭: 이벤트 위임 (재렌더에도 안전) */
    listEl.addEventListener("click", function (e) {
      var t = e.target;
      while (t && t !== listEl && !(t.className && String(t.className).indexOf("ezcx-search-row") >= 0)) {
        t = t.parentNode;
      }
      if (!t || t === listEl) return;
      var sid = t.getAttribute("data-sid");
      var title = t.getAttribute("data-title") || "새 대화";
      if (sid && window.EZChat && window.EZChat.switchSession) {
        try { window.EZChat.switchSession(sid); } catch (err) { /* 이미 현재 세션이어도 계속 */ }
      }
      closeOverlay();
      if (window.TX && window.TX.toast) window.TX.toast("'" + title + "' 대화로 이동", "ok");
    });

    return ov;
  }

  /* Esc 전역 처리 (입력창 밖에 포커스가 있어도 닫히도록) */
  function onDocKey(e) {
    if ((e.key === "Escape" || e.keyCode === 27) && ov && ov.classList.contains("on")) {
      closeOverlay();
    }
  }

  function render(qRaw) {
    if (!listEl) return;
    var r = search(qRaw);
    if (!r.q) {
      listEl.innerHTML = '<div class="ezcx-search-empty">지난 대화 내용을 검색합니다</div>';
      return;
    }
    if (!r.rows.length) {
      listEl.innerHTML = '<div class="ezcx-search-empty">일치하는 대화 없음</div>';
      return;
    }
    var html = "";
    for (var i = 0; i < r.rows.length; i++) {
      var row = r.rows[i];
      html +=
        '<button type="button" class="ezcx-search-row" data-sid="' + esc(row.sid) + '"' +
        ' data-title="' + esc(row.title) + '">' +
        '<span class="ezcx-search-sess">' +
        "<b>" + esc(row.title) + "</b>" +
        '<i class="ezcx-search-role">' + (row.role === "user" ? "👤" : "✦") + "</i>" +
        "</span>" +
        '<span class="ezcx-search-snip">' + row.snippetHtml + "</span>" +
        "</button>";
    }
    if (r.over) {
      html += '<div class="ezcx-search-more">결과가 많아 상위 ' + MAX_ROWS + "건만 표시합니다</div>";
    }
    listEl.innerHTML = html;
  }

  function openOverlay(panel) {
    ensureOverlay(panel);
    ov.classList.add("on");
    inEl.value = "";
    render("");
    document.addEventListener("keydown", onDocKey);
    /* 렌더 직후 포커스 */
    setTimeout(function () { try { inEl.focus(); } catch (e) { /* ignore */ } }, 0);
  }

  function closeOverlay() {
    if (debTimer) { clearTimeout(debTimer); debTimer = null; }
    if (ov) ov.classList.remove("on");
    document.removeEventListener("keydown", onDocKey);
  }

  /* ---------------- 헤더 버튼 주입 ---------------- */
  function findGear(top) {
    /* ⚙(AI 연결 설정) 버튼 탐색 — 텍스트 또는 aria-label 기준 */
    var btns = top.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var label = b.getAttribute("aria-label") || "";
      if (b.textContent === "⚙" || label.indexOf("AI 연결") >= 0) return b;
    }
    return null;
  }

  function mount() {
    var root = document.querySelector(".ezx-root");
    if (!root) return false;
    var top = root.querySelector(".ezx-head-top");
    var panel = root.querySelector(".ezx-panel");
    if (!top || !panel) return false;
    if (top.querySelector(".ezcx-search-btn")) return true; /* 중복 주입 방지 */

    injectStyle();

    var btn = document.createElement("button");
    btn.className = "ezx-x ezcx-search-btn";
    btn.setAttribute("aria-label", "지난 대화 검색");
    btn.setAttribute("title", "지난 대화 검색");
    btn.textContent = "🔍";
    btn.addEventListener("click", function () {
      if (!window.EZChat) return;
      if (ov && ov.classList.contains("on")) { closeOverlay(); return; }
      openOverlay(panel);
    });

    var gear = findGear(top);
    if (gear) top.insertBefore(btn, gear);      /* ⚙ 왼쪽 */
    else top.appendChild(btn);                  /* 폴백: 맨 뒤 */
    return true;
  }

  /* ---------------- 부트스트랩 ---------------- */
  function boot() {
    if (!window.EZChat) return; /* 스토어 없으면 기능 자체를 생략 */
    var tries = 0;
    (function poll() {
      if (mount()) return;
      tries++;
      if (tries < 20) setTimeout(poll, 300); /* FAB는 DOMContentLoaded 이후 생성 */
    })();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
