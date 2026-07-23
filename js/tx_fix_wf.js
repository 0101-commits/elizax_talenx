/* tx_fix_wf.js — 신청/승인(Approval workflow) 화면 fidelity 고도화 (2026-07-15)
 * ------------------------------------------------------------------
 * Rebuilds the 3 workflow sub-pages (받은 문서 / 보낸 문서 / 서명 문서) inner
 * content from a single self-consistent dataset so that, on every screen:
 *   pill counts  ==  filter badges  ==  actual DOM rows  ==  footer "1–N of N".
 *
 * Everything derives from the DATA arrays below. Pills swap the visible
 * dataset; filters sub-filter it; checkbox selection enables 반려/승인/읽음;
 * actions actually mutate rows and every number updates live.
 *
 * Runs inside TXFIX.ready() + re-applies on section open. Idempotent.
 * Owns its own `.txf-*` markup/classes so the old delegated handlers in
 * tx_revive/tx_enhance (which key off `.wf-abtn`, `.wf-pills button`,
 * `.wf-filter .fi`, `.cbx`) no longer match — and the section-scoped
 * listener stops propagation so tx_revive's generic row/bubble handlers
 * never double-fire. No network. Scoped CSS appended once.
 */
(function () {
  'use strict';
  if (window.__txfWf) return;
  window.__txfWf = true;

  var F = window.TXFIX || {};
  var TX = window.TX || {};
  var esc = (TX.esc) || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  /* ---------------- senders: real OTHER employees (not currentUser) -------- */
  var CUID = (F.CU && F.CU.emp_id) || 'EMP-0078';
  var pool = ((F.D && F.D.employees) || []).filter(function (e) {
    return e && e.emp_id !== CUID && e.name;
  });
  function P(i) {
    return pool.length ? pool[i % pool.length]
      : { name: '담당자', orgName: '인사팀' };
  }
  function nameTeam(e) {
    if (F.nameTeam) { var s = F.nameTeam(e); if (s) return s; }
    var t = e.orgName || '';
    return t ? (e.name + '(' + t + ')') : e.name;
  }
  var rs = [P(3), P(3), P(3), P(9)];          // 3 docs from one sender + 1 other
  var reqName = P(3).name;                      // 서명 요청자

  /* ---------------- datasets (module-scoped: survive re-render) ------------ */
  // status: 'p'=진행중, 'd'=완료 ; need=승인필요 ; unread=읽지않음 ; imp=중요
  var DATA = {
    received: [
      { id: 'r1', status: 'p', s: rs[0], type: '근무', recv: '승인', form: '근무내역 변경', need: true, unread: false, imp: false,
        sum: '변경 일자 : 26.06.10(수), 누락 정보 : 출근·퇴근, 변경 정보 : 출근(09:00), 퇴근(18:00)', date: '2026.06.30' },
      { id: 'r2', status: 'p', s: rs[1], type: '기타', recv: '승인', form: '도서비 신청', need: true, unread: false, imp: false,
        sum: '도서명 : 클린 아키텍처, 구매처 : 온라인, 신청금액 : 32,000원', date: '2026.05.27' },
      { id: 'r3', status: 'p', s: rs[2], type: '기타', recv: '승인', form: '경조금 지급 신청', need: true, unread: false, imp: false,
        sum: '신청구분 : 경조, 경조사명 : 자녀 결혼, 경조금 : 200,000원', date: '2026.04.21' },
      { id: 'r4', status: 'p', s: rs[3], type: '근무', recv: '승인', form: '출장비 신청', need: true, unread: false, imp: false,
        sum: '출장기간 : 2026.03.23 ~ 2026.03.24, 출장지 : 부산, 신청금액 : 180,000원', date: '2026.03.18' },
      { id: 'r5', status: 'd', s: P(14), type: '근무', recv: '승인', form: '재택근무 요청', need: false, unread: false, imp: false,
        sum: '재택근무 일자 : 26.02.20(금), 사용 일자 : 1일', date: '2026.02.20' }
    ],
    sent: [
      { id: 's1', status: 'p', type: '휴가', form: '휴가 요청', badge: '요청중', isNew: true, unread: true, imp: false,
        sum: '휴가 종류 : 연차, 휴가 일자 : 27.01.07(목), 사용 시간 : 2시간(잔여 59시간)', date: '44분 전' },
      { id: 's2', status: 'p', type: '근무', form: '대체근무', badge: '요청중', isNew: true, unread: false, imp: false,
        sum: '대체 근무일 : 26.07.18(토), 대체 휴일/휴무일 : 26.07.24(금)', date: '2026.07.01' },
      { id: 's3', status: 'p', type: '근무', form: '대체근무', badge: '요청중', isNew: false, unread: false, imp: false,
        sum: '대체 근무일 : 26.07.17(금), 대체 휴일/휴무일 : 26.07.23(목)', date: '2026.07.01' },
      { id: 's4', status: 'p', type: '근무', form: '근무내역 변경', badge: '요청중', isNew: false, unread: false, imp: false,
        sum: '변경 일자 : 26.06.12(금), 누락 정보 : 출근·퇴근, 변경 정보 : 출근(09:00), 퇴근(20:00)', date: '2026.06.23' },
      { id: 's5', status: 'd', type: '휴가', form: '휴가 요청', badge: '승인완료', unread: false, imp: true,
        sum: '휴가 종류 : 연차, 휴가 일자 : 26.05.02(금), 사용 시간 : 8시간', date: '2026.04.28' },
      { id: 's6', status: 'd', type: '근무', form: '근무내역 변경', badge: '승인완료', unread: false, imp: false,
        sum: '변경 일자 : 26.04.15(수), 변경 정보 : 출근(09:00), 퇴근(19:00)', date: '2026.04.14' },
      { id: 's7', status: 'd', type: '근무', form: '대체근무', badge: '승인완료', unread: false, imp: false,
        sum: '대체 근무일 : 26.04.05(토), 대체 휴일/휴무일 : 26.04.10(금)', date: '2026.04.03' },
      { id: 's8', status: 'd', type: '기타', form: '교육비 신청', badge: '반려', unread: false, imp: false,
        sum: '교육명 : 리더십 과정, 신청금액 : 300,000원', date: '2026.03.20' },
      { id: 's9', status: 'd', type: '근무', form: '재택근무 요청', badge: '승인완료', unread: false, imp: false,
        sum: '재택근무 일자 : 26.03.10(월), 사용 일자 : 1일', date: '2026.03.09' },
      { id: 's10', status: 'd', type: '근무', form: '초과근무 신청', badge: '승인완료', unread: false, imp: false,
        sum: '초과근무 일자 : 26.02.27(금), 사용 시간 : 3시간', date: '2026.02.26' },
      { id: 's11', status: 'd', type: '기타', form: '경조금 지급 신청', badge: '승인완료', unread: false, imp: false,
        sum: '경조사명 : 본인 결혼, 경조금 : 500,000원', date: '2026.02.10' },
      { id: 's12', status: 'd', type: '휴가', form: '휴가 요청', badge: '승인완료', unread: false, imp: false,
        sum: '휴가 종류 : 반차, 휴가 일자 : 26.01.30(금)', date: '2026.01.29' }
    ],
    sign: [
      { id: 'g1', type: '계약서', name: '연봉계약서 2026', reqDate: '2026-04-01 13:24', signDate: null, by: reqName },
      { id: 'g2', type: '동의서', name: '개인정보 수집·이용 동의서', reqDate: '2026-03-15 09:30', signDate: null, by: reqName },
      { id: 'g3', type: '동의서', name: '재택근무 서약서', reqDate: '2026-02-28 17:10', signDate: null, by: reqName },
      { id: 'g4', type: '계약서', name: '연봉계약서 2025', reqDate: '2025-04-01 10:00', signDate: '2025-04-02 09:12', by: reqName },
      { id: 'g5', type: '동의서', name: '보안 서약서', reqDate: '2025-01-05 11:00', signDate: '2025-01-05 15:40', by: reqName }
    ]
  };

  var ST = {
    received: { pill: 'progress', filter: 'all', sel: {} },
    sent:     { pill: 'progress', filter: 'all', sel: {} },
    sign:     { pill: 'wait',     filter: 'all', sel: {} }
  };

  var P2KEY = { '0': 'received', '1': 'sent', '2': 'sign' };
  var KEY2P = { received: '0', sent: '1', sign: '2' };

  var CFG = {
    received: {
      title: '받은 문서', write: true, select: true, bmark: true, rpp: 100,
      pills: [['progress', '진행중'], ['done', '완료'], ['important', '중요']],
      filters: [['all', '전체', 'dot'], ['need', '승인필요', 'chk'], ['unread', '읽지않음', 'dot']],
      actions: [['reject', '반려'], ['approve', '승인']]
    },
    sent: {
      title: '보낸 문서', write: true, select: true, bmark: true, rpp: 100,
      pills: [['progress', '진행중'], ['done', '완료'], ['important', '중요']],
      filters: [['all', '전체', 'dot'], ['unread', '읽지않음', 'chk']],
      actions: [['read', '읽음']]
    },
    sign: {
      title: '서명 문서', write: false, select: false, bmark: false, rpp: 10,
      pills: [['wait', '대기 문서'], ['done', '완료 문서']],
      filters: [['all', '전체', 'dot'], ['sign', '서명필요', 'chk']],
      actions: []
    }
  };

  var FUNNEL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>';

  /* ---------------- derivations ------------------------------------------- */
  // 부하 없는 조직원(member)은 결재자가 아니다 → '받은 문서'(결재 대기함) 게이팅.
  // 렌더 시점에 평가하여 역할 전환(reload) 후에도 정합. leader/hr/exec는 불변.
  function isMember() {
    var r = (F.CU && F.CU._role) ||
      (window.TXRoles && TXRoles.current && TXRoles.current().key) || 'member';
    return r === 'member';
  }
  function baseFor(key, pill) {
    if (key === 'received' && isMember()) return [];
    var arr = DATA[key];
    if (key === 'sign') return arr.filter(function (d) { return pill === 'wait' ? !d.signDate : !!d.signDate; });
    if (pill === 'important') return arr.filter(function (d) { return d.imp; });
    if (pill === 'done') return arr.filter(function (d) { return d.status === 'd'; });
    return arr.filter(function (d) { return d.status === 'p'; });
  }
  function visFor(base, key, filter) {
    if (filter === 'need') return base.filter(function (d) { return d.need; });
    if (filter === 'unread') return base.filter(function (d) { return d.unread; });
    return base; // 'all' or 'sign' (sign base already the pill set)
  }
  function filterCount(base, key, fk) {
    if (fk === 'all') return base.length;
    return visFor(base, key, fk).length;
  }

  /* ---------------- markup builders --------------------------------------- */
  function badgeCls(txt) {
    if (txt === '승인필요' || txt === '서명필요') return 'need';
    if (txt === '요청중') return 'req';
    if (txt === '반려') return 'rej';
    return 'done';
  }
  function ckHtml(id, on) {
    return '<span class="txf-cbx' + (on ? ' on' : '') + '" data-txf="ck" data-id="' + id + '"></span>';
  }
  function allckHtml(on) {
    return '<span class="txf-cbx' + (on ? ' on' : '') + '" data-txf="allck"></span>';
  }
  function starHtml(id, on) {
    return '<span class="txf-star' + (on ? ' on' : '') + '" data-txf="star" data-id="' + id + '" title="중요 표시">' + (on ? '★' : '☆') + '</span>';
  }

  function rowsHtml(key, vis, st) {
    if (!vis.length) {
      var span = key === 'received' ? 7 : 5;
      var msg = key === 'received' ? '결재할 문서가 없습니다.' : '문서가 없습니다.';
      return '<tr data-txf-empty="1"><td colspan="' + span + '" class="txf-empty">' + msg + '</td></tr>';
    }
    return vis.map(function (d) {
      if (key === 'received') {
        return '<tr data-txf="row" data-id="' + d.id + '">'
          + '<td class="txf-cchk">' + ckHtml(d.id, !!st.sel[d.id]) + '</td>'
          + '<td class="txf-sender"><b>' + esc(d.s.name) + '</b><small>' + esc(d.s.orgName || '') + '</small></td>'
          + '<td>' + esc(d.type) + '</td><td>' + esc(d.recv) + '</td>'
          + '<td><span class="txf-form">' + esc(d.form) + (d.need ? ' <span class="txf-badge need">승인필요</span>' : '') + '</span></td>'
          + '<td class="txf-sum">' + esc(d.sum) + '</td>'
          + '<td class="txf-date">' + esc(d.date) + ' ' + starHtml(d.id, !!d.imp) + '</td>'
          + '</tr>';
      }
      if (key === 'sent') {
        return '<tr data-txf="row" data-id="' + d.id + '">'
          + '<td class="txf-cchk">' + ckHtml(d.id, !!st.sel[d.id]) + '</td>'
          + '<td>' + esc(d.type) + '</td>'
          + '<td><span class="txf-form">' + esc(d.form)
          + (d.badge ? ' <span class="txf-badge ' + badgeCls(d.badge) + '">' + esc(d.badge) + '</span>' : '')
          + (d.isNew ? ' <span class="txf-new">• 신규</span>' : '') + '</span></td>'
          + '<td class="txf-sum">' + esc(d.sum) + '</td>'
          + '<td class="txf-date">' + esc(d.date) + ' ' + starHtml(d.id, !!d.imp) + '</td>'
          + '</tr>';
      }
      // sign
      var wait = !d.signDate;
      return '<tr data-txf="row" data-id="' + d.id + '">'
        + '<td>' + esc(d.type) + '</td>'
        + '<td><span class="txf-form"><span class="txf-signname">' + esc(d.name) + '</span>'
        + (wait ? ' <span class="txf-badge need">서명필요</span>' : ' <span class="txf-badge done">서명완료</span>') + '</span></td>'
        + '<td class="txf-date">' + esc(d.reqDate) + '</td>'
        + '<td class="' + (d.signDate ? 'txf-date' : 'txf-dash') + '">' + esc(d.signDate || '-') + '</td>'
        + '<td>' + esc(d.by) + '</td>'
        + '</tr>';
    }).join('');
  }

  function theadHtml(key, allOn) {
    if (key === 'received') {
      return '<tr><th class="txf-cchk">' + allckHtml(allOn)
        + '</th><th>보낸 사람</th><th>문서 유형</th><th>수신 유형</th><th>문서 양식</th><th>요약 정보</th><th class="txf-sort">요청일 <span>↓</span></th></tr>';
    }
    if (key === 'sent') {
      return '<tr><th class="txf-cchk">' + allckHtml(allOn)
        + '</th><th>문서 유형</th><th>문서 양식</th><th>요약 정보</th><th class="txf-sort">요청일 <span>↓</span></th></tr>';
    }
    return '<tr><th>문서 유형</th><th>문서명</th><th>서명 요청일</th><th>서명일</th><th>서명 요청자</th></tr>';
  }

  function build(key) {
    var cfg = CFG[key], st = ST[key];
    var base = baseFor(key, st.pill);
    var vis = visFor(base, key, st.filter);
    var selCount = cfg.select ? vis.filter(function (d) { return st.sel[d.id]; }).length : 0;
    var allOn = cfg.select && vis.length > 0 && selCount === vis.length;

    // title
    var h = '<div class="txf-title"><h2>' + cfg.title + '</h2>'
      + (cfg.write ? '<button class="txf-write" data-txf="write">문서 작성</button>' : '') + '</div>';

    // pills
    h += '<div class="txf-pills">';
    cfg.pills.forEach(function (p) {
      var cnt = baseFor(key, p[0]).length;
      h += '<button class="txf-pill' + (st.pill === p[0] ? ' on' : '') + '" data-txf="pill" data-pill="' + p[0] + '">'
        + p[1] + ' ' + cnt + '</button>';
    });
    h += '</div>';

    // card > filter row
    h += '<div class="txf-card"><div class="txf-filter">';
    cfg.filters.forEach(function (fl) {
      var fk = fl[0], label = fl[1], mark = fl[2];
      var cnt = filterCount(base, key, fk);
      var lbl = label;
      if (key === 'sign' && fk === 'sign') lbl = (st.pill === 'wait') ? '서명필요' : '서명완료';
      var mk = mark === 'chk' ? '<span class="txf-chk">✓</span>' : '<span class="txf-dot">•</span>';
      var red = (cfg.bmark && fk === 'all' && cnt > 0) ? '<span class="txf-bmark">•</span>' : '';
      h += '<span class="txf-fi' + (st.filter === fk ? ' on' : '') + '" data-txf="filter" data-filter="' + fk + '">'
        + mk + lbl + ' ' + cnt + red + '</span>';
    });
    // right cluster
    h += '<span class="txf-rt">';
    if (cfg.select) {
      h += '<span class="txf-cnt">' + selCount + ' / ' + vis.length + '</span>';
      cfg.actions.forEach(function (a) {
        var off = selCount === 0;
        h += '<button class="txf-abtn a-' + a[0] + (off ? ' is-off' : '') + '" data-txf="act" data-act="' + a[0] + '"'
          + (off ? ' disabled' : '') + '>' + a[1] + '</button>';
      });
    }
    h += '<span class="txf-ficon" data-txf="funnel" title="필터">' + FUNNEL + '</span>';
    h += '</span></div>';

    // table
    h += '<div class="txf-tablewrap"><table class="txf-tbl"><thead>' + theadHtml(key, allOn) + '</thead>'
      + '<tbody>' + rowsHtml(key, vis, st) + '</tbody></table></div>';

    // footer
    var n = vis.length;
    var range = n ? ('1–' + n + ' of ' + n) : '0–0 of 0';
    h += '<div class="txf-foot"><span class="txf-rpp">페이지당 <b>' + cfg.rpp + '</b>개 ⌄</span>'
      + '<span>' + range + '</span><span class="txf-pg"><span>‹</span><span>›</span></span></div>';

    h += '</div>';
    return h;
  }

  /* ---------------- render ------------------------------------------------ */
  function renderKey(key, root) {
    root = root || document.getElementById('s-wf');
    if (!root) return;
    var pageEl = root.querySelector('.wf-page[data-p="' + KEY2P[key] + '"]');
    if (pageEl) pageEl.innerHTML = build(key);
  }
  function renderAll(root) {
    root = root || document.getElementById('s-wf');
    if (!root) return;
    renderKey('received', root);
    renderKey('sent', root);
    renderKey('sign', root);
  }

  /* ---------------- actions ----------------------------------------------- */
  function selIds(key) {
    var s = ST[key].sel;
    return Object.keys(s).filter(function (id) { return s[id]; });
  }
  function doApprove(key, approve) {
    var ids = selIds(key);
    if (!ids.length) return;
    DATA[key] = DATA[key].filter(function (d) { return ids.indexOf(d.id) < 0; });
    ST[key].sel = {};
    renderKey(key);
    if (TX.toast) TX.toast('선택한 ' + ids.length + '건을 ' + (approve ? '승인' : '반려') + '했습니다.', 'ok');
  }
  function doRead(key) {
    var ids = selIds(key);
    if (!ids.length) return;
    DATA[key].forEach(function (d) { if (ids.indexOf(d.id) >= 0) d.unread = false; });
    ST[key].sel = {};
    renderKey(key);
    if (TX.toast) TX.toast('선택한 ' + ids.length + '건을 읽음 처리했습니다.', 'ok');
  }

  /* ---------------- event handling (section-scoped, single listener) ------ */
  function onClick(e) {
    // subnav switch → re-apply the freshly-shown page (idempotent)
    var nav = e.target.closest && e.target.closest('.subnav a[data-p]');
    if (nav) {
      var p = nav.getAttribute('data-p');
      setTimeout(function () { renderKey(P2KEY[p] || 'received'); }, 0);
      return; // let inline subnav script toggle .wf-page.on
    }

    var el = e.target.closest && e.target.closest('[data-txf]');
    if (!el) return;
    var pageEl = el.closest('.wf-page');
    var key = pageEl ? (P2KEY[pageEl.getAttribute('data-p')] || 'received') : 'received';
    var kind = el.getAttribute('data-txf');

    // shield old tx_revive/tx_enhance delegated handlers from double-firing
    e.stopPropagation();
    if (e.preventDefault) e.preventDefault();

    var st = ST[key];

    if (kind === 'pill') {
      var pk = el.getAttribute('data-pill');
      if (st.pill !== pk) { st.pill = pk; st.filter = 'all'; st.sel = {}; renderKey(key); }
      return;
    }
    if (kind === 'filter') {
      var fk = el.getAttribute('data-filter');
      if (st.filter !== fk) { st.filter = fk; st.sel = {}; renderKey(key); }
      return;
    }
    if (kind === 'allck') {
      var base = visFor(baseFor(key, st.pill), key, st.filter);
      var allSel = base.length > 0 && base.every(function (d) { return st.sel[d.id]; });
      base.forEach(function (d) { if (allSel) delete st.sel[d.id]; else st.sel[d.id] = true; });
      renderKey(key);
      return;
    }
    if (kind === 'ck') {
      var id = el.getAttribute('data-id');
      if (st.sel[id]) delete st.sel[id]; else st.sel[id] = true;
      renderKey(key);
      return;
    }
    if (kind === 'star') {
      var sid = el.getAttribute('data-id');
      var doc = DATA[key].filter(function (d) { return d.id === sid; })[0];
      if (doc) { doc.imp = !doc.imp; renderKey(key); }
      return;
    }
    if (kind === 'act') {
      var act = el.getAttribute('data-act');
      if (el.hasAttribute('disabled')) return;
      var ids = selIds(key);
      if (!ids.length) return;
      if (act === 'approve') {
        if (TX.confirm) TX.confirm('승인', '선택한 ' + ids.length + '건의 문서를 승인하시겠습니까?', function () { doApprove(key, true); }, '승인');
        else doApprove(key, true);
      } else if (act === 'reject') {
        if (TX.modal) {
          TX.modal({
            title: '반려',
            body: (TX.field ? TX.field('반려 사유', '<textarea placeholder="반려 사유를 입력하세요"></textarea>') : '<textarea placeholder="반려 사유"></textarea>'),
            actions: [{ label: '취소', kind: 'ghost' }, { label: '반려', kind: 'danger', onClick: function () { doApprove(key, false); } }]
          });
        } else doApprove(key, false);
      } else if (act === 'read') {
        doRead(key);
      }
      return;
    }
    if (kind === 'write') {
      if (TX.modal) {
        TX.modal({
          title: '문서 작성',
          body: (TX.field ? (TX.field('문서 유형', '<select><option>휴가 신청서</option><option>근무 신청서</option><option>기타 신청서</option></select>')
            + TX.field('제목', '<input type="text" placeholder="제목을 입력하세요">')
            + TX.field('내용', '<textarea placeholder="내용을 입력하세요"></textarea>')) : ''),
          actions: [{ label: '취소', kind: 'ghost' }, { label: '작성', kind: 'primary', onClick: function () { if (TX.toast) TX.toast('문서를 작성했습니다.', 'ok'); } }]
        });
      }
      return;
    }
    if (kind === 'funnel') {
      if (TX.toast) TX.toast('필터 옵션을 표시합니다.');
      return;
    }
    if (kind === 'row') {
      var rid = el.getAttribute('data-id');
      var d = DATA[key].filter(function (x) { return x.id === rid; })[0];
      if (!d) return;
      if (key === 'sign' && !d.signDate) {
        if (TX.confirm) TX.confirm('서명', '「' + d.name + '」 문서에 서명하시겠습니까?', function () {
          d.signDate = '2026-07-15 09:00'; renderKey('sign');
          if (TX.toast) TX.toast('서명을 완료했습니다.', 'ok');
        }, '서명');
        return;
      }
      openDetail(key, d);
      return;
    }
  }

  function openDetail(key, d) {
    if (!TX.drawer) { if (TX.toast) TX.toast('문서 상세를 불러왔습니다.'); return; }
    var rows;
    if (key === 'sign') {
      rows = [['문서 유형', d.type], ['문서명', d.name], ['서명 요청일', d.reqDate], ['서명일', d.signDate || '-'], ['서명 요청자', d.by]];
    } else if (key === 'received') {
      rows = [['보낸 사람', nameTeam(d.s)], ['문서 유형', d.type], ['수신 유형', d.recv], ['문서 양식', d.form], ['요약 정보', d.sum], ['요청일', d.date]];
    } else {
      rows = [['문서 유형', d.type], ['문서 양식', d.form], ['상태', d.badge || '-'], ['요약 정보', d.sum], ['요청일', d.date]];
    }
    var body = '<div class="txf-dl">' + rows.map(function (r) {
      return '<div class="txf-dr"><span class="txf-dk">' + esc(r[0]) + '</span><span class="txf-dv">' + esc(r[1]) + '</span></div>';
    }).join('') + '</div>';
    TX.drawer({ title: (d.form || d.name), subtitle: CFG[key].title, body: body, width: '420px' });
  }

  /* ---------------- styles (appended once) -------------------------------- */
  function injectStyle() {
    if (document.getElementById('txf-wf-style')) return;
    var css = ''
      + '#s-wf .txf-title{display:flex;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px 24px;margin-bottom:16px;min-height:24px}'
      + '#s-wf .txf-title h2{margin:0;font-size:20px;font-weight:800;letter-spacing:-.02em;color:var(--ink)}'
      + '#s-wf .txf-write{margin-left:auto;background:var(--blue);color:#fff;font-size:14px;font-weight:700;padding:11px 20px;border-radius:9px;cursor:pointer}'
      + '#s-wf .txf-write:hover{background:var(--blue-2)}'
      + '#s-wf .txf-pills{display:flex;gap:10px;margin-bottom:18px}'
      + '#s-wf .txf-pill{background:var(--card);border:1px solid var(--line);color:var(--ink-2);font-size:13.5px;font-weight:700;padding:8px 18px;border-radius:22px;cursor:pointer;font-variant-numeric:tabular-nums}'
      + '#s-wf .txf-pill.on{background:var(--dark);color:#fff;border-color:var(--dark)}'
      + '#s-wf .txf-card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 6px 8px}'
      + '#s-wf .txf-filter{display:flex;align-items:center;gap:20px;padding:2px 18px 16px;font-size:13.5px}'
      + '#s-wf .txf-fi{display:flex;align-items:center;gap:6px;color:var(--ink-2);font-weight:600;position:relative;cursor:pointer;font-variant-numeric:tabular-nums}'
      + '#s-wf .txf-fi.on{color:var(--ink);font-weight:700}'
      + '#s-wf .txf-fi .txf-dot{color:var(--ink-4);font-size:16px;line-height:1}'
      + '#s-wf .txf-fi .txf-chk{color:var(--blue);font-weight:800}'
      + '#s-wf .txf-bmark{color:var(--red);font-size:9px;line-height:1;align-self:flex-start;margin-left:-3px;margin-top:-2px}'
      + '#s-wf .txf-rt{margin-left:auto;display:flex;align-items:center;gap:10px}'
      + '#s-wf .txf-cnt{color:var(--ink-3);font-weight:600;font-variant-numeric:tabular-nums;margin-right:4px}'
      + '#s-wf .txf-abtn{border:1px solid var(--line);background:var(--card);color:var(--ink-2);font-size:12.5px;font-weight:700;padding:7px 15px;border-radius:8px;cursor:pointer}'
      + '#s-wf .txf-abtn.a-approve{border-color:var(--blue);color:var(--blue)}'
      + '#s-wf .txf-abtn.a-read{border-color:var(--blue);color:var(--blue)}'
      + '#s-wf .txf-abtn.a-reject{border-color:var(--red);color:var(--red)}'
      + '#s-wf .txf-abtn.is-off{background:var(--soft);color:var(--ink-4);border-color:var(--line);cursor:default}'
      + '#s-wf .txf-ficon{width:34px;height:34px;border:1px solid var(--line);border-radius:8px;display:grid;place-items:center;color:var(--ink-2);cursor:pointer}'
      + '#s-wf .txf-ficon svg{display:block}'
      + '#s-wf .txf-tablewrap{overflow-x:auto}'
      + '#s-wf table.txf-tbl{width:100%;border-collapse:collapse;min-width:1000px}'
      + '#s-wf table.txf-tbl th{text-align:left;font-size:12.5px;font-weight:600;color:var(--ink-3);padding:10px 12px;border-bottom:1px solid var(--line);white-space:nowrap}'
      + '#s-wf table.txf-tbl td{padding:14px 12px;border-bottom:1px solid var(--line-2);vertical-align:middle;font-size:13.5px;color:var(--ink)}'
      + '#s-wf table.txf-tbl tbody tr[data-txf="row"]{cursor:pointer}'
      + '#s-wf table.txf-tbl tbody tr[data-txf="row"]:hover td{background:var(--soft)}'
      + '#s-wf .txf-cchk{width:30px}'
      + '#s-wf .txf-cbx{width:16px;height:16px;border:1.5px solid var(--ink-4);border-radius:4px;display:inline-block;box-sizing:border-box;cursor:pointer;vertical-align:middle;position:relative}'
      + '#s-wf .txf-cbx.on{background:var(--blue);border-color:var(--blue)}'
      + '#s-wf .txf-cbx.on:after{content:"";position:absolute;left:4px;top:1px;width:4px;height:8px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}'
      + '#s-wf .txf-sort span{margin-left:3px;color:var(--ink-4)}'
      + '#s-wf .txf-sender b{display:block;font-size:14px;font-weight:700;color:var(--ink)}'
      + '#s-wf .txf-sender small{display:block;font-size:12px;color:var(--ink-3);margin-top:2px}'
      + '#s-wf .txf-form{display:flex;align-items:center;gap:8px;white-space:nowrap}'
      + '#s-wf .txf-badge{font-size:11px;font-weight:700;padding:3px 9px;border-radius:6px;white-space:nowrap}'
      + '#s-wf .txf-badge.need{background:var(--blue-soft);color:var(--blue-2)}'
      + '#s-wf .txf-badge.req{background:var(--line-2);color:var(--ink-2)}'
      + '#s-wf .txf-badge.done{background:#E6F4EA;color:#137333}'
      + '#s-wf .txf-badge.rej{background:#FCE8E6;color:#C5221F}'
      + '#s-wf .txf-new{color:var(--red);font-size:11.5px;font-weight:700;white-space:nowrap}'
      + '#s-wf .txf-sum{color:var(--ink-3);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
      + '#s-wf .txf-date{white-space:nowrap;font-weight:600;color:var(--ink)}'
      + '#s-wf .txf-dash{color:var(--ink-4)}'
      + '#s-wf .txf-signname{font-weight:600;color:var(--ink)}'
      + '#s-wf .txf-star{color:var(--ink-4);margin-left:12px;font-size:15px;cursor:pointer}'
      + '#s-wf .txf-star.on{color:var(--orange)}'
      + '#s-wf .txf-empty{text-align:center;color:var(--ink-3);padding:56px 12px;font-size:13.5px}'
      + '#s-wf .txf-foot{display:flex;align-items:center;justify-content:flex-end;gap:26px;padding:16px 18px 8px;font-size:13px;color:var(--ink-2)}'
      + '#s-wf .txf-foot .txf-rpp b{color:var(--ink);font-weight:700}'
      + '#s-wf .txf-foot .txf-pg{display:flex;align-items:center;gap:16px;color:var(--ink-4)}'
      + '#s-wf .txf-dl{display:flex;flex-direction:column;gap:2px}'
      + '.tx-drawer .txf-dr{display:flex;gap:12px;padding:12px 2px;border-bottom:1px solid var(--line-2)}'
      + '.tx-drawer .txf-dk{flex:0 0 96px;color:var(--ink-3);font-size:13px;font-weight:600}'
      + '.tx-drawer .txf-dv{flex:1;color:var(--ink);font-size:13.5px;line-height:1.5}';
    var st = document.createElement('style');
    st.id = 'txf-wf-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---------------- boot -------------------------------------------------- */
  function init() {
    var root = document.getElementById('s-wf');
    if (!root) return;
    injectStyle();
    renderAll(root);
    if (!root.dataset.txfWfBound) {
      root.dataset.txfWfBound = '1';
      root.addEventListener('click', onClick); // bubble; stops before document
    }
  }

  if (F.ready) F.ready(init);
  else if (document.readyState !== 'loading') setTimeout(init, 80);
  else document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 80); });
  if (F.onSection) F.onSection('s-wf', function () { init(); });
})();
