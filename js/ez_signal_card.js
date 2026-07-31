/* ============================================================================
 * ez_signal_card.js — 알림 한 줄 권유 (18-2차 R7, B3 소유)
 * ----------------------------------------------------------------------------
 * 18차의 카드 UI는 폐기했다. 남는 것은 우하단 「한 줄 권유」 하나다.
 *   · 사람 말 머리말 + 알림 문구 한 문장 + 「열어보기」·「나중에」
 *   · 「열어보기」 → EZSignalChat.ask(id) (없으면 Elizax.send(문장))
 *   · 「나중에」   → EZSignalEngine.snooze(id)
 *   · 2건 이상이면 꼬리에 「이 밖에 N건 더」 한 마디. 페이저·스택·펼침 없음.
 *
 * 공개 API (window.EZSignalCard) — 호출자 보호를 위해 이름은 그대로 둔다
 *   slot(insts)             우하단 단일 슬롯. EZProactive.claim("ezs-slot") 경유
 *   render(inst)            한 줄 권유 1개 (구 카드 호출자용 얇은 대체)
 *   stack(insts)            한 줄 권유 목록 (같음)
 *   mount(el, insts)        el 비우고 stack() 부착
 *
 * 화면에 내지 않는 것 (R2) — 유형·처리 라벨과 코드, 근거 축 이름, 필드 경로,
 *   레코드 식별자. 금지어 목록은 이 파일에 적지 않고 카탈로그에서 읽어 온다.
 *   식별자는 사람이 읽는 이름(사원명·조직명·목표 제목)으로 바꿔서만 쓴다.
 *   B1의 EZSignalChat.scrub()이 있으면 그것이 단일 원천이고, 없으면 아래 폴백.
 *
 * 18-3차 검토 — 「열어보기」 옆에 화면 직행 버튼을 두지 않는다 (결정 기록)
 *   한 줄 권유에 「화면에서 볼게」를 하나 더 달면 (ㄱ) R7의 "한 줄"이 두 줄짜리
 *   버튼 행이 되고, (ㄴ) 아직 아무 이야기도 안 한 사람을 화면에 먼저 떨어뜨려
 *   R5의 "대화가 먼저"를 뒤집는다. 이동은 이야기를 해 본 다음에 필요해진다.
 *   그래서 경로를 하나로 둔다 — 열어보기 → 대화 → (원하면) 「화면에서 직접 고칠게」
 *   → EZSignalAct.openScreen()이 그 줄·그 칸까지 데려간다(18-3차 화면 인계).
 *
 * 루트는 `.ezs-slot` + data-astryx-theme="talenx"를 계속 지고 간다
 *   — tx_proactive.js SEL·tx_upgrade.js 겹침 판정·ez_kit.js AI_ROOTS가 이 두
 *     선택자를 그대로 쓴다.
 * ========================================================================== */
(function () {
  "use strict";
  if (window.EZSignalCard && window.EZSignalCard.__v2) return;

  var SLOT_ID = "ezs-slot";                 /* EZProactive 슬롯 키 (prio 4) */
  var CAP = 3;                              /* 목록 대체 렌더의 최대 줄 수 */

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function esc(s) {
    if (window.EZKit && typeof window.EZKit.esc === "function") return window.EZKit.esc(s);
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function data() { return window.TALENX_DATA || {}; }
  function catalog() {
    try {
      if (window.EZSignalEngine && window.EZSignalEngine.catalog) return window.EZSignalEngine.catalog() || {};
    } catch (e) { /* 무시 */ }
    return window.EZSignalCatalog || {};
  }

  /* ---------- inst 접근 — 엔진이 평탄하게 주든 signal을 품고 주든 둘 다 읽는다 ---------- */
  function fld(inst, key) {
    if (inst && inst[key] != null) return inst[key];
    var s = (inst && (inst.sig || inst.signal)) || {};
    return s[key] != null ? s[key] : null;
  }

  /* ======================================================================
     사람 말로 고치기 — 분류 이름·코드·필드 경로·식별자를 화면에서 지운다
     ====================================================================== */

  var ID_RE = /(EMP|ORG|OBJ|KR|JOB|TH)-[A-Za-z0-9가-힣_-]+/g;
  var FIELD_RE = /(objectives|keyResults|employees|orgs|jobProfiles|checkins|feedbacks|competency_profile)\.[A-Za-z_]+/g;

  function findBy(list, key, val, out) {
    var i;
    for (i = 0; i < (list || []).length; i++) {
      if (list[i] && list[i][key] === val) return list[i][out] || "";
    }
    return "";
  }

  /* 레코드 식별자 → 사람이 읽는 이름. 못 찾으면 지운다(코드를 그대로 내지 않는다). */
  function nameFor(id) {
    var d = data();
    if (/^EMP-/.test(id)) return findBy(d.employees, "emp_id", id, "name");
    if (/^ORG-/.test(id)) return findBy(d.orgs, "org_id", id, "name");
    if (/^OBJ-/.test(id)) return findBy(d.objectives, "objective_id", id, "title");
    if (/^KR-/.test(id)) return findBy(d.keyResults, "kr_id", id, "name");
    if (/^JOB-/.test(id)) {
      var jp = d.jobProfiles || {};
      return (jp[id] && jp[id].title) || "";
    }
    return "";                               /* 기준값 코드 등은 말할 것이 없다 */
  }

  /* 금지어는 카탈로그의 분류 이름표에서 그대로 읽는다 — 이 파일에 적어 두지 않는다. */
  function banList() {
    var c = catalog(), out = [], maps = [c.typeLabel, c.actionLabel], i, k, m;
    for (i = 0; i < maps.length; i++) {
      m = maps[i] || {};
      for (k in m) {
        if (!own(m, k)) continue;
        if (m[k]) out.push(String(m[k]));
        out.push(String(k));
      }
    }
    return out;
  }

  function tidy(t) {
    return String(t)
      .replace(/\(\s*\)/g, "")
      .replace(/\s*·\s*·\s*/g, " · ")
      .replace(/^\s*·\s*|\s*·\s*$/g, "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([,.])/g, "$1")
      .trim();
  }

  function localScrub(s) {
    var t = String(s == null ? "" : s);
    t = t.replace(ID_RE, function (m) { return nameFor(m); });
    t = t.replace(FIELD_RE, "");
    var ban = banList(), i;
    for (i = 0; i < ban.length; i++) {
      if (ban[i]) t = t.split(ban[i]).join("");
    }
    return tidy(t);
  }

  function scrub(s) {
    try {
      if (window.EZSignalChat && typeof window.EZSignalChat.scrub === "function") {
        return window.EZSignalChat.scrub(s);
      }
    } catch (e) { /* 폴백으로 내려간다 */ }
    return localScrub(s);
  }

  /* ======================================================================
     한 줄 권유
     ====================================================================== */

  function clean(insts) {
    var out = [], i;
    for (i = 0; i < (insts || []).length; i++) if (insts[i]) out.push(insts[i]);
    return out;
  }

  function lineOf(inst) {
    return scrub(fld(inst, "notice") || fld(inst, "agent") || "");
  }

  /* more = 이 줄 말고 남은 건수 */
  function nudgeEl(inst, more) {
    var lead = more > 0 ? "살펴볼 게 있어요" : "살펴볼 게 하나 있어요";
    var box = document.createElement("div");
    box.className = "ezs-nudge";
    box.innerHTML =
      '<p class="ezs-line"><span class="ezs-lead">' + esc(lead) + "</span> "
      + '<span class="ezs-tx">' + esc(lineOf(inst)) + "</span></p>"
      + '<p class="ezs-btns">'
      + '<button type="button" class="ezs-go" data-ezs-open>열어보기</button>'
      + '<button type="button" class="ezs-later" data-ezs-later>나중에</button>'
      + (more > 0 ? '<span class="ezs-more">이 밖에 ' + esc(more) + "건 더</span>" : "")
      + "</p>";
    box._inst = inst;
    return box;
  }

  function instOf(node) {
    var n = node && node.closest ? node.closest(".ezs-nudge") : null;
    return n ? n._inst : null;
  }

  function releaseSlot(acted) {
    if (window.EZProactive && typeof window.EZProactive.release === "function") {
      try { window.EZProactive.release(SLOT_ID, acted !== false); } catch (e) { /* 무시 */ }
    }
  }

  /* 한 줄을 치운다. 슬롯 안이면 슬롯째로 걷고 EZProactive에 반납한다. */
  function drop(node, acted) {
    var n = node && node.closest ? node.closest(".ezs-nudge") : null;
    if (!n) return;
    var sl = n.closest(".ezs-slot");
    if (sl) {
      if (sl.parentNode) sl.parentNode.removeChild(sl);
      releaseSlot(acted);
      return;
    }
    if (n.parentNode) n.parentNode.removeChild(n);
  }

  /* 「열어보기」 — 화면으로 튀지 않는다. 그 주제로 대화가 열린다. */
  function openChat(node) {
    var inst = instOf(node);
    var id = String(fld(inst, "id") || "");
    var sent = lineOf(inst);
    drop(node, true);
    try { if (window.Elizax && window.Elizax.open) window.Elizax.open(); } catch (e) { /* 무시 */ }
    try {
      if (id && window.EZSignalChat && typeof window.EZSignalChat.ask === "function") {
        window.EZSignalChat.ask(id);
        return;
      }
    } catch (e2) { /* 아래 폴백 */ }
    try {
      if (window.Elizax && window.Elizax.send) { window.Elizax.send(sent); return; }
      if (window.Elizax && window.Elizax.sendRaw) { window.Elizax.sendRaw(sent); return; }
    } catch (e3) { /* 무시 */ }
    console.warn("[EZSignalCard] 대화 진입점이 없어 「열어보기」가 열 곳이 없습니다.");
  }

  /* 「나중에」 — 신호별 재알림 간격만큼 미룬다 */
  function later(node) {
    var inst = instOf(node);
    var id = String(fld(inst, "id") || "");
    if (id && window.EZSignalEngine && typeof window.EZSignalEngine.snooze === "function") {
      try { window.EZSignalEngine.snooze(id); } catch (e) { /* 무시 */ }
    }
    drop(node, false);
  }

  function onClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest("[data-ezs-open]")) { openChat(t); e.preventDefault(); return; }
    if (t.closest("[data-ezs-later]")) { later(t); e.preventDefault(); }
  }

  function wire(root) {
    if (!root || root._ezsWired) return root;
    root._ezsWired = true;
    root.addEventListener("click", onClick);
    return root;
  }

  /* ======================================================================
     우하단 단일 슬롯
     ====================================================================== */

  function killSlot() {
    var old = document.querySelector(".ezs-slot");
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }

  function slot(insts) {
    var list = clean(insts);
    killSlot();
    if (!list.length) return null;
    var box = document.createElement("div");
    box.className = "ezs-slot";
    box.setAttribute("data-astryx-theme", "talenx");
    box.appendChild(nudgeEl(list[0], list.length - 1));
    if (window.EZProactive && typeof window.EZProactive.claim === "function") {
      if (window.EZProactive.claim(SLOT_ID, killSlot) === false) return null;
    }
    document.body.appendChild(box);
    wire(box);
    box.classList.add("ezs-in");           /* 등장 모션 — ez_kit.css ezkInsert */
    watchPanel();                          /* 대화가 열리면 권유는 물러난다 */
    return box;
  }

  /* 대화 패널이 열리면 우하단 권유를 거둔다 — 같은 알림이 두 곳에 동시에 보이지 않게 한다.
     tx_agent 쪽 가드는 「띄우기 전」만 막으므로, 이미 떠 있는 경우는 여기서 거둔다. */
  var panelWatch = null;
  function watchPanel() {
    if (panelWatch) return;
    panelWatch = setInterval(function () {
      if (!document.querySelector(".ezs-slot")) {          /* 이미 사라졌다 */
        clearInterval(panelWatch); panelWatch = null; return;
      }
      if (document.querySelector(".ezx-root.ezx-open")) {
        clearInterval(panelWatch); panelWatch = null;
        releaseSlot(false);                                 /* 처리한 것이 아니라 물러난 것 */
        killSlot();
      }
    }, 300);
  }

  /* ======================================================================
     구 카드 호출자용 얇은 대체 — 카드 해부는 남기지 않는다
     ====================================================================== */

  function stack(insts) {
    var list = clean(insts), i;
    if (!list.length) return null;
    var host = document.createElement("div");
    host.className = "ezs-nudges";
    host.setAttribute("data-astryx-theme", "talenx");
    for (i = 0; i < list.length && i < CAP; i++) host.appendChild(nudgeEl(list[i], 0));
    return wire(host);
  }

  function render(inst) {
    if (!inst) return null;
    var host = document.createElement("div");
    host.className = "ezs-nudges";
    host.setAttribute("data-astryx-theme", "talenx");
    host.appendChild(nudgeEl(inst, 0));
    return wire(host);
  }

  function mount(el, insts) {
    if (!el) return null;
    el.innerHTML = "";
    var s = stack(insts);
    if (s) el.appendChild(s);
    return el;
  }

  window.EZSignalCard = {
    __v2: true,
    slot: slot,
    render: render,
    stack: stack,
    mount: mount,
    /* 내부 노출 — 하네스/디버그용. 계약이 아니다. */
    _scrub: scrub
  };
})();
