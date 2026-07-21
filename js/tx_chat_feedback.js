/* =====================================================================
   tx_chat_feedback.js — AI 응답 피드백 (👍/👎) 확장 모듈
   =====================================================================
   [기획 스펙]

   ① 배경/문제
      - elizax AI의 응답 품질을 개선하려면 사용자 반응 데이터가 필요하다.
      - 현재 대화창(FAB 도킹창·TXAgent 허브)에는 응답에 대한 평가 수단이
        없어, 부정확하거나 장황한 답변이 그대로 흘러가고 개선 루프가 없다.
      - HCG 4원칙 중 "감사 가능성" 관점: 피드백도 감사 로그처럼 기록·영속화
        되어야 하며, 사용자가 남긴 평가가 세션 저장소에 남아야 한다.

   ② 사용자 시나리오
      - 사용자가 elizax에게 질문 → AI 응답 완료 → 응답 버블 하단에
        👍/👎 아이콘 쌍이 상시 표시된다.
      - 👍 클릭: 즉시 "도움됨"으로 기록되고 아이콘이 활성 색으로 바뀐다.
        다시 클릭하면 평가가 취소된다.
      - 👎 클릭: 사유 선택 모달(부정확/근거 부족/장황함/기타+상세 텍스트)이
        열리고, 제출하면 사유와 함께 기록된다. 활성 상태에서 재클릭 시 취소.
      - 세션을 전환했다가 돌아오거나 새로고침해도(EZChat 영속화) 남긴
        평가 상태가 아이콘에 그대로 복원된다.

   ③ 동작 정의
      - 대상: 완료된 AI 메시지(role==="ai", streaming 아님, text 있음)만.
        nav/scn/work/err 및 스트리밍 중 버블에는 표시하지 않는다.
      - 주입: EZChat "messages" / "streaming"(on=false) / "switch" 이벤트 후
        현재 리스트(.ezx-list 및 [data-agh-chatlist])를 스캔해 각 AI 메시지
        노드 하단에 버튼 쌍을 주입한다(이중 주입 방지, 멱등 갱신).
        추가로 MutationObserver로 허브 attachSurface 등 이벤트 없는
        재렌더까지 커버한다.
      - 매칭: renderMessages()가 EZChat.messages() 배열을 순서대로 1:1로
        .ezx-msg 노드로 그리므로, 리스트 내 .ezx-msg 순서 == 메시지 배열
        순서 대응으로 매칭한다(개수 불일치 리스트는 스테일로 보고 건너뜀).
      - 기록: 클릭 시 해당 메시지 객체에
          m.fb = { v:"up"|"down", at:ISO문자열, reason? }
        를 기록하고 EZChat.save() 호출 → 자동 영속화 + 재렌더 → 재주입.
      - 👎 사유: TX.modal로 부정확/근거 부족/장황함/기타(+텍스트) 선택.
        제출 시 fb.reason 저장 후 토스트:
        "개선에 반영됩니다 — 피드백이 기록되었습니다 · 감사 로그에 기록됨"
      - 평가된 메시지에는 "감사 로그 기록됨 · 시각" 미니 라벨을 함께 표시.

   ④ 엣지 케이스
      - EZChat/TX 미로드: 300ms 간격 최대 20회 폴링 후 포기(무해하게 종료).
      - 재렌더로 리스트 innerHTML 리셋: 클릭은 document 레벨 위임으로 처리,
        버튼은 이벤트/옵저버 후 재주입되므로 유실되지 않는다.
      - 메시지 배열과 노드 개수 불일치(detach된 스테일 리스트, 빈 상태
        .ezx-empty 등): 해당 리스트는 스캔하지 않는다.
      - 클릭 시점의 인덱스는 data 속성이 아니라 DOM 위치에서 즉석 재계산
        (메시지 삭제 등으로 인덱스가 밀리는 경우 방지).
      - 모달에서 사유 미선택 제출: 경고 토스트 후 모달 유지.
      - AI 오프라인(목업 응답) 모드에서도 동일하게 동작(저장은 로컬 원장).
      - 스트리밍 중 취소된 빈 ai 메시지(text 없음)에는 버튼을 붙이지 않음.
   ===================================================================== */
(function () {
  "use strict";

  /* ---------------- 유틸 ---------------- */

  /* HTML 이스케이프 (& < > 치환) */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /* 클래스명으로 조상 탐색 (closest 폴리백) */
  function closestByClass(node, cls) {
    var n = node;
    while (n && n !== document) {
      if (n.classList && n.classList.contains(cls)) return n;
      n = n.parentNode;
    }
    return null;
  }

  /* ISO 시각 → "HH:MM" 표시용 */
  function timeLabel(iso) {
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      var hh = d.getHours(); var mm = d.getMinutes();
      return (hh < 10 ? "0" + hh : hh) + ":" + (mm < 10 ? "0" + mm : mm);
    } catch (e) { return ""; }
  }

  function toast(msg, kind) {
    if (window.TX && window.TX.toast) window.TX.toast(msg, kind || "");
  }

  /* ---------------- 스타일 주입 ---------------- */
  function injectStyle() {
    if (document.getElementById("ezcx-fb-style")) return;
    var st = document.createElement("style");
    st.id = "ezcx-fb-style";
    st.textContent =
      /* 버튼 행 */
      ".ezcx-fb-wrap{display:flex;align-items:center;gap:4px;margin:4px 0 2px;}" +
      ".ezcx-fb-btn{border:1px solid var(--line,#E4E7EC);background:var(--card,#fff);color:var(--ink,#1D2433);" +
      "border-radius:999px;padding:1px 9px;font-size:12px;line-height:1.6;cursor:pointer;opacity:.72;" +
      "transition:opacity .12s,border-color .12s,background .12s;}" +
      ".ezcx-fb-btn:hover{opacity:1;border-color:var(--blue,#1F7AF0);}" +
      ".ezcx-fb-btn.on{opacity:1;}" +
      ".ezcx-fb-btn.ezcx-fb-up.on{border-color:var(--blue,#1F7AF0);color:var(--blue,#1F7AF0);background:rgba(31,122,240,.09);}" +
      ".ezcx-fb-btn.ezcx-fb-down.on{border-color:#C2410C;color:#C2410C;background:rgba(194,65,12,.09);}" +
      ".ezcx-fb-audit{font-size:11px;color:var(--muted,#98A2B3);margin-left:2px;}" +
      /* 사유 모달 */
      ".ezcx-fb-opts{display:flex;flex-direction:column;gap:6px;margin:4px 0 10px;}" +
      ".ezcx-fb-opt{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--line,#E4E7EC);" +
      "border-radius:8px;background:var(--soft,#F8FAFC);cursor:pointer;font-size:13px;color:var(--ink,#1D2433);}" +
      ".ezcx-fb-opt:hover{border-color:var(--blue,#1F7AF0);}" +
      ".ezcx-fb-opt input{margin:0;accent-color:var(--blue,#1F7AF0);}" +
      ".ezcx-fb-ta{width:100%;box-sizing:border-box;border:1px solid var(--line,#E4E7EC);border-radius:8px;" +
      "padding:8px 10px;font-size:13px;font-family:inherit;background:var(--card,#fff);color:var(--ink,#1D2433);" +
      "resize:vertical;min-height:56px;}" +
      ".ezcx-fb-hint{font-size:11px;color:var(--muted,#98A2B3);margin-top:8px;}";
    document.head.appendChild(st);
  }

  /* ---------------- 메시지 ↔ 노드 매칭 스캔 ---------------- */

  /* 리스트 안의 .ezx-msg 직계 자식들을 순서대로 수집 */
  function msgNodesOf(list) {
    var out = [], i, c;
    for (i = 0; i < list.children.length; i++) {
      c = list.children[i];
      if (c.classList && c.classList.contains("ezx-msg")) out.push(c);
    }
    return out;
  }

  /* 피드백 대상 여부: 완료된 AI 텍스트 응답만 */
  function eligible(m) {
    return !!(m && m.role === "ai" && !m.streaming && m.text);
  }

  /* 버튼 행 생성/갱신 (멱등 — 이미 있으면 상태만 반영) */
  function applyToNode(node, m) {
    var wrap = null, i;
    for (i = 0; i < node.children.length; i++) {
      if (node.children[i].classList && node.children[i].classList.contains("ezcx-fb-wrap")) { wrap = node.children[i]; break; }
    }
    if (!eligible(m)) { if (wrap) node.removeChild(wrap); return; }
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "ezcx-fb-wrap";
      wrap.innerHTML =
        '<button type="button" class="ezcx-fb-btn ezcx-fb-up" title="도움됨" aria-label="도움됨">👍</button>' +
        '<button type="button" class="ezcx-fb-btn ezcx-fb-down" title="아쉬움" aria-label="아쉬움">👎</button>' +
        '<span class="ezcx-fb-audit"></span>';
      node.appendChild(wrap);
    }
    /* 저장된 fb 상태 복원/반영 */
    var up = wrap.querySelector(".ezcx-fb-up");
    var down = wrap.querySelector(".ezcx-fb-down");
    var audit = wrap.querySelector(".ezcx-fb-audit");
    var v = m.fb && m.fb.v;
    if (up) up.classList[v === "up" ? "add" : "remove"]("on");
    if (down) down.classList[v === "down" ? "add" : "remove"]("on");
    if (audit) {
      if (m.fb) {
        var t = timeLabel(m.fb.at);
        audit.textContent = "감사 로그 기록됨" + (t ? " · " + t : "") + (m.fb.reason ? " · " + m.fb.reason : "");
      } else {
        audit.textContent = "";
      }
    }
  }

  /* 현재 화면의 모든 대화 리스트를 스캔해 주입 */
  function scan() {
    if (!window.EZChat || !window.EZChat.messages) return;
    var msgs = window.EZChat.messages();
    var lists = document.querySelectorAll(".ezx-list, [data-agh-chatlist]");
    var li, list, nodes, i;
    for (li = 0; li < lists.length; li++) {
      list = lists[li];
      nodes = msgNodesOf(list);
      /* 렌더는 메시지 배열과 1:1 — 개수가 다르면 스테일 리스트로 보고 건너뜀 */
      if (!nodes.length || nodes.length !== msgs.length) continue;
      for (i = 0; i < nodes.length; i++) applyToNode(nodes[i], msgs[i]);
    }
  }

  var scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(function () { scanTimer = null; scan(); }, 30);
  }

  /* ---------------- 클릭 → fb 기록 ---------------- */

  /* 클릭 시점에 DOM 위치로 메시지 인덱스를 재계산 (스테일 인덱스 방지) */
  function resolveMessage(btn) {
    if (!window.EZChat || !window.EZChat.messages) return null;
    var node = closestByClass(btn, "ezx-msg");
    if (!node || !node.parentNode) return null;
    var list = node.parentNode;
    var nodes = msgNodesOf(list);
    var msgs = window.EZChat.messages();
    if (nodes.length !== msgs.length) return null;
    var idx = -1, i;
    for (i = 0; i < nodes.length; i++) { if (nodes[i] === node) { idx = i; break; } }
    if (idx < 0) return null;
    var m = msgs[idx];
    return eligible(m) ? m : null;
  }

  function saveFb(m, v, reason) {
    m.fb = { v: v, at: new Date().toISOString() };
    if (reason) m.fb.reason = reason;
    if (window.EZChat.save) window.EZChat.save();
    scheduleScan(); /* save가 이벤트를 내지 않는 구현 대비 보험 */
  }

  function clearFb(m) {
    delete m.fb;
    if (window.EZChat.save) window.EZChat.save();
    scheduleScan();
    toast("피드백을 취소했습니다.", "");
  }

  /* 👎 사유 선택 모달 */
  var REASONS = ["부정확", "근거 부족", "장황함", "기타"];
  function openReasonModal(m) {
    if (!(window.TX && window.TX.modal)) {
      /* 모달 불가 환경 폴백 — 사유 없이 기록 */
      saveFb(m, "down");
      toast("개선에 반영됩니다 — 피드백이 기록되었습니다 · 감사 로그에 기록됨", "ok");
      return;
    }
    var body = document.createElement("div");
    var html = '<div class="ezcx-fb-opts">';
    var i;
    for (i = 0; i < REASONS.length; i++) {
      html += '<label class="ezcx-fb-opt"><input type="radio" name="ezcx-fb-reason" value="' + esc(REASONS[i]) + '"><span>' + esc(REASONS[i]) + "</span></label>";
    }
    html += "</div>" +
      '<textarea class="ezcx-fb-ta" placeholder="상세 의견 (선택 — 기타 선택 시 권장)"></textarea>' +
      '<div class="ezcx-fb-hint">제출된 피드백은 감사 로그에 기록되며, 응답 품질 개선에 사용됩니다.</div>';
    body.innerHTML = html;
    window.TX.modal({
      title: "무엇이 아쉬웠나요?",
      body: body,
      actions: [
        { label: "취소", kind: "ghost" },
        {
          label: "제출", kind: "primary",
          onClick: function (box) {
            var sel = box.querySelector('input[name="ezcx-fb-reason"]:checked');
            if (!sel) { toast("사유를 선택해주세요.", "warn"); return false; }
            var ta = box.querySelector(".ezcx-fb-ta");
            var detail = ta && ta.value ? ta.value.trim() : "";
            var reason = sel.value + (detail ? " — " + detail : "");
            saveFb(m, "down", reason);
            toast("개선에 반영됩니다 — 피드백이 기록되었습니다 · 감사 로그에 기록됨", "ok");
          }
        }
      ]
    });
  }

  function onDocClick(e) {
    var t = e.target;
    var btn = closestByClass(t, "ezcx-fb-btn");
    if (!btn) return;
    var m = resolveMessage(btn);
    if (!m) return;
    var isUp = btn.classList.contains("ezcx-fb-up");
    var cur = m.fb && m.fb.v;
    if (isUp) {
      if (cur === "up") { clearFb(m); return; }        /* 재클릭 → 취소 */
      saveFb(m, "up");
      toast("피드백이 기록되었습니다 · 감사 로그에 기록됨", "ok");
    } else {
      if (cur === "down") { clearFb(m); return; }      /* 재클릭 → 취소 */
      openReasonModal(m);                               /* 제출 시 저장 */
    }
  }

  /* ---------------- 부트스트랩 ---------------- */
  function wire() {
    injectStyle();
    document.addEventListener("click", onDocClick, false);

    /* 재렌더 후 재주입: 내용 변경 / 스트리밍 종료 / 세션 전환 */
    window.EZChat.on("messages", function () { scheduleScan(); });
    window.EZChat.on("streaming", function (d) { if (d && d.on === false) scheduleScan(); });
    window.EZChat.on("switch", function () { scheduleScan(); });

    /* 이벤트 없이 일어나는 재렌더(허브 attachSurface 등) 커버 —
       우리가 넣은 노드(.ezcx-fb-wrap) 추가로 인한 재트리거는 무시 */
    if (window.MutationObserver && document.body) {
      var mo = new MutationObserver(function (muts) {
        var i, j, n, need = false;
        for (i = 0; i < muts.length && !need; i++) {
          for (j = 0; j < muts[i].addedNodes.length; j++) {
            n = muts[i].addedNodes[j];
            if (n.nodeType !== 1) continue;
            if (n.classList && n.classList.contains("ezcx-fb-wrap")) continue;
            if ((n.classList && n.classList.contains("ezx-msg")) || (n.querySelector && n.querySelector(".ezx-msg"))) { need = true; break; }
          }
        }
        if (need) scheduleScan();
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }

    scan(); /* 초기 1회 — 복원된 세션의 기존 fb 상태 반영 */
  }

  /* EZChat/DOM은 늦게 생긴다 — 300ms 간격 최대 20회 폴링 */
  function boot() {
    var tries = 0;
    (function poll() {
      if (window.EZChat && window.EZChat.on && document.body) { wire(); return; }
      tries++;
      if (tries >= 20) return; /* 환경 미성립 — 조용히 포기 */
      setTimeout(poll, 300);
    })();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
