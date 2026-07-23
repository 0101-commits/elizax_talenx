/* tx_fix_appr.js — 평가관리(Evaluation) fidelity pass (2026-07-15).
   Runtime patch: rebuilds the 평가 stage-pipeline + 탈렌트 세션 session-cards of
   the #s-appr section to match real talenx. Reads window.TALENX_DATA via TXFIX.
   IIFE · idempotent (marker-based, survives subnav/tab re-render) · no network.
   NOTE: real 평가 = stage pipeline (대상자→본인/상위자→2차 등급 조정→결과 확정);
   탈렌트 세션 = 승급 심사 session cards. NO 9-box / axes / drag / calibration. */
(function () {
  'use strict';
  var F = window.TXFIX; if (!F) return;
  var TX = window.TX || {};
  var D = F.D || window.TALENX_DATA || {};
  var CU = F.CU || {};
  var esc = TX.esc || function (s) { return String(s == null ? '' : s); };

  /* ---------- indexes ---------- */
  var byOrg = {}, evalIx = {};
  (D.employees || []).forEach(function (e) { (byOrg[e.orgName] = byOrg[e.orgName] || []).push(e); });
  (D.evaluations || []).forEach(function (x) { evalIx[x.emp_id] = x; });
  function team(n) { return (byOrg[n] || []); }
  function evalOf(id) { return evalIx[id] || (D.evalByEmp && D.evalByEmp[id]) || null; }
  function mgrOf(e) { return (e && F.emp(e.manager_id)) || CU; }

  var GC = { S: '#C2410C', A: '#1F7AF0', B: '#4B5563', C: '#E23B3B' };

  /* ---------- F3: 난이도 판단 재료 + 보정 데모 (표시 계산만 — 원본 불변) ---------- */
  var DIFF_COEF = { S: 1.15, A: 1.0, B: 0.9 };   // 계약 상수 (데모 계수)
  var krByObj = {};
  (D.keyResults || []).forEach(function (k) { (krByObj[k.objective_id] = krByObj[k.objective_id] || []).push(k); });
  function diffBadge(k) {
    var d = k.difficulty || '-';
    var lab = k.difficulty_basis && k.difficulty_basis.label;
    if (lab) return '<span class="txf-diffb' + (d === 'S' ? ' dS' : '') + '" title="' + esc((k.difficulty_basis.note || '')) + '">난이도 ' + esc(d) + ' · ' + esc(lab) + '</span>';
    return '<span class="txf-diffb nob">난이도 ' + esc(d) + ' · 근거 없음</span>';
  }
  function diffCoefOf(objList) {   // KR 난이도의 가중 평균 계수
    var s = 0, w = 0;
    objList.forEach(function (o) {
      (krByObj[(o || {}).objective_id] || []).forEach(function (k) {
        var wt = parseFloat(k.weight) || 1;
        s += (DIFF_COEF[k.difficulty] || 1) * wt; w += wt;
      });
    });
    return w ? s / w : 1;
  }

  /* ---------- one-time CSS ---------- */
  function styleOnce() {
    if (document.getElementById('txf-appr-style')) return;
    var s = document.createElement('style');
    s.id = 'txf-appr-style';
    s.textContent =
      '#s-appr .txf-selfnote{background:var(--soft);border:1px solid var(--line-2);border-radius:10px;padding:12px 14px;font-size:12.5px;line-height:1.6;color:var(--ink-2);margin-bottom:16px}' +
      '#s-appr .txf-selfbar{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}' +
      '#s-appr .txf-selfbar .ghost-btn,#s-appr .txf-selfbar .hbtn{cursor:pointer;padding:10px 20px;border-radius:9px;font-size:13px;font-weight:700}' +
      '#s-appr .txf-selfbar .ghost-btn{border:1px solid var(--line);background:var(--card);color:var(--ink-2)}' +
      '#s-appr .txf-selfbar .hbtn{border:none;background:var(--blue);color:#fff}' +
      '#s-appr .txfw-form .txfw-tabs{margin-top:4px}' +
      '#s-appr .txf-avwrap{position:relative;flex:none}' +
      '#s-appr .txf-plus{position:absolute;top:-5px;left:-7px;background:var(--ink-2);color:#fff;font-size:9px;font-weight:800;border-radius:20px;padding:1px 4px;line-height:1.4;z-index:1}' +
      '#s-appr .sdot.s-info{background:var(--blue)}' +
      '#s-appr .ap-nm .sdot{position:relative;top:-1px}' +
      '#s-appr .ap-tbl .hbtn{cursor:pointer}' +
      '#s-appr .ap-more a{cursor:pointer}' +
      '#s-appr .ap-filter{cursor:pointer}' +
      '#s-appr .ap-empty2{background:var(--card);border:1px solid var(--line);border-radius:12px;text-align:center;color:var(--ink-3);font-size:13.5px;padding:64px 20px}' +
      '#s-appr .ap-empty2 .rb{margin-top:14px;display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:8px;padding:8px 16px;font-size:13px;font-weight:600;color:var(--ink-2);background:var(--card);cursor:pointer}' +
      '.txf-rcpt{display:flex;flex-direction:column;gap:0}' +
      '.txf-rcpt .rc-top{display:flex;align-items:center;gap:12px;padding:2px 0 16px}' +
      '.txf-gpill{width:44px;height:44px;border-radius:11px;display:grid;place-items:center;color:#fff;font-size:22px;font-weight:800;flex:none}' +
      '.txf-rcpt .rc-sub{font-size:12.5px;color:var(--ink-3);margin-top:3px}' +
      '.txf-rcpt .rc-score{font-size:18px;font-weight:800;color:var(--ink)}' +
      '.txf-rrow{display:flex;justify-content:space-between;align-items:center;padding:11px 0;border-top:1px solid var(--line-2)}' +
      '.txf-rrow .k{font-size:12.5px;color:var(--ink-3)}' +
      '.txf-rrow .v{font-size:13px;font-weight:700;color:var(--ink)}' +
      '.txf-rat{margin-top:14px;padding:12px 14px;background:var(--soft);border-radius:9px;font-size:12.5px;line-height:1.6;color:var(--ink-2)}' +
      '.txf-fld{display:block;margin-bottom:16px}' +
      '.txf-fld>span{display:block;font-size:12.5px;font-weight:700;color:var(--ink-2);margin-bottom:7px}' +
      '.txf-fld select,.txf-fld input{width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 11px;font-size:13px;color:var(--ink);background:var(--card);font-family:inherit}' +
      '.txf-chips{display:flex;flex-wrap:wrap;gap:8px}' +
      '.txf-chip{border:1px solid var(--line);border-radius:20px;padding:6px 13px;font-size:12.5px;font-weight:600;color:var(--ink-2);background:var(--card);cursor:pointer}' +
      '.txf-chip.on{background:var(--blue);border-color:var(--blue);color:#fff}' +
      '.txf-adj{width:100%;border-collapse:collapse}' +
      '.txf-adj th,.txf-adj td{text-align:left;padding:9px 8px;border-bottom:1px solid var(--line-2);font-size:12.5px}' +
      '.txf-adj th{color:var(--ink-3);font-weight:700}' +
      '.txf-adj select{border:1px solid var(--line);border-radius:7px;padding:5px 8px;font-size:12.5px;font-family:inherit}' +
      /* 평가 작성 modal */
      '.txfw-tabs{display:flex;gap:0;border-bottom:1px solid var(--line);margin-bottom:14px}' +
      '.txfw-tabs button{background:none;border:0;border-bottom:2px solid transparent;padding:9px 14px;font-size:13.5px;font-weight:700;color:var(--ink-3);cursor:pointer;font-family:inherit}' +
      '.txfw-tabs button.on{color:var(--ink);border-bottom-color:var(--ink)}' +
      '.txfw-emp{display:flex;align-items:center;gap:11px;margin-bottom:14px}' +
      '.txfw-emp .nm{font-size:14px;font-weight:800;color:var(--ink)}' +
      '.txfw-emp .tm{font-size:12.5px;color:var(--ink-3);margin-top:2px}' +
      '.txfw-rad{display:inline-flex;align-items:center;gap:4px;margin-right:12px;font-size:12.5px;font-weight:700;color:var(--ink-2);cursor:pointer}' +
      '.txfw-op{width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 11px;font-size:13px;color:var(--ink);font-family:inherit;resize:vertical;box-sizing:border-box}' +
      '#s-appr .txfw-done{display:inline-flex;align-items:center;background:var(--blue-soft,#EAF2FE);color:var(--blue);font-size:11.5px;font-weight:800;border-radius:6px;padding:3px 9px;margin-top:6px;width:max-content}' +
      /* 평가 대시보드 modal */
      '.txfd-sec{font-size:12.5px;font-weight:800;color:var(--ink-2);margin:18px 0 10px}' +
      '.txfd-sec.first{margin-top:0}' +
      '.txfd-big{font-size:16px;font-weight:800;color:var(--ink)}' +
      '.txfd-prog{height:10px;background:var(--soft);border-radius:6px;overflow:hidden;margin-top:10px}' +
      '.txfd-prog i{display:block;height:100%;background:var(--blue);border-radius:6px}' +
      '.txfd-bar{display:flex;align-items:center;gap:10px;margin-bottom:8px}' +
      '.txfd-bar .g{width:26px;font-size:12.5px;font-weight:800;color:var(--ink-2)}' +
      '.txfd-bar .tr{flex:1;height:18px;background:var(--soft);border-radius:5px;overflow:hidden}' +
      '.txfd-bar .fl{height:100%;border-radius:5px}' +
      '.txfd-bar .n{width:70px;font-size:12px;color:var(--ink-3)}' +
      '.txfd-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line-2)}' +
      '.txfd-row:last-child{border-bottom:0}' +
      '.txfd-row .nm{font-size:13px;font-weight:700;color:var(--ink)}' +
      '.txfd-row .tm{font-size:12px;color:var(--ink-3)}' +
      '.txfd-pill{margin-left:auto;background:#FDECEC;color:var(--red,#E23B3B);font-size:11.5px;font-weight:800;border-radius:12px;padding:3px 10px}' +
      /* F3 난이도 배지 · 보정 데모 */
      '.txf-krd{display:flex;align-items:center;gap:6px;margin-top:4px;font-size:11.5px;color:var(--ink-3)}' +
      '.txf-krd .knm{max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.txf-diffb{display:inline-block;font-size:10.5px;font-weight:800;border-radius:5px;padding:1px 7px;background:rgba(31,122,240,.08);color:#356CB5;white-space:nowrap}' +
      '.txf-diffb.dS{background:rgba(194,65,12,.08);color:#C2410C}' +
      '.txf-diffb.nob{background:var(--soft);color:var(--ink-3);border:1px dashed var(--line)}' +
      '.txf-coefbox{margin-top:12px;background:var(--soft);border:1px solid var(--line);border-radius:9px;padding:10px 13px;font-size:12.5px;color:var(--ink-2);line-height:1.6}' +
      '.txf-coefbox .c{color:var(--ink-3);font-size:11.5px}' +
      '.txfd-dpill{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);border-radius:14px;padding:3px 11px;font-size:12px;font-weight:700;color:var(--ink-2);margin:0 6px 6px 0}';
    document.head.appendChild(s);
  }

  /* ---------- cell builder ---------- */
  function cell(name, teamName, opt) {
    opt = opt || {};
    var dot = '';
    if (opt.status === 'done') dot = ' <span class="sdot s-done">✓</span>';
    else if (opt.status === 'delay') dot = ' <span class="sdot s-delay"></span>';
    else if (opt.status === 'info') dot = ' <span class="sdot s-info"></span>';
    var etc = opt.etc ? ' <a data-txf="members" data-list="' + (opt.list || '') + '" style="color:var(--ink-2);font-weight:600;text-decoration:underline;text-underline-offset:2px;cursor:pointer">등 ' + opt.etc + '명</a>' : '';
    var plus = opt.plus ? '<span class="txf-plus">+' + opt.plus + '</span>' : '';
    var btn = opt.btn ? '<button class="' + opt.btn.cls + '" ' + (opt.btn.attr || '') + '>' + opt.btn.label + '</button>' : '';
    return '<div class="ap-cell"><span class="txf-avwrap">' + plus + F.avatar(name, 28) + '</span>' +
      '<div class="ap-cbody"><div class="ap-nm">' + esc(name) + etc + dot + '</div>' +
      '<div class="ap-tm">' + esc(teamName) + '</div>' + btn + '</div></div>';
  }
  var LEGEND =
    '<div class="ap-legend">' +
    '<span class="li"><i class="ap-ic ic-partial">✓</i>일부 완료</span>' +
    '<span class="li"><i class="ap-ic ic-done">✓</i>완료</span>' +
    '<span class="li"><i class="ap-ic ic-write">✎</i>평가 작성 완료</span>' +
    '<span class="li"><i class="ap-ic ic-grade">◆</i>등급 조정 완료</span>' +
    '<span class="li"><i class="ap-ic ic-delay"></i>지연중</span></div>';

  /* ---------- role ---------- */
  function roleKey() {
    return (CU && CU._role) ||
      (window.TXRoles && TXRoles.current && TXRoles.current().key) || 'member';
  }
  function hrRep() { return F.emp('EMP-0005') || CU; }

  /* ---------- project (stage pipeline) — role-aware ----------
     mode 'self'  : 대상자=본인(CU). 본인 평가 셀에 '작성'(자기평가). 1·2차·확정은 열람.
     mode 'first' : 대상자=팀원. 1차 상위자 셀(=CU)에 '작성'(1차 평가). 2차·확정 열람.
     mode 'hr'    : 대상자=전사. 2차 등급 조정/결과 확정 셀이 CU(HR). 기존 동작.        */
  function rowCells(t, mode, i) {
    var tn = F.teamName(t), mgr = mgrOf(t), mgrTeam = F.teamName(mgr);
    var done = (i % 3 !== 2);                 // vary: last row of trio still in review
    var writeBtn = { cls: 'ap-btn', label: '작성', attr: 'data-txf="write"' };
    var resultBtn = done ? { cls: 'ap-btn-o', label: '응답 확인', attr: 'data-txf="result" data-emp="' + t.emp_id + '"' } : null;
    var selfC, firstC, secondC, resultC;
    if (mode === 'self') {
      selfC = cell(t.name, tn, { status: done ? 'done' : 'delay', btn: done ? null : writeBtn });
      firstC = cell(mgr.name, mgrTeam, { status: done ? 'done' : 'info' });
      secondC = cell(hrRep().name, F.teamName(hrRep()), { status: 'info' });
      resultC = cell(t.name, tn, { status: done ? 'done' : null, btn: resultBtn });
    } else if (mode === 'first') {
      selfC = cell(t.name, tn, { status: done ? 'done' : 'delay' });            // 팀원 자기평가 — 리더는 열람만
      firstC = cell(CU.name, F.teamName(CU), { status: done ? 'done' : 'info', btn: done ? null : writeBtn });
      secondC = cell((mgrOf(CU) || hrRep()).name, F.teamName(mgrOf(CU) || hrRep()), { status: 'info' });
      resultC = cell(t.name, tn, { status: done ? 'done' : null, btn: resultBtn });
    } else {                                   // hr / exec
      selfC = cell(t.name, tn, { status: done ? 'done' : 'delay', btn: done ? null : writeBtn });
      firstC = cell(mgr.name, mgrTeam, { status: done ? 'done' : 'info' });
      secondC = cell(CU.name, F.teamName(CU));
      resultC = cell(CU.name, F.teamName(CU), { status: done ? 'done' : null, btn: resultBtn });
    }
    return '<tr data-emp="' + t.emp_id + '">' +
      '<td>' + cell(t.name, tn) + '</td>' +
      '<td>' + selfC + '</td>' +
      '<td>' + firstC + '</td>' +
      '<td>' + secondC + '</td>' +
      '<td>' + resultC + '</td>' +
      '</tr>';
  }
  function group(g) {
    var rows = (g.members || []).map(function (t, i) { return rowCells(t, g.mode, i); }).join('');
    if (!rows) rows = '<tr><td colspan="5" style="padding:22px;text-align:center;color:var(--ink-3);font-size:13px">대상자가 없습니다.</td></tr>';
    var adjBtn = g.canAdjust ? '<button class="hbtn" data-txf="adjust">조정 등급 입력</button>' : '';
    return '<div class="ap-group">' + esc(g.label) + '</div>' +
      '<div class="ap-tbl-wrap"><table class="ap-tbl"><thead><tr>' +
      '<th style="width:180px">평가 대상자</th>' +
      '<th>본인 평가<span class="pr">' + g.dates + '</span></th>' +
      '<th>1차 상위자 평가<span class="pr">' + g.dates + '</span></th>' +
      '<th>2차 등급 조정<span class="pr">' + g.dates + '</span>' + adjBtn + '</th>' +
      '<th>결과 확정<span class="pr">' + g.dates + '</span></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function project(p) {
    var groups = p.groups.map(function (gg) {
      return group({ label: gg.label, members: gg.members, mode: p.mode, dates: p.dates, canAdjust: p.canAdjust });
    }).join('');
    return '<div class="ap-proj"><div class="ap-proj-h"><span class="t">' + esc(p.title) + '</span>' + LEGEND + '</div>' + groups + '</div>';
  }

  /* ---------- roster per role ---------- */
  function reportsOf(cu) {
    var r = (D.employees || []).filter(function (e) { return e.manager_id === cu.emp_id; });
    if (!r.length) r = (byOrg[cu.orgName] || []).filter(function (e) { return e.emp_id !== cu.emp_id; });
    return r;
  }
  function orgTrio(name, from, to) { return team(name).slice(from, to); }
  function evalPlan() {
    var rk = roleKey();
    if (rk === 'member') {
      return { mode: 'self', canAdjust: false, canDash: false, canMore: false, projects: [
        { title: '2026 상반기 평가', dates: '03.12 ~ 08.27', groups: [{ label: F.teamName(CU), members: [CU] }] },
        { title: '2025 평가',       dates: '01.02 ~ 06.30', groups: [{ label: F.teamName(CU), members: [CU] }] }
      ] };
    }
    if (rk === 'leader') {
      var rep = reportsOf(CU);
      return { mode: 'first', canAdjust: false, canDash: true, canMore: false, projects: [
        { title: '2026 상반기 평가', dates: '03.12 ~ 08.27', groups: [{ label: F.teamName(CU) + ' 팀', members: rep.slice(0, 6) }] },
        { title: '2025 평가',       dates: '01.02 ~ 06.30', groups: [{ label: F.teamName(CU) + ' 팀', members: rep.slice(0, 6) }] }
      ] };
    }
    // hr / exec — 전사 (기존 하드코딩 BU 로스터 유지 — 전사 관점이라 맥락 정합)
    return { mode: 'hr', canAdjust: rk === 'hr', canDash: true, canMore: true, projects: [
      { title: '2026 상반기 평가', dates: '03.12 ~ 08.27', groups: [
        { label: 'hunel R&D Center', members: orgTrio('hunel R&D Center', 0, 3) },
        { label: 'S1 BU',            members: orgTrio('S1 BU', 0, 3) } ] },
      { title: '2025 평가', dates: '01.02 ~ 06.30', groups: [
        { label: 'E1 BU',            members: orgTrio('E1 BU', 0, 3) },
        { label: 'talenx R&D Center', members: orgTrio('talenx R&D Center', 0, 3) } ] }
    ] };
  }
  var MORE_PROJECT = { title: '2024 하반기 평가', dates: '09.01 ~ 12.20', mode: 'hr', canAdjust: true, groups: [
    { label: 'CS BU', members: [] }, { label: 'E2 BU', members: [] } ] };
  (function fillMore() { MORE_PROJECT.groups[0].members = orgTrio('CS BU', 0, 3); MORE_PROJECT.groups[1].members = orgTrio('E2 BU', 0, 3); })();

  /* ---------- build 평가 subpage ---------- */
  function buildEval(container) {
    var plan = evalPlan();
    var planProjects = plan.projects.map(function (p) {
      return project({ title: p.title, dates: p.dates, groups: p.groups, mode: plan.mode, canAdjust: plan.canAdjust });
    }).join('');
    var dashBtn = plan.canDash
      ? '<button class="ghost-btn" data-txf="dash" style="padding:9px 16px;font-size:13px">대시보드</button>' : '';
    var moreBtn = plan.canMore
      ? '<div class="ap-more"><a data-txf="more">더 보기 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></a></div>' : '';
    // 조직원: 본인 평가만 — '평가 검토'(타인 리뷰) 탭 숨김
    var reviewTab = roleKey() === 'member' ? '' : '<button data-txf="tab" data-tab="2">평가 검토</button>';
    // 조직원(피평가자): 평가자용 대상자 매트릭스 대신 '본인 평가 작성' 폼으로 바로 진입
    var isSelf = plan.mode === 'self';
    var pane0 = isSelf
      ? '<div class="txf-selfnote">아래는 <b>' + esc((CU && CU.name) || '본인') + '</b>님 본인 평가 작성입니다. 확정 등급·근거는 위 <b>검증 가능한 답변</b> 카드에서 확인하세요.</div>' +
        writeFormBody((CU && CU.emp_id) || '') +
        '<div class="txf-selfbar"><button class="ghost-btn" data-txf="self-save">임시저장</button><button class="hbtn" data-txf="self-submit">제출</button></div>'
      : (planProjects + moreBtn);
    var filterBtn = isSelf ? '' :
      '<button class="ap-filter" data-txf="filter" title="필터">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M7 12h10M10 18h4"/></svg>' +
      '<span class="fb">1</span></button>';
    container.innerHTML =
      '<div id="txf-appr0">' +
      '<div class="ap-head"><h2>평가 현황</h2><div class="r">' + dashBtn + filterBtn + '</div></div>' +
      '<div class="ap-tabs">' +
      '<button class="on" data-txf="tab" data-tab="0">평가 작성</button>' +
      '<button data-txf="tab" data-tab="1">결과 확인</button>' +
      reviewTab + '</div>' +
      '<div data-pane="0">' + pane0 +
      '</div>' +
      '<div data-pane="1" style="display:none"><div class="ap-empty2">평가 현황이 없습니다.</div></div>' +
      '<div data-pane="2" style="display:none"><div class="ap-empty2">검색 결과가 없습니다.' +
      '<div><button class="rb" data-txf="filter-reset"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg> 필터 초기화</button></div>' +
      '</div></div>' +
      '</div>';
  }

  /* ---------- 탈렌트 세션 (session cards) ---------- */
  function nameTeamList(emps) { return emps.map(function (e) { return e.emp_id; }).join(','); }
  function tsCard(c) {
    var subj = c.subjects, part = c.participants, host = c.host;
    var subjExtra = subj.length - 1, partExtra = part.length - 1;
    return '<div class="ts-card"><div class="ts-body">' +
      '<div class="ts-top"><span class="ts-title">' + esc(c.title) + '</span><span class="ts-pill">진행중</span></div>' +
      '<div class="ts-date">' + c.date + '</div>' +
      '<div class="ts-row"><div class="lb">대상자</div><div class="vl">' + esc(F.nameTeam(subj[0])) +
      (subjExtra > 0 ? ' <a data-txf="members" data-list="' + nameTeamList(subj) + '">등 ' + subj.length + '명</a>' : '') + '</div></div>' +
      '<div class="ts-row"><div class="lb">참여자</div><div class="vl">' + esc(F.nameTeam(part[0])) +
      (partExtra > 0 ? ' <a data-txf="members" data-list="' + nameTeamList(part) + '">등 ' + part.length + '명</a>' : '') + '</div></div>' +
      '<div class="ts-row"><div class="lb">진행자</div><div class="vl">' + esc(F.nameTeam(host)) + '</div></div>' +
      '</div><button class="ts-join" data-txf="join">참여</button></div>';
  }
  function buildTalent(container) {
    if (roleKey() === 'member') {   // 조직원: 인재 리뷰(승급 심사) 주관/참여 대상 아님
      container.innerHTML =
        '<div id="txf-appr1">' +
        '<div class="ts-headcard"><h2>인재 리뷰</h2></div>' +
        '<div class="ap-empty2">참여 가능한 인재 리뷰 세션이 없습니다.<div style="margin-top:8px;font-size:12.5px;color:var(--ink-4)">인재 리뷰는 조직장·HR이 주관합니다.</div></div>' +
        '</div>';
      return;
    }
    var subj26 = team('E1 BU').slice(0, 3), part26 = team('hunel R&D Center').slice(0, 3);
    var subj25 = team('S1 BU').slice(0, 3), part25 = team('talenx R&D Center').slice(0, 3);
    var cards =
      tsCard({ title: '2026 승급 심사', date: '2026.03.08 ~ 2027.03.08', subjects: subj26, participants: part26, host: CU }) +
      tsCard({ title: '2025 승급 심사', date: '2025.03.08 ~ 2026.03.08', subjects: subj25, participants: part25, host: CU });
    container.innerHTML =
      '<div id="txf-appr1">' +
      '<div class="ts-headcard"><h2>인재 리뷰</h2></div>' +
      '<div class="ts-ftabs"><button class="on" data-txf="ftab" data-ftab="0">진행중</button>' +
      '<button data-txf="ftab" data-ftab="1">마감</button></div>' +
      '<div data-fpane="0"><div class="ts-grid">' + cards + '</div></div>' +
      '<div data-fpane="1" style="display:none"><div class="ap-empty2">마감된 세션이 없습니다.</div></div>' +
      '</div>';
  }

  /* ---------- modals / drawers ---------- */
  function openResult(empId) {
    if (!TX.modal) return;
    var e = F.emp(empId), ev = evalOf(empId);
    var body;
    if (!ev) { body = '<div style="padding:24px 4px;text-align:center;color:var(--ink-3);font-size:13px">확정된 평가 결과가 없습니다.</div>'; }
    else {
      var g = ev.grade, c = ev.components || {}, col = GC[g] || 'var(--ink-2)';
      var r = function (k, v) { return '<div class="txf-rrow"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>'; };
      body = '<div class="txf-rcpt">' +
        '<div class="rc-top"><span class="txf-gpill" style="background:' + col + '">' + g + '</span>' +
        '<div><div class="rc-score">종합 ' + (ev.weighted_score != null ? ev.weighted_score : '-') + '점</div>' +
        '<div class="rc-sub">' + esc((e && e.name) || '') + ' · ' + esc(F.teamName(e)) + ' · ' + (ev.period || '') + '</div></div></div>' +
        r('목표 달성', (c.achievement_norm != null ? c.achievement_norm : '-') + ' / 100') +
        r('동료 평가', (c.peer_strength_norm != null ? c.peer_strength_norm : '-') + ' / 100') +
        r('실행 일관성', (c.exec_consistency_norm != null ? c.exec_consistency_norm : '-') + ' / 100') +
        (ev.rationale_summary ? '<div class="txf-rat">' + esc(ev.rationale_summary) + '</div>' : '') +
        '</div>';
    }
    TX.modal({ title: '결과 확인', body: body, actions: [{ label: '닫기', kind: 'ghost' }] });
  }

  /* ---------- 평가 작성 (write) modal ---------- */
  function objsFor(empId) {
    var e = F.emp(empId) || {};
    var all = D.objectives || [];
    var objs = all.filter(function (o) { return o.owner_emp_id === empId; });
    if (!objs.length) objs = all.filter(function (o) { return o.org_id === e.org_id; });
    if (!objs.length && all.length) {
      var h = 0, s = String(empId || ''), i;
      for (i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997;
      objs = [all[h % all.length], all[(h + 1) % all.length], all[(h + 2) % all.length]];
    }
    return objs.slice(0, 3);
  }
  function radioRow(name) {
    return ['A', 'B', 'C', 'D'].map(function (g) {
      return '<label class="txfw-rad"><input type="radio" name="' + name + '" value="' + g + '"' + (g === 'B' ? ' checked' : '') + '>' + g + '</label>';
    }).join('');
  }
  function writeFormBody(empId) {
    var e = F.emp(empId) || {};
    var objs = objsFor(empId);
    var goalRows = objs.map(function (o, i) {
      o = o || {};
      var krLines = (krByObj[o.objective_id] || []).slice(0, 3).map(function (k) {
        return '<div class="txf-krd"><span class="knm" title="' + esc(k.name) + '">' + esc(k.name) + '</span>' + diffBadge(k) + '</div>';
      }).join('');
      return '<tr><td>' + esc(o.title || '-') + krLines + '</td>' +
        '<td style="white-space:nowrap;color:var(--ink-2);font-weight:700">' + (o.progress != null ? o.progress + '%' : '-') + '</td>' +
        '<td style="white-space:nowrap">' + radioRow('txfw-g' + i) + '</td></tr>';
    }).join('');
    /* 난이도 보정 데모 — 원본 점수는 그대로, 화면 병기만 */
    var ev0 = evalOf(empId);
    var baseScore = ev0 ? (ev0.weighted_score != null ? ev0.weighted_score : (ev0.components && ev0.components.achievement_norm)) : null;
    if (baseScore == null) {
      var ps = 0, pn = 0;
      objs.forEach(function (o) { if (o && o.progress != null) { ps += o.progress; pn++; } });
      if (pn) baseScore = Math.round(ps / pn * 10) / 10;
    }
    var coefBox = '';
    if (baseScore != null) {
      var coef = diffCoefOf(objs);
      var adj = Math.round(baseScore * coef * 10) / 10;
      coefBox = '<div class="txf-coefbox">난이도 보정 데모 — 달성 점수 <b>' + baseScore + '</b> → 난이도 반영 <b>' + adj + '</b>' +
        ' <span class="c">(데모 반영 비율 ×' + (Math.round(coef * 100) / 100) + ' · S 1.15 / A 1.0 / B 0.9 — 핵심 성과 난이도 평균, 원본 점수는 바뀌지 않습니다)</span></div>';
    }
    var compRows = ['커뮤니케이션', '문제해결', '협업', '직무 전문성'].map(function (c, i) {
      return '<tr><td>' + c + '</td><td style="color:var(--ink-3)">공통 역량</td>' +
        '<td style="white-space:nowrap">' + radioRow('txfw-c' + i) + '</td></tr>';
    }).join('');
    return '<div class="txfw-form">' +
      '<div class="txfw-tabs"><button class="on" data-wtab="0">성과평가</button><button data-wtab="1">역량평가</button></div>' +
      '<div class="txfw-emp">' + F.avatar(e.name || '대상자', 36) +
      '<div><div class="nm">' + esc(e.name || empId || '대상자') + '</div>' +
      '<div class="tm">' + esc(F.teamName(e)) + (e.level_kr ? ' · ' + esc(e.level_kr) : '') + '</div></div></div>' +
      '<div data-wpane="0"><table class="txf-adj"><thead><tr><th>목표명</th><th>달성도</th><th>등급</th></tr></thead><tbody>' + goalRows + '</tbody></table>' + coefBox + '</div>' +
      '<div data-wpane="1" style="display:none"><table class="txf-adj"><thead><tr><th>역량 항목</th><th>구분</th><th>등급</th></tr></thead><tbody>' + compRows + '</tbody></table></div>' +
      '<div class="txf-fld" style="margin-top:16px"><span>종합의견</span><textarea class="txfw-op" rows="4" placeholder="평가 근거와 종합 의견을 입력하세요."></textarea></div>' +
      '</div>';
  }
  function openWrite(btn) {
    if (!TX.modal) return;
    var tr = btn.closest('tr');
    var empId = tr ? tr.getAttribute('data-emp') : null;
    var body = writeFormBody(empId);
    var m = TX.modal({
      title: '평가 작성', wide: true, body: body, actions: [
        { label: '임시저장', kind: 'ghost', onClick: function () { TX.toast && TX.toast('임시 저장되었습니다.', 'ok'); return false; } },
        { label: '제출', kind: 'primary', onClick: function () {
          TX.toast && TX.toast('평가를 제출했습니다.', 'ok');
          if (tr && tr.children[1]) {
            var td = tr.children[1];
            var dot = td.querySelector('.sdot');
            if (dot) { dot.className = 'sdot s-done'; dot.textContent = '✓'; }
            else { var nm = td.querySelector('.ap-nm'); if (nm) nm.insertAdjacentHTML('beforeend', ' <span class="sdot s-done">✓</span>'); }
            var wb = td.querySelector('[data-txf="write"]');
            if (wb) { var sp = document.createElement('span'); sp.className = 'txfw-done'; sp.textContent = '완료'; wb.parentNode.replaceChild(sp, wb); }
          }
        } }
      ]
    });
    m.body.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-wtab]'); if (!b) return;
      var ti = b.getAttribute('data-wtab');
      [].forEach.call(m.body.querySelectorAll('[data-wtab]'), function (x) { x.classList.toggle('on', x === b); });
      [].forEach.call(m.body.querySelectorAll('[data-wpane]'), function (p) { p.style.display = (p.getAttribute('data-wpane') === ti) ? '' : 'none'; });
    });
  }

  /* ---------- 평가 대시보드 modal ---------- */
  function openDash() {
    if (!TX.modal) return;
    var emps = D.employees || [], evs = D.evaluations || [];
    var total = emps.length || 221;
    var delayed = emps.filter(function (x, i) { return i % 13 === 4; });
    var done = Math.max(0, total - delayed.length);
    var pct = total ? Math.round(done / total * 100) : 0;
    var dist = { S: 0, A: 0, B: 0, C: 0 };
    if (evs.length) { evs.forEach(function (v) { if (dist[v.grade] != null) dist[v.grade]++; }); }
    else { dist = { S: 11, A: 44, B: 133, C: 33 }; }
    var maxN = 1;
    ['S', 'A', 'B', 'C'].forEach(function (g) { if (dist[g] > maxN) maxN = dist[g]; });
    var bars = ['S', 'A', 'B', 'C'].map(function (g) {
      var n = dist[g], w = Math.max(2, Math.round(n / maxN * 100));
      return '<div class="txfd-bar"><span class="g">' + g + '</span>' +
        '<span class="tr"><span class="fl" style="width:' + w + '%;background:' + (GC[g] || 'var(--ink-3)') + '"></span></span>' +
        '<span class="n">' + n + '명 (' + (total ? Math.round(n / total * 100) : 0) + '%)</span></div>';
    }).join('');
    var lateRows = delayed.slice(0, 6).map(function (x) {
      return '<div class="txfd-row">' + F.avatar(x.name, 30) +
        '<div><div class="nm">' + esc(x.name) + '</div><div class="tm">' + esc(F.teamName(x)) + '</div></div>' +
        '<span class="txfd-pill">본인 평가 지연</span></div>';
    }).join('');
    var body =
      '<div class="txfd-sec first">진행률 요약 — 2026 상반기 평가</div>' +
      '<div class="txfd-big">작성 완료 ' + done + ' <span style="color:var(--ink-3);font-weight:600">/ 전체 ' + total + ' (' + pct + '%)</span></div>' +
      '<div class="txfd-prog"><i style="width:' + pct + '%"></i></div>' +
      '<div class="txfd-sec">등급 분포</div>' + bars;
    /* F3: 난이도 분포 미니 표기 — 수립된 KR 기준 */
    var krAll = D.keyResults || [];
    if (krAll.length) {
      var dd = { S: 0, A: 0, B: 0 }, basisN = 0;
      krAll.forEach(function (k) {
        if (dd[k.difficulty] != null) dd[k.difficulty]++;
        if (k.difficulty_basis && k.difficulty_basis.label) basisN++;
      });
      body += '<div class="txfd-sec">난이도 분포 — 수립된 핵심 성과 ' + krAll.length + '건</div><div>' +
        ['S', 'A', 'B'].map(function (g) {
          return '<span class="txfd-dpill"><b style="color:' + (GC[g] || 'var(--ink-2)') + '">' + g + '</b> ' + dd[g] + '건 (' + Math.round(dd[g] / krAll.length * 100) + '%)</span>';
        }).join('') +
        '<span class="txfd-dpill">근거 기재 ' + Math.round(basisN / krAll.length * 100) + '%</span></div>';
    }
    body += '<div class="txfd-sec">지연자 (' + delayed.length + '명)</div>' + lateRows;
    TX.modal({ title: '평가 대시보드', wide: true, body: body, actions: [{ label: '닫기', kind: 'ghost' }] });
  }

  function openAdjust(btn) {
    if (!TX.modal) return;
    var wrap = btn.closest('.ap-tbl-wrap');
    var trs = wrap ? wrap.querySelectorAll('tbody tr') : [];
    var rowsHtml = '';
    [].forEach.call(trs, function (tr) {
      var id = tr.getAttribute('data-emp'), e = F.emp(id), ev = evalOf(id);
      var cur = ev ? ev.grade : 'B';
      var opts = ['S', 'A', 'B', 'C'].map(function (x) { return '<option' + (x === cur ? ' selected' : '') + '>' + x + '</option>'; }).join('');
      rowsHtml += '<tr><td>' + esc((e && e.name) || id) + '</td><td style="color:var(--ink-3)">' + esc(F.teamName(e)) + '</td>' +
        '<td>' + cur + '</td><td><select>' + opts + '</select></td></tr>';
    });
    var body = '<div style="font-size:12.5px;color:var(--ink-3);margin-bottom:12px">2차 등급 조정 — 대상자별 최종 조정 등급을 입력합니다.</div>' +
      '<table class="txf-adj"><thead><tr><th>대상자</th><th>소속</th><th>현재</th><th>조정 등급</th></tr></thead><tbody>' + rowsHtml + '</tbody></table>';
    TX.modal({ title: '조정 등급 입력', body: body, actions: [
      { label: '취소', kind: 'ghost' },
      { label: '저장', kind: 'primary', onClick: function () { TX.toast && TX.toast('조정 등급이 저장되었습니다.', 'ok'); } }
    ] });
  }

  function openFilter() {
    if (!TX.drawer) { TX.toast && TX.toast('필터'); return; }
    var body =
      '<label class="txf-fld"><span>평가 프로젝트</span><select>' +
      '<option>2026 상반기 평가</option><option>2025 평가</option><option>2024 하반기 평가</option></select></label>' +
      '<div class="txf-fld"><span>직군</span><div class="txf-chips">' +
      ['사무직', '연구직', '영업직', '기술직'].map(function (x, i) { return '<span class="txf-chip' + (i === 0 ? ' on' : '') + '" data-chip>' + x + '</span>'; }).join('') +
      '</div></div>' +
      '<div class="txf-fld"><span>진행 상태</span><div class="txf-chips">' +
      ['진행중', '지연중', '완료'].map(function (x) { return '<span class="txf-chip" data-chip>' + x + '</span>'; }).join('') +
      '</div></div>';
    var dr = TX.drawer({ title: '필터', subtitle: '평가 현황 조건', body: body, width: '380px' });
    dr.body.addEventListener('click', function (ev) {
      var c = ev.target.closest('[data-chip]'); if (c) c.classList.toggle('on');
    });
    var foot = document.createElement('div');
    foot.style.cssText = 'display:flex;gap:8px;margin-top:22px';
    foot.innerHTML = '<button class="tx-btn tx-ghost" style="flex:1">초기화</button><button class="tx-btn tx-primary" style="flex:1">적용</button>';
    dr.body.appendChild(foot);
    foot.children[0].addEventListener('click', function () {
      [].forEach.call(dr.body.querySelectorAll('.txf-chip'), function (c, i) { c.classList.toggle('on', i === 0); });
    });
    foot.children[1].addEventListener('click', function () { dr.close(); TX.toast && TX.toast('필터가 적용되었습니다.', 'ok'); });
  }

  function openMembers(anchor) {
    if (!TX.menu) return;
    var ids = (anchor.getAttribute('data-list') || '').split(',').filter(Boolean);
    var items = ids.map(function (id) { var e = F.emp(id); return { label: e ? F.nameTeam(e) : id }; });
    if (!items.length) return;
    TX.menu(anchor, items);
  }

  /* ---------- delegation (bound once per root) ---------- */
  function bind(root) {
    if (root.dataset.txfBound) return;
    root.dataset.txfBound = '1';
    root.addEventListener('click', function (ev) {
      // inline 자기평가 폼 성과/역량 탭 (본인 평가 작성 화면)
      var wt = ev.target.closest('[data-wtab]');
      if (wt && root.contains(wt)) {
        var form = wt.closest('.txfw-form') || root, ti = wt.getAttribute('data-wtab');
        [].forEach.call(form.querySelectorAll('[data-wtab]'), function (x) { x.classList.toggle('on', x === wt); });
        [].forEach.call(form.querySelectorAll('[data-wpane]'), function (p) { p.style.display = (p.getAttribute('data-wpane') === ti) ? '' : 'none'; });
        return;
      }
      var el = ev.target.closest('[data-txf]'); if (!el || !root.contains(el)) return;
      var act = el.getAttribute('data-txf');
      /* these classes (.ap-btn/.ap-btn-o/.ts-join/.ap-filter) are also caught by the
         tx_revive document-level delegate — stop the event so only one UI opens */
      if (act === 'write' || act === 'result' || act === 'join' || act === 'filter') ev.stopPropagation();
      if (act === 'self-save') { ev.preventDefault(); TX.toast && TX.toast('임시 저장되었습니다.', 'ok'); }
      else if (act === 'self-submit') { ev.preventDefault(); TX.toast && TX.toast('본인 평가를 제출했습니다.', 'ok'); }
      else if (act === 'result') { openResult(el.getAttribute('data-emp')); }
      else if (act === 'write') { openWrite(el); }
      else if (act === 'adjust') { ev.preventDefault(); openAdjust(el); }
      else if (act === 'members') { ev.preventDefault(); openMembers(el); }
      else if (act === 'filter') { openFilter(); }
      else if (act === 'dash') { openDash(); }
      else if (act === 'join') {
        if (el.classList.contains('joined')) { TX.toast && TX.toast('이미 참여 중인 세션입니다.'); }
        else if (TX.confirm) {
          TX.confirm('인재 리뷰 참여', '이 인재 리뷰 세션에 참여하시겠습니까?<br>참여 후 심사 대상자 정보와 평가 자료가 공개됩니다.', function () {
            el.classList.add('joined');
            el.textContent = '참여 중';
            TX.toast && TX.toast('인재 리뷰에 참여했습니다.', 'ok');
          }, '참여');
        }
        else { el.classList.add('joined'); el.textContent = '참여 중'; TX.toast && TX.toast('인재 리뷰에 참여했습니다.', 'ok'); }
      }
      else if (act === 'more') {
        var pane = root.querySelector('[data-pane="0"]');
        var moreWrap = el.parentNode;
        if (pane && !pane.querySelector('#txf-more')) {
          var div = document.createElement('div'); div.id = 'txf-more'; div.innerHTML = project(MORE_PROJECT);
          pane.insertBefore(div, moreWrap);
        }
        moreWrap.remove();
        TX.toast && TX.toast('이전 평가를 모두 불러왔습니다.');
      }
      else if (act === 'tab') {
        var t = el.getAttribute('data-tab');
        [].forEach.call(root.querySelectorAll('.ap-tabs button'), function (b) { b.classList.toggle('on', b === el); });
        [].forEach.call(root.querySelectorAll('[data-pane]'), function (p) { p.style.display = (p.getAttribute('data-pane') === t) ? '' : 'none'; });
        // real: 결과 확인 tab shows no filter badge
        var fb = root.querySelector('.ap-filter .fb'); if (fb) fb.style.display = (t === '1') ? 'none' : '';
      }
      else if (act === 'filter-reset') {
        [].forEach.call(root.querySelectorAll('.ap-tabs button'), function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === '0'); });
        [].forEach.call(root.querySelectorAll('[data-pane]'), function (p) { p.style.display = (p.getAttribute('data-pane') === '0') ? '' : 'none'; });
        TX.toast && TX.toast('필터가 초기화되었습니다.', 'ok');
      }
      else if (act === 'ftab') {
        var f = el.getAttribute('data-ftab');
        [].forEach.call(root.querySelectorAll('.ts-ftabs button'), function (b) { b.classList.toggle('on', b === el); });
        [].forEach.call(root.querySelectorAll('[data-fpane]'), function (p) { p.style.display = (p.getAttribute('data-fpane') === f) ? '' : 'none'; });
      }
    });
  }

  /* ---------- apply (idempotent by marker) ---------- */
  function apply() {
    var root = document.getElementById('s-appr'); if (!root) return;
    if (!(D.employees && D.employees.length)) return;
    styleOnce();
    var c0 = root.querySelector('.subpage[data-p="0"] .container');
    var c1 = root.querySelector('.subpage[data-p="1"] .container');
    if (c0 && !c0.querySelector('#txf-appr0')) buildEval(c0);
    if (c1 && !c1.querySelector('#txf-appr1')) buildTalent(c1);
    bind(root);
  }

  F.ready(apply);
  if (F.onSection) F.onSection('s-appr', apply);
})();
