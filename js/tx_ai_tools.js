/* ============================================================
   tx_ai_tools.js — elizax 에이전트 도구 (window.EZTools)
   Claude tool-use 루프(EZAI.agent)가 호출하는 실데이터 도구.
   모든 도구는 window.TALENX_DATA를 읽기 전용으로 조회하고,
   navigate만 화면 전환(EZNav.go)이라는 UI side-effect를 가진다.
   결과는 JSON 직렬화 가능한 객체 — 크기는 도구별 상한으로 제한.
   ============================================================ */
(function () {
  "use strict";

  function D() { return window.TALENX_DATA || {}; }
  function CU() { return (D().meta && D().meta.currentUser) || { emp_id: "EMP-0000", name: "사용자" }; }
  function arr(k) { return Array.isArray(D()[k]) ? D()[k] : []; }

  function empBrief(e) {
    return {
      emp_id: e.emp_id, name: e.name, jobTitle: e.jobTitle, orgName: e.orgName,
      level: e.level_kr || e.level, is_leader: !!e.is_leader, manager: e.managerName || null
    };
  }
  function findEmp(idOrName) {
    var q = String(idOrName || "").trim();
    if (!q) return null;
    var es = arr("employees");
    for (var i = 0; i < es.length; i++) if (es[i].emp_id === q) return es[i];
    for (var j = 0; j < es.length; j++) if (es[j].name === q) return es[j];
    for (var k = 0; k < es.length; k++) if ((es[k].name || "").indexOf(q) >= 0) return es[k];
    return null;
  }
  /* ---------------- 열람 규칙 게이트 (F5) ----------------
     화면을 우회해 AI에게 물어도 같은 규칙이 적용된다.
     공통 필터: 모든 도구가 반환하는 데이터 종류(recordType)를
     EZPolicy.check(역할, 종류, 관계)에 통과시켜 full/summ/anon/no 판정. */
  var POLICY_NOTE = "응답자 보호 정책에 따라 익명 집계로 제공합니다 (정책 v3.1)";
  var BLOCK_NOTE = "열람 권한이 없어 표시하지 않습니다 (정책 v3.1)";
  function viewerRole() {
    var c = CU();
    if (c._role) return c._role;
    try { if (window.TXRoles && TXRoles.current) return (TXRoles.current() || {}).key || "member"; } catch (e) { /* ignore */ }
    return c.is_leader ? "leader" : "member";
  }
  function relOf(ownerId) {
    var me = CU();
    if (!ownerId || ownerId === me.emp_id) return "self";
    var o = findEmp(ownerId);
    if (o && (o.manager_id === me.emp_id || o.org_id === me.org_id)) return "team";
    return "org";
  }
  function gate(recordType, ownerId) {
    try {
      if (window.EZPolicy && EZPolicy.check) return EZPolicy.check(viewerRole(), recordType, relOf(ownerId));
    } catch (e) { /* 정책 모듈 미로드 */ }
    return "full";
  }

  /* ---------------- 근태·급여 열람 규칙 (EZPolicy MATRIX 미수록 종류) ----------------
     tx_policy.js의 6종 매트릭스에는 근태·연차·급여 행이 없다. 민감도가 다른 종류라
     여기서 별도 규칙을 정의하되, 판정 어휘(full/summ/anon/no)와 relOf()·viewerRole()
     규약은 gate()와 동일하게 맞춘다.
       full = 개인 상세 · summ = 팀 집계만 · anon = 전사 익명 집계 · no = 차단
     원칙: 본인 급여·근태는 본인만, 조직장은 팀 근태 집계까지(급여는 불가), HR은 전사. */
  var HROPS_POLICY = {
    attendance: { self: "full", leader: "summ", hr: "full", exec: "anon" },
    leave:      { self: "full", leader: "summ", hr: "full", exec: "anon" },
    payroll:    { self: "full", leader: "no",   hr: "full", exec: "no" }
  };
  var HROPS_NOTE = {
    summ: "개인 상세 대신 팀 집계만 제공합니다 (근태·급여 열람 규칙)",
    anon: "전사 익명 집계만 제공합니다 (근태·급여 열람 규칙)",
    no: "급여·근태 상세는 본인과 HR만 열람할 수 있습니다 (근태·급여 열람 규칙)"
  };
  function gateHrOps(kind, ownerId) {
    var rel = relOf(ownerId), role = viewerRole();
    if (rel === "self") return "full";
    var row = HROPS_POLICY[kind] || HROPS_POLICY.attendance;
    if (role === "leader" && rel !== "team") return "no"; /* 팀 밖은 조직장도 차단 */
    return row[role] || "no";
  }

  function byPeriodDesc(a, b) { return String(b.period || "").localeCompare(String(a.period || "")); }
  function attOf(empId) { return arr("attendance").filter(function (a) { return a.emp_id === empId; }).sort(byPeriodDesc); }
  function payOf(empId) { return arr("payroll").filter(function (p) { return p.emp_id === empId; }).sort(byPeriodDesc); }
  function leaveOf(empId) { return arr("leaves").filter(function (l) { return l.emp_id === empId; })[0] || null; }
  function teamMembers(e) {
    return arr("employees").filter(function (x) { return x.org_id === e.org_id; });
  }
  function avg(list, f) {
    if (!list.length) return null;
    var s = 0, n = 0;
    for (var i = 0; i < list.length; i++) { var v = f(list[i]); if (v != null) { s += v; n++; } }
    return n ? Math.round(s * 10 / n) / 10 : null;
  }
  function attBrief(a) {
    return {
      period: a.period, partial: !!a.partial, work_days: a.work_days, actual_days: a.actual_days,
      leave_days: a.leave_days, overtime_hours: a.overtime_hours, late_count: a.late_count,
      early_leave_count: a.early_leave_count, remote_days: a.remote_days,
      avg_in_time: a.avg_in_time, avg_out_time: a.avg_out_time
    };
  }
  /* 근태 이상 신호 — 화면(tx_fix_att.js)과 AI가 같은 판정을 쓰도록 여기 단일 정의 */
  var OT_MONTH_LIMIT = 52; /* 주 12시간 연장 상한을 월로 환산(12h × 4.345주) */
  function attSignals(cur, prev, lv) {
    var out = [];
    if (!cur) return out;
    if (cur.overtime_hours >= OT_MONTH_LIMIT) {
      out.push({ code: "overtime_limit", level: "warn",
        text: "초과근로 " + cur.overtime_hours + "시간 — 월 환산 상한 " + OT_MONTH_LIMIT + "시간(주 12시간)에 도달했습니다" });
    } else if (prev && prev.overtime_hours >= 1 && cur.overtime_hours >= prev.overtime_hours * 1.5 && cur.overtime_hours >= 15) {
      out.push({ code: "overtime_spike", level: "warn",
        text: "초과근로 급증 — " + prev.period + " " + prev.overtime_hours + "시간 → " + cur.period + " " + cur.overtime_hours + "시간 (+" +
          Math.round((cur.overtime_hours / prev.overtime_hours - 1) * 100) + "%)" });
    }
    if (cur.late_count >= 3) {
      out.push({ code: "late_high", level: cur.late_count >= 5 ? "warn" : "info",
        text: "지각 " + cur.late_count + "회" + (prev ? " (전월 " + prev.late_count + "회)" : "") });
    } else if (prev && cur.late_count > prev.late_count && cur.late_count >= 2) {
      out.push({ code: "late_up", level: "info",
        text: "지각 증가 — 전월 " + prev.late_count + "회 → " + cur.late_count + "회" });
    }
    if (lv && lv.remaining_days != null && lv.remaining_days >= 10) {
      out.push({ code: "leave_expiring", level: "warn",
        text: "연차 잔여 " + lv.remaining_days + "일 — " + lv.expiring_at + " 소멸 예정 (연차사용촉진 대상)" });
    } else if (lv && lv.remaining_days != null && lv.remaining_days >= 5) {
      out.push({ code: "leave_left", level: "info",
        text: "연차 잔여 " + lv.remaining_days + "일 — " + lv.expiring_at + " 소멸 예정" });
    }
    return out;
  }
  /* 급여 전월 대비 변동 — 항목별 delta + payrollPolicy 근거 문장 */
  function payChanges(cur, prev, emp) {
    var pol = D().payrollPolicy || {};
    var out = [];
    if (!cur || !prev) return out;
    function add(item, key, reason) {
      var a = Number(prev[key] || 0), b = Number(cur[key] || 0);
      if (a === b) return;
      out.push({ item: item, prev: a, current: b, delta: b - a, reason: reason });
    }
    add("기본급", "base", "직급 기준 기본급 변동");
    add("직책수당", "position_allowance", "직책 부여·해제에 따른 수당 변동");
    if (Number(cur.overtime_pay || 0) !== Number(prev.overtime_pay || 0)) {
      out.push({
        item: "연장근로수당", prev: prev.overtime_pay, current: cur.overtime_pay,
        delta: cur.overtime_pay - prev.overtime_pay,
        reason: "연장근로 " + prev.overtime_hours + "시간 → " + cur.overtime_hours + "시간 · " +
          (pol.overtime_formula || "기본급 ÷ 209 × 1.5 × 연장근로시간")
      });
    }
    if (Number(cur.bonus || 0) !== Number(prev.bonus || 0)) {
      out.push({
        item: "성과급", prev: prev.bonus, current: cur.bonus, delta: cur.bonus - prev.bonus,
        reason: cur.bonus ? (cur.bonus_reason || "성과급 지급월") + " · " + (pol.bonus_rule || "")
          : "성과급 지급월(" + (pol.bonus_months || [6, 12]).join("·") + "월)이 아니어서 미지급"
      });
    }
    var dPrev = prev.deduction_total || 0, dCur = cur.deduction_total || 0;
    if (dPrev !== dCur) {
      out.push({
        item: "공제 합계", prev: dPrev, current: dCur, delta: dCur - dPrev,
        reason: "과세 대상 급여(지급 합계 − 비과세 식대 " + Number(cur.meal_allowance || 0).toLocaleString("en-US") + "원) 변동에 따라 " +
          (pol.tax_table_ref || "간이세액표") + " 기준 소득세·지방소득세와 4대보험료가 함께 조정됨"
      });
    }
    return out;
  }

  function krsOf(objectiveId) {
    return arr("keyResults").filter(function (k) { return k.objective_id === objectiveId; })
      .map(function (k) {
        return { kr_id: k.kr_id, name: k.name, target: k.target_value, current: k.current_value, weight: k.weight, progress: k.progress, status: k.status };
      });
  }

  /* ---------------- 이어받은 출발점(carry-over) 파생 ----------------
     evaluationsPrev(정본) 우선, 없으면 evalHistory/feedbackHistory/jobHistory에서
     런타임 파생. tx_fix_perf.js의 목표 생성 폼과 get_prev_cycle 도구가 공용. */
  function deriveCarry(empIdOrEmp) {
    var e = (empIdOrEmp && empIdOrEmp.emp_id) ? empIdOrEmp : (findEmp(empIdOrEmp) || CU());
    var out = { emp_id: e.emp_id, evaluation: null, undone_krs: [], feedback: [], job_change: null, first_cycle: false, derived: false };
    var prev = arr("evaluationsPrev").filter(function (x) { return x.emp_id === e.emp_id; })[0] || null;
    if (prev) {
      out.evaluation = { evaluation_id: prev.evaluation_id, period: prev.period, grade: prev.grade, score: prev.score, rationale_summary: prev.rationale_summary || "", krs: prev.krs || [] };
      out.undone_krs = (prev.krs || []).filter(function (k) { return !k.done; });
    } else {
      var hrec = arr("evalHistory").filter(function (h) { return h && h.emp_id === e.emp_id; })[0];
      var hist = (hrec && hrec.history) || [];
      var last = hist.length ? hist[hist.length - 1] : null;
      if (last) {
        out.evaluation = { evaluation_id: "EVAL-" + (last.period || "PREV") + "-" + e.emp_id, period: last.period, grade: last.grade, score: last.score, rationale_summary: "", krs: [] };
        out.derived = true;
      }
    }
    out.feedback = arr("feedbackHistory").filter(function (f) { return f.emp_id === e.emp_id; }).slice(0, 2);
    out.job_change = ((e.jobHistory || [])[0]) || null;
    out.first_cycle = !out.evaluation && !out.feedback.length && !out.job_change;
    return out;
  }

  /* ---------------- executors ---------------- */
  var EXEC = {

    search_employee: function (input) {
      var q = String(input.query || "").trim();
      var pool = arr("employees").filter(function (e) {
        return !q || (e.name || "").indexOf(q) >= 0 || (e.emp_id || "").indexOf(q) >= 0 ||
          (e.orgName || "").indexOf(q) >= 0 || (e.jobTitle || "").indexOf(q) >= 0;
      }).slice(0, 8).map(empBrief);
      return { count: pool.length, employees: pool };
    },

    get_employee_profile: function (input) {
      var e = findEmp(input.emp_id || input.name);
      if (!e) return { error: "직원을 찾을 수 없습니다: " + (input.emp_id || input.name || "") };
      var ev = arr("evaluations").filter(function (v) { return v.emp_id === e.emp_id; })[0] || null;
      var hist = (arr("evalHistory").filter(function (h) { return h.emp_id === e.emp_id; })[0] || {}).history || [];
      var sk = ((D().skills || {}).profiles || []).filter(function (s) { return s.emp_id === e.emp_id; })[0];
      var skills = null;
      if (sk) {
        skills = {};
        ((D().skills || {}).columns || []).forEach(function (c, i) { skills[c] = sk.prof[i]; });
      }
      /* 평가 초안·이력은 열람 규칙 통과분만 — full=전체 / summ=요약 / anon·no=비노출 */
      var evLv = gate("eval_draft", e.emp_id);
      var evOut = null;
      if (ev && evLv === "full") evOut = { period: ev.period, grade: ev.grade, weighted_score: ev.weighted_score, components: ev.components };
      else if (ev && evLv === "summ") evOut = { period: ev.period, grade: ev.grade, weighted_score: ev.weighted_score, note: "확정 후 공개 — 요약만 제공됩니다 (정책 v3.1)" };
      else if (ev) evOut = { policy: evLv === "anon" ? "등급 분포만 제공됩니다 (정책 v3.1)" : BLOCK_NOTE };
      var hiLv = gate("history", e.emp_id);
      var histOut = (hiLv === "full" || hiLv === "summ") ? hist
        : (hiLv === "anon" ? { count: hist.length, policy: POLICY_NOTE } : { policy: BLOCK_NOTE });
      return {
        profile: empBrief(e),
        tenure_years: e.tenure_years, join_date: e.join_date,
        evaluation: evOut,
        grade_history: histOut,
        skills: skills
      };
    },

    get_objectives: function (input) {
      var e = findEmp(input.emp_id || input.name) || CU();
      var lv = gate("goal_checkin", e.emp_id);
      if (lv === "no") return { blocked: true, policy: BLOCK_NOTE };
      if (lv === "anon") {
        var agOb = arr("objectives").filter(function (o) { return o.owner_emp_id === e.emp_id; });
        var agAvg = agOb.length ? Math.round(agOb.reduce(function (s, o) { return s + (o.progress || 0); }, 0) / agOb.length) : null;
        return { owner: { orgName: e.orgName }, count: agOb.length, avg_progress: agAvg, policy: POLICY_NOTE };
      }
      var objs = arr("objectives").filter(function (o) { return o.owner_emp_id === e.emp_id; })
        .map(function (o) {
          return {
            objective_id: o.objective_id, title: o.title, type: o.type, period: o.period,
            status: o.status, progress: o.progress, parent_objective_id: o.parent_objective_id,
            key_results: krsOf(o.objective_id)
          };
        });
      return { owner: empBrief(e), count: objs.length, objectives: objs };
    },

    get_checkins: function (input) {
      var e = findEmp(input.emp_id || input.name) || CU();
      var lv = gate("goal_checkin", e.emp_id);
      if (lv === "no") return { blocked: true, policy: BLOCK_NOTE };
      if (lv === "anon") {
        var agCs = arr("checkins").filter(function (c) { return c.emp_id === e.emp_id; });
        return { count: agCs.length, policy: POLICY_NOTE };
      }
      var limit = Math.min(Number(input.limit) || 10, 20);
      var cs = arr("checkins").filter(function (c) { return c.emp_id === e.emp_id; })
        .sort(function (a, b) { return (b.checkin_date || "").localeCompare(a.checkin_date || ""); })
        .slice(0, limit)
        .map(function (c) {
          return { date: c.checkin_date, kr_id: c.kr_id, progress: c.progress_snapshot, delta: c.progress_delta, confidence: c.confidence, comment: c.comment, blocker: c.blocker || null };
        });
      return { owner: empBrief(e), count: cs.length, checkins: cs };
    },

    get_team_status: function (input) {
      var mgr = findEmp(input.manager_emp_id || input.name) || CU();
      var team = arr("employees").filter(function (e) { return e.manager_id === mgr.emp_id; });
      if (!team.length) team = arr("employees").filter(function (e) { return e.org_id === mgr.org_id && e.emp_id !== mgr.emp_id; }).slice(0, 12);
      var rows = team.slice(0, 15).map(function (e) {
        var objs = arr("objectives").filter(function (o) { return o.owner_emp_id === e.emp_id; });
        var avg = objs.length ? Math.round(objs.reduce(function (s, o) { return s + (o.progress || 0); }, 0) / objs.length) : null;
        var last = arr("checkins").filter(function (c) { return c.emp_id === e.emp_id; })
          .sort(function (a, b) { return (b.checkin_date || "").localeCompare(a.checkin_date || ""); })[0];
        var ev = arr("evaluations").filter(function (v) { return v.emp_id === e.emp_id; })[0];
        var evLv = gate("eval_draft", e.emp_id); /* 등급 초안은 열람 규칙 통과분만 */
        return {
          emp_id: e.emp_id, name: e.name, jobTitle: e.jobTitle,
          objectives: objs.length, avg_progress: avg,
          last_checkin: last ? last.checkin_date : null,
          blocker: last && last.blocker ? last.blocker : null,
          grade_draft: (ev && (evLv === "full" || evLv === "summ")) ? ev.grade : null
        };
      });
      return { manager: empBrief(mgr), team_size: rows.length, members: rows };
    },

    get_org_overview: function () {
      var dist = {};
      arr("evaluations").forEach(function (v) { dist[v.grade] = (dist[v.grade] || 0) + 1; });
      var companyObjs = arr("objectives").filter(function (o) { return o.level === "company"; })
        .map(function (o) { return { title: o.title, progress: o.progress, status: o.status }; });
      var orgs = arr("orgs").filter(function (o) { return o.level === 2; })
        .map(function (o) { return { name: o.name, headcount: o.headcount }; });
      return {
        company: (D().company || {}).name,
        employees: arr("employees").length,
        grade_distribution: dist,
        company_objectives: companyObjs,
        divisions: orgs
      };
    },

    get_job_profile: function (input) {
      var e = findEmp(input.emp_id || input.name) || CU();
      var jp = (D().jobProfiles || {})[e.jobProfileId];
      if (!jp) return { error: "직무 프로파일 미연결: " + (e.name || e.emp_id) };
      var areas = Object.keys(jp.tasks || {}).map(function (a) {
        return { area: a, tasks: (jp.tasks[a] || []).slice(0, 5) };
      });
      /* 직무 기준 역량 상위 5 (역량 사전에서 이름 결합) */
      var compName = {};
      arr("competencies").forEach(function (c) { if (c && c.dimension_id) compName[c.dimension_id] = c.name; });
      var comps = (jp.competency_profile || []).slice(0, 5).map(function (c) {
        return { dimension_id: c.dimension_id, name: compName[c.dimension_id] || c.dimension_id, weight: c.weight };
      });
      /* 기대 스킬 상세 — skillDict 참조 시 분류(category) 포함 */
      var skillIdx = {};
      arr("skillDict").forEach(function (s) { if (s && s.skill_id) skillIdx[s.skill_id] = s; });
      var skillIds = jp.skill_ids || [];
      var skills = (jp.skills || []).slice(0, 15).map(function (n, i) {
        var rec = skillIds[i] ? skillIdx[skillIds[i]] : null;
        return { name: n, skill_id: skillIds[i] || null, category: (rec && rec.category) || null };
      });
      return {
        emp_id: e.emp_id, name: e.name, jobTitle: e.jobTitle,
        profile: {
          job_id: jp.job_id, title: jp.title, group: jp.group, series: jp.series,
          mission: jp.mission, task_areas: areas, skills: skills,
          competency_profile: comps
        }
      };
    },

    get_org_objectives: function (input) {
      /* 소속 조직 체인(팀→본부→전사)의 조직 목표 — 새 목표의 상위 목표 후보 */
      var e = findEmp(input.emp_id || input.name) || CU();
      var lv = gate("goal_checkin", e.emp_id);
      if (lv === "no") return { blocked: true, policy: BLOCK_NOTE };
      var orgIdx = {};
      arr("orgs").forEach(function (o) { orgIdx[o.org_id] = o; });
      var inChain = {}, cId = e.org_id, g = 0;
      while (cId && orgIdx[cId] && g++ < 20) { inChain[cId] = 1; cId = orgIdx[cId].parent_id; }
      var list = arr("objectives").filter(function (o) { return o.type !== "개인" && inChain[o.org_id]; })
        .map(function (o) {
          var topKr = arr("keyResults").filter(function (k) { return k.objective_id === o.objective_id; })[0];
          return {
            objective_id: o.objective_id, title: o.title,
            org_id: o.org_id, org_name: (orgIdx[o.org_id] || {}).name || null,
            level: o.level, period: o.period, status: o.status, progress: o.progress,
            strategy_theme_id: o.strategy_theme_id || null,
            top_kr: topKr ? { name: topKr.name, target: topKr.target_value } : null
          };
        });
      return {
        owner: empBrief(e), count: list.length, objectives: list,
        note: "새 목표의 parent_objective_id로 쓸 수 있는 조직 목표 목록입니다 (소속 조직 체인 기준)."
      };
    },

    get_prev_cycle: function (input) {
      /* 이어받은 출발점 — 전년 등급·평가 요지·미완 KR·피드백 요지·직무 변경 */
      var e = findEmp(input.emp_id || input.name) || CU();
      var lv = gate("history", e.emp_id);
      if (lv === "no") return { blocked: true, policy: BLOCK_NOTE };
      var c = deriveCarry(e);
      if (lv === "anon") return { owner: { orgName: e.orgName }, has_prev: !!c.evaluation, policy: POLICY_NOTE };
      if (c.first_cycle) return { owner: empBrief(e), first_cycle: true, note: "이전 사이클 기록이 없습니다 — 직무 기준(주요 과업·기대 스킬)을 출발점으로 설계하세요." };
      return {
        owner: empBrief(e), first_cycle: false, derived: c.derived,
        prev_evaluation: c.evaluation ? {
          evaluation_id: c.evaluation.evaluation_id, period: c.evaluation.period,
          grade: c.evaluation.grade, score: c.evaluation.score,
          rationale_summary: c.evaluation.rationale_summary || null
        } : null,
        undone_krs: c.undone_krs.map(function (k) { return { name: k.name, achievement_pct: k.achievement_pct }; }),
        feedback: c.feedback.map(function (f) { return { fb_id: f.fb_id, period: f.period, source_type: f.source_type, summary: f.summary }; }),
        job_change: c.job_change ? { prev_label: c.job_change.prev_label, new_label: c.job_change.new_label, period: c.job_change.period, note: c.job_change.note || null } : null
      };
    },

    get_strategy_themes: function () {
      var ts = arr("strategyThemes").map(function (t) {
        return { id: t.theme_id, title: t.name, description: t.description || null, kpis: t.kpis || [] };
      });
      return { count: ts.length, themes: ts };
    },

    get_upward_feedback: function (input) {
      /* 상향 피드백(구성원→조직장) — 매트릭스 하이라이트 행의 강제 지점.
         조직장 본인은 원문(raw) 대신 themes 집계만, 응답 3명 미만은 집계도 비공개. */
      var list = (D().upwardFeedback || []); /* 병렬 데이터 생성 중 — 방어적 접근 */
      var me = CU();
      var target = findEmp(input.leader_emp_id || input.name) || me;
      var rows = list.filter(function (f) { return f.leader_emp_id === target.emp_id; });
      if (!rows.length) return { count: 0, note: "해당 조직장에 대한 상향 피드백 기록이 없습니다." };
      var lv = gate("upward_feedback", target.emp_id);
      if (lv === "no") return { blocked: true, policy: "응답자 보호 정책에 따라 열람할 수 없습니다 (정책 v3.1)" };
      var min = (window.EZPolicy && EZPolicy.ANON_MIN) || 3;
      var items = rows.map(function (f) {
        if ((f.respondents || 0) < min) {
          return { uf_id: f.uf_id, period: f.period, note: "응답 인원이 적어 결과를 표시하지 않습니다 (익명 보호 · 최소 " + min + "명)" };
        }
        var r = { uf_id: f.uf_id, period: f.period, respondents: f.respondents, themes: f.themes || [] };
        if (lv === "full") r.raw = f.raw || [];
        else r.policy = POLICY_NOTE;
        return r;
      });
      return { leader: empBrief(target), count: items.length, items: items };
    },

    get_context_ledger: function (input) {
      /* 성과 히스토리 원장(EZLedger) 조회 — 타인 원장은 열람 규칙(history)대로 차단/집계 */
      var e = findEmp(input.emp_id || input.name) || CU();
      var self = e.emp_id === CU().emp_id;
      var lv = gate("history", e.emp_id);
      if (lv === "no") return { blocked: true, policy: BLOCK_NOTE };
      var list = [];
      if (self && window.EZLedger && EZLedger.list) {
        try { list = EZLedger.list() || []; } catch (e1) { list = []; }
      } else {
        /* 원장 모듈 미로드 또는 타인 원장 — localStorage 직접 읽기 (읽기 전용) */
        try {
          var raw = localStorage.getItem("elizax_ctx_v1:" + e.emp_id);
          var obj = raw ? JSON.parse(raw) : null;
          list = (obj && Object.prototype.toString.call(obj.items) === "[object Array]") ? obj.items.slice() : [];
          list.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
        } catch (e2) { list = []; }
      }
      var type = String(input.type || "").trim();
      if (type) list = list.filter(function (it) { return it && it.type === type; });
      if (lv === "anon") return { owner: { orgName: e.orgName }, count: list.length, policy: POLICY_NOTE };
      var limit = Math.min(Number(input.limit) || 8, 20);
      var out = list.slice(0, limit).map(function (it) {
        var row = { id: it.id, at: it.at, type: it.type, title: it.title, summary: it.summary, weight: it.weight, used_count: it.usedCount || 0 };
        if (lv === "full") row.source = it.source; /* summ은 출처 비노출 */
        return row;
      });
      return {
        owner: empBrief(e), total: list.length, count: out.length, level: lv, items: out,
        note: "근거로 실제 사용한 항목은 답변 끝에 [[ctx:ID1,ID2]] 마커로 인용하세요."
      };
    },

    simulate_whatif: function (input) {
      /* 읽기 전용 what-if — 정식 엔진(EZCalc.simulate) 우선, 없으면 evaluations 분포로 간단 계산 */
      var e = findEmp(input.emp_id || input.name) || CU();
      var lv = gate("eval_draft", e.emp_id);
      if (lv === "no" || lv === "anon") return { blocked: true, policy: lv === "anon" ? POLICY_NOTE : BLOCK_NOTE };
      var delta = Number(input.achievement_delta) || 0;
      var cap = (input.cap_pct == null || input.cap_pct === "") ? null : Number(input.cap_pct);
      if (window.EZCalc && EZCalc.simulate) {
        try {
          var p = { achievement_delta: delta };
          if (cap != null) p.cap_pct = cap;
          if (input.emp_id || input.name) p.emp_id = e.emp_id;
          var r = EZCalc.simulate(p);
          if (r && !r.error) { if (!r.engine) r.engine = "EZCalc"; return r; }
        } catch (e3) { /* 엔진 오류 → 폴백 */ }
      }
      var evs = arr("evaluations");
      var ev = evs.filter(function (v) { return v.emp_id === e.emp_id; })[0];
      if (!ev) return { error: "평가 데이터가 없습니다: " + (e.name || e.emp_id) };
      /* ponytail: 달성도 가중 40%·등급컷 S85/A75/B60 가정 — EZCalc.simulate 정식 엔진이 뜨면 그쪽이 우선 */
      var ACH_W = 0.4;
      function gradeOf(s) { return s >= 85 ? "S" : s >= 75 ? "A" : s >= 60 ? "B" : "C"; }
      var afterScore = Math.max(0, Math.min(100, Math.round((ev.weighted_score + delta * ACH_W) * 10) / 10));
      var dist = {}, top = 0;
      evs.forEach(function (v) { dist[v.grade] = (dist[v.grade] || 0) + 1; if (v.grade === "S" || v.grade === "A") top++; });
      var topPct = evs.length ? Math.round(top * 1000 / evs.length) / 10 : 0;
      var res = {
        engine: "fallback",
        target: { emp_id: e.emp_id, name: e.name },
        params: { achievement_delta: delta, cap_pct: cap },
        before: { weighted_score: ev.weighted_score, grade: ev.grade },
        after: { weighted_score: afterScore, grade: gradeOf(afterScore) },
        grade_changed: ev.grade !== gradeOf(afterScore),
        grade_distribution: dist,
        top_grade_pct: topPct,
        assumptions: "달성도 가중 40% · 등급 컷 S≥85/A≥75/B≥60 가정 · 읽기 전용 시뮬레이션 — 실제 데이터는 변경되지 않습니다"
      };
      if (cap != null) {
        res.cap_note = topPct > cap
          ? "현재 상위등급(S+A) 비율 " + topPct + "%가 상한 " + cap + "%를 초과 — 강제배분 시 상위등급 일부가 하향 조정될 수 있습니다"
          : "현재 상위등급(S+A) 비율 " + topPct + "%는 상한 " + cap + "% 이내입니다";
      }
      return res;
    },

    get_attendance: function (input) {
      /* 근태 요약 + 이상 신호 — 본인/HR은 개인 상세, 조직장은 팀 집계, 그 외 차단 */
      var e = findEmp(input.emp_id || input.name) || CU();
      var lv = gateHrOps("attendance", e.emp_id);
      if (lv === "no") return { blocked: true, policy: HROPS_NOTE.no };
      var rows = attOf(e.emp_id);
      if (!rows.length) return { error: "근태 기록이 없습니다: " + (e.name || e.emp_id) };
      if (lv === "summ" || lv === "anon") {
        var scope = (lv === "summ") ? teamMembers(e) : arr("employees");
        var ids = {};
        scope.forEach(function (x) { ids[x.emp_id] = 1; });
        /* 집계 기준월은 확정월(부분월 제외) 중 최신 — 일부 대상자만 있는 부분월로 집계하면 왜곡된다 */
        var scoped = arr("attendance").filter(function (a) { return ids[a.emp_id]; });
        var period = String(input.period || "");
        if (!period) {
          scoped.forEach(function (a) { if (!a.partial && a.period > period) period = a.period; });
        }
        var pool = scoped.filter(function (a) { return a.period === period; });
        return {
          scope: lv === "summ" ? (e.orgName || e.org_id) : ((D().company || {}).name || "전사"),
          period: period, headcount: pool.length,
          avg_overtime_hours: avg(pool, function (a) { return a.overtime_hours; }),
          avg_actual_days: avg(pool, function (a) { return a.actual_days; }),
          avg_remote_days: avg(pool, function (a) { return a.remote_days; }),
          late_total: pool.reduce(function (s, a) { return s + (a.late_count || 0); }, 0),
          over_limit_count: pool.filter(function (a) { return a.overtime_hours >= OT_MONTH_LIMIT; }).length,
          policy: HROPS_NOTE[lv],
          note: "개인별 근태 상세는 본인과 HR만 열람할 수 있습니다."
        };
      }
      var cur = input.period
        ? (rows.filter(function (a) { return a.period === String(input.period); })[0] || null)
        : rows[0];
      if (!cur) return { error: "해당 기간 근태 기록이 없습니다: " + input.period };
      var idx = rows.indexOf(cur);
      var prev = rows[idx + 1] || null;
      var lvRec = leaveOf(e.emp_id);
      return {
        owner: empBrief(e), as_of: (window.EZKit && EZKit.clock) ? EZKit.clock.asOfDate() : null,
        current: attBrief(cur),
        previous: prev ? attBrief(prev) : null,
        history: rows.slice(0, 4).map(attBrief),
        daily: (cur.daily || []).slice(0, 20),
        signals: attSignals(cur, prev, lvRec),
        source: "근태 원장(합성 데모 데이터) · 기준 " + cur.period + (cur.partial ? " (부분월 · " + cur.as_of + "까지)" : "")
      };
    },

    get_leave_balance: function (input) {
      /* 연차 잔여·소멸 예정·신청 이력 */
      var e = findEmp(input.emp_id || input.name) || CU();
      var lv = gateHrOps("leave", e.emp_id);
      if (lv === "no") return { blocked: true, policy: HROPS_NOTE.no };
      var rec = leaveOf(e.emp_id);
      if (!rec) return { error: "연차 기록이 없습니다: " + (e.name || e.emp_id) };
      if (lv === "summ" || lv === "anon") {
        var scope = (lv === "summ") ? teamMembers(e) : arr("employees");
        var ids = {};
        scope.forEach(function (x) { ids[x.emp_id] = 1; });
        var pool = arr("leaves").filter(function (l) { return ids[l.emp_id]; });
        return {
          scope: lv === "summ" ? (e.orgName || e.org_id) : ((D().company || {}).name || "전사"),
          year: rec.year, headcount: pool.length,
          avg_granted_days: avg(pool, function (l) { return l.granted_days; }),
          avg_used_days: avg(pool, function (l) { return l.used_days; }),
          avg_remaining_days: avg(pool, function (l) { return l.remaining_days; }),
          promotion_target_count: pool.filter(function (l) { return l.promotion_target; }).length,
          pending_requests: pool.reduce(function (s, l) {
            return s + (l.requests || []).filter(function (r) { return r.status === "대기"; }).length;
          }, 0),
          policy: HROPS_NOTE[lv]
        };
      }
      var reqs = rec.requests || [];
      var pending = reqs.filter(function (r) { return r.status === "대기"; });
      return {
        owner: empBrief(e), year: rec.year,
        granted_days: rec.granted_days, used_days: rec.used_days,
        remaining_days: rec.remaining_days,
        expiring_days: rec.expiring_days, expiring_at: rec.expiring_at,
        promotion_target: !!rec.promotion_target,
        pending_days: pending.reduce(function (s, r) { return s + (r.days || 0); }, 0),
        requests: reqs.slice(-8).map(function (r) {
          return { req_id: r.req_id, type: r.type, start: r.start, end: r.end, days: r.days, status: r.status, reason: r.reason };
        }),
        note: rec.promotion_target
          ? "잔여 " + rec.remaining_days + "일 — " + rec.expiring_at + " 소멸 예정이며 연차사용촉진(근로기준법 §61) 대상입니다."
          : "잔여 " + rec.remaining_days + "일은 " + rec.expiring_at + "에 소멸합니다.",
        source: "연차 대장(합성 데모 데이터)"
      };
    },

    get_payslip: function (input) {
      /* 급여 명세 + 전월 대비 변동 항목·사유(payrollPolicy 근거) */
      var e = findEmp(input.emp_id || input.name) || CU();
      var lv = gateHrOps("payroll", e.emp_id);
      if (lv !== "full") return { blocked: true, policy: HROPS_NOTE[lv] || HROPS_NOTE.no };
      var rows = payOf(e.emp_id);
      if (!rows.length) return { error: "급여 기록이 없습니다: " + (e.name || e.emp_id) };
      var cur = input.period
        ? (rows.filter(function (p) { return p.period === String(input.period); })[0] || null)
        : rows[0];
      if (!cur) {
        return { error: "해당 기간 급여 명세가 없습니다: " + input.period,
          available_periods: rows.map(function (p) { return p.period; }) };
      }
      var prev = rows[rows.indexOf(cur) + 1] || null;
      var pol = D().payrollPolicy || {};
      function slim(p) {
        return {
          period: p.period, pay_date: p.pay_date,
          base: p.base, position_allowance: p.position_allowance, meal_allowance: p.meal_allowance,
          overtime_pay: p.overtime_pay, overtime_hours: p.overtime_hours,
          bonus: p.bonus, bonus_reason: p.bonus_reason || null,
          gross: p.gross, deductions: p.deductions, deduction_total: p.deduction_total, net: p.net
        };
      }
      return {
        owner: empBrief(e), current: slim(cur), previous: prev ? slim(prev) : null,
        net_delta: prev ? cur.net - prev.net : null,
        gross_delta: prev ? cur.gross - prev.gross : null,
        changes: payChanges(cur, prev, e),
        available_periods: rows.map(function (p) { return p.period; }),
        policy: {
          pay_day: pol.pay_day, overtime_rate: pol.overtime_rate, night_rate: pol.night_rate,
          bonus_months: pol.bonus_months, bonus_rule: pol.bonus_rule,
          overtime_formula: pol.overtime_formula, tax_table_ref: pol.tax_table_ref,
          nontaxable: pol.nontaxable
        },
        note: "금액은 데모용 합성 데이터입니다. 변동 사유는 payrollPolicy 규칙을 근거로 설명하세요.",
        source: "급여 원장 + 급여 계산 규칙(payrollPolicy)"
      };
    },

    get_screen_context: function () {
      var label = "홈";
      try {
        var sec = document.querySelector("section.screen.on");
        var map = { "s-home": "홈", "s-perf": "성과관리", "s-appr": "평가관리", "s-msf": "360진단", "s-work": "업무관리", "s-att": "근무관리", "s-hrm": "인사관리", "s-pay": "급여관리", "s-wf": "승인결재" };
        if (sec) {
          label = map[sec.id] || "홈";
          var tab = sec.querySelector(".subnav a.on");
          if (tab) label += " › " + tab.textContent.trim();
        }
      } catch (e) { /* ignore */ }
      var role = null;
      try { role = window.TXRoles && TXRoles.current && TXRoles.current().label; } catch (e) { /* ignore */ }
      return { screen: label, role: role, current_user: empBrief(CU()) };
    },

    navigate: function (input) {
      var s = String(input.section || "");
      var p = (input.tab == null || input.tab === "") ? null : Number(input.tab);
      var ok = false, label = s;
      try {
        if (window.EZNav && window.EZNav.go) ok = window.EZNav.go(s, p);
        if (window.EZNav && window.EZNav.labelOf) label = window.EZNav.labelOf(s, p) || s;
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
      return { ok: ok, moved_to: label };
    }
  };

  /* ---------------- Anthropic tool schemas ---------------- */
  var SCHEMAS = [
    { name: "search_employee", description: "이름·사번·조직명·직무로 직원을 검색한다. 결과 최대 8명.",
      input_schema: { type: "object", properties: { query: { type: "string", description: "검색어 (이름/사번/조직/직무)" } }, required: ["query"] } },
    { name: "get_employee_profile", description: "직원 1명의 프로필·평가등급·등급 이력·역량 프로파일을 조회한다.",
      input_schema: { type: "object", properties: { emp_id: { type: "string" }, name: { type: "string" } } } },
    { name: "get_objectives", description: "직원의 목표(OKR)와 KR(목표치·현재치·가중치·진척)을 조회한다. emp_id 생략 시 현재 사용자.",
      input_schema: { type: "object", properties: { emp_id: { type: "string" }, name: { type: "string" } } } },
    { name: "get_checkins", description: "직원의 최근 체크인 기록(날짜·진척 변화·코멘트·장애요인)을 조회한다. emp_id 생략 시 현재 사용자.",
      input_schema: { type: "object", properties: { emp_id: { type: "string" }, name: { type: "string" }, limit: { type: "number", description: "최대 20" } } } },
    { name: "get_team_status", description: "리더의 팀원별 목표 수·평균 진척·마지막 체크인·장애요인·등급 초안을 요약한다.",
      input_schema: { type: "object", properties: { manager_emp_id: { type: "string" }, name: { type: "string" } } } },
    { name: "get_org_overview", description: "전사 개요: 등급 분포·전사 목표 진척·본부 목록.",
      input_schema: { type: "object", properties: {} } },
    { name: "get_job_profile", description: "직원의 직무 프로파일을 조회한다: 미션·주요 과업(task_areas)·기대 스킬(skill_id·분류 포함)·직무 기준 역량 프로파일(competency_profile: dimension_id·name·weight). 목표/KR 추천 시 KR의 job_task_ref(과업)·competency_id(역량) 근거로 사용. emp_id 생략 시 현재 사용자.",
      input_schema: { type: "object", properties: { emp_id: { type: "string" }, name: { type: "string" } } } },
    { name: "get_org_objectives", description: "직원이 속한 조직 체인(팀→본부→전사)의 조직 목표 목록을 조회한다. 새 목표의 상위 목표(parent_objective_id) 후보와 정렬 근거로 사용. objective_id·title·org_name·strategy_theme_id·대표 KR을 반환. emp_id 생략 시 현재 사용자.",
      input_schema: { type: "object", properties: { emp_id: { type: "string" }, name: { type: "string" } } } },
    { name: "get_prev_cycle", description: "이어받은 출발점 — 직전 사이클의 평가 등급·평가 요지, 미완 KR(달성률), 최근 피드백 요지, 직무 변경 이력을 조회한다. 새 목표 초안이 지난 사이클을 계승하도록 하는 근거. 기록이 없으면 first_cycle:true. emp_id 생략 시 현재 사용자.",
      input_schema: { type: "object", properties: { emp_id: { type: "string" }, name: { type: "string" } } } },
    { name: "get_strategy_themes", description: "전사 전략 테마와 KPI 목록을 조회한다. 목표가 어떤 전략에 기여하는지(strategy_theme_id) 판단하는 근거로 사용.",
      input_schema: { type: "object", properties: {} } },
    { name: "get_upward_feedback", description: "조직장에 대한 상향 피드백(구성원→조직장)을 조회한다. 응답자 보호: 조직장 본인은 익명 집계(themes)만, 응답 3명 미만은 집계도 비공개. leader_emp_id 생략 시 현재 사용자.",
      input_schema: { type: "object", properties: { leader_emp_id: { type: "string" }, name: { type: "string" } } } },
    { name: "get_context_ledger", description: "성과 기록(맥락 원장) 항목을 조회한다. 목표·체크인·1on1·피드백·평가이력·조직/직무 기준·규칙 등 사용자가 기능을 쓰며 축적한 맥락. 반환된 항목 id는 답변 끝 [[ctx:ID1,ID2]] 인용 마커에 사용. emp_id 생략 시 현재 사용자 — 타인 원장은 열람 규칙에 따라 요약/집계만.",
      input_schema: { type: "object", properties: { emp_id: { type: "string" }, type: { type: "string", description: "유형 필터: goal/checkin/oneonone/feedback/eval/org/job/rule" }, limit: { type: "number", description: "최근 N건 (기본 8, 최대 20)" } } } },
    { name: "simulate_whatif", description: "읽기 전용 what-if 시뮬레이션: 달성률 변화(achievement_delta, %p)나 강제배분 상한(cap_pct, %)을 가정했을 때 등급·종합점수·분포 변화를 실계산한다. 실제 데이터는 변경하지 않는다. 예: '달성률이 -10%p면 등급이 어떻게 되나'.",
      input_schema: { type: "object", properties: { achievement_delta: { type: "number", description: "달성률 변화 가정 (%p, 예: -10)" }, cap_pct: { type: "number", description: "상위등급(S+A) 강제배분 상한 % (예: 30)" }, emp_id: { type: "string", description: "대상 직원 (생략 시 현재 사용자)" } } } },
    { name: "get_attendance", description: "근태 기록을 조회한다: 월 요약(소정근로일·실근무일·휴가일·초과근로시간·지각·조퇴·재택일수·평균 출퇴근시각), 전월 대비, 최근 4주 일별(있는 경우), 그리고 이상 신호(초과근로 상한 도달·급증, 지각 증가, 연차 소멸 임박). period 생략 시 최신 기간. 열람 규칙: 본인·HR은 개인 상세, 조직장은 팀 집계만, 그 외 차단.",
      input_schema: { type: "object", properties: { emp_id: { type: "string" }, name: { type: "string" }, period: { type: "string", description: "YYYY-MM (예: 2026-06). 생략 시 최신" } } } },
    { name: "get_leave_balance", description: "연차 현황을 조회한다: 부여일수·사용일수·잔여일수·소멸 예정일수와 소멸일, 연차사용촉진 대상 여부, 신청 이력(연차/반차/병가/경조 · 승인/대기/반려). 열람 규칙: 본인·HR은 개인 상세, 조직장은 팀 집계만, 그 외 차단.",
      input_schema: { type: "object", properties: { emp_id: { type: "string" }, name: { type: "string" } } } },
    { name: "get_payslip", description: "급여 명세를 조회한다: 지급 항목(기본급·직책수당·식대·연장근로수당·성과급)·공제 항목(소득세·지방소득세·국민연금·건강보험·고용보험·장기요양)·실지급액, 그리고 전월 대비 변동 항목과 사유(성과급 지급월, 연장근로 증감 등)를 급여 계산 규칙(payrollPolicy)과 함께 반환한다. period 생략 시 최신. 열람 규칙: 급여 상세는 본인과 HR만 — 조직장·경영진은 차단.",
      input_schema: { type: "object", properties: { emp_id: { type: "string" }, name: { type: "string" }, period: { type: "string", description: "YYYY-MM (예: 2026-06). 생략 시 최신" } } } },
    { name: "get_screen_context", description: "사용자가 지금 보고 있는 talenx 화면·역할·현재 사용자 정보.",
      input_schema: { type: "object", properties: {} } },
    { name: "navigate", description: "talenx 화면을 전환한다. section: home/work/perf/msf/appr/pay/att/hrm/wf. tab은 서브탭 인덱스(없으면 null). perf: 0목표 1피드백 2미팅 3리뷰 · appr: 0매트릭스 1인재리뷰 · work: 0업무 1스크럼 · pay: 0급여 1연말정산 · att: 0내근무 1내휴가 2구성원근무 3구성원휴가 4스케줄 5위치 6연차촉진 · hrm: 0사용자 1구성원 2인재검색 3인원현황 · wf: 0받은 1보낸 2서명",
      input_schema: { type: "object", properties: { section: { type: "string" }, tab: { type: ["number", "null"] } }, required: ["section"] } }
  ];

  /* 도구 결과를 사람이 읽을 짧은 요약으로 (작업중 카드 표기용) */
  function summarize(name, result) {
    try {
      if (result && result.error) return "⚠ " + result.error;
      if (result && result.blocked) return "🔒 열람 규칙으로 차단됨";
      switch (name) {
        case "search_employee": return result.count + "명 검색됨";
        case "get_employee_profile": return result.profile.name + " · " + (result.evaluation && result.evaluation.grade ? result.evaluation.grade + " (" + result.evaluation.weighted_score + ")" : "평가 비노출/없음");
        case "get_objectives": return result.owner && result.owner.name ? result.owner.name + " 목표 " + result.count + "건" : "목표 " + result.count + "건 · 집계만";
        case "get_checkins": return result.owner ? result.owner.name + " 체크인 " + result.count + "건" : "체크인 " + result.count + "건 · 집계만";
        case "get_upward_feedback": return result.count ? "상향 피드백 " + result.count + "건 · 익명 보호 적용" : "상향 피드백 없음";
        case "get_team_status": return "팀원 " + result.team_size + "명 요약";
        case "get_org_overview": return "전사 " + result.employees + "명 · 등급분포 산출";
        case "get_job_profile": return "직무 프로파일 · " + result.profile.title;
        case "get_org_objectives": return "상위 목표 후보 " + result.count + "건 (조직 체인)";
        case "get_prev_cycle": return result.first_cycle ? "이전 사이클 기록 없음 — 첫 사이클"
          : "이어받은 출발점 · " + ((result.prev_evaluation && result.prev_evaluation.grade) || "등급 없음")
            + " · 미완 KR " + ((result.undone_krs || []).length) + "건";
        case "get_strategy_themes": return "전략 테마 " + result.count + "건";
        case "get_context_ledger": return result.items ? "성과 기록 " + result.count + "건 조회" : "성과 기록 " + result.count + "건 · 집계만";
        case "simulate_whatif": return result.after ? "시뮬 " + result.before.grade + " → " + result.after.grade + " (" + result.after.weighted_score + "점)" : "시뮬레이션 완료";
        case "get_attendance": return result.current
          ? (result.current.period + " 근태 · 초과 " + result.current.overtime_hours + "h · 신호 " + (result.signals || []).length + "건")
          : (result.scope + " 근태 집계 " + result.headcount + "명 · " + result.period);
        case "get_leave_balance": return result.remaining_days != null
          ? ("연차 잔여 " + result.remaining_days + "일 / " + result.granted_days + "일")
          : (result.scope + " 연차 집계 " + result.headcount + "명");
        case "get_payslip": return result.current
          ? (result.current.period + " 급여 · 실지급 " + Number(result.current.net).toLocaleString("en-US") + "원" +
            (result.net_delta ? " (전월 대비 " + (result.net_delta > 0 ? "+" : "") + Number(result.net_delta).toLocaleString("en-US") + ")" : ""))
          : "급여 명세 조회";
        case "get_screen_context": return result.screen;
        case "navigate": return result.ok ? result.moved_to + " 이동" : "이동 실패";
      }
    } catch (e) { /* ignore */ }
    return "완료";
  }

  var SRC_OF = {
    search_employee: "talenx", get_employee_profile: "talenx", get_objectives: "talenx",
    get_checkins: "ERP", get_team_status: "talenx", get_org_overview: "통계",
    get_screen_context: "맥락", navigate: "화면", get_job_profile: "talenx",
    get_upward_feedback: "talenx", get_context_ledger: "원장", simulate_whatif: "시뮬",
    get_org_objectives: "talenx", get_prev_cycle: "talenx", get_strategy_themes: "전략",
    get_attendance: "ERP", get_leave_balance: "ERP", get_payslip: "ERP"
  };
  var LABEL_OF = {
    search_employee: "직원 검색", get_employee_profile: "프로필·평가 조회", get_objectives: "목표·KR 조회",
    get_checkins: "체크인 기록 대조", get_team_status: "팀 현황 요약", get_org_overview: "전사 분포 스캔",
    get_screen_context: "현재 화면 확인", navigate: "화면 전환", get_job_profile: "직무 프로파일 조회",
    get_upward_feedback: "상향 피드백 조회 (익명 보호)",
    get_context_ledger: "성과 기록 조회", simulate_whatif: "What-if 시뮬레이션 (읽기 전용)",
    get_org_objectives: "상위 목표 후보 조회", get_prev_cycle: "이어받은 출발점 조회",
    get_strategy_themes: "전략 테마·KPI 조회",
    get_attendance: "근태 요약·이상 신호 조회", get_leave_balance: "연차 잔여·신청 이력 조회",
    get_payslip: "급여 명세·전월 대비 조회"
  };

  window.EZTools = {
    schemas: SCHEMAS,
    /* 이어받은 출발점 런타임 파생 — tx_fix_perf.js 목표 생성 폼과 공용 (F3) */
    deriveCarry: deriveCarry,
    /* 근태·급여 판정 단일 정의 — 화면(tx_fix_att/tx_fix_pay)이 AI와 같은 규칙을 쓴다 */
    hrOps: { signals: attSignals, changes: payChanges, gate: gateHrOps, otLimit: OT_MONTH_LIMIT },
    run: function (name, input) {
      var fn = EXEC[name];
      if (!fn) return { error: "unknown tool: " + name };
      try { return fn(input || {}); }
      catch (e) { return { error: String(e && e.message || e) }; }
    },
    summarize: summarize,
    srcOf: function (n) { return SRC_OF[n] || "talenx"; },
    labelOf: function (n) { return LABEL_OF[n] || n; }
  };
})();
