/* ============================================================================
 * tx_meeting.js — 로드맵 6: 목표 검토 회의 모드 (window.EZMeeting)
 * ----------------------------------------------------------------------------
 * 대상: 조직장(leader) 전용. Pain 군집 "목표 검토 회의 운영" 커버 —
 *   회의 전 쟁점 자동 추출 → 팀 목표 대비 개인 목표 대조 → 회의 중 합의 기록
 *   → 회의 후 개인별 전달(ez:ctx 발행) + 반영 추적.
 * 원칙: 회의 기록은 제안·기록만 — 원본 목표(TALENX_DATA)는 절대 수정하지 않음.
 * 진입: #s-perf 목표 탭 헤더 "검토 회의" 버튼 / window.EZMeeting.open().
 * 저장: sessionStorage "ezmt_v1:<emp_id>" (합의·추적 상태만).
 * z-index 4200 (허브 4000 · ezpm 4100 위).
 * ========================================================================== */
(function () {
  "use strict";

  var Z = 4200;
  var D = window.TALENX_DATA || {};
  var CU = (D.meta && D.meta.currentUser) || {};
  var LS_KEY = "ezmt_v1:" + (CU.emp_id || "anon");

  function roleKey() {
    return (CU._role) ||
      (window.TXRoles && TXRoles.current && (TXRoles.current() || {}).key) || "member";
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function toast(msg, kind) { try { window.TX && TX.toast && TX.toast(msg, kind || "ok"); } catch (e) { /* 무해화 */ } }
  function pctNum(w) { var n = parseFloat(String(w == null ? "" : w).replace("%", "")); return isNaN(n) ? 0 : n; }
  function ava(name, size) {
    if (window.TXFIX && TXFIX.avatar) return TXFIX.avatar(name, size || 24);
    return '<span style="display:inline-flex;width:24px;height:24px;border-radius:50%;background:#1F7AF0;color:#fff;font-size:11px;align-items:center;justify-content:center">' + esc((name || "?").slice(-2)) + "</span>";
  }
  function themeName(id) {
    var t = (D.strategyThemes || []).filter(function (x) { return x.theme_id === id; })[0];
    return t ? t.name : "";
  }

  /* ============================================================
     1. 데이터 모델 — 팀·목표·쟁점 (읽기 전용, 원본 불변)
     ============================================================ */
  function teamMembers() {
    return (D.employees || []).filter(function (e) { return e.manager_id === CU.emp_id; });
  }
  function teamObjective() {
    var objs = D.objectives || [];
    return objs.filter(function (o) { return o.org_id === CU.org_id && o.type === "조직"; })[0] ||
           objs.filter(function (o) { return o.owner_emp_id === CU.emp_id; })[0] || null;
  }
  function krsOf(objId) {
    return (D.keyResults || []).filter(function (k) { return k.objective_id === objId; });
  }

  /* 팀원 실데이터 목표가 없으면 회의용 초안(시뮬)을 결정적으로 생성.
     ponytail: 시연 데이터 4종 로테이션 — 실 목표 데이터가 채워지면 자동으로 실데이터 우선. */
  function synthGoals(emp, idx, teamTheme) {
    var duty = String(emp.jobTitle || "담당 업무").replace(/담당$/, "");
    var v = idx % 4;
    var krs, theme = teamTheme;
    if (v === 0) {          /* 측정 불가 표현 */
      krs = [
        { name: "업계 Top 수준 " + duty + " 대응 체계 구축", target: "", weight: "40%", diff: "A", basis: "전년 대비 범위 확대" },
        { name: duty + " 처리 리드타임 20% 단축", target: "20%", weight: "40%", diff: "B", basis: "전년 평균 리드타임" },
        { name: "정기 리포트 발행 12회", target: "12회", weight: "20%", diff: "B", basis: "전년 10회" }];
    } else if (v === 1) {   /* 근거 없는 S 난이도 */
      krs = [
        { name: duty + " 신규 프로세스 정착 (적용 조직 3곳)", target: "3곳", weight: "50%", diff: "S", basis: "" },
        { name: "고객 만족도 4.5점 이상", target: "4.5점", weight: "30%", diff: "A", basis: "전년 4.2점" },
        { name: "개선 과제 4건 완료", target: "4건", weight: "20%", diff: "B", basis: "전년 3건" }];
    } else if (v === 2) {   /* 가중치 합 90 */
      krs = [
        { name: duty + " 오류율 1% 이하 유지", target: "1%", weight: "40%", diff: "A", basis: "상반기 1.4%" },
        { name: "대응 매뉴얼 전면 개정", target: "1건", weight: "30%", diff: "B", basis: "현행 v2.0" },
        { name: "교육 이수 2건", target: "2건", weight: "20%", diff: "C", basis: "전년 2건" }];
    } else {                /* 전략 연결 없음 + 수치 없음 */
      theme = null;
      krs = [
        { name: duty + " 운영 체계 고도화", target: "", weight: "60%", diff: "A", basis: "" },
        { name: "월간 점검 회의 정례화", target: "12회", weight: "40%", diff: "B", basis: "비정기 운영" }];
    }
    return [{
      id: "SYN-" + emp.emp_id, title: "FY2026 " + duty + " " + (v === 3 ? "운영 고도화" : "성과 목표"),
      theme_id: theme, synth: true, krs: krs
    }];
  }

  function goalsOf(emp, idx, teamTheme) {
    var real = (D.objectives || []).filter(function (o) { return o.owner_emp_id === emp.emp_id; });
    if (!real.length) return synthGoals(emp, idx, teamTheme);
    return real.map(function (o) {
      return {
        id: o.objective_id, title: o.title, theme_id: o.strategy_theme_id, synth: false,
        krs: krsOf(o.objective_id).map(function (k) {
          return { name: k.name, target: k.target_value || "", weight: k.weight || "0%",
                   diff: k.difficulty || "", basis: (k.difficulty_basis && (k.difficulty_basis.note || k.difficulty_basis.label)) || "" };
        })
      };
    });
  }

  /* 쟁점 추출 — EZLint 실검사(goal 규칙) + 구조 검사(S 난이도 근거·가중치 합·전략 연결) */
  function collectIssues(m) {
    var out = [], seq = 0;
    function push(objTitle, krName, tag, tip, sev) {
      out.push({ id: m.emp.emp_id + "-i" + (++seq), emp_id: m.emp.emp_id, empName: m.emp.name,
                 objTitle: objTitle, kr: krName, tag: tag, tip: tip, sev: sev || "warn" });
    }
    m.objs.forEach(function (o) {
      var sum = 0;
      o.krs.forEach(function (k) {
        sum += pctNum(k.weight);
        if (window.EZLint && EZLint.lintKR) {
          EZLint.lintKR({ name: k.name, targetValue: k.target, baseline: k.basis, mode: 1, verifyCond: "" })
            .forEach(function (h) {
              if (h.id === "goal-6" || h.id === "goal-7") return; /* 기준선·판정조건은 회의 쟁점에서 제외(노이즈) */
              push(o.title, k.name, h.tag, h.tip, h.cls);
            });
        }
        if (k.diff === "S" && !String(k.basis || "").trim())
          push(o.title, k.name, "근거 없는 S 난이도", "난이도 상향 근거(비교 기준)가 없습니다 — 회의에서 근거를 합의하세요", "bad");
      });
      if (Math.round(sum) !== 100)
        push(o.title, null, "가중치 합 " + Math.round(sum) + "%", "핵심 성과 가중치 합이 100%가 아닙니다 — 배분을 재조정하세요", "bad");
      if (!o.theme_id)
        push(o.title, null, "전략 연결 없음", "팀 목표의 전략 테마와 연결되지 않았습니다 — 목표 정렬 점검 필요", "warn");
    });
    return out;
  }

  /* 중복 후보 — 팀원 간 핵심 성과 명칭 토큰 겹침(≥2).
     ponytail: O(n²) 전수 비교 — 팀 규모(수 명)에서 충분, 커지면 토큰 인덱스로. */
  var STOP = { "달성": 1, "이상": 1, "이하": 1, "완료": 1, "유지": 1, "목표": 1, "건수": 1 };
  function tokens(s) {
    return String(s || "").split(/[^가-힣A-Za-z0-9]+/).filter(function (t) { return t.length >= 2 && !STOP[t]; });
  }
  function dupCandidates(members) {
    var rows = [], list = [];
    members.forEach(function (m) {
      m.objs.forEach(function (o) {
        o.krs.forEach(function (k) { list.push({ emp: m.emp, name: k.name, tk: tokens(k.name) }); });
      });
    });
    for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) {
      if (list[i].emp.emp_id === list[j].emp.emp_id) continue;
      var hit = list[i].tk.filter(function (t) { return list[j].tk.indexOf(t) >= 0; });
      if (hit.length >= 2) rows.push({ a: list[i], b: list[j], common: hit.slice(0, 3) });
    }
    return rows;
  }

  function buildModel() {
    var tObj = teamObjective();
    var tTheme = tObj ? tObj.strategy_theme_id : null;
    var members = teamMembers().map(function (e, i) {
      var m = { emp: e, objs: goalsOf(e, i, tTheme) };
      m.issues = collectIssues(m);
      return m;
    });
    return { teamObj: tObj, teamKrs: tObj ? krsOf(tObj.objective_id) : [], teamTheme: tTheme,
             members: members, dups: dupCandidates(members),
             issues: members.reduce(function (a, m) { return a.concat(m.issues); }, []) };
  }

  /* ============================================================
     2. 합의 기록 상태 (sessionStorage — 원본 목표 비수정)
     ============================================================ */
  function loadAgs() { try { return JSON.parse(sessionStorage.getItem(LS_KEY) || "[]"); } catch (e) { return []; } }
  function saveAgs(a) { try { sessionStorage.setItem(LS_KEY, JSON.stringify(a)); } catch (e) { /* 무해화 */ } }

  var S = { step: 1, memberIdx: 0, model: null, ags: [] };

  /* ============================================================
     3. 스타일 (자체 주입, .ezmt-*)
     ============================================================ */
  function injectCss() {
    if (document.getElementById("ezmt-css")) return;
    var st = document.createElement("style");
    st.id = "ezmt-css";
    st.textContent =
      "#ezmt-ov{position:fixed;inset:0;z-index:" + Z + ";background:#F4F6FA;display:flex;flex-direction:column;font-size:13.5px;color:#1A2233}" +
      ".ezmt-head{display:flex;align-items:center;gap:14px;background:#fff;border-bottom:1px solid #E3E8F0;padding:12px 22px;flex:none}" +
      ".ezmt-head h2{margin:0;font-size:16.5px;font-weight:800;letter-spacing:-.01em}" +
      ".ezmt-head .ezmt-sub{color:#6B7280;font-size:12px}" +
      ".ezmt-steps{display:flex;gap:6px;margin-left:18px}" +
      ".ezmt-steps button{border:1px solid #E3E8F0;background:#fff;border-radius:18px;padding:6px 14px;font-size:12.5px;font-weight:700;color:#5B6472;cursor:pointer}" +
      ".ezmt-steps button.on{background:#1F7AF0;border-color:#1F7AF0;color:#fff}" +
      ".ezmt-x{margin-left:auto;border:0;background:none;font-size:20px;color:#5B6472;cursor:pointer;padding:4px 8px}" +
      ".ezmt-ai{border:1px solid #C7DCFB;background:#EFF6FF;color:#1D4ED8;border-radius:8px;padding:6px 12px;font-size:12.5px;font-weight:700;cursor:pointer}" +
      ".ezmt-body{flex:1;overflow:auto;padding:18px 22px}" +
      ".ezmt-card{background:#fff;border:1px solid #E3E8F0;border-radius:12px;padding:16px 18px;margin-bottom:14px}" +
      ".ezmt-card h3{margin:0 0 10px;font-size:14px;font-weight:800}" +
      ".ezmt-kpis{display:flex;gap:22px;flex-wrap:wrap}" +
      ".ezmt-kpis .k b{font-size:19px;font-weight:800;color:#1F7AF0;margin-right:4px}" +
      ".ezmt-chip{display:inline-flex;align-items:center;gap:5px;border:1px solid #E3E8F0;border-radius:14px;padding:3px 10px;font-size:12px;font-weight:600;color:#48505E;margin:2px 4px 2px 0;background:#fff}" +
      ".ezmt-chip.cov{border-color:#BBE3C9;background:#EFFAF3;color:#15803D}" +
      ".ezmt-chip.tt{border-color:#1F7AF0;color:#1F7AF0}" +
      ".ezmt-tag{display:inline-block;border-radius:5px;padding:1px 7px;font-size:11px;font-weight:700;margin-right:6px}" +
      ".ezmt-tag.bad{background:#FDEBEA;color:#B42318}.ezmt-tag.warn{background:#FFF4E5;color:#B45309}" +
      ".ezmt-irow{padding:9px 0;border-bottom:1px solid #EFF2F7}.ezmt-irow:last-child{border-bottom:0}" +
      ".ezmt-irow .tip{color:#6B7280;font-size:12px;margin-top:3px}" +
      ".ezmt-mem{display:flex;align-items:center;gap:8px;font-weight:800;margin-bottom:4px}" +
      ".ezmt-mchips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}" +
      ".ezmt-mchips button{display:flex;align-items:center;gap:7px;border:1px solid #E3E8F0;background:#fff;border-radius:20px;padding:5px 13px 5px 6px;font-size:12.5px;font-weight:700;color:#48505E;cursor:pointer}" +
      ".ezmt-mchips button.on{border-color:#1F7AF0;color:#1F7AF0;background:#EFF6FF}" +
      ".ezmt-cols{display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap}" +
      ".ezmt-cols>.ezmt-card{flex:1;min-width:340px;margin-bottom:0}" +
      ".ezmt-tbl{width:100%;border-collapse:collapse;font-size:12.5px}" +
      ".ezmt-tbl th{font-size:11.5px;color:#6B7280;text-align:left;padding:5px 8px;border-bottom:1px solid #E3E8F0;font-weight:700}" +
      ".ezmt-tbl td{padding:7px 8px;border-bottom:1px solid #EFF2F7;vertical-align:top}" +
      ".ezmt-wsum{display:inline-block;border-radius:6px;padding:2px 9px;font-size:12px;font-weight:800}" +
      ".ezmt-wsum.ok{background:#EFFAF3;color:#15803D}.ezmt-wsum.no{background:#FDEBEA;color:#B42318}" +
      ".ezmt-winp{width:52px;border:1px solid #E3E8F0;border-radius:6px;padding:3px 6px;font-size:12.5px;text-align:right}" +
      ".ezmt-agform{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}" +
      ".ezmt-agform input{border:1px solid #E3E8F0;border-radius:7px;padding:5px 9px;font-size:12.5px}" +
      ".ezmt-agform .dir{flex:1;min-width:180px}" +
      ".ezmt-btn{border:0;background:#1F7AF0;color:#fff;border-radius:7px;padding:6px 13px;font-size:12.5px;font-weight:700;cursor:pointer}" +
      ".ezmt-btn.ghost{background:#fff;border:1px solid #E3E8F0;color:#48505E}" +
      ".ezmt-btn:disabled{opacity:.45;cursor:default}" +
      ".ezmt-st{display:inline-block;border-radius:12px;padding:2px 10px;font-size:11.5px;font-weight:700}" +
      ".ezmt-st.s1{background:#EFF6FF;color:#1D4ED8}.ezmt-st.s2{background:#FFF4E5;color:#B45309}.ezmt-st.s3{background:#EFFAF3;color:#15803D}" +
      ".ezmt-gate{color:#6B7280;font-size:12px;margin:4px 0 0;display:flex;align-items:center;gap:6px}" +
      ".ezmt-empty{color:#6B7280;font-size:13px;padding:14px 0}" +
      "#ezmt-entry{display:inline-flex;align-items:center;gap:5px}";
    document.head.appendChild(st);
  }

  /* ============================================================
     4. 렌더
     ============================================================ */
  function stepBtn(n, label) {
    return '<button data-ezmt-step="' + n + '"' + (S.step === n ? ' class="on"' : "") + ">" + label + "</button>";
  }
  function issueRow(it, withMember) {
    return '<div class="ezmt-irow">' +
      '<span class="ezmt-tag ' + (it.sev === "bad" ? "bad" : "warn") + '">' + esc(it.tag) + "</span>" +
      (withMember ? "<b>" + esc(it.empName) + "</b> · " : "") +
      esc(it.kr || it.objTitle) +
      '<div class="tip">' + esc(it.tip) + "</div></div>";
  }

  function renderStep1(M) {
    var themes = (D.strategyThemes || []).map(function (t) {
      var n = 0;
      M.members.forEach(function (m) { m.objs.forEach(function (o) { if (o.theme_id === t.theme_id) n++; }); });
      var cls = "ezmt-chip" + (n ? " cov" : "") + (t.theme_id === M.teamTheme ? " tt" : "");
      return '<span class="' + cls + '">' + esc(t.name) + (t.theme_id === M.teamTheme ? " · 팀 목표" : "") + " — " + n + "건</span>";
    }).join("");
    var noLink = M.members.reduce(function (a, m) {
      return a + m.objs.filter(function (o) { return !o.theme_id; }).length;
    }, 0);
    var dups = M.dups.length
      ? M.dups.map(function (d) {
          return '<div class="ezmt-irow"><span class="ezmt-tag warn">중복 후보</span>' +
            "<b>" + esc(d.a.emp.name) + "</b> · " + esc(d.a.name) + " ↔ <b>" + esc(d.b.emp.name) + "</b> · " + esc(d.b.name) +
            '<div class="tip">겹치는 표현: ' + esc(d.common.join(", ")) + " — 역할 분담 또는 통합을 합의하세요</div></div>";
        }).join("")
      : '<div class="ezmt-empty">중복 후보가 없습니다.</div>';
    var cards = M.members.map(function (m, i) {
      var body = m.issues.length ? m.issues.map(function (it) { return issueRow(it, false); }).join("")
        : '<div class="ezmt-empty">자동 추출된 쟁점이 없습니다.</div>';
      return '<div class="ezmt-card"><div class="ezmt-mem">' + ava(m.emp.name, 26) + esc(m.emp.name) +
        ' <span style="font-weight:500;color:#6B7280;font-size:12px">' + esc(m.emp.jobTitle || "") + "</span>" +
        (m.objs[0] && m.objs[0].synth ? ' <span class="ezmt-tag warn">초안(시뮬)</span>' : "") +
        '<button class="ezmt-btn ghost" style="margin-left:auto" data-ezmt-goto="' + i + '">회의에서 논의</button></div>' + body + "</div>";
    }).join("");
    return '<div class="ezmt-card"><div class="ezmt-kpis">' +
      '<span class="k"><b>' + M.members.length + "</b>팀원</span>" +
      '<span class="k"><b>' + M.members.reduce(function (a, m) { return a + m.objs.length; }, 0) + "</b>개인 목표</span>" +
      '<span class="k"><b>' + M.issues.length + "</b>자동 추출 쟁점</span>" +
      '<span class="k"><b>' + M.dups.length + "</b>중복 후보</span></div></div>" +
      '<div class="ezmt-card"><h3>팀 목표 대비 개인 목표 합산 — 전략 테마 커버리지</h3>' + themes +
      (noLink ? '<div class="ezmt-gate">전략 연결이 없는 개인 목표 ' + noLink + "건 — 목표 정렬 점검 대상</div>" : "") + "</div>" +
      '<div class="ezmt-card"><h3>중복 후보</h3>' + dups + "</div>" +
      "<h3 style='margin:4px 2px 10px;font-size:14px'>팀원별 쟁점 카드</h3>" + cards;
  }

  function renderStep2(M) {
    if (!M.members.length) return '<div class="ezmt-empty">팀원이 없습니다.</div>';
    if (S.memberIdx >= M.members.length) S.memberIdx = 0;
    var m = M.members[S.memberIdx];
    var chips = M.members.map(function (x, i) {
      return '<button data-ezmt-mem="' + i + '"' + (i === S.memberIdx ? ' class="on"' : "") + ">" +
        ava(x.emp.name, 22) + esc(x.emp.name) + (x.issues.length ? " · " + x.issues.length : "") + "</button>";
    }).join("");

    var teamRows = M.teamKrs.map(function (k) {
      return "<tr><td>" + esc(k.name) + "</td><td>" + esc(k.target_value || "-") + "</td><td>" + esc(k.weight || "-") + "</td><td>" + esc(k.difficulty || "-") + "</td></tr>";
    }).join("") || '<tr><td colspan="4" class="ezmt-empty">팀 목표 핵심 성과가 없습니다.</td></tr>';

    var memHtml = m.objs.map(function (o, oi) {
      var rows = o.krs.map(function (k, ki) {
        return "<tr><td>" + esc(k.name) + "</td><td>" + esc(k.target || "-") + "</td>" +
          '<td><input type="number" class="ezmt-winp" data-ezmt-w="' + oi + ":" + ki + '" value="' + pctNum(k.weight) + '">%</td>' +
          "<td>" + esc(k.diff || "-") + (k.diff === "S" && !k.basis ? ' <span class="ezmt-tag bad">근거 없음</span>' : "") + "</td></tr>";
      }).join("");
      var sum = o.krs.reduce(function (a, k) { return a + pctNum(k.weight); }, 0);
      return "<h3 style='margin-top:12px'>" + esc(o.title) +
        (o.theme_id ? ' <span class="ezmt-chip tt">' + esc(themeName(o.theme_id)) + "</span>" : ' <span class="ezmt-tag warn">전략 연결 없음</span>') +
        (o.synth ? ' <span class="ezmt-tag warn">초안(시뮬)</span>' : "") + "</h3>" +
        '<table class="ezmt-tbl"><tr><th>핵심 성과</th><th>목표값</th><th>가중치</th><th>난이도</th></tr>' + rows + "</table>" +
        '<div style="margin-top:8px">가중치 합 <span class="ezmt-wsum ' + (Math.round(sum) === 100 ? "ok" : "no") + '" data-ezmt-wsum="' + oi + '">' +
        Math.round(sum) + '%</span> <span style="color:#6B7280;font-size:12px">— 100% 확인 (재검은 기록용, 원본 목표는 수정되지 않음)</span></div>';
    }).join("");

    var agForms = m.issues.length ? m.issues.map(function (it) {
      var done = S.ags.some(function (a) { return a.issueId === it.id; });
      return '<div class="ezmt-irow">' + issueRow(it, false).replace(/^<div class="ezmt-irow">|<\/div>$/g, "") +
        (done ? '<div class="ezmt-gate">✓ 합의 기록됨</div>'
          : '<div class="ezmt-agform" data-ezmt-iss="' + it.id + '">' +
            '<input class="dir" placeholder="수정 방향 (예: 목표 수치·기한 명시)">' +
            '<input style="width:90px" value="' + esc(m.emp.name) + '" placeholder="담당">' +
            '<input type="date" value="2026-07-31">' +
            '<button class="ezmt-btn" data-ezmt-rec="' + it.id + '">합의 기록</button></div>') +
        "</div>";
    }).join("") : '<div class="ezmt-empty">이 팀원의 자동 추출 쟁점이 없습니다.</div>';

    return '<div class="ezmt-mchips">' + chips + "</div>" +
      '<div class="ezmt-cols">' +
      '<div class="ezmt-card"><h3>팀 목표 — ' + esc(M.teamObj ? M.teamObj.title : "미지정") + "</h3>" +
      '<table class="ezmt-tbl"><tr><th>핵심 성과</th><th>목표값</th><th>가중치</th><th>난이도</th></tr>' + teamRows + "</table></div>" +
      '<div class="ezmt-card"><h3>' + esc(m.emp.name) + " 개인 목표</h3>" + memHtml + "</div></div>" +
      '<div class="ezmt-card" style="margin-top:14px"><h3>쟁점별 합의 기록</h3>' + agForms + "</div>";
  }

  function renderStep3(M) {
    var rows = S.ags.map(function (a) {
      var cls = a.status === "반영 확인" ? "s3" : a.status === "전달됨" ? "s2" : "s1";
      return "<tr><td>" + esc(a.empName) + "</td><td>" + esc(a.issue) + "</td><td>" + esc(a.dir || "-") + "</td>" +
        "<td>" + esc(a.owner) + "</td><td>" + esc(a.due) + "</td>" +
        '<td><span class="ezmt-st ' + cls + '">' + esc(a.status) + "</span>" +
        (a.status === "전달됨" ? ' <button class="ezmt-btn ghost" data-ezmt-done="' + a.id + '">반영 확인</button>' : "") + "</td></tr>";
    }).join("");
    var pending = S.ags.filter(function (a) { return a.status === "합의"; }).length;
    return '<div class="ezmt-card"><h3>합의 사항 요약 (' + S.ags.length + "건)</h3>" +
      (S.ags.length
        ? '<table class="ezmt-tbl"><tr><th>팀원</th><th>쟁점</th><th>수정 방향</th><th>담당</th><th>기한</th><th>상태</th></tr>' + rows + "</table>"
        : '<div class="ezmt-empty">기록된 합의가 없습니다 — ② 회의 중 단계에서 쟁점별로 기록하세요.</div>') +
      '<div style="margin-top:12px;display:flex;gap:8px;align-items:center">' +
      '<button class="ezmt-btn" data-ezmt-send="1"' + (pending ? "" : " disabled") + ">개인별 전달 (" + pending + "건)</button>" +
      '<span class="ezmt-gate">전달은 기록·알림만 생성합니다 — 승인 전에는 아무것도 반영되지 않음</span></div></div>' +
      '<div class="ezmt-card"><h3>반영 추적</h3><div class="ezmt-gate" style="margin-bottom:8px">합의 → 전달됨 → 반영 확인 순서로 추적합니다. 원본 목표 수정은 각 팀원이 직접 진행합니다.</div>' +
      (S.ags.length ? "" : '<div class="ezmt-empty">추적할 항목이 없습니다.</div>') + "</div>";
  }

  function render() {
    var ov = document.getElementById("ezmt-ov");
    if (!ov) return;
    var M = S.model;
    ov.querySelector(".ezmt-steps").innerHTML =
      stepBtn(1, "① 회의 전 브리핑") + stepBtn(2, "② 회의 중") + stepBtn(3, "③ 회의 후");
    ov.querySelector(".ezmt-body").innerHTML =
      S.step === 1 ? renderStep1(M) : S.step === 2 ? renderStep2(M) : renderStep3(M);
  }

  /* ============================================================
     5. 동작 — 열기/닫기/이벤트
     ============================================================ */
  function open() {
    if (roleKey() !== "leader") { toast("목표 검토 회의는 조직장 전용 기능입니다", "warn"); return; }
    injectCss();
    if (document.getElementById("ezmt-ov")) { document.getElementById("ezmt-ov").style.display = "flex"; render(); return; }
    S.model = buildModel();
    S.ags = loadAgs();
    S.step = 1;
    var ov = document.createElement("div");
    ov.id = "ezmt-ov";
    ov.innerHTML =
      '<div class="ezmt-head"><h2>목표 검토 회의</h2>' +
      '<span class="ezmt-sub">' + esc(CU.orgName || "") + " · " + esc(CU.name || "") + " · 기록만 남기며 원본 목표는 수정하지 않습니다</span>" +
      '<div class="ezmt-steps"></div>' +
      '<button class="ezmt-ai" data-ezmt-ai="1">✦ 쟁점 요약 초안</button>' +
      '<button class="ezmt-x" data-ezmt-close="1" aria-label="닫기">×</button></div>' +
      '<div class="ezmt-body"></div>';
    document.body.appendChild(ov);
    ov.addEventListener("click", onClick);
    ov.addEventListener("input", onInput);
    render();
  }
  function close() {
    var ov = document.getElementById("ezmt-ov");
    if (ov) ov.style.display = "none";
  }

  function issueById(id) {
    var hit = null;
    S.model.members.forEach(function (m) {
      m.issues.forEach(function (it) { if (it.id === id) hit = { m: m, it: it }; });
    });
    return hit;
  }

  function onClick(e) {
    var t = e.target.closest ? e.target.closest("[data-ezmt-close],[data-ezmt-step],[data-ezmt-mem],[data-ezmt-goto],[data-ezmt-rec],[data-ezmt-send],[data-ezmt-done],[data-ezmt-ai]") : null;
    if (!t) return;
    if (t.hasAttribute("data-ezmt-close")) { close(); return; }
    if (t.hasAttribute("data-ezmt-step")) { S.step = +t.getAttribute("data-ezmt-step"); render(); return; }
    if (t.hasAttribute("data-ezmt-mem")) { S.memberIdx = +t.getAttribute("data-ezmt-mem"); render(); return; }
    if (t.hasAttribute("data-ezmt-goto")) { S.memberIdx = +t.getAttribute("data-ezmt-goto"); S.step = 2; render(); return; }

    if (t.hasAttribute("data-ezmt-rec")) {           /* 쟁점별 합의 기록 */
      var iid = t.getAttribute("data-ezmt-rec");
      var form = t.closest('[data-ezmt-iss="' + iid + '"]');
      var found = issueById(iid);
      if (!form || !found) return;
      var inps = form.querySelectorAll("input");
      S.ags.push({
        id: "ag-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 5),
        issueId: iid, emp_id: found.it.emp_id, empName: found.it.empName,
        issue: found.it.tag + (found.it.kr ? " · " + found.it.kr : ""),
        dir: inps[0].value || "", owner: inps[1].value || found.it.empName,
        due: inps[2].value || "", status: "합의"
      });
      saveAgs(S.ags);
      toast("합의를 기록했습니다 · " + found.it.empName);
      render();
      return;
    }

    if (t.hasAttribute("data-ezmt-send")) {          /* 개인별 전달 — ez:ctx 발행(시뮬) */
      var byEmp = {};
      S.ags.forEach(function (a) {
        if (a.status !== "합의") return;
        (byEmp[a.emp_id] = byEmp[a.emp_id] || { name: a.empName, list: [] }).list.push(a);
      });
      var n = 0;
      Object.keys(byEmp).forEach(function (id) {
        var g = byEmp[id];
        n++;
        try {
          document.dispatchEvent(new CustomEvent("ez:ctx", {
            detail: {
              type: "goal", source: "meeting.agree",
              title: "목표 검토 회의 합의 · " + g.name,
              summary: g.list.map(function (a) { return a.issue + (a.dir ? " → " + a.dir : "") + " (기한 " + a.due + ")"; }).join(" / "),
              weight: 2
            }
          }));
        } catch (err) { /* 원장 부재 — 발행만 시도 */ }
        g.list.forEach(function (a) { a.status = "전달됨"; });
      });
      saveAgs(S.ags);
      toast("합의 사항을 " + n + "명에게 전달했습니다 (시뮬레이션) · 성과 히스토리에 기록됨");
      render();
      return;
    }

    if (t.hasAttribute("data-ezmt-done")) {          /* 반영 확인 */
      var aid = t.getAttribute("data-ezmt-done");
      S.ags.forEach(function (a) { if (a.id === aid) a.status = "반영 확인"; });
      saveAgs(S.ags);
      toast("반영 확인으로 표시했습니다");
      render();
      return;
    }

    if (t.hasAttribute("data-ezmt-ai")) {            /* elizax 쟁점 요약 초안 */
      if (!(window.Elizax && Elizax.sendRaw)) { toast("elizax를 불러오지 못했습니다", "warn"); return; }
      var lines = S.model.issues.map(function (it) {
        return "- " + it.empName + " / " + (it.kr || it.objTitle) + " / " + it.tag;
      });
      Elizax.sendRaw("목표 검토 회의 준비 중입니다. 아래 쟁점 목록을 회의 안건 초안으로 요약해줘 (팀원별 묶음, 우선순위 표시):\n" + lines.join("\n"));
      toast("elizax에 쟁점 요약 초안을 요청했습니다");
    }
  }

  /* 가중치 즉석 재검 — 화면 내 재계산만, 원본 비수정 */
  function onInput(e) {
    var inp = e.target;
    if (!inp.hasAttribute || !inp.hasAttribute("data-ezmt-w")) return;
    var oi = inp.getAttribute("data-ezmt-w").split(":")[0];
    var sum = 0;
    document.querySelectorAll('#ezmt-ov [data-ezmt-w^="' + oi + ':"]').forEach(function (x) { sum += parseFloat(x.value) || 0; });
    var badge = document.querySelector('#ezmt-ov [data-ezmt-wsum="' + oi + '"]');
    if (badge) {
      badge.textContent = Math.round(sum) + "%";
      badge.className = "ezmt-wsum " + (Math.round(sum) === 100 ? "ok" : "no");
    }
  }

  /* ============================================================
     6. 진입점 — #s-perf 목표 탭 헤더 버튼 (leader 전용)
     ============================================================ */
  function ensureEntry() {
    if (roleKey() !== "leader") return;
    if (document.getElementById("ezmt-entry")) return;
    var btns = document.querySelector('#s-perf .subpage[data-p="0"] .perf-head .btns');
    if (!btns) return;
    var b = document.createElement("button");
    b.id = "ezmt-entry";
    b.className = "ghost-btn";
    b.innerHTML = "🤝 검토 회의";
    b.addEventListener("click", open);
    btns.insertBefore(b, btns.firstChild);
  }

  function boot() {
    injectCss();
    ensureEntry();
    if (window.TXFIX && TXFIX.onSection) TXFIX.onSection("s-perf", ensureEntry);
    else document.addEventListener("click", function (ev) {
      var g = ev.target.closest && ev.target.closest('[data-s="perf"]');
      if (g) setTimeout(ensureEntry, 120);
    });
  }
  if (window.TXFIX && TXFIX.ready) TXFIX.ready(boot);
  else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 80); });
  else setTimeout(boot, 80);

  window.EZMeeting = { open: open, close: close, _model: buildModel /* 점검용 */ };
})();
