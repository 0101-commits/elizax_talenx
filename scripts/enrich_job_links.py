# -*- coding: utf-8 -*-
"""enrich_job_links.py — 직무/스킬/역량/사업전략 데이터 고도화 (2026-07-21)

1) meta.currentUser 동기화 — jobProfileId null 버그 수정 (employees 원본과 병합)
2) jobProfiles[].competency_profile — 직무↔역량 직접 연결 신설 (직군별 가중치, D1은 직책자 적용이라 제외)
3) skillDict — 기대 스킬 767종 정규화·분류 사전 + jobProfiles[].skill_ids
4) strategyThemes[].kpis / owner_org — 전략 테마 측정지표·주관조직

멱등: 재실행해도 같은 결과. 입력/출력 = js/talenx_data.js (단일 라인 JSON 래핑 유지)
"""
import io, json, re, collections, os

BASE = os.path.join(os.path.dirname(__file__), '..')
PATH = os.path.join(BASE, 'js', 'talenx_data.js')

s = io.open(PATH, encoding='utf-8').read()
prefix, suffix = 'window.TALENX_DATA = ', ';'
j = json.loads(s[len(prefix):s.rindex('}') + 1])

# ---------- 1) meta.currentUser 동기화 ----------
cu = j['meta'].get('currentUser') or {}
src = next((e for e in j['employees'] if e['emp_id'] == cu.get('emp_id')), None)
if src:
    merged = dict(cu)
    merged.update({k: v for k, v in src.items() if v is not None})
    j['meta']['currentUser'] = merged

# ---------- 2) 직무↔역량 직접 연결 (competency_profile) ----------
# 직군별 역량 가중치(합 100). D1 Leadership은 applicable_to=leader_and_senior — 직무 아닌 직책 기준이라 제외.
GROUP_COMP = {
    '전략기획':     [('D3', 30), ('D4', 25), ('D5', 25), ('D2', 20)],
    '제품기획':     [('D3', 30), ('D2', 25), ('D5', 25), ('D4', 20)],
    '소프트웨어개발': [('D3', 40), ('D4', 30), ('D5', 20), ('D2', 10)],
    '데이터AI':     [('D3', 40), ('D4', 25), ('D5', 25), ('D2', 10)],
    'SI컨설팅':     [('D3', 30), ('D2', 30), ('D4', 30), ('D5', 10)],
    '영업마케팅':    [('D2', 35), ('D4', 35), ('D3', 15), ('D5', 15)],
    '고객서비스':    [('D2', 35), ('D4', 30), ('D3', 20), ('D5', 15)],
    'IT인프라':     [('D3', 35), ('D4', 35), ('D2', 15), ('D5', 15)],
    '경영관리':     [('D4', 35), ('D3', 30), ('D2', 20), ('D5', 15)],
    '경영지원':     [('D2', 30), ('D4', 30), ('D3', 25), ('D5', 15)],
}
DEFAULT_COMP = [('D3', 30), ('D4', 30), ('D2', 20), ('D5', 20)]
for jp in j['jobProfiles'].values():
    w = GROUP_COMP.get(jp.get('group'), DEFAULT_COMP)
    jp['competency_profile'] = [{'dimension_id': d, 'weight': n} for d, n in w]

# ---------- 3) 스킬 사전 (skillDict) + skill_ids ----------
def norm(name):
    n = re.sub(r'\s+', '', name)
    n = n.replace('및', '·').replace('와', '·').replace('과', '·')
    n = re.sub(r'(능력|역량|스킬)$', '', n)
    return n

COMMON = {'문제해결', '의사소통', '협업', '협업·조정', '비판적사고', '논리적사고', '분석적사고',
          '전략적사고', '창의적사고', '프레젠테이션', '문서작성', '세부사항주의력', '시간관리',
          '우선순위설정', '커뮤니케이션', '보고서작성'}
CAT_RULES = [
    ('AI·데이터',      ['AI', '머신러닝', '딥러닝', '데이터', '통계', '모델링', 'LLM', '알고리즘', '분석']),
    ('개발·엔지니어링', ['개발', '프로그래밍', '코딩', '아키텍처', 'API', '클라우드', '인프라', '서버',
                       '네트워크', '보안', '데브옵스', '테스트', 'QA', '시스템', 'DB', '데이터베이스', 'SQL', '자동화']),
    ('디자인·UX',      ['UX', 'UI', '디자인', '프로토타이핑', '사용성', '와이어프레임']),
    ('기획·전략',      ['기획', '전략', '시장', '리서치', '조사', '벤치마킹', '사업', '수익', '로드맵', '트렌드']),
    ('고객·영업',      ['영업', '고객', '세일즈', '제안', '협상', 'CS', '마케팅', '캠페인', '브랜드', '커뮤니티']),
    ('운영·관리',      ['프로젝트관리', '운영', '프로세스', '일정', '예산', '리스크', '품질관리', '성과관리',
                       '조직', '인사', 'HR', '노무', '재무', '회계', '구매', '계약', '법무', '규정', '감사']),
]
def catOf(canon):
    if canon in COMMON:
        return '공통 스킬'
    for cat, kws in CAT_RULES:
        for kw in kws:
            if kw.lower() in canon.lower():
                return cat
    return '직무 전문'

groups = collections.defaultdict(list)   # canon -> [원문 표기들]
for jp in j['jobProfiles'].values():
    for sk in jp.get('skills', []):
        groups[norm(sk)].append(sk)

canon_sorted = sorted(groups.items(), key=lambda kv: (-len(kv[1]), kv[0]))
sid_of, skill_dict = {}, []
for i, (canon, names) in enumerate(canon_sorted, 1):
    display = collections.Counter(names).most_common(1)[0][0]
    sid = 'SK-%03d' % i
    sid_of[canon] = sid
    skill_dict.append({'skill_id': sid, 'name': display, 'category': catOf(canon),
                       'job_count': len(names)})
j['skillDict'] = skill_dict
for jp in j['jobProfiles'].values():
    jp['skill_ids'] = [sid_of[norm(sk)] for sk in jp.get('skills', [])]

# ---------- 4) 전략 테마 KPI·주관조직 ----------
THEME_EXTRA = {
    'ST-01': {'owner_org': '영업마케팅본부',
              'kpis': [{'name': 'FY2026 전사 매출', 'target': '491억원', 'current': '진척 61%'},
                       {'name': '신규 수주 파이프라인', 'target': '120건', 'current': '87건'}]},
    'ST-02': {'owner_org': 'AI x HR R&D Center',
              'kpis': [{'name': 'elizax 도입 고객', 'target': '150곳', 'current': '96곳'},
                       {'name': 'AI 기능 활성 사용률', 'target': '40%', 'current': '27%'}]},
    'ST-03': {'owner_org': 'Package BG',
              'kpis': [{'name': '핵심 기능 정시 출시율', 'target': '90%', 'current': '82%'},
                       {'name': '출시 후 30일 결함률', 'target': '2% 이하', 'current': '2.8%'}]},
    'ST-04': {'owner_org': 'CS BU',
              'kpis': [{'name': '고객 유지율', 'target': '95%', 'current': '93.4%'},
                       {'name': 'SLA 준수율', 'target': '99%', 'current': '98.2%'}]},
    'ST-05': {'owner_org': '경영지원팀',
              'kpis': [{'name': '표준 방법론 적용률', 'target': '80%', 'current': '64%'},
                       {'name': '보안 인증(ISMS-P)', 'target': '갱신 완료', 'current': '심사 준비'}]},
}
for t in j['strategyThemes']:
    ex = THEME_EXTRA.get(t['theme_id'])
    if ex:
        t.update(ex)

# ---------- meta 스탬프 ----------
j['meta']['enriched_at'] = '2026-07-21'
j['meta']['enriched_by'] = 'enrich_talenx_data.py + enrich_job_links.py'

out = prefix + json.dumps(j, ensure_ascii=False, separators=(',', ':')) + suffix
io.open(PATH, 'w', encoding='utf-8', newline='\n').write(out)

# ---------- self-check ----------
jj = json.loads(io.open(PATH, encoding='utf-8').read()[len(prefix):-1])
assert jj['meta']['currentUser']['jobProfileId'], 'currentUser jobProfileId still empty'
assert all('competency_profile' in p and 'skill_ids' in p for p in jj['jobProfiles'].values())
assert all(sum(c['weight'] for c in p['competency_profile']) == 100 for p in jj['jobProfiles'].values())
assert all(len(p['skill_ids']) == len(p['skills']) for p in jj['jobProfiles'].values())
assert all('kpis' in t and 'owner_org' in t for t in jj['strategyThemes'])
print('OK currentUser=%s skillDict=%d categories=%s' % (
    jj['meta']['currentUser']['jobProfileId'], len(jj['skillDict']),
    sorted(set(x['category'] for x in jj['skillDict']))))
