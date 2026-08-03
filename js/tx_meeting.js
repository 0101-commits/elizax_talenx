/* ============================================================================
 * tx_meeting.js — 로드맵 6: 목표 검토 회의 모드 (window.EZMeeting)
 * ----------------------------------------------------------------------------
 * 대상: 조직장(leader) 전용. Pain 군집 "목표 검토 회의 운영" 커버 —
 *   회의 전 쟁점 자동 추출 → 팀 목표 대비 개인 목표 대조 → 회의 중 합의 기록
 *   → 회의 후 개인별 전달(ez:ctx 발행) + 반영 추적.
 * 원칙: 회의 기록은 제안·기록만 — 원본 목표(TALENX_DATA)는 절대 수정하지 않음.
 * 진입: #s-perf 목표 탭 헤더 "검토 회의" 버튼 / window.EZMeeting.open().
 * 저장: localStorage "ezmt_v1:<emp_id>" (합의·추적 상태만 — 구 sessionStorage
 *       값은 최초 로드 시 1회 이관). 개인별 전달은 ez:ctx detail.emp_id로
 *       수신자 원장에 라우팅(tx_ctx_ledger 계약).
 * 가시성: 회의 화면 자체는 조직장 전용(게이트 유지). 다만 전달된 합의는 각 팀원
 *       본인의 성과 기록(원장)에 사람이 읽는 제목("목표 검토 회의 합의 — <KR명>")
 *       으로 저장되어 팀원이 자기 화면에서 확인한다 — ③ 단계에 이 경로를 안내한다.
 * 중복 후보: 불용어 보강 + 유의미 토큰(3자 이상) 조건 + 상위 8건 상한 + 토큰
 *       역색인으로 좁힌 비교. 판정 근거(겹친 토큰)는 칩으로 노출한다.
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
  /* 기록 시각 — 기준 시점은 EZKit 단일 발급(하드코딩 드리프트 금지) */
  function stamp() {
    try { if (window.EZKit && EZKit.clock) return EZKit.clock.asOf(); } catch (e) { /* 미로드 */ }
    return "2026-07-16 06:00";
  }
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
  function shortHash(s) {
    var h = 0, i;
    s = String(s || "");
    for (i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return (h >>> 0).toString(36);
  }
  function collectIssues(m) {
    var out = [];
    function push(objTitle, krName, tag, tip, sev) {
      /* ID = emp + 내용 해시 — 순번 시프트로 인한 합의 기록 오매칭 방지 */
      out.push({ id: m.emp.emp_id + "-" + shortHash((krName || objTitle || "") + "|" + tag),
                 emp_id: m.emp.emp_id, empName: m.emp.name,
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

  /* 중복 후보 — 팀원 간 핵심 성과 명칭 토큰 겹침.
     팀이 커질수록 오탐이 급증하던 문제를 3가지로 완화한다.
       (1) 불용어 보강 — 성과 문장에 관용적으로 붙는 일반어는 겹쳐도 근거가 아니다
       (2) 유의미 토큰 조건 — 3자 이상 토큰이 하나는 겹치거나, 2자 토큰이 3개 이상 겹쳐야 후보
       (3) 상한 — 겹침 강도(토큰 길이 합) 순으로 상위 MAX_DUP건만 노출
     비교 자체도 토큰 역색인으로 좁혀 전수 O(n²) 비교를 피한다. */
  var STOP = {
    /* 상태·정도 */
    "달성": 1, "이상": 1, "이하": 1, "미만": 1, "초과": 1, "완료": 1, "유지": 1, "확보": 1,
    "향상": 1, "개선": 1, "강화": 1, "제고": 1, "증대": 1, "감소": 1, "단축": 1, "확대": 1,
    /* 성과관리 관용어 */
    "목표": 1, "실적": 1, "성과": 1, "지표": 1, "결과": 1, "수준": 1, "기준": 1, "대비": 1,
    "이내": 1, "이후": 1, "관련": 1, "전체": 1, "신규": 1, "기존": 1, "주요": 1, "정기": 1,
    /* 단위·수량 */
    "건수": 1, "건당": 1, "회수": 1, "횟수": 1, "비율": 1, "이율": 1, "점수": 1, "인원": 1,
    /* 업무 일반 */
    "업무": 1, "과제": 1, "활동": 1, "운영": 1, "관리": 1, "수행": 1, "추진": 1, "진행": 1,
    "체계": 1, "방안": 1, "계획": 1, "검토": 1, "지원": 1, "대응": 1
  };
  var MIN_OVERLAP = 2;   /* 최소 겹침 토큰 수 */
  var STRONG_LEN = 3;    /* 이 길이 이상이면 '유의미한' 토큰 */
  var MAX_DUP = 8;       /* 노출 상한 */

  function tokens(s) {
    var seen = {}, out = [];
    String(s || "").split(/[^가-힣A-Za-z0-9]+/).forEach(function (t) {
      if (t.length < 2 || STOP[t] || /^\d+$/.test(t) || seen[t]) return;
      seen[t] = 1; out.push(t);
    });
    return out;
  }
  function dupCandidates(members) {
    var list = [], index = {}, pairs = {}, rows = [];
    members.forEach(function (m) {
      m.objs.forEach(function (o) {
        o.krs.forEach(function (k) { list.push({ emp: m.emp, name: k.name, tk: tokens(k.name) }); });
      });
    });
    /* 토큰 역색인 — 토큰을 공유하는 쌍만 실제로 비교한다 */
    list.forEach(function (e, i) {
      e.tk.forEach(function (t) { (index[t] = index[t] || []).push(i); });
    });
    Object.keys(index).forEach(function (t) {
      var ids = index[t];
      if (ids.length < 2 || ids.length > 40) return; /* 너무 흔한 토큰은 근거가 못 된다 */
      for (var x = 0; x < ids.length; x++) for (var y = x + 1; y < ids.length; y++) {
        var i = ids[x], j = ids[y];
        if (list[i].emp.emp_id === list[j].emp.emp_id) continue;
        (pairs[i + ":" + j] = pairs[i + ":" + j] || []).push(t);
      }
    });
    Object.keys(pairs).forEach(function (key) {
      var hit = pairs[key], p = key.split(":");
      if (hit.length < MIN_OVERLAP) return;
      var strong = hit.filter(function (t) { return t.length >= STRONG_LEN; });
      if (!strong.length && hit.length < 3) return;  /* 짧은 토큰만 2개 겹친 건 오탐으로 본다 */
      var score = hit.reduce(function (a, t) { return a + t.length; }, 0);
      rows.push({ a: list[+p[0]], b: list[+p[1]], common: hit, strong: strong.length, score: score });
    });
    rows.sort(function (a, b) { return b.score - a.score; });
    var shown = rows.slice(0, MAX_DUP);
    shown.total = rows.length;   /* 상한에 걸려 가려진 건수를 화면에서 밝히기 위해 보존 */
    return shown;
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
     2. 합의 기록 상태 (localStorage 영속 — 원본 목표 비수정)
     ============================================================ */
  function loadAgs() {
    try {
      var v = localStorage.getItem(LS_KEY);
      if (v == null) v = sessionStorage.getItem(LS_KEY); /* 구버전(session) 1회 이관 */
      return JSON.parse(v || "[]");
    } catch (e) { return []; }
  }
  function saveAgs(a) { try { localStorage.setItem(LS_KEY, JSON.stringify(a)); } catch (e) { /* 무해화 */ } }

  var S = { step: 1, memberIdx: 0, model: null, ags: [], ai: null, prefill: null };

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
      /* §9(PLAN-19) — 이 화면은 elizax의 독립 오버레이(talenx 화면에 끼워지지 않음)라 대부분
         카드는 이미 elizax 도구임이 분명하다. 유일하게 헷갈리는 지점은 "✦ 쟁점 요약 초안" 카드 —
         나머지 표·리스트와 같은 흰 카드라 AI가 만든 문장인지 사람이 적은 것인지 구분이 안 된다.
         좌측 레일 + 옅은 틴트로 이 카드만 표시(.ez_kit.css의 .ezsurf와 같은 시각 언어, 이 파일은
         토큰 없이 자체 hex 팔레트로 짜여 있어 같은 팔레트(#1F7AF0)로 재현) */
      ".ezmt-ai-card{position:relative;padding-left:18px;background:#F3F8FF;border-color:#BFDBFE}" +
      ".ezmt-ai-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;border-radius:12px 0 0 12px;background:#1F7AF0}" +
      ".ezmt-btn.ghost{background:#fff;border:1px solid #E3E8F0;color:#48505E}" +
      ".ezmt-btn:disabled{opacity:.45;cursor:default}" +
      ".ezmt-st{display:inline-block;border-radius:12px;padding:2px 10px;font-size:11.5px;font-weight:700}" +
      ".ezmt-st.s1{background:#EFF6FF;color:#1D4ED8}.ezmt-st.s2{background:#FFF4E5;color:#B45309}.ezmt-st.s3{background:#EFFAF3;color:#15803D}" +
      ".ezmt-gate{color:#6B7280;font-size:12px;margin:4px 0 0;display:flex;align-items:center;gap:6px}" +
      ".ezmt-empty{color:#6B7280;font-size:13px;padding:14px 0}" +
      ".ezmt-spin{display:inline-block;width:12px;height:12px;border:2px solid #C7DCFB;border-top-color:#1F7AF0;border-radius:50%;animation:ezmtSpin .8s linear infinite;vertical-align:-2px}" +
      "@keyframes ezmtSpin{to{transform:rotate(360deg)}}" +
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
          /* 판정 근거를 칩으로 노출 — 어떤 토큰이 겹쳐서 후보가 됐는지 사람이 바로 검증한다 */
          var chips = d.common.map(function (t) {
            return '<span class="ezmt-chip' + (t.length >= 3 ? " tt" : "") + '">' + esc(t) + "</span>";
          }).join("");
          return '<div class="ezmt-irow"><span class="ezmt-tag warn">중복 후보</span>' +
            "<b>" + esc(d.a.emp.name) + "</b> · " + esc(d.a.name) + " ↔ <b>" + esc(d.b.emp.name) + "</b> · " + esc(d.b.name) +
            '<div class="tip">겹친 토큰 ' + d.common.length + "개" +
            (d.strong ? " (유의미 " + d.strong + "개)" : "") + " — 역할 분담 또는 통합을 합의하세요</div>" +
            '<div style="margin-top:4px">' + chips + "</div></div>";
        }).join("") +
        (M.dups.total > M.dups.length
          ? '<div class="ezmt-gate">겹침이 강한 순으로 ' + M.dups.length + "건만 표시했습니다 — 전체 " + M.dups.total + "건</div>"
          : "")
      : '<div class="ezmt-empty">중복 후보가 없습니다 — 팀원 간 핵심 성과 명칭에서 유의미하게 겹치는 표현을 찾지 못했습니다.</div>';
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
      "<h3 style='margin:4px 2px 10px;font-size:14px'>팀원별 쟁점 카드</h3>" + cards +
      renderAiCard();
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

  /* 합의 1건을 사람이 읽는 한 줄로 — 원장 제목·추적 행 공용 */
  function agLabel(a) {
    if (a.kr) return a.kr;
    var parts = String(a.issue || "").split(" · ");
    return parts.length > 1 ? parts.slice(1).join(" · ") : (a.issue || "목표 합의");
  }
  var STAGES = ["합의", "전달됨", "반영 확인"];
  function stageBar(status) {
    var at = STAGES.indexOf(status);
    if (at < 0) at = 0;
    return STAGES.map(function (s, i) {
      var on = i <= at;
      return '<span style="font-size:11.5px;font-weight:' + (on ? "700" : "500") +
        ";color:" + (on ? (i === 2 ? "#15803D" : "#1D4ED8") : "#9CA3AF") + '">' +
        (on ? "●" : "○") + " " + esc(s) + "</span>";
    }).join('<span style="color:#CBD5E1;margin:0 5px">→</span>');
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

    /* 반영 추적 — 안내문만 있던 빈 껍데기를 실제 합의 기록에서 그린다 */
    var cnt = { "합의": 0, "전달됨": 0, "반영 확인": 0 };
    S.ags.forEach(function (a) { if (cnt[a.status] != null) cnt[a.status]++; });
    var trackRows = S.ags.map(function (a) {
      var when = a.doneAt || a.sentAt || a.at || "";
      return '<div class="ezmt-irow" style="display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap">' +
        '<span style="flex:1;min-width:220px"><b>' + esc(a.empName) + "</b> · " + esc(agLabel(a)) +
        (a.dir ? '<div class="tip">수정 방향: ' + esc(a.dir) + "</div>" : "") +
        '<div class="tip">담당 ' + esc(a.owner || "-") + " · 기한 " + esc(a.due || "-") +
        (when ? " · 최근 갱신 " + esc(when) : "") + "</div></span>" +
        '<span style="flex:none;display:flex;align-items:center;white-space:nowrap">' + stageBar(a.status) + "</span>" +
        (a.status === "전달됨"
          ? ' <button class="ezmt-btn ghost" style="flex:none" data-ezmt-done="' + a.id + '">반영 확인</button>'
          : "") +
        "</div>";
    }).join("");
    var track = S.ags.length
      ? '<div class="ezmt-kpis" style="margin-bottom:10px">' +
        '<span class="k"><b>' + cnt["합의"] + "</b>합의(미전달)</span>" +
        '<span class="k"><b>' + cnt["전달됨"] + "</b>전달됨</span>" +
        '<span class="k"><b>' + cnt["반영 확인"] + "</b>반영 확인</span></div>" + trackRows
      : '<div class="ezmt-empty">아직 추적할 합의가 없습니다 — ② 회의 중 단계에서 쟁점별로 합의를 기록하면 여기에 단계별로 나타납니다.</div>';

    return '<div class="ezmt-card"><h3>합의 사항 요약 (' + S.ags.length + "건)</h3>" +
      (S.ags.length
        ? '<table class="ezmt-tbl"><tr><th>팀원</th><th>쟁점</th><th>수정 방향</th><th>담당</th><th>기한</th><th>상태</th></tr>' + rows + "</table>"
        : '<div class="ezmt-empty">기록된 합의가 없습니다 — ② 회의 중 단계에서 쟁점별로 기록하세요.</div>') +
      '<div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
      '<button class="ezmt-btn" data-ezmt-send="1"' + (pending ? "" : " disabled") + ">개인별 전달 (" + pending + "건)</button>" +
      '<span class="ezmt-gate">전달은 기록·알림만 생성합니다 — 승인 전에는 아무것도 반영되지 않음</span></div>' +
      /* 이 화면은 조직장 전용이지만, 전달 결과는 팀원 쪽에서도 보인다는 점을 밝힌다 */
      '<div class="ezmt-gate" style="margin-top:8px">🙋 이 회의 화면은 조직장 전용입니다. ' +
      "전달한 합의는 <b>각 팀원 본인의 성과 기록(원장)</b>에 저장되어, 팀원이 자기 화면에서 직접 확인합니다 — " +
      "팀원에게 회의 화면 권한을 주지 않아도 결과는 전달됩니다.</div></div>" +
      '<div class="ezmt-card"><h3>반영 추적</h3><div class="ezmt-gate" style="margin-bottom:8px">합의 → 전달됨 → 반영 확인 순서로 추적합니다. 원본 목표 수정은 각 팀원이 직접 진행합니다.</div>' +
      track + "</div>";
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
    /* 재오픈 시에도 model·합의를 항상 재구성 — 옛 쟁점 잔존 버그 수정 */
    S.model = buildModel();
    S.ags = loadAgs();
    var exist = document.getElementById("ezmt-ov");
    if (exist) { exist.style.display = "flex"; render(); return; }
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

  /* 현재 화면(② 회의 중)의 가중치 입력값 중 원본과 달라진 것만 수집 */
  function collectWeightEdits(m) {
    var out = [];
    var inputs = document.querySelectorAll("#ezmt-ov [data-ezmt-w]");
    Array.prototype.forEach.call(inputs, function (inp) {
      var p = inp.getAttribute("data-ezmt-w").split(":");
      var o = m.objs[+p[0]], k = o && o.krs[+p[1]];
      if (!k) return;
      var v = parseFloat(inp.value);
      if (isNaN(v) || v === pctNum(k.weight)) return;
      out.push({ obj: o.title, kr: k.name, from: pctNum(k.weight), to: v });
    });
    return out;
  }

  /* ============================================================
     5-1. 쟁점 요약 초안 — 오버레이 내부 착지 (step1 하단 접이식 카드)
     ============================================================ */
  function issueLines() {
    return S.model.issues.map(function (it) {
      return "- " + it.empName + " / " + (it.kr || it.objTitle) + " / " + it.tag +
        " / 심각도 " + (it.sev === "bad" ? "높음" : "주의") + " / " + it.tip;
    });
  }
  /* 폴백 — 규칙 기반: 팀원별 그룹핑 + 심각도(bad 우선) 정렬 정적 요약 */
  function ruleSummary(label) {
    var lines = [];
    S.model.members.forEach(function (m) {
      m.issues.slice()
        .sort(function (a, b) { return (a.sev === "bad" ? 0 : 1) - (b.sev === "bad" ? 0 : 1); })
        .forEach(function (it) {
          lines.push({
            text: m.emp.name + " — [" + (it.sev === "bad" ? "높음" : "주의") + "] " + it.tag +
              " · " + (it.kr || it.objTitle) + " — " + it.tip,
            empId: it.emp_id, issueId: it.id
          });
        });
    });
    return { status: "done", label: label, fallback: true, lines: lines };
  }
  function runIssueSummary() {
    if (S.step !== 1) S.step = 1;
    if (!S.model.issues.length) { S.ai = { status: "done", label: "", lines: [] }; render(); return; }
    if (window.EZAI && EZAI.ready && EZAI.ready() && EZAI.agent) {
      S.ai = { status: "loading" };
      render();
      EZAI.agent({
        maxTurns: 1, maxTokens: 600,
        /* ④ 역할 관점 — 이 화면은 조직장 전용이므로 팀 운영 관점을 명시해 문구·우선순위를 고정한다 */
        system: "당신은 elizax — 목표 검토 회의 준비를 돕습니다. 읽는 사람은 " +
          (roleKey() === "leader" ? "이 회의를 주관하는 조직장" : "회의 참석자") +
          "입니다. 팀 전체 관점에서 어떤 목표를 어떻게 조정할지 합의하는 것이 목적이므로, " +
          "개인 질책이 아니라 팀 목표 정렬·리스크·역할 분담 관점으로 쓰세요. " +
          "주어진 쟁점 목록에 없는 내용을 지어내지 마세요.",
        messages: [{ role: "user", content:
          "목표 검토 회의 준비 중입니다. 아래 쟁점 목록을 회의 안건 초안으로 요약해줘 — " +
          "팀원별로 묶고 심각도 높은 순으로, 각 안건은 한 줄(번호·머리말 없이), 최대 8줄. " +
          "각 줄은 팀원 이름으로 시작해.\n" + issueLines().join("\n") }],
        onDone: function (text) {
          var lines = String(text || "").split(/\r?\n/).map(function (s) {
            return s.replace(/^\s*[-•\d.)]+\s*/, "").trim();
          }).filter(Boolean);
          if (!lines.length) { S.ai = ruleSummary("AI 응답 없음 — 규칙 기반 요약"); render(); return; }
          S.ai = { status: "done", label: "✦ Claude 생성", lines: lines.map(function (ln) {
            var empId = "";
            S.model.members.forEach(function (m) { if (ln.indexOf(m.emp.name) >= 0) empId = empId || m.emp.emp_id; });
            return { text: ln, empId: empId };
          }) };
          render();
        },
        onError: function () { S.ai = ruleSummary("AI 오류 — 규칙 기반 요약"); render(); }
      });
    } else {
      S.ai = ruleSummary("AI 미연결 — 규칙 기반 요약");
      render();
    }
  }
  function renderAiCard() {
    if (!S.ai) return "";
    var inner;
    if (S.ai.status === "loading") {
      inner = '<div class="ezmt-empty"><span class="ezmt-spin"></span> elizax가 쟁점 ' +
        S.model.issues.length + "건을 요약하는 중…</div>";
    } else if (!S.ai.lines.length) {
      inner = '<div class="ezmt-empty">요약할 쟁점이 없습니다.</div>';
    } else {
      inner = S.ai.lines.map(function (ln, i) {
        return '<div class="ezmt-irow" style="display:flex;gap:10px;align-items:flex-start">' +
          '<span style="flex:1;min-width:0">' + esc(ln.text) + "</span>" +
          '<button class="ezmt-btn ghost" style="flex:none" data-ezmt-copy="' + i + '">안건 메모로 복사</button></div>';
      }).join("");
    }
    return '<details class="ezmt-card ezmt-ai-card" open><summary style="cursor:pointer;font-weight:800;font-size:14px">✦ 쟁점 요약 초안' +
      (S.ai.label
        ? (S.ai.fallback
          ? ' <span class="ezmt-tag warn">' + esc(S.ai.label) + "</span>"
          : ' <span class="ezmt-tag" style="background:#EFF6FF;color:#1D4ED8">' + esc(S.ai.label) + "</span>")
        : "") +
      "</summary>" + inner +
      '<div class="ezmt-gate" style="margin-top:8px">' +
      '<button class="ezmt-btn ghost" data-ezmt-chat="1">elizax 대화로 계속</button>' +
      "패널이 열리면 이 회의 화면은 닫힙니다</div></details>";
  }
  /* [안건 메모로 복사] 착지 — ② 단계 해당 쟁점 합의 폼의 수정 방향 프리필 */
  function applyPrefill() {
    if (!S.prefill) return;
    var inp = null;
    if (S.prefill.issueId) inp = document.querySelector('#ezmt-ov [data-ezmt-iss="' + S.prefill.issueId + '"] .dir');
    if (!inp) inp = document.querySelector("#ezmt-ov .ezmt-agform .dir");
    if (inp) { inp.value = S.prefill.text; toast("안건 메모를 합의 폼에 채웠습니다"); }
    else toast("빈 합의 폼이 없습니다 — 이미 기록된 쟁점일 수 있습니다", "warn");
    S.prefill = null;
  }

  function onClick(e) {
    var t = e.target.closest ? e.target.closest("[data-ezmt-close],[data-ezmt-step],[data-ezmt-mem],[data-ezmt-goto],[data-ezmt-rec],[data-ezmt-send],[data-ezmt-done],[data-ezmt-ai],[data-ezmt-copy],[data-ezmt-chat]") : null;
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
        kr: found.it.kr || found.it.objTitle || "", /* 사람이 읽는 제목 원천(원장 제목·추적 행) */
        dir: inps[0].value || "", owner: inps[1].value || found.it.empName,
        due: inps[2].value || "", status: "합의", at: stamp(),
        weights: collectWeightEdits(found.m) /* 화면에서 편집한 가중치를 합의 기록에 포함 */
      });
      saveAgs(S.ags);
      toast("합의를 기록했습니다 · " + found.it.empName);
      render();
      return;
    }

    if (t.hasAttribute("data-ezmt-send")) {          /* 개인별 전달 — 수신자 원장 라우팅 */
      var byEmp = {};
      S.ags.forEach(function (a) {
        if (a.status !== "합의") return;
        (byEmp[a.emp_id] = byEmp[a.emp_id] || { name: a.empName, list: [] }).list.push(a);
      });
      var people = 0, sent = 0;
      Object.keys(byEmp).forEach(function (id) {
        var g = byEmp[id], ok = false;
        /* 원장 제목은 받는 팀원이 자기 화면에서 읽는 문장 — 무엇에 대한 합의인지 제목만 봐도 알게 한다 */
        var first = agLabel(g.list[0]);
        var gTitle = "목표 검토 회의 합의 — " + first +
          (g.list.length > 1 ? " 외 " + (g.list.length - 1) + "건" : "");
        try {
          document.dispatchEvent(new CustomEvent("ez:ctx", {
            detail: {
              type: "goal", source: "meeting.agree",
              emp_id: id, /* 수신자 emp_id — tx_ctx_ledger가 해당 팀원 원장으로 라우팅 */
              title: gTitle,
              summary: g.list.map(function (a) {
                return a.issue + (a.dir ? " → " + a.dir : "") + " (기한 " + a.due + ")" +
                  (a.weights && a.weights.length
                    ? " [가중치 조정: " + a.weights.map(function (w) { return w.kr + " " + w.from + "→" + w.to + "%"; }).join(", ") + "]"
                    : "");
              }).join(" / "),
              weight: 2
            }
          }));
          ok = true;
        } catch (err) { /* 원장 부재 — 발행 실패 건은 전달 집계에서 제외 */ }
        if (ok) {
          people++;
          g.list.forEach(function (a) { a.status = "전달됨"; a.sentAt = stamp(); sent++; });
        }
      });
      saveAgs(S.ags);
      if (sent) toast("합의 " + sent + "건을 " + people + "명에게 전달했습니다 · 각 팀원 본인의 성과 기록에서 확인할 수 있습니다");
      else toast("전달하지 못했습니다 — 성과 기록(원장)을 확인하세요", "warn");
      render();
      return;
    }

    if (t.hasAttribute("data-ezmt-done")) {          /* 반영 확인 */
      var aid = t.getAttribute("data-ezmt-done");
      S.ags.forEach(function (a) { if (a.id === aid) { a.status = "반영 확인"; a.doneAt = stamp(); } });
      saveAgs(S.ags);
      toast("반영 확인으로 표시했습니다");
      render();
      return;
    }

    if (t.hasAttribute("data-ezmt-ai")) {            /* 쟁점 요약 초안 — 오버레이 내부 카드에 착지 */
      runIssueSummary();
      return;
    }

    if (t.hasAttribute("data-ezmt-copy")) {          /* 요약 항목 → 합의 폼 프리필 */
      var ln = S.ai && S.ai.lines && S.ai.lines[+t.getAttribute("data-ezmt-copy")];
      if (!ln) return;
      S.model.members.forEach(function (m, i) { if (m.emp.emp_id === ln.empId) S.memberIdx = i; });
      S.prefill = { issueId: ln.issueId || "", text: ln.text };
      S.step = 2;
      render();
      applyPrefill();
      return;
    }

    if (t.hasAttribute("data-ezmt-chat")) {          /* 보조 링크 — elizax 패널을 실제로 열고 이어가기 */
      if (!(window.Elizax && Elizax.send)) { toast("elizax를 불러오지 못했습니다", "warn"); return; }
      Elizax.send("목표 검토 회의 준비 중입니다. 아래 쟁점 목록을 회의 안건 초안으로 요약해줘 (팀원별 묶음, 심각도 우선):\n" + issueLines().join("\n"));
      close();
      toast("elizax 패널로 이동했습니다 — 회의 화면을 닫았습니다");
      return;
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
