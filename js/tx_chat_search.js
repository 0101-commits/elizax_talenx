/* ============================================================
   tx_chat_search.js — 🔍 대화 찾기 (지난 대화 단일 진입점)

   [기획 스펙 · 18차 §7]
   ① 배경/문제
      - 「≡ 대화 목록」·「기록 탭」·「허브 지난 대화」·「🔍 검색」 네 표면이
        모두 같은 저장소(EZChat = "elizax_chat_v2:<emp>") 위의 껍데기였다.
        사용자가 "모두 겹치는 기능 같다"고 지적한 바로 그 중복.
      - 세션 제목은 첫 발화 24자 요약이라 본문 내용 검색도 필요하다.
   ② 사용자 시나리오
      - FAB 패널 헤더 🔍 → 패널 위 오버레이 하나로 지난 대화 전부를 다룬다.
        위에서 아래로 ①＋ 새 대화 ②대화 목록(행 클릭=전환 · ✎ 이름 변경 ·
        🗑 삭제) ③검색 입력 ④세션별로 묶인 검색 결과.
      - 결과 행을 클릭하면 그 세션으로 전환되고 오버레이가 닫히며
        "'<세션 제목>' 대화로 이동" 토스트가 뜬다.
   ③ 동작 정의
      - 주입 위치: .ezx-head-top 의 ⛶(전체화면)·✕(닫기) 왼쪽.
        ⚙(AI 연결 설정)은 18차에서 삭제되므로 앵커로 쓰지 않는다.
      - 세션 목록/행/이름 변경/삭제는 window.EZChatSessions 재사용
        (tx_chat_sessions.js 가 로직만 남기고 공개한 이음새).
      - 검색 대상: EZChat.exportAll() 반환 전 세션의 role이 user/ai인
        메시지 text. 대소문자 무시(lowercase indexOf). 150ms 디바운스.
      - 스니펫: 첫 매치어 앞뒤 약 28자, 매치어는 <mark>로 강조.
        메시지당 1행, 전체 최대 40행(과다 시 안내 문구).
      - 검색어가 있으면 목록을 접어 결과에 집중, 비우면 다시 펼친다.
      - 닫힘: Esc 키, 오버레이 바깥(반투명 배경) 클릭, ✕ 버튼.
      - 허브(전체화면)에서는 미노출 — FAB 헤더 전용 기능.
   ④ 엣지 케이스
      - EZChat 미존재 → 기능 전체를 조용히 비활성화.
      - EZChatSessions 미존재(로드 실패) → 목록 영역만 안내 문구로 대체,
        검색은 계속 동작.
      - .ezx-root가 늦게 생성됨 → 300ms 간격 최대 20회 폴링.
      - 패널이 재생성되면 이전 오버레이는 버리고 새 패널에 다시 만든다.
      - 검색어 비어 있음 → 안내 문구, 0건 → "일치하는 대화 없음".
      - 현재 세션이 결과로 클릭됨 → switchSession은 false를 반환하지만
        오버레이 닫기 + 토스트는 동일하게 수행.
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
  function sessAPI() { return window.EZChatSessions || null; }

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
      "background:var(--color-overlay);backdrop-filter:blur(1px);" +
      "border-radius:inherit;overflow:hidden;}" +
      ".ezcx-search-ov.on{display:block;}" +
      ".ezcx-search-card{margin:10px 10px 0;background:var(--color-background-card);" +
      "border:1px solid var(--color-border);border-radius:var(--radius-container);" +
      "box-shadow:var(--shadow-high, 0 12px 32px rgba(15,23,42,.18));display:flex;" +
      "flex-direction:column;max-height:calc(100% - 20px);overflow:hidden;}" +
      /* 카드 머리 — 제목 · ＋ 새 대화 · 닫기 */
      ".ezcx-search-hd{flex:none;display:flex;align-items:center;gap:8px;" +
      "padding:9px 10px 9px 12px;border-bottom:1px solid var(--color-border);" +
      "background:var(--color-background-muted);}" +
      ".ezcx-search-hd b{flex:1;min-width:0;font-size:12.5px;color:var(--color-text-primary);letter-spacing:-.01em;}" +
      /* 세션 목록 */
      ".ezcx-sess-wrap{flex:none;display:flex;flex-direction:column;min-height:0;" +
      "border-bottom:1px solid var(--color-border);}" +
      ".ezcx-sub{flex:none;padding:8px 12px 2px;font-size:11px;font-weight:600;" +
      "color:var(--color-text-disabled);letter-spacing:.01em;}" +
      ".ezcx-sess-list{overflow-y:auto;max-height:min(30vh,240px);padding:4px 6px 6px;}" +
      /* 입력행 */
      ".ezcx-search-inrow{flex:none;display:flex;align-items:center;gap:8px;" +
      "padding:10px 12px;border-bottom:1px solid var(--color-border);}" +
      ".ezcx-search-ico{font-size:14px;line-height:1;flex:none;}" +
      ".ezcx-search-in{flex:1;min-width:0;border:0;outline:0;background:transparent;" +
      "font:inherit;font-size:13px;color:var(--color-text-primary);}" +
      ".ezcx-search-in::placeholder{color:var(--color-text-disabled);}" +
      ".ezcx-search-x{flex:none;border:0;background:transparent;cursor:pointer;" +
      "font-size:13px;line-height:1;padding:4px;border-radius:var(--radius-inner);" +
      "color:var(--color-text-secondary);}" +
      ".ezcx-search-x:hover{background:var(--color-background-muted);color:var(--color-text-primary);}" +
      /* 결과 목록 */
      ".ezcx-search-list{flex:1;min-height:0;overflow-y:auto;padding:6px;}" +
      ".ezcx-grp{margin-bottom:4px;}" +
      ".ezcx-grp-h{display:flex;align-items:center;gap:6px;padding:5px 10px 3px;font-size:11px;" +
      "color:var(--color-text-secondary);}" +
      ".ezcx-grp-h b{color:var(--color-accent);font-weight:600;max-width:70%;" +
      "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}" +
      ".ezcx-search-row{display:block;width:100%;text-align:left;border:0;" +
      "background:transparent;cursor:pointer;padding:7px 10px;border-radius:var(--radius-element);" +
      "font:inherit;color:var(--color-text-primary);}" +
      ".ezcx-search-row:hover{background:var(--color-background-muted);}" +
      ".ezcx-search-role{flex:none;font-style:normal;margin-right:5px;}" +
      ".ezcx-search-snip{font-size:12.5px;line-height:1.5;color:var(--color-text-primary);" +
      "word-break:break-word;}" +
      ".ezcx-search-snip mark{background:var(--color-accent-muted);" +
      "color:var(--color-accent);font-weight:600;padding:0 1px;border-radius:var(--radius-inner);}" +
      /* 검색어 입력 중에는 목록을 접어 결과에 집중 */
      ".ezcx-search-card.ezcx-q .ezcx-sess-wrap{display:none;}" +
      /* 빈 상태/안내 */
      ".ezcx-search-empty{padding:18px 12px;text-align:center;font-size:12px;" +
      "color:var(--color-text-disabled);}" +
      ".ezcx-search-more{padding:6px 10px 10px;text-align:center;font-size:11px;" +
      "color:var(--color-text-disabled);}" +
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

  /* 전 세션 검색 → 세션별 묶음 [{sid, title, rows:[{role, snippetHtml}]}] */
  function search(qRaw) {
    var q = String(qRaw || "").trim().toLowerCase();
    if (!q || !window.EZChat || !window.EZChat.exportAll) return { q: q, groups: [], over: false, total: 0 };
    var groups = [];
    var total = 0;
    var over = false;
    var sessions = [];
    try { sessions = window.EZChat.exportAll() || []; } catch (e) { sessions = []; }
    for (var i = 0; i < sessions.length; i++) {
      var s = sessions[i];
      if (!s) continue;
      var msgs = s.messages || [];
      var rows = [];
      for (var j = 0; j < msgs.length; j++) {
        var m = msgs[j];
        if (!m || (m.role !== "user" && m.role !== "ai") || !m.text) continue;
        if (String(m.text).toLowerCase().indexOf(q) < 0) continue;
        if (total >= MAX_ROWS) { over = true; break; }
        var snip = buildSnippet(m.text, q);
        if (!snip) continue;
        rows.push({ role: m.role, snippetHtml: snip });
        total++;
      }
      if (rows.length) groups.push({ sid: s.id, title: s.title || "새 대화", rows: rows });
      if (over) break;
    }
    return { q: q, groups: groups, over: over, total: total };
  }

  /* ---------------- 오버레이 UI ---------------- */
  var ov = null;        /* 오버레이 루트 */
  var card = null;      /* 카드 (검색어 상태 클래스 보유) */
  var inEl = null;      /* 검색 입력 */
  var listEl = null;    /* 결과 목록 */
  var sessEl = null;    /* 세션 목록 */
  var debTimer = null;  /* 디바운스 타이머 */

  function ovOpen() { return !!(ov && ov.classList.contains("on")); }

  function el(tag, cls) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  function ensureOverlay(panel) {
    /* 같은 패널에 이미 붙어 있으면 재사용. 패널이 바뀌었으면 버리고 새로 만든다. */
    if (ov && ov.parentNode === panel) return ov;
    if (ov && ov.parentNode) { try { ov.parentNode.removeChild(ov); } catch (e) { /* ignore */ } }
    ov = null; card = null; inEl = null; listEl = null; sessEl = null;

    /* 패널이 static이면 absolute 자식이 어긋나므로 방어적으로 보정 */
    try {
      var cs = window.getComputedStyle(panel);
      if (cs && cs.position === "static") panel.style.position = "relative";
    } catch (e2) { /* ignore */ }

    ov = el("div", "ezcx-search-ov");
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-label", "대화 찾기");

    card = el("div", "ezcx-search-card");

    /* ① 머리 — 제목 · ＋ 새 대화 · 닫기 */
    var hd = el("div", "ezcx-search-hd");
    var tt = document.createElement("b");
    tt.textContent = "대화 찾기";
    var newBtn = el("button", "ezcs-new");
    newBtn.type = "button";
    newBtn.textContent = "＋ 새 대화";
    newBtn.setAttribute("aria-label", "새 대화 시작");
    var xbtn = el("button", "ezcx-search-x");
    xbtn.type = "button";
    xbtn.setAttribute("aria-label", "닫기");
    xbtn.textContent = "✕";
    hd.appendChild(tt); hd.appendChild(newBtn); hd.appendChild(xbtn);

    /* ② 세션 목록 */
    var swrap = el("div", "ezcx-sess-wrap");
    var sub = el("div", "ezcx-sub");
    sub.textContent = "대화 목록";
    sessEl = el("div", "ezcx-sess-list");
    swrap.appendChild(sub); swrap.appendChild(sessEl);

    /* ③ 검색 입력 */
    var row = el("div", "ezcx-search-inrow");
    var ico = el("span", "ezcx-search-ico");
    ico.textContent = "🔍";
    inEl = el("input", "ezcx-search-in");
    inEl.type = "text";
    inEl.placeholder = "지난 대화 내용 검색";
    inEl.setAttribute("aria-label", "지난 대화 검색어 입력");
    row.appendChild(ico); row.appendChild(inEl);

    /* ④ 결과 */
    listEl = el("div", "ezcx-search-list");

    card.appendChild(hd);
    card.appendChild(swrap);
    card.appendChild(row);
    card.appendChild(listEl);
    ov.appendChild(card);
    panel.appendChild(ov);

    /* ＋ 새 대화 — 다른 진입점과 동일하게 EZChat.newSession() 위임 */
    newBtn.addEventListener("click", function () {
      if (!window.EZChat || !window.EZChat.newSession) return;
      try { window.EZChat.newSession(); } catch (e3) { /* ignore */ }
      closeOverlay();
      if (window.TX && window.TX.toast) window.TX.toast("새 대화를 시작했습니다", "ok");
    });

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

    /* 세션 목록 클릭 위임 — 행=전환 / ✎=이름 변경 / 🗑=삭제 */
    sessEl.addEventListener("click", function (e) {
      var api = sessAPI();
      var t = e.target;
      var ren = t.closest && t.closest("[data-ezcs-ren]");
      if (ren) { if (api) api.withSession(ren.getAttribute("data-ezcs-ren"), api.askRename); return; }
      var del = t.closest && t.closest("[data-ezcs-del]");
      if (del) { if (api) api.withSession(del.getAttribute("data-ezcs-del"), api.askDelete); return; }
      var r = t.closest && t.closest("[data-ezcs-row]");
      if (!r) return;
      switchTo(r.getAttribute("data-ezcs-row"), r.getAttribute("title") || "새 대화");
    });
    /* 키보드 접근성 — 행에서 Enter로 전환 */
    sessEl.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var r = e.target.closest && e.target.closest("[data-ezcs-row]");
      if (r) switchTo(r.getAttribute("data-ezcs-row"), r.getAttribute("title") || "새 대화");
    });

    /* 결과 클릭: 이벤트 위임 (재렌더에도 안전) */
    listEl.addEventListener("click", function (e) {
      var t = e.target;
      var b = t.closest && t.closest(".ezcx-search-row");
      if (!b) return;
      switchTo(b.getAttribute("data-sid"), b.getAttribute("data-title") || "새 대화");
    });

    return ov;
  }

  /* 세션 전환 + 오버레이 닫기 + 확인 토스트 (목록·결과 공통) */
  function switchTo(sid, title) {
    if (sid && window.EZChat && window.EZChat.switchSession) {
      try { window.EZChat.switchSession(sid); } catch (err) { /* 이미 현재 세션이어도 계속 */ }
    }
    closeOverlay();
    if (window.TX && window.TX.toast) window.TX.toast("'" + title + "' 대화로 이동", "ok");
  }

  /* Esc 전역 처리 (입력창 밖에 포커스가 있어도 닫히도록) */
  function onDocKey(e) {
    if ((e.key === "Escape" || e.keyCode === 27) && ovOpen()) closeOverlay();
  }

  /* 세션 목록 렌더 — tx_chat_sessions.js 이음새 재사용 */
  function renderSessions() {
    if (!sessEl) return;
    var api = sessAPI();
    if (!api) {
      sessEl.innerHTML = '<div class="ezcs-empty">대화 목록을 불러올 수 없습니다</div>';
      return;
    }
    api.renderList(sessEl);
  }

  function render(qRaw) {
    if (!listEl) return;
    var r = search(qRaw);
    if (card) card.classList.toggle("ezcx-q", !!r.q);
    if (!r.q) {
      listEl.innerHTML = '<div class="ezcx-search-empty">대화 내용으로도 찾을 수 있습니다</div>';
      return;
    }
    if (!r.total) {
      listEl.innerHTML = '<div class="ezcx-search-empty">일치하는 대화 없음</div>';
      return;
    }
    var html = "";
    for (var i = 0; i < r.groups.length; i++) {
      var g = r.groups[i];
      html += '<div class="ezcx-grp"><div class="ezcx-grp-h"><b>' + esc(g.title) + "</b>" +
        "<span>" + g.rows.length + "건</span></div>";
      for (var j = 0; j < g.rows.length; j++) {
        var row = g.rows[j];
        html +=
          '<button type="button" class="ezcx-search-row" data-sid="' + esc(g.sid) + '"' +
          ' data-title="' + esc(g.title) + '">' +
          '<i class="ezcx-search-role">' + (row.role === "user" ? "👤" : "✦") + "</i>" +
          '<span class="ezcx-search-snip">' + row.snippetHtml + "</span>" +
          "</button>";
      }
      html += "</div>";
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
    renderSessions();
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
  /* 앵커 = ⛶(전체화면)·✕(닫기) 중 먼저 나오는 버튼. 18차에서 ⚙가 삭제되므로
     ⚙를 찾지 않는다. 어느 것도 없으면 .ezx-head-top 맨 뒤에 붙인다. */
  function findAnchor(top) {
    var ex = top.querySelector(".ezx-expand");
    if (ex && ex.parentNode === top) return ex;
    var btns = top.children;
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (!b.tagName || b.tagName.toLowerCase() !== "button") continue;
      var txt = (b.textContent || "").replace(/\s+/g, "");
      var label = b.getAttribute("aria-label") || "";
      if (txt === "⛶" || txt === "✕" || label.indexOf("전체화면") >= 0 || label.indexOf("닫기") >= 0) return b;
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
    btn.type = "button";
    btn.className = "ezx-x ezcx-search-btn";
    btn.setAttribute("aria-label", "대화 찾기");
    btn.setAttribute("title", "대화 찾기 · 지난 대화");
    btn.textContent = "🔍";
    btn.addEventListener("click", function () {
      if (!window.EZChat) return;
      if (ovOpen()) { closeOverlay(); return; }
      /* 패널이 다시 그려졌을 수 있으므로 클릭 시점에 재조회 */
      var p = document.querySelector(".ezx-root .ezx-panel") || panel;
      openOverlay(p);
    });

    var anchor = findAnchor(top);
    if (anchor) top.insertBefore(btn, anchor);   /* ⛶ / ✕ 왼쪽 */
    else top.appendChild(btn);                   /* 폴백: 맨 뒤 */

    /* 세션 변경 통지 → 열려 있을 때만 목록 갱신 */
    var api = sessAPI();
    if (api && api.onChange) {
      api.onChange(function () { if (ovOpen()) renderSessions(); });
    }
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
