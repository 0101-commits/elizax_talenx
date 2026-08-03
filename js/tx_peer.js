/* tx_peer.js — 「지금 1:1로 이야기 중인 상대」 단일 원천 (EZPeer)
   ----------------------------------------------------------------------------
   왜 필요한가
     성과관리 › 1:1 미팅 한 화면에 대상자를 정하는 곳이 셋 있었고 서로 몰랐다.
       · 좌측 elizax 녹음·요약 드롭다운 (tx_1on1.js  · selMemId)
       · 우측 미팅 카드 리스트        (tx_fix_perf.js · curMt[idx])
       · elizax 대화 패널            (tx_elizax.js   · state.subject)
     그래서 한 화면에 세 사람이 동시에 떴다. 어디서 바꾸든 나머지가 따라오도록
     상대 한 명을 여기 한 곳에만 둔다.

   계약
     EZPeer.get()            → {emp_id, name} 또는 null
     EZPeer.set(empId, src)  → 바뀌었을 때만 구독자에게 통지
     EZPeer.onChange(fn)     → fn({emp_id,name}, src)

     src = 「누가 바꿨는지」 꼬리표. 구독자는 자기가 낸 변경에 자기가 반응하지
     않도록 이 값으로 거른다. 꼬리표가 "-init"으로 끝나면 사람이 고른 것이 아니라
     화면이 처음 그려지며 알린 기본값이라는 뜻이다 — 사람의 선택에만 따라가야 하는
     구독자(예: elizax 대화의 대상)는 이걸 무시한다.

   초기값은 비워 둔다. 첫 소비자가 자기 기본값으로 set 한다.
   역할 전환은 페이지를 다시 읽으므로(switchTo → location.reload) 여기서 되돌릴 것이 없다.
   ========================================================================== */
(function () {
  "use strict";

  var cur = null;   /* {emp_id, name} */
  var subs = [];

  function nameOf(empId) {
    try {
      var list = (window.TALENX_DATA && window.TALENX_DATA.employees) || [];
      for (var i = 0; i < list.length; i++) if (list[i].emp_id === empId) return list[i].name || "";
    } catch (e) { /* 데이터 미로드 — 이름 없이도 emp_id만으로 동작한다 */ }
    return "";
  }

  function get() { return cur ? { emp_id: cur.emp_id, name: cur.name } : null; }

  function set(empId, src) {
    if (!empId) return;
    /* 같은 값이면 통지하지 않는다 — 구독자끼리 되울려 무한 루프가 되는 것을 막는다 */
    if (cur && cur.emp_id === empId) return;
    cur = { emp_id: empId, name: nameOf(empId) };
    var snap = get(), tag = String(src || "");
    for (var i = 0; i < subs.length; i++) {
      /* 구독자 하나가 던져도 나머지는 통지받아야 한다 — 화면 일부만 따라오는 어긋남 방지 */
      try { subs[i](snap, tag); } catch (e) { /* ignore */ }
    }
  }

  function onChange(fn) { if (typeof fn === "function") subs.push(fn); }

  window.EZPeer = { get: get, set: set, onChange: onChange };
})();
