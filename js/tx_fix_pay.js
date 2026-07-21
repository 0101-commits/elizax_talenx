/* tx_fix_pay.js — 급여관리(Payroll) fidelity 고도화 (2026-07-15)
   Runtime patch: upgrades the mock 급여관리 menu to match real talenx.
   - 내 급여: payslip LIST TABLE (제목/지급일/발송일자) with monthly rows,
     working year dropdown (2026/2025/2024), row -> 명세서 modal (self-consistent
     지급/공제/실지급액) + 다운로드.
   - 연말정산: primary 연말정산 pill (empty "연말정산 기간이 아닙니다.") + 과거연말정산
     history table.
   - profile header rebuilt for currentUser 최정남 with TXFIX.avatar.
   IIFE, idempotent, patches CURRENT DOM only. No network. No index.html edits. */
(function () {
  'use strict';
  var F = window.TXFIX, TX = window.TX;
  if (!F || !F.ready) return;

  var CU = (F.CU && F.CU.emp_id) ? F.CU : { name: '최정남', emp_id: 'EMP-0078',
    orgName: 'Package BG', level_kr: '사원', join_date: '2016-04-30',
    managerName: '홍예준', jobTitle: '서비스기획담당' };
  var esc = (TX && TX.esc) || function (s) { return String(s == null ? '' : s); };
  var won = F.won || function (n) { return Number(n).toLocaleString('en-US') + '원'; };
  function r10(x) { return Math.round(x / 10) * 10; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------- salary model (fabricated, internally consistent) ---------- */
  function slip(y, m) {
    var mm = pad2(m);
    var base = 3450000, meal = 200000, qual = 150000, transport = 150000;
    var ot = 100000 + ((m * 7) % 6) * 40000;           // deterministic variance
    var earn = [
      { label: '기본급', amt: base },
      { label: '식대(비과세)', amt: meal },
      { label: '자격수당', amt: qual },
      { label: '교통보조금', amt: transport },
      { label: '연장근로수당', amt: ot }
    ];
    var gross = base + meal + qual + transport + ot;
    var taxable = gross - meal;                          // 식대 비과세
    var nps = r10(Math.min(taxable, 6170000) * 0.045);  // 국민연금
    var health = r10(taxable * 0.03545);                // 건강보험
    var care = r10(health * 0.1295);                    // 장기요양
    var empi = r10(taxable * 0.009);                    // 고용보험
    var inc = r10(taxable * 0.045);                     // 소득세(간이)
    var loc = r10(inc * 0.1);                           // 지방소득세
    var ded = [
      { label: '국민연금', amt: nps },
      { label: '건강보험', amt: health },
      { label: '장기요양보험', amt: care },
      { label: '고용보험', amt: empi },
      { label: '소득세', amt: inc },
      { label: '지방소득세', amt: loc }
    ];
    var totalDed = nps + health + care + empi + inc + loc;
    return {
      y: y, m: m, key: 'pay' + y + mm, title: '월급여_' + y + mm,
      ym: y + '년 ' + m + '월', payDate: y + '.' + mm + '.25',
      sentDate: y + '.' + mm + '.25 오전 9:00',
      earn: earn, ded: ded, gross: gross, totalDed: totalDed, net: gross - totalDed
    };
  }
  var SLIPS = (function () {         // 18 months back from 2026-07
    var arr = [], anchor = 2026 * 12 + (7 - 1);
    for (var i = 0; i < 18; i++) {
      var idx = anchor - i, yy = Math.floor(idx / 12), mm = (idx % 12) + 1;
      arr.push(slip(yy, mm));
    }
    return arr;
  })();
  var YEARS = [2026, 2025, 2024];

  /* ---------- styles ---------- */
  function injectStyle() {
    if (document.getElementById('txf-pay-style')) return;
    var st = document.createElement('style');
    st.id = 'txf-pay-style';
    st.textContent =
      '#s-pay .txf-yearsel{width:200px;border:0;border-bottom:1px solid var(--line);' +
      'display:flex;align-items:center;justify-content:space-between;padding:8px 4px;' +
      'color:var(--ink);font-weight:600;margin-bottom:22px;cursor:pointer;user-select:none}' +
      '#s-pay .txf-yearsel:hover{border-bottom-color:var(--blue)}' +
      '#s-pay .txf-tbl{width:100%}' +
      '#s-pay .txf-tr{display:grid;grid-template-columns:1fr 150px 210px;align-items:center;' +
      'padding:16px 8px;border-bottom:1px solid var(--line);font-size:14px}' +
      '#s-pay .txf-th{color:var(--ink-3);font-size:13px;font-weight:600;padding:10px 8px}' +
      '#s-pay .txf-th span:nth-child(2),#s-pay .txf-th span:nth-child(3),' +
      '#s-pay .txf-row span:nth-child(2),#s-pay .txf-row span:nth-child(3){color:var(--ink-2)}' +
      '#s-pay .txf-row{cursor:pointer;transition:background .12s}' +
      '#s-pay .txf-row:hover{background:var(--soft)}' +
      '#s-pay .txf-row .txf-title{font-weight:700;color:var(--ink)}' +
      '#s-pay .txf-row:hover .txf-title{color:var(--blue)}' +
      '#s-pay .txf-empty{border:1px solid var(--line);border-radius:12px;padding:56px 20px;' +
      'text-align:center;margin-top:6px}' +
      '#s-pay .txf-empty .txf-i{width:22px;height:22px;border-radius:50%;border:1.5px solid var(--ink-4);' +
      'color:var(--ink-4);font-size:13px;font-weight:700;display:inline-grid;place-items:center;margin-bottom:10px}' +
      '#s-pay .txf-empty .txf-t{color:var(--ink-3);font-size:14px}' +
      /* 연말정산 pills */
      '#s-pay .txf-pills{display:flex;gap:8px}' +
      '#s-pay .txf-pill{border:1px solid var(--line);background:var(--card);color:var(--ink-2);' +
      'border-radius:999px;padding:8px 18px;font-size:14px;font-weight:700;cursor:pointer}' +
      '#s-pay .txf-pill.on{background:#2A2E36;border-color:#2A2E36;color:#fff}' +
      '#s-pay .txf-yebox{min-height:120px;display:grid;place-items:center;padding:36px 28px;color:var(--ink-3);font-size:14px}' +
      /* 과거연말정산 table */
      '#s-pay .txf-htbl{width:100%;font-size:14px}' +
      '#s-pay .txf-htr{display:grid;grid-template-columns:120px 1fr 180px 100px;align-items:center;' +
      'padding:14px 8px;border-bottom:1px solid var(--line)}' +
      '#s-pay .txf-htr.txf-hh{color:var(--ink-3);font-size:13px;font-weight:600}' +
      '#s-pay .txf-refund{color:var(--blue);font-weight:700}#s-pay .txf-due{color:var(--orange);font-weight:700}' +
      '#s-pay .txf-done{color:var(--ink-3)}' +
      /* payslip modal */
      '#s-pay .txf-slip,.txf-slip{font-size:14px}' +
      '.txf-slip .txf-meta{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;padding:2px 2px 16px;' +
      'border-bottom:1px solid var(--line);margin-bottom:16px}' +
      '.txf-slip .txf-meta .k{color:var(--ink-3)}.txf-slip .txf-meta b{color:var(--ink)}' +
      '.txf-slip .txf-cols{display:grid;grid-template-columns:1fr 1fr;gap:20px}' +
      '.txf-slip .txf-col-h{font-weight:800;color:var(--ink);margin-bottom:6px;font-size:14px}' +
      '.txf-slip .txf-li{display:flex;justify-content:space-between;padding:9px 2px;border-bottom:1px solid var(--line)}' +
      '.txf-slip .txf-li span:first-child{color:var(--ink-2)}.txf-slip .txf-li span:last-child{color:var(--ink);font-weight:600}' +
      '.txf-slip .txf-li-t span{font-weight:800!important;color:var(--ink)!important}' +
      '.txf-slip .txf-net{display:flex;justify-content:space-between;align-items:center;margin-top:18px;' +
      'padding:16px 18px;border-radius:12px;background:var(--soft)}' +
      '.txf-slip .txf-net span{font-weight:700;color:var(--ink)}.txf-slip .txf-net b{font-size:20px;color:var(--blue)}';
    document.head.appendChild(st);
  }

  /* ---------- profile header (both subpages) ---------- */
  function fmtDate(d) { return d ? String(d).replace(/-/g, '.') : '-'; }
  function profileHTML() {
    return '<div style="display:flex;align-items:center;gap:22px">' +
      F.avatar(CU.name, 74) +
      '<div style="flex:1;min-width:0">' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          '<span style="font-size:24px;font-weight:800;letter-spacing:-.02em;color:var(--ink)">' + esc(CU.name) + '</span>' +
          '<span class="badge b-org" style="font-size:12px;padding:3px 9px;font-weight:600;color:var(--ink-2)">' + esc((CU.emp_id || '').replace(/^EMP-?/, '') || '0078') + '</span>' +
          '<span class="badge b-org" style="font-size:12px;padding:3px 9px;font-weight:600;color:var(--ink-2)">재직</span>' +
        '</div>' +
        '<div style="margin-top:9px;display:flex;align-items:center;flex-wrap:wrap;gap:6px 34px">' +
          '<span style="font-size:15px;font-weight:700;color:var(--ink)">' + esc((function(){var p=[],o=F.org(CU.org_id||'ORG-010'),g=0;while(o&&g++<8){p.unshift(o.name);o=o.parent_id?F.org(o.parent_id):null;}return 'HCG > '+p.join(' > ');})()) + '</span>' +
          '<span style="font-size:14px"><span style="color:var(--ink-3)">직급/직책</span> &nbsp;<b style="color:var(--ink)">' + esc(CU.level_kr || '사원') + '</b></span>' +
          '<span style="font-size:14px"><span style="color:var(--ink-3)">입사일</span> &nbsp;<b style="color:var(--ink)">' + fmtDate(CU.join_date) + '</b></span>' +
          '<span style="font-size:14px"><span style="color:var(--ink-3)">관리자</span> &nbsp;<b style="color:var(--ink)">' + esc(CU.managerName || '-') + '</b></span>' +
        '</div>' +
      '</div>' +
    '</div>';
  }
  function patchProfiles(sec) {
    sec.querySelectorAll('.sp-page').forEach(function (pg) {
      var card = pg.querySelector('.card');
      if (!card || card.getAttribute('data-txf') === 'profile') return;
      card.innerHTML = profileHTML();
      card.setAttribute('data-txf', 'profile');
    });
  }

  /* ---------- 내 급여 ---------- */
  function patchMyPay(sec) {
    var page = sec.querySelector('.sp-page[data-p="0"]');
    if (!page) return;
    var bar = page.querySelector('.selectbar');
    var slipCard = bar && bar.closest('.card');
    if (!slipCard || slipCard.getAttribute('data-txf') === 'mypay') return;

    var state = { year: 2026 };
    slipCard.setAttribute('data-txf', 'mypay');
    slipCard.innerHTML =
      '<div class="txf-yearsel" role="button" tabindex="0">' +
        '<span class="txf-yearlab">' + state.year + '년</span><span style="color:var(--ink-3)">⌄</span>' +
      '</div><div class="txf-tblwrap"></div>';

    var sel = slipCard.querySelector('.txf-yearsel');
    var lab = slipCard.querySelector('.txf-yearlab');
    var wrap = slipCard.querySelector('.txf-tblwrap');

    function renderTable() {
      var rows = SLIPS.filter(function (s) { return s.y === state.year; });
      if (!rows.length) {
        wrap.innerHTML = '<div class="txf-empty"><div class="txf-i">i</div>' +
          '<div class="txf-t">급여 명세서가 없습니다.</div></div>';
        return;
      }
      var html = '<div class="txf-tbl"><div class="txf-tr txf-th"><span>제목</span>' +
        '<span>지급일</span><span>발송일자</span></div>';
      rows.forEach(function (s) {
        html += '<div class="txf-tr txf-row" data-key="' + s.key + '">' +
          '<span class="txf-title">' + s.title + '</span>' +
          '<span>' + s.payDate + '</span><span>' + s.sentDate + '</span></div>';
      });
      wrap.innerHTML = html + '</div>';
      wrap.querySelectorAll('.txf-row').forEach(function (r) {
        r.addEventListener('click', function () {
          var s = SLIPS.filter(function (x) { return x.key === r.getAttribute('data-key'); })[0];
          if (s) openSlip(s);
        });
      });
    }
    function openMenu() {
      if (!TX || !TX.menu) return;
      TX.menu(sel, YEARS.map(function (y) {
        return { label: y + '년', onClick: function () { state.year = y; lab.textContent = y + '년'; renderTable(); } };
      }));
    }
    sel.addEventListener('click', openMenu);
    sel.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMenu(); } });
    renderTable();
  }

  function openSlip(s) {
    if (!TX || !TX.modal) return;
    function rows(items) {
      return items.map(function (it) {
        return '<div class="txf-li"><span>' + it.label + '</span><span>' + won(it.amt) + '</span></div>';
      }).join('');
    }
    var body = '<div class="txf-slip">' +
      '<div class="txf-meta">' +
        '<div><span class="k">귀속월</span> &nbsp;<b>' + s.ym + '</b></div>' +
        '<div><span class="k">지급일</span> &nbsp;<b>' + s.payDate + '</b></div>' +
        '<div><span class="k">성명</span> &nbsp;<b>' + esc(CU.name) + '</b></div>' +
        '<div><span class="k">부서</span> &nbsp;<b>' + esc(CU.orgName || 'Package BG') + '</b></div>' +
      '</div>' +
      '<div class="txf-cols">' +
        '<div class="txf-col"><div class="txf-col-h">지급 내역</div>' + rows(s.earn) +
          '<div class="txf-li txf-li-t"><span>지급 합계</span><span>' + won(s.gross) + '</span></div></div>' +
        '<div class="txf-col"><div class="txf-col-h">공제 내역</div>' + rows(s.ded) +
          '<div class="txf-li txf-li-t"><span>공제 합계</span><span>' + won(s.totalDed) + '</span></div></div>' +
      '</div>' +
      '<div class="txf-net"><span>실지급액</span><b>' + won(s.net) + '</b></div>' +
    '</div>';
    TX.modal({
      wide: true, title: s.title, body: body,
      actions: [
        { label: '다운로드', kind: 'ghost', onClick: function () { downloadSlip(s); return false; } },
        { label: '닫기', kind: 'primary' }
      ]
    });
  }

  function downloadSlip(s) {
    try {
      var L = ['[' + s.title + ']  ' + s.ym, '성명: ' + CU.name + '   부서: ' + (CU.orgName || 'Package BG'),
        '지급일: ' + s.payDate, '', '== 지급 내역 =='];
      s.earn.forEach(function (i) { L.push(i.label + '\t' + won(i.amt)); });
      L.push('지급 합계\t' + won(s.gross), '', '== 공제 내역 ==');
      s.ded.forEach(function (i) { L.push(i.label + '\t' + won(i.amt)); });
      L.push('공제 합계\t' + won(s.totalDed), '', '실지급액\t' + won(s.net));
      var blob = new Blob([L.join('\n')], { type: 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = s.title + '.txt';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      if (TX && TX.toast) TX.toast('명세서를 다운로드했습니다.', 'ok');
    } catch (e) { if (TX && TX.toast) TX.toast('다운로드에 실패했습니다.', 'err'); }
  }

  /* ---------- 연말정산 ---------- */
  var HIST = [
    { yr: '2024년', kind: '연말정산', amt: -412300, refund: true },
    { yr: '2023년', kind: '연말정산', amt: 128600, refund: false },
    { yr: '2022년', kind: '연말정산', amt: -256000, refund: true }
  ];
  function patchSettlement(sec) {
    var page = sec.querySelector('.sp-page[data-p="1"]');
    if (!page) return;
    var preset = page.querySelector('.preset');
    var pillWrap = preset && preset.parentNode;
    if (!pillWrap || pillWrap.getAttribute('data-txf') === 'ye') return;

    pillWrap.setAttribute('data-txf', 'ye');
    pillWrap.innerHTML = '<div class="txf-pills">' +
      '<button class="txf-pill on" data-v="now">연말정산</button>' +
      '<button class="txf-pill" data-v="hist">과거연말정산</button></div>';

    // content card (the empty card that followed the pill)
    var card = pillWrap.nextElementSibling;
    while (card && !card.classList.contains('card')) card = card.nextElementSibling;
    if (!card) return;
    card.style.padding = '0';
    card.innerHTML = '<div class="txf-yebody"></div>';
    var box = card.querySelector('.txf-yebody');

    function renderView(v) {
      if (v === 'hist') {
        var html = '<div style="padding:8px 28px 22px"><div class="txf-htbl">' +
          '<div class="txf-htr txf-hh"><span>귀속연도</span><span>정산구분</span>' +
          '<span style="text-align:right">결정세액</span><span style="text-align:right">상태</span></div>';
        HIST.forEach(function (h) {
          var cls = h.refund ? 'txf-refund' : 'txf-due';
          var txt = won(Math.abs(h.amt)) + (h.refund ? ' (환급)' : ' (추가납부)');
          html += '<div class="txf-htr"><span style="font-weight:700;color:var(--ink)">' + h.yr + '</span>' +
            '<span style="color:var(--ink-2)">' + h.kind + '</span>' +
            '<span class="' + cls + '" style="text-align:right">' + txt + '</span>' +
            '<span class="txf-done" style="text-align:right">완료</span></div>';
        });
        box.innerHTML = html + '</div>';
      } else {
        box.innerHTML = '<div class="txf-yebox">연말정산 기간이 아닙니다.</div>';
      }
    }
    pillWrap.querySelectorAll('.txf-pill').forEach(function (b) {
      b.addEventListener('click', function () {
        pillWrap.querySelectorAll('.txf-pill').forEach(function (x) { x.classList.toggle('on', x === b); });
        renderView(b.getAttribute('data-v'));
      });
    });
    renderView('now');   // default = 연말정산
  }

  /* ---------- boot ---------- */
  function apply() {
    var sec = document.getElementById('s-pay');
    if (!sec) return;
    injectStyle();
    patchProfiles(sec);
    patchMyPay(sec);
    patchSettlement(sec);
  }
  F.ready(function () {
    apply();
    var sec = document.getElementById('s-pay');
    if (sec) sec.querySelectorAll('.subnav a[data-p]').forEach(function (a) {
      a.addEventListener('click', function () { setTimeout(apply, 30); });
    });
    if (F.onSection) F.onSection('s-pay', apply);
  });
})();
