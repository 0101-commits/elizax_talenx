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

  /* ---------- one-time CSS ---------- */
  function styleOnce() {
    if (document.getElementById('txf-appr-style')) return;
    var s = document.createElement('style');
    s.id = 'txf-appr-style';
    s.textContent =
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
      '.txf-adj select{border:1px solid var(--line);border-radius:7px;padding:5px 8px;font-size:12.5px;font-family:inherit}';
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

  /* ---------- project (stage pipeline) ---------- */
  function group(g) {
    var members = team(g.team).slice(g.from, g.to);
    var rows = members.map(function (t, i) {
      var tn = F.teamName(t), mgr = mgrOf(t), mgrTeam = F.teamName(mgr);
      var firstDone = (i % 3 !== 2);           // vary: last row of trio still in review
      var selfBtn = firstDone ? null : { cls: 'ap-btn', label: '작성', attr: 'data-txf="write"' };
      return '<tr data-emp="' + t.emp_id + '">' +
        '<td>' + cell(t.name, tn) + '</td>' +
        '<td>' + cell(t.name, tn, { status: firstDone ? 'done' : 'delay', btn: selfBtn }) + '</td>' +
        '<td>' + cell(mgr.name, mgrTeam, { status: firstDone ? 'done' : 'info' }) + '</td>' +
        '<td>' + cell(CU.name, F.teamName(CU)) + '</td>' +
        '<td>' + cell(CU.name, F.teamName(CU), { status: firstDone ? 'done' : null,
          btn: firstDone ? { cls: 'ap-btn-o', label: '응답 확인', attr: 'data-txf="result" data-emp="' + t.emp_id + '"' } : null }) + '</td>' +
        '</tr>';
    }).join('');
    return '<div class="ap-group">' + esc(g.label) + '</div>' +
      '<div class="ap-tbl-wrap"><table class="ap-tbl"><thead><tr>' +
      '<th style="width:180px">평가 대상자</th>' +
      '<th>본인 평가<span class="pr">' + g.dates + '</span></th>' +
      '<th>1차 상위자 평가<span class="pr">' + g.dates + '</span></th>' +
      '<th>2차 등급 조정<span class="pr">' + g.dates + '</span><button class="hbtn" data-txf="adjust">조정 등급 입력</button></th>' +
      '<th>결과 확정<span class="pr">' + g.dates + '</span></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function project(p) {
    var groups = p.groups.map(function (gg) { return group({ label: gg.label, team: gg.team, from: gg.from, to: gg.to, dates: p.dates }); }).join('');
    return '<div class="ap-proj"><div class="ap-proj-h"><span class="t">' + esc(p.title) + '</span>' + LEGEND + '</div>' + groups + '</div>';
  }

  // distinct sub-orgs + distinct rosters per group (fixes CPO duplication)
  var PROJECTS = [
    { title: '2026 상반기 평가', dates: '03.12 ~ 08.27', groups: [
      { label: 'hunel R&D Center', team: 'hunel R&D Center', from: 0, to: 3 },
      { label: 'S1 BU', team: 'S1 BU', from: 0, to: 3 } ] },
    { title: '2025 평가', dates: '01.02 ~ 06.30', groups: [
      { label: 'E1 BU', team: 'E1 BU', from: 0, to: 3 },
      { label: 'talenx R&D Center', team: 'talenx R&D Center', from: 0, to: 3 } ] }
  ];
  var MORE_PROJECT = { title: '2024 하반기 평가', dates: '09.01 ~ 12.20', groups: [
    { label: 'CS BU', team: 'CS BU', from: 0, to: 3 },
    { label: 'E2 BU', team: 'E2 BU', from: 0, to: 3 } ] };

  /* ---------- build 평가 subpage ---------- */
  function buildEval(container) {
    var projHtml = PROJECTS.map(project).join('');
    container.innerHTML =
      '<div id="txf-appr0">' +
      '<div class="ap-head"><h2>평가 현황</h2><div class="r">' +
      '<button class="ghost-btn" data-txf="dash" style="padding:9px 16px;font-size:13px">대시보드</button>' +
      '<button class="ap-filter" data-txf="filter" title="필터">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M7 12h10M10 18h4"/></svg>' +
      '<span class="fb">1</span></button></div></div>' +
      '<div class="ap-tabs">' +
      '<button class="on" data-txf="tab" data-tab="0">평가 작성</button>' +
      '<button data-txf="tab" data-tab="1">결과 확인</button>' +
      '<button data-txf="tab" data-tab="2">평가 검토</button></div>' +
      '<div data-pane="0">' + projHtml +
      '<div class="ap-more"><a data-txf="more">더 보기 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></a></div>' +
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
    var subj26 = team('E1 BU').slice(0, 3), part26 = team('hunel R&D Center').slice(0, 3);
    var subj25 = team('S1 BU').slice(0, 3), part25 = team('talenx R&D Center').slice(0, 3);
    var cards =
      tsCard({ title: '2026 승급 심사', date: '2026.03.08 ~ 2027.03.08', subjects: subj26, participants: part26, host: CU }) +
      tsCard({ title: '2025 승급 심사', date: '2025.03.08 ~ 2026.03.08', subjects: subj25, participants: part25, host: CU });
    container.innerHTML =
      '<div id="txf-appr1">' +
      '<div class="ts-headcard"><h2>탈렌트세션</h2></div>' +
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
        r('피어 리뷰', (c.peer_strength_norm != null ? c.peer_strength_norm : '-') + ' / 100') +
        r('실행 일관성', (c.exec_consistency_norm != null ? c.exec_consistency_norm : '-') + ' / 100') +
        (ev.rationale_summary ? '<div class="txf-rat">' + esc(ev.rationale_summary) + '</div>' : '') +
        '</div>';
    }
    TX.modal({ title: '결과 확인', body: body, actions: [{ label: '닫기', kind: 'ghost' }] });
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
      var el = ev.target.closest('[data-txf]'); if (!el || !root.contains(el)) return;
      var act = el.getAttribute('data-txf');
      if (act === 'result') { openResult(el.getAttribute('data-emp')); }
      else if (act === 'write') { TX.toast && TX.toast('평가 작성 화면으로 이동합니다.'); }
      else if (act === 'adjust') { ev.preventDefault(); openAdjust(el); }
      else if (act === 'members') { ev.preventDefault(); openMembers(el); }
      else if (act === 'filter') { openFilter(); }
      else if (act === 'dash') { TX.toast && TX.toast('평가 대시보드로 이동합니다.'); }
      else if (act === 'join') { TX.toast && TX.toast('탈렌트 세션에 참여합니다.'); }
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
