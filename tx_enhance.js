/* ===== talenx mockup — enhancement layer (additive; talenx UI/UX unchanged) =====
   Revives controls that had no real behaviour and turns cosmetic filters into
   working ones, WITHOUT touching layout/markup/design tokens.
   Loads after tx_revive.js. All work is delegated + idempotent + guarded.
   Features:
     1) 검색 input → 로컬 테이블 실시간 행 필터 (사번/이름 검색 등)
     2) 인사관리 구성원 목록(.mm-panel) → 221명 실제 페이지네이션
     3) 체크박스(.cbx) → 토글 + 전체선택 + 승인/결재 카운터 갱신
     4) 승인/결재 .wf-filter .fi(전체/승인필요/읽지않음) → 실제 행 필터
     5) 근무관리 미니 달력 .mh(‹ › 오늘) → 월 이동
     6) 근무관리 .filt → 필터 메뉴
     7) 평가관리 .plus → 평가자 추가 모달(perf 외 appr 범위 복구)
*/
(function () {
  'use strict';
  if (window.__TX_ENHANCE__) return; window.__TX_ENHANCE__ = true;
  var D = window.TALENX_DATA || {};
  var TX = window.TX || { toast: function () {}, menu: function () {}, modal: function () {} };

  function qa(s, r) { return [].slice.call((r || document).querySelectorAll(s)); }
  function q(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function txt(el) { return (el && el.textContent || '').trim(); }
  function closest(el, sel) { return el && el.closest ? el.closest(sel) : null; }
  var AVA = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-5 0-9 2.5-9 6v2h18v-2c0-3.5-4-6-9-6z"></path></svg>';
  function empNo(id) { return String(id || '').replace(/^EMP-?/, ''); }
  var orgById = {}; (D.orgs || []).forEach(function (o) { orgById[o.org_id] = o; });
  function orgPath(orgId) {
    var names = [], o = orgById[orgId], g = 0;
    while (o && g++ < 20) { names.unshift(o.name); o = o.parent_id ? orgById[o.parent_id] : null; }
    return names.join(' > ');
  }

  /* ---- one-off CSS: only for checkbox checked-state (uses existing tokens) ---- */
  (function injectCss() {
    if (document.getElementById('tx-enhance-css')) return;
    var st = document.createElement('style'); st.id = 'tx-enhance-css';
    st.textContent =
      '.cbx.tx-ck{background:var(--blue);border-color:var(--blue);position:relative}' +
      '.cbx.tx-ck::after{content:"";position:absolute;left:4px;top:1px;width:4px;height:8px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}' +
      'tr.tx-hidden{display:none!important}';
    (document.head || document.documentElement).appendChild(st);
  })();

  /* =================================================================
   * 1) 검색 input → 로컬 테이블 실시간 행 필터
   *    (인사관리 "사번 또는 이름 검색" 등, 리스너 없던 네이티브 검색창)
   * ================================================================= */
  // true if this search input governs the 221-member list (#mmBody in same subpage/screen)
  function drivesMemberList(input) {
    var sp = closest(input, '.subpage') || document.getElementById('s-hrm');
    return sp && sp.querySelector('#mmBody');
  }
  // 인재 검색: the tx2 results table (has a "조직 경로" column) → search whole roster
  function talentTbodyFor(input) {
    var sp = closest(input, '.subpage'); if (!sp) return null;
    var t = q('table.tx2', sp); if (!t) return null;
    var hasPath = qa('thead th', t).some(function (th) { return /조직\s*경로/.test(th.textContent || ''); });
    return hasPath ? q('tbody', t) : null;
  }
  function renderTalent(tbody, query) {
    var qv = (query || '').trim().toLowerCase();
    var sp = closest(tbody, '.subpage');
    function setCount(n) { var c = sp && q('.res-head .c', sp); if (c) c.textContent = '총 ' + n + '명'; }
    function empty(msg) { tbody.innerHTML = '<tr data-tx-empty="1"><td colspan="11" style="border:0;padding:0"><div class="res-empty">' + msg + '</div></td></tr>'; }
    if (!qv) { setCount(0); empty('사번 또는 이름을 입력하세요.'); return; }
    var list = (D.employees || []).filter(function (e) {
      return (e.name || '').toLowerCase().indexOf(qv) >= 0 || empNo(e.emp_id).toLowerCase().indexOf(qv) >= 0;
    });
    setCount(list.length);
    if (!list.length) { empty('검색 결과가 없습니다.'); return; }
    var comp = ((D.company && D.company.name) || 'HCG').split(' ')[0];
    tbody.innerHTML = list.slice(0, 100).map(function (e, i) {
      return '<tr>' +
        '<td><span class="cbx"></span></td>' +
        '<td>' + (i + 1) + '</td>' +
        '<td>' + esc(comp) + '</td>' +
        '<td>' + empNo(e.emp_id) + '</td>' +
        '<td><a class="mlink">' + esc(e.name) + '</a></td>' +
        '<td>보기</td>' +
        '<td>카드</td>' +
        '<td>' + esc(comp) + '</td>' +
        '<td>' + esc(e.orgName || '') + '</td>' +
        '<td style="white-space:nowrap">' + esc(orgPath(e.org_id)) + '</td>' +
        '<td>' + (e.is_leader ? '조직장' : '<span class="dash">-</span>') + '</td>' +
        '</tr>';
    }).join('');
  }
  function searchScopeTable(input) {
    // walk up from the input to the nearest ancestor that holds a *list-sized* table (>1 row)
    var el = input.parentElement, best = null;
    for (var i = 0; i < 7 && el; i++, el = el.parentElement) {
      var tbs = qa('table', el);
      for (var j = 0; j < tbs.length; j++) {
        if (tbs[j].querySelector('#mmBody')) return null;              // member table owns its own logic
        if (qa('tbody tr', tbs[j]).length > 1) { best = tbs[j]; break; }
      }
      if (best) break;
    }
    return best;
  }
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || t.tagName !== 'INPUT') return;
    var ph = t.getAttribute('placeholder') || '';
    if (!/검색|사번|이름/.test(ph)) return;
    var talent = talentTbodyFor(t);
    if (talent) { renderTalent(talent, t.value); return; }               // 인재 검색: 전체 로스터 검색
    if (drivesMemberList(t)) { mmQuery = t.value; mmPage = 0; mmRender(); return; } // 221-member search
    var table = searchScopeTable(t);
    if (!table) return;
    var qv = t.value.trim().toLowerCase();
    var rows = qa('tbody tr', table);
    var shown = 0;
    rows.forEach(function (r) {
      if (r.hasAttribute('data-tx-empty')) return;
      var hit = !qv || (r.textContent || '').toLowerCase().indexOf(qv) >= 0;
      r.classList.toggle('tx-hidden', !hit);
      if (hit) shown++;
    });
    // "no result" placeholder row
    var empty = q('tbody tr[data-tx-empty]', table);
    if (shown === 0) {
      if (!empty) {
        var cols = (qa('thead th', table).length) || (qa('tbody tr:first-child td', table).length) || 6;
        var tr = document.createElement('tr'); tr.setAttribute('data-tx-empty', '1');
        tr.innerHTML = '<td colspan="' + cols + '" style="text-align:center;color:var(--ink-3);padding:22px">검색 결과가 없습니다</td>';
        q('tbody', table).appendChild(tr);
      }
    } else if (empty) { empty.remove(); }
  }, true);

  /* =================================================================
   * 2) 인사관리 구성원 목록(.mm-panel) → 실제 페이지네이션 (221명)
   * ================================================================= */
  var MM_PP = 26, mmPage = 0, mmQuery = '';
  function mmRender() {
    var body = document.getElementById('mmBody');
    var hrm = document.getElementById('s-hrm');
    if (!body || !hrm) return;
    var all = (D.employees || []);
    var qv = mmQuery.trim().toLowerCase();
    if (qv) all = all.filter(function (e) {
      return (e.name || '').toLowerCase().indexOf(qv) >= 0 || empNo(e.emp_id).toLowerCase().indexOf(qv) >= 0;
    });
    var total = all.length;
    var pages = Math.max(1, Math.ceil(total / MM_PP));
    if (mmPage >= pages) mmPage = pages - 1;
    if (mmPage < 0) mmPage = 0;
    var start = mmPage * MM_PP, slice = all.slice(start, start + MM_PP);
    function c(v) { return (v === '-' || v === '' || v == null) ? '<span class="dash">-</span>' : esc(v); }
    body.innerHTML = slice.map(function (e, i) {
      var pink = e.gender === 'F';
      var lead = e.is_leader ? '<span class="lead-b"><span class="vf">✓</span>조직장</span>' : '';
      var role = e.is_leader ? '팀장' : '팀원';
      return '<tr>' +
        '<td>' + (start + i + 1) + '</td>' +
        '<td><span class="' + (pink ? 'mava pk' : 'mava') + '">' + (pink ? '🌸' : AVA) + '</span><a class="mlink">' + esc(e.name) + '</a></td>' +
        '<td>' + esc(e.orgName || '') + lead + '</td>' +
        '<td>' + empNo(e.emp_id) + '</td>' +
        '<td>' + c(role) + '</td>' +
        '<td>' + c(e.level_kr) + '</td>' +
        '<td>' + c(e.jobTitle) + '</td>' +
        '</tr>';
    }).join('') || '<tr data-tx-empty="1"><td colspan="7" style="text-align:center;color:var(--ink-3);padding:22px">검색 결과가 없습니다</td></tr>';
    var pager = q('.mm-panel .pager', hrm);
    if (pager && pager.children[1]) {
      pager.children[1].textContent = (total ? (start + 1) : 0) + '–' + (start + slice.length) + ' of ' + total;
    }
    var nav = q('.mm-panel .pager .pg-nav', hrm);
    if (nav) {
      var bs = qa('button', nav);
      if (bs[0]) bs[0].disabled = (mmPage <= 0);
      if (bs[1]) bs[1].disabled = (mmPage >= pages - 1);
    }
  }
  document.addEventListener('click', function (e) {
    var b = closest(e.target, '#s-hrm .mm-panel .pager .pg-nav button');
    if (!b) return;
    var prev = txt(b).indexOf('‹') >= 0 || txt(b).indexOf('<') >= 0;
    mmPage += prev ? -1 : 1;
    mmRender();
  }, true);

  /* =================================================================
   * 3) 체크박스(.cbx) → 토글 + 전체선택 + .wf-filter 카운터
   * ================================================================= */
  function activeWfTable() {
    var wf = document.getElementById('s-wf'); if (!wf) return null;
    var sp = qa('.subpage', wf).filter(function (s) { return s.offsetParent; })[0];
    return (sp && q('table', sp)) || q('table', wf);
  }
  function updateWfCount(scopeTable) {
    var table = scopeTable || activeWfTable(); if (!table) return;
    var sp = closest(table, '.subpage') || document.getElementById('s-wf');
    var cnt = sp && q('.wf-filter .cnt', sp); if (!cnt) return;
    var rows = qa('tbody tr', table).filter(function (r) { return !r.classList.contains('tx-hidden') && !r.hasAttribute('data-tx-empty'); });
    var sel = rows.filter(function (r) { return q('.cbx.tx-ck', r); }).length;
    cnt.textContent = sel + ' / ' + rows.length;
  }
  document.addEventListener('click', function (e) {
    var cb = closest(e.target, '.cbx');
    if (!cb) return;
    var thead = closest(cb, 'thead');
    var table = closest(cb, 'table');
    if (thead && table) {                       // header checkbox = select all (visible)
      var on = !cb.classList.contains('tx-ck');
      cb.classList.toggle('tx-ck', on);
      qa('tbody tr:not(.tx-hidden):not([data-tx-empty]) .cbx', table).forEach(function (x) { x.classList.toggle('tx-ck', on); });
    } else {
      cb.classList.toggle('tx-ck');
    }
    updateWfCount(table);
  }, true);

  /* =================================================================
   * 4) 승인/결재 .wf-filter .fi (전체 / 승인필요 / 읽지않음) → 실제 행 필터
   * ================================================================= */
  document.addEventListener('click', function (e) {
    var fi = closest(e.target, '#s-wf .wf-filter .fi');
    if (!fi) return;
    var sp = closest(fi, '.subpage') || document.getElementById('s-wf');
    var table = q('table', sp); if (!table) return;
    var label = txt(fi).replace(/\s*\d+\s*$/, '').replace(/[•✓]/g, '').trim();
    qa('tbody tr', table).forEach(function (r) {
      if (r.hasAttribute('data-tx-empty')) return;
      var need = !!q('.badge-need', r);
      var show = true;
      if (label.indexOf('승인필요') >= 0) show = need;
      else if (label.indexOf('읽지않음') >= 0) show = false;   // mock: 0건
      else show = true;                                         // 전체
      r.classList.toggle('tx-hidden', !show);
    });
    updateWfCount(table);
  }, true);

  /* =================================================================
   * 5) 근무관리 미니 달력 .mh (‹ › 오늘) → 월 이동
   * ================================================================= */
  document.addEventListener('click', function (e) {
    var mh = closest(e.target, '.mh'); if (!mh) return;
    var moEl = q('.mo', mh); if (!moEl) return;
    var isNav = closest(e.target, '.nb'), isToday = closest(e.target, '.today');
    if (!isNav && !isToday) return;
    var base = { y: 2026, m: 7 };
    var cur = (txt(moEl).match(/(\d{4})\.(\d{1,2})/) || [0, base.y, base.m]);
    var y = +cur[1], m = +cur[2];
    if (isToday) { y = base.y; m = base.m; }
    else { var back = txt(isNav).indexOf('‹') >= 0 || txt(isNav).indexOf('<') >= 0; m += back ? -1 : 1; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; } }
    moEl.textContent = y + '.' + (m < 10 ? '0' + m : m);
    TX.toast(y + '년 ' + m + '월');
  }, true);

  /* =================================================================
   * 6) 근무관리 .filt → 필터 메뉴 (리스너 없던 컨트롤)
   * ================================================================= */
  document.addEventListener('click', function (e) {
    var f = closest(e.target, '#s-att .filt'); if (!f) return;
    e.preventDefault();
    TX.menu(f, [
      { label: '전체 구성원', onClick: function () { TX.toast('전체 구성원 표시'); } },
      { label: '내 소속 구성원', onClick: function () { TX.toast('내 소속만 표시'); } },
      { label: '즐겨찾기', onClick: function () { TX.toast('즐겨찾기만 표시'); } }
    ]);
  }, true);

  /* =================================================================
   * 7) 평가관리 .plus → 평가자 추가 모달 (revive는 perf만 처리)
   * ================================================================= */
  document.addEventListener('click', function (e) {
    var pl = closest(e.target, '#s-appr .plus'); if (!pl) return;
    e.preventDefault();
    TX.modal({
      title: '평가자 추가',
      body: (TX.field ? TX.field('평가자', '<input type="text" placeholder="이름 또는 사번으로 검색">') : '<input placeholder="이름 검색">') +
            (TX.field ? TX.field('평가 단계', '<select><option>1차 평가</option><option>2차 평가</option><option>최종 평가</option></select>') : ''),
      actions: [{ label: '취소', kind: 'ghost' }, { label: '추가', kind: 'primary', onClick: function () { TX.toast('평가자를 추가했습니다.'); } }]
    });
  }, true);

  /* ---- initial member-table paging render (after hydrate) ---- */
  function boot() { try { mmRender(); } catch (_) {} try { updateWfCount(); } catch (_) {} }
  if (document.readyState === 'complete') setTimeout(boot, 300);
  else window.addEventListener('load', function () { setTimeout(boot, 300); });
  // re-init member paging when HRM screen becomes active (positional subnav re-render safety)
  document.addEventListener('click', function (e) {
    if (closest(e.target, '#gnb button')) setTimeout(function () { try { mmRender(); } catch (_) {} }, 120);
  }, true);
})();
