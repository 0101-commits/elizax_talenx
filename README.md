# elizax_talenx

talenx HR·성과관리 SaaS 사용자 앱 목업 + **성과관리/평가 AI Agent `elizax`** 통합 데모.

실제 서비스(app.talenx.com) 라이브 대조로 재구축한 정적 목업입니다. `index.html` 하나로 동작하며, 선택적으로 로컬 프록시 서버(`server/`)를 띄우면 실제 Claude API 응답까지 연결됩니다.

## 실행 — AI 연결 3모드 (자동 선택)

| 모드 | 방법 | 되는 것 |
|---|---|---|
| **direct** (권장·간편) | `index.html` 열기(또는 GitHub Pages) → elizax ⚙ 설정에서 Anthropic API 키 입력 | 서버 없이 브라우저에서 실제 Claude 스트리밍 응답 + LLM 주도 화면 전환. 키는 localStorage 저장(데모 전용) |
| proxy | `ANTHROPIC_API_KEY` 설정 후 `node server/server.js` → `http://localhost:8080` | 위와 동일 + 키가 서버에만 존재 (운영 권장) |
| proxy (Bedrock) | Anthropic 키 없이 AWS 키만 있을 때: `$env:AWS_KEYS_CSV="...accessKeys.csv"; .\server\run.ps1` | AWS Bedrock 경유 Claude (SigV4). IAM 유저에 `bedrock:InvokeModel` 권한 + Bedrock 모델 액세스 필요. 리전 `AWS_REGION`, 모델 `ELIZAX_BEDROCK_MODEL` |
| offline | 키·서버 둘 다 없음 | 전체 UI + 목업 영수증 응답 + 내비게이션 intent |

우선순위: 프록시(키 보유) → 브라우저 직접(로컬 키) → 오프라인 목업. `window.EZAI`가 자동 판정.

```powershell
# Windows
$env:ANTHROPIC_API_KEY="sk-ant-..." ; .\server\run.ps1
```
```bash
# macOS/Linux
ANTHROPIC_API_KEY=sk-ant-... ./server/run.sh
```

- `server/server.js` — zero-dependency Node(≥18) 프록시. 정적 서빙 + `POST /api/chat`(Anthropic Messages API 스트리밍 → SSE `{type:"chunk"}` 변환) + `POST /api/chat/reset` + `GET /api/health`.
- 모델은 `ELIZAX_MODEL` 환경변수로 변경 가능 (기본 `claude-sonnet-5`).

## talenx 목업 구성

- **홈 대시보드** + GNB 8개 메뉴: 인사관리 · 근무관리 · 업무관리 · 성과관리(목표/피드백/1:1 미팅/리뷰) · 360 진단 · 평가관리(매트릭스/탈렌트 세션) · 급여관리 · 신청/승인
- 모든 버튼/탭/케밥/필터/행이 실제 동작 (모달·드로어·컨텍스트메뉴·토스트, 죽은 클릭 0)
- 공통 헤더: 통합 검색(⌘/Ctrl+K), 알림 패널, 프로필 드로어
- 전역 헬퍼 `window.TX` (modal/drawer/toast/confirm/menu)
- 디자인 토큰: Primary `#1F7AF0` / Pretendard

### 사용자(persona) 전환

우상단 스위처로 3계정 토글 — 신원·데이터·권한이 함께 바뀜(localStorage 유지):

| 계정 | 이름 | 역할 | 차이 |
|---|---|---|---|
| `soohyunkim@…` | 김수현 | 조직장(미주팀) | 인재검색·인원현황 없음 |
| `inkichoi@…` | 최인기 | HR·팀장 | 전체 접근 |
| `minsoopark@…` | 박민수 | 조직원(미주팀) | HR 메뉴 없음, 360 생성 권한 없음 |

## elizax — 성과관리/평가 AI Agent

우하단 **FAB**(⌘/Ctrl+J)가 에이전트의 유일한 앵커입니다. 3계정 관점(HR·조직장·조직원)에 따라 내용이 자동 전환됩니다.

### FAB 중심 인터랙션 (Apple 스타일 리디자인)

모든 elizax 표면은 `DESIGN-apple` 디자인 시스템 기준으로 리디자인되었고(단일 액션 컬러는 talenx `#1F7AF0` 유지), **전부 FAB에서 발원**합니다:

- **도킹 대화창** — FAB 위치를 transform-origin으로 스프링 이징 확대(`cubic-bezier(.32,.72,.24,1)`). 프로스티드 글래스 헤더/컴포저, iMessage식 말풍선(사용자=블루, 에이전트=parchment), pill CTA 문법, press = `scale(.95)`.
- **선제 알림 팝업** — FAB에서 떠오르는 rise 애니메이션(하단 FAB 중심 origin). 카드는 hairline + 단일 플로팅 섀도.
- **전체화면 딥워크(Hub)** — FAB에서 원형 **clip-path morph** 진입/이탈. 완전 전체화면이 아니라 **현재 화면이 뒤에 흐릿하게 비치는 frosted 블러 시트**(배경 클릭·Esc로 닫힘). 글로벌바는 Apple global-nav 문법(near-black `#1d1d1f`, 44px). **컨텍스트 패널(판단 근거)은 필요할 때만** — 글로벌바 "☰ 근거" 토글 + 라이브 이벤트 발생 시 자동 오픈. 디버그: `index.html#ez=hub:home` / `#ez=panel` 로 자동 오픈.
- **FAB 글로우 오브** — 상태를 텍스트 없이 색·모션으로만 표현: 유휴 / 작업 중(회전 shimmer) / 제안 도착(halo pulse) / 승인 대기(고정 링). Apple Intelligence Siri glow 패턴.
- **컨텍스트 어웨어 칩** — 현재 탭에 맞는 제안이 FAB 옆에서 pill로 잠깐 내밈 (성과관리→"목표 정합성 점검", 평가관리→"평가 문장 품질 린트", 1:1 미팅→"AI 미팅 브리핑" …). M365 Copilot Dynamic Action Button 패턴.
- `prefers-reduced-motion` 대응.

### 자연어 내비게이션 (tx_nav.js)

"**목표 설정 화면으로 넘어가줘**" → 성과관리 › 목표 탭 실전환.

- 클라이언트 intent 라우터 `window.EZNav` — 이동 동사 + 화면 키워드 매칭 → 실제 GNB/서브내비 클릭으로 전환. GNB 8메뉴 + 서브탭 24개 전부 커버.
- 라이브 AI 모드에서는 LLM이 응답 끝에 `@@NAV{"s":"perf","p":0}@@` 마커를 붙여 화면 전환을 직접 지시할 수도 있음 (클라이언트가 마커 제거 후 실행).
- 대화창에는 "화면 전환 · 성과관리 › 목표 현황" 확인 카드가 남음.

### 대화 기록 · 화면 맥락

- **대화 기록 영속화** — 대화가 localStorage에 계정별로 저장되어 새로고침·재방문 후에도 유지. "대화 초기화"로 삭제.
- **화면 맥락 실시간 추적** — GNB·서브탭 이동 시 "현재 화면" 칩이 즉시 갱신되고(서브탭까지: "성과관리 › 목표"), 라이브 모드에선 이 맥락이 Claude 프롬프트에 첨부됨.
- 라이브 연결 시 일반 질문은 전부 Claude가 답변(오프라인에서만 키워드 시나리오 가로채기). 시나리오 카드는 제안 칩으로 계속 실행 가능.

### 4대 검증가능 답변(Verifiable Answer) 원칙

모든 에이전트 답변은 **검증 가능한 객체(answer receipt)**로 렌더링: ① 기준 시점 칩(bitemporal as-of) ② 계산·근거 트레이스(규칙 버전·법령 칩·원천 recordId) ③ 감사 가능 배지 ④ What-if 재계산. 공통 스키마 `{ answer, as_of, scope, trace[], rules[], evidence[], excluded[], actions[], audit_ref }`.

### 3가지 노출 형태 · S1–S8 프로토콜

- **도킹 대화창**(상주) · **선제 팝업**(이상 신호 감지 시 먼저 제시) · **전체화면 딥워크**(병렬 심의·대형 객체) — 셋 다 FAB 발원.
- 응답은 `S1 감지 → S2 정합 → S3 계획 → S4 수행(병렬) → S5 정초 → S6 객체화 → S7 게이팅 → S8 자산화` 상태기계로 전개.
- **불변식 A(읽기/쓰기 하드 분리)**: 계획·조회·판단은 자율 실행, 발송·저장·확정은 `propose → approve → commit` — 승인 게이트 전 side-effect 0.

### Quick-Win 7과제 + 추가 3과제 (전부 시뮬레이션 동작)

| ID | 과제 | 형태 | 자율성 | 관점 |
|---|---|---|---|---|
| QW1 | 주간 중간점검 · 진척 요약 | 팝업→도킹 | auto(발송만 승인) | 조직장·HR |
| QW2 | 개인 맥락 기반 목표 초안 | 전체화면 | suggest | 조직원·조직장 |
| QW3 | 평가 코멘트·등급 근거 초안 | 도킹 | human_approve | 조직장·HR |
| QW4 | 성과 근거 자동수집 · 타임라인 | 전체화면 | suggest | 전체 |
| QW5 | 평가 편향·등급 분포 Calibration | 전체화면 | human_approve | HR |
| QW6 | 피드백 문장 정제 · SBI 구조화 | 도킹 | suggest | 조직장 |
| QW7 | 팀 목표 정합성·중복 점검 | 전체화면 | suggest | 조직장·HR |
| EX1 | 목표 Cascading 정렬 맵 | 전체화면 | suggest | HR·조직장 |
| EX2 | 리뷰 초안 실시간 co-editing | 전체화면 | suggest | 조직장·HR |
| EX3 | 이의 신청 검토 보조 | 패널 | human_approve | HR |

### 서비스 고도화 (2025-26 리서치 반영 · tx_upgrade.js)

글로벌(Lattice·15Five·Culture Amp·Workday·SAP Joule)·국내(클랩·레몬베이스·flex) 최신 AI 기능 및 규제 동향 리서치를 반영한 5개 고도화 — 전부 talenx 기존 UX 안에서 세부 페이지로 연결:

| 기능 | 근거 트렌드 | 노출 위치 |
|---|---|---|
| **1:1 미팅 코파일럿** — 미팅 전 브리핑 드로어(목표 진척·피드백 시그널·액션아이템·추천 논의 포인트) | Lattice AI Agent in 1:1s · 15Five Kona · SAP Joule | 성과관리 서브내비 "✦ AI 미팅 브리핑" → 드로어 → elizax/근거 타임라인 딥링크 |
| **리뷰 품질·편향 린트** — 평가·피드백 작성 중 인라인 검사(단정·모호·최신편향·성별화 표현) + "elizax로 정제" | Culture Amp "Improve" · SAP Calibration Agent | 평가관리/성과관리 내 모든 textarea 하단 린트 바 |
| **AI 관여 고지·이의제기** — AI 관여 범위·인간 검토 기록 고지 + 설명 요구/이의 신청 | EU AI Act Annex III(2026.8 시행) · PIPA §37조의2 | 성과관리·평가관리 서브내비 "ⓘ AI 관여 고지" 배지 → 모달 |
| **FAB 글로우 오브** (위 참조) | Apple Intelligence Siri glow | FAB |
| **컨텍스트 어웨어 FAB 칩** (위 참조) | M365 Copilot DAB | FAB 옆 |

### W1 참조 조망 뷰

도킹 상단 "조망" 바 — **⌗ 에이전트 구조**(W1 5계층 오케스트레이션)와 **◈ E2E 프로세스 맵**(목표수립→중간점검→평가→피드백, 승인 게이트·Pillar 표기). 관점(페르소나)에 따라 참여 계층/단계 자동 강조, 각 단계에서 elizax 작업으로 드릴인.

## 파일 구조

| 파일 | 역할 |
|---|---|
| `index.html` | talenx 목업 본체 (화면·GNB·서브내비) |
| `talenx_data.js` | 목업 데이터레이크 (조직·목표·평가·근거) |
| `ui_kit.js/css` | 공통 인터랙션 킷 `window.TX` |
| `tx_roles.js/css` | persona(역할) 전환 |
| `tx_fix_*.js` | 메뉴별 실동작 레이어 (홈/성과/평가/근무/인사/급여/결재/업무/360) |
| `tx_elizax.js/css` | elizax 도킹 대화창 + FAB (`window.Elizax`) |
| `tx_agent.js` / `tx_agent.css` | 전체화면 딥워크 Hub + 시나리오 + 선제 팝업 (`window.TXAgent`) |
| `tx_ai.js` | 통합 AI 클라이언트 — proxy/direct/offline 자동 전환 + 키 설정 UI (`window.EZAI`) |
| `tx_nav.js` | 자연어 내비게이션 intent 라우터 (`window.EZNav`) |
| `tx_upgrade.js` | 2025-26 고도화 5종 (글로우 오브·컨텍스트 칩·린트·AI 고지·1:1 브리핑, `window.EZUpgrade`) |
| `server/server.js` | Claude API 프록시 + 정적 서버 (zero-dep Node) |

- 순수 vanilla JS/CSS, 외부 의존성 없음. CSS 스코프: `.ezx-*`(도킹) · `.agh-*`(Hub) · `.ezup-*`(고도화) — 기존 `.tx-*`/`#s-*` 미간섭. 다크 테마 대응.

> 데이터는 테스트 워크스페이스 기준 샘플입니다. 에이전트의 모든 발송·저장·확정은 승인 게이트 뒤 목업 동작이며 서버 반영은 없습니다.
