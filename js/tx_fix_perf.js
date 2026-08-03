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

    /* 역량 ID → 사람이 읽는 이름. 모르는 ID는 화면에 내지 않는다(코드 노출 금지). */
    var compKrName = {};
    (D.competencies || []).forEach(function (c) { compKrName[c.dimension_id] = c.name; });

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
    function roleKey() { return (CU._role) || (window.TXRoles && TXRoles.current && TXRoles.current().key) || 'member'; }
    function pickParentObjective() {   // D: most relevant 상위(조직) 목표 default
      var orgObjs = objs.filter(function (o) { return o.type === '조직'; });
      if (!orgObjs.length) return null;
      var chain = ancestorOrgs(cuEmp.org_id);   // [self, parent, ... root] — closest first
      for (var i = 0; i < chain.length; i++) {
        var hit = orgObjs.filter(function (o) { return o.org_id === chain[i]; })[0];
        if (hit) return hit;
      }
      var byMgr = orgObjs.filter(function (o) { return o.owner_emp_id === cuEmp.manager_id; })[0];
      if (byMgr) return byMgr;
      if (cuEmp.strategy_theme_id) {
        var byThm = orgObjs.filter(function (o) { return o.strategy_theme_id === cuEmp.strategy_theme_id; })[0];
        if (byThm) return byThm;
      }
      return orgObjs[0];
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
      '#s-perf .txf-diffrow select.txf-krdiffbasis{width:136px}',
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
      /* --- v2 §6: 은닉 기능 상시 ✦ 앵커 스트립 --- */
      '#s-perf .txf-aistrip{display:flex;gap:8px;margin:10px 0 2px;flex-wrap:wrap}',
      '#s-perf .txf-anchor{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--color-accent-muted,rgba(31,122,240,.28));color:var(--color-accent,#1F7AF0);background:var(--color-background-card,#fff);font-size:12.5px;font-weight:700;padding:7px 13px;border-radius:var(--radius-full,999px);cursor:pointer;transition:background var(--duration-fast,175ms)}',
      '#s-perf .txf-anchor:hover{background:var(--color-accent-muted,rgba(31,122,240,.08))}',
      '#s-perf .txf-ai:hover{background:var(--blue-soft)}',
      '#s-perf .txf-ck{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--ink-2);cursor:pointer;user-select:none}',
      '#s-perf .txf-ck input{width:15px;height:15px;accent-color:var(--blue)}',
      /* --- F6: 이어받은 출발점 패널 --- */
      '#s-perf .txf-carry{width:270px;flex:none;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;font-size:12.5px}',
      '#s-perf .txf-carry .ch{font-size:13px;font-weight:800;color:var(--ink)}',
      '#s-perf .txf-carry .ch .sub{display:block;font-size:11px;font-weight:600;color:var(--ink-3);margin-top:2px}',
      '#s-perf .txf-cv{border:1px solid var(--line-2,#F1F2F5);border-radius:9px;padding:9px 11px;margin-top:9px}',
      '#s-perf .txf-cv .cvt{font-size:11px;font-weight:800;color:var(--ink-3);margin-bottom:5px}',
      '#s-perf .txf-cv .cvb{font-size:12.5px;color:var(--ink)}',
      '#s-perf .txf-cv .cvb .gr{font-size:15px;font-weight:800}',
      '#s-perf .txf-cv .pd{font-size:11px;color:var(--ink-4)}',
      '#s-perf .txf-cv .cvn{font-size:11.5px;color:var(--ink-2);line-height:1.55;margin-top:4px}',
      '#s-perf .txf-cv .cvs{font-size:10.5px;color:var(--ink-4);margin-top:6px}',
      '#s-perf .txf-cv .cvk{display:flex;align-items:center;gap:6px;padding:6px 0;border-top:1px solid var(--line-2,#F1F2F5)}',
      '#s-perf .txf-cv .cvk .nm{flex:1;min-width:0;font-size:11.5px;color:var(--ink-2);line-height:1.4}',
      '#s-perf .txf-cv .cvk .ach{font-size:11px;font-weight:800;color:#B45309;flex:none}',
      '#s-perf .txf-cv .cvbtn{flex:none;border:1px solid var(--line);background:var(--card);border-radius:6px;font-size:10.5px;font-weight:700;color:var(--ink-2);padding:3px 7px;cursor:pointer}',
      '#s-perf .txf-cv .cvbtn:hover{background:var(--soft)}',
      '#s-perf .txf-src{display:inline-block;font-size:10px;font-weight:800;color:#356CB5;background:rgba(31,122,240,.08);border-radius:4px;padding:0 5px;cursor:pointer}',
      '#s-perf .txf-src:hover{background:rgba(31,122,240,.16)}',
      '#s-perf .txf-carryai{width:100%;margin-top:11px;border:1.5px solid var(--purple,#7C3AED);color:var(--purple,#7C3AED);background:var(--card);font-size:12px;font-weight:700;padding:8px;border-radius:8px;cursor:pointer}',
      '#s-perf .txf-carryai:hover{background:var(--blue-soft)}',
      '#s-perf .txf-carry.hl{border-color:var(--blue,#1F7AF0);box-shadow:0 0 0 3px rgba(31,122,240,.16)}',
      /* F3: 항목별 체크박스 — carry 패널/검토 모달 공용(모달은 #s-perf 밖) */
      '.txf-cvck{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:800;color:var(--ink-3);margin-bottom:5px;cursor:pointer;user-select:none}',
      '.txf-cvck input{width:14px;height:14px;accent-color:var(--blue,#1F7AF0);margin:0;flex:none}',
      /* F3: 진입 배너 */
      '#s-perf .txf-cbn{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:rgba(31,122,240,.06);border:1px solid rgba(31,122,240,.22);border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:12.5px;color:var(--ink-2);line-height:1.5}',
      '#s-perf .txf-cbn b{color:var(--ink)}',
      '#s-perf .txf-cbn.first{background:var(--soft);border-color:var(--line);color:var(--ink-3)}',
      '#s-perf .txf-cbn .cbtn{margin-left:auto;flex:none;border:1px solid var(--blue,#1F7AF0);color:var(--blue,#1F7AF0);background:var(--card);border-radius:7px;font-size:11.5px;font-weight:700;padding:5px 11px;cursor:pointer}',
      '#s-perf .txf-cbn .cbtn:hover{background:var(--blue-soft)}',
      /* F3 반응형: EZJob 패널(tx_jobcontext)과 동일 계약 — 좁은 화면에서는 숨기고 배너로 진입 */
      '@media(max-width:1100px){#s-perf .txf-carry{display:none}}',
      /* --- E: 가중치 합계 게이지 --- */
      '#s-perf .txf-wsum{display:flex;align-items:center;gap:10px;margin-top:14px;padding:9px 12px;border:1px solid var(--line);border-radius:9px;background:var(--soft);font-size:12.5px}',
      '#s-perf .txf-wsum .lb{font-weight:700;color:var(--ink-2);flex:none}',
      '#s-perf .txf-wsum .tr{flex:1;min-width:60px;height:7px;border-radius:99px;background:var(--line);overflow:hidden}',
      '#s-perf .txf-wsum .tr i{display:block;height:100%;background:var(--green,#2FA36B);transition:width .18s}',
      '#s-perf .txf-wsum.bad .tr i{background:var(--red,#E23B3B)}',
      '#s-perf .txf-wsum .vv{font-weight:800;color:var(--green,#2FA36B);flex:none}',
      '#s-perf .txf-wsum.bad .vv{color:var(--red,#E23B3B)}',
      '#s-perf .txf-wsum .eq{flex:none;border:1px solid var(--line);background:var(--card);border-radius:7px;font-size:11.5px;font-weight:700;color:var(--ink-2);padding:5px 10px;cursor:pointer}',
      '#s-perf .txf-wsum .eq:hover{background:var(--card);border-color:var(--blue,#1F7AF0);color:var(--blue,#1F7AF0)}',
      '#s-perf .txf-align{display:none;margin-top:8px;font-size:12px;color:var(--ink-2);background:rgba(31,122,240,.05);border:1px solid rgba(31,122,240,.18);border-radius:8px;padding:8px 11px;line-height:1.55}',
      '#s-perf .txf-align b{color:var(--blue,#1F7AF0)}',
      '#s-perf .txf-align .rs{margin-top:4px;color:var(--ink-3)}',
      '#s-perf .txf-spin{display:inline-block;width:11px;height:11px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:txfspin .7s linear infinite;vertical-align:-1px}',
      '@keyframes txfspin{to{transform:rotate(360deg)}}',
      /* --- F2: elizax 목표 초안 시트 --- */
      '#s-perf .txf-ds{position:fixed;left:0;right:0;bottom:0;z-index:80;background:var(--card);border-top:1px solid var(--line);box-shadow:0 -12px 34px rgba(16,24,40,.16);display:none;flex-direction:column;max-height:64vh}',
      '#s-perf .txf-ds.open{display:flex}',
      '#s-perf .txf-dsh{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:12px 22px;border-bottom:1px solid var(--line)}',
      '#s-perf .txf-dsh .tt{font-size:14px;font-weight:800;color:var(--ink)}',
      '#s-perf .txf-dsh .x{margin-left:auto;color:var(--ink-4);cursor:pointer;font-size:15px;flex:none}',
      '#s-perf .txf-dschip{font-size:10.5px;font-weight:800;border-radius:5px;padding:2px 7px;color:#356CB5;background:rgba(31,122,240,.1)}',
      '#s-perf .txf-dschip.tmpl{color:#B45309;background:#FFF4E5}',
      '#s-perf .txf-dsh .tools{font-size:11.5px;color:var(--ink-3);flex-basis:100%;line-height:1.55}',
      '#s-perf .txf-dsh .tools b{color:var(--ink-2);font-weight:700}',
      '#s-perf .txf-dsb{overflow-y:auto;padding:14px 22px;flex:1}',
      '#s-perf .txf-dsc{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--line);border-radius:10px;padding:11px 13px;margin-bottom:9px;cursor:pointer}',
      '#s-perf .txf-dsc:hover{background:var(--soft)}',
      '#s-perf .txf-dsc input[type=checkbox]{width:15px;height:15px;accent-color:var(--blue);margin-top:2px;flex:none}',
      '#s-perf .txf-dsc .bd{flex:1;min-width:0}',
      '#s-perf .txf-dsc .lb{font-size:11px;font-weight:800;color:var(--ink-3);margin-bottom:4px}',
      '#s-perf .txf-dsc .vv{font-size:13px;font-weight:700;color:var(--ink);line-height:1.5}',
      '#s-perf .txf-dsc .df{font-size:12px;line-height:1.6}',
      '#s-perf .txf-dsc .df .o{display:block;color:var(--ink-3);text-decoration:line-through}',
      '#s-perf .txf-dsc .df .n{display:block;color:var(--ink);font-weight:700}',
      '#s-perf .txf-dsc .mt{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}',
      '#s-perf .txf-dsc .mc{font-size:10.5px;font-weight:700;color:var(--ink-2);background:var(--soft);border:1px solid var(--line);border-radius:5px;padding:1px 7px}',
      '#s-perf .txf-dsc .mc.w{color:#356CB5;background:rgba(31,122,240,.08);border-color:rgba(31,122,240,.2)}',
      '#s-perf .txf-dsc .why{font-size:11.5px;color:var(--ink-2);margin-top:6px;line-height:1.55}',
      '#s-perf .txf-dsc .wn{font-size:11px;color:#B45309;background:#FFF4E5;border-radius:5px;padding:3px 8px;margin-top:6px;line-height:1.5}',
      '#s-perf .txf-dsnote{font-size:12px;color:var(--ink-3);line-height:1.6;padding:6px 2px}',
      '#s-perf .txf-dserr{font-size:12.5px;color:#B42318;background:#FEF3F2;border:1px solid #FECDCA;border-radius:9px;padding:11px 13px;line-height:1.6}',
      '#s-perf .txf-dsf{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:11px 22px;border-top:1px solid var(--line);background:var(--soft)}',
      '#s-perf .txf-dsf .sp{margin-left:auto;display:flex;gap:8px}',
      '#s-perf .txf-dsk{height:13px;border-radius:6px;background:linear-gradient(90deg,var(--line),var(--soft),var(--line));background-size:220% 100%;animation:txfsk 1.1s linear infinite;margin-bottom:8px}',
      '@keyframes txfsk{to{background-position:-220% 0}}',
      '#s-perf .txf-undo{position:fixed;left:50%;transform:translateX(-50%);bottom:26px;z-index:90;display:none;align-items:center;gap:12px;background:#1D2939;color:#fff;border-radius:10px;padding:11px 16px;font-size:12.5px;box-shadow:0 10px 26px rgba(16,24,40,.28)}',
      '#s-perf .txf-undo.open{display:flex}',
      '#s-perf .txf-undo .ub{border:1px solid rgba(255,255,255,.4);background:transparent;color:#fff;border-radius:7px;font-size:12px;font-weight:700;padding:5px 11px;cursor:pointer}',
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
      /* 세로로 쌓는다 — flex 행이면 elizax 바·아젠다 패널·미팅 상세가 셋으로 갈려 각각 좁아진다
         (아젠다 선택 화면이 260px로 찌그러지던 원인). 블록이면 셋 다 본문 폭을 그대로 쓴다. */
      '#s-perf .mt-main.txf-open{display:block;color:var(--ink);padding:26px 30px}',
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
      '.txf-carry-modal .ch{font-size:13px;font-weight:800;color:var(--ink)}',
      '.txf-carry-modal .ch .sub{display:block;font-size:11px;font-weight:600;color:var(--ink-3);margin-top:2px}',
      '.txf-carry-modal .txf-cv{border:1px solid var(--line-2,#F1F2F5);border-radius:9px;padding:9px 11px;margin-top:9px}',
      '.txf-carry-modal .cvb{font-size:12.5px;color:var(--ink)}',
      '.txf-carry-modal .cvb .gr{font-size:15px;font-weight:800}',
      '.txf-carry-modal .cvn{font-size:11.5px;color:var(--ink-2);line-height:1.55;margin-top:4px}',
      '.txf-carry-modal .cvs{font-size:10.5px;color:var(--ink-4);margin-top:6px}',
      '.txf-carry-modal .pd{font-size:11px;color:var(--ink-4)}',
      '.txf-carry-modal .cvk{display:flex;align-items:center;gap:6px;padding:6px 0;border-top:1px solid var(--line-2,#F1F2F5)}',
      '.txf-carry-modal .cvk .nm{flex:1;min-width:0;font-size:11.5px;color:var(--ink-2);line-height:1.4}',
      '.txf-carry-modal .cvk .ach{font-size:11px;font-weight:800;color:#B45309;flex:none}',
      '.txf-carry-modal .cvbtn{flex:none;border:1px solid var(--line);background:var(--card);border-radius:6px;font-size:10.5px;font-weight:700;color:var(--ink-2);padding:3px 7px;cursor:pointer}',
      '.txf-carry-modal .txf-src{display:inline-block;font-size:10px;font-weight:800;color:#356CB5;background:rgba(31,122,240,.08);border-radius:4px;padding:0 5px;cursor:pointer}',
      '.txf-carry-modal .txf-carryai{width:100%;margin-top:12px;border:1.5px solid var(--purple,#7C3AED);color:var(--purple,#7C3AED);background:var(--card);font-size:12px;font-weight:700;padding:8px;border-radius:8px;cursor:pointer}',
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
      // ④: 저장된 목표 가중치가 단일 원천 — 없는 목표만 잔여분 균등 폴백
      var stored = mine.map(function (o) {
        var w = parseFloat(o.weight);
        return (isFinite(w) && w >= 0) ? w : null;
      });
      var unset = 0, used = 0;
      stored.forEach(function (w) { if (w == null) unset++; else used += w; });
      var rem = Math.max(0, 100 - used);
      var wbase = unset ? Math.floor(rem / unset) : 0;
      var wextra = rem - wbase * unset, ui = 0;
      var weights = stored.map(function (w) {
        if (w != null) return w;
        ui++;
        return wbase + (ui === unset ? wextra : 0);
      });
      var wsum = Math.round(weights.reduce(function (a, b) { return a + b; }, 0) * 10) / 10;
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
      } else if (roleKey() === 'member') { // 소속 기준 · 조직원 — 본인 범위만 (동료 목표·진행률 비노출)
        html = myGoalsCard(true);
      } else {                           // 소속 기준 (default) — fix 6: cascade lives here (leader/hr/exec)
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
        /* 목표 맵은 전 조직 목표를 펼쳐 보는 창구다 — renderGoalBody가 조직원을 본인 범위로
           막아 둔 것을 이 버튼 하나가 우회한다. 조직원에게는 진입점을 내지 않는다. */
        + (roleKey() === 'member' ? '' : '<button class="ghost-btn" data-txf="map">목표 맵</button>')
        + '<button class="ghost-btn" data-txf="weight">목표 가중치 설정</button>'
        + '<button class="btn-blue" data-txf="new">목표 생성</button></div></div>'
        + '<div class="pilltabs">'
        + '<button data-txf-pill="0">나의 목표 요약</button>'
        + '<button data-txf-pill="1" class="on">소속 기준</button>'
        + '<button data-txf-pill="2">역할 기준</button>'
        + '<button data-txf-pill="3">나의 전체 목표</button></div>'
        /* v2 §6·§11: 은닉 기능(overlay/모달 내부)의 상시 진입 앵커 — 화면당 최대 3개 */
        + '<div class="txf-aistrip" data-astryx-theme="talenx">'
        + '<button class="txf-anchor" data-txf="anchor-airec">✦ AI 목표 추천</button>'
        + '<button class="txf-anchor" data-txf="anchor-refine">✦ 초안 정제</button>'
        + '<button class="txf-anchor" data-txf="anchor-aick">✦ 체크인 초안</button></div>'
        + '<div class="txf-goal-body"></div>';
      renderGoalBody();
    }
    if (goalPage) buildGoalPage();

    /* ============================================================= *
     *  피드백 (data-p=1) — 전면 재생성                               *
     *  in-place 패치는 index.html의 정적 카드(권나정·안효·최인기 등   *
     *  남이 받은 피드백 실명+원문)를 지우지 못했다. tx_hydrate는      *
     *  demoSubjects에 EMP-0078만 있어 조직장·HR·경영진에서는 손대지   *
     *  않고 빠지므로, 역할을 바꾸면 타인의 피드백 원문이 그대로 남는다.*
     *  그래서 카드를 통째로 버리고 내가 받은 것만 다시 그린다.        *
     * ============================================================= */
    (function patchFeedback() {
      var page = sec.querySelector('.subpage[data-p="1"]');
      if (!page) return;
      /* feedbackLog 필드는 log_id·to_emp·from_emp·kind·draft_at·sent_at·read_at·status·char_len뿐 —
         본문 텍스트가 없다. 없는 본문을 지어내지 않고 종류·분량·읽음 상태만 싣는다. */
      var mine = (D.feedbackLog || [])
        .filter(function (f) { return f.to_emp === CU.emp_id; })
        .sort(function (a, b) { return String(b.sent_at || '').localeCompare(String(a.sent_at || '')); });
      function fbDate(iso) {
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '날짜 미상';
        var h = d.getHours() % 12 || 12;
        return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 '
          + (d.getHours() < 12 ? '오전 ' : '오후 ') + h + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
      }
      /* 본문이 있는 자리에는 본문을 쓴다 — demoSubjects 13명에는 동료 리뷰의 실제 코멘트
         (strength_comments·dev_comments)가 들어 있다. 보낸 사람이 겹치는 건에 그 문장을 싣고,
         없으면 위 주석대로 종류·분량만 쓴다. 익명 리뷰면 보낸 사람 이름을 내지 않는다. */
      var prByReviewer = {};
      (function () {
        var ds = (D.demoSubjects || []).filter(function (s) { return s.emp_id === CU.emp_id; })[0];
        ((ds && ds.peerReviews) || []).forEach(function (pr) {
          var parts = [];
          [pr.strength_comments, pr.dev_comments].forEach(function (m) {
            Object.keys(m || {}).forEach(function (k) { if (m[k]) parts.push(m[k]); });
          });
          if (pr.overall_comment) parts.unshift(pr.overall_comment);
          if (parts.length && pr.reviewer_id) {
            prByReviewer[pr.reviewer_id] = { text: parts.join(' '), anon: !!pr.anonymous };
          }
        });
      })();
      var html = mine.map(function (f) {
        /* from_emp가 없는 건(174건 중 3건)은 발신자를 지어내지 않고 익명으로 둔다 */
        var pr = f.from_emp ? prByReviewer[f.from_emp] : null;
        var from = (pr && pr.anon) ? '익명' : (f.from_emp ? empName(f.from_emp) : '익명');
        var body = pr ? esc(pr.text)
          : (esc(f.kind || '피드백') + ' · 본문 ' + (f.char_len || 0) + '자'
             + (f.status === 'read' ? ' · 읽음' : ' · 읽지 않음'));
        return '<div class="fb-card"><div class="fb-top">'
          + (F.avatar ? F.avatar(from, 26) : '<span class="ava"></span>')
          + '<div class="fb-ttl"><b>' + esc(cuEmp.name || '나') + '</b> 님이 <b>' + esc(f.kind || '피드백') + '</b> 피드백을 받았습니다.</div>'
          + '<span class="fb-dots">⋮</span></div>'
          + '<div class="fb-body">' + body + '</div>'
          + '<div class="fb-from"><b>' + esc(from) + '</b> 님이 보냄</div>'
          + '<div class="fb-foot"><span>♡ 좋아요 0</span><span>💬 댓글 0</span>'
          + '<span>🕑 ' + esc(fbDate(f.sent_at)) + '</span></div></div>';
      }).join('');
      /* 「더 보기」도 지운다 — 받은 건 전부 그렸으므로 더 볼 것이 없다 */
      page.querySelectorAll('.fb-card, .fb-more').forEach(function (n) { n.remove(); });
      page.insertAdjacentHTML('beforeend', html
        || '<div class="fb-card"><div class="fb-body" style="color:var(--ink-3);margin:0">아직 받은 피드백이 없어요.</div></div>');
      var subB = page.querySelector('.ph .sub b');
      if (subB) subB.textContent = mine.length + '개';
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
      if (TX.drawer) TX.drawer({ title: '피드백 상세', subtitle: sender + ' 님이 보낸 피드백', body: el, width: '420px' });
      else if (TX.modal) TX.modal({ title: '피드백 상세', body: el, actions: [{ label: '닫기', kind: 'ghost' }] });
    }

    /* ============================================================= *
     *  1:1 미팅 (data-p=2) — rebuild list + click-to-load (fix 10)   *
     * ============================================================= */
    var meetings = [];
    (function buildMeetingData() {
      /* 「나의 1:1 미팅」 = 내가 대상자인 1:1 = 내 상사와의 1:1. 그것뿐이다.
         예전에는 EMP-0080·EMP-0077을 덧붙였는데 두 사람은 나와 아무 관계가 없는
         남의 부하였다 — 없는 미팅을 지어낸 것이라 지운다. 상사가 없으면(경영진)
         이 탭은 정직하게 빈다. */
      var partnerIds = cuEmp.manager_id ? [cuEmp.manager_id] : [];
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
            '핵심 성과 체크인 및 리스크 점검',
            i === 0 ? '커리어 개발 및 다음 분기 우선순위' : '협업 프로세스 개선 논의'
          ],
          notes: c.comment || '2분기 신규 기획 3건 사용자 검증 통과, 잔여 2건 진행 중. 리드타임 개선세 유지.',
          actions: [
            (c.blocker ? '막힌 부분 해소: ' + c.blocker : '리뷰 단계 병목 개선안 정리') + ' — ' + esc(cuEmp.name || '본인'),
            '다음 1:1 전까지 핵심 성과 진행률 업데이트'
          ]
        });
      });
    })();

    function meetingDetailHTML(m) {
      var e = m.emp;
      var head = '<div class="txf-md">'
        + '<div class="mdh">' + (F.avatar ? F.avatar(e.name, 44) : '')
        + '<div><div class="nm">' + esc(F.nameTeam ? F.nameTeam(e) : e.name) + '</div>'
        + '<div class="dt">' + esc(m.date) + ' · 1:1 미팅</div></div></div>';
      /* tx_policy의 oneonone 행은 조직장·HR에게 「확정 요약만」을 허용한다 —
         남의 1:1 안건·공유 노트·액션 아이템 원문은 당사자 몫이므로 여기서 내지 않는다. */
      if (m.summaryOnly) {
        return head
          + '<h4>확정 요약</h4><div class="nt">' + esc(m.summary) + '</div>'
          + '<div class="txf-krwhy" style="margin-top:10px">열람 범위 — 이 1:1은 <b>확정 요약</b>까지만 공개됩니다. '
          + '안건·공유 노트·액션 아이템 원문은 당사자와 직접 조직장에게만 보입니다.</div>'
          + '</div>';
      }
      return head
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
    function makeAltMeeting(e, date, seed, summaryOnly) {
      var eobj = (objByOwner[e.emp_id] || [])[0];
      var c = (chkByEmp[e.emp_id] || [])[0] || {};
      /* 열람 권한으로 보는 1:1은 확정 요약 한 줄뿐 — 요약은 목표 제목·후속 액션 유무 같은
         공개된 성과 정보로만 만들고, 체크인 코멘트(사적 노트)는 끌어오지 않는다. */
      if (summaryOnly) {
        return {
          emp: e, date: date, flags: seed % 3, comments: (seed + 1) % 2, summaryOnly: true,
          summary: (eobj ? eobj.title : '분기 핵심 과제') + ' 진행 점검 — 후속 액션 합의 완료'
        };
      }
      return {
        emp: e, date: date, flags: seed % 3, comments: (seed + 1) % 2,
        agenda: [
          '2분기 목표 진행 상황 리뷰 — ' + (eobj ? eobj.title : '분기 핵심 과제'),
          '핵심 성과 체크인 및 리스크 점검',
          '협업 프로세스 및 커뮤니케이션 개선 논의'
        ],
        notes: c.comment || '분기 목표 진행 상황을 공유하고 우선순위를 재정렬했습니다. 특이 리스크 없음.',
        actions: ['논의 안건 후속 정리 — ' + e.name, '다음 1:1 전까지 핵심 성과 진행률 업데이트']
      };
    }
    function tabMeetings(idx) {
      // A: 조직원은 본인 1:1(idx 0)만 — 관리자(idx 1)·열람가능(idx 2) 탭은 동료의 사적 1:1 노트라 비노출
      if (roleKey() === 'member' && idx !== 0) return [];
      // tx_policy의 oneonone 행에서 경영진은 「열람 불가」 — 열람 탭에 볼 대상이 없다
      if (idx === 2 && roleKey() === 'exec') return [];
      if (mtTabs[idx]) return mtTabs[idx];
      /* 내가 관리자인 1:1은 직속 부하 전원 — 좌측 드롭다운은 전원을 보여주는데 여기서
         3명으로 잘라 두면 드롭다운에서 고른 사람의 카드가 없는 일이 생긴다 */
      var pool = idx === 1
        ? emps.filter(function (e) { return e.manager_id === CU.emp_id; })
        : (empByOrg[cuEmp.org_id] || []).filter(function (e) { return e.emp_id !== CU.emp_id; }).slice(0, 3);
      if (!pool.length) pool = (empByOrg[cuEmp.org_id] || []).filter(function (e) { return e.emp_id !== CU.emp_id; }).slice(0, 2);
      var dates = idx === 1
        ? ['7월 2일 목요일 오전 11:00', '6월 24일 수요일 오후 3:30', '6월 11일 목요일 오전 9:30']
        : ['6월 30일 화요일 오후 4:00', '6월 18일 목요일 오전 10:30', '6월 3일 수요일 오후 2:00'];
      mtTabs[idx] = pool.map(function (e, i) { return makeAltMeeting(e, dates[i] || dates[0], idx * 10 + i, idx === 2); });
      return mtTabs[idx];
    }
    /* .mt-main을 통째로 갈아엎으면 tx_1on1이 여기 맨 앞에 꽂아 둔 elizax 녹음·요약 바와
       아젠다 패널까지 같이 날아간다. MutationObserver가 바를 다시 꽂아 주긴 하지만
       열어 둔 아젠다 준비 화면은 그대로 사라진다 — 대상만 바꿨는데 하던 일이 없어진다.
       그래서 미팅 상세 부분만 갈아 끼운다. */
    function setMeetingMain(main, html) {
      main.querySelectorAll('.txf-md,.txf-mt-empty').forEach(function (n) { n.remove(); });
      main.insertAdjacentHTML('beforeend', html);
    }

    var curMtTab = 0;
    function renderMeetingTab(idx, peerSrc) {
      var page = sec.querySelector('.subpage[data-p="2"]');
      if (!page) return;
      curMtTab = idx;
      curMt = tabMeetings(idx);
      var side = page.querySelector('.mt-side');
      if (side) {
        side.querySelectorAll('.txf-mt-item').forEach(function (n) { n.remove(); });
        side.insertAdjacentHTML('beforeend', mtListHTML(curMt));
      }
      var main = page.querySelector('.mt-main');
      if (main) {
        main.classList.add('txf-open');
        setMeetingMain(main, curMt.length ? meetingDetailHTML(curMt[0])
          : '<div class="txf-mt-empty" style="color:var(--ink-3);font-size:13.5px;padding:20px 0">'
            + (idx === 1 ? '내가 관리자인 1:1 미팅이 없습니다.'
             : idx === 2 ? '열람 가능한 1:1 미팅이 없습니다.'
                         : '나의 1:1 미팅이 없습니다.') + '</div>');
      }
      /* 펼쳐 놓은 카드가 곧 「지금 이야기 중인 상대」 — 좌측 드롭다운·아젠다가 따라온다.
         'none'은 곧바로 다른 카드를 펼 예정이라 알리지 않는다는 뜻(selectMeetingByEmp). */
      if (curMt.length && window.EZPeer && peerSrc !== 'none') EZPeer.set(curMt[0].emp.emp_id, peerSrc || 'mtlist');
    }

    /* 첫 화면에서 어떤 탭을 펼칠 것인가 — 역할마다 답이 다르다.
       조직장은 좌측 elizax 패널이 「팀원을 선택해 1:1을 주관하세요」라고 말하는 화면이다.
       거기에 내 상사와의 1:1을 펼쳐 놓으면 문맥이 어긋나므로 「내가 관리자인 1:1」로 연다.
       조직원은 상사와 하는 1:1이 맞으니 「나의 1:1」 그대로. 상사가 없는 경영진도
       나의 1:1 탭이 비므로 관리자 탭으로 연다. */
    function defaultMtTab() {
      var hasReports = emps.some(function (e) { return e.manager_id === CU.emp_id; });
      if (!hasReports) return 0;
      var rk = roleKey();
      return (rk === 'leader' || rk === 'exec' || !cuEmp.manager_id) ? 1 : 0;
    }

    /* 밖(좌측 드롭다운·elizax 대화)에서 대상이 바뀌면 그 사람 카드를 편다.
       지금 탭에 없으면 그 사람이 있는 탭으로 옮겨 준다 — 없으면 조용히 둔다. */
    function selectMeetingByEmp(empId) {
      var page = sec.querySelector('.subpage[data-p="2"]');
      if (!page) return;
      var tab = -1, pos = -1, i, list;
      for (i = 0; i < 3; i++) {
        list = (i === curMtTab) ? curMt : tabMeetings(i);
        for (var j = 0; j < list.length; j++) {
          if (list[j].emp.emp_id === empId) { tab = i; pos = j; break; }
        }
        if (tab >= 0) break;
      }
      if (tab < 0) return;
      if (tab !== curMtTab) {
        var btns = page.querySelectorAll('.segtabs button');
        if (btns[tab]) btns.forEach(function (b, bi) { b.classList.toggle('on', bi === tab); });
        renderMeetingTab(tab, 'none');   /* 이 탭의 첫 카드가 아니라 요청받은 사람을 펼 것이므로 알리지 않는다 */
      }
      var items = page.querySelectorAll('[data-mt]');
      if (!items[pos]) return;
      items.forEach(function (x, xi) { x.classList.toggle('on', xi === pos); });
      var main = page.querySelector('.mt-main');
      if (main && curMt[pos]) { main.classList.add('txf-open'); setMeetingMain(main, meetingDetailHTML(curMt[pos])); }
    }

    (function buildMeetingPage() {
      var page = sec.querySelector('.subpage[data-p="2"]');
      if (!page) return;
      var def = defaultMtTab();
      page.innerHTML = '<div class="mt-wrap">'
        + '<div class="mt-main txf-open"></div>'
        + '<div class="mt-side"><div class="sh"><h3>1:1 미팅</h3><span class="plus">+</span></div>'
        + '<div class="segtabs">'
        + '<button' + (def === 0 ? ' class="on"' : '') + '>나의 1:1 미팅</button>'
        + '<button' + (def === 1 ? ' class="on"' : '') + '>내가 관리자인 1:1 미팅</button>'
        + '<button>내가 열람할 수 있는 1:1 미팅</button>'
        + '</div></div></div>';
      /* 최초 렌더는 사람이 고른 것이 아니다 — "-init" 꼬리표로 알려 대화 대상이 끌려가지 않게 한다 */
      renderMeetingTab(def, 'mtlist-init');
    })();

    if (window.EZPeer) EZPeer.onChange(function (peer, src) {
      if (src.indexOf('mtlist') === 0) return;   /* 내가 낸 변경 */
      selectMeetingByEmp(peer.emp_id);
    });

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
    function rvRowsHTML(tab) {   // fix 15: 리뷰 segtabs — tab별 리스트 (role-aware)
      var ROLE = (CU && CU._role) || (window.TXRoles && TXRoles.current && TXRoles.current().key) || 'member';
      if (tab === 1) {           // 내가 관리자인 리뷰 — 실제 부하만, fallback 없음
        var subs = emps.filter(function (e) { return e.manager_id === CU.emp_id; }).slice(0, 3);
        return subs.map(function (e, i) { return rvRowHTML(e, cuEmp, i === 0 ? '완료' : '시작 이전', i === 0 ? '확인' : '작성'); }).join('')
          || '<div class="nogoal">내가 관리자인 리뷰가 없습니다.</div>';
      }
      if (tab === 2) {           // 내가 열람할 수 있는 리뷰 — member는 열람 대상 없음
        if (ROLE === 'member') return '<div class="nogoal">열람 가능한 리뷰가 없습니다.</div>';
        var peers = (empByOrg[cuEmp.org_id] || []).filter(function (e) { return e.emp_id !== CU.emp_id; }).slice(0, 2);
        return peers.map(function (e, i) { return rvRowHTML(e, rvMgrs[i % rvMgrs.length], '완료', '확인'); }).join('')
          || '<div class="nogoal">열람 가능한 리뷰가 없습니다.</div>';
      }
      // 나의 리뷰 (기본) — 한 사이클 본인 리뷰 1건, 관리자=본인 상위자
      var myMgr = empById[cuEmp.manager_id] || rvMgrs[0] || cuEmp;
      return rvRowHTML(cuEmp, myMgr, '작성 중', '작성');
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
    function treeHTML(orgId, noKids) {
      var o = orgById[orgId]; if (!o) return '';
      /* noKids: 조직원 관점 — 루트를 자기 소속으로 옮기는 것만으로는 부족하다.
         EMP-0078의 소속(Package BG)은 하위 조직이 10개라 루트만 바꾸면 사실상 전사가 펼쳐진다.
         그래서 하위 조직을 아예 접어 자기 조직 한 칸만 남긴다. */
      var kids = noKids ? [] : orgs.filter(function (x) { return x.parent_id === orgId; });
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
      /* 버튼을 숨겨도 목표 생성 화면의 'new-map'으로 이 오버레이가 열린다 —
         조직원은 트리 루트를 자기 소속 조직으로 좁혀 전사 목표가 펼쳐지지 않게 한다. */
      var isMember = roleKey() === 'member';
      var roots = isMember
        ? [orgById[cuEmp.org_id]].filter(Boolean)
        : orgs.filter(function (o) { return !o.parent_id; });
      /* 구성원 필터도 같은 이유로 조직원은 자기 조직 인원까지만 (전사 40명 실명 노출 차단) */
      var mapEmps = isMember ? (empByOrg[cuEmp.org_id] || []) : emps.slice(0, 40);
      mapOv.innerHTML =
        '<div class="txf-ovhead"><button class="bk" data-txf="map-close">←</button><h2>목표 맵</h2></div>'
        + '<div class="txf-ovbody"><div class="txf-map">'
        + '<div class="txf-rail"><h3>목표 맵 필터<span class="x" data-txf="map-close">✕</span></h3>'
        + '<button class="btn-blue" style="width:100%" data-txf="map-close">목표 현황으로 이동</button>'
        + '<div class="fl">주기</div><select data-txf="map-period">' + periodOpts + '</select>'
        + '<div class="fl">조직</div><div class="selbox" data-txf="map-orgname">' + esc((orgById[mapSel] || {}).name || '전체') + '</div>'
        + '<div class="fl">구성원</div><select class="selbox"><option>구성원 선택</option>' + mapEmps.map(function (e) { return '<option>' + esc(e.name) + '</option>'; }).join('') + '</select>'
        + '<label class="txf-ck" style="margin-top:14px"><input type="checkbox" data-txf="map-excl" checked> 마감한 목표 제외</label>'
        + '<div class="fl" style="margin-top:16px">조직도</div>'
        + '<div class="txf-tree">' + roots.map(function (r) { return treeHTML(r.org_id, isMember); }).join('') + '</div></div>'
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
    var MODE_LABELS = ['달성률', '절대값', '구간', '여부'];
    var CMP_LABELS = { yoy: '전년 실적', peer: '동료·직군 평균', market: '시장·고객 기준' };
    /* 신규 KR 행 기본 가중치 = 잔여분 (100 하드코딩 폐지) */
    function krWeightSum() {
      if (!newOv) return 0;
      var s = 0;
      Array.prototype.forEach.call(newOv.querySelectorAll('.txf-krw'), function (i) { s += parseFloat(i.value) || 0; });
      return s;
    }
    function nextKRWeight() {
      if (!newOv || !newOv.querySelectorAll('.txf-kr').length) return 100;
      var rem = 100 - krWeightSum();
      return rem > 0 ? Math.round(rem) : 0;
    }
    function krRowHTML(data) {
      krSeq++; data = data || {};
      var id = 'k' + krSeq, modes = MODE_LABELS;
      var wv = (data.weight == null || data.weight === '') ? nextKRWeight() : data.weight;
      var modeIx = (typeof data.mode === 'number' && data.mode >= 0) ? data.mode : 0;
      var srcs = data.sources || [];
      var srcHTML = srcs.map(function (s) {
            var lbl = srcLabel(s);
            if (!lbl) return '';
            return ' <span class="txf-src" data-txf="src" data-sid="' + esc(s) + '" title="출처 원본 보기">' + esc(lbl) + '</span>';
          }).join('');
      var whyBody = data.why || (data.whyText ? esc(data.whyText) : '');
      return '<div class="txf-kr" data-kr="' + id + '"'
        + ' data-why="' + esc(data.whyText || '') + '"'
        + ' data-jobtask="' + esc(data.jobTask || '') + '"'
        + ' data-comp="' + esc(data.competencyId || '') + '"'
        + ' data-sources="' + esc(srcs.join(',')) + '">'
        + '<div class="kh">핵심 성과 <span class="krn">' + '</span><span class="x" data-txf="kr-x" data-kr="' + id + '">✕</span></div>'
        + '<div class="txf-sub">성과 지표 <span style="color:var(--red)">*</span></div>'
        + '<input class="txf-inp" placeholder="성과지표를 입력합니다." value="' + esc(data.name || '') + '">'
        + '<div class="txf-sub">설명</div>'
        + '<div class="txf-rte"><div class="txf-rtebar"><b>B</b><b>U</b><span>Aa</span><span>A</span><span><i>i</i></span><span>S</span><span>≔</span><span>⋮</span><span>¶</span><span>🔗</span><span>▤</span></div><textarea placeholder="성과지표에 대한 설명을 입력합니다. (필수 항목 아님)">' + esc(data.desc || '') + '</textarea></div>'
        + '<div class="txf-sub">관리 방식</div>'
        + '<div class="txf-radios">' + modes.map(function (m, i) {
            return '<label><input type="radio" name="mode-' + id + '"' + (modeIx === i ? ' checked' : '') + '> ' + m + '</label>';
          }).join('') + '</div>'
        + '<div class="txf-sub">목표값 <span style="color:var(--red)">*</span></div>'
        + '<input class="txf-inp txf-krtv" placeholder="달성 판정 기준값 — 예: 90%, 12회, 5일 이내" value="' + esc(data.target || '') + '">'
        + '<div class="txf-sub">핵심 성과 가중치 <span style="color:var(--red)">*</span></div>'
        + '<input class="txf-inp txf-krw" type="number" min="0" max="100" value="' + wv + '">'
        + '<div class="txf-sub">난이도 · 난이도 근거</div>'
        + '<div class="txf-diffrow"><select class="txf-inp txf-krdiff">'
        + ['S', 'A', 'B'].map(function (d) {
            return '<option value="' + d + '"' + ((data.diff || 'A') === d ? ' selected' : '') + '>' + d + '</option>';
          }).join('')
        + '</select>'
        + '<select class="txf-inp txf-krdiffbasis">'
        + [['yoy', '전년 실적'], ['peer', '동료·직군 평균'], ['market', '시장·고객 기준']].map(function (b) {
            return '<option value="' + b[0] + '"' + ((data.difftype || 'yoy') === b[0] ? ' selected' : '') + '>' + b[1] + '</option>';
          }).join('')
        + '</select>'
        + '<input class="txf-inp txf-krdiffwhy" placeholder="난이도 근거 수치·설명 — 예: 전년 실적 대비 +30% 상향" value="' + esc(data.diffwhy || '') + '"></div>'
        + '<div class="txf-diffwhy">ⓘ 무엇과 비교해 어려운지(작년 실적·동료 수준) 남겨야 평가 시점의 난이도 반영이 가능합니다.</div>'
        + ((whyBody || srcHTML) ? '<div class="txf-krwhy">✦ 이 핵심 성과의 근거 — ' + whyBody
            + (data.jobTask ? ' <b>· 직무 과업 ' + esc(data.jobTask) + '</b>' : '')
            + (data.competencyId && compKrName[data.competencyId] ? ' <b>· 역량 ' + esc(compKrName[data.competencyId]) + '</b>' : '')
            + srcHTML + '</div>' : '')
        + '</div>';
    }
    /* KR 행 DOM → 데이터 (krRowHTML의 입력 포맷과 동일 — 스냅샷·저장 공용) */
    function readKRRow(row) {
      function q(s) { var e = row.querySelector(s); return e ? e : null; }
      var nameInp = q('input.txf-inp'), ta = q('textarea'), tv = q('.txf-krtv'), w = q('.txf-krw');
      var d1 = q('.txf-krdiff'), d2 = q('.txf-krdiffbasis'), d3 = q('.txf-krdiffwhy');
      var mode = 0;
      Array.prototype.forEach.call(row.querySelectorAll('input[type="radio"]'), function (r, i) { if (r.checked) mode = i; });
      return {
        name: nameInp ? nameInp.value : '',
        desc: ta ? ta.value : '',
        target: tv ? tv.value : '',
        mode: mode,
        weight: w ? (parseFloat(w.value) || 0) : 0,
        diff: d1 ? d1.value : 'A',
        difftype: d2 ? d2.value : 'yoy',
        diffwhy: d3 ? d3.value : '',
        whyText: row.getAttribute('data-why') || '',
        jobTask: row.getAttribute('data-jobtask') || '',
        competencyId: row.getAttribute('data-comp') || '',
        sources: (row.getAttribute('data-sources') || '').split(',').filter(Boolean)
      };
    }
    function weightGaugeHTML() {
      return '<div class="txf-wsum" data-txf-wsum><span class="lb">가중치 합계</span>'
        + '<span class="tr"><i style="width:0%"></i></span><span class="vv">0%</span>'
        + '<button class="eq" data-txf="kr-even">균등 배분</button></div>';
    }
    function refreshWeightGauge() {
      if (!newOv) return;
      var g = newOv.querySelector('[data-txf-wsum]'); if (!g) return;
      var s = Math.round(krWeightSum() * 10) / 10;
      var ok = s === 100;
      g.classList.toggle('bad', !ok);
      var i = g.querySelector('.tr i'); if (i) i.style.width = Math.max(0, Math.min(100, s)) + '%';
      var v = g.querySelector('.vv'); if (v) v.textContent = s + '%' + (ok ? ' ✓' : ' (100% 필요)');
    }
    function evenWeights() {
      if (!newOv) return 0;
      var inps = newOv.querySelectorAll('.txf-krw');
      var n = inps.length; if (!n) return 0;
      var base = Math.floor(100 / n), rem = 100 - base * n;
      Array.prototype.forEach.call(inps, function (inp, i) { inp.value = base + (i < rem ? 1 : 0); });
      refreshWeightGauge();
      return n;
    }
    function renumberKR() {
      if (!newOv) return;
      var rows = newOv.querySelectorAll('.txf-kr');
      rows.forEach(function (r, i) { var n = r.querySelector('.krn'); if (n) n.textContent = (i + 1); });
      var stepKR = newOv.querySelector('[data-step="kr"]');
      if (stepKR) stepKR.firstChild && (stepKR.querySelector('.lbl').textContent = '핵심 성과 ' + rows.length);
      refreshWeightGauge();
    }
    /* ---- 저장 게이트 (F2·F3) — bad 린트·근거 없는 S 난이도는 사유 없이 저장 불가 ---- */
    function gateIssues() {
      var out = [];
      if (!newOv) return out;
      var rows = newOv.querySelectorAll('.txf-kr');
      if (window.EZLint) {
        Array.prototype.forEach.call(rows, function (row, i) {
          var kr = EZLint.krFromRow(row);
          var tvEl = row.querySelector('.txf-krtv');
          if (tvEl) kr.targetValue = tvEl.value;   // 전용 목표값 필드 신설 — name 폴백 대신 실제 값으로 린트
          if (!String(kr.name || '').trim()) return;
          var bad = EZLint.lintKR(kr).filter(function (h) { return h.cls === 'bad'; });
          if (kr.diff === 'S' && !String(kr.basisVal || '').trim())
            bad.push({ id: 'diff-s', tag: 'S 난이도 근거 없음', tip: 'S 난이도는 비교 근거가 필요합니다', word: '난이도 S' });
          if (bad.length) out.push({ idx: i + 1, name: kr.name, kr: kr, hits: bad });
        });
      }
      /* E: 가중치 합 검사 — 합계 100%가 아니면 저장 게이트로 */
      var named = 0;
      Array.prototype.forEach.call(rows, function (row) {
        var n = row.querySelector('input.txf-inp');
        if (n && n.value.trim()) named++;
      });
      var sum = Math.round(krWeightSum() * 10) / 10;
      if (named && sum !== 100) {
        out.push({ idx: 0, name: '핵심 성과 가중치 합계 ' + sum + '%', kr: null, hits: [{
          id: 'w-sum', tag: '가중치 합 100% 아님', word: sum + '%',
          tip: '핵심 성과 가중치 합계는 100%여야 합니다 — [균등 배분] 버튼으로 맞출 수 있습니다'
        }] });
      }
      return out;
    }
    function finishNewSave(reason) {
      if (reason) {
        /* "알고도 남긴 근거"를 맥락 원장에 기록 — 평가 시점에 조회 가능 */
        try {
          document.dispatchEvent(new CustomEvent('ez:ctx', { detail: {
            type: 'goal', source: 'goal.gate.override',
            title: '측정 가능성 경고를 확인하고 저장',
            summary: '사유: ' + reason,
            weight: 2
          } }));
        } catch (e) { /* 원장 부재 — 무해화 */ }
      }
      /* 생성 즉시 목록 반영 — 세션 메모리(원본 talenx_data.js 불변, 새로고침 시 초기화) */
      try {
        var nmInp = newOv && newOv.querySelector('[data-txf="new-name"]');
        var title = nmInp ? nmInp.value.trim() : '';
        if (title) {
          var dscEl = newOv.querySelector('[data-txf="new-desc"]');
          var psEl = newOv.querySelector('[data-txf="new-parent"]');
          var owEl = newOv.querySelector('[data-txf="new-objw"]');
          var pid = psEl ? psEl.value : '';
          var parent = pid ? objById[pid] : null;
          var oid = 'OBJ-NEW-' + Date.now();
          var no = { objective_id: oid, title: title,
                     description: dscEl ? dscEl.value.trim() : '',
                     owner_emp_id: CU.emp_id, org_id: cuEmp.org_id, type: '개인',
                     parent_objective_id: pid || null,
                     period: (parent && parent.period) || 'FY2026',
                     strategy_theme_id: (parent && parent.strategy_theme_id) || cuEmp.strategy_theme_id || null,
                     alignment_reason: (pid && pid === alignFor) ? alignReason : '',
                     weight: owEl ? (parseFloat(owEl.value) || 0) : null,
                     progress: 0, status: '진행중', _session: true };
          if (cuEmp.jobProfileId) no.job_ref = { jobProfileId: cuEmp.jobProfileId, task_area: '' };
          objs.push(no); objById[oid] = no;
          (objByOwner[CU.emp_id] = objByOwner[CU.emp_id] || []).push(no);
          (objByOrg[no.org_id] = objByOrg[no.org_id] || []).push(no);
          var rows = newOv.querySelectorAll('.txf-kr');
          Array.prototype.forEach.call(rows, function (row, i) {
            var d = readKRRow(row);
            if (!String(d.name || '').trim()) return;
            if (no.job_ref && !no.job_ref.task_area && d.jobTask) no.job_ref.task_area = d.jobTask;
            var nk = { kr_id: oid + '-KR' + (i + 1), objective_id: oid, name: d.name,
                       description: d.desc || '',
                       target_value: d.target || '',
                       mode: MODE_LABELS[d.mode] || MODE_LABELS[0],
                       weight: d.weight + '%',
                       progress: 0, current_value: 0, difficulty: d.diff || 'A',
                       /* 목표 상세 렌더(.label/.note)와 정합 — 문자열이 아니라 객체 */
                       difficulty_basis: { label: CMP_LABELS[d.difftype] || CMP_LABELS.yoy,
                                           note: d.diffwhy || '', compare: d.difftype || 'yoy' },
                       why: d.whyText || '',
                       sources: d.sources || [],
                       competency_id: d.competencyId || null };
            if (d.jobTask) nk.job_task_ref = { task_area: d.jobTask };
            krs.push(nk);
            (krByObj[oid] = krByObj[oid] || []).push(nk);
          });
        }
      } catch (e) { /* 반영 실패해도 저장 흐름은 유지 */ }
      TX.toast && TX.toast('목표를 생성했습니다. 목록에 반영되었습니다. (데모 — 새로고침 시 초기화)', 'ok');
      closeNew();
      renderGoalBody();
    }
    function openSaveGate(issues) {
      if (!TX.modal) { finishNewSave(); return; }
      var MODES = ['달성률', '절대값', '구간', '여부'];
      var body = document.createElement('div');
      body.innerHTML =
        '<div style="font-weight:700;margin-bottom:9px">이 표현은 평가 시점에 측정할 수 없습니다</div>'
        + issues.map(function (it) {
            return '<div style="border:1px solid var(--line);border-radius:9px;padding:9px 12px;margin-bottom:7px;font-size:12.5px">'
              + '<b>' + (it.idx ? '핵심 성과 ' + it.idx : '폼 전체') + '</b> · ' + esc(it.name)
              + '<div style="margin-top:4px">'
              + it.hits.map(function (h) {
                  return '<div style="color:var(--red)">· [' + esc(h.tag) + ']'
                    + (h.word ? ' “' + esc(h.word) + '”' : '') + ' — ' + esc(h.tip) + '</div>';
                }).join('')
              + '</div></div>';
          }).join('')
        + '<div style="font-size:12px;color:var(--ink-3);margin:10px 0 5px">그대로 저장하려면 사유가 필요합니다 — 사유는 성과 기록에 저장되어 평가 시점에 함께 조회됩니다.</div>'
        + '<textarea class="txf-inp" data-gate-reason placeholder="그대로 저장하는 사유 (필수)" style="width:100%;min-height:58px;resize:vertical"></textarea>';
      TX.modal({
        title: '저장 전 확인 — 측정 가능성', body: body,
        actions: [
          { label: '✦ elizax로 정제', kind: 'ghost', onClick: function () {
              var lines = issues.filter(function (it) { return it.kr; }).map(function (it) {
                return '- ' + it.name + ' (관리 방식: ' + (MODES[it.kr.mode] || '미선택') + ' · 난이도 ' + (it.kr.diff || '-')
                  + (it.kr.basisVal ? ' · 비교 근거: ' + it.kr.basisVal : ' · 비교 근거 없음') + ')';
              }).join('\n');
              window.Elizax && Elizax.send && Elizax.send('다음 KR 문장을 측정 가능하게 바꿔줘 — 수치·기한·판정 기준 포함:\n' + lines);
            } },
          { label: '그대로 저장', kind: 'primary', onClick: function () {
              var ta = body.querySelector('[data-gate-reason]');
              var reason = ta ? ta.value.trim() : '';
              if (!reason) { TX.toast && TX.toast('사유를 입력해야 저장할 수 있습니다.', 'warn'); return false; }
              finishNewSave(reason + ' (지적 항목: ' + issues.map(function (it) {
                return '핵심성과' + it.idx + ' ' + it.hits.map(function (h) { return h.tag; }).join('·');
              }).join(' / ') + ')');
            } }
        ]
      });
    }
    /* ---- F6: 이어받은 출발점 — 작년 기록 실데이터 (currentUser 기준) ---- */
    var GR_COL = { S: '#C2410C', A: '#1F7AF0', B: '#4B5563', C: '#E23B3B' };
    /* F3: 원본 레코드 우선, 없으면 EZTools.deriveCarry 파생분(전 직원 성립) */
    var _c0 = safeCarry() || {};
    var prevEval = (D.evaluationsPrev || []).filter(function (x) { return x.emp_id === CU.emp_id; })[0] || _c0.evaluation || null;
    var prevFbs = (D.feedbackHistory || []).filter(function (x) { return x.emp_id === CU.emp_id; }).slice(0, 2);
    if (!prevFbs.length && _c0.feedback) prevFbs = _c0.feedback.slice(0, 2);
    var jobChg = (cuEmp.jobHistory || [])[0] || _c0.job_change || null;
    var srcMap = {};   // 출처 ID → 원본 요약 (칩 클릭 시 표시)
    if (prevEval) srcMap[prevEval.evaluation_id] = 'FY2025 평가 — 등급 ' + prevEval.grade + (prevEval.score != null ? ' · ' + prevEval.score + '점' : '') + '. ' + (prevEval.rationale_summary || '');
    prevFbs.forEach(function (f) { srcMap[f.fb_id] = 'FY2025 피드백(' + (f.source_type === 'leader' ? '리더' : '동료') + ') — ' + f.summary; });
    if (jobChg) srcMap['JOB-CHG'] = '직무 전환 ' + jobChg.prev_label + ' → ' + jobChg.new_label + '. ' + (jobChg.note || '');
    /* 출처 ID → 화면에 낼 짧은 사람 말. 모르는 ID는 빈 문자열(호출부가 감춘다). */
    function srcLabel(id) {
      if (!id) return '';
      if (prevEval && id === prevEval.evaluation_id) return '작년 평가';
      var fbHit = null;
      prevFbs.forEach(function (f) { if (f.fb_id === id) fbHit = f; });
      if (fbHit) return fbHit.source_type === 'leader' ? '작년 리더 피드백' : '작년 동료 피드백';
      if (id === 'JOB-CHG') return '직무 전환';
      return '';
    }
    function srcChip(id, label) {
      if (!id || !srcMap[id]) return '';
      var lbl = label || srcLabel(id);
      if (!lbl) return '';
      return ' <span class="txf-src" data-txf="src" data-sid="' + esc(id) + '" title="출처 원본 보기">' + esc(lbl) + '</span>';
    }
    function undoneKRs() {
      return prevEval ? (prevEval.krs || []).filter(function (k) { return !k.done; }) : [];
    }
    function emitGoalCtx(source, title, summary) {
      try {
        document.dispatchEvent(new CustomEvent('ez:ctx', { detail: {
          type: 'goal', source: source, title: title, summary: summary, weight: 2
        } }));
      } catch (e) { /* 원장 부재 — 무해화 */ }
    }
    /* F3: 항목별 체크박스 — 체크된 항목만 [✦ AI 초안에 반영]의 컨텍스트로 들어간다 */
    function cvCheck(key, label) {
      return '<label class="txf-cvck"><input type="checkbox" data-carry="' + key + '" checked>' + esc(label) + '</label>';
    }
    function carryPanelHTML(cls) {
      if (!prevEval && !prevFbs.length && !jobChg) return '';
      var h = '<div class="txf-carry' + (cls ? ' ' + cls : '') + '"><div class="ch">↩ 이어받은 출발점<span class="sub">작년 기록 — 올해 목표의 재료 · 체크한 항목만 AI 초안에 넣습니다</span></div>';
      if (prevEval) {
        h += '<div class="txf-cv">' + cvCheck('grade', '작년 등급')
          + '<div class="cvb"><b class="gr" style="color:' + (GR_COL[prevEval.grade] || 'var(--ink)') + '">' + esc(prevEval.grade) + '</b> '
          + (prevEval.score != null ? prevEval.score + '점' : '') + ' <span class="pd">' + esc(prevEval.period || '') + '</span></div>'
          + (prevEval.rationale_summary ? '<div class="cvn">' + esc(prevEval.rationale_summary) + '</div>' : '')
          + '<div class="cvs">출처' + srcChip(prevEval.evaluation_id) + '</div></div>';
        var und = undoneKRs();
        if (und.length) {
          h += '<div class="txf-cv">' + cvCheck('undone', '미완 핵심 성과 ' + und.length + '건')
            + und.map(function (k, i) {
                return '<div class="cvk"><span class="nm">' + esc(k.name) + '</span><span class="ach">' + k.achievement_pct + '%</span>'
                  + '<button class="cvbtn" data-txf="carry-kr" data-ci="' + i + '">그대로 이월</button></div>';
              }).join('')
            + '<div class="cvs">출처' + srcChip(prevEval.evaluation_id) + '</div></div>';
        }
      }
      if (prevFbs.length) {
        h += '<div class="txf-cv">' + cvCheck('feedback', '피드백 요지 ' + prevFbs.length + '건')
          + prevFbs.map(function (f) { return '<div class="cvn">· ' + esc(f.summary) + srcChip(f.fb_id) + '</div>'; }).join('')
          + '</div>';
      }
      if (jobChg) {
        h += '<div class="txf-cv">' + cvCheck('jobchg', '직무 변경')
          + '<div class="cvb">' + esc(jobChg.prev_label) + ' → <b>' + esc(jobChg.new_label) + '</b> <span class="pd">' + esc(jobChg.period || '') + '</span></div>'
          + (jobChg.note ? '<div class="cvn">' + esc(jobChg.note) + '</div>' : '')
          + '<div class="cvs">출처' + srcChip('JOB-CHG', '직무 전환') + '</div></div>';
      }
      /* 상단 [✦ AI 목표 추천](data-txf="ai")=전체 컨텍스트 / 여기=체크한 carry 항목만 */
      h += '<button class="txf-carryai" data-txf="ai-carry">✦ 체크한 항목만 AI 초안에 반영</button></div>';
      return h;
    }
    /* F3: 진입 배너 — 이어받은 재료를 폼 최상단에서 먼저 알린다(조용한 증발 금지) */
    function carryBannerHTML() {
      var c = safeCarry();
      var bits = [];
      if (c && !c.first_cycle) {
        if (c.evaluation) bits.push('등급 ' + c.evaluation.grade + (c.derived ? '(이력 파생)' : ''));
        if (c.undone_krs && c.undone_krs.length) bits.push('미완 KR ' + c.undone_krs.length + '건');
        if (c.feedback && c.feedback.length) bits.push('피드백 ' + c.feedback.length + '건');
        if (c.job_change) bits.push('직무 변경 1건');
      }
      if (!bits.length) {
        return '<div class="txf-cbn first">🌱 <b>첫 사이클</b> — 이어받을 작년 기록이 없어 직무 기준(주요 과업·기대 스킬)으로 시작합니다.</div>';
      }
      var per = (c.evaluation && c.evaluation.period) || 'FY2025';
      return '<div class="txf-cbn">↩ <span><b>' + esc(per) + '</b>에서 이어받음 — ' + esc(bits.join(' · ')) + '</span>'
        + '<button class="cbtn" data-txf="carry-review">출발점 검토</button></div>';
    }
    /* F3: 체크 상태 → carry 필터 (null이면 전체 컨텍스트) */
    var carryFilter = null;
    function carryPicksFrom() {
      var out = { grade: true, undone: true, feedback: true, jobchg: true };
      if (!newOv) return out;
      ['grade', 'undone', 'feedback', 'jobchg'].forEach(function (key) {
        var cb = newOv.querySelector('.txf-carry [data-carry="' + key + '"]');
        if (cb) out[key] = !!cb.checked;
      });
      return out;
    }
    function filteredCarry() {
      var c = safeCarry();
      if (!c || !carryFilter) return c;
      return {
        first_cycle: c.first_cycle, derived: c.derived,
        evaluation: carryFilter.grade ? c.evaluation : null,
        undone_krs: carryFilter.undone ? (c.undone_krs || []) : [],
        feedback: carryFilter.feedback ? (c.feedback || []) : [],
        job_change: carryFilter.jobchg ? c.job_change : null,
        filtered: true
      };
    }
    /* F3: 출처 칩 → 원장 딥링크(있으면), 없으면 요약 토스트 폴백 */
    function openSrc(sid) {
      if (!sid) return;
      var summary = srcMap[sid];
      if (window.EZLedger && typeof EZLedger.openPanel === 'function') {
        try {
          EZLedger.openPanel(sid);
          if (summary) TX.toast && TX.toast(summary);
          return;
        } catch (e) { /* 원장 열기 실패 — 토스트 폴백 */ }
      }
      TX.toast && TX.toast(summary || '원본 기록을 찾지 못했습니다.');
    }
    /* F3: 미완 KR 그대로 이월 (진척 개념 없는 폼 — name 프리필) */
    function carryTo(i) {
      var und = undoneKRs();
      var ck = und[i];
      var list = newOv && newOv.querySelector('[data-txf="kr-list"]');
      if (!ck || !list || !prevEval) return;
      list.insertAdjacentHTML('beforeend', krRowHTML({
        name: ck.name, weight: '', diff: 'A', difftype: 'yoy',
        diffwhy: '작년 달성률 ' + ck.achievement_pct + '% — 미완 과제 이월',
        why: '작년 미완 핵심 성과 이월 (달성률 ' + ck.achievement_pct + '%)' + srcChip(prevEval.evaluation_id)
      }));
      renumberKR();
      emitGoalCtx('goal.carryover', '작년 미완 핵심 성과 이월 — ' + ck.name,
        '출처 ' + srcLabel(prevEval.evaluation_id) + ' · 작년 달성률 ' + ck.achievement_pct + '%');
      TX.toast && TX.toast('작년 미완 핵심 성과를 이월했습니다. 출처가 함께 기록됩니다.', 'ok');
    }
    /* F3: 좁은 화면(≤1100px)에서 carry 패널이 숨겨졌을 때의 검토 경로 */
    function openCarryReview() {
      var panel = newOv && newOv.querySelector('.txf-carry');
      if (panel && panel.offsetParent !== null) {
        panel.scrollIntoView({ block: 'nearest' });
        panel.classList.add('hl');
        setTimeout(function () { panel.classList.remove('hl'); }, 1600);
        return;
      }
      var html = carryPanelHTML('txf-carry-modal');
      if (!html) { TX.toast && TX.toast('이어받을 작년 기록이 없습니다 — 직무 기준으로 시작합니다.'); return; }
      var body = document.createElement('div');
      body.innerHTML = '<div style="font-size:12.5px;color:var(--ink-3);margin-bottom:10px">체크를 해제한 항목은 AI 초안 컨텍스트에서 제외됩니다.</div>'
        + html;
      var m = body.querySelector('.txf-carry');
      if (m) { m.style.width = '100%'; m.style.border = 'none'; m.style.padding = '0'; }
      /* 모달 체크 상태를 원본 패널에 동기화 — 필터의 단일 원천은 패널 */
      body.addEventListener('change', function (e) {
        var cb = e.target && e.target.closest ? e.target.closest('[data-carry]') : null;
        if (!cb || !newOv) return;
        var src = newOv.querySelector('.txf-carry:not(.txf-carry-modal) [data-carry="' + cb.getAttribute('data-carry') + '"]');
        if (src) src.checked = cb.checked;
      });
      /* 모달은 #s-perf 밖 — sec 위임이 닿지 않으므로 여기서 직접 결선 */
      var handle = null;
      body.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('[data-txf]') : null;
        if (!b) return;
        var k = b.getAttribute('data-txf');
        e.preventDefault();
        if (k === 'src') { openSrc(b.getAttribute('data-sid')); return; }
        if (k === 'carry-kr') { carryTo(parseInt(b.getAttribute('data-ci'), 10)); return; }
        if (k === 'ai-carry') {
          carryFilter = carryPicksFrom();
          if (handle && handle.close) handle.close();
          startDraft(true);
          return;
        }
      });
      handle = TX.modal && TX.modal({ title: '이어받은 출발점 검토', body: body, actions: [{ label: '닫기', kind: 'ghost' }] });
    }
    /* ============================================================= *
     *  F1 · F2 — 구조화 JSON 초안 + 초안 시트(EzDraftSheet)            *
     * ============================================================= */
    /* ---- 상위 목표 후보: 사용자 조직 체인 스코프 (전사 무필터 해소) ---- */
    function parentCandidates() {
      var chain = ancestorOrgs(cuEmp.org_id);   // [본인 조직, 상위, ... 루트]
      var list = objs.filter(function (o) { return o.type === '조직' && chain.indexOf(o.org_id) >= 0; });
      list.sort(function (a, b) { return chain.indexOf(a.org_id) - chain.indexOf(b.org_id); });
      return list;
    }
    function parentSelectHTML() {
      var list = parentCandidates(), scoped = true;
      if (!list.length) { list = objs.filter(function (o) { return o.type === '조직'; }).slice(0, 40); scoped = false; }
      var html = '<option value="">상위 목표를 선택합니다.</option>'
        + list.map(function (o) {
            var og = orgById[o.org_id] || {};
            return '<option value="' + o.objective_id + '">' + esc((og.name ? og.name + ' · ' : '') + o.title) + '</option>';
          }).join('');
      return { html: html, scoped: scoped, count: list.length };
    }
    var alignReason = '', alignFor = '';
    function refreshAlignNote() {
      if (!newOv) return;
      var el = newOv.querySelector('[data-txf="new-align"]'); if (!el) return;
      var ps = newOv.querySelector('[data-txf="new-parent"]');
      var pid = ps ? ps.value : '';
      if (!pid) { el.style.display = 'none'; el.innerHTML = ''; return; }
      var p = objById[pid] || {}, og = orgById[p.org_id] || {};
      var showReason = alignReason && alignFor === pid;
      el.style.display = '';
      el.innerHTML = '<b>정렬 사유</b> · ' + esc(og.name || '상위 조직') + '의 「' + esc(p.title || pid) + '」에 연계됩니다.'
        + (showReason ? '<div class="rs">✦ ' + esc(alignReason) + '</div>' : '');
    }

    /* ---- 폼 스냅샷 · 복원 (Undo) ---- */
    function formSnapshot() {
      if (!newOv) return null;
      var nm = newOv.querySelector('[data-txf="new-name"]');
      var ds = newOv.querySelector('[data-txf="new-desc"]');
      var ps = newOv.querySelector('[data-txf="new-parent"]');
      return {
        name: nm ? nm.value : '', desc: ds ? ds.value : '', parent: ps ? ps.value : '',
        align: alignReason, alignFor: alignFor,
        krs: Array.prototype.map.call(newOv.querySelectorAll('.txf-kr'), readKRRow)
      };
    }
    function restoreSnapshot(s) {
      if (!s || !newOv) return;
      var nm = newOv.querySelector('[data-txf="new-name"]');
      var ds = newOv.querySelector('[data-txf="new-desc"]');
      var ps = newOv.querySelector('[data-txf="new-parent"]');
      if (nm) nm.value = s.name;
      if (ds) ds.value = s.desc;
      if (ps) ps.value = s.parent;
      alignReason = s.align || ''; alignFor = s.alignFor || '';
      var list = newOv.querySelector('[data-txf="kr-list"]');
      if (list) list.innerHTML = (s.krs.length ? s.krs : [{ weight: 100 }]).map(function (d) { return krRowHTML(d); }).join('');
      renumberKR();
      refreshAlignNote();
    }
    var undoEl = null, undoTimer = null, undoSnap = null;
    function showUndo(snap, n) {
      if (!newOv) return;
      undoSnap = snap;
      if (!undoEl) { undoEl = document.createElement('div'); undoEl.className = 'txf-undo'; newOv.appendChild(undoEl); }
      undoEl.innerHTML = '<span>초안 ' + n + '개 항목을 적용했습니다.</span>'
        + '<button class="ub" data-txf="ds-undo">되돌리기</button>';
      undoEl.classList.add('open');
      if (undoTimer) clearTimeout(undoTimer);
      undoTimer = setTimeout(function () { if (undoEl) undoEl.classList.remove('open'); undoSnap = null; }, 8000);
    }
    function hideUndo() { if (undoTimer) clearTimeout(undoTimer); if (undoEl) undoEl.classList.remove('open'); undoSnap = null; }

    /* ---- 이어받은 출발점: 전 직원 런타임 파생 (EZTools.deriveCarry) ---- */
    var _carry;
    function safeCarry() {
      if (_carry !== undefined) return _carry;
      try { _carry = (window.EZTools && EZTools.deriveCarry) ? EZTools.deriveCarry(cuEmp) : null; }
      catch (e) { _carry = null; }
      return _carry;
    }

    /* ---- 파싱: 첫 { ~ 마지막 } 슬라이스 후 JSON.parse ---- */
    function parseDraftJSON(text) {
      var s = String(text == null ? '' : text);
      var a = s.indexOf('{'), b = s.lastIndexOf('}');
      if (a < 0 || b <= a) return null;
      try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
    }

    /* ---- 검증 레이어 (순수 함수) — 적용 전 정규화 + 경고 수집 ---- */
    function validateDraft(raw) {
      var W = [];
      raw = raw || {};
      var o = raw.objective || {};
      var obj = {
        name: String(o.name == null ? '' : o.name).trim(),
        description: String(o.description == null ? '' : o.description).trim(),
        parent_objective_id: String(o.parent_objective_id == null ? '' : o.parent_objective_id).trim(),
        alignment_reason: String(o.alignment_reason == null ? '' : o.alignment_reason).trim()
      };
      if (obj.parent_objective_id && !objById[obj.parent_objective_id]) {
        W.push('제안한 상위 목표가 데이터에 없어 무시했습니다.');
        obj.parent_objective_id = '';
      }
      var list = (raw.keyResults || raw.key_results || []);
      if (!Array.isArray(list)) list = [];
      list = list.filter(function (k) { return k && String(k.name == null ? '' : k.name).trim(); });
      if (list.length > 5) { W.push('핵심 성과 ' + list.length + '건 중 5건까지만 사용합니다.'); list = list.slice(0, 5); }
      if (list.length && list.length < 3) W.push('핵심 성과가 ' + list.length + '건입니다 — 3~5건을 권장합니다.');
      var krs = list.map(function (k) {
        var w = [];
        var mode = MODE_LABELS.indexOf(String(k.mode == null ? '' : k.mode).trim());
        if (mode < 0) { if (k.mode) w.push('관리 방식 "' + k.mode + '"을(를) 인식하지 못해 달성률로 설정'); mode = 0; }
        var diff = String(k.difficulty == null ? '' : k.difficulty).trim().toUpperCase();
        if (['S', 'A', 'B'].indexOf(diff) < 0) { w.push('난이도 값이 없거나 규격 밖이라 A로 설정'); diff = 'A'; }
        var basis = k.difficulty_basis || {};
        var cmp = String(basis.compare == null ? '' : basis.compare).trim();
        if (!CMP_LABELS[cmp]) cmp = 'yoy';
        var note = String(basis.note == null ? '' : basis.note).trim();
        if (!note) w.push('난이도 근거(비교 수치)가 비어 있습니다');
        var tv = String(k.target_value == null ? '' : k.target_value).trim();
        if (!tv) w.push('목표값이 없습니다 — 판정 기준 수치를 채워주세요');
        var wt = parseFloat(k.weight);
        if (!isFinite(wt) || wt < 0) wt = 0;
        var srcs = Array.isArray(k.sources) ? k.sources.map(function (x) { return String(x).trim(); }).filter(Boolean) : [];
        return {
          name: String(k.name).trim(),
          desc: String(k.description == null ? '' : k.description).trim(),
          target: tv, mode: mode, weight: wt, diff: diff, difftype: cmp, diffwhy: note,
          whyText: String(k.why == null ? '' : k.why).trim(),
          jobTask: String(k.job_task_ref == null ? '' : k.job_task_ref).trim(),
          competencyId: String(k.competency_id == null ? '' : k.competency_id).trim(),
          sources: srcs, warnings: w
        };
      });
      /* 가중치 합 100 비례 정규화 + 반올림 보정 */
      if (krs.length) {
        var sum = 0; krs.forEach(function (k) { sum += k.weight; });
        var norm;
        if (sum <= 0) {
          var base = Math.floor(100 / krs.length), rem0 = 100 - base * krs.length;
          norm = krs.map(function (_, i) { return base + (i < rem0 ? 1 : 0); });
          W.push('가중치가 없어 균등 배분했습니다.');
        } else {
          norm = krs.map(function (k) { return Math.round(k.weight * 100 / sum); });
          var got = 0; norm.forEach(function (n) { got += n; });
          norm[norm.length - 1] = Math.max(0, norm[norm.length - 1] + (100 - got));
          if (Math.round(sum) !== 100) W.push('가중치 합 ' + Math.round(sum) + '% → 100% 기준으로 정규화했습니다.');
        }
        krs.forEach(function (k, i) { k.weight = norm[i]; });
      }
      return { objective: obj, keyResults: krs, warnings: W };
    }

    /* ---- 폴백 템플릿 — AI 결과와 동일한 JSON 구조 (시트가 단일 포맷만 소비) ---- */
    function cannedDraft() {
      var jp = (window.EZJob && EZJob.profileOf) ? EZJob.profileOf(cuEmp)
               : ((D.jobProfiles || {})[cuEmp.jobProfileId] || null);
      var areas = jp ? Object.keys(jp.tasks || {}) : [];
      function area(i) { return areas.length ? areas[i % areas.length] : (cuEmp.jobTitle || '담당 직무'); }
      var topComp = (jp && jp.competency_profile && jp.competency_profile[0]) || null;
      var compId = topComp ? topComp.dimension_id : '';
      var c = filteredCarry();   // F3: carry 체크 필터 반영 (전체 컨텍스트면 필터 없음)
      var evId = (c && c.evaluation && c.evaluation.evaluation_id) || '';
      var fbId = (c && c.feedback && c.feedback[0] && c.feedback[0].fb_id) || '';
      var ps = newOv && newOv.querySelector('[data-txf="new-parent"]');
      var pid = ps ? ps.value : '';
      var ptitle = (ps && pid && ps.options[ps.selectedIndex]) ? ps.options[ps.selectedIndex].text : '';
      var undone = (c && c.undone_krs && c.undone_krs[0]) || null;
      return {
        objective: {
          name: 'FY2026 ' + area(0) + ' 품질·리드타임 개선',
          description: area(0) + ' 과업의 산출물 품질과 처리 속도를 수치로 관리하고, 분기 단위로 검증합니다.',
          parent_objective_id: pid,
          alignment_reason: ptitle ? ('상위 목표 「' + ptitle + '」의 실행 단위를 본인 직무 과업으로 분해했습니다.') : ''
        },
        keyResults: [
          { name: (undone ? undone.name + ' (이월)' : '신규 기능 기획서 사용자 검증 통과율 90% 달성'),
            description: '분기별 검증 회차 기준, 승인 건수 / 제출 건수로 산출합니다.',
            target_value: '90%', mode: '달성률', weight: 40, difficulty: 'A',
            difficulty_basis: { compare: 'yoy', note: '전년 통과율 실적 대비 +15%p 상향' },
            why: '직무 과업 「' + area(0) + '」의 핵심 산출물 품질 지표' + (undone ? ' · 작년 미완 과제 이월(달성률 ' + undone.achievement_pct + '%)' : ''),
            job_task_ref: area(0), competency_id: compId,
            sources: [evId].filter(Boolean) },
          { name: '기획 산출물 평균 리드타임 5일 이내 단축',
            description: '요건 접수일 ~ 최종 산출물 승인일의 영업일 평균.',
            target_value: '5일', mode: '절대값', weight: 30, difficulty: 'S',
            difficulty_basis: { compare: 'peer', note: '동일 직군 평균 6.5일 대비 1.5일 단축' },
            why: '직무 과업 「' + area(1) + '」 처리 속도' + (fbId ? ' · 작년 피드백 보완' : ''),
            job_task_ref: area(1), competency_id: compId,
            sources: [fbId].filter(Boolean) },
          { name: '분기별 사용자 인터뷰 12회 실시 및 인사이트 공유',
            description: '분기 3회 × 4분기, 회차별 요약을 팀 위키에 게시하면 완료로 판정합니다.',
            target_value: '12회', mode: '여부', weight: 30, difficulty: 'B',
            difficulty_basis: { compare: 'market', note: '전년 수준 유지 — 고객 접점 안정 운영' },
            why: '직무 과업 「' + area(2) + '」 고객 이해 기반 확보',
            job_task_ref: area(2), competency_id: compId, sources: [] }
        ]
      };
    }

    /* ---- 프롬프트 ---- */
    var DRAFT_SYSTEM =
      'You are elizax, 성과관리 코치. 반드시 도구로 실제 데이터를 확인한 뒤에만 제안한다. 추정·창작 금지. ' +
      '사용 가능한 도구는 get_job_profile, get_org_objectives, get_prev_cycle, get_strategy_themes, get_objectives 뿐이며 그 외 도구는 호출하지 않는다. ' +
      '최종 답변은 설명·머리말·마크다운 코드펜스 없이 JSON 객체 하나만 출력한다. 스키마: ' +
      '{"objective":{"name","description","parent_objective_id","alignment_reason"},' +
      '"keyResults":[{"name","description","target_value","mode","weight","difficulty","difficulty_basis":{"compare","note"},' +
      '"why","job_task_ref","competency_id","sources"}]} — ' +
      'mode는 "달성률"|"절대값"|"구간"|"여부" 중 하나, difficulty는 "S"|"A"|"B", difficulty_basis.compare는 "yoy"|"peer"|"market", ' +
      'weight는 숫자이며 합계 100, keyResults는 3~5개. target_value에는 달성 판정 수치를 반드시 넣는다. ' +
      'job_task_ref에는 조회한 직무 과업명을, competency_id에는 역량 ID를, sources에는 근거가 된 실제 레코드 ID(평가·피드백 ID)를 배열로 넣는다. ' +
      '모든 문자열은 한국어로 쓴다.';
    function draftPromptText() {
      var ps = newOv && newOv.querySelector('[data-txf="new-parent"]');
      var pid = ps ? ps.value : '';
      var ptitle = (ps && pid && ps.options[ps.selectedIndex]) ? ps.options[ps.selectedIndex].text : '';
      var nm = newOv && newOv.querySelector('[data-txf="new-name"]');
      var ds = newOv && newOv.querySelector('[data-txf="new-desc"]');
      var L = [];
      L.push('대상: ' + (cuEmp.name || '') + ' (' + (CU.emp_id || '') + ') · ' + (cuEmp.jobTitle || '직무 미상')
        + ' · ' + (cuEmp.orgName || (orgById[cuEmp.org_id] || {}).name || '조직 미상'));
      L.push('역할 관점: ' + roleKey() + ' (member=본인 목표, leader=팀 성과 견인, hr/exec=전사 정합성 관점으로 문장 톤을 맞춰라)');
      if (pid) L.push('선택된 상위 목표: 「' + ptitle + '」 (' + pid + ') — parent_objective_id에 이 ID를 그대로 쓰고, alignment_reason에 이 상위 목표와의 정렬 근거를 써라.');
      else L.push('상위 목표 미선택 — get_org_objectives로 소속 조직 체인(팀→본부→전사)의 상위 목표 후보를 조회해 가장 적합한 것을 골라 parent_objective_id에 넣어라.');
      L.push('get_job_profile로 내 직무의 주요 과업·역량·스킬을 조회하고, 각 KR의 job_task_ref에 실제 과업명, competency_id에 실제 역량 ID를 인용하라.');
      L.push('get_strategy_themes로 전략 테마·KPI를 확인해 상위 정합성을 점검하라.');
      var c = filteredCarry();   // F3: 체크된 carry 항목만 컨텍스트로 주입
      var noCarry = !c || (!c.evaluation && !(c.undone_krs || []).length && !(c.feedback || []).length && !c.job_change);
      if (noCarry) {
        L.push('이어받은 기록: ' + ((c && c.filtered) ? '사용자가 이어받기 항목을 모두 해제함' : '없음(첫 사이클)')
          + ' — 직무 기준(주요 과업·기대 스킬)을 출발점으로 설계하라.');
      } else {
        if (c.filtered) L.push('※ 사용자가 선택한 이어받기 항목만 아래에 제공한다 — 제공되지 않은 작년 기록은 추정하지 말 것.');
        if (c.evaluation) L.push('작년 평가[' + c.evaluation.evaluation_id + '] 등급 ' + c.evaluation.grade
          + (c.evaluation.score != null ? ' · ' + c.evaluation.score + '점' : '')
          + (c.evaluation.rationale_summary ? ' · ' + c.evaluation.rationale_summary : '')
          + (c.derived ? ' (이력에서 파생)' : ''));
        if (c.undone_krs && c.undone_krs.length) L.push('작년 미완 핵심성과: '
          + c.undone_krs.map(function (k) { return k.name + '(달성률 ' + k.achievement_pct + '%)'; }).join(' / ')
          + ' — 이월 여부를 판단하고 이월 시 sources에 평가 ID를 넣어라.');
        if (c.feedback && c.feedback.length) L.push('작년 피드백: '
          + c.feedback.map(function (f) { return '[' + f.fb_id + '] ' + f.summary; }).join(' / ')
          + ' — 보완 KR을 만들면 sources에 피드백 ID를 넣어라.');
        if (c.job_change) L.push('직무 변경: ' + c.job_change.prev_label + ' → ' + c.job_change.new_label
          + (c.job_change.note ? ' (' + c.job_change.note + ')' : '') + ' — 새 직무 적합성을 반영하라.');
        L.push('반영 우선순위: ① 미완 과제 이월 ② 피드백 보완 ③ 새 직무 적합성.');
      }
      if (nm && nm.value.trim()) L.push('사용자가 이미 입력한 목표명: ' + nm.value.trim() + ' — 이 의도를 유지하며 다듬어라.');
      if (ds && ds.value.trim()) L.push('사용자가 이미 입력한 목표 설명: ' + ds.value.trim());
      var existing = [];
      if (newOv) Array.prototype.forEach.call(newOv.querySelectorAll('.txf-kr'), function (row) {
        var n = row.querySelector('input.txf-inp');
        if (n && n.value.trim()) existing.push(n.value.trim());
      });
      if (existing.length) L.push('사용자가 이미 입력한 핵심성과: ' + existing.join(' / ') + ' — 중복 없이 보완하라.');
      L.push('위 재료로 목표 1건과 핵심성과 3~5건의 초안을 JSON으로만 답하라.');
      return L.join('\n');
    }

    /* ---- 초안 시트 ---- */
    var dsEl = null, dsState = null;
    function dsEnsure() {
      if (dsEl && dsEl.parentNode) return dsEl;
      dsEl = document.createElement('div');
      dsEl.className = 'txf-ds';
      dsEl.setAttribute('data-txf-ds', '1');
      (newOv || sec).appendChild(dsEl);
      return dsEl;
    }
    function dsClose() { if (dsEl) dsEl.classList.remove('open'); }
    function dsOpen() { dsEnsure().classList.add('open'); dsRender(); }
    function setAIBusy(on) {
      if (!newOv) return;
      Array.prototype.forEach.call(newOv.querySelectorAll('[data-txf="ai"],[data-txf="ai-carry"]'), function (b) {
        b.disabled = !!on;
        if (on) {
          if (b.getAttribute('data-txf-lbl') == null) b.setAttribute('data-txf-lbl', b.innerHTML);
          b.innerHTML = '<span class="txf-spin"></span> 초안 생성 중…';
        } else if (b.getAttribute('data-txf-lbl') != null) {
          b.innerHTML = b.getAttribute('data-txf-lbl');
        }
      });
    }
    function curFormVals() {
      var nm = newOv && newOv.querySelector('[data-txf="new-name"]');
      var ds = newOv && newOv.querySelector('[data-txf="new-desc"]');
      var ps = newOv && newOv.querySelector('[data-txf="new-parent"]');
      var names = [];
      if (newOv) Array.prototype.forEach.call(newOv.querySelectorAll('.txf-kr'), function (row) {
        var n = row.querySelector('input.txf-inp');
        if (n && n.value.trim()) names.push(n.value.trim());
      });
      return {
        name: nm ? nm.value.trim() : '', desc: ds ? ds.value.trim() : '',
        parent: ps ? ps.value : '',
        parentText: (ps && ps.value && ps.options[ps.selectedIndex]) ? ps.options[ps.selectedIndex].text : '',
        krNames: names
      };
    }
    function dsPick(id, def) {
      if (dsState.picks[id] == null) dsState.picks[id] = def;
      return !!dsState.picks[id];
    }
    function dsFieldCard(id, label, proposed, current) {
      var diff = !!(current && current !== String(proposed));
      var on = dsPick(id, !diff);   // 기존 값이 있으면 기본 미선택
      return '<label class="txf-dsc" data-dsc="' + id + '">'
        + '<input type="checkbox" data-dspick="' + id + '"' + (on ? ' checked' : '') + '>'
        + '<div class="bd"><div class="lb">' + esc(label) + '</div>'
        + (diff
            ? '<div class="df"><span class="o">현재 · ' + esc(current) + '</span><span class="n">제안 · ' + esc(proposed) + '</span></div>'
            : '<div class="vv">' + esc(proposed) + '</div>')
        + '</div></label>';
    }
    function dsKRCard(i, k, dup) {
      var id = 'kr-' + i;
      var on = dsPick(id, !dup);
      var chips = '<span class="mc w">가중치 ' + k.weight + '%</span>'
        + '<span class="mc">목표값 ' + esc(k.target || '미입력') + '</span>'
        + '<span class="mc">' + esc(MODE_LABELS[k.mode]) + '</span>'
        + '<span class="mc">난이도 ' + esc(k.diff) + ' · ' + esc(CMP_LABELS[k.difftype]) + '</span>'
        + (k.jobTask ? '<span class="mc">직무 과업 ' + esc(k.jobTask) + '</span>' : '')
        + (k.competencyId && compKrName[k.competencyId] ? '<span class="mc">역량 ' + esc(compKrName[k.competencyId]) + '</span>' : '')
        + k.sources.map(function (s) { var lbl = srcLabel(s); return lbl ? '<span class="mc">출처 ' + esc(lbl) + '</span>' : ''; }).join('');
      return '<label class="txf-dsc" data-dsc="' + id + '">'
        + '<input type="checkbox" data-dspick="' + id + '"' + (on ? ' checked' : '') + '>'
        + '<div class="bd"><div class="lb">핵심 성과 ' + (i + 1) + (dup ? ' · 유사 항목이 이미 있습니다' : '') + '</div>'
        + (dup
            ? '<div class="df"><span class="o">현재 · ' + esc(dup) + '</span><span class="n">제안 · ' + esc(k.name) + '</span></div>'
            : '<div class="vv">' + esc(k.name) + '</div>')
        + '<div class="mt">' + chips + '</div>'
        + (k.diffwhy ? '<div class="why">난이도 근거 · ' + esc(k.diffwhy) + '</div>' : '')
        + (k.whyText ? '<div class="why">✦ ' + esc(k.whyText) + '</div>' : '')
        + (k.warnings.length ? '<div class="wn">⚠ ' + k.warnings.map(esc).join(' · ') + '</div>' : '')
        + '</div></label>';
    }
    function dsBodyHTML() {
      if (dsState.busy) {
        return '<div class="txf-dsk" style="width:62%"></div><div class="txf-dsk" style="width:88%"></div>'
          + '<div class="txf-dsk" style="width:74%"></div>'
          + '<div class="txf-dsnote">elizax가 직무 프로파일 · 상위 목표 · 작년 기록을 조회하는 중입니다.</div>';
      }
      if (dsState.error) {
        return '<div class="txf-dserr"><b>생성 실패</b> · ' + esc(dsState.error)
          + '<div style="margin-top:6px;color:var(--ink-3);font-weight:400">임의로 채우지 않았습니다 — 다시 시도하거나 템플릿 초안으로 이어갈 수 있습니다.</div></div>';
      }
      var d = dsState.draft;
      if (!d) return '<div class="txf-dsnote">표시할 초안이 없습니다.</div>';
      var cur = curFormVals();
      var html = '';
      if (d.objective.name) html += dsFieldCard('obj-name', '목표명', d.objective.name, cur.name);
      if (d.objective.description) html += dsFieldCard('obj-desc', '목표 설명', d.objective.description, cur.desc);
      if (d.objective.parent_objective_id && d.objective.parent_objective_id !== cur.parent) {
        var po = objById[d.objective.parent_objective_id] || {};
        html += dsFieldCard('obj-parent', '상위 목표 연계', po.title || d.objective.parent_objective_id, cur.parentText);
      }
      if (d.objective.alignment_reason) {
        html += '<div class="txf-dsnote">🧭 정렬 사유 · ' + esc(d.objective.alignment_reason) + '</div>';
      }
      html += d.keyResults.map(function (k, i) { return dsKRCard(i, k, cur.krNames[i] || ''); }).join('');
      if (d.warnings.length) html += '<div class="txf-dsnote">⚠ ' + d.warnings.map(esc).join('<br>⚠ ') + '</div>';
      return html;
    }
    function dsFootHTML() {
      if (dsState.busy) {
        return '<span class="txf-dsnote" style="padding:0">근거를 확인하는 중…</span>'
          + '<div class="sp"><button class="ghost-btn" data-txf="ds-stop">중지</button></div>';
      }
      if (dsState.error) {
        return '<div class="sp"><button class="ghost-btn" data-txf="ds-close">닫기</button>'
          + '<button class="ghost-btn" data-txf="ds-template">템플릿으로 계속</button>'
          + '<button class="btn-blue" data-txf="ds-retry">다시 시도</button></div>';
      }
      var d = dsState.draft;
      var n = 0, wsum = 0;
      if (d) d.keyResults.forEach(function (k, i) {
        if (dsState.picks['kr-' + i]) { n++; wsum += k.weight; }
      });
      ['obj-name', 'obj-desc', 'obj-parent'].forEach(function (id) { if (dsState.picks[id]) n++; });
      var wok = !n || wsum === 100 || wsum === 0;
      return '<span style="font-size:12px;color:' + (wok ? 'var(--ink-3)' : 'var(--red,#E23B3B)') + ';font-weight:700">'
        + '적용 시 가중치 합 ' + wsum + '%' + (wok ? '' : ' — 적용 후 [균등 배분]으로 맞추세요') + '</span>'
        + '<div class="sp"><button class="ghost-btn" data-txf="ds-close">닫기</button>'
        + '<button class="ghost-btn" data-txf="ds-retry">✦ 다시 생성</button>'
        + '<button class="ghost-btn" data-txf="ds-apply-all">전체 적용</button>'
        + '<button class="btn-blue" data-txf="ds-apply-sel"' + (n ? '' : ' disabled') + '>선택 항목 적용 (' + n + ')</button></div>';
    }
    function dsRender() {
      if (!dsEl || !dsState) return;
      var chip = dsState.live
        ? '<span class="txf-dschip">실AI 연결</span>'
        : '<span class="txf-dschip tmpl">템플릿</span>';
      var tools = dsState.tools.length
        ? '<div class="tools">확인한 데이터: <b>' + dsState.tools.map(esc).join('</b> · <b>') + '</b></div>'
        : (dsState.live ? '<div class="tools">확인한 데이터: 조회 대기 중…</div>' : '<div class="tools">확인한 데이터: 로컬 직무·작년 기록 (AI 미연결 — 템플릿 초안)</div>');
      dsEl.innerHTML = '<div class="txf-dsh"><span class="tt">✦ elizax 목표 초안</span>' + chip
        + '<span class="x" data-txf="ds-close">✕</span>' + tools + '</div>'
        + '<div class="txf-dsb">' + dsBodyHTML() + '</div>'
        + '<div class="txf-dsf">' + dsFootHTML() + '</div>';
    }
    function dsRefreshFoot() {
      if (!dsEl || !dsState) return;
      var f = dsEl.querySelector('.txf-dsf');
      if (f) f.innerHTML = dsFootHTML();
    }
    function dsApply(all) {
      var d = dsState && dsState.draft;
      if (!d) return;
      var snap = formSnapshot();
      var applied = 0;
      function want(id) { return all || !!dsState.picks[id]; }
      if (d.objective.name && want('obj-name')) {
        var nm = newOv.querySelector('[data-txf="new-name"]');
        if (nm) { nm.value = d.objective.name; applied++; }
      }
      if (d.objective.description && want('obj-desc')) {
        var ds2 = newOv.querySelector('[data-txf="new-desc"]');
        if (ds2) { ds2.value = d.objective.description; applied++; }
      }
      if (d.objective.parent_objective_id && want('obj-parent')) {
        var ps = newOv.querySelector('[data-txf="new-parent"]');
        if (ps) {
          var has = Array.prototype.some.call(ps.options, function (op) { return op.value === d.objective.parent_objective_id; });
          if (!has) {
            var po = objById[d.objective.parent_objective_id] || {};
            var og = orgById[po.org_id] || {};
            ps.insertAdjacentHTML('beforeend', '<option value="' + esc(po.objective_id) + '">'
              + esc((og.name ? og.name + ' · ' : '') + (po.title || po.objective_id)) + '</option>');
          }
          ps.value = d.objective.parent_objective_id;
          applied++;
        }
      }
      if (d.objective.alignment_reason) {
        var psx = newOv.querySelector('[data-txf="new-parent"]');
        alignReason = d.objective.alignment_reason;
        alignFor = psx ? psx.value : '';
      }
      refreshAlignNote();
      var picked = d.keyResults.filter(function (k, i) { return all || dsState.picks['kr-' + i]; });
      if (picked.length) {
        var list = newOv.querySelector('[data-txf="kr-list"]');
        if (list) {
          /* 이름 없는 빈 행 제거 후 append — 추천이 핵심 성과 1부터 채워지도록 */
          Array.prototype.forEach.call(list.querySelectorAll('.txf-kr'), function (row) {
            var n2 = row.querySelector('input.txf-inp');
            if (n2 && !n2.value.trim()) row.remove();
          });
          picked.forEach(function (k) { list.insertAdjacentHTML('beforeend', krRowHTML(k)); });
          applied += picked.length;
          renumberKR();
        }
      }
      /* 원장 기록 — 조건 없이 항상 (carryCtx 게이팅 제거) */
      var srcAll = [];
      picked.forEach(function (k) { (k.sources || []).forEach(function (s) {
        var lbl = srcLabel(s);
        if (lbl && srcAll.indexOf(lbl) < 0) srcAll.push(lbl);
      }); });
      emitGoalCtx('goal.ai.draft',
        'elizax 목표 초안 적용 — ' + applied + '개 항목 (핵심 성과 ' + picked.length + '건)',
        (dsState.live ? '실AI' : '템플릿') + ' · 확인한 데이터: ' + (dsState.tools.join(', ') || '로컬 직무·작년 기록')
          + (srcAll.length ? ' · 출처: ' + srcAll.join(' · ') : ''));
      dsClose();
      showUndo(snap, applied);
      TX.toast && TX.toast('초안 ' + applied + '개 항목을 폼에 반영했습니다. 8초 안에 되돌릴 수 있습니다.', 'ok');
    }
    function startDraft(force) {
      if (!newOv) return;
      if (dsState && dsState.busy) { dsOpen(); return; }
      if (!force && dsState && dsState.draft) { dsOpen(); return; }   // 재클릭 = 기존 시트 재오픈(중복 삽입 차단)
      hideUndo();
      var live = !!(window.EZAI && EZAI.agent && EZAI.ready && EZAI.ready() && window.EZTools);
      dsState = { busy: true, aborted: false, live: live, tools: [], draft: null, error: null, picks: {} };
      setAIBusy(true);
      dsOpen();
      if (!live) {
        setTimeout(function () {
          if (!dsState || dsState.aborted) return;
          dsState.busy = false;
          dsState.draft = validateDraft(cannedDraft());
          setAIBusy(false); dsRender();
        }, 280);
        return;
      }
      EZAI.agent({
        maxTurns: 5, maxTokens: 1400,
        system: DRAFT_SYSTEM,
        messages: [{ role: 'user', content: draftPromptText() }],
        onTool: function (name) {
          if (!dsState || dsState.aborted) return;
          var lb = (window.EZTools && EZTools.labelOf) ? EZTools.labelOf(name) : name;
          if (dsState.tools.indexOf(lb) < 0) { dsState.tools.push(lb); dsRender(); }
        },
        onDone: function (text) {
          if (!dsState || dsState.aborted) return;
          dsState.busy = false; setAIBusy(false);
          var raw = parseDraftJSON(text);
          var v = raw ? validateDraft(raw) : null;
          if (!v || !v.keyResults.length) {
            dsState.error = raw ? 'JSON은 읽었지만 사용할 수 있는 핵심 성과가 없습니다.'
                                : '응답을 목표 초안 형식(JSON)으로 읽지 못했습니다.';
          } else dsState.draft = v;
          dsRender();
        },
        onError: function (msg) {
          if (!dsState || dsState.aborted) return;
          dsState.busy = false; setAIBusy(false);
          dsState.error = 'elizax 호출에 실패했습니다 — ' + (msg || '연결 오류');
          dsRender();
        }
      });
    }
    function useTemplateDraft() {
      if (!dsState) dsState = { busy: false, aborted: false, live: false, tools: [], draft: null, error: null, picks: {} };
      dsState.busy = false; dsState.error = null; dsState.live = false;
      dsState.picks = {};
      dsState.draft = validateDraft(cannedDraft());
      setAIBusy(false);
      dsRender();
    }

    function buildNewOverlay() {
      newOv = document.createElement('div');
      newOv.className = 'txf-ov'; newOv.setAttribute('data-txf-ov', 'new');
      var parentSel = parentSelectHTML();
      newOv.innerHTML =
        '<div class="txf-ovhead"><button class="bk" data-txf="new-close">←</button><h2>목표 생성</h2>'
        + '<div class="sp"><button class="ghost-btn" data-txf="new-close">취소</button>'
        + '<button class="ghost-btn" data-txf="new-temp">임시저장</button>'
        + '<button class="btn-blue" data-txf="new-save">생성</button></div></div>'
        + '<div class="txf-ovbody"><div class="txf-form"><div class="txf-fmain">'
        + carryBannerHTML()
        + '<div class="txf-frow0">* 입력 필수 항목입니다.<div class="sp">'
        + '<label class="txf-ck" style="color:var(--ink-2);font-weight:600"><input type="checkbox" data-txf="new-adv"> 고급 설정</label>'
        /* 라벨은 실제 동작과 일치해야 한다 — 이 버튼은 KR만 추천하지 않고
           목표명·설명·KR을 모두 담은 초안을 만든다 */
        + '<button class="txf-ai" data-txf="ai">✦ 초안 생성</button></div></div>'
        + '<div class="txf-fcard"><div class="txf-lb">상위 목표 연계 <span style="color:var(--ink-4)">?</span>'
        + '<span class="mm" data-txf="new-map">목표 맵</span></div>'
        + '<select class="txf-inp" data-txf="new-parent" style="appearance:auto">' + parentSel.html + '</select>'
        + '<div class="txf-help">ⓘ ' + (parentSel.scoped
            ? '내 소속 조직 체인(팀→본부→전사)의 상위 목표 ' + parentSel.count + '건만 표시합니다.'
            : '소속 조직 체인에 조직 목표가 없어 전체 조직 목표를 표시합니다.')
        + ' 목표 맵에서 상위 목표를 확인할 수 있습니다.</div>'
        + '<div class="txf-align" data-txf="new-align"></div>'
        + '<div class="txf-lb" style="margin-top:20px">목표명 <span class="req">*</span></div>'
        + '<input class="txf-inp" data-txf="new-name" placeholder="목표 이름을 입력합니다.">'
        + '<div class="txf-lb" style="margin-top:20px">목표 설명</div>'
        + '<div class="txf-rte"><div class="txf-rtebar"><b>B</b><b>U</b><span>Aa</span><span>A</span><span><i>i</i></span><span>S</span><span>≔</span><span>⋮</span><span>¶</span><span>🔗</span><span>▤</span></div><textarea data-txf="new-desc" placeholder="목표 설명을 입력합니다."></textarea></div>'
        + '</div>'
        + '<div class="txf-fcard"><div class="txf-lb">핵심 성과 <span class="req">*</span></div>'
        + '<label class="txf-ck" style="margin-bottom:6px"><input type="checkbox" checked> 핵심 성과 가중치를 설정합니다.</label>'
        + '<div data-txf="kr-list">' + krRowHTML({}) + '</div>'
        + '<button class="txf-addkr" data-txf="add-kr">＋ 핵심 성과 추가</button>'
        + weightGaugeHTML() + '</div>'
        + '<div class="txf-fcard"><div class="txf-lb">목표 가중치 <span class="req">*</span></div>'
        + '<label class="txf-ck" style="margin-bottom:8px;color:var(--ink-3)"><input type="checkbox" checked disabled> 목표 가중치를 설정합니다.</label>'
        + '<input class="txf-inp" data-txf="new-objw" type="number" min="0" max="100" placeholder="목표 가중치를 입력합니다." value="100"></div>'
        + '</div>'
        + '<div style="flex:none;display:flex;flex-direction:column;gap:14px">'
        + carryPanelHTML()
        + (window.EZJob && EZJob.panelHTML ? EZJob.panelHTML(cuEmp) : '')
        + '</div>'
        + '<div class="txf-step"><h3>목표 설정</h3>'
        + '<div class="s done"><span class="ic">✓</span><span class="lbl">상위 목표 연계</span></div>'
        + '<div class="s done"><span class="ic">✓</span><span class="lbl">목표명</span><span class="rq">*</span></div>'
        + '<div class="s done"><span class="ic">✓</span><span class="lbl">목표 설명</span></div>'
        + '<div class="s done" data-step="kr"><span class="ic">✓</span><span class="lbl">핵심 성과 1</span><span class="rq">*</span></div>'
        + '<div class="s done"><span class="ic">✓</span><span class="lbl">목표 가중치</span><span class="rq">*</span></div>'
        + '</div></div></div>';
      sec.appendChild(newOv);
      // D: 상위 목표 연계 — 조직 상위 목표를 합리적 기본값으로 자동 선택(사용자가 변경 가능)
      var defParent = pickParentObjective();
      var psel = newOv.querySelector('[data-txf="new-parent"]');
      if (defParent && psel) {
        var ok = Array.prototype.some.call(psel.options, function (op) { return op.value === defParent.objective_id; });
        if (ok) psel.value = defParent.objective_id;
      }
      renumberKR();
      refreshAlignNote();
    }
    function openNew() { if (!newOv) buildNewOverlay(); newOv.classList.add('open'); }

    /* ---------- ⑥: 직무 과업 → KR 행 추가 (tx_jobcontext.js가 렌더하는 [KR로] 버튼) ---------- */
    function addKRFromTask(area, task) {
      area = String(area == null ? '' : area).trim();
      task = String(task == null ? '' : task).trim();
      if (!area && !task) return;
      openNew();   // 목표 생성 오버레이가 닫혀 있으면 먼저 연다
      var list = newOv && newOv.querySelector('[data-txf="kr-list"]');
      if (!list) return;
      /* 이름 없는 빈 행은 치우고 append — 과업이 핵심 성과 1번부터 채워지도록 */
      Array.prototype.forEach.call(list.querySelectorAll('.txf-kr'), function (row) {
        var n = row.querySelector('input.txf-inp');
        if (n && !n.value.trim()) row.remove();
      });
      list.insertAdjacentHTML('beforeend', krRowHTML({
        name: task || area,
        weight: '',                     // 잔여분 자동 배분(nextKRWeight)
        diff: 'A', difftype: 'yoy',
        jobTask: area,                  // 저장 시 job_task_ref.task_area로 보존
        whyText: '직무 과업 「' + (task || area) + '」에서 도출 — 목표값·판정 기준을 채워야 저장됩니다'
      }));
      renumberKR();
      var rows = list.querySelectorAll('.txf-kr');
      var last = rows[rows.length - 1];
      if (last) {
        last.scrollIntoView({ block: 'nearest' });
        var inp = last.querySelector('input.txf-inp');
        if (inp) inp.focus();
      }
      emitGoalCtx('goal.jobtask.kr', '직무 과업에서 핵심 성과 추가 — ' + (task || area),
        '직무 영역 ' + (area || '미상') + ' · 목표값·판정 기준은 사용자가 입력');
      TX.toast && TX.toast('직무 과업을 핵심 성과 행으로 추가했습니다. 목표값·판정 기준을 채워주세요.', 'ok');
    }
    function closeNew() { if (newOv) newOv.classList.remove('open'); dsClose(); hideUndo(); }

    /* ============================================================= *
     *  목표 가중치 설정 modal — fix 12                                *
     * ============================================================= */
    function openWeightEditor() {
      var mine = myObjectives();
      if (!mine.length) { TX.toast && TX.toast('가중치를 설정할 내 목표가 없습니다.', 'warn'); return; }
      var target = mine[0];
      var body = document.createElement('div');
      function sumNow() {
        var s = 0;
        body.querySelectorAll('.txf-we').forEach(function (i) { s += parseFloat(i.value) || 0; });
        return Math.round(s * 10) / 10;
      }
      function recalc() {
        var s = sumNow();
        var el = body.querySelector('.txf-wesum');
        if (el) { el.textContent = s; el.style.color = s === 100 ? 'var(--green)' : 'var(--red)'; }
      }
      function rowsHTML() {
        var ks = krByObj[target.objective_id] || [];
        if (!ks.length) return '<div style="color:var(--ink-3);font-size:13px">가중치를 설정할 핵심 성과가 없습니다.</div>';
        return ks.map(function (k) {
          return '<label class="tx-field"><span>' + esc(k.name) + '</span>'
            + '<input type="number" class="txf-we" data-kid="' + esc(k.kr_id) + '" min="0" max="100" value="' + wnum(k) + '" style="text-align:right"></label>';
        }).join('');
      }
      function draw() {
        body.innerHTML = '<div style="font-size:12.5px;color:var(--ink-3);margin-bottom:8px">가중치를 설정할 목표를 선택하세요 — 핵심 성과 가중치는 합계 100%가 되어야 합니다.</div>'
          + '<select class="txf-inp" data-we-obj style="width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 10px;font:inherit;font-size:13px;margin-bottom:12px;appearance:auto">'
          + mine.map(function (o) {
              return '<option value="' + esc(o.objective_id) + '"' + (o.objective_id === target.objective_id ? ' selected' : '') + '>'
                + esc(o.title) + '</option>';
            }).join('')
          + '</select>'
          + rowsHTML()
          + '<div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:12px;font-weight:800">합계 <span class="txf-wesum">0</span>%</div>';
        recalc();
      }
      body.addEventListener('input', recalc);
      body.addEventListener('change', function (e) {
        var sel = e.target && e.target.closest ? e.target.closest('[data-we-obj]') : null;
        if (!sel) return;
        target = objById[sel.value] || target;
        draw();
      });
      draw();
      TX.modal && TX.modal({
        title: '목표 가중치 설정', body: body,
        actions: [
          { label: '취소', kind: 'ghost' },
          { label: '균등 배분', kind: 'ghost', onClick: function () {
              var inps = body.querySelectorAll('.txf-we');
              var n = inps.length;
              if (!n) return false;
              var base = Math.floor(100 / n), rem = 100 - base * n;
              inps.forEach(function (inp, i) { inp.value = base + (i < rem ? 1 : 0); });
              recalc();
              TX.toast && TX.toast('가중치를 균등 배분했습니다. (' + n + '개 항목 · 합계 100%)', 'ok');
              return false;
            } },
          { label: '저장', kind: 'primary', onClick: function () {
              var s = sumNow();
              if (s !== 100) { TX.toast && TX.toast('가중치 합계가 100%가 되어야 합니다. (현재 ' + s + '%)', 'warn'); return false; }
              /* ④: 토스트만 띄우던 자리 — 실제 KR 레코드에 기록('40%' 문자열 포맷 유지) */
              var map = {};
              (krByObj[target.objective_id] || []).forEach(function (k) { map[k.kr_id] = k; });
              var n = 0;
              body.querySelectorAll('.txf-we').forEach(function (inp) {
                var k = map[inp.getAttribute('data-kid')];
                if (!k) return;
                k.weight = (parseFloat(inp.value) || 0) + '%';
                n++;
              });
              renderGoalBody();
              if (gdOv && gdOv.classList.contains('open') && gdOv.getAttribute('data-oid') === target.objective_id) {
                openGoalDetail(target.objective_id);
              }
              emitGoalCtx('goal.weight.save', '핵심 성과 가중치 변경 — ' + target.title,
                n + '개 항목 · 합계 100% (세션 반영 — 새로고침 시 초기화)');
              TX.toast && TX.toast('가중치를 저장했습니다. (' + n + '개 항목 · 목표에 반영)', 'ok');
            } }
        ]
      });
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
    var TODAY = '2026-07-15';   // 데모 기준일 — 경과일·기록 시각의 단일 기준
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
    /* ---------- ②: 숫자/단위 분리 · 방향 판정 · 추세 기반 제안 (하드코딩 증분 폐지) ---------- */
    function parseNumUnit(v) {
      if (v == null || v === '') return { num: null, unit: '' };
      if (typeof v === 'number') return { num: v, unit: '' };
      var s = String(v).trim();
      var m = s.match(/-?\d+(?:\.\d+)?/);
      if (!m) return { num: null, unit: s };
      return { num: parseFloat(m[0]), unit: s.replace(m[0], '').trim() };
    }
    function decimalsOf(n) {
      var s = String(n), i = s.indexOf('.');
      return i < 0 ? 0 : Math.min(2, s.length - i - 1);
    }
    /* KR 1건의 체크인 제안값 — 목표값과의 방향·최근 추세로만 산출, 목표값 초과 금지 */
    function krSuggest(k) {
      var cu = parseNumUnit(k.current_value != null ? k.current_value : k.progress);
      var tg = parseNumUnit(k.target_value);
      var cur = (cu.num == null) ? 0 : cu.num;
      var out = { cur: cur, unit: cu.unit || tg.unit || '', value: cur, basis: '' };
      if (tg.num == null) {
        out.basis = '목표값(' + (k.target_value || '미입력') + ')을 수치로 읽지 못해 현재값을 그대로 두었습니다 — 직접 입력해 주세요.';
        return out;
      }
      var gap = tg.num - cur;
      if (!gap) { out.basis = '이미 목표값에 도달해 현재값을 유지합니다.'; return out; }
      var down = gap < 0;   // 목표값 < 현재값 = 낮을수록 좋은 지표(리드타임·이탈률 등)
      var cks = (chkByKr[k.kr_id] || []).slice().sort(function (a, b) {
        return String(a.checkin_date || '').localeCompare(String(b.checkin_date || ''));
      });
      var deltas = cks.map(function (c) { return Math.abs(parseFloat(c.progress_delta) || 0); })
                      .filter(function (d) { return d > 0; });
      var frac, why;
      if (deltas.length >= 2) {
        var recent = deltas.slice(-3);
        var avg = recent.reduce(function (a, b) { return a + b; }, 0) / recent.length;
        var remain = Math.max(1, 100 - (parseFloat(k.progress) || 0));
        frac = Math.min(1, avg / remain);
        why = '최근 체크인 ' + recent.length + '건 평균 진척 +' + (Math.round(avg * 10) / 10) + '%p 추세';
      } else {
        frac = 0.25;   // 추세 근거가 없을 때의 보수적 비율 — 남은 격차의 1/4
        why = '추세 기록 ' + deltas.length + '건(2건 미만) — 남은 격차의 25% 기준';
      }
      var v = cur + gap * frac;
      v = down ? Math.max(tg.num, v) : Math.min(tg.num, v);   // 목표값 클램프
      var dg = Math.max(decimalsOf(cur), 1), pw = Math.pow(10, dg);
      out.value = Math.round(v * pw) / pw;
      out.basis = why + ' · 목표값 ' + tg.num + (out.unit || '')
        + (down ? '이 현재값보다 낮아 감소' : ' 방향으로 증가') + ' 제안 (목표값 초과 없음)';
      return out;
    }
    function openCheckinModal(o, aiDraft) {
      var ks = krByObj[o.objective_id] || [];
      var rows = ks.map(function (k) {
        var s = krSuggest(k);
        /* 비AI 입력칸 공백 버그 해소 — number 입력에는 숫자만, 단위는 접미사 텍스트로 */
        var val = aiDraft ? s.value : s.cur;
        return '<div style="padding:8px 2px;border-bottom:1px solid var(--line-2)">'
          + '<div style="display:flex;align-items:center;gap:9px">'
          + '<span style="flex:1;font-size:13px;font-weight:600">' + esc(k.name) + '</span>'
          + '<input type="number" step="any" data-ck-kr="' + esc(k.kr_id) + '" value="' + val + '" style="width:92px;text-align:right;border:1px solid #D0D5DD;border-radius:7px;padding:6px 8px;font:inherit;font-size:13px">'
          + (s.unit ? '<span style="font-size:12px;font-weight:700;color:var(--ink-2);flex:none">' + esc(s.unit) + '</span>' : '')
          + '<span style="font-size:12px;color:var(--ink-3);flex:none">/ ' + esc(k.target_value || '미설정') + '</span></div>'
          + (aiDraft && s.basis ? '<div style="font-size:11.5px;color:var(--ink-3);line-height:1.5;margin-top:4px">ⓘ ' + esc(s.basis) + '</div>' : '')
          + '</div>';
      }).join('');
      var draftNote = aiDraft
        ? '핵심 성과별 최근 체크인 추세와 목표값까지의 남은 격차를 기준으로 진척값 초안을 채웠습니다. (elizax 제안 — 값은 직접 고칠 수 있습니다)'
        : '';
      /* 1:1에서 넘어온 합의는 코멘트 첫 줄로 착지시킨다 — 한 번 쓰고 비운다 */
      if (pendingAgreement) {
        draftNote = '1:1 합의 — ' + pendingAgreement + (draftNote ? '\n' + draftNote : '');
        pendingAgreement = '';
      }
      TX.modal({
        title: '체크인 — ' + o.title,
        wide: true,
        body: (aiDraft ? '<div style="font-size:12px;color:#356CB5;background:rgba(31,122,240,.07);border:1px solid rgba(31,122,240,.25);border-radius:8px;padding:8px 11px;margin-bottom:10px">✦ <b>제안만</b> · 각 핵심 성과의 <b>체크인 기록 추세</b>와 <b>목표값까지의 남은 격차</b>로 계산한 초안입니다. 값은 언제든 고칠 수 있고, 반영은 관리자 승인 후입니다.</div>' : '')
          + rows
          + '<div style="margin-top:11px"><div style="font-size:12px;font-weight:700;color:var(--ink-2);margin-bottom:5px">코멘트 <span style="color:var(--ink-4);font-weight:500">— 요청 사유를 남기면 관리자가 빠르게 판단할 수 있습니다</span></div>'
          + '<textarea data-ck-cm style="width:100%;min-height:76px;border:1px solid #D0D5DD;border-radius:8px;padding:9px;font:inherit;font-size:13px" placeholder="이번 체크인에서 반영한 변경 사항을 적어주세요.">' + esc(draftNote) + '</textarea></div>',
        actions: [
          { label: '취소', kind: 'ghost' },
          { label: '체크인 · 승인 요청', kind: 'primary', onClick: function (box) {
              var vals = {};
              box.querySelectorAll('[data-ck-kr]').forEach(function (inp) { vals[inp.getAttribute('data-ck-kr')] = inp.value; });
              var cm = box.querySelector('[data-ck-cm]');
              ckSave(o.objective_id, { vals: vals, comment: cm ? cm.value : '', at: TODAY, ai: !!aiDraft });
              openGoalDetail(o.objective_id);
              TX.toast && TX.toast('체크인 승인을 요청했습니다. 관리자 승인 후 진행률에 반영됩니다.', 'ok');
            } }
        ]
      });
    }

    /* ---------- ③: 진척 감지 카드 — 실제 신호가 있을 때만, 실제 레코드 id만 ---------- */
    function daysSince(dateStr) {
      var a = Date.parse(String(dateStr || '') + 'T00:00:00'), b = Date.parse(TODAY + 'T00:00:00');
      if (isNaN(a) || isNaN(b)) return null;
      return Math.round((b - a) / 86400000);
    }
    function sigKey(oid) { return 'txf_aisig_' + oid; }
    function sigDismissed(oid) {
      try { return !!sessionStorage.getItem(sigKey(oid)); } catch (e) { return false; }
    }
    function sigDismiss(oid) {
      try { sessionStorage.setItem(sigKey(oid), '1'); } catch (e) { /* ignore */ }
    }
    /* 원장(EZLedger)에서 이 목표를 언급한 최근 항목 — 없으면 빈 배열 */
    function ledgerEventsFor(o) {
      var out = [];
      try {
        if (!(window.EZLedger && EZLedger.list)) return out;
        var title = String(o.title || ''), oid = String(o.objective_id || '');
        var cutoff = Date.now() - 14 * 86400000;
        EZLedger.list().forEach(function (it) {
          if (!it || !it.id || (it.ts || 0) < cutoff) return;
          var hay = (it.title || '') + ' ' + (it.summary || '');
          if ((title && hay.indexOf(title) >= 0) || (oid && hay.indexOf(oid) >= 0)) out.push(it);
        });
      } catch (e) { /* 원장 부재 — 무해화 */ }
      return out.slice(0, 3);
    }
    function progressSignal(o) {
      var cks = (chkByObj[o.objective_id] || []).slice().sort(function (a, b) {
        return String(b.checkin_date || '').localeCompare(String(a.checkin_date || ''));
      });
      var last = cks[0] || null;
      var days = last ? daysSince(last.checkin_date) : null;
      var evs = ledgerEventsFor(o);
      var stale = (days != null && days >= 7);
      if (!stale && !evs.length) return null;   // 신호 요건 미충족 → 카드를 그리지 않는다
      return { last: last, days: days, events: evs, stale: stale };
    }
    function signalCardHTML(o) {
      var sig = progressSignal(o);
      if (!sig) return '';
      var lines = [];
      if (sig.stale) lines.push('마지막 체크인(' + esc(sig.last.checkin_date) + ') 이후 ' + sig.days + '일이 지났습니다');
      if (sig.events.length) lines.push('성과 기록에 이 목표를 언급한 항목 ' + sig.events.length + '건이 최근 쌓였습니다');
      return '<div class="txf-fcard" style="border:1px solid rgba(31,122,240,.3);background:rgba(31,122,240,.03)">'
        + '<div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">'
        + '<span style="font-size:10.5px;font-weight:800;color:#356CB5;background:rgba(31,122,240,.1);border-radius:4px;padding:2px 7px">● 제안만</span>'
        + '<b style="font-size:13.5px">✦ elizax가 체크인 시점을 확인했습니다</b></div>'
        + '<p style="font-size:12.5px;color:var(--ink-2);line-height:1.6;margin:7px 0 9px">' + lines.join(' · ')
        + '. 기록된 추세로 체크인 초안을 만들어 드릴까요?</p>'
        + '<div style="display:flex;gap:7px"><button class="btn-blue" data-txf="gd-aick">체크인 초안 열기</button>'
        + '<button class="ghost-btn" data-txf="gd-aidismiss">무시</button></div></div>';
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
          + (k.competency_id && compName[k.competency_id] ? '<span class="txf-linkchip" style="color:#166534;background:rgba(47,163,107,.1)">역량 · ' + esc(compName[k.competency_id]) + '</span>' : '')
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
      var pendPill = '';
      if (pend && pend.status === 'approved') {
        /* ①: "진행률 반영"은 ez:checkin-applied로 실반영이 확인된 경우에만 — 그 외엔 "승인됨"까지 */
        pendPill = '<span style="display:inline-block;font-size:11px;font-weight:800;color:#067647;background:#ECFDF3;border:1px solid #ABEFC6;border-radius:999px;padding:3px 10px;margin-bottom:7px">✓ 체크인 승인됨'
          + (pend.applied ? ' · 진행률 반영' : '') + (pend.decided_at ? ' · ' + esc(pend.decided_at) : '') + '</span><br>';
      } else if (pend && pend.status === 'rejected') {
        pendPill = '<span style="display:inline-block;font-size:11px;font-weight:800;color:#B42318;background:#FEF3F2;border:1px solid #FECDCA;border-radius:999px;padding:3px 10px;margin-bottom:7px">체크인 반려됨 — 근거를 보완해 다시 요청할 수 있습니다</span><br>';
      } else if (pend) {
        pendPill = '<span style="display:inline-block;font-size:11px;font-weight:800;color:#5A6472;background:#EDF1F7;border:1px solid #D9E0EB;border-radius:999px;padding:3px 10px;margin-bottom:7px">⏳ 체크인 승인 요청 중' + (pend.ai ? ' · ✦ AI 초안' : '') + '</span><br>';
      }
      var ckDecided = pend && (pend.status === 'approved' || pend.status === 'rejected');
      var ckBtns = (pend && !ckDecided)
        ? '<button class="ghost-btn" data-txf="gd-ckcancel" style="color:#B42318;border-color:rgba(180,35,24,.35)">요청 취소</button>'
        : (isOwner ? '<button class="btn-blue" data-txf="gd-checkin">체크인</button>' : '');
      var aiCard = (!pend && isOwner && !sigDismissed(o.objective_id)) ? signalCardHTML(o) : '';
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
        + '<th>핵심 성과명</th><th>목표값</th><th>현재값</th><th>가중치</th><th>진행률</th><th>난이도</th></tr></thead><tbody>' + krRows + '</tbody></table></div>'
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

    /* ---------- ①: 체크인 승인 실반영 수신 (tx_inbox → ez:checkin-applied) ----------
       tx_inbox는 TALENX_DATA에 실제로 값을 반영한 경우에만 이 이벤트를 쏜다.
       따라서 이 시점에만 "진행률 반영" 문구를 쓸 수 있다(그 전에는 "승인됨"까지). */
    function ckMarkApplied(oid) {
      var d = ckPending(oid);
      if (!d) return;
      d.applied = true;
      if (!d.status) d.status = 'approved';
      ckSave(oid, d);
    }
    document.addEventListener('ez:checkin-applied', function (ev) {
      var oid = (ev && ev.detail && ev.detail.objective_id) || '';
      if (oid) ckMarkApplied(oid);
      try { renderGoalBody(); } catch (e) { /* 목표 페이지 미구성 */ }
      if (gdOv && gdOv.classList.contains('open')) {
        var cur = gdOv.getAttribute('data-oid');
        if (cur && (!oid || cur === oid)) openGoalDetail(cur);
      }
    });

    /* ---------- 1:1 합의 → 체크인 초안 착지 (tx_1on1 → ez:1on1-agreement) ----------
       detail = { emp_id, objective_id, text }. 1:1에서 합의한 내용이 대화 기록에만
       남고 끝나지 않도록, 해당 목표의 체크인 모달을 합의 문구가 담긴 채로 연다.
       objective_id가 비어 있으면 본인 목표 중 첫 건으로 착지한다. */
    var pendingAgreement = '';
    document.addEventListener('ez:1on1-agreement', function (ev) {
      var d = (ev && ev.detail) || {};
      var text = String(d.text || '').trim();
      if (!text) return;
      var mine = myObjectives();
      var o = null, oid = d.objective_id || '';
      if (oid) o = mine.filter(function (x) { return x.objective_id === oid; })[0]
                 || (objByOwner[d.emp_id] || []).filter(function (x) { return x.objective_id === oid; })[0];
      if (!o) o = mine[0];
      if (!o) { if (TX.toast) TX.toast('합의를 연결할 목표를 찾지 못했습니다.', 'warn'); return; }
      pendingAgreement = text;
      openCheckinModal(o, false);
    });

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
        + ' 달성\n- 체크인 기반 리스크 조기 공유로 일정 지연 최소화\n\n2. 보완할 점\n- 핵심 성과 측정 주기를 격주 단위로 단축하여 편차 조기 감지\n\n3. 다음 기간 목표\n- 하반기 핵심 과제 우선순위 재정렬 및 협업 프로세스 개선';
      var body = document.createElement('div');
      body.innerHTML =
        '<div style="display:flex;gap:18px;font-size:13px;margin-bottom:12px;flex-wrap:wrap">'
        + '<span>대상 <b>' + esc(tgt) + '</b></span><span>기간 <b>2025</b></span><span>양식 <b>기본 리뷰 양식</b></span></div>'
        /* v2 §6: AI 산출물 무표기 0건 — 프리필 초안 마커 의무 */
        + (done ? '' : '<div style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:#356CB5;background:rgba(31,122,240,.07);border:1px solid rgba(31,122,240,.25);border-radius:999px;padding:4px 12px;margin-bottom:8px">✦ AI 초안 — 수정·확정은 내가</div>')
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
        /* v2 §6: ✦ 상시 앵커 — 기존 오픈 함수 재사용, 해당 기능 활성 상태로 진입 */
        if (k === 'anchor-airec') {
          ev.preventDefault(); openNew();
          setTimeout(function () { var b = newOv && newOv.querySelector('.txf-ai[data-txf="ai"]'); if (b) b.click(); }, 80);
          return;
        }
        if (k === 'anchor-refine') {
          ev.preventDefault(); openNew();
          setTimeout(function () {
            var ta = newOv && newOv.querySelector('.txf-rte textarea');
            if (ta) { ta.scrollIntoView({ block: 'center' }); ta.focus(); }
          }, 80);
          return;
        }
        if (k === 'anchor-aick') {
          ev.preventDefault();
          var o0a = myObjectives()[0];
          if (!o0a) { TX.toast && TX.toast('먼저 목표를 생성하세요.', 'warn'); return; }
          openCheckinModal(o0a, true);
          return;
        }
        if (k === 'new-close') { ev.preventDefault(); closeNew(); return; }
        if (k === 'new-temp') { TX.toast && TX.toast('임시저장했습니다.', 'ok'); return; }
        if (k === 'new-save') {
          var nm = newOv && newOv.querySelector('[data-txf="new-name"]');
          if (nm && !nm.value.trim()) { TX.toast && TX.toast('목표명을 입력하세요.', 'warn'); return; }
          var issues = gateIssues();
          if (issues.length) { openSaveGate(issues); return; }
          finishNewSave(); return;
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
            TX.toast && TX.toast('체크인 요청을 취소했습니다. 취소 이력도 감사 기록에 남습니다.');
            return;
          }
          /* ③: 무시는 세션에 기억 — 재진입해도 되살아나지 않는다 */
          sigDismiss(gdo.objective_id);
          openGoalDetail(gdo.objective_id);
          TX.toast && TX.toast('이 목표의 진척 감지 알림을 이번 세션 동안 끕니다.');
          return;
        }
        if (k === 'reorder') { openReorderModal(); return; }
        if (k === 'cardset') { openCardSettings(); return; }
        if (k === 'expandall') { toggleAllMembers(tag); return; }
        if (k === 'add-kr') {
          var list = newOv && newOv.querySelector('[data-txf="kr-list"]');
          if (list) { list.insertAdjacentHTML('beforeend', krRowHTML({})); renumberKR(); }
          return;
        }
        if (k === 'kr-even') {
          ev.preventDefault();
          var cnt = evenWeights();
          if (cnt) TX.toast && TX.toast('가중치를 균등 배분했습니다. (' + cnt + '개 항목 · 합계 100%)', 'ok');
          return;
        }
        if (k === 'ds-close') { ev.preventDefault(); dsClose(); return; }
        if (k === 'ds-stop') {
          ev.preventDefault();
          if (dsState) { dsState.aborted = true; dsState.busy = false; dsState.draft = null; }
          setAIBusy(false); dsClose();
          TX.toast && TX.toast('초안 생성을 중지했습니다. 도착하는 결과는 무시합니다.');
          return;
        }
        if (k === 'ds-retry') { ev.preventDefault(); startDraft(true); return; }
        if (k === 'ds-template') { ev.preventDefault(); useTemplateDraft(); return; }
        if (k === 'ds-apply-sel') { ev.preventDefault(); dsApply(false); return; }
        if (k === 'ds-apply-all') { ev.preventDefault(); dsApply(true); return; }
        if (k === 'ds-undo') {
          ev.preventDefault();
          if (undoSnap) { restoreSnapshot(undoSnap); TX.toast && TX.toast('초안 적용을 되돌렸습니다.', 'ok'); }
          hideUndo();
          return;
        }
        if (k === 'kr-x') {
          var kid = tag.getAttribute('data-kr');
          var row = newOv && newOv.querySelector('.txf-kr[data-kr="' + kid + '"]');
          if (row && newOv.querySelectorAll('.txf-kr').length > 1) { row.remove(); renumberKR(); }
          else TX.toast && TX.toast('핵심 성과는 최소 1개가 필요합니다.', 'warn');
          return;
        }
        if (k === 'src') {   // ⑤: 출처 칩 → 원장 딥링크(폴백 토스트)
          ev.preventDefault();
          openSrc(tag.getAttribute('data-sid'));
          return;
        }
        if (k === 'carry-kr') {   // 미완 KR 그대로 이월
          ev.preventDefault();
          carryTo(parseInt(tag.getAttribute('data-ci'), 10));
          return;
        }
        if (k === 'carry-review') { ev.preventDefault(); openCarryReview(); return; }
        if (k === 'ai') {          // 상단 버튼 — 전체 컨텍스트
          ev.preventDefault();
          if (!newOv) return;
          carryFilter = null;
          startDraft(false);
          return;
        }
        if (k === 'ai-carry') {    // ⑤: carry 패널 — 체크한 항목만 컨텍스트로
          ev.preventDefault();
          if (!newOv) return;
          carryFilter = carryPicksFrom();
          startDraft(true);
          return;
        }
        if (k === 'job-kr') {      // ⑥: 직무 과업 → KR 행 추가 (tx_jobcontext 렌더)
          ev.preventDefault();
          addKRFromTask(tag.getAttribute('data-area'), tag.getAttribute('data-task'));
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
        if (main && curMt[idx]) { main.classList.add('txf-open'); setMeetingMain(main, meetingDetailHTML(curMt[idx])); }
        /* 사람이 고른 상대 — 좌측 드롭다운·아젠다·elizax 대화가 같은 사람으로 따라온다 */
        if (curMt[idx] && window.EZPeer) EZPeer.set(curMt[idx].emp.emp_id, 'mtlist');
        return;
      }
    });

    sec.addEventListener('change', function (ev) {
      var t = ev.target;
      if (mapOv && (t.getAttribute && (t.getAttribute('data-txf') === 'map-excl' || t.getAttribute('data-txf') === 'map-period'))) {
        var cards = mapOv.querySelector('[data-txf="map-cards"]'); if (cards) cards.innerHTML = mapCardsHTML();
      }
      if (!t.getAttribute) return;
      // F2: 초안 시트 항목 선택 → 푸터(적용 개수·가중치 합) 갱신
      var pk = t.getAttribute('data-dspick');
      if (pk && dsState) { dsState.picks[pk] = !!t.checked; dsRefreshFoot(); return; }
      // E: 상위 목표 변경 → 정렬 사유 영역 갱신
      if (t.getAttribute('data-txf') === 'new-parent') { refreshAlignNote(); return; }
      // E: 가중치 입력 변경 → 합계 게이지
      if (t.classList && t.classList.contains('txf-krw')) refreshWeightGauge();
    });

    // E: 가중치 실시간 합계 (input 단위)
    sec.addEventListener('input', function (ev) {
      var t = ev.target;
      if (t && t.classList && t.classList.contains('txf-krw')) refreshWeightGauge();
    });

    /* ⑥: #s-perf 밖(직무 프로파일 드로어 등)에서 온 [KR로] 클릭 폴백.
       sec 위임은 data-txf 처리 시 stopPropagation하므로 중복 실행되지 않는다. */
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      var b = t && t.closest ? t.closest('[data-txf="job-kr"]') : null;
      if (!b || b.closest('#s-perf')) return;
      ev.preventDefault();
      addKRFromTask(b.getAttribute('data-area'), b.getAttribute('data-task'));
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
