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

const crypto = require("crypto");

const PORT = Number(process.env.PORT || 8080);
const ROOT = path.resolve(__dirname, "..");
const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const MODEL = process.env.ELIZAX_MODEL || "claude-sonnet-5";
const MAX_TOKENS = Number(process.env.ELIZAX_MAX_TOKENS || 1024);

/* ---------------- AWS Bedrock 지원 (ANTHROPIC_API_KEY 없을 때 대체 경로) ----------
   자격증명: AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY 환경변수,
   또는 AWS_KEYS_CSV(IAM 콘솔에서 받은 *_accessKeys.csv 경로). */
let AWS_AK = process.env.AWS_ACCESS_KEY_ID || "";
let AWS_SK = process.env.AWS_SECRET_ACCESS_KEY || "";
if (!AWS_AK && process.env.AWS_KEYS_CSV) {
  try {
    const lines = fs.readFileSync(process.env.AWS_KEYS_CSV, "utf8").trim().split(/\r?\n/);
    const cols = lines[lines.length - 1].split(",");
    AWS_AK = (cols[0] || "").trim();
    AWS_SK = (cols[1] || "").trim();
  } catch (e) { console.warn("[elizax] AWS_KEYS_CSV 읽기 실패:", e.message); }
}
const AWS_REGION = process.env.AWS_REGION || "ap-northeast-2";
const BEDROCK_MODEL = process.env.ELIZAX_BEDROCK_MODEL || "apac.anthropic.claude-sonnet-4-20250514-v1:0";
const BACKEND = API_KEY ? "anthropic" : (AWS_AK && AWS_SK) ? "bedrock" : "none";

function sigv4(method, host, rawPath, query, region, service, body) {
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const canonHeaders = `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-date";
  const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
  /* non-S3 규칙: 이미 인코딩된 경로 세그먼트를 한 번 더 인코딩 */
  const canonPath = rawPath.split("/").map((s) => encodeURIComponent(s)).join("/");
  const canon = [method, canonPath, query || "", canonHeaders, signedHeaders, sha(body || "")].join("\n");
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const sts = ["AWS4-HMAC-SHA256", amzDate, scope, sha(canon)].join("\n");
  let k = crypto.createHmac("sha256", "AWS4" + AWS_SK).update(dateStamp).digest();
  for (const part of [region, service, "aws4_request"]) k = crypto.createHmac("sha256", k).update(part).digest();
  const sig = crypto.createHmac("sha256", k).update(sts, "utf8").digest("hex");
  return {
    "content-type": "application/json",
    "x-amz-date": amzDate,
    "Authorization": `AWS4-HMAC-SHA256 Credential=${AWS_AK}/${scope}, SignedHeaders=${signedHeaders}, Signature=${sig}`
  };
}

/* Bedrock InvokeModel (비스트리밍) → 텍스트 반환 */
async function bedrockInvoke(system, messages) {
  const host = `bedrock-runtime.${AWS_REGION}.amazonaws.com`;
  const rawPath = `/model/${encodeURIComponent(BEDROCK_MODEL)}/invoke`;
  const body = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: MAX_TOKENS,
    system,
    messages
  });
  const headers = sigv4("POST", host, rawPath, "", AWS_REGION, "bedrock", body);
  const r = await fetch(`https://${host}${rawPath}`, { method: "POST", headers, body });
  const text = await r.text();
  if (!r.ok) {
    let msg = "Bedrock HTTP " + r.status;
    try { const j = JSON.parse(text); msg += " — " + (j.message || j.Message || ""); } catch (e) { /* ignore */ }
    if (r.status === 403) msg += " · IAM 유저에 bedrock:InvokeModel 권한을 부여하세요 (AmazonBedrockLimitedAccess 정책 등)";
    throw new Error(msg);
  }
  const j = JSON.parse(text);
  return (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
}

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
- 답변은 검증 가능해야 합니다: 기준 시점, 근거 출처, 감사 가능성을 자연스럽게 언급합니다.
- 발송·저장·확정 같은 쓰기 행위는 절대 스스로 수행하지 않고, 반드시 "승인 후 반영" 제안으로만 답합니다.
- 한국어로, 간결하고 단정하게. 마크다운 사용 가능.
- 사용자 메시지 앞에 [현재 화면: …] 컨텍스트가 붙어 올 수 있습니다.

화면 이동(내비게이션):
사용자가 특정 화면·탭으로 이동을 원하면, 답변 마지막 줄에 정확히 아래 형식의 마커를 한 번만 추가하세요(설명 문장과 별도 줄):
@@NAV{"s":"<섹션키>","p":<탭인덱스 또는 null>}@@

섹션키: home(홈) · work(업무관리) · perf(성과관리) · msf(360진단) · appr(평가관리) · pay(급여관리) · att(근무관리) · hrm(인사관리) · wf(승인/결재)
perf 탭 p: 0=목표 현황 · 1=피드백 · 2=1:1 미팅 · 3=리뷰
appr 탭 p: 0=평가 매트릭스 · 1=인재 리뷰
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

  if (BACKEND === "none") {
    return json(res, 200, {
      type: "fallback", source: "fallback",
      response: "AI 자격증명이 없습니다. ANTHROPIC_API_KEY 또는 AWS 키(AWS_KEYS_CSV/AWS_ACCESS_KEY_ID)를 설정한 뒤 다시 실행해 주세요."
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

  /* ---- Bedrock 경로: 비스트리밍 호출 → 단일 chunk로 전달 ---- */
  if (BACKEND === "bedrock") {
    try {
      const out = await bedrockInvoke(SYSTEM, messages);
      hist.push({ role: "assistant", content: out || "(빈 응답)" });
      send({ type: "chunk", content: out || "(빈 응답)" });
      send({ type: "done" });
    } catch (e) {
      send({ type: "chunk", content: "Bedrock 오류: " + (e && e.message ? e.message : "unknown") });
      send({ type: "done" });
    }
    return res.end();
  }

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

/* ---------------- /api/messages — generic Messages API passthrough ----------
   tool-use 에이전트 루프(tx_ai.js EZAI.agent)용. 클라이언트가 만든 Messages
   요청 본문(model/system/messages/tools/stream)을 그대로 업스트림에 전달한다.
   - Anthropic 백엔드: 스트리밍 SSE를 원문 그대로 파이프
   - Bedrock  백엔드: 비스트리밍 InvokeModel → 완성 message JSON 반환
     (tool_use 블록 포함 — 클라이언트 루프가 JSON 응답도 처리) */
async function handleMessages(req, res) {
  let body;
  try { body = await readBody(req, res); } catch (e) { return json(res, 400, { error: "bad json" }); }
  if (!Array.isArray(body.messages) || !body.messages.length) {
    return json(res, 400, { error: "messages required" });
  }
  if (BACKEND === "none") {
    return json(res, 503, { error: "no credentials", message: "ANTHROPIC_API_KEY 또는 AWS 키를 설정하세요." });
  }

  if (BACKEND === "bedrock") {
    try {
      const host = `bedrock-runtime.${AWS_REGION}.amazonaws.com`;
      const rawPath = `/model/${encodeURIComponent(BEDROCK_MODEL)}/invoke`;
      const up = JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: Number(body.max_tokens) || MAX_TOKENS,
        system: body.system,
        messages: body.messages,
        tools: body.tools || undefined,
        tool_choice: body.tool_choice || undefined
      });
      const headers = sigv4("POST", host, rawPath, "", AWS_REGION, "bedrock", up);
      const r = await fetch(`https://${host}${rawPath}`, { method: "POST", headers, body: up });
      const text = await r.text();
      if (!r.ok) return json(res, r.status, { error: "bedrock", message: text.slice(0, 500) });
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
      return res.end(text);
    } catch (e) {
      return json(res, 502, { error: "bedrock", message: e && e.message ? e.message : "unknown" });
    }
  }

  /* Anthropic: 요청 본문 정리 후 그대로 전달, 응답 스트림 원문 파이프 */
  const payload = {
    model: body.model || MODEL,
    max_tokens: Number(body.max_tokens) || MAX_TOKENS,
    system: body.system,
    messages: body.messages,
    tools: body.tools || undefined,
    tool_choice: body.tool_choice || undefined,
    stream: body.stream !== false
  };
  try {
    const up = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!up.ok || !up.body) {
      const errTxt = await up.text().catch(() => "");
      return json(res, up.status || 502, { error: "upstream", message: errTxt.slice(0, 500) });
    }
    res.writeHead(200, {
      "Content-Type": payload.stream ? "text/event-stream; charset=utf-8" : "application/json; charset=utf-8",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });
    const reader = up.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (e) {
    try { json(res, 502, { error: "proxy", message: e && e.message ? e.message : "unknown" }); }
    catch (err) { try { res.end(); } catch (e2) { /* stream already open */ } }
  }
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
  if (req.method === "POST" && req.url === "/api/messages") return handleMessages(req, res);
  if (req.method === "POST" && req.url === "/api/chat/reset") {
    return readBody(req, res).then((b) => { sessions.delete(String(b.emp_id || "anon")); json(res, 200, { ok: true }); })
      .catch(() => json(res, 400, { error: "bad json" }));
  }
  if (req.method === "GET" && req.url === "/api/health") {
    return json(res, 200, {
      ok: true, backend: BACKEND,
      model: BACKEND === "bedrock" ? BEDROCK_MODEL : MODEL,
      keySet: BACKEND !== "none"
    });
  }
  return serveStatic(req, res);
});

server.listen(PORT, () => {
  const desc = BACKEND === "anthropic" ? "Anthropic API, model " + MODEL
    : BACKEND === "bedrock" ? "AWS Bedrock " + AWS_REGION + ", model " + BEDROCK_MODEL
    : "자격증명 없음 — 폴백 응답";
  console.log("[elizax] http://localhost:" + PORT + "  (" + desc + ")");
});
