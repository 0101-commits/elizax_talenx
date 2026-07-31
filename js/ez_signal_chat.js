/* ez_signal_chat.js — 신호를 「대화」로 (18-2차 R3~R5 · B1 소유)
   ------------------------------------------------------------------------
   목적
     - 18차의 신호 카드를 폐기하고, 신호 150건(그중 실계산 15건)을
       ① 빈 채팅창 아래 「추천 대화 버튼」과 ② 자연스러운 대화 답변으로만 쓴다.
     - 버튼을 누르면 사용자 말투 질문이 그대로 전송되고(`Elizax.send`),
       실측 근거는 `contextFor()`가 payload에 **보이지 않게** 실어 준다.
       화면 이동은 사용자가 「직접 고칠게」라고 말할 때만 일어난다(B3 담당).

   공개 API
     EZSignalChat.starters(role)     → [{q, id}] 최대 3 (미처리 신호를 사용자 말투로)
     EZSignalChat.ask(id)            → 그 주제를 걸고 Elizax.send(q). true/false
     EZSignalChat.contextFor(text)   → 보이지 않게 붙일 한국어 참고 블록 | ""
     EZSignalChat.answerText(inst)   → 오프라인/폴백용 자연문 답변
     EZSignalChat.chips(inst)        → 사용자 말투 후속 칩 3개 (tx_chat_followups 규약)
     EZSignalChat.topic()            → 현재 걸린 신호 인스턴스 | null
     (부가) clearTopic() · scrub(text) · lineFor(inst) · starterFor(id)
            · promptFor(inst) · styleRules() · audit()

   화면·AI에 절대 내보내지 않는 표현 (R2) — 전부 `scrub()`이 걷어낸다
     · 유형 이름  기한 도래 / 작성 공백 / 기준 이탈 / 연결 불일치 / 상황 변동, 코드 T1~T5
     · 처리 이름  새로 쓰기 / 내가 고치기 / 알려주기 / 1on1 잡기 / 상세 보기 / 승인 요청, 코드 A1~A6
     · 근거 축 이름 사실 / 비교 / 추이 / 연결 / 이력 / 범위 를 「딱지」로 붙이는 것
       (문장 안에서 자연스럽게 쓰는 것은 허용 — 딱지 위치만 걷어낸다)
     · 기계 식별자  EMP-0078 · ORG-026 · OBJ-0018 · KR-EMP0078-1 · JOB-소프트-080
                    · TH-… · FB-… · 낱개 OBJ/KR/EMP/ORG/CHK/TH
     · 점 찍힌 필드 경로  objectives.owner_emp_id · keyResults.competency_id …
     · 표 이름 그대로  objectives · keyResults · checkins · jobProfiles …
     식별자는 사람이 읽는 이름(구성원 이름·조직 이름·목표 제목·직무 이름)으로 **바꿔** 넣고,
     찾을 수 없으면 지운다. 코드를 날것으로 남기지 않는다.

   ES5 IIFE · 외부 전역은 전부 가드(EZSignalEngine · TALENX_DATA · Elizax · TXRoles).
   ------------------------------------------------------------------------ */
(function () {
  'use strict';

  /* ===================== 0. 사전 ===================== */

  /* 유형·처리 이름 → 사람 말 (딱지가 문장에 섞여 들어온 경우의 구제책) */
  var TYPE_KR = {
    '기한 도래': '마감이 가까워진 일',
    '작성 공백': '아직 비어 있는 부분',
    '기준 이탈': '기준에서 벗어난 부분',
    '연결 불일치': '서로 어긋난 연결',
    '상황 변동': '달라진 상황'
  };
  var ACT_KR = {
    '새로 쓰기': '초안 잡기',
    '내가 고치기': '직접 다듬기',
    '알려주기': '공유하기',
    '1on1 잡기': '면담 잡기',
    '상세 보기': '자세히 살펴보기',
    '승인 요청': '확인 요청'
  };
  /* 표 이름 → 사람 말 */
  var TABLE_KR = {
    objectives: '목표', keyResults: '핵심결과', checkins: '체크인',
    employees: '구성원', orgs: '조직', jobs: '직무', jobProfiles: '직무 프로파일',
    competencies: '역량', strategyThemes: '전략 테마',
    feedbackHistory: '피드백 이력', evalHistory: '평가 이력', evaluations: '평가 기록',
    evaluationsPrev: '지난 평가 기록', peerReviews: '동료 리뷰', upwardFeedback: '상향 피드백',
    payroll: '급여 기록', payrollPolicy: '급여 규정', attendance: '근태 기록', leaves: '휴가 기록',
    skills: '스킬', skillDict: '스킬 사전', demoSubjects: '대상자', period: '기간'
  };
  /* 필드 이름(마지막 조각) → 사람 말 */
  var FIELD_KR = {
    owner_emp_id: '담당자', emp_id: '구성원', org_id: '조직',
    parent_objective_id: '상위 목표 연결', objective_id: '목표',
    kr_id: '핵심결과', checkin_id: '체크인',
    job_ref: '직무 연결', job_task_ref: '직무 과업 연결', jobProfileId: '직무',
    competency_id: '역량 연결', weight: '가중치', progress: '진척',
    name: '이름', title: '제목', period: '기간',
    jobHistory: '직무 이동 이력', updated_at: '저장 시점',
    checkin_date: '기록 날짜', confidence: '확신도', blocker: '걸림돌', blockers: '걸림돌',
    difficulty_basis: '난이도 근거', difficulty: '난이도',
    dev_comments: '의견', summary: '요약', competency_profile: '역량 구성', tasks: '과업'
  };
  /* 낱개 약어 → 사람 말 */
  var ABBR_KR = { OBJ: '목표', KR: '핵심결과', EMP: '구성원', ORG: '조직', CHK: '체크인', TH: '기준', FB: '피드백' };

  /* 추천 대화 버튼 문구 — 라이브 15건을 사용자가 물을 법한 말로 손으로 옮긴 표 (R3) */
  var STARTER = {
    '목표수립-구성원-04': '내 핵심결과가 직무랑 잘 맞는지 봐줘',
    '목표수립-구성원-08': '내 핵심결과 이름이 남들 것과 겹치는지 봐줘',
    '목표수립-구성원-09': '내 목표가 한쪽 역량에만 쏠려 있는지 봐줘',
    '목표수립-구성원-10': '내 목표에 직무 연결이 빠진 데가 있는지 봐줘',
    '목표수립-상위조직장-05': '팀 목표가 위 목표에 잘 붙어 있는지 봐줘',
    '목표수립-상위조직장-07': '팀마다 중요한 역량이 목표에서 빠졌는지 봐줘',
    '목표수립-상위조직장-08': '팀 목표에 직무 연결이 비어 있는 곳 알려줘',
    '중간점검-구성원-08': '내 핵심결과 중에 기록이 밀린 게 있는지 봐줘',
    '중간점검-상위조직장-03': '팀 사이 진척 차이가 큰지 봐줘',
    '중간점검-상위조직장-05': '요즘 팀에서 되풀이되는 걸림돌이 뭔지 알려줘',
    '중간점검-상위조직장-06': '팀 체크인 중에 확신 없다고 적힌 게 많은지 봐줘',
    '중간점검-상위조직장-08': '목표 진행률이 실제 진척과 맞는지 봐줘',
    '중간점검-HR경영진-09': '조직 사이 진행률 차이가 큰 곳 알려줘',
    '평가-구성원-02': '자기평가에 쓸 내 기록이 넉넉한지 봐줘',
    '평가-구성원-10': '직무가 바뀐 게 이번 평가에 어떻게 걸리는지 알려줘'
  };
  /* 표에 없는 신호(135건)용 일반 문구 — 단계별로 갈라 쓴다 */
  var STARTER_GEN = {
    '목표수립': '이번 목표 세우면서 챙길 게 있는지 봐줘',
    '중간점검': '지금 진행 상황에서 챙길 게 있는지 봐줘',
    '평가': '이번 평가에서 챙길 게 있는지 봐줘',
    '피드백': '최근 피드백에서 챙길 게 있는지 봐줘'
  };

  /* 주제 찾기용 낱말 — 각 신호의 추천 문구에서 뽑고 손으로 보탰다.
     가중치: 세 글자 이상 낱말 2점, 두 글자 1점. 3점부터 그 주제로 본다.
     사용자가 추천 버튼 문구를 그대로 보내면 낱말 계산 없이 바로 그 주제다. */
  var KEYS = {
    '목표수립-구성원-04': ['핵심결과', '직무', '과업', '역량', '연결', '맞는지', '어울리'],
    '목표수립-구성원-08': ['핵심결과', '이름', '겹치', '중복', '똑같', '표현'],
    '목표수립-구성원-09': ['역량', '쏠려', '쏠림', '치우', '한쪽', '골고루'],
    '목표수립-구성원-10': ['목표', '직무', '연결', '빠진', '비어'],
    '목표수립-상위조직장-05': ['팀 목표', '상위', '위 목표', '정렬', '연결', '붙어'],
    '목표수립-상위조직장-07': ['팀', '역량', '빠졌', '중요한', '미연결', '전사', '비교'],
    '목표수립-상위조직장-08': ['팀 목표', '직무', '연결', '비어', '빈 곳'],
    '중간점검-구성원-08': ['핵심결과', '체크인', '기록', '밀린', '가중치'],
    '중간점검-상위조직장-03': ['진척', '차이', '격차', '팀 사이', '벌어'],
    '중간점검-상위조직장-05': ['걸림돌', '장애', '반복', '되풀이', '막히'],
    '중간점검-상위조직장-06': ['체크인', '확신', '자신', '낮음', '불안'],
    '중간점검-상위조직장-08': ['진행률', '진척', '어긋', '맞는지', '가중평균', '정합'],
    '중간점검-HR경영진-09': ['조직', '진행률', '차이', '격차', '벌어', '전사'],
    '평가-구성원-02': ['자기평가', '평가', '근거', '체크인', '기록', '넉넉'],
    '평가-구성원-10': ['직무', '바뀐', '직무가 바뀐', '전환', '변경', '평가', '기준']
  };
  /* 이어 묻는 말 — 주제를 그대로 물려받아도 되는 신호 */
  var FOLLOW_CUE = ['근거', '어떤 기록', '무슨 기록', '어디서', '출처', '왜', '어째서',
    '고칠', '고치', '수정', '저장', '초안', '맞춰', '정리', '요청', '면담', '자세히', '더 알려', '그거'];

  /* ===================== 1. 외부 전역 가드 ===================== */
  function ENG() { return window.EZSignalEngine || null; }
  function D() { return window.TALENX_DATA || {}; }
  function arr(k) {
    var v = D()[k];
    return (Object.prototype.toString.call(v) === '[object Array]') ? v : [];
  }
  function roleKey(r) {
    if (r) return r;
    var e = ENG();
    if (e && e.role) { try { return e.role() || 'member'; } catch (e0) {} }
    try { if (window.TXRoles && TXRoles.current) return TXRoles.current().key || 'member'; } catch (e1) {}
    return 'member';
  }
  function S(v) { return String(v == null ? '' : v); }
  function cut(s, n) { s = S(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  /* ===================== 2. 식별자 → 사람 이름 ===================== */
  var idxCache = null;
  function idx() {
    if (idxCache) return idxCache;
    var m = { emp: {}, org: {}, obj: {}, kr: {}, jp: {}, job: {} }, i, a, jp;
    a = arr('employees'); for (i = 0; i < a.length; i++) m.emp[a[i].emp_id] = a[i].name || '';
    a = arr('orgs'); for (i = 0; i < a.length; i++) m.org[a[i].org_id] = a[i].name || '';
    a = arr('objectives'); for (i = 0; i < a.length; i++) m.obj[a[i].objective_id] = a[i].title || '';
    a = arr('keyResults'); for (i = 0; i < a.length; i++) m.kr[a[i].kr_id] = a[i].name || '';
    jp = D().jobProfiles || {};
    for (i in jp) if (Object.prototype.hasOwnProperty.call(jp, i)) m.jp[i] = (jp[i] && jp[i].title) || '';
    a = arr('jobs'); for (i = 0; i < a.length; i++) m.job[a[i].job_id] = a[i].job_title || '';
    idxCache = m;
    return m;
  }
  /* 식별자 하나를 사람 이름으로. 못 찾으면 "" (지운다) */
  function humanId(tok) {
    var t = S(tok), m = idx();
    if (/^EMP-/.test(t)) return m.emp[t] || '';
    if (/^ORG-/.test(t)) return m.org[t] || '';
    if (/^OBJ-/.test(t)) return m.obj[t] ? '「' + cut(m.obj[t], 24) + '」' : '';
    if (/^KR-/.test(t)) return m.kr[t] ? '「' + cut(m.kr[t], 24) + '」' : '';
    if (/^JOB-/.test(t)) return m.jp[t] || m.job[t] || '';
    return '';
  }
  /* 점 찍힌 경로 → 사람 말. 앞머리가 표 이름이면 표 이름을, 식별자면 그 이름을 살린다 */
  function humanPath(pfx, fld) {
    var f = FIELD_KR[fld] || '';
    if (TABLE_KR[pfx]) return (TABLE_KR[pfx] + (f ? ' ' + f : '') + ' 기록').replace(/\s+/g, ' ');
    var nm = humanId(pfx);
    if (nm) return nm + '의 ' + (f || '기록');
    return f ? f + ' 기록' : '기록';
  }

  /* ===================== 3. scrub — 금지 표현 정제 (R2) ===================== */
  var RE_FY = /FY(\d{4})[-\s]?([1-4])Q/g;
  var RE_ORG_PAREN = /ORG-\d+\s*\(([^)]{1,40})\)/g;
  var RE_DOT = /([A-Za-z][A-Za-z0-9]*(?:-[0-9A-Za-z가-힣]+)*)\.([A-Za-z_][A-Za-z0-9_]*)/g;
  var RE_RANGE = /(OBJ|KR|EMP|ORG)-[0-9A-Za-z_]+\s*~\s*(?:(?:OBJ|KR|EMP|ORG)-)?[0-9A-Za-z_]+/g;
  var RE_ID = /(?:EMP|ORG|OBJ|KR)-[0-9A-Za-z_]+(?:-[0-9A-Za-z_]+)*/g;
  var RE_JOBID = /JOB-[^\s\/,)\]·]+/g;
  var RE_THID = /TH-[^\s\/,)\]·]+/g;
  var RE_FBID = /(?:FB|CHK|EV|PR)-[0-9A-Za-z_-]+/g;
  var RE_ABBR = /\b(OBJ|KR|EMP|ORG|CHK|TH|FB)\b/g;
  var RE_CODE_T = /\bT[1-5]\b/g;
  var RE_CODE_A = /\bA[1-6]\b/g;
  var RE_AX_BRACKET = /[\[(【]\s*(?:사실|비교|추이|연결|이력|범위)\s*[\])】]/g;
  var RE_AX_LABEL = /(^|\n)\s*(?:사실|비교|추이|연결|이력|범위)\s*[·:|]\s*/g;

  function scrub(text) {
    var s = S(text), k;
    if (!s) return '';

    /* 기간 표기 */
    s = s.replace(RE_FY, '$1년 $2분기');
    s = s.replace(/FY(\d{4})/g, '$1년');
    /* 조직코드(조직이름) → 조직이름 */
    s = s.replace(RE_ORG_PAREN, '$1');
    /* 점 찍힌 필드 경로 */
    s = s.replace(RE_DOT, function (all, pfx, fld) { return humanPath(pfx, fld); });
    /* 식별자 구간(OBJ-0001~OBJ-0040) */
    s = s.replace(RE_RANGE, function (all, kind) { return (ABBR_KR[kind] || '') + ' 전체'; });
    /* 낱개 식별자 → 사람 이름 (못 찾으면 지운다) */
    s = s.replace(RE_ID, function (t) { return humanId(t); });
    s = s.replace(RE_JOBID, function (t) { return humanId(t); });
    s = s.replace(RE_THID, '');
    s = s.replace(RE_FBID, '');
    /* 낱개 약어 */
    s = s.replace(RE_ABBR, function (t) { return ABBR_KR[t] || ''; });
    /* 표 이름 그대로 쓴 것 */
    for (k in TABLE_KR) if (Object.prototype.hasOwnProperty.call(TABLE_KR, k)) {
      s = s.replace(new RegExp('\\b' + k + '\\b', 'g'), TABLE_KR[k]);
    }
    /* 유형·처리 이름 */
    for (k in TYPE_KR) if (Object.prototype.hasOwnProperty.call(TYPE_KR, k)) s = s.split(k).join(TYPE_KR[k]);
    for (k in ACT_KR) if (Object.prototype.hasOwnProperty.call(ACT_KR, k)) s = s.split(k).join(ACT_KR[k]);
    /* 코드 */
    s = s.replace(RE_CODE_T, '').replace(RE_CODE_A, '');
    /* 근거 축 딱지 */
    s = s.replace(RE_AX_BRACKET, '').replace(RE_AX_LABEL, '$1');

    return tidy(s);
  }

  /* 지운 자리에 남은 구분기호·빈 괄호를 정리한다 */
  function tidy(str) {
    var s = S(str);
    s = s.replace(/\(\s*\)/g, '').replace(/「\s*」/g, '').replace(/\[\s*\]/g, '');
    if (/[·\/]/.test(s)) {
      var parts = s.split(/\s*[·\/]\s*/), keep = [], i, p;
      for (i = 0; i < parts.length; i++) {
        p = parts[i].replace(/^\s+|\s+$/g, '');
        if (!p || p === '-' || p === '–' || p === '—') continue;
        keep.push(p);
      }
      s = keep.join(' · ');
    }
    s = s.replace(/\s{2,}/g, ' ');
    s = s.replace(/\s+([,.)\]])/g, '$1');
    s = s.replace(/([(\[])\s+/g, '$1');
    return s.replace(/^\s+|\s+$/g, '');
  }

  /* ===================== 4. 검증용 스윕 ===================== */
  /* 금지 표현이 하나라도 남았는지 본다. 통과 = 전부 0 */
  var FORBID = [
    { name: '유형 이름', re: /기한 도래|작성 공백|기준 이탈|연결 불일치|상황 변동/ },
    { name: '유형 코드 T1~T5', re: /\bT[1-5]\b/ },
    { name: '처리 이름', re: /새로 쓰기|내가 고치기|알려주기|1on1 잡기|상세 보기|승인 요청/ },
    { name: '처리 코드 A1~A6', re: /\bA[1-6]\b/ },
    { name: '근거 축 딱지', re: /[\[(【]\s*(?:사실|비교|추이|연결|이력|범위)\s*[\])】]|(?:^|\n)\s*(?:사실|비교|추이|연결|이력|범위)\s*[·:|]/ },
    { name: '구성원 식별자', re: /EMP-\d+/ },
    { name: '조직 식별자', re: /ORG-\d+/ },
    { name: '목표 식별자', re: /OBJ-[0-9A-Za-z_]/ },
    { name: '핵심결과 식별자', re: /KR-[0-9A-Za-z_]/ },
    { name: '직무 식별자', re: /JOB-[^\s\/]/ },
    { name: '기준값 식별자', re: /TH-[^\s]/ },
    { name: '기타 식별자', re: /(?:FB|CHK|EV|PR)-[0-9A-Za-z]/ },
    { name: '낱개 약어', re: /\b(?:OBJ|KR|EMP|ORG|CHK|TH|FB)\b/ },
    { name: '점 찍힌 필드 경로', re: /[A-Za-z][A-Za-z0-9]*\.[A-Za-z_][A-Za-z0-9_]*/ },
    { name: '표 이름 그대로', re: new RegExp('\\b(?:' + keysOf(TABLE_KR).join('|') + ')\\b') }
  ];
  function keysOf(o) {
    var r = [], k;
    for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r.push(k);
    return r;
  }
  /* 신호 150건의 문구 전량을 scrub 한 뒤 금지 표현 잔존 건수를 센다 */
  function audit() {
    var e = ENG(), cat = e && e.catalog && e.catalog();
    var out = { signals: 0, strings: 0, findings: [], byPattern: {}, pass: true };
    if (!cat || !cat.signals) return out;
    var i, j, hits = {};
    for (i = 0; i < FORBID.length; i++) hits[FORBID[i].name] = 0;
    for (i = 0; i < cat.signals.length; i++) {
      var s = cat.signals[i], bag = [];
      out.signals++;
      bag.push(s.notice); bag.push(s.agent); bag.push(s.principle); bag.push(s.example);
      bag.push(s.typeLabel); bag.push(s.stage);
      if (s.done) { bag.push(s.done.title); bag.push(s.done.desc); }
      for (j = 0; j < (s.evidence || []).length; j++) {
        var ev = s.evidence[j];
        bag.push(ev.text); bag.push(ev.emph); bag.push(ev.src); bag.push(ev.calc); bag.push(ev.basis);
      }
      for (j = 0; j < (s.thresholds || []).length; j++) {
        bag.push(s.thresholds[j].code); bag.push(s.thresholds[j].name);
        bag.push(s.thresholds[j].value); bag.push(s.thresholds[j].why);
      }
      for (j = 0; j < (s.actions || []).length; j++) {
        var ac = s.actions[j];
        bag.push(ac.kind); bag.push(ac.label); bag.push(ac.draft); bag.push(ac.confirm); bag.push(ac.store);
        bag.push((ac.chips || []).join(' · '));
      }
      for (j = 0; j < bag.length; j++) {
        if (!bag[j]) continue;
        out.strings++;
        var cleaned = scrub(bag[j]), f;
        for (f = 0; f < FORBID.length; f++) {
          if (FORBID[f].re.test(cleaned)) {
            hits[FORBID[f].name]++;
            if (out.findings.length < 12) {
              out.findings.push({ id: s.id, pattern: FORBID[f].name, text: cut(cleaned, 90) });
            }
          }
        }
      }
    }
    out.byPattern = hits;
    for (i = 0; i < FORBID.length; i++) if (hits[FORBID[i].name] > 0) out.pass = false;
    return out;
  }

  /* ===================== 5. 신호 → 사용자 말투 ===================== */
  function instOf(x) {
    var e = ENG();
    if (!x) return null;
    if (typeof x === 'string') return (e && e.instance) ? e.instance(x) : null;
    return x;
  }
  function starterFor(id) {
    var q = STARTER[id];
    if (q) return q;
    var stage = S(id).split('-')[0];
    return STARTER_GEN[stage] || '지금 챙길 게 있는지 봐줘';
  }
  /* 알림 한 줄(정제됨) — B3의 한 줄 목록·우하단 한 줄 권유가 쓴다 */
  function lineFor(x) {
    var inst = instOf(x);
    if (!inst) return '';
    return scrub(inst.notice || (inst.sig && inst.sig.notice) || '');
  }
  /* 추천 대화 버튼 (R3) — 미처리 신호 최대 3건 */
  function starters(role) {
    var e = ENG(), rk = roleKey(role), out = [], seen = {}, list = [], i;
    if (!e) return out;
    try { list = e.pending ? e.pending(rk) : []; } catch (e0) { list = []; }
    if (!list.length) { try { list = e.live ? e.live(rk) : []; } catch (e1) { list = []; } }
    for (i = 0; i < list.length && out.length < 3; i++) {
      var id = list[i].id, q = starterFor(id);
      if (seen[q]) continue;
      seen[q] = 1;
      out.push({ q: q, id: id });
    }
    return out;
  }

  /* ===================== 6. 주제 걸기 ===================== */
  var cur = null;     /* 지금 이야기 중인 신호 인스턴스 */
  var armed = null;   /* ask()가 막 걸어 둔 주제 — 다음 한 통에 반드시 실린다 */

  function ask(id) {
    var inst = instOf(id);
    if (!inst) return false;
    cur = inst;
    armed = inst;
    var q = starterFor(inst.id);
    if (window.Elizax && typeof window.Elizax.send === 'function') {
      try { window.Elizax.send(q); return true; } catch (e) { return false; }
    }
    return false;
  }
  function topic() { return cur; }
  function clearTopic() { cur = null; armed = null; }

  /* 낱말 겹침으로 주제 찾기 */
  function scoreOf(id, text) {
    var ks = KEYS[id] || [], i, sc = 0, t = S(text);
    /* 추천 버튼 문구를 그대로 보냈으면 두 말 없이 그 주제 */
    if (t && t.indexOf(starterFor(id)) >= 0) return 99;
    for (i = 0; i < ks.length; i++) {
      if (t.indexOf(ks[i]) >= 0) sc += (ks[i].length >= 3 ? 2 : 1);
    }
    return sc;
  }
  function isFollowUp(text) {
    var t = S(text), i;
    if (t.length > 44) return false;
    for (i = 0; i < FOLLOW_CUE.length; i++) if (t.indexOf(FOLLOW_CUE[i]) >= 0) return true;
    return false;
  }
  /* 후보 = 미처리 → 라이브 → 실계산 가능한 15건 */
  function candidates(rk) {
    var e = ENG(), out = [], seen = {}, i, a = [];
    if (!e) return out;
    try { a = a.concat(e.pending ? e.pending(rk) : []); } catch (e0) {}
    try { a = a.concat(e.live ? e.live(rk) : []); } catch (e1) {}
    for (i = 0; i < a.length; i++) if (a[i] && !seen[a[i].id]) { seen[a[i].id] = 1; out.push(a[i]); }
    var ids = [];
    try { ids = e.liveIds ? e.liveIds() : []; } catch (e2) { ids = []; }
    for (i = 0; i < ids.length; i++) {
      if (seen[ids[i]]) continue;
      var inst = null;
      try { inst = e.instance(ids[i], rk); } catch (e3) { inst = null; }
      if (inst && inst.ready) { seen[ids[i]] = 1; out.push(inst); }
    }
    return out;
  }
  function match(text, role) {
    var rk = roleKey(role), list = candidates(rk), best = null, bestSc = 0, i;
    for (i = 0; i < list.length; i++) {
      var sc = scoreOf(list[i].id, text);
      if (sc > bestSc) { bestSc = sc; best = list[i]; }
    }
    return (bestSc >= 3) ? best : null;
  }

  /* ===================== 7. 근거 블록 (보이지 않게 실린다) ===================== */

  /* 답변 방식 규칙 (R4) — 그대로 프롬프트에 붙는다 */
  function styleRules() {
    return [
      '[답변 방식 — 반드시 지켜 주세요]',
      '1. 옆자리 동료에게 말하듯 해요체로 3~6문장만 씁니다. 표, 글머리기호, 굵은 글씨 나열은 쓰지 않습니다.',
      '2. 숫자는 문장 안에 녹여 씁니다. 근거를 줄 단위로 늘어놓지 않습니다.',
      '3. 내부 분류 이름, 영문 표 이름, 점 찍힌 데이터 경로, 코드처럼 보이는 기록 번호는 한 글자도 쓰지 않습니다. 사람 이름, 조직 이름, 목표 제목처럼 사람이 읽는 말만 씁니다.',
      '4. 위에 적힌 값만 씁니다. 없는 숫자는 만들지 않고, 아직 확인되지 않았다고 적힌 값은 확정해 말하지 않습니다.',
      '5. 마지막 문장은 사용자가 바로 이어받을 수 있는 짧은 제안이나 물음으로 맺습니다.',
      '6. 무엇을 보고 알았는지는 사용자가 물을 때만, 사람이 읽는 말로 한 문장으로 답합니다.',
      '7. 화면을 열거나 무엇을 저장하겠다고 먼저 말하지 않습니다. 사용자가 직접 고치겠다고 할 때만 안내합니다.'
    ].join('\n');
  }

  /* 근거 줄 고르기 — 기본 → 접힘 순, 최대 4줄. 추정 줄은 따로 모은다 */
  function pickEvidence(inst) {
    var ev = (inst && inst.evidence) || [], sure = [], soft = [], i, rank;
    var order = { '기본': 0, '접힘': 1, '펼침': 2 };
    var rows = ev.slice().sort(function (a, b) {
      rank = (order[a.show] == null ? 3 : order[a.show]) - (order[b.show] == null ? 3 : order[b.show]);
      return rank;
    });
    for (i = 0; i < rows.length; i++) {
      var t = scrub(rows[i].text);
      if (!t) continue;
      if (rows[i].assumed === 1) { if (soft.length < 2) soft.push(t); }
      else if (sure.length < 4) sure.push(t);
    }
    return { sure: sure, soft: soft };
  }
  /* 살펴본 자료 — 사람 말로만, 최대 3개. 여러 조각이 붙은 출처는 쪼개서 담는다 */
  function sourceWords(inst) {
    var ev = (inst && inst.evidence) || [], seen = {}, out = [], i, j;
    for (i = 0; i < ev.length; i++) {
      var parts = scrub(ev[i].src).split(' · ');
      for (j = 0; j < parts.length && out.length < 3; j++) {
        var s = parts[j].replace(/^\s+|\s+$/g, '');
        if (!s || s.length < 2 || seen[s]) continue;
        seen[s] = 1;
        out.push(balance(cut(s, 34)));
      }
      if (out.length >= 3) break;
    }
    return out;
  }
  /* 잘라낸 자리에 여는 낫표만 남는 것을 막는다 */
  function balance(s) {
    var t = S(s), a = t.split('「').length - 1, b = t.split('」').length - 1;
    while (b < a) { t += '」'; b++; }
    return t;
  }
  /* 기준값 — 실측이 붙은 것만 문장으로. 값 자체는 제도 예시라서 「잠정」이라고 말한다 */
  function thresholdLines(inst) {
    var th = (inst && inst.thresholds) || [], out = [], i;
    for (i = 0; i < th.length && out.length < 2; i++) {
      var nm = scrub(th[i].name);
      if (!nm) continue;
      if (th[i].actual != null) {
        out.push(nm + ' — 회사가 보는 잠정 기준 ' + scrub(th[i].value) + ', 지금 측정값 ' + scrub(th[i].actual));
      } else {
        out.push(nm + ' — 회사 기준이 아직 확정되지 않아 잠정으로 ' + scrub(th[i].value) + '로 봤어요');
      }
    }
    return out;
  }
  /* 이어서 도울 수 있는 일 — 처리 초안의 뜻만 한 줄로 (처리 이름은 쓰지 않는다) */
  function helpLine(inst) {
    var acts = ((inst && inst.actions) || []).slice().sort(function (a, b) { return (a.rank || 9) - (b.rank || 9); });
    var i, act = null;
    for (i = 0; i < acts.length; i++) if (acts[i].type !== 'A5') { act = acts[i]; break; }
    if (!act) act = acts[0] || null;
    if (!act || !act.draft) return '';
    return scrub(cut(S(act.draft).split('\n')[0], 160));
  }

  /* 보이지 않는 참고 블록 — B2의 payload 조립기가 사용자 문장 뒤에 붙인다 */
  function blockFor(inst) {
    if (!inst) return '';
    var L = [], ev = pickEvidence(inst), i;
    var src = sourceWords(inst), th = thresholdLines(inst), help = helpLine(inst);
    L.push('[참고 자료 — 사용자에게 그대로 보여 주지 마세요]');
    var notice = scrub(inst.notice);
    if (notice) L.push('지금 확인된 상황: ' + notice);
    if (inst.asof) L.push('기준 시점: ' + inst.asof);
    if (ev.sure.length) {
      L.push('실제로 세어 본 것:');
      for (i = 0; i < ev.sure.length; i++) L.push('- ' + cut(ev.sure[i], 120));
    }
    if (th.length) {
      L.push('견줘 본 기준:');
      for (i = 0; i < th.length; i++) L.push('- ' + cut(th[i], 110));
    }
    if (ev.soft.length) {
      L.push('아직 확인되지 않아 잠정으로 둔 것:');
      for (i = 0; i < ev.soft.length; i++) L.push('- ' + cut(ev.soft[i], 110));
    }
    if (src.length) L.push('살펴본 자료(물어볼 때만 사람 말로 밝히세요): ' + src.join(' · '));
    if (help) L.push('이어서 도울 수 있는 일: ' + cut(help, 140));
    if (!inst.ready) L.push('주의: 이 주제는 아직 실제 값을 다 세지 못했습니다. 단정하지 말고 무엇을 더 채워야 하는지만 말하세요.');
    L.push(styleRules());
    return tidy2(L.join('\n'));
  }
  /* 줄바꿈은 살리면서 줄마다 정리한다 */
  function tidy2(text) {
    var lines = S(text).split('\n'), out = [], i;
    for (i = 0; i < lines.length; i++) out.push(tidy(lines[i]));
    return out.join('\n');
  }

  /* contextFor — ①ask()가 걸어 둔 주제 ②낱말 겹침 ③이어 묻는 말이면 앞 주제 */
  function contextFor(userText, role) {
    var t = S(userText), inst = null;
    if (armed) { inst = armed; armed = null; }
    if (!inst && t) {
      inst = match(t, role);
      if (inst) cur = inst;
    }
    if (!inst && cur && isFollowUp(t)) inst = cur;
    if (!inst) return '';
    return blockFor(inst);
  }

  /* 신호 하나를 통째로 AI에 보낼 때 (질문 + 참고 자료) — 엔진 prompt()가 물려 쓴다 */
  function promptFor(x) {
    var inst = instOf(x);
    if (!inst) return '';
    var q = starterFor(inst.id), b = blockFor(inst);
    return b ? (q + '\n\n' + b) : q;
  }

  /* ===================== 8. 오프라인 답변 ===================== */
  /* 같은 규칙으로 3~5문장을 손으로 짠다. 엔진이 죽어 있을 때만 쓰인다 */
  function answerText(x) {
    var inst = instOf(x);
    if (!inst) return '';
    var ev = pickEvidence(inst), out = [], i;
    var notice = scrub(inst.notice);
    if (notice) out.push(sent(notice));
    for (i = 0; i < ev.sure.length && out.length < 3; i++) {
      if (ev.sure[i] === notice) continue;
      out.push(sent(ev.sure[i]));
    }
    var th = (inst.thresholds || [])[0];
    if (th && th.actual != null && out.length < 4) {
      var nm = scrub(th.name);
      if (nm) out.push(sent('「' + nm + '」 기준으로는 회사가 잠정으로 두는 값이 ' + scrub(th.value)
        + '인데 지금 측정값은 ' + scrub(th.actual) + '네요'));
    }
    if (ev.soft.length && out.length < 5) {
      out.push(sent(ev.soft[0] + ' — 이 부분은 아직 확인되지 않아 잠정으로 봤어요'));
    }
    var close = scrub(inst.agent || (inst.sig && inst.sig.agent) || '');
    if (close) out.push(sent(close));
    else out.push('어디부터 손대면 좋을지 같이 볼까요?');
    return out.slice(0, 6).join(' ');
  }
  /* 문장 끝을 다듬는다 (해요체 종결이 없으면 「예요」를 붙이지 않고 그대로 둔다) */
  function sent(s) {
    var t = tidy(S(s));
    if (!t) return '';
    if (/[.!?…]$/.test(t)) return t;
    return t + '.';
  }

  /* ===================== 9. 후속 칩 (R5 · 사용자 말투) ===================== */
  var CHIP_BY_TYPE = {
    A1: '초안 하나 잡아줘',
    A2: '어디를 어떻게 고치면 될지 알려줘',
    A3: '공유할 문장 만들어줘',
    A4: '면담 안건으로 정리해줘',
    A5: '근거를 더 자세히 보여줘',
    A6: '요청 문구 만들어줘'
  };
  function chips(x) {
    var inst = instOf(x);
    var out = [];
    if (inst) {
      var acts = (inst.actions || []).slice().sort(function (a, b) { return (a.rank || 9) - (b.rank || 9); });
      var i, first = null;
      for (i = 0; i < acts.length; i++) if (acts[i].type !== 'A5') { first = acts[i]; break; }
      if (!first) first = acts[0] || null;
      if (first && CHIP_BY_TYPE[first.type]) out.push(CHIP_BY_TYPE[first.type]);
    }
    if (!out.length) out.push('어떻게 하면 좋을지 알려줘');
    out.push('어떤 기록을 보고 한 말이야?');
    out.push('화면에서 직접 고칠게');
    /* 칩도 화면에 그대로 뜨므로 한 번 더 정제한다 */
    var clean = [], j;
    for (j = 0; j < out.length; j++) {
      var c = scrub(out[j]);
      if (c) clean.push(c);
    }
    return clean.slice(0, 3);
  }

  /* ===================== 10. 노출 ===================== */
  window.EZSignalChat = {
    starters: starters,
    ask: ask,
    contextFor: contextFor,
    answerText: answerText,
    chips: chips,
    topic: topic,
    clearTopic: clearTopic,
    scrub: scrub,
    lineFor: lineFor,
    starterFor: starterFor,
    promptFor: promptFor,
    styleRules: styleRules,
    audit: audit
  };

  /* 데이터가 갈리면 이름 색인을 버린다 */
  try {
    if (window.EZSignalEngine && EZSignalEngine.onChange) {
      EZSignalEngine.onChange(function () { idxCache = null; });
    }
  } catch (e) {}
})();
