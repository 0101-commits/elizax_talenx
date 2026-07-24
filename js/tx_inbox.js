/* =========================================================================
 * tx_inbox.js — 조직장 승인 인박스 (로드맵 1번)
 * =========================================================================
 * [기획 스펙]
 * ① 배경/문제
 *    - 조직원이 목표 상세에서 체크인 승인 요청(tx_fix_perf fix18,
 *      sessionStorage `txf_ckreq_<oid>`)을 올려도 조직장 쪽에는 이를 받아
 *      처리할 큐가 없다(Pain T18[1] 등 6건). 요청은 쌓이는데 결정 동선이 없음.
 * ② 사용자 시나리오
 *    - leader/hr 역할로 신청/승인(#s-wf) "받은 문서" 탭을 열면 목록 상단에
 *      "승인 대기" 카드가 뜬다. 행 클릭 → 우측 근거 드로어(요청 내용,
 *      현재값→요청값 변화, 근거 코멘트·출처) → 승인/반려.
 *    - 승인/반려하면 sessionStorage 상태 갱신 + 성과 히스토리(ez:ctx) 기록
 *      + 토스트. 처리된 건은 "처리됨" 섹션으로 이동, 헤더 배지 감소.
 * ③ 동작 정의 (sessionStorage 계약)
 *    - 체크인: `txf_ckreq_<oid>` = {vals,comment,at,ai, (인박스 추가 필드)
 *      status:'approved'|'rejected', decided_at, seed?, owner_emp_id?,
 *      title?, prev?, krNames?}. fix18이 만든 실요청은 oid로 objectives /
 *      keyResults에서 소유자·현재값을 역추적, 시드는 필드를 자체 내장.
 *    - 목표 수정/가중치: `txf_ibreq_<id>` = {kind:'goal'|'weight', ...} 시드.
 *    - 승인해도 원본 TALENX_DATA는 건드리지 않는다(데모 원칙). 상태는
 *      sessionStorage에만 남는다 → "승인 전에는 아무것도 반영되지 않음".
 *    - 감사: 결정 시 document에 CustomEvent "ez:ctx"
 *      detail={type:'checkin'|'goal', source:'inbox.approve'|'inbox.reject',
 *      title, summary, weight:2} 발행 → window.EZLedger가 수신·기록.
 * ④ 엣지 케이스
 *    - member/exec 역할은 카드 자체를 만들지 않는다.
 *    - tx_fix_wf가 .wf-page[data-p="0"] innerHTML을 통째로 재작성하므로
 *      MutationObserver로 카드가 밀려나면 다시 맨 위에 꽂는다.
 *    - oid가 데이터에 없는 요청(시드·삭제된 목표)은 내장 필드로 렌더.
 * ========================================================================= */
(function () {
  'use strict';
  if (window.__txInbox) return;
  window.__txInbox = true;

  var F = window.TXFIX || {};
  var D = window.TALENX_DATA || {};
  var esc = (window.TX && window.TX.esc) || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };
  function toast(msg, kind) { if (window.TX && window.TX.toast) window.TX.toast(msg, kind || ''); }

  /* ---- 역할 게이트: leader/hr 만 ---- */
  var CU = (D.meta && D.meta.currentUser) || {};
  var role = (CU._role) || (window.TXRoles && window.TXRoles.current().key) || 'member';
  if (role !== 'leader' && role !== 'hr') return;

  /* ---- 인덱스 ---- */
  var empById = {}, objById = {}, krByObj = {};
  (D.employees || []).forEach(function (e) { empById[e.emp_id] = e; });
  (D.objectives || []).forEach(function (o) { objById[o.objective_id] = o; });
  (D.keyResults || []).forEach(function (k) {
    (krByObj[k.objective_id] = krByObj[k.objective_id] || []).push(k);
  });
  function empName(id) { var e = empById[id]; return e ? e.name : '팀원'; }
  function empTeam(id) {
    var e = empById[id];
    return (e && (F.teamName ? F.teamName(e) : e.orgName)) || '';
  }

  var TODAY = '2026-07-24'; // 데모 세계 고정 기준일 (fix18 at 표기와 동일 세계)
  function daysAgo(at) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(at || ''));
    if (!m) return '';
    var t = /^(\d{4})-(\d{2})-(\d{2})/.exec(TODAY);
    var d = Math.round((Date.UTC(+t[1], +t[2] - 1, +t[3]) - Date.UTC(+m[1], +m[2] - 1, +m[3])) / 86400000);
    if (d <= 0) return '오늘';
    return d + '일 경과';
  }

  /* ================= 시드 (없을 때 1회 주입, 이후 상태는 같은 키가 원천) ==== */
  var CK_PREFIX = 'txf_ckreq_';
  var IB_PREFIX = 'txf_ibreq_';
  function sget(k) { try { var v = sessionStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function sset(k, d) { try { sessionStorage.setItem(k, JSON.stringify(d)); } catch (e) { /* ignore */ } }

  function seed() {
    // ① 체크인 승인 요청 시드 2건 — 팀원(EMP-0191·0193, 김명숙 조직장 직속) 목표
    if (!sget(CK_PREFIX + 'OBJ-T191')) sset(CK_PREFIX + 'OBJ-T191', {
      seed: true, owner_emp_id: 'EMP-0191',
      title: '고객 온보딩 리드타임 30% 단축',
      vals: { 'KR-T191-1': '82' }, prev: { 'KR-T191-1': '74' },
      krNames: { 'KR-T191-1': '온보딩 완료율(%)' },
      comment: '7월 2주차 온보딩 자동화 배포 완료로 리드타임 지표가 개선되어 진척값 반영을 요청드립니다.',
      at: '2026-07-21', ai: false,
      src: '체크인 기록 · 업무보드 tsk.wb-0714'
    });
    if (!sget(CK_PREFIX + 'OBJ-T193')) sset(CK_PREFIX + 'OBJ-T193', {
      seed: true, owner_emp_id: 'EMP-0193',
      title: '분기 고객 만족도(CSAT) 4.5 달성',
      vals: { 'KR-T193-1': '4.3' }, prev: { 'KR-T193-1': '4.1' },
      krNames: { 'KR-T193-1': '분기 CSAT 점수' },
      comment: '6/30 1:1 합의사항 이행과 7월 설문 회수분을 반영한 elizax 자동 감지 초안입니다.',
      at: '2026-07-19', ai: true,
      src: '1:1 노트 memo.0630 · 7월 CSAT 설문'
    });
    // ② 목표 수정 요청 시드 1건
    if (!sget(IB_PREFIX + 'goal1')) sset(IB_PREFIX + 'goal1', {
      kind: 'goal', owner_emp_id: 'EMP-0192',
      title: '신규 리드 창출 파이프라인 구축',
      field: '목표 기간', cur: '2026 상반기', req: '2026 3분기까지 연장',
      comment: '핵심 파트너사 일정 지연으로 기간 조정이 필요합니다. 6/30 1:1에서 사전 합의된 내용입니다.',
      at: '2026-07-18', src: '1:1 노트 memo.0630 · 파트너사 공문'
    });
    // ③ 가중치 변경 요청 시드 1건
    if (!sget(IB_PREFIX + 'wt1')) sset(IB_PREFIX + 'wt1', {
      kind: 'weight', owner_emp_id: 'EMP-0194',
      title: '내부 프로세스 문서화 · 지식 자산화',
      field: '핵심 성과 가중치', cur: '문서화 30% · 자산화 70%', req: '문서화 20% · 자산화 80%',
      comment: '하반기 우선순위 조정에 따라 자산화 비중을 높이는 가중치 변경을 요청드립니다.',
      at: '2026-07-22', src: '체크인 기록 · 7월 팀 우선순위 회의'
    });
  }

  /* ================= 수집: sessionStorage 스캔 → 항목 모델 ================= */
  /* 항목: {key, kind, reqName, reqTeam, title, kindLabel, summary, at, ago,
   *        status, data, deltas:[{name,cur,req,delta}]} */
  function collect() {
    var items = [], i, k;
    for (i = 0; i < sessionStorage.length; i++) {
      k = sessionStorage.key(i);
      if (!k) continue;
      if (k.indexOf(CK_PREFIX) === 0) {
        var d = sget(k); if (!d) continue;
        items.push(ckItem(k, d));
      } else if (k.indexOf(IB_PREFIX) === 0) {
        var d2 = sget(k); if (!d2) continue;
        items.push(ibItem(k, d2));
      }
    }
    items.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
    return items;
  }

  function ckItem(key, d) {
    var oid = key.slice(CK_PREFIX.length);
    var o = objById[oid];
    var owner = d.owner_emp_id || (o && o.owner_emp_id) || '';
    var deltas = [];
    var vals = d.vals || {}, kid;
    for (kid in vals) {
      if (!Object.prototype.hasOwnProperty.call(vals, kid)) continue;
      var name = (d.krNames && d.krNames[kid]) || '', cur = null;
      (krByObj[oid] || []).forEach(function (kr) {
        if (kr.kr_id === kid) {
          name = name || kr.name;
          cur = kr.current_value != null ? kr.current_value : (kr.progress || 0);
        }
      });
      if (cur == null && d.prev) cur = d.prev[kid];
      var dv = (parseFloat(vals[kid]) || 0) - (parseFloat(cur) || 0);
      deltas.push({ name: name || kid, cur: cur == null ? '—' : String(cur), req: String(vals[kid]),
        delta: (dv > 0 ? '+' : '') + (Math.round(dv * 10) / 10) });
    }
    return {
      key: key, kind: 'checkin', kindLabel: '체크인 승인',
      reqName: empName(owner), reqTeam: empTeam(owner),
      title: d.title || (o && o.title) || oid,
      summary: '진척값 ' + deltas.length + '건 변경' + (d.ai ? ' · ✦ AI 초안' : ''),
      at: d.at || '', ago: daysAgo(d.at), status: d.status || '',
      deltas: deltas, comment: d.comment || '', src: d.src || '체크인 기록', data: d
    };
  }

  function ibItem(key, d) {
    return {
      key: key, kind: d.kind, kindLabel: d.kind === 'weight' ? '가중치 변경 요청' : '목표 수정 요청',
      reqName: empName(d.owner_emp_id), reqTeam: empTeam(d.owner_emp_id),
      title: d.title || '', summary: (d.field || '') + ' 변경',
      at: d.at || '', ago: daysAgo(d.at), status: d.status || '',
      deltas: [{ name: d.field || '요청 항목', cur: d.cur || '—', req: d.req || '—', delta: '' }],
      comment: d.comment || '', src: d.src || '요청 사유', data: d
    };
  }

  /* ================= 카드 렌더 ============================================ */
  var card = null;         // 싱글턴 카드 요소
  var showDone = false;    // "처리됨" 접기 상태

  function avatar(name) {
    return F.avatar ? F.avatar(name, 30)
      : '<span class="ezib-ava">' + esc((name || '?').slice(-2)) + '</span>';
  }

  function rowHTML(it, idx) {
    var chip = '<span class="ezib-chip k-' + esc(it.kind) + '">' + esc(it.kindLabel) + '</span>';
    return '<div class="ezib-row" data-ezib-row="' + idx + '">'
      + avatar(it.reqName)
      + '<div class="ezib-who"><b>' + esc(it.reqName) + '</b><small>' + esc(it.reqTeam) + '</small></div>'
      + chip
      + '<div class="ezib-sum"><b>' + esc(it.title) + '</b><small>' + esc(it.summary) + '</small></div>'
      + '<span class="ezib-ago">' + esc(it.ago) + '</span>'
      + '<span class="ezib-chev">›</span></div>';
  }

  function doneRowHTML(it, idx) {
    var st = it.status === 'approved'
      ? '<span class="ezib-st ok">승인됨</span>'
      : '<span class="ezib-st no">반려됨</span>';
    return '<div class="ezib-row done" data-ezib-row="' + idx + '">'
      + avatar(it.reqName)
      + '<div class="ezib-who"><b>' + esc(it.reqName) + '</b><small>' + esc(it.reqTeam) + '</small></div>'
      + '<span class="ezib-chip k-' + esc(it.kind) + '">' + esc(it.kindLabel) + '</span>'
      + '<div class="ezib-sum"><b>' + esc(it.title) + '</b></div>' + st + '</div>';
  }

  function render() {
    if (!card) return;
    var items = collect();
    var pending = items.filter(function (it) { return !it.status; });
    var done = items.filter(function (it) { return !!it.status; });
    card.__items = items;

    var h = '<div class="ezib-head">'
      + '<b>승인 대기</b>'
      + (pending.length ? '<span class="ezib-badge">' + pending.length + '</span>' : '')
      + '<span class="ezib-note">승인 전에는 아무것도 반영되지 않음 · 결정은 조직장이 확정합니다</span>'
      + '</div>';

    var body = pending.length
      ? pending.map(function (it) { return rowHTML(it, items.indexOf(it)); }).join('')
      : '<div class="ezib-empty">대기 중인 승인 요청이 없습니다.</div>';

    var doneSec = '';
    if (done.length) {
      doneSec = '<button class="ezib-donetoggle" data-ezib="toggle-done">처리됨 ' + done.length + '건 '
        + (showDone ? '접기 ▴' : '보기 ▾') + '</button>'
        + (showDone ? done.map(function (it) { return doneRowHTML(it, items.indexOf(it)); }).join('') : '');
    }
    card.innerHTML = h + body + doneSec;
  }

  /* ================= 근거 드로어 (영수증) ================================= */
  function drKV(k, v) {
    return '<div class="ezib-dr"><span class="ezib-dk">' + k + '</span><span class="ezib-dv">' + v + '</span></div>';
  }
  function openDrawer(it) {
    if (!window.TX || !window.TX.drawer) return;
    var deltaRows = it.deltas.map(function (dl) {
      return '<div class="ezib-delta"><b>' + esc(dl.name) + '</b>'
        + '<span class="ezib-cur">' + esc(dl.cur) + '</span><span class="ezib-arrow">→</span>'
        + '<span class="ezib-req">' + esc(dl.req) + '</span>'
        + (dl.delta && dl.delta !== '0' ? '<span class="ezib-dchip">' + esc(dl.delta) + '</span>' : '')
        + '</div>';
    }).join('');
    var body = '<div class="ezib-rcpt">'
      + '<div class="ezib-rhead">요청 근거</div>'
      + drKV('요청자', esc(it.reqName) + (it.reqTeam ? ' · ' + esc(it.reqTeam) : ''))
      + drKV('유형', esc(it.kindLabel))
      + drKV('대상 목표', esc(it.title))
      + drKV('요청일', esc(it.at) + (it.ago ? ' (' + esc(it.ago) + ')' : ''))
      + '<div class="ezib-rsec">변경 사항 <small>현재값 → 요청값</small></div>' + deltaRows
      + '<div class="ezib-rsec">근거</div>'
      + '<div class="ezib-cmt">' + esc(it.comment || '요청 사유가 없습니다.') + '</div>'
      + '<div class="ezib-src">출처 · ' + esc(it.src) + '</div>'
      + '<div class="ezib-gate">결정 게이트 · 사람이 확정 — 승인 전에는 아무것도 반영되지 않음</div>'
      + '</div>'
      + (it.status ? '' :
        '<div class="ezib-acts">'
        + '<button class="ezib-btn no" data-ezib-act="reject">반려</button>'
        + '<button class="ezib-btn ok" data-ezib-act="approve">승인</button>'
        + '</div>');
    var dr = window.TX.drawer({ title: it.kindLabel, subtitle: esc(it.title), body: body, width: '460px' });
    dr.body.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-ezib-act]');
      if (!b) return;
      decide(it, b.getAttribute('data-ezib-act') === 'approve');
      dr.close();
    });
  }

  /* ================= 결정: 상태 갱신 + 감사 + 토스트 ======================= */
  function decide(it, approve) {
    var d = sget(it.key) || it.data || {};
    d.status = approve ? 'approved' : 'rejected';
    d.decided_at = TODAY;
    sset(it.key, d);
    // 감사 기록 — EZLedger(tx_ctx_ledger.js)가 ez:ctx 수신
    try {
      document.dispatchEvent(new CustomEvent('ez:ctx', { detail: {
        type: it.kind === 'checkin' ? 'checkin' : 'goal',
        source: approve ? 'inbox.approve' : 'inbox.reject',
        title: (approve ? '승인 · ' : '반려 · ') + it.kindLabel + ' — ' + it.title,
        summary: it.reqName + ' 요청 · ' + it.summary + ' · 조직장이 확정',
        weight: 2
      } }));
    } catch (e) { /* ignore */ }
    toast(approve
      ? '승인했습니다. 승인 내용이 기록되었습니다.'
      : '반려했습니다. 요청자에게 사유와 함께 전달됩니다.', approve ? 'ok' : '');
    render();
  }

  /* ================= 주입 + 이벤트 ======================================== */
  function pageEl() {
    var root = document.getElementById('s-wf');
    return root && root.querySelector('.wf-page[data-p="0"]');
  }
  function mount() {
    var pg = pageEl();
    if (!pg) return false;
    if (!card) {
      card = document.createElement('div');
      card.className = 'ezib-card';
      card.addEventListener('click', function (e) {
        var t = e.target.closest && e.target.closest('[data-ezib="toggle-done"]');
        if (t) { showDone = !showDone; render(); return; }
        var r = e.target.closest && e.target.closest('[data-ezib-row]');
        if (!r) return;
        var it = (card.__items || [])[parseInt(r.getAttribute('data-ezib-row'), 10)];
        if (it) openDrawer(it);
      });
      // tx_fix_wf가 innerHTML을 갈아엎으면 다시 맨 위로
      new MutationObserver(function () {
        if (card.parentNode !== pg) pg.insertBefore(card, pg.firstChild);
      }).observe(pg, { childList: true });
    }
    if (card.parentNode !== pg) pg.insertBefore(card, pg.firstChild);
    render();
    return true;
  }

  function injectStyle() {
    if (document.getElementById('ezib-style')) return;
    var css = ''
      + '.ezib-card{background:var(--card,#fff);border:1px solid rgba(35,64,142,.28);border-radius:12px;padding:14px 16px 10px;margin-bottom:16px}'
      + '.ezib-head{display:flex;align-items:center;gap:8px;padding-bottom:8px;border-bottom:1px solid var(--line-2,#EEF1F5)}'
      + '.ezib-head>b{font-size:15px;font-weight:800;color:#23408E;letter-spacing:-.02em}'
      + '.ezib-badge{min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:#1F7AF0;color:#fff;font-size:11.5px;font-weight:800;display:inline-flex;align-items:center;justify-content:center}'
      + '.ezib-note{margin-left:auto;font-size:11.5px;color:var(--ink-3,#7A8494)}'
      + '.ezib-row{display:flex;align-items:center;gap:11px;padding:11px 4px;border-bottom:1px solid var(--line-2,#EEF1F5);cursor:pointer}'
      + '.ezib-row:hover{background:var(--soft,#F6F8FB)}'
      + '.ezib-row.done{opacity:.75}'
      + '.ezib-who{min-width:110px}'
      + '.ezib-who b{display:block;font-size:13.5px;font-weight:700;color:var(--ink,#1B2430)}'
      + '.ezib-who small{display:block;font-size:11.5px;color:var(--ink-3,#7A8494)}'
      + '.ezib-chip{font-size:11px;font-weight:800;padding:3px 9px;border-radius:6px;white-space:nowrap}'
      + '.ezib-chip.k-checkin{background:rgba(31,122,240,.09);color:#1F7AF0}'
      + '.ezib-chip.k-goal{background:rgba(35,64,142,.09);color:#23408E}'
      + '.ezib-chip.k-weight{background:rgba(194,65,12,.09);color:#C2410C}'
      + '.ezib-sum{flex:1;min-width:0}'
      + '.ezib-sum b{display:block;font-size:13px;font-weight:600;color:var(--ink,#1B2430);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
      + '.ezib-sum small{display:block;font-size:11.5px;color:var(--ink-3,#7A8494)}'
      + '.ezib-ago{font-size:12px;font-weight:700;color:var(--ink-2,#4B5563);white-space:nowrap}'
      + '.ezib-chev{color:var(--ink-4,#A6AFBC);font-size:16px}'
      + '.ezib-st{font-size:11px;font-weight:800;padding:3px 9px;border-radius:6px;white-space:nowrap}'
      + '.ezib-st.ok{background:#E6F4EA;color:#137333}'
      + '.ezib-st.no{background:#FCE8E6;color:#C5221F}'
      + '.ezib-empty{padding:22px 4px;font-size:13px;color:var(--ink-3,#7A8494);text-align:center}'
      + '.ezib-donetoggle{display:block;width:100%;text-align:left;background:none;border:none;padding:10px 4px 6px;font-size:12.5px;font-weight:700;color:var(--ink-3,#7A8494);cursor:pointer}'
      + '.ezib-ava{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:#23408E;color:#fff;font-size:12px;font-weight:700;flex:none}'
      /* drawer 영수증 */
      + '.ezib-rcpt{border:1px solid rgba(35,64,142,.3);border-radius:11px;overflow:hidden;margin-bottom:14px}'
      + '.ezib-rhead{background:#23408E;color:#fff;font-size:13px;font-weight:800;padding:9px 14px;letter-spacing:-.01em}'
      + '.ezib-dr{display:flex;gap:12px;padding:9px 14px;border-bottom:1px solid var(--line-2,#EEF1F5)}'
      + '.ezib-dk{flex:0 0 76px;font-size:12.5px;font-weight:600;color:var(--ink-3,#7A8494)}'
      + '.ezib-dv{flex:1;font-size:13px;color:var(--ink,#1B2430);line-height:1.5}'
      + '.ezib-rsec{padding:11px 14px 5px;font-size:12px;font-weight:800;color:#23408E}'
      + '.ezib-rsec small{font-weight:500;color:var(--ink-3,#7A8494)}'
      + '.ezib-delta{display:flex;align-items:center;gap:8px;padding:7px 14px;font-size:13px}'
      + '.ezib-delta b{flex:1;font-weight:600;min-width:0}'
      + '.ezib-cur{color:var(--ink-3,#7A8494)}'
      + '.ezib-arrow{color:var(--ink-4,#A6AFBC)}'
      + '.ezib-req{font-weight:800;color:#1F7AF0}'
      + '.ezib-dchip{font-size:11px;font-weight:800;color:#1F7AF0;background:rgba(31,122,240,.09);border-radius:5px;padding:1px 6px}'
      + '.ezib-cmt{margin:2px 14px 8px;padding:9px 11px;background:var(--soft,#F6F8FB);border-radius:8px;font-size:12.5px;line-height:1.6;color:var(--ink-2,#4B5563)}'
      + '.ezib-src{padding:0 14px 10px;font-size:11.5px;color:var(--ink-3,#7A8494)}'
      + '.ezib-gate{margin:0 14px 12px;padding:7px 10px;border:1px dashed rgba(35,64,142,.4);border-radius:8px;font-size:11.5px;font-weight:700;color:#23408E}'
      + '.ezib-acts{display:flex;gap:9px;justify-content:flex-end}'
      + '.ezib-btn{font-size:13.5px;font-weight:700;padding:10px 22px;border-radius:9px;cursor:pointer;border:1px solid transparent}'
      + '.ezib-btn.ok{background:#1F7AF0;color:#fff}'
      + '.ezib-btn.ok:hover{background:#186AD6}'
      + '.ezib-btn.no{background:var(--card,#fff);color:#C5221F;border-color:rgba(197,34,31,.4)}';
    var st = document.createElement('style');
    st.id = 'ezib-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---- boot ---- */
  function init() {
    injectStyle();
    seed();
    if (mount()) return;
    var tries = 0;                     // #s-wf가 늦게 생기는 경우 폴링
    (function poll() {
      if (mount() || ++tries >= 10) return;
      setTimeout(poll, 300);
    })();
  }
  if (F.ready) F.ready(init);
  else if (document.readyState !== 'loading') setTimeout(init, 120);
  else document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 120); });
  if (F.onSection) F.onSection('s-wf', function () { mount(); });
})();
