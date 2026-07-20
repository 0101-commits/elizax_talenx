#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
enrich_talenx_data.py — 목표–직무–전략 연결 데이터 보강 (재실행 가능·멱등)

fix_talenx_data.py 와 같은 방식으로 talenx_data.js 를 파싱해 보강 후 다시 쓴다.
2026-07 피드백 반영: "직무 내용 없이 성과목표를 도출하는 것은 기초가 없는 것."

보강 내용
  E1. 직무 프로파일 확장     — enrich_assets/job_profiles_new.json 의 신규 프로파일 병합
                              (JOB-소프트-064~098, 기존 63종과 동일 스키마)
  E2. 직원 전원 직무 연결    — employees[].jobProfileId 를 직무명 정확 일치로 채움 (221/221)
  E3. 전략 테마 신설         — strategyThemes (ST-01~ST-05)
  E4. 목표→전략 연결         — objectives[].strategy_theme_id (키워드 → 부모 상속)
  E5. 목표→직무 연결         — objectives[].job_ref {jobProfileId, task_area} (team/chapter/individual)
  E6. KR→직무 과업·역량 연결 — keyResults[].job_task_ref {jobProfileId, task_area, task}
                              keyResults[].competency_id (D1~D5)
  E7. KR 난이도 근거         — keyResults[].difficulty_basis {type, label, note}
                              ("무엇과 비교해 어렵다고 봤는지"가 평가 시점까지 남도록)
  E8. meta.linkage           — 연결률 집계 (HR 품질 지표 화면이 사용)

사용법:  python3 enrich_talenx_data.py          # 검사만 (dry-run)
         python3 enrich_talenx_data.py --write  # talenx_data.js 재작성
"""
import json, hashlib, os, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_JS = os.path.join(ROOT, "talenx_data.js")
NEW_PROFILES = os.path.join(ROOT, "enrich_assets", "job_profiles_new.json")

PREFIX = "window.TALENX_DATA = "


def h(s, mod):
    """결정적 선택용 해시 (재실행해도 같은 결과)."""
    return int(hashlib.md5(s.encode("utf-8")).hexdigest(), 16) % mod


def load():
    raw = open(DATA_JS, encoding="utf-8").read().strip()
    assert raw.startswith(PREFIX), "talenx_data.js 형식이 예상과 다릅니다"
    body = raw[len(PREFIX):].rstrip().rstrip(";")
    return json.loads(body)


def save(D):
    out = PREFIX + json.dumps(D, ensure_ascii=False, separators=(",", ":")) + ";"
    open(DATA_JS, "w", encoding="utf-8").write(out)


# ---------------------------------------------------------------- E1 · E2
def merge_profiles(D):
    added = 0
    if os.path.exists(NEW_PROFILES):
        for p in json.load(open(NEW_PROFILES, encoding="utf-8")):
            if p["job_id"] not in D["jobProfiles"]:
                D["jobProfiles"][p["job_id"]] = p
                added += 1
    return added


def link_employees(D):
    by_title = {p["title"]: p["job_id"] for p in D["jobProfiles"].values()}
    linked = 0
    for e in D["employees"]:
        if not e.get("jobProfileId"):
            pid = by_title.get(e.get("jobTitle"))
            if pid:
                e["jobProfileId"] = pid
                linked += 1
    return linked


# ---------------------------------------------------------------- E3 · E4
THEMES = [
    {"theme_id": "ST-01", "name": "수익성 있는 성장",
     "description": "FY2026 전사 매출 491억 달성 — 영업 파이프라인, 제품 매출, 구축/운영 수주 확대",
     "focus": ["매출", "수주", "파이프라인", "영업"]},
    {"theme_id": "ST-02", "name": "AI-native HR Tech 전환",
     "description": "AI x HR 신규 모델과 elizax 중심의 시장 리더십 확보",
     "focus": ["AI", "elizax", "모델", "PoC"]},
    {"theme_id": "ST-03", "name": "제품 경쟁력·품질 강화",
     "description": "hunel · talenx · JaDE 핵심 기능과 사용성, 안정성 고도화",
     "focus": ["제품", "기능", "품질", "UX"]},
    {"theme_id": "ST-04", "name": "고객 성공·신뢰",
     "description": "고객 유지율 95%, SLA 준수, 기술 지원 응답 개선",
     "focus": ["고객", "유지율", "SLA", "지원"]},
    {"theme_id": "ST-05", "name": "운영 효율·조직 기반",
     "description": "프로세스 효율화, 방법론 표준화, 정보보안·경영지원 기반 강화",
     "focus": ["효율", "표준화", "보안", "운영"]},
]

# 순서 중요 — 앞의 규칙이 먼저 잡는다
THEME_RULES = [
    ("ST-02", ["AI", "elizax"]),
    ("ST-04", ["고객", "유지율", "SLA", "응답 시간", "CS BU"]),
    ("ST-01", ["매출", "수주", "파이프라인", "영업", "GTM", "점유율"]),
    ("ST-05", ["효율", "표준화", "방법론", "보안", "경영지원", "BizOps", "운영 품질", "백로그", "우선순위"]),
    ("ST-03", ["기능", "품질", "UX", "사용성", "성능", "아키텍처", "스프린트", "제품", "시스템 구조", "컨설팅"]),
]


def assign_themes(D):
    fixed = {"OBJ-0001": "ST-01", "OBJ-0002": "ST-02"}
    by_id = {o["objective_id"]: o for o in D["objectives"]}
    order = {"company": 0, "division": 1, "bu": 2, "team": 3, "chapter": 4, "individual": 5}
    changed = 0
    for o in sorted(D["objectives"], key=lambda x: order.get(x.get("level"), 9)):
        if o.get("strategy_theme_id"):
            continue
        tid = fixed.get(o["objective_id"])
        if not tid:
            for t, kws in THEME_RULES:
                if any(k in o["title"] for k in kws):
                    tid = t
                    break
        if not tid and o.get("parent_objective_id") in by_id:
            tid = by_id[o["parent_objective_id"]].get("strategy_theme_id")
        o["strategy_theme_id"] = tid or "ST-05"
        changed += 1
    return changed


# ---------------------------------------------------------------- E5 · E6
def pick_task_area(profile, text, seed):
    """제목/KR명 토큰과 과업 문구가 겹치는 영역 우선, 없으면 결정적 선택."""
    areas = list(profile["tasks"].keys())
    toks = [t for t in text.replace("·", " ").split() if len(t) >= 2]
    best, score = None, 0
    for area in areas:
        blob = area + " ".join(profile["tasks"][area])
        s = sum(1 for t in toks if t in blob)
        if s > score:
            best, score = area, s
    return best or areas[h(seed, len(areas))]


COMP_RULES = [
    ("D2", ["협업", "연계", "공동", "조율", "커뮤니", "파트너"]),
    ("D5", ["교육", "학습", "인터뷰", "피드백", "만족도", "온보딩", "개선율"]),
    ("D1", ["전략", "방향", "리더십", "조직 설계", "로드맵"]),
    ("D3", ["품질", "기술", "아키텍처", "연구", "개발", "설계", "분석", "보안", "모델"]),
    ("D4", ["매출", "달성", "수주", "납기", "일정", "리드타임", "완료", "실시", "단축", "효율"]),
]


def pick_competency(name):
    for cid, kws in COMP_RULES:
        if any(k in name for k in kws):
            return cid
    return "D4"


DIFF_BASIS = {
    "S": [
        {"type": "yoy",   "label": "전년 동기 실적 대비 +40% 스트레치", "note": "목표수립 시점(4/2) 전년 실적 기준으로 상향 폭을 합의"},
        {"type": "first", "label": "조직 최초 시도 — 비교 가능한 전년 실적 없음", "note": "선행 지표와 중간 마일스톤으로 달성 여부를 판정"},
        {"type": "peer",  "label": "동일 직군 상위 10% 수준의 도전 목표", "note": "직군 벤치마크 대비 난도를 목표수립 시점에 합의"},
    ],
    "A": [
        {"type": "yoy",  "label": "전년 실적 대비 +20% 상향", "note": "목표수립 시점(4/2) 전년 실적 기준"},
        {"type": "peer", "label": "동일 직군 평균 대비 상향 설정", "note": "직군 평균 실적을 비교선으로 합의"},
    ],
    "B": [
        {"type": "yoy", "label": "전년 수준 유지 — 안정 운영 목표", "note": "운영 연속성 확보가 목적, 전년 실적이 비교선"},
    ],
}


def link_goals(D):
    profiles = D["jobProfiles"]
    emp = {e["emp_id"]: e for e in D["employees"]}
    by_id = {o["objective_id"]: o for o in D["objectives"]}

    obj_ref = kr_ref = 0
    for o in D["objectives"]:
        if o.get("level") in ("team", "chapter", "individual"):
            owner = emp.get(o.get("owner_emp_id"))
            pid = owner and owner.get("jobProfileId")
            if pid and pid in profiles and not o.get("job_ref"):
                o["job_ref"] = {"jobProfileId": pid,
                                "task_area": pick_task_area(profiles[pid], o["title"], o["objective_id"])}
                obj_ref += 1
        elif "job_ref" not in o:
            o["job_ref"] = None

    for k in D["keyResults"]:
        o = by_id.get(k.get("objective_id"))
        owner = o and emp.get(o.get("owner_emp_id"))
        pid = owner and owner.get("jobProfileId")
        if pid and pid in profiles and not k.get("job_task_ref"):
            p = profiles[pid]
            area = pick_task_area(p, k["name"], k["kr_id"])
            tasks = p["tasks"][area]
            toks = [t for t in k["name"].replace("·", " ").split() if len(t) >= 2]
            task = max(tasks, key=lambda s: sum(1 for t in toks if t in s))
            if not any(t in task for t in toks):
                task = tasks[h(k["kr_id"], len(tasks))]
            k["job_task_ref"] = {"jobProfileId": pid, "task_area": area, "task": task}
            kr_ref += 1
        if not k.get("competency_id"):
            k["competency_id"] = pick_competency(k["name"])
        if not k.get("difficulty_basis"):
            opts = DIFF_BASIS.get(k.get("difficulty"), DIFF_BASIS["B"])
            k["difficulty_basis"] = dict(opts[h(k["kr_id"], len(opts))])
    return obj_ref, kr_ref


# ---------------------------------------------------------------- E8
def stamp(D):
    emps = D["employees"]
    objs = D["objectives"]
    krs = D["keyResults"]
    def rate(n, d):
        return round(100.0 * n / d, 1) if d else 0.0
    linked_emp = sum(1 for e in emps if e.get("jobProfileId"))
    themed = sum(1 for o in objs if o.get("strategy_theme_id"))
    krj = sum(1 for k in krs if k.get("job_task_ref"))
    krd = sum(1 for k in krs if k.get("difficulty_basis"))
    krc = sum(1 for k in krs if k.get("competency_id"))
    measurable = sum(1 for k in krs if any(c.isdigit() for c in str(k.get("target_value", ""))))
    D["meta"]["linkage"] = {
        "employees_with_job_profile": linked_emp, "employees_total": len(emps),
        "job_profile_rate": rate(linked_emp, len(emps)),
        "objectives_with_theme": themed, "objectives_total": len(objs),
        "theme_rate": rate(themed, len(objs)),
        "krs_with_job_task_ref": krj, "krs_with_difficulty_basis": krd,
        "krs_with_competency": krc, "krs_total": len(krs),
        "kr_job_ref_rate": rate(krj, len(krs)),
        "kr_difficulty_basis_rate": rate(krd, len(krs)),
        "kr_measurable": measurable, "kr_measurable_rate": rate(measurable, len(krs)),
    }
    D["meta"]["counts"]["jobProfiles"] = len(D["jobProfiles"])
    D["meta"]["counts"]["strategyThemes"] = len(D.get("strategyThemes", []))
    D["meta"]["enriched_by"] = "enrich_talenx_data.py"
    D["meta"]["enriched_at"] = "2026-07-20"


def verify(D):
    probs = []
    pids = set(D["jobProfiles"].keys())
    for e in D["employees"]:
        if not e.get("jobProfileId"):
            probs.append("미연결 직원 " + e["emp_id"] + " " + e.get("jobTitle", ""))
        elif e["jobProfileId"] not in pids:
            probs.append("잘못된 프로파일 참조 " + e["emp_id"])
    tids = {t["theme_id"] for t in D.get("strategyThemes", [])}
    for o in D["objectives"]:
        if o.get("strategy_theme_id") not in tids:
            probs.append("테마 미연결 " + o["objective_id"])
    for k in D["keyResults"]:
        r = k.get("job_task_ref")
        if not r or r["jobProfileId"] not in pids or r["task_area"] not in D["jobProfiles"][r["jobProfileId"]]["tasks"]:
            probs.append("직무 참조 오류 " + k["kr_id"])
        if not k.get("difficulty_basis") or not k.get("competency_id"):
            probs.append("근거/역량 누락 " + k["kr_id"])
    return probs


def main():
    write = "--write" in sys.argv
    D = load()
    added = merge_profiles(D)
    linked = link_employees(D)
    if "strategyThemes" not in D:
        D["strategyThemes"] = THEMES
    themed = assign_themes(D)
    obj_ref, kr_ref = link_goals(D)
    stamp(D)
    probs = verify(D)
    print("프로파일 병합 +%d (총 %d) · 직원 연결 +%d (%d/%d) · 테마 배정 %d · 목표 job_ref %d · KR 연결 %d"
          % (added, len(D["jobProfiles"]), linked,
             D["meta"]["linkage"]["employees_with_job_profile"], len(D["employees"]),
             themed, obj_ref, kr_ref))
    print("linkage:", json.dumps(D["meta"]["linkage"], ensure_ascii=False))
    if probs:
        print("문제 %d건:" % len(probs))
        for p in probs[:20]:
            print(" -", p)
        sys.exit(1)
    if write:
        save(D)
        print("talenx_data.js 재작성 완료 (%d bytes)" % os.path.getsize(DATA_JS))
    else:
        print("dry-run — 반영하려면 --write")


if __name__ == "__main__":
    main()
