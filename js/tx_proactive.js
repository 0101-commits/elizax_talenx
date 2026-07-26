/* ============================================================================
 * tx_proactive.js — 선제(proactive) 알림 단일 코디네이터 (§6 2슬롯 프레임)
 * ----------------------------------------------------------------------------
 * 슬롯 1(pill/토스트)을 세 표면이 시간 공유한다:
 *   - tx_agent.js   .agh-popup      선제 감지 카드        prio 3 (최상)
 *   - tx_entry.js   .eze-pill       화면 문맥 제안 pill    prio 2
 *   - tx_upgrade.js .ezup-ctxchip   컨텍스트 칩/온보딩     prio 1
 * 규칙: 새 claim의 prio ≥ active prio → 교체(밀린 쪽 [알림] 적재).
 *       새 claim의 prio <  active prio → 새 쪽을 즉시 닫고 [알림]으로만 적재.
 * 슬롯 2는 FAB 자체(카운트) — 여기서 관리하지 않는다.
 *
 * 증발 금지: 교체·소멸된 항목은 EZNotif(도킹 패널 [알림] 탭 스토어)에 적재.
 *   release(id, acted) — acted=true면 사용자가 실행한 것이므로 적재 생략.
 *   ponytail: tx_agent/tx_entry는 acted 플래그를 아직 안 넘김 — 실행된 항목도
 *   적재되는 소음 있음. 해당 파일 소유 작업에서 release(id, true) 전달이 업그레이드 경로.
 *
 * 계약(하위호환): window.EZProactive.claim(id, dismissFn) / release(id[, acted]).
 * ========================================================================== */
(function () {
  "use strict";
  if (window.EZProactive && window.EZProactive.__v2) return;
  var PRIO = { "agh-popup": 3, "eze-pill": 2, "ezup-ctxchip": 1, "ezup-onboard": 1 };
  var SEL = { "agh-popup": ".agh-popup", "eze-pill": ".eze-pill", "ezup-ctxchip": ".ezup-ctxchip", "ezup-onboard": ".ezup-ctxchip" };
  var LABEL = { "agh-popup": "선제 감지", "eze-pill": "화면 제안", "ezup-ctxchip": "문맥 제안", "ezup-onboard": "안내" };
  var active = null; // { id, dismiss }

  function snapshot(id) {
    var el = SEL[id] ? document.querySelector(SEL[id]) : null;
    var t = el ? (el.textContent || "").replace(/\s+/g, " ").trim() : "";
    return t || LABEL[id] || id;
  }
  function archive(id, body) {
    if (!(window.EZNotif && typeof window.EZNotif.push === "function")) return;
    try { window.EZNotif.push({ kind: "proactive", src: id, title: LABEL[id] || id, body: body }); } catch (e) { /* 스토어 미로드 등 — 무해화 */ }
  }
  window.EZProactive = {
    __v2: true,
    claim: function (id, dismiss) {
      var p = PRIO[id] != null ? PRIO[id] : 2;
      if (active && active.id !== id) {
        var ap = PRIO[active.id] != null ? PRIO[active.id] : 2;
        if (p < ap) { // 상위가 점유 중 — 새 항목은 표시 없이 알림 적재 후 닫기
          archive(id, snapshot(id));
          if (typeof dismiss === "function") { try { dismiss(); } catch (e) {} }
          return false;
        }
        var old = active;
        active = null; // dismiss 안의 release() 재진입 시 이중 적재 방지
        archive(old.id, snapshot(old.id)); // 밀린 쪽 적재 (DOM 제거 전 스냅샷)
        if (typeof old.dismiss === "function") { try { old.dismiss(); } catch (e) {} }
      }
      active = { id: id, dismiss: (typeof dismiss === "function" ? dismiss : null) };
      return true;
    },
    release: function (id, acted) {
      if (!active || active.id !== id) return;
      if (!acted) archive(id, snapshot(id)); // 자연 소멸·"나중에" — 잔존
      active = null;
    }
  };
})();
