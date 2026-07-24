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
      '<span class="txr-note">9개 화면 전체가 이 역할 기준으로 재구성됨 <span class="k">새로고침</span></span>';
    gnb.insertAdjacentElement("afterend", bar);
  }

  /* ---------- verifiable-answer receipt (평가관리 · 평가 현황) ---------- */
  function sb(kind, label) { return '<span class="txr-sb ' + kind + '">' + esc(label) + "</span>"; }

  /* ---------- 실데이터 계산 helpers (하드코딩 지표 대체) ---------- */
  var GRADES = ["S", "A", "B+", "B", "B-", "C", "D"];
  function gradeDown(g) {
    var i = GRADES.indexOf(g);
    return i < 0 ? "B" : GRADES[Math.min(i + 1, GRADES.length - 1)];
  }
  function orgById(id) {
    return (D().orgs || []).find(function (o) { return o.org_id === id; });
  }
  /* ponytail: 본부급 = level<=4 조상으로 근사(현 조직트리 6단), 조직개편 시 기준 레벨만 조정 */
  function divisionOf(orgId) {
    var o = orgById(orgId), guard = 0;
    while (o && o.level > 4 && guard++ < 10) o = orgById(o.parent_id);
    return o;
  }
  /* 본부별 등급 분포 → 전사 상위(S~A) 비율·관대화 의심 본부(전사+10%p 초과, n>=8) */
  function gradeStats() {
    var d = D(), evs = d.evaluations || [], emps = d.employees || [];
    if (!evs.length || !emps.length) return null;
    var evBy = {};
    evs.forEach(function (e) { evBy[e.emp_id] = e; });
    var top = 0, n = 0, byDiv = {};
    emps.forEach(function (emp) {
      var ev = evBy[emp.emp_id];
      if (!ev) return;
      n++;
      var isTop = ev.grade === "S" || ev.grade === "A";
      if (isTop) top++;
      var dv = divisionOf(emp.org_id);
      var key = dv ? dv.name : "기타";
      var b = byDiv[key] = byDiv[key] || { name: key, n: 0, top: 0 };
      b.n++;
      if (isTop) b.top++;
    });
    if (!n) return null;
    var rate = top / n, thr = rate + 0.10;
    var lenient = [];
    Object.keys(byDiv).forEach(function (k) {
      var b = byDiv[k];
      if (b.n >= 8 && b.top / b.n > thr) {
        lenient.push({ name: b.name, n: b.n, top: b.top, rate: Math.round(100 * b.top / b.n) });
      }
    });
    lenient.sort(function (a, b2) { return b2.rate - a.rate; });
    return { n: n, top: top, topPct: Math.round(rate * 100), thrPct: Math.round(thr * 100), lenient: lenient };
  }
  /* 상위(S~A) cap 초과분 하향 가정 재계산 (leader what-if) */
  function capTop(evs, cap) {
    var n = evs.length;
    if (!n) return null;
    var top = evs.filter(function (e) { return e.grade === "S" || e.grade === "A"; }).length;
    var allow = Math.floor(n * cap);
    var moved = Math.max(0, top - allow);
    return { n: n, beforePct: Math.round(100 * top / n), afterPct: Math.round(100 * Math.min(top, allow) / n), moved: moved };
  }
  function teamEvals(cu) {
    var d = D(), evBy = {};
    (d.evaluations || []).forEach(function (e) { evBy[e.emp_id] = e; });
    return (d.employees || []).filter(function (e) { return e.org_id === cu.org_id; })
      .map(function (e) { return evBy[e.emp_id]; })
      .filter(function (e) { return !!e; });
  }
  /* 전사 진척·정렬·본부별 요약 (exec) */
  function execStats() {
    var d = D(), os = d.objectives || [];
    var comp = os.filter(function (o) { return o.level === "company"; });
    var base = comp.length ? comp : os;
    var prog = base.length ? Math.round(base.reduce(function (a, o) { return a + (o.progress || 0); }, 0) / base.length) : 0;
    var mis = os.filter(function (o) { return !o.strategy_theme_id; });
    var alignPct = os.length ? Math.round(100 * (os.length - mis.length) / os.length) : 100;
    var byDiv = {};
    os.forEach(function (o) {
      var dv = divisionOf(o.org_id);
      if (!dv || dv.level === 1) return;
      var b = byDiv[dv.name] = byDiv[dv.name] || { name: dv.name, sum: 0, n: 0 };
      b.sum += o.progress || 0;
      b.n++;
    });
    var divs = Object.keys(byDiv).map(function (k) {
      var b = byDiv[k];
      return { name: b.name, avg: Math.round(b.sum / b.n) };
    });
    divs.sort(function (a, b2) { return b2.avg - a.avg; });
    return { total: os.length, prog: prog, mis: mis, alignPct: alignPct, divs: divs, themeCount: (d.strategyThemes || []).length };
  }

  /* ---------- what-if: 열 때마다 실계산 (EZCalc 우선, 데이터 폴백) ---------- */
  function exampleWf() {
    return { rows: [["평가 데이터 없음 ", "(예시)", ""]], note: "평가 데이터가 없어 예시로 표시합니다." };
  }
  function whatIfCalc(role) {
    /* tx_agent.js의 실계산 엔진이 있으면 우선 사용 */
    if (window.EZCalc && typeof window.EZCalc.simulate === "function") {
      try {
        var r = window.EZCalc.simulate({ achievement_delta: -10 });
        if (r) {
          /* EZCalc 계약: before/after = 등급 분포 객체 {S,A,B,C,D}(%) — 문자열 요약으로 변환 */
          var distStr = function (o) {
            if (o == null) return "-";
            if (typeof o !== "object") return String(o);
            return ["S", "A", "B", "C", "D"].filter(function (g) { return o[g] != null; })
              .map(function (g) { return g + " " + o[g] + "%"; }).join(" · ");
          };
          return {
            rows: r.rows || [["현재 ", distStr(r.before), ""], ["달성률 -10%p 적용 시 ", distStr(r.after), "neg"]],
            note: r.note || "입력값만 바꿔 같은 계산 규칙으로 재산출했습니다. 승인 전에는 아무것도 반영되지 않습니다."
          };
        }
      } catch (e) { /* 엔진 오류 → 아래 데이터 폴백 */ }
    }
    var d = D(), cu = (d.meta && d.meta.currentUser) || {};
    if (role === "leader") {
      var c = capTop(teamEvals(cu), 0.3);
      if (!c) return exampleWf();
      return {
        rows: [
          ["팀 S~A " + c.beforePct + "% → ", c.afterPct + "%", "pos"],
          ["하향 재검토 대상 ", c.moved + "명", c.moved ? "neg" : ""]
        ],
        note: "실제 팀 등급 분포에 상위 ≤30% 배분만 적용해 재산출했습니다. 승인 전에는 아무것도 반영되지 않습니다."
      };
    }
    if (role === "hr") {
      var gs = gradeStats();
      if (!gs) return exampleWf();
      var moved = 0;
      gs.lenient.forEach(function (b) { moved += Math.max(0, b.top - Math.floor(b.n * gs.topPct / 100)); });
      var afterPct = Math.round(100 * (gs.top - moved) / gs.n);
      return {
        rows: [
          ["전사 S~A " + gs.topPct + "% → ", afterPct + "%", "pos"],
          ["관대화 의심 " + gs.lenient.length + "본부 → ", "0본부", "pos"],
          ["하향 재검토 대상 ", moved + "명", moved ? "neg" : ""]
        ],
        note: "관대화 의심 본부의 상위 비율을 전사 평균에 맞춘다고 가정해 실분포로 재산출했습니다. 승인 전에는 아무것도 반영되지 않습니다."
      };
    }
    if (role === "exec") {
      var xs = execStats();
      return {
        rows: [
          ["전사 목표 진척 " + xs.prog + "% → ", Math.max(0, xs.prog - 10) + "%", "neg"],
          ["전략 정렬률 ", xs.alignPct + "%", ""],
          ["미정렬 목표 ", xs.mis.length + "건", xs.mis.length ? "neg" : ""]
        ],
        note: "전사 달성률 -10%p 가정을 같은 집계 규칙에 적용해 재산출했습니다. 승인 전에는 아무것도 반영되지 않습니다."
      };
    }
    var ev = (d.evaluations || []).find(function (e) { return e.emp_id === cu.emp_id; });
    if (!ev || !ev.grade) return exampleWf();
    return {
      rows: [
        ["현재 등급 초안 ", ev.grade, ""],
        ["달성률 -10%p 가정 시 ", gradeDown(ev.grade), "neg"]
      ],
      note: "현재 등급 기준 한 단계 하향을 가정해 재산출했습니다. 제출·확정 전에는 아무것도 반영되지 않습니다."
    };
  }
  function renderWhatIf(panel) {
    var w = whatIfCalc(curRole().key);
    var rowsHtml = w.rows.map(function (r) {
      return '<div class="txr-wf-row"><span>' + esc(r[0]) + '</span><b class="' + (r[2] || "") + '">' + esc(r[1]) + "</b></div>";
    }).join("");
    panel.innerHTML = "<h5>" + esc(panel.getAttribute("data-wf-title") || "") + "</h5>" + rowsHtml +
      '<p class="txr-wf-note">' + esc(w.note) + "</p>";
  }

  /* ---------- member 자기평가 제출 전 잠금 (tx_fix_appr.js 계약) ---------- */
  var selfEvalDoneFlag = false;
  document.addEventListener("txf:selfeval-submitted", function () {
    selfEvalDoneFlag = true;
    rerenderReceipt();
  });
  function selfEvalDone(empId) {
    if (selfEvalDoneFlag) return true;
    try { return !!sessionStorage.getItem("txf_selfeval_done:" + empId); }
    catch (e) { return true; } /* 저장소 불가 환경은 잠금 대신 공개(데모 우선) */
  }
  function ensureRolesCss() {
    if (document.getElementById("txr-roles-css")) return;
    var st = document.createElement("style");
    st.id = "txr-roles-css";
    st.textContent =
      ".txr-lockwrap{position:relative}" +
      ".txr-locked{filter:blur(7px);pointer-events:none;user-select:none}" +
      ".txr-lockmsg{position:absolute;top:0;left:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:4px;padding:16px}" +
      ".txr-lockmsg b{font-size:14px}" +
      ".txr-lockmsg p{font-size:12px;color:#667085;margin:0;max-width:360px}" +
      ".txr-metric[data-mis]{cursor:pointer;position:relative}" +
      ".txr-pop{position:absolute;top:calc(100% + 6px);left:0;z-index:30;background:#fff;border:1px solid #D0D5DD;border-radius:8px;box-shadow:0 8px 24px rgba(16,24,40,.12);padding:10px 12px;min-width:220px;max-width:320px;font-size:12px;color:#344054;text-align:left}" +
      ".txr-pop b{display:block;margin-bottom:4px}" +
      ".txr-pop ul{margin:0;padding-left:16px}" +
      ".txr-pop li{margin:2px 0}" +
      ".txr-pop p{margin:0}";
    document.head.appendChild(st);
  }

  /* ---------- 게이트 어휘: member=피평가자용, 그 외=결정권자용 ---------- */
  function gateDefs(role) {
    if (role === "member") {
      return [
        { act: "확인했습니다", primary: true },
        { act: "이의 제기", modal: { title: "이의 제기 사유 입력", desc: "등급 초안에 동의하지 않는 이유를 남기세요. 평가자 재검토 절차가 시작되며, 확정 전에는 아무것도 반영되지 않습니다.", ph: "예) 3분기 프로젝트 기여가 실적 집계에 빠져 있습니다", ok: "이의 제기 접수" } },
        { act: "소명 제출", modal: { title: "소명 내용 입력", desc: "평가 근거에 대한 소명을 남기면 감사 기록과 함께 평가자에게 전달됩니다.", ph: "예) 목표 지연은 고객사 일정 변경에 따른 것입니다", ok: "소명 제출" } }
      ];
    }
    return [
      { act: "승인", primary: true },
      { act: "수정", modal: { title: "수정 의견 입력", desc: "AI 초안에서 고칠 내용을 지시하세요. 변경 근거가 기록됩니다.", ph: "예) 상승폭 설명 근거에 3분기 리팩토링 기여를 반영해줘", ok: "수정 반영" } },
      { act: "보류", modal: { title: "보류 사유 입력", desc: "보류 사유를 남기면 다음 사이클 심의에서 우선 재검토됩니다.", ph: "예) ERP 4분기 마감 실적 반영 후 재심의", ok: "보류 확정" } }
    ];
  }

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

    var title, verdict, metrics, steps, wfTitle, audit;

    if (role === "leader") {
      var tc = capTop(teamEvals(m.cu), 0.3);
      var teamTop = tc ? tc.beforePct + "%" : "- (예시)";
      title = "우리 팀 등급 분포 · 검증";
      verdict = name + "님 팀(" + m.teamCount + "명) 등급 초안 분포입니다. <b>상위(S~A) 편중</b> 여부를 강제배분 밴드와 대조했습니다. <span class=\"warn\">자동 확정 아님.</span>";
      metrics = [["팀 인원", m.teamCount + "명"], ["S~A 비율", teamTop], ["밴드 상한", "≤30%"]];
      steps = [
        ["분포 스캔", "팀원 등급 초안 분포 집계 → S~A " + esc(teamTop) + " " + sb("rule", "규칙") + ' <span class="txr-rid">calib.dist.' + esc(m.cu.org_id || "") + "</span>"],
        ["규칙 대조", "강제배분 가이드 상위 ≤ 30% " + (tc && tc.moved ? "초과 감지 · 초과 " + tc.moved + "명" : "준수 확인") + " <span class=\"txr-badge ok\">평가규정 v3.1 · 검증됨</span> <span class=\"txr-badge ref\">§12</span>"],
        ["근거 대비", "상위 등급자 실적 달성률 대조 " + sb("erp", "ERP") + " → 상승폭 설명력 점검"]
      ];
      wfTitle = "강제배분(상위 ≤30%) 적용 시 재계산";
      audit = "탐색 범위 · 권한 내 우리 팀";
    } else if (role === "hr") {
      /* 연결·규칙 지표는 실데이터 전수 계산 (하드코딩 금지) */
      var dd = D();
      var ksAll = dd.keyResults || [], osAll = dd.objectives || [];
      var wSum = {};
      ksAll.forEach(function (k) { wSum[k.objective_id] = (wSum[k.objective_id] || 0) + (parseFloat(k.weight) || 0); });
      var wBad = Object.keys(wSum).filter(function (o) { return Math.abs(wSum[o] - 100) > 0.5; }).length;
      var noJobKr = ksAll.filter(function (k) { return !k.job_task_ref; }).length;
      var noTheme = osAll.filter(function (o) { return !o.strategy_theme_id; }).length;
      /* 관대화 의심: 본부별 상위(S~A) 비율 실계산 (전사+10%p 초과 · n>=8) */
      var gsHr = gradeStats();
      var lenList = gsHr ? gsHr.lenient : [];
      var lenLabel = gsHr ? lenList.length + "본부" : "2본부 (예시)";
      var lenNames = lenList.length
        ? lenList.map(function (l) { return l.name + " " + l.rate + "%"; }).join(" · ")
        : "임계 초과 본부 없음";
      title = "전사 평가 운영 · 규칙 검증";
      verdict = "전사 목표·평가에서 <b>규칙 위반·미연결 신호</b>를 먼저 보고합니다. 가중치·직무 근거·전략 연결은 전수 검증했고, 본부별 등급 분포로 관대화 의심을 점검했습니다. <span class=\"warn\">재검토 제안 · 자동 수정 아님.</span>";
      metrics = [["가중치 이상", wBad + "건"], ["직무근거 없는 KR", noJobKr + "건"], ["관대화 의심", lenLabel]];
      steps = [
        ["규칙 스캔", "목표별 KR 가중치 합 100% 검증 → 이상 " + wBad + "건 " + sb("rule", "규칙") + ' <span class="txr-rid">rule.weight.sum</span>'],
        ["정렬 검증", "목표 " + osAll.length + "건 전략 미연결 " + noTheme + "건 · KR " + ksAll.length + "건 직무근거 누락 " + noJobKr + "건 " + sb("talenx", "talenx") + " " + sb("rule", "원칙") + " 전사 정렬 필수"],
        ["분포 대비", gsHr
          ? "본부별 상위(S~A) 비율 전수 계산 → 전사 " + gsHr.topPct + "% · 임계 " + gsHr.thrPct + "% 초과 " + lenList.length + "본부(" + esc(lenNames) + ") " + sb("erp", "ERP") + " 실적 대비 상승폭 점검"
          : "평가 데이터 없음 → 관대화 의심 2본부 (예시) " + sb("erp", "ERP")]
      ];
      wfTitle = "관대화 의심 본부 정상화 가정 시 전사 분포 재계산";
      audit = "탐색 범위 · 권한 내 전사";
    } else if (role === "exec") {
      /* 진척·정렬·본부별 요약 = objectives·strategyThemes·orgs 실계산 */
      var xs = execStats();
      var gsEx = gradeStats();
      var risk = gsEx ? (gsEx.lenient.length === 0 ? "낮음" : gsEx.lenient.length <= 2 ? "중" : "높음") : "중 (예시)";
      var divTop = xs.divs.length ? xs.divs[0] : null;
      var divLow = xs.divs.length ? xs.divs[xs.divs.length - 1] : null;
      title = "전사 성과 조망 · 목표 정렬";
      verdict = "전사 목표 정렬 상태와 등급 분포 리스크를 요약합니다. 전사 목표 진척 " + xs.prog + "%와 <b>미정렬 목표 " + xs.mis.length + "건</b>을 짚었습니다.";
      metrics = [
        ["전사 목표 진척", xs.prog + "%"],
        ["미정렬 목표", xs.mis.length + "건 ▾", 'data-mis="1" title="클릭하면 해당 목표 목록을 확인합니다"'],
        ["분포 리스크", risk]
      ];
      steps = [
        ["정렬 현황 조회", "목표 " + xs.total + "건 × 전략 테마 " + xs.themeCount + "종 연결 검증 → 미정렬 " + xs.mis.length + "건 · 정렬률 " + xs.alignPct + "% " + sb("talenx", "talenx") + ' <span class="txr-rid">okr.tree.FY2026</span>'],
        ["실적 대조", "전사(company) 목표 진척 평균 " + xs.prog + "% " + sb("erp", "ERP")],
        ["본부별 요약", xs.divs.length
          ? "본부별 목표 진척 상위 " + esc(divTop.name) + " " + divTop.avg + "% · 하위 " + esc(divLow.name) + " " + divLow.avg + "% → 등급 조정 우선순위 제안"
          : "본부별 목표 데이터 없음 (예시)"]
      ];
      wfTitle = "전사 달성률 -10%p 가정 시 재계산";
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
      audit = "탐색 범위 · 권한 내 본인";
    }

    var metricsHtml = metrics.map(function (x) {
      return '<div class="txr-metric"' + (x[2] ? " " + x[2] : "") + "><label>" + esc(x[0]) + "</label><b>" + esc(x[1]) + "</b></div>";
    }).join("");
    var stepsHtml = steps.map(function (s, i) {
      return '<div class="txr-step"><span class="n">' + (i + 1) + "</span><div><b>" + esc(s[0]) + "</b><p>" + s[1] + "</p></div></div>";
    }).join("");

    /* 게이트: member=확인·이의·소명(피평가자 어휘), 그 외=승인·수정·보류 */
    var gateLab = role === "member" ? "확인 게이트 · 확정 전에는 아무것도 반영되지 않음" : "결정 게이트 · 사람이 확정";
    var gateBtns = gateDefs(role).map(function (df) {
      return '<button class="txr-btn' + (df.primary ? " primary" : "") + '" data-gate="' + esc(df.act) + '"' +
        (dec ? " disabled" : "") + (dec && dec.act === df.act ? ' data-chosen="1"' : "") + ">" + esc(df.act) + "</button>";
    }).join("");

    var bodyHtml =
      '<p class="txr-verdict">' + verdict + "</p>" +
      '<div class="txr-metrics">' + metricsHtml + "</div>" +
      '<div class="txr-trace open" data-trace>' +
        '<div class="txr-trace-head" data-tracehead><span class="txr-anno">2</span><b>계산·근거 과정</b><span class="cnt">' + steps.length + "단계</span><span class=\"tgl\">▾</span></div>" +
        '<div class="txr-trace-steps">' + stepsHtml + "</div>" +
      "</div>" +
      '<div class="txr-actions"><span class="txr-anno">4</span>' +
        '<button class="txr-btn primary" data-wf data-wf-on="재계산 접기" data-wf-off="' + esc(wfTitle) + '">' + esc(wfTitle) + "</button>" +
      "</div>" +
      '<div class="txr-whatif" data-wfpanel data-wf-title="' + esc(wfTitle) + '"></div>' +
      '<div class="txr-gate"' + (dec ? ' data-decided="1"' : "") + '><span class="lab">' + esc(gateLab) + "</span>" +
        gateBtns +
        (dec ? '<button class="txr-btn ghost" data-gate-reset>결정 취소</button>' : "") +
      "</div>" +
      (dec ? decisionStampHTML(dec) : "");

    /* member: 자기평가 제출 전에는 등급·수치 잠금 (앵커링 방지) */
    if (role === "member" && !selfEvalDone(m.cu.emp_id)) {
      bodyHtml =
        '<div class="txr-lockwrap">' +
          '<div class="txr-locked" aria-hidden="true">' + bodyHtml + "</div>" +
          '<div class="txr-lockmsg"><b>본인 평가 제출 후 근거가 공개됩니다</b>' +
            "<p>자기평가를 먼저 제출하면 등급 초안과 계산 근거가 열립니다. 제출 전에는 아무것도 확정되지 않습니다.</p></div>" +
        "</div>";
    }

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
      '<div class="txr-rc-body">' + bodyHtml + "</div>";
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
    var kindCls = (d.act === "승인" || d.act === "확인했습니다") ? "ok"
      : (d.act === "보류" || d.act === "소명 제출") ? "hold" : "edit";
    return '<div class="txr-decision ' + kindCls + '">' +
      '<span class="ic">' + (kindCls === "ok" ? "✓" : kindCls === "hold" ? "⏸" : "✎") + "</span>" +
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
    toast("'" + act + "' 결정이 감사 로그에 기록되었습니다.", (act === "승인" || act === "확인했습니다") ? "ok" : "");
  }
  function rerenderReceipt() {
    var rc = document.querySelector("#s-appr .txr-receipt");
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
        if (on) renderWhatIf(panel); /* 열 때마다 최신 데이터·엔진으로 재계산 */
        return;
      }
      var mm = t.closest("[data-mis]");
      if (mm) {
        var oldPop = mm.querySelector(".txr-pop");
        if (oldPop) { oldPop.parentNode.removeChild(oldPop); return; }
        var xsPop = execStats();
        var pop = el("div", "txr-pop");
        pop.innerHTML = xsPop.mis.length
          ? "<b>미정렬 목표 " + xsPop.mis.length + "건</b><ul>" + xsPop.mis.map(function (o) { return "<li>" + esc(o.title) + "</li>"; }).join("") + "</ul>"
          : "<b>미정렬 목표 없음</b><p>목표 " + xsPop.total + "건 전부 전략 테마에 연결되어 있습니다.</p>";
        mm.appendChild(pop);
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
        var defs = gateDefs(curRole().key), def = null;
        for (var di = 0; di < defs.length; di++) { if (defs[di].act === act) def = defs[di]; }
        /* 사유 입력이 필요 없는 결정(승인·확인했습니다)은 즉시 스탬프 */
        if (!def || !def.modal || !(window.TX && TX.modal)) { applyDecision(act); return; }
        var mo = TX.modal({
          title: def.modal.title,
          body: '<p style="font-size:12.5px;color:#667085;margin:0 0 8px">' + esc(def.modal.desc) + "</p>" +
            '<textarea data-gate-note style="width:100%;min-height:84px;border:1px solid #D0D5DD;border-radius:8px;padding:9px;font:inherit;font-size:13px" placeholder="' + esc(def.modal.ph) + '"></textarea>',
          actions: [
            { label: "취소", onClick: function () { mo.close(); } },
            { label: def.modal.ok, kind: "primary", onClick: function () {
                var ta2 = mo.box.querySelector("[data-gate-note]");
                applyDecision(act, ta2 ? ta2.value.trim() : "");
                mo.close();
              } }
          ]
        });
        return;
      }
    });
  }

  function injectReceipt() {
    // 검증 가능한 답변(등급·평가 근거) 영수증 = 평가관리(#s-appr)에 귀속.
    // 목표 현황(#s-perf)이 아니라 평가 현황 헤더(.ap-head) 뒤에 주입.
    var appr = document.getElementById("s-appr");
    if (!appr) return false;
    var head = appr.querySelector(".ap-head");
    if (!head) return false;
    if (appr.querySelector(".txr-receipt")) return true;
    ensureRolesCss();
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
    // re-check when user opens 평가관리
    var gnb = document.getElementById("gnb");
    if (gnb) gnb.addEventListener("click", function (e) {
      var b = e.target.closest('button[data-s="appr"]');
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
