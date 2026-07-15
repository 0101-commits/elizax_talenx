# -*- coding: utf-8 -*-
"""Authoritative, re-runnable data repair for talenx_data.js.
Parses window.TALENX_DATA, fixes cross-link/consistency defects, rewrites file.
Idempotent: safe to run repeatedly."""
import json, sys, io, re, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

import os
PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "talenx_data.js")
raw = open(PATH, "r", encoding="utf-8").read()
m = re.match(r"\s*window\.TALENX_DATA\s*=\s*(\{.*\})\s*;?\s*$", raw, re.DOTALL)
assert m, "wrapper not matched"
D = json.loads(m.group(1))

log = []
def note(s): log.append(s); print(s)

emps = {e["emp_id"]: e for e in D["employees"]}
orgs = {o["org_id"]: o for o in D["orgs"]}
objs = {o["objective_id"]: o for o in D["objectives"]}
krs  = {k["kr_id"]: k for k in D["keyResults"]}

# ---- FIX 5 (do first so checkins can reference): give currentUser EMP-0078 an owned objective ----
CU = D["meta"]["currentUser"]["emp_id"]  # EMP-0078
NEW_OBJ = "OBJ-EMP0078"
if NEW_OBJ not in objs:
    cu = emps[CU]
    parent = next((o["objective_id"] for o in D["objectives"]
                   if o.get("org_id")==cu["org_id"] and o.get("level")!="individual"), None)
    obj = {"objective_id":NEW_OBJ,"title":"서비스 기획 품질 및 사용자 만족도 향상",
           "type":"개인","level":"individual","org_id":cu["org_id"],
           "owner_emp_id":CU,"parent_objective_id":parent,"period":"FY2026-2Q",
           "status":"진행중","progress":58.0}
    D["objectives"].append(obj); objs[NEW_OBJ]=obj
    new_krs=[
      {"kr_id":"KR-EMP0078-1","objective_id":NEW_OBJ,"name":"신규 기능 기획서 사용자 검증 통과율",
       "target_value":"90%","current_value":"52%","weight":"50%","difficulty":"B","status":"진행중","progress":58},
      {"kr_id":"KR-EMP0078-2","objective_id":NEW_OBJ,"name":"기획 산출물 리드타임 단축",
       "target_value":"5일","current_value":"6.5일","weight":"50%","difficulty":"B","status":"진행중","progress":50},
    ]
    for k in new_krs: D["keyResults"].append(k); krs[k["kr_id"]]=k
    # a couple first-person check-ins for the new KRs
    D["checkins"].append({"checkin_id":"CHK-EMP0078-1","kr_id":"KR-EMP0078-1","objective_id":NEW_OBJ,
        "emp_id":CU,"checkin_date":"2026-06-20","progress_snapshot":58,"progress_delta":8,
        "confidence":"medium","comment":"2분기 신규 기획 3건 사용자 검증 통과, 잔여 2건 진행 중","blocker":"","likes_count":2})
    D["checkins"].append({"checkin_id":"CHK-EMP0078-2","kr_id":"KR-EMP0078-2","objective_id":NEW_OBJ,
        "emp_id":CU,"checkin_date":"2026-06-27","progress_snapshot":50,"progress_delta":10,
        "confidence":"low","comment":"리드타임 6.5일로 개선, 리뷰 단계 병목 남음","blocker":"디자인 QA 대기시간","likes_count":1})
    note(f"[FIX5] added owned objective {NEW_OBJ} + 2 KR + 2 checkins for {CU}")
else:
    note(f"[FIX5] {NEW_OBJ} already present, skip")

# ---- FIX 1: checkins — drop dangling kr_id, correct objective_id to KR's parent ----
before=len(D["checkins"]); kept=[]; corr=0
for c in D["checkins"]:
    k = krs.get(c.get("kr_id"))
    if not k:            # dangling kr_id -> drop
        continue
    if c.get("objective_id") != k["objective_id"]:
        c["objective_id"] = k["objective_id"]; corr+=1
    kept.append(c)
D["checkins"]=kept
note(f"[FIX1] checkins {before}->{len(kept)} (dropped {before-len(kept)} dangling kr_id; corrected {corr} objective_id)")

# ---- FIX 2 (data side): orgs headcount = rollup (self + all descendants by assignment) ----
children={}
for o in D["orgs"]: children.setdefault(o.get("parent_id"), []).append(o["org_id"])
direct={}
for e in D["employees"]: direct[e["org_id"]]=direct.get(e["org_id"],0)+1
def rollup(oid):
    tot=direct.get(oid,0)
    for c in children.get(oid,[]): tot+=rollup(c)
    return tot
changed=0
for o in D["orgs"]:
    r=rollup(o["org_id"])
    if o.get("headcount")!=r: o["headcount"]=r; changed+=1
    o["headcount_direct"]=direct.get(o["org_id"],0)
root_sum=sum(rollup(o["org_id"]) for o in D["orgs"] if o.get("parent_id") is None)
note(f"[FIX3] orgs headcount reconciled to rollup ({changed} changed); root rollup sum={root_sum} (roster={len(D['employees'])})")

# ---- FIX 4: demoSubjects.level align to roster ----
al=0
for ds in D["demoSubjects"]:
    rl=emps.get(ds["emp_id"],{}).get("level")
    if rl and ds.get("level")!=rl: ds["level"]=rl; al+=1
note(f"[FIX4] demoSubjects.level aligned to roster ({al} changed)")

# ---- FIX minor: dedupe persona_id ----
seen=set(); dd=0
for ds in D["demoSubjects"]:
    pid=ds.get("persona_id")
    if pid in seen:
        n=1
        while f"P{90+n:02d}" in seen or f"{pid}-{n}" in seen: n+=1
        ds["persona_id"]=f"{pid}-{n}"; dd+=1
    seen.add(ds["persona_id"])
note(f"[FIXminor] deduped {dd} duplicate persona_id")

# ---- VERIFY no dangling remains ----
kr_ok=all(c["kr_id"] in krs for c in D["checkins"])
obj_ok=all(c["objective_id"] in objs for c in D["checkins"])
mism=sum(1 for c in D["checkins"] if krs[c["kr_id"]]["objective_id"]!=c["objective_id"])
note(f"[VERIFY] checkin kr_id all-resolve={kr_ok}, objective_id all-resolve={obj_ok}, KR<->obj mismatches={mism}")
assert kr_ok and obj_ok and mism==0

# update meta counts
D["meta"].setdefault("counts",{})
D["meta"]["counts"]["checkins"]=len(D["checkins"])
D["meta"]["counts"]["objectives"]=len(D["objectives"])
D["meta"]["counts"]["keyResults"]=len(D["keyResults"])

out = "window.TALENX_DATA = " + json.dumps(D, ensure_ascii=False, separators=(",",":")) + ";"
if "--write" in sys.argv:
    open(PATH,"w",encoding="utf-8").write(out)
    note(f"[WRITE] {PATH} ({len(out)} bytes)")
else:
    note("[DRY RUN] pass --write to save")
