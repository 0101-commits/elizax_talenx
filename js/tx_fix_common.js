/* tx_fix_common.js — shared helpers for the 2026-07-15 fidelity 고도화 pass.
   Loaded LAST (after talenx_data / hydrate / cleanup / revive / enhance), so
   window.TXFIX.* is available to every tx_fix_<menu>.js. All helpers are
   dependency-free and read from window.TALENX_DATA. */
(function () {
  'use strict';
  var D = window.TALENX_DATA || {};
  var F = window.TXFIX = window.TXFIX || {};

  // ---- indexes ----
  var empById = {}, orgById = {};
  (D.employees || []).forEach(function (e) { empById[e.emp_id] = e; });
  (D.orgs || []).forEach(function (o) { orgById[o.org_id] = o; });
  var CU = (D.meta && D.meta.currentUser) || {};
  if (CU.emp_id && !empById[CU.emp_id]) empById[CU.emp_id] = CU;

  F.D = D;
  F.CU = CU;
  F.emp = function (id) { return empById[id] || null; };
  F.org = function (id) { return orgById[id] || null; };

  // team/org short name for an employee (real talenx renders 이름(소속팀))
  F.teamName = function (empOrId) {
    var e = typeof empOrId === 'string' ? empById[empOrId] : empOrId;
    if (!e) return '';
    return e.orgName || (orgById[e.org_id] && orgById[e.org_id].name) || '';
  };
  // "이름(소속팀)"
  F.nameTeam = function (empOrId) {
    var e = typeof empOrId === 'string' ? empById[empOrId] : empOrId;
    if (!e) return '';
    var t = F.teamName(e);
    return t ? (e.name + '(' + t + ')') : e.name;
  };

  // ---- avatar: deterministic colored initial circle (replaces gray SVG / emoji) ----
  var PAL = ['#356CB5', '#1F7AF0', '#0E9F6E', '#7C3AED', '#C2410C', '#0EA5E9',
             '#DB2777', '#4B3FBF', '#0F766E', '#B45309', '#4F46E5', '#059669'];
  F.avatarColor = function (name) {
    var s = 0, n = name || '?';
    for (var i = 0; i < n.length; i++) s = (s * 31 + n.charCodeAt(i)) >>> 0;
    return PAL[s % PAL.length];
  };
  F.initial = function (name) {
    if (!name) return '?';
    // Korean: last 1–2 chars of given name read best; use last two if name>1
    return name.length >= 2 ? name.slice(-2) : name;
  };
  // returns an HTML string for an initial-circle avatar
  F.avatar = function (name, size) {
    size = size || 32;
    var c = F.avatarColor(name), fs = Math.round(size * 0.4);
    return '<span class="txf-ava" style="display:inline-flex;align-items:center;justify-content:center;'
      + 'width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:' + c + ';color:#fff;'
      + 'font-size:' + fs + 'px;font-weight:700;letter-spacing:-.02em;flex:none;overflow:hidden;">'
      + F.initial(name) + '</span>';
  };

  // ---- misc formatters ----
  F.won = function (n) {
    if (n == null) return '-';
    return Number(n).toLocaleString('en-US') + '원';
  };
  F.pad2 = function (n) { return (n < 10 ? '0' : '') + n; };

  // ---- run once, late (after existing hydrators finish on DOMContentLoaded) ----
  var _queue = [], _ran = false;
  function _flush() {
    if (_ran) return; _ran = true;
    _queue.forEach(function (fn) { try { fn(); } catch (e) { console.error('[txfix]', e); } });
  }
  F.ready = function (fn) {
    _queue.push(fn);
    if (_ran) { try { fn(); } catch (e) { console.error('[txfix]', e); } }
  };
  function boot() { setTimeout(_flush, 60); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // re-run a fn when its GNB section is opened (sections init once; use for
  // patches that must survive subnav re-renders). Returns nothing.
  F.onSection = function (sectionId, fn) {
    document.addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('[data-s]');
      if (b && ('s-' + b.getAttribute('data-s')) === sectionId) setTimeout(fn, 80);
    });
  };
})();
