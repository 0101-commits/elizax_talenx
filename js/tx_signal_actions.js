/* ============================================================================
 * tx_signal_actions.js — 알림 처리 배선 (window.EZSignalAct) · 18-2차 R5 (B3)
 * ----------------------------------------------------------------------------
 * 목적
 *   18-2차부터 **기본은 대화 안에서 끝낸다.** 알림을 눌렀다고 화면이 튀지 않는다.
 *   run()은 초안·계산·비교를 대화 한 턴으로 돌려주고, 화면 이동은 사용자가
 *   「자세히」·「화면에서 고칠게」처럼 실제로 요청했을 때만 openScreen()이 한다.
 *   이미 있는 기능만 켠다 — 새 화면·새 폼·새 저장소를 만들지 않는다.
 *   가짜 성공(토스트만 띄우고 아무 일도 안 하는 것)을 만들지 않는다.
 *
 * 공개 API
 *   EZSignalAct.run(inst, i, text)        대화 안에서 해결 (기본 경로)
 *   EZSignalAct.openScreen(inst, i, text) 화면으로 데려가는 명시 경로
 *   EZSignalAct.fromText(inst, text)      사용자 말 한 줄 → 위 둘 중 하나로 라우팅
 *   EZSignalAct.wantsScreen(text)         화면으로 가겠다는 말인지 (EZNav.resolve 재사용)
 *   EZSignalAct.ask(inst)                 근거를 그대로 대화로 보낸다
 *   EZSignalAct.actionAt(inst, i)         정규화된 actions[i] (없으면 null)
 *   EZSignalAct.signalOf(inst)            카탈로그 신호 원본 (없으면 null)
 *   EZSignalAct.resolveScreen(inst)       {s, p} 화면 좌표 (라이브 점검용)
 *   EZSignalAct.targetOf(inst, i)         {s, p, how, reachable, why} 진입점 사전 해석
 *   EZSignalAct.reach(inst, i)            {ok, chat, why} 갈 곳이 정말 있는가
 *
 * 18-3차 개정 — 화면 인계(handoff)를 제대로 만든다
 *   사용자 지시: "인라인으로 한 후에 자세히 확인하고 싶으면 관련 화면으로 넘어가야
 *   하는데 그 기능은 어떻게 된거야? 그 기능 고도화해줘."
 *   ① 정확한 자리에 내린다 — 화면·오버레이가 아니라 그 줄·그 칸까지 스크롤 + 강조
 *      (land · landInModal). 목표 상세는 핵심 성과 표, 체크인은 값 입력칸,
 *      가중치는 첫 가중치 칸, 본인 평가는 첫 입력칸이 착지점이다.
 *   ② 맥락을 들고 간다 — 채팅에서 나온 제안을 착지 지점 맨 위 쪽지로 옮긴다
 *      (carryNote · proposalOf). 칸에 프리필이 되는 경우는 쪽지에 문안을 겹쳐
 *      쓰지 않고 돌아갈 길만 둔다.
 *   ③ 돌아갈 길을 남긴다 — 쪽지의 「대화로 돌아가기」가 같은 대화를 다시 연다
 *      (Elizax.open + showTab("chat")). 새 오버레이를 만들지 않는다.
 *   ④ 갈 곳이 없으면 가지 않는다 — reach()가 먼저 판단하고, 안 되면 이유를
 *      대화에 한 문장으로 적고 그 자리에 머문다. 대상 목표를 바꿔 열었을 때도
 *      saySwap()이 대화에 남긴다(토스트만으로 흘리지 않는다).
 *   R5는 그대로다 — run()은 대화에 머물고, openScreen()만 이동하며, 이동만 한
 *   경우에는 신호를 해제하지 않는다.
 *
 * 처리 종류 6가지(카탈로그 내부 코드는 화면에 내지 않는다) → 실제 진입점
 * ┌────┬────────────┬────────────────────────────────────────────────────────┐
 * │ 1  │초안 작성   │목표: #s-perf `[data-txf="anchor-airec"]`               │
 * │    │            │      = openNew()+초안 생성 (tx_fix_perf.js:2489)        │
 * │    │            │      오버레이 자체 = openNew (tx_fix_perf.js:1876)      │
 * │    │            │      프리필 `[data-txf="new-name"]`/`new-desc` (:1843·1846)│
 * │    │            │체크인: `[data-txf="anchor-aick"]`                      │
 * │    │            │      → openCheckinModal(o,true) (tx_fix_perf.js:2501)   │
 * │    │            │본인 평가: #s-appr `[data-pane="0"] .txfw-form`          │
 * │    │            │      = writeFormBody(emp,'self') (tx_fix_appr.js:361)   │
 * │    │            │      AI 근거초안 `[data-txdr="gen"]` (tx_fix_appr.js:620)│
 * ├────┼────────────┼────────────────────────────────────────────────────────┤
 * │ 2  │직접 수정   │가중치: `[data-txf="weight"]`                            │
 * │    │            │      → openWeightEditor() (tx_fix_perf.js:2519·1915)    │
 * │    │            │실적값·진척: 위 체크인 모달(현재값 입력칸이 그 자리)     │
 * │    │            │본인 평가: 위 인라인 폼(같은 폼이 수정 자리)             │
 * │    │            │목표·연결: `.grow[data-oid]`·`.mg.txf-exp[data-oid]`     │
 * │    │            │      → openGoalDetail() = `.txf-ov` (tx_fix_perf.js:    │
 * │    │            │      2671·2665·2290)                                    │
 * ├────┼────────────┼────────────────────────────────────────────────────────┤
 * │ 3  │전달        │TX.modal 발송 폼 (js/ui_kit.js:26) →                     │
 * │    │            │  받는 사람 성과 기록 = EZLedger.add({emp_id:…})         │
 * │    │            │  (tx_ctx_ledger.js:498·456 — 개인별 전달 계약)          │
 * │    │            │  + EZNotif.push (tx_elizax.js:131) 알림 기록            │
 * ├────┼────────────┼────────────────────────────────────────────────────────┤
 * │ 4  │1:1 안건    │localStorage `elizax_1on1_v1:<emp>`.nextAgenda 이월      │
 * │    │            │  (tx_1on1.js:62·201·1142) → EZOneOnOne.start()          │
 * │    │            │  (tx_1on1.js:1195·636) → `[data-ez1o-agin]` 프리필(:632)│
 * ├────┼────────────┼────────────────────────────────────────────────────────┤
 * │ 5  │화면 열기   │EZNav.go(s,p) (tx_nav.js:84·118). 기록·해제 없음         │
 * ├────┼────────────┼────────────────────────────────────────────────────────┤
 * │ 6  │결재 올리기 │체크인: 위 체크인 모달의 결재 버튼                       │
 * │    │            │  → ckSave → sessionStorage `txf_ckreq_<oid>`            │
 * │    │            │  (tx_fix_perf.js:2126 / 규약 tx_inbox.js:82·145)        │
 * │    │            │그 외: sessionStorage `txf_ibreq_<id>` 직접 생성         │
 * │    │            │  (규약 tx_inbox.js:83·108·175) → 조직장 결재 대기함     │
 * └────┴────────────┴────────────────────────────────────────────────────────┘
 * 기록이 실제로 남는 처리(3·4·6)만 확인을 받고, 끝나면
 *   EZSignalEngine.resolve(id,"acted") + TX.toast(done.title) + `ez:ctx` 1건.
 * 초안만 보여 주거나 화면만 여는 것은 **신호를 해제하지 않는다.**
 *
 * 화면에 내지 않는 것 (18-2차 R2)
 *   분류 이름표·코드, 근거 축 이름, 필드 경로, 레코드 식별자. 식별자가 꼭 필요하면
 *   사람이 읽는 이름(사원명·조직명·목표 제목)으로 바꿔 쓴다. 금지어 목록은 이 파일에
 *   적지 않고 카탈로그에서 읽거나 B1의 EZSignalChat.scrub()에 맡긴다.
 *
 * 규칙
 *   - ES5 IIFE. let/const/화살표/템플릿리터럴 없음.
 *   - 외부 전역(EZNav·EZSignalEngine·EZSignalChat·EZAI·EZOneOnOne·EZLedger·
 *     EZNotif·TX·TXRoles)은 전부 없을 수 있다 — 모두 guard, 절대 throw하지 않는다.
 *   - 데이터 준비가 안 된 신호는 화면 열기만 허용. 나머지는 정직하게 거절.
 * ========================================================================== */
(function () {
  "use strict";
  if (window.EZSignalAct) return;

  /* ======================================================================
     0) 얇은 유틸 — 전역 부재를 전부 흡수한다
     ====================================================================== */

  function esc(s) {
    if (window.TX && TX.esc) return TX.esc(s);
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function toast(msg, kind) {
    try { if (window.TX && TX.toast) TX.toast(String(msg || ""), kind || ""); }
    catch (e) { /* 토스트 부재 — 무해화 */ }
  }

  function data() { return window.TALENX_DATA || {}; }
  function cu() { var d = data(); return (d.meta && d.meta.currentUser) || {}; }

  /* 롤 키 — 18차 §9 공통 패턴 */
  function roleKey() {
    var CU = cu();
    if (CU._role) return CU._role;
    try {
      if (window.TXRoles && TXRoles.current && TXRoles.current()) return TXRoles.current().key;
    } catch (e) { /* 무시 */ }
    return "member";
  }

  function catalog() {
    try {
      if (window.EZSignalEngine && EZSignalEngine.catalog) return EZSignalEngine.catalog() || {};
    } catch (e) { /* 무시 */ }
    return window.EZSignalCatalog || {};
  }

  /* 카탈로그 처리 코드 → 1~6 숫자. 코드 문자열을 화면·분기 어디에도 남기지 않는다. */
  function actNo(act) {
    var n = parseInt(String((act && act.type) || "").replace(/[^0-9]/g, ""), 10);
    return isNaN(n) ? 0 : n;
  }

  /* ======================================================================
     0-2) 사람 말로 고치기 — 분류 이름·코드·필드 경로·식별자를 화면에서 지운다
     ====================================================================== */

  var ID_RE = /(EMP|ORG|OBJ|KR|JOB|TH)-[A-Za-z0-9가-힣_-]+/g;
  var FIELD_RE = /(objectives|keyResults|employees|orgs|jobProfiles|checkins|feedbacks|competency_profile)\.[A-Za-z_]+/g;
  var EDIT_TAIL = /\s*\(\s*수정할 수 있어요\s*\)\s*$/;

  function findBy(list, key, val, out) {
    var i;
    for (i = 0; i < (list || []).length; i++) {
      if (list[i] && list[i][key] === val) return list[i][out] || "";
    }
    return "";
  }

  /* 레코드 식별자 → 사람이 읽는 이름. 못 찾으면 지운다(코드를 그대로 내지 않는다). */
  function humanName(id) {
    var d = data();
    if (/^EMP-/.test(id)) return findBy(d.employees, "emp_id", id, "name");
    if (/^ORG-/.test(id)) return findBy(d.orgs, "org_id", id, "name");
    if (/^OBJ-/.test(id)) return findBy(d.objectives, "objective_id", id, "title");
    if (/^KR-/.test(id)) return findBy(d.keyResults, "kr_id", id, "name");
    if (/^JOB-/.test(id)) {
      var jp = d.jobProfiles || {};
      return (jp[id] && jp[id].title) || "";
    }
    return "";
  }

  /* 목표 제목 — 화면·기록에 목표를 가리켜야 할 때 코드 대신 이것을 쓴다 */
  function titleOf(oid) {
    if (!oid) return "";
    return humanName(oid) || "";
  }

  /* 금지어는 카탈로그의 분류 이름표에서 읽는다 — 이 파일에 적어 두지 않는다. */
  function banList() {
    var c = catalog(), out = [], maps = [c.typeLabel, c.actionLabel], i, k, m;
    for (i = 0; i < maps.length; i++) {
      m = maps[i] || {};
      for (k in m) {
        if (!Object.prototype.hasOwnProperty.call(m, k)) continue;
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
    t = t.replace(ID_RE, function (m) { return humanName(m); });
    t = t.replace(FIELD_RE, "");
    var ban = banList(), i;
    for (i = 0; i < ban.length; i++) if (ban[i]) t = t.split(ban[i]).join("");
    return tidy(t);
  }

  /* B1의 EZSignalChat.scrub()이 단일 원천. 없으면 위 폴백. */
  function scrub(s) {
    try {
      if (window.EZSignalChat && typeof EZSignalChat.scrub === "function") return EZSignalChat.scrub(s);
    } catch (e) { /* 폴백으로 내려간다 */ }
    return localScrub(s);
  }

  /* 처리 한 건을 사람 말로 부르는 이름. 분류 이름표(kind)는 버린다. */
  function actName(sig, act) {
    var s = scrub(String((act && act.label) || "").replace(EDIT_TAIL, ""));
    if (s) return s;
    return scrub(String((sig && sig.notice) || "")) || "알림";
  }

  /* 요소가 늦게 생기는 화면(오버레이·서브페이지 재렌더)을 위한 짧은 폴링 */
  function waitFor(sel, tries, cb) {
    var n = 0, max = tries || 14;
    (function poll() {
      var el = null;
      try { el = document.querySelector(sel); } catch (e) { el = null; }
      if (el) { cb(el); return; }
      if (++n >= max) { cb(null); return; }
      setTimeout(poll, 90);
    })();
  }

  function clickWhenReady(sel, tries, cb) {
    waitFor(sel, tries, function (el) {
      if (el) { try { el.click(); } catch (e) { /* 무시 */ } }
      if (cb) cb(el);
    });
  }

  function scrollTo(el) {
    if (!el) return;
    try { el.scrollIntoView({ block: "center", behavior: "smooth" }); }
    catch (e) { try { el.scrollIntoView(); } catch (e2) { /* 무시 */ } }
  }

  /* 착지 지점을 눈으로 알 수 있게 짧게 강조 — 자체 스타일 1회 주입 */
  function styleOnce() {
    if (document.getElementById("ezsa-style")) return;
    var st = document.createElement("style");
    st.id = "ezsa-style";
    st.textContent =
      ".ezsa-hl{animation:ezsaHl 1.8s ease-out 1;border-radius:10px}" +
      "@keyframes ezsaHl{0%{box-shadow:0 0 0 3px var(--color-accent,#1F7AF0)}" +
      "70%{box-shadow:0 0 0 3px var(--color-accent,#1F7AF0)}100%{box-shadow:0 0 0 0 transparent}}" +
      ".ezsa-draft{width:100%;min-height:150px;border:1px solid var(--color-border,#e0e0e0);" +
      "border-radius:10px;padding:11px;font:inherit;font-size:13px;line-height:1.7;resize:vertical}" +
      ".ezsa-note{font-size:12px;line-height:1.7;color:var(--color-text-secondary,#5C6474);margin-bottom:9px}" +
      ".ezsa-chips{display:flex;flex-wrap:wrap;gap:6px;margin:9px 0 2px}" +
      ".ezsa-chip{font-size:11.5px;font-weight:700;border-radius:999px;padding:4px 11px;cursor:pointer;" +
      "border:1px solid var(--color-border-emphasized,#c9d3e4);background:transparent;" +
      "color:var(--color-text-accent,#1F7AF0)}" +
      ".ezsa-ev{font-size:11.5px;line-height:1.7;color:var(--color-text-secondary,#5C6474);margin-top:9px}" +
      /* 착지 쪽지 — 화면 안에 흐름대로 끼워 넣는다(떠 있는 층을 새로 만들지 않으므로 z 값이 없다) */
      ".ezsa-carry{margin:0 0 11px;padding:10px 13px;border:1px solid var(--color-border-blue);" +
      "background:var(--color-background-blue);border-radius:var(--radius-container)}" +
      ".ezsa-carry p{margin:0}" +
      ".ezsa-carry-l{font-size:12.5px;line-height:1.6;color:var(--color-text-primary)}" +
      ".ezsa-carry-q{margin-top:8px;padding:8px 10px;border:1px solid var(--color-border);" +
      "background:var(--color-background-card);border-radius:var(--radius-element);font-size:12.5px;" +
      "line-height:1.7;color:var(--color-text-primary);white-space:pre-wrap;max-height:132px;overflow:auto}" +
      ".ezsa-carry-b{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}" +
      ".ezsa-carry-b button{font:inherit;font-size:11.5px;line-height:1.4;padding:4px 11px;cursor:pointer;" +
      "border-radius:var(--radius-full);border:1px solid var(--color-border);" +
      "background:var(--color-background-card);color:var(--color-accent)}" +
      ".ezsa-carry-b button:hover{background:var(--color-background-muted);border-color:var(--color-accent)}";
    document.head.appendChild(st);
  }

  function highlight(el) {
    if (!el) return;
    styleOnce();
    el.classList.add("ezsa-hl");
    setTimeout(function () { try { el.classList.remove("ezsa-hl"); } catch (e) { /* 무시 */ } }, 2000);
  }

  /* ======================================================================
     0-3) 착지 — 정확한 자리 + 옮겨 온 제안 + 대화로 돌아가는 길
     ----------------------------------------------------------------------
     화면으로 넘어간 다음이 원래 허술했다. 화면만 열고 끝내면 사용자는 (ㄱ) 어디를
     고쳐야 하는지, (ㄴ) 대화에서 무슨 얘기가 나왔는지, (ㄷ) 어떻게 돌아가는지를
     스스로 기억해야 한다. land()가 셋을 한 번에 처리한다.
       target → 그 줄·그 칸까지 스크롤 + 1.8초 강조
       host   → 그 안 맨 위에 착지 쪽지(왜 왔는지 · 대화에서 제안한 내용 ·
                「대화로 돌아가기」). 쪽지는 흐름 안에 끼우므로 새 층이 아니다.
     TXFIX(js/tx_fix_common.js)에 스크롤·강조 헬퍼가 있는지 먼저 확인했다 —
     D · CU · emp · org · teamName · nameTeam · avatarColor · avatar · initial ·
     won · pad2 · ready · onSection 뿐이고 강조·스크롤은 없다.
     그래서 이 파일의 scrollTo · highlight를 계속 쓴다.
     ====================================================================== */

  var CARRY_ID = "ezsa-carry";
  var carryWired = false;

  /* 대화의 마지막 답변 — 「대화에서 제안한 내용」의 원천 */
  function lastAnswer() {
    try {
      if (!window.EZChat || !EZChat.messages) return "";
      var arr = EZChat.messages() || [], i, m;
      for (i = arr.length - 1; i >= 0; i--) {
        m = arr[i];
        if (m && m.role === "ai" && m.text) return String(m.text);
      }
    } catch (e) { /* 무시 */ }
    return "";
  }

  /* 화면으로 들고 갈 제안. 처리 문안이 있으면 그것이 가장 구체적이고,
     없으면 방금 답변을 옮긴다. 지어내지 않는다 — 둘 다 없으면 빈 문자열. */
  function proposalOf(inst, act) {
    var t = scrub(String((act && act.draft) || ""));
    if (!t) t = scrub(lastAnswer());
    t = String(t || "").replace(/\s+$/, "");
    if (t.length > 420) t = t.slice(0, 420) + "…";
    return t;
  }

  /* 쪽지를 끼워도 안전한 그릇인지 — 표 내부(tr/tbody/table)에는 넣지 않는다 */
  function safeHost(el) {
    if (!el || el.nodeType !== 1) return null;
    var tag = String(el.tagName || "").toUpperCase();
    if (tag === "TABLE" || tag === "TBODY" || tag === "THEAD" || tag === "TR" || tag === "TD" || tag === "TH") return null;
    return el;
  }

  function dropCarry() {
    var old = document.getElementById(CARRY_ID);
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }

  /* 「대화로 돌아가기」·「문안 복사」·「닫기」 — 위임 1회 */
  function wireCarry() {
    if (carryWired) return;
    carryWired = true;
    document.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      if (t.closest("[data-ezsa-back]")) {
        ev.preventDefault();
        /* 같은 대화 그대로 다시 연다 — 새 창을 만들지 않는다 */
        try { if (window.Elizax && Elizax.open) Elizax.open(); } catch (e) { /* 무시 */ }
        try { if (window.Elizax && Elizax.showTab) Elizax.showTab("chat"); } catch (e2) { /* 무시 */ }
        dropCarry();
        return;
      }
      if (t.closest("[data-ezsa-carry-copy]")) {
        ev.preventDefault();
        var q = document.querySelector("#" + CARRY_ID + " .ezsa-carry-q");
        copyText(q ? q.textContent : "");
        return;
      }
      if (t.closest("[data-ezsa-carry-x]")) { ev.preventDefault(); dropCarry(); }
    }, false);
  }

  /* host 맨 위에 착지 쪽지 하나. 화면당 항상 한 장만 둔다. */
  function carryNote(host, line, proposal) {
    var h = safeHost(host);
    if (!h) return null;
    styleOnce();
    wireCarry();
    dropCarry();
    var box = document.createElement("div");
    box.id = CARRY_ID;
    box.className = "ezsa-carry";
    /* TX.modal은 talenx 오버레이 루트에 붙는다 — 토큰 스코프를 직접 진다 */
    box.setAttribute("data-astryx-theme", "talenx");
    var p = scrub(String(proposal || ""));
    box.innerHTML =
      '<p class="ezsa-carry-l">' + esc(scrub(line || "여기가 고치는 자리예요.")) + "</p>" +
      (p ? '<p class="ezsa-carry-q">' + esc(p) + "</p>" : "") +
      '<p class="ezsa-carry-b">' +
      '<button type="button" data-ezsa-back>대화로 돌아가기</button>' +
      (p ? '<button type="button" data-ezsa-carry-copy>문안 복사</button>' : "") +
      '<button type="button" data-ezsa-carry-x>닫기</button>' +
      "</p>";
    if (h.firstChild) h.insertBefore(box, h.firstChild);
    else h.appendChild(box);
    return box;
  }

  /* 쪽지를 둘 그릇 — 착지 지점을 품은 가장 가까운 카드. 화면 맨 위에 두면 정작
     스크롤이 내려가면서 쪽지가 위로 사라진다(라이브 확인). 그래서 「그 표가 있는
     카드」 안에 둬서 착지 지점과 쪽지가 늘 같이 보이게 한다. */
  function hostFor(target, fallback) {
    var h = null;
    try { h = target && target.closest ? target.closest(".txf-fcard, .tx-mbody, .txfw-form") : null; }
    catch (e) { h = null; }
    return safeHost(h) || safeHost(fallback) || null;
  }

  /* 아직 화면 밖이면 즉시 끌어온다. 부드러운 스크롤은 뒤에 오는 재렌더·쪽지 삽입에
     밀려 취소되는 일이 있었다(라이브 확인: 목표 상세에서 핵심 성과 표가 화면 밖에
     남아 스크롤이 0으로 돌아갔다). 그래서 마지막 확인만은 즉시 스크롤로 못박는다. */
  function scrollNow(el) {
    if (!el) return;
    try { el.scrollIntoView({ block: "center" }); }
    catch (e) { try { el.scrollIntoView(); } catch (e2) { /* 무시 */ } }
  }

  function ensureInView(el) {
    if (!el || !el.getBoundingClientRect) return;
    var r;
    try { r = el.getBoundingClientRect(); } catch (e) { return; }
    var h = window.innerHeight || 800;
    if (r.top >= 56 && r.top <= h * 0.7) return;      /* 이미 눈에 들어와 있다 */
    scrollNow(el);
  }

  /* o: {host, target, line, proposal} — target을 못 찾으면 host를 강조한다.
     여기서는 부드러운 스크롤을 쓰지 않는다 — 애니메이션이 진행되는 동안 쪽지가
     끼어들면서 애니메이션이 나중에 착지해 보정 스크롤을 덮어썼다(라이브 확인). */
  function land(o) {
    o = o || {};
    var t = o.target || o.host || null;
    if (t) { scrollNow(t); highlight(t); }
    if (o.host) carryNote(o.host, o.line, o.proposal);
    /* 쪽지가 위쪽에 끼면서 target이 화면 밖으로 밀릴 수 있다 — 두 번 더 맞춘다 */
    if (t && t !== o.host) {
      setTimeout(function () { ensureInView(t); }, 90);
      setTimeout(function () { ensureInView(t); }, 320);
    }
  }

  /* ======================================================================
     1) inst 정규화 — W1 엔진의 인스턴스 형태에 흔들리지 않게
     ====================================================================== */

  /* inst는 엔진(§4)이 만든다. 카탈로그 원본이 inst 자체일 수도, inst.sig·
     inst.signal·inst.catalog에 들어 있을 수도 있어 전부 받아준다. 마지막 폴백은
     id로 카탈로그를 다시 찾는 것 — 어떤 경우에도 null을 조용히 삼키지 않는다. */
  function signalOf(inst) {
    if (!inst) return null;
    var cand = [inst.sig, inst.signal, inst.catalog, inst.def, inst];
    var i, c;
    for (i = 0; i < cand.length; i++) {
      c = cand[i];
      if (c && c.id && (c.actions || c.notice)) return c;
    }
    var id = inst.id || (inst.sig && inst.sig.id);
    if (!id) return null;
    var list = catalog().signals || [];
    for (i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }

  function actionsOf(inst) {
    var sig = signalOf(inst);
    if (inst && inst.actions && inst.actions.length) return inst.actions;
    if (sig && sig.actions && sig.actions.length) return sig.actions;
    return [];
  }

  /* actionIdx는 카드의 data-ezs-act 값. inst.action(단수)만 준 호출도 받아준다. */
  function actionAt(inst, idx) {
    if (inst && inst.action && (idx == null || idx === 0)) return inst.action;
    var acts = actionsOf(inst);
    var i = parseInt(idx, 10);
    if (isNaN(i)) i = 0;
    return acts[i] || acts[0] || (inst && inst.action) || null;
  }

  /* ---- 처리 대상 분류 ----------------------------------------------------
     1차 기준은 `store`(그 처리가 실제로 저장하는 것)·`label`·`kind`뿐이다.
     `notice`를 같이 섞으면 오배선이 난다 — 실측 확인: 한 체크인 신호의
     notice에 "가중치 합은 65%"가 들어 있어, 핵심결과 직접 수정이 가중치 편집기로
     끌려갔다. notice·stage는 store가 아무것도 말해주지 않을 때만 2차로 본다. */
  var CLS_RE = {
    self:     /자기\s*평가|본인\s*평가|평가\s*의견/,
    checkin:  /체크인|실적값|진척|진행률/,
    weight:   /가중치/,
    meeting:  /안건|일정|회의|1\s*(:|on|온)\s*1|미팅/,
    feedback: /피드백/,
    goal:     /목표|핵심결과|핵심\s*성과|KR/
  };
  /* 판정 순서 — 좁은 것부터. goal이 가장 넓으므로 마지막. */
  var CLS_ORDER = ["self", "checkin", "weight", "meeting", "feedback", "goal"];

  function classify(inst, act) {
    var sig = signalOf(inst) || {};
    var t1 = [act && act.store, act && act.label, act && act.kind].join(" ");
    var t2 = [sig.stage, sig.notice].join(" ");
    var i;
    for (i = 0; i < CLS_ORDER.length; i++) if (CLS_RE[CLS_ORDER[i]].test(t1)) return CLS_ORDER[i];
    for (i = 0; i < CLS_ORDER.length; i++) if (CLS_RE[CLS_ORDER[i]].test(t2)) return CLS_ORDER[i];
    return "goal";
  }

  /* ======================================================================
     2) 화면 좌표 — stage → GNB/서브탭
     ====================================================================== */

  /* 카탈로그 stageNo(1~4)로 잡는다 — 단계 이름 문자열을 코드에 심지 않는다. */
  var STAGE_SCREEN = {
    1: { s: "perf", p: 0 },
    2: { s: "perf", p: 0 },
    3: { s: "appr", p: 0 },
    4: { s: "perf", p: 1 }
  };

  function resolveScreen(inst, act) {
    var sig = signalOf(inst) || {};
    var cls = classify(inst, act || null);
    if (cls === "self") return { s: "appr", p: 0 };
    if (cls === "meeting") return { s: "perf", p: 2 };
    if (cls === "feedback") return { s: "perf", p: 1 };
    return STAGE_SCREEN[sig.stageNo] || { s: "perf", p: 0 };
  }

  /* EZNav.go 우선. 없으면 GNB 버튼을 직접 눌러 같은 결과를 만든다. */
  function nav(s, p, cb) {
    var ok = false;
    try { if (window.EZNav && EZNav.go) ok = !!EZNav.go(s, p); } catch (e) { ok = false; }
    if (!ok) {
      var b = document.querySelector('#gnb [data-s="' + s + '"]') ||
              document.querySelector('[data-s="' + s + '"]');
      if (b) {
        try { b.click(); ok = true; } catch (e2) { /* 무시 */ }
        if (ok && p != null) {
          setTimeout(function () {
            var a = document.querySelector("#s-" + s + ' .subnav a[data-p="' + p + '"]');
            if (a) { try { a.click(); } catch (e3) { /* 무시 */ } }
          }, 70);
        }
      }
    }
    if (cb) setTimeout(function () { cb(ok); }, ok ? 280 : 60);
    return ok;
  }

  /* ======================================================================
     3) 대상 레코드 추정 — 근거의 src에 실 레코드 id가 박혀 있다
     ====================================================================== */

  function evidenceOf(inst) {
    var sig = signalOf(inst) || {};
    if (inst && inst.evidence && inst.evidence.length) return inst.evidence;
    return sig.evidence || [];
  }

  function scanId(inst, re) {
    var evs = evidenceOf(inst), i, m;
    for (i = 0; i < evs.length; i++) {
      m = re.exec(String((evs[i] && evs[i].src) || "") + " " + String((evs[i] && evs[i].text) || ""));
      if (m) return m[0];
      re.lastIndex = 0;
    }
    var f = (inst && inst.facts) || {};
    var k;
    for (k in f) {
      if (!Object.prototype.hasOwnProperty.call(f, k)) continue;
      m = re.exec(String(f[k]));
      if (m) return m[0];
      re.lastIndex = 0;
    }
    return null;
  }

  function myObjectives() {
    var d = data(), CU = cu();
    return (d.objectives || []).filter(function (o) {
      return o && o.owner_emp_id && CU.emp_id && o.owner_emp_id === CU.emp_id;
    });
  }

  /* 신호가 가리키는 목표 id. 근거에 없으면 내 목표 첫 건(없으면 null). */
  function pickObjectiveId(inst) {
    var id = scanId(inst, /OBJ-[A-Za-z0-9_-]+/);
    if (id) {
      var d = data(), i;
      for (i = 0; i < (d.objectives || []).length; i++) {
        if (d.objectives[i].objective_id === id) return id;
      }
    }
    var mine = myObjectives();
    return mine.length ? mine[0].objective_id : null;
  }

  /* ======================================================================
     4) 마무리 — 해제 + 토스트 + 원장 1건
     ====================================================================== */

  var LEDGER_TYPE = { 1: "goal", 2: "checkin", 3: "eval", 4: "feedback" };

  function ledgerType(sig, act) {
    if (actNo(act) === 4) return "oneonone";
    return LEDGER_TYPE[sig && sig.stageNo] || "goal";
  }

  /* ez:ctx 1건 — 페이로드 형태는 tx_inbox.js:347 발행부를 그대로 따른다.
     source는 표시 문구가 아니라 조인 키다(tx_ctx_ledger.js:492). 신호 번호만 쓴다
     — 신호 id에는 단계·주체 이름이 박혀 있어 화면에 새면 안 된다. */
  function record(inst, sig, act, summary) {
    var detail = {
      type: ledgerType(sig, act),
      source: "signal." + (sig.no || 0) + ".a" + actNo(act),
      title: "알림 처리 — " + actName(sig, act),
      summary: scrub(String(summary || sig.notice || "")),
      weight: 2
    };
    try {
      document.dispatchEvent(new CustomEvent("ez:ctx", { detail: detail }));
    } catch (e) { /* 수신자 없어도 발행만 — 구형 브라우저 무시 */ }
  }

  function resolveSignal(sig) {
    try {
      if (window.EZSignalEngine && EZSignalEngine.resolve) EZSignalEngine.resolve(sig.id, "acted");
    } catch (e) { /* 엔진 미로드 — 무해화 */ }
  }

  /* 실제로 기록이 남은 처리의 착지 — 여기서만 신호를 해제한다 */
  function finish(inst, sig, act, summary) {
    resolveSignal(sig);
    var done = (inst && inst.done) || sig.done || {};
    toast(scrub(done.title || "처리했어요."), "ok");
    record(inst, sig, act, summary);
  }

  /* 화면만 열었거나 초안만 보여 준 경우 — 기록은 남기고 신호는 그대로 둔다.
     (실제 저장이 아직 없는데 해제하면 처리한 척이 된다) */
  function noted(inst, sig, act, summary, say) {
    if (say) toast(scrub(say), "");
    record(inst, sig, act, summary);
  }

  /* ======================================================================
     5) 폴백 — 초안 모달 (진입점이 없을 때만. 가짜 성공을 만들지 않는다)
     ====================================================================== */

  /* opts: {title, note, text, chips[], inst, sig, act, onSubmit(text), submitLabel} */
  function openDraftModal(opts) {
    opts = opts || {};
    styleOnce();
    var box = document.createElement("div");
    var chipsHTML = "";
    var chips = opts.chips || [];
    if (chips.length) {
      chipsHTML = '<div class="ezsa-chips">';
      for (var i = 0; i < chips.length; i++) {
        chipsHTML += '<button type="button" class="ezsa-chip" data-ezsa-chip="' + i + '">' +
          esc(chips[i]) + "</button>";
      }
      chipsHTML += "</div>";
    }
    box.innerHTML =
      (opts.note ? '<p class="ezsa-note">' + esc(opts.note) + "</p>" : "") +
      '<textarea class="ezsa-draft" data-ezsa-text>' + esc(opts.text || "") + "</textarea>" +
      chipsHTML +
      (opts.evidence ? '<div class="ezsa-ev">' + opts.evidence + "</div>" : "");

    var ta = box.querySelector("[data-ezsa-text]");

    /* 재요청 칩 — 문안을 AI로 다시 뽑는다. AI 미연결이면 지시문을 문안 앞에 붙인다. */
    box.addEventListener("click", function (ev) {
      var c = ev.target && ev.target.closest ? ev.target.closest("[data-ezsa-chip]") : null;
      if (!c) return;
      var want = chips[parseInt(c.getAttribute("data-ezsa-chip"), 10)] || "";
      requestRedraft(opts.inst, want, ta);
    });

    var actions = [{ label: "닫기", kind: "ghost" }];
    actions.push({
      label: "문안 복사", kind: "ghost", onClick: function () {
        copyText(ta ? ta.value : "");
        return false;
      }
    });
    if (opts.onSubmit) {
      actions.push({
        label: opts.submitLabel || "확인", kind: "primary", onClick: function () {
          var v = ta ? String(ta.value || "").trim() : "";
          if (!v) { toast("문안을 입력해 주세요.", "warn"); return false; }
          return opts.onSubmit(v);
        }
      });
    }
    if (window.TX && TX.modal) {
      return TX.modal({ title: opts.title || "알림 처리", wide: true, body: box, actions: actions });
    }
    /* TX.modal조차 없다 — 마지막 폴백: elizax로 문안을 보낸다 */
    sendToElizax((opts.title || "") + "\n" + (opts.text || ""));
    return null;
  }

  function copyText(t) {
    var ok = false;
    try {
      var ta = document.createElement("textarea");
      ta.value = String(t || "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand("copy");
      ta.remove();
    } catch (e) { ok = false; }
    toast(ok ? "문안을 복사했습니다." : "복사에 실패했습니다 — 직접 선택해 복사해 주세요.", ok ? "ok" : "warn");
  }

  function sendToElizax(text) {
    try {
      if (window.Elizax && Elizax.sendRaw) { Elizax.sendRaw(String(text || "")); return true; }
      if (window.Elizax && Elizax.send) { Elizax.send(String(text || "")); return true; }
    } catch (e) { /* 무시 */ }
    return false;
  }

  /* ======================================================================
     6) AI 초안 — EZAI가 살아 있을 때만 실초안, 죽어 있으면 카탈로그 draft
     ====================================================================== */

  function aiLive() {
    try { return !!(window.EZAI && EZAI.ready && EZAI.ready()); } catch (e) { return false; }
  }

  function enginePrompt(inst) {
    try {
      if (window.EZSignalEngine && EZSignalEngine.prompt) return EZSignalEngine.prompt(inst) || "";
    } catch (e) { /* 무시 */ }
    /* 엔진 미로드 폴백 — 신호 문구 + 근거를 그대로 이어붙인다 */
    var sig = signalOf(inst) || {};
    var evs = evidenceOf(inst), lines = [], i;
    for (i = 0; i < evs.length; i++) {
      if (evs[i] && evs[i].text) lines.push("- " + evs[i].text + (evs[i].assumed ? " — 아직 확인되지 않은 값이에요" : ""));
    }
    return "[알림] " + (sig.notice || "") + "\n[근거]\n" + lines.join("\n");
  }

  /* 신호 근거에 기대는 실초안. onText(text) / onFail() 콜백. */
  function aiDraft(inst, want, onText, onFail) {
    var sig = signalOf(inst) || {};
    if (!aiLive()) { if (onFail) onFail(); return false; }
    var sys =
      "당신은 elizax — 성과관리 알림의 처리 문안 작성자입니다. " +
      "주어진 근거에 있는 사실·수치만 인용해 실제 제출할 수 있는 문안을 씁니다. " +
      "근거에 없는 숫자를 만들지 않고, 없으면 없다고 씁니다(정지 원칙). " +
      "한국어 해요체, 머리말·설명 없이 문안만 출력합니다.";
    var ask = enginePrompt(inst) +
      "\n\n[요청] 위 알림을 처리하기 위한 문안을 작성해 주세요." +
      (want ? " 조건: " + want + "." : "") +
      "\n[참고 초안] " + String((sig.drafts || "")).slice(0, 300);
    try {
      EZAI.agent({
        maxTurns: 4, maxTokens: 800, system: sys,
        messages: [{ role: "user", content: ask }],
        onDone: function (text) {
          var t = String(text || "").trim();
          if (t) { if (onText) onText(t); }
          else if (onFail) onFail();
        },
        onError: function () { if (onFail) onFail(); }
      });
      return true;
    } catch (e) {
      if (onFail) onFail();
      return false;
    }
  }

  function requestRedraft(inst, want, ta) {
    if (!ta) return;
    var before = ta.value;
    ta.value = "✦ 다시 작성 중… (" + want + ")";
    ta.disabled = true;
    var done = false;
    function back(t) {
      if (done) return;
      done = true;
      ta.disabled = false;
      ta.value = t;
    }
    var started = aiDraft(inst, want, back, function () {
      back("[" + want + "] " + before);
      toast("AI가 연결되지 않아 요청 조건만 문안 앞에 남겼습니다.", "warn");
    });
    if (!started) {
      back("[" + want + "] " + before);
      toast("AI가 연결되지 않아 요청 조건만 문안 앞에 남겼습니다.", "warn");
    }
  }

  /* ======================================================================
     7) 초안 작성
     ====================================================================== */

  function runA1(inst, sig, act) {
    switch (classify(inst, act)) {
      case "self": return selfEvalFlow(inst, sig, act);
      case "checkin": return openCheckinFlow(inst, sig, act, "체크인 초안 창");
      case "meeting": return meetingFlow(inst, sig, act);
      case "feedback": return feedbackFlow(inst, sig, act);
      default: return goalNewFlow(inst, sig, act);
    }
  }

  /* 피드백 — 이 목업에는 「피드백 쓰기」 진입점이 없다(카드 + 상세 드로어만,
     tx_fix_perf.js:559·594). 없는 것을 있는 척하지 않고, 피드백 탭으로 데려간 뒤
     문안 창을 띄운다. 카탈로그의 피드백 신호는 전부 now:0이라 오늘은 A5만 열린다. */
  function feedbackFlow(inst, sig, act) {
    nav("perf", 1, function () {
      waitFor('#s-perf .subpage[data-p="1"]', 14, function (pg) {
        if (pg) {
          land({
            host: pg, target: pg.querySelector(".fb-card") || pg,
            line: "피드백을 새로 쓰는 자리가 이 화면에는 아직 없어요. 받은 피드백만 여기서 볼 수 있어요.",
            proposal: proposalOf(inst, act)
          });
        }
        fallbackDraft(inst, sig, act, "이 화면에는 피드백을 새로 쓰는 자리가 아직 없습니다.");
      });
    });
    return true;
  }

  /* 자기평가 인라인 폼 — #s-appr 「평가 작성」 탭(tx_fix_appr.js:361) */
  function selfEvalFlow(inst, sig, act) {
    nav("appr", 0, function () {
      clickWhenReady('#s-appr .ap-tabs button[data-tab="0"]', 12, function () {
        waitFor('#s-appr [data-pane="0"] .txfw-form', 16, function (form) {
          if (!form) { fallbackDraft(inst, sig, act, "평가 작성 화면을 열지 못했습니다."); return; }
          /* 폼 전체가 아니라 첫 입력칸까지 데려간다 — 어디에 쓰는지가 바로 보이게 */
          land({
            host: form,
            target: form.querySelector("textarea, input, select") || form,
            line: "본인 평가를 쓰는 자리예요. 강조된 칸에 바로 쓰실 수 있어요.",
            proposal: proposalOf(inst, act)
          });
          /* AI가 살아 있으면 근거초안 생성까지 눌러준다(tx_fix_appr.js:620) */
          if (aiLive()) {
            var gen = document.querySelector('#s-appr [data-txdr-panel] [data-txdr="gen"]');
            if (gen) { try { gen.click(); } catch (e) { /* 무시 */ } }
          }
          noted(inst, sig, act, "본인 평가 작성 폼으로 이동 · 근거초안 " + (aiLive() ? "생성 요청" : "미연결"),
            "본인 평가를 쓰는 자리로 왔어요. 여기서 직접 고치실 수 있어요.");
        });
      });
    });
    return true;
  }

  /* 목표생성 오버레이 + 초안 생성(tx_fix_perf.js:2489·1876) */
  function goalNewFlow(inst, sig, act) {
    nav("perf", 0, function () {
      var anchor = aiLive() ? '#s-perf [data-txf="anchor-airec"]' : '#s-perf [data-txf="new"]';
      waitFor(anchor, 16, function (btn) {
        if (!btn) {
          /* 목표 현황 헤더가 없다 — 초안 모달로 정직하게 폴백 */
          fallbackDraft(inst, sig, act, "목표 생성 버튼을 찾지 못했습니다.");
          return;
        }
        try { btn.click(); } catch (e) { /* 무시 */ }
        waitFor('#s-perf [data-txf-ov="new"].open', 16, function (ov) {
          if (!ov) { fallbackDraft(inst, sig, act, "목표 생성 화면이 열리지 않았습니다."); return; }
          prefillNewGoal(ov, inst, act);
          /* 문안은 이미 칸에 들어갔다 — 쪽지에 문안을 또 붙이지 않고 돌아갈 길만 둔다 */
          land({
            host: ov.querySelector(".txf-ovbody") || ov,
            target: ov.querySelector('[data-txf="new-name"]') || ov,
            line: "목표를 새로 쓰는 자리예요. 대화에서 나온 문안을 미리 채워 뒀어요 — 그대로 고치셔도 돼요."
          });
          noted(inst, sig, act,
            "목표를 새로 쓰는 화면 진입 · " + (aiLive() ? "AI 초안 생성 실행" : "미리 채운 문안"),
            "목표를 새로 쓰는 자리로 왔어요. 문안은 그대로 고치실 수 있어요.");
        });
      });
    });
    return true;
  }

  /* 목표생성 오버레이 프리필 — AI 초안이 붙을 자리는 비워 둔다(덮어쓰지 않는다) */
  function prefillNewGoal(ov, inst, act) {
    var nm = ov.querySelector('[data-txf="new-name"]');
    var ds = ov.querySelector('[data-txf="new-desc"]');
    var draft = String((act && act.draft) || "");
    if (!draft) return;
    /* 목표명은 짧은 칸이다 — 초안 첫 구절만, 40자에서 끊는다.
       AI 초안(startDraft)이 도착하면 그쪽이 이 값을 덮는다. */
    var head = draft.split(/[.\n]/)[0].replace(/\s+/g, " ").trim().slice(0, 40);
    if (nm && !String(nm.value || "").trim()) nm.value = head;
    if (ds && !String(ds.value || "").trim()) ds.value = draft;
  }

  /* 체크인 모달 진입 — 목표 상세를 먼저 열어 그 목표에 대한 체크인이 되게 한다.
     상세를 못 열면 화면 상단 「✦ 체크인 초안」 앵커(첫 목표 기준)로 폴백. */
  function openCheckinFlow(inst, sig, act, what) {
    var oid = pickObjectiveId(inst);
    nav("perf", 0, function () {
      var got = openBestGoalDetail(oid);
      if (got) {
        saySwap(oid, got);
        waitFor('#s-perf [data-txf-ov="goal"].open', 16, function (ov) {
          if (!ov) { anchorCheckin(inst, sig, act, what); return; }
          var b = ov.querySelector('[data-txf="gd-aick"]') || ov.querySelector('[data-txf="gd-checkin"]');
          if (!b) { anchorCheckin(inst, sig, act, what); return; }
          try { b.click(); } catch (e) { /* 무시 */ }
          /* 창만 띄우고 끝내지 않는다 — 실제로 값을 넣는 칸까지 데려간다 */
          landInModal("[data-ck-kr]",
            "여기가 값을 넣는 자리예요 — " + (titleOf(got) || "목표") + "의 진척값이에요.",
            proposalOf(inst, act));
          noted(inst, sig, act, what + " 열기 · 대상 " + (titleOf(got) || "목표") +
            (oid && got !== oid ? " (원래 가리킨 " + (titleOf(oid) || "목표") + "은 이 화면에 없음)" : ""),
            what + "을 열었어요.");
        });
        return;
      }
      anchorCheckin(inst, sig, act, what);
    });
    return true;
  }

  function anchorCheckin(inst, sig, act, what) {
    waitFor('#s-perf [data-txf="anchor-aick"]', 12, function (a) {
      if (!a) { fallbackDraft(inst, sig, act, "체크인 화면을 열지 못했습니다."); return; }
      try { a.click(); } catch (e) { /* 무시 */ }
      /* 어느 목표 기준인지 반드시 말한다 — 조용히 바꿔치기하지 않는다 */
      var mine = myObjectives();
      sayWhy("가리킨 목표를 이 화면에서 열 수 없어서 " +
        (mine.length ? (titleOf(mine[0].objective_id) || "제 첫 목표") : "첫 목표") + " 기준으로 열었어요.");
      landInModal("[data-ck-kr]", "여기가 값을 넣는 자리예요.", proposalOf(inst, act));
      noted(inst, sig, act, what + " 열기 (내 첫 목표 기준)", what + "을 열었어요.");
    });
  }

  /* 열린 TX.modal 안의 특정 칸에 착지 — 모달 본문(.tx-mbody)이 쪽지의 그릇이다 */
  function landInModal(sel, line, proposal) {
    waitFor(".tx-back.show .tx-mbody " + sel, 16, function (el) {
      if (!el) return;                       /* 모달을 못 찾으면 아무것도 하지 않는다 */
      var body = el.closest ? el.closest(".tx-mbody") : null;
      land({ host: body, target: el, line: line, proposal: proposal });
      try { if (el.focus) el.focus(); } catch (e) { /* 무시 */ }
    });
  }

  /* 근거가 가리킨 대상과 실제로 열린 대상이 다르면 대화에 그대로 적는다.
     토스트만 띄우면 사라져 버려서 「조용한 바꿔치기」와 다를 게 없다. */
  function saySwap(want, got) {
    if (!want || !got || want === got) return;
    sayWhy((titleOf(want) || "가리킨 목표") + "은 이 화면에서 열 수 없어서 " +
      (titleOf(got) || "다른 목표") + "을 열었어요. 필요하면 목표를 바꿔 주세요.");
  }

  /* 목표 상세 오버레이 열기 — 해당 목표 행을 실제로 클릭한다(tx_fix_perf.js:2671) */
  function openGoalDetail(oid) {
    if (!oid) return false;
    var row = document.querySelector('#s-perf .grow[data-oid="' + oid + '"]') ||
              document.querySelector('#s-perf .mg.txf-exp[data-oid="' + oid + '"]') ||
              document.querySelector('#s-perf [data-oid="' + oid + '"]');
    if (!row) return false;
    scrollTo(row);
    try { row.click(); } catch (e) { return false; }
    return true;
  }

  /* 근거가 가리키는 목표가 이 화면에 행으로 없을 수 있다(예: 전사 목표를
     조직장 목표 현황에서 클릭할 수 없다). 내 목표 → 화면에 있는 첫 목표 순으로
     내려가며 실제로 열 수 있는 것을 연다. 열린 목표 id를 돌려주고, 근거가 가리킨
     것과 다르면 호출부가 그 사실을 토스트·기록에 그대로 적는다. */
  function openBestGoalDetail(preferred) {
    if (openGoalDetail(preferred)) return preferred;
    var mine = myObjectives(), i;
    for (i = 0; i < mine.length; i++) {
      if (openGoalDetail(mine[i].objective_id)) return mine[i].objective_id;
    }
    var row = document.querySelector("#s-perf .grow[data-oid], #s-perf .mg.txf-exp[data-oid], #s-perf [data-oid]");
    if (row) {
      var got = row.getAttribute("data-oid");
      if (openGoalDetail(got)) return got;
    }
    return null;
  }

  /* ======================================================================
     8) 직접 수정
     ====================================================================== */

  function runA2(inst, sig, act) {
    switch (classify(inst, act)) {
      case "self": return selfEvalFlow(inst, sig, act);
      /* 실적값·진척 수정의 실제 자리는 체크인 모달이다(KR 현재값 입력칸) */
      case "checkin": return openCheckinFlow(inst, sig, act, "실적값 수정 창");
      case "weight": return weightFlow(inst, sig, act);
      case "meeting": return meetingFlow(inst, sig, act);
      case "feedback": return feedbackFlow(inst, sig, act);
      default: return goalDetailFlow(inst, sig, act);
    }
  }

  /* 목표 가중치 설정 모달(tx_fix_perf.js:2519 → openWeightEditor) */
  function weightFlow(inst, sig, act) {
    var before = weightSnapshot(pickObjectiveId(inst));
    nav("perf", 0, function () {
      clickWhenReady('#s-perf [data-txf="weight"]', 14, function (btn) {
        if (!btn) { fallbackDraft(inst, sig, act, "가중치 설정 버튼을 찾지 못했습니다."); return; }
        /* 편집기 첫 칸까지 데려가고, 수정 전 값을 눈에 보이게 들고 간다 */
        landInModal(".txf-we", "여기가 가중치를 고치는 자리예요. 합계가 100%가 되면 저장할 수 있어요.",
          (before ? "지금 값 — " + before + "\n\n" : "") + proposalOf(inst, act));
        /* 저장은 사용자가 모달에서 확정한다. 여기서는 수정 전 값만 남긴다. */
        noted(inst, sig, act, "가중치 편집 진입 · 수정 전 " + (before || "값 없음"),
          "가중치를 직접 고치는 자리로 왔어요.");
      });
    });
    return true;
  }

  /* 목표 상세 오버레이(.txf-ov) — 본문·연결 수정의 자리 */
  function goalDetailFlow(inst, sig, act) {
    var oid = pickObjectiveId(inst);
    nav("perf", 0, function () {
      var got = openBestGoalDetail(oid);
      if (got) {
        var swapped = (oid && got !== oid);
        /* 바꿔치기는 대화에 남긴다(토스트는 사라진다) */
        if (swapped) saySwap(oid, got);
        waitFor('#s-perf [data-txf-ov="goal"].open', 16, function (ov) {
          if (ov) {
            /* 오버레이 전체를 감싸 강조하면 「어디를 고치나」가 안 보인다 —
               핵심 성과 표(값·가중치가 있는 자리)까지 데려간다 */
            var tg = ov.querySelector(".txf-krt") || ov.querySelector(".txf-fcard") || ov;
            land({
              host: hostFor(tg, ov.querySelector(".txf-ovbody") || ov),
              target: tg,
              line: (titleOf(got) || "목표") + "을 열었어요. 값과 가중치는 이 표에서 고칠 수 있어요.",
              proposal: proposalOf(inst, act)
            });
          }
          noted(inst, sig, act, "목표 상세 진입 · 대상 " + (titleOf(got) || "목표") +
            (swapped ? " (원래 가리킨 " + (titleOf(oid) || "목표") + "은 이 화면에 없음)" : "") +
            (ov ? "" : " (상세가 열리지 않아 목표 현황에서 확인)"),
            swapped ? "" : "목표를 직접 고치는 자리로 왔어요.");
        });
        return;
      }
      /* 대상 목표가 없다 — 화면까지는 데려간다(가짜 성공 금지).
         못 골랐다는 사실은 토스트로만 흘리지 않고 대화에도 남긴다. */
      waitFor("#s-perf .txf-goal-body, #s-perf .subpage", 14, function (host) {
        if (host) {
          land({
            host: host, target: host,
            line: "어느 목표를 고쳐야 하는지 제가 못 골랐어요. 목표 현황에서 직접 골라 주세요.",
            proposal: proposalOf(inst, act)
          });
        }
        sayWhy("어느 목표를 고칠지 제가 못 골라서 목표 현황까지만 열었어요. 목표를 골라 주시면 이어서 도울게요.");
        record(inst, sig, act, "목표 현황으로 이동 · 대상 목표 미확정");
      });
    });
    return true;
  }

  function weightSnapshot(oid) {
    if (!oid) return "";
    var d = data(), out = [];
    (d.keyResults || []).forEach(function (k) {
      if (k && k.objective_id === oid) out.push(String(k.name || "핵심결과") + " " + String(k.weight || "-"));
    });
    return out.join(" · ");
  }

  /* ======================================================================
     9) 전달
     ====================================================================== */

  /* 수신자 후보 — 실데이터의 manager_id / head_id / 직속 팀원에서만 만든다 */
  function recipients() {
    var d = data(), CU = cu(), rk = roleKey(), out = [], seen = {};
    function add(id, name, why) {
      if (!id || seen[id] || id === CU.emp_id) return;
      seen[id] = 1;
      out.push({ id: id, name: name || id, why: why || "" });
    }
    var empById = {};
    (d.employees || []).forEach(function (e) { if (e && e.emp_id) empById[e.emp_id] = e; });
    var me = empById[CU.emp_id] || CU;
    if (me && me.manager_id) add(me.manager_id, (empById[me.manager_id] || {}).name || me.managerName, "조직장");
    var org = null;
    (d.orgs || []).forEach(function (o) { if (o && o.org_id === (me && me.org_id)) org = o; });
    if (org && org.head_id) add(org.head_id, (empById[org.head_id] || {}).name, "소속 조직장");
    if (rk === "leader" || rk === "hr" || rk === "exec") {
      (d.employees || []).forEach(function (e) {
        if (e && e.manager_id === CU.emp_id) add(e.emp_id, e.name, "팀원");
      });
    }
    return out;
  }

  function runA3(inst, sig, act) {
    var rcp = recipients();
    var sel = "";
    if (rcp.length) {
      sel = '<label class="ezsa-note" style="display:block">받는 사람' +
        '<select data-ezsa-to style="width:100%;margin-top:5px;padding:8px 10px;font:inherit;' +
        'font-size:13px;border:1px solid var(--color-border,#e0e0e0);border-radius:8px;appearance:auto">';
      for (var i = 0; i < rcp.length; i++) {
        sel += '<option value="' + esc(rcp[i].id) + '">' + esc(rcp[i].name) +
          (rcp[i].why ? " · " + esc(rcp[i].why) : "") + "</option>";
      }
      sel += "</select></label>";
    }
    var text = scrub(String((act && act.draft) || sig.notice || ""));
    var mo = openDraftModal({
      inst: inst,
      title: "이대로 보낼까요 — " + actName(sig, act),
      note: "받는 사람의 성과 기록에 그대로 남아요. 문안은 고칠 수 있어요.",
      text: text,
      chips: act.chips || [],
      evidence: sel,
      submitLabel: "보내기",
      onSubmit: function (v) {
        var to = null, name = "";
        try {
          var s = mo && mo.box ? mo.box.querySelector("[data-ezsa-to]") : null;
          if (s) {
            to = s.value;
            name = s.options[s.selectedIndex] ? s.options[s.selectedIndex].text : to;
          }
        } catch (e) { /* 무시 */ }
        deliver(inst, sig, act, to, name, v);
        return true;
      }
    });
    if (!mo) {
      /* 모달을 못 띄웠다 — elizax로 문안을 흘려보내는 마지막 폴백 */
      sendToElizax(text);
      finish(inst, sig, act, "발송 폼을 띄우지 못해 문안을 elizax 대화로 보냈습니다.");
    }
    /* AI가 살아 있으면 문안을 실초안으로 갈아끼운다 */
    if (mo && aiLive()) {
      var ta = mo.box.querySelector("[data-ezsa-text]");
      aiDraft(inst, null, function (t) { if (ta && !ta.disabled) ta.value = t; }, null);
    }
    return true;
  }

  /* 수신자 원장 적재 — tx_ctx_ledger.js:498의 emp_id 라우팅 계약을 쓴다.
     ez:ctx 이벤트는 (§5 규칙대로) 감사 1건만 쓰므로 여기서는 직접 add. */
  function deliver(inst, sig, act, toId, toName, text) {
    var CU = cu();
    var delivered = false;
    if (toId) {
      try {
        if (window.EZLedger && EZLedger.add) {
          EZLedger.add({
            type: ledgerType(sig, act),
            source: "signal." + (sig.no || 0) + ".a3.to." + toId,
            title: "알림 전달 — " + (scrub(sig.notice) || actName(sig, act)),
            summary: (CU.name || "보낸 사람") + " → " + (toName || toId) + " · " + text,
            weight: 2, emp_id: toId
          });
          delivered = true;
        }
      } catch (e) { delivered = false; }
    }
    /* 보낸 쪽 알림 기록 — elizax [알림] 탭 「지난 알림」에 남는다 */
    try {
      if (window.EZNotif && EZNotif.push) {
        EZNotif.push({
          kind: "signal",
          title: "알림 발송 — " + (toName || "수신자 미지정"),
          body: text
        });
      }
    } catch (e2) { /* 무시 */ }
    finish(inst, sig, act,
      "받는 사람 " + (toName || "미지정") + " · " +
      /* 용어집: 적재→기록됨 / 원장→성과 기록 */
      (delivered ? "받는 사람 성과 기록에 기록됨" : "성과 기록을 쓸 수 없어 발송 기록만 남김") +
      " · 문안 " + text.length + "자");
  }

  /* ======================================================================
     10) 1:1 안건
     ====================================================================== */

  var ONE_KEY = "elizax_1on1_v1:";

  /* 다음 1:1 아젠다로 이월 — tx_1on1.js:1142의 nextAgenda 계약(최근 5건) */
  function pushAgenda(text) {
    var CU = cu();
    if (!CU.emp_id) return false;
    var key = ONE_KEY + CU.emp_id, st;
    try { st = JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) { st = {}; }
    if (!st || typeof st !== "object") st = {};
    var list = (st.nextAgenda && st.nextAgenda.length) ? st.nextAgenda : [];
    var one = String(text || "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (!one) return false;
    if (list.indexOf(one) < 0) list.push(one);
    st.nextAgenda = list.slice(-5);
    try { localStorage.setItem(key, JSON.stringify(st)); } catch (e2) { return false; }
    return true;
  }

  function runA4(inst, sig, act) { return meetingFlow(inst, sig, act); }

  function meetingFlow(inst, sig, act) {
    var agenda = String((act && act.draft) || sig.notice || "");
    var carried = pushAgenda(agenda);
    nav("perf", 2, function () {
      var started = false;
      try {
        if (window.EZOneOnOne && EZOneOnOne.start) { EZOneOnOne.start(); started = true; }
      } catch (e) { started = false; }
      if (!started) {
        /* 1on1 모듈이 없다 — 1:1 미팅 화면까지 데려가고 아젠다는 이월해 둔다 */
        waitFor('#s-perf .subpage[data-p="2"]', 14, function (pg) {
          if (pg) { scrollTo(pg); highlight(pg); }
          toast(carried ? "다음 1:1 아젠다로 담았습니다." : "1:1 미팅 화면으로 이동했습니다.", "ok");
          finish(inst, sig, act, "1:1 미팅 화면 이동 · 아젠다 이월 " + (carried ? "완료" : "실패"));
        });
        return;
      }
      /* 아젠다 직접 입력칸에도 프리필(tx_1on1.js:632) */
      waitFor("[data-ez1o-agin]", 16, function (inp) {
        if (inp) {
          /* 입력칸은 한 줄이다 — 줄바꿈을 공백으로 눌러 넣는다(maxlength 60) */
          if (!String(inp.value || "").trim()) {
            inp.value = agenda.replace(/\s+/g, " ").trim().slice(0, 60);
          }
          land({
            host: safeHost(inp.parentNode) || inp.parentNode,
            target: inp,
            line: "다음 면담 안건에 미리 담아 뒀어요. 문구는 그대로 고치셔도 돼요."
          });
        }
        finish(inst, sig, act, "1:1 아젠다 미리 채움 · 이월 " + (carried ? "완료" : "미적용") +
          " · " + agenda.slice(0, 40));
      });
    });
    return true;
  }

  /* ======================================================================
     11) 화면 열기 — 기록도 해제도 하지 않는다 (카탈로그 규칙)
     ====================================================================== */

  function runA5(inst, sig, act) {
    var dst = resolveScreen(inst, act);
    var oid = pickObjectiveId(inst);
    var label = "";
    try { if (window.EZNav && EZNav.labelOf) label = EZNav.labelOf(dst.s, dst.p); } catch (e) { label = ""; }
    var prop = proposalOf(inst, act);
    var ok = nav(dst.s, dst.p, function () {
      /* ① 가리킨 목표가 이 화면에 있으면 그 목표 상세까지 열고 표를 강조 */
      if (dst.s === "perf" && dst.p === 0 && oid && openGoalDetail(oid)) {
        waitFor('#s-perf [data-txf-ov="goal"].open', 16, function (ov) {
          if (!ov) return;
          var tg = ov.querySelector(".txf-krt") || ov;
          land({
            host: hostFor(tg, ov.querySelector(".txf-ovbody") || ov),
            target: tg,
            line: (titleOf(oid) || "목표") + "의 상세예요. 이야기했던 내용은 여기에 옮겨 뒀어요.",
            proposal: prop
          });
        });
        return;
      }
      waitFor("#s-" + dst.s, 12, function (secEl) {
        if (!secEl) return;
        var pg = secEl.querySelector('.subpage[data-p="' + dst.p + '"]') || secEl;
        /* ② 상세를 못 열어도 그 줄까지는 데려간다 — 화면만 열고 끝내지 않는다 */
        var row = oid ? pg.querySelector('[data-oid="' + oid + '"]') : null;
        land({
          host: pg, target: row || pg,
          line: row ? "이야기했던 줄이에요. 눌러서 상세를 볼 수 있어요."
                    : (label || "해당 화면") + "이에요. 이야기했던 내용은 아래에 옮겨 뒀어요.",
          proposal: prop
        });
      });
    });
    if (!ok) {
      /* 화면 전환 자체가 안 된다 — 근거를 그대로 보여주는 것이 최선의 정직 */
      openDraftModal({
        inst: inst, title: "알림 자세히 보기",
        note: "화면으로 넘어가지 못해 내용을 그대로 보여드려요.",
        text: scrub(enginePrompt(inst))
      });
      return false;
    }
    toast((label || "해당 화면") + "으로 넘어왔어요.", "");
    return true;   /* 기록·해제 없음 */
  }

  /* ======================================================================
     12) 결재 올리기
     ====================================================================== */

  var IB_PREFIX = "txf_ibreq_";   /* tx_inbox.js:83 규약 */

  function runA6(inst, sig, act) {
    var cls = classify(inst, act);

    /* ① 체크인 결재 — 체크인 모달의 결재 버튼이 txf_ckreq_를 만든다.
          우리가 sessionStorage를 흉내내는 것보다 실제 폼을 태우는 것이 진짜다.
          (store가 전부 "요청 기록 + 승인 흐름"이라 1차 기준이 침묵한다 —
           이때만 단계·문구 2차 기준이 체크인/목표를 가른다.) */
    if (cls === "checkin") {
      return openCheckinFlow(inst, sig, act, "체크인 올리는 창");
    }

    /* ② 그 외(목표 수정·가중치 변경) — 조직장 승인 대기함 요청 카드 생성 */
    var isWeight = (cls === "weight");
    var oid = pickObjectiveId(inst);
    var d = data(), title = "", i;
    for (i = 0; i < (d.objectives || []).length; i++) {
      if (d.objectives[i].objective_id === oid) { title = d.objectives[i].title; break; }
    }
    var curVal = isWeight ? (weightSnapshot(oid) || "현재 가중치") : "현재 내용";
    var mo = openDraftModal({
      inst: inst,
      title: "조직장에게 올릴까요 — " + actName(sig, act),
      note: "조직장 결재 대기함(신청/승인 › 받은 문서)으로 올라가요. 승인 전에는 아무것도 반영되지 않아요.",
      text: scrub(String((act && act.draft) || sig.notice || "")),
      chips: act.chips || [],
      evidence: '<b>대상</b> ' + esc(title || "대상 미확정") +
        " · <b>항목</b> " + esc(isWeight ? "핵심 성과 가중치" : "목표 내용") +
        " · <b>현재</b> " + esc(curVal),
      submitLabel: "올리기",
      onSubmit: function (v) {
        var ok = writeInboxRequest(sig, isWeight, title, curVal, v);
        if (!ok) {
          toast("올리지 못했어요 — 문안을 복사해 조직장에게 직접 전달해 주세요.", "warn");
          return false;
        }
        finish(inst, sig, act,
          (isWeight ? "가중치 변경" : "목표 수정") + " 결재 올림 · 대상 " +
          (title || "미확정") + " · 현재 " + curVal);
        /* 결재 대기함이 보이는 관점이면 바로 그 화면으로 데려간다 */
        var rk = roleKey();
        if (rk === "leader" || rk === "hr") nav("wf", 0, null);
        return true;
      }
    });
    if (!mo) {
      sendToElizax(scrub(String((act && act.draft) || sig.notice || "")));
      toast("올리는 창을 띄우지 못해 문안을 대화로 보냈어요.", "warn");
      return false;
    }
    if (aiLive()) {
      var ta = mo.box.querySelector("[data-ezsa-text]");
      aiDraft(inst, null, function (t) { if (ta && !ta.disabled) ta.value = t; }, null);
    }
    return true;
  }

  /* tx_inbox.js:108·175 규약대로 txf_ibreq_<id> 생성 (kind:'goal'|'weight') */
  function writeInboxRequest(sig, isWeight, title, curVal, comment) {
    var CU = cu();
    var key = IB_PREFIX + "sig" + String(sig.no || 0) + "_" + Date.now().toString(36);
    var payload = {
      kind: isWeight ? "weight" : "goal",
      owner_emp_id: CU.emp_id || "",
      title: title || scrub(sig.notice || ""),
      field: isWeight ? "핵심 성과 가중치" : "목표 내용",
      cur: curVal,
      req: comment.slice(0, 120),
      comment: comment,
      at: asOf(),
      src: "elizax 알림 · 근거 " + evidenceOf({ sig: sig }).length + "건"
    };
    try { sessionStorage.setItem(key, JSON.stringify(payload)); }
    catch (e) { return false; }
    return true;
  }

  /* 기준시점 — 엔진이 주는 값이 단일 원천. 없으면 데모 세계 기준일. */
  function asOf() {
    try {
      if (window.EZSignalEngine && EZSignalEngine.asOf) return EZSignalEngine.asOf();
    } catch (e) { /* 무시 */ }
    var d = data();
    return (d.meta && (d.meta.asOf || d.meta.as_of || d.meta.baseDate)) || "2026-07-24";
  }

  /* ======================================================================
     13) 공통 폴백 — 진입점이 정말 없을 때
     ====================================================================== */

  function fallbackDraft(inst, sig, act, why) {
    toast(why + " 문안을 보여드릴게요.", "warn");
    var mo = openDraftModal({
      inst: inst,
      title: actName(sig, act),
      note: why + " 아래 문안을 복사해 해당 화면에서 직접 붙여 주세요.",
      text: scrub(String((act && act.draft) || sig.notice || "")),
      chips: act.chips || []
    });
    if (!mo) { sendToElizax(scrub(String((act && act.draft) || sig.notice || ""))); }
    /* 실제 저장이 일어나지 않았으므로 신호를 해제하지 않는다. 기록만 남긴다. */
    record(inst, sig, act, "진입점을 찾지 못해 문안만 안내 — " + why);
    return false;
  }

  /* ======================================================================
     14) 진입점 사전 해석 (라이브 점검·W2 버튼 비활성 판정용)
     ====================================================================== */

  /* 분류 → 진입점 표기(감사·라이브 점검용). run()의 분기와 같은 표를 쓴다. */
  var CLS_ENTRY = {
    self:    { s: "appr", p: 0, how: '#s-appr [data-pane="0"] .txfw-form' },
    checkin: { s: "perf", p: 0, how: '[data-txf="gd-aick"] | [data-txf="anchor-aick"]' },
    weight:  { s: "perf", p: 0, how: '[data-txf="weight"]' },
    meeting: { s: "perf", p: 2, how: "nextAgenda + EZOneOnOne.start()" },
    feedback:{ s: "perf", p: 1, how: ".fb-card" },
    goal:    { s: "perf", p: 0, how: '.grow[data-oid] → [data-txf-ov="goal"]' }
  };

  function targetOf(inst, idx) {
    var sig = signalOf(inst), act = actionAt(inst, idx);
    if (!sig || !act) return null;
    var cls = classify(inst, act);
    var e = CLS_ENTRY[cls] || CLS_ENTRY.goal;
    var scr = { s: e.s, p: e.p }, how = e.how;
    switch (actNo(act)) {
      case 1:
        if (cls === "goal" || cls === "weight") {
          scr = { s: "perf", p: 0 };
          how = aiLive() ? '[data-txf="anchor-airec"]' : '[data-txf="new"]';
        } else if (cls === "feedback") {
          how = "피드백 탭 + 문안 창 (쓰기 진입점 없음)";
        }
        break;
      case 2: break;                         /* 분류 표 그대로 */
      case 3: how = "TX.modal 발송 폼 → EZLedger.add({emp_id})"; break;
      case 4: scr = { s: "perf", p: 2 }; how = CLS_ENTRY.meeting.how; break;
      case 5: scr = resolveScreen(inst, act); how = "EZNav.go"; break;
      case 6:
        how = (cls === "checkin")
          ? '[data-txf="gd-aick"] → sessionStorage txf_ckreq_'
          : "TX.modal 요청 폼 → sessionStorage txf_ibreq_";
        break;
      default: how = "미지원";
    }
    var rc = reach(inst, idx);
    return {
      no: actNo(act), cls: cls, s: scr.s, p: scr.p, how: how,
      live: sig.now === 1, reachable: rc.ok, why: rc.why
    };
  }

  /* ---- 갈 곳이 정말 있는가 -----------------------------------------------
     화면 이동 전에 이것부터 묻는다. 갈 곳이 없으면 「비슷한 화면」으로 데려가서
     사용자가 헤매게 하는 대신, 대화에서 그대로 말한다. R2를 지키느라 이유를
     흐리지 않는다 — 분류 이름을 쓰지 않고도 무엇이 없는지 말할 수 있다.
       ok    : 화면으로 데려가도 되는가
       why   : 안 되는 이유 (사람 말 한 문장, 그대로 대화에 올라간다)
       chat  : 대화에서 이어서 도울 수 있는가 (문안 초안 등) */
  function reach(inst, idx) {
    var sig = signalOf(inst), act = actionAt(inst, idx);
    if (!sig || !act || !actNo(act)) {
      return { ok: false, chat: false, why: "이 이야기로는 어느 자리를 고쳐야 할지 아직 짚지 못했어요." };
    }
    var n = actNo(act), cls = classify(inst, act);
    if (n < 1 || n > 6) {
      return { ok: false, chat: false, why: "이건 아직 화면에서 처리할 방법이 없어요. 여기서 같이 정리해 볼게요." };
    }
    /* 라이브가 아닌 신호로 화면을 열어 주면 빈 화면에 데려다 놓는 셈이 된다 */
    if (sig.now !== 1 && n !== 5) {
      return { ok: false, chat: false, why: "이건 데이터가 더 모여야 화면에서 고칠 수 있어요. 지금은 여기서 내용만 볼 수 있어요." };
    }
    /* 피드백을 새로 쓰거나 고치는 자리가 이 화면에는 없다(카드·상세만 있다) */
    if (cls === "feedback" && (n === 1 || n === 2)) {
      return { ok: false, chat: true, why: "피드백을 새로 쓰는 자리가 이 화면에는 아직 없어요. 여기서 문안을 잡아 드릴게요." };
    }
    /* 고칠 목표를 한 건도 못 고르는 상태 — 화면에 데려가도 열 것이 없다 */
    if ((cls === "goal" || cls === "weight" || cls === "checkin") && n !== 5 && !pickObjectiveId(inst) && !myObjectives().length) {
      return { ok: false, chat: false, why: "고칠 목표가 아직 없어서 화면에서 열 게 없어요. 먼저 목표를 세우는 이야기부터 해요." };
    }
    return { ok: true, chat: true, why: "" };
  }

  /* ======================================================================
     15) 의도 판정 — 화면으로 갈지, 대화 안에서 끝낼지
     ====================================================================== */

  /* 「자세히」·「화면에서 고칠게」·「거기서 수정」 같은 말이 있을 때만 화면으로 간다.
     내비게이션 의도 파서는 이미 tx_nav.js에 있다(EZNav.resolve = 이동 동사 + 목적지가
     둘 다 있을 때만 non-null). 두 번째 파서를 만들지 않고 그것을 재사용하고,
     목적지 단어가 없는 「직접 고칠게」류만 여기서 보탠다. */
  var SCREEN_INTENT = /(자세히|화면\s*에서|화면\s*으로|직접\s*(고치|수정|입력|쓰|쓸|작성)|거기서\s*(고치|수정|쓰|작성)|가서\s*(고치|수정)|열어\s*줘|열어\s*볼)/;

  function wantsScreen(text) {
    var t = String(text == null ? "" : text);
    if (!t) return false;
    if (SCREEN_INTENT.test(t)) return true;
    try { if (window.EZNav && EZNav.resolve && EZNav.resolve(t)) return true; }
    catch (e) { /* 파서 부재 — 위 판정만 쓴다 */ }
    return false;
  }

  /* 「이대로 보내줘」처럼 기록을 남기라고 확정한 말 */
  var WRITE_INTENT = /(이대로\s*(보내|저장|올려|요청|담아)|보내\s*줘|보내자|전달\s*해|저장\s*해|올려\s*줘|요청\s*해|담아\s*줘|잡아\s*줘)/;

  function wantsWrite(text) {
    var t = String(text == null ? "" : text);
    return !!t && WRITE_INTENT.test(t);
  }

  /* 기록이 실제로 남는 처리 = 전달·1:1 안건·결재 (3·4·6) */
  function writesRecord(act) {
    var n = actNo(act);
    return n === 3 || n === 4 || n === 6;
  }

  /* 화면으로 넘어갈 때는 왜 넘어가는지 한 줄로 알린다 (R5) */
  function sayWhy(line) {
    var t = scrub(line);
    if (!t) return;
    try {
      if (window.EZChat && EZChat.push) { EZChat.push({ role: "ai", text: t }); return; }
    } catch (e) { /* 대화 저장소 부재 — 토스트로 */ }
    toast(t, "");
  }

  /* ======================================================================
     16) run — 기본 경로. 대화 안에서 끝낸다
     ====================================================================== */

  /* 처리 한 건을 사용자 말투 요청 한 줄로 바꾼다. 이 문장이 대화에 그대로 올라가고,
     실측 근거는 B1의 EZSignalChat.contextFor()가 보이지 않게 실어 준다. */
  function chatRequest(sig, act) {
    var head = scrub(sig.notice || "");
    var what = actName(sig, act);
    var tail = writesRecord(act)
      ? " 보낼 문안을 먼저 채팅에서 보여줘. 확인하고 보낼게."
      : " 지금 데이터로 채팅에서 바로 정리해줘. 화면은 아직 안 옮겨도 돼.";
    return tidy(head + (head && what ? " — " : "") + what + tail);
  }

  function chatResolve(inst, sig, act) {
    var req = chatRequest(sig, act);
    try { if (window.Elizax && Elizax.open) Elizax.open(); } catch (e) { /* 무시 */ }
    if (sendToElizax(req)) return true;
    /* 대화를 못 열었다 — 문안 창으로 정직하게 폴백(신호는 해제하지 않는다) */
    return fallbackDraft(inst, sig, act, "대화를 열지 못했어요.");
  }

  function guard(inst, actionIdx) {
    var sig = signalOf(inst);
    var act = actionAt(inst, actionIdx);
    if (!sig || !act || !actNo(act)) {
      toast("처리할 알림 정보를 찾지 못했어요.", "warn");
      return null;
    }
    /* 라이브 신호가 아니면 화면 열기만 — 거짓 작동을 만들지 않는다 */
    if (sig.now !== 1 && actNo(act) !== 5) {
      toast("이 알림은 데이터가 더 모여야 처리할 수 있어요. 지금은 내용만 볼 수 있어요.", "warn");
      return null;
    }
    return { sig: sig, act: act };
  }

  /* run(inst, i, text) — 기본은 채팅 안에서 해결한다.
     text에 화면으로 가겠다는 말이 있으면 openScreen으로 넘기고,
     기록을 남기라고 확정한 말이 있으면 실제 쓰기 흐름을 태운다. */
  function run(inst, actionIdx, text) {
    var g = guard(inst, actionIdx);
    if (!g) return false;
    if (wantsScreen(text)) return openScreen(inst, actionIdx, text);
    try {
      if (writesRecord(g.act) && wantsWrite(text)) {
        switch (actNo(g.act)) {
          case 3: return runA3(inst, g.sig, g.act);
          case 4: return runA4(inst, g.sig, g.act);
          case 6: return runA6(inst, g.sig, g.act);
        }
      }
      return chatResolve(inst, g.sig, g.act);
    } catch (e) {
      try { console.error("[EZSignalAct]", e); } catch (e2) { /* 무시 */ }
      return fallbackDraft(inst, g.sig, g.act, "처리 중 문제가 생겼어요.");
    }
  }

  /* openScreen(inst, i, text) — 사용자가 화면에서 직접 하겠다고 한 경우에만.
     text가 비어 있는 호출(답변 끝의 진입 장치)도 받는다 — 그때는 사유 문장을 바꾼다. */
  function openScreen(inst, actionIdx, text) {
    var sig0 = signalOf(inst), act0 = actionAt(inst, actionIdx);
    /* ① 갈 곳이 정말 있는지 먼저 묻는다. 없으면 근처로 데려가지 않고 그대로 말한다. */
    var rc = reach(inst, actionIdx);
    if (!rc.ok) {
      sayWhy(rc.why);
      if (rc.chat && sig0 && act0) return chatResolve(inst, sig0, act0);
      return false;
    }
    var g = guard(inst, actionIdx);
    if (!g) return false;
    dropCarry();               /* 지난 인계의 쪽지가 남아 있으면 걷는다 */
    var dst = resolveScreen(inst, g.act);
    var label = "";
    try { if (window.EZNav && EZNav.labelOf) label = EZNav.labelOf(dst.s, dst.p); } catch (e) { label = ""; }
    /* 화면으로 넘어갈 때는 왜 넘어가는지 한 줄 (R5). 사용자가 말해서 가는 경우와
       답변 끝의 진입 장치로 가는 경우의 사유가 다르므로 문장을 나눈다. */
    sayWhy(wantsScreen(text)
      ? "직접 고치시겠다고 하셔서 " + (label || "해당 화면") + "으로 넘어갈게요."
      : (label || "해당 화면") + "에서 바로 고칠 수 있어요. 그 자리로 옮겨 드릴게요.");
    try {
      switch (actNo(g.act)) {
        case 1: return runA1(inst, g.sig, g.act);
        case 2: return runA2(inst, g.sig, g.act);
        case 3: return runA3(inst, g.sig, g.act);
        case 4: return runA4(inst, g.sig, g.act);
        case 5: return runA5(inst, g.sig, g.act);
        case 6: return runA6(inst, g.sig, g.act);
        default:
          toast("아직 지원하지 않는 처리예요.", "warn");
          return false;
      }
    } catch (e2) {
      try { console.error("[EZSignalAct]", e2); } catch (e3) { /* 무시 */ }
      toast("처리 중 문제가 생겨 문안만 보여드려요.", "warn");
      return fallbackDraft(inst, g.sig, g.act, "처리 중 문제가 생겼어요.");
    }
  }

  /* fromText — 사용자 말 한 줄로 라우팅한다(칩·자유 입력 공통 진입) */
  function fromText(inst, text, actionIdx) {
    return wantsScreen(text) ? openScreen(inst, actionIdx, text) : run(inst, actionIdx, text);
  }

  /* 근거를 그대로 대화로 — 대화가 단일 원천이므로 EZSignalChat이 있으면 그쪽 */
  function ask(inst) {
    var sig = signalOf(inst) || {};
    try {
      if (sig.id && window.EZSignalChat && typeof EZSignalChat.ask === "function") {
        if (window.Elizax && Elizax.open) Elizax.open();
        EZSignalChat.ask(sig.id);
        return true;
      }
    } catch (e) { /* 아래 폴백 */ }
    var p = scrub(enginePrompt(inst));
    if (!p) { toast("보낼 내용이 없어요.", "warn"); return false; }
    try { if (window.Elizax && Elizax.open) Elizax.open(); } catch (e2) { /* 무시 */ }
    if (sendToElizax(p)) return true;
    openDraftModal({ inst: inst, title: "알림 내용", note: "대화를 열 수 없어 내용을 그대로 보여드려요.", text: p });
    return false;
  }

  window.EZSignalAct = {
    run: run,
    openScreen: openScreen,
    fromText: fromText,
    wantsScreen: wantsScreen,
    ask: ask,
    actionAt: actionAt,
    signalOf: signalOf,
    resolveScreen: resolveScreen,
    targetOf: targetOf,
    reach: reach            /* 화면으로 데려가도 되는가 {ok, chat, why} */
  };
})();
