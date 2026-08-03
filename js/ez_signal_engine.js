/* ez_signal_engine.js — 신호 엔진 (18차 §4 · W1 소유)
   ------------------------------------------------------------------------
   목적
     - `window.EZSignalCatalog`(신호 150건, v0.6 문법)을 실데이터로 평가해
       화면이 그대로 그릴 수 있는 「알림 인스턴스」를 만든다.
     - 카탈로그의 근거·기준값 문구에 박혀 있는 예시 숫자를 실계산값으로
       갈아끼운다. 계산 못 한 줄은 버리지 않고 `assumed:1`로 남겨
       카드가 「(추정)」으로 표시하게 한다. 없는 값은 만들지 않는다.
     - 「지금 켤 수 있는 신호」(`now===1`) 15건만 실계산한다. 나머지 135건은
       열람 전용이며 `evaluate()`가 `ready:false`로 돌려준다.

   공개 API (§4)
     EZSignalEngine.catalog()          → window.EZSignalCatalog (없으면 null)
     EZSignalEngine.forRole(role)      → signals[]  롤 전체(now:0 포함, actorNo 오름차순)
     EZSignalEngine.live(role)         → inst[]     now===1 이고 평가가 참인 것
     EZSignalEngine.evaluate(id)       → {hit, facts, evidence, thresholds, asof, ready}
     EZSignalEngine.pending(role)      → inst[]     live 에서 해제·스누즈 제외
     EZSignalEngine.resolve(id, how [, actionType])  how: "acted"|"dismissed"
     EZSignalEngine.snooze(id)         → mute.repeat 만큼 미룸
     EZSignalEngine.prompt(inst)       → AI에 보낼 한국어 문자열
     EZSignalEngine.onChange(fn)       → 상태 변경 구독 (해지 함수 반환)
     (부가) instance(id[, role]) · state(role) · reset(role) · flush() · asof() · subject(role)

   상태
     localStorage["ez_signal_v1:"+emp_id]
       = { "<신호 id>": { st:"acted|dismissed|snoozed", at:ISO, until:ISO } }

   데이터 원천 — 모두 `window.TALENX_DATA` 실필드만 읽는다
     objectives(objective_id·org_id·owner_emp_id·parent_objective_id·period·
                progress·job_ref·strategy_theme_id)
     keyResults(kr_id·objective_id·name·weight·progress·job_task_ref·competency_id)
     checkins(kr_id·emp_id·checkin_date·confidence·blocker)
     orgs(org_id·parent_id·name·head_id) · employees(org_id·jobProfileId·jobHistory)
     jobProfiles[*].competency_profile / .tasks · competencies · strategyThemes
     feedbackHistory · evalHistory · meta.currentUser
   기준 시점 = `EZKit.clock.asOfDate()` 단일 원천 (없으면 "2026-07-16")

   주의 — 실데이터에 없는 필드는 쓰지 않는다
     · `objectives.updated_at` 없음 → 「저장 뒤 경과일」은 계산 불가 → assumed 유지
     · `checkins.blockers` 없음 → 단수 `blocker` 사용
     · `thresholds[].value`는 전부 제도 예시값(§1)이라 실측으로 덮지 않고
       `actual`(실측)을 덧붙인다. 카드는 「기준 N (예시) · 실측 M」으로 읽는다.

   ES5 IIFE · zero-dep. 카탈로그/데이터가 없으면 빈 배열을 돌려주고 던지지 않는다.
   ------------------------------------------------------------------------ */
(function () {
  'use strict';

  var LS_PREFIX = 'ez_signal_v1:';
  var DEFAULT_ASOF = '2026-07-16';
  /* tx_roles.js ROLES 와 같은 대표 인물 — TXRoles 미로딩(노드 검증) 시의 폴백 */
  var ROLE_EMP = { member: 'EMP-0078', leader: 'EMP-0030', hr: 'EMP-0005', exec: 'EMP-0001' };
  /* 역량 한국어 표기 — competencies[].name 은 영문(Execution 등)이고
     카탈로그 문구는 한국어를 쓰므로 dimension_id 기준 표기표를 둔다 */
  var COMP_KR = { D1: '리더십', D2: '협업', D3: '직무 전문성', D4: '실행력', D5: '성장 마인드셋' };
  /* 원장(EZLedger) TYPES 에 실제로 있는 키만 쓴다 */
  var STAGE_CTX = { '목표수립': 'goal', '중간점검': 'checkin', '평가': 'eval', '피드백': 'feedback' };

  var subs = [];
  var memState = {};      /* localStorage 불가 환경(노드) 폴백 */
  var cacheKey = null;    /* 계산 캐시 무효화 키 */
  var cacheEval = {};
  var cacheCo = null;
  var cacheScope = {};

  /* ================= 기본 헬퍼 ================= */
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function D() { return window.TALENX_DATA || {}; }
  function arr(k) { var v = D()[k]; return (Object.prototype.toString.call(v) === '[object Array]') ? v : []; }
  function CAT() { return window.EZSignalCatalog || null; }
  function num(v) { var m = /(-?\d+(\.\d+)?)/.exec(String(v == null ? '' : v)); return m ? parseFloat(m[1]) : 0; }
  /* 판정에 쓰는 기준값은 카탈로그가 단일 원천이다 (20차).
     예전에는 각 EVAL 안에 숫자를 박아 두어서, 카탈로그 기준값을 고쳐도
     화면 표시만 바뀌고 알림이 뜨는 선은 그대로였다. `thresholds[].code` 로 찾아
     「50%」·「3건」·「15%p」·「1.63건」에서 수를 뽑아 쓴다.
     카탈로그에 없는 값(엔진 자체 게이트)만 fallback 을 그대로 쓴다. */
  var thvCache = null;
  function thv(sigId, code, fallback) {
    var cat, list, i, j, ths, raw, v;
    if (!thvCache) {
      thvCache = {};
      cat = CAT();
      list = (cat && cat.signals) || [];
      for (i = 0; i < list.length; i++) {
        ths = list[i].thresholds || [];
        for (j = 0; j < ths.length; j++) {
          if (ths[j] && ths[j].code) thvCache[list[i].id + '|' + ths[j].code] = ths[j].value;
        }
      }
    }
    raw = thvCache[sigId + '|' + code];
    if (raw == null || raw === '') return fallback;
    v = num(raw);
    return isNaN(v) ? fallback : v;
  }
  function r0(v) { return Math.round(v); }
  function r1(v) { return Math.round(v * 10) / 10; }
  /* 소수 첫째자리까지 — 정수면 정수로 (64.8 / 100) */
  function pn(v) { var x = r1(v); return (x === Math.round(x)) ? String(Math.round(x)) : String(x); }
  function avg(list) { if (!list.length) return null; var s = 0, i; for (i = 0; i < list.length; i++) s += list[i]; return s / list.length; }
  function copy(o) { var r = {}, k; for (k in o) if (has(o, k)) r[k] = o[k]; return r; }
  function cut(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  function asof() {
    var s = DEFAULT_ASOF;
    try { if (window.EZKit && EZKit.clock && EZKit.clock.asOfDate) s = EZKit.clock.asOfDate() || DEFAULT_ASOF; } catch (e) {}
    return String(s).slice(0, 10);
  }
  function asofMs() { var t = Date.parse(asof() + 'T00:00:00Z'); return isNaN(t) ? Date.parse(DEFAULT_ASOF + 'T00:00:00Z') : t; }
  function dayShift(ms, days) { return new Date(ms + days * 86400000).toISOString().slice(0, 10); }
  function dnum(s) { var t = Date.parse(String(s) + 'T00:00:00Z'); return isNaN(t) ? null : t; }
  function nowIso() { return new Date().toISOString(); }

  /* 목표 기간 창 — objectives[].period("FY2026-2Q") 실파싱 (tx_agent.js 와 같은 규칙) */
  function periodWindow(period) {
    var m = /FY(\d{4})[-\s]?([1-4])Q/i.exec(String(period || ''));
    if (!m) return null;
    var y = +m[1], q = +m[2];
    return { start: Date.UTC(y, (q - 1) * 3, 1), end: Date.UTC(y, q * 3, 0), y: y, q: q,
             label: y + '년 ' + q + '분기', from: Date.UTC(y, (q - 1) * 3, 1), to: Date.UTC(y, q * 3, 0) };
  }
  function periodElapsed(period) {
    var w = periodWindow(period);
    if (!w) return null;
    return Math.max(0, Math.min(100, r0((asofMs() - w.start) / (w.end - w.start) * 100)));
  }

  /* ================= 인덱스 ================= */
  function empById(id) { var e = arr('employees'), i; for (i = 0; i < e.length; i++) if (e[i].emp_id === id) return e[i]; return null; }
  function orgById(id) { var o = arr('orgs'), i; for (i = 0; i < o.length; i++) if (o[i].org_id === id) return o[i]; return null; }
  function objById(id) { var o = arr('objectives'), i; for (i = 0; i < o.length; i++) if (o[i].objective_id === id) return o[i]; return null; }
  function orgChildren(pid) { return arr('orgs').filter(function (o) { return o.parent_id === pid; }); }
  function subtreeIds(rootId) {
    var out = {}, q = [rootId];
    while (q.length) {
      var id = q.shift();
      if (!id || out[id]) continue;
      out[id] = 1;
      orgChildren(id).forEach(function (c) { q.push(c.org_id); });
    }
    return out;
  }
  function krsOfObj(oid) { return arr('keyResults').filter(function (k) { return k.objective_id === oid; }); }
  function objsOwnedBy(eid) { return arr('objectives').filter(function (o) { return o.owner_emp_id === eid; }); }
  function jpOf(emp) { var m = D().jobProfiles || {}; return (emp && m[emp.jobProfileId]) || null; }
  /* 직무 기준 역량 가중치 내림차순 — tx_jobcontext.js compProfile 과 같은 원천 */
  function compProfile(jp) {
    var p = (jp && Object.prototype.toString.call(jp.competency_profile) === '[object Array]') ? jp.competency_profile : [];
    return p.slice().sort(function (a, b) { return (b.weight || 0) - (a.weight || 0); });
  }
  function compKr(id) { return COMP_KR[id] || id || ''; }
  function themeName(id) {
    var t = arr('strategyThemes'), i;
    for (i = 0; i < t.length; i++) if (t[i].theme_id === id) return t[i].name || id;
    return '';
  }
  function taskAreas(jp) {
    var out = [], k;
    if (jp && jp.tasks) for (k in jp.tasks) if (has(jp.tasks, k)) out.push(k);
    return out;
  }

  /* ================= 롤·대상자 ================= */
  function roleKey(r) {
    if (r) return r;
    var cu = (D().meta && D().meta.currentUser) || null;
    if (cu && cu._role) return cu._role;
    try { if (window.TXRoles && TXRoles.current) return TXRoles.current().key || 'member'; } catch (e) {}
    return 'member';
  }
  /* 롤의 대표 인물 — TXRoles.ROLES 가 단일 원천, 없으면 ROLE_EMP 폴백 */
  function subject(role) {
    var key = roleKey(role);
    var cu = (D().meta && D().meta.currentUser) || null;
    if (cu && cu._role === key) return cu;
    var id = null;
    try { if (window.TXRoles && TXRoles.ROLES && TXRoles.ROLES[key]) id = TXRoles.ROLES[key].emp_id; } catch (e) {}
    if (!id) id = ROLE_EMP[key];
    return empById(id) || cu || null;
  }

  /* ================= 전사 집계 (asof 기준 1회 계산 후 캐시) ================= */
  function co() {
    if (cacheCo) return cacheCo;
    var objs = arr('objectives'), krs = arr('keyResults'), cks = arr('checkins'), emps = arr('employees');
    var c = {
      objTotal: objs.length, krTotal: krs.length, ckTotal: cks.length, empTotal: emps.length
    };
    /* 1순위 역량 미커버 목표 */
    var uncov = 0, uncovTot = 0;
    objs.forEach(function (o) {
      var ow = empById(o.owner_emp_id), p = compProfile(jpOf(ow));
      if (!p.length) return;
      uncovTot++;
      var top = p[0].dimension_id;
      var hit = krsOfObj(o.objective_id).some(function (k) { return k.competency_id === top; });
      if (!hit) uncov++;
    });
    c.uncovObj = uncov; c.uncovTot = uncovTot;
    c.uncovPct = uncovTot ? r1(uncov / uncovTot * 100) : 0;
    /* 역량 분포 */
    var dist = {}, dom = null;
    krs.forEach(function (k) { if (k.competency_id) dist[k.competency_id] = (dist[k.competency_id] || 0) + 1; });
    for (var d in dist) if (has(dist, d)) { if (!dom || dist[d] > dist[dom]) dom = d; }
    c.compDist = dist; c.domDim = dom;
    c.domPct = (dom && krs.length) ? r1(dist[dom] / krs.length * 100) : 0;
    /* 체크인 */
    c.lowCk = cks.filter(function (k) { return k.confidence === 'low'; }).length;
    c.lowPct = cks.length ? r0(c.lowCk / cks.length * 100) : 0;
    c.ckPerEmp = emps.length ? Math.round(cks.length / emps.length * 100) / 100 : 0;
    /* 목표 직무 과업 연결 */
    c.jobRefObj = objs.filter(function (o) { return o.job_ref && o.job_ref.task_area; }).length;
    c.missJobRef = c.objTotal - c.jobRefObj;
    c.jobRefPct = c.objTotal ? r0(c.jobRefObj / c.objTotal * 100) : 0;
    /* 표시 진행률 vs 핵심결과 가중평균 */
    var diffs = [];
    objs.forEach(function (o) {
      var w = wavgOf(o);
      if (w == null) return;
      diffs.push({ id: o.objective_id, org: o.org_id, shown: o.progress || 0, wavg: w, diff: Math.abs((o.progress || 0) - w) });
    });
    c.wdiffs = diffs;
    c.wdiffAvg = diffs.length ? r1(avg(diffs.map(function (x) { return x.diff; }))) : 0;
    /* 조직별 목표 진행률 */
    var byOrg = {};
    objs.forEach(function (o) { (byOrg[o.org_id] = byOrg[o.org_id] || []).push(o.progress || 0); });
    var rows = [];
    for (var g in byOrg) if (has(byOrg, g)) {
      var o2 = orgById(g);
      rows.push({ org: g, name: (o2 && o2.name) || g, n: byOrg[g].length, avg: r1(avg(byOrg[g])) });
    }
    rows.sort(function (a, b) { return b.avg - a.avg; });
    c.orgRows = rows; c.orgN = rows.length;
    c.orgMax = rows[0] || null; c.orgMin = rows[rows.length - 1] || null;
    c.orgGap = (c.orgMax && c.orgMin) ? r1(c.orgMax.avg - c.orgMin.avg) : 0;
    /* 핵심결과 평균 진척 */
    c.krAvg = krs.length ? r0(avg(krs.map(function (k) { return k.progress || 0; }))) : 0;
    /* 핵심결과명 중복 — 이름 → 서로 다른 목표 수 */
    var byName = {};
    krs.forEach(function (k) { (byName[k.name] = byName[k.name] || {})[k.objective_id] = 1; });
    var dupRows = [];
    for (var n in byName) if (has(byName, n)) {
      var cnt = 0, oid;
      for (oid in byName[n]) if (has(byName[n], oid)) cnt++;
      if (cnt > 1) dupRows.push({ name: n, n: cnt });
    }
    dupRows.sort(function (a, b) { return b.n - a.n; });
    c.dupName = byName; c.dupRows = dupRows;
    /* 직무 이동 이력 */
    c.jobHistN = emps.filter(function (e) { return e.jobHistory && e.jobHistory.length; }).length;
    cacheCo = c;
    return c;
  }
  function dupCountOf(name) {
    var m = co().dupName[name];
    if (!m) return 0;
    var n = 0, k;
    for (k in m) if (has(m, k)) n++;
    return n;
  }
  /* 목표의 핵심결과 가중평균 진척 — 가중치 합이 0이면 null */
  function wavgOf(obj) {
    var ks = krsOfObj(obj.objective_id), ws = 0, sum = 0;
    ks.forEach(function (k) { var w = num(k.weight); ws += w; sum += w * (k.progress || 0); });
    return ws ? r1(sum / ws) : null;
  }

  /* ================= 상위 조직 관점 범위 =================
     결정 ①(18차) — 조직장(leader)이 상위조직장 신호를 겸수하므로
     「하위 팀」의 기준 조직을 정한다.
       · 내 조직에 직속 하위 조직이 2개 이상이면 → 내 조직이 기준
       · 없으면 한 단계 위(부모 조직)를 기준으로 삼는다 = 「상위 조직 관점」
     범위 문구(⓪ 근거)의 조직·팀 수·건수는 전부 실측으로 갈아끼운다. */
  function upperScope(emp) {
    if (!emp) return null;
    var ck = emp.emp_id + '|' + asof();
    if (cacheScope[ck]) return cacheScope[ck];
    var own = orgById(emp.org_id);
    if (!own) return null;
    var scopeOrg = own, kids = orgChildren(own.org_id);
    if (kids.length < 2 && own.parent_id) {
      var par = orgById(own.parent_id);
      if (par) {
        var pk = orgChildren(par.org_id);
        if (pk.length >= 2) { scopeOrg = par; kids = pk; }
      }
    }
    var stAll = subtreeIds(scopeOrg.org_id);
    var scopeObjs = arr('objectives').filter(function (o) { return stAll[o.org_id]; });
    var scopeKrs = [];
    scopeObjs.forEach(function (o) { krsOfObj(o.objective_id).forEach(function (k) { scopeKrs.push(k); }); });
    var scopeEmpIds = {};
    arr('employees').forEach(function (e) { if (stAll[e.org_id]) scopeEmpIds[e.emp_id] = 1; });
    var scopeCks = arr('checkins').filter(function (c) { return scopeEmpIds[c.emp_id]; });
    /* 기준 조직 자기 목표 = 하위가 붙어야 하는 상위 목표 */
    var ownObjIds = {};
    scopeObjs.forEach(function (o) { if (o.org_id === scopeOrg.org_id) ownObjIds[o.objective_id] = 1; });

    var units = kids.map(function (u) {
      var st = subtreeIds(u.org_id);
      var objs = arr('objectives').filter(function (o) { return st[o.org_id]; });
      var krs = [];
      objs.forEach(function (o) { krsOfObj(o.objective_id).forEach(function (k) { krs.push(k); }); });
      var ids = {};
      arr('employees').forEach(function (e) { if (st[e.org_id]) ids[e.emp_id] = 1; });
      var cks = arr('checkins').filter(function (c) { return ids[c.emp_id]; });
      var uc = 0, ut = 0, tops = {};
      objs.forEach(function (o) {
        var ow = empById(o.owner_emp_id), p = compProfile(jpOf(ow));
        if (!p.length) return;
        ut++;
        tops[p[0].dimension_id] = Math.max(tops[p[0].dimension_id] || 0, p[0].weight || 0);
        if (!krsOfObj(o.objective_id).some(function (k) { return k.competency_id === p[0].dimension_id; })) uc++;
      });
      var low = cks.filter(function (c) { return c.confidence === 'low'; }).length;
      var wmax = null;
      objs.forEach(function (o) {
        var w = wavgOf(o);
        if (w == null) return;
        var df = Math.abs((o.progress || 0) - w);
        if (!wmax || df > wmax.diff) wmax = { id: o.objective_id, shown: o.progress || 0, wavg: w, diff: r1(df), krN: krsOfObj(o.objective_id).length };
      });
      return {
        org: u.org_id, name: u.name, objs: objs, objN: objs.length, krs: krs, krN: krs.length,
        cks: cks, ckN: cks.length,
        krAvg: krs.length ? r1(avg(krs.map(function (k) { return k.progress || 0; }))) : null,
        uncov: uc, uncovTot: ut, uncovPct: ut ? r0(uc / ut * 100) : null,
        low: low, lowPct: cks.length ? r0(low / cks.length * 100) : null,
        noParent: objs.filter(function (o) { return !o.parent_objective_id; }).length,
        offParent: objs.filter(function (o) { return o.parent_objective_id && !ownObjIds[o.parent_objective_id] && o.org_id !== scopeOrg.org_id; }).length,
        noJobRef: objs.filter(function (o) { return !(o.job_ref && o.job_ref.task_area); }).length,
        tops: tops, wmax: wmax
      };
    });
    var uo = 0, uk = 0, uc = 0;
    units.forEach(function (u) { uo += u.objN; uk += u.krN; uc += u.ckN; });
    var s = {
      scopeOrg: scopeOrg, widened: scopeOrg.org_id !== own.org_id, ownOrg: own,
      units: units, unitN: units.length,
      /* 하위 팀 합계 = 기준 조직 자신을 뺀 값. scope* 는 기준 조직 포함 */
      unitObjN: uo, unitKrN: uk, unitCkN: uc,
      objs: scopeObjs, objN: scopeObjs.length, krs: scopeKrs, krN: scopeKrs.length,
      cks: scopeCks, ckN: scopeCks.length, ownObjIds: ownObjIds,
      srcOrg: scopeOrg.org_id + ' 하위 ' + units.length + '개 팀',
      srcOrgIncl: scopeOrg.org_id + '(' + scopeOrg.name + ') 및 하위 ' + units.length + '개 팀'
    };
    cacheScope[ck] = s;
    return s;
  }

  /* ================= 문구 치환 =================
     순차·1회성 치환: 각 쌍을 앞선 매치 뒤부터 찾아 한 번만 바꾼다.
     («2건» 을 «0건» 으로 바꾼 뒤 뒤쪽 «0건» 을 또 건드리는 사고를 막는다) */
  function subst(text, pairs) {
    var s = String(text == null ? '' : text), cur = 0, i;
    if (!pairs) return s;
    for (i = 0; i < pairs.length; i++) {
      var from = pairs[i][0];
      if (from == null || from === '') continue;
      var to = String(pairs[i][1] == null ? '' : pairs[i][1]);
      var at = s.indexOf(from, cur);
      if (at < 0) continue;              /* 카탈로그 문구가 바뀌었으면 조용히 건너뛴다 */
      s = s.slice(0, at) + to + s.slice(at + from.length);
      cur = at + to.length;
    }
    return s;
  }

  /* 근거 줄 조립 — spec[i] 가 없으면 계산 못 한 줄이므로 assumed:1 로 남긴다 */
  function buildEvidence(sig, spec) {
    var src = sig.evidence || [], out = [], A = asof(), i;
    for (i = 0; i < src.length; i++) {
      var e = src[i], r = copy(e), s = spec && spec[i];
      if (s && s.m) {
        r.text = subst(e.text, s.m);
        r.emph = (s.emph != null) ? String(s.emph) : subst(e.emph, s.m);
        if (e.calc) r.calc = subst(e.calc, s.calcm || s.m);
        r.assumed = s.assumed ? 1 : 0;
      } else if (s && s.ok) {
        r.assumed = s.assumed ? 1 : (e.assumed ? 1 : 0);
      } else {
        r.assumed = 1;                   /* 카탈로그 예시값 그대로 → 화면에 (추정) */
      }
      if (s && s.src) r.src = s.src;
      if (s && s.text != null) r.text = s.text;
      /* 기준시점 통일 — 지난 기간을 가리키는 「이력」 줄만 원래 시점을 지킨다 */
      r.asof = (s && s.asof) ? s.asof : ((e.axis === '이력') ? (e.asof || A) : A);
      out.push(r);
    }
    return out;
  }
  /* 기준값 — value 는 제도 예시값이므로 덮지 않고 actual(실측)을 덧붙인다(§1) */
  function buildThresholds(sig, map) {
    var src = sig.thresholds || [], out = [], i;
    for (i = 0; i < src.length; i++) {
      var t = src[i], r = copy(t);
      var a = map && has(map, t.code) ? map[t.code] : null;
      if (a != null) { r.actual = String(a); r.measured = 1; }
      out.push(r);
    }
    return out;
  }

  /* ================= 평가기 15종 ================= */
  var EVAL = {};

  /* --- 목표수립-구성원-04 : 핵심결과 직무 과업/1순위 역량 미연결 --------- */
  EVAL['목표수립-구성원-04'] = function (ctx) {
    var SID = '목표수립-구성원-04';
    var C = co(), krs = ctx.myKrs, krN = krs.length, p = ctx.profile;
    var jp = ctx.jp, areas = taskAreas(jp);
    /* 직무 과업 미연결 = job_task_ref 없음 또는 소유 직무의 과업영역에 없는 참조 */
    var noJT = krs.filter(function (k) {
      var r = k.job_task_ref;
      if (!r || !r.task_area) return true;
      if (jp && r.jobProfileId && r.jobProfileId !== jp.job_id) return true;
      return areas.length ? areas.indexOf(r.task_area) < 0 : false;
    }).length;
    var noJTPct = krN ? r0(noJT / krN * 100) : 0;
    var top = p[0] || null;
    var cover = top ? krs.filter(function (k) { return k.competency_id === top.dimension_id; }).length : 0;
    /* 내 핵심결과가 몰린 역량 */
    var dist = {}, dom = null;
    krs.forEach(function (k) { if (k.competency_id) dist[k.competency_id] = (dist[k.competency_id] || 0) + 1; });
    for (var d in dist) if (has(dist, d)) { if (!dom || dist[d] > dist[dom]) dom = d; }
    var domN = dom ? dist[dom] : 0;
    var t3 = p.slice(0, 3), t3sum = 0, t3cov = 0;
    t3.forEach(function (x) {
      t3sum += (x.weight || 0);
      t3cov += krs.filter(function (k) { return k.competency_id === x.dimension_id; }).length;
    });
    /* 내 핵심결과가 닿아 있는 직무 가중치 합 */
    var linkW = 0, linkNames = [];
    p.forEach(function (x) {
      if (krs.filter(function (k) { return k.competency_id === x.dimension_id; }).length) {
        linkW += (x.weight || 0); linkNames.push('「' + compKr(x.dimension_id) + '」');
      }
    });
    /* 지난 기간 리더 피드백 */
    var fb = arr('feedbackHistory').filter(function (f) { return f.emp_id === ctx.emp.emp_id && f.source_type === 'leader'; })[0] || null;

    var facts = {
      krN: krN, noJT: noJT, noJTPct: noJTPct,
      top1: top ? compKr(top.dimension_id) : '', top1W: top ? top.weight : 0, top1Cover: cover,
      domComp: dom ? compKr(dom) : '', domN: domN,
      top3sum: t3sum, top3Cover: t3cov, linkW: linkW, jobTitle: ctx.emp.jobTitle || '',
      coUncov: C.uncovObj, coUncovPct: C.uncovPct, coObjTotal: C.objTotal
    };
    var hit = krN > 0 && (noJTPct >= thv(SID, 'TH-직무연결-미달', 50)
      || cover <= thv(SID, 'TH-1순위역량-미커버', 0));
    var oids = ctx.myObjs.map(function (o) { return o.objective_id; }).join(' · ') || '목표 없음';
    var spec = {};
    if (top) spec[0] = { m: [['서비스기획담당', facts.jobTitle], ['직무 전문성', facts.top1], ['30%', facts.top1W + '%'], ['0건', cover + '건']],
                         emph: cover + '건', src: (jp && jp.job_id ? jp.job_id : ctx.emp.jobProfileId) + ' / ' + oids };
    spec[1] = { m: [['3건', krN + '건'], ['모두', (domN === krN && krN > 0) ? '모두' : (domN + '건이')], ['실행력', facts.domComp || '미지정']],
                emph: (domN === krN && krN > 0) ? '모두' : (domN + '건'),
                src: krs.map(function (k) { return k.kr_id; }).join(' / ') || '핵심결과 없음' };
    spec[2] = { m: [['40건', C.objTotal + '건'], ['25건', C.uncovObj + '건'], ['62.5%', pn(C.uncovPct) + '%']],
                emph: C.uncovObj + '건(' + pn(C.uncovPct) + '%)',
                src: 'objectives ' + C.objTotal + '건 × jobProfiles ' + Object.keys(D().jobProfiles || {}).length + '종' };
    if (t3.length === 3) {
      spec[3] = { m: [['직무 전문성', compKr(t3[0].dimension_id)], ['30%', t3[0].weight + '%'],
                      ['협업', compKr(t3[1].dimension_id)], ['25%', t3[1].weight + '%'],
                      ['성장 마인드셋', compKr(t3[2].dimension_id)], ['25%', t3[2].weight + '%'],
                      ['80%', t3sum + '%'], ['0건', t3cov + '건']],
                  emph: '합 ' + t3sum + '%', src: (jp && jp.job_id) || ctx.emp.jobProfileId };
    }
    spec[4] = { m: [['실행력', linkNames.length ? linkNames.join(' · ').replace(/[「」]/g, '') : '없음'],
                    ['20%', linkW + '%'], ['20%에만', linkW + '%에만']],
                emph: linkW + '%에만', src: (jp && jp.job_id || ctx.emp.jobProfileId) + ' / ' + (krs[0] ? krs[0].kr_id : '-') };
    if (fb) spec[5] = { m: [['협업 리드 경험을 늘려 달라', cut(String(fb.summary).split('—').pop().split('.')[0].replace(/^\s+/, ''), 26)]],
                        src: fb.fb_id + ' / ' + fb.period, asof: '2025-12-31' };
    /* 미연결이 0건이면 「연결되지 않고」는 사실과 어긋난다 —
       숫자만 갈아끼우면 「0건이 연결되지 않고」가 되므로 어절 자체를 실제 상태로 바꾼다 */
    var nMap = (noJT === 0 && krN > 0)
      ? [['핵심결과 2건이 직무 과업에 연결되지 않고', '핵심결과 ' + krN + '건은 모두 직무 과업에 연결됐지만'],
         ['1순위 역량 연결도', '1순위 역량 연결이'], ['0건', cover + '건']]
      : [['2건', noJT + '건'], ['0건', cover + '건']];
    return {
      hit: hit, facts: facts,
      notice: nMap,
      ev: spec,
      th: { 'TH-직무연결-미달': noJTPct + '%', 'TH-1순위역량-미커버': cover + '건' }
    };
  };

  /* --- 목표수립-구성원-08 : 내 핵심결과명이 전사에서 반복 ---------------- */
  EVAL['목표수립-구성원-08'] = function (ctx) {
    var SID = '목표수립-구성원-08';
    var C = co(), krs = ctx.myKrs, krN = krs.length;
    var mine = krs.map(function (k) { return { kr: k, n: dupCountOf(k.name) }; });
    var dupMine = mine.filter(function (x) { return x.n > 1; });
    dupMine.sort(function (a, b) { return b.n - a.n; });
    var maxDup = dupMine.length ? dupMine[0].n : 0;
    var topName = dupMine.length ? dupMine[0].kr.name : (C.dupRows[0] ? C.dupRows[0].name : '');
    var second = C.dupRows.filter(function (r) { return r.name !== topName; })[0] || null;
    var areas = taskAreas(ctx.jp);
    var facts = {
      krN: krN, dupN: dupMine.length, maxDup: maxDup, topName: topName,
      secondName: second ? second.name : '', secondN: second ? second.n : 0,
      jobTitle: ctx.emp.jobTitle || '', taskArea: areas[0] || '',
      coObjTotal: C.objTotal, coOrgTotal: arr('orgs').length
    };
    var hit = dupMine.length >= thv(SID, 'TH-핵심결과중복-본인', 1)
      && maxDup >= thv(SID, 'TH-핵심결과중복-전사', 5);
    var spec = {};
    spec[0] = { m: [['4건', krN + '건'], ['2건', dupMine.length + '건']], emph: dupMine.length + '건',
                src: (dupMine[0] ? dupMine[0].kr.kr_id : (krs[0] ? krs[0].kr_id : '-')) + ' / keyResults.name 집계' };
    spec[1] = { m: [['고객 만족도', topName || '해당 없음'], ['9곳', maxDup + '곳']], emph: maxDup + '곳',
                src: 'keyResults.name 집계 (' + C.krTotal + '건)' };
    if (second) spec[2] = { m: [['프로젝트 납기 준수율', second.name], ['6곳', second.n + '곳']], emph: second.n + '곳',
                            src: 'keyResults.name 집계 (' + C.krTotal + '건)' };
    if (areas.length) spec[3] = { m: [['솔루션컨설팅담당', facts.jobTitle], ['구축 단계 품질 관리', areas[0]]],
                                  emph: areas[0], src: (ctx.jp && ctx.jp.job_id) || ctx.emp.jobProfileId };
    spec[4] = { m: [['9곳', maxDup + '곳']], emph: '서로 달라',
                src: 'objectives ' + C.objTotal + '건 × orgs ' + arr('orgs').length + '개' };
    return {
      hit: hit, facts: facts,
      notice: [['2건', dupMine.length + '건'], ['9곳', maxDup + '곳']],
      ev: spec,
      th: { 'TH-핵심결과중복-전사': maxDup + '곳', 'TH-핵심결과중복-본인': dupMine.length + '건' }
    };
  };

  /* --- 목표수립-구성원-09 : 역량 쏠림 + 상위 역량 공백 ------------------- */
  EVAL['목표수립-구성원-09'] = function (ctx) {
    var SID = '목표수립-구성원-09';
    var C = co(), krs = ctx.myKrs, krN = krs.length, p = ctx.profile;
    var dist = {}, dom = null;
    krs.forEach(function (k) { if (k.competency_id) dist[k.competency_id] = (dist[k.competency_id] || 0) + 1; });
    for (var d in dist) if (has(dist, d)) { if (!dom || dist[d] > dist[dom]) dom = d; }
    var domN = dom ? dist[dom] : 0, domPct = krN ? r0(domN / krN * 100) : 0;
    var top = p[0] || null;
    var cover = top ? (dist[top.dimension_id] || 0) : 0;
    /* 직무 가중치 상위 3 중 비어 있는 역량 */
    var t3 = p.slice(0, 3);
    var empty = t3.filter(function (x) { return !dist[x.dimension_id]; });
    var u2 = empty.length > 1 ? empty[1] : (empty.length ? empty[0] : null);
    var facts = {
      krN: krN, domComp: dom ? compKr(dom) : '', domN: domN, domPct: domPct,
      top1: top ? compKr(top.dimension_id) : '', top1W: top ? top.weight : 0, top1Cover: cover,
      emptyTop: empty.length, jobTitle: ctx.emp.jobTitle || '',
      coDomComp: compKr(C.domDim), coDomPct: C.domPct, coKrTotal: C.krTotal,
      coDomIsMine: C.domDim === dom
    };
    var hit = krN > 0 && domPct >= thv(SID, 'TH-역량쏠림-구성원', 70)
      && cover <= thv(SID, 'TH-1순위역량-미커버', 0);
    var spec = {};
    spec[0] = { m: [['4건', krN + '건'], ['모두', (domN === krN) ? '모두' : (domN + '건이')], ['실행력', facts.domComp || '미지정']],
                emph: (domN === krN) ? '모두' : (domN + '건'),
                src: (ctx.myObjs[0] ? ctx.myObjs[0].objective_id : '-') + ' / ' + (krs[0] ? krs[0].kr_id : '-') };
    spec[1] = { m: [['146건', C.krTotal + '건'], ['실행력', compKr(C.domDim)], ['61.0%', pn(C.domPct) + '%']],
                emph: pn(C.domPct) + '%', src: 'keyResults.competency_id 집계 (' + C.krTotal + '건)' };
    if (top) spec[2] = { m: [['시스템운영담당', facts.jobTitle], ['협업', facts.top1], ['35%', top.weight + '%'], ['0건', cover + '건']],
                         emph: cover + '건', src: (ctx.jp && ctx.jp.job_id) || ctx.emp.jobProfileId };
    if (u2) spec[3] = { m: [['성장 마인드셋', compKr(u2.dimension_id)], ['15%', u2.weight + '%']],
                        emph: '없어요', src: (ctx.jp && ctx.jp.job_id) || ctx.emp.jobProfileId };
    return {
      hit: hit, facts: facts,
      notice: [['4건', krN + '건'], ['실행력', facts.domComp || '미지정'], ['세 개', empty.length + '개']],
      ev: spec,
      th: { 'TH-역량쏠림-구성원': domPct + '%', 'TH-1순위역량-미커버': cover + '건' }
    };
  };

  /* --- 목표수립-구성원-10 : 핵심결과는 과업 연결, 목표만 공백 ------------ */
  EVAL['목표수립-구성원-10'] = function (ctx) {
    var SID = '목표수립-구성원-10';
    var C = co();
    var miss = ctx.myObjs.filter(function (o) { return !(o.job_ref && o.job_ref.task_area); });
    var missKrs = [];
    miss.forEach(function (o) { krsOfObj(o.objective_id).forEach(function (k) { missKrs.push(k); }); });
    var linked = missKrs.filter(function (k) { return k.job_task_ref && k.job_task_ref.task_area; }).length;
    var area = '';
    if (missKrs.length && missKrs[0].job_task_ref) area = missKrs[0].job_task_ref.task_area || '';
    var facts = {
      missObjN: miss.length, missObjTitle: miss.length ? miss[0].title : '',
      krOfMiss: missKrs.length, krLinked: linked, taskArea: area,
      coJobRefObj: C.jobRefObj, coObjTotal: C.objTotal, coJobRefPct: C.jobRefPct
    };
    var hit = miss.length >= 1 && missKrs.length > 0 && linked === missKrs.length;
    var spec = {};
    spec[0] = { m: [['{{목표명}}', facts.missObjTitle || '목표 없음']], emph: '비어 있어요',
                src: (miss[0] ? miss[0].objective_id : '-') + ' / objectives.job_ref' };
    spec[1] = { m: [['40건', C.objTotal + '건'], ['32건', C.jobRefObj + '건'], ['80%', C.jobRefPct + '%']],
                emph: C.jobRefObj + '건(' + C.jobRefPct + '%)', src: 'objectives.job_ref (' + C.objTotal + '건)' };
    spec[2] = { m: [['4건', missKrs.length + '건'], ['모두', (linked === missKrs.length && missKrs.length) ? '모두' : (linked + '건이')]],
                emph: (linked === missKrs.length && missKrs.length) ? '모두' : (linked + '건'),
                src: missKrs.map(function (k) { return k.kr_id; }).join(' / ') || '핵심결과 없음' };
    return {
      hit: hit, facts: facts,
      notice: [['4건', missKrs.length + '건']],
      ev: spec,
      th: { 'TH-목표직무연결-없음': miss.length + '건' }
    };
  };

  /* --- 목표수립-상위조직장-05 : 하위 팀 목표의 상위 연결 공백 ------------ */
  EVAL['목표수립-상위조직장-05'] = function (ctx) {
    var SID = '목표수립-상위조직장-05';
    var C = co(), s = ctx.scope;
    if (!s) return { hit: false, facts: {}, ev: {}, th: {} };
    var missObjs = [];
    s.units.forEach(function (u) {
      u.objs.forEach(function (o) {
        if (!o.parent_objective_id) { missObjs.push(o); return; }
        if (!s.ownObjIds[o.parent_objective_id] && o.org_id !== s.scopeOrg.org_id) missObjs.push(o);
      });
    });
    var unitObjN = 0;
    s.units.forEach(function (u) { unitObjN += u.objN; });
    var missTeams = {};
    missObjs.forEach(function (o) { missTeams[o.org_id] = 1; });
    var theme = '';
    s.objs.forEach(function (o) { if (!theme && o.org_id === s.scopeOrg.org_id && o.strategy_theme_id) theme = themeName(o.strategy_theme_id); });
    var facts = {
      unitN: s.unitN, unitObjN: unitObjN, missN: missObjs.length,
      missPct: unitObjN ? r0(missObjs.length / unitObjN * 100) : 0,
      missTeamN: Object.keys(missTeams).length, theme: theme,
      scopeOrg: s.scopeOrg.org_id, scopeOrgName: s.scopeOrg.name, widened: s.widened
    };
    /* 카탈로그 조건은 「일정 건수를 넘을 때」뿐이다. 누락 비율은 근거·표시용이라
       판정에 넣지 않는다. 기준값은 카탈로그에서 읽는다 (20차) */
    var hit = missObjs.length >= thv(SID, 'TH-상위연결-누락건수', 3);
    var srcScope = s.srcOrg + ' / OBJ ' + unitObjN + '건';
    var spec = {};
    spec[0] = { m: [['8개', s.unitN + '개'], ['22건', unitObjN + '건']], emph: unitObjN + '건', src: srcScope };
    spec[1] = { m: [['22건', unitObjN + '건'], ['4건', missObjs.length + '건']], emph: missObjs.length + '건',
                src: 'OBJ 미연결 ' + missObjs.length + '건 / objectives.parent_objective_id' };
    spec[2] = { m: [['22건', unitObjN + '건'], ['4건', missObjs.length + '건']], src: '상위 목표 연결 제도 기준' };
    if (theme) spec[3] = { m: [['4건', missObjs.length + '건'], ['수익성 있는 성장', theme]], emph: '「' + theme + '」',
                           src: s.scopeOrg.org_id + ' 목표 / 전략 테마 ' + theme };
    return {
      hit: hit, facts: facts,
      notice: [['22건', unitObjN + '건'], ['4건', missObjs.length + '건']],
      ev: spec,
      th: { 'TH-상위연결-누락건수': missObjs.length + '건', 'TH-상위연결-누락비율': facts.missPct + '%' }
    };
  };

  /* --- 목표수립-상위조직장-07 : 팀 1순위 역량 미연결률 vs 전사 ----------- */
  EVAL['목표수립-상위조직장-07'] = function (ctx) {
    var SID = '목표수립-상위조직장-07';
    var C = co(), s = ctx.scope;
    if (!s) return { hit: false, facts: {}, ev: {}, th: {} };
    var TH = thv(SID, 'TH-역량커버-미달비율', 70);
    var bad = s.units.filter(function (u) { return u.uncovPct != null && u.uncov > 0 && u.uncovPct >= TH; });
    var rest = s.units.filter(function (u) { return u.uncovPct != null && bad.indexOf(u) < 0; });
    var badObjN = 0, badObjTot = 0, badKrN = 0, badKrs = [], unitObjN = s.unitObjN, unitKrN = s.unitKrN;
    bad.forEach(function (u) {
      badObjN += u.uncov; badObjTot += u.objN; badKrN += u.krN;
      u.krs.forEach(function (k) { badKrs.push(k); });
    });
    var badPct = badObjTot ? r0(badObjN / badObjTot * 100) : 0;
    var diff = r1(badPct - C.uncovPct);
    /* 대상 팀 핵심결과가 몰린 역량 */
    var dist = {}, dom = null;
    badKrs.forEach(function (k) { if (k.competency_id) dist[k.competency_id] = (dist[k.competency_id] || 0) + 1; });
    for (var d in dist) if (has(dist, d)) { if (!dom || dist[d] > dist[dom]) dom = d; }
    /* 대상 팀 직무 1순위 역량 목록 */
    var tops = {}, topList = [];
    bad.forEach(function (u) { for (var t in u.tops) if (has(u.tops, t)) tops[t] = Math.max(tops[t] || 0, u.tops[t]); });
    for (var t2 in tops) if (has(tops, t2)) topList.push({ d: t2, w: tops[t2] });
    topList.sort(function (a, b) { return b.w - a.w; });
    var topStr = topList.slice(0, 3).map(function (x) { return '「' + compKr(x.d) + '」 ' + x.w + '%'; }).join(' · ') || '기록 없음';
    var restPct = rest.length ? r0(avg(rest.map(function (u) { return u.uncovPct; }))) : 0;
    var facts = {
      unitN: s.unitN, unitObjN: unitObjN, unitKrN: unitKrN,
      badTeamN: bad.length, badTeams: bad.map(function (u) { return u.org; }),
      badObjN: badObjN, badObjTot: badObjTot, badPct: badPct,
      badKrN: badKrN, badDomComp: dom ? compKr(dom) : '', badDomN: dom ? dist[dom] : 0,
      coUncov: C.uncovObj, coUncovPct: C.uncovPct, coObjTotal: C.objTotal, diff: diff,
      restTeamN: rest.length, restPct: restPct, topList: topStr,
      scopeOrg: s.scopeOrg.org_id, scopeOrgName: s.scopeOrg.name, widened: s.widened
    };
    var hit = bad.length >= 1 && diff >= thv(SID, 'TH-역량커버-편차', 15);
    var badSrc = bad.map(function (u) { return u.org; }).join(' · ') || s.scopeOrg.org_id;
    var spec = {};
    spec[0] = { m: [['8개', s.unitN + '개'], ['22건', unitObjN + '건'], ['146건', unitKrN + '건']], emph: unitObjN + '건',
                src: s.srcOrg + ' / OBJ ' + unitObjN + '건 · KR ' + unitKrN + '건' };
    spec[1] = { m: [['두 팀', bad.length + '개 팀'], ['11건', badObjTot + '건'], ['9건', badObjN + '건']], emph: badObjN + '건',
                src: badSrc + ' / OBJ ' + badObjTot + '건' };
    spec[2] = { m: [['두 팀', bad.length + '개 팀'], ['34건', badKrN + '건'], ['21건', facts.badDomN + '건'], ['실행력', facts.badDomComp || '미지정']],
                emph: facts.badDomN + '건', src: badSrc + ' / KR ' + badKrN + '건' };
    /* 카탈로그가 정수로 쓴 자리(63% · 19%p)는 정수로 맞춘다 — 실측 소수는 기준값 actual 에 남는다 */
    spec[3] = { m: [['40건', C.objTotal + '건'], ['25건', C.uncovObj + '건'], ['두 팀', bad.length + '개 팀'],
                    ['63%', r0(C.uncovPct) + '%'], ['19%p', r0(diff) + '%p']], emph: r0(C.uncovPct) + '%',
                src: 'objectives ' + C.objTotal + '건 / 1순위 역량 미연결 ' + C.uncovObj + '건' };
    spec[4] = { m: [['6개', rest.length + '개'], ['55%', restPct + '%']], emph: restPct + '%',
                src: s.srcOrg + ' 중 나머지 ' + rest.length + '개 팀' };
    spec[5] = { m: [['두 팀', bad.length + '개 팀'], ['「직무 전문성」 40%와 「협업」 35%', topStr]], emph: topStr,
                src: badSrc + ' 직무 프로파일' };
    return {
      hit: hit, facts: facts,
      notice: [['두 팀', bad.length + '개 팀'], ['9건', badObjN + '건'], ['63%', r0(C.uncovPct) + '%'], ['19%p', r0(diff) + '%p']],
      ev: spec,
      th: { 'TH-역량커버-미달비율': badPct + '%', 'TH-역량커버-편차': pn(diff) + '%p' }
    };
  };

  /* --- 목표수립-상위조직장-08 : 하위 팀 목표 직무 과업 연결 공백 --------- */
  EVAL['목표수립-상위조직장-08'] = function (ctx) {
    var SID = '목표수립-상위조직장-08';
    var C = co(), s = ctx.scope;
    if (!s) return { hit: false, facts: {}, ev: {}, th: {} };
    var missObjs = [], unitObjN = 0, teams = {};
    s.units.forEach(function (u) {
      unitObjN += u.objN;
      u.objs.forEach(function (o) {
        if (!(o.job_ref && o.job_ref.task_area)) { missObjs.push(o); teams[o.org_id] = 1; }
      });
    });
    var facts = {
      unitN: s.unitN, unitObjN: unitObjN, missN: missObjs.length,
      missTeamN: Object.keys(teams).length,
      coMissN: C.missJobRef, coObjTotal: C.objTotal, coJobRefPct: C.jobRefPct,
      elapsedDays: null,        /* objectives 에 저장일(updated_at)이 없어 계산 불가 */
      scopeOrg: s.scopeOrg.org_id, widened: s.widened
    };
    var hit = missObjs.length >= thv(SID, 'TH-직무과업연결-누락건수', 3);
    var spec = {};
    spec[0] = { m: [['8개', s.unitN + '개'], ['22건', unitObjN + '건']], emph: unitObjN + '건',
                src: s.srcOrg + ' / OBJ ' + unitObjN + '건' };
    spec[1] = { m: [['세 팀', facts.missTeamN + '개 팀'], ['6건', missObjs.length + '건']], emph: missObjs.length + '건',
                src: (Object.keys(teams).join(' · ') || s.scopeOrg.org_id) + ' / OBJ ' + missObjs.length + '건' };
    spec[2] = { m: [['40건', C.objTotal + '건'], ['8건', C.missJobRef + '건'], ['80%', C.jobRefPct + '%']],
                emph: C.jobRefPct + '%', src: 'objectives.job_ref (' + C.objTotal + '건)' };
    /* [3] 경과일 = objectives 에 저장일 필드가 없어 계산 불가 → 카탈로그 예시값 유지(추정) */
    return {
      hit: hit, facts: facts,
      notice: [['세 팀', facts.missTeamN + '개 팀'], ['6건', missObjs.length + '건']],
      ev: spec,
      th: { 'TH-직무과업연결-누락건수': missObjs.length + '건' }
    };
  };

  /* --- 중간점검-구성원-08 : 체크인 없는 핵심결과 + 가중치 합 ------------- */
  EVAL['중간점검-구성원-08'] = function (ctx) {
    var SID = '중간점검-구성원-08';
    var C = co(), krs = ctx.myKrs, krN = krs.length;
    var ckBy = {};
    arr('checkins').forEach(function (c) { ckBy[c.kr_id] = (ckBy[c.kr_id] || 0) + 1; });
    var zero = krs.filter(function (k) { return !ckBy[k.kr_id]; });
    var withCk = krs.filter(function (k) { return !!ckBy[k.kr_id]; });
    var zeroW = 0;
    zero.forEach(function (k) { zeroW += num(k.weight); });
    var myKrIds = {};
    krs.forEach(function (k) { myKrIds[k.kr_id] = 1; });
    var myCkOnMine = ctx.myCks.filter(function (c) { return myKrIds[c.kr_id]; });
    var w = periodWindow(ctx.myObjs[0] && ctx.myObjs[0].period);
    var startM = w ? (new Date(w.start).getUTCMonth() + 1) : null;
    var facts = {
      krN: krN, zeroN: zero.length, zeroPct: krN ? r0(zero.length / krN * 100) : 0,
      zeroWsum: r0(zeroW), withCkN: withCk.length, myCkOnMine: myCkOnMine.length,
      coCkTotal: C.ckTotal, coEmpTotal: C.empTotal, coCkAvg: C.ckPerEmp, startMonth: startM
    };
    var hit = krN > 0 && zero.length >= 1
      && facts.zeroPct >= thv(SID, 'TH-핵심결과체크인-없음', 50)
      && facts.zeroWsum >= thv(SID, 'TH-미기록이중치-합', 50);
    var spec = {};
    spec[0] = { m: [['4건', krN + '건'], ['3건', zero.length + '건']], emph: zero.length + '건',
                src: (ctx.myObjs[0] ? ctx.myObjs[0].objective_id : '-') + ' / checkins.kr_id' };
    spec[1] = { m: [['1건', withCk.length + '건'], ['2건', myCkOnMine.length + '건']], emph: myCkOnMine.length + '건',
                src: myCkOnMine.map(function (c) { return c.checkin_id; }).join(' / ') || '체크인 없음',
                assumed: (withCk.length === 1 ? 0 : 1) };
    spec[2] = { m: [['360건', C.ckTotal + '건'], ['1.63건', C.ckPerEmp + '건']], emph: C.ckPerEmp + '건',
                src: 'checkins ' + C.ckTotal + '건 / employees ' + C.empTotal + '명' };
    spec[3] = { m: [['3건', zero.length + '건'], ['4월', (startM ? startM + '월' : '기간 시작')]],
                emph: '한 번도', src: zero.map(function (k) { return k.kr_id; }).join(' / ') || '해당 없음',
                assumed: startM ? 0 : 1 };
    spec[4] = { m: [['3건', zero.length + '건'], ['65%', r0(zeroW) + '%']], emph: r0(zeroW) + '%',
                src: zero.map(function (k) { return k.kr_id; }).join(' / ') || '해당 없음' };
    return {
      hit: hit, facts: facts,
      notice: [['4건', krN + '건'], ['3건', zero.length + '건'], ['65%', r0(zeroW) + '%']],
      ev: spec,
      th: { 'TH-핵심결과체크인-없음': facts.zeroPct + '%', 'TH-미기록이중치-합': facts.zeroWsum + '%' }
    };
  };

  /* --- 중간점검-상위조직장-03 : 하위 팀 진척 격차 ------------------------ */
  EVAL['중간점검-상위조직장-03'] = function (ctx) {
    var SID = '중간점검-상위조직장-03';
    var C = co(), s = ctx.scope;
    if (!s) return { hit: false, facts: {}, ev: {}, th: {} };
    var rows = s.units.filter(function (u) { return u.krAvg != null && u.krN > 0; });
    rows.sort(function (a, b) { return b.krAvg - a.krAvg; });
    var hi = rows[0] || null, lo = rows[rows.length - 1] || null;
    var gap = (hi && lo) ? r1(hi.krAvg - lo.krAvg) : 0;
    var loBelow = lo ? lo.krs.filter(function (k) { return (k.progress || 0) < 50; }).length : 0;
    var unitKrN = s.unitKrN;
    /* 기간 경과율 — 하위 팀 목표의 period 실파싱 */
    var per = null;
    s.units.forEach(function (u) { u.objs.forEach(function (o) { if (!per && o.period) per = o.period; }); });
    var elapsed = periodElapsed(per);
    var planGap = (elapsed != null && lo) ? r1(elapsed - lo.krAvg) : null;
    var pw = periodWindow(per);
    var facts = {
      unitN: s.unitN, unitKrN: unitKrN,
      hiName: hi ? hi.name : '', hiOrg: hi ? hi.org : '', hiAvg: hi ? hi.krAvg : null,
      loName: lo ? lo.name : '', loOrg: lo ? lo.org : '', loAvg: lo ? lo.krAvg : null,
      gap: gap, loKrN: lo ? lo.krN : 0, loBelow50: loBelow,
      coKrTotal: C.krTotal, coKrAvg: C.krAvg, elapsed: elapsed, planGap: planGap,
      period: per, scopeOrg: s.scopeOrg.org_id, widened: s.widened
    };
    /* 팀 간 격차가 기준을 넘고, 계획 대비 미달 폭도 기준을 넘을 때만 알린다.
       계획 대비를 못 센 경우(planGap == null)는 격차만으로 판단한다 (20차) */
    var hit = !!(hi && lo && gap >= thv(SID, 'TH-팀진척격차-폭', 30)
      && (planGap == null || planGap >= thv(SID, 'TH-진척계획 대비 격차-하한', 15)));
    var spec = {};
    spec[0] = { m: [['8개', s.unitN + '개'], ['146건', unitKrN + '건']], emph: s.unitN + '개 팀',
                src: s.srcOrg + ' / KR ' + unitKrN + '건' };
    if (hi && lo) {
      spec[1] = { m: [['78%', r0(hi.krAvg) + '%'], ['41%', r0(lo.krAvg) + '%']], emph: r0(lo.krAvg) + '%',
                  src: hi.org + ' / ' + lo.org + ' / keyResults.progress 팀별 집계' };
      spec[2] = { m: [['17건', lo.krN + '건'], ['12건', loBelow + '건']], emph: loBelow + '건',
                  src: lo.org + ' / KR ' + lo.krN + '건' };
      spec[3] = { m: [['37%p', r0(gap) + '%p']], emph: r0(gap) + '%p', src: hi.org + ' / ' + lo.org };
    }
    spec[4] = { m: [['146건', C.krTotal + '건'], ['43%', C.krAvg + '%']], emph: C.krAvg + '%',
                src: 'keyResults.progress (' + C.krTotal + '건)' };
    if (elapsed != null && lo) {
      spec[5] = { m: [['100%', elapsed + '%'], ['41%', r0(lo.krAvg) + '%'], ['59%p', r0(planGap) + '%p']],
                  emph: r0(planGap) + '%p',
                  src: lo.org + ' / ' + (per || '기간 미상') + (pw ? ' ' + new Date(pw.start).toISOString().slice(0, 10) + '~' + new Date(pw.end).toISOString().slice(5, 10) : '') };
    }
    return {
      hit: hit, facts: facts,
      notice: [['78%', hi ? r0(hi.krAvg) + '%' : '기록 없음'], ['41%', lo ? r0(lo.krAvg) + '%' : '기록 없음'], ['37%p', r0(gap) + '%p']],
      ev: spec,
      th: { 'TH-팀진척격차-폭': pn(gap) + '%p', 'TH-진척계획 대비 격차-하한': (planGap == null ? null : pn(planGap) + '%p') }
    };
  };

  /* --- 중간점검-상위조직장-05 : 최근 기간 장애요인 반복 ------------------ */
  EVAL['중간점검-상위조직장-05'] = function (ctx) {
    var SID = '중간점검-상위조직장-05';
    var s = ctx.scope;
    if (!s) return { hit: false, facts: {}, ev: {}, th: {} };
    var WIN = thv(SID, 'TH-장애요인반복-기간', 14);
    var from = dayShift(asofMs(), -WIN), prevFrom = dayShift(asofMs(), -WIN * 2);
    var win = s.cks.filter(function (c) { return c.checkin_date > from && c.checkin_date <= asof(); });
    var prev = s.cks.filter(function (c) { return c.checkin_date > prevFrom && c.checkin_date <= from; });
    var cnt = {}, teamOf = {};
    var orgByEmp = {};
    arr('employees').forEach(function (e) { orgByEmp[e.emp_id] = e.org_id; });
    win.forEach(function (c) {
      if (!c.blocker) return;
      cnt[c.blocker] = (cnt[c.blocker] || 0) + 1;
      (teamOf[c.blocker] = teamOf[c.blocker] || {})[orgByEmp[c.emp_id] || '?'] = 1;
    });
    var top = null;
    for (var b in cnt) if (has(cnt, b)) { if (!top || cnt[b] > cnt[top]) top = b; }
    var topN = top ? cnt[top] : 0;
    var teams = top ? Object.keys(teamOf[top]) : [];
    var prevN = top ? prev.filter(function (c) { return c.blocker === top; }).length : 0;
    var unitObjN = 0;
    s.units.forEach(function (u) { unitObjN += u.objN; });
    var facts = {
      winDays: WIN, winFrom: from, winCkN: win.length, winBlockerN: win.filter(function (c) { return !!c.blocker; }).length,
      topBlocker: top || '', topN: topN, teamN: teams.length, teams: teams, prevN: prevN,
      unitN: s.unitN, scopeCkN: s.ckN, lastCkDate: (function () {
        var d = null;
        s.cks.forEach(function (c) { if (!d || c.checkin_date > d) d = c.checkin_date; });
        return d;
      })(), scopeOrg: s.scopeOrg.org_id, widened: s.widened
    };
    var hit = topN >= thv(SID, 'TH-장애요인반복-건수', 3)
      && teams.length >= thv(SID, 'TH-장애요인반복-팀수', 3);
    var spec = {};
    spec[0] = { m: [['하위 8개 팀', '기준 조직과 하위 ' + s.unitN + '개 팀'], ['41건', win.length + '건']], emph: win.length + '건',
                src: s.srcOrgIncl + ' / 최근 ' + WIN + '일(' + from + '~' + asof() + ') 체크인 ' + win.length + '건' };
    spec[1] = { m: [['외부 API 연동 이슈로 일정 지연', top || '해당 없음'], ['7건', topN + '건']], emph: topN + '건',
                src: 'checkins.blocker / 최근 ' + WIN + '일 ' + win.length + '건' };
    spec[2] = { m: [['3개', teams.length + '개']], emph: teams.length + '개 팀',
                src: (teams.join(' · ') || '해당 없음') + ' / CHK ' + topN + '건' };
    spec[3] = { m: [['1건', prevN + '건'], ['7건', topN + '건']],
                src: '직전 ' + WIN + '일(' + prevFrom + '~' + from + ') 체크인 ' + prev.length + '건' };
    return {
      hit: hit, facts: facts,
      notice: [['세 팀', teams.length + '개 팀'], ['7건', topN + '건']],
      ev: spec,
      th: { 'TH-장애요인반복-건수': topN + '건', 'TH-장애요인반복-팀수': teams.length + '개', 'TH-장애요인반복-기간': WIN + '일' }
    };
  };

  /* --- 중간점검-상위조직장-06 : 팀 확신도 낮음 비중 ---------------------- */
  EVAL['중간점검-상위조직장-06'] = function (ctx) {
    var SID = '중간점검-상위조직장-06';
    var C = co(), s = ctx.scope;
    if (!s) return { hit: false, facts: {}, ev: {}, th: {} };
    var MIN_CK = 10;
    var rows = s.units.filter(function (u) { return u.ckN >= MIN_CK && u.lowPct != null; });
    rows.sort(function (a, b) { return b.lowPct - a.lowPct; });
    var w = rows[0] || null;
    var diff = w ? r1(w.lowPct - C.lowPct) : 0;
    var isTop = !!w && (function () {
      var all = s.units.filter(function (u) { return u.lowPct != null; });
      var mx = -1;
      all.forEach(function (u) { if (u.lowPct > mx) mx = u.lowPct; });
      return w.lowPct >= mx;
    })();
    var facts = {
      unitN: s.unitN, scopeCkN: s.ckN, minCk: MIN_CK, qualifiedTeamN: rows.length,
      teamOrg: w ? w.org : '', teamName: w ? w.name : '', teamCkN: w ? w.ckN : 0,
      teamLowN: w ? w.low : 0, teamLowPct: w ? w.lowPct : null,
      coLowN: C.lowCk, coCkTotal: C.ckTotal, coLowPct: C.lowPct, diff: diff, isTop: isTop,
      scopeOrg: s.scopeOrg.org_id, widened: s.widened
    };
    var hit = !!w && w.lowPct >= thv(SID, 'TH-저확신비중-팀', 40)
      && diff >= thv(SID, 'TH-저확신비중-편차', 20);
    var spec = {};
    /* ⓪ 범위 문구가 「하위 N개 팀」이므로 기준 조직 자신을 뺀 하위 팀 합계를 쓴다 */
    spec[0] = { m: [['8개', s.unitN + '개'], ['360건', s.unitCkN + '건']], emph: s.unitCkN + '건',
                src: s.srcOrg + ' / CHK ' + s.unitCkN + '건' };
    if (w) {
      spec[1] = { m: [['34건', w.ckN + '건'], ['17건', w.low + '건']], emph: w.low + '건',
                  src: w.org + ' / CHK ' + w.ckN + '건' };
      spec[3] = { m: [['50%', w.lowPct + '%'], ['31%p', pn(diff) + '%p'], ['8개', s.unitN + '개']],
                  emph: pn(diff) + '%p', src: s.srcOrg + ' / checkins.confidence 팀별 집계',
                  assumed: isTop ? 0 : 1 };
    }
    spec[2] = { m: [['360건', C.ckTotal + '건'], ['68건', C.lowCk + '건'], ['19%', C.lowPct + '%']],
                emph: C.lowPct + '%', src: 'checkins.confidence (' + C.ckTotal + '건)' };
    return {
      hit: hit, facts: facts,
      notice: [['34건', (w ? w.ckN : 0) + '건'], ['17건', (w ? w.low : 0) + '건']],
      ev: spec,
      th: { 'TH-저확신비중-팀': (w ? w.lowPct + '%' : '0%'), 'TH-저확신비중-편차': pn(diff) + '%p' }
    };
  };

  /* --- 중간점검-상위조직장-08 : 표시 진행률 vs 가중평균 ------------------ */
  EVAL['중간점검-상위조직장-08'] = function (ctx) {
    var SID = '중간점검-상위조직장-08';
    var C = co(), s = ctx.scope;
    if (!s) return { hit: false, facts: {}, ev: {}, th: {} };
    var rows = [];
    s.objs.forEach(function (o) {
      var w = wavgOf(o);
      if (w == null) return;
      var ks = krsOfObj(o.objective_id), wsum = 0;
      ks.forEach(function (k) { wsum += num(k.weight); });
      var org = orgById(o.org_id);
      rows.push({ id: o.objective_id, org: o.org_id, orgName: (org && org.name) || o.org_id,
                  shown: r1(o.progress || 0), wavg: w, diff: r1(Math.abs((o.progress || 0) - w)),
                  krN: ks.length, wsum: r0(wsum), krIds: ks.map(function (k) { return k.kr_id; }) });
    });
    rows.sort(function (a, b) { return b.diff - a.diff; });
    var w0 = rows[0] || null;
    var bigN = rows.filter(function (r) { return r.diff > 25; }).length;
    var facts = {
      unitN: s.unitN, unitObjN: s.unitObjN, scopeObjN: s.objN,
      worstObj: w0 ? w0.id : '', worstOrg: w0 ? w0.org : '', worstOrgName: w0 ? w0.orgName : '',
      shown: w0 ? w0.shown : null, wavg: w0 ? w0.wavg : null, diff: w0 ? w0.diff : 0,
      worstKrN: w0 ? w0.krN : 0, worstWsum: w0 ? w0.wsum : 0,
      bigN: bigN, coWdiffAvg: C.wdiffAvg, coObjTotal: C.objTotal,
      scopeOrg: s.scopeOrg.org_id, widened: s.widened
    };
    /* 카탈로그 조건은 「차이가 조직 평균을 크게 웃돌 때」다. 「차이 큰 목표 3건 이상」은
       조건이 아니라 묶어 보내는 최소 건수(발송 규칙)라 판정에 넣지 않는다 (20차) */
    var hit = !!w0 && w0.diff >= thv(SID, 'TH-진행률산식괴리-폭', 25);
    var spec = {};
    /* 산식 괴리는 기준 조직 자신의 목표에서도 생기므로 범위에 기준 조직을 포함하고
       ⓪ 문구도 「기준 조직과 하위 N개 팀」으로 바꿔 실제 대조군을 그대로 드러낸다 */
    spec[0] = { m: [['하위 8개 팀', '기준 조직과 하위 ' + s.unitN + '개 팀'], ['22건', s.objN + '건']], emph: s.objN + '건',
                src: s.srcOrgIncl + ' / OBJ ' + s.objN + '건' };
    if (w0) {
      var krRange = w0.krIds.length ? (w0.krIds[0] + (w0.krIds.length > 1 ? '~' + w0.krIds[w0.krIds.length - 1] : '')) : '-';
      spec[1] = { m: [['65%', r0(w0.shown) + '%'], ['35%', r0(w0.wavg) + '%']], emph: r0(w0.wavg) + '%',
                  src: w0.id + '(' + w0.orgName + ') / ' + krRange };
      spec[4] = { m: [['4건', w0.krN + '건'], ['100%', w0.wsum + '%']], emph: w0.wsum + '%',
                  src: w0.id + ' / ' + krRange, assumed: (w0.wsum === 100 ? 0 : 1) };
    }
    spec[2] = { m: [['4건', bigN + '건']], emph: bigN + '건', src: s.srcOrgIncl + ' / OBJ ' + bigN + '건' };
    spec[3] = { m: [['40건', C.objTotal + '건'], ['11%p', pn(C.wdiffAvg) + '%p']], emph: pn(C.wdiffAvg) + '%p',
                src: 'objectives.progress vs keyResults 가중평균 (' + C.objTotal + '건)' };
    spec[5] = { ok: 1, src: 'objectives.progress / keyResults.weight·progress' };
    return {
      hit: hit, facts: facts,
      notice: [['65%', w0 ? r0(w0.shown) + '%' : '기록 없음'], ['35%', w0 ? r0(w0.wavg) + '%' : '기록 없음'],
               ['30%p', r0(facts.diff) + '%p']],
      ev: spec,
      th: { 'TH-진행률산식괴리-폭': pn(facts.diff) + '%p', 'TH-진행률산식괴리-건수': bigN + '건' }
    };
  };

  /* --- 중간점검-HR경영진-09 : 조직 간 목표 진행률 격차 ------------------- */
  EVAL['중간점검-HR경영진-09'] = function (ctx) {
    var SID = '중간점검-HR경영진-09';
    var C = co();
    var hi = C.orgMax, lo = C.orgMin;
    var per = null;
    arr('objectives').forEach(function (o) { if (!per && o.period) per = o.period; });
    var pw = periodWindow(per);
    var facts = {
      orgN: C.orgN, coObjTotal: C.objTotal,
      hiOrg: hi ? hi.org : '', hiName: hi ? hi.name : '', hiAvg: hi ? hi.avg : null,
      loOrg: lo ? lo.org : '', loName: lo ? lo.name : '', loAvg: lo ? lo.avg : null,
      gap: C.orgGap, period: per, periodLabel: pw ? pw.label : ''
    };
    var hit = !!(hi && lo) && C.orgGap >= thv(SID, 'TH-진척조직간격차-초과', 30)
      && C.orgN >= thv(SID, 'TH-진척비교조직-최소수', 5);
    var spec = {};
    spec[0] = { m: [['40건', C.objTotal + '건']], emph: C.objTotal + '건',
                src: 'objectives ' + C.objTotal + '건 / orgs ' + C.orgN + '곳' };
    if (hi && lo) {
      spec[1] = { m: [['64.8%', pn(hi.avg) + '%'], ['21.9%', pn(lo.avg) + '%']], emph: pn(lo.avg) + '%',
                  calcm: [['64.8%', pn(hi.avg) + '%'], ['21.9%', pn(lo.avg) + '%'], ['42.9%p', pn(C.orgGap) + '%p']],
                  src: hi.org + '(' + hi.name + ') / ' + lo.org + '(' + lo.name + ') / objectives.progress' };
    }
    /* [2] 「제도 기준선 30%p」는 확정 근거가 없는 잠정 기준선 → 카탈로그대로 추정 유지 */
    return {
      hit: hit, facts: facts,
      notice: [['64.8%', hi ? pn(hi.avg) + '%' : '기록 없음'], ['21.9%', lo ? pn(lo.avg) + '%' : '기록 없음']],
      ev: spec,
      th: { 'TH-진척조직간격차-초과': pn(C.orgGap) + '%p', 'TH-진척비교조직-최소수': C.orgN + '곳' }
    };
  };

  /* --- 평가-구성원-02 : 자기평가 근거로 쓸 체크인 부족 ------------------- */
  EVAL['평가-구성원-02'] = function (ctx) {
    var SID = '평가-구성원-02';
    var C = co();
    var per = (ctx.myObjs[0] && ctx.myObjs[0].period) || null;
    if (!per) arr('objectives').forEach(function (o) { if (!per && o.period) per = o.period; });
    var pw = periodWindow(per);
    var from = pw ? new Date(pw.start).toISOString().slice(0, 10) : null;
    var to = pw ? new Date(pw.end).toISOString().slice(0, 10) : null;
    var inPeriod = ctx.myCks.filter(function (c) {
      if (!from) return true;
      return c.checkin_date >= from && c.checkin_date <= to;
    });
    var last = null;
    ctx.myCks.forEach(function (c) { if (!last || c.checkin_date > last) last = c.checkin_date; });
    var lastMs = last ? dnum(last) : null;
    var gapDays = lastMs == null ? null : Math.max(0, Math.round((asofMs() - lastMs) / 86400000));
    var lastMonth = last ? parseInt(last.slice(5, 7), 10) : null;
    var facts = {
      period: per, periodLabel: pw ? pw.label : '', periodFrom: from, periodTo: to,
      myCkN: inPeriod.length, myCkTotal: ctx.myCks.length, lastDate: last, gapDays: gapDays,
      coCkTotal: C.ckTotal, coEmpTotal: C.empTotal, coCkAvg: C.ckPerEmp
    };
    var hit = inPeriod.length < thv(SID, 'TH-평가근거체크인-부족', 2);
    var spec = {};
    spec[0] = { m: [['1건', inPeriod.length + '건']], emph: inPeriod.length + '건',
                src: 'checkins where emp_id=' + ctx.emp.emp_id + (from ? ' · ' + from + '~' + to : '') };
    spec[1] = { m: [['360건', C.ckTotal + '건'], ['1.63건', C.ckPerEmp + '건']], emph: C.ckPerEmp + '건',
                src: 'checkins ' + C.ckTotal + '건 / employees ' + C.empTotal + '명' };
    if (last) spec[2] = { m: [['4월', lastMonth + '월'], ['석 달', gapDays + '일']], emph: gapDays + '일',
                          src: (inPeriod[inPeriod.length - 1] || ctx.myCks[0] || {}).checkin_id || last };
    return {
      hit: hit, facts: facts,
      notice: [['1건', inPeriod.length + '건']],
      ev: spec,
      th: { 'TH-평가근거체크인-부족': inPeriod.length + '건', 'TH-체크인-전사평균': C.ckPerEmp + '건' }
    };
  };

  /* --- 평가-구성원-10 : 직무 전환으로 평가 축 변동 ---------------------- */
  EVAL['평가-구성원-10'] = function (ctx) {
    var SID = '평가-구성원-10';
    var C = co();
    var hist = (ctx.emp.jobHistory && ctx.emp.jobHistory.length) ? ctx.emp.jobHistory[ctx.emp.jobHistory.length - 1] : null;
    var jpm = D().jobProfiles || {};
    var prevJp = hist ? jpm[hist.prev_jobProfileId] : null;
    var newJp = hist ? (jpm[hist.new_jobProfileId] || ctx.jp) : null;
    var pt = compProfile(prevJp)[0] || null, nt = compProfile(newJp)[0] || null;
    var sameDim = !!(pt && nt && pt.dimension_id === nt.dimension_id);
    var prevAreas = taskAreas(prevJp), newAreas = taskAreas(newJp);
    var freshAreas = newAreas.filter(function (a) { return prevAreas.indexOf(a) < 0; });
    var eh = arr('evalHistory').filter(function (x) { return x.emp_id === ctx.emp.emp_id; })[0] || null;
    var prevGrade = null;
    if (eh && eh.history && eh.history.length) prevGrade = eh.history[eh.history.length - 1];
    var facts = {
      changed: !!hist, period: hist ? hist.period : '',
      prevLabel: hist ? hist.prev_label : '', newLabel: hist ? hist.new_label : '',
      prevTop: pt ? compKr(pt.dimension_id) : '', prevTopW: pt ? pt.weight : null,
      newTop: nt ? compKr(nt.dimension_id) : '', newTopW: nt ? nt.weight : null,
      sameTopDim: sameDim, newAreaN: newAreas.length, freshAreaN: freshAreas.length,
      coJobHistN: C.jobHistN, coEmpTotal: C.empTotal,
      prevPeriod: prevGrade ? prevGrade.period : '', prevScore: prevGrade ? prevGrade.score : null
    };
    var hit = !!hist;
    /* 1순위 역량 dimension 이 그대로면 「서로 달라」는 사실이 아니다 → 실제 변화(가중치)로 바꿔 쓴다 */
    var axisPhrase = sameDim
      ? ('가중치 1순위 역량은 같은 「' + facts.newTop + '」인데 비중이 ' + facts.prevTopW + '%→' + facts.newTopW + '%로 바뀌어')
      : '가중치 1순위 역량이 서로 달라';
    var axisEmph = sameDim ? ('비중 ' + facts.prevTopW + '%→' + facts.newTopW + '%') : '서로 달라';
    var noticePhrase = sameDim
      ? ('가중치 1순위 역량 비중이 ' + facts.prevTopW + '%에서 ' + facts.newTopW + '%로 바뀌었어요')
      : null;
    var spec = {};
    if (hist) {
      spec[0] = { m: [['데이터분석담당', facts.prevLabel], ['서비스기획담당', facts.newLabel]], emph: facts.newLabel,
                  src: ctx.emp.emp_id + '.jobHistory / ' + facts.period };
      spec[1] = { m: [['가중치 1순위 역량이 서로 달라', axisPhrase]], emph: axisEmph,
                  src: hist.prev_jobProfileId + ' → ' + hist.new_jobProfileId };
      spec[2] = { m: [['221명', C.empTotal + '명'], ['1명', C.jobHistN + '명']], emph: C.jobHistN + '명',
                  src: 'employees.jobHistory (' + C.empTotal + '명 중 ' + C.jobHistN + '명)' };
      spec[3] = { m: [['5개', newAreas.length + '개'], ['3개', freshAreas.length + '개']], emph: freshAreas.length + '개',
                  src: hist.new_jobProfileId + ' 과업영역 ' + newAreas.length + '개' };
      if (prevGrade) spec[4] = { ok: 1, src: ctx.emp.emp_id + '.evalHistory / ' + prevGrade.period + ' ' + prevGrade.grade + '등급 ' + prevGrade.score,
                                 asof: '2025-12-31' };
    }
    return {
      hit: hit, facts: facts,
      notice: noticePhrase ? [['가중치 1순위 역량이 지난 기간과 달라졌어요', noticePhrase]] : [],
      ev: spec,
      th: { 'TH-직무전환-비교불가': (hist ? '1회' : '0회') }
    };
  };

  /* ================= 평가 실행 ================= */
  function byId(id) {
    var c = CAT();
    if (!c || !c.signals) return null;
    var s = c.signals, i;
    for (i = 0; i < s.length; i++) if (s[i].id === id) return s[i];
    return null;
  }
  function ctxFor(role) {
    var emp = subject(role);
    if (!emp) return null;
    var myObjs = objsOwnedBy(emp.emp_id);
    var myKrs = [];
    myObjs.forEach(function (o) { krsOfObj(o.objective_id).forEach(function (k) { myKrs.push(k); }); });
    var jp = jpOf(emp);
    return {
      role: roleKey(role), emp: emp, jp: jp, profile: compProfile(jp),
      myObjs: myObjs, myKrs: myKrs,
      myCks: arr('checkins').filter(function (c) { return c.emp_id === emp.emp_id; }),
      scope: upperScope(emp)
    };
  }
  function invalidate() {
    var k = asof() + '|' + roleKey() + '|' + arr('objectives').length + '|' + arr('keyResults').length;
    if (k !== cacheKey) { cacheKey = k; cacheEval = {}; cacheCo = null; cacheScope = {}; }
  }

  /* evaluate — {hit, facts, evidence, thresholds, asof, ready} */
  function evaluate(id, role) {
    invalidate();
    var A = asof(), sig = byId(id);
    if (!sig) return { hit: false, ready: false, facts: {}, evidence: [], thresholds: [], asof: A };
    var rk = roleKey(role);
    var ck = id + '|' + rk + '|' + A;
    if (cacheEval[ck]) return cacheEval[ck];
    var out;
    /* 20-4차 — 점화 판정을 카탈로그 `now` 에서 **EVAL 구현 유무**로 옮겼다.
       원천 데이터를 채우고 EVAL 을 붙이면 그 신호가 곧바로 실계산으로 넘어간다.
       카탈로그 `now` 는 문서(설계 시점의 판단)로 남고 판정에는 쓰지 않는다. */
    if (!EVAL[id]) {
      /* 열람 전용 — 카탈로그 예시값 전량을 (추정)으로 표시하고 처리 버튼은 카드가 잠근다 */
      out = { hit: false, ready: false, facts: {}, evidence: buildEvidence(sig, null),
              thresholds: buildThresholds(sig, null), asof: A, notice: sig.notice };
    } else {
      var ctx = ctxFor(rk);
      if (!ctx) {
        out = { hit: false, ready: false, facts: {}, evidence: buildEvidence(sig, null),
                thresholds: buildThresholds(sig, null), asof: A, notice: sig.notice };
      } else {
        var r;
        try { r = EVAL[id](ctx) || {}; } catch (e) { r = { hit: false, facts: { error: String(e && e.message || e) }, ev: {}, th: {} }; }
        out = {
          hit: !!r.hit, ready: true, facts: r.facts || {},
          notice: subst(sig.notice, r.notice),
          evidence: buildEvidence(sig, r.ev), thresholds: buildThresholds(sig, r.th),
          asof: A
        };
      }
    }
    cacheEval[ck] = out;
    return out;
  }

  /* inst — 카드가 그대로 그릴 수 있는 인스턴스 (카드는 계산하지 않는다) */
  function instance(id, role) {
    var sig = byId(id);
    if (!sig) return null;
    var ev = evaluate(id, role);
    var inst = copy(sig);
    inst.sig = sig;
    inst.notice = ev.notice || sig.notice;
    inst.evidence = ev.evidence;
    inst.thresholds = ev.thresholds;
    inst.facts = ev.facts;
    inst.hit = ev.hit;
    inst.ready = ev.ready;
    inst.asof = ev.asof;
    inst.role = roleKey(role);
    inst.scopeLabel = (sig.actor === '상위조직장') ? '상위 조직 관점' : '';
    inst.evBasic = ev.evidence.filter(function (e) { return e.show === '기본'; });
    inst.evRest = ev.evidence.filter(function (e) { return e.show !== '기본'; });
    inst.assumedN = ev.evidence.filter(function (e) { return e.assumed === 1; }).length;
    inst.state = readState(inst.role)[id] || null;
    return inst;
  }

  /* ================= 목록 ================= */
  function forRole(role) {
    var c = CAT();
    if (!c || !c.signals) return [];
    var rk = roleKey(role);
    var out = c.signals.filter(function (s) {
      return s.roles && s.roles.indexOf(rk) >= 0;
    });
    out = out.slice().sort(function (a, b) {
      if ((a.actorNo || 0) !== (b.actorNo || 0)) return (a.actorNo || 0) - (b.actorNo || 0);
      if ((a.stageNo || 0) !== (b.stageNo || 0)) return (a.stageNo || 0) - (b.stageNo || 0);
      return (a.no || 0) - (b.no || 0);
    });
    return out;
  }
  function live(role) {
    var rk = roleKey(role);
    var out = [];
    forRole(rk).forEach(function (s) {
      if (!EVAL[s.id]) return;         /* 실계산되는 것만 — 카탈로그 `now` 는 보지 않는다 (20-4차) */
      var inst = instance(s.id, rk);
      if (inst && inst.hit) out.push(inst);
    });
    /* 수신 순서 = 구성원 → 팀장 → 상위 조직장 → HR·경영진 (§1) */
    out.sort(function (a, b) {
      if ((a.actorNo || 0) !== (b.actorNo || 0)) return (a.actorNo || 0) - (b.actorNo || 0);
      return (a.stageNo || 0) - (b.stageNo || 0);
    });
    return out;
  }
  function pending(role) {
    var rk = roleKey(role), st = readState(rk), now = Date.now();
    return live(rk).filter(function (i) {
      var r = st[i.id];
      if (!r) return true;
      if (r.st === 'acted' || r.st === 'dismissed') return false;
      if (r.st === 'snoozed') return !(r.until && Date.parse(r.until) > now);
      return true;
    });
  }

  /* ================= 상태 ================= */
  function stateKey(role) {
    var e = subject(role);
    return LS_PREFIX + ((e && e.emp_id) || 'EMP-0000');
  }
  function readState(role) {
    var k = stateKey(role);
    try {
      var raw = localStorage.getItem(k);
      if (raw) {
        var o = JSON.parse(raw);
        if (o && typeof o === 'object') return o;
      }
      return {};
    } catch (e) { return memState[k] || {}; }
  }
  function writeState(role, obj) {
    var k = stateKey(role);
    memState[k] = obj;
    try { localStorage.setItem(k, JSON.stringify(obj)); } catch (e) {}
  }
  function setRec(id, rec, role) {
    var st = readState(role);
    st[id] = rec;
    writeState(role, st);
    emit({ id: id, rec: rec });
  }
  function state(role) { return readState(role); }
  function reset(role) { writeState(role, {}); emit({ id: null, rec: null }); }

  /* mute.repeat("7일"·"14일"·"재알림 없음(1회)") → 일수. 재알림 없음이면 사실상 영구 */
  function repeatDays(sig) {
    var r = (sig && sig.mute && sig.mute.repeat) || '';
    if (/재알림\s*없음/.test(r)) return 3650;
    var n = num(r);
    if (n > 0) return n;
    return (sig && sig.level === '심화') ? 14 : 7;     /* 출발값 = 기초 7일 / 심화 14일 (§1) */
  }

  function resolve(id, how, actionType) {
    var sig = byId(id);
    if (!sig) return null;
    var st = (how === 'dismissed') ? 'dismissed' : 'acted';
    var rec = { st: st, at: nowIso() };
    setRec(id, rec);
    var at = actionType || (st === 'acted' ? firstActType(sig) : 'dismissed');
    dispatchCtx(sig, st, at);
    return rec;
  }
  function snooze(id) {
    var sig = byId(id);
    if (!sig) return null;
    var d = repeatDays(sig);
    var rec = { st: 'snoozed', at: nowIso(), until: new Date(Date.now() + d * 86400000).toISOString() };
    setRec(id, rec);
    return rec;
  }
  function firstActType(sig) {
    var a = (sig.actions || []).slice().sort(function (x, y) { return (x.rank || 9) - (y.rank || 9); });
    var i;
    for (i = 0; i < a.length; i++) if (a[i].type && a[i].type !== 'A5') return a[i].type;
    return (a[0] && a[0].type) || 'A5';
  }
  /* 처리 기록 1건 → 맥락 원장(EZLedger)이 ez:ctx 를 받는다.
     payload 규약은 tx_1on1.js:945 · tx_inbox.js:347 과 같은 {type,source,title,summary,weight} */
  function dispatchCtx(sig, st, actionType) {
    var d = null;
    try { d = document; } catch (e) { d = null; }
    if (!d || !d.dispatchEvent || typeof CustomEvent !== 'function') return;
    /* 원장에는 실측이 치환된 알림 문구를 남긴다 — 카탈로그 예시 숫자를 기록에 흘리지 않는다 */
    var live1 = null;
    try { live1 = instance(sig.id); } catch (e0) { live1 = null; }
    var notice = (live1 && live1.notice) || sig.notice;
    var doneT = (st === 'acted') ? ((sig.done && sig.done.title) || notice) : cut(notice, 40);
    var label = (st === 'acted')
      ? ((CAT() && CAT().actionLabel && CAT().actionLabel[actionType]) || actionType)
      : '해제';
    try {
      d.dispatchEvent(new CustomEvent('ez:ctx', {
        detail: {
          type: STAGE_CTX[sig.stage] || 'org',
          source: 'signal.' + sig.id + '.' + actionType,
          title: (st === 'acted' ? '처리 · ' : '해제 · ') + doneT,
          summary: sig.stage + ' · ' + (sig.typeLabel || sig.type) + ' 알림 — ' + cut(notice, 60)
            + ' · 처리 ' + label + ' · 기준 ' + asof(),
          weight: (sig.level === '심화') ? 3 : 2
        }
      }));
    } catch (e) {}
  }

  function onChange(fn) {
    if (typeof fn !== 'function') return function () {};
    subs.push(fn);
    return function () {
      var i = subs.indexOf(fn);
      if (i >= 0) subs.splice(i, 1);
    };
  }
  function emit(detail) {
    var i;
    for (i = 0; i < subs.length; i++) {
      try { subs[i](detail); } catch (e) {}
    }
    try {
      if (typeof document !== 'undefined' && document.dispatchEvent && typeof CustomEvent === 'function') {
        document.dispatchEvent(new CustomEvent('ez:signal-change', { detail: detail || {} }));
      }
    } catch (e2) {}
  }

  /* ================= AI 프롬프트 (18-2차 R4 — 대화체 계약) =================
     카드가 폐기됐으므로 프롬프트도 「표 채우기」가 아니라 「말 걸기」다.
     · 분류 이름(유형·단계·처리)·코드·필드 이름·기록 번호는 한 글자도 싣지 않는다
     · 실측 근거는 사람 말로만 싣고, 출처는 물어볼 때만 밝히도록 지시한다
     문구 정제는 `EZSignalChat.scrub`이 단일 원천이고, 그 모듈이 없을 때만
     아래 최소 정제기가 대신 돈다(노드 검증·부분 로딩 대비). */
  var MIN_TABLE = {
    objectives: '목표', keyResults: '핵심결과', checkins: '체크인', employees: '구성원',
    orgs: '조직', jobs: '직무', jobProfiles: '직무 프로파일', competencies: '역량',
    strategyThemes: '전략 테마', feedbackHistory: '피드백 이력', evalHistory: '평가 이력',
    evaluations: '평가 기록', peerReviews: '동료 리뷰', attendance: '근태 기록',
    payroll: '급여 기록', leaves: '휴가 기록', period: '기간'
  };
  var MIN_ABBR = { OBJ: '목표', KR: '핵심결과', EMP: '구성원', ORG: '조직', CHK: '체크인', TH: '기준', FB: '피드백' };
  function minScrub(text) {
    var s = String(text == null ? '' : text), k;
    if (!s) return '';
    s = s.replace(/FY(\d{4})[-\s]?([1-4])Q/g, '$1년 $2분기');
    s = s.replace(/ORG-\d+\s*\(([^)]{1,40})\)/g, '$1');
    s = s.replace(/([A-Za-z][A-Za-z0-9]*(?:-[0-9A-Za-z가-힣]+)*)\.([A-Za-z_][A-Za-z0-9_]*)/g,
      function (all, pfx) { return (MIN_TABLE[pfx] || '') + ' 기록'; });
    s = s.replace(/(?:EMP|ORG|OBJ|KR)-[0-9A-Za-z_]+(?:-[0-9A-Za-z_]+)*/g, '');
    s = s.replace(/JOB-[^\s\/,)\]·]+/g, '').replace(/TH-[^\s\/,)\]·]+/g, '');
    s = s.replace(/(?:FB|CHK|EV|PR)-[0-9A-Za-z_-]+/g, '');
    s = s.replace(/\b(OBJ|KR|EMP|ORG|CHK|TH|FB)\b/g, function (t) { return MIN_ABBR[t] || ''; });
    for (k in MIN_TABLE) if (has(MIN_TABLE, k)) s = s.replace(new RegExp('\\b' + k + '\\b', 'g'), MIN_TABLE[k]);
    s = s.replace(/기한 도래|작성 공백|기준 이탈|연결 불일치|상황 변동/g, '살펴볼 점');
    s = s.replace(/새로 쓰기|내가 고치기|알려주기|1on1 잡기|상세 보기|승인 요청/g, '이어서 할 일');
    s = s.replace(/\bT[1-5]\b/g, '').replace(/\bA[1-6]\b/g, '');
    s = s.replace(/[\[(【]\s*(?:사실|비교|추이|연결|이력|범위)\s*[\])】]/g, '');
    s = s.replace(/\(\s*\)/g, '').replace(/「\s*」/g, '');
    if (/[·\/]/.test(s)) {
      var parts = s.split(/\s*[·\/]\s*/), keep = [], i, p;
      for (i = 0; i < parts.length; i++) {
        p = parts[i].replace(/^\s+|\s+$/g, '');
        if (p && p !== '-') keep.push(p);
      }
      s = keep.join(' · ');
    }
    return s.replace(/\s{2,}/g, ' ').replace(/^\s+|\s+$/g, '');
  }
  function sane(text) {
    try {
      if (window.EZSignalChat && typeof EZSignalChat.scrub === 'function') return EZSignalChat.scrub(text);
    } catch (e) {}
    return minScrub(text);
  }

  function prompt(inst) {
    if (!inst) return '';
    if (typeof inst === 'string') inst = instance(inst);
    if (!inst) return '';
    /* 대화 모듈이 있으면 그쪽이 단일 원천 — 질문 + 보이지 않는 참고 자료 */
    try {
      if (window.EZSignalChat && typeof EZSignalChat.promptFor === 'function') {
        var viaChat = EZSignalChat.promptFor(inst);
        if (viaChat) return viaChat.length > 1600 ? viaChat.slice(0, 1597) + '…' : viaChat;
      }
    } catch (e0) {}

    var L = [], i;
    L.push('[사용자에게 건넬 이야기] ' + sane(inst.notice));
    L.push('[기준 시점] ' + inst.asof);
    var ev = (inst.evidence || []).filter(function (e) { return e.show === '기본' || e.show === '접힘'; });
    if (!ev.length) ev = (inst.evidence || []).slice(0, 4);
    var sure = [], soft = [];
    ev.slice(0, 5).forEach(function (e) {
      var t = sane(cut(e.text, 120));
      if (!t) return;
      if (e.assumed === 1) soft.push(t); else sure.push(t);
    });
    if (sure.length) {
      L.push('[실제로 세어 본 것]');
      for (i = 0; i < sure.length; i++) L.push('- ' + sure[i]);
    }
    if (soft.length) {
      L.push('[아직 확인되지 않아 잠정으로 둔 것]');
      for (i = 0; i < soft.length; i++) L.push('- ' + soft[i]);
    }
    if (inst.thresholds && inst.thresholds.length) {
      var th = [];
      inst.thresholds.slice(0, 2).forEach(function (t) {
        var nm = sane(t.name);
        if (!nm) return;
        th.push(nm + ' — 회사가 보는 잠정 기준 ' + sane(t.value) + (t.actual ? ', 지금 측정값 ' + sane(t.actual) : ''));
      });
      if (th.length) L.push('[견줘 본 기준] ' + th.join(' / '));
    }
    var srcs = [], seen = {};
    (inst.evidence || []).forEach(function (e) {
      var s = sane(cut(e.src, 40));
      if (!s || s.length < 2 || seen[s] || srcs.length >= 3) return;
      seen[s] = 1; srcs.push(s);
    });
    if (srcs.length) L.push('[살펴본 자료 — 사용자가 물을 때만 사람 말로 밝히세요] ' + srcs.join(' · '));
    var acts = (inst.actions || []).slice().sort(function (a, b) { return (a.rank || 9) - (b.rank || 9); });
    var act = null;
    for (i = 0; i < acts.length; i++) if (acts[i].type !== 'A5') { act = acts[i]; break; }
    if (!act) act = acts[0] || null;
    if (act && act.draft) L.push('[이어서 도울 수 있는 일] ' + sane(cut(String(act.draft).split('\n')[0], 160)));
    if (!inst.ready) L.push('[주의] 이 주제는 실제 값을 다 세지 못했습니다. 단정하지 말고 무엇을 더 채워야 하는지만 말하세요.');
    L.push('[답변 방식 — 반드시 지켜 주세요]');
    L.push('1. 옆자리 동료에게 말하듯 해요체로 3~6문장만 씁니다. 표, 글머리기호, 굵은 글씨 나열은 쓰지 않습니다.');
    L.push('2. 숫자는 문장 안에 녹여 씁니다. 근거를 줄 단위로 늘어놓지 않습니다.');
    L.push('3. 내부 분류 이름, 영문 표 이름, 점 찍힌 데이터 경로, 코드처럼 보이는 기록 번호는 한 글자도 쓰지 않습니다.');
    L.push('4. 위에 적힌 값만 씁니다. 없는 숫자는 만들지 않고, 잠정이라고 적힌 값은 확정해 말하지 않습니다.');
    L.push('5. 마지막 문장은 사용자가 바로 이어받을 수 있는 짧은 제안이나 물음으로 맺습니다.');
    var out = L.join('\n');
    return out.length > 1600 ? out.slice(0, 1597) + '…' : out;
  }

  /* ================= 노출 ================= */
  window.EZSignalEngine = {
    catalog: function () { return CAT(); },
    forRole: forRole,
    live: live,
    pending: pending,
    evaluate: function (id, role) { return evaluate(id, role); },
    instance: instance,
    resolve: resolve,
    snooze: snooze,
    prompt: prompt,
    onChange: onChange,
    state: state,
    reset: reset,
    /* thvCache 도 함께 비운다 — 카탈로그 기준값이 갈리면 판정선도 다시 읽어야 한다 (20차) */
    flush: function () { cacheKey = null; cacheEval = {}; cacheCo = null; cacheScope = {}; thvCache = null; },
    /* 판정에 쓰는 기준값을 그대로 돌려준다 — 검사기가 카탈로그와 대조하는 용도 (20차).
       화면·프롬프트는 이 값을 쓰지 않는다(표시값은 evaluate 의 thresholds 에 있다). */
    thresholdOf: function (id, code, fallback) { return thv(id, code, fallback == null ? null : fallback); },
    asof: asof,
    subject: subject,
    role: function () { return roleKey(); },
    liveIds: function () {
      var c = CAT();
      if (!c || !c.signals) return [];
      return c.signals.filter(function (s) { return !!EVAL[s.id]; }).map(function (s) { return s.id; });
    },
    /* 이 신호를 지금 실계산할 수 있는가 — 화면·대화가 「예시」 표시를 가를 때 쓴다 */
    hasEval: function (id) { return !!EVAL[String(id)]; },
    /* 판정 함수를 밖에서 등록한다 (js/ez_signal_eval2.js 가 쓴다).
       같은 신호를 두 번 등록하면 나중 것이 이긴다 — 덮어쓰기를 막지 않는다. */
    registerEval: function (id, fn) {
      if (!id || typeof fn !== 'function') return false;
      EVAL[String(id)] = fn;
      cacheEval = {};
      return true;
    },
    /* EVAL 이 쓰는 계산 맥락 — 밖에서 등록한 판정 함수도 같은 맥락을 받는다 */
    ctx: function (role) { return ctxFor(roleKey(role)); },
    /* 밖에서 등록한 판정 함수가 쓰는 계산 도구 — 같은 값·같은 반올림 규칙을 쓰게 한다 */
    helpers: {
      num: num, r0: r0, r1: r1, pn: pn, avg: avg, cut: cut,
      arr: arr, data: D, thv: thv, asof: asof, dayShift: dayShift, asofMs: asofMs, co: co
    }
  };

  /* 기준 시점이 바뀌면 계산을 버린다 */
  try {
    if (window.EZKit && EZKit.clock && EZKit.clock.onChange) {
      EZKit.clock.onChange(function () { window.EZSignalEngine.flush(); emit({ id: null, rec: null }); });
    }
  } catch (e) {}
})();
