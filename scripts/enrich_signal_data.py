# -*- coding: utf-8 -*-
"""enrich_signal_data.py — 신호 카탈로그가 기다리는 원천 데이터 주입 (2026-08-03)

⚠️ 합성(가상) 데이터 고지
  이 스크립트가 만드는 모든 기록은 **데모용 합성 데이터**다. 실존 인물의 실제
  기록이 아니며 고정 시드 해시로 생성한 가공값이다. `meta.signal_data.synthetic`
  = true 로 데이터 자체에도 표기한다.

배경
  신호 카탈로그 150건 가운데 「AI 판단 가능」이 「데이터 보완 후」 47건,
  「이력 축적 후」 40건이다. 그 87건은 판단할 원천이 talenx_data 에 아예 없어서
  실계산을 못 하고 예시값으로만 보여 줄 수 있었다. 카탈로그의 「새로 만들 기록」
  132종을 뜻이 같은 것끼리 묶으면 15개 기록군이고, 이 스크립트가 그것을 만든다.

추가 컬렉션
  1) periods          기간 일정 마스터 — 목표·체크인·평가·피드백·다면진단·상향 6종
  2) objectiveHistory 목표 변경 이력(무엇이 언제 어떻게 바뀌었는지)
  3) krProgress       핵심결과 실적값 변경 이력 — 격주 스냅샷 (진척 추이 판정 원천)
  4) evaluatorMap     1차·2차 평가자 매핑 (조직 기준 + 매핑 공백)
  5) evalStatus       평가 제출 상태·제출 시각 (자기평가 → 1차 → 2차 확정)
  6) selfEval         자기평가 항목 서술 + 인용 근거 참조
  7) gradeHistory     등급 변경 이력(변경 전후·시각·변경자·사유)
  8) policy           제도 정책값 — 등급 분포 권고·난이도 분포·등급 경계·요소 가중치 등
  9) notifyLog        알림 발송·열람·처리 기록 (Agent 가 보낸 것)
 10) requestLog       요청·회신·처리 이력 (보완 요청·재작성 요청·협조 요청)
 11) meetingStore     1on1·면담 서버 보존 + 합의 항목 이행 기록
 12) feedbackLog      피드백 송수신·열람 기록
 13) msfAssign        다면진단 배정·제출 기록
 14) upwardResp       상향 피드백 응답 제출 기록
 15) devPlan          육성 계획 · 역량 개발 메모

  또 기존 컬렉션에 시각 필드를 채운다 —
    objectives : created_at · updated_at · confirmed_at · confirm_status
    keyResults : created_at · updated_at
    checkins   : 시연 대상 팀에 주간 회차를 26주로 늘리고
                 정체 구간·급등 구간·반복 걸림돌을 심는다(추이·반복 판정 원천)

정합 규칙 (말미에서 전수 검산)
  · 모든 emp_id · kr_id 는 기존 컬렉션에 실재
  · krProgress 의 마지막 값 == keyResults.progress
  · evalStatus 의 시각 순서 = self ≤ first ≤ second
  · evaluatorMap.first_evaluator 는 본인이 아니고 employees 에 실재
  · periods 의 start ≤ remind ≤ due ≤ close
  · 기준 시점(2026-07-16) 대비 「임박·지남」이 섞이도록 일정을 배치한다

결정론
  random 미사용. 모든 변동은 djb2 해시(H)로 생성 — 재실행 시 같은 결과.
  멱등: 15개 키를 통째로 재대입하고, 기존 컬렉션 보강도 같은 값으로 덮는다.

입출력 = js/talenx_data.js (단일 라인 JSON 래핑 유지)
"""
import datetime
import io
import json
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

BASE = os.path.join(os.path.dirname(__file__), '..')
PATH = os.path.join(BASE, 'js', 'talenx_data.js')

AS_OF = '2026-07-16'          # 앱 전역 기준 시점 (EZKit.clock DEFAULT_SNAPSHOT)
H1 = 'FY2026 상반기'
H0 = 'FY2025 하반기'

s = io.open(PATH, encoding='utf-8').read()
prefix, suffix = 'window.TALENX_DATA = ', ';'
j = json.loads(s[len(prefix):s.rindex('}') + 1])

emps = j['employees']
empIdx = {e['emp_id']: e for e in emps}
orgIdx = {o['org_id']: o for o in j['orgs']}
objs = j['objectives']
krs = j['keyResults']
cks = j['checkins']
evals = {v['emp_id']: v for v in j.get('evaluations', []) if v.get('emp_id')}


# ---------------------------------------------------------------- 결정론 도구
def H(*parts):
    """djb2 + 32bit 믹싱 — 고정 시드 해시(random 대체)."""
    x = 5381
    for ch in '|'.join(str(p) for p in parts):
        x = ((x * 33) + ord(ch)) & 0xFFFFFFFF
    x ^= x >> 15
    x = (x * 2246822519) & 0xFFFFFFFF
    x ^= x >> 13
    return x


def pick(seq, *seed):
    return seq[H(*seed) % len(seq)] if seq else None


def rng(lo, hi, *seed):
    return lo + H(*seed) % (hi - lo + 1)


def d2i(ds):
    return datetime.date(int(ds[0:4]), int(ds[5:7]), int(ds[8:10])).toordinal()


def dshift(ds, days):
    t = datetime.date(int(ds[0:4]), int(ds[5:7]), int(ds[8:10])) + datetime.timedelta(days=days)
    return t.isoformat()


def at(ds, hh, mm=0):
    return '%sT%02d:%02d:00+09:00' % (ds, hh, mm)


# ------------------------------------------------- 시연 대상 집합 (이력 생성 범위)
demo_ids = [x['emp_id'] for x in j.get('demoSubjects', []) if x.get('emp_id')]
cu = (j.get('meta') or {}).get('currentUser') or {}
if cu.get('emp_id'):
    demo_ids.append(cu['emp_id'])
subj_orgs = {empIdx[e]['org_id'] for e in demo_ids if e in empIdx}
SUBJ = set(demo_ids)
for e in emps:
    if e['org_id'] in subj_orgs:
        SUBJ.add(e['emp_id'])
for o in objs:
    if o.get('owner_emp_id'):
        SUBJ.add(o['owner_emp_id'])
for org in list(subj_orgs):
    head = (orgIdx.get(org) or {}).get('head_id')
    if head:
        SUBJ.add(head)
SUBJ = {e for e in SUBJ if e in empIdx}
print('이력 생성 대상 %d명 · 대상 조직 %d곳' % (len(SUBJ), len(subj_orgs)))


# ============================================================ 1) periods
# 기준 시점 2026-07-16 대비 「지남 · 임박 · 앞으로」가 섞이도록 배치한다.
# 이것이 「기한 도래」 유형 신호의 유일한 판단 원천이다.
periods = [
    ('goal', H0, '2025-07-01', '2025-07-14', '2025-07-20', '2025-07-31'),
    ('goal', H1, '2026-01-05', '2026-01-19', '2026-01-31', '2026-02-07'),
    ('goal', 'FY2026 하반기', '2026-07-01', '2026-07-13', '2026-07-19', '2026-07-31'),
    ('checkin', H1, '2026-01-12', '2026-07-13', '2026-07-17', '2026-07-24'),
    ('eval', H0, '2025-12-01', '2025-12-08', '2025-12-19', '2025-12-31'),
    # 평가·피드백은 기준 시점에 **열려 있어야** 그 단계 신호를 볼 수 있다.
    # 예전에는 개시일이 기준 시점보다 뒤여서 평가·피드백 신호 전부가 「아직 아님」이었다.
    # 평가 마감 셋(자기평가 due · 1차 제출 due+1 · 2차 확정 close)이 모두 기준 시점
    # 코앞에 와야 상위 조직장의 「1차 제출 D-2」·「2차 확정 D-4」가 성립한다.
    ('eval', H1, '2026-07-06', '2026-07-15', '2026-07-17', '2026-07-20'),
    ('feedback', H1, '2026-07-01', '2026-07-14', '2026-07-16', '2026-07-18'),
    ('msf', H1, '2026-06-15', '2026-07-03', '2026-07-10', '2026-07-14'),
    ('upward', H1, '2026-06-15', '2026-06-29', '2026-07-05', '2026-07-12'),
]
KIND_KR = {
    'goal': '목표 수립·확정', 'checkin': '중간점검 체크인', 'eval': '평가 작성·확정',
    'feedback': '결과 피드백·면담', 'msf': '다면진단', 'upward': '상향 피드백',
}
j['periods'] = []
for i, (kind, label, st, rm, due, cl) in enumerate(periods, 1):
    status = 'closed' if d2i(cl) < d2i(AS_OF) else ('open' if d2i(st) <= d2i(AS_OF) else 'planned')
    j['periods'].append({
        'period_id': 'PRD-%s-%02d' % (kind.upper()[:4], i),
        'kind': kind, 'kind_kr': KIND_KR[kind], 'label': label,
        'start': st, 'remind_at': rm, 'due': due, 'confirm_due': due, 'close': cl,
        'status': status,
        'days_left': d2i(due) - d2i(AS_OF),
        'source': '제도 운영 기준(합성)',
    })

# ================================================ 2) objectives 시각 · 변경 이력
GOAL_H1 = [p for p in j['periods'] if p['kind'] == 'goal' and p['label'] == H1][0]
obj_hist = []
for o in objs:
    oid = o['objective_id']
    born = dshift(GOAL_H1['start'], rng(0, 20, 'obborn', oid))
    o['created_at'] = at(born, rng(9, 17, 'obh', oid), rng(0, 59, 'obm', oid))
    lag = rng(0, 120, 'oblag', oid)
    upd = dshift(born, lag)
    if d2i(upd) > d2i(AS_OF):
        upd = AS_OF
    o['updated_at'] = at(upd, rng(9, 18, 'obuh', oid), rng(0, 59, 'obum', oid))
    settled = (H('obconf', oid) % 5) != 0
    o['confirm_status'] = 'confirmed' if settled else 'draft'
    o['confirmed_at'] = at(dshift(born, rng(1, 25, 'obcf', oid)), 11) if settled else None
    if lag > 0:
        obj_hist.append({
            'hist_id': 'OBH-%s-1' % oid,
            'objective_id': oid, 'emp_id': o.get('owner_emp_id'),
            'at': o['updated_at'],
            'field': pick(['title', 'progress', 'parent_objective_id'], 'obf', oid),
            'before': '(이전 값)', 'after': '(현재 값)',
            'by': o.get('owner_emp_id'),
            'reason': pick(['상위 목표 변경 반영', '지표 표현 정정', '진척 갱신', '담당 범위 조정'],
                           'obr', oid),
        })
j['objectiveHistory'] = obj_hist

# =========================================== 3) keyResults 시각 · 실적 변경 이력
objIdx = {o['objective_id']: o for o in objs}
kr_prog = []
for k in krs:
    kid = k['kr_id']
    po = objIdx.get(k.get('objective_id')) or {}
    born = (po.get('created_at') or at(GOAL_H1['start'], 10))[0:10]
    k['created_at'] = at(dshift(born, rng(0, 6, 'krb', kid)), rng(9, 17, 'krh', kid))
    cur = k.get('progress') or 0
    steps = 13
    stall_at = rng(3, 8, 'krst', kid)
    stall_len = rng(2, 4, 'krsl', kid)
    jump_at = min(steps - 1, stall_at + stall_len + rng(0, 2, 'krj', kid))
    seq, v = [], 0
    for w in range(steps):
        if w < stall_at:
            v = int(round(cur * (w + 1) / float(steps + 2)))
        elif w < stall_at + stall_len:
            pass                                # 정체 — 값이 움직이지 않는다
        elif w == jump_at:
            v = int(round(cur * 0.82))          # 급등
        else:
            v = int(round(v + (cur - v) * 0.45))
        seq.append(max(0, min(100, v)))
    seq[-1] = cur                               # 마지막은 반드시 현재값
    last_at = None
    for w, val in enumerate(seq):
        day = dshift(GOAL_H1['start'], 14 * w + rng(0, 3, 'krd', kid, w))
        if d2i(day) > d2i(AS_OF):
            day = AS_OF
        last_at = at(day, rng(10, 18, 'krph', kid, w))
        kr_prog.append({
            'prog_id': 'KRP-%s-%02d' % (kid, w + 1),
            'kr_id': kid, 'objective_id': k.get('objective_id'),
            'emp_id': po.get('owner_emp_id'),
            'at': last_at, 'week': w + 1, 'progress': val, 'value': val,
            'changed_by': po.get('owner_emp_id'),
            'delta': val - (seq[w - 1] if w else 0),
        })
    k['updated_at'] = last_at
j['krProgress'] = kr_prog

# ============================================ 4) evaluatorMap (1차 · 2차 평가자)
ev_map = []
for e in emps:
    eid = e['emp_id']
    first = e.get('manager_id') or (orgIdx.get(e['org_id']) or {}).get('head_id')
    if first == eid:
        first = (orgIdx.get((orgIdx.get(e['org_id']) or {}).get('parent_id') or '') or {}).get('head_id')
    parent = (orgIdx.get(e['org_id']) or {}).get('parent_id')
    second = (orgIdx.get(parent or '') or {}).get('head_id')
    if second == first:
        gp = (orgIdx.get(parent or '') or {}).get('parent_id')
        second = (orgIdx.get(gp or '') or {}).get('head_id')
    hole = (H('evhole', eid) % 20) == 0          # 스무 명 중 한 명은 매핑이 비어 있다
    ev_map.append({
        'map_id': 'EVM-%s' % eid, 'emp_id': eid, 'period': H1,
        'first_evaluator': None if hole else first,
        'second_evaluator': None if hole else second,
        'assigned_at': None if hole else at('2026-07-01', 9),
        'source': 'missing' if hole else 'org',
        'note': '발령 뒤 매핑이 비어 있습니다' if hole else '조직 기준 자동 매핑(합성)',
    })
j['evaluatorMap'] = ev_map

# ======================================== 5) evalStatus (제출 상태 · 제출 시각)
EV_H1 = [p for p in j['periods'] if p['kind'] == 'eval' and p['label'] == H1][0]
ev_status = []
DEMO_FORCE = set(demo_ids)      # 시연 대상자는 자기평가를 미리 제출해 둔다(데모 가능성 확보)
for e in emps:
    eid = e['emp_id']
    r = H('evst', eid) % 100
    if eid in DEMO_FORCE:
        r = min(r, 15)
    self_at = first_at = second_at = None
    st = 'not_started'
    if r < 22:
        self_at = at(dshift(EV_H1['start'], rng(1, 8, 'evsd', eid)), rng(9, 20, 'evsh', eid))
        st = 'self_submitted'
    if r < 8:
        first_at = at(dshift(self_at[0:10], rng(1, 3, 'evfd', eid)), 14)
        st = 'first_submitted'
    if r < 3:
        second_at = at(dshift(first_at[0:10], rng(1, 2, 'evcd', eid)), 16)
        st = 'confirmed'
    ev_status.append({
        'status_id': 'EVS-%s' % eid, 'emp_id': eid, 'period': H1,
        'self_submitted_at': self_at, 'first_submitted_at': first_at,
        'second_confirmed_at': second_at, 'status': st,
        # 1차 평가 마감은 자기평가 마감 다음이다. 이 값이 「평가 미작성 + 마감 임박」
        # 판정의 원천이라 기간 일정에서 파생시킨다(예전에는 08-03 을 박아 두었다).
        'due_self': EV_H1['due'],
        'due_first': dshift(EV_H1['due'], 1),
        'due_second': EV_H1['close'],
    })
j['evalStatus'] = ev_status

# =============================================== 6) selfEval (자기평가 서술)
krByOwner = {}
for k in krs:
    po = objIdx.get(k.get('objective_id')) or {}
    ow = po.get('owner_emp_id')
    if ow:
        krByOwner.setdefault(ow, []).append(k)
stIdx = {x['emp_id']: x for x in ev_status}
self_eval = []
for eid in sorted(SUBJ):
    mine = krByOwner.get(eid, [])
    stt = stIdx.get(eid)
    if not mine or not stt or not stt['self_submitted_at']:
        continue
    items = []
    for k in mine:
        thin = (H('sev', k['kr_id']) % 4) == 0        # 넷 중 하나는 서술이 아주 짧다
        nonum = (H('sen', k['kr_id']) % 3) == 0       # 셋 중 하나는 숫자 근거가 없다
        body = '목표한 %s 대비 현재 %s까지 왔습니다.' % (k.get('target_value'), k.get('current_value'))
        if nonum:
            body = '담당 범위에서 맡은 일을 계획대로 진행했습니다.'
        if thin:
            body = '진행했습니다.'
        items.append({
            'kr_id': k['kr_id'], 'text': body, 'char_len': len(body),
            'self_score': rng(2, 5, 'sesc', k['kr_id']),
            'evidence_refs': [] if nonum else ['KRP-%s-13' % k['kr_id']],
            'has_number': not nonum,
        })
    self_eval.append({
        'self_id': 'SEV-%s' % eid, 'emp_id': eid, 'period': H1,
        'submitted_at': stt['self_submitted_at'], 'items': items,
        'item_count': len(items),
        'thin_count': len([x for x in items if x['char_len'] < 20]),
    })
j['selfEval'] = self_eval

# ============================================ 7) gradeHistory (등급 변경 이력)
grade_hist = []
GRADES = ['S', 'A', 'B', 'C', 'D']
for eid, v in list(evals.items()):
    if (H('gh', eid) % 12) != 0:                  # 열두 명 중 한 명만 조정이 있었다
        continue
    cur = v.get('grade')
    if cur not in GRADES:
        continue
    before = GRADES[min(len(GRADES) - 1, GRADES.index(cur) + 1)]
    who = (stIdx.get(eid) and None)
    who = ([x for x in ev_map if x['emp_id'] == eid] or [{}])[0].get('second_evaluator')
    give_reason = (H('ghr', eid) % 3) != 0        # 셋 중 하나는 사유가 비어 있다
    grade_hist.append({
        'gh_id': 'GRH-%s' % eid, 'emp_id': eid, 'period': H1,
        'at': at('2026-08-07', rng(10, 18, 'ghh', eid)),
        'before': before, 'after': cur, 'by': who,
        'reason': '등급 조정 회의 결과 반영' if give_reason else None,
        'session_id': 'CAL-2026H1-01',
    })
j['gradeHistory'] = grade_hist

# ================================================== 8) policy (제도 정책값)
j['policy'] = {
    'policy_id': 'POL-2026H1', 'effective_from': '2026-01-01', 'source': '제도 운영 기준(합성)',
    'grade_distribution': {'S': 10, 'A': 25, 'B': 40, 'C': 20, 'D': 5, 'tolerance_pp': 5},
    'grade_cutoff': {'S': 90, 'A': 80, 'B': 70, 'C': 60, 'D': 0},
    'grade_concentration_cap_pct': 60,
    'difficulty_distribution': {'상': 30, '중': 50, '하': 20, 'tolerance_pp': 10},
    'score_weights': {'goal': 70, 'competency': 30},
    'goal_count_per_period': 3,
    'kr_count_per_objective': {'min': 2, 'max': 5},
    'kr_weight_sum': 100,
    'checkin_gap_days': 14,
    'checkin_cycle_days': 7,
    'agreement_followup_days': 14,
    'blocker_types': ['외부 연동 지연', '협조 대기', '인력 부족', '요건 변경', '승인 대기'],
    'standard_metrics': ['달성률', '완료 건수', '품질 지표', '납기 준수율', '만족도'],
    'theme_min_objectives': 3,
    'msf_min_raters': 3,
}

# ================================= 9~10) notifyLog · requestLog (알림 · 요청)
notify, request = [], []
try:
    sig_src = io.open(os.path.join(BASE, 'js', 'ez_signals.js'), encoding='utf-8').read()
    sig_json = json.loads(sig_src[sig_src.index('{'):sig_src.rindex('}') + 1])
    sig_ids = [x['id'] for x in sig_json.get('signals', [])]
except Exception:
    sig_ids = []
targets = sorted(SUBJ)[:40]
mapIdx = {x['emp_id']: x for x in ev_map}
for eid in targets:
    for n in range(rng(1, 3, 'nlog', eid)):
        sent = dshift(AS_OF, -rng(1, 40, 'nsd', eid, n))
        read = None if (H('nr', eid, n) % 4) == 0 else at(dshift(sent, rng(0, 2, 'nrd', eid, n)), 9)
        acted = at(dshift(sent, rng(1, 5, 'nad', eid, n)), 15) \
            if (read and (H('na', eid, n) % 3) == 0) else None
        notify.append({
            'notify_id': 'NTF-%s-%d' % (eid, n + 1),
            'signal_id': pick(sig_ids, 'nsig', eid, n) or '', 'emp_id': eid,
            'sent_at': at(sent, rng(8, 19, 'nsh', eid, n)), 'read_at': read, 'acted_at': acted,
            'channel': pick(['agent', 'mail', 'push'], 'nch', eid, n),
            'status': 'acted' if acted else ('read' if read else 'sent'),
        })
KINDS = [('보완 요청', 'goal'), ('재작성 요청', 'eval'), ('협조 요청', 'blocker'),
         ('면담 요청', 'meeting'), ('근거 보완 요청', 'eval')]
for eid in targets:
    if (H('rq', eid) % 3) != 0:
        continue
    kind, ref = pick(KINDS, 'rqk', eid)
    sent = dshift(AS_OF, -rng(2, 30, 'rqd', eid))
    replied = None if (H('rqr', eid) % 3) == 0 else at(dshift(sent, rng(1, 6, 'rqrd', eid)), 14)
    request.append({
        'req_id': 'REQ-%s' % eid, 'kind': kind, 'ref_kind': ref,
        'from_emp': (mapIdx.get(eid) or {}).get('first_evaluator'), 'to_emp': eid,
        'at': at(sent, rng(9, 18, 'rqh', eid)), 'replied_at': replied,
        'status': 'replied' if replied else 'waiting',
        'body': '%s 건을 확인해 주세요.' % kind,
    })
j['notifyLog'] = notify
j['requestLog'] = request

# =========================== 11) meetingStore (1on1 · 면담 보존 + 합의 이행)
meetings = []
leaders = [e for e in emps if e.get('is_leader') and e['emp_id'] in SUBJ]
for ld in leaders:
    members = [e for e in emps if e.get('manager_id') == ld['emp_id']]
    for mb in members[:6]:
        if (H('mtg', ld['emp_id'], mb['emp_id']) % 4) == 0:   # 넷 중 하나는 아직 못 했다
            continue
        day = dshift(AS_OF, -rng(3, 60, 'mtd', mb['emp_id']))
        mine = krByOwner.get(mb['emp_id'], [])
        agreements = []
        for a in range(rng(1, 3, 'mta', mb['emp_id'])):
            due = dshift(day, rng(7, 30, 'mtdue', mb['emp_id'], a))
            done = (H('mtdone', mb['emp_id'], a) % 3) != 0
            agreements.append({
                'text': pick(['핵심결과 지표를 숫자로 다시 쓰기', '외부 연동 지연 건 에스컬레이션',
                              '교육 과정 신청', '상위 목표 연결 보완', '주간 기록 주기 지키기'],
                             'mtt', mb['emp_id'], a),
                'due': due,
                'done_at': at(dshift(due, -rng(0, 5, 'mtdd', mb['emp_id'], a)), 15) if done else None,
                'status': 'done' if done else ('overdue' if d2i(due) < d2i(AS_OF) else 'open'),
                'ref_kr': (mine[0]['kr_id'] if mine else None),
            })
        meetings.append({
            'meeting_id': 'MTG-%s-%s' % (ld['emp_id'], mb['emp_id']),
            'leader_emp_id': ld['emp_id'], 'member_emp_id': mb['emp_id'],
            'kind': '1on1', 'at': at(day, rng(10, 17, 'mth', mb['emp_id'])),
            'saved_at': at(day, 18), 'stored': True,
            'agenda': ['진척 확인', '걸림돌', '다음 2주 계획'],
            'agreements': agreements,
            'summary_len': rng(80, 400, 'mtsl', mb['emp_id']),
        })
j['meetingStore'] = meetings

# ================== 12~14) feedbackLog · 다면진단 배정/제출 · 상향 응답 기록
fb_log, msf_assign, up_resp = [], [], []
for eid in sorted(SUBJ):
    for i in range(rng(0, 3, 'fbn', eid)):
        sent = dshift(AS_OF, -rng(2, 90, 'fbd', eid, i))
        read = None if (H('fbr', eid, i) % 3) == 0 else at(dshift(sent, rng(0, 4, 'fbrd', eid, i)), 10)
        fb_log.append({
            'log_id': 'FBL-%s-%d' % (eid, i + 1), 'to_emp': eid,
            'from_emp': (mapIdx.get(eid) or {}).get('first_evaluator'),
            'kind': pick(['성과 피드백', '개발 의견', '칭찬', '개선 요청'], 'fbk', eid, i),
            'draft_at': at(dshift(sent, -1), 17),
            'sent_at': at(sent, rng(9, 18, 'fbh', eid, i)), 'read_at': read,
            'status': 'read' if read else 'sent',
            'char_len': rng(40, 320, 'fbc', eid, i),
        })
DEMO_FIRST = ['EMP-0078', 'EMP-0030', 'EMP-0005', 'EMP-0001']   # 역할 대표 인물
MSF = [p for p in j['periods'] if p['kind'] == 'msf'][0]
for tgt in sorted(SUBJ)[:30]:
    # 대표 인물을 앞에 세운다 — 데모에서 보는 사람이 평가자로 배정돼 있어야 한다
    pool = [x for x in DEMO_FIRST if x != tgt and x in SUBJ]
    pool += [x for x in sorted(SUBJ) if x != tgt and x not in pool]
    raters = pool[:4]
    for rt in raters:
        done = (H('msf', tgt, rt) % 5) != 0          # 다섯 중 하나는 미제출
        msf_assign.append({
            'msf_id': 'MSF-%s-%s' % (tgt, rt), 'period': H1,
            'target_emp_id': tgt, 'rater_emp_id': rt,
            'assigned_at': at(MSF['start'], 9),
            'submitted_at': at(dshift(MSF['start'], rng(1, 22, 'msd', tgt, rt)), 14) if done else None,
            'due': MSF['due'], 'status': 'submitted' if done else 'pending',
        })
UP = [p for p in j['periods'] if p['kind'] == 'upward'][0]
for org in sorted(subj_orgs):
    head = (orgIdx.get(org) or {}).get('head_id')
    members = [e['emp_id'] for e in emps if e['org_id'] == org and e['emp_id'] != head]
    for m in members[:8]:
        done = (H('up', org, m) % 4) != 0
        up_resp.append({
            'resp_id': 'UPR-%s-%s' % (org, m), 'period': H1, 'org_id': org,
            'leader_emp_id': head, 'rater_emp_id': m,
            'assigned_at': at(UP['start'], 9),
            'submitted_at': at(dshift(UP['start'], rng(1, 18, 'upd', org, m)), 13) if done else None,
            'due': UP['due'], 'status': 'submitted' if done else 'pending',
        })
j['feedbackLog'] = fb_log
j['msfAssign'] = msf_assign
j['upwardResp'] = up_resp

# ============================================ 15) devPlan (육성 계획 · 메모)
dev = []
comp_ids = [c['dimension_id'] for c in j.get('competencies', [])]
low_grade = {eid for eid, v in evals.items() if v.get('grade') in ('C', 'D')}
for eid in sorted(SUBJ):
    if not (eid in low_grade or (H('dv', eid) % 3) == 0):
        continue
    registered = (H('dvr', eid) % 4) != 0          # 넷 중 하나는 등록만 안 되어 있다
    items = []
    for a in range(rng(1, 2, 'dvn', eid)):
        items.append({
            'competency_id': pick(comp_ids, 'dvc', eid, a),
            'action': pick(['사내 교육 수강', '멘토링 배정', '과제 확대', '외부 과정 등록'], 'dva', eid, a),
            'due': dshift(AS_OF, rng(20, 90, 'dvd', eid, a)),
            'status': pick(['open', 'in_progress'], 'dvs', eid, a),
        })
    dev.append({
        'plan_id': 'DVP-%s' % eid, 'emp_id': eid, 'period': H1,
        'created_at': at(dshift(AS_OF, -rng(5, 40, 'dvcd', eid)), 11) if registered else None,
        'registered': registered, 'items': items if registered else [],
        'memo': '역량 개발 메모(합성)' if registered else None,
    })
j['devPlan'] = dev

# ======================== checkins 보강 — 26주 · 정체 · 반복 걸림돌 (추이 원천)
CK = [p for p in j['periods'] if p['kind'] == 'checkin'][0]
existing = {(c.get('kr_id'), c.get('checkin_date')) for c in cks}
BLOCKERS = j['policy']['blocker_types']
hot_orgs = sorted(subj_orgs)[:3]      # 반복 걸림돌을 집중 배치할 조직
progByKr = {}
for p in kr_prog:
    progByKr.setdefault(p['kr_id'], {})[p['week']] = p
added = 0
for k in krs:
    po = objIdx.get(k.get('objective_id')) or {}
    ow = po.get('owner_emp_id')
    if not ow or ow not in SUBJ:
        continue
    org = empIdx[ow]['org_id']
    prog = progByKr.get(k['kr_id'], {})
    for w in range(1, 27):
        day = dshift(CK['start'], 7 * (w - 1))
        if d2i(day) > d2i(AS_OF):
            break
        if (H('ckskip', k['kr_id'], w) % 5) == 0:      # 다섯 회차 중 하나는 비운다
            continue
        if (k['kr_id'], day) in existing:
            continue
        pw = prog.get(min(13, max(1, (w + 1) // 2)))
        low_conf = (H('ckcf', k['kr_id'], w) % 4) == 0
        blk = None
        if org in hot_orgs and (H('ckbl', k['kr_id'], w) % 3) == 0:
            blk = BLOCKERS[H('ckb2', org) % 3]          # 조직마다 같은 걸림돌이 되풀이된다
        elif (H('ckbl2', k['kr_id'], w) % 9) == 0:
            blk = pick(BLOCKERS, 'ckb3', k['kr_id'], w)
        cks.append({
            'checkin_id': 'CHK-%s-W%02d' % (k['kr_id'], w),
            'kr_id': k['kr_id'], 'objective_id': k.get('objective_id'), 'emp_id': ow,
            'checkin_date': day, 'progress_snapshot': (pw['progress'] if pw else 0),
            'progress_delta': (pw['delta'] if pw else 0),
            'confidence': ('낮음' if low_conf else pick(['보통', '높음'], 'ckc', k['kr_id'], w)),
            'comment': '주간 진행 상황을 기록했습니다.',
            'blocker': blk, 'likes_count': rng(0, 3, 'ckl', k['kr_id'], w),
            'source': 'synthetic-26w',
        })
        added += 1
print('체크인 %d건 보강 → 총 %d건' % (added, len(cks)))

# ================= 데모 표본 심기 — 대표 인물 기준으로 알림이 실제로 뜨게 =======
# 엔진 subject() 는 currentUser._role 이 맞을 때만 그 사람을 쓰고, 아니면 역할 대표
# 인물로 고정한다(ROLE_EMP). 역할 스위처도 그 4명으로 화면을 바꾸므로 **데모에서
# 보이는 것은 이 4명 기준의 판정 결과**다. 판정 함수를 붙여도 이 4명의 데이터가
# 조건을 만족하지 않으면 사람이 보는 것은 늘 「지금은 뜰 상태가 아니에요」다.
# 그래서 각 단계·역할에서 알림이 최소 한 건은 뜨도록 결핍을 심는다.
# 심는 것은 「없는 것을 있다고 하기」가 아니라 「있을 수 있는 상황을 하나 만들기」다.
DEMO_ROLE = {'member': 'EMP-0078', 'leader': 'EMP-0030', 'hr': 'EMP-0005', 'exec': 'EMP-0001'}
me = DEMO_ROLE['member']

# ① 체크인 공백 — 이번 달 기록을 지난달로 물러 앉힌다
#    (중간점검-구성원-01 마지막 기록 뒤 경과일 · 06 이번 달 기록 없음, 두 신호가 함께 켜진다)
mine = [c for c in cks if c.get('emp_id') == me]
moved = 0
for c in mine:
    if str(c.get('checkin_date', ''))[:7] == '2026-07':
        c['checkin_date'] = dshift(c['checkin_date'], -21)
        moved += 1

# ② 마지막 두 회차는 확신도가 낮았다 (중간점검-구성원-09 확신도 낮음 연속)
mine.sort(key=lambda c: c.get('checkin_date') or '')
for c in mine[-2:]:
    c['confidence'] = '낮음'
print('데모 표본 — 구성원 대표 체크인 %d건을 지난달로, 마지막 2회 확신도 낮음' % moved)

# ③ 아직 안 읽은 피드백 한 건 (피드백-구성원-04 — 사이클 종료 임박과 함께 걸린다)
got = [x for x in fb_log if x.get('to_emp') == me and x.get('sent_at')]
if got:
    got[0]['read_at'] = None
    got[0]['status'] = 'sent'

# ④ 상향 피드백에 아직 응답하지 않았다 (피드백-구성원-06)
for r in up_resp:
    if r.get('rater_emp_id') == me:
        r['submitted_at'] = None
        r['status'] = 'pending'
        break

# ⑤ 팀 등급이 위쪽에 몰렸다 (평가-팀장-06) — 조직장 대표의 팀원 한 명을 한 칸 위로
leader = DEMO_ROLE['leader']
team = [e['emp_id'] for e in emps if e.get('manager_id') == leader]
UP1 = {'A': 'S', 'B': 'A', 'C': 'B', 'D': 'C'}
for eid in team:
    v = evals.get(eid)
    if v and v.get('grade') in UP1:
        v['grade'] = UP1[v['grade']]
        break

# ⑥ 낮은 등급인데 육성 계획이 등록되지 않은 사람 (피드백-HR경영진-09)
#    우연히 전원 등록돼 있어 「미등록 0명」이었다. 낮은 등급 두 명을 미등록으로 둔다.
low_ids = [x for x in sorted(low_grade) if x in {d['emp_id'] for d in dev}][:2]
for d in dev:
    if d['emp_id'] in low_ids:
        d['registered'] = False
        d['items'] = []
        d['created_at'] = None
        d['memo'] = None

# ⑦ 면담 기록이 아예 없는 조직 (피드백-HR경영진-01 — 완료율과 0건 조직 수를 함께 본다)
#    면담을 만든 조직장 절반만 남긴다. 나머지 조직은 「한 건도 없음」이 된다.
all_ld = sorted({m['leader_emp_id'] for m in meetings})
#    절반을 지우면 상위 조직장의 「하위 팀 면담」 신호가 함께 죽는다 — 세 곳만 비운다
keep_leaders = set(all_ld[3:]) if len(all_ld) > 4 else set(all_ld)
meetings = [m for m in meetings if m['leader_emp_id'] in keep_leaders]
j['meetingStore'] = meetings

# ⑧ 상위 조직장 관점의 평가 단계 (평가-상위조직장-01 · 05 · 08)
#    엔진 upperScope 는 대표 조직장(EMP-0030)의 조직에 하위가 없어 한 단계 위
#    ORG-026(Consulting BU)을 기준 조직으로 잡는다. 그 범위 안에만 심는다.
def _subtree(root):
    out, q = set(), [root]
    while q:
        oid = q.pop()
        if not oid or oid in out:
            continue
        out.add(oid)
        q += [o['org_id'] for o in j['orgs'] if o.get('parent_id') == oid]
    return out

UP_ORG = (orgIdx.get(empIdx[leader]['org_id']) or {}).get('parent_id')
UP_SCOPE = _subtree(UP_ORG) if UP_ORG else set()

#    2차 확정 대기가 기준(10건)을 넘어야 한다. 그런데 「제출률 0%인 하위 팀」이
#    남아 있어야 01 도 함께 성립하므로, 골고루 뿌리지 않고 앞쪽 한두 팀에만 몰아
#    심는다. 대표의 팀(ORG-030)과 그 직속 팀원은 손대지 않는다 — 팀장 관점의
#    「팀원 평가 미작성」 신호가 그 사람들 위에 서 있다.
UP_PEND_MIN = 10                      # TH-2차확정-대기건수
up_pend = [x for x in ev_status
           if empIdx[x['emp_id']]['org_id'] in UP_SCOPE
           and x['first_submitted_at'] and not x['second_confirmed_at']]
seeded_orgs = []
for oid in sorted(o for o in UP_SCOPE if o not in (UP_ORG, empIdx[leader]['org_id'])):
    if len(up_pend) >= UP_PEND_MIN:
        break
    for x in ev_status:
        if len(up_pend) >= UP_PEND_MIN:
            break
        e = empIdx[x['emp_id']]
        if e['org_id'] != oid or e.get('manager_id') == leader or x['first_submitted_at']:
            continue
        if not x['self_submitted_at']:
            x['self_submitted_at'] = at(dshift(EV_H1['start'], 2), 10)
        x['first_submitted_at'] = at(dshift(x['self_submitted_at'][:10], 2), 14)
        x['second_confirmed_at'] = None
        x['status'] = 'first_submitted'
        up_pend.append(x)
        if oid not in seeded_orgs:
            seeded_orgs.append(oid)

#    등급 변경 사유가 비어 있는 건 한 건 (평가-상위조직장-05 — 기준은 1건)
up_noreason = 0
for g in grade_hist:
    if empIdx[g['emp_id']]['org_id'] in UP_SCOPE and g['reason']:
        g['reason'] = None
        up_noreason += 1
        break

print('데모 표본 — 상위 조직장 범위 %s: 2차 확정 대기 %d건(%s) · 등급 변경 사유 공백 %d건'
      % (UP_ORG, len(up_pend), ' · '.join(seeded_orgs) or '추가 없음', up_noreason))

print('데모 표본 — 육성 계획 미등록 %d명 · 면담 기록 있는 조직장 %d명으로 좁힘'
      % (len(low_ids), len(keep_leaders)))
print('데모 표본 — 안 읽은 피드백 1건 · 상향 미응답 1건 · 팀 등급 한 칸 위로 1명')

# ---------------------------------------------------------------- meta 표기
COLLS = ['periods', 'objectiveHistory', 'krProgress', 'evaluatorMap', 'evalStatus',
         'selfEval', 'gradeHistory', 'policy', 'notifyLog', 'requestLog',
         'meetingStore', 'feedbackLog', 'msfAssign', 'upwardResp', 'devPlan']
meta = j.setdefault('meta', {})
meta['signal_data'] = {
    'synthetic': True,
    'enriched_by': 'scripts/enrich_signal_data.py',
    'enriched_at': AS_OF, 'as_of': AS_OF,
    'note': '신호 카탈로그가 기다리는 원천(기간 일정·수정 이력·평가 축·로그류)의 합성 데이터',
    'collections': COLLS,
}
counts = meta.setdefault('counts', {})
for key in COLLS:
    v = j.get(key)
    counts[key] = len(v) if isinstance(v, list) else 1
counts['checkins'] = len(cks)

# ------------------------------------------------------------------- 정합 검산
ids = set(empIdx)
krids = {x['kr_id'] for x in krs}
for p in j['periods']:
    assert d2i(p['start']) <= d2i(p['remind_at']) <= d2i(p['due']) <= d2i(p['close']), p['period_id']
for m in ev_map:
    assert m['emp_id'] in ids, m['map_id']
    assert m['first_evaluator'] != m['emp_id'], m['map_id']
    if m['first_evaluator']:
        assert m['first_evaluator'] in ids, m['map_id']
for st in ev_status:
    a, b, c = st['self_submitted_at'], st['first_submitted_at'], st['second_confirmed_at']
    if b:
        assert a and a <= b, st['status_id']
    if c:
        assert b and b <= c, st['status_id']
lastOf = {}
for p in kr_prog:
    assert p['kr_id'] in krids, p['prog_id']
    lastOf[p['kr_id']] = p
for k in krs:
    lp = lastOf.get(k['kr_id'])
    if lp:
        assert lp['progress'] == (k.get('progress') or 0), k['kr_id']
for mt in meetings:
    assert mt['leader_emp_id'] in ids and mt['member_emp_id'] in ids, mt['meeting_id']
for a in msf_assign:
    assert a['target_emp_id'] in ids and a['rater_emp_id'] in ids, a['msf_id']
for c in cks:
    if c.get('emp_id'):
        assert c['emp_id'] in ids, c.get('checkin_id')

out = prefix + json.dumps(j, ensure_ascii=False, separators=(',', ':')) + suffix
io.open(PATH, 'w', encoding='utf-8', newline='\n').write(out)

# ------------------------------------------------------------------ self-check
jj = json.loads(io.open(PATH, encoding='utf-8').read()[len(prefix):-1])
for key in COLLS:
    assert key in jj, key
print('%.1f MB' % (len(out.encode('utf-8')) / 1024.0 / 1024.0))
print(' · '.join('%s %d' % (k, counts[k]) for k in
                 ['periods', 'krProgress', 'evaluatorMap', 'evalStatus', 'selfEval',
                  'meetingStore', 'notifyLog', 'msfAssign', 'devPlan', 'checkins']))
print('열려 있는 기간 —', ' / '.join(
    '%s %s %s(D%+d)' % (p['kind'], p['label'], p['due'], p['days_left'])
    for p in j['periods'] if p['status'] != 'closed'))
