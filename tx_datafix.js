/* ===== talenx mockup — runtime data sanitizer (idempotent) =====
   Mirrors scratchpad/fix_talenx_data.py at load time so the app stays
   internally consistent even if talenx_data.js is ever replaced by a
   stale build. Runs BEFORE tx_hydrate consumes the data.
   Fixes: dangling check-ins, KR<->objective mismatch, org headcount rollup,
          demoSubjects.level vs roster, duplicate persona_id. */
(function () {
  'use strict';
  var D = window.TALENX_DATA;
  if (!D || D.__sanitized) return;

  try {
    var emps = {}; (D.employees || []).forEach(function (e) { emps[e.emp_id] = e; });
    var orgs = {}; (D.orgs || []).forEach(function (o) { orgs[o.org_id] = o; });
    var objs = {}; (D.objectives || []).forEach(function (o) { objs[o.objective_id] = o; });
    var krs = {}; (D.keyResults || []).forEach(function (k) { krs[k.kr_id] = k; });

    // 1) check-ins: drop dangling kr_id; correct objective_id to KR's parent
    if (Array.isArray(D.checkins)) {
      D.checkins = D.checkins.filter(function (c) {
        var k = krs[c.kr_id];
        if (!k) return false;
        if (c.objective_id !== k.objective_id) c.objective_id = k.objective_id;
        return true;
      });
    }

    // 2) org headcount = rollup (self + descendants by assignment)
    var children = {}, direct = {};
    (D.orgs || []).forEach(function (o) { (children[o.parent_id] = children[o.parent_id] || []).push(o.org_id); });
    (D.employees || []).forEach(function (e) { direct[e.org_id] = (direct[e.org_id] || 0) + 1; });
    function rollup(oid, g) { g = (g || 0) + 1; if (g > 40) return 0; var t = direct[oid] || 0; (children[oid] || []).forEach(function (c) { t += rollup(c, g); }); return t; }
    (D.orgs || []).forEach(function (o) { o.headcount = rollup(o.org_id); o.headcount_direct = direct[o.org_id] || 0; });

    // 3) demoSubjects.level aligned to roster
    (D.demoSubjects || []).forEach(function (ds) { var rl = emps[ds.emp_id] && emps[ds.emp_id].level; if (rl) ds.level = rl; });

    // 4) dedupe persona_id
    var seen = {};
    (D.demoSubjects || []).forEach(function (ds) {
      var pid = ds.persona_id;
      if (seen[pid]) { var n = 1; while (seen[pid + '-' + n]) n++; ds.persona_id = pid + '-' + n; }
      seen[ds.persona_id] = 1;
    });

    if (D.meta && D.meta.counts) {
      D.meta.counts.checkins = (D.checkins || []).length;
      D.meta.counts.objectives = (D.objectives || []).length;
      D.meta.counts.keyResults = (D.keyResults || []).length;
    }
    D.__sanitized = true;
  } catch (err) { /* never block the app on data cleanup */ }
})();
