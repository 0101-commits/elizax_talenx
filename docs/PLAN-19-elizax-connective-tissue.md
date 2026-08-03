# 19차 — 연결성 복구 · 사람 말 · 인라인 (공유 계약서)

작성 2026-07-31. 병렬 빌더 공용 계약서. **각 담당은 자기 소유 파일만 고친다.**
선행 = `PLAN-18-signal-alert-card.md`(18차·18-2차·18-3차). 원천 = `성과평가 AI Agent_AX Consulting_W5_signal catalogue_260730.xlsx` → `js/ez_signals.js`(150건).

---

## 0. 사용자 요청 12건 → 담당

| # | 요청 | 진단 | 담당 |
|---|---|---|---|
| 1 | 대화 **복사·재생성 삭제** | `js/tx_chat_actions.js` 전용 파일 | A |
| 2 | 알림 **출처 = 화면 이름**, 그 화면으로 바로 연결. `goal.ai.draft` 같은 개발자 말 전부 삭제 | 출처 원문을 그대로 그림(`tx_ctx_ledger.js:902`·`tx_inbox.js:269`·`tx_fix_perf.js:1131`) | B(사전) · E · H |
| 3 | 「지난 알림」·「성과 기록」 **뭐가 다른가 · 중복** | 저장소는 둘(EZNotif·EZLedger)인데 **같은 탭에 붙여** 놨고, EZNotif에 테스트·빈 스냅샷이 쌓여 50건 상한을 채움 | A |
| 4 | 안내 팝업 ↔ 실제 대화 **연결 안 됨** | 빈 화면 아래 3버튼이 역할·데이터와 무관한 고정 문자열 | A · C |
| 5 | 「확인 내역 작업 중」이 **정지 화면 같다** | 스텝 아이콘만 갈아끼우고 헤더만 깜빡임 | A |
| 6 | 실제 입력란에서 **인라인 편집** | `EZApply.popover`는 필드 **옆** 뜨는 별도 상자. 목표 상세는 편집 필드가 아예 없음 | F |
| 7 | 「인용 이력 · 답변 인용 0회」 → **앞뒤 데이터 노드** | `usedCount` 카운터만 있고 기록 사이 연결이 없음 | E |
| 8 | 「조직장에게 올릴까요」가 **대화 원문 그대로** · 수신자도 틀림 | 발송 문안에 `{{팀원명}}` 미치환, 수신자 고정 | D |
| 9 | talenx=명숙 / elizax=이지민 **대상 불일치**, elizax에서 사람 고르면 안 됨 | `defaultSubject`가 조직장의 첫 직속을 자동 선택해 헤더 검색창에 노출 | A |
| 10 | 「그 자리로 옮겨 드릴게요」 **자동 이동 금지**, 물어봐야 함 | `openScreen`이 확인 없이 이동 | A · D |
| 11 | `✦ elizax 녹음·요약` 배너 **작고 화면과 구분 안 됨** | `.ez1o-bar` 등 elizax 표면에 공통 표시가 없음 | G |
| 12 | 질문하면 **답이 먼저** 나와야 하는데 화면으로 튐. 어떤 질문이 신호를 부르는지 모름 | **근본원인: `tx_nav.js:56` `GO_STRONG`의 `가자`가 "평**가자**"에 오탐** + 자유 질문 경로가 `EZSignalCatalog`를 전혀 참조하지 않음 | B · C · A |

---

## 1. 절대 규칙 (18-2차 R2 유지 + 추가)

- 화면·AI 출력에 **코드·식별자·표 이름·점 찍힌 경로·분류 라벨 금지**. `EZSignalChat.scrub()` 통과가 기본.
- **모르면 감춘다.** 사람 이름으로 못 바꾸는 출처는 그 줄 자체를 그리지 않는다. 원문 코드를 대신 쓰지 않는다.
- **자동 화면 이동 금지.** 이동은 ①사용자가 이동을 말했을 때 ②사용자가 이동 버튼을 눌렀을 때만.
- **거짓 작동 금지.** 실계산 못 한 값은 예시라고 밝히고, 왜 못 셌는지 한 줄로 말한다.
- ES5 IIFE. `let/const/화살표/템플릿리터럴` 금지. hex 직접 쓰기 금지(토큰만). z-index는 `css/ez_kit.css` 토큰만.
- 용어: 「알림」·「근거」·「기준값」·「처리」·「해제」·「성과 기록」. (`GLOSSARY.md`)
- 검증: `node --check <파일>` 통과 + 콘솔 에러 0.

---

## 2. 파일 소유권 — 겹치면 충돌이다

| 담당 | 소유 파일 | 맡은 요청 |
|---|---|---|
| **A** | `js/tx_elizax.js`, `css/tx_elizax.css`, `js/tx_chat_actions.js`, `js/tx_proactive.js` | 1·3·4·5·9·10(UI)·12(호출 순서) |
| **B** | `js/tx_nav.js`, `js/ez_source_map.js`(신설) | 2(사전)·12(오탐) |
| **C** | `js/ez_signal_chat.js` | 12(질문 사전)·4(스타터) |
| **D** | `js/tx_signal_actions.js` | 8·10(문장) |
| **E** | `js/tx_ctx_ledger.js` | 7·2·3(성과 기록 정체성) |
| **F** | `js/ez_inline.js`(신설), `js/tx_upgrade.js` | 6 |
| **G** | `js/tx_1on1.js`, `css/tx_agent.css`, `css/ez_kit.css`, `js/tx_meeting.js` | 11 |
| **H** | `js/tx_inbox.js`, `js/tx_fix_perf.js` | 2(잔여 노출) |
| 본세션 | `index.html`, 이 문서, 최종 검증 | 스크립트 등록·캐시버스팅 |

`js/ez_signal_engine.js`·`js/ez_signals.js`는 **아무도 고치지 않는다**(자동 생성물·평가기).

---

## 3. B — 화면 사전 & 이동 판정

### 3-1. `js/ez_source_map.js` 신설 → `window.EZSource`

```js
EZSource.label(source)   // → "목표 상세" | ""        모르면 반드시 "" (코드 금지)
EZSource.of(source)      // → {label, s, p, ov, oid} | null
EZSource.go(source)      // → true/false  화면 전환(+오버레이 열기)
EZSource.chip(source)    // → HTMLButtonElement | null   (label 없으면 null)
EZSource.screenLabel(s,p)// → EZNav.labelOf 위임
```

`source` 실제 값 예: `perf.checkin.CHK-EMP0078-2` · `goal.ai.draft` · `eval.lint` ·
`signal.목표수립-구성원-04.a3.to.EMP-0030` · `objectives` · `tsk.wb-0714` · `memo.0630` · `rule.평가규정 §4.2`

**앞머리 → 화면** (앞머리는 `.`·`-`·`_` 앞 첫 조각을 소문자화해 본다. 여러 규칙이 맞으면 더 긴 접두가 이긴다.)

| 앞머리 패턴 | 화면 이름(사람 말) | s / p | 오버레이 |
|---|---|---|---|
| `goal.new` `goal.create` `goal.ai.draft` `obj.new` | **목표 생성** | perf/0 | `data-txf-ov="new"` |
| `goal.detail` `objective.detail` `obj.` `objectives` `kr.` `keyresults` | **목표 상세** | perf/0 | `openGoalDetail(oid)` |
| `goal.` `perf.goal` | **목표 현황** | perf/0 | — |
| `perf.checkin` `checkin` `checkins` `chk.` | **목표 상세 · 체크인** | perf/0 | `openGoalDetail(oid)` |
| `fb.` `feedback` `feedbackhistory` | **피드백** | perf/1 | — |
| `1on1` `oneonone` `memo.` `meeting` | **1:1 미팅** | perf/2 | — |
| `review.` `perf.review` | **리뷰** | perf/3 | — |
| `eval.` `evaluation` `evaluations` `appr.` `assess` | **평가 작성** | appr/0 | — |
| `talent` `calib` | **인재 리뷰** | appr/1 | — |
| `msf.` `peer` `upward` `360` | **360 진단** | msf/null | — |
| `tsk.` `task` `wb-` `work` `scrum` | **업무보드** | work/0 | — |
| `att.` `attendance` `leave` `vacation` | **근무관리** | att/0 | — |
| `pay.` `payroll` `salary` | **급여관리** | pay/0 | — |
| `wf.` `approval` `ckreq` `sign` | **신청/승인** | wf/0 | — |
| `hrm.` `employee` `employees` `job` `jobprofile` `skill` | **인사관리** | hrm/1 | — |
| `rule.` `policy.` `regulation` | **평가 규정** | — | 화면 없음 → label만, `go`는 false |
| `signal.<신호ID>....` | 신호 ID의 **단계**로 판정 — `목표수립`→목표 현황 · `중간점검`→목표 상세 · `평가`→평가 작성 · `피드백`→피드백 | | |

`oid`는 source에 `OBJ-xxxx`가 들어 있으면 그것, 없으면 `KR-...`의 소유 목표를 `TALENX_DATA.keyResults`에서 역참조.
**어느 규칙에도 안 맞으면 `label()`은 `""`**. 호출자는 빈 문자열이면 「출처」 줄을 그리지 않는다.

`EZSource.go()`는 `EZNav.go(s,p)` 뒤 220ms에 오버레이를 연다(`window.TXFIX && TXFIX.openGoalDetail` 또는 `[data-txf-ov="new"]` 트리거 버튼 클릭). 오버레이 진입점이 없으면 화면만 연다.

### 3-2. `js/tx_nav.js` — 오탐 제거 + 질문 우선

1. **`GO_STRONG`에서 `가자` 삭제**하고 낱말 경계를 준다:
   `/(넘어가|이동|전환|들어가|접속|탭\s*으로|화면\s*으로|메뉴\s*로|페이지\s*로|(?:^|[\s,.])가\s*줘|(?:^|[\s,.])가줘|(?:^|[\s,.])가자(?:$|[\s,.!?])|으로\s*가(?:$|[\s,.!?])|로\s*가(?:$|[\s,.!?]))/`
   → `"1차 평가자 검토가 제대로 되고 있는지 확인해줘"` 는 **이동 아님**.
2. **질문 가드 신설** — `resolve()` 첫머리에서 아래에 맞으면 무조건 `null`:
   `ASK_GUARD = /(는지|은지|나요|까요|인가|일까|어때|얼마나|몇\s|왜\b|어떤|어디가|무슨|알려\s*줘|알려줘|봐\s*줘|봐줘|확인해\s*줘|확인해줘|점검해|보여\s*주세요|어떻게\s*되)/`
   단 「화면」·「탭」·「메뉴」·「페이지」와 강한 이동 동사가 **함께** 있으면 가드를 넘긴다("목표 화면으로 넘어가 줄래?").
3. `resolve()`가 `{s,p,label,strength:"explicit"}` 를 돌려준다. 새 함수 **`EZNav.askIntent(text)`** → `true`면 "이건 질문이다"(호출자가 답변 경로를 먼저 태운다).
4. `EZNav.confirmLabel(s,p)` → `"성과관리 › 목표 현황 열기"` (버튼 문구 단일 원천).
5. `ROUTES`에 `검토`·`평가자` 단독은 **넣지 않는다**(신호 질문으로 가야 한다).

`EZSource`는 `EZNav`에 의존한다. 두 파일 모두 B 소유.

---

## 4. C — 질문 사전 (`js/ez_signal_chat.js`)

### 4-1. 150건 전체 질문 사전
지금 `STARTER`/`KEYS`는 라이브 15건만 있다. **150건 전부**에 다음을 만든다.

```js
EZSignalChat.questionFor(id)        // → 사용자 말투 질문 1개 (필수, 150건 전부)
EZSignalChat.aliases(id)            // → 그 신호를 부르는 낱말 묶음
EZSignalChat.matchAny(text, role)   // → {inst|sig, id, score, live:bool} | null   ★신설
EZSignalChat.catalogQuestions(role) // → [{id,q,live}] 역할별 전체 목록(질문 브라우저용)
```

- 질문 문구는 `notice`에서 기계 변환하지 말고 **의미로 다시 쓴다**. 규칙: 20~34자, 반말 요청체(`~봐줘`·`~알려줘`), 분류·코드 금지.
  - `목표수립-상위조직장-02`(notice: "조직 평균 3일인데 1차 평가자 검토가 14일 넘게 멈춘 목표가 7건이에요")
    → **`1차 평가자 검토가 제대로 되고 있는지 확인해줘`** (사용자가 실제로 친 문장 그대로를 정답 질문으로 등재한다)
- `aliases`는 `notice`+`principle`+`refs`에서 2글자 이상 명사를 뽑고, **역할·단계 낱말**(`1차 평가자`·`검토`·`멈춘`·`지연`)을 손으로 보탠다.
- `matchAny` 점수: 3글자 이상 낱말 2점 / 2글자 1점, **질문 문구 부분일치 = 99**. 3점부터 채택. 동점이면 ①질문 일치 길이 ②**역할 일치** ③`now:1` ④`score.help` 순.
  (역할이 안 맞는 답은 실수치가 붙어도 틀린 답이다. 역할이 맞는데 예시값인 것은 §4-2 형식이 예시라고 밝히므로 손해가 없다.)
- **역할 밖 신호도 답한다** — 단, `roles`에 없는 신호면 답 앞에 한 줄: `"이건 조직장이 받는 알림인데, 궁금하실 테니 지금 보이는 만큼만 말씀드릴게요."`

### 4-2. `now:0` 신호 답변 형식 (135건)
`answerText(inst)`가 다음 3문단을 만든다. **예시임을 반드시 밝힌다.**

1. 무엇을 보는 알림인지 (`principle`을 사람 말로)
2. **`"지금 회사 데이터에는 <빠진 것>이 남지 않아 실제로 세지는 못했어요."`** — `빠진 것` = `todoCreate`/`refs`에서 뽑아 사람 말로
3. **`"기록이 갖춰지면 이렇게 알려드려요 — <notice>"`** + 처리 한 줄(`actions[0].draft` 첫 문장)

`live:false`일 때 `contextFor()`가 프롬프트에 넣는 지시도 같게 바꾼다(단정 금지·예시 명시).

### 4-3. 스타터 (요청 4)
```js
EZSignalChat.starters(role)   // 기존: 미처리 3건 → 유지
EZSignalChat.suggested(role)  // ★신설: 역할별 대표 질문 6개(라이브 우선, 부족분은 카탈로그에서 help 점수 순)
```
`suggested()`는 **각 질문이 실제로 답을 만드는지 자체 검사**해 통과한 것만 돌려준다(`matchAny(q).id === id`).

---

## 5. A — 패널 (`js/tx_elizax.js` · `css/tx_elizax.css` · `tx_chat_actions.js` · `tx_proactive.js`)

### 5-1. 요청 1 — 복사·재생성 삭제
`js/tx_chat_actions.js`에서 **`copy`·`regen` 버튼과 그 처리기를 제거**한다. `edit`(✎ 수정, 마지막 사용자 말 → 입력창)만 남긴다. 남은 버튼이 없으면 바 자체를 만들지 않는다. `copyText`/`Elizax.regenerate` 호출부 제거.

### 5-2. 요청 9 — 대상은 talenx가 정한다
- `js/tx_elizax.js:278-297` **대상 직원 검색 입력·드롭다운 전부 삭제**(`el.pickerInput`·`el.pickerList`·`renderPickerList`).
- `defaultSubject()`(:86-92)는 **항상 `CURRENT`(talenx 현재 사용자)** 를 돌려준다. 자동 직속 선택 폐지.
- 조직장·HR 관점에서 특정 팀원 이야기가 필요하면 **대화 안에서 이름을 말해** 정한다: `setSubjectByName(text)` — 사용자 문장에서 사원 이름이 나오면 그때만 `state.subject` 교체하고 한 줄로 알린다(`"홍예준님 기준으로 볼게요."`). 이름이 없으면 팀 전체 집계로 답한다.
- 관점 차단(`:1362-1367`)이 "대상을 고르라"고 막던 것 제거 — 막지 않는다.

### 5-3. 요청 3 — 알림/기록 분리 + 쓰레기 청소
- **EZNotif 1회 마이그레이션**(`ezk_notif_v1` 읽을 때): ①`title`이 `알림`이고 `body`도 비었거나 `알림`인 항목 ②`/^테스트 알림/` ③`폴백 확인` → 전부 버린다. 마이그레이션 플래그 `ezk_notif_mig_v19`.
- `js/tx_proactive.js` `archive()`: 스냅샷 본문이 라벨과 같거나 8자 미만이면 **적재하지 않는다**.
- `renderNtf()`에서 **「성과 기록」 블록과 `el.recPane` 삽입을 제거**한다(`:634-636`, `:639`). 대신:
  - 「지난 알림」 헤더 밑 캡션 한 줄: `"elizax가 건넨 알림을 모아 둔 곳이에요."`
  - 목록 끝에 링크 한 줄: `"답변의 근거가 된 내 기록은 성과 기록에서 볼 수 있어요"` → `EZLedger.openPanel()`
  - `setTab("rec", id)` 계약은 **`EZLedger.openPanel(id)` 로 리다이렉트**(알림 탭으로 보내지 않는다).
- 「지난 알림」이 30건을 넘으면 최근 20건만 그리고 `"더 보기"` 한 줄.

### 5-4. 요청 5 — 작업 중 = 살아 있는 피드
`workHTML`/`animateWork`/`addWorkStep`/`finishWorkStep` 재작성.

- 헤더: `✦ elizax가 확인하는 중` + **경과 시간(0.1초 단위, 실시간)** + 불확정 진행 막대(`.ezx-work-bar::after` shimmer 1.1s linear infinite).
- 본문 = **피드**. 스텝이 하나씩 아래로 **나타난다**(`@keyframes ezxStepIn` opacity 0→1 · translateY 6px→0, 220ms).
  - 진행 중 스텝: 이름 뒤에 **타이핑 점 3개**(`.ezx-dots span` 각 0/0.15/0.3s 지연 blink).
  - 끝난 스텝: `✓` + **찾은 것 한 줄**(사람 말·실제 건수). 예 `"체크인 12건을 봤어요"`.
  - 대본 스텝 간격은 고정 800ms가 아니라 **380~900ms 난수**(멈춘 화면처럼 보이지 않게).
- 완료: 헤더가 `확인 끝 · 2.4초 · 근거 4건`으로 바뀌고 본문이 접힌다. 헤더 클릭 시 다시 펼침.
- 실 도구 호출(live)이 있으면 그 이름을 사람 말로 바꿔 쓴다. 없으면 대본을 쓰되 **각 줄이 실제 데이터 건수를 말한다**(`TALENX_DATA` 집계).
- `prefers-reduced-motion: reduce`면 애니메이션 없이 텍스트만 갱신.

### 5-5. 요청 10·12 — 이동은 물어보고, 답이 먼저
`sendMessage(userText)` 순서를 바꾼다:

```
1) EZNav.askIntent(text) 이거나 EZSignalChat.matchAny(text) 가 있으면 → 내비 판정 건너뛰고 답변 경로
2) 그 밖에 EZNav.resolve(text)가 explicit 이면 → 즉시 이동 ("…으로 넘어갈게요")
3) 나머지 → 답변 경로
```
- **답변 뒤에 이동이 필요하면 자동으로 가지 않는다.** 답변 아래 버튼 두 개를 붙인다:
  `[성과관리 › 목표 현황 열기]` `[여기서 계속]` — `role:"navask"` 메시지 타입 신설.
  문장은 `"…는 성과관리 › 목표 현황에서 고칠 수 있어요. 열어 드릴까요?"`
  공개 API `Elizax.askNav(s, p, reason)` 를 신설해 D가 부른다.
- `offlineNav()`(:1641-1650) 폐지 — 오프라인 답변 경로에서 이동 판정하지 않는다.
- `role:"nav"` 버블은 이동 직전 **1.2초 취소 가능**(`[취소]` 버튼).

### 5-6. 요청 4 — 빈 화면 ↔ 대화 연결
- 부제: `"목표·평가·근무·급여를 실제 기록으로 확인하고, 필요하면 그 화면까지 열어 드려요."`
- 버튼 = `EZSignalChat.suggested(roleKey())` 6개(2열). 고정 3버튼은 **역할별**로:
  - member `내 목표 진행상황 점검` / `이번 달 근무기록 확인` / `급여명세서 열어줘`
  - leader `우리 팀 진척 정리해줘` / `이번 주 1:1 안건 잡아줘` / `팀 평가 준비 상태 봐줘`
  - hr `조직별 목표 진행률 비교해줘` / `평가 진행이 밀린 곳 알려줘` / `이번 분기 인원 현황 보여줘`
  - exec `전사 목표 진행 상황 요약해줘` / `조직 간 격차 큰 곳 알려줘` / `평가 일정 위험한 곳 알려줘`
- 아래 한 줄 링크 `"이런 것도 물어볼 수 있어요"` → **질문 브라우저 오버레이**: `EZSignalChat.catalogQuestions(role)` 를 단계별로 묶어 보여 주고, 누르면 그대로 전송. 각 줄 오른쪽에 `지금 확인 가능`/`기록 준비 중` 한 낱말.

---

## 6. D — 발송·수신자 (`js/tx_signal_actions.js`)

### 6-1. 요청 8 — 누구에게 가는가
`recipientFor(inst, act)` 신설. **신호의 수신 주체(actor)와 처리의 상대는 다르다.**

| 신호 actor | A3 알려주기 받는 사람 | A4 면담 상대 | A6 승인 요청 |
|---|---|---|---|
| 구성원 | 내 조직장(`manager_id`) | 내 조직장 | 내 조직장 |
| 조직장(1차 평가자) | **해당 팀원** | **해당 팀원** | 내 상위 조직장 |
| 상위 조직장 | **해당 하위 조직장** | **해당 하위 조직장** | HR |
| HR·경영진 | **해당 조직의 조직장** | 해당 조직의 조직장 | 경영진 |

대상 특정 순서: ①`inst.facts.subjectIds[0]` ②`inst.facts.orgId`의 리더 ③위 표의 관계. 셋 다 없으면 **발송 버튼을 만들지 않는다**.

### 6-2. 발송 문안
- **대화 원문을 절대 발송 문안으로 쓰지 않는다.** 문안은 `actions[].draft`를 실데이터로 채운 것.
- `fillTemplate(draft, ctx)` — `{{팀원명}}`·`{{목표명}}`·`{{조직명}}`·`{{기한}}`·`{{건수}}` 등 전부 치환. **치환 못 한 `{{…}}`가 하나라도 남으면 발송을 막고** `"보낼 문장에 아직 채워지지 않은 자리가 있어요"` 로 알린다.
- 확인 모달 3줄 고정:
  `받는 사람  홍예준 (우리 팀 · 프로젝트관리담당)` / `왜 이 사람인가  이 목표의 담당자예요` / `보낼 문장  …`
  버튼 `[보내기]` `[1:1로 이야기하기]` `[안 보낼래요]`.
- 고정 문구 `"조직장에게 올릴까요"` 폐지 — 항상 **실명·관계**로 쓴다.

### 6-3. 요청 10 — 문장
- `openScreen()`의 비확인 분기는 **이동하지 않는다**. 문구를 의문형(`"<라벨>에서 바로 고칠 수 있어요. 열어 드릴까요?"`)으로 바꾸고 `window.Elizax.askNav(s, p, reason)` 에 넘긴다.
- `wantsScreen(text)`는 `EZNav.resolve` 대신 **자체 명시 목록**만 본다: `화면에서|직접 고칠|거기서|그 화면|열어 줘|열어줘|이동해|넘어가`.

---

## 7. E — 성과 기록 (`js/tx_ctx_ledger.js`)

### 7-1. 요청 7 — 「인용 이력 · 답변 인용 N회」 → 「이 기록의 앞뒤」
`detailHtml()`(:884-937) 안 `:932` 블록을 교체한다. 노드 지도(순수 DOM/CSS, 라이브러리 금지):

```
[앞선 기록 ≤2]  →  ● 이 기록  →  [뒤따른 기록 ≤2]
                      ↘ 이 기록을 근거로 쓴 답변 N건
```
- **연결 판정**: `it.source`에서 앵커(`OBJ-…`/`KR-…`/`emp_id`)를 뽑아 같은 앵커의 기록을 `ts` 순 정렬 → 직전 2건·직후 2건. 앵커가 없으면 같은 `type` + 같은 날의 기록으로 대체.
- 노드는 **제목 한 줄 + 날짜**만. 코드·표 이름 금지.
- 앞/뒤 노드 클릭 → 그 기록 상세로 이동. 답변 노드 클릭 → `Elizax.showTab("chat")` + 그 대화로.
- 연결이 하나도 없으면 `"아직 앞뒤로 이어진 기록이 없어요."` 한 줄. **0회 같은 숫자를 보여 주지 않는다.**
- 목록 행의 `.ezl-used` 배지도 **N>0일 때만** `"답변 N건의 근거"`, 0이면 배지를 그리지 않는다.

### 7-2. 요청 2 — 출처
- `:902-903` 「출처」 값 = `EZSource.label(it.source)`. **빈 문자열이면 「출처」 줄 자체를 그리지 않는다.**
- 값이 있으면 클릭 가능한 칩(`EZSource.chip`)으로 만들어 그 화면을 연다.
- 기존 `humanSrc()`/`SRC_WORDS`는 `EZSource`가 없을 때의 폴백으로만 남긴다.

### 7-3. 요청 3 — 정체성
패널 머리말 한 줄 신설: `"답변의 근거가 된 내 기록이에요. elizax가 건넨 알림은 알림 탭에 있어요."`

---

## 8. F — 인라인 편집 (`js/ez_inline.js` 신설 · `js/tx_upgrade.js`)

### 8-1. `window.EZInline`
```js
EZInline.suggest(field, text, opts)  // opts:{label, why, onApply, chips:[]}
EZInline.cancel(field)
EZInline.editable(host, spec)        // 읽기 전용 화면에 그 자리 편집을 붙인다
EZInline.landFromChat(payload)       // {screen, field, text, why} — 대화에서 화면으로 착지
```

**`suggest` 동작 — 필드 「옆」이 아니라 필드 「위」다.**
- `field.getBoundingClientRect()`와 `getComputedStyle`을 복사해 `position:fixed` 오버레이를 **필드와 정확히 겹치게** 올린다(같은 `font`·`padding`·`line-height`·`border-radius`, `box-shadow`로 링).
- 오버레이 안: 기존 값은 흐리게 위에, 제안 문안은 아래 진하게. 한 줄 필드면 제안만 보여 준다.
- 필드 **바로 아래 폭에 맞춰** 인라인 바: `[이대로 적용]` `[다르게 써줘]` `[그만]` + 왼쪽에 `✦` + `why` 한 줄(≤28자).
- 적용 → `field.value = text`; `input`·`change` 이벤트 dispatch; 포커스+커서 끝; 필드 링이 1회 깜빡.
- 취소: `Esc`, 바깥 클릭. `scroll`/`resize`에 위치 재계산, 닫힐 때 리스너 해제.
- 접근성: `role="dialog"` `aria-label="elizax 제안"`.

**`editable(host, spec)`** — 목표 상세(`[data-txf-ov="goal"]`)처럼 편집 필드가 없는 화면에 붙인다.
- `spec = [{sel:".txf-god-title", kind:"text", key:"title"}, …]`
- 대상에 마우스를 올리면 오른쪽 끝에 `✎` → 누르면 **그 자리에서 `<input>`으로 바뀐다**(원래 글꼴·폭 유지). `Enter` 저장 / `Esc` 취소 / 저장 시 `ez:ctx` 기록 1건.
- `tx_fix_perf.js`는 고치지 않는다 — `MutationObserver`로 오버레이가 열릴 때 주입한다.

### 8-2. `js/tx_upgrade.js`
- `EZApply.popover`는 **`EZInline.suggest`로 위임**한다(옆 상자 폐지). 기존 호출 계약(`{field, anchor, run, ...}`)은 유지.
- `attachLint`의 `✦ elizax로 정제` 버튼은 그대로 두되, 누르면 `EZInline.suggest`가 뜬다.
- 린트 칩 문구에서 개발자 말 제거(`평가 문장 품질 린트` 계열) — `"문장 다듬기"`·`"근거가 빠졌어요"` 같은 사람 말로.

---

## 9. G — elizax 표면 구분 (`css/ez_kit.css` · `js/tx_1on1.js` · `css/tx_agent.css` · `js/tx_meeting.js`)

### 9-1. 공통 클래스 `.ezsurf` 신설 (`css/ez_kit.css`)
화면 안에 박히는 **모든 elizax 조각**이 이걸 두른다.

```
.ezsurf{
  position:relative; border-radius:12px;
  padding:14px 16px 14px 20px;
  background:color-mix(in srgb, var(--color-accent) 6%, var(--color-background));
  border:1px solid color-mix(in srgb, var(--color-accent) 22%, transparent);
}
.ezsurf::before{ content:""; position:absolute; left:0; top:0; bottom:0; width:4px;
  border-radius:12px 0 0 12px; background:var(--color-accent); }
.ezsurf-hd{ display:flex; align-items:center; gap:8px; font-size:13.5px; font-weight:600;
  color:var(--color-text-accent); margin:0 0 8px; }
.ezsurf-hd::before{ content:"✦"; }
.ezsurf-note{ font-size:12.5px; line-height:1.6; color:var(--color-text-secondary); }
```
- 최소 글자 크기 **12.5px**, 제목 **13.5px**. 11px 이하 금지.
- `light-dark()` 토큰만 쓴다. hex 금지.

### 9-2. 적용
- `js/tx_1on1.js` `.ez1o-bar` → `.ezsurf` 병용. `✦ elizax 녹음·요약`을 **제목 줄**(`.ezsurf-hd`)로 올리고 버튼은 아래 줄. `.ez1o-note` 11.5px → 12.5px.
- `css/tx_agent.css` `.agh-live`(11.5px) → 12.5px, `.agh-brief`·`.agh-workpanel`에 `.ezsurf` 적용.
- `js/tx_meeting.js` 안 화면 삽입 조각도 훑어 `.ezsurf` 적용.
- **화면 안 elizax 조각 전수 점검표**를 파일 머리에 주석으로 남긴다.

---

## 10. H — 잔여 개발자 말 (`js/tx_inbox.js` · `js/tx_fix_perf.js`)

- `tx_inbox.js:96,105,113,121` `src` 문자열의 `tsk.wb-0714`·`memo.0630` **삭제** — 사람 말만(`체크인 기록 · 업무보드`).
- `tx_inbox.js:269` `drKV('출처', …)` → `EZSource.label()`. 빈 값이면 그 줄을 그리지 않는다.
- `tx_fix_perf.js:1131-1134` `srcChip` 노출 텍스트 → `EZSource.label(s)`, 없으면 칩을 만들지 않는다(`data-sid`는 남겨도 된다).
- `tx_fix_perf.js:1230,1235-1236` `openSrc` 토스트에서 `'[' + sid + ']'` **제거**.
- 두 파일 전체를 훑어 **화면에 나가는 문자열의 코드·표 이름·점 경로**를 없앤다.

---

## 11. 검증 (본세션)

1. `node --check` — 변경 파일 전부.
2. `index.html` 스크립트 등록(`js/ez_source_map.js`·`js/ez_inline.js`) + 변경 파일 `?v=` 캐시버스팅.
3. 라이브 4역할 × 시나리오:
   - `"1차 평가자 검토가 제대로 되고 있는지 확인해줘"` → **화면 이동 없이 채팅 답변**, `조직 평균 3일`·`14일`·`7건` 취지 포함.
   - 복사·재생성 버튼 없음.
   - 알림 탭에 「성과 기록」 없음, 지난 알림에 `테스트 알림`·빈 `알림` 없음.
   - 작업 중 카드가 실제로 움직인다.
   - 성과 기록 상세에 「인용 이력」 없고 앞뒤 노드가 보인다.
   - 목표 생성 화면에서 `✦ elizax로 정제` → 제안이 **필드 위에** 겹쳐 뜬다.
   - 발송 확인 모달에 실명 수신자·`{{}}` 없음.
   - `document.body.innerText` 정규식 스윕에 `goal.ai.draft`·`objectives.owner_emp_id` 류 0건.
4. 콘솔 에러 0.
