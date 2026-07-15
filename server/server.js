/* ============================================================
   elizax backend proxy — zero-dependency Node (>=18) server.

   - Serves the static mockup from the repo root  (http://localhost:8080)
   - POST /api/chat        → Anthropic Messages API (streaming)
                             re-emitted as the SSE contract tx_elizax.js
                             already speaks: data:{type:"chunk",content}
                             … data:{type:"done"}
   - POST /api/chat/reset  → clears the per-employee session history

   Run:  ANTHROPIC_API_KEY=sk-ant-…  node server/server.js
   (or   server\run.ps1  /  server/run.sh)
   ============================================================ */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 8080);
const ROOT = path.resolve(__dirname, "..");
const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const MODEL = process.env.ELIZAX_MODEL || "claude-sonnet-5";
const MAX_TOKENS = Number(process.env.ELIZAX_MAX_TOKENS || 1024);

/* ---------------- lightweight session store ---------------- */
const sessions = new Map(); // emp_id → [{role, content}]
function history(empId) {
  if (!sessions.has(empId)) sessions.set(empId, []);
  return sessions.get(empId);
}

/* ---------------- system prompt ---------------- */
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

/* ---------------- helpers ---------------- */
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(body);
}

function readBody(req, res) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => {
      buf += c;
      if (buf.length > 1e6) {
        if (res) { try { res.writeHead(413); res.end("Payload too large"); } catch (e) { /* headers sent */ } }
        req.destroy();
      }
    });
    req.on("end", () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

/* ---------------- /api/chat ---------------- */
async function handleChat(req, res) {
  let body;
  try { body = await readBody(req, res); } catch (e) { return json(res, 400, { error: "bad json" }); }
  const empId = String(body.emp_id || "anon");
  const message = String(body.message || "").slice(0, 8000);
  const perspective = String(body.perspective || "subject");
  if (!message) return json(res, 400, { error: "empty message" });

  if (!API_KEY) {
    return json(res, 200, {
      type: "fallback", source: "fallback",
      response: "ANTHROPIC_API_KEY가 설정되지 않았습니다. 서버 환경변수에 키를 설정한 뒤 다시 실행해 주세요."
    });
  }

  const hist = history(empId);
  hist.push({ role: "user", content: "[관점: " + perspective + "] " + message });
  const messages = hist.slice(-20); // keep the tail

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*"
  });
  const send = (obj) => res.write("data: " + JSON.stringify(obj) + "\n\n");

  let full = "";
  try {
    const up = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM, messages, stream: true })
    });
    if (!up.ok || !up.body) {
      const errTxt = await up.text().catch(() => "");
      send({ type: "chunk", content: "업스트림 오류 (HTTP " + up.status + "). " + errTxt.slice(0, 300) });
      send({ type: "done" });
      return res.end();
    }
    const reader = up.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
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
          send({ type: "chunk", content: j.delta.text });
        }
      }
    }
    hist.push({ role: "assistant", content: full || "(빈 응답)" });
    send({ type: "done" });
  } catch (e) {
    send({ type: "chunk", content: "프록시 오류: " + (e && e.message ? e.message : "unknown") });
    send({ type: "done" });
  }
  res.end();
}

/* ---------------- static files ---------------- */
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".md": "text/markdown; charset=utf-8"
};
function serveStatic(req, res) {
  let p = decodeURIComponent((req.url || "/").split("?")[0]);
  if (p === "/") p = "/index.html";
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}

/* ---------------- router ---------------- */
const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Accept"
    });
    return res.end();
  }
  if (req.method === "POST" && req.url === "/api/chat") return handleChat(req, res);
  if (req.method === "POST" && req.url === "/api/chat/reset") {
    return readBody(req, res).then((b) => { sessions.delete(String(b.emp_id || "anon")); json(res, 200, { ok: true }); })
      .catch(() => json(res, 400, { error: "bad json" }));
  }
  if (req.method === "GET" && req.url === "/api/health") {
    return json(res, 200, { ok: true, model: MODEL, keySet: !!API_KEY });
  }
  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log("[elizax] http://localhost:" + PORT + "  (API key " + (API_KEY ? "set" : "NOT SET — fallback replies") + ", model " + MODEL + ")");
});
