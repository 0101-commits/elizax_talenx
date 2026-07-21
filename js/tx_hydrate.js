/* =====================================================================
 * tx_hydrate.js — talenx 목업 정적 콘텐츠 → 실데이터(window.TALENX_DATA) 하이드레이션
 * 레이아웃/디자인/CSS 클래스는 절대 변경하지 않음. 텍스트/숫자/행 내용만 교체.
 * index.html 수정 없음. talenx_data.js 및 각 화면 인라인 IIFE 이후에 로드될 것.
 * 로그인 사용자 = meta.currentUser (EMP-0078 최정남).
 * ===================================================================== */
(function () {
  'use strict';

  var AVA_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-5 0-9 2.5-9 6v2h18v-2c0-3.5-4-6-9-6z"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function qa(root, sel) { return root ? Array.prototype.slice.call(root.querySelectorAll(sel)) : []; }
  function q(root, sel) { return root ? root.querySelector(sel) : null; }
  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function clamp(n) { return Math.max(0, Math.min(100, Math.round(n))); }
  function dot(ds) { return String(ds || '').replace(/-/g, '.'); }
  function empNoOf(id) { var m = String(id || '').match(/(\d+)\s*$/); return m ? m[1] : '0000'; }

  function fmtK(ds) {
    if (!ds) return '';
    var p = String(ds).split('-');
    if (p.length < 3) return String(ds);
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    var w = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
    return (+p[1]) + '월 ' + (+p[2]) + '일 ' + w + '요일';
  }
  function niceCeil(v) {
    if (v <= 5) return 5;
    var step = Math.pow(10, Math.floor(Math.log10(v)));
    return Math.ceil(v / step) * step;
  }

  var done = false;

  function run() {
    var D = window.TALENX_DATA;
    if (!D) return;

    /* ---- lookups ---- */
    var CU = (D.meta && D.meta.currentUser) || {};
    var empById = {}, orgById = {}, objById = {}, krById = {}, evalByEmp = {};
    var krsByObj = {};
    (D.employees || []).forEach(function (e) { empById[e.emp_id] = e; });
    if (CU.emp_id && !empById[CU.emp_id]) empById[CU.emp_id] = CU;
    (D.orgs || []).forEach(function (o) { orgById[o.org_id] = o; });
    (D.objectives || []).forEach(function (o) { objById[o.objective_id] = o; });
    (D.keyResults || []).forEach(function (k) {
      krById[k.kr_id] = k;
      (krsByObj[k.objective_id] = krsByObj[k.objective_id] || []).push(k);
    });
    (D.evaluations || []).forEach(function (v) { evalByEmp[v.emp_id] = v; });

    function empName(id) { var e = empById[id]; return e ? e.name : ''; }
    function orgPath(orgId) {
      var out = [], o = orgById[orgId], g = 0;
      while (o && g++ < 20) { out.unshift(o.name); o = o.parent_id ? orgById[o.parent_id] : null; }
      return out;
    }
    function ancestorAtLevel(orgId, lvl) {
      var o = orgById[orgId], g = 0;
      while (o && o.parent_id && (o.level || 99) > lvl && g++ < 20) o = orgById[o.parent_id];
      return o;
    }

    /* difficulty → 중요도 badge (S/A → 중, 그 외 → 하) */
    function impBadge(obj) {
      var krs = krsByObj[obj.objective_id] || [];
      var order = { S: 4, A: 3, B: 2, C: 1, D: 0 }, hardest = 0;
      krs.forEach(function (k) { var v = order[k.difficulty] || 0; if (v > hardest) hardest = v; });
      return hardest >= 3
        ? '<span class="badge b-mid">중요도 중</span>'
        : '<span class="badge b-low">중요도 하</span>';
    }
    function repWeight(obj) {
      var krs = krsByObj[obj.objective_id] || [], max = 0;
      krs.forEach(function (k) { var n = num(k.weight); if (n > max) max = n; });
      return max ? Math.round(max) + '%' : '';
    }

    /* 로그인 사용자와 연관된 목표 캐스케이드(팀→사업부→전사) */
    function myObjectives() {
      var res = [], seen = {};
      function add(ob) { if (ob && !seen[ob.objective_id]) { seen[ob.objective_id] = 1; res.push(ob); } }
      (D.objectives || []).filter(function (o) { return o.owner_emp_id === CU.emp_id; }).forEach(add);
      (D.objectives || []).filter(function (o) { return o.org_id === CU.org_id; }).forEach(function (ob) {
        add(ob);
        var p = ob.parent_objective_id, g = 0;
        while (p && g++ < 10) { var po = objById[p]; if (!po) break; add(po); p = po.parent_objective_id; }
      });
      if (!res.length) {
        var chain = orgPath(CU.org_id); // names, but need ids -> collect ancestor ids
        var ids = {}, o = orgById[CU.org_id], g = 0;
        while (o && g++ < 20) { ids[o.org_id] = 1; o = o.parent_id ? orgById[o.parent_id] : null; }
        (D.objectives || []).filter(function (ob) { return ids[ob.org_id]; }).forEach(add);
      }
      return res;
    }

    var section = function (el, fn) {
      if (!el || el.getAttribute('data-txh') === '1') return;
      try { fn(); el.setAttribute('data-txh', '1'); } catch (e) { /* keep other sections alive */ }
    };

    var homeRoot = document.getElementById('s-home');
    var perfRoot = document.getElementById('s-perf');
    var apprRoot = document.getElementById('s-appr');
    var hrmRoot = document.getElementById('s-hrm');

    function cardByTitle(root, prefix, notPrefix) {
      var cards = qa(root, '.card');
      for (var i = 0; i < cards.length; i++) {
        var h = q(cards[i], '.ct h3');
        if (!h) continue;
        var t = (h.textContent || '').replace(/›|⌄|⌃/g, '').trim();
        if (t.indexOf(prefix) === 0 && (!notPrefix || t.indexOf(notPrefix) !== 0)) return cards[i];
      }
      return null;
    }

    /* ===================================================================
     * 1) GNB / 내 정보(인사관리 프로필) → currentUser
     * =================================================================== */
    section(document.querySelector('.gnb .gnb-right .ava'), function () {
      var a = document.querySelector('.gnb .gnb-right .ava');
      a.setAttribute('title', CU.name + ' · ' + (CU.jobTitle || '') + ' · ' + (CU.orgName || ''));
    });

    section(q(hrmRoot, '.prof'), function () {
      var prof = q(hrmRoot, '.prof');
      var pn = q(prof, '.pname'); if (pn) pn.textContent = CU.name;
      var pnum = q(prof, '.pnum'); if (pnum) pnum.textContent = empNoOf(CU.emp_id);
      qa(prof, '.pmeta .pm').forEach(function (pm) {
        var k = q(pm, '.pk'), v = q(pm, '.pv'); if (!k || !v) return;
        var key = (k.textContent || '').trim();
        if (key.indexOf('직급') === 0) v.textContent = (CU.level_kr || '') + '/' + (CU.is_leader ? '팀장' : '팀원');
        else if (key.indexOf('입사일') === 0) v.textContent = dot(CU.join_date);
        else if (key.indexOf('관리자') === 0) v.textContent = CU.managerName || '-';
      });
      var porg = q(prof, '.porg');
      if (porg) { var path = orgPath(CU.org_id); porg.textContent = (path.length ? path : [CU.orgName]).join(' > '); }
    });

    /* 인사정보 KV rows (사용자 정보 subpage) */
    section(q(hrmRoot, '.subpage[data-p="0"] .htab-content'), function () {
      var scope = q(hrmRoot, '.subpage[data-p="0"] .htab-content');
      var email = String(CU.emp_id || '').toLowerCase().replace(/[^a-z0-9]/g, '') + '@hcg.co.kr';
      qa(scope, '.kv').forEach(function (kv) {
        var k = q(kv, '.kvk'), v = q(kv, '.kvv'); if (!k || !v) return;
        var key = (k.textContent || '').trim();
        switch (key) {
          case '사번': v.textContent = empNoOf(CU.emp_id); break;
          case '입사일':
          case '그룹 입사일':
          case '계약 시작일': v.textContent = dot(CU.join_date); break;
          case '회사이메일': v.textContent = email; break;
          case '근무위치': v.textContent = '서울'; break;
          case '채용 구분': v.textContent = '경력'; break;
          case '회사': v.textContent = (D.company && D.company.name) || '올인원컴퍼니'; break;
          case '조직': v.innerHTML = esc(CU.orgName) + ' <span class="vf">✓</span>'; break;
          case '직책': v.textContent = CU.is_leader ? '팀장' : '팀원'; break;
          case '직급': v.textContent = CU.level_kr || '-'; break;
          case '직위': v.textContent = CU.jobTitle || '-'; break;
          case '재직 상태': v.textContent = '재직'; break;
        }
      });
    });

    /* ===================================================================
     * 2) 홈 대시보드 · 나의 목표
     * =================================================================== */
    var myObjs = myObjectives();
    var avgProg = myObjs.length ? clamp(myObjs.reduce(function (s, o) { return s + num(o.progress); }, 0) / myObjs.length) : 0;

    function homeGoalRow(obj) {
      var p = clamp(obj.progress);
      return '<div class="goal"><div class="g1">' +
        '<span class="gname">' + esc(obj.title) + ' ' + impBadge(obj) + '</span>' +
        '<span class="gw">' + repWeight(obj) + '</span>' +
        '<span class="gs"><span class="chip-prog">진행중</span></span>' +
        '<span class="gbarwrap"><span class="gbar"><i style="width:' + p + '%"></i></span></span>' +
        '<span class="gp">' + p + '%</span></div>' +
        '<div class="g2"><span class="badge b-org">조직</span></div></div>';
    }

    section(cardByTitle(homeRoot, '나의 목표'), function () {
      var card = cardByTitle(homeRoot, '나의 목표');
      var body = q(card, '.body');
      qa(body, '.goal').forEach(function (g) { g.remove(); });
      body.insertAdjacentHTML('beforeend', myObjs.map(homeGoalRow).join(''));
      var head = q(body, '.goalhead .a');
      if (head) {
        var bar = q(head, '.gbar > i'); if (bar) bar.style.width = avgProg + '%';
        var b = head.querySelector('b'); if (b) b.textContent = avgProg + '%';
      }
      var ck = qa(card, '.ct .r .ck');
      if (ck[0]) { var b0 = ck[0].querySelector('b'); if (b0) b0.textContent = myObjs.length; }
      if (ck[1]) ck[1].textContent = '· 조직 ' + myObjs.length;
      if (ck[2]) ck[2].textContent = '· 개인 0';
    });

    /* ===================================================================
     * 3) 홈 · 360 요약 / 피드백 / 최근 활동 / 처리할 문서
     * =================================================================== */
    var cuDemo = (D.demoSubjects || []).filter(function (d) { return d.emp_id === CU.emp_id; })[0];

    section(cardByTitle(homeRoot, '360 피드백'), function () {
      var card = cardByTitle(homeRoot, '360 피드백');
      var ck = qa(card, '.ct .r .ck');
      if (ck[0]) { var b = ck[0].querySelector('b'); if (b) b.textContent = 2; }
      if (ck[1]) ck[1].textContent = '· 결과 확인 8';
      if (ck[2]) ck[2].textContent = '· 생성중 3';
    });

    /* 홈 피드백 (360 아님) : 최정남이 받은 피어리뷰 요약 */
    section(cardByTitle(homeRoot, '피드백', '360'), function () {
      var card = cardByTitle(homeRoot, '피드백', '360');
      var body = q(card, '.body'); if (!body) return;
      var items = [];
      ((cuDemo && cuDemo.peerReviews) || []).forEach(function (r) {
        var sender = empName(r.reviewer_id) || '동료';
        var cs = r.strength_comments || {};
        Object.keys(cs).forEach(function (d) { items.push({ from: sender, date: r.review_date }); });
      });
      if (!items.length) items = [{ from: CU.managerName, date: '2026-04-24' }];
      items = items.slice(0, 3);
      body.innerHTML = items.map(function (it) {
        return '<div class="frow"><div class="tx">' + esc(CU.name) +
          '님이 피드백을 받았습니다.<small>보낸 사람 ' + esc(it.from) + '</small></div>' +
          '<div class="dt">' + fmtK(it.date) + '</div></div>';
      }).join('');
    });

    /* 홈 최근 활동 : 우리 팀 체크인 최신순 */
    section(cardByTitle(homeRoot, '최근 활동'), function () {
      var card = cardByTitle(homeRoot, '최근 활동');
      var body = q(card, '.body'); if (!body) return;
      var teamIds = {};
      (D.employees || []).filter(function (e) { return e.org_id === CU.org_id; }).forEach(function (e) { teamIds[e.emp_id] = 1; });
      teamIds[CU.emp_id] = 1;
      var ck = (D.checkins || []).filter(function (c) { return teamIds[c.emp_id] && c.comment; });
      ck.sort(function (a, b) { return String(b.checkin_date).localeCompare(String(a.checkin_date)); });
      var rows = ck.slice(0, 10).map(function (c) {
        var nm = empName(c.emp_id) || CU.name;
        var t = (krById[c.kr_id] || {}).name || (objById[c.objective_id] || {}).title || '목표';
        return '<div class="frow"><div class="tx">' + esc(nm) + '님이 ‘' + esc(t) +
          '’ 목표를 체크인했습니다.</div><div class="dt">' + fmtK(c.checkin_date) + '</div></div>';
      });
      if (rows.length) body.innerHTML = rows.join('');
    });

    /* 홈 처리할 문서 : 팀원 신청 문서 */
    section(cardByTitle(homeRoot, '처리할 문서'), function () {
      var card = cardByTitle(homeRoot, '처리할 문서');
      var body = q(card, '.body'); if (!body) return;
      var team = (D.employees || []).filter(function (e) { return e.org_id === CU.org_id && e.emp_id !== CU.emp_id; });
      var docs = [
        { t: '근무계획 수립 신청', d: '2026년 7월 13일 월요일 오후 6:57', tag: '근무' },
        { t: '연차 휴가 신청', d: '2026년 7월 10일 금요일 오후 2:18', tag: '휴가' },
        { t: '지출결의서 제출', d: '2026년 7월 8일 수요일 오전 11:04', tag: '기타' }
      ];
      var html = docs.map(function (dc, i) {
        var nm = (team[i] || team[0] || CU).name;
        return '<div class="frow"><div class="tx" style="color:var(--ink-2)">' + esc(nm) + '님이 ' + esc(dc.t) +
          '<small>' + esc(dc.d) + '</small></div><div class="tag-r">' + esc(dc.tag) + '</div></div>';
      }).join('');
      body.innerHTML = html;
    });

    /* ===================================================================
     * 4) 성과관리 · 목표 현황 (나의 목표 mycard + 조직 카드)
     * =================================================================== */
    function mgRow(obj) {
      var p = clamp(obj.progress);
      return '<div class="mg"><div class="nm">' +
        '<div class="t1">' + esc(obj.title) + ' ' + impBadge(obj) + '</div>' +
        '<div class="t2"><span class="badge b-org">조직</span></div></div>' +
        '<span class="w">' + repWeight(obj) + '</span>' +
        '<span class="s"><span class="chip-prog">진행중</span></span>' +
        '<span class="bw"><span class="membar"><i style="width:' + p + '%"></i></span></span>' +
        '<span class="p">' + p + '%</span></div>';
    }
    section(q(perfRoot, '.mycard'), function () {
      var mc = q(perfRoot, '.mycard');
      qa(mc, '.mg').forEach(function (m) { m.remove(); });
      var sub = q(mc, '.mysub');
      sub.insertAdjacentHTML('afterend', myObjs.map(mgRow).join(''));
      qa(mc, '.mt .r b').forEach(function (b, i) { b.textContent = (i === 2 ? 0 : myObjs.length); });
      var sbar = q(sub, '.sumbar > i'); if (sbar) sbar.style.width = avgProg + '%';
      var pct = q(sub, '.pct'); if (pct) pct.textContent = avgProg + '%';
    });

    /* 조직 카드: 제목 → 실제 조직, 구성원 이름 → 실제 사원, 진행률 = 평가점수 기반 */
    section(perfRoot && qa(perfRoot, '.orgcard').length ? perfRoot : null, function () {
      var orgcards = qa(perfRoot, '.orgcard');
      var orgsWithHc = (D.orgs || []).filter(function (o) { return o.headcount > 0; })
        .sort(function (a, b) { return b.headcount - a.headcount; });
      // 최정남 소속/상위 조직을 우선 노출
      var priority = [];
      var o = orgById[CU.org_id], g = 0;
      while (o && g++ < 20) { priority.push(o); o = o.parent_id ? orgById[o.parent_id] : null; }
      var ordered = priority.concat(orgsWithHc.filter(function (x) { return priority.indexOf(x) < 0; }));
      var empPool = (D.employees || []).slice();
      var poolIdx = 0;
      orgcards.forEach(function (card, ci) {
        var org = ordered[ci] || ordered[0];
        var h3 = q(card, 'h3'); if (h3 && org) h3.textContent = org.name + '의 목표';
        // 구성원 이름/진행률 치환 (accordion 리스너 보존 위해 텍스트만 수정)
        qa(card, '.mem').forEach(function (mem) {
          var e = empPool[poolIdx++ % empPool.length];
          var nme = q(mem, '.nme'); if (nme && e) nme.textContent = e.name + (e.is_leader ? '' : '');
          var ev = e && evalByEmp[e.emp_id];
          var pr = ev ? clamp(ev.weighted_score) : 0;
          var bar = q(mem, '.membar > i'); if (bar) bar.style.width = pr + '%';
          var pp = q(mem, '.p'); if (pp) pp.textContent = pr + '%';
        });
        // 열린 조직 목표 박스(gbox)에 실제 KR 반영
        qa(card, '.gbox').forEach(function (gb) {
          var krs = (krsByObj[(D.objectives || []).filter(function (ob) { return ob.org_id === (org && org.org_id); })[0] &&
            (D.objectives || []).filter(function (ob) { return ob.org_id === (org && org.org_id); })[0].objective_id] || '') || [];
          if (!krs.length) return;
          var rows = '<div class="grow hd"><span class="gn">목표명</span><span class="gw">가중치</span><span class="gbwrap"></span><span class="gp">진행률</span></div>';
          rows += krs.map(function (k) {
            var p = clamp(k.progress);
            return '<div class="grow"><span class="gn">' + esc(k.name) + '</span>' +
              '<span class="gw">' + esc(k.weight) + '</span>' +
              '<span class="gbwrap"><span class="membar"><i style="width:' + p + '%"></i></span></span>' +
              '<span class="gp">' + p + '%</span></div>';
          }).join('');
          gb.innerHTML = rows;
        });
        // "불러오는 중" 상태 카드 → 조직 목표 요약으로 대체
        var empty = q(card, '.empty');
        if (empty && org) {
          var ob = (D.objectives || []).filter(function (x) { return x.org_id === org.org_id; })[0];
          var krs = ob ? (krsByObj[ob.objective_id] || []) : [];
          if (krs.length) {
            var box = '<div class="gbox">' +
              '<div class="grow hd"><span class="gn">목표명</span><span class="gw">가중치</span><span class="gbwrap"></span><span class="gp">진행률</span></div>' +
              krs.map(function (k) {
                var p = clamp(k.progress);
                return '<div class="grow"><span class="gn">' + esc(k.name) + '</span>' +
                  '<span class="gw">' + esc(k.weight) + '</span>' +
                  '<span class="gbwrap"><span class="membar"><i style="width:' + p + '%"></i></span></span>' +
                  '<span class="gp">' + p + '%</span></div>';
              }).join('') + '</div>';
            empty.outerHTML = box;
          } else {
            empty.textContent = '목표가 없습니다.';
          }
        }
      });
    });

    /* ===================================================================
     * 5) 성과관리 · 피드백 카드 & 리뷰 행
     * =================================================================== */
    section(q(perfRoot, '.subpage[data-p="1"]'), function () {
      var sp = q(perfRoot, '.subpage[data-p="1"]');
      var more = q(sp, '.fb-more');
      var teamObj = (D.objectives || []).filter(function (o) { return o.org_id === CU.org_id; })[0];
      var items = [];
      ((cuDemo && cuDemo.peerReviews) || []).forEach(function (r) {
        var sender = empName(r.reviewer_id) || '동료';
        var like = /leader/.test(r.relation) ? 1 : 0;
        Object.keys(r.strength_comments || {}).forEach(function (d) {
          items.push({ body: r.strength_comments[d], from: sender, date: r.review_date, like: like, rel: teamObj ? teamObj.title : '' });
        });
        Object.keys(r.dev_comments || {}).forEach(function (d) {
          items.push({ body: r.dev_comments[d], from: sender, date: r.review_date, like: 0, rel: '' });
        });
      });
      items = items.slice(0, 9);
      if (!items.length) return;
      qa(sp, '.fb-card').forEach(function (c) { c.remove(); });
      var html = items.map(function (it, i) {
        var avaStyle = (i % 3 === 0) ? ' style="background:#F7CBD8;color:#D6698A"' : '';
        var rel = it.rel ? '<div class="rel-goal"><span class="lb">관련 목표</span>' + esc(it.rel) + '</div>' : '';
        var like = it.like ? '<span class="heart">♥ 좋아요 ' + it.like + '</span>' : '<span>♡ 좋아요 0</span>';
        return '<div class="fb-card"><div class="fb-top">' +
          '<span class="ava"' + avaStyle + '>' + AVA_SVG + '</span>' +
          '<div class="fb-ttl"><b>' + esc(CU.name) + '</b> 님이 피드백을 받았습니다.</div>' +
          '<span class="fb-dots">⋮</span></div>' +
          '<div class="fb-body">' + esc(it.body) + '</div>' + rel +
          '<div class="fb-from"><b>' + esc(it.from) + '</b> 님이 보냄</div>' +
          '<div class="fb-foot">' + like + '<span>💬 댓글 0</span><span>🕑 ' + fmtK(it.date) + '</span></div></div>';
      }).join('');
      if (more) more.insertAdjacentHTML('beforebegin', html);
      else sp.insertAdjacentHTML('beforeend', html);
      var subB = q(sp, '.ph .sub b'); if (subB) subB.textContent = items.length + '개';
    });

    section(q(perfRoot, '.subpage[data-p="3"] .rv-card'), function () {
      var rows = qa(perfRoot, '.subpage[data-p="3"] .rv-row');
      var badges = [
        '<span class="badge" style="background:var(--blue-soft);color:var(--blue-2)">진행중</span>',
        '<span class="badge" style="background:#E4F5EC;color:var(--green)">완료</span>'
      ];
      rows.forEach(function (row, i) {
        var yr = q(row, '.yr'); if (yr) yr.innerHTML = '2026 ' + (badges[i] || badges[0]);
        var people = qa(row, '.rv-people .g .nm');
        if (people[0]) people[0].textContent = CU.name;                 // 대상자
        if (people[1]) people[1].textContent = CU.managerName || '홍예준'; // 관리자
      });
    });

    /* ===================================================================
     * 6) 평가관리 · 평가 매트릭스
     * =================================================================== */
    section(apprRoot && qa(apprRoot, '.ap-proj').length ? apprRoot : null, function () {
      var team = (D.employees || []).filter(function (e) { return e.org_id === CU.org_id; });
      if (team.length < 2) team = (D.employees || []).slice(0, 5);
      var projTitles = ['FY2026 2Q 성과평가', 'FY2026 1Q 성과평가', 'FY2026 상반기 종합평가'];

      function cellHTML(inner) {
        return '<td><div class="ap-cell"><span class="ap-av">' + AVA_SVG + '</span>' +
          '<div class="ap-cbody">' + inner + '</div></div></td>';
      }
      function buildCell(kind, e) {
        var team2 = esc(e.orgName);
        var ev = evalByEmp[e.emp_id];
        if (kind === 'target')
          return cellHTML('<div class="ap-nm">' + esc(e.name) + '</div><div class="ap-tm">' + team2 + '</div>');
        if (kind === 'result') {
          var gr = ev ? ev.grade : '-';
          return cellHTML('<div class="ap-nm">' + esc(e.name) + ' <span class="sdot s-done">✓</span></div>' +
            '<div class="ap-tm">' + team2 + '</div><div class="ap-tm">결과 ' + esc(gr) + '등급</div>');
        }
        if (kind === 'self')
          return cellHTML('<div class="ap-nm">' + esc(e.name) + ' <span class="sdot s-done">✓</span></div>' +
            '<div class="ap-tm">' + team2 + '</div><button class="ap-btn-o">응답 확인</button>');
        return cellHTML('<div class="ap-nm">' + esc(e.name) + ' <span class="sdot s-delay"></span></div>' +
          '<div class="ap-tm">' + team2 + '</div><button class="ap-btn">작성</button>');
      }
      function kindFor(thText) {
        if (thText.indexOf('대상자') >= 0) return 'target';
        if (thText.indexOf('결과') >= 0) return 'result';
        if (thText.indexOf('본인') >= 0) return 'self';
        return 'pending';
      }

      qa(apprRoot, '.ap-proj').forEach(function (proj, pi) {
        var tEl = q(proj, '.ap-proj-h .t'); if (tEl) tEl.textContent = projTitles[pi] || projTitles[0];
        qa(proj, '.ap-group').forEach(function (g, gi) {
          var org = ancestorAtLevel(CU.org_id, 2) || orgById[CU.org_id];
          g.textContent = (org && org.name) || CU.orgName;
        });
        qa(proj, 'table.ap-tbl').forEach(function (tbl) {
          var ths = qa(tbl, 'thead th').map(function (th) { return (th.childNodes[0] && th.childNodes[0].textContent || th.textContent || '').trim(); });
          var kinds = ths.map(kindFor);
          var tbody = q(tbl, 'tbody'); if (!tbody) return;
          var rows = team.slice(0, 5).map(function (e) {
            return '<tr>' + kinds.map(function (k) { return buildCell(k, e); }).join('') + '</tr>';
          }).join('');
          tbody.innerHTML = rows;
        });
      });
    });

    /* ===================================================================
     * 7) 인사관리 · 구성원 목록 (#mmBody) — IIFE 이후 재렌더
     * =================================================================== */
    section(document.getElementById('mmBody'), function () {
      var body = document.getElementById('mmBody');
      var emps = (D.employees || []).slice(0, 26);
      function c(v) { return (v === '-' || v === '' || v == null) ? '<span class="dash">-</span>' : esc(v); }
      body.innerHTML = emps.map(function (e, i) {
        var pink = e.gender === 'F';
        var lead = e.is_leader ? '<span class="lead-b"><span class="vf">✓</span>조직장</span>' : '';
        var role = e.is_leader ? '팀장' : '팀원';
        return '<tr>' +
          '<td>' + (i + 1) + '</td>' +
          '<td><span class="' + (pink ? 'mava pk' : 'mava') + '">' + (pink ? '🌸' : AVA_SVG) + '</span><a class="mlink">' + esc(e.name) + '</a></td>' +
          '<td>' + esc(e.orgName) + lead + '</td>' +
          '<td>' + esc(empNoOf(e.emp_id)) + '</td>' +
          '<td>' + c(role) + '</td>' +
          '<td>' + c(e.level_kr) + '</td>' +
          '<td>' + c(e.jobTitle) + '</td>' +
        '</tr>';
      }).join('');
      // 상단 카운트/경로
      var mmHead = q(hrmRoot, '.mm-panel .mm-head');
      if (mmHead) {
        var cb = q(mmHead, '.cntbig b'); if (cb) cb.textContent = emps.length;
        var path = q(mmHead, '.path'); if (path) path.textContent = (D.company && D.company.name) || '올인원컴퍼니';
      }
      var pager = q(hrmRoot, '.mm-panel .pager');
      if (pager) {
        var mid = pager.children[1];
        if (mid) mid.textContent = '1–' + emps.length + ' of ' + (D.company ? D.company.employee_count : emps.length);
      }
    });

    /* ===================================================================
     * 8) 인원 현황 / 인사 통계 (조직별 인원, 성별)
     * =================================================================== */
    section(q(hrmRoot, '.subpage[data-p="3"] .pivot-card'), function () {
      var sp = q(hrmRoot, '.subpage[data-p="3"]');
      var total = (D.company && D.company.employee_count) || (D.employees || []).length;

      // 상위 조직(본부/센터급, 레벨4) 기준 그룹 집계 — 레벨2는 대부분 CPO 단일 버킷이라 분포가 무의미
      var groups = {};
      (D.employees || []).forEach(function (e) {
        var anc = ancestorAtLevel(e.org_id, 4) || orgById[e.org_id];
        var name = anc ? anc.name : (e.orgName || '기타');
        var g = groups[name] || (groups[name] = { name: name, m: 0, f: 0 });
        if (e.gender === 'F') g.f++; else g.m++;
      });
      var arr = Object.keys(groups).map(function (k) { return groups[k]; })
        .sort(function (a, b) { return (b.m + b.f) - (a.m + a.f); });
      var top = arr.slice(0, 3);
      var shown = top.reduce(function (s, g) { return s + g.m + g.f; }, 0);

      // 두 곳의 "필터링한 인원" 텍스트
      qa(sp, '.cc-head .sub').forEach(function (el) { el.textContent = '필터링한 인원 : ' + shown + '/' + total + '명'; });

      // 피벗 테이블 (Group / 남자 / 여자 / 합계 — 열 개수 유지, 라벨만 교체)
      var pivot = q(sp, 'table.pivot');
      if (pivot) {
        var heads = qa(pivot, 'thead th');
        // 3개의 값 컬럼 라벨(마지막 헤더 행) 재사용
        var lastRow = qa(pivot, 'thead tr');
        if (lastRow.length) {
          var lastThs = qa(lastRow[lastRow.length - 1], 'th');
          var labs = ['남자', '여자', '합계'];
          lastThs.forEach(function (th, i) { if (labs[i] != null) th.textContent = labs[i]; });
        }
        var tbody = q(pivot, 'tbody');
        if (tbody) {
          var rows = top.map(function (g) {
            return '<tr><td class="grp-cell">' + esc(g.name) + ' (' + (g.m + g.f) + ')</td>' +
              '<td class="num">' + g.m + '</td><td class="num">' + g.f + '</td><td class="num">' + (g.m + g.f) + '</td></tr>';
          }).join('');
          var tm = top.reduce(function (s, g) { return s + g.m; }, 0);
          var tf = top.reduce(function (s, g) { return s + g.f; }, 0);
          rows += '<tr><td class="grp-cell">Total</td><td class="num">' + tm + '</td><td class="num">' + tf + '</td><td class="num">' + (tm + tf) + '</td></tr>';
          tbody.innerHTML = rows;
        }
      }

      // 차트 (막대 재구성 + Y축 스케일)
      var chart = q(sp, '.chart');
      if (chart && top.length) {
        var maxV = 1;
        top.forEach(function (g) { maxV = Math.max(maxV, g.m, g.f); });
        var axisTop = niceCeil(maxV);
        var yax = q(chart, '.yax');
        if (yax) {
          var yh = '';
          for (var i = 5; i >= 0; i--) {
            var val = Math.round(axisTop * i / 5);
            yh += '<span class="yt" style="bottom:' + (i * 20) + '%">' + val + '</span>';
          }
          yax.innerHTML = yh;
        }
        var groupsEl = q(chart, '.groups');
        if (groupsEl) {
          groupsEl.innerHTML = top.map(function (g) {
            var hm = clamp(g.m / axisTop * 100), hf = clamp(g.f / axisTop * 100);
            return '<div class="grp">' +
              '<div class="bar c1" style="height:' + hm + '%"><span class="bv">' + g.m + '</span></div>' +
              '<div class="bar c3" style="height:' + hf + '%"><span class="bv">' + g.f + '</span></div></div>';
          }).join('');
        }
        var xlab = q(chart, '.xlab');
        if (xlab) xlab.innerHTML = top.map(function (g) { return '<span>' + esc(g.name) + '</span>'; }).join('');
      }
    });
  }

  function boot() { if (done) return; done = true; run(); }

  window.TXHydrate = { run: function () { done = false; boot(); } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
