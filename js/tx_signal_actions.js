/* ============================================================================
 * tx_signal_actions.js — 신호 알림 처리 배선 (window.EZSignalAct) · 18차 §5 (W4)
 * ----------------------------------------------------------------------------
 * 목적
 *   신호 카드(EZSignalCard)의 「처리 방법」 버튼 A1~A6을 눌렀을 때, **이미 있는
 *   기능**을 실제로 켠다. 이 파일은 새 화면·새 폼·새 저장소를 만들지 않는다.
 *   가짜 성공(토스트만 띄우고 아무 일도 안 하는 것)을 만들지 않는다 — 진입점이
 *   없으면 정직하게 폴백하고, 사용자는 반드시 실재하는 화면에 착지한다.
 *
 * 공개 API
 *   EZSignalAct.run(inst, actionIdx) → true(처리 시작) | false(불가)
 *   EZSignalAct.ask(inst)            → 카드 「자세히」. Elizax.sendRaw(엔진 프롬프트)
 *   EZSignalAct.actionAt(inst, i)    → 정규화된 actions[i] (없으면 null)
 *   EZSignalAct.signalOf(inst)       → 카탈로그 신호 원본 (없으면 null)
 *   EZSignalAct.resolveScreen(inst)  → {s, p} 신호 stage → 화면 좌표 (라이브 점검용)
 *   EZSignalAct.targetOf(inst, i)    → {type, s, p, how} 실행 전 진입점 해석 결과
 *
 * A타입 → 실제 진입점 (감사로 확인한 file:line)
 * ┌────┬────────────┬────────────────────────────────────────────────────────┐
 * │A1  │새로 쓰기   │목표: #s-perf `[data-txf="anchor-airec"]`               │
 * │    │            │      = openNew()+초안 생성 (tx_fix_perf.js:2489)        │
 * │    │            │      오버레이 자체 = openNew (tx_fix_perf.js:1876)      │
 * │    │            │      프리필 `[data-txf="new-name"]`/`new-desc` (:1843·1846)│
 * │    │            │체크인: `[data-txf="anchor-aick"]`                      │
 * │    │            │      → openCheckinModal(o,true) (tx_fix_perf.js:2501)   │
 * │    │            │자기평가: #s-appr `[data-pane="0"] .txfw-form`           │
 * │    │            │      = writeFormBody(emp) 인라인 (tx_fix_appr.js:361)   │
 * │    │            │      AI 근거초안 `[data-txdr="gen"]` (tx_fix_appr.js:620)│
 * ├────┼────────────┼────────────────────────────────────────────────────────┤
 * │A2  │내가 고치기 │가중치: `[data-txf="weight"]`                            │
 * │    │            │      → openWeightEditor() (tx_fix_perf.js:2519·1915)    │
 * │    │            │실적값·진척: 위 A1 체크인 모달(KR 현재값 입력칸이 그 자리)│
 * │    │            │자기평가: 위 A1 자기평가 인라인 폼(같은 폼이 수정 자리)  │
 * │    │            │목표·연결: `.grow[data-oid]`·`.mg.txf-exp[data-oid]`     │
 * │    │            │      → openGoalDetail() = `.txf-ov` (tx_fix_perf.js:    │
 * │    │            │      2671·2665·2290)                                    │
 * ├────┼────────────┼────────────────────────────────────────────────────────┤
 * │A3  │알려주기    │TX.modal 발송 폼 (js/ui_kit.js:26) →                     │
 * │    │            │  수신자 원장 적재 = EZLedger.add({emp_id:…})            │
 * │    │            │  (tx_ctx_ledger.js:498·456 — 개인별 전달 계약)          │
 * │    │            │  + EZNotif.push (tx_elizax.js:131) 알림 기록            │
 * ├────┼────────────┼────────────────────────────────────────────────────────┤
 * │A4  │1on1 잡기   │localStorage `elizax_1on1_v1:<emp>`.nextAgenda 이월      │
 * │    │            │  (tx_1on1.js:62·201·1142) → EZOneOnOne.start()          │
 * │    │            │  (tx_1on1.js:1195·636) → `[data-ez1o-agin]` 프리필(:632)│
 * ├────┼────────────┼────────────────────────────────────────────────────────┤
 * │A5  │상세 보기   │EZNav.go(s,p) (tx_nav.js:84·118). 기록·해제 없음         │
 * ├────┼────────────┼────────────────────────────────────────────────────────┤
 * │A6  │승인 요청   │체크인: 위 A1 체크인 모달의 「체크인 · 승인 요청」        │
 * │    │            │  → ckSave → sessionStorage `txf_ckreq_<oid>`            │
 * │    │            │  (tx_fix_perf.js:2126 / 규약 tx_inbox.js:82·145)        │
 * │    │            │그 외: sessionStorage `txf_ibreq_<id>` 직접 생성         │
 * │    │            │  (규약 tx_inbox.js:83·108·175) → 조직장 승인 대기함     │
 * └────┴────────────┴────────────────────────────────────────────────────────┘
 * 공통 마무리(A5 제외): EZSignalEngine.resolve(id,"acted") → TX.toast(done.title)
 *   → `ez:ctx` 1건(source:"signal.<id>.<A타입>") → EZLedger 수신(:1496).
 *
 * 규칙
 *   - ES5 IIFE. let/const/화살표/템플릿리터럴 없음.
 *   - 외부 전역(EZNav·EZSignalEngine·EZAI·EZDraft·EZOneOnOne·EZLedger·EZNotif·
 *     TX·TXRoles)은 전부 없을 수 있다 — 모두 guard, 절대 throw하지 않는다.
 *   - `now !== 1`(데이터 준비 필요) 신호는 A5만 허용. 나머지는 정직하게 거절.
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

  function actionLabel(t) {
    var m = catalog().actionLabel || {};
    return m[t] || t || "";
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
      ".ezsa-ev{font-size:11.5px;line-height:1.7;color:var(--color-text-secondary,#5C6474);margin-top:9px}";
    document.head.appendChild(st);
  }

  function highlight(el) {
    if (!el) return;
    styleOnce();
    el.classList.add("ezsa-hl");
    setTimeout(function () { try { el.classList.remove("ezsa-hl"); } catch (e) { /* 무시 */ } }, 2000);
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
     `notice`를 같이 섞으면 오배선이 난다 — 실측 확인: 중간점검-구성원-08의
     notice에 "가중치 합은 65%"가 들어 있어, 핵심결과 수정(A2)이 가중치 편집기로
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

  var STAGE_SCREEN = {
    "목표수립": { s: "perf", p: 0 },
    "중간점검": { s: "perf", p: 0 },
    "평가": { s: "appr", p: 0 },
    "피드백": { s: "perf", p: 1 },
    "보상": { s: "pay", p: 0 },
    "육성": { s: "hrm", p: 0 }
  };

  function resolveScreen(inst, act) {
    var sig = signalOf(inst) || {};
    var cls = classify(inst, act || null);
    if (cls === "self") return { s: "appr", p: 0 };
    if (cls === "meeting") return { s: "perf", p: 2 };
    if (cls === "feedback") return { s: "perf", p: 1 };
    return STAGE_SCREEN[sig.stage] || { s: "perf", p: 0 };
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

  var LEDGER_TYPE = {
    "목표수립": "goal", "중간점검": "checkin", "평가": "eval", "피드백": "feedback"
  };

  function ledgerType(sig, act) {
    if (act && act.type === "A4") return "oneonone";
    return LEDGER_TYPE[sig && sig.stage] || "goal";
  }

  /* ez:ctx 1건 — 페이로드 형태는 tx_inbox.js:347 발행부를 그대로 따른다 */
  function record(inst, sig, act, summary) {
    var detail = {
      type: ledgerType(sig, act),
      source: "signal." + sig.id + "." + act.type,
      title: actionLabel(act.type) + " — " + (act.label || sig.notice || sig.id),
      summary: String(summary || sig.notice || ""),
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

  /* A5를 제외한 모든 처리의 공통 착지 */
  function finish(inst, sig, act, summary) {
    resolveSignal(sig);
    var done = (inst && inst.done) || sig.done || {};
    toast(done.title || "처리했습니다.", "ok");
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
      if (evs[i] && evs[i].text) lines.push("- " + evs[i].text + (evs[i].assumed ? " (추정)" : ""));
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
     7) A1 새로 쓰기
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
        if (pg) { scrollTo(pg); highlight(pg); }
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
          scrollTo(form); highlight(form);
          /* AI가 살아 있으면 근거초안 생성까지 눌러준다(tx_fix_appr.js:620) */
          if (aiLive()) {
            var gen = document.querySelector('#s-appr [data-txdr-panel] [data-txdr="gen"]');
            if (gen) { try { gen.click(); } catch (e) { /* 무시 */ } }
          }
          finish(inst, sig, act, "자기평가 작성 폼으로 이동 · 근거초안 " + (aiLive() ? "생성 요청" : "미연결"));
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
          highlight(ov.querySelector('[data-txf="new-name"]') || ov);
          finish(inst, sig, act,
            "목표 생성 화면 진입 · " + (aiLive() ? "AI 초안 생성 실행" : "카탈로그 초안 미리 채움"));
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
        waitFor('#s-perf [data-txf-ov="goal"].open', 16, function (ov) {
          if (!ov) { anchorCheckin(inst, sig, act, what); return; }
          var b = ov.querySelector('[data-txf="gd-aick"]') || ov.querySelector('[data-txf="gd-checkin"]');
          if (!b) { anchorCheckin(inst, sig, act, what); return; }
          try { b.click(); } catch (e) { /* 무시 */ }
          finish(inst, sig, act, what + " 열기 · 대상 목표 " + got +
            (oid && got !== oid ? " (근거 대상 " + oid + "은 이 화면에 없음)" : ""));
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
      finish(inst, sig, act, what + " 열기 (내 첫 목표 기준)");
    });
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

  /* 근거가 가리키는 목표가 이 화면에 행으로 없을 수 있다(예: 전사 목표 OBJ-0001을
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
     8) A2 내가 고치기
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
        /* 저장은 사용자가 모달에서 확정한다. 여기서는 수정 전 값만 남긴다. */
        finish(inst, sig, act, "가중치 편집 진입 · 수정 전 " + (before || "값 없음"));
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
        if (swapped) {
          toast("근거가 가리킨 " + oid + "은 이 화면에서 열 수 없어 " + got + "을 열었습니다.", "warn");
        }
        waitFor('#s-perf [data-txf-ov="goal"].open', 16, function (ov) {
          if (ov) highlight(ov);
          finish(inst, sig, act, "목표 상세 진입 · 대상 " + got +
            (swapped ? " (근거 대상 " + oid + "은 이 화면에 없음)" : "") +
            (ov ? "" : " (상세 오버레이 미표시 — 목표 현황에서 확인)"));
        });
        return;
      }
      /* 대상 목표가 없다 — 화면까지는 데려간다(가짜 성공 금지) */
      waitFor("#s-perf .txf-goal-body, #s-perf .subpage", 14, function (host) {
        if (host) { scrollTo(host); highlight(host); }
        toast("고칠 목표를 찾지 못했습니다 — 목표 현황에서 대상을 직접 골라 주세요.", "warn");
        record(inst, sig, act, "목표 현황으로 이동 · 대상 목표 미확정");
        resolveSignal(sig);
      });
    });
    return true;
  }

  function weightSnapshot(oid) {
    if (!oid) return "";
    var d = data(), out = [];
    (d.keyResults || []).forEach(function (k) {
      if (k && k.objective_id === oid) out.push(String(k.name || k.kr_id) + " " + String(k.weight || "-"));
    });
    return out.join(" · ");
  }

  /* ======================================================================
     9) A3 알려주기
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
    var text = String((act && act.draft) || sig.notice || "");
    var mo = openDraftModal({
      inst: inst,
      title: "알려주기 — " + (act.label || sig.stage),
      note: "받는 사람의 성과 기록에 그대로 남습니다. 문안은 고칠 수 있어요.",
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
            source: "signal." + sig.id + ".A3.to." + toId,
            title: "알림 전달 — " + (sig.notice || sig.id),
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
     10) A4 1on1 잡기
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
          scrollTo(inp); highlight(inp);
        }
        finish(inst, sig, act, "1:1 아젠다 미리 채움 · 이월 " + (carried ? "완료" : "미적용") +
          " · " + agenda.slice(0, 40));
      });
    });
    return true;
  }

  /* ======================================================================
     11) A5 상세 보기 — 기록도 해제도 하지 않는다 (카탈로그 규칙)
     ====================================================================== */

  function runA5(inst, sig, act) {
    var dst = resolveScreen(inst, act);
    var oid = pickObjectiveId(inst);
    var label = "";
    try { if (window.EZNav && EZNav.labelOf) label = EZNav.labelOf(dst.s, dst.p); } catch (e) { label = ""; }
    var ok = nav(dst.s, dst.p, function () {
      if (dst.s === "perf" && dst.p === 0 && oid) {
        if (openGoalDetail(oid)) return;
      }
      waitFor("#s-" + dst.s, 12, function (secEl) {
        if (secEl) {
          var pg = secEl.querySelector('.subpage[data-p="' + dst.p + '"]') || secEl;
          scrollTo(pg); highlight(pg);
        }
      });
    });
    if (!ok) {
      /* 화면 전환 자체가 안 된다 — 근거를 그대로 보여주는 것이 최선의 정직 */
      openDraftModal({
        inst: inst, title: "알림 상세 — " + sig.id,
        note: "화면으로 이동하지 못해 근거를 그대로 보여드립니다.",
        text: enginePrompt(inst)
      });
      return false;
    }
    toast((label || "해당 화면") + "으로 이동했습니다.", "");
    return true;   /* 기록·해제 없음 */
  }

  /* ======================================================================
     12) A6 승인 요청
     ====================================================================== */

  var IB_PREFIX = "txf_ibreq_";   /* tx_inbox.js:83 규약 */

  function runA6(inst, sig, act) {
    var cls = classify(inst, act);

    /* ① 체크인 승인 — 체크인 모달의 「체크인 · 승인 요청」이 txf_ckreq_를 만든다.
          우리가 sessionStorage를 흉내내는 것보다 실제 폼을 태우는 것이 진짜다.
          (A6 store는 전부 "요청 기록 + 승인 흐름"이라 1차 기준이 침묵한다 —
           이때만 stage·notice 2차 기준이 체크인/목표를 가른다.) */
    if (cls === "checkin") {
      return openCheckinFlow(inst, sig, act, "체크인 승인 요청 창");
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
      title: "승인 요청 — " + (act.label || sig.stage),
      note: "조직장 승인 대기함(신청/승인 › 받은 문서)으로 올라갑니다. 승인 전에는 아무것도 반영되지 않아요.",
      text: String((act && act.draft) || sig.notice || ""),
      chips: act.chips || [],
      evidence: '<b>대상</b> ' + esc(title || oid || "대상 미확정") +
        " · <b>항목</b> " + esc(isWeight ? "핵심 성과 가중치" : "목표 내용") +
        " · <b>현재</b> " + esc(curVal),
      submitLabel: "승인 요청 보내기",
      onSubmit: function (v) {
        var ok = writeInboxRequest(sig, isWeight, oid, title, curVal, v);
        if (!ok) {
          toast("요청을 저장하지 못했습니다 — 문안을 복사해 조직장에게 직접 전달해 주세요.", "warn");
          return false;
        }
        finish(inst, sig, act,
          (isWeight ? "가중치 변경" : "목표 수정") + " 승인 요청 생성 · 대상 " +
          (title || oid || "미확정") + " · 현재 " + curVal);
        /* 승인 대기함이 보이는 관점이면 바로 그 화면으로 데려간다 */
        var rk = roleKey();
        if (rk === "leader" || rk === "hr") nav("wf", 0, null);
        return true;
      }
    });
    if (!mo) {
      sendToElizax(String((act && act.draft) || sig.notice || ""));
      toast("요청 폼을 띄우지 못해 문안을 elizax 대화로 보냈습니다.", "warn");
      return false;
    }
    if (aiLive()) {
      var ta = mo.box.querySelector("[data-ezsa-text]");
      aiDraft(inst, null, function (t) { if (ta && !ta.disabled) ta.value = t; }, null);
    }
    return true;
  }

  /* tx_inbox.js:108·175 규약대로 txf_ibreq_<id> 생성 (kind:'goal'|'weight') */
  function writeInboxRequest(sig, isWeight, oid, title, curVal, comment) {
    var CU = cu();
    var key = IB_PREFIX + "sig" + String(sig.id).replace(/[^A-Za-z0-9]/g, "") + "_" +
      Date.now().toString(36);
    var payload = {
      kind: isWeight ? "weight" : "goal",
      owner_emp_id: CU.emp_id || "",
      title: title || oid || (sig.notice || sig.id),
      field: isWeight ? "핵심 성과 가중치" : "목표 내용",
      cur: curVal,
      req: comment.slice(0, 120),
      comment: comment,
      at: asOf(),
      src: "elizax 알림 " + sig.id + " · 근거 " + evidenceOf({ sig: sig }).length + "건"
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
      title: (actionLabel(act.type) || "처리") + " — " + (act.label || sig.stage),
      note: why + " 아래 문안을 복사해 해당 화면에서 직접 붙여 주세요.",
      text: String((act && act.draft) || sig.notice || ""),
      chips: act.chips || []
    });
    if (!mo) { sendToElizax(String((act && act.draft) || sig.notice || "")); }
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
    switch (act.type) {
      case "A1":
        if (cls === "goal" || cls === "weight") {
          scr = { s: "perf", p: 0 };
          how = aiLive() ? '[data-txf="anchor-airec"]' : '[data-txf="new"]';
        } else if (cls === "feedback") {
          how = "피드백 탭 + 문안 창 (쓰기 진입점 없음)";
        }
        break;
      case "A2": break;                      /* 분류 표 그대로 */
      case "A3": how = "TX.modal 발송 폼 → EZLedger.add({emp_id})"; break;
      case "A4": scr = { s: "perf", p: 2 }; how = CLS_ENTRY.meeting.how; break;
      case "A5": scr = resolveScreen(inst, act); how = "EZNav.go"; break;
      case "A6":
        how = (cls === "checkin")
          ? '[data-txf="gd-aick"] → sessionStorage txf_ckreq_'
          : "TX.modal 요청 폼 → sessionStorage txf_ibreq_";
        break;
      default: how = "미지원";
    }
    return { type: act.type, cls: cls, s: scr.s, p: scr.p, how: how, live: sig.now === 1 };
  }

  /* ======================================================================
     15) run — 단일 진입점
     ====================================================================== */

  function run(inst, actionIdx) {
    var sig = signalOf(inst);
    var act = actionAt(inst, actionIdx);
    if (!sig || !act || !act.type) {
      toast("처리할 알림 정보를 찾지 못했습니다.", "warn");
      return false;
    }
    /* 라이브 15건이 아니면 A5만 — 거짓 작동을 만들지 않는다(§4) */
    if (sig.now !== 1 && act.type !== "A5") {
      toast("이 알림은 데이터 준비가 필요해 아직 처리할 수 없어요. 상세 보기만 됩니다.", "warn");
      return false;
    }
    try {
      switch (act.type) {
        case "A1": return runA1(inst, sig, act);
        case "A2": return runA2(inst, sig, act);
        case "A3": return runA3(inst, sig, act);
        case "A4": return runA4(inst, sig, act);
        case "A5": return runA5(inst, sig, act);
        case "A6": return runA6(inst, sig, act);
        default:
          toast("아직 지원하지 않는 처리 방법입니다 — " + act.type, "warn");
          return false;
      }
    } catch (e) {
      /* 어떤 경우에도 카드가 죽지 않게 한다 */
      try { console.error("[EZSignalAct]", e); } catch (e2) { /* 무시 */ }
      toast("처리 중 문제가 생겨 문안만 보여드립니다.", "warn");
      return fallbackDraft(inst, sig, act, "처리 중 오류가 났습니다.");
    }
  }

  /* 카드 `.ezs-agent` 우측 「자세히」 — 엔진 프롬프트를 elizax에 그대로 보낸다 */
  function ask(inst) {
    var p = enginePrompt(inst);
    if (!p) { toast("보낼 근거가 없습니다.", "warn"); return false; }
    try { if (window.Elizax && Elizax.open) Elizax.open(); } catch (e) { /* 무시 */ }
    if (sendToElizax(p)) return true;
    openDraftModal({ inst: inst, title: "알림 근거", note: "elizax 대화를 열 수 없어 근거를 그대로 보여드립니다.", text: p });
    return false;
  }

  window.EZSignalAct = {
    run: run,
    ask: ask,
    actionAt: actionAt,
    signalOf: signalOf,
    resolveScreen: resolveScreen,
    targetOf: targetOf
  };
})();
