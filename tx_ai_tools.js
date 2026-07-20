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
  function krsOf(objectiveId) {
    return arr("keyResults").filter(function (k) { return k.objective_id === objectiveId; })
      .map(function (k) {
        return { kr_id: k.kr_id, name: k.name, target: k.target_value, current: k.current_value, weight: k.weight, progress: k.progress, status: k.status };
      });
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
      return {
        profile: empBrief(e),
        tenure_years: e.tenure_years, join_date: e.join_date,
        evaluation: ev ? { period: ev.period, grade: ev.grade, weighted_score: ev.weighted_score, components: ev.components } : null,
        grade_history: hist,
        skills: skills
      };
    },

    get_objectives: function (input) {
      var e = findEmp(input.emp_id || input.name) || CU();
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
        return {
          emp_id: e.emp_id, name: e.name, jobTitle: e.jobTitle,
          objectives: objs.length, avg_progress: avg,
          last_checkin: last ? last.checkin_date : null,
          blocker: last && last.blocker ? last.blocker : null,
          grade_draft: ev ? ev.grade : null
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
      return {
        emp_id: e.emp_id, name: e.name, jobTitle: e.jobTitle,
        profile: {
          job_id: jp.job_id, title: jp.title, group: jp.group, series: jp.series,
          mission: jp.mission, task_areas: areas, skills: (jp.skills || []).slice(0, 15)
        }
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
    { name: "get_checkins", description: "직원의 최근 체크인 기록(날짜·진척 변화·코멘트·블로커)을 조회한다. emp_id 생략 시 현재 사용자.",
      input_schema: { type: "object", properties: { emp_id: { type: "string" }, name: { type: "string" }, limit: { type: "number", description: "최대 20" } } } },
    { name: "get_team_status", description: "리더의 팀원별 목표 수·평균 진척·마지막 체크인·블로커·등급 초안을 요약한다.",
      input_schema: { type: "object", properties: { manager_emp_id: { type: "string" }, name: { type: "string" } } } },
    { name: "get_org_overview", description: "전사 개요: 등급 분포·전사 목표 진척·본부 목록.",
      input_schema: { type: "object", properties: {} } },
    { name: "get_job_profile", description: "직원의 직무 프로파일(미션·주요 과업·기대 스킬)을 조회한다. 목표/KR 추천의 직무 근거로 사용. emp_id 생략 시 현재 사용자.",
      input_schema: { type: "object", properties: { emp_id: { type: "string" }, name: { type: "string" } } } },
    { name: "get_screen_context", description: "사용자가 지금 보고 있는 talenx 화면·역할·현재 사용자 정보.",
      input_schema: { type: "object", properties: {} } },
    { name: "navigate", description: "talenx 화면을 전환한다. section: home/work/perf/msf/appr/pay/att/hrm/wf. tab은 서브탭 인덱스(없으면 null). perf: 0목표 1피드백 2미팅 3리뷰 · appr: 0매트릭스 1인재리뷰 · work: 0업무 1스크럼 · pay: 0급여 1연말정산 · att: 0내근무 1내휴가 2구성원근무 3구성원휴가 4스케줄 5위치 6연차촉진 · hrm: 0사용자 1구성원 2인재검색 3인원현황 · wf: 0받은 1보낸 2서명",
      input_schema: { type: "object", properties: { section: { type: "string" }, tab: { type: ["number", "null"] } }, required: ["section"] } }
  ];

  /* 도구 결과를 사람이 읽을 짧은 요약으로 (작업중 카드 표기용) */
  function summarize(name, result) {
    try {
      if (result && result.error) return "⚠ " + result.error;
      switch (name) {
        case "search_employee": return result.count + "명 검색됨";
        case "get_employee_profile": return result.profile.name + " · " + (result.evaluation ? result.evaluation.grade + " (" + result.evaluation.weighted_score + ")" : "평가 없음");
        case "get_objectives": return result.owner.name + " 목표 " + result.count + "건";
        case "get_checkins": return result.owner.name + " 체크인 " + result.count + "건";
        case "get_team_status": return "팀원 " + result.team_size + "명 요약";
        case "get_org_overview": return "전사 " + result.employees + "명 · 등급분포 산출";
        case "get_job_profile": return "직무 프로파일 · " + result.profile.title;
        case "get_screen_context": return result.screen;
        case "navigate": return result.ok ? result.moved_to + " 이동" : "이동 실패";
      }
    } catch (e) { /* ignore */ }
    return "완료";
  }

  var SRC_OF = {
    search_employee: "talenx", get_employee_profile: "talenx", get_objectives: "talenx",
    get_checkins: "ERP", get_team_status: "talenx", get_org_overview: "통계",
    get_screen_context: "맥락", navigate: "화면", get_job_profile: "talenx"
  };
  var LABEL_OF = {
    search_employee: "직원 검색", get_employee_profile: "프로필·평가 조회", get_objectives: "목표·KR 조회",
    get_checkins: "체크인 기록 대조", get_team_status: "팀 현황 요약", get_org_overview: "전사 분포 스캔",
    get_screen_context: "현재 화면 확인", navigate: "화면 전환", get_job_profile: "직무 프로파일 조회"
  };

  window.EZTools = {
    schemas: SCHEMAS,
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
