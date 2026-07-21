/* ============================================================
   tx_policy.js — 기록 보관·열람 규칙 (window.EZPolicy)
   ------------------------------------------------------------
   피드백의 두 질문에 화면으로 답한다:
   ① 쌓인 기록은 어떤 규칙으로 보존·폐기되는가
   ② "이 정보를 이 사람이 이 형태로 봐도 되는가"
   - TX.modal(wide) 위에 보존 규칙 + 역할별 열람 매트릭스 + 원칙을 표시
   - 상향 피드백(구성원→조직장) 행이 피드백의 대표 사례 — 강조 표시
   - vanilla JS IIFE · .ezpo-* 스코프 · 어떤 화면에서든 EZPolicy.open()
   ============================================================ */
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* ================= 스타일 (1회 주입) ================= */
  function injectStyle() {
    if (document.getElementById("ezpo-css")) return;
    var css = [
      ".ezpo-body{ font-family:var(--sans); font-size:13px; line-height:1.65; color:var(--ink,#1d1d1f); }",
      ".ezpo-sec{ margin-bottom:15px; }",
      ".ezpo-sec > b{ display:block; margin-bottom:6px; font-size:13.5px; font-weight:700; letter-spacing:-.02em; }",
      ".ezpo-sec ul{ margin:0; padding-left:18px; }",
      ".ezpo-sec li{ margin-bottom:4px; }",
      /* ---- 데모 한계 고지 (amber callout) ---- */
      ".ezpo-demo{ font-size:12px; line-height:1.6; color:#8a5a06; background:rgba(180,83,9,.07);",
      "  border:1px solid rgba(180,83,9,.32); border-radius:10px; padding:10px 13px; margin-bottom:15px; }",
      ".ezpo-demo b{ display:block; margin-bottom:3px; color:#B45309; font-weight:700; }",
      /* ---- 열람 매트릭스 ---- */
      ".ezpo-tblwrap{ overflow-x:auto; border:1px solid var(--line,#e8e8ed); border-radius:10px; }",
      ".ezpo-tbl{ width:100%; min-width:560px; border-collapse:collapse; font-size:11.5px; }",
      ".ezpo-tbl th,.ezpo-tbl td{ padding:8px 10px; border-bottom:1px solid var(--line-2,#f1f2f5); text-align:left; vertical-align:top; }",
      ".ezpo-tbl thead th{ font-size:11px; font-weight:700; color:var(--ink-2,#5c6474); background:var(--soft,#f5f6f8); white-space:nowrap; }",
      ".ezpo-tbl tbody tr:last-child th,.ezpo-tbl tbody tr:last-child td{ border-bottom:none; }",
      ".ezpo-tbl tbody th{ font-weight:700; color:var(--ink,#2a2e39); white-space:nowrap; }",
      ".ezpo-tbl tbody th small{ display:block; font-size:10px; font-weight:600; color:#B45309; margin-top:2px; }",
      ".ezpo-row-hl th,.ezpo-row-hl td{ background:rgba(180,83,9,.06); }",
      ".ezpo-row-hl th{ box-shadow:inset 3px 0 0 #B45309; }",
      /* ---- 셀 칩 (원문/요약/익명·집계/열람 불가) ---- */
      ".ezpo-cell{ display:inline-block; border-radius:999px; padding:2px 9px; font-weight:600; font-size:10.5px; border:1px solid; white-space:normal; }",
      ".ezpo-full{ color:#15803D; background:rgba(21,128,61,.07); border-color:rgba(21,128,61,.3); }",
      ".ezpo-summ{ color:var(--blue-2,#0E63D6); background:rgba(31,122,240,.07); border-color:rgba(31,122,240,.3); }",
      ".ezpo-anon{ color:var(--ink-2,#5c6474); background:var(--soft,#f5f6f8); border-color:var(--line,#e0e0e0); }",
      ".ezpo-no{ color:#B42318; background:rgba(180,35,24,.06); border-color:rgba(180,35,24,.3); }",
      ".ezpo-legend{ display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-top:8px; font-size:10.5px; color:var(--ink-3,#9096a3); }",
      ".ezpo-legend .lab{ font-weight:700; }",
      /* ---- 규정 정렬 각주 ---- */
      ".ezpo-reg{ font-size:11px; color:var(--ink-3,#7a7a7a); background:var(--soft,#f5f5f7); border-radius:8px; padding:8px 11px; margin-top:4px; }"
    ].join("\n");
    var st = document.createElement("style");
    st.id = "ezpo-css";
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ================= 열람 매트릭스 데이터 ================= */
  /* cells 순서: 본인 / 조직장 / HR / 경영진 · kind: full|summ|anon|no */
  var MATRIX = [
    { name: "내 목표·체크인",
      cells: [["full", "원문"], ["full", "원문"], ["full", "원문"], ["anon", "집계"]] },
    { name: "1:1 미팅 기록",
      cells: [["full", "원문"], ["summ", "확정 요약만"], ["summ", "확정 요약만"], ["no", "열람 불가"]] },
    { name: "동료 피드백 원문",
      cells: [["anon", "익명화 요약"], ["anon", "익명화 요약"], ["full", "원문 · 감사 목적 한정"], ["anon", "집계"]] },
    { name: "상향 피드백 (구성원→조직장)", hl: true, note: "작성자 보호 — 이 행이 핵심 사례",
      cells: [["full", "원문"], ["anon", "⚠ 익명·집계만 — 작성자 식별 불가 형태"], ["full", "원문 · 조사 목적 한정"], ["anon", "집계"]] },
    { name: "평가 근거·등급 초안",
      cells: [["summ", "확정 후 공개"], ["full", "원문"], ["full", "원문"], ["anon", "분포만"]] },
    { name: "성과 히스토리",
      cells: [["full", "본인 전체"], ["summ", "팀 범위"], ["summ", "권한 범위"], ["anon", "집계"]] }
  ];

  function cellHtml(c) {
    return '<td><span class="ezpo-cell ezpo-' + esc(c[0]) + '">' + esc(c[1]) + "</span></td>";
  }
  function matrixHtml() {
    var head = "<thead><tr><th>기록</th><th>본인</th><th>조직장</th><th>HR</th><th>경영진</th></tr></thead>";
    var rows = MATRIX.map(function (r) {
      return '<tr class="' + (r.hl ? "ezpo-row-hl" : "") + '"><th>' + esc(r.name)
        + (r.note ? "<small>" + esc(r.note) + "</small>" : "") + "</th>"
        + r.cells.map(cellHtml).join("") + "</tr>";
    }).join("");
    return '<div class="ezpo-tblwrap"><table class="ezpo-tbl">' + head + "<tbody>" + rows + "</tbody></table></div>"
      + '<div class="ezpo-legend"><span class="lab">표기</span>'
      + '<span class="ezpo-cell ezpo-full">원문</span>'
      + '<span class="ezpo-cell ezpo-summ">요약</span>'
      + '<span class="ezpo-cell ezpo-anon">익명·집계</span>'
      + '<span class="ezpo-cell ezpo-no">열람 불가</span></div>';
  }

  function bodyHtml() {
    return '<div class="ezpo-body">'
      /* ---- ① 보존 규칙 ---- */
      + '<div class="ezpo-sec"><b>무엇을 보관하나</b><ul>'
      + "<li><b>승인·확정된 기록만</b> 보관합니다. 확정 전 초안은 폐기할 수 있고, 폐기된 요약은 성과 히스토리에 남지 않습니다 — 맥락 오염 방지.</li>"
      + "<li>보관 기간: <b>평가 사이클 종료 후 3년</b>. 이의제기가 진행 중이면 해당 기록의 삭제는 동결됩니다.</li>"
      + "<li>모든 확정·수정·취소는 <b>감사 기록과 함께</b> 남습니다.</li>"
      + "</ul></div>"
      /* ---- 데모 한계 고지 ---- */
      + '<div class="ezpo-demo"><b>데모 한계 고지</b>'
      + "이 목업의 성과 히스토리는 브라우저(localStorage)에만 저장되며 최근 80건까지만 보관됩니다. "
      + "실서비스에서는 평가 근거가 이렇게 다뤄지면 안 되므로, 서버 측 보존 저장소(보존 정책·권한·감사 포함)가 다음 단계 과제입니다.</div>"
      /* ---- ② 열람 매트릭스 ---- */
      + '<div class="ezpo-sec"><b>누가 어디까지 보나</b>' + matrixHtml() + "</div>"
      /* ---- ③ 원칙 ---- */
      + '<div class="ezpo-sec"><b>원칙</b><ul>'
      + "<li>근거 없는 답변 금지와 같은 급의 원칙으로, <b>“이 정보를 이 사람이 이 형태로 봐도 되는가”</b>를 매 노출마다 검사합니다.</li>"
      + "<li>역할별 근거 노출 깊이(핵심 근거 / 근거+출처 / 산출 로직)와 결합해 적용됩니다.</li>"
      + "<li>민감 원문은 형태 변환(요약·익명화) 후에만 이동합니다.</li>"
      + "</ul></div>"
      + '<div class="ezpo-reg">평가규정 v3.1 · 개인정보보호법 §37조의2 · EU AI Act 고지 의무와 정렬</div>'
      + "</div>";
  }

  /* ================= 공개 API ================= */
  function open() {
    if (!(window.TX && TX.modal)) return null;
    injectStyle();
    return TX.modal({
      title: "기록 보관·열람 규칙",
      wide: true,
      body: bodyHtml(),
      actions: [{ label: "확인", kind: "primary" }]
    });
  }

  window.EZPolicy = { open: open };
})();
