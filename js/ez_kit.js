/* ez_kit.js — 단일 원천 기반 모듈 (v2 기획안 §4·§7, 원칙 P6)
   EZClock(기준 시점) · gaId(감사 ID) · gates(게이트 결정 스토어) · 신뢰 컴포넌트 렌더러 6종.
   zero-dep. window.EZKit 노출. talenx 화면 DOM 불변 — data-astryx-theme는 AI 레이어 루트에만. */
(function () {
  'use strict';

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /* ---- EZClock — 기준 시점 단일 발급 (드리프트 7/15·7/16·6/30 → 7/16 06:00 통일) ---- */
  var SNAPSHOT_KEY = 'ezk_snapshot_v1';
  var DEFAULT_SNAPSHOT = '2026-07-16 06:00';
  var clockListeners = [];
  var clock = {
    asOf: function () {
      try { return localStorage.getItem(SNAPSHOT_KEY) || DEFAULT_SNAPSHOT; }
      catch (e) { return DEFAULT_SNAPSHOT; }
    },
    asOfDate: function () { return clock.asOf().slice(0, 10); },
    setSnapshot: function (v) {
      try { localStorage.setItem(SNAPSHOT_KEY, v); } catch (e) {}
      clockListeners.forEach(function (cb) { try { cb(v); } catch (e) {} });
    },
    onChange: function (cb) { clockListeners.push(cb); }
  };

  /* ---- gaId — 결정론적 해시 → GA-2026-NNNNN 단일 포맷 ---- */
  function gaId(seedStr) {
    var h = 5381, s = String(seedStr == null ? '' : seedStr);
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return 'GA-2026-' + String(h % 100000).padStart(5, '0');
  }

  /* ---- gates — 게이트 결정 단일 스토어 (메모리/LS/SS 3곳 → 1, localStorage persist) ---- */
  var GATES_KEY = 'ezk_gates_v1';
  var gateListeners = [];
  function loadGates() {
    try { return JSON.parse(localStorage.getItem(GATES_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  var gates = {
    get: function (id) { return loadGates()[id] || null; },
    set: function (id, rec) {
      var all = loadGates();
      all[id] = { decision: rec.decision, reason: rec.reason || '', by: rec.by || '', at: rec.at || clock.asOf() };
      try { localStorage.setItem(GATES_KEY, JSON.stringify(all)); } catch (e) {}
      gateListeners.forEach(function (cb) { try { cb(id, all[id]); } catch (e) {} });
    },
    onChange: function (cb) { gateListeners.push(cb); }
  };

  /* ---- 렌더러 6종 — HTML 문자열 반환, DOM 미의존 ---- */
  function asof() {
    return '<span class="ezk-chip ezk-asof">📌 기준 ' + esc(clock.asOf()) + '</span>';
  }
  var SRC_LABEL = { talenx: 'talenx', erp: 'ERP', rule: '규정', web: '웹' };
  function src(kind, label) {
    var k = SRC_LABEL[kind] ? kind : 'talenx';
    return '<span class="ezk-chip ezk-src" data-src="' + k + '">' + esc(label || SRC_LABEL[k]) + '</span>';
  }
  function audit(seed) {
    return '<span class="ezk-chip ezk-audit" data-ga="' + esc(gaId(seed)) + '">⛨ 감사 기록됨 · ' + esc(gaId(seed)) + '</span>';
  }
  var STATUS_LABEL = { auto: '● 자동', suggest: '◐ 제안만', approve: '○ 승인 필요' };
  function status(mode) {
    var m = STATUS_LABEL[mode] ? mode : 'suggest';
    return '<span class="ezk-chip ezk-status" data-mode="' + m + '">' + STATUS_LABEL[m].slice(2) + '</span>';
  }
  function receipt(o) {
    o = o || {};
    return '<div class="ezk-receipt">' +
      '<div class="ezk-receipt-head">' +
      (o.title ? '<span class="ezk-receipt-title">' + esc(o.title) + '</span>' : '') +
      asof() + (o.chips || '') +
      '</div>' +
      '<div class="ezk-receipt-body">' + (o.body || '') + '</div>' +
      '</div>';
  }
  function gate(o) {
    o = o || {};
    var id = esc(o.id || 'gate');
    var on = o.onLabels || ['승인', '수정', '보류'];
    var decided = gates.get(o.id);
    var html = '<div class="ezk-gate" data-gate-id="' + id + '"' + (decided ? ' data-decided="' + esc(decided.decision) + '"' : '') + '>' +
      '<span class="ezk-gate-label">결정 게이트 · 사람이 확정</span>';
    if (decided) {
      html += '<span class="ezk-gate-decision">' + esc(decided.decision) + ' · ' + esc(decided.at) + '</span>';
    } else {
      html += on.map(function (l, i) {
        return '<button type="button" class="' + (i === 0 ? 'ezk-gate-primary' : '') + '" data-gate-act="' + esc(l) + '">' + esc(l) + '</button>';
      }).join('');
    }
    return html + '</div>';
  }

  /* ---- data-astryx-theme 자동 부여 — AI 레이어 루트만, talenx 화면(#s-… / .tx-…) 금지 ---- */
  var AI_ROOTS = '.ezx-root,.ezx-panel,.ezx-fab,.agh-root,.ezl-panel,.ezpm-root,.ez1o-root,.txr-receipt,.ezpo-modal,.ezs-slot,.ezs-stack,.ezs-card';
  function stamp(scope) {
    var nodes = (scope || document).querySelectorAll(AI_ROOTS);
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.closest('[data-astryx-theme]')) continue;
      if (el.closest('#s-home,#s-perf,#s-eval,#s-msf,#s-work,#s-wf,#s-att,#s-hrm,#s-pay') && !el.className.match(/^ez|^agh|^txr/)) continue;
      el.setAttribute('data-astryx-theme', 'talenx');
    }
  }
  function init() {
    stamp(document);
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        for (var j = 0; j < muts[i].addedNodes.length; j++) {
          var n = muts[i].addedNodes[j];
          if (n.nodeType !== 1) continue;
          if (n.matches && n.matches(AI_ROOTS)) stamp(n.parentNode || document);
          else if (n.querySelector && n.querySelector(AI_ROOTS)) stamp(n);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.EZKit = {
    marker: '✦',
    clock: clock,
    gaId: gaId,
    gates: gates,
    receipt: receipt,
    asof: asof,
    src: src,
    gate: gate,
    audit: audit,
    status: status,
    esc: esc
  };
})();
