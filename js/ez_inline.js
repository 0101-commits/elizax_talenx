/* ============================================================
   ez_inline.js — window.EZInline : 「필드 그 자리」 편집 표준 (19차 §8-1)
   ------------------------------------------------------------
   왜 만들었나
     지금까지 elizax 제안은 필드 「옆」에 뜨는 380px 상자였다(EZApply.popover).
     사용자가 쓰던 칸과 제안이 서로 다른 자리에 있으니, 읽고 → 눈을 옮기고 →
     비교하고 → 누르는 네 동작이 필요했다. 이 파일은 제안을 사용자가 지금
     글을 쓰고 있는 그 칸 「위」에 정확히 겹쳐 올려 그 거리를 없앤다.

   공개 API
     EZInline.suggest(field, text, opts)  제안을 필드 위에 겹쳐 띄운다 → handle
     EZInline.cancel(field)               열려 있는 제안을 닫는다
     EZInline.editable(host, spec)        읽기 전용 화면에 그 자리 편집을 붙인다
     EZInline.landFromChat(payload)       대화에서 만든 문안을 화면 칸에 착지
     EZInline.isOpen()                    현재 제안이 떠 있는지

   suggest(field, text, opts)
     field   HTMLElement | null  제안이 겹쳐질 입력 칸. 없으면 opts.anchor 아래에 뜬다
     text    string | null       바로 보여 줄 문안. null이고 opts.run이 있으면 로딩으로 연다
     opts
       anchor      HTMLElement   field가 없을 때 위치 기준
       fieldSel    string        적용 시점에 다시 찾을 선택자(재렌더 안전)
       title       string        오버레이 맨 윗줄 제목(생략 가능)
       why         string        바에 붙는 한 줄 이유 (28자 이내로 잘림)
       original    string        원래 값(기본 field 값). 여러 줄 칸에서만 위에 흐리게
       applyLabel  string        적용 버튼 글자 (기본 "이대로 적용")
       chips       [string]      바에 붙는 보조 칩
       run         fn(ctx)       문안 생성기. ctx.done(text) / ctx.fail(msg)
       onApply     fn(text, el)  false를 돌려주면 기본 값 대입을 건너뛴다
       onReject    fn()          "그만"으로 닫았을 때
       onClose     fn()
       chat        {label,prompt}|string   보조 링크(대화로 이어가기)
       audit       {source,title,summary}  적용 시 ez:ctx 1건 발행
     handle { el, field, done(text), fail(msg), close() }

   기하 — 어떻게 「그 칸 위」에 정확히 겹치나
     1) field.getBoundingClientRect() 로 화면 좌표·폭·높이를 읽는다.
     2) getComputedStyle(field) 에서 글꼴·글자 크기·자간·줄높이·안쪽 여백·
        모서리 둥글기·정렬을 그대로 복사한다 → 같은 글자가 같은 자리에 앉는다.
     3) 오버레이는 position:fixed(뷰포트 좌표계)라 스크롤·리사이즈마다 1)을 다시 읽는다.
     4) 칸이 스크롤 영역 밖으로 밀려 나가면(상위 스크롤 상자와 겹치지 않으면) 감춘다.
        position:fixed 는 상위 상자에 잘리지 않아서, 이 검사를 안 하면 칸이 사라진
        뒤에도 제안만 허공에 남는다.
     5) 실행 바는 칸 「바로 아래」에 폭을 맞춰 붙이고, 아래 공간이 모자라면 위로 뒤집는다.

   규칙: ES5 · hex 색 금지(토큰만) · z-index는 ez_kit 토큰만 · 절대 throw 하지 않는다.
   ============================================================ */
(function () {
  "use strict";

  var MK = "✦"; /* ✦ */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function each(list, fn) {
    if (!list) return;
    for (var i = 0; i < list.length; i++) fn(list[i], i);
  }
  function cut(s, n) {
    s = String(s == null ? "" : s).trim();
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  /* ================= CSS (자가 주입 — index.html 손대지 않는다) ================= */
  var CSS = [
    /* 루트는 화면 전체를 덮되 클릭은 통과시킨다 — 바깥 클릭이 원래 화면에 그대로 닿아야 한다 */
    ".ezin-root{ position:fixed; left:0; top:0; right:0; bottom:0; pointer-events:none;",
    "  z-index:var(--z-overlay, 4100); font-family:var(--font-family-body, inherit); }",

    /* --- 칸 위에 겹치는 오버레이 --- */
    ".ezin-ov{ position:absolute; box-sizing:border-box; pointer-events:auto; overflow:hidden;",
    "  background:var(--color-background-surface); color:var(--color-text-primary);",
    "  border:1px solid var(--color-accent);",
    "  box-shadow:0 0 0 3px var(--color-accent-muted), 0 10px 30px var(--color-shadow);",
    "  opacity:0; transform:translateY(-3px);",
    "  transition:opacity .14s var(--ease-standard, ease), transform .14s var(--ease-standard, ease); }",
    ".ezin-ov .ezin-ttl{ display:block; font-size:12.5px; font-weight:600; color:var(--color-text-accent);",
    "  letter-spacing:0; margin-bottom:5px; }",
    ".ezin-ov .ezin-old{ display:block; font-size:12.5px; line-height:1.5; color:var(--color-text-disabled);",
    "  letter-spacing:0; margin-bottom:5px; max-height:42px; overflow:hidden; white-space:pre-wrap; word-break:break-word; }",
    ".ezin-ov .ezin-old i{ font-style:normal; font-weight:600; }",
    ".ezin-ov .ezin-new{ display:block; white-space:pre-wrap; word-break:break-word; color:var(--color-text-primary); }",
    ".ezin-ov.wait .ezin-new{ color:var(--color-text-secondary); }",
    ".ezin-ov.bad .ezin-new{ color:var(--color-trust-warm, var(--color-text-secondary)); }",
    ".ezin-sp{ display:inline-block; width:11px; height:11px; border:2px solid var(--color-accent-muted);",
    "  border-top-color:var(--color-accent); border-radius:50%; animation:ezkSpin .8s linear infinite;",
    "  vertical-align:-2px; margin-right:6px; }",

    /* --- 칸 바로 아래, 칸 폭에 맞춘 실행 바 --- */
    ".ezin-bar{ position:absolute; box-sizing:border-box; pointer-events:auto;",
    "  display:flex; align-items:center; flex-wrap:wrap; gap:7px; padding:8px 10px;",
    "  background:var(--color-background-popover); border:1px solid var(--color-border);",
    "  border-radius:var(--radius-container, 10px); box-shadow:0 8px 24px var(--color-shadow);",
    "  opacity:0; transform:translateY(-3px);",
    "  transition:opacity .14s var(--ease-standard, ease), transform .14s var(--ease-standard, ease); }",
    ".ezin-root.show .ezin-ov, .ezin-root.show .ezin-bar{ opacity:1; transform:none; }",
    ".ezin-root.off .ezin-ov, .ezin-root.off .ezin-bar{ opacity:0; pointer-events:none; }",
    ".ezin-bar .ezin-mk{ color:var(--color-accent); font-weight:700; font-size:13px; flex:none; }",
    ".ezin-bar .ezin-why{ font-size:12.5px; line-height:1.45; color:var(--color-text-secondary);",
    "  margin-right:auto; min-width:60px; }",
    ".ezin-btn{ font:inherit; font-size:12.5px; font-weight:600; line-height:1.3; white-space:nowrap;",
    "  border-radius:var(--radius-full, 999px); padding:5px 12px; cursor:pointer;",
    "  border:1px solid var(--color-border); background:var(--color-background-surface);",
    "  color:var(--color-text-primary); transition:transform .15s var(--ease-standard, ease); }",
    ".ezin-btn.pri{ background:var(--color-accent); border-color:var(--color-accent); color:var(--color-on-accent); }",
    ".ezin-btn:disabled{ opacity:.45; cursor:default; }",
    ".ezin-btn:active:not(:disabled){ transform:scale(.96); }",
    ".ezin-bar .ezin-chips{ display:flex; flex-wrap:wrap; gap:5px; width:100%; }",
    ".ezin-chip{ font-size:12.5px; line-height:1.4; padding:2px 9px; border-radius:var(--radius-full, 999px);",
    "  border:1px solid var(--color-border); background:var(--color-background-muted); color:var(--color-text-secondary); }",
    ".ezin-bar .ezin-link{ font:inherit; font-size:12.5px; font-weight:600; color:var(--color-text-secondary);",
    "  background:none; border:none; padding:0 2px; cursor:pointer; text-decoration:underline; text-underline-offset:2px; }",
    ".ezin-bar .ezin-link:hover{ color:var(--color-text-accent); }",

    /* --- 적용 직후 칸 테두리 1회 깜빡 (칸 자체를 건드리지 않고 겹쳐 그린다) --- */
    ".ezin-ring{ position:fixed; pointer-events:none; z-index:var(--z-overlay, 4100);",
    "  box-shadow:0 0 0 3px var(--color-accent-muted); animation:ezinFade .55s ease forwards; }",
    "@keyframes ezinFade{ from{ opacity:1; } to{ opacity:0; } }",

    /* --- editable : 읽기 전용 화면의 그 자리 편집 --- */
    "[data-ezin-edt]{ position:relative; }",
    ".ezin-pen{ position:absolute; right:2px; top:50%; transform:translateY(-50%);",
    "  font:inherit; font-size:12.5px; line-height:1; color:var(--color-text-secondary);",
    "  background:var(--color-background-surface); border:1px solid var(--color-border);",
    "  border-radius:var(--radius-full, 999px); padding:3px 7px; cursor:pointer;",
    "  opacity:0; transition:opacity .12s ease; }",
    "[data-ezin-edt]:hover .ezin-pen, .ezin-pen:focus{ opacity:1; }",
    ".ezin-pen:hover{ color:var(--color-text-accent); border-color:var(--color-accent); }",
    ".ezin-ie{ font:inherit; color:var(--color-text-primary); background:var(--color-background-surface);",
    "  border:1px solid var(--color-accent); border-radius:6px; padding:2px 6px; width:100%; max-width:100%;",
    "  box-sizing:border-box; box-shadow:0 0 0 3px var(--color-accent-muted); }",
    ".ezin-ehint{ display:block; font-size:12.5px; color:var(--color-text-secondary); margin-top:3px; font-weight:400; }"
  ].join("\n");

  (function injectCSS() {
    try {
      if (document.getElementById("ezin-css")) return;
      var st = document.createElement("style");
      st.id = "ezin-css";
      st.textContent = CSS;
      (document.head || document.documentElement).appendChild(st);
    } catch (e) { /* 스타일 주입 실패해도 동작은 막지 않는다 */ }
  })();

  /* ================= 기하 도우미 ================= */

  /* 칸을 감싸는 스크롤 상자들 — position:fixed 오버레이는 이 상자에 잘리지 않으므로
     "칸이 아직 보이는가"를 직접 계산해야 한다. */
  function scrollBoxes(el) {
    var out = [], n = el && el.parentElement;
    while (n && n !== document.body && n !== document.documentElement) {
      var cs;
      try { cs = window.getComputedStyle(n); } catch (e) { cs = null; }
      if (cs) {
        var ov = cs.overflow + cs.overflowY + cs.overflowX;
        if (/(auto|scroll|hidden)/.test(ov)) out.push(n);
      }
      n = n.parentElement;
    }
    return out;
  }
  function rectVisible(el, boxes) {
    var r = el.getBoundingClientRect();
    if (!r.width && !r.height) return false;
    if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return false;
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i].getBoundingClientRect();
      if (r.bottom < b.top + 1 || r.top > b.bottom - 1 || r.right < b.left + 1 || r.left > b.right - 1) return false;
    }
    return true;
  }
  /* 칸의 글자 모양을 오버레이에 그대로 옮긴다 — 같은 글자가 같은 자리에 앉게 하는 핵심 */
  var COPY = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight",
    "textAlign", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderRadius"];
  function copyLook(ov, field) {
    var cs;
    try { cs = window.getComputedStyle(field); } catch (e) { return; }
    for (var i = 0; i < COPY.length; i++) {
      var k = COPY[i];
      if (cs[k]) ov.style[k] = cs[k];
    }
    /* 안쪽 여백이 0인 칸(표 안 셀 등)은 글자가 테두리에 붙어 읽기 어렵다 — 최소치를 준다 */
    if (num(cs.paddingLeft) < 6) { ov.style.paddingLeft = "10px"; ov.style.paddingRight = "10px"; }
    if (num(cs.paddingTop) < 5) { ov.style.paddingTop = "8px"; ov.style.paddingBottom = "8px"; }
  }

  /* ================= suggest ================= */

  var cur = null; /* 화면에 하나 — 새로 열면 이전 것은 닫힌다 */

  function closeCur(reason) {
    if (!cur) return;
    var h = cur;
    cur = null;
    try {
      document.removeEventListener("keydown", h._key, true);
      document.removeEventListener("mousedown", h._out, true);
      window.removeEventListener("scroll", h._place, true);
      window.removeEventListener("resize", h._place);
      if (h._tick) { clearInterval(h._tick); h._tick = null; }
    } catch (e) { /* 이미 해제됨 */ }
    try { h.root.classList.remove("show"); } catch (e) {}
    setTimeout(function () { try { if (h.root.parentNode) h.root.parentNode.removeChild(h.root); } catch (e) {} }, 170);
    if (reason === "reject" && h._opts.onReject) { try { h._opts.onReject(); } catch (e) {} }
    if (h._opts.onClose) { try { h._opts.onClose(); } catch (e) {} }
  }

  function ringFlash(el) {
    try {
      var r = el.getBoundingClientRect();
      var d = document.createElement("div");
      d.className = "ezin-ring";
      d.setAttribute("data-astryx-theme", "talenx");
      var cs = window.getComputedStyle(el);
      d.style.left = r.left + "px";
      d.style.top = r.top + "px";
      d.style.width = r.width + "px";
      d.style.height = r.height + "px";
      d.style.borderRadius = cs.borderRadius || "8px";
      document.body.appendChild(d);
      setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 600);
    } catch (e) { /* 장식 — 실패해도 무시 */ }
  }

  /* 한 줄 칸(input)에는 제안만 보여 준다 — 좁은 칸에 원래 값까지 얹으면
     칸 세 배 높이의 상자가 되어, 「그 자리」라는 감각이 깨진다(§8-1). */
  function multiline(field) {
    if (!field || !field.tagName) return true;
    if (field.tagName === "INPUT") return false;
    if (field.tagName === "TEXTAREA") return true;
    return true;
  }

  function suggest(field, text, opts) {
    opts = opts || {};
    if (field && typeof field === "string") field = document.querySelector(field);
    var anchor = opts.anchor || field;
    if (!field && !anchor) return null;
    closeCur();

    var detached = !field; /* 칸이 없는 자리(브리핑 등) — 기준 요소 아래에 카드로 띄운다 */
    var geo = field || anchor;
    var boxes = scrollBoxes(geo);
    var multi = multiline(field);
    var original = opts.original != null ? opts.original
      : (field ? (field.value != null ? field.value : field.textContent) : "");
    original = String(original == null ? "" : original).trim();

    var root = document.createElement("div");
    root.className = "ezin-root";
    root.setAttribute("data-astryx-theme", "talenx");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "elizax 제안");

    var ov = document.createElement("div");
    ov.className = "ezin-ov";
    ov.innerHTML =
      (opts.title ? '<span class="ezin-ttl">' + MK + " " + esc(opts.title) + "</span>" : "") +
      (multi && original ? '<span class="ezin-old"><i>지금 값</i> · ' + esc(original) + "</span>" : "") +
      '<span class="ezin-new" data-ezin-new></span>';

    var bar = document.createElement("div");
    bar.className = "ezin-bar";
    var canRedo = !!(opts.run || opts.chat);
    bar.innerHTML =
      '<span class="ezin-mk" aria-hidden="true">' + MK + "</span>" +
      '<span class="ezin-why" data-ezin-why>' + esc(cut(opts.why || "", 28)) + "</span>" +
      '<button type="button" class="ezin-btn pri" data-ezin-ok disabled>' + esc(opts.applyLabel || "이대로 적용") + "</button>" +
      (canRedo ? '<button type="button" class="ezin-btn" data-ezin-redo>다르게 써줘</button>' : "") +
      '<button type="button" class="ezin-btn" data-ezin-no>그만</button>' +
      (opts.chat && opts.run ? '<button type="button" class="ezin-link" data-ezin-chat>' +
        esc(typeof opts.chat === "string" ? "대화로 이어가기" : (opts.chat.label || "대화로 이어가기")) + "</button>" : "") +
      ((opts.chips && opts.chips.length)
        ? '<span class="ezin-chips">' + opts.chips.map(function (c) { return '<span class="ezin-chip">' + esc(c) + "</span>"; }).join("") + "</span>"
        : "");

    if (detached) {
      ov.style.width = "380px";
      ov.style.maxWidth = "calc(100vw - 24px)";
      ov.style.padding = "12px 14px";
      ov.style.borderRadius = "12px";
      ov.style.fontSize = "13px";
      ov.style.lineHeight = "1.6";
    } else {
      copyLook(ov, field);
    }

    root.appendChild(ov);
    root.appendChild(bar);
    document.body.appendChild(root);

    var box = ov.querySelector("[data-ezin-new]");
    var bOk = bar.querySelector("[data-ezin-ok]");
    var bRedo = bar.querySelector("[data-ezin-redo]");
    var whyEl = bar.querySelector("[data-ezin-why]");
    var value = "";

    function place() {
      try {
        if (!document.body.contains(geo)) { closeCur(); return; }
        if (!rectVisible(geo, boxes)) { root.classList.add("off"); return; }
        root.classList.remove("off");
        var r = geo.getBoundingClientRect();
        var left, width;
        if (detached) {
          width = Math.min(380, window.innerWidth - 24);
          left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
          ov.style.left = left + "px";
          ov.style.top = (r.bottom + 8) + "px";
        } else {
          width = r.width;
          left = r.left;
          ov.style.left = left + "px";
          ov.style.top = r.top + "px";
          ov.style.width = width + "px";
          ov.style.minHeight = r.height + "px";
        }
        var ovR = ov.getBoundingClientRect();
        var barH = bar.offsetHeight || 38;
        var barTop = ovR.bottom + 6;
        if (barTop + barH > window.innerHeight - 8) {
          /* 아래에 자리가 없으면 칸 위로 뒤집는다 — 바가 화면 밖에 잘리지 않게 */
          barTop = Math.max(8, ovR.top - barH - 6);
        }
        /* 바는 칸 폭을 따르되, 칸이 너무 좁으면 버튼이 세 줄로 접힌다 — 최소 폭을 준다 */
        var bw = Math.min(Math.max(width, 380), Math.max(240, window.innerWidth - 16));
        bar.style.left = Math.min(Math.max(8, left), Math.max(8, window.innerWidth - bw - 8)) + "px";
        bar.style.width = bw + "px";
        bar.style.top = barTop + "px";
      } catch (e) { /* 위치 계산 실패 — 그대로 둔다 */ }
    }

    function target() {
      if (opts.fieldSel) {
        var t = document.querySelector(opts.fieldSel);
        if (t) return t;
      }
      return field;
    }

    var h = {
      root: root, el: ov, field: field, _opts: opts, _place: place,
      close: function () { closeCur(); },
      done: function (t) {
        value = String(t == null ? "" : t).trim();
        ov.classList.remove("wait", "bad");
        if (whyEl) whyEl.textContent = cut(opts.why || "", 28);
        if (!value) { h.fail("받은 문안이 비어 있어요"); return; }
        box.textContent = value;
        bOk.disabled = false;
        if (bRedo) bRedo.disabled = false;
        place();
        try { bOk.focus(); } catch (e) {}
      },
      fail: function (msg) {
        value = "";
        ov.classList.remove("wait");
        ov.classList.add("bad");
        if (whyEl) whyEl.textContent = "쓰시던 글은 그대로 있어요";
        /* 사람 말로 온 이유만 그대로 보여 준다 — 개발 메시지가 화면에 나가지 않게 한다 */
        var m = String(msg == null ? "" : msg).trim();
        if (!m || !/[가-힣]/.test(m)) m = "지금은 문안을 못 만들었어요 · 잠시 뒤 다시 눌러 주세요";
        box.textContent = m;
        bOk.disabled = true;
        if (bRedo) bRedo.disabled = false;
        place();
      }
    };

    h._key = function (e) {
      if (e.key === "Escape") { e.stopPropagation(); closeCur("reject"); return; }
      if (e.key === "Enter" && !e.shiftKey) {
        if (root.contains(e.target) && !bOk.disabled) { e.preventDefault(); e.stopPropagation(); apply(); }
      }
    };
    h._out = function (e) {
      if (root.contains(e.target)) return;
      if (field && (e.target === field || (field.contains && field.contains(e.target)))) return;
      closeCur();
    };

    function apply() {
      if (!value) return;
      var tgt = target();
      var handled = false;
      if (opts.onApply) {
        try { handled = (opts.onApply(value, tgt) === false); } catch (e) { handled = false; }
      }
      if (!handled && tgt) {
        try {
          if ("value" in tgt) {
            tgt.value = value;
            tgt.dispatchEvent(new Event("input", { bubbles: true }));
            tgt.dispatchEvent(new Event("change", { bubbles: true }));
          } else tgt.textContent = value;
        } catch (e) { /* 값 대입 실패 — 아래 안내만 */ }
        ringFlash(tgt);
        try {
          tgt.focus();
          if (tgt.setSelectionRange && typeof tgt.value === "string") {
            tgt.setSelectionRange(tgt.value.length, tgt.value.length);
          }
        } catch (e) { /* 포커스 불가한 요소 */ }
      }
      if (opts.audit) {
        try {
          document.dispatchEvent(new CustomEvent("ez:ctx", { detail: {
            type: "audit", source: opts.audit.source || "ez:apply", weight: 1,
            title: opts.audit.title || "elizax 문안 반영",
            summary: opts.audit.summary || String(value).slice(0, 80)
          } }));
        } catch (e) { /* 성과 기록 미탑재 */ }
      }
      try { if (window.TX && TX.toast) TX.toast("칸에 넣었어요 · 아직 확정 전이라 되돌릴 수 있어요", "ok"); } catch (e) {}
      closeCur();
    }

    bOk.addEventListener("click", apply);
    bar.querySelector("[data-ezin-no]").addEventListener("click", function () { closeCur("reject"); });
    if (bRedo) bRedo.addEventListener("click", function () {
      if (opts.run) { start(); return; }
      sendChat();
      closeCur();
    });
    var chatBtn = bar.querySelector("[data-ezin-chat]");
    if (chatBtn) chatBtn.addEventListener("click", function () { sendChat(); closeCur(); });

    function sendChat() {
      var p = typeof opts.chat === "string" ? opts.chat : (opts.chat && opts.chat.prompt);
      try { if (window.Elizax && Elizax.open) Elizax.open(); } catch (e) {}
      try { if (p && window.Elizax && Elizax.send) Elizax.send(p); } catch (e) {}
    }

    function start() {
      ov.classList.remove("bad");
      ov.classList.add("wait");
      box.innerHTML = '<span class="ezin-sp"></span>elizax가 쓰고 있어요…';
      bOk.disabled = true;
      if (bRedo) bRedo.disabled = true;
      if (whyEl && !opts.why) whyEl.textContent = "잠깐만 기다려 주세요";
      place();
      try {
        opts.run({
          done: function (t) { if (cur === h) h.done(t); },
          fail: function (m) { if (cur === h) h.fail(m); }
        });
      } catch (e) { h.fail(e && e.message ? e.message : "알 수 없는 이유"); }
    }

    cur = h;
    document.addEventListener("keydown", h._key, true);
    setTimeout(function () { document.addEventListener("mousedown", h._out, true); }, 0);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    /* 칸이 사라지거나(재렌더) 자리만 조용히 움직이는 경우까지 따라간다 */
    h._tick = setInterval(function () { if (cur === h) place(); }, 400);

    if (opts.run && (text == null || text === "")) start();
    else h.done(text != null ? text : "");

    place();
    requestAnimationFrame(function () { place(); root.classList.add("show"); });
    return h;
  }

  function cancel(field) {
    if (!cur) return;
    if (!field || cur.field === field) closeCur();
  }

  /* ================= editable — 읽기 전용 화면의 그 자리 편집 ================= */

  /* 요소의 글자만 읽는다(우리가 붙인 ✎ 버튼과 보조 설명은 뺀다) */
  function ownText(el) {
    var s = "";
    each(el.childNodes, function (n) {
      if (n.nodeType === 3) s += n.nodeValue;
      else if (n.nodeType === 1 && !/ezin-pen|ezin-ehint/.test(n.className || "")) s += n.textContent;
    });
    return s.replace(/\s+/g, " ").trim();
  }

  function beginEdit(el, sp) {
    if (el._ezinEditing) return;
    el._ezinEditing = true;
    var raw = ownText(el);
    var unit = sp.unit || "";
    var val = raw;
    if (unit && val.slice(-unit.length) === unit) val = val.slice(0, -unit.length).trim();

    var keep = [];
    while (el.firstChild) keep.push(el.removeChild(el.firstChild));

    var inp = document.createElement("input");
    inp.className = "ezin-ie";
    inp.type = sp.kind === "number" ? "number" : "text";
    inp.value = val;
    inp.setAttribute("data-astryx-theme", "talenx");
    inp.setAttribute("aria-label", (sp.label || "값") + " 고치기");
    if (sp.kind === "number") { inp.min = "0"; inp.max = sp.max != null ? String(sp.max) : "100"; }
    el.appendChild(inp);
    var hint = document.createElement("span");
    hint.className = "ezin-ehint";
    hint.textContent = "Enter 로 저장 · Esc 로 되돌리기";
    el.appendChild(hint);
    try { inp.focus(); inp.select(); } catch (e) {}

    var escaped = false;
    function restore(txt) {
      el._ezinEditing = false;
      while (el.firstChild) el.removeChild(el.firstChild);
      var seen = false;
      for (var i = 0; i < keep.length; i++) {
        var n = keep[i];
        if (!seen && n.nodeType === 3) { n.nodeValue = txt; seen = true; }
        el.appendChild(n);
      }
      if (!seen) el.insertBefore(document.createTextNode(txt), el.firstChild);
    }
    function finish(save) {
      if (!el._ezinEditing) return;
      var v = String(inp.value == null ? "" : inp.value).trim();
      if (!save || !v || v === val) { restore(raw); return; }
      var shown = v + unit;
      restore(shown);
      ringFlash(el);
      var ok = true;
      if (sp.onSave) { try { ok = sp.onSave(v, el, sp) !== false; } catch (e) { ok = false; } }
      try {
        document.dispatchEvent(new CustomEvent("ez:ctx", { detail: {
          type: "audit", source: sp.source || "goal.edit", weight: 1,
          title: (sp.label || "내용") + " 고침",
          summary: (sp.label || "내용") + " · " + cut(raw || "빈 값", 24) + " → " + cut(shown, 24)
        } }));
      } catch (e) { /* 성과 기록 미탑재 */ }
      try {
        if (window.TX && TX.toast) TX.toast(ok ? "고쳤어요 · 아직 확정 전이에요" : "화면에는 반영했지만 저장은 못 했어요", ok ? "ok" : "warn");
      } catch (e) {}
    }
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); escaped = false; finish(true); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); escaped = true; finish(false); }
    });
    inp.addEventListener("blur", function () { setTimeout(function () { if (!escaped) finish(true); }, 0); });
    inp.addEventListener("click", function (e) { e.stopPropagation(); });
  }

  /* editable(host, spec)
       spec = [{sel, kind:"text"|"number", key, label, unit, max, onSave(v, el, sp)}]
     대상에 마우스를 올리면 오른쪽 끝에 ✎ 가 뜨고, 누르면 그 자리에서 입력칸이 된다. */
  function editable(host, spec) {
    if (!host || !spec || !spec.length) return 0;
    var n = 0;
    for (var i = 0; i < spec.length; i++) {
      (function (sp) {
        var list;
        try { list = host.querySelectorAll(sp.sel); } catch (e) { return; }
        each(list, function (el) {
          if (el.getAttribute("data-ezin-edt")) return;
          if (el.getAttribute("colspan")) return; /* "없습니다" 같은 안내 행은 건너뛴다 */
          el.setAttribute("data-ezin-edt", sp.key || "1");
          var b = document.createElement("button");
          b.type = "button";
          b.className = "ezin-pen";
          b.setAttribute("data-astryx-theme", "talenx");
          b.setAttribute("aria-label", (sp.label || "값") + " 고치기");
          b.textContent = "✎"; /* ✎ */
          b.addEventListener("click", function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            beginEdit(el, sp);
          });
          el.appendChild(b);
          n++;
        });
      })(spec[i]);
    }
    return n;
  }

  /* ================= landFromChat ================= */

  /* 대화에서 만든 문안을 화면 칸에 착지시킨다.
     화면 이동은 하지 않는다 — 칸을 못 찾으면 false를 돌려줄 뿐이다(자동 이동 금지 규칙). */
  var FIELD_ALIAS = {
    "goal-name": '[data-txf-ov="new"] input[data-txf="new-name"]',
    "goal-desc": '[data-txf-ov="new"] textarea[data-txf="new-desc"]',
    "kr-name": '[data-txf="kr-list"] .txf-kr input.txf-inp',
    "kr-target": '[data-txf="kr-list"] .txf-kr .txf-krtv'
  };
  function landFromChat(payload) {
    payload = payload || {};
    var text = String(payload.text == null ? "" : payload.text).trim();
    if (!text) return false;
    var f = payload.field;
    if (f && typeof f === "string") {
      var sel = FIELD_ALIAS[f] || f;
      try { f = document.querySelector(sel); } catch (e) { f = null; }
    }
    if (!f || !f.getBoundingClientRect) return false;
    if (!rectVisible(f, scrollBoxes(f))) return false;
    suggest(f, text, {
      why: cut(payload.why || "대화에서 만든 문안이에요", 28),
      title: payload.title || "대화에서 가져온 문안",
      audit: { source: "chat.land", title: "대화 문안을 화면에 반영", summary: cut(text, 60) }
    });
    return true;
  }

  /* ================= 목표 상세 화면 자동 연결 =================
     tx_fix_perf.js 의 목표 상세는 읽기 전용이라 편집 칸이 하나도 없다.
     그 파일은 고치지 않고(소유자가 다르다), 오버레이가 열리는 순간을
     MutationObserver 로 잡아 여기서 편집을 붙인다.
     ============================================================ */
  var GOAL_SPEC = [
    { sel: ".txf-gd .gd-title", kind: "text", key: "title", label: "목표 이름",
      onSave: function (v) { return saveGoal("title", v); } },
    { sel: ".txf-gd .txf-krt tbody tr > td:first-child", kind: "text", key: "kr-name", label: "핵심 성과 이름",
      onSave: function (v, el) { return saveKR(el, "name", v); } },
    { sel: ".txf-gd .txf-krt tbody tr > td:nth-child(4)", kind: "number", key: "kr-weight", label: "가중치", unit: "%",
      onSave: function (v, el) { return saveKR(el, "weight", num(v)); } }
  ];

  function goalOv() { return document.querySelector('[data-txf-ov="goal"]'); }
  function curOid() { var g = goalOv(); return g ? g.getAttribute("data-oid") : ""; }

  /* 화면에 보이는 값을 실제 데이터에도 남긴다 — 안 그러면 화면을 다시 그릴 때 되돌아간다.
     찾지 못하면 false 를 돌려주고, 사용자에게 "저장은 못 했다"고 그대로 말한다. */
  function saveGoal(key, v) {
    var D = window.TALENX_DATA || {}, oid = curOid(), hit = null;
    each(D.objectives || [], function (o) { if (o.objective_id === oid) hit = o; });
    if (!hit) return false;
    hit[key] = v;
    fire(oid);
    return true;
  }
  function saveKR(cell, key, v) {
    var D = window.TALENX_DATA || {}, oid = curOid();
    var tr = cell && cell.parentElement;
    var tbody = tr && tr.parentElement;
    if (!tr || !tbody) return false;
    var ix = -1;
    each(tbody.children, function (row, i) { if (row === tr) ix = i; });
    if (ix < 0) return false;
    var ks = [];
    each(D.keyResults || [], function (k) { if (k.objective_id === oid) ks.push(k); });
    if (!ks[ix]) return false;
    ks[ix][key] = v;
    fire(oid);
    return true;
  }
  function fire(oid) {
    try { document.dispatchEvent(new CustomEvent("ez:goal-edited", { detail: { objective_id: oid } })); } catch (e) {}
  }

  var wireTimer = null;
  function wireGoal() {
    var g = goalOv();
    if (!g || g.className.indexOf("open") < 0) return;
    try { editable(g, GOAL_SPEC); } catch (e) { /* 구조가 바뀌었으면 조용히 넘어간다 */ }
  }
  function scheduleWire() {
    clearTimeout(wireTimer);
    wireTimer = setTimeout(wireGoal, 90);
  }
  /* 문서 전체를 보되, 변경 목록을 훑지 않는다 — 목표 상세가 열려 있을 때만 일을 시킨다.
     (대화 스트리밍처럼 초당 수십 번 바뀌는 화면에서 낭비가 없게) */
  try {
    new MutationObserver(function () {
      if (!goalOv()) return;
      scheduleWire();
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "data-oid"] });
  } catch (e) { /* 관찰 불가 환경 — 아래 클릭 폴백만 동작 */ }
  document.addEventListener("click", function () { scheduleWire(); }, true);

  window.EZInline = {
    suggest: suggest,
    cancel: cancel,
    editable: editable,
    landFromChat: landFromChat,
    isOpen: function () { return !!cur; },
    close: function () { closeCur(); },
    GOAL_SPEC: GOAL_SPEC
  };
})();
