/* tx_fix_hrm.js — 인사관리(HRM) fidelity 고도화 (2026-07-15)
   Runtime patch: upgrades the 인사관리 menu of the talenx mockup to match real
   talenx for the HCG dataset (currentUser EMP-0078 최정남 / Package BG / 사원).
   - Distinct content for all 12 사용자정보 tabs (was 1 shared placeholder)
   - 발령이력 rebuilt from HCG org path (removes hardcoded 올인원/1021 TEST rows)
   - 구성원정보: real org tree + selected-team roster, 조직장 badge only for leaders
   - 인원현황: normalized pivot/legend (임원/정규직/계약직), default 재직, working 추이 view
   - initial-circle avatars everywhere (66px profile / 32px roster)
   - 인재검색: company chip preselected + wired buttons (real filter)
   Scoped to #s-hrm / .txf-*. No index.html edits. Idempotent. Zero deps. */
(function () {
  'use strict';
  var F = window.TXFIX, TX = window.TX;
  if (!F || !F.ready) return;

  F.ready(function () {
    var root = document.getElementById('s-hrm');
    if (!root || root.dataset.txfHrm) return;
    root.dataset.txfHrm = '1';

    var D = F.D || {}, CU = F.CU || {};
    var esc = (TX && TX.esc) ? TX.esc : function (s) { return String(s == null ? '' : s); };
    var toast = (TX && TX.toast) ? TX.toast : function (m) { /* no-op */ };

    /* ---------- indexes ---------- */
    var orgById = {}, kidsOf = {}, directMembers = {};
    (D.orgs || []).forEach(function (o) { orgById[o.org_id] = o; });
    (D.orgs || []).forEach(function (o) { var p = o.parent_id || '__root'; (kidsOf[p] = kidsOf[p] || []).push(o); });
    (D.employees || []).forEach(function (e) { (directMembers[e.org_id] = directMembers[e.org_id] || []).push(e); });

    function empNo(id) { return (id || '').replace(/^EMP-?/, '') || '----'; }
    function orgName(id) { return (orgById[id] && orgById[id].name) || ''; }
    function orgPathNames(id) {
      var out = [], o = orgById[id];
      while (o) { out.unshift(o.name); o = o.parent_id ? orgById[o.parent_id] : null; }
      return out;
    }
    function orgPathStr(id) {
      var n = orgPathNames(id).slice();
      if (n.length && (n[0] === 'CEO' || n[0] === 'ORG-001')) n.shift();
      return ['HCG'].concat(n).join(' > ');
    }
    var GRADE_RANK = { '사장': 9, '부사장': 8, '상무': 7, '이사': 6, '부장': 5, '차장': 4, '과장': 3, '대리': 2, '사원': 1 };
    function jikwi(lv) {
      if (/사장|부사장|상무|이사/.test(lv || '')) return '임원';
      if (/부장|차장/.test(lv || '')) return '책임매니저';
      if (/과장|대리/.test(lv || '')) return '선임매니저';
      return '매니저';
    }
    function jikchaek(e) { return e.is_leader ? '팀장' : '팀원'; }

    /* ================================================================
       STYLE
    ================================================================ */
    var st = document.createElement('style');
    st.id = 'txf-hrm-style';
    st.textContent = [
      '#s-hrm .txf-edit,#s-hrm .txf-issue{display:inline-flex;align-items:center;gap:6px;background:var(--card);border:1px solid var(--line);color:var(--ink);font-size:12.5px;font-weight:700;padding:6px 13px;border-radius:7px;cursor:pointer}',
      '#s-hrm .txf-edit:hover,#s-hrm .txf-issue:hover{background:var(--soft)}',
      '#s-hrm .txf-issue{border-color:var(--blue);color:var(--blue)}',
      '#s-hrm .txf-empty{padding:44px 16px;text-align:center;color:var(--ink-3);font-size:13.5px}',
      '#s-hrm .txf-sub{font-size:12.5px;color:var(--ink-3);font-weight:500;margin:-2px 0 12px}',
      '#s-hrm .txf-acc .txf-acc-b{display:none;margin-top:10px;padding:12px 14px;background:var(--soft);border-radius:8px;font-size:13px;color:var(--ink-2);line-height:1.65}',
      '#s-hrm .txf-acc.open .txf-acc-b{display:block}',
      '#s-hrm .txf-exp,#s-hrm .apt .aexp{cursor:pointer;user-select:none}',
      '#s-hrm .txf-acc.open .txf-exp .car{transform:rotate(180deg)}',
      '#s-hrm .txf-exp .car{display:inline-block;transition:transform .15s}',
      '#s-hrm .txf-badge{display:inline-flex;align-items:center;border:1px solid var(--line);background:var(--soft);color:var(--ink-2);font-size:11px;font-weight:700;padding:2px 8px;border-radius:5px;margin-left:8px}',
      '#s-hrm .txf-evr{display:flex;align-items:flex-start;padding:16px 4px;border-bottom:1px solid var(--line-2)}',
      '#s-hrm .txf-evr:last-child{border-bottom:0}',
      '#s-hrm .txf-evr .yr{width:120px;flex:none;font-size:14px;font-weight:800;color:var(--ink)}',
      '#s-hrm .txf-evr .bd{flex:1;min-width:0}',
      '#s-hrm .txf-evr .t1{font-size:14.5px;font-weight:800;color:var(--ink);display:flex;align-items:center;gap:2px;margin-bottom:3px}',
      '#s-hrm .txf-evr .dt{font-size:12.5px;color:var(--ink-3);font-weight:500}',
      '#s-hrm .txf-evr .rt{margin-left:14px;flex:none;display:flex;align-items:center;gap:14px}',
      '#s-hrm .txf-grade{display:inline-grid;place-items:center;min-width:22px;height:22px;padding:0 6px;border-radius:6px;font-size:12px;font-weight:800;color:#fff}',
      '#s-hrm .txf-grade.gA{background:#0E9F6E}#s-hrm .txf-grade.gB{background:var(--blue)}#s-hrm .txf-grade.gC{background:var(--orange)}#s-hrm .txf-grade.gD{background:var(--red)}',
      '#s-hrm .txf-score{font-size:13px;font-weight:700;color:var(--ink-2)}',
      '#s-hrm table.txf-tbl{width:100%;border-collapse:collapse;margin-top:4px}',
      '#s-hrm table.txf-tbl th{font-size:12.5px;font-weight:700;color:var(--ink-3);text-align:left;padding:11px 10px;border-bottom:1px solid var(--line)}',
      '#s-hrm table.txf-tbl td{font-size:13px;color:var(--ink);padding:12px 10px;border-bottom:1px solid var(--line-2)}',
      '#s-hrm table.txf-tbl tbody tr:hover{background:var(--soft)}',
      '#s-hrm .txf-reprint{color:var(--blue);font-weight:700;cursor:pointer}',
      '#s-hrm .txf-mini-pg{display:flex;align-items:center;justify-content:flex-end;gap:14px;padding:14px 6px 2px;font-size:12.5px;color:var(--ink-2)}',
      '#s-hrm .txf-mini-pg button{width:24px;height:24px;border:1px solid var(--line);background:var(--card);border-radius:6px;color:var(--ink-3);cursor:pointer}',
      '#s-hrm .txf-mrow{display:inline-flex;align-items:center;gap:8px}',
      '#s-hrm .txf-onode .tw{cursor:pointer}',
      '#s-hrm .txf-trend-x{display:flex;justify-content:space-around;margin-top:8px;padding:0 30px}',
      '#s-hrm .txf-trend-x span{font-size:11.5px;color:var(--ink-2);font-weight:600}',
      '#s-hrm .txf-trend svg{width:100%;height:250px;display:block}'
    ].join('\n');
    root.appendChild(st);

    /* ================================================================
       사용자 정보 — profile header
    ================================================================ */
    var p0 = root.querySelector('.subpage[data-p="0"]');
    var prof = p0 && p0.querySelector('.prof');
    if (prof) {
      prof.innerHTML =
        '<span class="pava" style="background:transparent;width:66px;height:66px">' + F.avatar(CU.name || '최정남', 66) + '</span>' +
        '<div class="pbody"><div class="ptop">' +
          '<div class="pline1"><span class="pname">' + esc(CU.name || '최정남') + '</span>' +
          '<span class="pnum">' + empNo(CU.emp_id) + '</span><span class="pstat">재직</span></div>' +
          '<div class="pmeta">' +
            '<span class="pm"><span class="pk">직급/직책</span><span class="pv">' + esc(CU.level_kr || '사원') + ' / ' + jikchaek(CU) + '</span></span>' +
            '<span class="pm"><span class="pk">입사일</span><span class="pv">' + (CU.join_date || '2016-04-30').replace(/-/g, '.') + '</span></span>' +
            '<span class="pm"><span class="pk">관리자</span><span class="pv">' + esc(CU.managerName || '홍예준') + '</span></span>' +
          '</div></div>' +
        '<div class="porg">' + esc(orgPathStr(CU.org_id || 'ORG-010')) + '</div></div>';
    }

    /* ---------- tab content ---------- */
    var htabContent = p0 && p0.querySelector('.htab-content');
    var htabPh = p0 && p0.querySelector('.htab-ph');

    function kv(k, v) { return '<div class="kv"><div class="kvk">' + k + '</div><div class="kvv">' + v + '</div></div>'; }
    function head(t, btn, act) { return '<h3 class="hcard-t">' + t + (btn ? '<span class="r"><button class="' + (act || 'txf-edit') + '">' + btn + '</button></span>' : '') + '</h3>'; }
    function emptyBox() { return '<div class="txf-empty">입력된 정보가 없습니다.</div>'; }
    var CAR = ' <span class="car">⌄</span>';

    function tab_인사정보() {
      var join = (CU.join_date || '2016-04-30').replace(/-/g, '.');
      var email = 'jn.choi@e-hcg.com';
      var apt = [
        ['2016.04.30', '입사', 'HCG 입사 · CPO / Package BG 서비스기획담당 배치',
          '입사구분: 신입 · 최초 배치 조직: Package BG · 직급: 사원 · 고용형태: 정규직'],
        ['2018.07.01', '직무이동', 'Package BG 내 서비스기획담당 직무 확정',
          '직무: 서비스기획담당 · 사유: 직무 재배치 · 조직 변동 없음'],
        ['2021.07.01', '조직개편', 'CPO 산하 Package BG 재편제',
          '개편 유형: 상위 조직 개편 · 소속 조직(Package BG) 유지 · 보고라인 변경'],
        ['2024.01.01', '처우조정', '연간 처우 조정 반영',
          '유형: 연봉 조정 · 직급/조직 변동 없음']
      ];
      var aptHtml = apt.map(function (a) {
        return '<div class="apt txf-acc"><div class="adate">' + a[0] + '</div>' +
          '<div class="abody"><div class="atitle">' + a[1] + '</div>' +
          '<div class="adesc">' + a[2] + '</div>' +
          '<div class="txf-acc-b">' + a[3] + '</div></div>' +
          '<div class="aexp txf-exp">펼치기' + CAR + '</div></div>';
      }).join('');
      return '<div class="htab-content">' +
        '<div class="hcard">' + head('직원정보') +
          kv('사번', empNo(CU.emp_id)) +
          kv('입사일', join) +
          kv('그룹 입사일', join) +
          kv('채용 구분', '신입') +
          kv('회사이메일', email) +
        '</div>' +
        '<div class="hcard">' + head('발령정보') +
          kv('회사', 'HCG') +
          kv('조직', esc(CU.orgName || 'Package BG')) +
          kv('직무', esc(CU.jobTitle || '서비스기획담당')) +
          kv('직책', jikchaek(CU)) +
          kv('직급', esc(CU.level_kr || '사원')) +
          kv('직위', jikwi(CU.level_kr)) +
          kv('직원 구분', '사무직') +
          kv('고용 형태', '정규직') +
          kv('재직 상태', '재직') +
          kv('휴직 유형', '휴직 아님') +
        '</div>' +
        '<div class="hcard">' + '<h3 class="hcard-t">발령이력 <span class="r"><button class="tl-btn">📈 발령이력 타임라인</button></span></h3>' +
          aptHtml +
        '</div>' +
      '</div>';
    }

    function tab_개인정보() {
      return '<div class="htab-content">' +
        '<div class="hcard">' + head('개인정보', '수정') +
          kv('이름', esc(CU.name || '최정남')) +
          kv('주민등록번호', '920415-2******') +
          kv('휴대전화번호', '010-4827-3391') +
          kv('성별', CU.gender === 'M' ? '남' : '여') +
          kv('법정생일', '1992.04.15') +
        '</div>' +
        '<div class="hcard">' + head('가족정보', '수정') + emptyBox() + '</div>' +
      '</div>';
    }

    function tab_학력경력() {
      var edu = '<div class="txf-acc"><div class="kv txf-exp" style="cursor:pointer">' +
        '<div class="kvk">2011.03 ~ 2015.02</div>' +
        '<div class="kvv" style="justify-content:space-between">한국대학교 · 경영학 (학사)<span class="txf-exp" style="color:var(--ink-3);font-weight:500;font-size:13px">펼치기' + CAR + '</span></div></div>' +
        '<div class="txf-acc-b">소재지: 서울 · 학위: 학사 · 졸업 · 전공: 경영학 / 부전공: 경제학</div></div>';
      return '<div class="htab-content">' +
        '<div class="hcard">' + head('학력정보', '수정') + edu + '</div>' +
        '<div class="hcard">' + head('경력정보', '수정') + emptyBox() +
          '<div class="txf-sub" style="margin:12px 0 0">신입 입사자로 등록된 이전 경력 정보가 없습니다.</div>' +
        '</div>' +
      '</div>';
    }

    function tab_자격어학() {
      var cert = [['정보처리기사', '2015.11', '한국산업인력공단'], ['컴퓨터활용능력 1급', '2014.06', '대한상공회의소'], ['ADsP(데이터분석 준전문가)', '2019.09', '한국데이터산업진흥원']];
      var lang = [['TOEIC', '900', '2023.05', 'ETS'], ['OPIc', 'IH', '2022.11', 'ACTFL']];
      var certRows = cert.map(function (c) { return '<tr><td>' + c[0] + '</td><td>' + c[1] + '</td><td>' + c[2] + '</td></tr>'; }).join('');
      var langRows = lang.map(function (l) { return '<tr><td>' + l[0] + '</td><td>' + l[1] + '</td><td>' + l[2] + '</td><td>' + l[3] + '</td></tr>'; }).join('');
      return '<div class="htab-content">' +
        '<div class="hcard">' + head('자격/면허', '수정') +
          '<table class="txf-tbl"><thead><tr><th>자격명</th><th>취득일</th><th>발급기관</th></tr></thead><tbody>' + certRows + '</tbody></table>' +
        '</div>' +
        '<div class="hcard">' + head('어학', '수정') +
          '<table class="txf-tbl"><thead><tr><th>시험명</th><th>점수/등급</th><th>취득일</th><th>주관기관</th></tr></thead><tbody>' + langRows + '</tbody></table>' +
        '</div>' +
      '</div>';
    }

    function tab_병역() {
      return '<div class="htab-content"><div class="hcard">' + head('병역사항', '수정') +
        kv('병역 대상 여부', '비대상') +
        kv('사유', '여성') +
        kv('군별 / 계급 / 복무기간', '<span class="cc">해당 없음</span>') +
      '</div></div>';
    }

    function tab_장애보훈() {
      return '<div class="htab-content">' +
        '<div class="hcard">' + head('장애정보', '수정') + emptyBox() + '</div>' +
        '<div class="hcard">' + head('보훈정보', '수정') + emptyBox() + '</div>' +
      '</div>';
    }

    function tab_포상징계() {
      var awards = [['우수사원 표창', '2023.12.20', '연간 성과 우수'], ['장기근속 포상 (5년)', '2021.04.30', '근속 5년']];
      var rows = awards.map(function (a) { return '<tr><td>' + a[0] + '</td><td>' + a[1] + '</td><td>' + a[2] + '</td></tr>'; }).join('');
      return '<div class="htab-content">' +
        '<div class="hcard">' + head('포상 내역') +
          '<table class="txf-tbl"><thead><tr><th>포상명</th><th>일자</th><th>사유</th></tr></thead><tbody>' + rows + '</tbody></table>' +
        '</div>' +
        '<div class="hcard">' + head('징계 내역') + emptyBox() + '</div>' +
      '</div>';
    }

    function tab_평가() {
      var evMain = (D.evaluations || []).filter(function (e) { return e.emp_id === CU.emp_id; })[0];
      var histRec = (D.evalHistory || []).filter(function (h) { return h.emp_id === CU.emp_id; })[0];
      var map = {};
      (histRec ? histRec.history : []).forEach(function (h) { map[h.period] = { grade: h.grade, score: h.score }; });
      if (evMain) map[evMain.period] = { grade: evMain.grade, score: evMain.weighted_score, comp: evMain.components, rat: evMain.rationale_summary };
      var years = Object.keys(map).map(function (p) { return parseInt(p.replace(/\D/g, ''), 10); }).sort(function (a, b) { return b - a; });
      if (!years.length) years = [2026, 2025, 2024];

      function gradeCls(g) { return 'g' + (g || 'B'); }
      function row(year, type, score, grade, body) {
        var rt = '<div class="rt">' +
          (grade ? '<span class="txf-grade ' + gradeCls(grade) + '">' + grade + '</span>' : '') +
          (score != null ? '<span class="txf-score">' + (Math.round(score * 10) / 10) + '점</span>' : '<span class="cc" style="color:var(--ink-4);font-size:12.5px">집계중</span>') +
          '<span class="txf-exp" style="color:var(--ink-3);font-weight:500;font-size:13px">펼치기' + CAR + '</span></div>';
        return '<div class="txf-evr txf-acc"><div class="yr">' + year + '년</div>' +
          '<div class="bd"><div class="t1">연말 평가 <span class="txf-badge">' + type + '</span></div>' +
          '<div class="dt">' + year + '.01.01 ~ ' + year + '.12.31</div>' +
          '<div class="txf-acc-b">' + body + '</div></div>' + rt + '</div>';
      }
      var html = '';
      years.forEach(function (y) {
        var m = map['FY' + y] || map[String(y)] || {};
        var comp = m.comp;
        var ach = comp ? comp.achievement_norm : null;
        var comp2 = comp ? Math.round((comp.peer_strength_norm + comp.exec_consistency_norm) / 2 * 10) / 10 : null;
        html += row(y, '종합', m.score, m.grade, m.rat ? esc(m.rat) : ('연말 종합 평가 결과입니다. 등급 ' + (m.grade || '-') + ' · 종합점수 ' + (m.score != null ? m.score : '-') + '점'));
        html += row(y, '역량', comp2, null, comp ? ('피어리뷰 ' + comp.peer_strength_norm + ' · 실행 일관성 ' + comp.exec_consistency_norm + ' → 역량 ' + comp2 + '점') : '역량 평가 상세는 해당 연도 마감 후 공개됩니다.');
        html += row(y, '업적', ach, null, comp ? ('목표 달성도 기준 업적 점수 ' + ach + '점') : '업적 평가 상세는 해당 연도 마감 후 공개됩니다.');
      });
      return '<div class="htab-content"><div class="hcard">' + head('평가정보') + html + '</div></div>';
    }

    function tab_노동조합() {
      return '<div class="htab-content"><div class="hcard">' + head('노동조합', '수정') +
        kv('가입 여부', '미가입') +
        kv('조합명', '<span class="cc">해당 없음</span>') +
        kv('가입일', '<span class="cc">-</span>') +
      '</div></div>';
    }

    function tab_교육() {
      var edu = [['신입사원 온보딩 과정', '2016.05.20', '16h', '집합'], ['개인정보보호 법정의무교육', '2025.03.11', '2h', '이러닝'], ['성과관리 실무 워크숍', '2024.09.05', '8h', '집합'], ['서비스 기획 심화', '2023.06.14', '12h', '이러닝']];
      var rows = edu.map(function (e) { return '<tr><td>' + e[0] + '</td><td>' + e[1] + '</td><td>' + e[2] + '</td><td>' + e[3] + '</td></tr>'; }).join('');
      return '<div class="htab-content"><div class="hcard">' + head('교육 이수내역') +
        '<table class="txf-tbl"><thead><tr><th>과정명</th><th>이수일</th><th>이수시간</th><th>구분</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '</div></div>';
    }

    function tab_급여() {
      return '<div class="htab-content"><div class="hcard">' + head('급여정보') +
        kv('급여 형태', '연봉제') +
        kv('지급 주기', '월 1회 (매월 25일)') +
        kv('지급 은행', '국민은행') +
        kv('지급 계좌', '1234-**-******') +
        kv('4대보험', '가입 (건강·국민·고용·산재)') +
        '<div class="txf-sub" style="margin:12px 0 0">상세 급여 명세는 급여관리 메뉴에서 확인할 수 있습니다.</div>' +
      '</div></div>';
    }

    function tab_인사신청() {
      var reqs = [['재직증명서 발급', '2026.06.22', '완료'], ['개인정보 변경 신청', '2026.02.10', '승인']];
      var rows = reqs.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>'; }).join('');
      return '<div class="htab-content"><div class="hcard">' +
        '<h3 class="hcard-t">인사신청 내역 <span class="r"><button class="txf-issue" data-msg="인사신청 화면으로 이동합니다.">＋ 신청하기</button></span></h3>' +
        '<table class="txf-tbl"><thead><tr><th>신청 유형</th><th>신청일</th><th>상태</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '</div></div>';
    }

    function issueCard(title, btnLabel, kind, rows) {
      var body = rows.map(function (r) {
        return '<tr><td style="width:50%">' + r[0] + '</td><td>' + r[1] + ' <span class="txf-reprint" data-msg="문서를 재출력합니다.">재출력</span></td></tr>';
      }).join('');
      return '<div class="hcard">' +
        '<h3 class="hcard-t">' + title + ' <span class="r"><button class="txf-issue" data-msg="' + kind + '을(를) 발급합니다.">' + btnLabel + '</button></span></h3>' +
        '<table class="txf-tbl"><thead><tr><th>발급 용도</th><th>발급 일자</th></tr></thead><tbody>' + body + '</tbody></table>' +
        '<div class="txf-mini-pg"><span>Rows per page: 10</span><span>1–' + rows.length + ' of ' + rows.length + '</span><span><button>‹</button><button>›</button></span></div>' +
      '</div>';
    }
    function tab_제증명() {
      return '<div class="htab-content">' +
        issueCard('재직증명서 발급 내역', '재직증명서 발급', '재직증명서', [['은행 제출용', '2026-06-22 14:33'], ['관공서 제출용', '2026-06-22 14:33'], ['은행 제출용', '2026-05-27 10:17']]) +
        issueCard('경력증명서 발급 내역', '경력증명서 발급', '경력증명서', [['은행 제출용', '2026-05-27 10:17']]) +
      '</div>';
    }

    var TAB_FN = {
      '인사정보': tab_인사정보, '개인정보': tab_개인정보, '학력/경력': tab_학력경력,
      '자격/어학': tab_자격어학, '병역': tab_병역, '장애/보훈': tab_장애보훈,
      '포상/징계': tab_포상징계, '평가': tab_평가, '노동조합': tab_노동조합,
      '교육': tab_교육, '급여': tab_급여, '인사신청': tab_인사신청, '제증명 발급': tab_제증명
    };

    function renderActiveTab() {
      if (!p0 || !htabContent) return;
      var on = p0.querySelector('.htab.on') || p0.querySelector('.htab');
      var name = on ? on.textContent.trim() : '인사정보';
      var fn = TAB_FN[name] || tab_인사정보;
      // replace the .htab-content node's inner html (keep the node as .htab-content)
      var wrapped = fn();
      // fn returns a full .htab-content wrapper; extract its innerHTML
      var tmp = document.createElement('div'); tmp.innerHTML = wrapped;
      var inner = tmp.querySelector('.htab-content');
      htabContent.innerHTML = inner ? inner.innerHTML : wrapped;
      htabContent.style.display = '';
      if (htabPh) htabPh.style.display = 'none';
    }
    renderActiveTab();

    /* ================================================================
       구성원 정보 — org tree + selected team roster
    ================================================================ */
    var p1 = root.querySelector('.subpage[data-p="1"]');
    var treeEl = p1 && p1.querySelector('.org-tree');
    var mmBody = root.querySelector('#mmBody');
    var mmCount = p1 && p1.querySelector('.mm-head .cntbig');
    var mmPath = p1 && p1.querySelector('.mm-head .path');
    var mmPager = p1 && p1.querySelector('.pager > span:nth-child(2)');
    var selOrg = CU.org_id || 'ORG-010';
    var expanded = {};

    function hasKids(id) { return !!(kidsOf[id] && kidsOf[id].length); }
    function nodeVisible(o) {
      var p = o.parent_id;
      while (p) { if (!expanded[p]) return false; p = orgById[p] ? orgById[p].parent_id : null; }
      return true;
    }
    function buildTree() {
      if (!treeEl) return;
      var html = '';
      function rec(o) {
        var pad = ((o.level || 1) - 1) * 18;
        html += '<div class="org-node txf-onode" data-org="' + o.org_id + '" style="padding-left:' + pad + 'px">' +
          '<span class="tw"></span><span class="nm">' + esc(o.name) + '</span> ' +
          '<span class="cnt">(' + (o.headcount != null ? o.headcount : (o.headcount_direct || 0)) + ')</span></div>';
        (kidsOf[o.org_id] || []).forEach(rec);
      }
      (kidsOf['__root'] || []).forEach(rec);
      treeEl.innerHTML = html;
    }
    function refreshTree() {
      if (!treeEl) return;
      treeEl.querySelectorAll('.txf-onode').forEach(function (n) {
        var id = n.getAttribute('data-org'), o = orgById[id];
        n.style.display = nodeVisible(o) ? '' : 'none';
        n.classList.toggle('sel', id === selOrg);
        var tw = n.querySelector('.tw');
        tw.textContent = hasKids(id) ? (expanded[id] ? '⊖' : '⊕') : '';
      });
    }
    function setDepth(n) {
      (D.orgs || []).forEach(function (o) { expanded[o.org_id] = hasKids(o.org_id) && (o.level || 1) < n; });
      refreshTree();
    }
    function renderRoster(orgId) {
      if (!mmBody) return;
      var list = (directMembers[orgId] || []).slice().sort(function (a, b) {
        if (a.is_leader !== b.is_leader) return a.is_leader ? -1 : 1;
        var r = (GRADE_RANK[b.level_kr] || 0) - (GRADE_RANK[a.level_kr] || 0);
        return r !== 0 ? r : (a.name < b.name ? -1 : 1);
      });
      var html = list.map(function (e, i) {
        var lead = e.is_leader ? '<span class="lead-b"><span class="vf">✓</span>조직장</span>' : '';
        return '<tr>' +
          '<td>' + (i + 1) + '</td>' +
          '<td><span class="txf-mrow">' + F.avatar(e.name, 32) + '<a class="mlink">' + esc(e.name) + '</a></span></td>' +
          '<td>' + esc(e.orgName || orgName(e.org_id)) + lead + '</td>' +
          '<td>' + empNo(e.emp_id) + '</td>' +
          '<td>' + jikchaek(e) + '</td>' +
          '<td>' + esc(e.level_kr || '-') + '</td>' +
          '<td>' + jikwi(e.level_kr) + '</td>' +
        '</tr>';
      }).join('');
      mmBody.innerHTML = html || '<tr><td colspan="7" style="text-align:center;color:var(--ink-3);padding:40px">해당 조직에 직접 소속된 구성원이 없습니다.</td></tr>';
      if (mmCount) mmCount.innerHTML = '전체 <b>' + list.length + '</b>';
      if (mmPath) mmPath.textContent = orgName(orgId);
      if (mmPager) mmPager.textContent = (list.length ? '1' : '0') + '–' + list.length + ' of ' + list.length;
    }
    if (treeEl) {
      buildTree();
      setDepth(3);               // show levels 1–3 (ORG-010 is lvl3), deeper via ⊕
      renderRoster(selOrg);
      // reflect default depth on the segment control (DOM ships with '1' active)
      var dsegs = root.querySelectorAll('.depth-seg button');
      dsegs.forEach(function (b) { b.classList.toggle('on', b.textContent.trim() === '3'); });
    }

    /* depth segment (existing handler toggles .on; we add depth logic) */
    root.querySelectorAll('.depth-seg button').forEach(function (b) {
      b.addEventListener('click', function () { setDepth(parseInt(b.textContent, 10)); });
    });

    /* ================================================================
       인재 검색 — preselect 회사 chip + wire buttons + real-ish filter
    ================================================================ */
    var p2 = root.querySelector('.subpage[data-p="2"]');
    if (p2) {
      var boxes = p2.querySelectorAll('.fbar-r1 .fbox');
      // fbox[0]=재직(keep), fbox[1]=회사 → fill with HCG chip
      if (boxes[1]) {
        boxes[1].innerHTML = '<span class="ai-chip"><span class="dot">회</span>HCG <span class="x">✕</span></span><span class="clr">✕</span><span class="arw">⌄</span>';
      }
      // add 회사 > HCG cond-chip
      var r2 = p2.querySelector('.fbar-r2');
      if (r2 && !r2.querySelector('.txf-cchip')) {
        var chip = document.createElement('span');
        chip.className = 'cond-chip txf-cchip';
        chip.innerHTML = '회사 &gt; HCG <span class="x">✕</span>';
        var rr = r2.querySelector('.r');
        r2.insertBefore(chip, rr);
      }
    }
    var resBody = p2 && p2.querySelector('table.tx2 tbody');
    var resCount = p2 && p2.querySelector('.res-head .c');
    var resInput = p2 && p2.querySelector('.fsearch input');
    var resPgn = p2 && p2.querySelector('.pager2 .pgn');
    var resTot = p2 && p2.querySelector('.pager2 > div:last-child span');

    function runSearch() {
      if (!resBody) return;
      var q = (resInput && resInput.value || '').trim();
      var list = (D.employees || []).filter(function (e) {
        if (!q) return true;
        return (e.name && e.name.indexOf(q) >= 0) || empNo(e.emp_id).indexOf(q) >= 0;
      });
      var rows = list.map(function (e, i) {
        return '<tr>' +
          '<td><input type="checkbox"></td>' +
          '<td>' + (i + 1) + '</td>' +
          '<td>HCG</td>' +
          '<td>' + empNo(e.emp_id) + '</td>' +
          '<td style="text-align:left">' + esc(e.name) + '</td>' +
          '<td><span class="mlink" style="cursor:pointer">보기</span></td>' +
          '<td><span class="mlink" style="cursor:pointer">카드</span></td>' +
          '<td>HCG</td>' +
          '<td style="text-align:left">' + esc(e.orgName || orgName(e.org_id)) + '</td>' +
          '<td style="text-align:left;font-size:12px;color:var(--ink-3)">' + esc(orgPathStr(e.org_id)) + '</td>' +
          '<td>' + (e.is_leader ? 'Y' : 'N') + '</td>' +
        '</tr>';
      }).join('');
      if (list.length) {
        resBody.innerHTML = rows;
      } else {
        resBody.innerHTML = '<tr><td colspan="11" style="border:0;padding:0"><div class="res-empty">검색 결과가 없습니다.</div></td></tr>';
      }
      if (resCount) resCount.textContent = '총 ' + list.length + '명';
      if (resPgn) resPgn.textContent = '1 / 1';
      if (resTot) resTot.textContent = '[' + list.length + ' / ' + list.length + ']';
    }
    function clearSearch() {
      if (resInput) resInput.value = '';
      if (resBody) resBody.innerHTML = '<tr><td colspan="11" style="border:0;padding:0"><div class="res-empty">검색 결과가 없습니다.</div></td></tr>';
      if (resCount) resCount.textContent = '총 0명';
      if (resPgn) resPgn.textContent = '1 / 1';
      if (resTot) resTot.textContent = '[0 / 0]';
    }

    /* ================================================================
       인원 현황 — normalize pivot/legend/chart + default 재직 + 추이 view
    ================================================================ */
    var p3 = root.querySelector('.subpage[data-p="3"]');
    // employment split (single company HCG, 221)
    var EMP = { 임원: 8, 정규직: 205, 계약직: 8 };
    var EMP_TOTAL = EMP.임원 + EMP.정규직 + EMP.계약직;
    if (p3) {
      /* cond-panel: 퇴직 → 재직 */
      p3.querySelectorAll('.cond-panel .mini-chip').forEach(function (c) {
        if (c.textContent.indexOf('퇴') >= 0) c.innerHTML = '<span class="dot">재</span>재직 <span class="x">✕</span>';
      });

      /* axis note + chart sub */
      var axisNote = p3.querySelector('.chart-card .axis-note');
      if (axisNote) axisNote.innerHTML = '축: 회사 / 범례: 고용 형태<span class="st">재직 상태: 재직</span>';
      p3.querySelectorAll('.cc-head .sub').forEach(function (s) { s.textContent = '필터링한 인원 : ' + EMP_TOTAL + '/221명'; });

      /* rebuild chart (bars scaled to 250) */
      var yax = p3.querySelector('.chart .yax');
      if (yax) {
        var ticks = [0, 50, 100, 150, 200, 250], yh = '';
        ticks.forEach(function (t) { yh += '<span class="yt" style="bottom:' + (t / 250 * 100) + '%">' + t + '</span>'; });
        yax.innerHTML = yh;
      }
      var groups = p3.querySelector('.chart .groups');
      if (groups) {
        function bar(cls, v) { return '<div class="grp"><div class="bar ' + cls + '" style="height:' + (v / 250 * 100) + '%"><span class="bv">' + v + '</span></div></div>'; }
        groups.innerHTML = bar('c1', EMP.임원) + bar('c2', EMP.정규직) + bar('c3', EMP.계약직);
      }
      var xlab = p3.querySelector('.chart .xlab');
      if (xlab) xlab.innerHTML = '<span>임원</span><span>정규직</span><span>계약직</span>';
      var legend = p3.querySelector('.chart-card .legend');
      if (legend) legend.innerHTML =
        '<span><i style="background:var(--blue)"></i>임원</span>' +
        '<span><i style="background:#9EC9FA"></i>정규직</span>' +
        '<span><i style="background:var(--green)"></i>계약직</span>';

      /* rebuild pivot table */
      var pivot = p3.querySelector('table.pivot');
      if (pivot) {
        pivot.innerHTML =
          '<thead>' +
            '<tr><th rowspan="2" style="text-align:left;vertical-align:middle">Group</th><th>임원</th><th>정규직</th><th>계약직</th></tr>' +
            '<tr><th>인원</th><th>인원</th><th>인원</th></tr>' +
          '</thead>' +
          '<tbody>' +
            '<tr><td class="grp-cell">HCG (' + EMP_TOTAL + ')</td><td class="num">' + EMP.임원 + '</td><td class="num">' + EMP.정규직 + '</td><td class="num">' + EMP.계약직 + '</td></tr>' +
            '<tr><td class="grp-cell">Total</td><td class="num">' + EMP.임원 + '</td><td class="num">' + EMP.정규직 + '</td><td class="num">' + EMP.계약직 + '</td></tr>' +
          '</tbody>';
      }

      /* build 추이 (trend) card, hidden by default */
      var statRight = p3.querySelector('.stat-right');
      if (statRight && !statRight.querySelector('.txf-trend-card')) {
        var yrs = ['2021', '2022', '2023', '2024', '2025', '2026'];
        var vals = [176, 189, 201, 210, 217, 221];
        var W = 700, H = 250, padL = 30, padR = 20, padT = 20, padB = 24;
        var vmin = 150, vmax = 230;
        function px(i) { return padL + i * ((W - padL - padR) / (yrs.length - 1)); }
        function py(v) { return H - padB - (v - vmin) / (vmax - vmin) * (H - padT - padB); }
        var pts = vals.map(function (v, i) { return px(i) + ',' + py(v); }).join(' ');
        var area = 'M' + px(0) + ',' + (H - padB) + ' L' + vals.map(function (v, i) { return px(i) + ',' + py(v); }).join(' L') + ' L' + px(yrs.length - 1) + ',' + (H - padB) + ' Z';
        var dots = vals.map(function (v, i) { return '<circle cx="' + px(i) + '" cy="' + py(v) + '" r="4" fill="var(--blue)"/><text x="' + px(i) + '" y="' + (py(v) - 10) + '" text-anchor="middle" font-size="11" fill="var(--ink-2)" font-weight="700">' + v + '</text>'; }).join('');
        var grid = [150, 170, 190, 210, 230].map(function (g) { var y = py(g); return '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="var(--line-2)"/><text x="' + (padL - 6) + '" y="' + (y + 3) + '" text-anchor="end" font-size="10" fill="var(--ink-3)">' + g + '</text>'; }).join('');
        var card = document.createElement('div');
        card.className = 'chart-card txf-trend-card txf-trend';
        card.style.display = 'none';
        card.innerHTML =
          '<div class="cc-head"><span class="t">인원 추이</span><span class="sub">최근 6개년 · 재직 인원</span>' +
          '<span class="r"><button class="btn-dl" data-msg="차트 이미지를 다운로드합니다.">이미지 다운로드 ⬇</button></span></div>' +
          '<div class="axis-note">축: 연도 / 값: 재직 인원수<span class="st">재직 상태: 재직</span></div>' +
          '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' + grid +
          '<path d="' + area + '" fill="var(--blue-soft)" opacity="0.6"/>' +
          '<polyline points="' + pts + '" fill="none" stroke="var(--blue)" stroke-width="2.5"/>' + dots + '</svg>' +
          '<div class="txf-trend-x">' + yrs.map(function (y) { return '<span>' + y + '</span>'; }).join('') + '</div>';
        statRight.appendChild(card);
      }
    }
    function setStatView(trend) {
      if (!p3) return;
      var origChart = p3.querySelector('.chart-card:not(.txf-trend-card)');
      var pivotCard = p3.querySelector('.pivot-card');
      var trendCard = p3.querySelector('.txf-trend-card');
      if (origChart) origChart.style.display = trend ? 'none' : '';
      if (pivotCard) pivotCard.style.display = trend ? 'none' : '';
      if (trendCard) trendCard.style.display = trend ? '' : 'none';
    }
    root.querySelectorAll('.seg2 button').forEach(function (b) {
      b.addEventListener('click', function () { setStatView(b.textContent.indexOf('추이') >= 0); });
    });

    /* ================================================================
       DELEGATED interactions
    ================================================================ */
    root.addEventListener('click', function (ev) {
      var t = ev.target;
      var acc = t.closest && (t.closest('.txf-exp') || (t.classList && t.classList.contains('aexp') ? t : null));
      if (acc) { var box = t.closest('.txf-acc'); if (box) box.classList.toggle('open'); return; }

      var onode = t.closest && t.closest('.txf-onode');
      if (onode) {
        if (t.classList && t.classList.contains('tw') && hasKids(onode.getAttribute('data-org'))) {
          var id = onode.getAttribute('data-org'); expanded[id] = !expanded[id]; refreshTree(); return;
        }
        selOrg = onode.getAttribute('data-org'); refreshTree(); renderRoster(selOrg); return;
      }

      if (t.closest && t.closest('.btn-search')) { runSearch(); return; }
      if (t.closest && t.closest('.freset')) { clearSearch(); toast('검색 조건을 초기화했습니다.'); return; }
      if (t.closest && t.closest('.fmore')) { toast('상세 조건 패널을 엽니다.'); return; }
      if (t.closest && t.closest('.btn-xls')) { toast('검색 결과를 엑셀로 내려받습니다.'); return; }
      if (t.closest && t.closest('.btn-dl')) { var d = t.closest('.btn-dl'); toast(d.getAttribute('data-msg') || '다운로드를 시작합니다.'); return; }

      var iss = t.closest && (t.closest('.txf-issue') || t.closest('.txf-reprint'));
      if (iss) { toast(iss.getAttribute('data-msg') || '요청을 처리했습니다.'); return; }
      var edit = t.closest && t.closest('.txf-edit');
      if (edit) { toast('수정 화면으로 이동합니다.'); return; }

      /* re-apply tab content after the section's own htab handler runs */
      if (t.closest && t.closest('.htab')) { setTimeout(renderActiveTab, 50); return; }
      /* re-apply after subnav toggle */
      if (t.closest && t.closest('.subnav a[data-nav]')) {
        setTimeout(function () {
          renderActiveTab();
          if (treeEl) { refreshTree(); renderRoster(selOrg); }
        }, 50);
        return;
      }
    });
  });
})();
