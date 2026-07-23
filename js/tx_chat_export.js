/* ============================================================
   tx_chat_export.js — elizax 대화 내보내기 모듈

   [기획 스펙]
   ① 배경/문제
      elizax와의 대화(성과 코칭·시나리오 실행 내역 등)는 브라우저
      localStorage에만 저장되어, 회고·보고·공유 목적으로 밖으로
      꺼낼 방법이 없다. 데모에서도 "대화를 증빙으로 남긴다"는
      verifiable 흐름을 보여줄 내보내기 장치가 필요하다.
   ② 사용자 시나리오
      1) 사용자가 FAB 대화창을 열고 하단 푸터행의 "내보내기" 클릭
      2) 모달에서 ①Markdown 다운로드 ②JSON 다운로드
         ③클립보드 복사(Markdown) 중 하나 선택
      3) 파일이 즉시 다운로드되거나 클립보드에 복사되고 토스트 확인
   ③ 동작 정의
      - FAB 푸터행(.ezx-foot-row)의 "대화 초기화" 버튼 옆에
        "내보내기" 버튼 주입 (푸터행은 재렌더 대상 아님 — 1회 주입,
        중복 방지 가드)
      - Markdown 변환: 헤더(세션 제목·내보낸 시각·사용자명) +
        메시지별 "**사용자**"/"**elizax**" 라벨,
        nav → "→ 화면 이동: <라벨>", scn → "✦ 시나리오 실행: <key>",
        note → 이탤릭 각주(*…*)
      - 다운로드: Blob + a[download],
        파일명 elizax_대화_YYYYMMDD_HHMM.md / .json
      - JSON은 EZChat.exportSession() 결과를 pretty-print(2칸)
      - 성공 시 TX.toast(ok)
   ④ 엣지 케이스
      - 내보낼 메시지가 0건(work 카드만 있던 경우 포함) →
        "내보낼 대화가 없습니다" 토스트만 띄우고 모달 미표시
      - window.EZChat / window.TX 부재 → 조용히 비활성(콘솔 경고)
      - .ezx-foot-row는 DOMContentLoaded 이후 생성 →
        300ms 간격 최대 20회 폴링으로 주입
      - 클립보드 API 미지원/권한 거부 → textarea + execCommand
        폴백, 그마저 실패하면 warn 토스트
      - nav 라벨 누락 → target.s/p 조합으로 폴백 표기
   ============================================================ */
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

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  /* 표시용 시각: YYYY-MM-DD HH:MM */
  function stampHuman(t) {
    return t.getFullYear() + "-" + pad2(t.getMonth() + 1) + "-" + pad2(t.getDate()) +
      " " + pad2(t.getHours()) + ":" + pad2(t.getMinutes());
  }
  /* 파일명용 시각: YYYYMMDD_HHMM */
  function stampFile(t) {
    return "" + t.getFullYear() + pad2(t.getMonth() + 1) + pad2(t.getDate()) +
      "_" + pad2(t.getHours()) + pad2(t.getMinutes());
  }

  function toast(msg, kind) {
    if (window.TX && TX.toast) TX.toast(msg, kind || "");
  }

  function userName() {
    var D = window.TALENX_DATA;
    if (D && D.meta && D.meta.currentUser && D.meta.currentUser.name) {
      return D.meta.currentUser.name;
    }
    return "(알 수 없음)";
  }

  /* ---------------- Markdown 변환 ---------------- */

  function msgToMd(m) {
    if (!m || !m.role) return null;
    if (m.role === "nav") {
      var label = (m.target && m.target.label) ||
        (m.target ? ((m.target.s || "") + (m.target.p ? " > " + m.target.p : "")) : "");
      return "→ 화면 이동: " + (label || "(알 수 없음)");
    }
    if (m.role === "scn") {
      return "✦ 시나리오 실행: " + (m.key || "(알 수 없음)");
    }
    if (m.role === "user" || m.role === "ai" || m.role === "err") {
      var who = (m.role === "user") ? "사용자" : "elizax";
      if (m.role === "err") who += " (오류)";
      var block = "**" + who + "**\n\n" + (m.text || "");
      if (m.note) block += "\n\n*" + m.note + "*";   /* note → 이탤릭 각주 */
      return block;
    }
    return null; /* work 등 저장 제외 카드 */
  }

  function sessionToMd(sess, now) {
    var lines = [];
    lines.push("# " + (sess.title || "새 대화"));
    lines.push("");
    lines.push("- 내보낸 시각: " + stampHuman(now));
    lines.push("- 사용자: " + userName());
    lines.push("");
    lines.push("---");
    lines.push("");
    var blocks = [];
    (sess.messages || []).forEach(function (m) {
      var b = msgToMd(m);
      if (b) blocks.push(b);
    });
    return lines.join("\n") + "\n" + blocks.join("\n\n") + "\n";
  }

  /* ---------------- 다운로드 / 클립보드 ---------------- */

  function download(filename, text, mime) {
    try {
      var blob = new Blob([text], { type: (mime || "text/plain") + ";charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      return true;
    } catch (e) {
      console.warn("[tx_chat_export] 다운로드 실패", e);
      return false;
    }
  }

  function copyToClipboard(text, onDone) {
    /* 1차: 비동기 Clipboard API */
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { onDone(true); },
        function () { onDone(copyFallback(text)); }
      );
      return;
    }
    onDone(copyFallback(text));
  }
  /* 2차 폴백: 숨김 textarea + execCommand */
  function copyFallback(text) {
    var ok = false;
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand("copy");
      document.body.removeChild(ta);
    } catch (e) { ok = false; }
    return ok;
  }

  /* ---------------- 내보내기 실행 ---------------- */

  /* 내보낼 세션을 얻는다. 없거나 비었으면 null */
  function grabSession() {
    if (!window.EZChat || !EZChat.exportSession) return null;
    var sess = null;
    try { sess = EZChat.exportSession(); } catch (e) { sess = null; }
    if (!sess || !sess.messages || !sess.messages.length) return null;
    return sess;
  }

  function doExport(kind) {
    var sess = grabSession();
    if (!sess) { toast("내보낼 대화가 없습니다", "warn"); return; }
    var now = new Date();
    var base = "elizax_대화_" + stampFile(now);

    if (kind === "md") {
      if (download(base + ".md", sessionToMd(sess, now), "text/markdown")) {
        toast("Markdown 파일을 내려받았습니다", "ok");
      } else {
        toast("다운로드에 실패했습니다", "warn");
      }
      return;
    }
    if (kind === "json") {
      var json = "";
      try { json = JSON.stringify(sess, null, 2); } catch (e) { json = ""; }
      if (json && download(base + ".json", json, "application/json")) {
        toast("JSON 파일을 내려받았습니다", "ok");
      } else {
        toast("다운로드에 실패했습니다", "warn");
      }
      return;
    }
    if (kind === "copy") {
      copyToClipboard(sessionToMd(sess, now), function (ok) {
        if (ok) toast("대화를 클립보드에 복사했습니다 (Markdown)", "ok");
        else toast("클립보드 복사에 실패했습니다", "warn");
      });
    }
  }

  /* ---------------- 선택 모달 ---------------- */

  function openModal() {
    /* 비어 있으면 모달 없이 토스트만 */
    if (!grabSession()) { toast("내보낼 대화가 없습니다", "warn"); return; }
    if (!window.TX || !TX.modal) { doExport("md"); return; } /* 모달 불가 → MD 즉시 */

    var title = "새 대화";
    var count = 0;
    try {
      var sess = grabSession();
      title = sess.title || "새 대화";
      count = sess.messages.length;
    } catch (e) { /* ignore */ }

    var body =
      '<div class="ezcx-exp-sub">대화 “' + esc(title) + '” · 메시지 ' + count + '건</div>' +
      '<div class="ezcx-exp-opts">' +
        '<button type="button" class="ezcx-exp-opt" data-exp="md">' +
          '<span class="ezcx-exp-ic">⬇</span>' +
          '<span class="ezcx-exp-tx"><b>Markdown 다운로드</b><small>.md 파일 — 보고·회고용 문서</small></span>' +
        '</button>' +
        '<button type="button" class="ezcx-exp-opt" data-exp="json">' +
          '<span class="ezcx-exp-ic">{ }</span>' +
          '<span class="ezcx-exp-tx"><b>JSON 다운로드</b><small>.json 파일 — 원본 데이터 그대로</small></span>' +
        '</button>' +
        '<button type="button" class="ezcx-exp-opt" data-exp="copy">' +
          '<span class="ezcx-exp-ic">⧉</span>' +
          '<span class="ezcx-exp-tx"><b>클립보드 복사</b><small>Markdown 텍스트로 바로 붙여넣기</small></span>' +
        '</button>' +
      '</div>';

    var handle = TX.modal({
      title: "대화 내보내기",
      body: body,
      actions: [{ label: "닫기", kind: "ghost" }]
    });

    /* 옵션 버튼 바인딩 — 실행 후 모달 닫기 */
    var opts = handle.body.querySelectorAll("[data-exp]");
    for (var i = 0; i < opts.length; i++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          var kind = btn.getAttribute("data-exp");
          handle.close();
          doExport(kind);
        });
      })(opts[i]);
    }
  }

  /* ---------------- 스타일 주입 ---------------- */

  function injectStyle() {
    if (document.getElementById("ezcx-export-style")) return;
    var st = document.createElement("style");
    st.id = "ezcx-export-style";
    st.textContent =
      /* 푸터행 버튼 — 기존 .ezx-reset 톤에 맞춤 */
      ".ezcx-export-btn{ font-size:11px; color:var(--ink-3,#6B7280); font-weight:400;" +
      " background:none; border:0; padding:0; margin-left:10px; cursor:pointer; font-family:inherit; }" +
      ".ezcx-export-btn:hover{ color:var(--ink-2,#4B5563); text-decoration:underline; }" +
      /* 모달 내부 */
      ".ezcx-exp-sub{ font-size:12px; color:var(--ink-3,#6B7280); margin-bottom:10px; }" +
      ".ezcx-exp-opts{ display:flex; flex-direction:column; gap:8px; }" +
      ".ezcx-exp-opt{ display:flex; align-items:center; gap:12px; width:100%; text-align:left;" +
      " padding:11px 14px; border:1px solid var(--line,#E4E7EC); border-radius:10px;" +
      " background:var(--card,#fff); color:var(--ink,#1D2433); cursor:pointer; font-family:inherit; }" +
      ".ezcx-exp-opt:hover{ border-color:var(--blue,#1F7AF0); background:var(--soft,#F8FAFC); }" +
      ".ezcx-exp-ic{ flex:0 0 30px; height:30px; display:flex; align-items:center; justify-content:center;" +
      " border-radius:8px; background:var(--soft,#F8FAFC); border:1px solid var(--line,#E4E7EC);" +
      " font-size:13px; color:var(--blue,#1F7AF0); }" +
      ".ezcx-exp-tx{ display:flex; flex-direction:column; gap:2px; }" +
      ".ezcx-exp-tx b{ font-size:13px; font-weight:600; }" +
      ".ezcx-exp-tx small{ font-size:11px; color:var(--ink-3,#6B7280); }";
    document.head.appendChild(st);
  }

  /* ---------------- 버튼 주입 (푸터행 폴링) ---------------- */

  function injectButton() {
    var row = document.querySelector(".ezx-root .ezx-foot-row");
    if (!row) return false;
    if (row.querySelector(".ezcx-export-btn")) return true; /* 중복 방지 */
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ezcx-export-btn";
    btn.textContent = "내보내기";
    btn.setAttribute("aria-label", "대화 내보내기");
    btn.addEventListener("click", openModal);
    /* "대화 초기화"(.ezx-reset) 바로 옆에 배치 */
    var reset = row.querySelector(".ezx-reset");
    if (reset && reset.nextSibling) row.insertBefore(btn, reset.nextSibling);
    else row.appendChild(btn);
    return true;
  }

  function boot() {
    if (!window.EZChat) {
      console.warn("[tx_chat_export] EZChat 스토어 없음 — 모듈 비활성");
      return;
    }
    injectStyle();
    /* FAB(.ezx-root)는 DOMContentLoaded 이후 생성 → 폴링 (300ms × 최대 20회) */
    var tries = 0;
    (function poll() {
      if (injectButton()) return;
      if (++tries >= 20) {
        console.warn("[tx_chat_export] .ezx-foot-row 미발견 — 버튼 주입 포기");
        return;
      }
      setTimeout(poll, 300);
    })();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
