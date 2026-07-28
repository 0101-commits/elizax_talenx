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
  function compFacets(id) {
    var cs = arr('competencies');
    for (var i = 0; i < cs.length; i++) if (cs[i] && cs[i].dimension_id === id) return (cs[i].facets || []).join(' · ');
    return '';
  }
  /* 직무 기준 역량 가중치 (enrich_job_links.py가 생성한 competency_profile) */
  function compProfile(jp) {
    return (jp && Array.isArray(jp.competency_profile)) ? jp.competency_profile : [];
  }
  /* 스킬 사전 — skill_id → {name, category} */
  var _skillIdx = null;
  function skillIdx() {
    if (_skillIdx) return _skillIdx;
    _skillIdx = {};
    (arr('skillDict') || []).forEach(function (s) { if (s && s.skill_id) _skillIdx[s.skill_id] = s; });
    return _skillIdx;
  }
  /* 직무 기대 스킬을 분류별로 묶음 → [{cat, names:[]}] (사전 없으면 단일 그룹) */
  function skillsByCat(jp) {
    var names = (jp && jp.skills) || [];
    var ids = (jp && jp.skill_ids) || [];
    var idx = skillIdx();
    var byCat = {}, order = [];
    names.forEach(function (n, i) {
      var e = ids[i] ? idx[ids[i]] : null;
      var cat = (e && e.category) || '기타';
      if (!byCat[cat]) { byCat[cat] = []; order.push(cat); }
      byCat[cat].push(n);
    });
    return order.map(function (c) { return { cat: c, names: byCat[c] }; });
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
      /* ≤1100px 계약 — 패널을 없애지 않는다. 요약 헤더는 남기고 본문만 접는다.
         목표 생성 폼의 carry 패널(tx_fix_perf)과 같은 브레이크포인트를 쓰되,
         carry가 모달로 빠지는 자리에서 이쪽은 인라인 펼치기로 접근 경로를 준다. */
      '.ezjc-cotoggle{display:none;margin-left:auto;flex:none;align-items:center;gap:4px;font:inherit;font-size:11px;font-weight:700;color:var(--blue,#1F7AF0);background:var(--card,#fff);border:1px solid var(--line,#ECEEF2);border-radius:999px;padding:3px 9px;cursor:pointer;white-space:nowrap}',
      '.ezjc-cotoggle:hover{background:var(--blue-soft,#E9F1FE)}',
      '.ezjc-cosum{display:none;font-size:11px;color:var(--ink-3,#9096A3);margin-top:3px;line-height:1.45}',
      '@media(max-width:1100px){',
      '#s-perf .txf-jobpanel{width:100%;flex:1 1 100%;padding:12px 14px}',
      '#s-perf .txf-jobpanel .ezjc-cotoggle{display:inline-flex}',
      '#s-perf .txf-jobpanel .ezjc-cosum{display:block}',
      '#s-perf .txf-jobpanel.ezjc-collapsed .ezjc-ph{padding-bottom:0;border-bottom:none;margin-bottom:0}',
      '#s-perf .txf-jobpanel.ezjc-collapsed > *:not(.ezjc-ph){display:none}',
      '}',
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
      '.ezjc-chip2.comp{color:#5B47CC;background:rgba(123,97,255,.08);border-color:rgba(123,97,255,.25)}',
      '.ezjc-chip2.comp .cw{font-weight:800;color:#7B61FF}',
      '.ezjc-skcat{font-size:10.5px;font-weight:700;color:var(--ink-3,#9096A3);margin:8px 0 4px}',
      '.ezjc-item .sm.kpi b{color:var(--blue-2,#0E63D6)}',
      '.ezjc-dockchip{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:var(--ink-2,#5C6474);background:var(--card,#fff);border:1px solid var(--line,#ECEEF2);border-radius:999px;padding:3px 10px;cursor:pointer;white-space:nowrap}',
      '.ezjc-dockchip:hover{background:var(--blue-soft,#E9F1FE);color:var(--blue-2,#0E63D6)}',
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
      /* 연결선 범례 — 선 색 5종이 각각 무슨 관계인지 (실선/점선만 설명하던 범례 대체) */
      '.ezjc-legend2{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin-top:9px;font-size:10.5px;color:var(--ink-3,#9096A3)}',
      '.ezjc-legend2 .lg{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}',
      '.ezjc-legend2 .lg i{display:inline-block;width:16px;height:2px;border-radius:2px;flex:none}',
      '.ezjc-legend2 .lg i.dash{height:0;background:none;border-top:2px dashed #7B61FF}',
      '.ezjc-legend2 .sep{color:var(--ink-4,#B4B9C4)}',
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
      '.ezjc-quality .tx-kpi{flex-wrap:wrap}',
      '.ezjc-quality .tx-kpi .c{background:var(--card,#fff);min-width:150px}',
      /* 타일 = 드릴다운 진입점. 100%도 클릭 가능 — "미달 0건"도 정보다 */
      '.ezjc-quality .tx-kpi .c.ezjc-qtile{cursor:pointer;transition:border-color .12s,background .12s}',
      '.ezjc-quality .tx-kpi .c.ezjc-qtile:hover,.ezjc-quality .tx-kpi .c.ezjc-qtile:focus-visible{border-color:var(--blue,#1F7AF0);background:var(--blue-soft,#E9F1FE);outline:none}',
      '.ezjc-quality .tx-kpi .c .qn{font-size:10.5px;color:var(--ink-4,#B4B9C4);margin-top:5px;line-height:1.45}',
      '.ezjc-quality .tx-kpi .c .qn b{font-weight:800;color:#B45309}',
      '.ezjc-quality .tx-kpi .c .qn b.ok{color:#15803D}',
      /* --- 미달 항목 드릴다운 --- */
      '.ezjc-qdsum{font-size:12.5px;color:var(--ink-2,#5C6474);line-height:1.6;background:var(--soft,#F5F6F8);border-radius:9px;padding:10px 12px;margin-bottom:12px}',
      '.ezjc-qdsum b{color:var(--ink,#2A2E39)}',
      '.ezjc-qdok{font-size:12.5px;font-weight:700;color:#15803D;background:rgba(21,128,61,.07);border:1px solid rgba(21,128,61,.25);border-radius:9px;padding:14px 14px;line-height:1.6}',
      '.ezjc-qrow{display:flex;flex-wrap:wrap;align-items:flex-start;gap:6px 10px;padding:9px 4px;border-bottom:1px solid var(--line,#ECEEF2);font-size:12px}',
      '.ezjc-qrow .w{flex:none;width:96px;font-weight:700;color:var(--ink,#2A2E39);line-height:1.45}',
      '.ezjc-qrow .t{flex:1;min-width:0;color:var(--ink,#2A2E39);line-height:1.45;word-break:break-word}',
      '.ezjc-qrow .t .s{display:block;font-size:10.5px;color:var(--ink-3,#9096A3);margin-top:2px}',
      /* order:2 = 사유 줄은 버튼 뒤, 항상 새 줄 (flex-basis:100%) */
      '.ezjc-qrow .y{order:2;flex-basis:100%;padding-left:106px;font-size:11px;color:#B45309;line-height:1.45}',
      '.ezjc-qgo{flex:none;border:1px solid var(--line,#ECEEF2);background:var(--card,#fff);color:var(--blue-2,#0E63D6);border-radius:6px;font-size:10.5px;font-weight:700;padding:3px 8px;cursor:pointer;white-space:nowrap}',
      '.ezjc-qgo:hover{background:var(--blue-soft,#E9F1FE)}',
      '@media(max-width:760px){.ezjc-qrow .y{padding-left:0}}',
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
  /* 직무 기준 핵심 역량 칩 — 가중치순, hover에 하위 요소(facets) */
  function compChips(jp, max) {
    var cp = compProfile(jp).slice(0, max || 3);
    if (!cp.length) return '';
    return '<div class="ezjc-chips">' + cp.map(function (c) {
      return '<span class="ezjc-chip2 comp" title="' + esc(compFacets(c.dimension_id)) + '">'
        + esc(c.dimension_id) + ' ' + esc(compName(c.dimension_id))
        + ' <b class="cw">' + esc(c.weight) + '%</b></span>';
    }).join('') + '</div>';
  }


  /* ============================================================
     1) 목표 생성 오버레이 패널 — window.EZJob.panelHTML(emp)
     ============================================================ */
  /* 접힌 상태에서도 "무엇이 들어 있는지"는 알아야 한다 — 헤더용 한 줄 요약 */
  function panelSummary(jp) {
    if (!jp) return '직무 프로파일 미연결';
    var tasks = jp.tasks || {}, n = 0;
    Object.keys(tasks).forEach(function (a) { n += (tasks[a] || []).length; });
    return '과업 ' + n + ' · 기대 스킬 ' + ((jp.skills || []).length) + ' · 역량 ' + compProfile(jp).length;
  }
  function panelHTML(emp) {
    injectStyle();
    emp = emp || cu();
    var jp = profileOf(emp);
    /* ezjc-collapsed는 ≤1100px에서만 효력 — 넓은 화면은 지금까지와 동일하게 펼친 상태 */
    var h = '<div class="txf-jobpanel ezjc-collapsed" data-ezjc-panel>'
      + '<div class="ezjc-ph"><span class="ic">🧩</span><div><b>내 직무 기준</b>'
      + '<div class="jt">' + esc(emp.jobTitle || '직무 미지정') + '</div>'
      + '<div class="ezjc-cosum">' + esc(panelSummary(jp)) + '</div></div>'
      + '<button type="button" class="ezjc-cotoggle" data-ezjc="collapse" '
      + 'title="좁은 화면에서 직무 기준 패널을 펼치거나 접습니다">⌄ 펼치기</button></div>';
    if (!jp) {
      h += '<div class="ezjc-missing">⚠ 직무 프로파일 미연결 — HR에 연결을 요청하세요</div>'
        + '<div class="ezjc-note">✦ 직무 기준이 연결되면 과업·기대 스킬을 근거로 AI가 KR을 추천합니다.</div>';
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
        + skillsChips(jp.skills, 8)
        + (compProfile(jp).length
            ? '<div class="ezjc-sec">직무 기준 역량</div>' + compChips(jp, 3)
            : '');
    }
    /* 지난 사이클 이어받기는 목표 생성 폼의 '이어받은 출발점' 패널이 단일 원천이다.
       같은 정보를 여기서 다시 그리면 어느 쪽이 기능인지 알 수 없다 (F3). */
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
        + skillsByCat(jp).map(function (g) {
            return '<div class="ezjc-skcat">' + esc(g.cat) + '</div>' + skillsChips(g.names, 12);
          }).join('')
        + (compProfile(jp).length
            ? '<div class="ezjc-sec">직무 기준 역량 (가중치)</div>' + compChips(jp, 5)
            : '');
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
  /* 과업명 + 역량id 합성 키의 구분자. 과업명에 등장하지 않는 문자여야 하고,
     소스에서 눈에 보여야 한다 — 이전에는 불가시 제어문자라 빈 문자열로 오독됐다. */
  var SEP = '§';

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
        if (ar) areaComp[ar + SEP + k.competency_id] = 1;
      }
    });
    Object.keys(areaComp).forEach(function (pk) {
      var pp = pk.split(SEP);
      if (pp.length !== 2 || !pp[0] || !pp[1]) return;
      curPairs.push(['a:' + pp[0], 'c:' + pp[1], '#B45309']);
    });
    var ev = evalOf(e.emp_id);
    if (ev) Object.keys(linkedComps).forEach(function (cid) {
      curPairs.push(['c:' + cid, 'ev:1', '#5C6474']);
    });
    /* 직무 기준 역량 — 프로파일에 정의된 사전 연결 (점선) */
    var profComps = {};
    compProfile(jp).forEach(function (c) { profComps[c.dimension_id] = c.weight; });
    Object.keys(profComps).slice(0, 3).forEach(function (cid) {
      curPairs.push(['p:1', 'c:' + cid, '#7B61FF', 'dash']);
    });

    /* ---- 컬럼 렌더 ---- */
    var c1 = ths.map(function (t) {
      var hl = !!themeTo[t.theme_id];
      var kpi = (t.kpis && t.kpis[0]) || null;
      return '<div class="ezjc-item' + (hl ? ' hl' : ' dim') + '" data-jm="t:' + esc(t.theme_id) + '">'
        + '<b>' + esc(t.theme_id) + '</b> ' + esc(t.name)
        + (t.description ? '<div class="sm">' + esc(t.description) + '</div>' : '')
        + (kpi ? '<div class="sm kpi">KPI · ' + esc(kpi.name) + ' <b>' + esc(kpi.target) + '</b> (' + esc(kpi.current) + ')</div>' : '')
        + (t.owner_org ? '<div class="sm">주관 · ' + esc(t.owner_org) + '</div>' : '')
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
          var pw = profComps[c.dimension_id];
          return '<div class="ezjc-item' + (hl ? ' hl' : (pw ? '' : ' dim')) + '" data-jm="c:' + esc(c.dimension_id) + '">'
            + '<b>' + esc(c.dimension_id) + '</b> ' + esc(c.name)
            + (pw ? '<div class="sm">직무 기준 가중치 ' + esc(pw) + '%</div>' : '')
            + '</div>';
        }).join('') : '<div class="ezjc-item dim">역량 사전이 없습니다</div>');

    var h25 = histOf(e.emp_id, 'FY2025'), h24 = histOf(e.emp_id, 'FY2024');
    var c6 = '<div class="ezjc-item' + (ev ? ' hl' : ' dim') + '" data-jm="ev:1">'
      + '<b>' + (ev ? esc(ev.period || '') + ' 평가 ' + esc(ev.grade || '') + '등급' : '평가 기록 없음') + '</b>'
      + (ev && ev.rationale_summary ? '<div class="sm">' + esc(ev.rationale_summary) + '</div>' : '')
      + '<div class="sm" style="color:#15803D">확정 근거로 연결</div></div>'
      + ((h24 || h25)
          ? '<div class="ezjc-item"><div class="sm" style="margin:0">성과 기록</div>'
            + (h24 ? 'FY2024 ' + esc(h24.grade) : '') + (h24 && h25 ? ' → ' : '')
            + (h25 ? 'FY2025 ' + esc(h25.grade) : '') + '</div>'
          : '');

    var bodies = [c1, c2, c3, c4, c5, c6];
    var colsHTML = COLS.map(function (c, i) {
      return '<div class="ezjc-col"><div class="ch"><span class="step">' + (i + 1) + '</span>' + esc(c.t) + '</div>'
        + '<div class="cap">' + esc(c.cap) + '</div>' + bodies[i] + '</div>';
    }).join('');

    var krWithJob = myKrs.filter(function (k) { return k.job_task_ref && k.job_task_ref.task_area; }).length;
    var summary = '연결선 ' + curPairs.length + '개 · KR 직무 근거 ' + krWithJob + '/' + myKrs.length + '건'
      + ' · 참조 역량 ' + Object.keys(linkedComps).length + '종'
      + (jp ? ' · 직무 기준 역량 ' + Math.min(3, compProfile(jp).length) + '종(점선)' : '');
    return '<svg class="ezjc-svg" data-ezjc-svg></svg>'
      + '<div class="ezjc-cols">' + colsHTML + '</div>'
      + '<div class="ezjc-note"><b>연결 요약</b> · ' + esc(summary) + '</div>'
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
        + '" stroke-width="1.6" opacity=".55"' + (pr[3] === 'dash' ? ' stroke-dasharray="5 4"' : '') + '/>';
    });
    svg.innerHTML = paths;
  }

  /* 연결선 색 = 관계 종류. 범례가 없으면 5색이 장식으로 보인다 */
  var LINE_LEGEND = [
    ['#7B61FF', '전략 테마 → 조직 목표'],
    ['#1F7AF0', '조직 목표 → 내 목표'],
    ['#0E9F6E', 'KR → 직무 과업'],
    ['#B45309', '직무 과업 → 역량'],
    ['#5C6474', '역량 → 평가 근거']
  ];
  function legendHTML() {
    return '<div class="ezjc-legend2">'
      + LINE_LEGEND.map(function (l) {
          return '<span class="lg"><i style="background:' + l[0] + '"></i>' + esc(l[1]) + '</span>';
        }).join('')
      + '<span class="lg"><i class="dash"></i>점선 · 직무 기준(사전 정의)</span>'
      + '<span class="lg sep">테두리 강조 = 연결됨 · 흐림 = 미연결</span>'
      + '</div>';
  }

  /* 선은 DOM 좌표로 그려지므로 리사이즈·스크롤로 배치가 바뀌면 다시 계산해야 한다.
     렌더 시점 2회 호출만으로는 창을 줄이는 순간 선이 엉뚱한 곳에 남는다. */
  var _redrawTimer = null, _winRedrawOn = false;
  function scheduleRedraw() {
    if (_redrawTimer) clearTimeout(_redrawTimer);
    _redrawTimer = setTimeout(function () {
      _redrawTimer = null;
      var ov = document.querySelector('[data-ezjc-mapov]');
      var wrap = ov && ov.querySelector('[data-ezjc-wrap]');
      if (wrap) drawLines(wrap);
    }, 80);
  }
  function bindRedraw(ov) {
    if (!_winRedrawOn) { window.addEventListener('resize', scheduleRedraw); _winRedrawOn = true; }
    /* 오버레이 스코프 리스너는 노드와 함께 사라진다 */
    var wrap = ov.querySelector('[data-ezjc-wrap]');
    var card = ov.querySelector('.ezjc-map');
    if (wrap) wrap.addEventListener('scroll', scheduleRedraw);
    if (card) card.addEventListener('scroll', scheduleRedraw);
  }
  function unbindRedraw() {
    if (_winRedrawOn) { window.removeEventListener('resize', scheduleRedraw); _winRedrawOn = false; }
    if (_redrawTimer) { clearTimeout(_redrawTimer); _redrawTimer = null; }
  }

  function renderMap(ov, empId) {
    var wrap = ov.querySelector('[data-ezjc-wrap]');
    if (!wrap) return;
    wrap.innerHTML = mapBodyHTML(empId);
    requestAnimationFrame(function () { drawLines(wrap); });
    setTimeout(function () { drawLines(wrap); }, 120);   /* 폰트 로딩 후 보정 */
  }

  /* 열 때마다 오버레이를 새로 만든다(캐시 없음) — 역할·직무·대상자가 바뀌면
     subjects()/mapBodyHTML()이 그 시점 데이터로 다시 계산된다. */
  function openLinkMap(empId) {
    injectStyle();
    closeLinkMap();
    var subj = subjects();
    var first = empId || (subj[0] && subj[0].emp_id) || cu().emp_id;
    /* 드릴다운에서 넘어온 대상자가 기본 목록(subjects())에 없으면 목록 앞에 끼운다.
       그러지 않으면 select는 첫 사람을, 본문은 요청받은 사람을 가리키는 불일치가 난다. */
    var inList = false;
    subj.forEach(function (s) { if (s && s.emp_id === first) inList = true; });
    if (!inList) {
      var target = empBy(first);
      if (target) subj = [target].concat(subj);
      else first = (subj[0] && subj[0].emp_id) || cu().emp_id;
    }
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
      + '<div class="ezjc-subj"><span>대상</span>' + selHTML + '</div>'
      + legendHTML()
      + '<div class="ezjc-mapwrap" data-ezjc-wrap></div>'
      + '</div>';
    document.body.appendChild(ov);
    renderMap(ov, first);
    bindRedraw(ov);
  }
  function closeLinkMap() {
    var ov = document.querySelector('[data-ezjc-mapov]');
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    unbindRedraw();
  }

  /* ============================================================
     4) 목표–직무 연결 품질 지표 카드 (HR/경영진, #s-appr 평가 탭)
     ============================================================ */
  var QD_MAX_ROWS = 200;   /* 드릴다운 표시 상한 — 넘으면 남은 건수를 한 줄로 알린다 */

  /* 지표 6종을 "퍼센트"가 아니라 "모집단 · 미달 항목 목록"까지 계산한다.
     100%만 늘어선 카드는 신호가 없다 — 무엇이 미달인지 열어볼 수 있어야 지표다. */
  function qualityMetrics() {
    var es = arr('employees'), os = arr('objectives'), ks = arr('keyResults');
    var oIdx = {};
    os.forEach(function (o) { if (o) oIdx[o.objective_id] = o; });
    function ownerOfObj(o) {
      var e = o ? empBy(o.owner_emp_id) : null;
      return { emp: (o && o.owner_emp_id) || '', who: (e && e.name) || (o && o.owner_emp_id) || '소유자 미상' };
    }
    function krMetric(key, label, ok, why) {
      var miss = ks.filter(function (k) { return !ok(k); });
      return {
        key: key, label: label, unit: 'KR', total: ks.length, miss: miss.length,
        rows: miss.map(function (k) {
          var o = oIdx[k.objective_id], ow = ownerOfObj(o);
          return {
            emp: ow.emp, who: ow.who,
            what: (k.kr_id || 'KR') + ' · ' + (k.name || ''),
            sub: o ? o.title : (k.objective_id || ''),
            why: why
          };
        })
      };
    }
    var empMiss = es.filter(function (e) { return !(e.jobProfileId != null && e.jobProfileId !== ''); });
    var objMiss = os.filter(function (o) { return o && !o.strategy_theme_id; });
    return [
      {
        key: 'emp-jp', label: '직무 프로파일 연결률', unit: '명', total: es.length, miss: empMiss.length,
        rows: empMiss.map(function (e) {
          return {
            emp: e.emp_id, who: e.name || e.emp_id,
            what: e.jobTitle || '직무 미지정', sub: e.orgName || '',
            why: 'jobProfileId 없음 — 직무 기준 없이 목표를 세우게 됩니다'
          };
        })
      },
      {
        key: 'obj-st', label: '목표의 전략 연결률', unit: '목표', total: os.length, miss: objMiss.length,
        rows: objMiss.map(function (o) {
          var ow = ownerOfObj(o);
          return {
            emp: ow.emp, who: ow.who, what: o.title || o.objective_id,
            sub: (LEVEL_KR[o.level] || o.level || '') + (o.period ? ' · ' + o.period : ''),
            why: 'strategy_theme_id 없음 — 전략 기여를 설명할 근거가 없습니다'
          };
        })
      },
      krMetric('kr-job', 'KR 직무 근거 보유율', function (k) { return !!k.job_task_ref; },
        'job_task_ref 없음 — 어느 직무 과업을 측정하는지 불명'),
      krMetric('kr-comp', 'KR 역량 연결률', function (k) { return !!k.competency_id; },
        'competency_id 없음 — 평가 역량과 연결되지 않음'),
      krMetric('kr-diff', 'KR 난이도 근거 보유율', function (k) { return !!k.difficulty_basis; },
        'difficulty_basis 없음 — 난이도 등급의 근거가 비어 있음'),
      krMetric('kr-meas', '측정 가능 KR 비율', function (k) { return /[0-9%]/.test(String(k.target_value || '')); },
        '목표값에 수치·%가 없음 — 달성 여부를 판정할 수 없음')
    ];
  }
  function metricBy(key) {
    var ms = qualityMetrics();
    for (var i = 0; i < ms.length; i++) if (ms[i].key === key) return ms[i];
    return null;
  }

  /* 타일 클릭 → 미달 항목 목록. 미달 0건이면 "0건"이라는 사실 자체를 보여준다 */
  function openQualityDetail(key) {
    var m = metricBy(key);
    if (!m) return;
    var meId = cu().emp_id;
    var canLedger = !!(window.EZLedger && window.EZLedger.openPanel);
    var shown = m.rows.slice(0, QD_MAX_ROWS);
    var pct = m.total ? Math.round((m.total - m.miss) / m.total * 100) : 0;
    var head = '<div class="ezjc-qdsum">모집단 <b>' + m.total + ' ' + esc(m.unit) + '</b> 중 충족 <b>'
      + (m.total - m.miss) + '</b> · 미달 <b>' + m.miss + '</b>건 (' + pct + '%)'
      + '<br>기준 시점 2026 상반기 · 항목을 누르면 그 사람 기준으로 연결 지도를 엽니다</div>';
    var body = document.createElement('div');
    if (!m.miss) {
      body.innerHTML = head
        + '<div class="ezjc-qdok">✓ 미달 0건 — 모집단 ' + m.total + ' ' + esc(m.unit)
        + ' 전부가 이 기준을 충족합니다. 이 지표에서는 조치할 항목이 없습니다.</div>';
    } else {
      body.innerHTML = head + shown.map(function (r) {
        return '<div class="ezjc-qrow"><div class="w">' + esc(r.who) + '</div>'
          + '<div class="t">' + esc(r.what) + (r.sub ? '<span class="s">' + esc(r.sub) + '</span>' : '') + '</div>'
          + '<div class="y">' + esc(r.why) + '</div>'
          + (r.emp ? '<button type="button" class="ezjc-qgo" data-qgo="map" data-emp="' + esc(r.emp) + '">연결 지도 →</button>' : '')
          + (canLedger && r.emp && r.emp === meId ? '<button type="button" class="ezjc-qgo" data-qgo="ledger">원장 →</button>' : '')
          + '</div>';
      }).join('')
        + (m.rows.length > shown.length
            ? '<div class="ezjc-note">외 ' + (m.rows.length - shown.length) + '건 — 상위 ' + QD_MAX_ROWS + '건만 표시합니다.</div>'
            : '');
    }
    var handle = null;
    body.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-qgo]') : null;
      if (!b) return;
      e.preventDefault();
      if (handle && handle.close) handle.close();
      if (b.getAttribute('data-qgo') === 'ledger') {
        try { window.EZLedger.openPanel(); } catch (err) { /* 원장 미탑재 */ }
        return;
      }
      openLinkMap(b.getAttribute('data-emp'));
    });
    handle = window.TX && window.TX.modal
      ? window.TX.modal({ title: m.label + ' — 미달 항목', body: body, wide: true, actions: [{ label: '닫기', kind: 'ghost' }] })
      : null;
  }

  function qualityHTML() {
    var ms = qualityMetrics();
    return '<div class="ezjc-quality" data-ezjc-quality>'
      + '<div class="ezjc-qhead"><h3>목표–직무 연결 품질</h3>'
      + '<button class="ezjc-qlink" data-ezjc="map">🧭 연결 지도 열기</button></div>'
      + '<div class="ezjc-qcap">직무 근거가 있는 목표가 평가 갈등을 줄입니다 · 타일을 누르면 미달 항목을 봅니다 · 기준 시점 2026 상반기</div>'
      + '<div class="tx-kpi">' + ms.map(function (m) {
          var pct = m.total ? Math.round((m.total - m.miss) / m.total * 100) + '%' : '—';
          return '<div class="c ezjc-qtile" data-ezjc="qtile" data-qk="' + esc(m.key) + '" role="button" tabindex="0"'
            + ' title="클릭 → 미달 항목 ' + m.miss + '건 보기">'
            + '<div class="n">' + esc(pct) + '</div><div class="l">' + esc(m.label) + '</div>'
            + '<div class="qn">' + m.total + ' ' + esc(m.unit) + ' 중 ' + (m.total - m.miss)
            + ' · 미달 <b' + (m.miss ? '' : ' class="ok"') + '>' + m.miss + '</b>건</div>'
            + '</div>';
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
    /* elizax 도킹 패널 맥락 칩 — 대화 중에도 내 직무 기준으로 바로 진입 */
    var ctx = document.querySelector('.ezx-panel .ezx-ctx');
    if (ctx && !ctx.querySelector('[data-ezjc-dock]')) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'ezjc-dockchip';
      chip.setAttribute('data-ezjc-dock', '1');
      chip.setAttribute('data-ezjc', 'drawer');
      chip.setAttribute('data-emp', (cu().emp_id || ''));
      chip.title = '내 직무 프로파일 — 미션·주요 과업·기대 스킬·직무 기준 역량';
      chip.innerHTML = '🧩 내 직무';
      ctx.appendChild(chip);
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
    if (k === 'qtile') { openQualityDetail(act.getAttribute('data-qk')); return; }
    if (k === 'collapse') {
      var pnl = act.closest ? act.closest('[data-ezjc-panel]') : null;
      if (pnl) {
        var col = pnl.classList.toggle('ezjc-collapsed');
        act.innerHTML = col ? '⌄ 펼치기' : '⌃ 접기';
      }
      return;
    }
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
    if (e.key === 'Escape') { closeLinkMap(); return; }
    /* 타일은 role="button" — 키보드로도 드릴다운이 열려야 한다 */
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var t = e.target;
    var tile = t && t.closest ? t.closest('[data-ezjc="qtile"]') : null;
    if (!tile) return;
    e.preventDefault();
    openQualityDetail(tile.getAttribute('data-qk'));
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
    qualityHTML: qualityHTML,
    qualityMetrics: qualityMetrics,
    openQualityDetail: openQualityDetail
  };
})();
