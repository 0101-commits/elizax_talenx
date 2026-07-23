/* tx_fix_home.js — HOME dashboard + global header fidelity 고도화 (2026-07-15)
 * Full re-implementation. Runs inside TXFIX.ready (≈60ms after DOMContentLoaded,
 * AFTER tx_hydrate / tx_cleanup / tx_revive). Patches the CURRENT (post-hydration)
 * DOM only. Idempotent (dataset guards). No network, no deps, pure DOM.
 * Only this file is created — index.html and other .js are untouched.
 */
(function () {
  'use strict';
  var F = window.TXFIX, TX = window.TX;
  if (!F) return;
  var D = F.D || {}, CU = F.CU || {};

  function esc(s) {
    return (TX && TX.esc) ? TX.esc(s)
      : String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
  }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  /* capture-phase click → stop the tx_revive document-delegated handler, then run fn */
  function cap(node, fn) {
    if (!node) return;
    node.addEventListener('click', function (e) {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      try { fn(e); } catch (err) { console.error('[txfix-home]', err); }
    }, true);
  }
  function toast(m, k) { if (TX && TX.toast) TX.toast(m, k); }

  /* navigate to a GNB section (and optional subnav data-p) by clicking real controls */
  function nav(key, subP) {
    var b = document.querySelector('#gnb [data-s="' + key + '"]') ||
            document.querySelector('.gnb-menu [data-s="' + key + '"]');
    if (!b) return;
    b.click();
    if (subP != null) {
      setTimeout(function () {
        try {
          var a = document.querySelector('#s-' + key + ' .subnav a[data-p="' + subP + '"]');
          if (a) a.click();
        } catch (e) {}
      }, 40);
    }
  }

  var email = String(CU.emp_id || 'emp').toLowerCase().replace(/[^a-z0-9]/g, '') + '@hcg.co.kr';
  var UNREAD = 69;

  /* 현재 관점 롤키 (member일 때만 조직원 스코프 게이팅; 나머지 롤은 기존 유지) */
  function curRole() { return (F.CU && F.CU._role) || (window.TXRoles && TXRoles.current && TXRoles.current().key) || 'member'; }

  /* ================================================================
   *  CSS (self-contained; selectors prefixed .txf- / #s-home)
   * ================================================================ */
  function injectCSS() {
    if (document.getElementById('txf-home-css')) return;
    var st = document.createElement('style');
    st.id = 'txf-home-css';
    st.textContent = [
      /* ---- shared panels ---- */
      '.txf-scrim{position:fixed;inset:0;background:rgba(17,24,39,.06);z-index:100000;opacity:0;transition:opacity .16s}',
      '.txf-scrim.on{opacity:1}',
      '.txf-panel{position:fixed;top:0;right:0;height:100vh;background:var(--card,#fff);z-index:100001;',
      '  box-shadow:-10px 0 34px rgba(15,23,42,.14);display:flex;flex-direction:column;',
      '  transform:translateX(14px);opacity:0;transition:transform .2s ease,opacity .2s ease;font-size:13px;color:var(--ink)}',
      '.txf-panel.on{transform:none;opacity:1}',
      /* ---- notification panel ---- */
      '.txf-np{width:410px;max-width:92vw}',
      '.txf-np-hd{display:flex;align-items:center;gap:16px;padding:16px 18px 0}',
      '.txf-np-tab{font-size:14px;font-weight:600;color:var(--ink-4);cursor:pointer;padding-bottom:12px;border-bottom:2px solid transparent}',
      '.txf-np-tab b{font-weight:800;margin-left:3px}',
      '.txf-np-tab.on{color:var(--ink);font-weight:800;border-bottom-color:var(--ink)}',
      '.txf-np-hd .sp{flex:1}',
      '.txf-np-ico{width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;border-radius:8px;color:var(--ink-3);cursor:pointer}',
      '.txf-np-ico:hover{background:var(--soft)}',
      '.txf-np-chips{display:flex;gap:7px;padding:12px 18px;border-bottom:1px solid var(--line)}',
      '.txf-chip{height:30px;padding:0 14px;border-radius:16px;border:1px solid var(--line);background:var(--card);',
      '  color:var(--ink-3);font-size:12.5px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center}',
      '.txf-chip.on{background:var(--ink);color:#fff;border-color:var(--ink)}',
      '.txf-np-list{flex:1;overflow-y:auto;padding:4px 0}',
      '.txf-nrow{display:flex;gap:11px;padding:14px 18px;border-bottom:1px solid var(--line);cursor:pointer}',
      '.txf-nrow:hover{background:var(--soft)}',
      '.txf-nrow .txf-ava{margin-top:1px}',
      '.txf-nrow .nb{flex:1;min-width:0}',
      '.txf-nrow .nt{font-size:13.5px;line-height:1.45;color:var(--ink)}',
      '.txf-nrow .nsub{font-size:12.5px;color:var(--ink-3);margin-top:4px;background:var(--soft);border-radius:6px;padding:5px 9px;display:inline-block}',
      '.txf-nrow .ndt{font-size:12px;color:var(--ink-4);margin-top:7px}',
      '.txf-np-empty{padding:40px 18px;text-align:center;color:var(--ink-3);font-size:13px}',
      /* ---- avatar menu ---- */
      '.txf-am{width:344px;max-width:92vw;overflow-y:auto}',
      '.txf-am-top{display:flex;align-items:center;justify-content:space-between;padding:14px 18px}',
      '.txf-am-x{font-size:18px;color:var(--ink-3);cursor:pointer;line-height:1}',
      '.txf-am-out{font-size:13px;font-weight:700;color:var(--ink-2);cursor:pointer}',
      '.txf-am-out:hover{color:var(--red)}',
      '.txf-am-id{display:flex;align-items:center;gap:12px;padding:6px 18px 18px}',
      '.txf-am-id .nm{font-size:16px;font-weight:800;color:var(--ink)}',
      '.txf-am-id .em{font-size:12.5px;color:var(--ink-3);margin-top:2px}',
      '.txf-am-sec{padding:14px 18px 4px;font-size:12px;font-weight:700;color:var(--ink-4)}',
      '.txf-am-ws{margin:0 18px 4px;height:42px;border:1px solid var(--line);border-radius:10px;display:flex;align-items:center;',
      '  padding:0 12px;font-size:13.5px;font-weight:700;color:var(--ink);cursor:pointer;justify-content:space-between}',
      '.txf-am-item{padding:11px 18px;font-size:14px;color:var(--ink);cursor:pointer;font-weight:600}',
      '.txf-am-item:hover{background:var(--soft)}',
      '.txf-am-div{height:1px;background:var(--line);margin:8px 0}',
      /* ---- search dropdown ---- */
      '.txf-sd{position:fixed;z-index:100001;width:440px;max-width:94vw;background:var(--card,#fff);border:1px solid var(--line);',
      '  border-radius:14px;box-shadow:0 18px 44px rgba(15,23,42,.18);overflow:hidden;opacity:0;transform:translateY(-6px);transition:.15s}',
      '.txf-sd.on{opacity:1;transform:none}',
      '.txf-sd-in{display:flex;align-items:center;gap:9px;padding:14px 16px;border-bottom:1px solid var(--line)}',
      '.txf-sd-in svg{color:var(--ink-3);flex:none}',
      '.txf-sd-in input{flex:1;border:0;outline:0;font-size:15px;color:var(--ink);background:transparent}',
      '.txf-sd-res{max-height:340px;overflow-y:auto}',
      '.txf-sd-row{display:flex;gap:11px;align-items:center;padding:11px 16px;cursor:pointer}',
      '.txf-sd-row:hover{background:var(--soft)}',
      '.txf-sd-row .nm{font-size:13.5px;font-weight:700;color:var(--ink)}',
      '.txf-sd-row .mo{font-size:12px;color:var(--ink-3);margin-top:1px}',
      '.txf-sd-empty{padding:26px 16px;text-align:center;color:var(--ink-3);font-size:13px}',
      /* ---- header avatar reset ---- */
      '.gnb-right .ava.txf-avaslot{background:transparent!important;padding:0!important;width:auto!important;height:auto!important;border:0!important}',
      /* ---- preset pills ---- */
      '#s-home .txf-preset{display:inline-flex;gap:0;background:var(--soft);border-radius:18px;padding:3px}',
      '#s-home .txf-pp{height:30px;padding:0 18px;border-radius:16px;font-size:13px;font-weight:800;color:var(--ink-4);',
      '  cursor:pointer;display:inline-flex;align-items:center;border:0;background:transparent}',
      '#s-home .txf-pp.on{background:var(--ink);color:#fff}',
      /* ---- 출근 button ---- */
      '#s-home .txf-checkin{width:100%;height:44px;border:0;border-radius:12px;background:var(--blue);color:#fff;',
      '  font-size:14px;font-weight:800;cursor:pointer;margin:4px 0 10px}',
      '#s-home .txf-checkin.done{background:var(--soft);color:var(--ink-3)}',
      /* ---- 근태 통계 widget ---- */
      '#s-home .txf-attcard .txf-att-avg{display:grid;grid-template-columns:1fr 1fr 1fr;text-align:center;padding:6px 0 16px}',
      '#s-home .txf-att-a{border-right:1px solid var(--line)}',
      '#s-home .txf-att-a:last-child{border-right:0}',
      '#s-home .txf-att-a b{display:block;font-size:20px;font-weight:800;color:var(--ink)}',
      '#s-home .txf-att-a span{display:block;font-size:12px;color:var(--ink-4);margin-top:5px}',
      '#s-home .txf-att-cells{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}',
      '#s-home .txf-att-c{border:1px solid var(--line);border-radius:12px;padding:16px 6px;text-align:center}',
      '#s-home .txf-att-c b{display:block;font-size:22px;font-weight:800;color:var(--ink-4)}',
      '#s-home .txf-att-c span{display:block;font-size:11.5px;color:var(--ink-4);margin-top:7px}',
      '#s-home .txf-att-c.hl b{color:var(--ink)}',
      /* ---- modal form fields ---- */
      '.txf-fld3{display:block;margin-bottom:6px}',
      '.txf-fld3>span{display:block;font-size:12.5px;font-weight:700;color:var(--ink-2);margin-bottom:7px}',
      '.txf-fld3 select,.txf-fld3 input,.txf-fld3 textarea{width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 11px;font-size:13px;color:var(--ink);background:var(--card);font-family:inherit;box-sizing:border-box;resize:vertical}',
      /* ---- release notes / manual / workspace modal ---- */
      '.txf-rel{padding:12px 0;border-bottom:1px solid var(--line-2)}',
      '.txf-rel:last-child{border-bottom:0}',
      '.txf-rel .rt{font-size:13.5px;font-weight:800;color:var(--ink)}',
      '.txf-rel .rd{font-size:12px;color:var(--ink-4);margin:3px 0 6px}',
      '.txf-rel .rb{font-size:13px;color:var(--ink-2);line-height:1.6}',
      '.txf-wsrow{display:flex;align-items:center;gap:11px;padding:12px 12px;border:1px solid var(--line);border-radius:10px;margin-bottom:9px;cursor:pointer}',
      '.txf-wsrow:hover{background:var(--soft)}',
      '.txf-wsrow .wn{font-size:13.5px;font-weight:800;color:var(--ink)}',
      '.txf-wsrow .wm{font-size:12px;color:var(--ink-3);margin-top:2px}',
      '.txf-wsrow .cur{margin-left:auto;background:#EAF2FE;color:var(--blue);font-size:11px;font-weight:800;border-radius:10px;padding:3px 9px}',
      /* ---- 성과 preset grid ---- */
      '#s-home .txh-perf-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}',
      '@media(max-width:940px){#s-home .txh-perf-grid{grid-template-columns:1fr}}',
      '#s-home .txh-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line-2)}',
      '#s-home .txh-row:last-child{border-bottom:0}',
      '#s-home .txh-row .tt{flex:1;min-width:0;font-size:13px;font-weight:600;color:var(--ink)}',
      '#s-home .txh-row .tt small{display:block;font-size:11.5px;color:var(--ink-4);font-weight:500;margin-top:2px}',
      '#s-home .txh-row .dt{font-size:12px;color:var(--ink-3);white-space:nowrap}',
      '#s-home .txh-bar{width:90px;height:7px;border-radius:5px;background:var(--soft);overflow:hidden;flex:none}',
      '#s-home .txh-bar i{display:block;height:100%;background:var(--blue);border-radius:5px}',
      '#s-home .txh-row b{width:38px;text-align:right;font-size:12.5px;color:var(--ink)}',
      '#s-home .txh-big{font-size:30px;font-weight:800;color:var(--ink);padding:4px 0 2px}',
      '#s-home .txh-sub{font-size:12px;color:var(--ink-4);margin-bottom:8px}',
      /* clickable affordance */
      '#s-home .card .frow{cursor:pointer}',
      '#s-home .card .goal{cursor:pointer}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ================================================================
   *  panel plumbing
   * ================================================================ */
  function closePanels() {
    var s = document.querySelector('.txf-scrim');
    if (s) { s.classList.remove('on'); setTimeout(function () { if (s.parentNode) s.remove(); }, 180); }
    ['.txf-np', '.txf-am', '.txf-sd'].forEach(function (sel) {
      var p = document.querySelector(sel);
      if (p) { p.classList.remove('on'); setTimeout(function () { if (p.parentNode) p.remove(); }, 200); }
    });
  }
  function openPanel(panel) {
    closePanels();
    var sc = el('div', 'txf-scrim');
    sc.addEventListener('click', closePanels);
    document.body.appendChild(sc);
    document.body.appendChild(panel);
    requestAnimationFrame(function () { sc.classList.add('on'); panel.classList.add('on'); });
    var escFn = function (e) { if (e.key === 'Escape') { closePanels(); document.removeEventListener('keydown', escFn); } };
    document.addEventListener('keydown', escFn);
  }

  /* ================================================================
   *  1) Notification panel (right-docked)
   * ================================================================ */
  function teamPick(i) {
    var t = (D.employees || []).filter(function (e) { return e.org_id === CU.org_id && e.emp_id !== CU.emp_id; });
    return (t[i % (t.length || 1)] || { name: '동료' }).name;
  }
  function buildNotifs() {
    return [
      { cat: '근무관리', appr: 1, who: teamPick(0), t: '님이 근무내역 변경 승인을 요청했습니다.', dt: '6월 30일 화요일 오후 4:51' },
      { cat: '근무관리', appr: 1, who: teamPick(1), t: '님이 도서비 신청 승인을 요청했습니다.', dt: '5월 27일 수요일 오전 10:57' },
      { cat: '근무관리', appr: 1, who: teamPick(2), t: '님이 경조금 지급 신청 승인을 요청했습니다.', dt: '4월 21일 화요일 오전 10:55' },
      { cat: '성과관리', appr: 1, who: CU.managerName || teamPick(3), t: '님이 목표 삭제를 승인했습니다.', sub: '목표: 서비스 기획 품질 및 사용자 만족도 향상', dt: '3월 19일 목요일 오후 4:05' },
      { cat: '성과관리', appr: 1, who: CU.managerName || teamPick(3), t: '님이 목표 가중치 수정을 승인했습니다.', sub: '가중치: 없음(100.0) → 있음(50.0)', dt: '3월 19일 목요일 오후 3:14' },
      { cat: '성과관리', appr: 0, who: teamPick(0), t: '님이 목표 수정을 승인했습니다.', sub: '목표: 신규 기능 기획서 사용자 검증 통과율', dt: '3월 19일 목요일 오후 2:34' },
      { cat: '근무관리', appr: 1, who: teamPick(4), t: '님이 출장비 신청 승인을 요청했습니다.', dt: '3월 14일 금요일 오전 9:22' },
      { cat: '성과관리', appr: 0, who: teamPick(1), t: '님이 체크인을 등록했습니다.', sub: '목표: 기획 산출물 리드타임 단축', dt: '3월 12일 수요일 오후 5:40' },
      { cat: '근무관리', appr: 0, who: '관리자', t: ' 연차 촉진 안내: 미사용 연차 3일이 남아 있습니다.', dt: '3월 10일 월요일 오전 8:00' },
      { cat: '성과관리', appr: 1, who: CU.managerName || teamPick(2), t: '님이 1:1 미팅을 요청했습니다.', sub: '2026.03.09 14:00 · 분기 목표 점검', dt: '3월 6일 목요일 오후 1:12' },
      { cat: '근무관리', appr: 1, who: teamPick(3), t: '님이 근무계획 수립을 신청했습니다.', dt: '3월 3일 월요일 오후 6:57' },
      { cat: '성과관리', appr: 0, who: teamPick(0), t: '님이 360 피드백을 요청했습니다.', dt: '2월 27일 금요일 오전 11:03' }
    ];
  }
  function openNotif() {
    var data = buildNotifs();
    if (curRole()==='member') data.forEach(function(n){ n.appr = 0; });
    var apprN = data.filter(function (n) { return n.appr; }).length;
    var state = { tab: 'appr', chip: 'all' };

    var p = el('div', 'txf-panel txf-np');
    var hd = el('div', 'txf-np-hd');
    hd.innerHTML =
      '<span class="txf-np-tab" data-tab="appr">승인 필요<b>' + apprN + '</b></span>' +
      '<span class="txf-np-tab" data-tab="unread">읽지 않음<b>' + UNREAD + '</b></span>' +
      '<span class="txf-np-tab" data-tab="all">전체</span>' +
      '<span class="sp"></span>' +
      '<span class="txf-np-ico" title="메시지"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 01-9 8.4 9.5 9.5 0 01-4-.8L3 21l1.9-4a8.4 8.4 0 01-.8-3.5A8.4 8.4 0 0112 5a8.4 8.4 0 019 6.5z"/></svg></span>' +
      '<span class="txf-np-ico" title="설정">⋮</span>';
    var chips = el('div', 'txf-np-chips');
    chips.innerHTML = ['all|전체', '근무관리|근무관리', '성과관리|성과관리'].map(function (c) {
      var kv = c.split('|');
      return '<span class="txf-chip" data-chip="' + kv[0] + '">' + kv[1] + '</span>';
    }).join('');
    var list = el('div', 'txf-np-list');

    function render() {
      hd.querySelectorAll('.txf-np-tab').forEach(function (t) { t.classList.toggle('on', t.getAttribute('data-tab') === state.tab); });
      chips.querySelectorAll('.txf-chip').forEach(function (c) { c.classList.toggle('on', c.getAttribute('data-chip') === state.chip); });
      var rows = [];
      data.forEach(function (n, i) {
        if (state.tab === 'appr' && !n.appr) return;
        if (state.chip !== 'all' && n.cat !== state.chip) return;
        rows.push({ n: n, i: i });
      });
      if (!rows.length) { list.innerHTML = '<div class="txf-np-empty">알림이 없습니다.</div>'; return; }
      list.innerHTML = rows.map(function (r) {
        var n = r.n;
        return '<div class="txf-nrow" data-i="' + r.i + '">' + F.avatar(n.who, 34) +
          '<div class="nb"><div class="nt"><b>' + esc(n.who) + '</b>' + esc(n.t) + '</div>' +
          (n.sub ? '<div class="nsub">' + esc(n.sub) + '</div>' : '') +
          '<div class="ndt">' + esc(n.dt) + '</div></div></div>';
      }).join('');
    }
    hd.addEventListener('click', function (e) {
      var t = e.target.closest('.txf-np-tab');
      if (t) { state.tab = t.getAttribute('data-tab'); render(); }
    });
    chips.addEventListener('click', function (e) {
      var c = e.target.closest('.txf-chip');
      if (c) { state.chip = c.getAttribute('data-chip'); render(); }
    });
    list.addEventListener('click', function (e) {
      var r = e.target.closest('.txf-nrow');
      if (!r) return;
      var n = data[parseInt(r.getAttribute('data-i'), 10)];
      if (n) { closePanels(); openNotifDetail(n); }
    });
    p.appendChild(hd); p.appendChild(chips); p.appendChild(list);
    render();
    openPanel(p);
  }

  /* ---- notification detail drawer ---- */
  function openNotifDetail(n) {
    if (!TX || !TX.drawer) { toast('알림 상세'); return; }
    var target = n.cat === '성과관리' ? 'perf' : 'att';
    if (/신청 승인|근무계획|출장비|경조금|도서비/.test(n.t || '')) target = 'wf';
    var targetLabel = target === 'perf' ? '성과관리' : (target === 'wf' ? '신청/승인' : '근무관리');
    var body =
      '<div style="font-size:14.5px;font-weight:700;color:var(--ink);line-height:1.55"><b>' + esc(n.who) + '</b>' + esc(n.t) + '</div>' +
      '<div style="font-size:12.5px;color:var(--ink-4);margin-top:8px">' + esc(n.dt) + '</div>' +
      (n.sub ? '<div style="margin-top:14px;background:var(--soft);border-radius:8px;padding:11px 13px;font-size:13px;color:var(--ink-2)">' + esc(n.sub) + '</div>' : '') +
      '<div style="margin-top:16px;font-size:13px;color:var(--ink-2);line-height:1.65">' +
      (n.appr ? '승인이 필요한 요청입니다. 요청 내용을 확인한 뒤 해당 화면에서 승인 또는 반려를 진행하세요.'
              : '참고용 알림입니다. 상세 내용은 관련 화면에서 확인할 수 있습니다.') + '</div>' +
      '<button class="txf-ndgo" style="margin-top:22px;width:100%;height:42px;border:0;border-radius:10px;background:var(--blue);color:#fff;font-size:13.5px;font-weight:800;cursor:pointer;font-family:inherit">' + targetLabel + ' 화면으로 이동</button>';
    var dr = TX.drawer({ title: '알림 상세', subtitle: esc(n.cat) + (n.appr ? ' · 승인 필요' : ''), body: body });
    var go = dr.body.querySelector('.txf-ndgo');
    if (go) go.addEventListener('click', function () { dr.close(); nav(target); });
  }

  /* ---- employee detail drawer (search results) ---- */
  function openEmpDetail(emp) {
    if (!TX || !TX.drawer) { toast('구성원 상세'); return; }
    var objs = (D.objectives || []).filter(function (o) {
      return o.owner_emp_id === emp.emp_id || (o.org_id === emp.org_id && o.level !== 'company');
    });
    var num = parseInt(String(emp.emp_id || '').replace(/\D/g, ''), 10) || 0;
    var phone = '010-' + (3000 + (num * 37) % 7000) + '-' + (1000 + (num * 91) % 9000);
    var mail = String(emp.emp_id || 'emp').toLowerCase().replace(/[^a-z0-9]/g, '') + '@hcg.co.kr';
    function row(k, v) {
      return '<div style="display:flex;justify-content:space-between;gap:14px;padding:9px 0;border-bottom:1px solid var(--line-2)">' +
        '<span style="font-size:12.5px;color:var(--ink-3);flex:none">' + k + '</span>' +
        '<span style="font-size:13px;font-weight:700;color:var(--ink);text-align:right">' + v + '</span></div>';
    }
    /* member 관점: 본인이 아닌 타인의 연락처·이메일·목표는 노출하지 않음(디렉터리 수준만) */
    var isSelf = emp.emp_id === CU.emp_id;
    var minimal = curRole() === 'member' && !isSelf;
    var objHtml = minimal ? '' : objs.slice(0, 3).map(function (o) {
      return row(esc(o.title), (o.progress != null ? o.progress : 0) + '%');
    }).join('');
    var body =
      '<div style="display:flex;align-items:center;gap:12px;padding-bottom:14px">' + F.avatar(emp.name, 48) +
      '<div><div style="font-size:15px;font-weight:800;color:var(--ink)">' + esc(emp.name) + '</div>' +
      '<div style="font-size:12.5px;color:var(--ink-3);margin-top:2px">' + esc(emp.orgName || '') + (emp.jobTitle ? ' · ' + esc(emp.jobTitle) : '') + '</div></div></div>' +
      row('사번', esc(emp.emp_id || '-')) +
      row('조직', esc(emp.orgName || '-')) +
      row('직급', esc(emp.level_kr || '-') + (emp.level ? ' / ' + esc(emp.level) : '')) +
      row('직책', emp.is_leader ? '조직장' : '팀원') +
      row('입사일', esc(emp.join_date || '-')) +
      (minimal ? '' :
        row('연락처', phone) +
        row('이메일', mail) +
        row('보유 목표', objs.length + '개')) +
      (objHtml ? '<div style="font-size:12.5px;font-weight:800;color:var(--ink-2);margin:16px 0 4px">주요 목표</div>' + objHtml : '');
    TX.drawer({
      title: esc(emp.name),
      subtitle: esc(emp.orgName || '') + (emp.jobTitle ? ' · ' + esc(emp.jobTitle) : ''),
      body: body
    });
  }

  /* ================================================================
   *  2) Avatar dropdown (right-docked, rich)
   * ================================================================ */
  function openAvatarMenu() {
    var ws = (D.company && D.company.name) || '올인원컴퍼니';
    var p = el('div', 'txf-panel txf-am');
    p.innerHTML =
      '<div class="txf-am-top"><span class="txf-am-x" title="닫기">✕</span><span class="txf-am-out">로그아웃</span></div>' +
      '<div class="txf-am-id">' + F.avatar(CU.name, 48) +
        '<div><div class="nm">' + esc(CU.name) + '</div><div class="em">' + esc(email) + '</div></div></div>' +
      '<div class="txf-am-sec">워크스페이스</div>' +
      '<div class="txf-am-ws" data-act="ws"><span>' + esc(ws) + '</span><span style="color:var(--ink-4)">▾</span></div>' +
      '<div class="txf-am-sec">내 정보</div>' +
      '<div class="txf-am-item" data-act="mypage">마이페이지</div>' +
      '<div class="txf-am-item" data-act="account">계정 설정</div>' +
      '<div class="txf-am-sec">고객센터</div>' +
      '<div class="txf-am-item" data-act="new">새로운 기능</div>' +
      '<div class="txf-am-item" data-act="manual">사용자 매뉴얼</div>' +
      '<div class="txf-am-item" data-act="feedback">의견 보내기</div>' +
      '<div class="txf-am-div"></div>' +
      '<div class="txf-am-sec">설정</div>' +
      '<div class="txf-am-item" data-act="admin">관리자 메뉴</div>';
    p.querySelector('.txf-am-x').addEventListener('click', closePanels);
    p.querySelector('.txf-am-out').addEventListener('click', function () { closePanels(); toast('로그아웃되었습니다.'); });
    p.querySelectorAll('.txf-am-ws,.txf-am-item').forEach(function (n) {
      n.addEventListener('click', function () { doMenuAct(n.getAttribute('data-act')); });
    });
    openPanel(p);
  }

  /* ---- avatar menu actions ---- */
  function doMenuAct(a) {
    if (a === 'admin') { toast('관리자 권한이 필요합니다.', 'warn'); return; }
    closePanels();
    if (a === 'mypage') { nav('hrm', 0); return; }
    if (a === 'account') { openAccountModal(); return; }
    if (a === 'new') { openReleaseNotes(); return; }
    if (a === 'manual') { openManual(); return; }
    if (a === 'feedback') { openFeedbackModal(); return; }
    if (a === 'ws') { openWorkspaceModal(); return; }
  }
  function openAccountModal() {
    if (!TX || !TX.modal) { toast('계정 설정'); return; }
    function tog(label, on) {
      return '<label style="display:flex;align-items:center;justify-content:space-between;padding:10px 2px;font-size:13.5px;color:var(--ink);cursor:pointer">' +
        label + '<input type="checkbox"' + (on ? ' checked' : '') + ' style="width:16px;height:16px"></label>';
    }
    var body =
      '<label class="txf-fld3"><span>언어</span><select><option selected>한국어</option><option>English</option><option>日本語</option></select></label>' +
      '<div style="font-size:12.5px;font-weight:800;color:var(--ink-2);margin:14px 0 4px">알림 설정</div>' +
      tog('이메일 알림', true) + tog('푸시 알림', true) + tog('주간 요약 리포트', false);
    TX.modal({
      title: '계정 설정', body: body,
      actions: [{ label: '취소', kind: 'ghost' }, { label: '저장', kind: 'primary', onClick: function () { toast('계정 설정이 저장되었습니다.', 'ok'); } }]
    });
  }
  function openReleaseNotes() {
    if (!TX || !TX.modal) { toast('새로운 기능'); return; }
    var notes = [
      ['v0.191.0', '2026.07.10', '홈 대시보드 위젯 순서가 개편되고 근태 통계 위젯이 추가되었습니다. 기본/성과 화면 구성 전환을 지원합니다.'],
      ['v0.190.0', '2026.06.26', '평가관리에 2차 등급 조정 입력과 결과 확인(영수증형) 화면이 추가되었습니다.'],
      ['v0.189.2', '2026.06.12', '알림 센터가 승인 필요/읽지 않음 탭으로 개편되고 구성원 검색 성능이 개선되었습니다.']
    ];
    var body = notes.map(function (r) {
      return '<div class="txf-rel"><div class="rt">' + r[0] + '</div><div class="rd">' + r[1] + '</div><div class="rb">' + r[2] + '</div></div>';
    }).join('');
    TX.modal({ title: '새로운 기능', body: body, actions: [{ label: '닫기', kind: 'ghost' }] });
  }
  function openManual() {
    if (!TX || !TX.modal) { toast('사용자 매뉴얼'); return; }
    var toc = [
      '1. 시작하기 — 로그인과 워크스페이스',
      '2. 홈 — 대시보드 위젯 구성과 화면 전환',
      '3. 인사관리 — 내 정보·구성원 정보·인재검색',
      '4. 근무관리 — 출퇴근 기록과 휴가 신청',
      '5. 성과관리 — 목표(OKR) 수립과 체크인',
      '6. 평가관리 — 평가 작성·등급 조정·결과 확인',
      '7. 신청/승인 — 전자결재 문서 처리'
    ];
    var body = '<div style="font-size:12.5px;color:var(--ink-3);margin-bottom:8px">talenx 사용자 매뉴얼 목차</div>' +
      toc.map(function (x) {
        return '<div style="padding:10px 2px;border-bottom:1px solid var(--line-2);font-size:13.5px;color:var(--ink);font-weight:600">' + x + '</div>';
      }).join('');
    TX.modal({ title: '사용자 매뉴얼', body: body, actions: [{ label: '닫기', kind: 'ghost' }] });
  }
  function openFeedbackModal() {
    if (!TX || !TX.modal) { toast('의견 보내기'); return; }
    var body =
      '<div style="font-size:13px;color:var(--ink-3);margin-bottom:10px">서비스 개선을 위한 의견을 들려주세요.</div>' +
      '<label class="txf-fld3"><textarea rows="5" class="txf-fbtext" placeholder="불편했던 점, 개선 아이디어를 자유롭게 적어주세요."></textarea></label>';
    TX.modal({
      title: '의견 보내기', body: body,
      actions: [
        { label: '취소', kind: 'ghost' },
        { label: '제출', kind: 'primary', onClick: function (box) {
          var v = String(box.querySelector('.txf-fbtext').value || '').trim();
          if (!v) { toast('의견 내용을 입력해주세요.', 'warn'); return false; }
          toast('의견이 전송되었습니다. 감사합니다.', 'ok');
        } }
      ]
    });
  }
  function openWorkspaceModal() {
    if (!TX || !TX.modal) { toast('워크스페이스 전환'); return; }
    var body =
      '<div class="txf-wsrow" data-ws="HCG 운영"><div><div class="wn">HCG 운영</div><div class="wm">people.talenx.com · 구성원 221명</div></div><span class="cur">현재</span></div>' +
      '<div class="txf-wsrow" data-ws="HCG 테스트"><div><div class="wn">HCG 테스트</div><div class="wm">test.talenx.com · 테스트 환경</div></div></div>';
    var m = TX.modal({ title: '워크스페이스 전환', body: body, actions: [{ label: '닫기', kind: 'ghost' }] });
    m.body.addEventListener('click', function (e) {
      var r = e.target.closest('.txf-wsrow');
      if (!r) return;
      var w = r.getAttribute('data-ws');
      m.close();
      toast(w === 'HCG 운영' ? '이미 HCG 운영 워크스페이스입니다.' : '워크스페이스를 전환했습니다: ' + w, 'ok');
    });
  }

  /* ================================================================
   *  3) Header-anchored search dropdown
   * ================================================================ */
  function openSearch(anchor) {
    closePanels();
    var sc = el('div', 'txf-scrim');
    sc.addEventListener('click', closePanels);
    document.body.appendChild(sc);
    var p = el('div', 'txf-sd');
    p.innerHTML =
      '<div class="txf-sd-in"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
      '<input type="text" placeholder="검색어를 입력합니다"></div><div class="txf-sd-res"></div>';
    document.body.appendChild(p);
    var r = anchor.getBoundingClientRect();
    var w = 440, left = Math.min(Math.max(12, r.right - w), window.innerWidth - w - 12);
    p.style.top = (r.bottom + 8) + 'px';
    p.style.left = left + 'px';
    var input = p.querySelector('input'), res = p.querySelector('.txf-sd-res');
    function draw(qv) {
      var list = (D.employees || []);
      /* member 관점: 전 직원 노출 대신 같은 조직(본인+팀) 범위로 스코프 */
      if (curRole() === 'member') list = list.filter(function (e) { return e.org_id === CU.org_id; });
      if (qv) {
        var s = qv.toLowerCase();
        list = list.filter(function (e) {
          return (e.name || '').toLowerCase().indexOf(s) >= 0 ||
            (e.orgName || '').toLowerCase().indexOf(s) >= 0 ||
            (e.jobTitle || '').toLowerCase().indexOf(s) >= 0;
        });
      }
      list = list.slice(0, 30);
      if (!list.length) { res.innerHTML = '<div class="txf-sd-empty">검색 결과가 없습니다.</div>'; return; }
      res.innerHTML = list.map(function (e) {
        return '<div class="txf-sd-row" data-emp="' + esc(e.emp_id) + '">' + F.avatar(e.name, 34) +
          '<div><div class="nm">' + esc(e.name) + '</div><div class="mo">' +
          esc((e.orgName || '') + (e.jobTitle ? ' · ' + e.jobTitle : '')) + '</div></div></div>';
      }).join('');
    }
    input.addEventListener('input', function () { draw(input.value.trim()); });
    res.addEventListener('click', function (e) {
      var row = e.target.closest('.txf-sd-row');
      if (!row) return;
      var id = row.getAttribute('data-emp');
      var emp = null;
      (D.employees || []).forEach(function (x) { if (!emp && x.emp_id === id) emp = x; });
      closePanels();
      if (emp) openEmpDetail(emp);
    });
    draw('');
    requestAnimationFrame(function () { sc.classList.add('on'); p.classList.add('on'); input.focus(); });
    var escFn = function (ev) { if (ev.key === 'Escape') { closePanels(); document.removeEventListener('keydown', escFn); } };
    document.addEventListener('keydown', escFn);
  }

  /* ================================================================
   *  HEADER patch
   * ================================================================ */
  function patchHeader() {
    var right = document.querySelector('.gnb .gnb-right');
    if (!right || right.dataset.txfHeader === '1') return;
    right.dataset.txfHeader = '1';

    /* logo dot → #0E63D6 */
    var dot = document.querySelector('.gnb .logo .d');
    if (dot) dot.style.color = '#0E63D6';

    /* bell: badge → 69, replace handler with right-docked notif panel.
       tx_revive binds on document; clone strips any element listeners, then a
       capture listener stops the event before it reaches the document handler. */
    var bell = right.querySelector('.i[title="알림"]');
    if (bell) {
      var badge = bell.querySelector('.bell-badge');
      if (badge) badge.textContent = String(UNREAD);
      var bell2 = bell.cloneNode(true);
      bell.parentNode.replaceChild(bell2, bell);
      cap(bell2, function () { openNotif(); });
    }

    /* search: header-anchored dropdown */
    var search = right.querySelector('.i[title="검색"]');
    if (search) {
      var s2 = search.cloneNode(true);
      search.parentNode.replaceChild(s2, search);
      cap(s2, function () { openSearch(s2); });
    }

    /* avatar: currentUser initial-circle + rich dropdown */
    var ava = right.querySelector('.ava');
    if (ava) {
      ava.classList.add('txf-avaslot');
      ava.innerHTML = F.avatar(CU.name, 32);
      ava.style.cursor = 'pointer';
      cap(ava, function () { openAvatarMenu(); });
    }
  }

  /* ================================================================
   *  HOME patch
   * ================================================================ */
  function cardByTitle(root, prefix, notPrefix) {
    var cards = root.querySelectorAll('.card');
    for (var i = 0; i < cards.length; i++) {
      var h = cards[i].querySelector('.ct h3');
      if (!h) continue;
      var t = (h.textContent || '').replace(/[›⌄⌃]/g, '').trim();
      if (t.indexOf(prefix) === 0 && (!notPrefix || t.indexOf(notPrefix) !== 0)) return cards[i];
    }
    return null;
  }

  function buildAttCard() {
    var card = el('div', 'card txf-attcard');
    card.innerHTML =
      '<div class="ct"><h3>근태 통계 <span class="chev">›</span></h3></div>' +
      '<div class="body">' +
        '<div class="txf-att-avg">' +
          '<div class="txf-att-a"><b>8시간 2분</b><span>평균 근무시간</span></div>' +
          '<div class="txf-att-a"><b>09:02</b><span>평균 출근시간</span></div>' +
          '<div class="txf-att-a"><b>18:24</b><span>평균 퇴근시간</span></div>' +
        '</div>' +
        '<div class="txf-att-cells">' +
          '<div class="txf-att-c"><b>3</b><span>휴가 사용일</span></div>' +
          '<div class="txf-att-c"><b>1</b><span>휴일 근무일</span></div>' +
          '<div class="txf-att-c hl"><b>2</b><span>근무기록 누락일</span></div>' +
          '<div class="txf-att-c"><b>1</b><span>지각 횟수</span></div>' +
          '<div class="txf-att-c"><b>0</b><span>조퇴 횟수</span></div>' +
        '</div>' +
      '</div>';
    cap(card.querySelector('.ct'), function () { nav('att'); });
    return card;
  }

  /* extra rows appended when 더보기 is clicked, keyed by card title */
  function moreRows(title) {
    if (title.indexOf('피드백') === 0) {
      return [
        ['최정남님이 협업 배지와 피드백을 받았습니다.', '보낸 사람 ' + F.nameTeam(teamPick(2)), '3월 28일 금요일 오후 2:10'],
        ['최정남님이 피드백을 받았습니다.', '보낸 사람 ' + F.nameTeam(teamPick(4)), '3월 14일 금요일 오전 9:48']
      ].map(function (r) {
        return '<div class="frow"><div class="tx">' + esc(r[0]) + '<small>' + esc(r[1]) + '</small></div><div class="dt">' + esc(r[2]) + '</div></div>';
      }).join('');
    }
    if (title.indexOf('최근 활동') === 0) {
      return [
        [teamPick(1) + '님이 ‘고객 만족도 향상’ 목표를 체크인했습니다.', '3월 28일 금요일'],
        [teamPick(3) + '님이 ‘프로젝트 납기 준수율’ 목표를 체크인했습니다.', '3월 21일 토요일'],
        [CU.name + '님이 ‘서비스 기획 품질 향상’ 목표를 체크인했습니다.', '3월 14일 금요일']
      ].map(function (r) {
        return '<div class="frow"><div class="tx">' + esc(r[0]) + '</div><div class="dt">' + esc(r[1]) + '</div></div>';
      }).join('');
    }
    if (title.indexOf('처리할 문서') === 0) {
      return [
        [teamPick(4) + '님이 재택근무 신청', '2026년 6월 28일 일요일 오후 3:20', '근무'],
        [teamPick(2) + '님이 경조금 지급 신청', '2026년 6월 19일 금요일 오전 10:05', '기타']
      ].map(function (r) {
        return '<div class="frow"><div class="tx" style="color:var(--ink-2)">' + esc(r[0]) + '<small>' + esc(r[1]) + '</small></div><div class="tag-r">' + esc(r[2]) + '</div></div>';
      }).join('');
    }
    return '';
  }

  function wireMore(card, title) {
    var more = card.querySelector('.more');
    if (!more) return;
    cap(more, function () {
      var body = card.querySelector('.body');
      var extra = moreRows(title);
      if (body && extra) body.insertAdjacentHTML('beforeend', extra);
      more.style.display = 'none';
      toast('항목을 더 불러왔습니다.');
    });
  }

  /* ---- 성과 preset: performance-centric card grid ---- */
  function buildPerfGrid() {
    var wrap = el('div', 'txh-perf-grid');
    var allObjs = D.objectives || [];
    var teamObjs = allObjs.filter(function (o) { return o.org_id === CU.org_id; });
    if (!teamObjs.length) teamObjs = allObjs.slice(0, 5);
    var mineObjs = allObjs.filter(function (o) { return o.owner_emp_id === CU.emp_id; });
    if (!mineObjs.length) mineObjs = teamObjs.slice(0, 4);
    var avg = 0;
    if (teamObjs.length) {
      teamObjs.forEach(function (o) { avg += (o.progress || 0); });
      avg = Math.round(avg / teamObjs.length * 10) / 10;
    }
    function bar(pct) {
      return '<span class="txh-bar"><i style="width:' + Math.min(100, Math.round(pct || 0)) + '%"></i></span>';
    }
    var goalRows = mineObjs.slice(0, 4).map(function (o) {
      return '<div class="txh-row"><div class="tt">' + esc(o.title) + '<small>' + esc(o.period || '') + ' · ' + esc(o.status || '') + '</small></div>' +
        bar(o.progress) + '<b>' + (o.progress != null ? o.progress : 0) + '%</b></div>';
    }).join('');
    var teamRows = teamObjs.slice(0, 3).map(function (o) {
      return '<div class="txh-row"><div class="tt">' + esc(o.title) + '</div>' + bar(o.progress) + '<b>' + (o.progress != null ? o.progress : 0) + '%</b></div>';
    }).join('');
    var isMember = curRole() === 'member';
    var checks = [
      ['중간점검 1:1 — ' + (CU.managerName || '홍예준'), '2026.07.21 (화) 14:00'],
      ['분기 목표 리뷰 (' + (CU.orgName || 'Package BG') + ')', '2026.07.28 (화) 10:00'],
      /* '상반기 평가 대상자 확정'은 관리자 업무 → member 제외 */
      ['상반기 평가 대상자 확정', '2026.08.04 (화) 09:00']
    ].filter(function (c) { return !isMember || c[0].indexOf('평가 대상자 확정') < 0; });
    var checkRows = checks.map(function (c) {
      return '<div class="txh-row"><div class="tt">' + esc(c[0]) + '</div><span class="dt">' + esc(c[1]) + '</span></div>';
    }).join('');
    var fbs = [
      [teamPick(0), '꼼꼼한 일정 관리 덕분에 출시가 순조로웠어요. 감사합니다!', '7월 8일'],
      [teamPick(3), '기획서 검토 코멘트가 큰 도움이 되었습니다.', '6월 30일'],
      [teamPick(1), '협업 배지와 함께 피드백을 보냈습니다.', '6월 24일']
    ];
    var fbRows = fbs.map(function (f) {
      return '<div class="txh-row"><div class="tt">' + esc(f[1]) + '<small>보낸 사람 ' + esc(f[0]) + '</small></div><span class="dt">' + esc(f[2]) + '</span></div>';
    }).join('');
    function card(title, inner, key, subP) {
      var c = el('div', 'card');
      c.innerHTML = '<div class="ct"><h3>' + title + ' <span class="chev">›</span></h3></div><div class="body">' + inner + '</div>';
      cap(c.querySelector('.ct'), function () { nav(key, subP); });
      return c;
    }
    wrap.appendChild(card('내 목표 진행률', goalRows || '<div class="empty">목표가 없습니다.</div>', 'perf', 0));
    /* '팀 평균 달성률'은 관리자 톤 카드 → leader/hr/exec만 노출 */
    if (!isMember) wrap.appendChild(card('팀 평균 달성률',
      '<div class="txh-big">' + avg + '%</div><div class="txh-sub">' + esc(CU.orgName || '') + ' · 목표 ' + teamObjs.length + '건 평균</div>' + teamRows, 'perf', 0));
    wrap.appendChild(card('다가오는 중간점검', checkRows, 'perf', 1));
    wrap.appendChild(card('최근 피드백', fbRows, 'perf', 1));
    return wrap;
  }

  function patchHome() {
    var home = document.getElementById('s-home');
    if (!home || home.dataset.txfHome === '1') return;
    home.dataset.txfHome = '1';

    /* ---- preset: 기본/성과 two-pill toggle (really swaps dashboard content) ---- */
    var preset = home.querySelector('.home-top .preset');
    if (preset) {
      preset.classList.add('txf-preset');
      preset.classList.remove('preset'); /* drop tx_revive .preset menu binding target */
      preset.innerHTML = '<button class="txf-pp on" data-p="basic">기본</button><button class="txf-pp" data-p="perf">성과</button>';
      var setPreset = function (key) {
        var grid = home.querySelector('.home');
        if (!grid) return;
        var pg = home.querySelector('.txh-perf-grid');
        if (key === 'perf') {
          if (!pg) { pg = buildPerfGrid(); grid.parentNode.insertBefore(pg, grid.nextSibling); }
          grid.style.display = 'none';
          pg.style.display = '';
          toast('성과 대시보드로 전환했습니다.');
        } else {
          if (pg) pg.style.display = 'none';
          grid.style.display = '';
          toast('기본 대시보드로 전환했습니다.');
        }
      };
      preset.querySelectorAll('.txf-pp').forEach(function (pill) {
        cap(pill, function () {
          preset.querySelectorAll('.txf-pp').forEach(function (x) { x.classList.toggle('on', x === pill); });
          setPreset(pill.getAttribute('data-p'));
        });
      });
    }

    /* ---- 대시보드 설정 → settings modal (widget visibility) ---- */
    var setBtn = null;
    home.querySelectorAll('.home-top .ghost-btn').forEach(function (b) {
      if ((b.textContent || '').indexOf('대시보드 설정') >= 0) setBtn = b;
    });
    if (setBtn) cap(setBtn, function () { openDashSettings(); });

    /* ---- feedback senders: vary + real names(team) ---- */
    var fbCard = cardByTitle(home, '피드백', '360');
    if (fbCard) {
      var fbBody = fbCard.querySelector('.body');
      if (fbBody) {
        var fb = [
          { badge: '', from: teamPick(0), dt: '4월 24일 금요일 오후 1:30' },
          { badge: '최고지향 배지와 ', from: teamPick(3), dt: '4월 11일 토요일 오후 2:23' },
          { badge: '책임감 배지와 ', from: teamPick(1), dt: '3월 27일 금요일 오후 4:21' }
        ];
        fbBody.innerHTML = fb.map(function (r) {
          return '<div class="frow"><div class="tx">' + esc(CU.name) + '님이 ' + esc(r.badge) +
            '피드백을 받았습니다.<small>보낸 사람 ' + esc(F.nameTeam(r.from)) + '</small></div><div class="dt">' + esc(r.dt) + '</div></div>';
        }).join('');
      }
    }

    /* ---- build/insert 근태 통계 widget & REORDER left column ---- */
    var leftCol = home.querySelector('.home .col');
    if (leftCol) {
      var attCard = buildAttCard();
      var order = [
        cardByTitle(home, '처리할 문서'),
        cardByTitle(home, '최근 활동'),
        attCard,
        cardByTitle(home, '예정 휴가'),
        cardByTitle(home, '나의 목표'),
        cardByTitle(home, '피드백', '360'),
        cardByTitle(home, '360 피드백')
      ];
      order.forEach(function (c) { if (c) leftCol.appendChild(c); });
      if (curRole()==='member'){ var _dc=cardByTitle(home,'처리할 문서'); if(_dc)_dc.style.display='none'; }
    }

    /* ---- widget navigation (chevrons + rows) ---- */
    function wireCard(title, key, subP) {
      var parts = title.split('|');
      var c = cardByTitle(home, parts[0], parts[1]);
      if (!c) return null;
      var chev = c.querySelector('.ct .chev') || c.querySelector('.ct h3');
      cap(chev, function () { nav(key, subP); });
      c.querySelectorAll('.body .frow, .body .goal').forEach(function (row) {
        cap(row, function () { nav(key, subP); });
      });
      return c;
    }
    wireCard('나의 목표', 'perf', 0);
    wireCard('예정 휴가', 'att', null); /* chevron+rows → 근무관리 (was dead tx_revive fallback) */
    var wfCard = wireCard('처리할 문서', 'wf', null);
    var fbC = wireCard('피드백|360', 'perf', 1);
    wireCard('360 피드백', 'msf', null);
    var actCard = cardByTitle(home, '최근 활동');
    if (actCard) actCard.querySelectorAll('.body .frow').forEach(function (row) { cap(row, function () { nav('perf', 0); }); });

    /* ---- 더보기 expansion ---- */
    [['피드백', fbC], ['최근 활동', actCard], ['처리할 문서', wfCard]].forEach(function (p) {
      if (p[1]) wireMore(p[1], p[0]);
    });

    /* ---- work card: blue 출근 button above dark 근무 신청 ---- */
    var darkBtn = home.querySelector('.wcard .btn-dark');
    if (darkBtn && !home.querySelector('.txf-checkin')) {
      var chk = el('button', 'txf-checkin', '출근');
      darkBtn.parentNode.insertBefore(chk, darkBtn);
      cap(chk, function () {
        if (chk.classList.contains('done')) return;
        chk.classList.add('done');
        chk.textContent = '출근 완료 · 09:02';
        var pill = home.querySelector('.wcard .wpill');
        if (pill) pill.textContent = '근무중';
        toast('출근 처리되었습니다.', 'ok');
      });
    }

    /* ---- 근무 현황 member list: real count + varied teams + initial avatars ---- */
    var wcard = null;
    home.querySelectorAll('.wcard').forEach(function (w) {
      if (!wcard && /근무\s*현황/.test(w.textContent || '') && w.querySelector('.selectbar')) wcard = w;
    });
    if (wcard) {
      var mine = (D.employees || []).filter(function (e) { return e.org_id === CU.org_id; });
      var others = (D.employees || []).filter(function (e) { return e.org_id !== CU.org_id; });
      /* member 관점: 타 조직원 근무상태는 제외하고 같은 조직만 표시 */
      var members = (curRole() === 'member' ? mine : mine.concat(others)).slice(0, 17);
      var selBar = wcard.querySelector('.selectbar .sp');
      if (selBar) selBar.textContent = '전체 (' + members.length + ') ⌄';
      wcard.querySelectorAll('.mrow').forEach(function (r) { r.remove(); });
      var mhtml = members.map(function (e) {
        return '<div class="mrow">' + F.avatar(e.name, 30) +
          '<div><div class="mn">' + esc(e.name) + '</div>' +
          '<div class="mo">' + esc(F.teamName(e) || '') + '</div></div></div>';
      }).join('');
      var anchor = wcard.querySelector('.selectbar');
      if (anchor) anchor.insertAdjacentHTML('afterend', mhtml);
      else wcard.insertAdjacentHTML('beforeend', mhtml);
    }
  }

  /* ---- dashboard settings modal ---- */
  function openDashSettings() {
    if (!TX || !TX.modal) { toast('대시보드 설정'); return; }
    var widgets = ['처리할 문서', '최근 활동', '근태 통계', '예정 휴가', '나의 목표', '피드백', '360 피드백'];
    var body = '<div style="font-size:13px;color:var(--ink-3);margin-bottom:12px">대시보드에 표시할 위젯을 선택하세요.</div>' +
      widgets.map(function (w) {
        return '<label style="display:flex;align-items:center;gap:10px;padding:9px 2px;font-size:14px;color:var(--ink);cursor:pointer">' +
          '<input type="checkbox" checked style="width:16px;height:16px"> ' + esc(w) + '</label>';
      }).join('');
    TX.modal({
      title: '대시보드 설정', body: body,
      actions: [{ label: '취소', kind: 'ghost' }, { label: '저장', kind: 'primary', onClick: function () { toast('대시보드 설정을 저장했습니다.', 'ok'); } }]
    });
  }

  /* ================================================================ */
  F.ready(function () {
    try {
      injectCSS();
      patchHeader();
      patchHome();
    } catch (e) { console.error('[txfix-home] fatal', e); }
  });
})();
