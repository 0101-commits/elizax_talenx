/* ============================================================================
 * tx_proactive.js — 알림 단일 코디네이터 (§6 2슬롯 프레임)
 * ----------------------------------------------------------------------------
 * 슬롯 1(우하단)을 네 표면이 시간 공유한다 — 화면에 쓰는 말은 「알림」 하나:
 *   - ez_signal_card.js .ezs-slot      신호 알림 카드        prio 4 (최상)
 *   - tx_agent.js       .agh-popup     폴백 알림 카드        prio 3
 *   - tx_entry.js       .eze-pill      화면 문맥 폴백 pill   prio 2
 *   - tx_upgrade.js     .ezup-ctxchip  컨텍스트 칩           prio 1
 * 규칙: 새 claim의 prio ≥ active prio → 교체. prio < active prio → 새 쪽 즉시 닫기.
 * 슬롯 2는 FAB 자체(카운트) — 여기서 관리하지 않는다.
 *
 * [알림] 적재는 신호 카드만: FAB 배지는 EZNotif 건수를 세므로, 만료된 문맥 칩·
 * 화면 폴백까지 적재하면 화면만 옮겨도 숫자가 자동으로 오른다(배지 폭주 근본원인).
 * 처리할 일이 있는 신호 카드만 남기고 나머지는 흔적 없이 사라진다.
 *
 * 계약(하위호환): window.EZProactive.claim(id, dismissFn) / release(id[, acted]).
 * ========================================================================== */
(function () {
  "use strict";
  if (window.EZProactive && window.EZProactive.__v2) return;
  /* 신호 카드 id는 ez_signal_card.js(W2)가 claim 시 쓰는 키 — 두 표기 모두 허용 */
  var PRIO = { "ezs-slot": 4, "ezs-card": 4, "agh-popup": 3, "eze-pill": 2, "ezup-ctxchip": 1 };
  var SEL = { "ezs-slot": ".ezs-slot", "ezs-card": ".ezs-card", "agh-popup": ".agh-popup", "eze-pill": ".eze-pill", "ezup-ctxchip": ".ezup-ctxchip" };
  var LABEL = { "ezs-slot": "알림", "ezs-card": "알림", "agh-popup": "알림", "eze-pill": "알림", "ezup-ctxchip": "알림" };
  var SIGNAL = { "ezs-slot": 1, "ezs-card": 1 };   // [알림] 적재 대상 = 신호 카드만
  var active = null; // { id, dismiss }

  /* 카드 전체 textContent를 그대로 적재하면 버튼 글자까지 문장에 달라붙는다
     ("…벌어졌어요열어보기나중에"). 19차: 알림 문장만 골라 담는다 —
     `.ezs-tx`(문장) → `.ezs-line`(권유+문장) → 버튼(.ezs-btns) 뺀 나머지 순. */
  function norm(s) {
    return String(s == null ? "" : s).replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
  }
  function bodyOf(el) {
    if (!el) return "";
    var pick = el.querySelector(".ezs-tx") || el.querySelector(".ezs-line");
    if (pick) return norm(pick.textContent);
    var t = "";
    try {
      var clone = el.cloneNode(true);
      var btns = clone.querySelectorAll(".ezs-btns, button, .ezs-more");
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].parentNode) btns[i].parentNode.removeChild(btns[i]);
      }
      t = norm(clone.textContent);
    } catch (e) { t = norm(el.textContent); }
    return t;
  }
  function snapshot(id) {
    var el = SEL[id] ? document.querySelector(SEL[id]) : null;
    return bodyOf(el) || LABEL[id] || id;
  }
  /* "다시 실행" 복원용 질문 문구 — 표면 DOM에 _ask가 붙어 있으면 그대로 적재한다
     (밀려난 제안을 [알림] 탭에서 다시 물어볼 수 있게 하는 유일한 경로) */
  function askOf(id) {
    try {
      var el = SEL[id] ? document.querySelector(SEL[id]) : null;
      if (!el || !el._ask) return null;
      return el._ask === "__brief__" ? "1:1 미팅 브리핑해줘" : String(el._ask);
    } catch (e) { return null; }
  }
  /* 19차 §5-3 — 「지난 알림」 쓰레기 차단.
     스냅샷 본문이 라벨과 같거나(「알림」) 8자 미만이면 사용자가 읽을 내용이 없다.
     그런 항목이 50건 상한을 채워 「지난 알림」이 빈 줄 목록처럼 보이던 근본원인. */
  function worthArchiving(id, body) {
    var t = norm(body);
    if (!t) return false;
    if (t === (LABEL[id] || id)) return false;
    return t.length >= 8;
  }
  function archive(id, body) {
    if (!SIGNAL[id]) return;   // 신호 카드가 아니면 아무 흔적도 남기지 않는다 (배지 폭주 차단)
    if (!worthArchiving(id, body)) return;   // 라벨뿐인 빈 스냅샷은 적재하지 않는다
    if (!(window.EZNotif && typeof window.EZNotif.push === "function")) return;
    try { window.EZNotif.push({ kind: "proactive", src: id, title: LABEL[id] || id, body: body, action: askOf(id) }); } catch (e) { /* 스토어 미로드 등 — 무해화 */ }
  }
  window.EZProactive = {
    __v2: true,
    claim: function (id, dismiss) {
      var p = PRIO[id] != null ? PRIO[id] : 2;
      if (active && active.id !== id) {
        var ap = PRIO[active.id] != null ? PRIO[active.id] : 2;
        if (p < ap) { // 상위가 점유 중 — 새 항목은 표시하지 않고 닫는다(신호 카드면 [알림] 적재)
          archive(id, snapshot(id));
          if (typeof dismiss === "function") { try { dismiss(); } catch (e) {} }
          return false;
        }
        var old = active;
        active = null; // dismiss 안의 release() 재진입 시 이중 적재 방지
        archive(old.id, snapshot(old.id)); // 밀린 쪽이 신호 카드면 적재 (DOM 제거 전 스냅샷)
        if (typeof old.dismiss === "function") { try { old.dismiss(); } catch (e) {} }
      }
      active = { id: id, dismiss: (typeof dismiss === "function" ? dismiss : null) };
      return true;
    },
    release: function (id, acted) {
      if (!active || active.id !== id) return;
      if (!acted) archive(id, snapshot(id)); // 자연 소멸·"나중에" — 신호 카드만 잔존
      active = null;
    }
  };
})();
