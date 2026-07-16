/* ============================================================
   elizax cloud proxy — Cloudflare Worker
   GitHub Pages(정적 목업)에서도 실제 Claude 응답이 나오도록
   server/server.js 의 API 계약을 그대로 구현한 무료 클라우드 백엔드.

   - GET  /api/health      → {ok, keySet, backend, model}
   - POST /api/chat        → Anthropic Messages 스트리밍 →
                             SSE: data:{type:"chunk",content} … data:{type:"done"}
   - POST /api/messages    → 범용 Messages 패스스루 (tool-use 루프용, SSE 원문)
   - POST /api/chat/reset  → 세션 초기화 (isolate 메모리 — 베스트에포트)

   보안 가드레일 (공개 URL에 조직 키가 걸리므로 필수):
   - Origin 화이트리스트 (GitHub Pages + localhost 데모)
   - 모델 화이트리스트 + max_tokens 상한
   - 메시지 길이/개수 상한

   배포:  cd worker && npx wrangler deploy
   키:    npx wrangler secret put ANTHROPIC_API_KEY
   ============================================================ */
"use strict";

const ALLOWED_ORIGINS = [
  "https://0101-commits.github.io",
  "http://localhost:8080",
  "http://127.0.0.1:8080"
];
const ALLOWED_MODELS = ["claude-sonnet-5", "claude-haiku-4-5-20251001"];
const DEFAULT_MODEL = "claude-sonnet-5";
const MAX_TOKENS_CAP = 2048;
const MAX_MSG_CHARS = 8000;
const MAX_MSGS = 40;

const SYSTEM = `당신은 elizax — 한국 HR SaaS "talenx"에 상주하는 성과관리·평가 AI 에이전트입니다.

역할 원칙:
- 목표수립 → 중간점검 → 평가 → 피드백 전 주기를 지원합니다.
- 답변은 검증 가능해야 합니다: 기준 시점(as-of), 근거 출처, 감사 가능성을 자연스럽게 언급합니다.
- 발송·저장·확정 같은 쓰기 행위는 절대 스스로 수행하지 않고, 반드시 "승인 후 반영" 제안으로만 답합니다.
- 한국어로, 간결하고 단정하게. 마크다운 사용 가능.
- 사용자 메시지 앞에 [현재 화면: …] 컨텍스트가 붙어 올 수 있습니다.

화면 이동(내비게이션):
사용자가 특정 화면·탭으로 이동을 원하면, 답변 마지막 줄에 정확히 아래 형식의 마커를 한 번만 추가하세요(설명 문장과 별도 줄):
@@NAV{"s":"<섹션키>","p":<탭인덱스 또는 null>}@@

섹션키: home(홈) · work(업무관리) · perf(성과관리) · msf(360진단) · appr(평가관리) · pay(급여관리) · att(근무관리) · hrm(인사관리) · wf(승인/결재)
perf 탭 p: 0=목표 현황 · 1=피드백 · 2=1:1 미팅 · 3=리뷰
appr 탭 p: 0=평가 매트릭스 · 1=탈렌트 세션
work 탭 p: 0=업무보드 · 1=스크럼보드
pay 탭 p: 0=내 급여 · 1=연말정산
att 탭 p: 0=내 근무 · 1=내 휴가 · 2=구성원 근무 · 3=구성원 휴가 · 4=근무스케줄 · 5=위치정보 · 6=연차촉진
hrm 탭 p: 0=사용자 정보 · 1=구성원 정보 · 2=인재 검색 · 3=인원 현황
wf 탭 p: 0=받은 문서 · 1=보낸 문서 · 2=서명 문서
이동이 필요 없으면 마커를 넣지 마세요.`;

/* isolate-로컬 세션 (에페메럴 — Worker 재활용 시 소실, 데모 용도) */
const sessions = new Map();
function history(empId) {
  if (!sessions.has(empId)) sessions.set(empId, []);
  return sessions.get(empId);
}

function corsHeaders(origin) {
  const ok = ALLOWED_ORIGINS.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Accept",
    "Vary": "Origin"
  };
}
function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, corsHeaders(origin))
  });
}
function originAllowed(req) {
  const o = req.headers.get("Origin");
  /* Origin 없는 요청(서버간·curl)은 헬스체크만 허용, 그 외 차단 */
  return o && ALLOWED_ORIGINS.includes(o);
}
function pickModel(m) {
  return ALLOWED_MODELS.includes(m) ? m : DEFAULT_MODEL;
}

async function anthropicStream(env, payload) {
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

/* /api/chat — server.js 와 동일한 SSE 계약으로 재방출 */
async function handleChat(req, env, origin) {
  let body;
  try { body = await req.json(); } catch (e) { return json({ error: "bad json" }, 400, origin); }
  const empId = String(body.emp_id || "anon");
  const message = String(body.message || "").slice(0, MAX_MSG_CHARS);
  const perspective = String(body.perspective || "subject");
  if (!message) return json({ error: "empty message" }, 400, origin);

  const hist = history(empId);
  hist.push({ role: "user", content: "[관점: " + perspective + "] " + message });
  const messages = hist.slice(-20);

  const up = await anthropicStream(env, {
    model: DEFAULT_MODEL, max_tokens: 1024, system: SYSTEM, messages, stream: true
  });

  const enc = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const w = writable.getWriter();
  const send = (obj) => w.write(enc.encode("data: " + JSON.stringify(obj) + "\n\n"));

  (async () => {
    try {
      if (!up.ok || !up.body) {
        const t = await up.text().catch(() => "");
        await send({ type: "chunk", content: "업스트림 오류 (HTTP " + up.status + "). " + t.slice(0, 300) });
        await send({ type: "done" });
        return;
      }
      const reader = up.body.getReader();
      const dec = new TextDecoder();
      let buf = "", full = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop();
        for (const ev of events) {
          const m = ev.match(/^data:\s*(\{.*\})\s*$/m);
          if (!m) continue;
          let j; try { j = JSON.parse(m[1]); } catch (e) { continue; }
          if (j.type === "content_block_delta" && j.delta && j.delta.type === "text_delta") {
            full += j.delta.text;
            await send({ type: "chunk", content: j.delta.text });
          }
        }
      }
      hist.push({ role: "assistant", content: full || "(빈 응답)" });
      await send({ type: "done" });
    } catch (e) {
      try {
        await send({ type: "chunk", content: "프록시 오류: " + (e && e.message ? e.message : "unknown") });
        await send({ type: "done" });
      } catch (e2) { /* stream closed */ }
    } finally {
      try { await w.close(); } catch (e) { /* already closed */ }
    }
  })();

  return new Response(readable, {
    headers: Object.assign({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache"
    }, corsHeaders(origin))
  });
}

/* /api/messages — 범용 패스스루 (모델·토큰 가드 적용, SSE 원문 파이프) */
async function handleMessages(req, env, origin) {
  let body;
  try { body = await req.json(); } catch (e) { return json({ error: "bad json" }, 400, origin); }
  if (!Array.isArray(body.messages) || !body.messages.length) {
    return json({ error: "messages required" }, 400, origin);
  }
  if (body.messages.length > MAX_MSGS) body.messages = body.messages.slice(-MAX_MSGS);

  const payload = {
    model: pickModel(body.model),
    max_tokens: Math.min(Number(body.max_tokens) || 1024, MAX_TOKENS_CAP),
    system: body.system,
    messages: body.messages,
    tools: body.tools || undefined,
    tool_choice: body.tool_choice || undefined,
    stream: body.stream !== false
  };
  const up = await anthropicStream(env, payload);
  if (!up.ok || !up.body) {
    const t = await up.text().catch(() => "");
    return json({ error: "upstream", message: t.slice(0, 500) }, up.status || 502, origin);
  }
  return new Response(up.body, {
    headers: Object.assign({
      "Content-Type": payload.stream ? "text/event-stream; charset=utf-8" : "application/json; charset=utf-8",
      "Cache-Control": "no-cache"
    }, corsHeaders(origin))
  });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin") || "";

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (req.method === "GET" && url.pathname === "/api/health") {
      return json({
        ok: true, backend: "anthropic", model: DEFAULT_MODEL,
        keySet: !!env.ANTHROPIC_API_KEY
      }, 200, origin);
    }
    /* 이하 전부 Origin 화이트리스트 필수 (공개 키 오남용 방지) */
    if (!originAllowed(req)) return json({ error: "forbidden origin" }, 403, origin);

    if (req.method === "POST" && url.pathname === "/api/chat") return handleChat(req, env, origin);
    if (req.method === "POST" && url.pathname === "/api/messages") return handleMessages(req, env, origin);
    if (req.method === "POST" && url.pathname === "/api/chat/reset") {
      let b = {}; try { b = await req.json(); } catch (e) { /* ignore */ }
      sessions.delete(String(b.emp_id || "anon"));
      return json({ ok: true }, 200, origin);
    }
    return json({ error: "not found" }, 404, origin);
  }
};
