/* ============================================================================
 * tx_proactive.js — 선제(proactive) 알림 단일 코디네이터
 * ----------------------------------------------------------------------------
 * 문제: 화면 우하단 FAB 주변에 선제 팝업이 서로를 모르는 채 3곳에서 뜬다.
 *   - tx_agent.js   .agh-popup      선제 감지 카드(열어서 확인/나중에)  right:24 bottom:96
 *   - tx_entry.js   .eze-pill       화면 문맥 제안 pill                 right:24 bottom:94  ← agh-popup과 같은 자리, 겹침
 *   - tx_upgrade.js .ezup-ctxchip   FAB 왼쪽 컨텍스트 칩                right:88 bottom:32
 * eze-pill·ezup-ctxchip는 둘 다 GNB/탭 클릭에 반응하고, agh-popup은 로드 9초 타이머라
 * 조작·타이밍이 겹치면 두 팝업이 동시에 떠 겹쳐 보인다.
 *
 * 해결: 전역 단일 슬롯. 새 팝업이 뜰 때 앞선 팝업을 닫고(replace) 자기를 active로 등록.
 *       → 어느 순간에도 선제 팝업은 하나만 보인다. 실제 기능(열어서 확인/나중에/제안
 *       수락/자동소멸)은 각 모듈이 그대로 수행한다.
 *
 * 계약: window.EZProactive.claim(id, dismissFn) / release(id).
 *   claim: 다른 id가 active면 그 dismissFn을 호출해 닫고, 자기를 active로 교체.
 *   release: 자기가 active일 때만 슬롯 비움(dismissFn 안에서 호출해도 안전).
 * 소비 모듈에서는 항상 `window.EZProactive &&` 로 가드해 로드 순서와 무관하게 동작.
 *
 * ponytail: 단일 전역 슬롯 — 우선순위/큐 없음(가장 최근 것이 이긴다). 특정 알림을
 *           반드시 살려야 하면 claim에 우선도 인자를 추가하는 것이 업그레이드 경로.
 * ========================================================================== */
(function () {
  "use strict";
  if (window.EZProactive) return;
  var active = null; // { id, dismiss }
  window.EZProactive = {
    claim: function (id, dismiss) {
      if (active && active.id !== id && typeof active.dismiss === "function") {
        try { active.dismiss(); } catch (e) { /* 무해화 */ }
      }
      active = { id: id, dismiss: (typeof dismiss === "function" ? dismiss : null) };
    },
    release: function (id) {
      if (active && active.id === id) active = null;
    }
  };
})();
