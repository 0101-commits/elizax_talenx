/* tx_fix_att.js — 근무관리(Attendance) fidelity 고도화 (2026-07-15).
   Runtime patch: rewrites the 근무관리 menu of the talenx mockup to match the
   real talenx *_full reference screens. Loaded LAST (after tx_fix_common.js).
   - IIFE, idempotent, patches the CURRENT DOM (does not touch index.html).
   - All added CSS is scoped to #s-att / .txf-*. No network. ES5 only. */
(function () {
  'use strict';
  if (window.__txFixAtt) return;            // module-level idempotency guard
  window.__txFixAtt = true;

  var F  = window.TXFIX || {};
  var TX = window.TX || {};
  var pad2 = F.pad2 || function (n) { return (n < 10 ? '0' : '') + n; };

  function TOAST(m, k) { if (TX.toast) TX.toast(m, k); }
  function MENU(anchor, items) { if (TX.menu) TX.menu(anchor, items); }
  function MODAL(o) { return TX.modal ? TX.modal(o) : null; }

  var TODAY = new Date(2026, 6, 14);        // app "today" = 2026-07-14
  function q(r, s) { return r ? r.querySelector(s) : null; }
  function qa(r, s) { return r ? Array.prototype.slice.call(r.querySelectorAll(s)) : []; }
  function stop(e) { if (e) e.stopPropagation(); }
  function once(el) { if (!el || el.__txf) return false; el.__txf = 1; return true; }
  function fmt(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

  /* ---- shared SVGs (copied from index.html markup for pixel parity) ---- */
  var SVG_PEN  = '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.2" stroke="currentColor" stroke-width="1.6"/><path d="M8.6 15.4l.5-2 4-4 1.5 1.5-4 4-2 .5z" fill="currentColor"/></svg>';
  var SVG_EXCL = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor"/><rect x="11" y="6" width="2" height="7" rx="1" fill="#fff"/><circle cx="12" cy="16.5" r="1.3" fill="#fff"/></svg>';
  var SVG_ARR  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  var SVG_CLK  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h5"/></svg>';

  /* ================= injected styles ================= */
  function injectStyle() {
    if (document.getElementById('txf-att-style')) return;
    var css =
      '#s-att .txf-checkin{width:100%;background:var(--blue);color:#fff;border:0;border-radius:9px;padding:14px;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:10px}' +
      '#s-att .txf-checkin:hover{filter:brightness(1.04)}' +
      '#s-att .toggle.txf-on .sw{background:var(--blue)}' +
      '#s-att .toggle.txf-on .sw::after{left:17px}' +
      '#s-att .toggle{cursor:pointer}' +
      '#s-att .selbox,#s-att .dtbox,#s-att .refresh,#s-att .dlbtn,#s-att .morebtn,#s-att .docrow,#s-att .bluebtn,#s-att .mh .nb,#s-att .mh .today,#s-att .statnav .nb{cursor:pointer}' +
      '#s-att .txf-more{display:none}' +
      '#s-att .txf-emptybox{border:1px solid var(--line);border-radius:10px;padding:40px 20px;text-align:center;color:var(--ink-3);font-size:13px;margin-top:8px}' +
      '#s-att .txf-emptybox .ic{width:22px;height:22px;border-radius:50%;border:1.5px solid var(--ink-4);color:var(--ink-4);display:grid;place-items:center;margin:0 auto 10px;font-size:12px;font-style:italic}' +
      '#s-att .txf-sigrow{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--ink-2);padding:10px 2px;border-bottom:1px solid var(--line)}' +
      '#s-att .txf-sigrow:last-child{border-bottom:0}';
    var st = document.createElement('style');
    st.id = 'txf-att-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ================= 0. 내 근무 ================= */
  function tagFor(d, inMonth) {
    var key = fmt(d);
    if (d.getTime() === TODAY.getTime() && inMonth)
      return '<span class="ctag plan">' + SVG_PEN + '근무전</span><span class="ctime">자율</span>';
    if (key === '2026-06-28') return '<span class="ctag holi">휴일</span>';
    if (d < TODAY) return '<span class="ctag miss">' + SVG_EXCL + '누락</span>';
    return '<span class="ctag undef">' + SVG_EXCL + '미정</span>';
  }
  function cellFor(d, inMonth) {
    var wd = d.getDay(), isToday = (d.getTime() === TODAY.getTime() && inMonth);
    var cls = isToday ? 'dnum today' : ((!inMonth || wd === 0 || wd === 6) ? 'dnum dim' : 'dnum');
    var num = isToday ? String(d.getDate()) : pad2(d.getDate());
    var top = '<div class="cell-top"><span class="' + cls + '">' + num + '</span>';
    if (fmt(d) === '2026-07-17') top += '<span class="holname">제헌절</span>';
    top += '</div>';
    return '<div class="cell">' + top + tagFor(d, inMonth) + '</div>';
  }
  function renderCal(body, y, m) {          // m = 1-based
    var first = new Date(y, m - 1, 1);
    var start = new Date(y, m - 1, 1 - first.getDay());
    var last = new Date(y, m, 0);
    var end = new Date(y, m - 1, last.getDate() + (6 - last.getDay()));
    var html = '', cur = new Date(start);
    while (cur <= end) {
      html += cellFor(cur, cur.getMonth() === (m - 1));
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
    }
    body.innerHTML = html;
  }
  function patchWork(root) {
    var p = q(root, '.subpage[data-p="0"]');
    if (!p || !once(p)) return;

    /* calendar re-render + wire ‹ › 오늘 (fix #2, #3) */
    var body = q(p, '.cal-body'), mo = q(p, '.cal-mo'), head = q(p, '.cal-head');
    var view = { y: 2026, m: 7 };
    function draw() { if (mo) mo.textContent = view.y + '.' + pad2(view.m); if (body) renderCal(body, view.y, view.m); }
    draw();
    if (head) head.addEventListener('click', function (e) {
      var t = e.target;
      if (t.classList.contains('nav')) {
        stop(e);
        if (t.textContent.indexOf('‹') >= 0) { view.m--; if (view.m < 1) { view.m = 12; view.y--; } }
        else { view.m++; if (view.m > 12) { view.m = 1; view.y++; } }
        draw();
      } else if (t.classList.contains('today')) { stop(e); view.y = 2026; view.m = 7; draw(); }
    }, false);

    /* right panel — add blue 출근 button above dark 근무 신청 (fix #1) */
    var wcards = qa(p, '.att-col .wcard');
    var w0 = wcards[0];
    if (w0) {
      var dark = q(w0, '.btn-dark');
      if (dark && !q(w0, '.txf-checkin')) {
        var b = document.createElement('button');
        b.className = 'txf-checkin'; b.textContent = '출근';
        b.addEventListener('click', function (e) {
          stop(e);
          TX.confirm ? TX.confirm('출근', '지금 출근 처리하시겠습니까?', function () { TOAST('출근 처리되었습니다.', 'ok'); }, '출근')
                     : TOAST('출근 처리되었습니다.', 'ok');
        }, false);
        dark.parentNode.insertBefore(b, dark);
      }
      var wt = q(w0, '.wtime'); if (wt) wt.innerHTML = '오후 4:17 ↻';
    }

    /* 근무현황 panel: wire statnav ‹ › 오늘 ⋮ (fix #4) */
    var sn = w0 && wcards[1] ? q(wcards[1], '.statnav') : q(p, '.statnav');
    if (sn && once(sn)) sn.addEventListener('click', function (e) {
      var t = e.target;
      if (t.classList.contains('nb')) {
        stop(e);
        var tx = (t.textContent || '').trim();
        if (tx.indexOf('⋮') >= 0) {            // ⋮
          MENU(t, [
            { label: '기간 상세보기', onClick: function () { TOAST('근무 기간 상세를 표시합니다.'); } },
            { label: '엑셀 다운로드', onClick: function () { TOAST('다운로드를 시작합니다.'); } }
          ]);
        } else { TOAST('기간을 이동했습니다.'); }
      } else if (t.classList.contains('today')) { stop(e); TOAST('이번 달로 이동했습니다.'); }
    }, false);
  }

  /* ================= 1. 내 휴가 ================= */
  function lvrowHTML(name, sub, amt, dot) {
    return '<div class="lvrow' + (dot ? ' txf-more' : '') + '">' +
      '<div><div class="nm">' + name + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>' +
      '<span class="sp"></span>' + (amt ? '<span class="amt">' + amt + '</span>' : '') +
      '<span class="go">' + SVG_ARR + '</span></div>';
  }
  function patchLeave(root) {
    var p = q(root, '.subpage[data-p="1"]');
    if (!p || !once(p)) return;

    /* header: year 2027 -> 2026, consistent totals, drop 요청중 chip (fix #5) */
    var hsum = q(p, '.hsum');
    if (hsum) {
      var yr = q(hsum, '.selbox'); if (yr) yr.innerHTML = '2026 <span class="cv">▾</span>';
      var bs = hsum.querySelectorAll('b'); if (bs[0]) bs[0].textContent = '136시간(17일)';
      var blue = q(hsum, '.blue'); if (blue) blue.textContent = '136시간(17일)';
      var ro = q(hsum, '.req-orange'); if (ro) ro.parentNode.removeChild(ro);
      if (yr) wireSelbox(yr, ['2026', '2025', '2024'], function (v) { yr.innerHTML = v + ' <span class="cv">▾</span>'; TOAST(v + '년 휴가 현황을 조회합니다.'); });
    }

    /* 잔여 휴가: realistic leave types (fix #5) */
    var cards = qa(p, '.card');
    var leaveCard = cards[0];
    if (leaveCard) {
      var more = q(leaveCard, '.morebtn');
      qa(leaveCard, '.lvrow').forEach(function (r) { r.parentNode.removeChild(r); });
      var rows =
        lvrowHTML('연차 휴가', '개별 기한', '136시간(17일)', false) +
        lvrowHTML('여름휴가', '2026.07.21 ~ 2026.07.31', '0분', false) +
        lvrowHTML('경조휴가', '', '', false) +
        lvrowHTML('병가', '', '', false) +
        lvrowHTML('공가', '', '', true) +
        lvrowHTML('보건휴가', '', '', true);
      if (more) more.insertAdjacentHTML('beforebegin', rows);
      if (more && once(more)) more.addEventListener('click', function (e) {
        stop(e);
        var open = leaveCard.classList.toggle('txf-showmore');
        qa(leaveCard, '.txf-more').forEach(function (r) { r.style.display = open ? 'flex' : 'none'; });
        more.innerHTML = open ? '접기 ⌃' : '더보기 ⌄';
      }, false);
    }

    /* 잔여 휴가 controls: 사용기간 이내 toggle + 기본순 sort (fix #5) */
    var tog = leaveCard && q(leaveCard, '.toggle');
    if (tog && once(tog)) tog.addEventListener('click', function (e) {
      stop(e); var on = tog.classList.toggle('txf-on');
      TOAST('사용기간 이내 ' + (on ? '적용' : '해제'));
    }, false);
    var sortSel = leaveCard && qa(leaveCard, '.selbox').pop();
    if (sortSel) wireSelbox(sortSel, ['기본순', '이름순', '잔여 많은순', '만료 임박순'], function (v) {
      sortSel.innerHTML = v + ' <span class="cv">▾</span>'; TOAST(v + '으로 정렬했습니다.');
    });

    /* 예정휴가 / 사용기록 tabs + download (fix #5) */
    var histCard = cards[1];
    if (histCard) {
      var oldRow = q(histCard, '.schedrow'); if (oldRow) oldRow.parentNode.removeChild(oldRow);
      var anchor = q(histCard, '.cardhd');
      var planned = document.createElement('div');
      planned.className = 'txf-lvtab txf-planned';
      planned.innerHTML = '<div class="txf-emptybox"><div class="ic">i</div>예정휴가 일정이 없습니다.</div>';
      var history = document.createElement('div');
      history.className = 'txf-lvtab txf-history'; history.style.display = 'none';
      history.innerHTML = '' +
        schedRow('2026.06.15(월)', '8시간', '여름휴가') +
        schedRow('2026.05.02(금)', '8시간', '연차') +
        schedRow('2026.03.10(화)', '4시간', '경조휴가');
      if (anchor) { anchor.parentNode.insertBefore(planned, anchor.nextSibling); anchor.parentNode.insertBefore(history, planned.nextSibling); }

      var segt = q(histCard, '.segtabs');
      if (segt && once(segt)) segt.addEventListener('click', function (e) {
        var btn = e.target.closest('button'); if (!btn) return;
        stop(e);
        qa(segt, 'button').forEach(function (x) { x.classList.remove('on'); }); btn.classList.add('on');
        var hist = btn.textContent.indexOf('사용기록') >= 0;
        planned.style.display = hist ? 'none' : 'block';
        history.style.display = hist ? 'block' : 'none';
      }, false);

      var dl = q(histCard, '.dlbtn');
      if (dl && once(dl)) dl.addEventListener('click', function (e) { stop(e); TOAST('휴가 내역을 다운로드합니다.'); }, false);
    }

    /* mini calendar: only Sunday red (fix #6) + wire nav (fix #5) */
    var mgrid = q(p, '.mgrid');
    if (mgrid) qa(mgrid, '.dd').forEach(function (dd, i) {
      var col = i % 7;
      if (col === 6) dd.classList.remove('sun');       // Saturday -> normal
      else if (col === 0) dd.classList.add('sun');      // Sunday -> red
    });
    var mh = q(p, '.mh');
    if (mh && once(mh)) mh.addEventListener('click', function (e) {
      var t = e.target;
      if (t.classList.contains('nb')) { stop(e); TOAST('달을 이동했습니다.'); }
      else if (t.classList.contains('today')) { stop(e); TOAST('이번 달로 이동했습니다.'); }
    }, false);
  }
  function schedRow(d, hrs, type) {
    return '<div class="schedrow" style="border-bottom:1px solid var(--line)"><span class="d">' + d + '</span><span>' + hrs +
      '</span><span class="vbar"></span><span style="color:var(--ink-2)">' + type + '</span></div>';
  }

  /* ================= 2. 구성원 근무 ================= */
  function memberRows(filterFn) {
    var emps = (F.D && F.D.employees ? F.D.employees : []).filter(function (e) { return e && e.name; });
    if (filterFn) emps = emps.filter(filterFn);
    emps = emps.slice(0, 11);
    var cols = ''; for (var c = 0; c < 14; c++) cols += '<span class="gcol"></span>';
    var block = '<div class="gblock"><span class="core"></span><span class="rest"></span>' +
      '<div class="bt">' + SVG_CLK + '시차출퇴근 (9-18)</div><div class="bs">09:00 - 18:00</div></div>';
    return emps.map(function (e) {
      var team = (F.teamName ? F.teamName(e) : e.orgName) || '';
      var ava = F.avatar ? F.avatar(e.name, 32) : '<span class="ava"></span>';
      return '<div class="grow"><div class="gmember">' + ava +
        '<div><div class="nm">' + e.name + '</div><div class="org">' + team + '</div></div></div>' +
        '<div class="gtrack">' + cols + block + '</div></div>';
    }).join('');
  }
  function patchMember(root) {
    var p = q(root, '.subpage[data-p="2"]');
    if (!p || !once(p)) return;

    /* role gate (fix #7): 조직원(member)은 타인 근태 목록/전체 승인 권한 없음.
       leader=본인팀, hr=전사는 기존 동작 유지. */
    var ROLE = (F.CU && F.CU._role) || (window.TXRoles && TXRoles.current && TXRoles.current().key) || 'member';
    if (ROLE === 'member') {
      var mBlue = q(p, '.bluebtn'); if (mBlue) mBlue.style.display = 'none';          // 요청 모아보기/전체 승인 숨김
      var mSeg  = q(p, '.segtabs'); if (mSeg) mSeg.style.display = 'none';
      var mCard = q(p, '.card');
      if (mCard) mCard.innerHTML =
        '<div class="txf-emptybox"><div class="ic">i</div>' +
        '구성원 근무 현황은 조직장·HR에게만 제공됩니다.<br>' +
        '나의 근무는 ‘나의 근무’ 탭에서 확인하세요.</div>';
      return;
    }

    var blue = q(p, '.bluebtn');
    if (blue) {
      blue.childNodes[0].nodeValue = '요청 모아보기 1';    // badge 21 -> 1 (fix #7)
      if (once(blue)) blue.addEventListener('click', function (e) {
        stop(e);
        MODAL({
          title: '근무 요청 모아보기', wide: true,
          body: '<div class="txf-sigrow"><b style="color:var(--ink)">' +
                '김소희(유럽팀)</b><span style="flex:1"></span>근무시간 변경 요청 · 07.14</div>' +
                '<div class="txf-sigrow" style="color:var(--ink-3)">승인 대기 1건</div>',
          actions: [{ label: '닫기', kind: 'ghost' }, { label: '전체 승인', kind: 'primary', onClick: function () { TOAST('요청을 승인했습니다.', 'ok'); } }]
        });
      }, false);
    }

    /* leader(조직장)=본인 팀 범위만, hr/exec=전사 (fix: leader over-scope leak) */
    var teamFilter = (ROLE === 'leader' && F.teamName && F.CU) ? function (e) { return F.teamName(e) === F.teamName(F.CU); } : null;
    var teamSize = teamFilter ? (F.D && F.D.employees ? F.D.employees : []).filter(function (e) { return e && e.name; }).filter(teamFilter).length : 472;
    var headCount = teamFilter ? teamSize : 100;
    var pagerTxt = teamFilter ? ('1–' + teamSize + ' of ' + teamSize) : '1–100 of 472';

    var card = q(p, '.card');
    if (card) {
      var ghl = q(card, '.gh-l');
      if (ghl) ghl.innerHTML = '구성원 (' + headCount + ') <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M6 12h12M10 18h4"/></svg>';
      qa(card, '.grow').forEach(function (r) { r.parentNode.removeChild(r); });
      var pager = q(card, '.pager');
      if (pager) {
        pager.insertAdjacentHTML('beforebegin', memberRows(teamFilter));
        var spans = qa(pager, 'span');
        for (var i = 0; i < spans.length; i++) if (/of/.test(spans[i].textContent) && spans[i].className !== 'rpp') { spans[i].textContent = pagerTxt; break; }
      }
      /* wire toolbar (fix #7) */
      var dt = q(card, '.dtbox');
      if (dt && once(dt)) dt.addEventListener('click', function (e) { stop(e); TOAST('날짜를 선택하세요. (2026.07.14)'); }, false);
      var sel = q(card, '.selbox');
      if (sel) wireSelbox(sel, ['요청중 포함', '요청중 제외', '승인만 보기'], function (v) { sel.innerHTML = v + ' <span class="cv">▾</span>'; TOAST(v + '으로 조회합니다.'); });
      var rf = q(card, '.refresh');
      if (rf && once(rf)) rf.addEventListener('click', function (e) { stop(e); TOAST('새로고침했습니다.'); }, false);
    }

    /* 일정 / 현황 segtabs (fix #7 wiring) */
    var seg = q(p, '.segtabs');
    if (seg && once(seg)) {
      var stat = document.createElement('div');
      stat.className = 'txf-memstat'; stat.style.display = 'none';
      stat.innerHTML = '<div class="card" style="padding:18px"><div class="txf-emptybox"><div class="ic">i</div>선택한 날짜의 구성원 근무 현황 집계입니다.<br>실근무 대비 소정근무 달성률 92%</div></div>';
      if (card) card.parentNode.insertBefore(stat, card.nextSibling);
      seg.addEventListener('click', function (e) {
        var btn = e.target.closest('button'); if (!btn) return;
        stop(e);
        qa(seg, 'button').forEach(function (x) { x.classList.remove('on'); }); btn.classList.add('on');
        var isStat = btn.textContent.indexOf('현황') >= 0;
        if (card) card.style.display = isStat ? 'none' : '';
        stat.style.display = isStat ? 'block' : 'none';
      }, false);
    }
  }

  /* ================= 4. 근무스케줄 ================= */
  function patchSchedule(root) {
    var p = q(root, '.subpage[data-p="4"]');
    if (!p || !once(p)) return;
    var card = q(p, '.card');
    var sels = qa(p, '.selbox');
    if (sels[0]) wireSelbox(sels[0], ['2026년 07월', '2026년 08월', '2026년 06월', '2026년 05월'], function (v) { sels[0].innerHTML = v + ' <span class="cv">▾</span>'; TOAST(v + ' 스케줄을 조회합니다.'); });
    if (sels[1]) wireSelbox(sels[1], ['템플릿 모아보기', '표준 근무제', '시차출퇴근제', '선택적근로시간제'], function (v) { sels[1].innerHTML = v + ' <span class="cv">▾</span>'; TOAST(v + '을 적용합니다.'); });

    var scroll = card && q(card, '.schscroll');
    var role = document.createElement('div');
    role.className = 'txf-role'; role.style.display = 'none';
    role.innerHTML = '<div class="txf-emptybox"><div class="ic">i</div>역할(직무) 기준 근무 스케줄입니다.<br>동일 역할 구성원의 표준 근무패턴을 표시합니다.</div>';
    if (scroll) scroll.parentNode.insertBefore(role, scroll.nextSibling);

    var seg = q(p, '.segtabs');
    if (seg) seg.addEventListener('click', function (e) {
      var btn = e.target.closest('button'); if (!btn) return;
      stop(e);
      qa(seg, 'button').forEach(function (x) { x.classList.remove('on'); }); btn.classList.add('on');
      var isRole = btn.textContent.indexOf('역할') >= 0;
      if (scroll) scroll.style.display = isRole ? 'none' : '';
      role.style.display = isRole ? 'block' : 'none';
      var pg = card && q(card, '.pager'); if (pg) pg.style.display = isRole ? 'none' : '';
    }, false);
  }

  /* ================= 5. 위치정보 제공 조회 ================= */
  function patchLocation(root) {
    var p = q(root, '.subpage[data-p="5"]');
    if (!p || !once(p)) return;
    var sels = qa(p, '.selbox');
    if (sels[0]) wireSelbox(sels[0], ['2026년', '2025년', '2024년'], function (v) { sels[0].innerHTML = v + ' <span class="cv">▾</span>'; TOAST(v + ' 위치정보 이력을 조회합니다.'); });
    if (sels[1]) wireSelbox(sels[1], ['01월', '02월', '03월', '04월', '05월', '06월', '07월', '08월', '09월', '10월', '11월', '12월'], function (v) { sels[1].innerHTML = v + ' <span class="cv">▾</span>'; TOAST(v + ' 이력을 조회합니다.'); });
    var rf = q(p, '.refresh');
    if (rf) {
      rf.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 11A8 8 0 106 6l-2 2m0-4v4h4"/></svg>2026.07.14 (화) 오후 4:17';
      if (once(rf)) rf.addEventListener('click', function (e) { stop(e); TOAST('위치정보 이력을 새로고침했습니다.'); }, false);
    }
  }

  /* ================= 6. 연차촉진 ================= */
  function patchAnnual(root) {
    var p = q(root, '.subpage[data-p="6"]');
    if (!p || !once(p)) return;
    var sels = qa(p, '.selbox');
    if (sels[0]) wireSelbox(sels[0], ['2026년', '2025년', '2024년'], function (v) { sels[0].innerHTML = v + ' <span class="cv">▾</span>'; TOAST(v + ' 연차촉진 현황을 조회합니다.'); });
    if (sels[1]) wireSelbox(sels[1], ['서명 테스트', '1차 촉진', '2차 촉진'], function (v) { sels[1].innerHTML = v + ' <span class="cv">▾</span>'; TOAST(v + ' 촉진작업을 선택했습니다.'); });

    qa(p, '.docrow').forEach(function (row) {
      if (!once(row)) return;
      row.addEventListener('click', function (e) {
        stop(e);
        var nm = (q(row, '.nm') || {}).textContent || '연차촉진 문서';
        var done = !!q(row, '.st-done');
        MODAL({
          title: nm,
          body: '<div class="txf-sigrow">대상 기간<span style="flex:1"></span>2026.07.02 ~ 2026.07.12</div>' +
                '<div class="txf-sigrow">상태<span style="flex:1"></span>' + (done ? '확인완료' : '미작성') + '</div>' +
                '<div class="txf-sigrow" style="color:var(--ink-3)">' + (done ? '이미 확인/서명이 완료된 문서입니다.' : '연차촉진 기간에 서명/작성이 가능합니다.') + '</div>',
          actions: done ? [{ label: '닫기', kind: 'ghost' }]
                        : [{ label: '취소', kind: 'ghost' }, { label: '서명/작성', kind: 'primary', onClick: function () { TOAST(nm + ' 작성을 완료했습니다.', 'ok'); } }]
        });
      }, false);
    });
  }

  /* ================= selbox helper ================= */
  function wireSelbox(el, options, onPick) {
    if (!el || !once(el)) return;
    el.addEventListener('click', function (e) {
      stop(e);
      MENU(el, options.map(function (o) { return { label: o, onClick: function () { onPick && onPick(o); } }; }));
    }, false);
  }

  /* ================= driver ================= */
  function patch() {
    var root = document.getElementById('s-att');
    if (!root) return;
    injectStyle();
    try { patchWork(root); } catch (e) { console.error('[txfix att work]', e); }
    try { patchLeave(root); } catch (e) { console.error('[txfix att leave]', e); }
    try { patchMember(root); } catch (e) { console.error('[txfix att member]', e); }
    try { patchSchedule(root); } catch (e) { console.error('[txfix att schedule]', e); }
    try { patchLocation(root); } catch (e) { console.error('[txfix att location]', e); }
    try { patchAnnual(root); } catch (e) { console.error('[txfix att annual]', e); }
  }

  function boot() {
    patch();
    /* re-apply after subnav clicks (subpages persist; guards make this a no-op,
       but this satisfies the "re-apply after subnav" contract for safety) */
    var root = document.getElementById('s-att');
    if (root) {
      var nav = q(root, '.subnav');
      if (nav) nav.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('a')) setTimeout(patch, 80);
      }, false);
    }
  }

  if (F.ready) F.ready(boot);
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 80); });
  else setTimeout(boot, 80);
})();
