# -*- coding: utf-8 -*-
"""체크인 원천을 하나로 — 화면과 신호가 같은 기록을 보게 만든다.

문제
  체크인 3,359건이 두 갈래였다.
    · 손으로 쓴 데모 360건  confidence 가 영문(low/medium/high) · 최신 6/27
    · 자동 생성 2,999건     confidence 가 한글(낮음/보통/높음) · 최신 7/6 · 장애요인 없음
  신호 엔진은 「영문 confidence」로 앞의 360건만 골라 세고, 화면은 3,359건을 전부
  그렸다. 그래서 같은 화면에서 「7월 6일 체크인」과 「103일째 멈춤」이 함께 보였다.

  엔진이 좁힌 까닭은 자동 생성분이 **모든 핵심결과를 7/6까지 빠짐없이** 채워
  체크인 공백이 0이 되기 때문이다. 데이터에 공백이 없으니 공백 신호가 못 떴다.

고치는 것
  ① confidence 를 영문 하나로 통일한다 → 「영문만 고르기」가 곧 전량이 되어
     엔진 코드를 손대지 않고도 두 층이 같은 기록을 본다.
  ② 실제 공백을 만든다 — 세 팀의 핵심결과 절반에서 기준일 이후 체크인을 지운다.
     남은 여덟 팀은 그대로 두어 「기준을 넘긴 팀」이 실제로 갈린다.

멱등. 다시 돌려도 같은 결과.
"""
import io, json, os, re, sys

sys.stdout.reconfigure(encoding="utf-8")

PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "js", "talenx_data.js")

CONF_KR = {"낮음": "low", "보통": "medium", "높음": "high"}

# 멈춘 팀 — (조직, 이 날짜 뒤 체크인을 지운다, 팀 핵심결과 중 몇 건을 멈추게 할지)
# 기준 시점 2026-07-16 에서 각각 103일 · 73일 · 45일 공백이 된다.
STALL = [
    ("ORG-027", "2026-04-04", 2),   # PPA Chapter
    ("ORG-028", "2026-05-04", 2),   # PB Chapter
    ("ORG-032", "2026-06-01", 2),   # TA Chapter
]


def load():
    raw = io.open(PATH, encoding="utf-8").read()
    m = re.match(r"\s*window\.TALENX_DATA\s*=\s*(\{.*\})\s*;?\s*$", raw, re.DOTALL)
    assert m, "wrapper not matched"
    return json.loads(m.group(1))


def save(D):
    body = json.dumps(D, ensure_ascii=False, separators=(",", ":"))
    io.open(PATH, "w", encoding="utf-8", newline="\n").write(
        "window.TALENX_DATA = " + body + ";\n")


def subtree(D, root):
    ids, changed = {root}, True
    while changed:
        changed = False
        for o in D["orgs"]:
            if o.get("parent_id") in ids and o["org_id"] not in ids:
                ids.add(o["org_id"])
                changed = True
    return ids


def krs_of_org(D, org_ids):
    obj_ids = {o["objective_id"] for o in D["objectives"] if o.get("org_id") in org_ids}
    return [k for k in D["keyResults"] if k.get("objective_id") in obj_ids]


def main():
    D = load()
    cks = D["checkins"]
    before = len(cks)

    # ① confidence 통일
    fixed = 0
    for c in cks:
        v = c.get("confidence")
        if v in CONF_KR:
            c["confidence"] = CONF_KR[v]
            fixed += 1
    print("confidence 한글 → 영문 :", fixed, "건")

    # ② 실제 공백 만들기
    cut_total = 0
    for org, cutoff, want in STALL:
        krs = krs_of_org(D, subtree(D, org))
        # 핵심결과 순서를 고정해 멱등을 지킨다
        target = sorted(k["kr_id"] for k in krs)[:want]
        keep, cut = [], 0
        for c in cks:
            if c.get("kr_id") in target and (c.get("checkin_date") or "") > cutoff:
                cut += 1
                continue
            keep.append(c)
        cks[:] = keep
        cut_total += cut
        name = next(o["name"] for o in D["orgs"] if o["org_id"] == org)
        print("  %-14s %s 뒤 %d건 삭제 (핵심결과 %d/%d건 멈춤)"
              % (name, cutoff, cut, len(target), len(krs)))

    save(D)
    print("체크인 %d건 → %d건 (삭제 %d)" % (before, len(cks), cut_total))
    last = max(c["checkin_date"] for c in cks)
    kinds = sorted({c.get("confidence") for c in cks})
    print("최신 체크인:", last, "· confidence 값:", kinds)


if __name__ == "__main__":
    main()
