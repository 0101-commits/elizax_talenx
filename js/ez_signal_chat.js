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
     EZSignalChat.suggested(role)    → [{q, id, live}] 6개 · 역할별 대표 질문(자체 검사 통과분만)
     EZSignalChat.questionFor(id)    → 그 신호를 부르는 사용자 말투 질문 (150건 전부)
     EZSignalChat.aliases(id)        → 그 신호를 부르는 낱말 묶음
     EZSignalChat.matchAny(text,role)→ {id, sig, inst, score, live, mine} | null  (150건 전체 대조)
     EZSignalChat.catalogQuestions(role) → [{id,q,live,mine,stage,actor}] 150건 (내 역할이 앞)
     EZSignalChat.ask(id)            → 그 주제를 걸고 Elizax.send(q). true/false
     EZSignalChat.contextFor(text)   → 보이지 않게 붙일 한국어 참고 블록 | ""
     EZSignalChat.answerText(inst)   → 오프라인/폴백용 자연문 답변
     EZSignalChat.chips(inst)        → 사용자 말투 후속 칩 3개 (tx_chat_followups 규약)
     EZSignalChat.topic()            → 현재 걸린 신호 인스턴스 | null
     (부가) clearTopic() · scrub(text) · lineFor(inst) · starterFor(id)
            · promptFor(inst) · styleRules() · audit()

   19차 §4 — 질문 사전
     · 신호 150건 전부에 손으로 쓴 질문 1개씩(`QMAP`, 20~34자 반말 요청체).
     · 아직 실계산이 안 되는 135건은 답도 프롬프트도 **예시라고 밝히고** 왜 못 셌는지 말한다.
     · 역할 밖 신호도 답한다 — 앞에 한 줄만 붙인다.

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

  /* ---------------------------------------------------------------------
     QMAP — 신호 150건 전부의 「사용자 말투 질문」 (19차 §4-1)
     ---------------------------------------------------------------------
     · 알림 문구(notice)를 기계 변환한 게 아니라 **의미로 다시 쓴 것**이다.
     · 규칙 = 20~34자 · 반말 요청체(~봐줘 / ~알려줘 / ~확인해줘) · 분류·코드 금지.
     · 사용자가 실제로 친 문장이 확인된 건은 그 문장을 그대로 정답으로 등재한다
       (예: 목표수립-상위조직장-02).
     · 손으로 쓴 것 150건 / 기계 생성 0건.
     --------------------------------------------------------------------- */
  var QMAP = {
    /* 목표수립 · 구성원 (11) */
    '목표수립-구성원-01': '목표 확정일 전에 내 목표가 비어 있는지 봐줘',
    '목표수립-구성원-02': '내 목표에 핵심결과가 안 붙어 있는지 봐줘',
    '목표수립-구성원-03': '내 핵심결과 가중치 합이 맞는지 확인해줘',
    '목표수립-구성원-04': '내 핵심결과가 직무랑 잘 맞는지 확인해줘',
    '목표수립-구성원-05': '직무가 바뀌었는데 예전 과업이 남았는지 봐줘',
    '목표수립-구성원-06': '내 목표에 상위 목표 연결이 빠졌는지 봐줘',
    '목표수립-구성원-07': '내 목표에 핵심결과 수가 부족한지 알려줘',
    '목표수립-구성원-08': '내 핵심결과 이름이 남들 것과 겹치는지 봐줘',
    '목표수립-구성원-09': '내 목표가 한쪽 역량에만 쏠려 있는지 봐줘',
    '목표수립-구성원-10': '내 목표에 직무 연결이 빠진 데가 있는지 봐줘',
    '목표수립-구성원-11': '지난 기간에 못 끝낸 일이 이번에 빠졌는지 봐줘',
    /* 목표수립 · 팀장 (10) */
    '목표수립-팀장-01': '목표를 아직 안 세운 팀원이 있는지 알려줘',
    '목표수립-팀장-02': '팀원 목표에 핵심결과가 안 붙었는지 봐줘',
    '목표수립-팀장-03': '팀원 핵심결과 이름이 다른 팀과 겹치는지 봐줘',
    '목표수립-팀장-04': '우리 팀 목표에 안 붙은 팀원 목표가 있는지 봐줘',
    '목표수립-팀장-05': '새로 온 팀원 목표가 예전 조직에 남았는지 봐줘',
    '목표수립-팀장-06': '팀원 목표가 한 역량에만 몰려 있는지 봐줘',
    '목표수립-팀장-07': '팀원 핵심결과 한 곳에 가중치가 몰렸는지 봐줘',
    '목표수립-팀장-08': '마감 전에 목표를 못 낸 팀원이 몇 명인지 알려줘',
    '목표수립-팀장-09': '지난 기간 미완 항목이 팀원 목표에 빠졌는지 봐줘',
    '목표수립-팀장-10': '팀원 핵심결과에 목표값이 비었는지 확인해줘',
    /* 목표수립 · 상위조직장 (8) */
    '목표수립-상위조직장-01': '목표 수립이 늦은 팀이 어디인지 알려줘',
    '목표수립-상위조직장-02': '1차 평가자 검토가 제대로 되고 있는지 확인해줘',
    '목표수립-상위조직장-03': '한 팀에 쉬운 난이도가 몰려 있는지 확인해줘',
    '목표수립-상위조직장-05': '팀 목표가 위 목표에 잘 붙어 있는지 확인해줘',
    '목표수립-상위조직장-06': '조직이 바뀐 뒤 목표 주인이 그대로인지 봐줘',
    '목표수립-상위조직장-07': '팀마다 중요한 역량이 목표에서 빠졌는지 봐줘',
    '목표수립-상위조직장-08': '팀 목표에 직무 연결이 비어 있는 곳 알려줘',
    '목표수립-상위조직장-09': '조직 목표가 아예 없는 하위 조직이 있는지 봐줘',
    /* 목표수립 · HR경영진 (9) */
    '목표수립-HR경영진-01': '전사 목표 확정률이 기준에 닿았는지 알려줘',
    '목표수립-HR경영진-02': '전사 목표에 직무 연결이 빈 곳이 많은지 봐줘',
    '목표수립-HR경영진-03': '난이도가 한쪽으로 쏠린 조직이 있는지 알려줘',
    '목표수립-HR경영진-04': '조직마다 난이도 기준이 다른지 비교해서 알려줘',
    '목표수립-HR경영진-05': '상위 목표에 안 붙은 목표가 많은 조직 알려줘',
    '목표수립-HR경영진-06': '전략 방향에 걸린 목표가 부족한지 확인해줘',
    '목표수립-HR경영진-07': '소속이 바뀐 사람이 목표를 다시 세웠는지 봐줘',
    '목표수립-HR경영진-08': '중요한 역량을 다룬 목표가 얼마나 되는지 알려줘',
    '목표수립-HR경영진-09': '같은 이름 핵심결과가 여기저기 쓰이는지 봐줘',
    /* 중간점검 · 구성원 (10) */
    '중간점검-구성원-01': '내 체크인이 너무 오래 밀렸는지 확인해줘',
    '중간점검-구성원-02': '내 진척이 남은 기간에 비해 느린지 알려줘',
    '중간점검-구성원-03': '내 진척이 계속 제자리에 머무는지 확인해줘',
    '중간점검-구성원-04': '상위 목표가 바뀌었는데 내 목표는 그대로인지 봐줘',
    '중간점검-구성원-05': '동료는 기록을 남기는데 나만 밀렸는지 봐줘',
    '중간점검-구성원-06': '이번 달 내 체크인이 비어 있는지 확인해줘',
    '중간점검-구성원-07': '다음 면담에 올릴 안건이 준비됐는지 봐줘',
    '중간점검-구성원-08': '내 핵심결과 중에 기록이 밀린 게 있는지 봐줘',
    '중간점검-구성원-09': '요즘 내 체크인에 자신 없다고 적혔는지 봐줘',
    '중간점검-구성원-10': '같은 걸림돌이 내 기록에 되풀이되는지 봐줘',
    /* 중간점검 · 팀장 (11) */
    '중간점검-팀장-01': '이번 회차에 체크인을 안 한 팀원이 있는지 봐줘',
    '중간점검-팀장-02': '체크인이 오래 밀린 팀원이 누구인지 알려줘',
    '중간점검-팀장-03': '자신 없다고 적은 팀원이 있는지 확인해줘',
    '중간점검-팀장-04': '진척이 팀 평균보다 낮은 팀원이 있는지 봐줘',
    '중간점검-팀장-05': '걸림돌 적힌 팀원과 면담이 밀렸는지 확인해줘',
    '중간점검-팀장-06': '진척이 여러 번 제자리인 팀원이 있는지 봐줘',
    '중간점검-팀장-07': '목표 진행률이 실제 계산과 어긋나는지 봐줘',
    '중간점검-팀장-08': '팀원 기록이 한 항목에만 몰렸는지 확인해줘',
    '중간점검-팀장-09': '기간이 얼마 안 남았는데 진척 낮은 곳 알려줘',
    '중간점검-팀장-10': '면담에서 합의한 일이 그대로 남았는지 봐줘',
    '중간점검-팀장-11': '초과근무는 많은데 기록이 없는 팀원 알려줘',
    /* 중간점검 · 상위조직장 (8) */
    '중간점검-상위조직장-01': '체크인이 저조한 팀이 어디인지 알려줘',
    '중간점검-상위조직장-02': '오래 멈춰 있는 핵심결과가 많은 팀 알려줘',
    '중간점검-상위조직장-03': '하위 팀 사이에 진척 차이가 큰지 확인해줘',
    '중간점검-상위조직장-04': '팀 진척은 올랐는데 조직 목표는 그대로인지 봐줘',
    '중간점검-상위조직장-05': '요즘 팀에서 되풀이되는 걸림돌이 뭔지 알려줘',
    '중간점검-상위조직장-06': '팀 체크인 중에 확신 없다고 적힌 게 많은지 봐줘',
    '중간점검-상위조직장-07': '이번 기간에 기록이 아예 없는 사람이 많은지 봐줘',
    '중간점검-상위조직장-08': '목표 진행률이 실제 진척과 맞는지 확인해줘',
    /* 중간점검 · HR경영진 (9) */
    '중간점검-HR경영진-01': '전사 체크인 참여율이 어느 정도인지 알려줘',
    '중간점검-HR경영진-02': '진행률이 가장 낮은 조직이 어디인지 알려줘',
    '중간점검-HR경영진-03': '협조를 기다리는 걸림돌이 쌓인 곳 알려줘',
    '중간점검-HR경영진-04': '아래는 오르는데 위가 안 움직이는 조직 알려줘',
    '중간점검-HR경영진-05': '전사 기록이 언제부터 멈췄는지 확인해줘',
    '중간점검-HR경영진-06': '자신 없다는 기록이 얼마나 쌓였는지 알려줘',
    '중간점검-HR경영진-07': '여러 조직에 걸친 공통 걸림돌이 뭔지 알려줘',
    '중간점검-HR경영진-08': '초과근무가 늘고 기록은 줄었는지 확인해줘',
    '중간점검-HR경영진-09': '조직 사이 진행률 차이가 큰 곳 알려줘',
    /* 평가 · 구성원 (10) */
    '평가-구성원-01': '자기평가 제출 기한이 얼마나 남았는지 알려줘',
    '평가-구성원-02': '자기평가에 쓸 내 기록이 넉넉한지 확인해줘',
    '평가-구성원-03': '내 자기평가에 숫자 근거가 빠졌는지 봐줘',
    '평가-구성원-04': '자기평가와 기록된 진척이 어긋나는지 봐줘',
    '평가-구성원-05': '소속이 바뀌어 평가자가 달라졌는지 확인해줘',
    '평가-구성원-06': '평가 결과에 의견 낼 기간이 남았는지 알려줘',
    '평가-구성원-07': '자기평가에서 아직 안 쓴 항목이 있는지 봐줘',
    '평가-구성원-08': '어렵게 잡은 항목에 근거가 비었는지 확인해줘',
    '평가-구성원-09': '지난번 받은 의견을 이번에 담았는지 확인해줘',
    '평가-구성원-10': '직무가 바뀐 게 이번 평가에 어떻게 걸리는지 알려줘',
    /* 평가 · 팀장 (11) */
    '평가-팀장-01': '아직 평가를 못 쓴 팀원이 있는지 알려줘',
    '평가-팀장-02': '평가 근거로 쓸 기록이 부족한 팀원 알려줘',
    '평가-팀장-03': '등급에 비해 달성률이 낮은 팀원이 있는지 봐줘',
    '평가-팀장-04': '평가 기간에 팀을 옮겨 온 팀원이 있는지 봐줘',
    '평가-팀장-05': '평가 근거 문장이 너무 짧은 곳이 있는지 봐줘',
    '평가-팀장-06': '우리 팀 등급이 한쪽에 몰렸는지 확인해줘',
    '평가-팀장-07': '같은 등급이 여러 번 이어진 팀원이 있는지 봐줘',
    '평가-팀장-08': '동료 리뷰가 등급에 안 담겼는지 확인해줘',
    '평가-팀장-09': '마감 전에 평가가 비어 있는 팀원이 몇인지 봐줘',
    '평가-팀장-10': '평가 근거가 한쪽 숫자만 담고 있는지 봐줘',
    '평가-팀장-11': '점수가 계속 내려간 팀원이 있는지 알려줘',
    /* 평가 · 상위조직장 (10) */
    '평가-상위조직장-01': '평가 제출이 늦은 팀이 어디인지 알려줘',
    '평가-상위조직장-02': '평가 근거를 짧게 쓴 평가자가 있는지 봐줘',
    '평가-상위조직장-03': '높은 등급을 유독 많이 준 평가자가 있는지 봐줘',
    '평가-상위조직장-04': '등급은 높은데 점수는 낮은 건이 있는지 봐줘',
    '평가-상위조직장-05': '제출 뒤 등급이 바뀐 이유가 남았는지 확인해줘',
    '평가-상위조직장-06': '높은 등급이 유난히 적은 팀이 있는지 알려줘',
    '평가-상위조직장-07': '등급이 크게 움직인 사람이 많은 팀 알려줘',
    '평가-상위조직장-08': '확정 안 된 평가가 얼마나 밀렸는지 알려줘',
    '평가-상위조직장-09': '팀마다 높은 등급 비율이 얼마나 다른지 봐줘',
    '평가-상위조직장-10': '평가 근거에 실제 실적이 인용됐는지 확인해줘',
    /* 평가 · HR경영진 (11) */
    '평가-HR경영진-01': '전사 평가 제출률이 기준에 닿았는지 알려줘',
    '평가-HR경영진-02': '평가 근거가 부실한 조직이 어디인지 알려줘',
    '평가-HR경영진-03': '높은 등급이 유난히 많은 조직 알려줘',
    '평가-HR경영진-04': '조직 사이 등급 기준이 다른지 비교해서 알려줘',
    '평가-HR경영진-05': '진척은 낮은데 등급은 높은 조직 알려줘',
    '평가-HR경영진-06': '소속이 바뀐 사람에게 평가자가 있는지 봐줘',
    '평가-HR경영진-07': '한 등급에 사람이 몰린 조직이 있는지 봐줘',
    '평가-HR경영진-08': '평가 점수 계산에서 빠진 요소가 있는지 봐줘',
    '평가-HR경영진-09': '등급 나누는 기준이 문서로 남아 있는지 봐줘',
    '평가-HR경영진-10': '기록이 없는데 등급을 받은 사람이 있는지 봐줘',
    '평가-HR경영진-11': '작년보다 점수가 크게 움직인 사람 알려줘',
    /* 피드백 · 구성원 (9) */
    '피드백-구성원-01': '다면진단에서 내가 안 쓴 대상이 있는지 봐줘',
    '피드백-구성원-02': '동료 리뷰에서 내가 낮게 나온 역량 알려줘',
    '피드백-구성원-03': '나에게 온 피드백이 누구 것인지 알려줘',
    '피드백-구성원-04': '아직 안 열어 본 피드백이 있는지 확인해줘',
    '피드백-구성원-05': '면담에서 합의한 일을 내가 옮겼는지 확인해줘',
    '피드백-구성원-06': '상향 피드백에 내 응답이 빠졌는지 확인해줘',
    '피드백-구성원-07': '내가 받은 리뷰에 도움말이 적은지 알려줘',
    '피드백-구성원-08': '내가 쓴 리뷰에 의견 칸이 비었는지 확인해줘',
    '피드백-구성원-09': '지난번 개선 약속이 이번 목표에 담겼는지 봐줘',
    /* 피드백 · 팀장 (8) */
    '피드백-팀장-01': '아직 면담을 못 한 팀원이 있는지 알려줘',
    '피드백-팀장-02': '써 둔 피드백을 아직 안 보냈는지 확인해줘',
    '피드백-팀장-03': '새로 온 동료 리뷰가 초안에 담겼는지 봐줘',
    '피드백-팀장-04': '개발 의견이 중요한 역량을 비껴갔는지 봐줘',
    '피드백-팀장-05': '성과가 좋은 팀원에게 다음 과제가 있는지 봐줘',
    '피드백-팀장-06': '작년과 똑같은 의견을 또 쓰고 있는지 확인해줘',
    '피드백-팀장-07': '피드백 기록이 비어 있는 팀원이 몇인지 봐줘',
    '피드백-팀장-08': '오래 피드백을 못 받은 팀원이 있는지 알려줘',
    /* 피드백 · 상위조직장 (6) */
    '피드백-상위조직장-01': '면담 기록이 아예 없는 팀이 있는지 알려줘',
    '피드백-상위조직장-02': '등급 확정 뒤 면담이 밀린 팀이 있는지 알려줘',
    '피드백-상위조직장-03': '낮은 등급인데 육성 의견이 비었는지 확인해줘',
    '피드백-상위조직장-05': '팀마다 면담 실시율이 얼마나 다른지 봐줘',
    '피드백-상위조직장-06': '조직이 바뀐 뒤 면담 담당이 정해졌는지 봐줘',
    '피드백-상위조직장-07': '면담 기록에 다음 합의가 비었는지 확인해줘',
    /* 피드백 · HR경영진 (9) */
    '피드백-HR경영진-01': '전사 면담 완료율이 어느 정도인지 알려줘',
    '피드백-HR경영진-02': '받은 피드백 기록이 얼마나 쌓였는지 알려줘',
    '피드백-HR경영진-03': '다면진단 결과가 있는 사람이 얼마나 되는지 봐줘',
    '피드백-HR경영진-04': '낮은 등급인데 아무 기록도 없는 사람 알려줘',
    '피드백-HR경영진-05': '상향 피드백이 모인 조직이 얼마나 되는지 봐줘',
    '피드백-HR경영진-06': '중요한 역량이 진단에서 낮게 나온 사례 알려줘',
    '피드백-HR경영진-07': '지난 사이클 미완 항목이 남아 있는지 확인해줘',
    '피드백-HR경영진-08': '내보낸 피드백이 실제로 전달됐는지 확인해줘',
    '피드백-HR경영진-09': '낮은 등급 대상 육성 계획이 등록됐는지 봐줘'
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

  /* ---------------------------------------------------------------------
     낱말 묶음(aliases) — 세 겹으로 쌓는다 (19차 §4-1)
       ① KEYS      라이브 15건에 손으로 붙여 둔 낱말 (위)
       ② HINT      나머지 신호에 손으로 보탠 「그 신호를 부르는 말」
       ③ 자동 추출  notice · principle · refs 에서 두 글자 이상 낱말
       ④ 주체 낱말  구성원/팀장/상위조직장/HR경영진 별 공통 호칭
     --------------------------------------------------------------------- */

  /* 주체 → 사용자가 그 신호를 부를 때 쓰는 말 */
  var ACTOR_WORDS = {
    '구성원': ['내', '나', '제 ', '본인'],
    '팀장': ['팀원', '우리 팀', '팀에서', '팀 안'],
    '상위조직장': ['하위 팀', '팀들', '팀마다', '팀 사이', '우리 조직'],
    'HR경영진': ['전사', '회사 전체', '조직마다', '조직 사이', '조직끼리']
  };
  /* 주체 → 답변 머리말에 쓰는 사람 말 */
  var ACTOR_KR = {
    '구성원': '구성원', '팀장': '조직장', '상위조직장': '조직장', 'HR경영진': '인사 담당'
  };

  /* 신호별 손으로 보탠 낱말 — 자동 추출로는 안 잡히는 사용자 말투 */
  var HINT = {
    '목표수립-구성원-01': ['목표 없', '아직 안 세', '확정일', '마감'],
    '목표수립-구성원-02': ['핵심결과 없', '안 붙', '비어'],
    '목표수립-구성원-03': ['가중치', '합', '백'],
    '목표수립-구성원-05': ['직무 바뀐', '예전 과업', '이전 직무'],
    '목표수립-구성원-06': ['상위 목표', '위 목표', '연결 빠'],
    '목표수립-구성원-07': ['개수', '몇 건', '부족', '적은'],
    '목표수립-구성원-11': ['못 끝낸', '미완', '이월', '승계'],
    '목표수립-팀장-01': ['안 세운 팀원', '목표 안 낸', '팀원 목표'],
    '목표수립-팀장-02': ['팀원', '핵심결과 없', '안 붙'],
    '목표수립-팀장-03': ['이름 겹', '중복', '다른 팀'],
    '목표수립-팀장-04': ['팀 목표', '연결 안', '안 붙은'],
    '목표수립-팀장-05': ['새로 온', '합류', '예전 조직', '옮겨'],
    '목표수립-팀장-06': ['한 역량', '쏠', '몰려'],
    '목표수립-팀장-07': ['가중치 몰', '한 곳', '쏠림'],
    '목표수립-팀장-08': ['몇 명', '못 낸', '마감 전'],
    '목표수립-팀장-09': ['미완', '지난 기간', '빠졌'],
    '목표수립-팀장-10': ['목표값', '실적값', '빈 칸', '비었'],
    '목표수립-상위조직장-01': ['수립률', '늦은 팀', '저조'],
    '목표수립-상위조직장-02': ['1차 평가자', '평가자 검토', '검토', '멈춘', '지연', '대기', '확정 안'],
    '목표수립-상위조직장-03': ['난이도', '쉬운', '몰려'],
    '목표수립-상위조직장-06': ['개편', '통합', '목표 주인', '소유'],
    '목표수립-상위조직장-09': ['조직 목표 없', '하위 조직', '빈 조직'],
    '목표수립-HR경영진-01': ['확정률', '전사', '기준'],
    '목표수립-HR경영진-02': ['직무 연결', '빈 목표', '필수'],
    '목표수립-HR경영진-03': ['난이도', '쏠린 조직'],
    '목표수립-HR경영진-04': ['난이도 기준', '조직끼리', '격차'],
    '목표수립-HR경영진-05': ['상위 목표', '미연결', '연결률'],
    '목표수립-HR경영진-06': ['전략', '테마', '방향'],
    '목표수립-HR경영진-07': ['소속 바뀐', '발령', '재수립'],
    '목표수립-HR경영진-08': ['1순위 역량', '중요한 역량', '전사'],
    '목표수립-HR경영진-09': ['같은 이름', '되풀이', '반복', '지표명'],
    '중간점검-구성원-01': ['체크인', '오래', '밀린', '안 쓴'],
    '중간점검-구성원-02': ['진척', '느린', '뒤처', '기간 대비'],
    '중간점검-구성원-03': ['제자리', '안 오르', '멈춰', '그대로'],
    '중간점검-구성원-04': ['상위 목표 바뀐', '내 목표', '그대로'],
    '중간점검-구성원-05': ['동료', '나만', '밀렸'],
    '중간점검-구성원-06': ['이번 달', '체크인 없', '마감'],
    '중간점검-구성원-07': ['면담', '안건', '준비'],
    '중간점검-구성원-09': ['자신 없', '확신', '낮음'],
    '중간점검-구성원-10': ['걸림돌', '장애', '되풀이', '반복'],
    '중간점검-팀장-01': ['이번 회차', '체크인 안 한', '팀원'],
    '중간점검-팀장-02': ['오래 밀린', '간격', '누구'],
    '중간점검-팀장-03': ['자신 없', '확신', '팀원'],
    '중간점검-팀장-04': ['팀 평균', '낮은 팀원', '진척'],
    '중간점검-팀장-05': ['걸림돌', '면담 밀', '1on1'],
    '중간점검-팀장-06': ['제자리', '여러 번', '증감'],
    '중간점검-팀장-07': ['진행률', '어긋', '가중평균'],
    '중간점검-팀장-08': ['한 항목', '몰린', '쏠린'],
    '중간점검-팀장-09': ['기간 남', '진척 낮', '마무리'],
    '중간점검-팀장-10': ['합의', '면담', '그대로 남'],
    '중간점검-팀장-11': ['초과근무', '야근', '기록 없'],
    '중간점검-상위조직장-01': ['체크인율', '저조한 팀', '마감'],
    '중간점검-상위조직장-02': ['멈춘', '오래', '핵심결과', '간격'],
    '중간점검-상위조직장-04': ['조직 목표', '안 움직', '그대로'],
    '중간점검-상위조직장-07': ['기록 없는 사람', '참여', '0건'],
    '중간점검-HR경영진-01': ['참여율', '전사', '체크인율'],
    '중간점검-HR경영진-02': ['가장 낮은 조직', '진행률'],
    '중간점검-HR경영진-03': ['협조', '기다리', '쌓인', '병목'],
    '중간점검-HR경영진-04': ['상위', '하위', '안 움직'],
    '중간점검-HR경영진-05': ['언제부터', '멈췄', '전사 기록'],
    '중간점검-HR경영진-06': ['자신 없', '확신', '쌓인'],
    '중간점검-HR경영진-07': ['공통', '여러 조직', '병목', '연동'],
    '중간점검-HR경영진-08': ['초과근무', '늘었', '줄었'],
    '평가-구성원-01': ['자기평가', '제출', '기한', '마감'],
    '평가-구성원-03': ['숫자', '수치', '근거 없'],
    '평가-구성원-04': ['어긋', '과장', '진척과 다'],
    '평가-구성원-05': ['소속 바뀌', '평가자 달라', '전환'],
    '평가-구성원-06': ['의견', '이의', '기간 남'],
    '평가-구성원-07': ['안 쓴', '빈 항목', '서술'],
    '평가-구성원-08': ['난이도 근거', '어렵게', '비었'],
    '평가-구성원-09': ['지난번 의견', '리더 의견', '반영'],
    '평가-팀장-01': ['평가 안 쓴', '못 쓴 팀원', '작성'],
    '평가-팀장-02': ['근거 부족', '기록 적', '팀 평균'],
    '평가-팀장-03': ['등급', '달성률', '낮은'],
    '평가-팀장-04': ['옮겨 온', '전입', '평가 기간'],
    '평가-팀장-05': ['짧은', '요약문', '근거 문장'],
    '평가-팀장-06': ['한쪽에 몰', '쏠림', '등급 분포'],
    '평가-팀장-07': ['같은 등급', '여러 기간', '이어진'],
    '평가-팀장-08': ['동료 리뷰', '반영 안', '등급'],
    '평가-팀장-09': ['비어 있는 팀원', '마감', '몇 명'],
    '평가-팀장-10': ['한쪽 숫자', '달성률만', '근거'],
    '평가-팀장-11': ['점수 내려', '하락', '낮은 등급'],
    '평가-상위조직장-01': ['제출 늦', '제출률', '팀'],
    '평가-상위조직장-02': ['짧게', '근거', '평가자'],
    '평가-상위조직장-03': ['후하', '높은 등급', '평가자'],
    '평가-상위조직장-04': ['등급 높', '점수 낮', '어긋'],
    '평가-상위조직장-05': ['등급 바뀐', '변경 사유', '제출 뒤'],
    '평가-상위조직장-06': ['적은 팀', '박하', '높은 등급'],
    '평가-상위조직장-07': ['등급 움직', '변동', '두 단계'],
    '평가-상위조직장-08': ['확정 안', '대기', '밀린'],
    '평가-상위조직장-09': ['팀마다', '비율', '격차'],
    '평가-상위조직장-10': ['실적 인용', '달성값', '근거'],
    '평가-HR경영진-01': ['제출률', '전사', '마감'],
    '평가-HR경영진-02': ['부실', '짧은 근거', '조직'],
    '평가-HR경영진-03': ['높은 등급 많', '관대', '조직'],
    '평가-HR경영진-04': ['눈금', '기준 다', '격차'],
    '평가-HR경영진-05': ['진척 낮', '등급 높', '어긋'],
    '평가-HR경영진-06': ['평가자 없', '소속 바뀐', '지정'],
    '평가-HR경영진-07': ['한 등급', '몰린', '상한'],
    '평가-HR경영진-08': ['산식', '빠진 요소', '역산'],
    '평가-HR경영진-09': ['등급 경계', '문서', '규정'],
    '평가-HR경영진-10': ['기록 없', '등급 받', '근거 없'],
    '평가-HR경영진-11': ['작년', '전년', '크게 움직'],
    '피드백-구성원-01': ['다면진단', '안 쓴', '제출 기한'],
    '피드백-구성원-02': ['동료 리뷰', '낮게 나온', '역량'],
    '피드백-구성원-03': ['누가', '누구', '보낸 사람'],
    '피드백-구성원-04': ['안 열어', '읽지', '받은 피드백'],
    '피드백-구성원-05': ['합의', '면담', '옮겼'],
    '피드백-구성원-06': ['상향', '응답', '나만'],
    '피드백-구성원-07': ['도움말', '개발 의견', '적은'],
    '피드백-구성원-08': ['내가 쓴', '의견 칸', '비었'],
    '피드백-구성원-09': ['개선 약속', '지난 사이클', '이어'],
    '피드백-팀장-01': ['면담 못 한', '면담 기록', '팀원'],
    '피드백-팀장-02': ['안 보낸', '초안', '발송'],
    '피드백-팀장-03': ['새 리뷰', '도착', '초안 반영'],
    '피드백-팀장-04': ['개발 의견', '비껴', '중요한 역량'],
    '피드백-팀장-05': ['성과 좋', '다음 과제', '개발 항목'],
    '피드백-팀장-06': ['작년', '똑같은', '되풀이'],
    '피드백-팀장-07': ['비어 있는 팀원', '몇 명', '기록 없'],
    '피드백-팀장-08': ['오래', '못 받은', '빈도'],
    '피드백-상위조직장-01': ['면담 없는 팀', '기록 0', '하위 팀'],
    '피드백-상위조직장-02': ['등급 확정', '면담 밀', '실시율'],
    '피드백-상위조직장-03': ['낮은 등급', '육성 의견', '비었'],
    '피드백-상위조직장-05': ['실시율', '팀마다', '격차'],
    '피드백-상위조직장-06': ['개편', '담당 없', '지정'],
    '피드백-상위조직장-07': ['합의 항목', '다음 기간', '비었'],
    '피드백-HR경영진-01': ['완료율', '전사 면담', '기한'],
    '피드백-HR경영진-02': ['쌓인', '받은 피드백', '오래된'],
    '피드백-HR경영진-03': ['다면진단', '결과 있는', '몇 명'],
    '피드백-HR경영진-04': ['낮은 등급', '기록 없', '설명 없'],
    '피드백-HR경영진-05': ['상향 피드백', '모인 조직', '익명'],
    '피드백-HR경영진-06': ['중요한 역량', '최하위', '진단'],
    '피드백-HR경영진-07': ['미완', '항목 단위', '승계'],
    '피드백-HR경영진-08': ['전달', '열람', '도달'],
    '피드백-HR경영진-09': ['육성 계획', '낮은 등급', '등록']
  };

  /* 자동 추출에서 걸러낼 말 — 어느 신호에나 나오는 껍데기 */
  var STOP = ('것 곳 때 수 중 안 밖 뒤 앞 위 아래 이번 지난 다음 최근 오늘 우리 본인 사람 인원 대상 상태 경우 기준 기간 '
    + '건수 비율 항목 내용 값 관련 해당 일정 여부 확인 필요 가운데 이상 이하 미만 초과 정도 이유 방법 문제 '
    + '있을 없을 넘을 남을 있는 없는 되는 하는 한다 된다 한다면 그대로 아직 다시 함께 서로 모두 여럿 여러 '
    + '동안 이어 이어질 이어서 넘게 못한 못할 크게 거의 상당 일부 전체 하나 둘 셋 각각 별로 이런 저런 그런 '
    + '알림 신호 기록 자료 데이터 화면 목록 명단 정보 항 등').split(/\s+/);
  var STOPSET = {};
  (function () { var i; for (i = 0; i < STOP.length; i++) STOPSET[STOP[i]] = 1; })();
  /* 조사·어미 꼬리 — 낱말 끝에서 잘라 낸다 */
  var TAIL = ['에서는', '으로는', '까지', '부터', '에서', '으로', '보다', '한테', '에게', '이나', '라도',
    '이라', '으로서', '처럼', '마다', '이며', '이고', '과의', '와의', '의', '이', '가', '은', '는', '을', '를',
    '에', '도', '만', '과', '와', '로', '나', '요'];

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
  /* 그 신호를 부르는 사용자 말투 질문 — 150건 전부 (§4-1) */
  function questionFor(id) {
    var q = QMAP[S(id)];
    if (q) return q;
    var stage = S(id).split('-')[0];
    return STARTER_GEN[stage] || '지금 챙길 게 있는지 봐줘';
  }
  /* STARTER 는 이제 「보내는 문장」이 아니다 — 낱말 대조(scoreOf·qHitLen)에만 쓴다.
     사용자에게 보이고 실제로 전송되는 문장은 QMAP 하나뿐이다(20차). 카탈로그 엑셀
     「이 알림을 부르는 질문」 열이 QMAP 을 그대로 옮긴 것이라, 표에 적힌 문장과
     화면·전송 문장이 갈라지면 그 표가 거짓이 된다. */
  function starterFor(id) {
    return questionFor(id);
  }

  /* 카탈로그 뒤지기 — 라이브가 아니어도 신호 원본은 늘 찾을 수 있다 */
  function allSignals() {
    var e = ENG(), cat = e && e.catalog && e.catalog();
    return (cat && cat.signals) ? cat.signals : [];
  }
  var sigCache = null;
  function sigById(id) {
    var list, i;
    if (!sigCache) {
      sigCache = {};
      list = allSignals();
      for (i = 0; i < list.length; i++) sigCache[list[i].id] = list[i];
    }
    return sigCache[S(id)] || null;
  }

  /* ===================== 5-2. 낱말 묶음 ===================== */
  /* 한글 덩어리를 뽑아 조사 꼬리를 떼고 두 글자 이상만 남긴다 */
  function nouns(text, bag) {
    var chunks = S(text).split(/[^가-힣]+/), i, j, w;
    for (i = 0; i < chunks.length; i++) {
      w = chunks[i];
      if (!w || w.length < 2) continue;
      for (j = 0; j < TAIL.length; j++) {
        if (w.length - TAIL[j].length >= 2 && w.slice(-TAIL[j].length) === TAIL[j]) {
          w = w.slice(0, w.length - TAIL[j].length);
          break;
        }
      }
      if (w.length < 2 || w.length > 7) continue;
      if (STOPSET[w]) continue;
      bag[w] = 1;
    }
  }
  var aliasCache = {};
  function aliases(id) {
    var key = S(id);
    if (aliasCache[key]) return aliasCache[key];
    var sig = sigById(key), bag = {}, out = [], k, i, src;
    src = (KEYS[key] || []).concat(HINT[key] || []);
    for (i = 0; i < src.length; i++) if (src[i]) bag[src[i]] = 1;
    if (sig) {
      nouns(sig.notice, bag);
      nouns(sig.principle, bag);
      nouns(sig.refs, bag);
      src = ACTOR_WORDS[sig.actor] || [];
      for (i = 0; i < src.length; i++) bag[src[i]] = 1;
    }
    nouns(questionFor(key), bag);
    for (k in bag) if (Object.prototype.hasOwnProperty.call(bag, k)) {
      if (k.replace(/\s+/g, '').length >= 2) out.push(k);
    }
    /* 긴 낱말이 먼저 걸리도록 */
    out.sort(function (a, b) { return b.length - a.length; });
    if (out.length > 30) out = out.slice(0, 30);
    aliasCache[key] = out;
    return out;
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

  /* 낱말 겹침으로 주제 찾기 — 세 글자 이상 2점 · 두 글자 1점 · 질문 부분일치 99 (§4-1) */
  function squash(s) { return S(s).replace(/\s+/g, ''); }
  function scoreOf(id, text) {
    var ks = aliases(id), i, sc = 0, t = S(text), flat = squash(text);
    var qs = [questionFor(id), STARTER[id]], q;
    for (i = 0; i < qs.length; i++) {
      q = qs[i];
      if (q && flat.indexOf(squash(q)) >= 0) return 99;
    }
    for (i = 0; i < ks.length; i++) {
      if (squash(ks[i]).length >= 3) { if (flat.indexOf(squash(ks[i])) >= 0) sc += 2; }
      else if (t.indexOf(ks[i]) >= 0) sc += 1;
    }
    return sc;
  }
  /* 99가 여럿이면 더 긴 질문이 이긴다 */
  function qHitLen(id, text) {
    var flat = squash(text), qs = [questionFor(id), STARTER[id]], i, best = 0, f;
    for (i = 0; i < qs.length; i++) {
      if (!qs[i]) continue;
      f = squash(qs[i]);
      if (flat.indexOf(f) >= 0 && f.length > best) best = f.length;
    }
    return best;
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
    var m = matchAny(text, role);
    return (m && m.inst) ? m.inst : null;
  }

  /* ===================== 6-2. 150건 전체 대조 (§4-1) ===================== */
  /* 역할 밖 신호도 후보에 넣는다. 역할은 동점을 가르는 데 쓴다.
     동점 순서 = ①질문 일치 길이 ②역할 일치 ③실계산 가능(now:1) ④도움 점수.
     역할이 안 맞는 답은 실수치가 붙어도 사용자에게 틀린 답이다. 역할이 맞는데
     예시값인 것은 §4-2 세 문단이 예시라고 밝히므로 손해가 없다. */
  function instOfSig(id, rk) {
    var e = ENG();
    if (!e || !e.instance) return null;
    try { return e.instance(id, rk); } catch (e0) { return null; }
  }
  function inRole(sig, rk) {
    return !!(sig && sig.roles && sig.roles.length && sig.roles.indexOf(rk) >= 0);
  }
  function helpOf(sig) { return (sig && sig.score && sig.score.help) || 0; }

  /* matchAny(text, role) → {id, sig, inst, score, live, mine} | null */
  function matchAny(text, role) {
    var t = S(text);
    if (!t) return null;
    var rk = roleKey(role), list = allSignals(), i, sig, sc;
    var best = null, bestSc = 0, bestQ = 0;
    for (i = 0; i < list.length; i++) {
      sig = list[i];
      sc = scoreOf(sig.id, t);
      if (sc < 3) continue;
      var qlen = (sc >= 99) ? qHitLen(sig.id, t) : 0;
      if (best) {
        if (sc < bestSc) continue;
        if (sc === bestSc) {
          if (qlen !== bestQ) { if (qlen < bestQ) continue; }
          else if (inRole(sig, rk) !== inRole(best, rk)) { if (!inRole(sig, rk)) continue; }
          else if ((sig.now === 1) !== (best.now === 1)) { if (sig.now !== 1) continue; }
          else if (helpOf(sig) <= helpOf(best)) continue;
        }
      }
      best = sig; bestSc = sc; bestQ = qlen;
    }
    if (!best) return null;
    return {
      id: best.id, sig: best, inst: instOfSig(best.id, rk),
      score: bestSc, live: best.now === 1, mine: inRole(best, rk)
    };
  }

  /* catalogQuestions(role) → [{id, q, live, mine, stage, actor}]
     150건 전부를 돌려준다. 내 역할 것이 앞, 나머지가 뒤(질문 브라우저가 그대로 묶어 쓴다). */
  function catalogQuestions(role) {
    var rk = roleKey(role), list = allSignals(), rows = [], i, sig;
    for (i = 0; i < list.length; i++) {
      sig = list[i];
      rows.push({
        id: sig.id, q: questionFor(sig.id), live: sig.now === 1,
        mine: inRole(sig, rk), stage: sig.stage, actor: sig.actor,
        stageNo: sig.stageNo || 0, actorNo: sig.actorNo || 0, no: sig.no || 0
      });
    }
    rows.sort(function (a, b) {
      if (a.mine !== b.mine) return a.mine ? -1 : 1;
      if (a.stageNo !== b.stageNo) return a.stageNo - b.stageNo;
      if (a.actorNo !== b.actorNo) return a.actorNo - b.actorNo;
      return a.no - b.no;
    });
    return rows;
  }

  /* suggested(role) → 대표 질문 6개. 라이브·미처리 우선, 부족분은 도움 점수 순.
     각 질문이 실제로 그 주제를 불러오는지 스스로 확인한 것만 돌려준다 (§4-3). */
  function suggested(role) {
    var rk = roleKey(role), out = [], seen = {}, i, id, q, m;
    function take(id, live) {
      if (out.length >= 6 || seen[id]) return;
      q = questionFor(id);
      m = matchAny(q, rk);
      if (!m || m.id !== id) return;      /* 자체 검사 — 통과한 것만 */
      seen[id] = 1;
      out.push({ q: q, id: id, live: !!live });
    }
    var e = ENG(), a = [];
    try { a = a.concat(e && e.pending ? e.pending(rk) : []); } catch (e0) {}
    try { a = a.concat(e && e.live ? e.live(rk) : []); } catch (e1) {}
    for (i = 0; i < a.length; i++) if (a[i]) take(a[i].id, true);
    /* 그다음 = 내 역할 신호를 라이브 → 도움 점수 → 카탈로그 순으로 */
    var mine = [], list = allSignals();
    for (i = 0; i < list.length; i++) if (inRole(list[i], rk)) mine.push(list[i]);
    mine.sort(function (x, y) {
      if ((x.now === 1) !== (y.now === 1)) return (x.now === 1) ? -1 : 1;
      if (helpOf(x) !== helpOf(y)) return helpOf(y) - helpOf(x);
      if ((x.stageNo || 0) !== (y.stageNo || 0)) return (x.stageNo || 0) - (y.stageNo || 0);
      return (x.no || 0) - (y.no || 0);
    });
    for (i = 0; i < mine.length && out.length < 6; i++) take(mine[i].id, mine[i].now === 1);
    return out;
  }

  /* ===================== 6-3. 아직 못 세는 신호를 사람 말로 ===================== */

  /* 카탈로그 문안에 남은 자리표시자 — 화면에도 프롬프트에도 그대로 내보내지 않는다.
     (발송 문안 검사는 D가 따로 하므로 scrub 은 건드리지 않고 여기서만 지운다) */
  function phrase(text) {
    var s = scrub(text);
    s = s.replace(/\{\{\s*팀원명\s*\}\}\s*님?/g, '어떤 팀원');
    s = s.replace(/\{\{\s*조직명\s*\}\}/g, '어떤 조직');
    s = s.replace(/\{\{[^}]*\}\}/g, '');
    return tidy(s);
  }
  /* 받침이 있으면 이, 없으면 가 */
  function subjP(word) {
    var w = S(word), c = w.charCodeAt(w.length - 1);
    if (c >= 0xAC00 && c <= 0xD7A3) return ((c - 0xAC00) % 28 !== 0) ? '이' : '가';
    return '이';
  }
  /* 무엇이 없어서 못 세는가 — todoCreate → todoDecide → refs 순 */
  function missingThing(sig) {
    if (!sig) return '';
    var tc = S(sig.todoCreate).replace(/^\s+|\s+$/g, '');
    if (tc && tc.length >= 2) return phrase(tc.replace(/[.。]$/, ''));
    var td = S(sig.todoDecide);
    var m = td.match(/(.{2,44}?)(?:이|가)\s*(?:없어|없고|없으|비어|남지\s*않아)/);
    if (m && m[1]) return phrase(m[1].replace(/^[^가-힣]*/, ''));
    var refs = S(sig.refs).split(/\s*;\s*/);
    if (refs.length && refs[refs.length - 1]) return phrase(refs[refs.length - 1]);
    return '';
  }
  /* principle → 사람 말 한 문장. lead 는 앞에 붙일 말머리 */
  function watchLine(sig, lead) {
    var p = phrase(sig && sig.principle), head = (lead == null) ? '이건 ' : lead;
    if (!p) return '';
    p = p.replace(/[.。]$/, '');
    if (/때$/.test(p)) return head + p + ' 알려 드리는 알림이에요.';
    return head + p + ' 상황을 지켜보는 알림이에요.';
  }
  /* 처리 초안 첫 문장 — 이어서 도울 수 있는 일 */
  function helpShort(sig) {
    var acts = ((sig && sig.actions) || []).slice().sort(function (a, b) { return (a.rank || 9) - (b.rank || 9); });
    var i, act = null;
    for (i = 0; i < acts.length; i++) if (acts[i].type !== 'A5') { act = acts[i]; break; }
    if (!act) act = acts[0] || null;
    if (!act || !act.draft) return '';
    return phrase(cut(S(act.draft).split(/[.。]\s*/)[0], 70));
  }
  /* 역할 밖 신호를 물었을 때 앞에 붙이는 한 줄 (§4-1) */
  function offRoleLine(sig, rk) {
    if (!sig || inRole(sig, rk)) return '';
    var who = ACTOR_KR[sig.actor] || '다른 분';
    return '이건 ' + who + '이 받는 알림인데, 궁금하실 테니 지금 보이는 만큼만 말씀드릴게요.';
  }
  /* 이 인스턴스가 실제로 세어진 것인가 */
  function isLive(inst) {
    if (!inst) return false;
    var sig = inst.sig || inst;
    return !!(sig && sig.now === 1 && inst.ready);
  }

  /* ============ 6-4. 화면에 그대로 나가는 신호 답변 (20-3차) ============
     여태 신호는 「보이지 않는 참고 자료」로만 모델에 실렸다. 그래서 모델이 자기
     문장으로 녹여 버리면 카탈로그의 알림 문구가 화면에서 사라졌다 —
     「질문을 넣었는데 그 알림이 안 보인다」는 말이 그것이다.
     이 함수는 모델을 거치지 않고 카탈로그·엔진 값만으로 답의 뼈대를 만든다.
     화면(tx_elizax)이 이것을 말풍선으로 그리고, 모델은 그 뒤에 덧붙이는 말만 한다.

     세 갈래를 반드시 가른다 — 셋을 섞으면 없는 문제를 있다고 말하게 된다.
       ① 실계산 + 참  → 알림 문구를 실측 그대로 (`notice`)
       ② 실계산 + 거짓 → 「지금은 뜰 상태가 아니에요」 + 언제 뜨는 알림인지
       ③ 실계산 못 함  → 예시라고 밝히고, 먼저 남아야 하는 기록을 말한다        */
  var EDIT_TAIL = /\s*\([^)]*(?:할 수 있어요|가능)\)\s*$/;
  function answerBlocks(x, role) {
    var inst = instOf(x);
    if (!inst) return null;
    var sig = inst.sig || inst, rk = roleKey(role);
    var live = isLive(inst), hit = !!inst.hit;
    var ev = live ? pickEvidence(inst) : { sure: [], soft: [] };
    var out = {
      id: sig.id, live: live, hit: hit, stage: sig.stage, actor: sig.actor,
      lead: '', notice: '', asof: live ? S(inst.asof) : '',
      sure: ev.sure, soft: ev.soft,
      th: live ? thresholdLines(inst) : [],
      demo: [],   /* 실계산 못 하는 신호의 「예시 근거」 — 실측과 절대 섞지 않는다 */
      note: '', off: offRoleLine(sig, rk) || '', actions: []
    };
    if (live && hit) {
      out.notice = scrub(inst.notice);
    } else if (live) {
      out.notice = '지금은 이 알림이 뜰 상태가 아니에요.';
      out.note = '이 알림이 뜨는 때 : ' + phrase(sig.principle);
    } else {
      out.lead = '아직 회사 기록으로 실제 수를 세지 못하는 알림이라, 아래 문구의 숫자는 예시예요.';
      out.notice = phrase(inst.notice || sig.notice);
      var miss = missingThing(sig);
      out.note = miss ? '먼저 남아야 하는 기록 : ' + cut(miss, 90) : (watchLine(sig, '') || '');
      /* 뒷받침이 아예 없으면 알림 문구만 떠서 근거 없는 단정처럼 읽힌다.
         카탈로그가 적어 둔 근거 줄을 「예시」로 밝혀 두 줄까지 보인다 (실측이 아니다). */
      var cev = (sig.evidence || []), basic = [], rest = [];
      for (var ci = 0; ci < cev.length; ci++) {
        var ct = phrase(cev[ci].text);
        if (!ct) continue;
        (cev[ci].show === '기본' ? basic : rest).push(ct);
      }
      out.demo = basic.concat(rest).slice(0, 2);
    }
    /* 처리 단추 — 참일 때만 쓰는 처리를 내놓는다. 그 밖에는 보기만 하는 처리 하나.
       `idx` 는 `sig.actions` 원본 자리번호다(EZSignalAct.run 이 그 번호로 찾는다). */
    var acts = (sig.actions || []).map(function (a, i) { return { a: a, i: i }; });
    acts.sort(function (p, q) { return (p.a.rank || 9) - (q.a.rank || 9); });
    var pick = [];
    if (live && hit) pick = acts.slice(0, 2);
    else {
      for (var k = 0; k < acts.length; k++) if (acts[k].a.type === 'A5') { pick = [acts[k]]; break; }
    }
    for (var j = 0; j < pick.length; j++) {
      var nm = scrub(S(pick[j].a.label).replace(EDIT_TAIL, ''));
      if (!nm) continue;
      out.actions.push({ idx: pick[j].i, label: cut(nm, 28) });
    }
    return out;
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
        out.push(nm + ' : 회사가 보는 잠정 기준 ' + scrub(th[i].value) + ', 지금 측정값 ' + scrub(th[i].actual));
      } else {
        out.push(nm + ' : 회사 기준이 아직 확정되지 않아 잠정으로 ' + scrub(th[i].value) + '로 봤어요');
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
  function blockFor(inst, role) {
    if (!inst) return '';
    if (!isLive(inst)) return blockForPending(inst, role);
    var L = [], ev = pickEvidence(inst), i;
    var src = sourceWords(inst), th = thresholdLines(inst), help = helpLine(inst);
    L.push('[참고 자료 — 사용자에게 그대로 보여 주지 마세요]');
    var off = offRoleLine(inst.sig || inst, roleKey(role));
    if (off) L.push('먼저 이 한 문장으로 시작하세요: ' + off);
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

  /* 아직 못 세는 신호(135건)의 참고 블록 — 단정 금지·예시 명시 (§4-2) */
  function blockForPending(inst, role) {
    var sig = (inst && (inst.sig || inst)) || null;
    if (!sig) return '';
    var L = [], rk = roleKey(role);
    var off = offRoleLine(sig, rk), miss = missingThing(sig);
    var notice = phrase(inst.notice || sig.notice), help = helpShort(sig), watch = watchLine(sig);
    L.push('[참고 자료 — 사용자에게 그대로 보여 주지 마세요]');
    L.push('이 주제는 아직 회사 데이터로 실제 수를 세지 못하는 알림입니다. 아래 숫자는 전부 예시입니다.');
    if (off) L.push('먼저 이 한 문장으로 시작하세요: ' + off);
    if (watch) L.push('무엇을 보는 알림인가: ' + watch);
    if (miss) L.push('아직 남지 않은 기록: ' + cut(miss, 80));
    if (notice) L.push('기록이 갖춰졌을 때 나갈 예시 문구: ' + cut(notice, 120));
    if (help) L.push('그때 이어서 도울 수 있는 일: ' + cut(help, 140));
    L.push('[이 답변에서 반드시 지킬 것]');
    L.push('1. 위 예시 문구의 숫자를 지금 회사의 실제 값처럼 말하지 않습니다. 반드시 예시라고 밝힙니다.');
    L.push('2. 왜 아직 못 세는지를 「아직 남지 않은 기록」을 사람 말로 풀어 한 문장으로 말합니다.');
    L.push('3. 세 덩어리로 씁니다 — 무엇을 보는 알림인지, 왜 아직 못 세는지, 기록이 갖춰지면 어떻게 알려 주는지.');
    L.push('4. 없는 숫자를 새로 만들지 않고, 확인된 것처럼 단정하지 않습니다.');
    L.push(styleRules());
    return tidy2(L.join('\n'));
  }
  /* 줄바꿈은 살리면서 줄마다 정리한다 */
  function tidy2(text) {
    var lines = S(text).split('\n'), out = [], i;
    for (i = 0; i < lines.length; i++) out.push(tidy(lines[i]));
    return out.join('\n');
  }

  /* contextFor — ①ask()가 걸어 둔 주제 ②150건 전체 대조 ③이어 묻는 말이면 앞 주제 */
  function contextFor(userText, role) {
    var t = S(userText), inst = null, m;
    if (armed) { inst = armed; armed = null; }
    if (!inst && t) {
      m = matchAny(t, role);
      if (m) {
        inst = m.inst || m.sig;
        cur = inst;
      }
    }
    if (!inst && cur && isFollowUp(t)) inst = cur;
    if (!inst) return '';
    return blockFor(inst, role);
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
  function answerText(x, role) {
    var inst = instOf(x) || (typeof x === 'string' ? sigById(x) : null);
    if (!inst) return '';
    if (!isLive(inst)) return pendingAnswer(inst, role);
    var ev = pickEvidence(inst), out = [], i;
    var off = offRoleLine(inst.sig || inst, roleKey(role));
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
      out.push(sent(ev.soft[0] + '. 이 부분은 아직 확인되지 않아 잠정으로 봤어요'));
    }
    var close = scrub(inst.agent || (inst.sig && inst.sig.agent) || '');
    if (close) out.push(sent(close));
    else out.push('어디부터 손대면 좋을지 같이 볼까요?');
    out = out.slice(0, 6);
    if (off) out.unshift(off);
    return out.join(' ');
  }

  /* 아직 못 세는 신호(135건)의 답변 — 세 문단, 예시임을 반드시 밝힌다 (§4-2) */
  function pendingAnswer(inst, role) {
    var sig = (inst && (inst.sig || inst)) || null;
    if (!sig) return '';
    var rk = roleKey(role), P = [];
    var off = offRoleLine(sig, rk);
    var watch = watchLine(sig, off ? '이 알림은 ' : '이건 ');
    var miss = missingThing(sig);
    var notice = phrase((inst && inst.notice) || sig.notice);
    var help = helpShort(sig);

    /* ① 무엇을 보는 알림인가 */
    P.push((off ? off + ' ' : '')
      + (watch || (off ? '이 알림은 ' : '이건 ') + '성과 기록을 지켜보다가 챙길 게 생기면 알려 드리는 알림이에요.'));

    /* ② 왜 아직 못 세는가 */
    if (miss) {
      P.push('지금 회사 데이터에는 ' + miss + subjP(miss) + ' 남지 않아 실제로 세지는 못했어요. '
        + '그래서 몇 건인지 숫자로 말씀드릴 수가 없어요.');
    } else {
      P.push('지금 회사 데이터에는 이 알림에 필요한 기록이 남지 않아 실제로 세지는 못했어요. '
        + '그래서 몇 건인지 숫자로 말씀드릴 수가 없어요.');
    }

    /* ③ 갖춰지면 이렇게 알려 준다 (예시임을 밝힌다) */
    var p3 = '기록이 갖춰지면 이렇게 알려드려요 : 「' + notice + '」 '
      + '여기 숫자는 실제로 센 값이 아니라 예시로 적어 둔 거예요.';
    if (help) p3 += ' 그때는 「' + help + '」 같은 문안까지 대신 잡아 드릴 수 있어요.';
    P.push(p3);

    return P.join('\n\n');
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
    suggested: suggested,
    questionFor: questionFor,
    aliases: aliases,
    matchAny: matchAny,
    catalogQuestions: catalogQuestions,
    ask: ask,
    contextFor: contextFor,
    answerBlocks: answerBlocks,   /* 화면이 그대로 그리는 신호 답변 (20-3차) */
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
