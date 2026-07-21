/* =====================================================================
 * tx_cleanup.js — talenx 목업 2차 하이드레이션(잔여 샘플/플레이스홀더 정리)
 * tx_hydrate.js 이후 실행. 남아있는 가짜 데이터(올인원컴퍼니 / 최인기·0026 /
 * 인사기획팀 1021(TEST) / 인기있는 인기 / 가짜 조직트리)를
 * window.TALENX_DATA 실데이터로 교체한다.
 *
 * 규칙: index.html 수정 없음. CSS/클래스/레이아웃 변경 없음.
 *       기존 마크업/클래스만 그대로 재사용해 텍스트 교체 + 행 재구성.
 *       멱등(재실행 안전). DOM 준비 후 1회 자동 실행. window.TXCleanup={run}.
 * 로그인 사용자 = meta.currentUser (EMP-0078 최정남 / Package BG / ORG-010).
 * ===================================================================== */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function q(root, sel) { return root ? root.querySelector(sel) : null; }
  function qa(root, sel) { return root ? Array.prototype.slice.call(root.querySelectorAll(sel)) : []; }
  function dot(ds) { return String(ds || '').replace(/-/g, '.'); }
  function empNoOf(id) { var m = String(id || '').match(/(\d+)\s*$/); return m ? m[1] : '0000'; }
  function styleHas(el, s) { return el && (el.getAttribute('style') || '').indexOf(s) >= 0; }

  var done = false;

  function run() {
    var D = window.TALENX_DATA;
    if (!D || !document.body) return;

    var CU = (D.meta && D.meta.currentUser) || {};
    var EMPS = D.employees || [];
    var ORGS = D.orgs || [];
    var COMPANY_LABEL = 'HCG'; // 짧은 회사 라벨(breadcrumb/label 용)

    var orgById = {};
    ORGS.forEach(function (o) { orgById[o.org_id] = o; });

    var EMPNO = empNoOf(CU.emp_id);                    // "0078"
    var NAME = CU.name || '최정남';
    var ORGN = CU.orgName || 'Package BG';
    var ROLE = CU.is_leader ? '팀장' : '팀원';
    var LVL = CU.level_kr || '사원';
    var JOIN = dot(CU.join_date);                      // "2016.04.30"
    var MGR = CU.managerName || '-';
    var EMAIL = 'emp' + EMPNO + '@hcg.co.kr';          // "emp0078@hcg.co.kr"
    var TOTAL = (D.company && D.company.employee_count) || EMPS.length;

    /* 조직 org_id → 루트→리프 이름 배열(HCG 접두). breadcrumb 용. */
    function realPath(orgId) {
      var out = [], o = orgById[orgId], g = 0;
      while (o && g++ < 20) { out.unshift(o.name); o = o.parent_id ? orgById[o.parent_id] : null; }
      out.unshift(COMPANY_LABEL);
      return out;
    }
    function pathStr(orgId) { return realPath(orgId).join(' > '); }

    function safe(fn) { try { fn(); } catch (e) { /* keep the rest alive */ } }

    /* --- 텍스트 노드 토큰 치환 (script/style/elizax 패널 제외) --- */
    function applyPairs(root, pairs) {
      if (!root || !pairs.length) return;
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          var p = n.parentNode, stop = root.parentNode;
          while (p && p !== stop) {
            if (p.nodeType === 1) {
              var tag = p.tagName;
              if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
              if (p.id === 'tx-overlay-root') return NodeFilter.FILTER_REJECT;
              var cn = (typeof p.className === 'string') ? p.className : '';
              if (cn.indexOf('ezx-') >= 0) return NodeFilter.FILTER_REJECT;
            }
            p = p.parentNode;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      var nodes = [], nd;
      while ((nd = walker.nextNode())) nodes.push(nd);
      nodes.forEach(function (n) {
        var v = n.nodeValue, orig = v;
        for (var i = 0; i < pairs.length; i++) {
          if (v.indexOf(pairs[i][0]) >= 0) v = v.split(pairs[i][0]).join(pairs[i][1]);
        }
        if (v !== orig) n.nodeValue = v;
      });
    }

    var homeRoot = document.getElementById('s-home');
    var payRoot = document.getElementById('s-pay');
    var attRoot = document.getElementById('s-att');
    var hrmRoot = document.getElementById('s-hrm');
    var wfRoot = document.getElementById('s-wf');

    /* ============================================================
     * 1) HOME 근무 현황 미니 리스트 (6 rows)
     * ============================================================ */
    safe(function () {
      if (!homeRoot) return;
      var sect = qa(homeRoot, '.sect-h').filter(function (h) {
        return /근무\s*현황/.test(h.textContent || '');
      })[0];
      var wcard = sect ? sect.parentElement : null;
      if (!wcard) return;
      var inOrg = EMPS.filter(function (e) { return e.org_id === CU.org_id; });
      var others = EMPS.filter(function (e) { return e.org_id !== CU.org_id; });
      var pick = inOrg.concat(others).slice(0, 6);
      if (!pick.length) return;
      var html = pick.map(function (e) {
        var nm = e.name || '';
        return '<div class="mrow"><span class="ava">' + esc(nm.charAt(0)) + '</span>' +
          '<div><div class="mn">' + esc(nm) + '</div>' +
          '<div class="mo">' + esc(e.orgName || '') + '</div></div></div>';
      }).join('');
      qa(wcard, '.mrow').forEach(function (r) { r.remove(); });
      var anchor = q(wcard, '.selectbar');
      if (anchor) anchor.insertAdjacentHTML('afterend', html);
      else wcard.insertAdjacentHTML('beforeend', html);
    });

    /* ============================================================
     * 2a) PAY 프로필 헤더(내급여 + 연말정산) — 페르소나 정규화
     * ============================================================ */
    safe(function () {
      if (!payRoot) return;
      qa(payRoot, '.card').forEach(function (card) {
        var spans = qa(card, 'span');
        var nameSpan = spans.filter(function (s) { return styleHas(s, 'font-size:24px'); })[0];
        if (!nameSpan) return; // 프로필 헤더 카드가 아님
        nameSpan.textContent = NAME;
        // 사번 badge (4자리 숫자)
        qa(card, 'span.badge').forEach(function (b) {
          if (/^\d{3,4}$/.test((b.textContent || '').trim())) b.textContent = EMPNO;
        });
        // breadcrumb (font-size:15px + font-weight:700)
        var bc = spans.filter(function (s) {
          return styleHas(s, 'font-size:15px') && styleHas(s, 'font-weight:700');
        })[0];
        if (bc) bc.textContent = pathStr(CU.org_id);
        // 직급/직책 · 입사일 · 관리자
        spans.forEach(function (s) {
          var lab = q(s, 'span'), b = q(s, 'b');
          if (!lab || !b) return;
          var lt = (lab.textContent || '').trim();
          if (lt.indexOf('직급') === 0) b.textContent = LVL + '/' + ROLE;
          else if (lt.indexOf('입사일') === 0) b.textContent = JOIN;
          else if (lt.indexOf('관리자') === 0) b.textContent = MGR;
        });
      });
    });

    /* ============================================================
     * 2b) HRM 프로필 헤더 (.prof)
     * ============================================================ */
    safe(function () {
      var prof = q(hrmRoot, '.prof');
      if (!prof) return;
      var pn = q(prof, '.pname'); if (pn) pn.textContent = NAME;
      var pnum = q(prof, '.pnum'); if (pnum) pnum.textContent = EMPNO;
      qa(prof, '.pmeta .pm').forEach(function (pm) {
        var k = q(pm, '.pk'), v = q(pm, '.pv'); if (!k || !v) return;
        var key = (k.textContent || '').trim();
        if (key.indexOf('직급') === 0) v.textContent = LVL + '/팀원';
        else if (key.indexOf('입사일') === 0) v.textContent = JOIN;
        else if (key.indexOf('관리자') === 0) v.textContent = MGR;
      });
      var porg = q(prof, '.porg'); if (porg) porg.textContent = pathStr(CU.org_id);
    });

    /* ============================================================
     * 3) HRM 인사정보 KV rows
     * ============================================================ */
    safe(function () {
      var scope = q(hrmRoot, '.htab-content');
      if (!scope) return;
      qa(scope, '.kv').forEach(function (kv) {
        var k = q(kv, '.kvk'), v = q(kv, '.kvv'); if (!k || !v) return;
        var key = (k.textContent || '').trim();
        switch (key) {
          case '사번': v.textContent = EMPNO; break;
          case '입사일':
          case '그룹 입사일':
          case '계약 시작일': v.textContent = JOIN; break;
          case '계약 만료일': v.textContent = '-'; break;
          case '회사이메일': v.textContent = EMAIL; break;
          case '근무위치': v.textContent = '서울'; break;
          case '별명': v.textContent = '-'; break;
          case '회사': v.textContent = COMPANY_LABEL; break;
          case '조직': v.textContent = ORGN; break;
          case '직책': v.textContent = ROLE; break;
          case '직급': v.textContent = LVL; break;
          case '직위': v.textContent = LVL; break;
        }
      });
    });

    /* ============================================================
     * 4) HRM 발령이력 타임라인 (.apt .adesc) — 선행 조직 텍스트만 교체
     * ============================================================ */
    safe(function () {
      if (!hrmRoot) return;
      qa(hrmRoot, '.apt .abody .adesc').forEach(function (ad) {
        var first = ad.firstChild;
        if (first && first.nodeType === 3) {
          first.nodeValue = COMPANY_LABEL + ' · ' + ORGN + ' ';
        }
      });
    });

    /* ============================================================
     * 5) ATT 근무관리 구성원 행 (.gmember) — 실사원으로 재구성
     * ============================================================ */
    safe(function () {
      if (!attRoot || !EMPS.length) return;
      qa(attRoot, '.gmember').forEach(function (m, i) {
        var e = EMPS[i % EMPS.length];
        var nm = q(m, '.nm'), org = q(m, '.org');
        if (nm) nm.textContent = e.name || '';
        if (org) org.textContent = e.orgName || '';
      });
    });

    /* ============================================================
     * 6) HRM 조직도 (.org-tree) — 실 orgs 트리로 재구성
     * ============================================================ */
    safe(function () {
      var tree = q(hrmRoot, '.org-tree');
      if (!tree || !ORGS.length) return;
      var childrenOf = {};
      ORGS.forEach(function (o) {
        var pid = o.parent_id || '__root__';
        (childrenOf[pid] = childrenOf[pid] || []).push(o);
      });
      var order = [];
      (function dfs(list) {
        (list || []).forEach(function (o) {
          order.push(o);
          dfs(childrenOf[o.org_id]);
        });
      })(childrenOf['__root__']);

      function node(pad, tw, name, cnt, extra) {
        var style = pad > 0 ? ' style="padding-left:' + pad + 'px"' : '';
        return '<div class="org-node' + (extra || '') + '"' + style + '>' +
          '<span class="tw">' + tw + '</span>' +
          '<span class="nm">' + esc(name) + '</span> ' +
          '<span class="cnt">(' + cnt + ')</span></div>';
      }

      var html = node(0, '⊖', COMPANY_LABEL, TOTAL, '');
      order.slice(0, 39).forEach(function (o) {
        var pad = ((o.level || 1) - 1) * 22;
        var hasChildren = !!childrenOf[o.org_id];
        var tw = hasChildren ? '⊖' : '';
        var extra = (o.org_id === CU.org_id) ? ' sel' : '';
        html += node(pad, tw, o.name, (o.headcount != null ? o.headcount : 0), extra);
      });
      tree.innerHTML = html;
    });

    /* ============================================================
     * 7) HRM 인원 현황 — 라벨 재작성 제거
     *   tx_hydrate.js(8)가 이미 막대/피벗/x축 라벨을 동일한 그룹 집계에서
     *   자기일관되게 생성함. 과거 여기서 다른 조직셋(레벨2 slice)+org.headcount로
     *   라벨만 덮어써 "숫자≠라벨" 모순을 만들었으므로 override 삭제.
     * ============================================================ */

    /* ============================================================
     * 8) WF 승인/결재 — 가짜 조직 텍스트 sweep (#s-wf 범위)
     * ============================================================ */
    var ORG_PAIRS = [
      ['인사기획팀 1021(TEST)', ORGN],
      ['인사기획팀 1021 변경', ORGN],
      ['인사기획팀 1021', ORGN],
      ['올인원그룹(테스트)', COMPANY_LABEL],
      ['올인원컴퍼니', COMPANY_LABEL],
      ['올인원제조', COMPANY_LABEL],
      ['올인원테크', COMPANY_LABEL],
      ['올인원뱅크', COMPANY_LABEL],
      ['SH컴퍼니', COMPANY_LABEL],
      ['firstCompany', COMPANY_LABEL],
      ['최인기', NAME],
      ['인기있는 인기', '-'],
      ['inkichoi@allinone.com', EMAIL]
    ];
    safe(function () {
      // 특정 토큰(위) 처리 후, 남은 순수 "인사기획팀"도 조직명으로 교체
      applyPairs(wfRoot, ORG_PAIRS.concat([['인사기획팀', ORGN]]));
    });

    /* ============================================================
     * 9) 전역 안전 sweep — 남은 리터럴 정리 (script/style/elizax 제외)
     * ============================================================ */
    safe(function () {
      applyPairs(document.body, ORG_PAIRS);
    });

    if (document.body) document.body.setAttribute('data-txc', '1');
  }

  function boot() { if (done) return; done = true; run(); }

  window.TXCleanup = { run: function () { done = false; boot(); } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
