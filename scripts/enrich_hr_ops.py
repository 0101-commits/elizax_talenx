# -*- coding: utf-8 -*-
"""enrich_hr_ops.py — 근태·연차·급여 원천 데이터 주입 (2026-07-28)

⚠️ 합성(가상) 데이터 고지
  이 스크립트가 만드는 attendance / leaves / payroll 은 **데모용 합성 데이터**다.
  실존 인물의 실제 근태·급여가 아니며, 결정론적 해시(고정 시드)로 생성된
  가공 수치다. 데이터 자체에도 meta.hr_ops.synthetic = true 로 표기한다.

배경
  근무관리(#s-att)·급여관리(#s-pay) 화면은 정적 목업이고, TALENX_DATA에
  근태·급여 원천이 아예 없어 elizax가 "내 연차 얼마 남았어" 같은 질문에
  답하지 못했다. 아래 4개 컬렉션을 추가해 화면·AI 도구가 같은 원천을 본다.

추가 컬렉션
  1) leaves         전 직원 2026년 연차 대장 + 신청 이력(승인/대기/반려)
  2) attendance     전 직원 × 2026-04·05·06 월 요약
                    (+ 시연 대상자 subset은 2026-07 부분월 + 최근 4주 일별)
  3) payroll        전 직원 × 2026-04·05·06 급여명세(지급/공제/실지급)
  4) payrollPolicy  계산 규칙 원천 — AI가 "왜 이 금액인지" 설명할 때 인용

정합 규칙 (스크립트 말미에서 전수 검산)
  · 모든 emp_id 는 employees 에 실재
  · leaves.used_days   == 승인된 연차·반차 신청일수 합
  · leaves.remaining_days == granted_days - used_days
  · attendance.actual_days == work_days - 해당 월 승인 휴가일수
  · payroll.gross == 기본급+직책수당+식대+연장근로수당+상여
  · payroll.net   == gross - 공제 합계
  · payroll.overtime_pay 는 같은 달 attendance.overtime_hours 에서 산출
  · 성과급은 payrollPolicy.bonus_months(6·12월)에만, 등급(evaluations)에 비례
    → "6월 급여가 왜 늘었나"가 규칙+데이터로 설명 가능

결정론
  random 미사용. 모든 변동은 djb2 해시(H)로 생성 — 재실행 시 결과 동일.
  멱등: 4개 키를 통째로 재대입하므로 반복 실행해도 같은 파일이 나온다.

입출력 = js/talenx_data.js (단일 라인 JSON 래핑 유지)
"""
import io, json, os, datetime

BASE = os.path.join(os.path.dirname(__file__), '..')
PATH = os.path.join(BASE, 'js', 'talenx_data.js')

AS_OF = '2026-07-16'          # 앱 전역 기준 시점 (EZKit.clock DEFAULT_SNAPSHOT)
FY = 'FY2026'
YEAR = 2026

s = io.open(PATH, encoding='utf-8').read()
prefix, suffix = 'window.TALENX_DATA = ', ';'
j = json.loads(s[len(prefix):s.rindex('}') + 1])

emps = j['employees']
empIdx = {e['emp_id']: e for e in emps}
orgIdx = {o['org_id']: o for o in j['orgs']}
jobProfiles = j.get('jobProfiles', {})
evalGrade = {}
for v in j.get('evaluations', []):
    if v.get('emp_id'):
        evalGrade[v['emp_id']] = v.get('grade')


# ---------------------------------------------------------------- 결정론 도구
def H(*parts):
    """djb2 + 32bit avalanche 믹싱 — 고정 시드 해시(random 대체).
    믹싱을 넣지 않으면 '2026-07-13','2026-07-14'처럼 한 글자만 다른 시드가
    연속된 값을 뱉어 일별 수치가 계단처럼 보인다(합성 티가 남)."""
    x = 5381
    for ch in '|'.join(str(p) for p in parts):
        x = ((x * 33) + ord(ch)) & 0xFFFFFFFF
    x ^= x >> 15
    x = (x * 2246822519) & 0xFFFFFFFF
    x ^= x >> 13
    x = (x * 3266489917) & 0xFFFFFFFF
    x ^= x >> 16
    return x


def pick(lo, hi, *seed):
    """[lo, hi] 정수 균등 선택 (결정론)."""
    return lo + H(*seed) % (hi - lo + 1)


def r10(x):
    return int(round(x / 10.0)) * 10


# ---------------------------------------------------------------- 근무일 달력
# 2026년 공휴일 중 평일에 걸리는 것만 (4~7월 구간에 유효한 항목)
HOLIDAYS = {
    '2026-01-01',              # 신정
    '2026-02-16', '2026-02-17', '2026-02-18',   # 설 연휴
    '2026-03-02',              # 3·1절 대체공휴일(3/1 일요일)
    '2026-05-05',              # 어린이날
    '2026-05-25',              # 부처님오신날(5/24 일) 대체공휴일
    '2026-06-03',              # 제9회 전국동시지방선거
    '2026-08-17',              # 광복절(8/15 토) 대체공휴일
    '2026-10-05', '2026-10-06', '2026-10-07',   # 추석 연휴
    '2026-10-09',              # 한글날
    '2026-12-25',              # 성탄절
}


def month_workdays(period, upto=None):
    """period='YYYY-MM' 의 소정근로일 리스트(주말·공휴일 제외). upto='YYYY-MM-DD' 까지만."""
    y, m = int(period[:4]), int(period[5:7])
    d = datetime.date(y, m, 1)
    out = []
    while d.month == m:
        k = d.isoformat()
        if d.weekday() < 5 and k not in HOLIDAYS and (upto is None or k <= upto):
            out.append(k)
        d += datetime.timedelta(days=1)
    return out


PERIODS = ['2026-04', '2026-05', '2026-06']          # 전 직원 확정 월
PARTIAL = '2026-07'                                   # subset 부분월 (as-of까지)
WD = {p: month_workdays(p) for p in PERIODS}
WD[PARTIAL] = month_workdays(PARTIAL, upto=AS_OF)

# 최근 4주 일별 상세 창 (as-of 2026-07-16 기준 직전 4주)
DAILY_FROM, DAILY_TO = '2026-06-18', '2026-07-15'

# 일별 상세·부분월을 붙일 시연 대상자 subset
#  = 역할 스위처 4인(조직원/조직장/HR/경영진) + demoSubjects + 각 역할 대표의 팀원
ROLE_EMPS = ['EMP-0078', 'EMP-0030', 'EMP-0005', 'EMP-0001']
SUBSET = []
for x in ROLE_EMPS:
    if x in empIdx and x not in SUBSET:
        SUBSET.append(x)
for ds in j.get('demoSubjects', []):
    x = ds.get('emp_id') if isinstance(ds, dict) else ds
    if x in empIdx and x not in SUBSET:
        SUBSET.append(x)
for r in ROLE_EMPS:
    for e in emps:
        if e.get('manager_id') == r and e['emp_id'] not in SUBSET:
            SUBSET.append(e['emp_id'])
SUBSET_SET = set(SUBSET)


# ---------------------------------------------------------------- 1) leaves
# granted_days: 근속연수 기반 (근로기준법 §60 — 1년 미만 월 1일(최대 11),
#   1년 이상 15일, 3년차부터 2년마다 1일 가산, 상한 25일).
#   employees[].join_date 가 전원 존재하므로 이를 사용한다(해시 추정 불필요).
LEAVE_TYPES_PAID = ('연차', '반차')     # 연차 잔여를 소모하는 유형
REASONS = {
    '연차': ['개인 사유', '가족 행사', '휴식', '여행', '자녀 학교 행사'],
    '반차': ['병원 진료', '개인 용무', '가족 돌봄', '관공서 방문'],
    '병가': ['입원 치료', '독감 회복', '건강검진 후 안정'],
    '경조': ['본인 결혼', '직계가족 경조', '조부모 상'],
}


def tenure_years_at(join_date, on='2026-01-01'):
    jd = datetime.date(*[int(v) for v in str(join_date)[:10].split('-')])
    od = datetime.date(*[int(v) for v in on.split('-')])
    return (od - jd).days / 365.25


def granted_of(emp):
    t = tenure_years_at(emp.get('join_date') or '2025-01-01')
    if t < 1:
        return max(1, min(11, int(t * 12)))
    return min(25, 15 + max(0, (int(t) - 1) // 2))


def workday_near(target, forward=True):
    """target(YYYY-MM-DD) 이후/이전 가장 가까운 평일(공휴일 제외)."""
    d = datetime.date(*[int(v) for v in target.split('-')])
    for _ in range(12):
        k = d.isoformat()
        if d.weekday() < 5 and k not in HOLIDAYS:
            return k
        d += datetime.timedelta(days=1 if forward else -1)
    return target


leaves = []
# emp_id → {period: 승인 휴가일수} (attendance 정합에 사용)
used_by_month = {}

for e in emps:
    eid = e['emp_id']
    granted = granted_of(e)
    # 상반기(1~7월) 사용률 15~55% — 조직·직급이 아니라 개인 해시로 분산
    ratio = 15 + H('leave-ratio', eid) % 41
    target_half = round(granted * ratio / 100.0 * 2) / 2.0    # 0.5일 단위
    reqs, used = [], 0.0
    month_used = {}
    n = 0
    # 승인된 연차/반차를 target_half 에 정확히 맞춰 채운다 (used_days 정합)
    while used < target_half - 1e-9 and n < 12:
        left = target_half - used
        if left >= 1 and (H('leave-kind', eid, n) % 4):
            days, typ = (2.0, '연차') if (left >= 2 and H('leave-2d', eid, n) % 3 == 0) else (1.0, '연차')
            if days > left:
                days = 1.0
        else:
            days, typ = (0.5, '반차') if left >= 0.5 else (left, '반차')
        if days > left:
            days = left
        mon = 1 + (H('leave-mon', eid, n) % 7)                # 2026-01 ~ 2026-07
        day = 1 + (H('leave-day', eid, n) % 27)
        start = workday_near('%04d-%02d-%02d' % (YEAR, mon, day))
        if start > AS_OF:                                     # 승인분은 과거만
            start = workday_near('2026-0%d-%02d' % (1 + n % 6, 1 + (H('leave-d2', eid, n) % 27)))
        end = start if days <= 1 else (
            datetime.date(*[int(v) for v in start.split('-')]) + datetime.timedelta(days=int(days) - 1)
        ).isoformat()
        rs = REASONS[typ]
        reqs.append({
            'req_id': 'LVR-%s-%02d' % (eid.replace('EMP-', ''), len(reqs) + 1),
            'type': typ, 'start': start, 'end': end, 'days': days,
            'status': '승인', 'reason': rs[H('leave-rsn', eid, n) % len(rs)],
        })
        used += days
        pm = start[:7]
        month_used[pm] = month_used.get(pm, 0.0) + days
        n += 1
    used = round(used, 1)

    # 대기 1건 (미래 일자) — 3명 중 1명꼴
    if H('leave-pend', eid) % 3 == 0:
        st = workday_near('2026-0%d-%02d' % (7 + H('leave-pm', eid) % 2, 18 + H('leave-pd', eid) % 10))
        reqs.append({
            'req_id': 'LVR-%s-P1' % eid.replace('EMP-', ''),
            'type': '연차', 'start': st, 'end': st, 'days': 1.0,
            'status': '대기', 'reason': REASONS['연차'][H('leave-pr', eid) % 5],
        })
    # 병가·경조 (연차 미소모) — 6명 중 1명꼴
    if H('leave-sick', eid) % 6 == 0:
        typ = '병가' if H('leave-st', eid) % 2 else '경조'
        st = workday_near('2026-0%d-%02d' % (2 + H('leave-sm', eid) % 5, 3 + H('leave-sd', eid) % 24))
        dd = 1.0 if typ == '병가' else 3.0
        en = (datetime.date(*[int(v) for v in st.split('-')]) + datetime.timedelta(days=int(dd) - 1)).isoformat()
        reqs.append({
            'req_id': 'LVR-%s-S1' % eid.replace('EMP-', ''),
            'type': typ, 'start': st, 'end': en, 'days': dd,
            'status': '승인', 'reason': REASONS[typ][H('leave-sr', eid) % len(REASONS[typ])],
        })
    # 반려 1건 — 9명 중 1명꼴
    if H('leave-rej', eid) % 9 == 0:
        st = workday_near('2026-0%d-%02d' % (3 + H('leave-rm', eid) % 4, 5 + H('leave-rd', eid) % 20))
        reqs.append({
            'req_id': 'LVR-%s-R1' % eid.replace('EMP-', ''),
            'type': '연차', 'start': st, 'end': st, 'days': 1.0,
            'status': '반려', 'reason': '팀 일정 중복 — 재신청 요청',
        })

    reqs.sort(key=lambda r: (r['start'], r['req_id']))
    remaining = round(granted - used, 1)
    leaves.append({
        'leave_id': 'LV-2026-' + eid.replace('EMP-', ''),
        'emp_id': eid, 'org_id': e.get('org_id'), 'year': YEAR,
        'granted_days': granted, 'used_days': used, 'remaining_days': remaining,
        'expiring_days': remaining, 'expiring_at': '2026-12-31',
        'promotion_target': remaining >= 10,   # 연차사용촉진(근로기준법 §61) 대상
        'requests': reqs,
    })
    used_by_month[eid] = month_used

leaveIdx = {l['emp_id']: l for l in leaves}


# ------------------------------------------------------------ 2) attendance
# 조직·직무에 따라 자연스럽게 분포시킨다 — 개발/데이터 직군 재택 ↑, 영업/CS 재택 ↓.
GROUP_PROFILE = {
    #                 재택 하한·상한, 초과근로 하한·상한
    '소프트웨어개발': (5, 9, 6, 22),
    '데이터AI':      (5, 9, 5, 20),
    '제품기획':      (3, 6, 4, 16),
    '전략기획':      (2, 5, 5, 18),
    'IT인프라':      (3, 7, 8, 26),
    'SI컨설팅':      (2, 6, 10, 30),
    '영업마케팅':    (0, 2, 4, 15),
    '고객서비스':    (0, 2, 3, 12),
    '경영관리':      (1, 3, 3, 12),
    '경영지원':      (1, 3, 3, 12),
}
DEFAULT_PROFILE = (1, 4, 4, 16)
# 초과근로 계절성 — 6월은 상반기 마감으로 전사적으로 증가
MONTH_OT_FACTOR = {'2026-04': 1.0, '2026-05': 0.9, '2026-06': 1.35, '2026-07': 0.6}


def group_of(emp):
    jp = jobProfiles.get(emp.get('jobProfileId')) or {}
    return jp.get('group')


def att_row(emp, period, partial=False):
    eid = emp['emp_id']
    lo_r, hi_r, lo_o, hi_o = GROUP_PROFILE.get(group_of(emp), DEFAULT_PROFILE)
    wd = WD[period]
    work_days = len(wd)
    lv = used_by_month.get(eid, {}).get(period, 0.0)
    lv = min(lv, work_days)
    actual = round(work_days - lv, 1)

    ot = pick(lo_o, hi_o, 'ot', eid, period) * MONTH_OT_FACTOR[period]
    # 이상치: 20명 중 1명은 해당 월 초과근로 급증(마감·장애 대응)
    if H('ot-spike', eid, period) % 20 == 0:
        ot *= 2.3
    ot = round(min(ot, 58.0), 1)

    late = pick(0, 2, 'late', eid, period)
    if H('late-out', eid, period) % 17 == 0:      # 이상치: 지각 급증
        late = pick(5, 8, 'late2', eid, period)
    early = pick(0, 1, 'early', eid, period)
    remote = pick(lo_r, hi_r, 'rmt', eid, period)
    if partial:
        remote = max(0, int(remote * work_days / 22.0))
        late = min(late, 2)

    in_min = 55 + H('in', eid, period) % 20        # 08:55 ~ 09:14
    in_h, in_m = (8, in_min) if in_min < 60 else (9, in_min - 60)
    extra = min(240, int(round(ot / max(actual, 1) * 60)))   # 하루 평균 초과 분(상한 4h)
    out_total = 18 * 60 + 5 + extra + H('out', eid, period) % 12
    row = {
        'att_id': 'ATT-%s-%s' % (period.replace('-', ''), eid.replace('EMP-', '')),
        'emp_id': eid, 'org_id': emp.get('org_id'), 'period': period,
        'work_days': work_days, 'actual_days': actual,
        'leave_days': round(lv, 1),
        'overtime_hours': ot,
        'late_count': late, 'early_leave_count': early, 'remote_days': remote,
        'avg_in_time': '%02d:%02d' % (in_h, in_m),
        'avg_out_time': '%02d:%02d' % (out_total // 60, out_total % 60),
    }
    if partial:
        row['partial'] = True
        row['as_of'] = AS_OF
    return row


def daily_all(emp, period, m):
    """해당 월 전체 일별 기록. 월 요약(m)의 초과근로·지각·재택 총량을 그 달에
    분배하므로 일별 합계 == 월 요약이 된다(화면 달력과 우측 집계가 어긋나지 않음)."""
    eid = emp['emp_id']
    off = {}
    for r in leaveIdx[eid]['requests']:
        if r['status'] != '승인':
            continue
        d0 = datetime.date(*[int(v) for v in r['start'].split('-')])
        d1 = datetime.date(*[int(v) for v in r['end'].split('-')])
        while d0 <= d1:
            off[d0.isoformat()] = r['type']
            d0 += datetime.timedelta(days=1)
    days = WD[period]
    full_off = set(k for k in days if off.get(k) in ('연차', '병가', '경조'))
    worked = [k for k in days if k not in full_off]
    remote = set(sorted(worked, key=lambda k: H('d-rmt', eid, k))[:min(m['remote_days'], len(worked))])
    late = set(sorted(worked, key=lambda k: H('d-late', eid, k))[:min(m['late_count'], len(worked))])
    # 초과근로 총량을 근무일에 가중 분배 (합 == m['overtime_hours'])
    w = {k: 0.35 + (H('d-w', eid, k) % 131) / 100.0 for k in worked}
    tw = sum(w.values()) or 1.0
    out = []
    for k in days:
        if k in full_off:
            out.append({'date': k, 'type': off[k], 'in': '', 'out': '', 'work_hours': 0.0})
            continue
        half = off.get(k) == '반차'
        base_h = 4.0 if half else 8.0
        extra = 0.0 if half else round(m['overtime_hours'] * w[k] / tw, 2)
        # 지각 판정선 09:11 — 정시 구간(08:52~09:09)과 겹치지 않게 분리한다
        if k in late:
            imin = 551 + H('d-li', eid, k) % 22          # 09:11 ~ 09:32 (지각)
        else:
            imin = 532 + H('d-in', eid, k) % 18          # 08:52 ~ 09:09 (정시)
        omin = int(round(imin + 60 + base_h * 60 + extra * 60))   # 점심 1시간
        out.append({
            'date': k,
            'type': '반차' if half else ('재택' if k in remote else '정상'),
            'in': '%02d:%02d' % (imin // 60, imin % 60),
            'out': '%02d:%02d' % (omin // 60, omin % 60),
            'work_hours': round(base_h + extra, 1),
        })
    return out


def reconcile(m, daily):
    """월 요약의 근태 지표를 일별 실적으로 재계산 — 두 값이 어긋나지 않게."""
    work = [d for d in daily if d['in']]
    if not work:
        return m
    ot = sum(max(0.0, d['work_hours'] - 8.0) for d in work)
    m['overtime_hours'] = round(ot, 1)
    m['late_count'] = len([d for d in work if d['in'] >= '09:11'])
    m['remote_days'] = len([d for d in work if d['type'] == '재택'])
    def mins(t):
        return int(t[:2]) * 60 + int(t[3:])
    ai = int(round(sum(mins(d['in']) for d in work) / float(len(work))))
    ao = int(round(sum(mins(d['out']) for d in work) / float(len(work))))
    m['avg_in_time'] = '%02d:%02d' % (ai // 60, ai % 60)
    m['avg_out_time'] = '%02d:%02d' % (ao // 60, ao % 60)
    return m


def window_rows(daily):
    """최근 4주(2026-06-18~07-15) 창에 드는 일별만 노출."""
    return [d for d in daily if DAILY_FROM <= d['date'] <= DAILY_TO]


attendance = []
for e in emps:
    sub = e['emp_id'] in SUBSET_SET
    for p in PERIODS:
        r = att_row(e, p)
        if sub and p == '2026-06':
            full = daily_all(e, p, r)
            reconcile(r, full)
            r['daily'] = window_rows(full)
        attendance.append(r)
    if sub:
        r = att_row(e, PARTIAL, partial=True)
        full = daily_all(e, PARTIAL, r)
        reconcile(r, full)
        r['daily'] = window_rows(full)
        attendance.append(r)

attIdx = {}
for a in attendance:
    attIdx[(a['emp_id'], a['period'])] = a


# --------------------------------------------------------------- 3) payroll
# 직급별 기본급 구간 — 데모용 합성치(실제 보상 테이블 아님)
BASE_BY_LEVEL = {
    'Associate': 3200000, 'Senior': 3900000, 'Manager': 4700000,
    'Senior Manager': 5500000, 'Director': 6500000, 'VP': 8500000,
    'SVP': 10500000, 'C-level': 13000000,
}
POS_ALLOW_BY_LEVEL = {
    'Manager': 150000, 'Senior Manager': 200000, 'Director': 350000,
    'VP': 600000, 'SVP': 900000, 'C-level': 1200000,
}
MEAL = 200000                      # 식대 — 비과세 한도 내
BONUS_RATIO = {'S': 1.0, 'A': 0.8, 'B': 0.6, 'C': 0.3, 'D': 0.1}
PAY_PERIODS = PERIODS              # 2026-04 · 05 · 06

# 4대보험·세율 (2026 가정) — payrollPolicy 에 그대로 노출해 AI가 인용
RATE = {'pension': 0.045, 'pension_cap': 6170000, 'health': 0.03545,
        'care_of_health': 0.1295, 'employment': 0.009}
TAX_TABLE = [(2000000, 0.015), (3000000, 0.025), (4000000, 0.040),
             (5000000, 0.055), (7000000, 0.075), (10000000, 0.105), (10 ** 12, 0.140)]


def income_tax_of(taxable):
    """2026 근로소득 간이세액표 근사 — 과세 대상 급여 구간별 실효율."""
    for cap, rate in TAX_TABLE:
        if taxable <= cap:
            return r10(taxable * rate)
    return r10(taxable * 0.14)


def base_of(emp):
    b = BASE_BY_LEVEL.get(emp.get('level'), 3200000)
    # 동일 직급 내 ±6% 개인차 (근속·평가 누적 반영 가정)
    return r10(b * (1 + (H('base', emp['emp_id']) % 121 - 60) / 1000.0))


payroll = []
for e in emps:
    eid = e['emp_id']
    base = base_of(e)
    pos = POS_ALLOW_BY_LEVEL.get(e.get('level'), 0) + (300000 if e.get('is_leader') else 0)
    hourly = base / 209.0                       # 통상시급 = 월 소정근로 209시간
    for p in PAY_PERIODS:
        a = attIdx[(eid, p)]
        ot_pay = r10(a['overtime_hours'] * hourly * 1.5)
        month = int(p[5:7])
        bonus = 0
        if month in (6, 12):
            bonus = r10(base * BONUS_RATIO.get(evalGrade.get(eid), 0.5))
        gross = base + pos + MEAL + ot_pay + bonus
        taxable = gross - MEAL                  # 식대 비과세
        pension = r10(min(taxable, RATE['pension_cap']) * RATE['pension'])
        health = r10(taxable * RATE['health'])
        care = r10(health * RATE['care_of_health'])
        employment = r10(taxable * RATE['employment'])
        inc = income_tax_of(taxable)
        loc = r10(inc * 0.1)
        ded = {'income_tax': inc, 'local_tax': loc, 'pension': pension,
               'health': health, 'employment': employment, 'other': care}
        total_ded = sum(ded.values())
        payroll.append({
            'pay_id': 'PAY-%s-%s' % (p.replace('-', ''), eid.replace('EMP-', '')),
            'emp_id': eid, 'org_id': e.get('org_id'), 'period': p,
            'base': base, 'position_allowance': pos, 'meal_allowance': MEAL,
            'overtime_pay': ot_pay, 'overtime_hours': a['overtime_hours'],
            'bonus': bonus,
            'bonus_reason': ('%s 성과급 (등급 %s · 기본급 %d%%)' % (
                FY + ' 상반기', evalGrade.get(eid) or '-',
                int(BONUS_RATIO.get(evalGrade.get(eid), 0.5) * 100))) if bonus else None,
            'gross': gross,
            'deductions': ded, 'deduction_total': total_ded,
            'net': gross - total_ded,
            'pay_date': p + '-25',
        })

# ---------------------------------------------------------- 4) payrollPolicy
payrollPolicy = {
    'policy_id': 'PAYPOL-2026',
    'effective_from': '2026-01-01',
    'pay_day': 25,
    'pay_day_note': '매월 25일 지급 (휴일이면 직전 영업일)',
    'pay_period': '당월 1일 ~ 말일 근무분',
    'overtime_rate': 1.5,
    'night_rate': 2.0,
    'holiday_rate': 1.5,
    'ordinary_hours_per_month': 209,
    'overtime_formula': '연장근로수당 = 기본급 ÷ 209 × 1.5 × 연장근로시간 (10원 단위 반올림)',
    'tax_table_ref': '2026 근로소득 간이세액표',
    'nontaxable': [{'item': '식대', 'monthly_limit': 200000, 'ref': '소득세법 시행령 §17의2'}],
    'insurance_rates': [
        {'name': '국민연금', 'rate': 0.045, 'base_cap': 6170000},
        {'name': '건강보험', 'rate': 0.03545},
        {'name': '장기요양보험', 'rate': 0.1295, 'base': '건강보험료', 'mapped_to': 'deductions.other'},
        {'name': '고용보험', 'rate': 0.009},
    ],
    'local_tax_rate': 0.1,
    'local_tax_note': '지방소득세 = 소득세의 10%',
    'bonus_months': [6, 12],
    'bonus_rule': '성과급은 6월·12월 급여에 합산 지급. 지급률 = 직전 평가등급별 기본급 비율 (S 100% · A 80% · B 60% · C 30% · D 10%)',
    'notes': [
        '이 정책은 데모용 합성 규칙입니다 — 실제 사규가 아닙니다.',
        '공제 항목의 other = 장기요양보험료입니다.',
        '급여 명세의 변동 사유를 설명할 때 이 규칙을 근거로 인용하세요.',
    ],
    'synthetic': True,
}

# ----------------------------------------------------------------- 주입
j['leaves'] = leaves
j['attendance'] = attendance
j['payroll'] = payroll
j['payrollPolicy'] = payrollPolicy
j['meta']['hr_ops'] = {
    'synthetic': True,
    'generated_by': 'scripts/enrich_hr_ops.py',
    'generated_at': '2026-07-28',
    'as_of': AS_OF,
    'fiscal_year': FY,
    'periods': PAY_PERIODS + [PARTIAL + '(부분·일부 대상자)'],
    'daily_window': DAILY_FROM + ' ~ ' + DAILY_TO,
    'notice': '근태·연차·급여는 데모용 합성 데이터입니다. 실존 인물의 실제 기록이 아닙니다.',
}
j['meta']['counts']['attendance'] = len(attendance)
j['meta']['counts']['leaves'] = len(leaves)
j['meta']['counts']['payroll'] = len(payroll)

# ------------------------------------------------------------ 검산 (쓰기 전)
ids = set(empIdx)
for l in leaves:
    assert l['emp_id'] in ids, l['leave_id']
    ap = round(sum(r['days'] for r in l['requests']
                   if r['status'] == '승인' and r['type'] in LEAVE_TYPES_PAID), 1)
    assert abs(ap - l['used_days']) < 1e-6, (l['leave_id'], ap, l['used_days'])
    assert abs(l['granted_days'] - l['used_days'] - l['remaining_days']) < 1e-6, l['leave_id']
    assert l['remaining_days'] >= 0, l['leave_id']
    for r in l['requests']:
        assert r['start'] <= r['end'] and r['status'] in ('승인', '대기', '반려'), r['req_id']

for a in attendance:
    assert a['emp_id'] in ids, a['att_id']
    lv = used_by_month.get(a['emp_id'], {}).get(a['period'], 0.0)
    assert abs(a['actual_days'] - (a['work_days'] - min(lv, a['work_days']))) < 1e-6, a['att_id']
    assert 0 <= a['actual_days'] <= a['work_days'], a['att_id']

for p in payroll:
    assert p['emp_id'] in ids, p['pay_id']
    items = p['base'] + p['position_allowance'] + p['meal_allowance'] + p['overtime_pay'] + p['bonus']
    assert p['gross'] == items, (p['pay_id'], p['gross'], items)
    tot = sum(p['deductions'].values())
    assert p['deduction_total'] == tot, p['pay_id']
    assert p['net'] == p['gross'] - tot, p['pay_id']
    assert p['net'] > 0, p['pay_id']
    assert (p['bonus'] > 0) == (int(p['period'][5:7]) in payrollPolicy['bonus_months']), p['pay_id']

out = prefix + json.dumps(j, ensure_ascii=False, separators=(',', ':')) + suffix
io.open(PATH, 'w', encoding='utf-8', newline='\n').write(out)

# ------------------------------------------------------------- self-check
jj = json.loads(io.open(PATH, encoding='utf-8').read()[len(prefix):-1])
assert len(jj['attendance']) == len(attendance)
assert len(jj['leaves']) == len(leaves) == len(emps)
assert len(jj['payroll']) == len(payroll) == len(emps) * len(PAY_PERIODS)
assert jj['meta']['hr_ops']['synthetic'] is True
assert jj['payrollPolicy']['pay_day'] == 25
daily_n = sum(len(a.get('daily') or []) for a in jj['attendance'])
print('OK attendance=%d (subset=%d, daily rows=%d) leaves=%d payroll=%d policy=1 topKeys=%d' % (
    len(jj['attendance']), len(SUBSET), daily_n, len(jj['leaves']), len(jj['payroll']), len(jj.keys())))
