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

  /* ---------- 급여 원장 (TALENX_DATA.payroll) ----------
     scripts/enrich_hr_ops.py 가 만든 합성 원천. EZTools.get_payslip 과 같은 데이터를
     읽으므로 화면 금액과 elizax 답변이 어긋나지 않는다. 임의 조작·재계산 금지 —
     지급/공제 항목은 원장 값을 그대로 표시하고 합계만 검산한다. */
  function DATA() { return (F && F.D) || window.TALENX_DATA || {}; }
  function AS_OF() {
    try { if (window.EZKit && EZKit.clock) return EZKit.clock.asOfDate(); } catch (e) { /* ignore */ }
    return '2026-07-16';
  }
  var DED_LABEL = [
    ['pension', '국민연금'], ['health', '건강보험'], ['other', '장기요양보험'],
    ['employment', '고용보험'], ['income_tax', '소득세'], ['local_tax', '지방소득세']
  ];
  function toSlip(p) {
    var y = +String(p.period).slice(0, 4), m = +String(p.period).slice(5, 7), mm = pad2(m);
    var earn = [{ label: '기본급', amt: p.base }];
    if (p.position_allowance) earn.push({ label: '직책수당', amt: p.position_allowance });
    earn.push({ label: '식대(비과세)', amt: p.meal_allowance });
    if (p.overtime_pay) earn.push({ label: '연장근로수당 (' + p.overtime_hours + '시간)', amt: p.overtime_pay });
    if (p.bonus) earn.push({ label: '성과급', amt: p.bonus });
    var ded = DED_LABEL.filter(function (d) { return p.deductions && p.deductions[d[0]]; })
      .map(function (d) { return { label: d[1], amt: p.deductions[d[0]] }; });
    return {
      y: y, m: m, key: p.pay_id, title: '월급여_' + y + mm,
      ym: y + '년 ' + m + '월',
      payDate: String(p.pay_date).replace(/-/g, '.'),
      sentDate: String(p.pay_date).replace(/-/g, '.') + ' 오전 9:00',
      earn: earn, ded: ded, gross: p.gross, totalDed: p.deduction_total, net: p.net,
      rec: p
    };
  }
  var SLIPS = (DATA().payroll || [])
    .filter(function (p) { return p.emp_id === CU.emp_id; })
    .sort(function (a, b) { return String(b.period).localeCompare(String(a.period)); })
    .map(toSlip);
  var YEARS = (function () {
    var seen = {}, out = [];
    SLIPS.forEach(function (s) { if (!seen[s.y]) { seen[s.y] = 1; out.push(s.y); } });
    return out.length ? out : [2026];
  })();

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
      '#s-pay .txf-payhd{display:flex;align-items:center;gap:12px;margin-bottom:22px}' +
      '#s-pay .txf-payhd .txf-yearsel{margin-bottom:0}' +
      /* ---- ✦ elizax 앵커 + 결과 착지 패널 (화면 안에서 끝난다) ---- */
      '#s-pay .txf-ezanchor{margin-left:auto;display:inline-flex;align-items:center;gap:6px;' +
      'border:1px solid rgba(31,122,240,.28);color:var(--blue);background:var(--card);font-size:12.5px;' +
      'font-weight:700;padding:7px 14px;border-radius:999px;cursor:pointer}' +
      '#s-pay .txf-ezanchor:hover{background:rgba(31,122,240,.06)}' +
      '#s-pay .txf-ezanchor[disabled]{opacity:.6;cursor:default}' +
      '#s-pay .txf-ezpanel{border:1px solid rgba(31,122,240,.28);border-radius:12px;padding:16px 18px;' +
      'margin-bottom:18px;font-size:13px;color:var(--ink-2);line-height:1.65}' +
      '#s-pay .txf-ezpanel .ezh{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:800;color:var(--ink);margin-bottom:8px}' +
      '#s-pay .txf-ezpanel .ezh .sp{color:var(--blue)}' +
      '#s-pay .txf-ezpanel .ezh .x{margin-left:auto;cursor:pointer;color:var(--ink-4);font-weight:600}' +
      '#s-pay .txf-ezpanel .chip{display:inline-block;font-size:10.5px;font-weight:700;border-radius:999px;' +
      'padding:2px 9px;margin:0 5px 6px 0;background:rgba(31,122,240,.08);color:#356CB5;border:1px solid rgba(31,122,240,.22)}' +
      '#s-pay .txf-ezpanel .chip.off{background:#F2F4F7;color:#5C6474;border-color:#DDE2EA}' +
      '#s-pay .txf-ezpanel .chip.src{background:rgba(194,65,12,.08);color:#C2410C;border-color:rgba(194,65,12,.22)}' +
      '#s-pay .txf-ezpanel ul{margin:6px 0 0;padding-left:17px}' +
      '#s-pay .txf-ezpanel li{margin-bottom:5px}' +
      '#s-pay .txf-ezpanel li b{color:var(--ink)}' +
      '#s-pay .txf-ezpanel .up{color:var(--blue);font-weight:700}#s-pay .txf-ezpanel .dn{color:var(--orange);font-weight:700}' +
      '#s-pay .txf-ezpanel .foot{margin-top:9px;padding-top:8px;border-top:1px solid var(--line);font-size:11.5px;color:var(--ink-3)}' +
      '#s-pay .txf-tbl{width:100%}' +
      '#s-pay .txf-tr{display:grid;grid-template-columns:1fr 130px 160px 160px;align-items:center;' +
      'padding:16px 8px;border-bottom:1px solid var(--line);font-size:14px}' +
      '#s-pay .txf-tr .txf-net-c{font-weight:700;color:var(--ink)}' +
      '#s-pay .txf-tr span:nth-child(3),#s-pay .txf-tr span:nth-child(4){text-align:right}' +
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
          '<span style="font-size:15px;font-weight:700;color:var(--ink)">' + esc((function(){var p=[],o=F.org(CU.org_id||'ORG-010'),g=0;while(o&&g++<8){p.unshift(o.name);o=o.parent_id?F.org(o.parent_id):null;}if(p[0]==='CEO')p.shift();return ['HCG'].concat(p).join(' > ');})()) + '</span>' +
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

    var state = { year: YEARS[0] };
    slipCard.setAttribute('data-txf', 'mypay');
    slipCard.innerHTML =
      '<div class="txf-payhd">' +
        '<div class="txf-yearsel" role="button" tabindex="0">' +
          '<span class="txf-yearlab">' + state.year + '년</span><span style="color:var(--ink-3)">⌄</span>' +
        '</div>' +
        '<button type="button" class="txf-ezanchor" data-txf="pay-explain">✦ 명세 설명</button>' +
      '</div>' +
      '<div class="txf-ezslot"></div><div class="txf-tblwrap"></div>';

    var sel = slipCard.querySelector('.txf-yearsel');
    var lab = slipCard.querySelector('.txf-yearlab');
    var wrap = slipCard.querySelector('.txf-tblwrap');
    var slot = slipCard.querySelector('.txf-ezslot');
    var anch = slipCard.querySelector('[data-txf="pay-explain"]');
    if (anch) anch.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      explainPay(slot, anch, null);
    });

    function renderTable() {
      var rows = SLIPS.filter(function (s) { return s.y === state.year; });
      if (!rows.length) {
        wrap.innerHTML = '<div class="txf-empty"><div class="txf-i">i</div>' +
          '<div class="txf-t">' + state.year + '년 급여 명세서가 없습니다.</div>' +
          '<div class="txf-t" style="font-size:12.5px;margin-top:6px">보유 기간: ' +
          (SLIPS.length ? SLIPS.map(function (s) { return s.rec.period; }).reverse().join(' · ') : '없음') +
          ' (데모 합성 데이터)</div></div>';
        return;
      }
      var html = '<div class="txf-tbl"><div class="txf-tr txf-th"><span>제목</span>' +
        '<span>지급일</span><span>지급 합계</span><span>실지급액</span></div>';
      rows.forEach(function (s) {
        html += '<div class="txf-tr txf-row" data-key="' + esc(s.key) + '">' +
          '<span class="txf-title">' + s.title + '</span>' +
          '<span>' + s.payDate + '</span>' +
          '<span>' + won(s.gross) + '</span>' +
          '<span class="txf-net-c">' + won(s.net) + '</span></div>';
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

  /* 명세 모달 안 "전월 대비" 블록 — EZTools.get_payslip 의 changes 를 그대로 인용 */
  function deltaBlockHTML(s) {
    var T = window.EZTools;
    if (!(T && T.run) || !s.rec) return '';
    var r = T.run('get_payslip', { period: s.rec.period });
    if (!r || r.error || r.blocked || !r.previous) return '';
    var items = (r.changes || []).map(function (ch) {
      return '<li style="margin-bottom:5px"><b>' + hesc(ch.item) + '</b> ' + won(ch.prev) + ' → ' + won(ch.current) +
        ' (' + signed(ch.delta) + ')<br><span style="font-size:12px;color:var(--ink-3)">' + hesc(ch.reason) + '</span></li>';
    }).join('');
    if (!items) return '';
    return '<div style="margin-top:16px;padding:14px 16px;border:1px solid var(--line);border-radius:12px">' +
      '<div style="font-weight:800;color:var(--ink);margin-bottom:6px">전월(' + hesc(r.previous.period) + ') 대비 ' + signed(r.net_delta) + '</div>' +
      '<ul style="margin:0;padding-left:17px;font-size:13px;color:var(--ink-2)">' + items + '</ul></div>';
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
      deltaBlockHTML(s) +
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

  /* ==========================================================================
     ✦ 명세 설명 — 전월 대비 변동을 급여 계산 규칙(payrollPolicy) 근거와 함께 설명.
     결과는 채팅이 아니라 이 화면 안(.txf-ezslot)에 착지한다.
     실AI(EZAI.ready())면 실호출, 아니면 규칙 기반 설명 + "AI 미연결" 라벨(폴백 은폐 금지).
     열람 규칙은 EZTools.get_payslip 이 적용 — 급여 상세는 본인·HR만.
     ========================================================================== */
  function hesc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function aiLive() {
    try { return !!(window.EZAI && EZAI.direct && EZAI.ready && EZAI.ready()); } catch (e) { return false; }
  }
  function ledger(source, title, summary) {
    try {
      document.dispatchEvent(new CustomEvent('ez:ctx', { detail: {
        type: 'audit', source: source, title: title, summary: summary, weight: 1
      } }));
    } catch (e) { /* 원장 미탑재 */ }
  }
  function signed(n) {
    var v = Number(n || 0);
    return '<span class="' + (v >= 0 ? 'up' : 'dn') + '">' + (v >= 0 ? '+' : '−') + won(Math.abs(v)) + '</span>';
  }
  function panelHTML(title, chips, body, foot) {
    return '<div class="ezh"><span class="sp">✦</span>' + hesc(title) +
      '<span class="x" data-txf="ezclose">✕</span></div>' + (chips || '') + body +
      (foot ? '<div class="foot">' + foot + '</div>' : '');
  }
  function payRuleBody(r) {
    var c = r.current, p = r.previous;
    var head = '<div><b style="color:var(--ink)">' + hesc(c.period) + '</b> 지급 합계 ' + won(c.gross) +
      ' · 공제 ' + won(c.deduction_total) + ' · <b style="color:var(--ink)">실지급 ' + won(c.net) + '</b>' +
      (p ? ' (전월 대비 ' + signed(r.net_delta) + ')' : ' · 전월 명세 없음 — 비교 생략') + '</div>';
    var items = (r.changes || []).map(function (ch) {
      return '<li><b>' + hesc(ch.item) + '</b> ' + won(ch.prev) + ' → ' + won(ch.current) +
        ' (' + signed(ch.delta) + ')<br><span style="font-size:12px">' + hesc(ch.reason) + '</span></li>';
    }).join('');
    return head + (items ? '<ul>' + items + '</ul>'
      : '<div style="margin-top:6px">전월 대비 변동 항목이 없습니다.</div>');
  }
  function explainPay(slot, btn, period) {
    if (!slot) return;
    var T = window.EZTools;
    var el = slot.querySelector('.txf-ezpanel');
    if (!el) {
      el = document.createElement('div');
      el.className = 'txf-ezpanel';
      slot.appendChild(el);
      el.addEventListener('click', function (e) {
        if (e.target && e.target.getAttribute('data-txf') === 'ezclose') { e.stopPropagation(); el.parentNode.removeChild(el); }
      });
    }
    var r = (T && T.run) ? T.run('get_payslip', period ? { period: period } : {}) : null;
    if (!r || r.error || r.blocked) {
      el.innerHTML = panelHTML('명세 설명', '<span class="chip off">' + (r && r.blocked ? '열람 규칙으로 차단' : '데이터 없음') + '</span>',
        '<div>' + hesc((r && (r.policy || r.error)) || '급여 원장을 찾지 못했습니다. 지어내지 않고 여기서 멈춥니다.') + '</div>', '');
      return;
    }
    var body = payRuleBody(r);
    var pol = r.policy || {};
    var foot = '기준 ' + AS_OF() + ' · 규칙: 지급일 매월 ' + pol.pay_day + '일 · 연장 ' + pol.overtime_rate +
      '배 · 성과급 ' + (pol.bonus_months || []).join('·') + '월 · ' + hesc(pol.tax_table_ref || '') +
      ' · 금액은 데모 합성 데이터';
    var live = aiLive();
    el.innerHTML = panelHTML('명세 설명',
      (live ? '<span class="chip">✦ elizax 작성 중…</span>' : '<span class="chip off">AI 미연결 — 규칙 기반 설명</span>') +
      '<span class="chip src">급여 원장</span><span class="chip src">급여 계산 규칙</span>',
      body, foot);
    ledger('pay.explain', '급여 명세 설명 · ' + r.current.period,
      '실지급 ' + won(r.current.net) + (r.net_delta ? ' (전월 대비 ' + (r.net_delta > 0 ? '+' : '') + won(r.net_delta) + ')' : '') +
      ' · 변동 ' + ((r.changes || []).length) + '항목');
    if (!live) return;
    if (btn) btn.disabled = true;
    function fail(msg) {
      if (btn) btn.disabled = false;
      el.innerHTML = panelHTML('명세 설명',
        '<span class="chip off">AI 생성 실패 — 규칙 기반 설명으로 대체</span><span class="chip src">급여 원장</span>',
        body, foot + ' · 실패 사유: ' + hesc(msg || '응답 없음'));
    }
    try {
      window.EZAI.direct({
        system: '당신은 elizax — 급여 명세 설명자입니다. 아래 JSON은 사용자 본인의 급여 명세(current/previous), ' +
          '전월 대비 변동 항목(changes), 급여 계산 규칙(policy)입니다. 이 데이터에 있는 수치와 규칙만 인용해 ' +
          '"이번 달 급여가 왜 이 금액인지"를 한국어 3~4문장으로 설명하세요. 변동이 큰 항목을 먼저 짚고, 반드시 규칙(성과급 지급월·연장근로 산식·비과세 식대·간이세액표)을 근거로 대세요. ' +
          '데이터에 없는 수치를 만들지 마세요. 머리말·마크다운 없이 문장만.',
        messages: [{ role: 'user', content: JSON.stringify(r).slice(0, 6000) }],
        onDone: function (t) {
          if (btn) btn.disabled = false;
          var txt = String(t || '').trim();
          if (!txt) { fail('빈 응답'); return; }
          el.innerHTML = panelHTML('명세 설명',
            '<span class="chip">✦ elizax 생성</span><span class="chip src">급여 원장</span><span class="chip src">급여 계산 규칙</span>',
            '<div>' + hesc(txt).replace(/\n+/g, '<br>') + '</div>' +
            '<div style="margin-top:10px;font-size:12px"><b style="color:var(--ink)">인용한 명세</b>' + body + '</div>', foot);
          ledger('pay.explain', '급여 명세 설명 (elizax) · ' + r.current.period, txt.slice(0, 160));
        },
        onError: function (e) { fail(e && e.message ? e.message : String(e || '')); }
      });
    } catch (e) { fail(String(e && e.message || e)); }
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
