# 18차 — 신호 알림 카드 신설 + elizax UX/UI 고도화 (공유 계약서)

작성 2026-07-31. 병렬 빌더 에이전트 공용 계약서. **각 담당은 자기 소유 파일만 고친다.**
원천 = `성과평가 AI Agent_AX Consulting_W5_signal catalogue_260730.xlsx` (신호 150건 · 카탈로그 v0.6 문법).

---

## 0. 사용자 요청 6건과 대응

| # | 요청 | 대응 | 담당 |
|---|---|---|---|
| 1 | elizax 제안 + 에이전트 알림(선제 감지)을 **하나의 UI로 통일**. 두 건이면 "두 건 있다"고 알림. **9+ 정체 불명**. 색은 빨강이 아니라 **파란 계열** | 카드 렌더러 1개(`EZSignalCard`)로 3개 표면 교체. 스택 pager. 배지 = 미처리 신호 수, `--color-accent` | W2·W3·W5 |
| 2 | 패널 **상하 크기 확대**. 헤더 잡다한 칩(최정남/서비스기획담당·현재 화면 홈·평가 진행중›리뷰·내 직무) 삭제. **현재 화면 맥락 토글 삭제**. **(연결됨·AI 연결됨) 삭제**. 대화 내보내기 삭제, 대화 목록+대화 초기화 → **새 채팅 시작** 한 칸. "지금 도와드릴 수 있는 일" = **W5 카드 중심 재구성** | 아래 §3 | W3·W6 |
| 3 | API 재연결 | **완료** — 예약작업 `elizax-engine` 재기동, `/api/health` = `{ok:true,keySet:true,model:"claude-sonnet-5"}` | 본세션 |
| 4 | 대화 목록·기록·돋보기 **중복 → 하나로 통합**. **elizax AI 연결 설정 삭제** | 탭 3→2, `ezcs-bar` 폐지, 🔍 = 대화 찾기 단일 진입, ⚙ 제거 | W3·W6 |
| 5 | W5 카탈로그 기반 알림을 **우선 노출**, 화면·데이터 **전부 연결**, API가 자동으로 답 + 기능 활성화 | `EZSignalEngine`(실데이터 평가) + `tx_signal_actions.js`(A1~A6 → 기존 화면) | W1·W4 |

**사용자 결정 3건** — ①상위조직장 신호 32건은 **조직장(leader)이 겸수**(`상위 조직 관점` 구분 칩, 새 롤 만들지 않음) ②라이브 = **「지금 켤 수 있는 신호」 15건만 실계산**, 나머지 135건은 카탈로그 열람 전용("데이터 준비 필요" 배지) ③패널 탭 = **알림·대화 2탭**, 기록은 알림 탭 안 「지난 알림」으로 접음.

---

## 1. 데이터 원천 — `window.EZSignalCatalog`

`js/ez_signals.js` (662KB 자동 생성물, 생성기 `scripts/build_signals.py`, **직접 고치지 않는다**).

```js
{ version:"v0.6 / W5 260730", count:150,
  typeLabel:{T1:"기한 도래",T2:"작성 공백",T3:"기준 이탈",T4:"연결 불일치",T5:"상황 변동"},
  actionLabel:{A1:"새로 쓰기",A2:"내가 고치기",A3:"알려주기",A4:"1on1 잡기",A5:"상세 보기",A6:"승인 요청"},
  signals:[{
    id:"목표수립-구성원-01", no:1, stage:"목표수립", stageNo:1,
    actor:"구성원", actorNo:1, roles:["member"],          // 상위조직장 → roles:["leader"]
    type:"T1", typeLabel:"기한 도래", level:"기초",        // 기초 90 / 심화 60
    ai:"데이터 보완 후",                                    // 바로 가능 / 데이터 보완 후 / 이력 축적 후
    need:"기본 데이터", now:0,                             // now:1 = 지금 켤 수 있는 신호(15건)
    notice:"2026년 2분기 목표 확정일까지 3일 남았는데 저장한 목표가 0건이에요",   // 한 문장 26~44자
    principle:"…할 때", example:"… → AI 알림", refs:"…", drafts:"…", compare:"회사 규정값",
    thresholds:[{code:"TH-…", name:"목표 확정 마감 잔여일", value:"3일", range:"2~5일", why:"…"}],
    evidence:[{mark:"①", axis:"사실", text:"…", emph:"0건", src:"EMP-0078 / objectives.owner_emp_id",
               asof:"2026-07-16", calc:"남은 일수 = 확정 마감일 − 오늘", show:"기본", assumed:1, basis:"회사 규정값"}],
    actions:[{rank:1, type:"A1", kind:"새로 쓰기", label:"목표 초안 (수정할 수 있어요)",
              draft:"…실제 제출되는 문안…", confirm:"목표 3건 저장", store:"목표 신규 저장 + 핵심결과 동시 생성",
              chips:["더 도전적으로","수치 목표로"], newdata:"목표 기간 일정 마스터"}],
    agent:"직무 과업과 상위 목표로 목표 초안 3건을 잡아봤어요. 다듬어볼까요?",   // 25~45자 해요체
    done:{title:"목표 3건을 저장했어요", desc:"핵심결과와 함께 목표 기록에 새로 저장됩니다."},
    score:{help:3,freq:3,unique:1}, mute:{repeat:"3일", minCount:"해당 없음", clear:"목표를 1건이라도 저장하면 즉시"},
    adopt:"범용", todoDecide:"…", todoCreate:"…"
  }, …]}
```

### 카탈로그가 강제하는 화면 규칙 (Outlook 시트 = 절대 기준)
- **근거는 위 2줄만 카드에 보이고 나머지는 접는다.** 기초 3~4줄 / 심화 5~7줄.
- **처리 방법은 기초 1~2개, 심화 1~3개.** `A5 상세 보기`는 **첫 처리가 될 수 없다**(기록이 안 남으므로).
- 재알림 출발값 = 기초 7일 / 심화 14일. 신호별 `mute.repeat` 우선.
- 수신 순서 = 구성원 → 팀장 → 상위 조직장 → HR·경영진. 아래에서 처리되지 않은 것만 위로 올라간다.
- 세 문구를 섞지 않는다 — `actions[].draft`=제출되는 문안 / `agent`=건네는 말 한 줄 / `done`=처리 후 확인 문구.
- `evidence[].assumed` = 추정값 → 화면에 **(추정)** 표시. `thresholds[].value`는 전부 예시값 → **(예시)** 표시.

---

## 2. 통합 카드 — `window.EZSignalCard` (W2 소유)

**어휘 단일화**: 화면에 쓰는 말은 **「알림」** 하나. `제안`·`문맥 제안`·`선제 브리핑`·`에이전트 알림 · 선제 감지` 네 어휘 전부 폐지. 근거 출처는 카드 안 `.ezs-why`로만 밝힌다.

### DOM (prefix `ezs-`)
```html
<article class="ezs-card" data-sig="목표수립-구성원-01" data-mode="stack|slot|inline|welcome" data-t="T1">
  <header class="ezs-hd">
    <span class="ezs-type">기한 도래</span>
    <span class="ezs-stage">목표수립</span>
    <span class="ezs-scope">상위 조직 관점</span>   <!-- actor==="상위조직장" 일 때만 -->
    <span class="ezs-sp"></span>
    <span class="ezs-rel" hidden>관련 2건</span>
    <button class="ezs-x" data-ezs-close aria-label="닫기">✕</button>
  </header>
  <p class="ezs-notice">…notice…</p>
  <ul class="ezs-ev">                              <!-- show==="기본" 중 위 2줄 -->
    <li><i class="ezs-ax">사실</i><span>…<b>0건</b>…</span>
        <span class="ezs-why">objectives.owner_emp_id · 기준 7/16</span></li>
  </ul>
  <button class="ezs-ev-more" data-ezs-ev>근거 2줄 더 보기</button>
  <div class="ezs-fold" hidden>
    <ul class="ezs-ev ezs-ev-rest">…나머지 근거…</ul>
    <dl class="ezs-th"><dt>목표 확정 마감 잔여일</dt><dd>3일 <em>(예시 · 조정 2~5일)</em></dd></dl>
    <p class="ezs-rule">알림 조건 — …principle…</p>
  </div>
  <div class="ezs-acts">
    <button class="ezs-btn ezs-btn-1" data-ezs-act="0">목표 초안 열기</button>
    <button class="ezs-btn" data-ezs-act="1">…</button>
  </div>
  <p class="ezs-agent">✦ …agent…</p>
  <footer class="ezs-ft">3일 뒤 다시 알림 · 목표를 1건이라도 저장하면 해제</footer>
</article>
```
2건 이상이면 `<div class="ezs-stack" data-n="2">` 로 감싸고 헤더 `.ezs-rel`에 `관련 N건`, 하단에 `‹ 1/N ›` pager. **관련 판정 = 같은 `stage` + 같은 `roles` 교집합.**

### 공개 API
```js
EZSignalCard.render(inst, mode)   // → HTMLElement. mode: "stack"|"slot"|"inline"|"welcome"
EZSignalCard.stack(insts, mode)   // → HTMLElement (1건이면 render와 동일)
EZSignalCard.slot(insts)          // 우하단 선제 슬롯에 띄운다. EZProactive.claim 경유
EZSignalCard.mount(el, insts, mode)
```
`inst` = `EZSignalEngine`이 만든 인스턴스(§4). 카드는 **계산하지 않는다** — 받은 값만 그린다.

### 색 — 파란 계열만. 빨강 0
유형칩은 파랑/네이비/무채색 5단으로만 가른다. 심각도를 색으로 말하지 않는다(카탈로그에 심각도 축이 없다).

| 유형 | 배경 | 글자 |
|---|---|---|
| T1 기한 도래 | `var(--color-accent)` | `var(--color-on-accent)` |
| T2 작성 공백 | `var(--color-trust)` | `#fff` |
| T3 기준 이탈 | `color-mix(in srgb, var(--color-accent) 14%, transparent)` | `var(--color-text-accent)` |
| T4 연결 불일치 | `color-mix(in srgb, var(--color-trust) 12%, transparent)` | `var(--color-trust)` |
| T5 상황 변동 | `var(--color-background-muted)` | `var(--color-text-secondary)` |

토큰 출처 — `--color-accent` `light-dark(#1F7AF0,#B5C4FF)`(`css/astryx-talenx.css:86`) · `--color-trust` `light-dark(#23408E,#8fa8e8)`(`:132`) · `--color-on-accent`(`:88`). **hex 직접 쓰기 금지**(`css/tx_elizax.css:4` 규칙과 동일).
`--color-error`(#a50c25)는 이 카드에서 **쓰지 않는다**. `--color-trust-warm`(#C2410C)도 쓰지 않는다.

---

## 3. 패널 골격 수술 (W3 소유 — `js/tx_elizax.js`, `css/tx_elizax.css`)

| 항목 | 지금 | 바꿀 것 | 근거 |
|---|---|---|---|
| 크기 | `width:380px; height:72vh; max-height:640px; min-height:420px` (`css/tx_elizax.css:47-49`) | `width:420px; height:86vh; max-height:920px; min-height:560px` | 요청 2 |
| 좁은 화면 | `@media(max-width:460px)` `height:82vh` (`:60-62`) | `height:90vh` 유지·확대 | |
| 탭 | 대화·기록·알림 3개 (`tx_elizax.js:261-270`) | **알림·대화 2개, 기본 진입 = 알림**. `기록`은 알림 탭 하단 `지난 알림` 접이식 | 결정 ③ |
| 알림 탭 내용 | `renderNtf()` 아카이브 행 (`:436-462`) | `EZSignalCard.stack()` 카드 스택 + 하단 `지난 알림`(기존 `EZNotif` 행 + `EZLedger` 진입) | 요청 1·5 |
| 배지 | `.ezx-cnt`/`.ezx-tab-n` = `EZNotif.unreadCount()`, `--color-error` (`:38`,`:103`) | **`EZSignalEngine.pending().length`**, `--color-accent`. `>9`면 `9+`(양쪽 동일하게), `title="처리하지 않은 알림 N건"` | 요청 1 |
| `.ezx-ctx` 칩 행 | 5개(신원·현재 화면·맥락 토글·사이클·내 직무) (`:297-307`) | **행 전체 삭제.** 사이클·내 직무는 이미 `tx_entry.js` ⋯메뉴에 있음(`결정 흐름`·`목표–직무 연결 지도`) | 요청 2 |
| 맥락 토글 | `state.attachContext` 기본 true (`:99`, `:301`) | 토글 UI 삭제, **플래그는 true 고정**(`buildPayloadMessage` `:1155` 그대로) | 요청 2 |
| `.ezx-status` | `● 연결됨 · AI 연결됨` (`:2424-2436`) | **삭제.** 단 `EZAI.ready()`가 false일 때만 `.ezx-note.warn` 한 줄로 대체 노출 | 요청 2 |
| ⚙ 버튼 | `EZAI.openSettings` (`:251-254`) | **삭제**(버튼만. `EZAI.openSettings` 함수는 남긴다 — `tx_fix_msf.js:478`이 부름) | 요청 4 |
| 🔍 | `tx_chat_search.js` 오버레이 | **대화 찾기 단일 진입** — 오버레이 상단에 세션 목록, 하단에 검색 결과 | 요청 4 |
| `ezcs-bar` (≡ 대화 목록) | `tx_chat_sessions.js:187-196` | **삭제**(드롭다운 기능은 🔍 오버레이로 이관) | 요청 4 |
| footer row | `대화 초기화` + `내보내기` (`:336-341`, `tx_chat_export.js:287`) | **`＋ 새 채팅 시작` 한 칸**(`EZChat.newSession()` + `resetConversation` 겸용). 내보내기 삭제 | 요청 2 |
| 웰컴 `지금 도와드릴 수 있는 일` | `TXAgent.SCENARIOS` 5칩 (`:589-598`) | **역할별 라이브 신호 카드 3장**(`EZSignalCard.render(inst,"welcome")`) + `카탈로그 전체 보기(150건)` 링크 1줄 | 요청 2·5 |
| 일반 스타터 3칩 | `내 목표 진행상황 점검` 등 (`:601-607`) | 유지 | |

**보존 필수**: `Elizax.*` 공개 API 13종(`:2463-2489`)·`EZNotif`(`:114-156`)·`attachSurface/detachSurface`(허브 공유 서피스)·`showTab(key,hl)` 3키(`chat|rec|ntf`) — `rec` 호출자는 `tx_ctx_ledger.js`이므로 **`rec`는 `ntf`+지난 알림 펼침으로 리다이렉트**한다.

---

## 4. 신호 엔진 — `window.EZSignalEngine` (W1 소유, `js/ez_signal_engine.js` 신설)

```js
EZSignalEngine.catalog()            // → window.EZSignalCatalog
EZSignalEngine.forRole(role)        // → signals[] (roles 포함, actorNo 오름차순)
EZSignalEngine.live(role)           // → inst[]  now===1 이고 평가가 참인 것만
EZSignalEngine.evaluate(id)         // → {hit:bool, facts:{}, evidence:[치환됨], thresholds:[치환됨], asof:"YYYY-MM-DD"}
EZSignalEngine.pending(role)        // → inst[]  미처리(해제·스누즈 제외)
EZSignalEngine.resolve(id, how)     // how: "acted"|"dismissed". 상태 저장 + ez:ctx 기록
EZSignalEngine.snooze(id)           // mute.repeat 만큼 미룸
EZSignalEngine.prompt(inst)         // → AI에 보낼 문자열(신호 문구 + 근거 실측 + 초안 지침 + 출력 형식)
EZSignalEngine.onChange(fn)
```
상태 = `localStorage["ez_signal_v1:"+emp_id]` = `{ "<id>": {st:"acted|dismissed|snoozed", at:ISO, until:ISO} }`.

**실측 치환 규칙**: 카탈로그 `evidence[].text`·`emph`·`thresholds[].value`의 숫자를 실계산값으로 갈아끼운다. 계산 못 한 줄은 **버리지 않고** `assumed:1`로 남겨 `(추정)` 표시. `asof` = `TALENX_DATA` 기준시점 문자열 하나로 통일(고정 문자열 4곳 불일치가 기존 결함).

### 라이브 15건 — 평가기와 데이터 원천
| 신호 ID | 무엇을 세는가 | 원천 |
|---|---|---|
| 목표수립-구성원-04 | KR 중 `job_task_ref` 없음 건수 + 1순위 역량 연결 0 | `keyResults`, `jobProfiles[].competency_profile` |
| 목표수립-구성원-08 | 내 KR `name`이 전사 KR에서 재사용된 곳 수 | `keyResults` 전건 |
| 목표수립-구성원-09 | 내 KR `competency_id` 분포 vs 직무 가중 상위 3 역량 | `keyResults`, `competency_profile` |
| 목표수립-구성원-10 | 목표 `parent`(상위 목표) 결측인데 KR은 과업 연결됨 | `objectives`, `keyResults` |
| 목표수립-상위조직장-05 | 하위 팀 목표 중 상위 목표 연결 결측 | `objectives`, `orgs` 하위 롤업 |
| 목표수립-상위조직장-07 | 팀별 1순위 역량 미연결률 vs 전사 평균 | `keyResults`, `orgs` |
| 목표수립-상위조직장-08 | 저장 후 경과일 + 과업 연결 결측 | `objectives.updated_at`, `keyResults` |
| 중간점검-구성원-08 | 내 KR 중 체크인 0건 건수 + 그 가중치 합 | `checkins`, `keyResults.weight` |
| 중간점검-상위조직장-03 | 하위 팀 평균 진척 최고·최저 격차 | `keyResults.progress`, `orgs` |
| 중간점검-상위조직장-05 | 최근 2주 체크인에서 반복 장애요인 | `checkins.blockers` |
| 중간점검-상위조직장-06 | 팀 체크인 중 확신도 낮음 비율 | `checkins.confidence` |
| 중간점검-상위조직장-08 | 표시 진행률 vs 가중평균 진행률 차 | `objectives.progress`, `keyResults` |
| 중간점검-HR경영진-09 | 조직 간 목표 진행률 최고·최저 | `objectives`, `orgs` |
| 평가-구성원-02 | 자기평가 근거로 쓸 내 체크인 건수 | `checkins` |
| 평가-구성원-10 | 직무 변경 이력 + 가중 1순위 역량 변화 | `employees[].jobHistory`, `competency_profile` |

**나머지 135건** = `now:0`. 카드에 `데이터 준비 필요` 무채색 배지 + `todoDecide`/`todoCreate` 한 줄. 처리 버튼은 비활성, `A5 상세 보기`만 살린다. **거짓 작동을 만들지 않는다.**

---

## 5. 처리 배선 — `window.EZSignalAct` (W4 소유, `js/tx_signal_actions.js` 신설)

`EZSignalAct.run(inst, actionIdx)` → 기존 기능만 쓴다. 새 화면을 만들지 않는다.

| 처리 | 가는 곳 | 붙일 것 |
|---|---|---|
| A1 새로 쓰기 | 목표 → `#s-perf` 목표생성 오버레이(`tx_fix_perf.js`) · 체크인 → 체크인 승인 모달(fix 18) · 자기평가 → `tx_fix_appr.js` `writeFormBody(emp,'self')` | `EZDraft`/`EZAI`로 `actions[].draft`를 실데이터 기반 초안으로 프리필. `chips`는 재요청 칩으로 |
| A2 내가 고치기 | 목표 상세 `.txf-ov` · KR 가중치 인라인 편집 | 수정 전·후 값 `ez:ctx` 기록 |
| A3 알려주기 | `TX.modal` 발송 폼 → `tx_inbox.js` 규약 | 발송 기록 `ez:ctx` |
| A4 1on1 잡기 | `EZOneOnOne` 안건 프리필(`tx_1on1.js`) | 안건 = `actions[].draft` |
| A5 상세 보기 | `EZNav`/`showScreen` 딥링크만 | 기록 남기지 않음 |
| A6 승인 요청 | `tx_inbox.js` 승인 카드 생성(`txf_ckreq_*` 규약 확장) | 요청·승인/반려 이력 |

공통: 처리 성공 → `EZSignalEngine.resolve(id,"acted")` → `TX.toast(done.title)` → `ez:ctx` 원장 1건(`source:"signal.<id>.<A타입>"`) → 카드에 `done.desc` 잔상.
**AI 자동 응답**: 카드 `.ezs-agent` 우측 `자세히` → `Elizax.sendRaw(EZSignalEngine.prompt(inst))`. 엔진(`:8080`) 살아 있으면 실 SSE, 죽으면 오프라인 예시.

---

## 6. 선제 슬롯 통일 (W5 소유)

| 파일 | 지금 | 바꿀 것 |
|---|---|---|
| `js/tx_agent.js:2748-2772` | `.agh-popup` 자체 DOM + 하드코딩 `alertsNow()` 5종 | `EZSignalCard.slot(EZSignalEngine.pending(role).slice(0,2))`. `.agh-popup` DOM·CSS 제거 |
| `js/tx_entry.js:337-390` | `.eze-pill` + `제안` 배지 | 화면 문맥 제안은 **신호가 없을 때만** 뜨는 폴백으로 격하. 배지 어휘 `제안` 삭제. `claim` 3번째 인자 오용 정리 |
| `js/tx_upgrade.js:193-215` | `.ezup-ctxchip` | 유지하되 **만료 시 `EZNotif`에 넣지 않는다**(배지 폭주 원인) |
| `js/tx_proactive.js:22-24,41-44` | `PRIO`/`LABEL` 4종, 만료분 전부 아카이브 | 신호 카드가 최우선(prio 4). `archive()`는 **신호 카드만** |
| `js/tx_chat_unread.js:191-215` | 25초 후 `✦ (선제 브리핑)` 채팅 메시지 | 어휘 삭제. 브리핑은 신호 카드로 대체 — 이 타이머 제거 |

**배지 폭주 근본원인**(실측 확인): `.ezx-cnt`가 `EZNotif.unreadCount()`인데, 만료된 문맥 칩·화면 제안이 계속 아카이브되어 화면만 몇 번 옮겨도 숫자가 7→8→9로 자동 증가한다. 실제 처리할 일과 무관 = 사용자가 "9+가 뭘 뜻하는지 모르겠음"이라고 한 그것. 배지 기준을 **미처리 신호 수**로 바꾸고 아카이브를 신호로 제한해 끊는다.

---

## 7. 중복 진입점 정리 (W6 소유)

감사로 확인된 사실: **대화 목록 계열 4개 표면이 모두 같은 저장소 `elizax_chat_v2:<emp>`(`js/tx_chatstore.js:20`)의 UI 껍데기**이고 자체 저장소가 없다 → 합쳐도 잃는 것이 없다. **성과 기록·감사 로그·산출물 보관함 9개 표면도 모두 `elizax_ctx_v1:<emp>`(`js/tx_ctx_ledger.js:76`) 하나**다.

| 표면 | 처분 |
|---|---|
| `ezcs-bar` ≡ 대화 목록 (`tx_chat_sessions.js:187`) | **삭제**. 세션 목록 렌더 함수(`rowHtml` `:153`)는 남겨 🔍 오버레이가 재사용 |
| 허브 `지난 대화` 내비 (`tx_chat_sessions.js:250`, cap 5) | **삭제**(같은 저장소 중복) |
| 🔍 지난 대화 검색 (`tx_chat_search.js`) | **단일 진입**으로 승격. 오버레이 = `＋ 새 대화` · 세션 목록(이름변경·삭제) · 검색 입력 · 결과 |
| 내보내기 (`tx_chat_export.js`) | **버튼 주입 중단**(모듈 파일은 남긴다) |
| 기록 탭 (`EZLedger`) | 탭 삭제. 진입 = 알림 탭 하단 `지난 알림` + ⋯메뉴 `성과 기록` + 카드 근거의 원장 링크 |

---

## 8. 파일 소유권 — 겹치면 충돌이다

| 담당 | 소유 파일 |
|---|---|
| W1 | `js/ez_signal_engine.js` (신설) |
| W2 | `js/ez_signal_card.js`, `css/ez_signal_card.css` (신설) |
| W3 | `js/tx_elizax.js`, `css/tx_elizax.css` |
| W4 | `js/tx_signal_actions.js` (신설) |
| W5 | `js/tx_agent.js`, `js/tx_entry.js`, `js/tx_upgrade.js`, `js/tx_proactive.js`, `js/tx_chat_unread.js`, `css/tx_agent.css` |
| W6 | `js/tx_chat_sessions.js`, `js/tx_chat_search.js`, `js/tx_chat_export.js` |
| 본세션 | `index.html`, `scripts/build_signals.py`, `js/ez_signals.js`, 이 문서, 최종 검증 |

## 9. 공통 규칙

- ES5 IIFE. `let/const/화살표/템플릿리터럴` 금지(기존 파일 관행). 자체 style 주입은 신규 모듈만.
- 롤 키: `(CU._role) || TXRoles.current().key || "member"`.
- 마운트는 폴링(`TXFIX.ready` 또는 자체 60ms late 폴링) — `tx_elizax` 초기화가 `DOMContentLoaded` 게이트라서.
- z-index는 `css/ez_kit.css:6-10` 토큰만(`--z-badge:900`·`--z-panel:4000`·`--z-overlay:4100`·`--z-modal:5000`·`--z-top:9000`). 새 z 값 만들지 않는다.
- 용어: 「알림」·「근거」·「기준값」·「처리」·「해제」. `트리거`·`룰`·`propose`·`side-effect` 금지(GLOSSARY.md).
- 검증: `node --check` → claude-in-chrome 라이브 4역할 × 알림 탭 → 콘솔 에러 0.


---

# 개정 — 18-2차: 카드 폐기, 전부 대화로 (2026-07-31, 사용자 재지시)

18차의 카드 UI는 폐기한다. 사용자 지시 verbatim:
> "방금 진행했던 것들이 카드 형태로 나오니까 이상함. 모든 내용은 채팅으로 구성되게 하고 내 목표 진행상황 점검처럼 처음에는 버튼으로 누를 수 있는 것으로 변경. … 대화가 먼저이고 알림이 그 다음임. elizax 처음 화면은 빈 채팅창이어야 함. 추천 대화 버튼은 기존처럼 있고. 그리고 내가 고치기, keyResults.competency_id …, 연결 불일치, 목표수립 이런 표현 필요 없음 삭제. 그냥 사용자가 interaction하다가 필요한 화면으로 넘어가면 됨. 그리고 화면 넘어가는건 사용자가 자세히 수정하거나 이런 것을 요청할 때 넘어가도록 하고 기본은 채팅창 내에서 해결이 가능하도록 수정. 비교, 사실 등 근거는 사용자가 대화 하다가 자연스레 채팅 내용에 나오게끔 해야 함."

## R1. 무엇이 바뀌는가

| 18차 | 18-2차 |
|---|---|
| 알림 탭이 기본 진입, 카드 스택 | **대화 탭이 기본 진입, 빈 채팅창** |
| 웰컴에 신호 카드 3장 | **웰컴 = 빈 채팅 + 추천 대화 버튼**(`내 목표 진행상황 점검` 형식) |
| 카드 안에 근거 2줄 + 접힘 + 기준값 + 처리 버튼 | **AI 답변 본문에 자연스럽게 녹아든 문장.** 근거는 대화하다 나온다 |
| 처리 버튼 = 화면 이동 | **기본은 채팅 안에서 해결.** 화면 이동은 사용자가 「자세히」·「고치겠다」고 할 때만 |
| 유형·단계·처리 라벨 노출(`연결 불일치`·`목표수립`·`내가 고치기`) | **전부 삭제.** 분류 체계는 내부에만 둔다 |
| 근거에 필드명 노출(`keyResults.competency_id`·`objectives.owner_emp_id`) | **전부 삭제.** 출처는 사람 말로만, 그것도 물었을 때만 |
| 우하단 슬롯에 카드 | **한 줄 권유**만. 누르면 그 주제로 대화가 열린다 |

카탈로그는 그대로 쓴다. 바뀌는 건 **표현 형태**뿐이다 — 신호 150건·근거·기준값·처리 6종은 여전히 답변의 재료다.

## R2. 금지 표현 (화면에 절대 나오지 않는다)

- 유형 라벨 `기한 도래`·`작성 공백`·`기준 이탈`·`연결 불일치`·`상황 변동`, 코드 `T1`~`T5`
- 단계 라벨을 칩으로 노출하는 것 (`목표수립`·`중간점검`·`평가`·`피드백`). 문장 안에서 자연스럽게 쓰는 건 허용 — "이번 분기 목표를 세울 때" 처럼
- 처리 라벨 `새로 쓰기`·`내가 고치기`·`알려주기`·`1on1 잡기`·`상세 보기`·`승인 요청`, 코드 `A1`~`A6`
- 근거 축 라벨 `사실`·`비교`·`추이`·`연결`·`이력`·`범위`
- 데이터 필드·식별자 `keyResults.competency_id`·`objectives.owner_emp_id`·`KR-EMP0078-1`·`OBJ-0018`·`JOB-소프트-080`·`EMP-0078`·`ORG-026`·`TH-…`. 사람이 읽는 이름으로 바꾼다 — `KR-EMP0078-1` → 그 핵심결과의 제목, `JOB-소프트-080` → `서비스기획담당`, `ORG-026` → `Consulting BU`
- `(예시)`·`(추정)` 배지도 칩으로 달지 않는다. 필요하면 문장으로 — "아직 회사 기준이 정해지지 않아 잠정값으로 봤어요"
- `데이터 준비 필요` 배지 → 문장으로 대체하거나 그 신호를 추천에서 빼면 된다

## R3. 추천 대화 버튼

빈 채팅창 아래 버튼. 두 묶음을 한 줄 간격으로 둔다.

1. **지금 볼 만한 것** — `EZSignalChat.starters(role)`가 미처리 신호를 **사용자 말투 질문**으로 바꾼 것 최대 3개.
   신호를 그대로 읽어 주는 게 아니라 사용자가 물을 법한 말로 바꾼다.
   - `목표수립-구성원-04` → `내 핵심결과가 직무랑 잘 맞는지 봐줘`
   - `중간점검-상위조직장-06` → `팀 체크인 중에 확신 없다고 적힌 게 많은지 봐줘`
   - `중간점검-HR경영진-09` → `조직 사이 진행률 차이가 큰 곳 알려줘`
2. **기존 3개 유지** — `내 목표 진행상황 점검` · `이번 달 근무기록 확인` · `급여명세서 열어줘`

두 묶음의 버튼 모양은 같다(기존 `.ezx-starter`). 1번 묶음에만 작은 머리말 한 줄을 둘 수 있다(라벨은 분류명이 아니라 `지금 볼 만한 것` 같은 사람 말).

## R4. 답변 구성 — `window.EZSignalChat` (신설)

```js
EZSignalChat.starters(role)      // → [{q:"내 핵심결과가 직무랑 잘 맞는지 봐줘", id:"목표수립-구성원-04"}] 최대 3
EZSignalChat.ask(id)             // → Elizax.send(q). 그 전에 topic을 걸어 둔다
EZSignalChat.contextFor(userText) // → string|"" · tx_elizax의 payload 조립기가 부른다(보이지 않는 근거 주입)
EZSignalChat.answerText(inst)    // → 오프라인/폴백용 자연문 답변
EZSignalChat.chips(inst)         // → 사용자 말투 후속 칩 ["가중치 맞춰줘","이대로 저장해줘","화면에서 고칠게"]
EZSignalChat.topic()             // → 현재 걸린 신호 인스턴스|null
```

**AI 경로가 정답이다.** 버튼 누름 → `Elizax.send(자연어 질문)` → 실 AI 응답. 신호의 실측 근거는
`contextFor()`가 payload에 **보이지 않게** 실어 준다. 프롬프트에 다음을 명시한다.

- 대화체 해요체 3~6문장. 표·머리기호·굵은 글씨 나열을 쓰지 않는다
- 숫자는 문장 안에 녹인다. 근거 줄을 나열하지 않는다
- **R2 금지 표현을 쓰지 않는다.** 분류 이름·코드·필드명·식별자 금지
- 끝은 사용자가 이어받을 수 있게 맺는다 — "가중치를 맞춰 볼까요?"
- 사용자가 출처를 물으면 그때만 사람 말로 밝힌다 — "체크인 기록과 직무 프로파일을 봤어요"
- 확인되지 않은 값은 확정해 말하지 않는다

오프라인이면 `answerText(inst)`가 같은 규칙으로 조립한 문장을 쓴다.

## R5. 처리 — 기본은 채팅 안에서

- 후속 칩(`chips()`)은 **사용자 말투**다. `내가 고치기 핵심결과 수정 초안` 같은 라벨을 버튼에 쓰지 않는다
- 칩을 누르면 우선 **채팅 안에서** 초안·계산·비교를 보여 준다. 저장·제출처럼 실제로 기록이 남는 것만 확인을 받는다
- **화면 이동은 사용자가 요청할 때만.** `화면에서 고칠게`·`자세히 볼게`·`거기서 직접 수정할게` 같은 말이 있을 때만 `EZSignalAct`를 태운다
- 화면으로 넘어갈 때는 왜 넘어가는지 한 줄로 알린다

## R6. 알림 탭

- 탭 순서 **대화 → 알림**. 기본 진입 = 대화
- 알림 탭은 카드가 아니라 **한 줄 목록**. 한 줄 = 알림 문구 한 문장(유형·단계 칩 없음)
- 줄을 누르면 카드가 펼쳐지는 게 아니라 **대화가 열리고 그 주제로 답이 온다**(`EZSignalChat.ask(id)`)
- 「지난 알림」은 그대로 접힌 채 유지

## R7. 우하단 선제 슬롯

- 카드 폐기. **한 줄 권유** — `살펴볼 게 하나 있어요` + 알림 문구 한 문장 + `열어보기`·`나중에`
- `열어보기` → `EZSignalChat.ask(id)`
- 2건 이상이면 한 줄에 `이 밖에 1건 더` 정도로만 알린다. 페이저를 만들지 않는다
- `EZProactive` 단일 슬롯 규약(`claim`/`release`)과 배지 규칙은 18차 그대로

## R8. 파일 소유권 (18-2차)

| 담당 | 소유 파일 |
|---|---|
| B1 | `js/ez_signal_chat.js` (신설), `js/ez_signal_engine.js`(프롬프트·표현 정리만) |
| B2 | `js/tx_elizax.js`, `css/tx_elizax.css` |
| B3 | `js/ez_signal_card.js`, `css/ez_signal_card.css`(한 줄 권유·한 줄 목록만 남기고 축소), `js/tx_agent.js`, `js/tx_signal_actions.js` |
| 본세션 | `index.html`, 이 문서, 최종 검증 |

§9 공통 규칙(ES5·토큰·z·용어·검증)은 그대로 적용한다.
