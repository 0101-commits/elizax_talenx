/* ============================================================
   tx_jobcontext.js — 직무 프로파일 · 목표-직무 연결 레이어 (window.EZJob)
   1) 목표 생성 오버레이용 "내 직무 기준" 패널 HTML (panelHTML)
   2) 직무 프로파일 상세 drawer (openProfileDrawer)
   3) 목표–직무 연결 지도 오버레이 (openLinkMap, .ezjc-mapov)
   4) HR/경영진용 목표–직무 연결 품질 지표 카드 (#s-appr 주입)
   전부 window.TALENX_DATA 읽기 전용 · 데이터 필드가 없으면 조용히
   생략/흐림 처리(defensive). prefix .ezjc- · IIFE · 'use strict'.
   ============================================================ */
(function () {
  'use strict';

  function D() { return window.TALENX_DATA || {}; }
  function cu() { return (D().meta && D().meta.currentUser) || {}; }
  function arr(k) { return Array.isArray(D()[k]) ? D()[k] : []; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function empBy(id) {
    if (!id) return null;
    var es = arr('employees');
    for (var i = 0; i < es.length; i++) if (es[i].emp_id === id) return es[i];
    var c = cu();
    return c.emp_id === id ? c : null;
  }
  function evalOf(empId) {
    var vs = arr('evaluations');
    for (var i = 0; i < vs.length; i++) if (vs[i].emp_id === empId) return vs[i];
    return null;
  }
  function histOf(empId, period) {
    var hs = arr('evalHistory');
    for (var i = 0; i < hs.length; i++) {
      if (hs[i] && hs[i].emp_id === empId) {
        var h = hs[i].history || [];
        for (var j = 0; j < h.length; j++) if (h[j] && h[j].period === period) return h[j];
        return null;
      }
    }
    return null;
  }
  /* 직무 프로파일: jobProfileId 우선, 없으면 직무명(title) 일치로 보조 매칭 */
  function profileOf(emp) {
    if (!emp) return null;
    var dict = D().jobProfiles || {};
    var jp = emp.jobProfileId ? dict[emp.jobProfileId] : null;
    if (!jp && emp.jobTitle) {
      for (var k in dict) {
        if (dict[k] && dict[k].title === emp.jobTitle) { jp = dict[k]; break; }
      }
    }
    return jp || null;
  }
  function compName(id) {
    var cs = arr('competencies');
    for (var i = 0; i < cs.length; i++) if (cs[i] && cs[i].dimension_id === id) return cs[i].name || id;
    return id || '';
  }
  function roleKey() {
    try {
      return (window.TXRoles && window.TXRoles.current && window.TXRoles.current().key) || 'member';
    } catch (e) { return 'member'; }
  }

  /* 전략 테마 — 데이터에 없으면 표준 테마로 표시(연결선은 그리지 않음) */
  var FALLBACK_THEMES = [
    { theme_id: 'ST-01', name: '수익성 있는 성장', description: '매출·수익 구조 개선' },
    { theme_id: 'ST-02', name: 'AI-native HR Tech 전환', description: 'AI 중심 제품·운영 전환' },
    { theme_id: 'ST-03', name: '제품 경쟁력·품질', description: '제품 품질과 차별화' },
    { theme_id: 'ST-04', name: '고객 성공·신뢰', description: '고객 성과와 신뢰 구축' },
    { theme_id: 'ST-05', name: '운영 효율·조직 기반', description: '운영 효율과 조직 역량' }
  ];
  function themes() {
    var ts = D().strategyThemes;
    return (Array.isArray(ts) && ts.length) ? ts : FALLBACK_THEMES;
  }

  /* ============================================================
     STYLE — <style id="ezjc-css"> 싱글턴
     ============================================================ */
  function injectStyle() {
    if (document.getElementById('ezjc-css')) return;
    var st = document.createElement('style');
    st.id = 'ezjc-css';
    st.textContent = [
      /* --- 목표 생성 오버레이: 내 직무 기준 패널 --- */
      '#s-perf .txf-jobpanel{width:270px;flex:none;background:var(--card,#fff);border:1px solid var(--line,#ECEEF2);border-radius:12px;padding:16px;font-size:12.5px;color:var(--ink,#2A2E39)}',
      '@media(max-width:1100px){#s-perf .txf-jobpanel{display:none}}',
      '.txf-jobpanel .ezjc-ph{display:flex;gap:9px;align-items:flex-start;padding-bottom:11px;border-bottom:1px solid var(--line,#ECEEF2);margin-bottom:11px}',
      '.txf-jobpanel .ezjc-ph .ic{font-size:16px;line-height:1.2}',
      '.txf-jobpanel .ezjc-ph b{font-size:13.5px;font-weight:800}',
      '.txf-jobpanel .ezjc-ph .jt{font-size:11.5px;color:var(--ink-3,#9096A3);margin-top:2px}',
      '.ezjc-missing{font-size:12px;font-weight:700;color:#B45309;background:rgba(180,83,9,.07);border:1px solid rgba(180,83,9,.25);border-radius:8px;padding:9px 11px;margin:4px 0 10px;line-height:1.55}',
      '.ezjc-ptitle{font-size:13.5px;font-weight:800;color:var(--ink,#2A2E39)}',
      '.ezjc-pmeta{font-size:11.5px;color:var(--ink-3,#9096A3);margin:3px 0 8px}',
      '.ezjc-mission{font-size:12px;color:var(--ink-2,#5C6474);line-height:1.6}',
      '.ezjc-mission.clamp{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}',
      '.ezjc-more{border:none;background:none;color:var(--blue,#1F7AF0);font-size:11.5px;font-weight:700;cursor:pointer;padding:3px 0}',
      '.ezjc-sec{font-size:11.5px;font-weight:800;color:var(--ink-3,#9096A3);margin:12px 0 6px;letter-spacing:.02em}',
      '.ezjc-area{display:flex;align-items:center;gap:6px;padding:7px 8px;border:1px solid var(--line,#ECEEF2);border-radius:8px;margin-top:5px;cursor:pointer;font-size:12px;font-weight:700;color:var(--ink,#2A2E39);background:var(--card,#fff);user-select:none}',
      '.ezjc-area:hover{background:var(--soft,#F5F6F8)}',
      '.ezjc-area .cv{color:var(--ink-4,#B4B9C4);font-size:11px;flex:none}',
      '.ezjc-area .anm{flex:1;min-width:0;line-height:1.4}',
      '.ezjc-area .cnt{font-size:10.5px;font-weight:700;color:var(--blue-2,#0E63D6);background:var(--blue-soft,#E9F1FE);border-radius:999px;padding:1px 7px;flex:none}',
      '.ezjc-tasks{margin:2px 0 4px;padding-left:4px}',
      '.ezjc-task{display:flex;gap:6px;align-items:flex-start;padding:5px 2px 5px 8px;font-size:11.5px;color:var(--ink-2,#5C6474);border-left:2px solid var(--line,#ECEEF2)}',
      '.ezjc-task .tt{flex:1;min-width:0;line-height:1.5}',
      '.ezjc-tokr{flex:none;border:1px solid var(--blue,#1F7AF0);color:var(--blue,#1F7AF0);background:var(--card,#fff);border-radius:6px;font-size:10.5px;font-weight:700;padding:2px 7px;cursor:pointer}',
      '.ezjc-tokr:hover{background:var(--blue-soft,#E9F1FE)}',
      '.ezjc-chips{display:flex;flex-wrap:wrap;gap:5px}',
      '.ezjc-chip2{font-size:11px;font-weight:600;color:var(--ink-2,#5C6474);background:var(--soft,#F5F6F8);border:1px solid var(--line,#ECEEF2);border-radius:999px;padding:2px 9px}',
      '.ezjc-chip2.more{color:var(--blue-2,#0E63D6);background:var(--blue-soft,#E9F1FE);border-color:transparent}',
      '.ezjc-carry{margin-top:12px;background:rgba(123,97,255,.06);border:1px solid rgba(123,97,255,.22);border-radius:10px;padding:10px 11px}',
      '.ezjc-carry .ct{font-size:11.5px;font-weight:800;color:#7B61FF;margin-bottom:5px}',
      '.ezjc-carry .cg{font-size:12px;color:var(--ink,#2A2E39)}',
      '.ezjc-carry .cr{font-size:11.5px;color:var(--ink-2,#5C6474);line-height:1.55;margin-top:4px}',
      '.ezjc-carry .cn{font-size:10.5px;color:var(--ink-3,#9096A3);margin-top:6px}',
      '.ezjc-foot{margin-top:11px;padding-top:9px;border-top:1px solid var(--line,#ECEEF2)}',
      '.ezjc-link{font-size:12px;font-weight:700;color:var(--blue,#1F7AF0);cursor:pointer}',
      /* --- 진입 버튼 --- */
      '.ezjc-mapbtn{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;padding:9px 14px;border:1px solid var(--line,#ECEEF2);border-radius:8px;background:var(--card,#fff);color:var(--ink-2,#5C6474);cursor:pointer}',
      '.ezjc-mapbtn:hover{background:var(--soft,#F5F6F8)}',
      /* --- 연결 지도 오버레이 --- */
      '.ezjc-mapov{position:fixed;inset:0;z-index:1300;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:24px}',
      '.ezjc-map{background:var(--card,#fff);color:var(--ink,#2A2E39);border-radius:18px;max-width:1200px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 24px 64px rgba(15,23,42,.3);padding:20px 22px}',
      '.ezjc-maphead{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.ezjc-maphead .tt{font-size:16.5px;font-weight:800}',
      '.ezjc-maphead .sub{flex-basis:100%;font-size:12px;color:var(--ink-3,#9096A3);margin-top:2px}',
      '.ezjc-chip{font-size:11px;font-weight:700;color:var(--blue-2,#0E63D6);background:var(--blue-soft,#E9F1FE);border-radius:999px;padding:3px 10px;white-space:nowrap}',
      '.ezjc-mapx{cursor:pointer;margin-left:auto;border:none;background:none;font-size:18px;color:var(--ink-3,#9096A3);line-height:1}',
      '.ezjc-subj{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink-2,#5C6474);margin:10px 0 0;flex-wrap:wrap}',
      '.ezjc-subj select{border:1px solid var(--line,#ECEEF2);border-radius:8px;padding:6px 9px;font-size:12.5px;color:var(--ink,#2A2E39);background:var(--card,#fff)}',
      '.ezjc-legend{font-size:10.5px;color:var(--ink-3,#9096A3);margin-left:auto}',
      '.ezjc-mapwrap{position:relative;overflow-x:auto;margin-top:12px;padding-bottom:6px}',
      '.ezjc-svg{position:absolute;left:0;top:0;pointer-events:none;z-index:0}',
      '.ezjc-cols{position:relative;z-index:1;display:grid;grid-template-columns:repeat(6,minmax(168px,1fr));gap:14px;min-width:1090px}',
      '.ezjc-col>.ch{font-size:12.5px;font-weight:800;display:flex;align-items:center;gap:6px}',
      '.ezjc-col>.ch .step{width:18px;height:18px;border-radius:50%;background:#23408E;color:#fff;font-size:10px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;flex:none}',
      '.ezjc-col>.cap{font-size:10.5px;color:var(--ink-3,#9096A3);margin:3px 0 9px}',
      '.ezjc-item{position:relative;background:var(--card,#fff);border:1px solid var(--line,#ECEEF2);border-radius:10px;padding:8px 10px;margin-bottom:7px;font-size:11.5px;line-height:1.5;color:var(--ink,#2A2E39)}',
      '.ezjc-item b{font-weight:700}',
      '.ezjc-item .sm{font-size:10.5px;color:var(--ink-3,#9096A3);margin-top:3px;line-height:1.45}',
      '.ezjc-item.hl{border-color:var(--blue,#1F7AF0);box-shadow:0 0 0 2px rgba(31,122,240,.12)}',
      '.ezjc-item.dim{opacity:.42}',
      '.ezjc-item.kr{background:var(--soft,#F5F6F8);padding:6px 9px;font-size:11px;margin-left:8px}',
      '.ezjc-note{font-size:10.5px;color:var(--ink-3,#9096A3);margin-top:8px;line-height:1.5}',
      /* --- 품질 지표 카드 --- */
      '.ezjc-quality{background:var(--card,#fff);border:1px solid var(--line,#ECEEF2);border-radius:12px;padding:16px 20px;margin:0 0 20px}',
      '.ezjc-qhead{display:flex;align-items:center;gap:10px}',
      '.ezjc-qhead h3{margin:0;font-size:15px;font-weight:800;color:var(--ink,#2A2E39)}',
      '.ezjc-qlink{margin-left:auto;display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;padding:7px 12px;border:1px solid var(--line,#ECEEF2);border-radius:8px;background:var(--card,#fff);color:var(--blue-2,#0E63D6);cursor:pointer}',
      '.ezjc-qlink:hover{background:var(--blue-soft,#E9F1FE)}',
      '.ezjc-qcap{font-size:12px;color:var(--ink-3,#9096A3);margin:4px 0 13px}',
      '.ezjc-quality .tx-kpi .c{background:var(--card,#fff)}',
      /* --- 직무 프로파일 drawer 내부 --- */
      '.ezjc-dr .ezjc-sec:first-child{margin-top:0}',
      '.ezjc-dr .ezjc-mission{font-size:13px}',
      '.ezjc-ref{display:flex;align-items:center;gap:8px;padding:9px 4px;border-bottom:1px solid var(--line,#ECEEF2);font-size:12.5px}',
      '.ezjc-ref .tt{flex:1;min-width:0;font-weight:600;color:var(--ink,#2A2E39)}',
      '.ezjc-ref .pp{flex:none;font-size:11.5px;font-weight:700;color:var(--blue-2,#0E63D6)}',
      '.ezjc-ref .ow{flex:none;font-size:11px;color:var(--ink-3,#9096A3)}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ============================================================
     공통 조각 — 과업 아코디언 · 스킬 칩
     ============================================================ */
  function areasHTML(jp, withKr) {
    var tasks = (jp && jp.tasks) || {};
    var names = Object.keys(tasks);
    if (!names.length) return '<div class="ezjc-note">등록된 과업이 없습니다.</div>';
    return names.map(function (area) {
      var ts = tasks[area] || [];
      return '<div class="ezjc-area" data-ezjc="area"><span class="cv">⌄</span>'
        + '<span class="anm">' + esc(area) + '</span><span class="cnt">' + ts.length + '</span></div>'
        + '<div class="ezjc-tasks" style="display:none">'
        + ts.map(function (t) {
            return '<div class="ezjc-task"><span class="tt">' + esc(t) + '</span>'
              + (withKr ? '<button class="ezjc-tokr" data-txf="job-kr" data-area="' + esc(area) + '" data-task="' + esc(t) + '" title="이 과업을 측정 가능한 KR로 추가">KR로</button>' : '')
              + '</div>';
          }).join('')
        + '</div>';
    }).join('');
  }
  function skillsChips(skills, max) {
    skills = skills || [];
    var out = skills.slice(0, max).map(function (s) {
      return '<span class="ezjc-chip2">' + esc(s) + '</span>';
    }).join('');
    if (skills.length > max) out += '<span class="ezjc-chip2 more">+' + (skills.length - max) + '</span>';
    return '<div class="ezjc-chips">' + (out || '<span class="ezjc-chip2">—</span>') + '</div>';
  }
  function carryOverHTML(emp) {
    var h25 = histOf(emp.emp_id, 'FY2025');
    var ev = evalOf(emp.emp_id);
    if (!h25 && !ev) return '';
    return '<div class="ezjc-carry"><div class="ct">지난 사이클 이어받기</div>'
      + (h25 ? '<div class="cg">FY2025 등급 <b>' + esc(h25.grade) + '</b>'
          + (h25.score != null ? ' · ' + esc(h25.score) + '점' : '') + '</div>' : '')
      + (ev && ev.rationale_summary ? '<div class="cr">' + esc(ev.rationale_summary) + '</div>' : '')
      + '<div class="cn">작년 기록과 직무 기준을 AI 추천의 근거로 사용합니다</div></div>';
  }

  /* ============================================================
     1) 목표 생성 오버레이 패널 — window.EZJob.panelHTML(emp)
     ============================================================ */
  function panelHTML(emp) {
    injectStyle();
    emp = emp || cu();
    var jp = profileOf(emp);
    var h = '<div class="txf-jobpanel" data-ezjc-panel>'
      + '<div class="ezjc-ph"><span class="ic">🧩</span><div><b>내 직무 기준</b>'
      + '<div class="jt">' + esc(emp.jobTitle || '직무 미지정') + '</div></div></div>';
    if (!jp) {
      h += '<div class="ezjc-missing">⚠ 직무 프로파일 미연결 — HR에 연결을 요청하세요</div>'
        + '<div class="ezjc-note">직무 기준이 연결되면 과업·기대 스킬을 근거로 AI가 KR을 추천합니다.</div>';
    } else {
      var longMission = (jp.mission || '').length > 80;
      h += '<div class="ezjc-ptitle">' + esc(jp.title || '') + '</div>'
        + '<div class="ezjc-pmeta">' + esc(jp.group || '')
        + (jp.series ? ' · ' + esc(jp.series) : '') + '</div>'
        + '<div class="ezjc-mission clamp" data-ezjc-mission>' + esc(jp.mission || '') + '</div>'
        + (longMission ? '<button class="ezjc-more" data-ezjc="mission-more">더보기</button>' : '')
        + '<div class="ezjc-sec">주요 과업</div>'
        + areasHTML(jp, true)
        + '<div class="ezjc-sec">기대 스킬</div>'
        + skillsChips(jp.skills, 8);
    }
    h += carryOverHTML(emp);
    h += '<div class="ezjc-foot"><a class="ezjc-link" data-ezjc="drawer" data-emp="' + esc(emp.emp_id || '') + '">전체 프로파일 보기 →</a></div>';
    h += '</div>';
    return h;
  }

  /* ============================================================
     2) 직무 프로파일 drawer — window.EZJob.openProfileDrawer(empId)
     ============================================================ */
  function refObjectives(e, jp) {
    return arr('objectives').filter(function (o) {
      if (!o) return false;
      if (o.owner_emp_id === e.emp_id) return true;
      if (jp && o.job_ref && o.job_ref.jobProfileId === jp.job_id) return true;
      return false;
    }).slice(0, 6);
  }
  function openProfileDrawer(empId) {
    injectStyle();
    var TXk = window.TX || {};
    var e = empBy(empId) || cu();
    var jp = profileOf(e);
    var refs = refObjectives(e, jp);
    var body = '<div class="ezjc-dr">';
    if (!jp) {
      body += '<div class="ezjc-missing">⚠ 직무 프로파일 미연결 — HR에 연결을 요청하세요</div>';
    } else {
      body += '<div class="ezjc-sec">미션</div>'
        + '<div class="ezjc-mission">' + esc(jp.mission || '') + '</div>'
        + '<div class="ezjc-sec">주요 과업</div>'
        + areasHTML(jp, false)
        + '<div class="ezjc-sec">기대 스킬 (' + ((jp.skills || []).length) + ')</div>'
        + skillsChips(jp.skills, 15);
    }
    body += '<div class="ezjc-sec">이 직무 기준을 참조한 목표</div>';
    body += refs.length ? refs.map(function (o) {
      var ow = empBy(o.owner_emp_id);
      return '<div class="ezjc-ref"><span class="tt">' + esc(o.title) + '</span>'
        + '<span class="ow">' + esc(ow ? ow.name : '') + '</span>'
        + '<span class="pp">' + Math.round(o.progress || 0) + '%</span></div>';
    }).join('') : '<div class="ezjc-note">아직 이 직무 기준을 참조한 목표가 없습니다.</div>';
    body += '</div>';
    var title = esc((jp && jp.title) || e.jobTitle || '직무') + ' 직무 프로파일';
    var sub = esc(e.name || '') + (e.orgName ? ' · ' + esc(e.orgName) : '');
    if (TXk.drawer) TXk.drawer({ title: title, subtitle: sub, body: body, width: '520px' });
    else if (TXk.modal) TXk.modal({ title: title, body: body, actions: [{ label: '닫기', kind: 'ghost' }] });
  }

  /* ============================================================
     3) 목표–직무 연결 지도 — window.EZJob.openLinkMap()
     ============================================================ */
  var COLS = [
    { t: '사업전략', cap: '전략 테마 → 조직 목표' },
    { t: '조직 목표', cap: '조직 목표 → 내 목표' },
    { t: '내 목표·KR', cap: '내 KR → 직무 과업' },
    { t: '직무 R&R', cap: '직무 과업 → 스킬·역량' },
    { t: '스킬·역량', cap: '역량 → 평가 근거' },
    { t: '평가', cap: '확정 근거로 연결' }
  ];
  var LEVEL_KR = { company: '전사', division: '본부', bu: 'BU', team: '팀', chapter: '챕터', individual: '개인' };
  var curPairs = [];

  function subjects() {
    var me = cu();
    var key = roleKey();
    if (key === 'leader') {
      var reps = arr('employees').filter(function (x) { return x.manager_id === me.emp_id; });
      return [me].concat(reps).slice(0, 12);
    }
    if (key === 'hr' || key === 'exec') {
      var list = (D().demoSubjects || []).map(function (s) { return empBy(s.emp_id); }).filter(Boolean);
      return list.length ? list : [me];
    }
    return [me];
  }

  function mapBodyHTML(empId) {
    curPairs = [];
    var e = empBy(empId) || cu();
    var jp = profileOf(e);
    var objsAll = arr('objectives'), krsAll = arr('keyResults');
    var oIdx = {};
    objsAll.forEach(function (o) { oIdx[o.objective_id] = o; });
    var myObjs = objsAll.filter(function (o) { return o.owner_emp_id === e.emp_id; }).slice(0, 3);
    var myKrs = [];
    myObjs.forEach(function (o) {
      krsAll.filter(function (k) { return k.objective_id === o.objective_id; })
        .slice(0, 4).forEach(function (k) { myKrs.push(k); });
    });

    /* ② 조직 목표: 내 목표의 상위 체인 + 전사 목표 */
    var chain = [], inChain = {};
    myObjs.forEach(function (o) {
      var lineage = [], c = oIdx[o.parent_objective_id], g = 0;
      while (c && g++ < 10) { lineage.unshift(c); c = oIdx[c.parent_objective_id]; }
      lineage.forEach(function (x) {
        if (!inChain[x.objective_id]) { inChain[x.objective_id] = 1; chain.push(x); }
      });
    });
    var col2 = [], in2 = {};
    objsAll.forEach(function (o) {
      if (o.level === 'company' && !in2[o.objective_id]) { col2.push(o); in2[o.objective_id] = 1; }
    });
    chain.forEach(function (o) {
      if (!in2[o.objective_id]) { col2.push(o); in2[o.objective_id] = 1; }
    });
    col2 = col2.slice(0, 6);

    /* ① 전략 테마 연결 (objectives[].strategy_theme_id · 없으면 제목 추정 1건) */
    var ths = themes();
    var themeTo = {};
    function noteTheme(tid, o) {
      if (!tid || themeTo[tid]) return;
      var target = null;
      if (in2[o.objective_id]) target = o.objective_id;
      else {
        var c = oIdx[o.parent_objective_id], g = 0, last = null;
        while (c && g++ < 10) { if (in2[c.objective_id]) last = c.objective_id; c = oIdx[c.parent_objective_id]; }
        target = last || (col2[0] && col2[0].objective_id);
      }
      if (target) themeTo[tid] = target;
    }
    myObjs.forEach(function (o) { noteTheme(o.strategy_theme_id, o); });
    chain.forEach(function (o) { noteTheme(o.strategy_theme_id, o); });
    if (!Object.keys(themeTo).length) {
      for (var ci = 0; ci < col2.length; ci++) {
        var tt = String(col2[ci].title || '');
        if (/AI/i.test(tt)) { themeTo['ST-02'] = col2[ci].objective_id; break; }
        if (/매출|수익/.test(tt)) { themeTo['ST-01'] = col2[ci].objective_id; break; }
      }
    }
    Object.keys(themeTo).forEach(function (tid) {
      curPairs.push(['t:' + tid, 'o:' + themeTo[tid], '#7B61FF']);
    });

    /* ③↔④↔⑤ 연결: KR→과업, 과업→역량, 역량→평가 */
    var linkedAreas = {}, linkedComps = {}, areaComp = {};
    myObjs.forEach(function (o) {
      if (o.job_ref && o.job_ref.task_area) linkedAreas[o.job_ref.task_area] = 1;
      if (o.parent_objective_id && in2[o.parent_objective_id]) {
        curPairs.push(['o:' + o.parent_objective_id, 'my:' + o.objective_id, '#1F7AF0']);
      }
    });
    myKrs.forEach(function (k) {
      var ar = k.job_task_ref && k.job_task_ref.task_area;
      if (ar) { linkedAreas[ar] = 1; curPairs.push(['kr:' + k.kr_id, 'a:' + ar, '#0E9F6E']); }
      if (k.competency_id) {
        linkedComps[k.competency_id] = 1;
        if (ar) areaComp[ar + '' + k.competency_id] = 1;
      }
    });
    Object.keys(areaComp).forEach(function (pk) {
      var pp = pk.split('');
      curPairs.push(['a:' + pp[0], 'c:' + pp[1], '#B45309']);
    });
    var ev = evalOf(e.emp_id);
    if (ev) Object.keys(linkedComps).forEach(function (cid) {
      curPairs.push(['c:' + cid, 'ev:1', '#5C6474']);
    });

    /* ---- 컬럼 렌더 ---- */
    var c1 = ths.map(function (t) {
      var hl = !!themeTo[t.theme_id];
      return '<div class="ezjc-item' + (hl ? ' hl' : ' dim') + '" data-jm="t:' + esc(t.theme_id) + '">'
        + '<b>' + esc(t.theme_id) + '</b> ' + esc(t.name)
        + (t.description ? '<div class="sm">' + esc(t.description) + '</div>' : '')
        + '</div>';
    }).join('');

    var themedObjs = {};
    Object.keys(themeTo).forEach(function (tid) { themedObjs[themeTo[tid]] = 1; });
    var c2 = col2.length ? col2.map(function (o) {
      var hl = inChain[o.objective_id] || themedObjs[o.objective_id];
      return '<div class="ezjc-item' + (hl ? ' hl' : ' dim') + '" data-jm="o:' + esc(o.objective_id) + '">'
        + esc(o.title)
        + '<div class="sm">' + esc(LEVEL_KR[o.level] || o.level || '')
        + (o.progress != null ? ' · ' + Math.round(o.progress) + '%' : '') + '</div></div>';
    }).join('') : '<div class="ezjc-item dim">연결된 조직 목표가 없습니다</div>';

    var c3 = myObjs.length ? myObjs.map(function (o) {
      var kk = krsAll.filter(function (k) { return k.objective_id === o.objective_id; }).slice(0, 4);
      return '<div class="ezjc-item hl" data-jm="my:' + esc(o.objective_id) + '"><b>' + esc(o.title) + '</b>'
        + '<div class="sm">' + esc(o.type || '') + (o.progress != null ? ' · ' + Math.round(o.progress) + '%' : '') + '</div></div>'
        + kk.map(function (k) {
            return '<div class="ezjc-item kr" data-jm="kr:' + esc(k.kr_id) + '">' + esc(k.name) + '</div>';
          }).join('');
    }).join('') : '<div class="ezjc-item dim">등록된 목표가 없습니다</div>';

    var c4;
    if (jp) {
      var areaNames = Object.keys(jp.tasks || {});
      c4 = '<div class="ezjc-item hl" data-jm="p:1"><b>' + esc(jp.title || '') + '</b>'
        + '<div class="sm">' + esc(jp.group || '') + (jp.series ? ' · ' + esc(jp.series) : '') + '</div></div>'
        + areaNames.map(function (a) {
            var hl = !!linkedAreas[a];
            return '<div class="ezjc-item' + (hl ? ' hl' : ' dim') + '" data-jm="a:' + esc(a) + '">' + esc(a) + '</div>';
          }).join('');
    } else {
      c4 = '<div class="ezjc-item dim">직무 프로파일 미연결 — HR에 연결을 요청하세요</div>';
    }

    var comps = arr('competencies');
    var c5 = (jp ? '<div class="ezjc-item"><div class="sm" style="margin:0 0 5px">기대 스킬 (상위 5)</div>'
        + skillsChips((jp.skills || []).slice(0, 5), 5) + '</div>' : '')
      + (comps.length ? comps.map(function (c) {
          var hl = !!linkedComps[c.dimension_id];
          return '<div class="ezjc-item' + (hl ? ' hl' : ' dim') + '" data-jm="c:' + esc(c.dimension_id) + '">'
            + '<b>' + esc(c.dimension_id) + '</b> ' + esc(c.name) + '</div>';
        }).join('') : '<div class="ezjc-item dim">역량 사전이 없습니다</div>');

    var h25 = histOf(e.emp_id, 'FY2025'), h24 = histOf(e.emp_id, 'FY2024');
    var c6 = '<div class="ezjc-item' + (ev ? ' hl' : ' dim') + '" data-jm="ev:1">'
      + '<b>' + (ev ? esc(ev.period || '') + ' 평가 ' + esc(ev.grade || '') + '등급' : '평가 기록 없음') + '</b>'
      + (ev && ev.rationale_summary ? '<div class="sm">' + esc(ev.rationale_summary) + '</div>' : '')
      + '<div class="sm" style="color:#15803D">확정 근거로 연결</div></div>'
      + ((h24 || h25)
          ? '<div class="ezjc-item"><div class="sm" style="margin:0">성과 히스토리</div>'
            + (h24 ? 'FY2024 ' + esc(h24.grade) : '') + (h24 && h25 ? ' → ' : '')
            + (h25 ? 'FY2025 ' + esc(h25.grade) : '') + '</div>'
          : '');

    var bodies = [c1, c2, c3, c4, c5, c6];
    var colsHTML = COLS.map(function (c, i) {
      return '<div class="ezjc-col"><div class="ch"><span class="step">' + (i + 1) + '</span>' + esc(c.t) + '</div>'
        + '<div class="cap">' + esc(c.cap) + '</div>' + bodies[i] + '</div>';
    }).join('');

    return '<svg class="ezjc-svg" data-ezjc-svg></svg>'
      + '<div class="ezjc-cols">' + colsHTML + '</div>'
      + '<div class="ezjc-note">' + esc(e.name || '') + ' 님 기준 · 흐리게 표시된 항목은 아직 데이터로 연결되지 않은 기준입니다.</div>';
  }

  function drawLines(wrap) {
    var svg = wrap.querySelector('[data-ezjc-svg]');
    if (!svg) return;
    var nodes = {};
    wrap.querySelectorAll('[data-jm]').forEach(function (n) { nodes[n.getAttribute('data-jm')] = n; });
    var wr = wrap.getBoundingClientRect();
    var W = Math.max(wrap.scrollWidth, wrap.clientWidth);
    var H = Math.max(wrap.scrollHeight, wrap.clientHeight);
    svg.setAttribute('width', W); svg.setAttribute('height', H);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var paths = '';
    curPairs.forEach(function (pr) {
      var a = nodes[pr[0]], b = nodes[pr[1]];
      if (!a || !b) return;
      var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      var x1 = ra.right - wr.left + wrap.scrollLeft, y1 = ra.top + ra.height / 2 - wr.top + wrap.scrollTop;
      var x2 = rb.left - wr.left + wrap.scrollLeft, y2 = rb.top + rb.height / 2 - wr.top + wrap.scrollTop;
      var mx = (x1 + x2) / 2;
      paths += '<path d="M' + x1.toFixed(1) + ' ' + y1.toFixed(1)
        + ' C' + mx.toFixed(1) + ' ' + y1.toFixed(1) + ',' + mx.toFixed(1) + ' ' + y2.toFixed(1)
        + ',' + x2.toFixed(1) + ' ' + y2.toFixed(1) + '" fill="none" stroke="' + (pr[2] || '#1F7AF0')
        + '" stroke-width="1.6" opacity=".55"/>';
    });
    svg.innerHTML = paths;
  }

  function renderMap(ov, empId) {
    var wrap = ov.querySelector('[data-ezjc-wrap]');
    if (!wrap) return;
    wrap.innerHTML = mapBodyHTML(empId);
    requestAnimationFrame(function () { drawLines(wrap); });
    setTimeout(function () { drawLines(wrap); }, 120);   /* 폰트 로딩 후 보정 */
  }

  function openLinkMap(empId) {
    injectStyle();
    closeLinkMap();
    var subj = subjects();
    var first = empId || (subj[0] && subj[0].emp_id) || cu().emp_id;
    var selHTML = '<select data-ezjc="subj">' + subj.map(function (s) {
      return '<option value="' + esc(s.emp_id) + '"' + (s.emp_id === first ? ' selected' : '') + '>'
        + esc(s.name) + (s.jobTitle ? ' · ' + esc(s.jobTitle) : '') + '</option>';
    }).join('') + '</select>';
    var ov = document.createElement('div');
    ov.className = 'ezjc-mapov';
    ov.setAttribute('data-ezjc-mapov', '1');
    ov.innerHTML = '<div class="ezjc-map">'
      + '<div class="ezjc-maphead"><span class="tt">목표–직무 연결 지도</span>'
      + '<span class="ezjc-chip">기준 시점 · 2026 상반기</span>'
      + '<button class="ezjc-mapx" data-ezjc="mapclose" title="닫기">✕</button>'
      + '<div class="sub">사업전략부터 평가까지, 데이터가 어떻게 이어지는지 봅니다</div></div>'
      + '<div class="ezjc-subj"><span>대상</span>' + selHTML
      + '<span class="ezjc-legend">테두리 강조 = 연결됨 · 흐림 = 미연결 · 연결선 = 실제 데이터 참조</span></div>'
      + '<div class="ezjc-mapwrap" data-ezjc-wrap></div>'
      + '</div>';
    document.body.appendChild(ov);
    renderMap(ov, first);
  }
  function closeLinkMap() {
    var ov = document.querySelector('[data-ezjc-mapov]');
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
  }

  /* ============================================================
     4) 목표–직무 연결 품질 지표 카드 (HR/경영진, #s-appr 평가 탭)
     ============================================================ */
  function qualityHTML() {
    var es = arr('employees'), os = arr('objectives'), ks = arr('keyResults');
    function pctOf(n, t) { return t ? Math.round(n / t * 100) + '%' : '—'; }
    var tiles = [
      [pctOf(es.filter(function (e) { return e.jobProfileId != null && e.jobProfileId !== ''; }).length, es.length), '직무 프로파일 연결률'],
      [pctOf(os.filter(function (o) { return !!o.strategy_theme_id; }).length, os.length), '목표의 전략 연결률'],
      [pctOf(ks.filter(function (k) { return !!k.job_task_ref; }).length, ks.length), 'KR 직무 근거 보유율'],
      [pctOf(ks.filter(function (k) { return !!k.difficulty_basis; }).length, ks.length), 'KR 난이도 근거 보유율'],
      [pctOf(ks.filter(function (k) { return /[0-9%]/.test(String(k.target_value || '')); }).length, ks.length), '측정 가능 KR 비율']
    ];
    return '<div class="ezjc-quality" data-ezjc-quality>'
      + '<div class="ezjc-qhead"><h3>목표–직무 연결 품질</h3>'
      + '<button class="ezjc-qlink" data-ezjc="map">🧭 연결 지도 열기</button></div>'
      + '<div class="ezjc-qcap">직무 근거가 있는 목표가 평가 갈등을 줄입니다 · 기준 시점 2026 상반기</div>'
      + '<div class="tx-kpi">' + tiles.map(function (t) {
          return '<div class="c"><div class="n">' + esc(t[0]) + '</div><div class="l">' + esc(t[1]) + '</div></div>';
        }).join('') + '</div>'
      + '</div>';
  }

  /* ============================================================
     주입 — 진입 버튼(성과/평가 헤더) + 품질 카드 (멱등)
     ============================================================ */
  var BTN_HTML = '<button class="ghost-btn ezjc-mapbtn" data-ezjc="map" data-ezjc-btn>🧭 연결 지도</button>';
  function tryInject() {
    injectStyle();
    /* #s-perf 목표 현황 헤더 (tx_fix_perf가 통째로 재구성 → 재주입 필요) */
    var ph = document.querySelector('#s-perf .subpage[data-p="0"] .perf-head');
    if (ph && !ph.querySelector('[data-ezjc-btn]')) {
      (ph.querySelector('.btns') || ph).insertAdjacentHTML('beforeend', BTN_HTML);
    }
    /* #s-appr 평가 현황 헤더 */
    var ah = document.querySelector('#s-appr .subpage[data-p="0"] .ap-head');
    if (ah && !ah.querySelector('[data-ezjc-btn]')) {
      (ah.querySelector('.r') || ah).insertAdjacentHTML('beforeend', BTN_HTML);
    }
    /* 품질 지표 카드 — HR/경영진 관점에서만 */
    var rk = roleKey();
    if ((rk === 'hr' || rk === 'exec') && ah && !document.querySelector('[data-ezjc-quality]')) {
      ah.insertAdjacentHTML('afterend', qualityHTML());
    }
  }

  /* ============================================================
     이벤트 위임 + 부트스트랩
     ============================================================ */
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.getAttribute && t.getAttribute('data-ezjc-mapov')) { closeLinkMap(); return; }
    var act = t && t.closest ? t.closest('[data-ezjc]') : null;
    if (!act) return;
    var k = act.getAttribute('data-ezjc');
    if (k === 'map') { openLinkMap(); return; }
    if (k === 'mapclose') { closeLinkMap(); return; }
    if (k === 'drawer') { openProfileDrawer(act.getAttribute('data-emp')); return; }
    if (k === 'mission-more') {
      var host = act.parentNode;
      var m = host && host.querySelector ? host.querySelector('[data-ezjc-mission]') : null;
      if (m) {
        var clamped = m.classList.toggle('clamp');
        act.textContent = clamped ? '더보기' : '접기';
      }
      return;
    }
    if (k === 'area') {
      var nx = act.nextElementSibling;
      if (nx && nx.classList.contains('ezjc-tasks')) {
        var hidden = nx.style.display === 'none';
        nx.style.display = hidden ? '' : 'none';
        var cv = act.querySelector('.cv');
        if (cv) cv.textContent = hidden ? '⌃' : '⌄';
      }
      return;
    }
  });

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t && t.matches && t.matches('[data-ezjc="subj"]')) {
      var ov = t.closest('.ezjc-mapov');
      if (ov) renderMap(ov, t.value);
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeLinkMap();
  });

  function boot() {
    injectStyle();
    tryInject();
    /* tx_fix_perf/tx_fix_appr는 DOMContentLoaded+60ms 이후 재구성 → 폴링으로 결선 */
    var tries = 0;
    var poll = setInterval(function () {
      tries++; tryInject();
      if (tries >= 20) clearInterval(poll);
    }, 300);
    ['s-perf', 's-appr'].forEach(function (sid) {
      var sec = document.getElementById(sid);
      if (sec && window.MutationObserver) {
        var mo = new MutationObserver(function () { tryInject(); });
        mo.observe(sec, { childList: true, subtree: true });
      }
    });
    try {
      if (window.TXFIX && window.TXFIX.onSection) {
        window.TXFIX.onSection('s-perf', tryInject);
        window.TXFIX.onSection('s-appr', tryInject);
      }
    } catch (e) { /* ignore */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* ---------------- 전역 노출 ---------------- */
  window.EZJob = {
    panelHTML: panelHTML,
    openProfileDrawer: openProfileDrawer,
    openLinkMap: openLinkMap,
    openMap: openLinkMap,
    closeLinkMap: closeLinkMap,
    profileOf: profileOf,
    qualityHTML: qualityHTML
  };
})();
