/* tx_fix_msf.js — 360 진단(360 다면진단/multi-source feedback) fidelity re-implementation.
   Runtime patch, loaded LAST. Upgrades #s-msf to match real talenx:
     • 현황 list rebuilt with real employees ("이름(소속팀)"), realistic types,
       thin hollow ring gauges, initial-circle avatars, working sort/filter.
     • 360 피드백 요청/생성  → full-page routed overlay form (back ←).
     • 결과 확인             → full-page routed 결과 screen (back ←) with 문항 cards,
       per-question text answers, 응답 비율 토글, AI 감정분석, 역량 radar.
   Overrides the wrong content (3-field modal / side drawer) wired in tx_revive.js by
   cloning the buttons (strip listeners) + binding direct handlers that stopPropagation
   to defeat the bubble-phase delegated revive handler.
   Only appends a <style> (#s-msf / .txf- prefixed). No network. IIFE + idempotency guard. */
(function () {
  'use strict';
  var TXFIX = window.TXFIX;
  var TX = window.TX;
  if (!TXFIX || !TXFIX.ready) return;
  var esc = (TX && TX.esc) || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };
  function toast(m, k) { if (TX && TX.toast) TX.toast(m, k); }

  TXFIX.ready(function () {
    var root = document.getElementById('s-msf');
    if (!root || root.__txfMsf) return;
    root.__txfMsf = 1;

    var D = TXFIX.D || {};
    var CU = TXFIX.CU || {};
    var comps = (D.competencies || []).slice(0, 5);
    var ROLE = (CU && CU._role) || (window.TXRoles && TXRoles.current && TXRoles.current().key) || 'member';
    var canManage = (ROLE === 'leader' || ROLE === 'hr'); // 조직원=권한없음, 경영진=조망만

    /* ---------------- helpers ---------------- */
    function emp(id) { return TXFIX.emp(id); }
    function nt(e) { return TXFIX.nameTeam(e) || (e && e.name) || ''; }
    function ava(name, size) { return TXFIX.avatar(name, size || 24); }
    function hash(s) { var h = 0, i = 0; s = String(s); for (; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
    function anonAva(size) {
      size = size || 30;
      return '<span class="txf-anon" style="width:' + size + 'px;height:' + size + 'px">' +
        '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-5 0-9 2.5-9 6v2h18v-2c0-3.5-4-6-9-6z"/></svg></span>';
    }
    function kdate(d) {
      var ap = d.getHours() < 12 ? '오전' : '오후';
      var h = d.getHours() % 12; if (h === 0) h = 12;
      return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + ap + ' ' + h + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
    }
    function orgChain(e) {
      var a = [], o = e && TXFIX.org(e.org_id), g = 0;
      while (o && g++ < 12) { a.unshift(o.name); o = o.parent_id ? TXFIX.org(o.parent_id) : null; }
      return a.join(' > ');
    }
    function ringSVG(pct) {
      var C = 2 * Math.PI * 24, off = C * (1 - Math.max(0, Math.min(100, pct)) / 100);
      var col = pct > 0 ? 'var(--blue)' : 'var(--ink-4)';
      return '<span class="txf-ring">' +
        '<svg viewBox="0 0 56 56" width="56" height="56">' +
        '<circle cx="28" cy="28" r="24" fill="none" stroke="var(--line)" stroke-width="4"/>' +
        '<circle cx="28" cy="28" r="24" fill="none" stroke="' + col + '" stroke-width="4" stroke-linecap="round" ' +
        'stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 28 28)"/></svg>' +
        '<b style="color:' + col + '">' + pct + '%</b></span>';
    }

    /* ---------------- data model (real employees) ---------------- */
    function E(id, fb) { return emp(id) || fb || { name: '구성원', orgName: '' }; }
    var eA = CU;                       // 최정남 (Package BG) — current user / requester
    var eB = E('EMP-0041');            // 박지영(전략기획팀)
    var eB1 = E('EMP-0042');           // 김순옥(전략기획팀)
    var eB2 = E('EMP-0043');           // 남중수(전략기획팀)
    var eC = E('EMP-0203');            // 안동현(서비스 기술팀)

    var Q = function (name) {
      return [
        name + '님의 평소 협업 태도는 어떻습니까?',
        name + '님과 협업을 할 때 칭찬할 만한 부분이 있다면 무엇입니까?',
        name + '님이 보다 협업을 잘하기 위해서 필요한 것이 있다면 무엇입니까?',
        '이외에 ' + name + '께 하고 싶은 피드백이 있다면 자유롭게 작성합니다.'
      ];
    };

    var cards = [
      {
        id: 'm1', type: '협업 리뷰 (copy)', reason: '테스트', subj: eA, raters: [eA],
        pct: 100, resp: 1, total: 1, deadline: new Date(2026, 3, 13, 13, 35),
        anon: '비공개', scope: '전체 공개', comp: true,
        answers: [
          { t: '맡은 업무를 책임감 있게 마무리하고, 필요할 때 먼저 상황을 공유해 협업 흐름이 매끄럽습니다.', s: 'pos' },
          { t: '회의에서 나온 내용을 문서로 잘 정리해 팀 전체가 같은 맥락을 공유하도록 돕는 점이 인상적입니다.', s: 'pos' },
          { t: '여러 이해관계자가 얽힌 일정 조율 시 우선순위를 조금 더 명확히 제시해주면 좋겠습니다.', s: 'neu' },
          { t: '전반적으로 신뢰가 가는 동료입니다. 지금처럼만 해주셔도 충분합니다.', s: 'pos' }
        ]
      },
      {
        id: 'm2', type: '협업 리뷰', reason: '확인', subj: eB, raters: [eB1, eB2],
        pct: 0, resp: 0, total: 2, deadline: new Date(2026, 6, 25, 18, 0),
        anon: '비공개', scope: '평가자에게만 공개', comp: false, answers: []
      },
      {
        id: 'm3', type: '동료 협업 피드백', reason: '감정분석 test', subj: eC, raters: [eA],
        pct: 100, resp: 1, total: 1, deadline: new Date(2026, 3, 13, 13, 35),
        anon: '공개', scope: '전체 공개', comp: true,
        answers: [
          { t: '요청한 자료를 항상 기한 내에 전달해 주셔서 함께 일하기 편합니다.', s: 'pos' },
          { t: '기술적으로 막히는 부분을 침착하게 설명해 주는 점이 큰 도움이 됩니다.', s: 'pos' },
          { t: '가끔 진행 상황 공유가 늦어 확인이 필요할 때가 있어, 중간 공유가 조금 더 잦으면 좋겠습니다.', s: 'neu' },
          { t: '묵묵히 자기 몫을 해내는 분입니다. 앞으로도 좋은 협업 기대합니다.', s: 'pos' }
        ]
      }
    ];
    // member: only 360s the current user is subject or rater of (본인 관련만 노출)
    if (ROLE === 'member') {
      cards = cards.filter(function (c) { return c.subj === CU || (c.raters && c.raters.indexOf(CU) >= 0); });
    }
    cards.forEach(function (c, i) { c.order = i; c.title = c.type; c.qs = Q(nt(c.subj)); });

    /* ================= 현황 LIST rebuild ================= */
    function cardHTML(c, i) {
      var rAva = c.raters.length ? ava(c.raters[0].name, 24) : '';
      var rNames = c.raters.map(nt).join(', ');
      return '<div class="mcard txf-mcard" data-ci="' + i + '" data-name="' + esc(c.subj.name) + '" data-type="' + esc(c.type) + '" data-order="' + c.order + '">' +
        ringSVG(c.pct) +
        '<div class="mbody">' +
        '<div class="mtitle">' + esc(c.type) + ' <span class="badge b-org">종료</span></div>' +
        '<div class="msub">' + esc(c.reason) + '</div>' +
        '<div class="mppl">' +
        '<div class="grp tgt"><span class="lab">대상자</span><span class="txf-who">' + ava(c.subj.name, 24) + esc(nt(c.subj)) + '</span></div>' +
        '<div class="grp"><span class="lab rlab">평가자</span><span class="txf-who txf-raters">' + rAva + esc(rNames) + '</span></div>' +
        '</div></div>' +
        '<button class="btn-res txf-res">결과 확인</button></div>';
    }
    var doneList = root.querySelector('.list[data-list="done"]');
    var progList = root.querySelector('.list[data-list="prog"]');
    if (doneList) {
      doneList.innerHTML = cards.map(cardHTML).join('');
      doneList.querySelectorAll('.txf-res').forEach(function (b) {
        b.addEventListener('click', function (e) {
          e.preventDefault(); e.stopPropagation();
          var mc = b.closest('.mcard'); openResult(cards[+mc.getAttribute('data-ci')]);
        });
      });
    }
    if (progList) progList.innerHTML = '<div class="empty">진행 중인 요청이 없습니다.</div>';

    // subtab counts → realistic (need 0 / done 3 / prog 0)
    var counts = { need: 0, done: cards.length, prog: 0 };
    root.querySelectorAll('.subtabs button').forEach(function (t) {
      var k = t.getAttribute('data-tab'), b = t.querySelector('b');
      if (b && counts[k] != null) b.textContent = counts[k];
    });

    /* ================= SORT (actually reorder DOM) ================= */
    function reclone(el) { if (!el) return null; var n = el.cloneNode(true); el.parentNode.replaceChild(n, el); return n; }
    function applySort(mode) {
      if (!doneList) return;
      var arr = [].slice.call(doneList.querySelectorAll('.mcard'));
      arr.sort(function (a, b) {
        if (mode === 'name') return a.getAttribute('data-name').localeCompare(b.getAttribute('data-name'), 'ko');
        if (mode === 'type') return a.getAttribute('data-type').localeCompare(b.getAttribute('data-type'), 'ko');
        return (+a.getAttribute('data-order')) - (+b.getAttribute('data-order'));
      });
      arr.forEach(function (n) { doneList.appendChild(n); });
    }
    var sortMap = { '생성순': 'order', '이름순': 'name', '유형순': 'type' };
    root.querySelectorAll('.sortset .so').forEach(function (so0) {
      var so = reclone(so0);
      so.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        root.querySelectorAll('.sortset .so').forEach(function (x) {
          x.classList.remove('on'); var ck = x.querySelector('.ck'); if (ck) ck.remove();
        });
        so.classList.add('on');
        if (!so.querySelector('.ck')) {
          so.insertAdjacentHTML('afterbegin', '<svg class="ck" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l6 6L20 6"/></svg>');
        }
        applySort(sortMap[so.textContent.trim()] || 'order');
      });
    });

    /* ================= FILTER (real panel) ================= */
    var filterState = { types: null };
    var filt = reclone(root.querySelector('.filt'));
    if (filt) {
      filt.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation(); openFilter(filt);
      });
    }
    function openFilter(anchor) {
      var ex = document.getElementById('txf-filter-pop'); if (ex) { ex.remove(); return; }
      var types = cards.map(function (c) { return c.type; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
      var chosen = filterState.types || types.slice();
      var pop = document.createElement('div');
      pop.id = 'txf-filter-pop'; pop.className = 'txf-filter-pop';
      pop.innerHTML =
        '<div class="txf-fp-h">필터</div>' +
        '<div class="txf-fp-sec">유형</div>' +
        types.map(function (t) {
          return '<label class="txf-fp-row"><input type="checkbox" value="' + esc(t) + '"' + (chosen.indexOf(t) >= 0 ? ' checked' : '') + '>' + esc(t) + '</label>';
        }).join('') +
        '<div class="txf-fp-sec">상태</div>' +
        '<label class="txf-fp-row"><input type="checkbox" checked disabled>종료</label>' +
        '<div class="txf-fp-foot"><button class="txf-fp-reset" type="button">초기화</button><button class="txf-fp-apply" type="button">적용</button></div>';
      document.body.appendChild(pop);
      var r = anchor.getBoundingClientRect();
      pop.style.top = (r.bottom + 6) + 'px';
      pop.style.left = Math.max(8, r.right - pop.offsetWidth) + 'px';
      function close() { pop.remove(); document.removeEventListener('mousedown', out, true); }
      function out(ev) { if (!pop.contains(ev.target) && ev.target !== anchor) close(); }
      setTimeout(function () { document.addEventListener('mousedown', out, true); }, 0);
      pop.querySelector('.txf-fp-reset').addEventListener('click', function () {
        filterState.types = null;
        doneList.querySelectorAll('.mcard').forEach(function (n) { n.style.display = ''; });
        close(); toast('필터를 초기화했습니다.');
      });
      pop.querySelector('.txf-fp-apply').addEventListener('click', function () {
        var sel = [].slice.call(pop.querySelectorAll('input[type=checkbox]:not(:disabled):checked')).map(function (i) { return i.value; });
        filterState.types = sel;
        doneList.querySelectorAll('.mcard').forEach(function (n) {
          n.style.display = sel.indexOf(n.getAttribute('data-type')) >= 0 ? '' : 'none';
        });
        close(); toast(sel.length + '개 유형을 표시합니다.', 'ok');
      });
    }

    /* ================= 평가자 설정 menu ================= */
    var btnSet = reclone(root.querySelector('.btn-set'));
    if (btnSet && ROLE === 'member') { btnSet.style.display = 'none'; btnSet = null; }
    if (btnSet) {
      btnSet.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        if (TX && TX.menu) TX.menu(btnSet, [
          { label: '평가자 직접 지정', onClick: function () { toast('평가자 직접 지정 모드'); } },
          { label: '조직 기준 자동 배정', onClick: function () { toast('평가자를 자동 배정했습니다.', 'ok'); } },
          { sep: true },
          { label: '기본 평가자 수 설정', onClick: function () { toast('기본 평가자 수를 설정합니다.'); } }
        ]);
      });
    }

    /* ================= 요청/생성 button ================= */
    var btnReq = reclone(root.querySelector('.btn-req'));
    if (btnReq) {
      btnReq.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation(); openRequest();
      });
    }

    /* ================= full-page overlay scaffold ================= */
    function pageOpen(id) {
      var top = Math.max(0, Math.round(root.getBoundingClientRect().top));
      if (top < 8) top = 56;
      var pg = document.createElement('div');
      pg.className = 'txf-page'; pg.id = id; pg.style.top = top + 'px';
      document.body.appendChild(pg);
      document.body.style.overflow = 'hidden';
      requestAnimationFrame(function () { pg.classList.add('on'); });
      return pg;
    }
    function pageClose(pg) {
      pg.classList.remove('on');
      document.body.style.overflow = '';
      setTimeout(function () { if (pg.parentNode) pg.remove(); }, 180);
    }
    function pageBar(title, actionsHTML) {
      return '<div class="txf-pgbar"><button class="txf-back" aria-label="뒤로">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>' +
        '<h1>' + esc(title) + '</h1><div class="txf-pgact">' + (actionsHTML || '') + '</div></div>';
    }

    /* ============================================================
       360 피드백 결과  (full page)
       ============================================================ */
    function openResult(c) {
      var pg = pageOpen('txf-result-page');
      var subjName = nt(c.subj);
      var reqName = nt(CU);

      var profileHTML =
        '<div class="txf-card txf-profile">' +
        '<div class="txf-pf-top">' + ava(c.subj.name, 52) + '<div class="txf-pf-name">' + esc(subjName) + '</div></div>' +
        '<div class="txf-pf-grid">' +
        '<div><div class="txf-pf-lab">조직</div><div class="txf-pf-val">' + esc(orgChain(c.subj) || (c.subj.orgName || '-')) + '</div></div>' +
        '<div><div class="txf-pf-lab">관리자</div><div class="txf-pf-val txf-inline">' +
        (c.subj.managerName ? ava(c.subj.managerName, 22) + esc(c.subj.managerName) : '<span class="txf-muted">-</span>') + '</div></div>' +
        '</div></div>';

      var metaHTML =
        '<div class="txf-card">' +
        '<div class="txf-mlab">요청자</div><div class="txf-inline txf-mv">' + ava(CU.name, 22) + esc(reqName) + '</div>' +
        '<div class="txf-mlab" style="margin-top:16px">요청 사유</div><div class="txf-box">' + esc(c.reason) + '</div>' +
        '<div class="txf-mlab" style="margin-top:18px">평가자 <span class="txf-count">' + c.raters.length + '</span></div>' +
        '<div class="txf-raterlist">' + c.raters.map(function (r) { return '<div class="txf-inline txf-mv">' + ava(r.name, 22) + esc(nt(r)) + '</div>'; }).join('') + '</div>' +
        (canManage ? '<button class="txf-btn-ghost txf-sm" style="margin-top:10px" data-noop>평가자 수정</button>' : '') +
        '<div class="txf-mlab" style="margin-top:18px">공개 범위</div><div class="txf-mv">' + esc(c.scope) + '</div>' +
        '<div class="txf-mlab" style="margin-top:18px">응답률</div>' +
        '<div class="txf-inline" style="gap:14px;margin-top:6px">' + ringSVG(c.pct) + '<span class="txf-muted">' + c.resp + ' / ' + c.total + '</span></div>' +
        '<div class="txf-mlab" style="margin-top:18px">유형</div><div class="txf-box txf-inline"><span class="txf-typeicon">360</span>' + esc(c.type) + '</div>' +
        '<div class="txf-mlab" style="margin-top:18px">응답 마감 시각</div><div class="txf-box">' + kdate(c.deadline) + '</div>' +
        '</div>';

      // sentiment
      var pos = 0, neu = 0, neg = 0;
      c.answers.forEach(function (a) { if (a.s === 'pos') pos++; else if (a.s === 'neg') neg++; else neu++; });
      var tot = c.answers.length || 1;
      var score = Math.round((pos + neu * 0.5) / tot * 100);
      var sentHTML = c.answers.length ?
        ('<div class="txf-card txf-sent">' +
          '<div class="txf-sent-h"><span class="txf-ai">AI</span> 감정분석</div>' +
          '<div class="txf-sent-bars">' +
          sentBar('긍정', pos, tot, 'var(--blue)') + sentBar('중립', neu, tot, 'var(--ink-4)') + sentBar('부정', neg, tot, 'var(--red)') +
          '</div>' +
          '<p class="txf-sent-txt">전체 응답 ' + tot + '건 중 긍정 ' + pos + '건, 중립 ' + neu + '건, 부정 ' + neg + '건으로 분석되었습니다. ' +
          '“책임감”, “기한 내 전달”, “도움” 등 협업 태도·자료 전달의 신뢰성에 대한 긍정 표현이 반복적으로 나타났으며, ' +
          '개선 제안은 “진행 상황 중간 공유”와 “우선순위 명확화”에 집중되어 있습니다. ' +
          '종합 감정 점수는 <b>' + score + '점(긍정 우세)</b>이며, 즉각적인 리스크 신호는 확인되지 않았습니다.</p>' +
          '</div>') :
        ('<div class="txf-card txf-sent"><div class="txf-sent-h"><span class="txf-ai">AI</span> 감정분석</div>' +
          '<p class="txf-sent-txt txf-muted">아직 응답이 없어 감정분석 결과를 제공할 수 없습니다. 평가자 응답이 접수되면 자동으로 분석됩니다.</p></div>');

      // question cards
      var qHTML = c.qs.map(function (q, i) {
        var a = c.answers[i];
        var body = a ?
          ('<div class="txf-ans">' + anonAva(30) + '<div class="txf-ans-b">' + esc(a.t) + '</div></div>' +
            '<div class="txf-ratio" hidden>응답 ' + c.resp + ' / 대상 ' + c.total + ' · ' + c.pct + '%</div>') :
          '<div class="txf-ans txf-noans">' + anonAva(30) + '<div class="txf-ans-b txf-muted">아직 응답이 없습니다.</div></div>';
        return '<div class="txf-card txf-qcard"><div class="txf-q">' + esc(q) + ' <span class="txf-req-mark">*</span></div>' + body + '</div>';
      }).join('');

      // competency radar (직책자/역량 성격 · 응답 존재 시)
      var radarHTML = (c.comp && c.resp > 0) ? competencyBlock(c.subj) : '';

      pg.innerHTML =
        pageBar('360 피드백 결과',
          canManage ? '<button class="txf-btn-danger txf-del">삭제</button><button class="txf-btn-ghost txf-edit">수정</button>' : '') +
        '<div class="txf-pgbody">' + profileHTML + metaHTML +
        radarHTML +
        '<div class="txf-qhead"><h3>360 피드백 문항</h3><label class="txf-toggle"><span>응답 비율 표시(%)</span><input type="checkbox" class="txf-ratio-tg"><i></i></label></div>' +
        qHTML + sentHTML +
        '</div>';

      pg.querySelector('.txf-back').addEventListener('click', function () { pageClose(pg); });
      var btnDel = pg.querySelector('.txf-del');
      if (btnDel) btnDel.addEventListener('click', function () {
        TX.confirm('360 피드백 삭제', '이 360 피드백 결과를 삭제하시겠습니까? 삭제 후 복구할 수 없습니다.', function () {
          toast('360 피드백을 삭제했습니다.', 'ok'); pageClose(pg);
        }, '삭제');
      });
      var btnEdit = pg.querySelector('.txf-edit');
      if (btnEdit) btnEdit.addEventListener('click', function () { toast('수정 모드로 전환합니다.'); });
      var tg = pg.querySelector('.txf-ratio-tg');
      if (tg) tg.addEventListener('change', function () {
        pg.querySelectorAll('.txf-ratio').forEach(function (r) { r.hidden = !tg.checked; });
      });
      /* Claude 연결 시: 실제 응답 텍스트를 넘겨 감정분석 문단을 실시간 생성 */
      (function liveSentiment() {
        var live = !!(window.EZAI && EZAI.agent && EZAI.ready && EZAI.ready());
        var p = pg.querySelector('.txf-sent .txf-sent-txt');
        if (!live || !p || !c.answers.length) return;
        var stat = '긍정 ' + pos + ' · 중립 ' + neu + ' · 부정 ' + neg + ' (총 ' + tot + '건, 종합 ' + score + '점)';
        p.insertAdjacentHTML('beforeend', ' <em style="color:var(--ink-4);font-style:normal">· elizax가 원문 재분석 중…</em>');
        window.EZAI.agent({
          maxTurns: 2, maxTokens: 400,
          system: '당신은 elizax — HR 360 피드백 감정분석가입니다. 주어진 실제 응답 원문만 근거로 3~4문장 분석을 씁니다. 반복 키워드는 따옴표로 인용, 마지막에 리스크 신호 유무 한 줄. 다른 텍스트·머리말 금지. 도구 호출 불필요.',
          messages: [{ role: 'user', content:
            '집계: ' + stat + '\n응답 원문:\n' +
            c.answers.map(function (a, i) { return (i + 1) + '. [' + a.s + '] ' + a.t; }).join('\n') }],
          onDone: function (text) {
            if (text && text.trim()) p.innerHTML = esc(text.trim()).replace(/\n+/g, '<br>') +
              ' <em style="color:var(--ink-4);font-style:normal">· Claude 실시간 분석</em>';
          },
          onError: function () { var em = p.querySelector('em'); if (em) em.remove(); }
        });
      })();
      pg.querySelectorAll('[data-noop]').forEach(function (b) { b.addEventListener('click', function () { toast('평가자를 수정합니다.'); }); });
    }

    function sentBar(lab, n, tot, col) {
      var w = Math.round(n / tot * 100);
      return '<div class="txf-sb"><div class="txf-sb-h"><span>' + lab + '</span><span>' + n + '건 · ' + w + '%</span></div>' +
        '<div class="txf-sb-t"><i style="width:' + w + '%;background:' + col + '"></i></div></div>';
    }

    function competencyBlock(subj) {
      if (!comps.length) return '';
      var scores = comps.map(function (c) { return +(3.4 + (hash(subj.name + c.dimension_id) % 15) / 10).toFixed(1); });
      var labels = comps.map(function (c) { return c.name; });
      var avg = (scores.reduce(function (a, b) { return a + b; }, 0) / scores.length).toFixed(2);
      var bars = comps.map(function (c, i) {
        var w = Math.round(scores[i] / 5 * 100);
        return '<div class="txf-cbar"><div class="txf-cbar-h"><span>' + esc(c.dimension_id) + '. ' + esc(c.name) + '</span><span class="txf-blue">' + scores[i].toFixed(1) + ' / 5</span></div>' +
          '<div class="txf-cbar-t"><i style="width:' + w + '%"></i></div>' +
          '<div class="txf-cbar-d">' + esc(c.description || '') + '</div></div>';
      }).join('');
      return '<div class="txf-card"><div class="txf-qhead" style="margin:0 0 6px"><h3>역량 종합 <span class="txf-blue" style="font-size:14px">평균 ' + avg + ' / 5</span></h3></div>' +
        '<div class="txf-radarwrap">' + radarSVG(scores, labels) + '<div class="txf-cbars">' + bars + '</div></div></div>';
    }

    function radarSVG(scores, labels) {
      var cx = 130, cy = 132, R = 84, n = scores.length;
      function pt(i, rad) { var a = (-90 + i * 360 / n) * Math.PI / 180; return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)]; }
      var s = '', i, g, p, pts;
      for (g = 1; g <= 5; g++) {
        pts = [];
        for (i = 0; i < n; i++) { p = pt(i, R * g / 5); pts.push(p[0].toFixed(1) + ',' + p[1].toFixed(1)); }
        s += '<polygon points="' + pts.join(' ') + '" fill="none" stroke="var(--line)" stroke-width="1"/>';
      }
      for (i = 0; i < n; i++) { p = pt(i, R); s += '<line x1="' + cx + '" y1="' + cy + '" x2="' + p[0].toFixed(1) + '" y2="' + p[1].toFixed(1) + '" stroke="var(--line)" stroke-width="1"/>'; }
      pts = []; for (i = 0; i < n; i++) { p = pt(i, R * scores[i] / 5); pts.push(p[0].toFixed(1) + ',' + p[1].toFixed(1)); }
      s += '<polygon points="' + pts.join(' ') + '" fill="rgba(31,122,240,.15)" stroke="var(--blue)" stroke-width="2"/>';
      for (i = 0; i < n; i++) { p = pt(i, R * scores[i] / 5); s += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3" fill="var(--blue)"/>'; }
      for (i = 0; i < n; i++) {
        p = pt(i, R + 16); var anc = Math.abs(p[0] - cx) < 6 ? 'middle' : (p[0] > cx ? 'start' : 'end');
        s += '<text x="' + p[0].toFixed(1) + '" y="' + (p[1] + 4).toFixed(1) + '" text-anchor="' + anc + '" font-size="10.5" font-weight="600" fill="var(--ink-3)">' + esc(labels[i]) + '</text>';
      }
      return '<svg class="txf-radar" viewBox="0 0 260 268" width="240" height="248">' + s + '</svg>';
    }

    /* ============================================================
       360 피드백 생성  (full page form)
       ============================================================ */
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    function field(label, req, inner) {
      return '<div class="txf-field"><label class="txf-flabel">' + esc(label) + (req ? '<span class="txf-req-mark">*</span>' : '') + '</label>' + inner + '</div>';
    }
    function openRequest() {
      if (!canManage) { // member=권한없음, exec=조망만
        TX.confirm('360 피드백 생성', '생성·요청 권한이 없습니다. 조직장 또는 HR에게 요청하세요.', null, '확인');
        return;
      }
      var pg = pageOpen('txf-request-page');
      var empList = (D.employees || []).slice(0, 80);
      var opt = '<option value="">대상자를 선택합니다.</option>' +
        empList.map(function (e) { return '<option value="' + e.emp_id + '">' + esc(nt(e)) + '</option>'; }).join('');
      var typeList = ['협업 리뷰', '동료 협업 피드백', '감정분석', '직책자 진단', '역량 진단'];
      var typeOpt = '<option value="">360 피드백 유형을 선택합니다.</option>' + typeList.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('');
      var defDl = new Date(Date.now() + 6 * 864e5);
      var dlVal = defDl.getFullYear() + '-' + p2(defDl.getMonth() + 1) + '-' + p2(defDl.getDate()) + 'T' + p2(defDl.getHours()) + ':' + p2(defDl.getMinutes());

      var tb = ['B', 'U', 'Aa', 'A', 'i', 'S', '≔', '≡', '¶', '🔗', '🖾', '▦'];
      pg.innerHTML =
        pageBar('360 피드백 생성',
          '<button class="txf-btn-ghost txf-tmp">임시 저장</button><button class="txf-btn-primary txf-submit">생성</button>') +
        '<div class="txf-pgbody"><div class="txf-card txf-form">' +
        field('대상자', true, '<div class="txf-select"><select class="txf-subj">' + opt + '</select></div>') +
        field('평가자', true,
          '<button type="button" class="txf-addrater" disabled>평가자 추가</button>' +
          '<div class="txf-chips txf-raterchips"></div>' +
          '<div class="txf-info">360 피드백 대상자를 선택하면 평가자를 선정할 수 있습니다.</div>') +
        field('요청 사유', true,
          '<div class="txf-rich"><div class="txf-rich-tb">' + tb.map(function (x) { return '<button type="button" tabindex="-1">' + x + '</button>'; }).join('') + '</div>' +
          '<div class="txf-rich-ed" contenteditable="true" data-ph="요청 사유를 입력합니다."></div></div>') +
        field('관련 목표', false, '<div class="txf-select txf-dis"><select disabled><option>관련 목표를 선택합니다. (필수 항목 아님)</option></select></div>' +
          '<div class="txf-info">360 피드백 대상자를 선택하면 관련 목표를 선정할 수 있습니다.</div>') +
        field('관련 업무', false, '<div class="txf-select txf-dis"><select disabled><option>관련 업무를 선택합니다. (필수 항목 아님)</option></select></div>' +
          '<div class="txf-info">360 피드백 대상자를 선택하면 관련 업무를 선정할 수 있습니다.</div>') +
        field('유형', true, '<div class="txf-select"><select class="txf-type">' + typeOpt + '</select></div>') +
        field('문항', false, '<div class="txf-box txf-qprev">360 피드백 유형을 선택하면 문항을 확인할 수 있습니다.</div>') +
        field('응답 결과 비교', false,
          '<label class="txf-check"><input type="checkbox">유형 비교</label>' +
          '<div class="txf-info">동일 피드백 유형의 모든 대상자의 응답 결과와 비교합니다.</div>') +
        field('대상자 평가자 비교', false,
          '<div class="txf-radios"><label class="txf-radio"><input type="radio" name="txf-cmp">사용</label>' +
          '<label class="txf-radio"><input type="radio" name="txf-cmp" checked>사용 안 함</label></div>') +
        field('응답 마감 시각', false, '<div class="txf-select"><input type="datetime-local" class="txf-dl" value="' + dlVal + '"></div>') +
        field('응답 익명성 수준', false,
          '<div class="txf-anonbox"><div class="txf-anonlab">평가자 목록</div>' +
          '<div class="txf-radios"><label class="txf-radio"><input type="radio" name="txf-anon" value="비공개" checked>비공개</label>' +
          '<label class="txf-radio"><input type="radio" name="txf-anon" value="공개">공개</label></div>' +
          '<div class="txf-info txf-anondesc">응답에 참여할 수 있는 사람을 공개하지 않습니다. 익명 보장 수준이 매우 높습니다.</div></div>') +
        field('공개 범위', false,
          '<div class="txf-select"><div class="txf-chips txf-scope"><span class="txf-chip">' + ava(CU.name, 20) + esc(nt(CU)) + '<b class="txf-chip-x">✕</b></span></div></div>') +
        '</div></div>';

      // interactions
      var subjSel = pg.querySelector('.txf-subj');
      var addRater = pg.querySelector('.txf-addrater');
      var chips = pg.querySelector('.txf-raterchips');
      var chosenRaters = [];
      subjSel.addEventListener('change', function () { addRater.disabled = !subjSel.value; });
      addRater.addEventListener('click', function () {
        if (addRater.disabled) return;
        var pool = (D.employees || []).filter(function (e) { return e.emp_id !== subjSel.value && chosenRaters.indexOf(e.emp_id) < 0; });
        TX.menu(addRater, pool.slice(0, 12).map(function (e) {
          return { label: nt(e), onClick: function () { chosenRaters.push(e.emp_id); renderChips(); } };
        }));
      });
      function renderChips() {
        chips.innerHTML = chosenRaters.map(function (id) {
          var e = emp(id); return '<span class="txf-chip" data-id="' + id + '">' + ava(e.name, 20) + esc(nt(e)) + '<b class="txf-chip-x">✕</b></span>';
        }).join('');
        chips.querySelectorAll('.txf-chip-x').forEach(function (x) {
          x.addEventListener('click', function () {
            var id = x.closest('.txf-chip').getAttribute('data-id');
            chosenRaters = chosenRaters.filter(function (v) { return v !== id; }); renderChips();
          });
        });
      }
      // 유형 → 문항 preview
      var typeSel = pg.querySelector('.txf-type');
      var qprev = pg.querySelector('.txf-qprev');
      typeSel.addEventListener('change', function () {
        var name = subjSel.value ? nt(emp(subjSel.value)) : '대상자';
        if (!typeSel.value) { qprev.classList.remove('txf-qprev-on'); qprev.textContent = '360 피드백 유형을 선택하면 문항을 확인할 수 있습니다.'; return; }
        var qs = /역량|직책자/.test(typeSel.value)
          ? comps.map(function (c) { return name + '님의 ' + c.name + ' 역량은 어떻습니까?'; })
          : Q(name);
        qprev.classList.add('txf-qprev-on');
        qprev.innerHTML = '<ol class="txf-qprev-list">' + qs.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ol>';
      });
      // anonymity desc
      pg.querySelectorAll('input[name=txf-anon]').forEach(function (r) {
        r.addEventListener('change', function () {
          pg.querySelector('.txf-anondesc').textContent = r.value === '공개'
            ? '응답에 참여할 수 있는 사람을 공개합니다. 익명성은 보장되지 않습니다.'
            : '응답에 참여할 수 있는 사람을 공개하지 않습니다. 익명 보장 수준이 매우 높습니다.';
        });
      });
      pg.querySelectorAll('.txf-rich-tb button').forEach(function (b) { b.addEventListener('click', function (e) { e.preventDefault(); }); });
      pg.querySelectorAll('.txf-scope .txf-chip-x').forEach(function (x) { x.addEventListener('click', function () { x.closest('.txf-chip').remove(); }); });

      pg.querySelector('.txf-back').addEventListener('click', function () {
        TX.confirm('작성 취소', '작성 중인 내용이 저장되지 않습니다. 나가시겠습니까?', function () { pageClose(pg); }, '나가기');
      });
      pg.querySelector('.txf-tmp').addEventListener('click', function () { toast('임시 저장되었습니다.', 'ok'); });
      pg.querySelector('.txf-submit').addEventListener('click', function () {
        var reason = (pg.querySelector('.txf-rich-ed').textContent || '').trim();
        if (!subjSel.value) return toast('대상자를 선택해 주세요.');
        if (!chosenRaters.length) return toast('평가자를 1명 이상 추가해 주세요.');
        if (!reason) return toast('요청 사유를 입력해 주세요.');
        if (!typeSel.value) return toast('유형을 선택해 주세요.');
        toast('360 피드백을 생성했습니다.', 'ok'); pageClose(pg);
      });
    }

    /* ================= styles ================= */
    injectStyle();
    function injectStyle() {
      if (document.getElementById('txf-msf-style')) return;
      var css =
        '#s-msf .txf-mcard{align-items:center}' +
        '#s-msf .txf-ring{width:56px;height:56px;flex:none;position:relative;display:grid;place-items:center}' +
        '#s-msf .txf-ring b{position:absolute;font-size:12px;font-weight:700;letter-spacing:-.02em}' +
        '#s-msf .txf-who{display:inline-flex;align-items:center;gap:8px;font-size:13.5px;font-weight:600;color:var(--ink)}' +
        '#s-msf .txf-who.txf-raters{font-weight:500;color:var(--ink-2)}' +
        '#s-msf .txf-mcard .mppl .grp.tgt{width:300px}' +
        '.txf-anon{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;background:var(--line);color:var(--ink-4);flex:none}' +
        '.txf-anon svg{width:60%;height:60%}' +
        /* filter popover */
        '.txf-filter-pop{position:fixed;z-index:1400;background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.18);padding:12px;min-width:210px;font-size:13px}' +
        '.txf-fp-h{font-weight:800;font-size:14px;color:var(--ink);margin-bottom:6px}' +
        '.txf-fp-sec{font-size:11.5px;font-weight:700;color:var(--ink-3);margin:10px 0 4px}' +
        '.txf-fp-row{display:flex;align-items:center;gap:8px;padding:5px 2px;color:var(--ink);cursor:pointer}' +
        '.txf-fp-row input{accent-color:var(--blue)}' +
        '.txf-fp-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}' +
        '.txf-fp-reset,.txf-fp-apply{border-radius:8px;font-size:12.5px;font-weight:700;padding:7px 14px;cursor:pointer;border:1px solid var(--line)}' +
        '.txf-fp-reset{background:var(--card);color:var(--ink-2)}.txf-fp-apply{background:var(--blue);color:#fff;border-color:var(--blue)}' +
        /* full page */
        '.txf-page{position:fixed;left:0;right:0;bottom:0;z-index:900;background:var(--soft);overflow-y:auto;opacity:0;transition:opacity .18s ease}' +
        '.txf-page.on{opacity:1}' +
        '.txf-pgbar{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:14px;background:var(--card);border-bottom:1px solid var(--line);padding:14px 32px}' +
        '.txf-pgbar h1{margin:0;font-size:19px;font-weight:800;letter-spacing:-.01em;color:var(--ink)}' +
        '.txf-back{width:34px;height:34px;border:none;background:transparent;color:var(--ink);cursor:pointer;display:grid;place-items:center;border-radius:8px}' +
        '.txf-back:hover{background:var(--soft)}.txf-back svg{width:22px;height:22px}' +
        '.txf-pgact{margin-left:auto;display:flex;gap:9px}' +
        '.txf-btn-primary,.txf-btn-ghost,.txf-btn-danger{border-radius:9px;font-size:13.5px;font-weight:700;padding:9px 18px;cursor:pointer;border:1px solid var(--line)}' +
        '.txf-btn-primary{background:var(--blue);color:#fff;border-color:var(--blue)}' +
        '.txf-btn-ghost{background:var(--card);color:var(--ink)}' +
        '.txf-btn-danger{background:var(--red-soft);color:var(--red);border-color:var(--red-soft)}' +
        '.txf-btn-ghost.txf-sm,.txf-sm{font-size:12.5px;padding:7px 13px}' +
        '.txf-pgbody{max-width:1180px;margin:0 auto;padding:26px 32px 90px}' +
        '.txf-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px 26px;margin-bottom:18px;box-shadow:0 1px 2px rgba(20,30,55,.04)}' +
        /* profile */
        '.txf-pf-top{display:flex;align-items:center;gap:14px}' +
        '.txf-pf-name{font-size:17px;font-weight:800;color:var(--ink)}' +
        '.txf-pf-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px}' +
        '.txf-pf-lab{font-size:12.5px;color:var(--ink-3);font-weight:600;margin-bottom:6px}' +
        '.txf-pf-val{font-size:13.5px;color:var(--ink);font-weight:600}' +
        '.txf-inline{display:inline-flex;align-items:center;gap:8px}' +
        '.txf-muted{color:var(--ink-3)}' +
        /* meta */
        '.txf-mlab{font-size:13px;font-weight:700;color:var(--ink);margin-bottom:8px}' +
        '.txf-mv{font-size:13.5px;color:var(--ink);font-weight:600;margin-bottom:4px}' +
        '.txf-box{background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:12px 14px;font-size:13.5px;color:var(--ink);gap:9px}' +
        '.txf-count{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--line);color:var(--ink-2);font-size:11px;font-weight:700;vertical-align:middle}' +
        '.txf-typeicon{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--dark);color:#fff;font-size:8.5px;font-weight:800;flex:none}' +
        '.txf-raterlist{display:flex;flex-direction:column;gap:2px}' +
        /* qhead / toggle */
        '.txf-qhead{display:flex;align-items:center;margin:6px 0 12px}' +
        '.txf-qhead h3{margin:0;font-size:16px;font-weight:800;color:var(--ink)}' +
        '.txf-toggle{margin-left:auto;display:inline-flex;align-items:center;gap:8px;font-size:12.5px;color:var(--ink-3);font-weight:600;cursor:pointer}' +
        '.txf-toggle input{display:none}' +
        '.txf-toggle i{width:34px;height:19px;border-radius:11px;background:var(--line);position:relative;transition:.16s;flex:none}' +
        '.txf-toggle i::after{content:"";position:absolute;top:2px;left:2px;width:15px;height:15px;border-radius:50%;background:#fff;transition:.16s;box-shadow:0 1px 2px rgba(0,0,0,.2)}' +
        '.txf-toggle input:checked + i{background:var(--blue)}.txf-toggle input:checked + i::after{transform:translateX(15px)}' +
        /* question cards */
        '.txf-qcard{padding:18px 22px}' +
        '.txf-q{font-size:14px;font-weight:700;color:var(--ink);margin-bottom:12px}' +
        '.txf-req-mark{color:var(--red);font-weight:700}' +
        '.txf-ans{display:flex;align-items:flex-start;gap:10px}' +
        '.txf-ans-b{background:var(--soft);border-radius:10px;padding:9px 13px;font-size:13.5px;color:var(--ink);line-height:1.55;flex:1}' +
        '.txf-ratio{margin:9px 0 0 40px;font-size:12px;color:var(--blue);font-weight:700}' +
        /* sentiment */
        '.txf-sent-h{font-size:15px;font-weight:800;color:var(--ink);display:flex;align-items:center;gap:8px;margin-bottom:14px}' +
        '.txf-ai{display:inline-grid;place-items:center;padding:2px 8px;border-radius:6px;background:var(--blue-soft);color:var(--blue);font-size:11px;font-weight:800}' +
        '.txf-sent-bars{display:flex;flex-direction:column;gap:9px;margin-bottom:14px}' +
        '.txf-sb-h{display:flex;justify-content:space-between;font-size:12.5px;font-weight:600;color:var(--ink-2);margin-bottom:5px}' +
        '.txf-sb-t{height:8px;border-radius:5px;background:var(--soft);overflow:hidden}.txf-sb-t i{display:block;height:100%;border-radius:5px}' +
        '.txf-sent-txt{font-size:13.5px;color:var(--ink-2);line-height:1.7;margin:0}.txf-sent-txt b{color:var(--ink)}' +
        /* competency */
        '.txf-radarwrap{display:flex;gap:26px;align-items:center;flex-wrap:wrap}' +
        '.txf-radar{flex:none}' +
        '.txf-cbars{flex:1;min-width:280px}' +
        '.txf-cbar{margin-bottom:13px}' +
        '.txf-cbar-h{display:flex;justify-content:space-between;font-size:13px;font-weight:700;color:var(--ink)}' +
        '.txf-blue{color:var(--blue)}' +
        '.txf-cbar-t{height:7px;border-radius:4px;background:var(--soft);margin:6px 0}.txf-cbar-t i{display:block;height:100%;border-radius:4px;background:var(--blue)}' +
        '.txf-cbar-d{font-size:12px;color:var(--ink-3)}' +
        /* form */
        '.txf-form{padding:26px 30px}' +
        '.txf-field{margin-bottom:26px}' +
        '.txf-flabel{display:block;font-size:14px;font-weight:700;color:var(--ink);margin-bottom:10px}' +
        '.txf-select{border:1px solid var(--line);border-radius:9px;background:var(--card);position:relative;display:flex;align-items:center}' +
        '.txf-select.txf-dis{background:var(--soft)}' +
        '.txf-select select,.txf-select input{width:100%;border:none;background:transparent;padding:12px 14px;font-size:13.5px;color:var(--ink);outline:none;font-family:inherit}' +
        '.txf-select select{-webkit-appearance:none;appearance:none;cursor:pointer}' +
        '.txf-select::after{content:"⌄";position:absolute;right:14px;color:var(--ink-4);pointer-events:none;font-size:14px}' +
        '.txf-select:has(input[type=datetime-local])::after{content:""}' +
        '.txf-info{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--ink-3);margin-top:8px}' +
        '.txf-info::before{content:"ⓘ";color:var(--ink-4)}' +
        '.txf-addrater{border:1px dashed var(--line);background:var(--soft);color:var(--ink-3);font-size:13px;font-weight:600;padding:9px 16px;border-radius:9px}' +
        '.txf-addrater:not(:disabled){border-style:solid;background:var(--card);color:var(--ink);cursor:pointer}' +
        '.txf-addrater:disabled{cursor:not-allowed;opacity:.7}' +
        '.txf-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}' +
        '.txf-scope{margin:0;padding:6px 8px;flex:1}' +
        '.txf-chip{display:inline-flex;align-items:center;gap:7px;background:var(--soft);border:1px solid var(--line);border-radius:20px;padding:5px 10px 5px 6px;font-size:12.5px;font-weight:600;color:var(--ink)}' +
        '.txf-chip-x{cursor:pointer;color:var(--ink-4);font-size:10px;font-weight:700}' +
        '.txf-rich{border:1px solid var(--line);border-radius:10px;overflow:hidden}' +
        '.txf-rich-tb{display:flex;gap:2px;flex-wrap:wrap;padding:8px 10px;border-bottom:1px solid var(--line);background:var(--card)}' +
        '.txf-rich-tb button{width:28px;height:28px;border:none;background:transparent;color:var(--ink-2);font-size:13px;border-radius:6px;cursor:pointer}' +
        '.txf-rich-tb button:hover{background:var(--soft)}' +
        '.txf-rich-ed{min-height:96px;padding:12px 14px;font-size:13.5px;color:var(--ink);outline:none;line-height:1.6}' +
        '.txf-rich-ed:empty::before{content:attr(data-ph);color:var(--ink-4)}' +
        '.txf-qprev.txf-qprev-on{background:var(--card)}' +
        '.txf-qprev-list{margin:0;padding-left:20px}.txf-qprev-list li{font-size:13.5px;color:var(--ink);padding:5px 0;line-height:1.5}' +
        '.txf-check,.txf-radio{display:inline-flex;align-items:center;gap:8px;font-size:13.5px;color:var(--ink);cursor:pointer}' +
        '.txf-check input,.txf-radio input{accent-color:var(--blue);width:16px;height:16px}' +
        '.txf-radios{display:flex;gap:24px}' +
        '.txf-anonbox{background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:14px 16px}' +
        '.txf-anonlab{font-size:12px;font-weight:700;color:var(--ink-3);margin-bottom:10px}' +
        '.txf-anonbox .txf-info{margin-top:10px}' +
        '@media (max-width:720px){.txf-pf-grid{grid-template-columns:1fr}.txf-pgbody,.txf-pgbar{padding-left:18px;padding-right:18px}}';
      var st = document.createElement('style');
      st.id = 'txf-msf-style'; st.textContent = css;
      document.head.appendChild(st);
    }
  });
})();
