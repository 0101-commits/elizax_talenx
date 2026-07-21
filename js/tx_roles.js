/* ============================================================
   tx_roles.js — 역할 관점 전환 (조직원 · 조직장 · HR · 경영진)
   + 검증 가능한 답변 영수증(as-of·trace·audit·what-if)을 성과관리 화면에 주입.

   동작: 역할 선택 → sessionStorage 저장 → meta.currentUser 를 대표 직원으로 교체
   → 페이지 리로드. 리로드 시 이 파일이 tx_hydrate/tx_fix_* 보다 먼저 실행되어
   9개 화면 전체가 해당 역할 기준으로 재구성됨(별도 화면 재렌더 훅 불필요).

   로드 위치: talenx_data.js 직후(다른 tx_* 스크립트보다 먼저).
   ============================================================ */
(function () {
  "use strict";

  var ROLES = {
    member: { key: "member", label: "조직원", emp_id: "EMP-0078", persp: "subject",
      scope: "본인 목표·평가 근거" },
    leader: { key: "leader", label: "조직장", emp_id: "EMP-0030", persp: "manager",
      scope: "우리 팀 성과·등급 분포" },
    hr:     { key: "hr",     label: "HR",     emp_id: "EMP-0005", persp: "hr",
      scope: "전사 평가 운영·규칙 검증" },
    exec:   { key: "exec",   label: "경영진", emp_id: "EMP-0001", persp: "executive",
      scope: "전사 성과·목표 정렬 조망" }
  };
  var ORDER = ["member", "leader", "hr", "exec"];
  var KEY = "tx_role";

  function hashRole() {
    var m = (window.location.hash || "").match(/role=([a-z]+)/i);
    return m && ROLES[m[1]] ? m[1] : null;
  }
  function savedKey() {
    var h = hashRole();
    if (h) return h;                       // URL hash survives reload even on file://
    try { return sessionStorage.getItem(KEY) || "member"; }
    catch (e) { return window.__txRole || "member"; }
  }
  function saveKey(k) {
    try { sessionStorage.setItem(KEY, k); } catch (e) { window.__txRole = k; }
    try { window.location.hash = "role=" + k; } catch (e) { /* ignore */ }
  }
  function curRole() { return ROLES[savedKey()] || ROLES.member; }

  /* ---------- PHASE 1 : swap currentUser (synchronous, pre-hydrate) ---------- */
  (function applyRoleUser() {
    var D = window.TALENX_DATA;
    if (!D || !Array.isArray(D.employees)) return;
    var r = ROLES[savedKey()] || ROLES.member;
    var emp = D.employees.find(function (e) { return e.emp_id === r.emp_id; });
    if (!emp) return;
    var cu = {};
    for (var k in emp) { if (Object.prototype.hasOwnProperty.call(emp, k)) cu[k] = emp[k]; }
    cu._role = r.key;
    D.meta = D.meta || {};
    D.meta.currentUser = cu;
  })();

  function switchTo(key) {
    if (!ROLES[key] || key === savedKey()) return;
    saveKey(key);
    try { location.reload(); } catch (e) { location.href = location.href; }
  }

  /* ---------- helpers ---------- */
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function D() { return window.TALENX_DATA || {}; }
  function toast(msg, kind) { if (window.TX && TX.toast) TX.toast(msg, kind || ""); }

  /* ---------- PHASE 2 : UI injection (after full render) ---------- */
  function onLoad(fn) {
    if (document.readyState === "complete") setTimeout(fn, 0);
    else window.addEventListener("load", fn);
  }

  function injectSwitcher() {
    var right = document.querySelector(".gnb .gnb-right");
    if (!right || right.querySelector(".txr-switch")) return;
    var wrap = el("div", "txr-switch");
    wrap.appendChild(el("span", "txr-lab", "관점"));
    var seg = el("div", "txr-seg");
    seg.setAttribute("role", "tablist");
    seg.setAttribute("aria-label", "역할 관점 전환");
    var cur = savedKey();
    ORDER.forEach(function (k) {
      var b = el("button", k === cur ? "on" : "", esc(ROLES[k].label));
      b.setAttribute("data-role", k);
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", k === cur ? "true" : "false");
      b.addEventListener("click", function () { switchTo(k); });
      seg.appendChild(b);
    });
    wrap.appendChild(seg);
    right.insertBefore(wrap, right.firstChild);
  }

  function injectBar() {
    var gnb = document.querySelector("header.gnb");
    if (!gnb || document.querySelector(".txr-bar")) return;
    var r = curRole();
    var cu = D().meta && D().meta.currentUser ? D().meta.currentUser : {};
    var bar = el("div", "txr-bar");
    bar.innerHTML =
      '<span class="txr-role"><span class="dot"></span>' + esc(r.label) + " 관점</span>" +
      '<span class="txr-as">보는 사람 <b>' + esc(cu.name || "-") + "</b> · " +
        esc(cu.jobTitle || "") + " · " + esc(cu.orgName || "") + "</span>" +
      '<span class="txr-scope">범위 · ' + esc(r.scope) + "</span>" +
      '<span class="txr-note">9개 화면 전체가 이 역할 기준으로 재구성됨 <span class="k">reload</span></span>';
    gnb.insertAdjacentElement("afterend", bar);
  }

  /* ---------- verifiable-answer receipt (성과관리 · 목표 페이지) ---------- */
  function sb(kind, label) { return '<span class="txr-sb ' + kind + '">' + esc(label) + "</span>"; }

  function receiptModel() {
    var d = D();
    var cu = (d.meta && d.meta.currentUser) || {};
    var ev = (d.evaluations || []).find(function (e) { return e.emp_id === cu.emp_id; });
    var owned = (d.objectives || []).filter(function (o) { return o.owner_emp_id === cu.emp_id; });
    var avg = owned.length ? Math.round(owned.reduce(function (a, o) { return a + (o.progress || 0); }, 0) / owned.length) : null;
    var team = (d.employees || []).filter(function (e) { return e.org_id === cu.org_id; });
    return { cu: cu, ev: ev, owned: owned, avg: avg, teamCount: team.length, role: curRole() };
  }

  function receiptHTML() {
    var m = receiptModel();
    var dec = getDecision();
    var role = m.role.key;
    var name = m.cu.name || "사용자";
    var grade = m.ev ? m.ev.grade : "B+";
    var score = m.ev ? m.ev.weighted_score : "-";
    var asof = "2026 상반기 · 6/30 마감 실적";

    var title, verdict, metrics, steps, wfTitle, wfRows, wfNote, audit;

    if (role === "leader") {
      title = "우리 팀 등급 분포 · 검증";
      verdict = name + "님 팀(" + m.teamCount + "명) 등급 초안 분포입니다. <b>상위(S~A) 편중</b> 여부를 강제배분 밴드와 대조했습니다. <span class=\"warn\">자동 확정 아님.</span>";
      metrics = [["팀 인원", m.teamCount + "명"], ["S~A 비율", "38%"], ["밴드 상한", "≤30%"]];
      steps = [
        ["분포 스캔", "팀원 등급 초안 분포 집계 → S~A 38% " + sb("rule", "규칙") + ' <span class="txr-rid">calib.dist.' + esc(m.cu.org_id || "") + "</span>"],
        ["규칙 대조", "강제배분 가이드 상위 ≤ 30% 초과 감지 <span class=\"txr-badge ok\">평가규정 v3.1 · 검증됨</span> <span class=\"txr-badge ref\">§12</span>"],
        ["근거 대비", "상위 편중 3명 실적 달성률 대조 " + sb("erp", "ERP") + " → 상승폭 설명력 점검"]
      ];
      wfTitle = "강제배분(상위 ≤30%) 적용 시 재계산";
      wfRows = [["S 8% → ", "6%", "pos"], ["A 30% → ", "24%", "pos"], ["B 46% → ", "54%", "pos"]];
      wfNote = "같은 계산 규칙에서 배분 기준만 적용해 즉시 재산출. rule-exec.cal7";
      audit = "탐색 범위 · 권한 내 우리 팀";
    } else if (role === "hr") {
      title = "전사 평가 운영 · 규칙 검증";
      verdict = "전사 목표·평가에서 <b>규칙 위반·미연결 신호</b>를 먼저 보고합니다. 관대화 의심 본부와 가중치 이상을 감지했습니다. <span class=\"warn\">재검토 제안 · 자동 수정 아님.</span>";
      metrics = [["가중치 이상", "5건"], ["전사 미연결", "3건"], ["관대화 의심", "2본부"]];
      steps = [
        ["규칙 스캔", "전체 목표 가중치 합 100% 초과 5건 " + sb("rule", "규칙") + ' <span class="txr-rid">rule.weight.sum</span>'],
        ["정렬 검증", "전사 목표 미연결 3건 감지 " + sb("talenx", "talenx") + " " + sb("rule", "원칙") + " 전사 정렬 필수"],
        ["분포 대비", "본부 간 등급 분포 편차 → 관대화 의심 2본부 " + sb("erp", "ERP") + " 실적 대비 상승폭 점검"]
      ];
      wfTitle = "특정 본부 강제배분 적용 시 전사 분포 재계산";
      wfRows = [["전사 A 34% → ", "27%", "pos"], ["관대화 지표 ", "-11%p", "pos"], ["밴드 준수 본부 ", "+2", "pos"]];
      wfNote = "전사 공통 계산 규칙으로 재산출. rule-exec.hr12";
      audit = "탐색 범위 · 권한 내 전사";
    } else if (role === "exec") {
      title = "전사 성과 조망 · 목표 정렬";
      verdict = "전사 OKR 정렬 상태와 등급 분포 리스크를 요약합니다. 전사 매출 목표 대비 진척과 <b>미정렬 목표</b>를 짚었습니다.";
      metrics = [["전사 목표 진척", "61%"], ["미정렬 목표", "3건"], ["분포 리스크", "중"]];
      steps = [
        ["정렬 현황 조회", "전사 OKR 트리 정렬 상태 집계 " + sb("talenx", "talenx") + ' <span class="txr-rid">okr.tree.FY2026</span>'],
        ["실적 대조", "전사 매출 달성률 61% · 목표 대비 진척 " + sb("erp", "ERP")],
        ["분포 점검", "본부 간 등급 분포 편차 → 캘리브레이션 우선순위 제안"]
      ];
      wfTitle = "미정렬 목표 정렬 시 정렬률 지표 재계산";
      wfRows = [["정렬률 82% → ", "94%", "pos"], ["미정렬 3 → ", "0", "pos"], ["전사 롤업 반영 ", "즉시", "pos"]];
      wfNote = "전사 정렬률 재산출. rule-exec.exe3";
      audit = "탐색 범위 · 전사";
    } else {
      title = "내 목표 · 평가 근거";
      verdict = name + "님 상반기 등급 초안은 <span class=\"g\">" + esc(grade) + "</span>입니다. 담당 목표 " + m.owned.length + "건, 평균 진행률 " + (m.avg != null ? m.avg + "%" : "-") + ". 목표 달성률과 피어리뷰가 안정적입니다.";
      metrics = [["등급 초안", grade], ["종합 점수", score], ["담당 목표", m.owned.length + "건"]];
      steps = [
        ["실적 조회", "목표 달성률 집계 → 종합 " + esc(score) + "/100 " + sb("erp", "ERP") + ' <span class="txr-rid">eval.FY2026.' + esc(m.cu.emp_id || "") + "</span>"],
        ["규칙 적용", "평가규정 등급 매핑 (초과달성 120%↑) <span class=\"txr-badge ok\">규정 v3.1 · 검증됨</span> <span class=\"txr-badge ref\">§12</span>"],
        ["과정 근거", "중간 1:1 기록 대조 · 자기주도 근거 " + sb("talenx", "talenx")]
      ];
      wfTitle = "달성률 -10%p 가정 시 재계산";
      wfRows = [["현재 등급 ", grade, ""], ["가정 적용 시 ", "B", "neg"], ["직무군 백분위 ", "상위 32% → 46%", "neg"]];
      wfNote = "입력값만 바꿔 같은 계산 규칙으로 즉시 재산출. rule-exec.a3f1";
      audit = "탐색 범위 · 권한 내 본인";
    }

    var metricsHtml = metrics.map(function (x) {
      return '<div class="txr-metric"><label>' + esc(x[0]) + "</label><b>" + esc(x[1]) + "</b></div>";
    }).join("");
    var stepsHtml = steps.map(function (s, i) {
      return '<div class="txr-step"><span class="n">' + (i + 1) + "</span><div><b>" + esc(s[0]) + "</b><p>" + s[1] + "</p></div></div>";
    }).join("");
    var wfHtml = wfRows.map(function (r) {
      return '<div class="txr-wf-row"><span>' + esc(r[0]) + '</span><b class="' + (r[2] || "") + '">' + esc(r[1]) + "</b></div>";
    }).join("");

    return '' +
      '<div class="txr-rc-meta">' +
        '<div class="txr-rc-left">' +
          '<span class="txr-anno">✦</span>' +
          '<span class="txr-rc-title">검증 가능한 답변 · ' + esc(title) + "</span>" +
        "</div>" +
        '<div class="txr-rc-left">' +
          '<span class="txr-chip asof" data-asof><span class="txr-anno">1</span>' + esc(asof) + " ▾</span>" +
          '<span class="txr-chip audit"><span class="txr-anno">3</span>감사 기록됨 · ' + esc(audit) + "</span>" +
        "</div>" +
      "</div>" +
      '<div class="txr-rc-body">' +
        '<p class="txr-verdict">' + verdict + "</p>" +
        '<div class="txr-metrics">' + metricsHtml + "</div>" +
        '<div class="txr-trace open" data-trace>' +
          '<div class="txr-trace-head" data-tracehead><span class="txr-anno">2</span><b>계산·근거 트레이스</b><span class="cnt">' + steps.length + "단계</span><span class=\"tgl\">▾</span></div>" +
          '<div class="txr-trace-steps">' + stepsHtml + "</div>" +
        "</div>" +
        '<div class="txr-actions"><span class="txr-anno">4</span>' +
          '<button class="txr-btn primary" data-wf data-wf-on="재계산 접기" data-wf-off="' + esc(wfTitle) + '">' + esc(wfTitle) + "</button>" +
        "</div>" +
        '<div class="txr-whatif" data-wfpanel><h5>' + esc(wfTitle) + "</h5>" + wfHtml + '<p class="txr-wf-note">' + esc(wfNote) + "</p></div>" +
        '<div class="txr-gate"' + (dec ? ' data-decided="1"' : "") + '><span class="lab">결정 게이트 · 사람이 확정</span>' +
          '<button class="txr-btn primary" data-gate="승인"' + (dec ? " disabled" : "") + (dec && dec.act === "승인" ? ' data-chosen="1"' : "") + ">승인</button>" +
          '<button class="txr-btn" data-gate="수정"' + (dec ? " disabled" : "") + (dec && dec.act === "수정" ? ' data-chosen="1"' : "") + ">수정</button>" +
          '<button class="txr-btn" data-gate="보류"' + (dec ? " disabled" : "") + (dec && dec.act === "보류" ? ' data-chosen="1"' : "") + ">보류</button>" +
          (dec ? '<button class="txr-btn ghost" data-gate-reset>결정 취소</button>' : "") +
        "</div>" +
        (dec ? decisionStampHTML(dec) : "") +
      "</div>";
  }

  /* ---------- gate decision state (역할별 · 세션 지속) ---------- */
  function gateKey() { return "txr_gate_" + savedKey(); }
  function getDecision() {
    try { var v = sessionStorage.getItem(gateKey()); return v ? JSON.parse(v) : null; }
    catch (e) { return null; }
  }
  function saveDecision(d) {
    try {
      if (d) sessionStorage.setItem(gateKey(), JSON.stringify(d));
      else sessionStorage.removeItem(gateKey());
    } catch (e) { /* ignore */ }
  }
  function auditId(act) {
    var base = savedKey() + act;
    var hsum = 0;
    for (var i = 0; i < base.length; i++) hsum = (hsum * 31 + base.charCodeAt(i)) % 100000;
    return "GA-2026-" + String(10000 + hsum).slice(0, 5);
  }
  function decisionStampHTML(d) {
    var kindCls = d.act === "승인" ? "ok" : d.act === "보류" ? "hold" : "edit";
    return '<div class="txr-decision ' + kindCls + '">' +
      '<span class="ic">' + (d.act === "승인" ? "✓" : d.act === "보류" ? "⏸" : "✎") + "</span>" +
      "<div><b>결정 · " + esc(d.act) + "</b>" +
      (d.note ? '<p class="note">' + esc(d.note) + "</p>" : "") +
      '<p class="meta">' + esc(d.at) + " · 감사 로그 " + esc(d.audit) + " 기록됨 · 결정자 " + esc(d.by) + "</p></div></div>";
  }
  function nowLabel() {
    var t = new Date();
    function z(n) { return (n < 10 ? "0" : "") + n; }
    return t.getFullYear() + "-" + z(t.getMonth() + 1) + "-" + z(t.getDate()) + " " + z(t.getHours()) + ":" + z(t.getMinutes());
  }
  function applyDecision(act, note) {
    var cu = (D().meta && D().meta.currentUser) || {};
    saveDecision({ act: act, note: note || "", at: nowLabel(), audit: auditId(act), by: cu.name || "-" });
    rerenderReceipt();
    toast(act + " 처리 완료 — 감사 로그에 기록되었습니다.", act === "승인" ? "ok" : "");
  }
  function rerenderReceipt() {
    var rc = document.querySelector("#s-perf .txr-receipt");
    if (rc) { rc.innerHTML = receiptHTML(); }
  }

  function bindReceipt(node) {
    node.addEventListener("click", function (e) {
      var t = e.target;
      var asof = t.closest("[data-asof]");
      if (asof) {
        var snaps = ["2026 상반기 · 6/30 마감 실적", "2026 상반기 · 5/31 시점", "2025 하반기 · 확정 기준"];
        var cur = asof.childNodes[asof.childNodes.length - 1].nodeValue.replace(" ▾", "").trim();
        var i = snaps.indexOf(cur); i = (i + 1) % snaps.length;
        asof.childNodes[asof.childNodes.length - 1].nodeValue = " " + snaps[i] + " ▾";
        return;
      }
      var th = t.closest("[data-tracehead]");
      if (th) { th.closest("[data-trace]").classList.toggle("open"); return; }
      var wf = t.closest("[data-wf]");
      if (wf) {
        var panel = node.querySelector("[data-wfpanel]");
        var on = panel.classList.toggle("show");
        wf.textContent = on ? wf.getAttribute("data-wf-on") : wf.getAttribute("data-wf-off");
        return;
      }
      var gr = t.closest("[data-gate-reset]");
      if (gr) {
        saveDecision(null);
        rerenderReceipt();
        toast("결정을 취소했습니다. 취소 이력도 감사 로그에 남습니다.");
        return;
      }
      var g = t.closest("[data-gate]");
      if (g && !g.disabled) {
        var act = g.getAttribute("data-gate");
        if (act === "승인") { applyDecision("승인"); return; }
        if (window.TX && TX.modal) {
          var isEdit = act === "수정";
          var mo = TX.modal({
            title: isEdit ? "수정 의견 입력" : "보류 사유 입력",
            body: '<p style="font-size:12.5px;color:#667085;margin:0 0 8px">' +
              (isEdit ? "AI 초안에서 고칠 내용을 지시하세요. 변경 근거가 기록됩니다."
                      : "보류 사유를 남기면 다음 사이클 심의에서 우선 재검토됩니다.") + "</p>" +
              '<textarea data-gate-note style="width:100%;min-height:84px;border:1px solid #D0D5DD;border-radius:8px;padding:9px;font:inherit;font-size:13px" placeholder="' +
              (isEdit ? "예) 상승폭 설명 근거에 3분기 리팩토링 기여를 반영해줘" : "예) ERP 4분기 마감 실적 반영 후 재심의") + '"></textarea>',
            actions: [
              { label: "취소", onClick: function () { mo.close(); } },
              { label: isEdit ? "수정 반영" : "보류 확정", kind: "primary", onClick: function () {
                  var ta2 = mo.box.querySelector("[data-gate-note]");
                  applyDecision(act, ta2 ? ta2.value.trim() : "");
                  mo.close();
                } }
            ]
          });
        } else { applyDecision(act); }
        return;
      }
    });
  }

  function injectReceipt() {
    var perf = document.getElementById("s-perf");
    if (!perf) return false;
    var head = perf.querySelector(".perf-head");
    if (!head) return false;
    if (perf.querySelector(".txr-receipt")) return true;
    var rc = el("div", "txr-receipt");
    rc.innerHTML = receiptHTML();
    head.insertAdjacentElement("afterend", rc);
    bindReceipt(rc);
    return true;
  }
  function pollReceipt() {
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      if (injectReceipt() || tries > 40) clearInterval(t);
    }, 150);
    // re-check when user opens 성과관리
    var gnb = document.getElementById("gnb");
    if (gnb) gnb.addEventListener("click", function (e) {
      var b = e.target.closest('button[data-s="perf"]');
      if (b) setTimeout(injectReceipt, 120);
    });
  }

  onLoad(function () {
    injectSwitcher();
    injectBar();
    pollReceipt();
  });

  window.TXRoles = { current: curRole, switchTo: switchTo, ROLES: ROLES };
})();
