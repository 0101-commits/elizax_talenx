/* ============================================================================
 * ez_signal_card.js — 신호 알림 카드 단일 렌더러 (18차 §2, W2 소유)
 * ----------------------------------------------------------------------------
 * 목적
 *   elizax 제안 · 에이전트 선제 감지 · 화면 문맥 제안 세 표면을 「알림」 카드
 *   한 종류로 통일한다. 이 파일이 그 카드의 유일한 렌더러다.
 *   카드는 계산하지 않는다 — EZSignalEngine이 만든 inst를 받아 그리고, 처리는
 *   EZSignalAct에 넘긴다(이벤트 발신만).
 *
 * 공개 API (window.EZSignalCard)
 *   render(inst, mode)      → HTMLElement  mode: "stack"|"slot"|"inline"|"welcome"
 *   stack(insts, mode)      → HTMLElement  2건 이상이면 펼친 카드 1장 + 접힌 행 N-1개
 *   slot(insts)             → HTMLElement  우하단 선제 슬롯(right:24px / bottom:96px)
 *   mount(el, insts, mode)  → HTMLElement  el 비우고 stack() 부착
 *
 * 카탈로그(v0.6)가 강제하는 규칙 — 이 파일이 지킨다 (§1)
 *   · 근거는 show==="기본" 중 위 2줄만 보이고 나머지는 전부 .ezs-fold 로 접는다.
 *     더보기 버튼은 실제 남은 줄 수를 말한다 — 「근거 3줄 더 보기」.
 *   · 처리 버튼은 기초 최대 2개 / 심화 최대 3개, rank 오름차순.
 *     kind는 작은 앞말, label은 버튼 글자(꼬리말 "(수정할 수 있어요)"는 title로 뺀다).
 *   · evidence[].assumed → (추정) 표시. thresholds[].value → 항상 (예시) + 「조정 <range>」.
 *   · now===0 → data-now="0" · 무채색 「데이터 준비 필요」 칩 ·
 *     처리 버튼 비활성(A5 상세 보기만 살림) · todoDecide/todoCreate 한 줄.
 *   · 꼬리말 = mute.repeat 뒤 다시 알림 · mute.clear 하면 해제.
 *   · actor==="상위조직장" → 「상위 조직 관점」 구분 칩(새 롤을 만들지 않는다).
 *   · 색은 파란 계열 5단만. 빨강 0 — hex 직접 사용 금지, astryx 토큰 var()만.
 *
 * 어휘 — 화면에 쓰는 말은 「알림」 하나. 제안·문맥 제안·선제 브리핑·에이전트 알림
 *        네 어휘는 쓰지 않는다.
 *
 * 의존 — 없어도 죽지 않는다(전부 존재 검사 후 호출)
 *   window.EZKit          esc / marker / asof / src / audit / clock
 *   window.EZSignalEngine snooze(id) / prompt(inst)
 *   window.EZSignalAct    run(inst, actionIdx)
 *   window.Elizax         sendRaw(text)
 *   window.EZProactive    claim(id, dismiss) / release(id, acted)
 * ========================================================================== */
(function () {
  "use strict";
  if (window.EZSignalCard && window.EZSignalCard.__v1) return;

  var SLOT_ID = "ezs-slot";              /* EZProactive 슬롯 키 (W5가 PRIO 4로 등록) */
  var EDIT_TAIL = /\s*\(\s*수정할 수 있어요\s*\)\s*$/;

  /* ---------- 문자 안전 처리 — EZKit.esc 단일 원천, 없으면 자체 폴백 ---------- */
  function esc(s) {
    if (window.EZKit && typeof window.EZKit.esc === "function") return window.EZKit.esc(s);
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function marker() { return (window.EZKit && window.EZKit.marker) || "✦"; }
  function srcChip(kind, label) {
    if (window.EZKit && typeof window.EZKit.src === "function") return window.EZKit.src(kind, label);
    return '<span class="ezk-chip ezk-src" data-src="' + esc(kind) + '">' + esc(label) + "</span>";
  }
  function asofChip() {
    if (window.EZKit && typeof window.EZKit.asof === "function") return window.EZKit.asof();
    return "";
  }
  function auditChip(seed) {
    if (window.EZKit && typeof window.EZKit.audit === "function") return window.EZKit.audit(seed);
    return "";
  }
  function asOfDate() {
    try { return window.EZKit.clock.asOfDate(); } catch (e) { return ""; }
  }

  /* ---------- inst 접근 — 엔진이 평탄하게 주든 signal을 품고 주든 둘 다 읽는다 ---------- */
  function sigOf(inst) {
    if (!inst) return {};
    return inst.sig || inst.signal || inst;
  }
  function fld(inst, key) {
    if (inst && inst[key] != null) return inst[key];
    var s = sigOf(inst);
    return s && s[key] != null ? s[key] : null;
  }

  /* ---------- 잔가지 ---------- */
  function cut(s, n) {
    var t = String(s == null ? "" : s);
    return t.length > n ? t.slice(0, n - 1) + "…" : t;
  }
  function md(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    return m ? Number(m[2]) + "/" + Number(m[3]) : String(iso || "");
  }
  function firstLine(s) {
    var t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
    var i = t.indexOf(". ");
    var j = t.indexOf("다. ");
    if (j > -1) return t.slice(0, j + 2);
    if (i > -1) return t.slice(0, i + 1);
    return t;
  }

  /* emph는 text 안에서 단 한 번 문자열 그대로 치환한다. 못 찾으면 원문을 그대로 둔다. */
  function evText(ev) {
    var t = String(ev.text == null ? "" : ev.text);
    var e = ev.emph == null ? "" : String(ev.emph);
    if (!e) return esc(t);
    var i = t.indexOf(e);
    if (i < 0) return esc(t);
    return esc(t.slice(0, i)) + "<b>" + esc(e) + "</b>" + esc(t.slice(i + e.length));
  }

  /* mute.clear = "목표를 1건이라도 저장하면 즉시" → "목표를 1건이라도 저장하면 해제" */
  function clearText(raw) {
    var s = String(raw == null ? "" : raw).replace(/\s*즉시\s*$/, "").replace(/\s+$/, "");
    if (!s || s === "해당 없음") return "";
    return /(면|때|후|뒤)$/.test(s) ? s + " 해제" : s + "하면 해제";
  }
  /* mute.repeat = "7일" → "7일 뒤 다시 알림" / "재알림 없음(1회)" → "다시 알리지 않음 · 1회" */
  function repeatText(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s || s === "해당 없음") return "";
    if (/^\d+\s*(일|주|주간|개월|달|시간)$/.test(s)) return s + " 뒤 다시 알림";
    if (/재알림\s*없음/.test(s)) {
      var m = /\(([^)]+)\)/.exec(s);
      return "다시 알리지 않음" + (m ? " · " + m[1] : "");
    }
    return s;
  }
  function footText(inst) {
    var m = fld(inst, "mute") || {};
    var out = [];
    var r = repeatText(m.repeat);
    if (r) out.push(r);
    var c = clearText(m.clear);
    if (c) out.push(c);
    return out.join(" · ");
  }

  /* ---------- 근거 — show==="기본" 위 2줄만 노출, 나머지 전부 접힘 ---------- */
  function splitEv(list, cap) {
    var basic = [], rest = [], i;
    var lim = cap == null ? 2 : cap;
    for (i = 0; i < (list || []).length; i++) {
      var ev = list[i];
      if (!ev) continue;
      if (ev.show === "기본" && basic.length < lim) basic.push(ev);
      else rest.push(ev);
    }
    return { basic: basic, rest: rest };
  }

  function evLi(ev) {
    var srcTxt = ev.src == null ? "" : String(ev.src);
    var kind = /규정|제도|규칙/.test(String(ev.basis == null ? "" : ev.basis)) ? "rule" : "talenx";
    var chip = srcTxt ? srcChip(kind, cut(srcTxt, 26)) : "";
    var d = ev.asof ? String(ev.asof).slice(0, 10) : "";
    var dt = d && d !== asOfDate() ? "기준 " + md(d) : "";
    var tip = [];
    if (srcTxt) tip.push(srcTxt);
    if (ev.calc) tip.push("계산 " + ev.calc);
    if (ev.basis) tip.push("비교 " + ev.basis);
    var why = chip || dt
      ? '<span class="ezs-why"' + (tip.length ? ' title="' + esc(tip.join(" · ")) + '"' : "") + ">"
        + chip + (dt ? '<span class="ezs-dt">' + esc(dt) + "</span>" : "") + "</span>"
      : "";
    return "<li" + (ev.mark ? ' data-mark="' + esc(ev.mark) + '"' : "") + ">"
      + '<i class="ezs-ax">' + esc(ev.axis || "사실") + "</i>"
      + '<span class="ezs-tx">' + evText(ev)
      + (ev.assumed ? ' <em class="ezs-asm">(추정)</em>' : "") + "</span>"
      + why + "</li>";
  }
  function evUl(list, cls) {
    if (!list || !list.length) return "";
    var h = '<ul class="ezs-ev' + (cls ? " " + cls : "") + '">', i;
    for (i = 0; i < list.length; i++) h += evLi(list[i]);
    return h + "</ul>";
  }

  /* ---------- 기준값 — value는 전부 예시값이므로 항상 (예시) ---------- */
  function thDl(list) {
    if (!list || !list.length) return "";
    var h = '<dl class="ezs-th">', i;
    for (i = 0; i < list.length; i++) {
      var th = list[i];
      if (!th) continue;
      var note = "(예시" + (th.range ? " · 조정 " + th.range : "") + ")";
      h += "<dt" + (th.why ? ' title="' + esc(th.why) + '"' : "") + ">"
        + esc(th.name || th.code || "기준값") + "</dt>"
        + "<dd>" + esc(th.value == null ? "" : th.value) + ' <em>' + esc(note) + "</em></dd>";
    }
    return h + "</dl>";
  }

  /* ---------- 처리 — 기초 2 / 심화 3, rank 오름차순, 원본 index 보존 ---------- */
  function actList(inst, limit) {
    var acts = fld(inst, "actions") || [];
    var arr = [], i;
    for (i = 0; i < acts.length; i++) if (acts[i]) arr.push({ a: acts[i], i: i });
    arr.sort(function (x, y) {
      var d = (x.a.rank == null ? 99 : x.a.rank) - (y.a.rank == null ? 99 : y.a.rank);
      return d !== 0 ? d : x.i - y.i;
    });
    var cap = limit != null ? limit : (fld(inst, "level") === "심화" ? 3 : 2);
    return arr.slice(0, cap);
  }
  function actsHtml(inst, mode) {
    var now0 = Number(fld(inst, "now")) === 0;
    var picked = actList(inst, mode === "welcome" ? 1 : null);
    /* 데이터 준비 필요 + 웰컴 = 유일한 버튼이 비활성이면 A5 상세 보기를 대신 세운다 */
    if (mode === "welcome" && now0 && picked.length && picked[0].a.type !== "A5") {
      var all = actList(inst, 99), k;
      for (k = 0; k < all.length; k++) if (all[k].a.type === "A5") { picked = [all[k]]; break; }
    }
    if (!picked.length) return "";
    var h = '<div class="ezs-acts">', i;
    for (i = 0; i < picked.length; i++) {
      var a = picked[i].a;
      var raw = String(a.label == null ? (a.kind || "처리") : a.label);
      var txt = raw.replace(EDIT_TAIL, "");
      var tip = EDIT_TAIL.test(raw) ? "수정할 수 있어요" : "";
      var off = now0 && a.type !== "A5";
      h += '<button type="button" class="ezs-btn' + (i === 0 ? " ezs-btn-1" : "") + '"'
        + ' data-ezs-act="' + picked[i].i + '" data-a="' + esc(a.type || "") + '"'
        + (off ? " disabled aria-disabled=\"true\"" : "")
        + (tip ? ' title="' + esc(tip) + '"' : "")
        + ">"
        + (a.kind ? '<i class="ezs-k">' + esc(a.kind) + "</i>" : "")
        + '<span class="ezs-l">' + esc(txt || a.kind || "처리") + "</span>"
        + (tip ? '<em class="ezs-edit">수정 가능</em>' : "")
        + "</button>";
    }
    return h + "</div>";
  }

  /* ---------- 카드 한 장 ---------- */
  function cardHtml(inst, mode, relN) {
    var id = String(fld(inst, "id") || "");
    var type = String(fld(inst, "type") || "T5");
    var now0 = Number(fld(inst, "now")) === 0;
    var lean = mode === "welcome";
    var ev = splitEv(fld(inst, "evidence") || [], lean ? 1 : 2);
    var upper = String(fld(inst, "actor") || "") === "상위조직장";
    var agent = String(fld(inst, "agent") || "");
    var ft = footText(inst);
    var todo = firstLine(fld(inst, "todoDecide") || fld(inst, "todoCreate") || "");

    var h = '<article class="ezs-card" data-sig="' + esc(id) + '" data-mode="' + esc(mode)
      + '" data-t="' + esc(type) + '"' + (now0 ? ' data-now="0"' : "") + ">";

    h += '<header class="ezs-hd">'
      + '<span class="ezs-type">' + esc(fld(inst, "typeLabel") || type) + "</span>"
      + '<span class="ezs-stage">' + esc(fld(inst, "stage") || "") + "</span>"
      + (upper ? '<span class="ezs-scope">상위 조직 관점</span>' : "")
      + (now0 ? '<span class="ezs-need">데이터 준비 필요</span>' : "")
      + '<span class="ezs-sp"></span>'
      + '<span class="ezs-rel"' + (relN > 1 ? "" : " hidden") + ">"
      + (relN > 1 ? "관련 " + esc(relN) + "건" : "") + "</span>"
      + '<button type="button" class="ezs-x" data-ezs-close aria-label="이 알림 접어두기" title="이 알림 접어두기">✕</button>'
      + "</header>";

    h += '<p class="ezs-notice">' + esc(fld(inst, "notice") || "") + "</p>";
    if (now0 && todo) h += '<p class="ezs-todo">준비할 것 — ' + esc(todo) + "</p>";

    h += evUl(ev.basic);

    if (!lean) {
      if (ev.rest.length) {
        h += '<button type="button" class="ezs-ev-more" data-ezs-ev aria-expanded="false">'
          + "근거 " + esc(ev.rest.length) + "줄 더 보기</button>";
      }
      var fold = '<div class="ezs-meta">' + asofChip() + auditChip("signal:" + id) + "</div>"
        + evUl(ev.rest, "ezs-ev-rest")
        + thDl(fld(inst, "thresholds") || []);
      var pr = fld(inst, "principle");
      if (pr) fold += '<p class="ezs-rule">알림 조건 — ' + esc(pr) + "</p>";
      if (!ev.rest.length) {
        /* 접을 근거가 없어도 기준값·조건은 남는다 — 「자세히 접기」 진입 버튼을 따로 세운다 */
        h += '<button type="button" class="ezs-ev-more" data-ezs-ev aria-expanded="false">기준값·조건 보기</button>';
      }
      h += '<div class="ezs-fold" hidden>' + fold + "</div>";
    }

    h += actsHtml(inst, mode);

    if (!lean && agent) {
      h += '<p class="ezs-agent">' + esc(marker()) + " "
        + '<span class="ezs-agent-tx">' + esc(agent) + "</span>"
        + '<button type="button" class="ezs-ask" data-ezs-ask>자세히</button></p>';
    }
    if (!lean && ft) h += '<footer class="ezs-ft">' + esc(ft) + "</footer>";

    return h + "</article>";
  }

  /* ---------- 접힌 행 — astryx 원칙(dense records belong in rows) ---------- */
  function rowHtml(inst, i) {
    var t = String(fld(inst, "type") || "T5");
    var now0 = Number(fld(inst, "now")) === 0;
    var sub = [fld(inst, "typeLabel") || t, fld(inst, "stage") || ""];
    if (String(fld(inst, "actor") || "") === "상위조직장") sub.push("상위 조직 관점");
    if (now0) sub.push("데이터 준비 필요");
    return '<li><button type="button" class="ezs-row" data-ezs-row="' + i + '" data-t="' + esc(t) + '"'
      + (now0 ? ' data-now="0"' : "") + ">"
      + '<span class="ezs-row-dot"></span>'
      + '<span class="ezs-row-bd"><span class="ezs-row-tt">' + esc(fld(inst, "notice") || "") + "</span>"
      + '<span class="ezs-row-bs">' + esc(sub.join(" · ")) + "</span></span>"
      + "</button></li>";
  }

  /* ---------- DOM 만들기 ---------- */
  function toEl(html) {
    var d = document.createElement("div");
    d.innerHTML = html;
    return d.firstElementChild;
  }
  /* 토큰은 @scope([data-astryx-theme="talenx"]) to ([data-astryx-theme]) — 스탬프 밖이면
     var()가 전부 무효가 되어 카드가 맨몸으로 뜬다. ez_kit.js의 MutationObserver가 찍어주지만
     (AI_ROOTS에 .ezs-slot/.ezs-stack/.ezs-card 등록됨) ez_kit이 없거나 늦어도 되게 스스로 찍는다.
     같은 테마를 중첩해도 선언값이 동일하므로 무해하다. */
  function stampTheme(el) {
    if (el && !el.getAttribute("data-astryx-theme")) el.setAttribute("data-astryx-theme", "talenx");
  }

  function render(inst, mode, relN) {
    var m = mode || "stack";
    var el = toEl(cardHtml(inst, m, relN || 1));
    el._inst = inst;
    stampTheme(el);
    return el;
  }

  /* ---------- 스택 — 펼친 카드 1장 + 접힌 행 N-1개 ---------- */
  function stackHtml(n, idx) {
    return '<div class="ezs-stack" data-n="' + esc(n) + '" tabindex="0" role="group"'
      + ' aria-label="관련 알림 ' + esc(n) + '건">'
      + '<div class="ezs-stack-body"></div>'
      + '<ul class="ezs-rows"></ul>'
      + '<div class="ezs-pager">'
      + '<button type="button" class="ezs-pg-b" data-ezs-prev aria-label="이전 알림">‹</button>'
      + '<span class="ezs-pg">' + esc(idx + 1) + "/" + esc(n) + "</span>"
      + '<button type="button" class="ezs-pg-b" data-ezs-next aria-label="다음 알림">›</button>'
      + "</div></div>";
  }

  function paint(st) {
    var list = st._insts || [], n = list.length, i;
    if (!n) { if (st.parentNode) st.parentNode.removeChild(st); return; }
    if (st._idx >= n) st._idx = n - 1;
    if (st._idx < 0) st._idx = 0;
    var body = st.querySelector(".ezs-stack-body");
    var rows = st.querySelector(".ezs-rows");
    var pg = st.querySelector(".ezs-pg");
    var pager = st.querySelector(".ezs-pager");
    body.innerHTML = "";
    body.appendChild(render(list[st._idx], st._mode || "stack", n));
    var rh = "";
    for (i = 0; i < n; i++) if (i !== st._idx) rh += rowHtml(list[i], i);
    rows.innerHTML = rh;
    if (pg) pg.textContent = (st._idx + 1) + "/" + n;
    st.setAttribute("data-n", n);
    if (pager) pager.hidden = n < 2;
    if (rows) rows.hidden = n < 2;
  }

  function stack(insts, mode) {
    var list = [], i;
    for (i = 0; i < (insts || []).length; i++) if (insts[i]) list.push(insts[i]);
    if (!list.length) return null;
    if (list.length === 1) { var one = render(list[0], mode || "stack", 1); wire(one); return one; }
    var st = toEl(stackHtml(list.length, 0));
    st._insts = list;
    st._idx = 0;
    st._mode = mode || "stack";
    stampTheme(st);
    paint(st);
    wire(st);
    return st;
  }

  function mount(el, insts, mode) {
    if (!el) return null;
    el.innerHTML = "";
    var s = stack(insts, mode || "stack");
    if (s) el.appendChild(s);
    return el;
  }

  /* ---------- 우하단 선제 슬롯 ---------- */
  function killSlot() {
    var old = document.querySelector(".ezs-slot");
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }
  function slot(insts) {
    var list = [], i;
    for (i = 0; i < (insts || []).length; i++) if (insts[i]) list.push(insts[i]);
    killSlot();
    if (!list.length) return null;
    var box = document.createElement("div");
    box.className = "ezs-slot";
    stampTheme(box);
    var inner = stack(list, "slot");
    if (!inner) return null;
    box.appendChild(inner);
    if (window.EZProactive && typeof window.EZProactive.claim === "function") {
      if (window.EZProactive.claim(SLOT_ID, killSlot) === false) return null;
    }
    document.body.appendChild(box);
    /* 등장 모션 — ez_kit.css의 ezkInsert 재사용 */
    box.classList.add("ezs-in");
    return box;
  }
  function releaseSlot(acted) {
    if (window.EZProactive && typeof window.EZProactive.release === "function") {
      try { window.EZProactive.release(SLOT_ID, acted !== false); } catch (e) {}
    }
  }

  /* ---------- 이벤트 — 카드는 실행하지 않는다. 넘긴다 ---------- */
  function instOf(node) {
    var c = node.closest ? node.closest(".ezs-card") : null;
    return c ? c._inst : null;
  }
  function removeCard(cardEl) {
    var st = cardEl.closest ? cardEl.closest(".ezs-stack") : null;
    if (st && st._insts) {
      st._insts.splice(st._idx, 1);
      if (!st._insts.length) {
        var sl = st.closest(".ezs-slot");
        if (sl && sl.parentNode) { sl.parentNode.removeChild(sl); releaseSlot(true); return; }
        if (st.parentNode) st.parentNode.removeChild(st);
        return;
      }
      paint(st);
      return;
    }
    var sl2 = cardEl.closest ? cardEl.closest(".ezs-slot") : null;
    if (sl2 && sl2.parentNode) { sl2.parentNode.removeChild(sl2); releaseSlot(true); return; }
    if (cardEl.parentNode) cardEl.parentNode.removeChild(cardEl);
  }

  function onClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;

    var ev = t.closest("[data-ezs-ev]");
    if (ev) {
      var card = ev.closest(".ezs-card");
      var fold = card ? card.querySelector(".ezs-fold") : null;
      if (fold) {
        var open = fold.hasAttribute("hidden");
        if (open) fold.removeAttribute("hidden"); else fold.setAttribute("hidden", "");
        ev.setAttribute("aria-expanded", open ? "true" : "false");
        var rest = card.querySelectorAll(".ezs-ev-rest > li").length;
        ev.textContent = open ? "근거 접기" : (rest ? "근거 " + rest + "줄 더 보기" : "기준값·조건 보기");
      }
      e.preventDefault();
      return;
    }

    var act = t.closest("[data-ezs-act]");
    if (act) {
      if (act.disabled) { e.preventDefault(); return; }
      var ai = parseInt(act.getAttribute("data-ezs-act"), 10);
      var inst = instOf(act);
      if (window.EZSignalAct && typeof window.EZSignalAct.run === "function") {
        try { window.EZSignalAct.run(inst, ai); } catch (err) { /* 처리 배선 오류는 카드가 삼킨다 */ }
      } else {
        console.warn("[EZSignalCard] EZSignalAct.run 미탑재 — 처리 배선 대기", fld(inst, "id"), ai);
      }
      e.preventDefault();
      return;
    }

    var x = t.closest("[data-ezs-close]");
    if (x) {
      var c1 = x.closest(".ezs-card");
      var id1 = c1 ? fld(c1._inst, "id") : null;
      if (id1 && window.EZSignalEngine && typeof window.EZSignalEngine.snooze === "function") {
        try { window.EZSignalEngine.snooze(id1); } catch (err) {}
      }
      if (c1) removeCard(c1);
      e.preventDefault();
      return;
    }

    var ask = t.closest("[data-ezs-ask]");
    if (ask) {
      var inst2 = instOf(ask);
      var txt = "";
      if (window.EZSignalEngine && typeof window.EZSignalEngine.prompt === "function") {
        try { txt = window.EZSignalEngine.prompt(inst2) || ""; } catch (err) { txt = ""; }
      }
      if (!txt) txt = String(fld(inst2, "notice") || "") + " 근거와 처리 방법을 알려줘";
      if (window.Elizax && typeof window.Elizax.sendRaw === "function") {
        try { window.Elizax.sendRaw(txt); } catch (err) {}
      } else {
        console.warn("[EZSignalCard] Elizax.sendRaw 미탑재 — 「자세히」 무동작");
      }
      e.preventDefault();
      return;
    }

    var row = t.closest("[data-ezs-row]");
    if (row) {
      var st1 = row.closest(".ezs-stack");
      if (st1) { st1._idx = parseInt(row.getAttribute("data-ezs-row"), 10) || 0; paint(st1); st1.focus(); }
      e.preventDefault();
      return;
    }

    var pv = t.closest("[data-ezs-prev]");
    var nx = t.closest("[data-ezs-next]");
    if (pv || nx) {
      var st2 = (pv || nx).closest(".ezs-stack");
      if (st2 && st2._insts) { step(st2, pv ? -1 : 1); }
      e.preventDefault();
    }
  }

  function step(st, d) {
    var n = st._insts.length;
    if (n < 2) return;
    st._idx = ((st._idx + d) % n + n) % n;
    paint(st);
  }

  function onKey(e) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
    var st = t.closest(".ezs-stack");
    if (!st || !st._insts || st._insts.length < 2) return;
    step(st, e.key === "ArrowLeft" ? -1 : 1);
    e.preventDefault();
  }

  /* 위임은 루트 1곳에만 건다 — 재렌더로 리스너가 새지 않는다 */
  function wire(root) {
    if (!root || root._ezsWired) return root;
    root._ezsWired = true;
    root.addEventListener("click", onClick);
    root.addEventListener("keydown", onKey);
    return root;
  }

  window.EZSignalCard = {
    __v1: true,
    render: function (inst, mode) { return wire(render(inst, mode, 1)); },
    stack: stack,
    slot: slot,
    mount: mount,
    /* 내부 노출 — 하네스/디버그용. 계약이 아니다. */
    _footText: footText,
    _clearText: clearText,
    _repeatText: repeatText
  };
})();
