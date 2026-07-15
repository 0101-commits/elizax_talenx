/* tx_fix_perf.js — 성과관리(Performance) fidelity 고도화 (2026-07-15)
   Runtime patch. Does NOT edit index.html or any other file.
   IIFE · idempotency-guarded · runs inside TXFIX.ready · patches the CURRENT DOM.
   Rebuilds 목표(data-p=0) / 1:1 미팅(data-p=2) / 리뷰(data-p=3) from TALENX_DATA,
   patches 피드백(data-p=1) in place, and adds two full-screen overlays:
   목표 맵(obj_map) and 목표 생성(obj_new). No network, zero JS errors expected. */
(function () {
  'use strict';
  var F = window.TXFIX;
  if (!F || !F.ready) return;
  var TX = window.TX || {};
  var esc = TX.esc || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  F.ready(function () {
    var sec = document.getElementById('s-perf');
    if (!sec || sec.dataset.txfPerf) return;   // idempotency guard
    sec.dataset.txfPerf = '1';

    var D = F.D || window.TALENX_DATA || {};
    var CU = F.CU || (D.meta && D.meta.currentUser) || {};
    var cuEmp = F.emp(CU.emp_id) || CU;

    /* ---------------- indexes ---------------- */
    var objs = D.objectives || [], krs = D.keyResults || [],
        chks = D.checkins || [], emps = D.employees || [], orgs = D.orgs || [];
    var objById = {}, orgById = {}, empById = {};
    objs.forEach(function (o) { objById[o.objective_id] = o; });
    orgs.forEach(function (o) { orgById[o.org_id] = o; });
    emps.forEach(function (e) { empById[e.emp_id] = e; });
    if (CU.emp_id && !empById[CU.emp_id]) empById[CU.emp_id] = cuEmp;

    var krByObj = {}, chkByKr = {}, chkByObj = {}, chkByEmp = {};
    krs.forEach(function (k) { (krByObj[k.objective_id] = krByObj[k.objective_id] || []).push(k); });
    chks.forEach(function (c) {
      (chkByKr[c.kr_id] = chkByKr[c.kr_id] || []).push(c);
      (chkByObj[c.objective_id] = chkByObj[c.objective_id] || []).push(c);
      (chkByEmp[c.emp_id] = chkByEmp[c.emp_id] || []).push(c);
    });
    var objByOwner = {}, objByOrg = {}, empByOrg = {};
    objs.forEach(function (o) {
      (objByOwner[o.owner_emp_id] = objByOwner[o.owner_emp_id] || []).push(o);
      (objByOrg[o.org_id] = objByOrg[o.org_id] || []).push(o);
    });
    emps.forEach(function (e) { (empByOrg[e.org_id] = empByOrg[e.org_id] || []).push(e); });

    /* ---------------- helpers ---------------- */
    function wnum(k) { return parseFloat(k.weight) || 0; }
    function pct(n) { return Math.round(n || 0) + '%'; }
    function objProgress(o) {
      if (o == null) return 0;
      if (o.progress != null) return o.progress;
      var ks = krByObj[o.objective_id] || [];
      if (!ks.length) return 0;
      var s = 0, w = 0;
      ks.forEach(function (k) { s += (k.progress || 0) * wnum(k); w += wnum(k); });
      return w ? s / w : 0;
    }
    function empName(id) { var e = empById[id]; return e ? e.name : (id || ''); }
    function empProgress(id) {   // fix 4: derive from member's objectives, NOT eval score
      var os = objByOwner[id] || [];
      if (!os.length) return null;
      var s = 0; os.forEach(function (o) { s += objProgress(o); });
      return s / os.length;
    }
    function typeBadge(o) {
      return o.type === '개인'
        ? '<span class="badge b-org">개인</span>'
        : '<span class="badge b-org">조직</span>';
    }
    function statusChip(o) {
      var st = o.status || '진행중';
      if (st === '완료') return '<span class="chip-prog" style="background:#E4F5EC;color:var(--green)">완료</span>';
      return '<span class="chip-prog">' + esc(st) + '</span>';
    }
    function bar(p, w) { return '<span class="membar" style="width:' + (w || 112) + 'px"><i style="width:' + Math.max(0, Math.min(100, p)) + '%"></i></span>'; }
    function ancestorOrgs(orgId) {   // [self, parent, ... root]
      var out = [], c = orgId, guard = 0;
      while (c && orgById[c] && guard++ < 20) { out.push(c); c = orgById[c].parent_id; }
      return out;
    }

    /* ============================================================= *
     *  STYLE                                                        *
     * ============================================================= */
    var css = document.createElement('style');
    css.id = 'txf-perf-style';
    css.textContent = [
      '#s-perf .txf-note{font-size:12px;color:var(--ink-3);margin-left:8px}',
      '#s-perf .txf-note.warn{color:var(--red);font-weight:700}',
      '#s-perf .txf-sumtag{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:var(--green);background:#E4F5EC;border-radius:6px;padding:2px 9px}',
      '#s-perf .txf-sumtag.bad{color:var(--red);background:var(--red-soft)}',
      '#s-perf .mg.txf-exp{cursor:pointer}',
      '#s-perf .mg.txf-exp:hover{background:var(--soft)}',
      '#s-perf .txf-detail{margin:0 0 6px}',
      '#s-perf .txf-ai{display:inline-flex;align-items:center;gap:6px;border:1.5px solid var(--purple);color:var(--purple);background:var(--card);font-size:12.5px;font-weight:700;padding:8px 14px;border-radius:8px;cursor:pointer}',
      '#s-perf .txf-ai:hover{background:var(--blue-soft)}',
      '#s-perf .txf-ck{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--ink-2);cursor:pointer;user-select:none}',
      '#s-perf .txf-ck input{width:15px;height:15px;accent-color:var(--blue)}',
      /* --- overlays --- */
      '#s-perf .txf-ov{position:fixed;left:0;right:0;top:60px;bottom:0;background:var(--soft);z-index:60;display:none;overflow-y:auto}',
      '#s-perf .txf-ov.open{display:block}',
      '#s-perf .txf-ovhead{display:flex;align-items:center;gap:12px;background:var(--card);border-bottom:1px solid var(--line);padding:14px 26px;position:sticky;top:0;z-index:2}',
      '#s-perf .txf-ovhead .bk{width:34px;height:34px;border-radius:8px;border:1px solid var(--line);background:var(--card);display:flex;align-items:center;justify-content:center;font-size:17px;color:var(--ink-2);cursor:pointer}',
      '#s-perf .txf-ovhead .bk:hover{background:var(--soft)}',
      '#s-perf .txf-ovhead h2{margin:0;font-size:18px;font-weight:800}',
      '#s-perf .txf-ovhead .sp{margin-left:auto;display:flex;gap:8px}',
      '#s-perf .txf-ovbody{padding:22px 26px;max-width:1240px;margin:0 auto}',
      /* map */
      '#s-perf .txf-map{display:flex;gap:20px;align-items:flex-start}',
      '#s-perf .txf-rail{width:300px;flex:none;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px}',
      '#s-perf .txf-rail h3{margin:0 0 14px;font-size:16px;font-weight:800;display:flex;align-items:center}',
      '#s-perf .txf-rail h3 .x{margin-left:auto;color:var(--ink-4);cursor:pointer;font-size:15px}',
      '#s-perf .txf-rail .fl{font-size:12px;font-weight:700;color:var(--ink-3);margin:14px 0 6px}',
      '#s-perf .txf-rail select,#s-perf .txf-rail .selbox{width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 10px;font-size:13px;color:var(--ink);background:var(--card)}',
      '#s-perf .txf-tree{margin-top:6px;font-size:13px;border-top:1px solid var(--line);padding-top:12px}',
      '#s-perf .txf-tnode{padding:3px 0}',
      '#s-perf .txf-trow{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:6px;cursor:pointer}',
      '#s-perf .txf-trow:hover{background:var(--soft)}',
      '#s-perf .txf-trow.sel{background:var(--blue-soft);color:var(--blue-2);font-weight:700}',
      '#s-perf .txf-tg{width:16px;text-align:center;color:var(--ink-4);flex:none}',
      '#s-perf .txf-tkids{margin-left:14px;border-left:1px dashed var(--line);padding-left:6px}',
      '#s-perf .txf-cards{flex:1;min-width:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;align-content:start}',
      '#s-perf .txf-gcard{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px}',
      '#s-perf .txf-gcard .tt{font-size:14px;font-weight:800;line-height:1.45;color:var(--ink);min-height:40px}',
      '#s-perf .txf-gcard .og{display:flex;align-items:center;gap:7px;margin:10px 0 12px;font-size:12.5px;color:var(--ink-2);font-weight:600}',
      '#s-perf .txf-gcard .ln{display:flex;align-items:center;font-size:12px;margin-top:7px}',
      '#s-perf .txf-gcard .ln .lb{color:var(--blue-2);font-weight:700}.txf-gcard .ln .vv{margin-left:auto;font-weight:800;color:var(--ink)}',
      '#s-perf .txf-oi{width:22px;height:22px;border-radius:6px;background:var(--blue);color:#fff;font-size:11px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;flex:none}',
      '#s-perf .txf-empty{color:var(--ink-3);font-size:13.5px;padding:40px;text-align:center;grid-column:1/-1}',
      /* new-goal form */
      '#s-perf .txf-form{display:flex;gap:20px;align-items:flex-start}',
      '#s-perf .txf-fmain{flex:1;min-width:0}',
      '#s-perf .txf-fcard{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px 22px;margin-bottom:16px}',
      '#s-perf .txf-frow0{display:flex;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 18px;margin-bottom:16px;font-size:12.5px;color:var(--red);font-weight:700}',
      '#s-perf .txf-frow0 .sp{margin-left:auto;display:flex;align-items:center;gap:16px}',
      '#s-perf .txf-lb{font-size:14px;font-weight:800;color:var(--ink);display:flex;align-items:center;gap:6px;margin-bottom:9px}',
      '#s-perf .txf-lb .req{color:var(--red)}',
      '#s-perf .txf-lb .mm{margin-left:auto;font-size:12px;font-weight:700;color:var(--ink-2);border:1px solid var(--line);border-radius:7px;padding:6px 12px;cursor:pointer;background:var(--card)}',
      '#s-perf .txf-inp,#s-perf .txf-ta{width:100%;border:1px solid var(--line);border-radius:8px;padding:11px 12px;font-size:13.5px;color:var(--ink);background:var(--card);font-family:inherit}',
      '#s-perf .txf-ta{min-height:90px;resize:vertical}',
      '#s-perf .txf-rte{border:1px solid var(--line);border-radius:8px;overflow:hidden}',
      '#s-perf .txf-rtebar{display:flex;gap:2px;padding:6px 8px;border-bottom:1px solid var(--line);background:var(--soft);color:var(--ink-3);font-size:13px}',
      '#s-perf .txf-rtebar b,.txf-rtebar span{width:26px;height:24px;display:inline-flex;align-items:center;justify-content:center;border-radius:5px;cursor:default}',
      '#s-perf .txf-rte textarea{width:100%;border:0;padding:11px 12px;font-size:13.5px;min-height:76px;resize:vertical;font-family:inherit;background:var(--card);color:var(--ink)}',
      '#s-perf .txf-help{font-size:12px;color:var(--ink-3);margin-top:7px}',
      '#s-perf .txf-kr{border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin-top:14px}',
      '#s-perf .txf-kr .kh{display:flex;align-items:center;font-size:14px;font-weight:800;margin-bottom:12px}',
      '#s-perf .txf-kr .kh .x{margin-left:auto;color:var(--ink-4);cursor:pointer;font-size:15px}',
      '#s-perf .txf-sub{font-size:12.5px;font-weight:700;color:var(--ink-2);margin:14px 0 7px}',
      '#s-perf .txf-radios{display:flex;gap:20px;font-size:13px;color:var(--ink);align-items:center}',
      '#s-perf .txf-radios label{display:inline-flex;align-items:center;gap:6px;cursor:pointer}',
      '#s-perf .txf-radios input{accent-color:var(--blue)}',
      '#s-perf .txf-addkr{width:100%;border:1px dashed var(--line);background:var(--card);color:var(--ink-2);font-weight:700;font-size:13px;padding:11px;border-radius:9px;margin-top:14px;cursor:pointer}',
      '#s-perf .txf-addkr:hover{background:var(--soft)}',
      '#s-perf .txf-step{width:250px;flex:none;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px}',
      '#s-perf .txf-step h3{margin:0 0 16px;font-size:15px;font-weight:800}',
      '#s-perf .txf-step .s{display:flex;align-items:center;gap:9px;font-size:13.5px;color:var(--ink-3);padding:8px 0}',
      '#s-perf .txf-step .s.done{color:var(--ink)}',
      '#s-perf .txf-step .s .ic{width:18px;height:18px;border-radius:50%;background:var(--line);color:#fff;font-size:11px;display:inline-flex;align-items:center;justify-content:center;flex:none}',
      '#s-perf .txf-step .s.done .ic{background:var(--blue)}',
      '#s-perf .txf-step .s .rq{color:var(--red)}',
      /* 1:1 meeting main pane */
      '#s-perf .txf-mt-item{display:flex;gap:10px;align-items:flex-start;padding:12px 6px;border-radius:9px;cursor:pointer;border-top:1px solid var(--line-2)}',
      '#s-perf .txf-mt-item:hover{background:var(--soft)}',
      '#s-perf .txf-mt-item.on{background:var(--blue-soft)}',
      '#s-perf .txf-mt-item .nm{font-size:13.5px;font-weight:700;color:var(--ink)}',
      '#s-perf .txf-mt-item .meta{font-size:12px;color:var(--ink-3);margin-top:5px;display:flex;gap:12px}',
      '#s-perf .txf-mt-item .date{font-size:12px;color:var(--ink-3);margin-top:5px}',
      '#s-perf .txf-md{width:100%;text-align:left;align-self:stretch}',
      '#s-perf .txf-md .mdh{display:flex;align-items:center;gap:12px;padding-bottom:16px;border-bottom:1px solid var(--line);margin-bottom:18px}',
      '#s-perf .txf-md .mdh .nm{font-size:16px;font-weight:800;color:var(--ink)}',
      '#s-perf .txf-md .mdh .dt{font-size:12.5px;color:var(--ink-3);margin-top:3px}',
      '#s-perf .txf-md h4{margin:20px 0 9px;font-size:13.5px;font-weight:800;color:var(--ink)}',
      '#s-perf .txf-md h4:first-of-type{margin-top:0}',
      '#s-perf .txf-md .ag{display:flex;gap:9px;padding:8px 0;font-size:13.5px;color:var(--ink-2);border-bottom:1px solid var(--line-2)}',
      '#s-perf .txf-md .ag .no{color:var(--blue-2);font-weight:800;flex:none}',
      '#s-perf .txf-md .nt{font-size:13.5px;color:var(--ink-2);line-height:1.6;background:var(--soft);border-radius:8px;padding:14px 16px}',
      '#s-perf .txf-md .ai{display:flex;gap:9px;align-items:center;padding:8px 0;font-size:13.5px;color:var(--ink-2)}',
      '#s-perf .txf-md .ai .bx{width:16px;height:16px;border:1.5px solid var(--line);border-radius:4px;flex:none}',
      '#s-perf .mt-main.txf-open{align-items:flex-start;justify-content:flex-start;color:var(--ink);padding:26px 30px}'
    ].join('\n');
    if (!document.getElementById('txf-perf-style')) sec.appendChild(css);

    /* ============================================================= *
     *  목표 (data-p=0) — full data-driven rebuild                    *
     * ============================================================= */
    var goalPage = sec.querySelector('.subpage[data-p="0"]');
    var activePill = 1;   // 0 요약 · 1 소속기준(default) · 2 역할기준 · 3 전체

    function myObjectives() {   // fix 6: only objectives the CU actually owns
      return (objByOwner[CU.emp_id] || []).slice();
    }

    function myGoalsCard(withDetail) {
      var mine = myObjectives();
      var org = mine.filter(function (o) { return o.type === '조직'; }).length;
      var per = mine.filter(function (o) { return o.type === '개인'; }).length;
      var avg = mine.length ? mine.reduce(function (a, o) { return a + objProgress(o); }, 0) / mine.length : 0;
      // fix 5: objective-level weight roll-up (equal split → sums to 100) + sum guard
      var n = mine.length, base = n ? Math.floor(100 / n) : 0;
      var weights = mine.map(function (_, i) { return i === n - 1 ? 100 - base * (n - 1) : base; });
      var wsum = weights.reduce(function (a, b) { return a + b; }, 0);
      var rows = mine.map(function (o, i) {
        var p = objProgress(o);
        var ks = krByObj[o.objective_id] || [];
        var ck = (chkByObj[o.objective_id] || []).length;
        var det = '';
        if (withDetail) {
          det = '<div class="gbox txf-detail" style="display:none">'
            + '<div class="grow hd"><span class="gn">핵심 성과</span><span class="gw">가중치</span><span class="gbwrap"></span><span class="gp">진행률</span></div>'
            + ks.map(function (k) {
                var lc = (chkByKr[k.kr_id] || [])[0];
                return '<div class="grow"><span class="gn">' + esc(k.name)
                  + (lc ? ' <span class="supn">· 최근 체크인: ' + esc((lc.comment || '').slice(0, 40)) + '</span>' : '')
                  + '</span><span class="gw">' + wnum(k) + '%</span><span class="gbwrap">' + bar(k.progress || 0) + '</span><span class="gp">' + pct(k.progress || 0) + '</span></div>';
              }).join('')
            + (ks.length ? '' : '<div class="grow"><span class="gn" style="color:var(--ink-3)">등록된 핵심 성과가 없습니다.</span></div>')
            + '</div>';
        }
        return '<div class="mg txf-exp">'
          + '<div class="nm"><div class="t1">' + esc(o.title)
          + (ck ? ' <span class="supn">체크인 ' + ck + '건</span>' : '') + '</div>'
          + '<div class="t2">' + typeBadge(o) + '</div></div>'
          + '<span class="w">' + weights[i] + '%</span>'
          + '<span class="s">' + statusChip(o) + '</span>'
          + '<span class="bw">' + bar(p) + '</span>'
          + '<span class="p">' + pct(p) + '</span></div>' + det;
      }).join('');
      if (!mine.length) rows = '<div class="nogoal">등록된 목표가 없습니다.</div>';
      var guard = wsum === 100
        ? '<span class="txf-sumtag">✓ 가중치 합 ' + wsum + '%</span>'
        : '<span class="txf-sumtag bad">⚠ 가중치 합 ' + wsum + '% (100%가 아닙니다)</span>';
      return '<div class="mycard">'
        + '<div class="mt"><h3>나의 목표</h3>'
        + '<div class="r"><span class="ck">✓ 전체 <b>' + mine.length + '</b></span><span>· 조직 <b>' + org + '</b></span><span>· 개인 <b>' + per + '</b></span></div></div>'
        + '<div class="mysub"><button class="ghost-btn">⇅ 순서 변경</button>'
        + '<div class="r">' + guard
        + '<span class="pb"><span>전체 진행률</span><span class="sumbar"><i style="width:' + Math.round(avg) + '%"></i></span></span>'
        + '<span class="pct">' + pct(avg) + '</span></div></div>'
        + rows + '</div>';
    }

    function orgCard(orgId) {
      var o = orgById[orgId]; if (!o) return '';
      var members = (empByOrg[orgId] || []).slice(0, 16);
      var memberObjs = [];
      members.forEach(function (m) { (objByOwner[m.emp_id] || []).forEach(function (x) { memberObjs.push(x); }); });
      var orgLevelObjs = (objByOrg[orgId] || []).filter(function (x) { return x.type === '조직'; });
      // fix 3: counts computed from members' objectives (not hardcoded)
      var ing = memberObjs.filter(function (x) { return x.status === '진행중'; }).length;
      var done = memberObjs.filter(function (x) { return x.status === '완료'; }).length;
      var delay = memberObjs.filter(function (x) { return x.status === '지연' || x.status === '지연중'; }).length;
      var help = 0;
      members.forEach(function (m) { (chkByEmp[m.emp_id] || []).forEach(function (c) { if (c.blocker) help++; }); });
      var total = members.length;
      var setCnt = members.filter(function (m) { return (objByOwner[m.emp_id] || []).length; }).length;
      var memRows = members.map(function (m) {
        var mp = empProgress(m.emp_id);
        var mine = objByOwner[m.emp_id] || [];
        var av = F.avatar ? F.avatar(m.name, 32) : '<span class="ava"></span>';
        var head = '<div class="mem txf-mem" style="border-top:1px solid var(--line-2)">' + av
          + '<span class="nme">' + esc(F.nameTeam ? F.nameTeam(m) : m.name) + '</span>'
          + '<span class="fill"></span>' + bar(mp || 0)
          + '<span class="p">' + (mp == null ? '0%' : pct(mp)) + '</span><span class="cv">⌄</span></div>';
        var body;
        if (!mine.length) {
          body = '<div class="nogoal" style="display:none">목표가 없습니다.</div>';
        } else {
          body = '<div class="gbox" style="display:none">'
            + '<div class="grow hd"><span class="gn">목표명</span><span class="gw">진행 상태</span><span class="gbwrap"></span><span class="gp">진행률</span></div>'
            + mine.map(function (x) {
                var p = objProgress(x);
                return '<div class="grow"><span class="gn">' + esc(x.title) + ' ' + typeBadge(x) + '</span>'
                  + '<span class="gw">' + esc(x.status || '진행중') + '</span>'
                  + '<span class="gbwrap">' + bar(p) + '</span><span class="gp">' + pct(p) + '</span></div>';
              }).join('') + '</div>';
        }
        return head + body;
      }).join('');
      var orgTab = orgLevelObjs.length
        ? '<div class="gbox" style="margin-top:12px">'
          + '<div class="grow hd"><span class="gn">조직 목표</span><span class="gw">진행 상태</span><span class="gbwrap"></span><span class="gp">진행률</span></div>'
          + orgLevelObjs.map(function (x) {
              var p = objProgress(x);
              return '<div class="grow"><span class="gn">' + esc(x.title) + '</span><span class="gw">' + esc(x.status || '진행중')
                + '</span><span class="gbwrap">' + bar(p) + '</span><span class="gp">' + pct(p) + '</span></div>';
            }).join('') + '</div>'
        : '<div class="nogoal" style="margin-top:12px">등록된 조직 목표가 없습니다.</div>';
      return '<div class="orgcard" data-org="' + orgId + '">'
        + '<h3>' + esc(o.name) + '의 목표</h3>'
        + '<div class="orgtabs txf-orgtabs"><button data-t="org">조직</button><button class="on" data-t="mem">구성원</button></div>'
        + '<div class="orgstat"><div class="l">'
        + '<span class="c1">진행중 <b>' + ing + '</b></span><span class="c2">완료 <b>' + done + '</b></span>'
        + '<span class="c3">지연중 <b>' + delay + '</b></span><span class="c4">도움요청 <b>' + help + '</b></span></div>'
        + '<div class="r"><span class="tot">✓ 전체 ' + total + '</span><span>· 수립 <b>' + setCnt + '</b></span><span>· 미수립 <b>' + (total - setCnt) + '</b></span></div></div>'
        + '<div class="orgctrl"><span class="tog"></span><span class="toglbl">핵심 성과</span><button class="ghost-btn">전체 열기</button></div>'
        + '<div class="txf-org-mem">' + memRows + '</div>'
        + '<div class="txf-org-org" style="display:none">' + orgTab + '</div>'
        + '</div>';
    }

    function roleCard() {   // 역할 기준 — group my objectives under my job role
      var mine = myObjectives();
      var role = cuEmp.jobTitle || '담당';
      var rows = mine.length ? mine.map(function (o) {
        var p = objProgress(o);
        return '<div class="grow"><span class="gn">' + esc(o.title) + ' ' + typeBadge(o) + '</span>'
          + '<span class="gw">' + esc(o.status || '진행중') + '</span><span class="gbwrap">' + bar(p) + '</span><span class="gp">' + pct(p) + '</span></div>';
      }).join('') : '<div class="grow"><span class="gn" style="color:var(--ink-3)">등록된 목표가 없습니다.</span></div>';
      return '<div class="orgcard"><h3>' + esc(role) + ' 역할 기준 목표</h3>'
        + '<div class="gbox" style="margin-top:4px">'
        + '<div class="grow hd"><span class="gn">목표명</span><span class="gw">진행 상태</span><span class="gbwrap"></span><span class="gp">진행률</span></div>'
        + rows + '</div></div>';
    }

    function allCard() {   // 나의 전체 목표 — flat list of every objective I own
      var mine = myObjectives();
      var rows = mine.length ? mine.map(function (o) {
        var p = objProgress(o);
        return '<div class="grow"><span class="gn">' + esc(o.title) + ' ' + typeBadge(o) + ' ' + statusChip(o) + '</span>'
          + '<span class="gw"></span><span class="gbwrap">' + bar(p) + '</span><span class="gp">' + pct(p) + '</span></div>';
      }).join('') : '<div class="grow"><span class="gn" style="color:var(--ink-3)">등록된 목표가 없습니다.</span></div>';
      return '<div class="orgcard"><h3>나의 전체 목표 (' + mine.length + ')</h3>'
        + '<div class="gbox" style="margin-top:4px">'
        + '<div class="grow hd"><span class="gn">목표명</span><span class="gw"></span><span class="gbwrap"></span><span class="gp">진행률</span></div>'
        + rows + '</div></div>';
    }

    function renderGoalBody() {
      var host = goalPage.querySelector('.txf-goal-body');
      if (!host) return;
      var html;
      if (activePill === 0) {            // 나의 목표 요약
        html = myGoalsCard(false);
      } else if (activePill === 2) {     // 역할 기준
        html = myGoalsCard(false) + roleCard();
      } else if (activePill === 3) {     // 나의 전체 목표
        html = allCard();
      } else {                           // 소속 기준 (default) — fix 6: cascade lives here
        html = myGoalsCard(true)
          + '<div class="cardset"><button class="ghost-btn">조직 카드 설정</button></div>'
          + ancestorOrgs(cuEmp.org_id).map(orgCard).join('');
      }
      host.innerHTML = html;
    }

    function buildGoalPage() {
      goalPage.innerHTML =
        '<div class="perf-head"><h2>목표 현황</h2><div class="btns">'
        + '<button class="ghost-btn" data-txf="map">목표 맵</button>'
        + '<button class="ghost-btn" data-txf="weight">목표 가중치 설정</button>'
        + '<button class="btn-blue" data-txf="new">목표 생성</button></div></div>'
        + '<div class="pilltabs">'
        + '<button data-txf-pill="0">나의 목표 요약</button>'
        + '<button data-txf-pill="1" class="on">소속 기준</button>'
        + '<button data-txf-pill="2">역할 기준</button>'
        + '<button data-txf-pill="3">나의 전체 목표</button></div>'
        + '<div class="txf-goal-body"></div>';
      renderGoalBody();
    }
    if (goalPage) buildGoalPage();

    /* ============================================================= *
     *  피드백 (data-p=1) — patch in place (fix 9)                    *
     * ============================================================= */
    (function patchFeedback() {
      var page = sec.querySelector('.subpage[data-p="1"]');
      if (!page) return;
      var goalTitles = objs.map(function (o) { return o.title; });
      var senders = ['홍예준', '최우진', '성도현', '김중수', '김수민', '이해영'];
      var cards = page.querySelectorAll('.fb-card');
      cards.forEach(function (card, i) {
        // avatar → deterministic initial circle
        var av = card.querySelector('.fb-top .ava');
        var nameEl = card.querySelector('.fb-ttl b');
        var who = nameEl ? nameEl.textContent.trim() : ('U' + i);
        if (av && F.avatar) {
          var tmp = document.createElement('div'); tmp.innerHTML = F.avatar(who, 26);
          var a2 = tmp.firstChild; a2.className = 'ava'; av.replaceWith(a2);
        }
        // vary related goal (every 3rd card gets a distinct real goal; others none)
        var rel = card.querySelector('.rel-goal');
        if (i % 3 === 2) {
          var t = goalTitles[i % goalTitles.length];
          if (!rel) {
            rel = document.createElement('div'); rel.className = 'rel-goal';
            var body = card.querySelector('.fb-body');
            if (body) body.after(rel);
          }
          rel.innerHTML = '<span class="lb">관련 목표</span>' + esc(t);
        } else if (rel) {
          rel.remove();   // omit when none instead of repeating the same goal
        }
        // vary sender
        var from = card.querySelector('.fb-from b');
        if (from && i > 0) from.textContent = senders[i % senders.length];
      });
    })();

    /* ============================================================= *
     *  1:1 미팅 (data-p=2) — rebuild list + click-to-load (fix 10)   *
     * ============================================================= */
    var meetings = [];
    (function buildMeetingData() {
      var partnerIds = [cuEmp.manager_id || 'EMP-0010', 'EMP-0080', 'EMP-0077'];
      var dates = ['6월 16일 화요일 오전 10:23', '5월 20일 수요일 오후 5:52', '4월 30일 목요일 오후 2:10'];
      var myChk = (chkByEmp[CU.emp_id] || []);
      partnerIds.forEach(function (pid, i) {
        var e = empById[pid]; if (!e) return;
        var c = myChk[i % Math.max(1, myChk.length)] || {};
        meetings.push({
          emp: e,
          date: dates[i] || dates[0],
          flags: i === 0 ? 2 : 0,
          comments: i === 0 ? 1 : 0,
          agenda: [
            '2분기 목표 진행 상황 리뷰 — ' + ((myObjectives()[0] || {}).title || '서비스 기획 품질 향상'),
            '핵심 성과 KR 체크인 및 리스크 점검',
            i === 0 ? '커리어 개발 및 다음 분기 우선순위' : '협업 프로세스 개선 논의'
          ],
          notes: c.comment || '2분기 신규 기획 3건 사용자 검증 통과, 잔여 2건 진행 중. 리드타임 개선세 유지.',
          actions: [
            (c.blocker ? '블로커 해소: ' + c.blocker : '리뷰 단계 병목 개선안 정리') + ' — ' + esc(cuEmp.name || '본인'),
            '다음 1:1 전까지 KR 진행률 업데이트'
          ]
        });
      });
    })();

    function meetingDetailHTML(m) {
      var e = m.emp;
      return '<div class="txf-md">'
        + '<div class="mdh">' + (F.avatar ? F.avatar(e.name, 44) : '')
        + '<div><div class="nm">' + esc(F.nameTeam ? F.nameTeam(e) : e.name) + '</div>'
        + '<div class="dt">' + esc(m.date) + ' · 1:1 미팅</div></div></div>'
        + '<h4>안건</h4>'
        + m.agenda.map(function (a, i) { return '<div class="ag"><span class="no">' + (i + 1) + '</span><span>' + esc(a) + '</span></div>'; }).join('')
        + '<h4>공유 노트</h4><div class="nt">' + esc(m.notes) + '</div>'
        + '<h4>액션 아이템</h4>'
        + m.actions.map(function (a) { return '<div class="ai"><span class="bx"></span><span>' + esc(a) + '</span></div>'; }).join('')
        + '</div>';
    }

    (function buildMeetingPage() {
      var page = sec.querySelector('.subpage[data-p="2"]');
      if (!page) return;
      var listHTML = meetings.map(function (m, i) {
        var e = m.emp;
        return '<div class="txf-mt-item' + (i === 0 ? ' on' : '') + '" data-mt="' + i + '">'
          + (F.avatar ? F.avatar(e.name, 34) : '')
          + '<div><div class="nm">' + esc(F.nameTeam ? F.nameTeam(e) : e.name) + '</div>'
          + '<div class="meta"><span>🏳 ' + m.flags + '</span><span>💬 ' + m.comments + '</span></div>'
          + '<div class="date">' + esc(m.date) + '</div></div></div>';
      }).join('');
      page.innerHTML = '<div class="mt-wrap">'
        + '<div class="mt-main txf-open">' + (meetings.length ? meetingDetailHTML(meetings[0]) : '선택한 1:1 미팅이 없습니다.') + '</div>'
        + '<div class="mt-side"><div class="sh"><h3>1:1 미팅</h3><span class="plus">+</span></div>'
        + '<div class="segtabs"><button class="on">나의 1:1 미팅</button><button>내가 관리자인 1:1 미팅</button><button>내가 열람할 수 있는 1:1 미팅</button></div>'
        + listHTML + '</div></div>';
    })();

    /* ============================================================= *
     *  리뷰 (data-p=3) — generate rows from data (fix 11)            *
     * ============================================================= */
    (function buildReviewPage() {
      var page = sec.querySelector('.subpage[data-p="3"]');
      if (!page) return;
      var mgrs = [empById['EMP-0010'], empById['EMP-0001'], empById['EMP-0008']].filter(Boolean);
      if (!mgrs.length) mgrs = emps.slice(0, 3);
      var YEAR = 2025, ROWS = 6;
      var rows = '';
      for (var i = 0; i < ROWS; i++) {
        var mgr = mgrs[i % mgrs.length];
        var doneRow = i === ROWS - 1;
        var badge = doneRow
          ? '<span class="badge" style="background:#E4F5EC;color:var(--green)">완료</span>'
          : '<span class="badge" style="background:var(--blue-soft);color:var(--blue-2)">시작 이전</span>';
        rows += '<div class="rv-row"><div class="rv-info">'
          + '<div class="tt">기본 리뷰 양식</div>'
          + '<div class="yr">' + YEAR + ' ' + badge + '</div>'
          + '<div class="rv-people">'
          + '<div class="g"><span class="lb">대상자</span>' + (F.avatar ? F.avatar(cuEmp.name, 22) : '') + '<span class="nm">' + esc(F.nameTeam ? F.nameTeam(cuEmp) : cuEmp.name) + '</span></div>'
          + '<div class="g"><span class="lb">관리자</span>' + (F.avatar ? F.avatar(mgr.name, 22) : '') + '<span class="nm">' + esc(F.nameTeam ? F.nameTeam(mgr) : mgr.name) + '</span></div>'
          + '</div></div>'
          + '<button class="rv-act' + (doneRow ? ' ghost' : '') + '" data-txf="rv-open">' + (doneRow ? '확인' : '작성') + '</button></div>';
      }
      page.innerHTML = '<div class="ph"><h2>리뷰 현황</h2><div class="btns">'
        + '<button class="ghost-btn" data-txf="rv-explorer">리뷰 탐색기</button>'
        + '<button class="btn-blue" data-txf="rv-open">리뷰 생성</button>'
        + '<span class="filt">☰<span class="bdg">2</span></span></div></div>'
        + '<div class="segtabs" style="margin-bottom:14px"><button class="on">나의 리뷰</button><button>내가 관리자인 리뷰</button><button>내가 열람할 수 있는 리뷰</button></div>'
        + '<div class="rv-card"><div class="rv-sort"><span class="on">생성순</span><span class="dot">·</span><span>이름순</span><span class="dot">·</span><span>유형순</span></div>'
        + rows + '</div>';
    })();

    /* ============================================================= *
     *  목표 맵 (obj_map) overlay — fix 1                             *
     * ============================================================= */
    var mapOv, mapSel = cuEmp.org_id;
    function orgObjectives(orgId) {   // objectives of an org (org-level + members' individual)
      var set = (objByOrg[orgId] || []).slice();
      return set;
    }
    function mapCardsHTML() {
      var o = orgById[mapSel];
      var list = orgObjectives(mapSel);
      var excl = mapOv && mapOv.querySelector('[data-txf="map-excl"]') && mapOv.querySelector('[data-txf="map-excl"]').checked;
      if (excl) list = list.filter(function (x) { return x.status !== '완료'; });
      var per = mapOv && mapOv.querySelector('[data-txf="map-period"]');
      if (per && per.value) list = list.filter(function (x) { return (x.period || '') === per.value; });
      if (!list.length) return '<div class="txf-empty">' + (o ? esc(o.name) + '에 ' : '') + '등록된 목표가 없습니다.</div>';
      return list.map(function (x) {
        var org = orgById[x.org_id] || {};
        var p = objProgress(x);
        var ks = (krByObj[x.objective_id] || []).length;
        return '<div class="txf-gcard"><div class="tt">' + esc(x.title) + '</div>'
          + '<div class="og"><span class="txf-oi">' + esc((org.name || '조직').slice(0, 2)) + '</span>' + esc(org.name || '') + ' ' + typeBadge(x) + '</div>'
          + '<div class="ln"><span class="lb">' + esc(x.status || '진행중') + '</span><span class="vv">' + pct(p) + '</span></div>'
          + bar(p, 999).replace('width:999px', 'width:100%;margin-top:6px')
          + '<div class="ln"><span style="color:var(--ink-3)">핵심 성과</span><span class="vv">' + ks + '개</span></div></div>';
      }).join('');
    }
    function treeHTML(orgId) {
      var o = orgById[orgId]; if (!o) return '';
      var kids = orgs.filter(function (x) { return x.parent_id === orgId; });
      var expanded = ancestorOrgs(cuEmp.org_id).indexOf(orgId) >= 0;
      var g = kids.length ? (expanded ? '⊖' : '⊕') : '·';
      return '<div class="txf-tnode" data-node="' + orgId + '">'
        + '<div class="txf-trow' + (orgId === mapSel ? ' sel' : '') + '" data-txf-org="' + orgId + '">'
        + '<span class="txf-tg" data-txf-tg="' + orgId + '">' + g + '</span><span>' + esc(o.name) + '</span></div>'
        + (kids.length ? '<div class="txf-tkids" style="' + (expanded ? '' : 'display:none') + '">' + kids.map(function (k) { return treeHTML(k.org_id); }).join('') + '</div>' : '')
        + '</div>';
    }
    function buildMapOverlay() {
      mapOv = document.createElement('div');
      mapOv.className = 'txf-ov'; mapOv.setAttribute('data-txf-ov', 'map');
      var periods = {}; objs.forEach(function (o) { if (o.period) periods[o.period] = 1; });
      var periodOpts = '<option value="">주기 선택</option>' + Object.keys(periods).map(function (p) { return '<option value="' + esc(p) + '">' + esc(p) + '</option>'; }).join('');
      var roots = orgs.filter(function (o) { return !o.parent_id; });
      mapOv.innerHTML =
        '<div class="txf-ovhead"><button class="bk" data-txf="map-close">←</button><h2>목표 맵</h2></div>'
        + '<div class="txf-ovbody"><div class="txf-map">'
        + '<div class="txf-rail"><h3>목표 맵 필터<span class="x" data-txf="map-close">✕</span></h3>'
        + '<button class="btn-blue" style="width:100%" data-txf="map-close">목표 현황으로 이동</button>'
        + '<div class="fl">주기</div><select data-txf="map-period">' + periodOpts + '</select>'
        + '<div class="fl">조직</div><div class="selbox" data-txf="map-orgname">' + esc((orgById[mapSel] || {}).name || '전체') + '</div>'
        + '<div class="fl">구성원</div><select class="selbox"><option>구성원 선택</option>' + emps.slice(0, 40).map(function (e) { return '<option>' + esc(e.name) + '</option>'; }).join('') + '</select>'
        + '<label class="txf-ck" style="margin-top:14px"><input type="checkbox" data-txf="map-excl" checked> 마감한 목표 제외</label>'
        + '<div class="fl" style="margin-top:16px">조직도</div>'
        + '<div class="txf-tree">' + roots.map(function (r) { return treeHTML(r.org_id); }).join('') + '</div></div>'
        + '<div class="txf-cards" data-txf="map-cards">' + mapCardsHTML() + '</div>'
        + '</div></div>';
      sec.appendChild(mapOv);
    }
    function openMap() { if (!mapOv) buildMapOverlay(); mapOv.classList.add('open'); }
    function closeMap() { if (mapOv) mapOv.classList.remove('open'); }

    /* ============================================================= *
     *  목표 생성 (obj_new) overlay — fix 2                           *
     * ============================================================= */
    var newOv, krSeq = 0;
    function krRowHTML(data) {
      krSeq++; data = data || {};
      var id = 'k' + krSeq, modes = ['달성률', '절대값', '구간', '여부'];
      return '<div class="txf-kr" data-kr="' + id + '">'
        + '<div class="kh">핵심 성과 <span class="krn">' + '</span><span class="x" data-txf="kr-x" data-kr="' + id + '">✕</span></div>'
        + '<div class="txf-sub">성과 지표 <span style="color:var(--red)">*</span></div>'
        + '<input class="txf-inp" placeholder="성과지표를 입력합니다." value="' + esc(data.name || '') + '">'
        + '<div class="txf-sub">설명</div>'
        + '<div class="txf-rte"><div class="txf-rtebar"><b>B</b><b>U</b><span>Aa</span><span>A</span><span><i>i</i></span><span>S</span><span>≔</span><span>⋮</span><span>¶</span><span>🔗</span><span>▤</span></div><textarea placeholder="성과지표에 대한 설명을 입력합니다. (필수 항목 아님)"></textarea></div>'
        + '<div class="txf-sub">관리 방식</div>'
        + '<div class="txf-radios">' + modes.map(function (m, i) {
            return '<label><input type="radio" name="mode-' + id + '"' + ((data.mode || 0) === i ? ' checked' : '') + '> ' + m + '</label>';
          }).join('') + '</div>'
        + '<div class="txf-sub">핵심 성과 가중치 <span style="color:var(--red)">*</span></div>'
        + '<input class="txf-inp txf-krw" type="number" min="0" max="100" value="' + (data.weight != null ? data.weight : 100) + '">'
        + '</div>';
    }
    function renumberKR() {
      if (!newOv) return;
      var rows = newOv.querySelectorAll('.txf-kr');
      rows.forEach(function (r, i) { var n = r.querySelector('.krn'); if (n) n.textContent = (i + 1); });
      var stepKR = newOv.querySelector('[data-step="kr"]');
      if (stepKR) stepKR.firstChild && (stepKR.querySelector('.lbl').textContent = '핵심 성과 ' + rows.length);
    }
    function buildNewOverlay() {
      newOv = document.createElement('div');
      newOv.className = 'txf-ov'; newOv.setAttribute('data-txf-ov', 'new');
      var objOpts = '<option value="">상위 목표를 선택합니다.</option>'
        + objs.filter(function (o) { return o.type === '조직'; }).map(function (o) {
            return '<option value="' + o.objective_id + '">' + esc(o.title) + '</option>';
          }).join('');
      newOv.innerHTML =
        '<div class="txf-ovhead"><button class="bk" data-txf="new-close">←</button><h2>목표 생성</h2>'
        + '<div class="sp"><button class="ghost-btn" data-txf="new-close">취소</button>'
        + '<button class="ghost-btn" data-txf="new-temp">임시저장</button>'
        + '<button class="btn-blue" data-txf="new-save">생성</button></div></div>'
        + '<div class="txf-ovbody"><div class="txf-form"><div class="txf-fmain">'
        + '<div class="txf-frow0">* 입력 필수 항목입니다.<div class="sp">'
        + '<label class="txf-ck" style="color:var(--ink-2);font-weight:600"><input type="checkbox" data-txf="new-adv"> 고급 설정</label>'
        + '<button class="txf-ai" data-txf="ai">✦ AI 목표 추천</button></div></div>'
        + '<div class="txf-fcard"><div class="txf-lb">상위 목표 연계 <span style="color:var(--ink-4)">?</span>'
        + '<span class="mm" data-txf="new-map">목표 맵</span></div>'
        + '<select class="txf-inp" style="appearance:auto">' + objOpts + '</select>'
        + '<div class="txf-help">ⓘ 목표 맵을 클릭할 경우 목표 맵을 확인하고 상위 목표를 선택할 수 있습니다.</div>'
        + '<div class="txf-lb" style="margin-top:20px">목표명 <span class="req">*</span></div>'
        + '<input class="txf-inp" data-txf="new-name" placeholder="목표 이름을 입력합니다.">'
        + '<div class="txf-lb" style="margin-top:20px">목표 설명</div>'
        + '<div class="txf-rte"><div class="txf-rtebar"><b>B</b><b>U</b><span>Aa</span><span>A</span><span><i>i</i></span><span>S</span><span>≔</span><span>⋮</span><span>¶</span><span>🔗</span><span>▤</span></div><textarea placeholder="목표 설명을 입력합니다."></textarea></div>'
        + '</div>'
        + '<div class="txf-fcard"><div class="txf-lb">핵심 성과 <span class="req">*</span></div>'
        + '<label class="txf-ck" style="margin-bottom:6px"><input type="checkbox" checked> 핵심 성과 가중치를 설정합니다.</label>'
        + '<div data-txf="kr-list">' + krRowHTML({ weight: 100 }) + '</div>'
        + '<button class="txf-addkr" data-txf="add-kr">＋ 핵심 성과 추가</button></div>'
        + '<div class="txf-fcard"><div class="txf-lb">목표 가중치 <span class="req">*</span></div>'
        + '<label class="txf-ck" style="margin-bottom:8px;color:var(--ink-3)"><input type="checkbox" checked disabled> 목표 가중치를 설정합니다.</label>'
        + '<input class="txf-inp" type="number" placeholder="목표 가중치를 입력합니다." value="100"></div>'
        + '</div>'
        + '<div class="txf-step"><h3>목표 설정</h3>'
        + '<div class="s done"><span class="ic">✓</span><span class="lbl">상위 목표 연계</span></div>'
        + '<div class="s done"><span class="ic">✓</span><span class="lbl">목표명</span><span class="rq">*</span></div>'
        + '<div class="s done"><span class="ic">✓</span><span class="lbl">목표 설명</span></div>'
        + '<div class="s done" data-step="kr"><span class="ic">✓</span><span class="lbl">핵심 성과 1</span><span class="rq">*</span></div>'
        + '<div class="s done"><span class="ic">✓</span><span class="lbl">목표 가중치</span><span class="rq">*</span></div>'
        + '</div></div></div>';
      sec.appendChild(newOv);
      renumberKR();
    }
    function openNew() { if (!newOv) buildNewOverlay(); newOv.classList.add('open'); }
    function closeNew() { if (newOv) newOv.classList.remove('open'); }

    /* ============================================================= *
     *  목표 가중치 설정 modal — fix 12                                *
     * ============================================================= */
    function openWeightEditor() {
      var mine = myObjectives();
      var target = mine[0];
      var ks = target ? (krByObj[target.objective_id] || []) : [];
      var body = document.createElement('div');
      var rowsHTML = ks.map(function (k, i) {
        return '<label class="tx-field"><span>' + esc(k.name) + '</span>'
          + '<input type="number" class="txf-we" data-i="' + i + '" min="0" max="100" value="' + wnum(k) + '" style="text-align:right"></label>';
      }).join('');
      body.innerHTML = '<div style="font-size:12.5px;color:var(--ink-3);margin-bottom:10px">'
        + esc(target ? target.title : '목표') + ' — 핵심 성과 가중치는 합계 100%가 되어야 합니다.</div>'
        + (rowsHTML || '<div style="color:var(--ink-3)">가중치를 설정할 핵심 성과가 없습니다.</div>')
        + '<div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:12px;font-weight:800">합계 <span class="txf-wsum">100</span>%</div>';
      function recalc() {
        var s = 0; body.querySelectorAll('.txf-we').forEach(function (i) { s += parseFloat(i.value) || 0; });
        var el = body.querySelector('.txf-wsum'); if (el) { el.textContent = s; el.style.color = s === 100 ? 'var(--green)' : 'var(--red)'; }
      }
      body.addEventListener('input', recalc);
      TX.modal && TX.modal({
        title: '목표 가중치 설정', body: body,
        actions: [
          { label: '취소', kind: 'ghost' },
          { label: '저장', kind: 'primary', onClick: function () {
              var s = 0; body.querySelectorAll('.txf-we').forEach(function (i) { s += parseFloat(i.value) || 0; });
              if (s !== 100) { TX.toast && TX.toast('가중치 합계가 100%가 되어야 합니다. (현재 ' + s + '%)', 'warn'); return false; }
              TX.toast && TX.toast('가중치를 저장했습니다.', 'ok');
            } }
        ]
      });
      setTimeout(recalc, 0);
    }

    /* ============================================================= *
     *  DELEGATION — one click + one change handler on the section    *
     * ============================================================= */
    sec.addEventListener('click', function (ev) {
      var t = ev.target;
      var tag = t.closest('[data-txf]');
      if (tag) {
        ev.stopPropagation();  // prevent tx_revive.js:447 delegated "목표" handler from double-firing
        var k = tag.getAttribute('data-txf');
        if (k === 'map' || k === 'new-map') { ev.preventDefault(); openMap(); return; }
        if (k === 'map-close') { ev.preventDefault(); closeMap(); return; }
        if (k === 'new') { ev.preventDefault(); openNew(); return; }
        if (k === 'new-close') { ev.preventDefault(); closeNew(); return; }
        if (k === 'new-temp') { TX.toast && TX.toast('임시저장했습니다.', 'ok'); return; }
        if (k === 'new-save') {
          var nm = newOv && newOv.querySelector('[data-txf="new-name"]');
          if (nm && !nm.value.trim()) { TX.toast && TX.toast('목표명을 입력하세요.', 'warn'); return; }
          TX.toast && TX.toast('목표를 생성했습니다.', 'ok'); closeNew(); return;
        }
        if (k === 'weight') { openWeightEditor(); return; }
        if (k === 'add-kr') {
          var list = newOv && newOv.querySelector('[data-txf="kr-list"]');
          if (list) { list.insertAdjacentHTML('beforeend', krRowHTML({ weight: '' })); renumberKR(); }
          return;
        }
        if (k === 'kr-x') {
          var kid = tag.getAttribute('data-kr');
          var row = newOv && newOv.querySelector('.txf-kr[data-kr="' + kid + '"]');
          if (row && newOv.querySelectorAll('.txf-kr').length > 1) { row.remove(); renumberKR(); }
          else TX.toast && TX.toast('핵심 성과는 최소 1개가 필요합니다.', 'warn');
          return;
        }
        if (k === 'ai') {
          var list2 = newOv && newOv.querySelector('[data-txf="kr-list"]');
          if (list2) {
            var sugg = [
              { name: '신규 기능 기획서 사용자 검증 통과율 90% 달성', mode: 0, weight: 40 },
              { name: '기획 산출물 평균 리드타임 5일 이내 단축', mode: 1, weight: 30 },
              { name: '분기별 사용자 인터뷰 12회 실시', mode: 3, weight: 30 }
            ];
            sugg.forEach(function (s) { list2.insertAdjacentHTML('beforeend', krRowHTML(s)); });
            renumberKR();
            TX.toast && TX.toast('AI가 핵심 성과 3건을 추천했습니다.', 'ok');
          }
          return;
        }
        if (k === 'rv-open') { TX.toast && TX.toast('리뷰 작성 화면은 준비 중입니다.'); return; }
        if (k === 'rv-explorer') {
          TX.modal && TX.modal({ title: '리뷰 탐색기', wide: true,
            body: '<div style="padding:8px 0;color:var(--ink-2);font-size:13.5px;line-height:1.7">리뷰 탐색기에서는 조직·기간·유형별로 리뷰를 검색하고 진행 현황을 한눈에 확인할 수 있습니다.<br>선택한 대상: <b>' + esc(cuEmp.name || '') + '</b> · 기간 <b>2025</b> · 유형 <b>기본 리뷰 양식</b></div>',
            actions: [{ label: '닫기', kind: 'ghost' }] });
          return;
        }
      }
      // pilltabs (fix 7)
      var pill = t.closest('[data-txf-pill]');
      if (pill) {
        activePill = parseInt(pill.getAttribute('data-txf-pill'), 10) || 0;
        goalPage.querySelectorAll('[data-txf-pill]').forEach(function (b) { b.classList.toggle('on', b === pill); });
        renderGoalBody();
        return;
      }
      // org 조직/구성원 tabs
      var otab = t.closest('.txf-orgtabs button');
      if (otab) {
        var card = otab.closest('.orgcard');
        card.querySelectorAll('.txf-orgtabs button').forEach(function (b) { b.classList.toggle('on', b === otab); });
        var isMem = otab.getAttribute('data-t') === 'mem';
        card.querySelector('.txf-org-mem').style.display = isMem ? '' : 'none';
        card.querySelector('.txf-org-org').style.display = isMem ? 'none' : '';
        return;
      }
      // my-goal expandable rows
      var exp = t.closest('.mg.txf-exp');
      if (exp) {
        var det = exp.nextElementSibling;
        if (det && det.classList.contains('txf-detail')) det.style.display = det.style.display === 'none' ? '' : 'none';
        return;
      }
      // org member accordion
      var mem = t.closest('.txf-mem');
      if (mem) {
        var panel = mem.nextElementSibling;
        if (panel && (panel.classList.contains('nogoal') || panel.classList.contains('gbox'))) {
          var open = panel.style.display !== 'none';
          panel.style.display = open ? 'none' : '';
          var cv = mem.querySelector('.cv'); if (cv) cv.textContent = open ? '⌄' : '⌃';
        }
        return;
      }
      // map: tree expand/collapse
      var tg = t.closest('[data-txf-tg]');
      if (tg) {
        ev.stopPropagation();
        var node = tg.closest('.txf-tnode');
        var kids = node && node.querySelector('.txf-tkids');
        if (kids) {
          var hidden = kids.style.display === 'none';
          kids.style.display = hidden ? '' : 'none';
          tg.textContent = hidden ? '⊖' : '⊕';
        }
        return;
      }
      // map: select org
      var orow = t.closest('[data-txf-org]');
      if (orow) {
        mapSel = orow.getAttribute('data-txf-org');
        mapOv.querySelectorAll('[data-txf-org]').forEach(function (r) { r.classList.toggle('sel', r === orow); });
        var on = mapOv.querySelector('[data-txf="map-orgname"]'); if (on) on.textContent = (orgById[mapSel] || {}).name || '';
        var cards = mapOv.querySelector('[data-txf="map-cards"]'); if (cards) cards.innerHTML = mapCardsHTML();
        return;
      }
      // 1:1 meeting: load selected into main pane (fix 10)
      var mi = t.closest('[data-mt]');
      if (mi) {
        var idx = parseInt(mi.getAttribute('data-mt'), 10);
        var page2 = sec.querySelector('.subpage[data-p="2"]');
        page2.querySelectorAll('[data-mt]').forEach(function (x) { x.classList.toggle('on', x === mi); });
        var main = page2.querySelector('.mt-main');
        if (main && meetings[idx]) { main.classList.add('txf-open'); main.innerHTML = meetingDetailHTML(meetings[idx]); }
        return;
      }
    });

    sec.addEventListener('change', function (ev) {
      var t = ev.target;
      if (mapOv && (t.getAttribute && (t.getAttribute('data-txf') === 'map-excl' || t.getAttribute('data-txf') === 'map-period'))) {
        var cards = mapOv.querySelector('[data-txf="map-cards"]'); if (cards) cards.innerHTML = mapCardsHTML();
      }
    });

    /* re-apply after subnav clicks (goals page is static once built, but keep
       overlays closed and pill state consistent when navigating away/back). */
    var subnav = sec.querySelector('.subnav');
    if (subnav) subnav.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[data-p]');
      if (!a) return;
      closeMap(); closeNew();
      if (a.getAttribute('data-p') === '0' && goalPage && !goalPage.querySelector('.txf-goal-body')) {
        buildGoalPage();   // defensive: rebuild if content was lost
      }
    });
  });
})();
