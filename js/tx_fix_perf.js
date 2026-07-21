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
      '#s-perf .txf-krwhy{font-size:11.5px;color:var(--ink-2);background:rgba(31,122,240,.05);border:1px solid rgba(31,122,240,.18);border-radius:7px;padding:6px 9px;margin-top:7px;line-height:1.55}',
      '#s-perf .txf-krwhy b{color:var(--blue,#1F7AF0)}',
      '#s-perf .txf-diffrow{display:flex;gap:8px;align-items:center;margin-top:4px}',
      '#s-perf .txf-diffrow select{width:88px}',
      '#s-perf .txf-diffwhy{font-size:11px;color:var(--ink-3);margin-top:2px;line-height:1.5}',
      '#s-perf .txf-linkrow{display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--ink-2);padding:6px 0;border-bottom:1px solid var(--line-2,#F1F2F5)}',
      '#s-perf .txf-linkrow:last-child{border-bottom:none}',
      '#s-perf .txf-linkchip{display:inline-block;font-size:11px;font-weight:700;color:#356CB5;background:rgba(31,122,240,.08);border-radius:5px;padding:1px 7px}',
      '#s-perf .txf-linkchip.thm{color:#6D28D9;background:rgba(109,40,217,.08)}',
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
      '#s-perf .mt-main.txf-open{align-items:flex-start;justify-content:flex-start;color:var(--ink);padding:26px 30px}',
      /* --- fix 13~16: clickable goal rows · 목표 상세 · 타임라인 · 카드 설정 --- */
      '#s-perf .grow[data-oid]{cursor:pointer}',
      '#s-perf .grow[data-oid]:hover{background:var(--soft)}',
      '#s-perf .fb-card{cursor:pointer}',
      '#s-perf .mgx{width:26px;flex:none;text-align:center;color:var(--ink-4);cursor:pointer;font-size:13px;user-select:none}',
      '#s-perf .mgx:hover{color:var(--ink-2)}',
      '#s-perf .txf-gd .gd-title{font-size:19px;font-weight:800;margin:0 0 12px;line-height:1.4}',
      '#s-perf .txf-gd .gd-meta{display:flex;align-items:center;gap:14px;font-size:13px;color:var(--ink-2);flex-wrap:wrap}',
      '#s-perf .txf-gd .gd-meta b{color:var(--ink)}',
      '#s-perf .txf-gd .gd-prog{display:flex;align-items:center;gap:12px;margin-top:16px}',
      '#s-perf .txf-gd .gd-prog .big{font-size:22px;font-weight:800;color:var(--blue-2)}',
      '#s-perf .txf-gd h3{margin:0 0 12px;font-size:15px;font-weight:800}',
      '#s-perf .txf-krt{width:100%;border-collapse:collapse;font-size:13px}',
      '#s-perf .txf-krt th{text-align:left;color:var(--ink-3);font-weight:700;font-size:12px;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}',
      '#s-perf .txf-krt td{padding:10px;border-bottom:1px solid var(--line-2);color:var(--ink);vertical-align:middle}',
      '#s-perf .txf-tl .ti{position:relative;margin-left:6px;padding:0 0 16px 16px;border-left:2px solid var(--line)}',
      '#s-perf .txf-tl .ti:last-child{border-left-color:transparent;padding-bottom:2px}',
      '#s-perf .txf-tl .ti:before{content:"";position:absolute;left:-6px;top:3px;width:10px;height:10px;border-radius:50%;background:var(--blue);border:2px solid var(--card)}',
      '#s-perf .txf-tl .dt{font-size:12px;color:var(--ink-3);font-weight:700}',
      '#s-perf .txf-tl .dl{font-size:12px;font-weight:800;color:var(--green);margin-left:8px}',
      '#s-perf .txf-tl .nt2{font-size:13px;color:var(--ink-2);margin-top:3px;line-height:1.55}',
      '#s-perf .txf-cm{display:flex;gap:10px;padding:11px 0;border-top:1px solid var(--line-2);font-size:13px;color:var(--ink-2);align-items:flex-start}',
      '#s-perf .txf-cm .w{font-weight:700;color:var(--ink)}',
      '#s-perf .txf-cm .d{color:var(--ink-4);font-size:12px}',
      '#s-perf .orgcard.txf-hide-stat .orgstat{display:none}',
      '#s-perf .orgcard.txf-hide-ctrl .orgctrl{display:none}',
      '#s-perf .orgcard.txf-nobar .txf-mem .membar,#s-perf .orgcard.txf-nobar .txf-mem .p{display:none}',
      /* modal/drawer content lives outside #s-perf — unscoped */
      '.txf-rr{display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:1px solid var(--line-2);font-size:13.5px}',
      '.txf-rr .no{width:20px;color:var(--ink-3);font-weight:700;flex:none}',
      '.txf-rr .tt{flex:1;font-weight:600;min-width:0}',
      '.txf-rr .mv{width:26px;height:26px;border:1px solid var(--line);border-radius:6px;background:var(--card);cursor:pointer;color:var(--ink-2)}',
      '.txf-rr .mv:disabled{opacity:.35;cursor:default}',
      '.txf-rx{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);border-radius:14px;padding:4px 11px;font-size:12.5px;background:var(--card);cursor:pointer;color:var(--ink-2)}',
      '.txf-rx:hover{background:var(--soft)}'
    ].join('\n');
    if (!document.getElementById('txf-perf-style')) sec.appendChild(css);

    /* ============================================================= *
     *  목표 (data-p=0) — full data-driven rebuild                    *
     * ============================================================= */
    var goalPage = sec.querySelector('.subpage[data-p="0"]');
    var activePill = 1;   // 0 요약 · 1 소속기준(default) · 2 역할기준 · 3 전체

    var goalOrder = null;       // fix 16: user-defined ordering (⇅ 순서 변경)
    function myObjectives() {   // fix 6: only objectives the CU actually owns
      var list = (objByOwner[CU.emp_id] || []).slice();
      if (goalOrder) list.sort(function (a, b) {
        function ix(o) { var i = goalOrder.indexOf(o.objective_id); return i < 0 ? 999 : i; }
        return ix(a) - ix(b);
      });
      return list;
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
        return '<div class="mg txf-exp" data-oid="' + o.objective_id + '">'
          + '<div class="nm"><div class="t1">' + esc(o.title)
          + (ck ? ' <span class="supn">체크인 ' + ck + '건</span>' : '') + '</div>'
          + '<div class="t2">' + typeBadge(o) + '</div></div>'
          + '<span class="w">' + weights[i] + '%</span>'
          + '<span class="s">' + statusChip(o) + '</span>'
          + '<span class="bw">' + bar(p) + '</span>'
          + '<span class="p">' + pct(p) + '</span>'
          + (withDetail ? '<span class="mgx" title="핵심 성과 펼치기">⌄</span>' : '')
          + '</div>' + det;
      }).join('');
      if (!mine.length) rows = '<div class="nogoal">등록된 목표가 없습니다.</div>';
      var guard = wsum === 100
        ? '<span class="txf-sumtag">✓ 가중치 합 ' + wsum + '%</span>'
        : '<span class="txf-sumtag bad">⚠ 가중치 합 ' + wsum + '% (100%가 아닙니다)</span>';
      return '<div class="mycard">'
        + '<div class="mt"><h3>나의 목표</h3>'
        + '<div class="r"><span class="ck">✓ 전체 <b>' + mine.length + '</b></span><span>· 조직 <b>' + org + '</b></span><span>· 개인 <b>' + per + '</b></span></div></div>'
        + '<div class="mysub"><button class="ghost-btn" data-txf="reorder">⇅ 순서 변경</button>'
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
                return '<div class="grow" data-oid="' + x.objective_id + '"><span class="gn">' + esc(x.title) + ' ' + typeBadge(x) + '</span>'
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
              return '<div class="grow" data-oid="' + x.objective_id + '"><span class="gn">' + esc(x.title) + '</span><span class="gw">' + esc(x.status || '진행중')
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
        + '<div class="orgctrl"><span class="tog"></span><span class="toglbl">핵심 성과</span><button class="ghost-btn" data-txf="expandall">전체 열기</button></div>'
        + '<div class="txf-org-mem">' + memRows + '</div>'
        + '<div class="txf-org-org" style="display:none">' + orgTab + '</div>'
        + '</div>';
    }

    function roleCard() {   // 역할 기준 — group my objectives under my job role
      var mine = myObjectives();
      var role = cuEmp.jobTitle || '담당';
      var rows = mine.length ? mine.map(function (o) {
        var p = objProgress(o);
        return '<div class="grow" data-oid="' + o.objective_id + '"><span class="gn">' + esc(o.title) + ' ' + typeBadge(o) + '</span>'
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
        return '<div class="grow" data-oid="' + o.objective_id + '"><span class="gn">' + esc(o.title) + ' ' + typeBadge(o) + ' ' + statusChip(o) + '</span>'
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
          + '<div class="cardset"><button class="ghost-btn" data-txf="cardset">조직 카드 설정</button></div>'
          + ancestorOrgs(cuEmp.org_id).map(orgCard).join('');
      }
      host.innerHTML = html;
      applyCardPrefs();
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

    /* fix 14: 피드백 카드 클릭 → 상세 drawer */
    function openFeedbackDetail(card) {
      var ttlEl = card.querySelector('.fb-ttl');
      var sndEl = card.querySelector('.fb-from b');
      var bodyEl = card.querySelector('.fb-body');
      var relEl = card.querySelector('.rel-goal');
      var foot = card.querySelectorAll('.fb-foot span');
      var sender = sndEl ? sndEl.textContent.trim() : '알 수 없음';
      var dateTxt = foot.length ? foot[foot.length - 1].textContent.replace(/^[^0-9]*/, '').trim() : '';
      var likes = 0;
      if (foot.length) { var lm = foot[0].textContent.match(/\d+/); likes = lm ? parseInt(lm[0], 10) : 0; }
      var relTxt = relEl ? relEl.textContent.replace(/^관련 목표/, '').trim() : '';
      var el = document.createElement('div');
      el.innerHTML =
        '<div style="display:flex;align-items:center;gap:10px;padding-bottom:14px;border-bottom:1px solid var(--line)">'
        + (F.avatar ? F.avatar(sender, 40) : '')
        + '<div><div style="font-weight:800;font-size:14.5px">보낸 사람 · ' + esc(sender) + '</div>'
        + '<div style="font-size:12px;color:var(--ink-3);margin-top:2px">' + esc(dateTxt || '날짜 미상') + '</div></div></div>'
        + '<div style="font-size:12.5px;font-weight:700;color:var(--ink-3);margin:16px 0 6px">전체 내용</div>'
        + '<div style="font-size:13.5px;line-height:1.7;color:var(--ink);background:var(--soft);border-radius:8px;padding:14px 16px">'
        + esc(ttlEl ? ttlEl.textContent.trim() : '') + '<br><br>' + esc(bodyEl ? bodyEl.textContent.trim() : '') + '</div>'
        + (relTxt
            ? '<div style="font-size:12.5px;font-weight:700;color:var(--ink-3);margin:16px 0 6px">관련 목표</div>'
              + '<span style="display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:14px;padding:5px 12px;font-size:12.5px;color:var(--blue-2);font-weight:700">🎯 ' + esc(relTxt) + '</span>'
            : '')
        + '<div style="font-size:12.5px;font-weight:700;color:var(--ink-3);margin:16px 0 8px">리액션</div>'
        + '<div style="display:flex;gap:8px">'
        + '<button class="txf-rx">👍 <i style="font-style:normal">' + (likes + 3) + '</i></button>'
        + '<button class="txf-rx">👏 <i style="font-style:normal">' + (likes + 1) + '</i></button>'
        + '<button class="txf-rx">💙 <i style="font-style:normal">' + likes + '</i></button></div>';
      el.addEventListener('click', function (e) {
        var b = e.target.closest('.txf-rx');
        if (b) { var n = b.querySelector('i'); if (n) n.textContent = parseInt(n.textContent, 10) + 1; }
      });
      if (TX.drawer) TX.drawer({ title: '피드백 상세', subtitle: sender + ' 님이 보낸 피드백', body: el, width: 420 });
      else if (TX.modal) TX.modal({ title: '피드백 상세', body: el, actions: [{ label: '닫기', kind: 'ghost' }] });
    }

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

    function mtListHTML(list) {
      return list.map(function (m, i) {
        var e = m.emp;
        return '<div class="txf-mt-item' + (i === 0 ? ' on' : '') + '" data-mt="' + i + '">'
          + (F.avatar ? F.avatar(e.name, 34) : '')
          + '<div><div class="nm">' + esc(F.nameTeam ? F.nameTeam(e) : e.name) + '</div>'
          + '<div class="meta"><span>🏳 ' + m.flags + '</span><span>💬 ' + m.comments + '</span></div>'
          + '<div class="date">' + esc(m.date) + '</div></div></div>';
      }).join('');
    }

    /* fix 15: 1:1 미팅 segtabs — tab별 대체 리스트 */
    var curMt = meetings;                 // list backing the visible tab
    var mtTabs = [meetings, null, null];
    function makeAltMeeting(e, date, seed) {
      var eobj = (objByOwner[e.emp_id] || [])[0];
      var c = (chkByEmp[e.emp_id] || [])[0] || {};
      return {
        emp: e, date: date, flags: seed % 3, comments: (seed + 1) % 2,
        agenda: [
          '2분기 목표 진행 상황 리뷰 — ' + (eobj ? eobj.title : '분기 핵심 과제'),
          '핵심 성과 KR 체크인 및 리스크 점검',
          '협업 프로세스 및 커뮤니케이션 개선 논의'
        ],
        notes: c.comment || '분기 목표 진행 상황을 공유하고 우선순위를 재정렬했습니다. 특이 리스크 없음.',
        actions: ['논의 안건 후속 정리 — ' + e.name, '다음 1:1 전까지 KR 진행률 업데이트']
      };
    }
    function tabMeetings(idx) {
      if (mtTabs[idx]) return mtTabs[idx];
      var pool = idx === 1
        ? emps.filter(function (e) { return e.manager_id === CU.emp_id; }).slice(0, 3)
        : (empByOrg[cuEmp.org_id] || []).filter(function (e) { return e.emp_id !== CU.emp_id; }).slice(0, 3);
      if (!pool.length) pool = (empByOrg[cuEmp.org_id] || []).filter(function (e) { return e.emp_id !== CU.emp_id; }).slice(0, 2);
      var dates = idx === 1
        ? ['7월 2일 목요일 오전 11:00', '6월 24일 수요일 오후 3:30', '6월 11일 목요일 오전 9:30']
        : ['6월 30일 화요일 오후 4:00', '6월 18일 목요일 오전 10:30', '6월 3일 수요일 오후 2:00'];
      mtTabs[idx] = pool.map(function (e, i) { return makeAltMeeting(e, dates[i] || dates[0], idx * 10 + i); });
      return mtTabs[idx];
    }
    function renderMeetingTab(idx) {
      var page = sec.querySelector('.subpage[data-p="2"]');
      if (!page) return;
      curMt = tabMeetings(idx);
      var side = page.querySelector('.mt-side');
      if (side) {
        side.querySelectorAll('.txf-mt-item').forEach(function (n) { n.remove(); });
        side.insertAdjacentHTML('beforeend', mtListHTML(curMt));
      }
      var main = page.querySelector('.mt-main');
      if (main) {
        main.classList.add('txf-open');
        main.innerHTML = curMt.length ? meetingDetailHTML(curMt[0])
          : '<div style="color:var(--ink-3);font-size:13.5px;padding:20px 0">'
            + (idx === 1 ? '내가 관리자인 1:1 미팅이 없습니다.' : '열람 가능한 1:1 미팅이 없습니다.') + '</div>';
      }
    }

    (function buildMeetingPage() {
      var page = sec.querySelector('.subpage[data-p="2"]');
      if (!page) return;
      page.innerHTML = '<div class="mt-wrap">'
        + '<div class="mt-main txf-open">' + (meetings.length ? meetingDetailHTML(meetings[0]) : '선택한 1:1 미팅이 없습니다.') + '</div>'
        + '<div class="mt-side"><div class="sh"><h3>1:1 미팅</h3><span class="plus">+</span></div>'
        + '<div class="segtabs"><button class="on">나의 1:1 미팅</button><button>내가 관리자인 1:1 미팅</button><button>내가 열람할 수 있는 1:1 미팅</button></div>'
        + mtListHTML(meetings) + '</div></div>';
    })();

    /* ============================================================= *
     *  리뷰 (data-p=3) — generate rows from data (fix 11)            *
     * ============================================================= */
    var rvMgrs = [empById['EMP-0010'], empById['EMP-0001'], empById['EMP-0008']].filter(Boolean);
    if (!rvMgrs.length) rvMgrs = emps.slice(0, 3);
    function rvBadge(label) {
      if (label === '완료') return '<span class="badge" style="background:#E4F5EC;color:var(--green)">완료</span>';
      if (label === '작성 중') return '<span class="badge" style="background:#FFF4E5;color:#B45309">작성 중</span>';
      return '<span class="badge" style="background:var(--blue-soft);color:var(--blue-2)">시작 이전</span>';
    }
    function rvRowHTML(tgt, mgr, badgeLabel, act) {
      return '<div class="rv-row"><div class="rv-info">'
        + '<div class="tt">기본 리뷰 양식</div>'
        + '<div class="yr">2025 ' + rvBadge(badgeLabel) + '</div>'
        + '<div class="rv-people">'
        + '<div class="g"><span class="lb">대상자</span>' + (F.avatar ? F.avatar(tgt.name, 22) : '') + '<span class="nm">' + esc(F.nameTeam ? F.nameTeam(tgt) : tgt.name) + '</span></div>'
        + '<div class="g"><span class="lb">관리자</span>' + (F.avatar ? F.avatar(mgr.name, 22) : '') + '<span class="nm">' + esc(F.nameTeam ? F.nameTeam(mgr) : mgr.name) + '</span></div>'
        + '</div></div>'
        + '<button class="rv-act' + (act === '확인' ? ' ghost' : '') + '" data-txf="rv-open">' + act + '</button></div>';
    }
    function rvRowsHTML(tab) {   // fix 15: 리뷰 segtabs — tab별 리스트
      if (tab === 1) {           // 내가 관리자인 리뷰
        var subs = emps.filter(function (e) { return e.manager_id === CU.emp_id; }).slice(0, 3);
        if (!subs.length) subs = (empByOrg[cuEmp.org_id] || []).filter(function (e) { return e.emp_id !== CU.emp_id; }).slice(0, 3);
        return subs.map(function (e, i) { return rvRowHTML(e, cuEmp, i === 0 ? '완료' : '시작 이전', i === 0 ? '확인' : '작성'); }).join('')
          || '<div class="nogoal">내가 관리자인 리뷰가 없습니다.</div>';
      }
      if (tab === 2) {           // 내가 열람할 수 있는 리뷰
        var peers = (empByOrg[cuEmp.org_id] || []).filter(function (e) { return e.emp_id !== CU.emp_id; }).slice(0, 2);
        return peers.map(function (e, i) { return rvRowHTML(e, rvMgrs[i % rvMgrs.length], '완료', '확인'); }).join('')
          || '<div class="nogoal">열람 가능한 리뷰가 없습니다.</div>';
      }
      var rows = '';             // 나의 리뷰 (기본)
      for (var i = 0; i < 6; i++) {
        var doneRow = i === 5;
        rows += rvRowHTML(cuEmp, rvMgrs[i % rvMgrs.length], doneRow ? '완료' : '시작 이전', doneRow ? '확인' : '작성');
      }
      return rows;
    }
    function renderReviewTab(idx) {
      var page = sec.querySelector('.subpage[data-p="3"]');
      var cardEl = page && page.querySelector('.rv-card');
      if (!cardEl) return;
      cardEl.querySelectorAll('.rv-row, .nogoal').forEach(function (n) { n.remove(); });
      cardEl.insertAdjacentHTML('beforeend', rvRowsHTML(idx));
    }

    (function buildReviewPage() {
      var page = sec.querySelector('.subpage[data-p="3"]');
      if (!page) return;
      var rows = rvRowsHTML(0);
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
        + '<div class="txf-sub">난이도 · 난이도 근거</div>'
        + '<div class="txf-diffrow"><select class="txf-inp txf-krdiff">'
        + ['S', 'A', 'B'].map(function (d) {
            return '<option value="' + d + '"' + ((data.diff || 'A') === d ? ' selected' : '') + '>' + d + '</option>';
          }).join('')
        + '</select>'
        + '<input class="txf-inp txf-krdiffwhy" placeholder="난이도 근거 — 예: 전년 실적 대비 +30% 상향" value="' + esc(data.diffwhy || '') + '"></div>'
        + '<div class="txf-diffwhy">ⓘ 무엇과 비교해 어려운지(작년 실적·동료 수준) 남겨야 평가 시점의 난이도 반영이 가능합니다.</div>'
        + (data.why ? '<div class="txf-krwhy">✦ 이 KR의 근거 — ' + data.why + '</div>' : '')
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
        + (window.EZJob && EZJob.panelHTML ? EZJob.panelHTML(cuEmp) : '')
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
     *  세부 목표 (goal detail) overlay — fix 13                       *
     * ============================================================= */
    var gdOv;
    function goalTimeline(o) {   // real checkins first, deterministic synthesis otherwise
      var real = (chkByObj[o.objective_id] || []).slice()
        .sort(function (a, b) { return String(b.checkin_date || '').localeCompare(String(a.checkin_date || '')); })
        .slice(0, 4)
        .map(function (c) { return { date: c.checkin_date || '', note: c.comment || '체크인 업데이트', delta: c.progress_delta || 0 }; });
      if (real.length >= 3) return real;
      var p = Math.round(objProgress(o));
      var seed = parseInt(String(o.objective_id).replace(/\D/g, ''), 10) || 1;
      var dates = ['2026-04-10', '2026-05-08', '2026-06-05', '2026-07-03'];
      var notes = [
        '주요 산출물 초안 공유 완료, 이해관계자 리뷰 진행 중입니다.',
        '일정 지연 리스크를 식별하여 우선순위를 재조정했습니다.',
        '중간 점검 결과 목표 대비 순항 중입니다. 다음 단계에 착수합니다.',
        '협업 부서 의존성 이슈를 해소하고 진행 속도를 회복했습니다.'
      ];
      var out = [];
      for (var i = 0; i < 4; i++) {
        out.push({
          date: dates[i],
          note: notes[(seed + i) % notes.length],
          delta: Math.round(p * (i + 1) / 4) - Math.round(p * i / 4)
        });
      }
      return out;
    }
    /* ---------- fix 18: 체크인 승인 플로우 (실앱 패턴) + AI 진척 감지 ---------- */
    function ckKey(oid) { return 'txf_ckreq_' + oid; }
    function ckPending(oid) {
      try { var v = sessionStorage.getItem(ckKey(oid)); return v ? JSON.parse(v) : null; } catch (e) { return null; }
    }
    function ckSave(oid, d) {
      try {
        if (d) sessionStorage.setItem(ckKey(oid), JSON.stringify(d));
        else sessionStorage.removeItem(ckKey(oid));
      } catch (e) { /* ignore */ }
    }
    function openCheckinModal(o, aiDraft) {
      var ks = krByObj[o.objective_id] || [];
      var rows = ks.map(function (k, i) {
        var cur = k.current_value != null ? k.current_value : Math.round((k.progress || 0));
        var sug = aiDraft ? (parseFloat(cur) || 0) + 4 + (i % 3) : cur;
        return '<div style="display:flex;align-items:center;gap:9px;padding:8px 2px;border-bottom:1px solid var(--line-2)">'
          + '<span style="flex:1;font-size:13px;font-weight:600">' + esc(k.name) + '</span>'
          + '<input type="number" data-ck-kr="' + esc(k.kr_id) + '" value="' + sug + '" style="width:92px;text-align:right;border:1px solid #D0D5DD;border-radius:7px;padding:6px 8px;font:inherit;font-size:13px">'
          + '<span style="font-size:12px;color:var(--ink-3)">/ ' + esc(k.target_value || '100') + '</span></div>';
      }).join('');
      var draftNote = aiDraft
        ? '주간 업무보드 완료 3건과 6/30 1:1 합의사항 이행을 반영해 진척값을 업데이트합니다. (elizax 자동 감지 초안)'
        : '';
      TX.modal({
        title: '체크인 — ' + o.title,
        wide: true,
        body: (aiDraft ? '<div style="font-size:12px;color:#356CB5;background:rgba(31,122,240,.07);border:1px solid rgba(31,122,240,.25);border-radius:8px;padding:8px 11px;margin-bottom:10px">✦ <b>suggest</b> · elizax가 1:1 노트·업무보드에서 감지한 진척 신호로 초안을 채웠습니다. 값은 언제든 고칠 수 있고, 반영은 관리자 승인 후입니다.</div>' : '')
          + rows
          + '<div style="margin-top:11px"><div style="font-size:12px;font-weight:700;color:var(--ink-2);margin-bottom:5px">코멘트 <span style="color:var(--ink-4);font-weight:500">— 요청 사유를 남기면 관리자가 빠르게 판단할 수 있습니다</span></div>'
          + '<textarea data-ck-cm style="width:100%;min-height:76px;border:1px solid #D0D5DD;border-radius:8px;padding:9px;font:inherit;font-size:13px" placeholder="이번 체크인에서 반영한 변경 사항을 적어주세요.">' + esc(draftNote) + '</textarea></div>',
        actions: [
          { label: '취소', kind: 'ghost' },
          { label: '체크인 · 승인 요청', kind: 'primary', onClick: function (box) {
              var vals = {};
              box.querySelectorAll('[data-ck-kr]').forEach(function (inp) { vals[inp.getAttribute('data-ck-kr')] = inp.value; });
              var cm = box.querySelector('[data-ck-cm]');
              ckSave(o.objective_id, { vals: vals, comment: cm ? cm.value : '', at: '2026-07-15', ai: !!aiDraft });
              openGoalDetail(o.objective_id);
              TX.toast && TX.toast('체크인 승인을 요청했습니다. 관리자 승인 후 진행률에 반영됩니다.', 'ok');
            } }
        ]
      });
    }

    /* 목표–직무–전략 연결 근거 — "직무 내용 없이 도출된 목표는 기초가 없다" */
    function goalLinksHTML(o, ks) {
      var themes = D.strategyThemes || [];
      var th = null;
      themes.forEach(function (t) { if (t.theme_id === o.strategy_theme_id) th = t; });
      var jp = o.job_ref && (D.jobProfiles || {})[o.job_ref.jobProfileId];
      var compName = {};
      (D.competencies || []).forEach(function (c) { compName[c.dimension_id] = c.name; });
      if (!th && !jp && !ks.some(function (k) { return k.job_task_ref; })) return '';
      var head = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">'
        + (th ? '<span class="txf-linkchip thm">전략 · ' + esc(th.name) + '</span>' : '')
        + (jp ? '<span class="txf-linkchip">직무 · ' + esc(jp.title) + (o.job_ref.task_area ? ' › ' + esc(o.job_ref.task_area) : '') + '</span>' : '')
        + '</div>';
      var rows = ks.filter(function (k) { return k.job_task_ref || k.competency_id; }).map(function (k) {
        var r = k.job_task_ref || {};
        return '<div class="txf-linkrow"><b style="min-width:0;flex:1">' + esc(k.name) + '</b>'
          + (r.task_area ? '<span class="txf-linkchip">직무 과업 · ' + esc(r.task_area) + '</span>' : '')
          + (k.competency_id ? '<span class="txf-linkchip" style="color:#166534;background:rgba(47,163,107,.1)">역량 · ' + esc(compName[k.competency_id] || k.competency_id) + '</span>' : '')
          + '</div>';
      }).join('');
      return '<div class="txf-fcard"><h3>연결 근거 — 이 목표가 서 있는 자리</h3>' + head + rows
        + '<div style="font-size:11.5px;color:var(--ink-3);margin-top:8px">ⓘ 전략 테마 · 직무 과업 · 역량과의 연결은 평가 단계에서 "왜 이 목표였는가"의 근거가 됩니다. <span data-ezjc="map" style="color:var(--blue,#1F7AF0);font-weight:700;cursor:pointer">🧭 연결 지도에서 전체 보기</span></div></div>';
    }
    function goalDetailHTML(o) {
      var owner = empById[o.owner_emp_id] || {};
      var org = orgById[owner.org_id || o.org_id] || {};
      var p = objProgress(o);
      var ks = krByObj[o.objective_id] || [];
      var pend = ckPending(o.objective_id);
      var krRows = ks.length ? ks.map(function (k) {
        var kp = k.progress || 0;
        var cur = k.current_value != null ? String(k.current_value) : '—';
        var deltaChip = '';
        if (pend && pend.vals && pend.vals[k.kr_id] != null) {
          var dv = (parseFloat(pend.vals[k.kr_id]) || 0) - (parseFloat(k.current_value) || 0);
          if (dv !== 0) deltaChip = ' <span style="font-size:11px;font-weight:800;color:#1F7AF0;background:rgba(31,122,240,.09);border-radius:5px;padding:1px 6px">' + (dv > 0 ? '+' : '') + Math.round(dv * 10) / 10 + '</span>';
        }
        return '<tr><td style="font-weight:600">' + esc(k.name) + '</td>'
          + '<td>' + esc(k.target_value || '—') + '</td>'
          + '<td>' + esc(cur) + deltaChip + '</td>'
          + '<td>' + wnum(k) + '%</td>'
          + '<td style="white-space:nowrap">' + bar(kp, 110) + ' <b>' + pct(kp) + '</b></td>'
          + '<td' + (k.difficulty_basis ? ' title="' + esc(k.difficulty_basis.note || '') + '"' : '') + '>'
          + '<b>' + esc(k.difficulty || '—') + '</b>'
          + (k.difficulty_basis ? '<div style="font-size:10.5px;color:var(--ink-3);line-height:1.4;margin-top:2px;max-width:150px">' + esc(k.difficulty_basis.label || '') + '</div>' : '')
          + '</td></tr>';
      }).join('') : '<tr><td colspan="6" style="color:var(--ink-3)">등록된 핵심 성과가 없습니다.</td></tr>';
      var tl = goalTimeline(o).map(function (c) {
        return '<div class="ti"><span class="dt">' + esc(c.date) + '</span>'
          + '<span class="dl">+' + Math.round(c.delta) + '%</span>'
          + '<div class="nt2">' + esc(c.note) + '</div></div>';
      }).join('');
      var mgr = empById[owner.manager_id] || {};
      var peer = ((empByOrg[owner.org_id] || []).filter(function (e) { return e.emp_id !== owner.emp_id; })[0]) || {};
      var cms = [
        { w: mgr.name || '김수민', d: '6월 28일', t: '진행 상황 공유 감사합니다. 지연 리스크 항목은 다음 1:1에서 함께 논의하시죠.' },
        { w: peer.name || '동료', d: '7월 3일', t: '관련 지표를 최신 대시보드 수치 기준으로 맞췄습니다. 확인 부탁드립니다.' }
      ];
      var cmHTML = cms.map(function (c) {
        return '<div class="txf-cm">' + (F.avatar ? F.avatar(c.w, 28) : '')
          + '<div><span class="w">' + esc(c.w) + '</span> <span class="d">' + esc(c.d) + '</span>'
          + '<div style="margin-top:3px">' + esc(c.t) + '</div></div></div>';
      }).join('');
      var isOwner = o.owner_emp_id === CU.emp_id;
      var pendPill = pend
        ? '<span style="display:inline-block;font-size:11px;font-weight:800;color:#5A6472;background:#EDF1F7;border:1px solid #D9E0EB;border-radius:999px;padding:3px 10px;margin-bottom:7px">⏳ 체크인 승인 요청 중' + (pend.ai ? ' · ✦ AI 초안' : '') + '</span><br>'
        : '';
      var ckBtns = pend
        ? '<button class="ghost-btn" data-txf="gd-ckcancel" style="color:#B42318;border-color:rgba(180,35,24,.35)">요청 취소</button>'
        : (isOwner ? '<button class="btn-blue" data-txf="gd-checkin">체크인</button>' : '');
      var aiCard = (!pend && isOwner)
        ? '<div class="txf-fcard" style="border:1px solid rgba(31,122,240,.3);background:rgba(31,122,240,.03)">'
          + '<div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">'
          + '<span style="font-size:10.5px;font-weight:800;color:#356CB5;background:rgba(31,122,240,.1);border-radius:4px;padding:2px 7px">● 제안만</span>'
          + '<b style="font-size:13.5px">✦ elizax가 진척 신호를 감지했습니다</b></div>'
          + '<p style="font-size:12.5px;color:var(--ink-2);line-height:1.6;margin:7px 0 9px">주간 업무보드 완료 3건 · 6/30 1:1 합의사항 이행 확인 — 마지막 체크인 이후 12일이 지났습니다. 감지한 신호로 체크인 초안을 만들어 드릴까요? <span style="color:var(--ink-4)">근거: 업무보드 <b>tsk.wb-0715</b> · 1:1 노트 <b>memo.0630</b> · 감사 기록됨</span></p>'
          + '<div style="display:flex;gap:7px"><button class="btn-blue" data-txf="gd-aick">체크인 초안 열기</button>'
          + '<button class="ghost-btn" data-txf="gd-aidismiss">무시</button></div></div>'
        : '';
      return '<div class="txf-ovhead"><button class="bk" data-txf="gd-close">←</button><h2>목표 상세</h2>'
        + '<div class="sp">' + ckBtns + '<button class="ghost-btn" data-txf="gd-close">닫기</button></div></div>'
        + '<div class="txf-ovbody"><div class="txf-gd">'
        + '<div class="txf-fcard">' + pendPill + '<div class="gd-title">' + esc(o.title) + '</div>'
        + '<div class="gd-meta">'
        + '<span style="display:inline-flex;align-items:center;gap:7px">' + (F.avatar ? F.avatar(owner.name || '?', 26) : '')
        + '<b>' + esc(owner.name || '미지정') + '</b>' + (org.name ? ' · ' + esc(org.name) : '') + '</span>'
        + '<span>기간 <b>' + esc(o.period || 'FY2026') + '</b></span>'
        + typeBadge(o) + statusChip(o) + '</div>'
        + '<div class="gd-prog"><span class="big">' + pct(p) + '</span>' + bar(p, 260)
        + '<span style="font-size:12px;color:var(--ink-3)">핵심 성과 ' + ks.length + '개 · 체크인 ' + (chkByObj[o.objective_id] || []).length + '건</span></div></div>'
        + aiCard
        + '<div class="txf-fcard"><h3>핵심 성과</h3><table class="txf-krt"><thead><tr>'
        + '<th>KR명</th><th>목표값</th><th>현재값</th><th>가중치</th><th>진행률</th><th>난이도</th></tr></thead><tbody>' + krRows + '</tbody></table></div>'
        + goalLinksHTML(o, ks)
        + '<div class="txf-fcard"><h3>체크인 타임라인</h3><div class="txf-tl">' + tl + '</div></div>'
        + '<div class="txf-fcard"><h3>코멘트 · 활동</h3>' + cmHTML + '</div>'
        + '<div style="display:flex;justify-content:flex-end;margin:4px 0 20px"><button class="btn-blue" data-txf="gd-close">닫기</button></div>'
        + '</div></div>';
    }
    function openGoalDetail(oid) {
      var o = objById[oid]; if (!o) return;
      if (!gdOv) {
        gdOv = document.createElement('div');
        gdOv.className = 'txf-ov'; gdOv.setAttribute('data-txf-ov', 'goal');
        sec.appendChild(gdOv);
      }
      gdOv.innerHTML = goalDetailHTML(o);
      gdOv.setAttribute('data-oid', oid);
      gdOv.classList.add('open');
      gdOv.scrollTop = 0;
    }
    function closeGoalDetail() { if (gdOv) gdOv.classList.remove('open'); }

    /* ============================================================= *
     *  fix 16: 순서 변경 · 전체 열기 · 조직 카드 설정 · 리뷰 작성       *
     * ============================================================= */
    function openReorderModal() {
      var list = myObjectives().map(function (o) { return o.objective_id; });
      var body = document.createElement('div');
      function draw() {
        body.innerHTML = list.length ? list.map(function (id, i) {
          var o = objById[id];
          return '<div class="txf-rr" data-i="' + i + '"><span class="no">' + (i + 1) + '</span>'
            + '<span class="tt">' + esc(o ? o.title : id) + '</span>'
            + '<button class="mv" data-mv="up"' + (i === 0 ? ' disabled' : '') + '>▲</button>'
            + '<button class="mv" data-mv="dn"' + (i === list.length - 1 ? ' disabled' : '') + '>▼</button></div>';
        }).join('') : '<div style="color:var(--ink-3);font-size:13px">순서를 변경할 목표가 없습니다.</div>';
      }
      draw();
      body.addEventListener('click', function (e) {
        var b = e.target.closest('.mv'); if (!b) return;
        var i = parseInt(b.closest('.txf-rr').getAttribute('data-i'), 10);
        var j = b.getAttribute('data-mv') === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= list.length) return;
        var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
        draw();
      });
      TX.modal && TX.modal({
        title: '목표 순서 변경', body: body,
        actions: [
          { label: '취소', kind: 'ghost' },
          { label: '저장', kind: 'primary', onClick: function () {
              goalOrder = list.slice();
              renderGoalBody();
              TX.toast && TX.toast('목표 순서를 변경했습니다.', 'ok');
            } }
        ]
      });
    }

    var cardPrefs = { stat: true, ctrl: true, bar: true };
    function applyCardPrefs() {
      if (!goalPage || !cardPrefs) return;   // guarded: callable before init line runs
      goalPage.querySelectorAll('.orgcard').forEach(function (c) {
        c.classList.toggle('txf-hide-stat', !cardPrefs.stat);
        c.classList.toggle('txf-hide-ctrl', !cardPrefs.ctrl);
        c.classList.toggle('txf-nobar', !cardPrefs.bar);
      });
    }
    function openCardSettings() {
      var defs = [['stat', '진행 현황 요약 표시'], ['ctrl', '핵심 성과 컨트롤 바 표시'], ['bar', '구성원 진행률 바 표시']];
      var body = document.createElement('div');
      body.innerHTML = '<div style="font-size:12.5px;color:var(--ink-3);margin-bottom:6px">조직 카드에 표시할 항목을 선택합니다.</div>'
        + defs.map(function (d) {
            return '<label style="display:flex;align-items:center;gap:8px;margin:9px 0;font-size:13.5px;cursor:pointer">'
              + '<input type="checkbox" data-pref="' + d[0] + '" style="width:15px;height:15px;accent-color:var(--blue)"'
              + (cardPrefs[d[0]] ? ' checked' : '') + '> ' + d[1] + '</label>';
          }).join('');
      TX.modal && TX.modal({
        title: '조직 카드 설정 — 표시 항목', body: body,
        actions: [
          { label: '취소', kind: 'ghost' },
          { label: '적용', kind: 'primary', onClick: function () {
              body.querySelectorAll('[data-pref]').forEach(function (i) { cardPrefs[i.getAttribute('data-pref')] = i.checked; });
              applyCardPrefs();
              TX.toast && TX.toast('조직 카드 표시 항목을 적용했습니다.', 'ok');
            } }
        ]
      });
    }

    function toggleAllMembers(btn) {   // 전체 열기 ↔ 전체 닫기
      var oc = btn.closest('.orgcard'); if (!oc) return;
      var openAll = btn.textContent.indexOf('열기') >= 0;
      oc.querySelectorAll('.txf-mem').forEach(function (m) {
        var pn = m.nextElementSibling;
        if (pn && (pn.classList.contains('gbox') || pn.classList.contains('nogoal'))) {
          pn.style.display = openAll ? '' : 'none';
          var cv = m.querySelector('.cv'); if (cv) cv.textContent = openAll ? '⌃' : '⌄';
        }
      });
      btn.textContent = openAll ? '전체 닫기' : '전체 열기';
    }

    function setRvBadge(row, label) {
      var b = row.querySelector('.badge'); if (!b) return;
      if (label === '완료') { b.style.background = '#E4F5EC'; b.style.color = 'var(--green)'; }
      else if (label === '작성 중') { b.style.background = '#FFF4E5'; b.style.color = '#B45309'; }
      else { b.style.background = 'var(--blue-soft)'; b.style.color = 'var(--blue-2)'; }
      b.textContent = label;
    }
    function newReviewRow(badgeLabel, act) {
      var page = sec.querySelector('.subpage[data-p="3"]');
      var sort = page && page.querySelector('.rv-sort');
      if (sort) sort.insertAdjacentHTML('afterend', rvRowHTML(cuEmp, rvMgrs[0] || cuEmp, badgeLabel, act));
    }
    function openReviewWrite(btn) {
      var row = btn && btn.closest ? btn.closest('.rv-row') : null;
      var isCreate = !row;
      var done = !!(row && row.querySelector('.badge') && row.querySelector('.badge').textContent === '완료');
      var tgtEl = row && row.querySelector('.rv-people .g .nm');
      var tgt = tgtEl ? tgtEl.textContent.trim() : (F.nameTeam ? F.nameTeam(cuEmp) : cuEmp.name);
      var o0 = myObjectives()[0];
      var draft = '[2025 기본 리뷰 초안]\n\n1. 주요 성과\n- ' + (o0 ? o0.title : '핵심 목표') + ' 진행률 ' + pct(o0 ? objProgress(o0) : 0)
        + ' 달성\n- 체크인 기반 리스크 조기 공유로 일정 지연 최소화\n\n2. 보완할 점\n- KR 측정 주기를 격주 단위로 단축하여 편차 조기 감지\n\n3. 다음 기간 목표\n- 하반기 핵심 과제 우선순위 재정렬 및 협업 프로세스 개선';
      var body = document.createElement('div');
      body.innerHTML =
        '<div style="display:flex;gap:18px;font-size:13px;margin-bottom:12px;flex-wrap:wrap">'
        + '<span>대상 <b>' + esc(tgt) + '</b></span><span>기간 <b>2025</b></span><span>양식 <b>기본 리뷰 양식</b></span></div>'
        + '<textarea style="width:100%;min-height:190px;border:1px solid var(--line);border-radius:8px;padding:12px;font-size:13.5px;font-family:inherit;resize:vertical;color:var(--ink);background:var(--card)"'
        + (done ? ' readonly' : '') + '>' + esc(draft) + '</textarea>';
      var acts;
      if (done) {
        acts = [{ label: '닫기', kind: 'ghost' }];
      } else {
        acts = [
          { label: '임시저장', kind: 'ghost', onClick: function () {
              if (row) setRvBadge(row, '작성 중'); else newReviewRow('작성 중', '작성');
              TX.toast && TX.toast('리뷰를 임시저장했습니다.', 'ok');
            } },
          { label: '제출', kind: 'primary', onClick: function () {
              var ta = body.querySelector('textarea');
              if (ta && !ta.value.trim()) { TX.toast && TX.toast('리뷰 내용을 입력하세요.', 'warn'); return false; }
              if (row) {
                setRvBadge(row, '완료');
                var act = row.querySelector('.rv-act');
                if (act) { act.textContent = '확인'; act.classList.add('ghost'); }
              } else newReviewRow('완료', '확인');
              TX.toast && TX.toast('리뷰를 제출했습니다.', 'ok');
            } }
        ];
      }
      TX.modal && TX.modal({ title: done ? '리뷰 확인' : (isCreate ? '리뷰 생성' : '리뷰 작성'), wide: true, body: body, actions: acts });
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
        if (k === 'gd-close') { ev.preventDefault(); closeGoalDetail(); return; }
        if (k === 'gd-checkin' || k === 'gd-aick' || k === 'gd-ckcancel' || k === 'gd-aidismiss') {
          ev.preventDefault();
          var gdo = gdOv && objById[gdOv.getAttribute('data-oid')];
          if (!gdo) return;
          if (k === 'gd-checkin') { openCheckinModal(gdo, false); return; }
          if (k === 'gd-aick') { openCheckinModal(gdo, true); return; }
          if (k === 'gd-ckcancel') {
            ckSave(gdo.objective_id, null);
            openGoalDetail(gdo.objective_id);
            TX.toast && TX.toast('체크인 요청을 취소했습니다. 취소 이력도 감사 로그에 남습니다.');
            return;
          }
          var aic = tag.closest('.txf-fcard');
          if (aic) aic.style.display = 'none';
          TX.toast && TX.toast('이번 신호는 무시했습니다. 다음 감지 시 다시 제안합니다.');
          return;
        }
        if (k === 'reorder') { openReorderModal(); return; }
        if (k === 'cardset') { openCardSettings(); return; }
        if (k === 'expandall') { toggleAllMembers(tag); return; }
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
            /* 근거 재료 — 내 직무 프로파일 과업 + 선택된 상위 목표 (근거 없는 추천 금지 원칙) */
            var jp = (window.EZJob && EZJob.profileOf) ? EZJob.profileOf(cuEmp)
                     : ((D.jobProfiles || {})[cuEmp.jobProfileId] || null);
            var areas = jp ? Object.keys(jp.tasks || {}) : [];
            var parentSel = newOv.querySelector('.txf-fcard select.txf-inp');
            var parentTitle = (parentSel && parentSel.value && parentSel.options[parentSel.selectedIndex])
              ? parentSel.options[parentSel.selectedIndex].text
              : ((objs.filter(function (o) { return o.owner_emp_id === cuEmp.manager_id; })[0] || objs[0] || {}).title || '상위 조직 목표');
            /* 직무 기준 역량(competency_profile) 1순위 — 근거 문구에 함께 인용 */
            var topComp = (jp && jp.competency_profile && jp.competency_profile[0]) || null;
            var compLabel = '';
            if (topComp) {
              var compRec = (D.competencies || []).filter(function (c) { return c.dimension_id === topComp.dimension_id; })[0];
              compLabel = topComp.dimension_id + ' ' + ((compRec && compRec.name) || '');
            }
            var whyOf = function (i) {
              var a = areas.length ? areas[i % areas.length] : (cuEmp.jobTitle || '내 직무');
              return '직무 과업 <b>「' + esc(a) + '」</b> + 상위목표 <b>「' + esc(parentTitle) + '」</b>'
                + (compLabel ? ' · 역량 <b>' + esc(compLabel) + '</b>' : '');
            };
            var canned = [
              { name: '신규 기능 기획서 사용자 검증 통과율 90% 달성', mode: 0, weight: 40, diff: 'A', diffwhy: '전년 통과율 실적 대비 +15%p 상향', why: whyOf(0) },
              { name: '기획 산출물 평균 리드타임 5일 이내 단축', mode: 1, weight: 30, diff: 'A', diffwhy: '전년 평균 6.5일 대비 단축', why: whyOf(1) },
              { name: '분기별 사용자 인터뷰 12회 실시', mode: 3, weight: 30, diff: 'B', diffwhy: '전년 수준 유지 — 안정 운영', why: whyOf(2) }
            ];
            var insertKRs = function (items, live) {
              items.forEach(function (s) { list2.insertAdjacentHTML('beforeend', krRowHTML(s)); });
              renumberKR();
              TX.toast && TX.toast(live ? 'elizax가 직무 프로파일·상위목표를 근거로 KR 3건을 추천했습니다.'
                                        : 'AI가 직무 과업·상위목표를 근거로 핵심 성과 3건을 추천했습니다.', 'ok');
            };
            /* Claude 연결 시: 직무·기존 목표 실데이터 기반 실제 추천 */
            var live = !!(window.EZAI && EZAI.agent && EZAI.ready && EZAI.ready() && window.EZTools);
            if (live) {
              TX.toast && TX.toast('elizax가 실데이터를 조회해 추천 중…');
              window.EZAI.agent({
                maxTurns: 3, maxTokens: 640,
                messages: [{ role: 'user', content:
                  '현재 사용자의 직무 프로파일(get_job_profile)과 기존 목표를 도구로 조회한 뒤, 새 목표에 넣을 핵심성과(KR) 3건을 추천해줘. ' +
                  '반드시 아래 형식으로만 답해 — 각 줄 "KR명 | 가중치% | 근거" 형태 3줄, 그 외 텍스트 금지. 가중치 합 100. ' +
                  '근거는 "직무 과업 ○○ · 상위목표 ○○" 형식으로 실제 과업명과 목표명을 인용해.' }],
                onDone: function (text) {
                  var items = [];
                  String(text || '').split(/\r?\n/).forEach(function (ln) {
                    var m2 = ln.match(/^\s*(?:\d+[.)]\s*)?(.+?)\s*\|\s*(\d{1,3})\s*%?\s*(?:\|\s*(.+?)\s*)?$/);
                    if (m2 && items.length < 3) items.push({
                      name: m2[1].trim(), mode: 0, weight: Number(m2[2]),
                      diff: 'A', diffwhy: '전년 실적 대비 상향',
                      why: m2[3] ? esc(m2[3].trim()) : whyOf(items.length)
                    });
                  });
                  insertKRs(items.length === 3 ? items : canned, items.length === 3);
                },
                onError: function () { insertKRs(canned, false); }
              });
            } else {
              insertKRs(canned, false);
            }
          }
          return;
        }
        if (k === 'rv-open') { openReviewWrite(tag); return; }
        if (k === 'rv-explorer') {
          TX.modal && TX.modal({ title: '리뷰 탐색기', wide: true,
            body: '<div style="padding:8px 0;color:var(--ink-2);font-size:13.5px;line-height:1.7">리뷰 탐색기에서는 조직·기간·유형별로 리뷰를 검색하고 진행 현황을 한눈에 확인할 수 있습니다.<br>선택한 대상: <b>' + esc(cuEmp.name || '') + '</b> · 기간 <b>2025</b> · 유형 <b>기본 리뷰 양식</b></div>',
            actions: [{ label: '닫기', kind: 'ghost' }] });
          return;
        }
      }
      // segtabs (1:1 미팅 / 리뷰) — fix 15
      var st = t.closest('.segtabs button');
      if (st) {
        var grp = st.closest('.segtabs');
        var btns = grp.querySelectorAll('button');
        var si = Array.prototype.indexOf.call(btns, st);
        btns.forEach(function (b) { b.classList.toggle('on', b === st); });
        var pg = st.closest('.subpage');
        var pno = pg ? pg.getAttribute('data-p') : '';
        if (pno === '2') renderMeetingTab(si);
        else if (pno === '3') renderReviewTab(si);
        return;
      }
      // 피드백 카드 → 상세 drawer — fix 14 (.fb-more / .fb-dots는 기존 핸들러 유지)
      var fbc = t.closest('.fb-card');
      if (fbc) {
        if (!t.closest('.fb-more') && !t.closest('.fb-dots')) openFeedbackDetail(fbc);
        return;
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
      // my-goal rows — expander icon toggles inline detail, row body opens 목표 상세 (fix 13)
      var exp = t.closest('.mg.txf-exp');
      if (exp) {
        var xp = t.closest('.mgx');
        if (xp) {
          var det = exp.nextElementSibling;
          if (det && det.classList.contains('txf-detail')) {
            var vis = det.style.display === 'none';
            det.style.display = vis ? '' : 'none';
            xp.textContent = vis ? '⌃' : '⌄';
          }
        } else if (exp.getAttribute('data-oid')) {
          openGoalDetail(exp.getAttribute('data-oid'));
        }
        return;
      }
      // goal rows in org/role/all cards → 목표 상세 (fix 13)
      var gr = t.closest('.grow[data-oid]');
      if (gr) { openGoalDetail(gr.getAttribute('data-oid')); return; }
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
        if (main && curMt[idx]) { main.classList.add('txf-open'); main.innerHTML = meetingDetailHTML(curMt[idx]); }
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
      closeMap(); closeNew(); closeGoalDetail();
      if (a.getAttribute('data-p') === '0' && goalPage && !goalPage.querySelector('.txf-goal-body')) {
        buildGoalPage();   // defensive: rebuild if content was lost
      }
    });
  });
})();
