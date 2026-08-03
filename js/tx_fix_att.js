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

  /* app "today" = 기준 시점(EZKit.clock) — 전역 as-of 2026-07-16 과 일치 */
  var AS_OF = (function () {
    try { if (window.EZKit && EZKit.clock) return EZKit.clock.asOfDate(); } catch (e) { /* ignore */ }
    return '2026-07-16';
  })();
  var TODAY = (function () {
    var p = AS_OF.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  })();
  /* 화면에 찍는 "지금"은 하나여야 한다 — 달력·근태요약과 툴바 날짜가 서로 다른 날을
     가리키면 안 되므로 라벨도 EZKit.clock 에서 만든다. */
  function asOfDot() { return AS_OF.replace(/-/g, '.'); }
  function asOfTime() {
    var raw = AS_OF + ' 06:00';
    try { if (window.EZKit && EZKit.clock) raw = EZKit.clock.asOf(); } catch (e) { /* ignore */ }
    var hm = ((raw.split(' ')[1]) || '06:00').split(':');
    var h = +hm[0];
    return (h < 12 ? '오전' : '오후') + ' ' + (h % 12 || 12) + ':' + hm[1];
  }
  function asOfStamp() {
    return asOfDot() + ' (' + ['일', '월', '화', '수', '목', '금', '토'][TODAY.getDay()] + ') ' + asOfTime();
  }
  function q(r, s) { return r ? r.querySelector(s) : null; }
  function qa(r, s) { return r ? Array.prototype.slice.call(r.querySelectorAll(s)) : []; }
  function stop(e) { if (e) e.stopPropagation(); }
  function once(el) { if (!el || el.__txf) return false; el.__txf = 1; return true; }
  function fmt(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ================= 근태·연차 원천 데이터 (TALENX_DATA) =================
     attendance / leaves 는 scripts/enrich_hr_ops.py 가 만든 합성 원천이다.
     같은 원천을 EZTools(get_attendance·get_leave_balance)도 읽으므로
     화면 수치와 elizax 답변이 어긋나지 않는다. */
  function DATA() { return F.D || window.TALENX_DATA || {}; }
  function ME() {
    var d = DATA();
    return (F.CU && F.CU.emp_id) ? F.CU : ((d.meta && d.meta.currentUser) || {});
  }
  function ROLEKEY() {
    return (F.CU && F.CU._role) ||
      (window.TXRoles && TXRoles.current && TXRoles.current().key) || 'member';
  }
  function attRows(empId) {
    return (DATA().attendance || []).filter(function (a) { return a.emp_id === empId; })
      .sort(function (a, b) { return String(b.period).localeCompare(String(a.period)); });
  }
  function myLeave() {
    var me = ME();
    return (DATA().leaves || []).filter(function (l) { return l.emp_id === me.emp_id; })[0] || null;
  }
  /* 일별 기록 date → row (최근 4주 창) */
  function dailyMap(empId) {
    var m = {};
    attRows(empId).forEach(function (a) {
      (a.daily || []).forEach(function (d) { m[d.date] = d; });
    });
    return m;
  }
  function hhmm(hours) {
    var t = Math.max(0, Math.round((hours || 0) * 60));
    return Math.floor(t / 60) + '시간 ' + (t % 60) + '분';
  }
  function daysLabel(n) { return (Math.round((n || 0) * 10) / 10) + '일'; }

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
      '#s-att .txf-sigrow:last-child{border-bottom:0}' +
      /* ---- ✦ elizax 앵커 + 결과 착지 패널 (화면 안에서 끝난다 — 채팅으로 던지지 않음) ---- */
      '#s-att .txf-ezbar{display:flex;align-items:center;gap:10px;margin-left:auto}' +
      '#s-att .txf-ezanchor{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(31,122,240,.28);color:var(--blue);background:var(--card);font-size:12.5px;font-weight:700;padding:7px 14px;border-radius:999px;cursor:pointer}' +
      '#s-att .txf-ezanchor:hover{background:rgba(31,122,240,.06)}' +
      '#s-att .txf-ezanchor[disabled]{opacity:.6;cursor:default}' +
      '#s-att .txf-ezpanel{border:1px solid rgba(31,122,240,.28);background:var(--card);border-radius:12px;padding:16px 18px;margin-bottom:18px;font-size:13px;color:var(--ink-2);line-height:1.65}' +
      '#s-att .txf-ezpanel .ezh{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:800;color:var(--ink);margin-bottom:8px}' +
      '#s-att .txf-ezpanel .ezh .sp{color:var(--blue)}' +
      '#s-att .txf-ezpanel .ezh .x{margin-left:auto;cursor:pointer;color:var(--ink-4);font-weight:600}' +
      '#s-att .txf-ezpanel .chip{display:inline-block;font-size:10.5px;font-weight:700;border-radius:999px;padding:2px 9px;margin-right:5px;background:rgba(31,122,240,.08);color:#356CB5;border:1px solid rgba(31,122,240,.22)}' +
      '#s-att .txf-ezpanel .chip.off{background:#F2F4F7;color:#5C6474;border-color:#DDE2EA}' +
      '#s-att .txf-ezpanel .chip.src{background:rgba(194,65,12,.08);color:#C2410C;border-color:rgba(194,65,12,.22)}' +
      '#s-att .txf-ezpanel ul{margin:6px 0 0;padding-left:17px}' +
      '#s-att .txf-ezpanel li{margin-bottom:3px}' +
      '#s-att .txf-ezpanel li.warn{color:var(--red);font-weight:600}' +
      '#s-att .txf-ezpanel .foot{margin-top:9px;padding-top:8px;border-top:1px solid var(--line);font-size:11.5px;color:var(--ink-3)}';
    var st = document.createElement('style');
    st.id = 'txf-att-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ================= ✦ 근태 요약 (elizax 앵커 · 결과는 화면 안에 착지) =================
     실AI(EZAI.ready())면 실호출, 아니면 규칙 기반 요약 + "AI 미연결" 라벨.
     폴백을 AI인 척 감추지 않는다(프로젝트 확립 원칙). */
  function aiLive() {
    try { return !!(window.EZAI && EZAI.direct && EZAI.ready && EZAI.ready()); } catch (e) { return false; }
  }
  function teamAgg() {
    /* 조직장·HR용 팀/전사 집계 — 개인 상세가 아니라 집계 수준만 */
    var me = ME(), role = ROLEKEY();
    if (role !== 'leader' && role !== 'hr' && role !== 'exec') return null;
    var d = DATA();
    var ids = {};
    (d.employees || []).forEach(function (e) {
      if (role === 'leader' ? (e.org_id === me.org_id) : true) ids[e.emp_id] = 1;
    });
    var period = '';
    (d.attendance || []).forEach(function (a) { if (!a.partial && ids[a.emp_id] && a.period > period) period = a.period; });
    var pool = (d.attendance || []).filter(function (a) { return ids[a.emp_id] && a.period === period; });
    if (!pool.length) return null;
    var lv = (d.leaves || []).filter(function (l) { return ids[l.emp_id]; });
    var sum = 0;
    pool.forEach(function (a) { sum += a.overtime_hours || 0; });
    return {
      scope: role === 'leader' ? (me.orgName || '우리 팀') : '전사',
      period: period, headcount: pool.length,
      avg_ot: Math.round(sum * 10 / pool.length) / 10,
      over_limit: pool.filter(function (a) { return a.overtime_hours >= 52; }).length,
      promo: lv.filter(function (l) { return l.promotion_target; }).length
    };
  }
  function attFacts() {
    var T = window.EZTools;
    if (!(T && T.run)) return null;
    var a = T.run('get_attendance', {}), l = T.run('get_leave_balance', {});
    if (!a || a.error || a.blocked) a = null;
    if (!l || l.error || l.blocked) l = null;
    if (!a && !l) return null;
    return { att: a, leave: l, team: teamAgg() };
  }
  function attRuleLines(f) {
    var out = [], c = f.att && f.att.current;
    if (c) {
      out.push({ warn: false, t: c.period + (c.partial ? ' (부분월 · ' + AS_OF + ' 기준)' : '') +
        ' — 소정 ' + c.work_days + '일 중 실근무 ' + daysLabel(c.actual_days) +
        ' · 초과근로 ' + c.overtime_hours + '시간 · 재택 ' + c.remote_days + '일 · 지각 ' + c.late_count + '회' });
    }
    ((f.att && f.att.signals) || []).forEach(function (s) {
      out.push({ warn: s.level === 'warn', t: s.text });
    });
    var l = f.leave;
    if (l && l.remaining_days != null) {
      out.push({ warn: false, t: '연차 부여 ' + l.granted_days + '일 · 사용 ' + l.used_days + '일 · 잔여 ' +
        l.remaining_days + '일 — ' + l.expiring_at + ' 소멸 예정' +
        (l.pending_days ? ' (승인 대기 ' + l.pending_days + '일)' : '') });
    }
    if (f.team) {
      out.push({ warn: false, t: f.team.scope + ' 집계(' + f.team.period + ') — ' + f.team.headcount +
        '명 · 평균 초과근로 ' + f.team.avg_ot + '시간 · 월 52시간 도달 ' + f.team.over_limit +
        '명 · 연차촉진 대상 ' + f.team.promo + '명 (개인 상세는 열람 규칙상 비노출)' });
    }
    if (!out.length) out.push({ warn: false, t: '근태·연차 기록이 없어 요약할 내용이 없습니다.' });
    return out;
  }
  function ezPanelHTML(title, chips, bodyHTML, foot) {
    return '<div class="ezh"><span class="sp">✦</span>' + esc(title) +
      '<span class="x" data-txf="ezclose">✕</span></div>' +
      (chips || '') + bodyHTML +
      (foot ? '<div class="foot">' + foot + '</div>' : '');
  }
  function mountPanel(host, cls) {
    var el = q(host, '.' + cls);
    if (!el) {
      el = document.createElement('div');
      el.className = 'txf-ezpanel ' + cls;
      host.insertBefore(el, host.firstChild);
      el.addEventListener('click', function (e) {
        if (e.target && e.target.getAttribute('data-txf') === 'ezclose') { stop(e); el.parentNode.removeChild(el); }
      }, false);
    }
    return el;
  }
  function runAttSummary(host, btn) {
    var f = attFacts();
    var el = mountPanel(host, 'txf-ezatt');
    if (!f) {
      el.innerHTML = ezPanelHTML('근태 요약', '<span class="chip off">데이터 없음</span>',
        '<div>근태·연차 원천 데이터를 찾지 못했습니다. 지어내지 않고 여기서 멈춥니다.</div>', '');
      return;
    }
    var lines = attRuleLines(f);
    var listHTML = '<ul>' + lines.map(function (x) {
      return '<li class="' + (x.warn ? 'warn' : '') + '">' + esc(x.t) + '</li>';
    }).join('') + '</ul>';
    var foot = '기준 ' + AS_OF + ' · 원천: 근태 원장 · 연차 대장 (데모 합성 데이터)';
    var live = aiLive();
    el.innerHTML = ezPanelHTML('근태 요약',
      (live ? '<span class="chip">✦ elizax 작성 중…</span>' : '<span class="chip off">AI 미연결 — 규칙 기반 요약</span>') +
      '<span class="chip src">ERP 근태</span><span class="chip src">연차 대장</span>',
      listHTML, foot);
    ledger('att.summary', '근태 요약', lines.map(function (x) { return x.t; }).join(' · ').slice(0, 160));
    if (!live) return;
    if (btn) { btn.disabled = true; }
    try {
      window.EZAI.direct({
        system: '당신은 elizax — HR 근태 코치입니다. 아래 JSON은 사용자 본인의 근태·연차 실데이터입니다. ' +
          '이 데이터에 있는 수치만 인용해 한국어 3~4문장으로 요약하세요. 이상 신호(초과근로 상한 도달·급증, 지각 증가, 연차 소멸 임박)가 있으면 먼저 짚고, ' +
          '무엇을 하면 되는지 한 문장으로 제안하세요. 데이터에 없는 수치를 만들지 마세요. 머리말·마크다운 없이 문장만.',
        messages: [{ role: 'user', content: JSON.stringify(f).slice(0, 6000) }],
        onDone: function (t) {
          if (btn) btn.disabled = false;
          var txt = String(t || '').trim();
          if (!txt) { onFail('빈 응답'); return; }
          el.innerHTML = ezPanelHTML('근태 요약',
            '<span class="chip">✦ elizax 생성</span><span class="chip src">ERP 근태</span><span class="chip src">연차 대장</span>',
            '<div>' + esc(txt).replace(/\n+/g, '<br>') + '</div>' +
            '<div style="margin-top:9px;font-size:12px"><b style="color:var(--ink)">조회한 사실</b>' + listHTML + '</div>', foot);
          ledger('att.summary', '근태 요약 (elizax)', txt.slice(0, 160));
        },
        onError: function (e) { onFail(e && e.message ? e.message : String(e || '')); }
      });
    } catch (e) { onFail(String(e && e.message || e)); }
    function onFail(msg) {
      if (btn) btn.disabled = false;
      el.innerHTML = ezPanelHTML('근태 요약',
        '<span class="chip off">AI 생성 실패 — 규칙 기반 요약으로 대체</span><span class="chip src">ERP 근태</span>',
        listHTML, foot + ' · 실패 사유: ' + esc(msg || '응답 없음'));
    }
  }
  /* 산출물을 성과 기록(원장)에 남긴다 */
  function ledger(source, title, summary) {
    try {
      document.dispatchEvent(new CustomEvent('ez:ctx', { detail: {
        type: 'audit', source: source, title: title, summary: summary, weight: 1
      } }));
    } catch (e) { /* 원장 미탑재 */ }
  }
  function addAnchor(host, label, onClick) {
    if (!host || q(host, '.txf-ezanchor')) return;
    var bar = document.createElement('span');
    bar.className = 'txf-ezbar';
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'txf-ezanchor';
    b.textContent = label;
    b.addEventListener('click', function (e) { stop(e); e.preventDefault(); onClick(b); }, false);
    bar.appendChild(b);
    host.appendChild(bar);
  }

  /* ================= 0. 내 근무 ================= */
  function tagFor(d, inMonth, dmap) {
    var key = fmt(d);
    var rec = dmap && dmap[key];
    if (rec && inMonth) {
      if (rec.type === '연차' || rec.type === '병가' || rec.type === '경조')
        return '<span class="ctag holi">' + esc(rec.type) + '</span>';
      if (rec.type === '반차')
        return '<span class="ctag req">반차</span><span class="ctime">' + esc(rec.in) + ' - ' + esc(rec.out) + '</span>';
      return '<span class="ctag ' + (rec.type === '재택' ? 'req' : 'zero') + '">' +
        (rec.type === '재택' ? '재택' : '근무') + ' ' + rec.work_hours + 'h</span>' +
        '<span class="ctime">' + esc(rec.in) + ' - ' + esc(rec.out) + '</span>';
    }
    if (d.getTime() === TODAY.getTime() && inMonth)
      return '<span class="ctag plan">' + SVG_PEN + '근무전</span><span class="ctime">자율</span>';
    if (!inMonth) return '';
    if (d.getDay() === 0 || d.getDay() === 6) return '<span class="ctag off">휴무</span>';
    if (d < TODAY) return '<span class="ctag miss">' + SVG_EXCL + '누락</span>';
    return '<span class="ctag undef">' + SVG_EXCL + '미정</span>';
  }
  function cellFor(d, inMonth, dmap) {
    var wd = d.getDay(), isToday = (d.getTime() === TODAY.getTime() && inMonth);
    var cls = isToday ? 'dnum today' : ((!inMonth || wd === 0 || wd === 6) ? 'dnum dim' : 'dnum');
    var num = isToday ? String(d.getDate()) : pad2(d.getDate());
    var top = '<div class="cell-top"><span class="' + cls + '">' + num + '</span>';
    if (fmt(d) === '2026-07-17') top += '<span class="holname">제헌절</span>';
    if (fmt(d) === '2026-06-03') top += '<span class="holname">지방선거</span>';
    top += '</div>';
    return '<div class="cell">' + top + tagFor(d, inMonth, dmap) + '</div>';
  }
  function renderCal(body, y, m, dmap) {    // m = 1-based
    var first = new Date(y, m - 1, 1);
    var start = new Date(y, m - 1, 1 - first.getDay());
    var last = new Date(y, m, 0);
    var end = new Date(y, m - 1, last.getDate() + (6 - last.getDay()));
    var html = '', cur = new Date(start);
    while (cur <= end) {
      html += cellFor(cur, cur.getMonth() === (m - 1), dmap);
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
    }
    body.innerHTML = html;
  }
  /* 우측 근무현황 패널 — attendance 월 요약 실측 렌더 */
  function paintWorkStat(card, rec) {
    if (!card || !rec) return;
    var STD = 8;                                  /* 1일 소정근로 8시간 */
    var normal = Math.max(0, (rec.actual_days || 0) * STD);
    var ot = rec.overtime_hours || 0;
    var total = normal + ot;
    var std = (rec.work_days || 0) * STD;
    var pct = std ? Math.round(total * 100 / std) : 0;
    var nav = q(card, '.statnav span:nth-child(2)');
    if (nav) {
      var ym = String(rec.period).split('-');
      var lastDay = new Date(+ym[0], +ym[1], 0).getDate();
      nav.textContent = String(ym[0]).slice(2) + '.' + ym[1] + '.01 ~ ' + ym[1] + '.' + pad2(lastDay) +
        (rec.partial ? ' (' + AS_OF + ' 기준)' : '');
    }
    var big = q(card, '.statbig');
    if (big) big.innerHTML = hhmm(total) + ' <small>/ ' + std + '시간 (월)</small>';
    var pctEl = card.querySelector('div > b');
    if (pctEl) pctEl.textContent = pct + '%';
    var bar = q(card, '.progbar');
    if (bar) {
      bar.style.background = 'linear-gradient(90deg,var(--blue) 0%,var(--blue) ' +
        Math.min(100, pct) + '%,var(--line) ' + Math.min(100, pct) + '%,var(--line) 100%)';
    }
    var vals = [
      daysLabel(rec.actual_days), hhmm(normal), hhmm(0), hhmm(total),
      daysLabel(rec.leave_days || 0), hhmm(0), hhmm(ot), hhmm(0)
    ];
    qa(card, '.statcell .v').forEach(function (v, i) { if (vals[i] != null) v.textContent = vals[i]; });
  }
  function patchWork(root) {
    var p = q(root, '.subpage[data-p="0"]');
    if (!p || !once(p)) return;

    var me = ME();
    var rows = attRows(me.emp_id);
    var dmap = dailyMap(me.emp_id);

    /* ✦ elizax 앵커 1개 (AI 무풍 화면 해소) — 결과는 이 화면 안에 착지 */
    var title = q(p, '.att-title');
    if (title) {
      title.style.display = 'flex';
      title.style.alignItems = 'center';
      addAnchor(title, '✦ 근태 요약', function (btn) { runAttSummary(p, btn); });
    }

    /* calendar re-render + wire ‹ › 오늘 (fix #2, #3) */
    var body = q(p, '.cal-body'), mo = q(p, '.cal-mo'), head = q(p, '.cal-head');
    var view = { y: TODAY.getFullYear(), m: TODAY.getMonth() + 1 };
    function draw() { if (mo) mo.textContent = view.y + '.' + pad2(view.m); if (body) renderCal(body, view.y, view.m, dmap); }
    draw();
    if (head) head.addEventListener('click', function (e) {
      var t = e.target;
      if (t.classList.contains('nav')) {
        stop(e);
        if (t.textContent.indexOf('‹') >= 0) { view.m--; if (view.m < 1) { view.m = 12; view.y--; } }
        else { view.m++; if (view.m > 12) { view.m = 1; view.y++; } }
        draw();
      } else if (t.classList.contains('today')) { stop(e); view.y = TODAY.getFullYear(); view.m = TODAY.getMonth() + 1; draw(); }
    }, false);

    /* right panel — add blue 출근 button above dark 근무 신청 (fix #1) */
    var wcards = qa(p, '.att-col .wcard');
    var w0 = wcards[0];
    if (w0) {
      /* 오늘 상태 카드 — 기준 시점 실데이터 */
      var todayRec = dmap[fmt(TODAY)];
      var DOW = ['일', '월', '화', '수', '목', '금', '토'];
      var st = q(w0, '.wstate .t');
      if (st) {
        st.innerHTML = (TODAY.getMonth() + 1) + '월 ' + TODAY.getDate() + '일 ' + DOW[TODAY.getDay()] + '요일<br>' +
          (todayRec
            ? '<span style="color:var(--blue)">' + esc(todayRec.type) + '</span> · ' + esc(todayRec.in) + ' 출근'
            : '<span style="color:var(--blue)">출근전</span> 입니다.');
      }
      var pill = q(w0, '.wpill');
      if (pill) pill.textContent = todayRec ? '근무중' : '근무전';
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
      var wt = q(w0, '.wtime'); if (wt) wt.innerHTML = asOfTime() + ' ↻';
    }

    /* 근무현황 패널 — 월 요약 실측치 (최신 기간 = 부분월 2026-07) */
    var statIdx = 0;
    if (wcards[1]) paintWorkStat(wcards[1], rows[0]);

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
        } else {
          /* 실데이터 기간 이동 (attendance 보유 기간 안에서만) */
          statIdx += (tx.indexOf('‹') >= 0) ? 1 : -1;
          statIdx = Math.max(0, Math.min(rows.length - 1, statIdx));
          paintWorkStat(wcards[1], rows[statIdx]);
          TOAST(rows[statIdx] ? (rows[statIdx].period + ' 근무현황') : '이동할 기간이 없습니다.');
        }
      } else if (t.classList.contains('today')) {
        stop(e); statIdx = 0; paintWorkStat(wcards[1], rows[0]); TOAST('이번 달로 이동했습니다.');
      }
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

    /* 연차 원장(leaves) 실데이터 — 화면·AI 단일 원천 */
    var LV = myLeave();
    function hrs(days) { return Math.round((days || 0) * 8) + '시간(' + (Math.round((days || 0) * 100) / 100) + '일)'; }
    var reqs = (LV && LV.requests) || [];
    var pendDays = reqs.filter(function (r) { return r.status === '대기'; })
      .reduce(function (s, r) { return s + (r.days || 0); }, 0);

    /* header: 연차 대장 수치로 교체 (fix #5) */
    var hsum = q(p, '.hsum');
    if (hsum) {
      var yr = q(hsum, '.selbox');
      if (yr) yr.innerHTML = (LV ? LV.year : 2026) + ' <span class="cv">▾</span>';
      var bs = hsum.querySelectorAll('b');
      if (bs[0]) bs[0].textContent = LV ? hrs(LV.granted_days) : '기록 없음';
      if (bs[1]) bs[1].textContent = LV ? hrs(LV.used_days) : '-';
      var blue = q(hsum, '.blue'); if (blue) blue.textContent = LV ? hrs(LV.remaining_days) : '-';
      var ro = q(hsum, '.req-orange');
      if (ro) {
        if (pendDays) ro.textContent = hrs(pendDays) + ' 요청중';
        else ro.parentNode.removeChild(ro);
      }
      if (yr) wireSelbox(yr, ['2026'], function (v) { TOAST(v + '년 연차 대장만 보유하고 있습니다 (데모 데이터).'); });
    }

    /* 잔여 휴가: 연차 대장 기반 (fix #5) */
    var cards = qa(p, '.card');
    var leaveCard = cards[0];
    if (leaveCard) {
      var more = q(leaveCard, '.morebtn');
      qa(leaveCard, '.lvrow').forEach(function (r) { r.parentNode.removeChild(r); });
      var sickUsed = reqs.filter(function (r) { return r.type === '병가' && r.status === '승인'; })
        .reduce(function (s, r) { return s + r.days; }, 0);
      var famUsed = reqs.filter(function (r) { return r.type === '경조' && r.status === '승인'; })
        .reduce(function (s, r) { return s + r.days; }, 0);
      var rows =
        lvrowHTML('연차 휴가', LV ? ('2026.01.01 ~ ' + String(LV.expiring_at).replace(/-/g, '.') + ' 소멸') : '', LV ? hrs(LV.remaining_days) : '-', false) +
        lvrowHTML('경조휴가', famUsed ? ('사용 ' + famUsed + '일') : '', '', false) +
        lvrowHTML('병가', sickUsed ? ('사용 ' + sickUsed + '일') : '', '', false) +
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
      /* 예정휴가 = 기준 시점 이후 신청 / 사용기록 = 승인 완료분 (연차 대장 실데이터) */
      var DOWK = ['일', '월', '화', '수', '목', '금', '토'];
      function reqRow(r) {
        var d = new Date(r.start.slice(0, 4), +r.start.slice(5, 7) - 1, +r.start.slice(8, 10));
        var lab = r.start.replace(/-/g, '.') + '(' + DOWK[d.getDay()] + ')' + (r.end !== r.start ? ' ~ ' + r.end.slice(5).replace('-', '.') : '');
        return schedRow(lab, Math.round(r.days * 8) + '시간', esc(r.type) + ' · ' + esc(r.status) + (r.reason ? ' · ' + esc(r.reason) : ''));
      }
      var upcoming = reqs.filter(function (r) { return r.start > AS_OF || r.status === '대기'; });
      var past = reqs.filter(function (r) { return r.status === '승인' && r.start <= AS_OF; })
        .sort(function (a, b) { return b.start.localeCompare(a.start); });
      var planned = document.createElement('div');
      planned.className = 'txf-lvtab txf-planned';
      planned.innerHTML = upcoming.length
        ? upcoming.map(reqRow).join('')
        : '<div class="txf-emptybox"><div class="ic">i</div>예정휴가 일정이 없습니다.</div>';
      var history = document.createElement('div');
      history.className = 'txf-lvtab txf-history'; history.style.display = 'none';
      history.innerHTML = past.length
        ? past.map(reqRow).join('')
        : '<div class="txf-emptybox"><div class="ic">i</div>사용 기록이 없습니다.</div>';
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
    /* 집계 기준월 = 확정월 중 최신 (부분월은 일부 대상자만 보유 — 집계 왜곡 방지) */
    var all = DATA().attendance || [];
    var base = '';
    all.forEach(function (a) { if (!a.partial && a.period > base) base = a.period; });
    var byEmp = {};
    all.forEach(function (a) { if (a.period === base) byEmp[a.emp_id] = a; });
    return emps.map(function (e) {
      var team = (F.teamName ? F.teamName(e) : e.orgName) || '';
      var ava = F.avatar ? F.avatar(e.name, 32) : '<span class="ava"></span>';
      var a = byEmp[e.emp_id];
      var head = a ? ('실근무 ' + daysLabel(a.actual_days) + ' / ' + a.work_days + '일 · 초과 ' + a.overtime_hours + 'h')
        : '근태 기록 없음';
      var sub = a ? (a.avg_in_time + ' - ' + a.avg_out_time + ' · 재택 ' + a.remote_days + '일 · 지각 ' + a.late_count + '회') : '-';
      var block = '<div class="gblock"><span class="core"></span><span class="rest"></span>' +
        '<div class="bt">' + SVG_CLK + esc(head) + '</div><div class="bs">' + esc(sub) + '</div></div>';
      return '<div class="grow"><div class="gmember">' + ava +
        '<div><div class="nm">' + esc(e.name) + '</div><div class="org">' + esc(team) + '</div></div></div>' +
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
        /* 요청자는 실제 구성원에서 고른다 — '김소희(유럽팀)'은 HCG 에 없는 사람·조직이었다. */
        var reqPool = (DATA().employees || []).filter(function (e) {
          return e && e.name && e.emp_id !== (F.CU && F.CU.emp_id) && (!teamFilter || teamFilter(e));
        });
        var who = reqPool[0] || { name: '구성원', orgName: '' };
        MODAL({
          title: '근무 요청 모아보기', wide: true,
          body: '<div class="txf-sigrow"><b style="color:var(--ink)">' +
                esc(who.name) + (who.orgName ? '(' + esc(who.orgName) + ')' : '') +
                '</b><span style="flex:1"></span>근무시간 변경 요청 · ' + AS_OF.slice(5).replace('-', '.') + '</div>' +
                '<div class="txf-sigrow" style="color:var(--ink-3)">승인 대기 1건</div>',
          actions: [{ label: '닫기', kind: 'ghost' }, { label: '전체 승인', kind: 'primary', onClick: function () { TOAST('요청을 승인했습니다.', 'ok'); } }]
        });
      }, false);
    }

    /* leader(조직장)=본인 팀 범위만, hr/exec=전사 (fix: leader over-scope leak) */
    var teamFilter = (ROLE === 'leader' && F.teamName && F.CU) ? function (e) { return F.teamName(e) === F.teamName(F.CU); } : null;
    var allNamed = (DATA().employees || []).filter(function (e) { return e && e.name; });
    var teamSize = teamFilter ? allNamed.filter(teamFilter).length : allNamed.length;
    var shown = Math.min(11, teamSize);
    var headCount = teamSize;
    var pagerTxt = '1–' + shown + ' of ' + teamSize;

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
      if (dt) {
        dt.innerHTML = dt.innerHTML.replace(/[\d]{4}[.\-][\d]{2}[.\-][\d]{2}/, asOfDot());
        if (once(dt)) dt.addEventListener('click', function (e) { stop(e); TOAST('날짜를 선택하세요. (' + asOfDot() + ')'); }, false);
      }
      var sel = q(card, '.selbox');
      if (sel) wireSelbox(sel, ['요청중 포함', '요청중 제외', '승인만 보기'], function (v) { sel.innerHTML = v + ' <span class="cv">▾</span>'; TOAST(v + '으로 조회합니다.'); });
      var rf = q(card, '.refresh');
      if (rf) {
        rf.innerHTML = rf.innerHTML.replace(/(오전|오후)\s*\d{1,2}:\d{2}/, asOfTime());
        if (once(rf)) rf.addEventListener('click', function (e) { stop(e); TOAST('새로고침했습니다.'); }, false);
      }
    }

    /* 일정 / 현황 segtabs (fix #7 wiring) */
    var seg = q(p, '.segtabs');
    if (seg && once(seg)) {
      var stat = document.createElement('div');
      stat.className = 'txf-memstat'; stat.style.display = 'none';
      /* 집계는 실데이터로 — 조직장은 본인 팀, HR/경영진은 전사 */
      var agSrc = (DATA().employees || []).filter(function (x) { return x && x.name; });
      if (teamFilter) agSrc = agSrc.filter(teamFilter);
      var agIds = {};
      agSrc.forEach(function (x) { agIds[x.emp_id] = 1; });
      var agBase = '';
      (DATA().attendance || []).forEach(function (a) { if (!a.partial && agIds[a.emp_id] && a.period > agBase) agBase = a.period; });
      var agPool = (DATA().attendance || []).filter(function (a) { return agIds[a.emp_id] && a.period === agBase; });
      var agW = 0, agA = 0, agO = 0, agL = 0;
      agPool.forEach(function (a) { agW += a.work_days || 0; agA += a.actual_days || 0; agO += a.overtime_hours || 0; agL += a.late_count || 0; });
      var agPct = agW ? Math.round(agA * 1000 / agW) / 10 : 0;
      stat.innerHTML = '<div class="card" style="padding:18px"><div class="txf-emptybox"><div class="ic">i</div>' +
        (agPool.length
          ? (esc(agBase) + ' 구성원 근무 현황 집계 (' + agPool.length + '명)<br>' +
             '소정 대비 실근무 달성률 ' + agPct + '% · 평균 초과근로 ' +
             (Math.round(agO * 10 / agPool.length) / 10) + '시간 · 지각 합계 ' + agL + '회')
          : '집계할 근태 기록이 없습니다.') + '</div></div>';
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

  /* ================= 3. 구성원 휴가 ================= */
  function patchLeaveMember(root) {
    var p = q(root, '.subpage[data-p="3"]');
    if (!p || !once(p)) return;
    var dt3 = q(p, '.dtbox');
    if (dt3) dt3.innerHTML = dt3.innerHTML.replace(/[\d]{4}[.\-][\d]{2}[.\-][\d]{2}/, asOfDot());
    /* 구성원 근무(p=2)와 동일 스코프: member=차단, leader=본인 팀, hr/exec=전사 */
    var ROLE = (F.CU && F.CU._role) || (window.TXRoles && TXRoles.current && TXRoles.current().key) || 'member';
    if (ROLE === 'member') {
      var b = q(p, '.bluebtn'); if (b) b.style.display = 'none';
      var s = q(p, '.segtabs'); if (s) s.style.display = 'none';
      var c = q(p, '.card');
      if (c) c.innerHTML =
        '<div class="txf-emptybox"><div class="ic">i</div>' +
        '구성원 휴가 현황은 조직장·HR에게만 제공됩니다.<br>' +
        '나의 휴가는 ‘내 휴가’ 탭에서 확인하세요.</div>';
      return;
    }
    /* 연차 대장(leaves)에 실제 휴가 요청이 있으므로 표를 채운다 — 조직장은 본인 팀,
       HR·경영진은 전사. 비어 있던 'No rows' 가 곧 "휴가 내역 없음"으로 읽히던 문제. */
    var teamOnly = (ROLE === 'leader' && F.teamName && F.CU)
      ? function (e) { return F.teamName(e) === F.teamName(F.CU); } : null;
    var empOf = {};
    (DATA().employees || []).forEach(function (e) { if (e && e.name) empOf[e.emp_id] = e; });
    var rows = [];
    (DATA().leaves || []).forEach(function (lv) {
      var e = empOf[lv.emp_id];
      if (!e || (teamOnly && !teamOnly(e))) return;
      (lv.requests || []).forEach(function (r) {
        if (r.status !== '승인' || r.start > AS_OF) return;   // 기준일까지 확정된 건만
        rows.push({ e: e, r: r });
      });
    });
    rows.sort(function (a, b) { return a.r.start < b.r.start ? 1 : -1; });
    var tb = q(p, 'table.tbl tbody');
    if (tb && rows.length) {
      var shown = rows.slice(0, 100);
      tb.innerHTML = shown.map(function (x, i) {
        var span = x.r.end && x.r.end !== x.r.start ? x.r.start + ' ~ ' + x.r.end : x.r.start;
        return '<tr><td>' + (i + 1) + '</td>' +
          '<td>' + esc(x.e.name) + '</td><td>HCG</td>' +
          '<td>' + esc(x.e.orgName || '') + '</td>' +
          '<td>' + esc(span) + ' (' + esc(x.r.type) + ')</td>' +
          '<td>' + (x.r.days * 8) + '시간</td><td>-</td><td>-</td></tr>';
      }).join('');
      var pg = qa(p, '.pager span').filter(function (s) { return /of/.test(s.textContent) && s.className !== 'rpp'; })[0];
      if (pg) pg.textContent = '1–' + shown.length + ' of ' + rows.length;
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
      rf.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 11A8 8 0 106 6l-2 2m0-4v4h4"/></svg>' + asOfStamp();
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
    try { patchLeaveMember(root); } catch (e) { console.error('[txfix att mleave]', e); }
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
