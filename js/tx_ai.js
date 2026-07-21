/* ============================================================
   tx_ai.js — elizax 통합 AI 클라이언트 (window.EZAI)
   연결 모드 자동 선택:
     1. proxy  — 로컬 프록시(server/server.js, :8080)가 살아 있고 키 보유
     2. direct — 브라우저에서 Anthropic API 직접 호출
                 (설정에서 입력한 키 · localStorage · 데모 전용)
     3. offline— 둘 다 없음 → 기존 목업 응답
   file:// · GitHub Pages에서도 direct 모드로 실제 Claude 응답 가능.
   ⚠ direct 모드는 키가 브라우저에 저장되는 데모 편의 기능 — 운영 금지.
   ============================================================ */
(function () {
  "use strict";

  var LS_KEY = "elizax_api_key";
  var LS_MODEL = "elizax_model";
  var DEFAULT_MODEL = "claude-sonnet-5";

  /* ---------------- backend probe ---------------- */
  function apiBase() {
    if (typeof window.ELIZAX_API_BASE === "string") return window.ELIZAX_API_BASE;
    var loc = window.location || {};
    /* GitHub Pages → Cloudflare Worker 프록시 (PC 꺼져 있어도 실 AI 응답) */
    if (/\.github\.io$/.test(loc.hostname || "")) return "https://elizax-proxy.baldr0001.workers.dev";
    if (loc.protocol === "file:" || loc.port !== "8080") return "http://localhost:8080";
    return "";
  }
  var backend = { up: false, keySet: false, probed: false };
  function probe(cb) {
    var ctl = null, to = null;
    try { ctl = new AbortController(); to = setTimeout(function () { ctl.abort(); }, 1200); } catch (e) { /* old browser */ }
    fetch(apiBase() + "/api/health", ctl ? { signal: ctl.signal } : undefined)
      .then(function (r) { return r.json(); })
      .then(function (j) { backend.up = !!j.ok; backend.keySet = !!j.keySet; })
      .catch(function () { backend.up = false; backend.keySet = false; })
      .then(function () { if (to) clearTimeout(to); backend.probed = true; if (cb) cb(); });
  }
  probe();
  /* 백엔드가 재시작돼도 새로고침 없이 복구되도록 15초 주기 재프로브 */
  setInterval(function () { probe(); }, 15000);

  /* ---------------- key / model ---------------- */
  function getKey() { try { return localStorage.getItem(LS_KEY) || ""; } catch (e) { return ""; } }
  function setKey(k) {
    try {
      if (k) localStorage.setItem(LS_KEY, String(k).trim());
      else localStorage.removeItem(LS_KEY);
    } catch (e) { /* ignore */ }
  }
  function getModel() { try { return localStorage.getItem(LS_MODEL) || DEFAULT_MODEL; } catch (e) { return DEFAULT_MODEL; } }
  function setModel(m) { try { if (m) localStorage.setItem(LS_MODEL, m); } catch (e) { /* ignore */ } }

  /* ---------------- mode ---------------- */
  function mode() {
    if (backend.up && backend.keySet) return "proxy";
    if (getKey()) return "direct";
    if (backend.up) return "proxy"; /* 서버는 있는데 키 미설정 → 서버 안내 응답 */
    return "offline";
  }
  function modeLabel() {
    var m = mode();
    if (m === "proxy") return backend.keySet ? "로컬 프록시 연결됨" : "프록시 연결됨 · 서버 AI 키 미설정";
    return { direct: "브라우저 직접 연결 (Claude API)", offline: "오프라인 목업" }[m];
  }
  /* 실제 AI 응답 가능 여부 (프록시가 떠 있어도 키 없으면 false) */
  function ready() {
    var m = mode();
    return m === "direct" || (m === "proxy" && backend.keySet);
  }

  /* ---------------- system prompt (direct 모드 · 서버 SYSTEM과 동일 계약) ---------------- */
  function systemPrompt() {
    return "당신은 elizax — 한국 HR SaaS \"talenx\"에 상주하는 성과관리·평가 AI 에이전트입니다.\n\n" +
      "역할 원칙:\n" +
      "- 목표수립 → 중간점검 → 평가 → 피드백 전 주기를 지원합니다.\n" +
      "- 답변은 검증 가능해야 합니다: 기준 시점, 근거 출처, 감사 가능성을 자연스럽게 언급합니다.\n" +
      "- 발송·저장·확정 같은 쓰기 행위는 절대 스스로 수행하지 않고, 반드시 \"승인 후 반영\" 제안으로만 답합니다.\n" +
      "- 한국어로, 간결하고 단정하게. 마크다운 사용 가능.\n" +
      "- 사용자 메시지 앞에 [현재 화면: …] 컨텍스트가 붙어 올 수 있습니다.\n\n" +
      "화면 이동(내비게이션):\n" +
      "사용자가 특정 화면·탭으로 이동을 원하면, 답변 마지막 줄에 정확히 아래 형식의 마커를 한 번만 추가하세요:\n" +
      '@@NAV{"s":"<섹션키>","p":<탭인덱스 또는 null>}@@\n\n' +
      "섹션키: home(홈) · work(업무관리) · perf(성과관리) · msf(360진단) · appr(평가관리) · pay(급여관리) · att(근무관리) · hrm(인사관리) · wf(승인/결재)\n" +
      "perf 탭 p: 0=목표 현황 · 1=피드백 · 2=1:1 미팅 · 3=리뷰\n" +
      "appr 탭 p: 0=평가 매트릭스 · 1=인재 리뷰\n" +
      "work 탭 p: 0=업무보드 · 1=스크럼보드\n" +
      "pay 탭 p: 0=내 급여 · 1=연말정산\n" +
      "att 탭 p: 0=내 근무 · 1=내 휴가 · 2=구성원 근무 · 3=구성원 휴가 · 4=근무스케줄 · 5=위치정보 · 6=연차촉진\n" +
      "hrm 탭 p: 0=사용자 정보 · 1=구성원 정보 · 2=인재 검색 · 3=인원 현황\n" +
      "wf 탭 p: 0=받은 문서 · 1=보낸 문서 · 2=서명 문서\n" +
      "이동이 필요 없으면 마커를 넣지 마세요.";
  }

  /* ---------------- direct 스트리밍 호출 ----------------
     opts: { messages:[{role,content}], system?, onChunk(t), onDone(full), onError(msg) } */
  function direct(opts) {
    var key = getKey();
    if (!key) { if (opts.onError) opts.onError("API 키가 없습니다. elizax 설정(⚙)에서 키를 입력하세요."); return; }
    var full = "";
    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: getModel(),
        max_tokens: 1024,
        system: opts.system || systemPrompt(),
        messages: opts.messages,
        stream: true
      })
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          var msg = "Anthropic API 오류 (HTTP " + res.status + ")";
          try { var j = JSON.parse(t); if (j.error && j.error.message) msg += " — " + j.error.message; } catch (e) { /* ignore */ }
          if (res.status === 401) msg += " · 키를 확인하세요 (⚙ 설정)";
          throw new Error(msg);
        });
      }
      var reader = res.body.getReader();
      var dec = new TextDecoder();
      var buf = "";
      function pump() {
        return reader.read().then(function (x) {
          if (x.done) { if (opts.onDone) opts.onDone(full); return; }
          buf += dec.decode(x.value, { stream: true });
          var events = buf.split("\n\n");
          buf = events.pop();
          events.forEach(function (ev) {
            var m = ev.match(/^data:\s*(\{[\s\S]*\})\s*$/m);
            if (!m) return;
            var j;
            try { j = JSON.parse(m[1]); } catch (e) { return; }
            if (j.type === "content_block_delta" && j.delta && j.delta.type === "text_delta") {
              full += j.delta.text;
              if (opts.onChunk) opts.onChunk(j.delta.text);
            }
            if (j.type === "error" && j.error) throw new Error(j.error.message || "stream error");
          });
          return pump();
        });
      }
      return pump();
    }).catch(function (e) {
      if (opts.onError) opts.onError(e && e.message ? e.message : "네트워크 오류");
    });
  }

  /* ---------------- agent 시스템 프롬프트 (tool-use) ---------------- */
  function agentSystemPrompt() {
    return "당신은 elizax — 한국 HR SaaS \"talenx\"에 상주하는 성과관리·평가 AI 에이전트입니다.\n\n" +
      "역할 원칙:\n" +
      "- 목표수립 → 중간점검 → 평가 → 피드백 전 주기를 지원합니다.\n" +
      "- 숫자·이름·등급·진척을 언급하기 전에 반드시 도구로 실데이터를 조회합니다. 조회 없이 추정하지 않습니다(HOLD 원칙 — 근거가 없으면 그렇게 말하고 멈춥니다).\n" +
      "- 답변의 모든 사실은 도구 결과에서만 가져오고, 출처(talenx·ERP·통계)와 기준 시점을 자연스럽게 언급합니다.\n" +
      "- 도구는 전부 읽기 전용입니다. 발송·저장·확정 같은 쓰기 행위는 절대 스스로 수행하지 않고 \"승인 후 반영\" 제안으로만 답합니다.\n" +
      "- 한국어로, 간결하고 단정하게. 마크다운 사용 가능.\n" +
      "- 사용자 메시지 앞에 [현재 화면: …] 컨텍스트가 붙어 올 수 있습니다. 필요하면 get_screen_context로 직접 확인해도 됩니다.\n" +
      "- 사용자가 화면 이동을 원하면 navigate 도구를 호출하세요(마커 대신). 이동 후 한 줄로 어디로 이동했는지 알려주세요.\n" +
      "- 불필요한 도구 호출은 피하되, 근거가 필요한 질문에는 반드시 1회 이상 조회하세요.";
  }

  /* ---------------- Messages API 1턴 호출 (transport 공용) ----------------
     mode()에 따라 직접(브라우저→Anthropic) 또는 프록시(/api/messages)로 보낸다.
     스트리밍 SSE와 완성 JSON(비스트리밍 · Bedrock) 응답을 모두 처리.
     handlers: { onText(t), onMessage({content,stop_reason}), onError(msg) } */
  function callMessages(payload, handlers) {
    var m = mode();
    var url, headers;
    if (m === "direct") {
      url = "https://api.anthropic.com/v1/messages";
      headers = {
        "x-api-key": getKey(),
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "anthropic-dangerous-direct-browser-access": "true"
      };
      payload.model = payload.model || getModel();
    } else {
      url = apiBase() + "/api/messages";
      headers = { "content-type": "application/json" };
    }
    fetch(url, { method: "POST", headers: headers, body: JSON.stringify(payload) }).then(function (res) {
      var ct = (res.headers.get("Content-Type") || "").toLowerCase();
      if (!res.ok) {
        return res.text().then(function (t) {
          var msg = "API 오류 (HTTP " + res.status + ")";
          try { var j = JSON.parse(t); msg += " — " + ((j.error && j.error.message) || j.message || ""); } catch (e) { /* ignore */ }
          if (res.status === 401) msg += " · 키를 확인하세요 (⚙ 설정)";
          throw new Error(msg);
        });
      }
      /* 비스트리밍 JSON (Bedrock 등) */
      if (ct.indexOf("event-stream") === -1) {
        return res.json().then(function (msg) {
          (msg.content || []).forEach(function (b) {
            if (b.type === "text" && b.text && handlers.onText) handlers.onText(b.text);
          });
          if (handlers.onMessage) handlers.onMessage({ content: msg.content || [], stop_reason: msg.stop_reason });
        });
      }
      /* 스트리밍 SSE — content_block 조립 */
      var reader = res.body.getReader();
      var dec = new TextDecoder();
      var buf = "", blocks = [], stopReason = null;
      function onEvent(j) {
        if (j.type === "content_block_start") {
          blocks[j.index] = { type: j.content_block.type, id: j.content_block.id, name: j.content_block.name, text: "", partial: "" };
        } else if (j.type === "content_block_delta") {
          var b = blocks[j.index];
          if (!b) return;
          if (j.delta.type === "text_delta") { b.text += j.delta.text; if (handlers.onText) handlers.onText(j.delta.text); }
          else if (j.delta.type === "input_json_delta") { b.partial += j.delta.partial_json || ""; }
        } else if (j.type === "message_delta") {
          if (j.delta && j.delta.stop_reason) stopReason = j.delta.stop_reason;
        } else if (j.type === "error" && j.error) {
          throw new Error(j.error.message || "stream error");
        }
      }
      function assemble() {
        var content = [];
        blocks.forEach(function (b) {
          if (!b) return;
          if (b.type === "text") content.push({ type: "text", text: b.text });
          else if (b.type === "tool_use") {
            var input = {};
            try { input = b.partial ? JSON.parse(b.partial) : {}; } catch (e) { /* malformed partial */ }
            content.push({ type: "tool_use", id: b.id, name: b.name, input: input });
          }
        });
        return content;
      }
      function pump() {
        return reader.read().then(function (x) {
          if (x.done) {
            if (handlers.onMessage) handlers.onMessage({ content: assemble(), stop_reason: stopReason });
            return;
          }
          buf += dec.decode(x.value, { stream: true });
          var events = buf.split("\n\n");
          buf = events.pop();
          events.forEach(function (ev) {
            var m2 = ev.match(/^data:\s*(\{[\s\S]*\})\s*$/m);
            if (!m2) return;
            var j;
            try { j = JSON.parse(m2[1]); } catch (e) { return; }
            onEvent(j);
          });
          return pump();
        });
      }
      return pump();
    }).catch(function (e) {
      if (handlers.onError) handlers.onError(e && e.message ? e.message : "네트워크 오류");
    });
  }

  /* ---------------- tool-use 에이전트 루프 ----------------
     opts: {
       messages: [{role,content}],           초기 대화 (마지막이 user)
       system?: string,                      기본 agentSystemPrompt()
       maxTurns?: number,                    기본 6
       onText(t), onTool(name, input), onToolResult(name, result, summary),
       onDone(fullText), onError(msg)
     }
     모델이 tool_use로 멈추면 EZTools.run으로 로컬 실행 → tool_result 반환 → 반복. */
  function agent(opts) {
    var tools = (window.EZTools && window.EZTools.schemas) || [];
    var msgs = (opts.messages || []).slice();
    var turnsLeft = opts.maxTurns || 6;
    var allText = "";

    function turn() {
      turnsLeft--;
      callMessages({
        max_tokens: opts.maxTokens || 2048,
        system: opts.system || agentSystemPrompt(),
        messages: msgs,
        tools: tools.length ? tools : undefined,
        stream: true
      }, {
        onText: function (t) { allText += t; if (opts.onText) opts.onText(t); },
        onError: function (m) { if (opts.onError) opts.onError(m); },
        onMessage: function (msg) {
          var uses = (msg.content || []).filter(function (b) { return b.type === "tool_use"; });
          if (msg.stop_reason === "tool_use" && uses.length && turnsLeft > 0) {
            msgs.push({ role: "assistant", content: msg.content });
            var results = uses.map(function (b) {
              if (opts.onTool) opts.onTool(b.name, b.input || {});
              var r = window.EZTools ? window.EZTools.run(b.name, b.input || {}) : { error: "tools unavailable" };
              var summary = window.EZTools ? window.EZTools.summarize(b.name, r) : "";
              if (opts.onToolResult) opts.onToolResult(b.name, r, summary);
              return { type: "tool_result", tool_use_id: b.id, content: JSON.stringify(r) };
            });
            msgs.push({ role: "user", content: results });
            if (allText && allText.slice(-1) !== "\n") allText += "\n";
            turn();
          } else {
            if (opts.onDone) opts.onDone(allText);
          }
        }
      });
    }
    turn();
  }

  /* ---------------- 설정 모달 (⚙) ---------------- */
  function openSettings(onChange) {
    var cur = getKey();
    var body =
      '<div style="font-size:13px;line-height:1.7">' +
      '<div style="margin-bottom:10px">연결 상태: <b>' + modeLabel() + "</b></div>" +
      '<label style="display:block;font-weight:600;margin-bottom:4px">Anthropic API 키</label>' +
      '<input type="password" data-ezai-key value="' + (cur ? cur.replace(/"/g, "&quot;") : "") + '" placeholder="sk-ant-..." style="width:100%;border:1px solid var(--line,#e0e0e0);border-radius:999px;padding:9px 14px;font-size:13px;font-family:inherit">' +
      '<label style="display:block;font-weight:600;margin:12px 0 4px">모델</label>' +
      '<input type="text" data-ezai-model value="' + getModel().replace(/"/g, "&quot;").replace(/</g, "&lt;") + '" style="width:100%;border:1px solid var(--line,#e0e0e0);border-radius:999px;padding:9px 14px;font-size:13px;font-family:inherit">' +
      '<div style="margin-top:12px;font-size:11px;color:#B45309;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.3);border-radius:8px;padding:8px 11px">⚠ 키는 이 브라우저 localStorage에만 저장됩니다(데모 전용). 공용 PC에서는 사용 후 삭제하세요. 운영 환경은 <code>server/server.js</code> 프록시를 쓰세요.</div>' +
      "</div>";
    if (window.TX && TX.modal) {
      TX.modal({
        title: "elizax AI 연결 설정",
        body: body,
        actions: [
          { label: "키 삭제", kind: "ghost", onClick: function () { setKey(""); if (TX.toast) TX.toast("API 키 삭제됨 — 오프라인 목업 모드", "ok"); if (onChange) onChange(); } },
          {
            label: "저장", kind: "primary", onClick: function (box) {
              var k = box.querySelector("[data-ezai-key]").value.trim();
              var m = box.querySelector("[data-ezai-model]").value.trim();
              setKey(k); if (m) setModel(m);
              if (TX.toast) TX.toast(k ? "저장됨 — " + modeLabel() : "키 없음 — 오프라인 목업 모드", "ok");
              if (onChange) onChange();
            }
          }
        ]
      });
    } else {
      var k = window.prompt("Anthropic API 키 (sk-ant-...) — 비우면 삭제", cur);
      if (k !== null) { setKey(k.trim()); if (onChange) onChange(); }
    }
  }

  window.EZAI = {
    mode: mode,
    modeLabel: modeLabel,
    ready: ready,
    probe: probe,
    getKey: getKey,
    setKey: setKey,
    getModel: getModel,
    setModel: setModel,
    systemPrompt: systemPrompt,
    agentSystemPrompt: agentSystemPrompt,
    direct: direct,
    agent: agent,
    openSettings: openSettings,
    apiBase: apiBase
  };
})();
