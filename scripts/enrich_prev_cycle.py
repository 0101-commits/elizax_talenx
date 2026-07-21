# -*- coding: utf-8 -*-
"""enrich_prev_cycle.py — PLAN-11 F6 carry-over 실데이터 주입 (2026-07-21)

talenx_data.js 최상위에 전년(FY2025) 기록 데이터 추가:
1) evaluationsPrev[]  — EMP-0078·EMP-0035·EMP-0191 FY2025 평가 상세(KR 달성률, 미완 KR 포함)
                        grade/score는 기존 evalHistory FY2025와 일치
2) feedbackHistory[]  — 같은 인물 FY2025 피드백(peer/leader 혼합)
                        EMP-0078 leader 건은 tx_agent.js:526 "협업 리드 경험을 늘려 달라" 취지 유지
3) upwardFeedback[]   — ORG-030(김명숙, respondents=5 정상) + ORG-034(김정희, respondents=2 임계 미달)
4) employees[EMP-0078].jobHistory — FY2026 데이터분석담당(JOB-소프트-024)→서비스기획담당(JOB-소프트-080) 전환

멱등: 키 단위 전체 재대입 — 재실행해도 결과 동일. 입출력 = js/talenx_data.js (단일 라인 JSON 래핑 유지)
"""
import io, json, os

BASE = os.path.join(os.path.dirname(__file__), '..')
PATH = os.path.join(BASE, 'js', 'talenx_data.js')

s = io.open(PATH, encoding='utf-8').read()
prefix, suffix = 'window.TALENX_DATA = ', ';'
j = json.loads(s[len(prefix):s.rindex('}') + 1])

keys_before = set(j.keys())

# ---------- FK 사전 ----------
emps = {e['emp_id']: e for e in j['employees']}
orgs = {o['org_id']: o for o in j['orgs']}
eh = {h['emp_id']: {x['period']: x for x in h['history']} for h in j['evalHistory']}

def fy25(emp_id):
    return eh[emp_id]['FY2025']

# ---------- 1) evaluationsPrev ----------
# grade/score = evalHistory FY2025 그대로 (단일 소스 정합)
j['evaluationsPrev'] = [
    {
        'evaluation_id': 'EVAL-2025-0078', 'emp_id': 'EMP-0078', 'period': 'FY2025',
        'krs': [
            {'name': '서비스 이용 데이터 월간 분석 리포트 12회 발행', 'achievement_pct': 100, 'done': True},
            {'name': '고객 이탈 예측 지표 정확도 75% 달성', 'achievement_pct': 88, 'done': True},
            {'name': 'VOC 데이터 분류 체계 구축 및 태깅 자동화', 'achievement_pct': 60, 'done': False},
            {'name': '유관 조직 합동 데이터 활용 워크숍 2회 운영', 'achievement_pct': 50, 'done': False},
        ],
        'grade': fy25('EMP-0078')['grade'], 'score': fy25('EMP-0078')['score'],
        'rationale_summary': '월간 분석 리포트와 이탈 예측 지표는 목표를 채웠으나, VOC 분류 자동화(60%)와 합동 워크숍(50%)이 미완으로 남음. 분석 결과를 실행으로 잇는 협업 리드 경험이 개선 과제로 지목됨.',
    },
    {
        'evaluation_id': 'EVAL-2025-0035', 'emp_id': 'EMP-0035', 'period': 'FY2025',
        'krs': [
            {'name': '고객사 평가제도 진단 보고서 6건 납품', 'achievement_pct': 100, 'done': True},
            {'name': '평가제도 컨설팅 표준 방법론 v2 문서화', 'achievement_pct': 90, 'done': True},
            {'name': '진단 결과 후속 계약 전환율 40% 달성', 'achievement_pct': 55, 'done': False},
        ],
        'grade': fy25('EMP-0035')['grade'], 'score': fy25('EMP-0035')['score'],
        'rationale_summary': '진단 납품과 방법론 문서화는 안정적으로 달성. 후속 계약 전환율(55%)이 미완으로 남아 제안 단계 관여 확대가 과제로 남음.',
    },
    {
        'evaluation_id': 'EVAL-2025-0191', 'emp_id': 'EMP-0191', 'period': 'FY2025',
        'krs': [
            {'name': '컨설팅 프로젝트 일정 준수율 90% 유지', 'achievement_pct': 95, 'done': True},
            {'name': '프로젝트 리스크 조기 감지 체크리스트 도입', 'achievement_pct': 100, 'done': True},
            {'name': '이슈 대응 회고 정례화(격주) 정착', 'achievement_pct': 45, 'done': False},
        ],
        'grade': fy25('EMP-0191')['grade'], 'score': fy25('EMP-0191')['score'],
        'rationale_summary': '일정 준수와 리스크 체크리스트는 목표 달성. 회고 정례화(45%)는 하반기 프로젝트 과부하로 미완 — 차기 사이클 이월 후보.',
    },
]

# ---------- 2) feedbackHistory ----------
j['feedbackHistory'] = [
    # EMP-0078 — leader 건은 tx_agent.js:526 하드코딩 문구("협업 리드 경험을 늘려 달라")와 취지 일치
    {'fb_id': 'FB-2025-001', 'emp_id': 'EMP-0078', 'period': 'FY2025', 'source_type': 'leader',
     'summary': '분석 결과는 정확하나 실행 단계에서 한 발 물러서는 경향 — 협업 리드 경험을 늘려 달라. 유관 조직과의 합동 과제에서 주도 역할을 맡길 권함.'},
    {'fb_id': 'FB-2025-002', 'emp_id': 'EMP-0078', 'period': 'FY2025', 'source_type': 'peer',
     'summary': '데이터 해석이 명료하고 리포트 품질이 일정함. 다만 기획 조직에 전달할 때 배경 설명이 짧아 재질문이 잦음.'},
    {'fb_id': 'FB-2025-003', 'emp_id': 'EMP-0078', 'period': 'FY2025', 'source_type': 'peer',
     'summary': 'VOC 분류 기준을 함께 잡을 때 논리가 탄탄했음. 서비스 기획 관점의 우선순위 감각을 더하면 좋겠음.'},
    # EMP-0035
    {'fb_id': 'FB-2025-004', 'emp_id': 'EMP-0035', 'period': 'FY2025', 'source_type': 'leader',
     'summary': '진단 보고서 완성도가 높고 고객 신뢰가 두터움. 제안·수주 단계에도 초기부터 참여해 전환율을 끌어올릴 것.'},
    {'fb_id': 'FB-2025-005', 'emp_id': 'EMP-0035', 'period': 'FY2025', 'source_type': 'peer',
     'summary': '방법론 문서가 실무에 바로 쓰일 만큼 구체적. 내부 공유 세션을 늘려주면 팀 전체에 도움이 되겠음.'},
    # EMP-0191
    {'fb_id': 'FB-2025-006', 'emp_id': 'EMP-0191', 'period': 'FY2025', 'source_type': 'leader',
     'summary': '일정 관리가 안정적이고 리스크를 미리 알리는 습관이 좋음. 회고를 정례화해 재발 방지까지 잇는 것이 다음 과제.'},
    {'fb_id': 'FB-2025-007', 'emp_id': 'EMP-0191', 'period': 'FY2025', 'source_type': 'peer',
     'summary': '이슈 발생 시 공유가 빠르고 정리가 깔끔함. 다만 회의가 길어지는 편이라 안건 사전 정리가 있으면 좋겠음.'},
]

# ---------- 3) upwardFeedback ----------
# UF-2026-01: ORG-030(TM Chapter, 리더 EMP-0030 김명숙) respondents=5 → 정상 표시용
# UF-2026-02: ORG-034(PO전략팀, 리더 EMP-0034 김정희) respondents=2 → 익명 임계(N=3) 미달 시연용
j['upwardFeedback'] = [
    {
        'uf_id': 'UF-2026-01', 'org_id': 'ORG-030', 'leader_emp_id': 'EMP-0030', 'period': 'FY2026-1H',
        'respondents': 5,
        'themes': [
            {'label': '방향 제시가 명확함', 'count': 4},
            {'label': '개별 피드백 빈도 부족', 'count': 3},
            {'label': '업무 배분이 일부에 몰림', 'count': 2},
        ],
        'raw': [
            {'text': '분기 목표의 배경을 매번 설명해 주셔서 일의 이유가 분명합니다.'},
            {'text': '바쁜 시기에는 한 달 넘게 개별 피드백이 없을 때가 있습니다.'},
            {'text': '급한 과제가 늘 같은 사람에게 가는 경향이 있어 배분 기준이 궁금합니다.'},
            {'text': '어려운 의사결정을 미루지 않고 빠르게 정리해 주시는 점이 좋습니다.'},
        ],
    },
    {
        'uf_id': 'UF-2026-02', 'org_id': 'ORG-034', 'leader_emp_id': 'EMP-0034', 'period': 'FY2026-1H',
        'respondents': 2,
        'themes': [
            {'label': '보고 부담이 큼', 'count': 2},
            {'label': '전략 방향 공유 충분', 'count': 1},
        ],
        'raw': [
            {'text': '주간 보고 양식이 잦게 바뀌어 준비 부담이 큽니다.'},
            {'text': '전략 방향은 자주 공유해 주셔서 이해가 쉽습니다.'},
            {'text': '소수 조직이라 의견을 내면 누가 썼는지 드러날까 조심스럽습니다.'},
        ],
    },
]

# ---------- 4) EMP-0078 jobHistory ----------
jp = j['jobProfiles']
prev_id, new_id = 'JOB-소프트-024', 'JOB-소프트-080'
assert new_id == emps['EMP-0078']['jobProfileId'], 'EMP-0078 현 직무와 new 불일치'
emps['EMP-0078']['jobHistory'] = [{
    'period': 'FY2026',
    'prev_jobProfileId': prev_id, 'new_jobProfileId': new_id,
    'prev_label': jp[prev_id]['title'], 'new_label': jp[new_id]['title'],
    'note': '데이터 분석 경험을 서비스 기획에 잇기 위한 본인 희망 전환. FY2025 피드백(협업 리드 확대)과 VOC 분류 과제 수행이 계기 — 올해 목표의 출발점이 전년과 달라짐.',
}]

# ---------- 5) "근거 없는 S" 시연 데이터 ----------
# F3 캘리브레이션 리스크 행·평가 배지 회색 상태 시연용: S 난이도 KR 2건의 difficulty_basis 제거.
# 멱등: 항상 같은 대상(EMP-0030 팀 우선, kr_id 정렬 앞 2건) 선택.
obj_owner = {o['objective_id']: o.get('owner_emp_id') for o in j['objectives']}
team_ids = {e['emp_id'] for e in j['employees'] if e.get('org_id') == 'ORG-030'} | {'EMP-0030'}
s_krs = sorted([k for k in j['keyResults'] if k.get('difficulty') == 'S'], key=lambda k: k['kr_id'])
team_s = [k for k in s_krs if obj_owner.get(k.get('objective_id')) in team_ids]
targets = (team_s + [k for k in s_krs if k not in team_s])[:2]
for k in targets:
    k.pop('difficulty_basis', None)
no_basis_s = [k['kr_id'] for k in j['keyResults'] if k.get('difficulty') == 'S' and 'difficulty_basis' not in k]
assert len(no_basis_s) == 2, no_basis_s

# ---------- meta 스탬프 ----------
j['meta']['prev_cycle_enriched_at'] = '2026-07-21'

# ---------- FK 정합 검증 (쓰기 전) ----------
for ev in j['evaluationsPrev']:
    assert ev['emp_id'] in emps and ev['period'] == 'FY2025'
    h = fy25(ev['emp_id'])
    assert ev['grade'] == h['grade'] and ev['score'] == h['score'], ev['emp_id']
    assert any(not k['done'] for k in ev['krs']), '미완 KR 없음: ' + ev['emp_id']
for fb in j['feedbackHistory']:
    assert fb['emp_id'] in emps and fb['source_type'] in ('peer', 'leader')
for uf in j['upwardFeedback']:
    assert uf['org_id'] in orgs and uf['leader_emp_id'] in emps
    assert orgs[uf['org_id']]['head_id'] == uf['leader_emp_id'], uf['uf_id']
jh = emps['EMP-0078']['jobHistory'][0]
assert jh['prev_jobProfileId'] in jp and jh['new_jobProfileId'] in jp

out = prefix + json.dumps(j, ensure_ascii=False, separators=(',', ':')) + suffix
io.open(PATH, 'w', encoding='utf-8', newline='\n').write(out)

# ---------- self-check (재파싱) ----------
jj = json.loads(io.open(PATH, encoding='utf-8').read()[len(prefix):-1])
keys_after = set(jj.keys())
assert keys_after - keys_before <= {'evaluationsPrev', 'feedbackHistory', 'upwardFeedback'}
assert len(jj['evaluationsPrev']) == 3
assert len(jj['feedbackHistory']) == 7
assert len(jj['upwardFeedback']) == 2
assert len(next(e for e in jj['employees'] if e['emp_id'] == 'EMP-0078')['jobHistory']) == 1
print('OK evaluationsPrev=%d feedbackHistory=%d upwardFeedback=%d jobHistory(EMP-0078)=1 topKeys=%d' % (
    len(jj['evaluationsPrev']), len(jj['feedbackHistory']), len(jj['upwardFeedback']), len(keys_after)))
