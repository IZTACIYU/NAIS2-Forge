# Regression Ledger

이 문서는 **반복해서 깨졌거나, 코드만 보고는 알기 어려운 회귀 방지 invariant**를 기록한다.
일반 changelog가 아니다.

Codex는 회귀/인접 버그 작업 전에 관련 키워드를 검색한다.

---

## 기록 기준

다음 중 하나에 해당할 때만 새 항목을 추가한다.

- 과거 수정이 다시 깨짐
- 같은 root cause 계열이 반복됨
- 비직관적 guard/순서/호환성 규칙이 실제 데이터/기능을 보호함
- 여러 화면/모듈이 공유하는 위험한 계약이 확인됨

---

## R-001 — Storage backend migration is not an optimization shortcut

- **Area:** `src/lib/indexed-db.ts`, `src/lib/native-state.ts`, `src-tauri`, persisted Zustand stores
- **Symptom/Risk:** 성능 개선 과정에서 저장 backend를 바꾸면 기존 user data와 새 저장소 사이의 연결이 끊기거나 일부 데이터가 보이지 않을 수 있다.
- **History:** 프로젝트에는 History index와 Library state를 IndexedDB에서 SQLite로 옮긴 이력이 있다.
- **Invariant to preserve:** 성능 요청 자체는 storage backend/schema migration 권한이 아니다.
- **Required behavior:** backend/schema/key/migration 변경 전 `DATA CHANGE GATE`로 사용자 승인.
- **Migration rule:** copy → verify → read from new path → compatibility/rollback 확인 → 마지막에 cleanup.
- **Do not "fix" by:** 느리다는 이유만으로 IndexedDB/SQLite/localStorage를 임의 교체하거나 원본을 즉시 삭제.

---

## R-002 — Startup migration must finish before Zustand/React hydration

- **Area:** `src/main.tsx`, `src/lib/indexed-db.ts`
- **Symptom/Risk:** React가 migration보다 먼저 렌더되면 persisted store가 빈/이전 storage에서 hydrate되어 데이터가 사라진 것처럼 보이거나 새 빈 상태가 저장될 수 있다.
- **Invariant to preserve:** DB 준비 및 migration 단계가 React render보다 먼저 완료되어야 한다.
- **Do not "optimize" by:** startup latency를 줄인다는 이유로 migration을 render와 병렬 실행.
- **Required verification:** 기존 install data가 있는 상태에서 startup 후 store item/count/reference가 유지되는지 확인.

---

## R-003 — Thumbnail load failure is not proof that the source image is missing

- **Area:** Scene image thumbnails / `SceneMode`
- **History:** WebView thumbnail 오류를 실제 missing file처럼 처리하던 로직이 수정된 이력이 있다.
- **Invariant to preserve:** UI/WebView 이미지 load error만으로 Scene image metadata를 삭제하지 않는다.
- **Evidence required for deletion:** 실제 filesystem missing 확인 또는 명시적 사용자 삭제.
- **Do not "fix" by:** `onError`가 발생한 image id를 즉시 missing으로 분류.

---

## R-004 — Scene display name and physical folder identity are independent

- **Area:** Scene store, SceneDetail, scene generation filesystem paths
- **History:** scene rename/move 이후 physical folder 연결을 안정화하기 위해 persisted `folderPath`가 도입되었다.
- **Invariant to preserve:** 유효한 `scene.folderPath`가 있으면 display name에서 경로를 재추론하지 않는다.
- **Risk:** name 기반 재계산은 기존 이미지와 새 이미지가 서로 다른 폴더로 갈라지거나 파일을 찾지 못하게 할 수 있다.
- **Do not "simplify" by:** `folderPath`를 제거하고 항상 `presetName/sceneName`으로 path를 다시 만들기.

---

## R-005 — Do not re-resolve prompt semantics at the final API transport boundary

- **Area:** `src/services/novelai-api.ts`, conditional prompts, character prompts
- **History:** API 호출 직전에 conditional prompt를 다시 resolve하도록 추가한 변경이 바로 revert된 이력이 있다.
- **Invariant to preserve:** scene/main-character provenance 등 의미 정보는 그 정보를 실제로 아는 상위 request-building 계층에서 resolve한다.
- **Transport responsibility:** NovelAI API 계층은 전달/직렬화/response 처리에 집중한다.
- **Do not "fix" by:** 안전망 명목으로 API 직전에 prompt를 한 번 더 normalize/resolve.

---

## R-006 — Global keyboard navigation must yield to editors

- **Area:** Library, SceneDetail, prompt/editor UI, global keyboard listeners
- **History:** 편집 중 Escape가 page navigation까지 실행되는 문제를 막기 위해 editable target/defaultPrevented guard가 추가되었지만, 앱 전체 단축키의 navigation 분기는 초기의 입력 허용 예외를 계속 유지해 Tab/Shift+Tab에서 같은 문제가 재발했다.
- **Root cause:** `useShortcuts`가 navigation binding과 일치하면 editable target과 `defaultPrevented`를 확인하기 전에 앱 route를 변경했다.
- **Invariant to preserve:** input/textarea/select/contentEditable 및 이미 처리된 keyboard event는 global navigation이 다시 처리하지 않는다.
- **Fix:** 모든 앱 navigation shortcut이 공통 editable/defaultPrevented 판단을 먼저 통과하도록 했다. 생성·다이얼로그처럼 navigation이 아닌 shortcut은 기존 동작을 유지한다.
- **Regression coverage:** `npm run check:shortcuts`, TypeScript 및 production build.
- **Do not "simplify" by:** page-level `window.keydown`에서 key만 보고 즉시 navigation.

---

## R-007 — PNG EXIF 제거는 text chunk와 stealth alpha를 함께 처리한다

- **Date:** 2026-08-21
- **Area:** `src/lib/exif-stripper.ts`, EXIF 퀵액션/매니저, R2 upload preprocessing
- **Symptom:** EXIF 제거 후 RGB 색상은 유지되지만 앱에서 NovelAI prompt metadata가 그대로 읽힘.
- **Root cause:** v1.3.3에서 canvas 재인코딩의 색상 변형을 막기 위해 PNG text chunk만 무손실 제거하도록 바꿨으나, NovelAI가 동일 metadata를 알파 채널 LSB의 `stealth_pnginfo`/`stealth_pngcomp`에도 기록함.
- **Evidence:** 실제 생성 PNG에 `tEXt` 7개와 `stealth_pngcomp`가 동시에 존재했고, text chunk만 제거한 파일에서도 stealth parser가 metadata를 복구함.
- **Invariant to preserve:** 같은 PNG 포맷 제거는 RGB와 색상 profile을 그대로 유지하면서 metadata chunk를 제거하고, stealth payload 구간의 alpha LSB만 최대 1 조정해 숨은 metadata도 제거한다.
- **Fix:** IDAT를 inflate/unfilter하고 stealth payload를 제거한 뒤 기존 PNG filter로 refilter/deflate한다.
- **Regression coverage:** `node scripts/check-exif-strip.ts`
- **Do not "fix" by:** 같은 포맷 PNG를 canvas로 재인코딩해 색상/RGB 전체를 바꾸거나, text chunk만 지워 제거가 끝났다고 판단.
- **Related:** v1.3.3 EXIF pixel/color preservation 변경

---

## R-008 — 모델 파라미터와 legacy 저장 상태를 분리한다

- **Date:** 2026-08-21
- **Area:** model capabilities, generation store, V5 request builder
- **Symptom/Risk:** V4.5에서 저장된 `variety=true`를 V5 Furry로 재해석하면 모델을 전환한 사용자가 의도치 않게 `fur dataset,` prompt를 전송할 수 있다.
- **Root cause:** `variety`는 V4.5의 `skip_cfg_above_sigma: 58`을 뜻하며 generation store와 preset에 영속화된다.
- **Invariant to preserve:** 모델별 지원 옵션과 API 힌트 값은 모델 파라미터 정의가 소유하고, legacy `variety`의 의미를 V5 Mode로 바꾸지 않는다. 모델별 선택 저장은 정의 문자열을 복제하지 않고 선택 ID만 별도 기억한다.
- **Fix:** V5 Full/Curated request builder는 모델 정의의 Mode로 Furry dataset을 조립하고 Variety+ transport를 비활성화한다. Quality/UC 힌트는 모델별 프리셋 정의에서 전송값으로 변환하며, 투명 배경이 꺼진 경우 `false`가 아닌 `null`을 전송한다. 최초 구현에서는 선택값을 런타임에만 유지했고, 이후 사용자 승인에 따라 R-020의 additive 모델별 기억 구조를 추가했다.
- **Regression coverage:** `npm run check:model-capabilities`, TypeScript 및 production build.
- **Do not "fix" by:** 기존 `variety` boolean을 Furry mode로 재해석하거나 모델 정의의 prompt/prefix 문자열을 사용자 persistence에 복제.
- **Related:** R-020

---

## R-009 — 캐릭터 위치 오버레이는 실제 표시 이미지 좌표를 사용한다

- **Date:** 2026-08-21
- **Area:** character position board, MainMode image preview
- **Symptom/Risk:** `object-contain` 이미지 요소의 전체 박스를 위치 보드로 사용하면 레터박스 영역까지 좌표에 포함되어 실제 생성 위치와 마커가 어긋난다.
- **Invariant to preserve:** 현재 해상도와 이미지 원본 크기가 일치할 때는 natural ratio로 계산한 실제 표시 이미지 사각형에 오버레이를 맞춘다. 불일치하거나 다른 탭이면 현재 생성 비율의 별도 회색 보드를 사용하고 메인 이미지 전체를 숨긴다. 닫기 및 모드 컨트롤은 위치 좌표 영역과 분리하되 기존 이미지 우상단 액션의 오른쪽 경계를 그대로 사용하고, Grid/Free 다음 오른쪽에 닫기를 둔다. 마지막으로 선택한 Grid/Free 모드는 기존 settings store에서 복원한다.
- **Fix:** 표시 이미지 사각형과 fallback fitting을 공통 좌표 함수로 계산하고, Free 드래그는 로컬 draft로 표시한 뒤 mouseup에 한 번만 persisted position을 확정한다. fallback 보드는 테마의 muted 색을 사용하고 MainMode preview wrapper를 숨긴다. 위치 지정 컨트롤은 숨겨진 기존 이미지 액션 컨테이너의 좌표에 오른쪽 정렬한다. 모드 선택값은 `nais2-forge-settings`에 저장한다.
- **Regression coverage:** `npm run check:character-position`, TypeScript 및 production build.
- **Do not "fix" by:** `object-contain` 요소의 전체 client rect를 이미지 영역으로 간주하거나 pointer move마다 persisted store에 위치를 기록하거나, 컨트롤을 위치 좌표 영역 안에 겹쳐 배치하거나 보드 비율에 따라 별도 위치를 재계산하거나, 모드 선택값을 컴포넌트 로컬 기본값으로 되돌리기.

---

## R-010 — 최종 프롬프트는 NovelAI 콤마 공백 규칙을 따른다

- **Date:** 2026-08-21
- **Area:** prompt formatting, common generation request builder, character negative transport
- **Symptom/Risk:** 동일 seed와 prompt라도 콤마 주변 ASCII 공백 하나가 공홈 payload와 다르면 생성 결과가 달라진다.
- **Root cause:** Forge는 공홈의 기본 콤마 정규화를 적용하지 않았고 character negative transport는 최종 문자열을 추가로 `trim()`했다.
- **Invariant to preserve:** 모든 생성 prompt는 자동 빈 구분자 제거 옵션과 무관하게 콤마 앞 ASCII 공백을 최대 한 칸 제거한다. 콤마 뒤에 ASCII 공백이 없고 뒤 문자가 있으면 한 칸을 추가하며, 이미 존재하는 한 칸 이상의 공백과 문자열 끝 공백은 그대로 둔다.
- **Fix:** main/scene 공통 request builder에서 wildcard와 conditional 처리 뒤 기본 콤마 정규화를 적용하고, 선택적인 빈 구분자 제거는 그 결과에 이어서 적용한다. transport는 character negative의 앞뒤 공백을 변경하지 않는다.
- **Regression coverage:** `npm run check:prompt-formatting`, 제공된 공홈/Forge V5 전문의 `prompt`, positive/negative base caption, character caption, `uc` exact match, TypeScript 및 production build.
- **Do not "fix" by:** 전체 문자열이나 각 tag를 `trim()`하거나, 기존 공백 수를 한 칸으로 축약하거나, API transport에서 다시 정규화.

---

## R-011 — V5 투명 배경은 최상위 alpha와 prompt tag를 함께 사용한다

- **Date:** 2026-08-21
- **Area:** V5 common request builder, NovelAI transport, PNG metadata import
- **Symptom/Risk:** 투명 배경 힌트만 켜면 불투명 이미지가 생성되고, Forge 결과의 최상위 `straight_alpha`가 공홈과 달리 `false`가 된다. 임포트 시 V5 모델·품질 프리셋·투명 배경 상태도 복원되지 않는다.
- **Root cause:** 같은 이름의 중첩 디버그 필드와 최상위 `straight_alpha`를 구분하지 못해 최상위 값을 보내지 않았고, 투명 배경에 필요한 최종 positive prompt tag가 누락되었다. 메타데이터 파서는 Source와 V5 `tag_hint_*`를 generation option으로 역변환하지 않았다.
- **Invariant to preserve:** V5는 최상위 `straight_alpha: true`를 보내되 `extra_passthrough_testing.straight_alpha`는 재해석하지 않는다. 투명 배경이 켜지면 `tag_hint_transparent_background: true`와 prompt의 `transparent background`를 함께 보내고, 꺼지면 hint는 `null`이다. positive 조립 순서는 공홈과 동일한 `사용자 prompt → transparent background → Quality Tags → teXt`이며, `teXt:`는 작은따옴표·큰따옴표 내부 문구를 등장 순서와 중복 그대로 빈 줄로 구분한다. 단, `another's`처럼 단어 내부의 작은따옴표와 `artist:` 바로 뒤의 인용 이름은 추출하지 않는다. 임포트는 `teXt → Quality Tags → transparent background` 역순으로 exact match가 확인된 한 겹만 분리하고, 이전 Forge가 artist 이름까지 넣은 `teXt:`도 읽을 때만 호환한다. Source로 모델 ID를 정한 뒤 그 모델 정의의 tag hint 표를 역조회하고, UC도 같은 exact prefix 규칙으로 분리하며, NAIS2 `promptParts`의 빈 negative도 유효한 원본 값으로 취급한다.
- **Fix:** 메인/씬 공통 request builder에서 V5 alpha와 prompt tag를 조립하고 두 transport가 그대로 직렬화한다. 텍스트 추출은 큰따옴표와 독립된 작은따옴표만 인용 경계로 사용하고 단어 내부 apostrophe와 artist 인용 이름은 건너뛴다. PNG/WebP/stealth parser는 현재 형식과 이전 artist 포함 형식을 exact match로 구분해 원본 prompt를 복원하고, Source, quality/UC hint, transparent hint를 런타임 generation option으로 변환한다. 외부/구형 이미지 fallback은 모델 프리셋 표의 exact suffix/prefix만 제거하고, 자체 promptParts가 있으면 저장된 원본을 그대로 사용한다.
- **Regression coverage:** `npm run check:prompt-formatting`, `npm run check:model-capabilities`, TypeScript 및 production build, standard/streaming payload 필드 비교.
- **Do not "fix" by:** 중첩 debug alpha를 `true`로 만들거나 API transport에서 prompt를 다시 수정하거나, 임포트를 위해 persisted user schema에 V5 전용 필드를 추가.

---

## R-012 — 메타데이터의 숫자 0은 누락값이 아니다

- **Date:** 2026-08-21
- **Area:** PNG/WebP metadata parser, metadata import parameter application
- **Symptom/Risk:** `cfg_rescale: 0`인 이미지가 메타데이터 화면에서 `-`로 표시되고, 임포트 전 설정이 nonzero이면 0으로 초기화되지 않는다.
- **Root cause:** parser와 적용 UI가 숫자 필드 존재 여부를 truthiness로 검사해 유효한 0을 누락값으로 취급했다.
- **Invariant to preserve:** 메타데이터 숫자 필드는 `undefined`/`null`과 0을 구분하고, 적용 단계도 0을 유효한 값으로 전달한다.
- **Fix:** `cfg_rescale` 읽기는 nullish 존재 여부로, 적용은 `undefined` 여부로 판정한다.
- **Regression coverage:** TypeScript 및 production build, `cfg_rescale: 0` 표시·적용 경로 확인.
- **Do not "fix" by:** 숫자 metadata의 존재 여부를 `if (value)` 또는 `value || default`로 판정.

---

## R-013 — 프롬프트 토크나이저는 모델 파라미터다

- **Date:** 2026-08-21
- **Area:** model capabilities, prompt token counter
- **Symptom/Risk:** V5 프롬프트를 기존 T5 토크나이저로 계산하면 1471/703 한도 표시가 실제 Qwen 3.5 토큰 수와 달라진다.
- **Root cause:** 토큰 카운터가 모델과 무관하게 T5 정의 하나만 사용했다.
- **Invariant to preserve:** 각 모델 정의가 사용할 프롬프트 토크나이저를 소유하며, V5 Full/Curated는 Qwen 3.5에 최종 프롬프트 원문을 그대로 전달하고 기존 모델만 기존 T5용 가중치·괄호 제거를 유지한다. 대용량 토크나이저 정의는 해당 모델 계산 시에만 지연 로드한다.
- **Fix:** 공통 카운터가 model capability에 따라 T5/Qwen 카운터를 선택하고, 공식 Qwen 3.5 정의와 웹 토크나이저를 로컬 자산으로 분리했다. V5 Qwen 분기를 T5 전처리보다 앞에 두어 `{}`, `[]`, `숫자::`도 실제 입력 그대로 계산한다.
- **Regression coverage:** `npm run check:tokenizer`, `npm run check:model-capabilities`, TypeScript 및 production build.
- **Do not "fix" by:** 모든 모델에 같은 토크나이저나 같은 prompt 전처리를 적용하거나 Qwen 정의를 초기 앱 번들에 정적 import.

---

## R-014 — 다중 Quality Tags 선택은 boolean으로 복원할 수 없다

- **Date:** 2026-08-22
- **Area:** generation persisted store, V5 Quality Tags
- **Symptom/Risk:** V5에서 Light 또는 None을 선택해도 앱 재시작 후 Standard로 돌아간다.
- **Root cause:** `qualityTagPreset`은 런타임 state와 요청에는 사용됐지만 `nais2-forge-generation`의 `partialize`에서 누락됐고, 기존 `qualityToggle` boolean은 세 가지 프리셋을 표현할 수 없다.
- **Invariant to preserve:** 다중 Quality Tags 모델은 선택 ID를 저장하고, 기존 boolean은 이전 모델 호환 의미로 유지한다.
- **Fix:** 사용자 승인(2026-08-22) 후 기존 generation store 저장 payload에 `qualityTagPreset`을 additive field로 포함했다. 저장 키·backend·기존 필드는 변경하지 않았다.
- **Regression coverage:** `partialize` 저장 필드 확인, TypeScript 및 production build.
- **Do not "fix" by:** Light를 `qualityToggle=true`로 축약하거나 기존 boolean의 의미를 바꾸기.

---

## R-015 — 숫자 경계의 자동 가중치는 구분 공백을 둔다

- **Date:** 2026-08-22
- **Area:** prompt editor weight shortcut
- **Symptom/Risk:** 숫자로 시작하거나 끝나는 tag를 `Ctrl+↑/↓`로 감싸면 가중치 숫자와 prompt 숫자가 `::`에 바로 붙어 구문 경계가 모호해진다.
- **Root cause:** 자동 가중치 조립기가 prompt 내용을 그대로 `숫자::prompt::` 사이에 넣고 양 끝 문자를 검사하지 않았다.
- **Invariant to preserve:** prompt 첫 문자가 숫자면 여는 `::` 뒤에 한 칸, 마지막 문자가 숫자면 닫는 `::` 앞에 한 칸을 추가한다. 숫자가 아닌 경계와 사용자가 이미 둔 공백은 그대로 유지한다.
- **Fix:** 공통 가중치 formatter가 숫자 경계 공백을 조립하고 단축키의 caret 위치도 앞쪽 추가 공백만큼 보정한다.
- **Regression coverage:** `npm run check:prompt-formatting`, TypeScript 및 production build.
- **Do not "fix" by:** 전체 prompt를 trim/compact하거나 모든 가중치 prompt에 무조건 공백을 삽입.

---

## R-016 — Scene 이미지 I2I는 현재 Scene route를 유지한다

- **Date:** 2026-08-22
- **Area:** Scene image context actions, shared generation Source Image panel
- **Symptom/Risk:** Scene 이미지에서 I2I를 선택할 때 source 설정 후 `/`로 이동하면 Scene 생성 맥락을 잃고 Main 생성 화면으로 전환된다.
- **Invariant to preserve:** Scene 이미지 I2I는 공통 generation store에 source와 I2I mode만 설정하고 현재 Scene route를 유지한다. 외부 도구처럼 별도 화면이 필요한 액션만 명시적으로 navigate한다.
- **Fix:** Scene I2I handler의 Main route 이동을 제거하고 현재 Scene의 공통 Source Image panel이 설정을 소비하게 한다.
- **Regression coverage:** TypeScript 및 production build, Scene I2I handler의 navigation 부재 확인.
- **Do not "fix" by:** I2I 설정을 Scene 전용 두 번째 store에 복제하거나, Source Image panel 표시를 위해 Main route로 이동.

---

## R-017 — Scene 순환 반복은 생성 세션 전용 커서를 공유한다

- **Date:** 2026-08-23
- **Area:** Scene generation queue, character/reference repeat queue
- **Symptom/Risk:** 각 Scene에 같은 반복 횟수를 예약하면 첫 Scene을 모두 소진한 뒤 다음 Scene으로 넘어가며, 일반 생성과 캐릭터 반복 생성의 순서가 서로 달라질 수 있다.
- **Root cause:** 일반 큐는 항상 `queueCount > 0`인 첫 Scene을 선택하고, 캐릭터 반복 큐는 Scene별 반복 배열을 이어 붙였다.
- **Invariant to preserve:** 순환 반복이 꺼지면 기존 Scene별 소진 순서를 유지한다. 켜지면 현재 Scene 배열 순서대로 한 번씩 실행하고 남은 횟수가 있는 Scene만 건너뛰지 않고 순환한다. 상세 Scene 단독 생성에는 적용하지 않으며, 순환 커서는 생성 세션 시작·취소·종료 때 초기화한다.
- **Fix:** 공통 Scene dequeue가 런타임 커서 다음의 남은 Scene을 선택하고, 캐릭터/레퍼런스 반복 큐도 같은 순환 순서 빌더를 사용한다. 설정은 기존 settings store의 additive boolean으로 저장한다.
- **Regression coverage:** `npm run check:scene-queue-order`, TypeScript 및 production build.
- **Do not "fix" by:** 순환을 위해 persisted Scene 배열 순서를 바꾸거나, queue count를 생성 시작과 동시에 지우거나, 일반 큐와 캐릭터 반복 큐에 서로 다른 순서 규칙을 복제하지 않기.

---

## R-018 — 배포 태그 인덱스는 기존 바이너리 타입 코드를 보존한다

- **Date:** 2026-08-23
- **Area:** Danbooru tag sync, autocomplete binary index, prompt tag matching
- **Symptom/Risk:** 원격 category와 alias를 추가하면서 기존 타입 숫자의 순서를 바꾸거나 중복 label을 그대로 두면, 과거 타입이 다른 category로 해석되거나 exact match 결과가 데이터 순서에 따라 달라질 수 있다.
- **Root cause:** 기존 정적 자산은 category별 목록을 합치며 동일 label을 중복 포함했고, 바이너리에는 category 이름 대신 위치 기반 숫자 코드만 저장했다.
- **Invariant to preserve:** `NAITAG01`의 기존 코드는 general=0, copyright=1, character=2, artist=3으로 유지하고 meta=4만 끝에 추가한다. 현재 Danbooru 고유 태그 30만과 이전 배포 목록에서 누락된 고유 label만 병행 보존하며, 전체 alias를 독립 태그로 복제하지 않는다. 누락 목록에 있던 alias label은 legacy 태그와 canonical 추천을 함께 제공하고, `^_^`처럼 밑줄이 문법인 label은 공백으로 바꾸지 않는다. 원격 전체 데이터와 sync 상태는 `.tag-sync` 스테이징에만 두고 사용자 저장소와 연결하지 않는다.
- **Fix:** 전체 원격 스냅샷을 트랜잭션 스테이징에서 검증한 뒤 count 순 고유 30만 태그를 만들고, 커밋된 legacy 호환 목록 21,306개 중 문장부호 밑줄을 현재 label로 교정하는 18개를 제외한 21,288개를 병합한다. 최초 누락 21,305개와 label 교정으로 30만 경계에서 추가 이탈한 `pink crown` 한 개를 함께 보존한다. alias는 prompt matching 또는 사용자가 자동완성 검색을 시작할 때만 지연 로드하며, 누락 목록과 겹치는 6,001개만 direct legacy tag와 canonical alias 결과를 함께 반환하되 같은 태그 인덱스는 중복하지 않는다.
- **Regression coverage:** `npm run check:tag-index`, 인덱스 재생성 전후 SHA-256 비교, TypeScript 및 production build.
- **Do not "fix" by:** category 배열을 알파벳순으로 재배열하거나, API 응답을 런타임에서 직접 읽거나, deprecated/count 0이라는 이유만으로 legacy 호환 태그를 다시 제거하거나, 전체 alias 31,836개를 direct tag로 복제하거나, 별칭을 앱 시작 시 미리 로드하거나, `.tag-sync`를 사용자 persisted storage로 이동하기.

---

## R-019 — 이미지 작업은 히스토리 썸네일을 원본으로 사용하지 않는다

- **Date:** 2026-08-25
- **Area:** History image quick actions
- **Symptom:** 히스토리에서 이미지 복사를 눌러도 클립보드에 이미지가 들어가지 않고 아무 안내도 표시되지 않음.
- **Root cause:** 복사 작업이 원본 파일 대신 최대 20개로 제한된 표시용 썸네일 캐시를 읽었고, 저장 이미지의 `convertFileSrc` URL을 다시 fetch했다. 캐시가 없으면 작업이 조용히 종료되었다.
- **Invariant to preserve:** 히스토리의 복사·메타데이터·편집 작업은 임시 이미지면 메모리 원본, 저장 이미지면 실제 파일을 읽는다. 썸네일과 asset URL은 표시 전용이다.
- **Fix:** 기존 원본 이미지 로더를 복사에도 사용하고 성공·실패 결과를 사용자에게 알린다.
- **Regression coverage:** TypeScript 및 production build, 저장 이미지와 임시 이미지 복사 경로 확인.
- **Do not "fix" by:** 썸네일 캐시 크기를 늘리거나 action 직전에 썸네일을 다시 채워 원본 의존 문제를 숨기기.

---

## R-020 — 모든 모델 파라미터는 모델 전환 때 교환한다

- **Date:** 2026-08-25
- **Area:** generation persisted store, model capabilities, preset/metadata application
- **Symptom:** V5에서 선택한 UC Preset이 V4.5로 전환한 뒤에도 같은 숫자 ID로 유지되어 대상 모델의 내장 네거티브가 의도치 않게 적용됨.
- **Root cause:** 모델별 허용 옵션과 prompt 값은 capability에 분리됐지만 사용자의 현재 생성 파라미터는 generation store의 단일 전역 필드만 사용했다. 모델 전환은 일부 값을 대상 모델 규격으로 normalize할 뿐 모델별 마지막 설정을 기억하지 않았다.
- **Invariant to preserve:** 활성 모델의 기존 필드가 현재 설정의 유일한 owner이며, `modelOptionMemory`에는 비활성 모델 값만 둔다. 모델 전환은 떠나는 모델의 Steps, Guidance, Rescale, Sampler, Scheduler, 해상도, SMEA, Variety, Mode, Quality, UC, 투명 배경을 저장하고 대상 모델 값을 꺼내면서 대상 entry를 memory에서 제거한다. Prompt, Seed, Batch, I2I 작업 상태는 모델 파라미터가 아니므로 공유한다.
- **Fix:** 모든 모델 생성 파라미터를 모델 ID별로 교환하고 기존 additive persisted field에 비활성 모델 값을 저장한다. 이 구조를 처음 읽을 때 현재 활성 모델의 기존 값을 모든 모델에 복제하되, 이미 저장된 모델별 값은 보존하고 누락 필드만 현재값으로 채운다.
- **Regression coverage:** `npm run check:model-capabilities`, 기존 payload merge, 부분 필드로 저장된 이전 `modelOptionMemory` 확장, V5 Full ↔ V4.5 Full 전체 파라미터 왕복, TypeScript 및 production build.
- **Do not "fix" by:** 모델 정의의 preset 문자열을 사용자 저장 데이터에 복제하거나, 모델 전환 때 현재 모델 값을 대상 모델 entry에 다시 덮어쓰거나, active 값과 memory entry를 동시에 authoritative하게 유지하기.

---

## R-021 — 캔버스 편집 이력은 작업 단위로 제한하고 Redo 분기를 보존한다

- **Date:** 2026-08-25
- **Area:** Inpainting, Draw Over, Mosaic canvas editors, keyboard shortcuts
- **Symptom/Risk:** 인페인트와 덧그리기는 실행 취소만 가능하고 모자이크는 이력이 없어서, 한 번 되돌린 작업을 다시 적용하거나 모자이크 실수를 복구할 수 없었다.
- **Root cause:** 각 편집기가 서로 다른 canvas 상태를 소유하지만 공통적인 undo/redo 분기 규칙이 없었고, 기존 인페인트·덧그리기 이력은 이전 상태만 보관했다.
- **Invariant to preserve:** 한 번의 pointer stroke와 초기화를 각각 한 작업으로 기록한다. Undo 후 새 작업을 시작하면 기존 Redo 분기를 버리고, 편집기를 닫거나 원본을 교체하면 임시 이력을 정리한다. 입력 요소가 포커스를 가진 동안 전역 단축키가 native undo/redo를 가로채지 않는다.
- **Fix:** 인페인트와 모자이크는 변경 셀/블록 작업을 최대 50회 보관하고, 덧그리기는 메모리 사용을 제한하기 위해 압축 편집 레이어 snapshot을 최대 12회 보관한다. 세 편집기 모두 버튼과 `Ctrl+Z`, `Ctrl+Shift+Z`, `Ctrl+Y`로 양방향 이동하며, 모자이크는 원본 이미지 전체 snapshot 대신 변경 블록으로 canvas를 재구성한다.
- **Regression coverage:** `npm run check:shortcuts`, undo 후 redo, undo 후 새 stroke, reset undo/redo, editable target shortcut guard, TypeScript 및 production build.
- **Do not "fix" by:** 매 pointer move마다 전체 canvas snapshot을 저장하거나, 이력을 무제한 유지하거나, 편집기 밖의 input native undo를 가로채기.

---

## R-022 — 프롬프트 편집 이력은 표시 값과 프로그램 편집을 함께 소유한다

- **Date:** 2026-08-26
- **Area:** Prompt autocomplete editor, text undo/redo, IME input
- **Symptom/Risk:** 한 글자 수정 후 Undo가 예상보다 오래 전 상태로 이동하거나, Redo가 보이는 편집 순서보다 앞이나 뒤로 이동했다.
- **Root cause:** 외부 코드 편집기의 3초 영단어 병합 이력과 React의 현재 값이 따로 관리됐고, 자동완성·가중치 조절·자동 구문 완성은 외부 편집기 이력을 거치지 않아 표시 값과 Undo stack이 달라졌다.
- **Invariant to preserve:** 프롬프트의 보이는 값과 Undo/Redo stack은 자동완성 편집기가 함께 소유한다. 짧고 인접한 일반 문자 입력·삭제만 묶고, 공백·쉼표·개행·커서 이동·선택 교체·붙여넣기·자동완성·가중치 조절·IME 조합은 작업 경계를 만든다. Undo 후 새 편집은 Redo 분기를 버리며 이력은 최대 100개만 유지한다.
- **Fix:** 입력 전후 차이와 caret 연속성을 기준으로 700ms 이내의 인접 단일 문자 입력·삭제만 병합하고, 모든 프로그램 편집과 IME 완료를 명시적 transaction으로 기록한다. `Ctrl+Z`, `Ctrl+Shift+Z`, `Ctrl+Y`는 이 이력만 이동한다.
- **Regression coverage:** `npm run check:shortcuts`, TypeScript 및 production build, 인접 입력/시간 경과/커서 이동/공백·쉼표/Backspace·Delete/붙여넣기 분기 검사.
- **Do not "fix" by:** 부모 `onChange` debounce 시간을 Undo 단위로 사용하거나, 프로그램 편집을 외부 편집기 내부 이력과 별도로 갱신하거나, IME 조합 중간값을 각각 한 단계로 기록하기.

---

## R-023 — 씬 생성은 지연 저장 중인 로컬 프롬프트를 먼저 확정한다

- **Date:** 2026-08-26
- **Area:** Scene prompt editor, scene generation session, queue generation
- **Symptom:** 씬 프롬프트를 수정한 직후 생성하면 첫 생성은 이전 프롬프트를 사용하고 두 번째 생성부터 수정값이 적용됐다.
- **Root cause:** 타이핑 중 큰 persisted scene store 갱신을 줄이기 위해 positive와 negative prompt를 1초 뒤 저장하지만, 씬 상세 버튼·공통 생성 버튼·생성 단축키가 공유하는 generation session 시작점은 대기 중인 로컬 초안을 확정하지 않았다. 자동완성 편집기의 부모 알림도 100ms 지연되므로 입력 직후 단축키 경로에서는 scene component ref보다 편집기 내부 값이 더 최신일 수 있었다.
- **Invariant to preserve:** 씬 프롬프트는 입력 중 component-local draft를 owner로 유지하고 store 저장은 debounce한다. 실제 generation session을 시작할 때는 현재 마운트된 편집기의 positive와 negative draft를 store에 동기 반영한 후 queue를 읽는다.
- **Fix:** 자동완성 편집기는 렌더를 일으키지 않는 draft callback으로 최신 문자열을 scene component ref에 즉시 전달한다. 씬 상세 편집기가 런타임 flush callback을 등록하고, 모든 진입점이 공유하는 `startNewGenerationSession`이 session state를 바꾸기 전에 callback을 동기 실행한다. 씬 이동과 상세 화면 종료도 같은 callback으로 최신 초안을 보존한다.
- **Regression coverage:** `npm run check:scene-queue-order`, 모든 `startNewGenerationSession` 호출자가 공통 store action을 통과하는지 검색, TypeScript 및 production build.
- **Do not "fix" by:** 매 keystroke마다 전체 persisted scene store를 갱신하거나, 생성 버튼 한 곳에만 별도 지연·중복 prompt override를 추가하거나, API transport에서 화면의 로컬 state를 추정하기.

---

## R-024 — 외부 WebView 태그 추출은 페이지 표시 문자열을 신뢰하지 않는다

- **Date:** 2026-08-27
- **Area:** Embedded WebView, Danbooru tag copy, shortcut handling
- **Symptom/Risk:** 외부 단부루 페이지의 `?` 링크·게시물 수·표시용 공백이 프롬프트에 섞이거나, 단부루가 아닌 페이지에 DOM 스크립트를 실행할 수 있다.
- **Evidence:** 저장된 단부루 페이지 HTML에서 실제 태그 값은 각 `li[data-tag-name]`에 있고, 표시 문자열에는 wiki 링크와 post count가 함께 있다.
- **Invariant to preserve:** 복사는 현재 child WebView가 `donmai.us` 도메인일 때만 실행하며, 지정된 category class의 `data-tag-name`만 원본으로 사용한다. 태그 선택 설정은 WebView 전용 Store에만 저장하고 프롬프트·프리셋·생성 state와 섞지 않는다. Native child WebView를 열기 전에 크기를 읽는 target element는 닫힌 상태에도 mount되어 있어야 한다.
- **Fix:** native WebView 경계에서 도메인을 확인하고, category별 raw attribute를 `, `와 줄바꿈으로 조립한 뒤 Clipboard API 실패 시 page-local copy fallback을 사용한다. 단축키는 WebView route와 editable target guard를 통과할 때만 실행한다.
- **Regression coverage:** Danbooru host 경계와 raw selector/구분자 Rust test, `npm run check:shortcuts`의 명령 등록 및 focus guard 검사, TypeScript 및 production build.
- **Do not "fix" by:** 화면 textContent를 파싱하거나, 일반 페이지에 같은 script를 실행하거나, 새 설정을 generation/preset persisted store에 넣기.

---

## R-025 — 씬 프리셋 복제는 이미지 경로를 공유하지 않는다

- **Date:** 2026-08-27
- **Area:** Scene preset store, scene character additions, generated-image folder paths
- **Symptom/Risk:** 프리셋을 객체째 복사하면 source와 copy가 같은 Scene ID·이미지·`folderPath`를 공유해, 이후 이미지 삭제 또는 생성이 원본 데이터를 건드리거나 새 파일 경로를 충돌시킬 수 있다. `복사본` 이름을 다시 복제할 때도 물리 폴더명이 겹칠 수 있다.
- **Evidence:** Scene은 generated image와 physical `folderPath`를 persisted state에 함께 보유하며, 기존 단일 Scene 복제도 새 ID를 만들고 image·folderPath를 비운 뒤 씬별 character addition을 새 Scene ID로 복사한다.
- **Invariant to preserve:** 프리셋 복제는 source를 읽기만 한다. 새 프리셋과 모든 Scene은 새 ID를 쓰고, 이미지·queue·folderPath는 비운다. scene character additions만 새 Scene ID로 연결한다. 복사본 이름은 표시 이름과 sanitize된 물리 폴더명 모두 기존 프리셋과 충돌하지 않아야 한다.
- **Fix:** 기존 단일 Scene 복제의 데이터 보존 규칙을 프리셋 복제에도 적용하고, 공통 이름 생성기가 `원본 → 원본 (복사본) → 원본 (복사본 2)` 순서와 sanitize 충돌을 보장한다.
- **Regression coverage:** `npm run check:scene-copy-name`, TypeScript 및 production build.
- **Do not "fix" by:** source Scene ID나 image/folderPath를 그대로 재사용하거나, 복제본의 이름만 바꾸고 sanitize된 폴더명 충돌을 확인하지 않기.

---

## R-026 — 다인씬 추가 프롬프트는 같은 대상 캐릭터의 캡션에 결합한다

- **Date:** 2026-08-28
- **Area:** Scene multi-character slots, prompt token preview, common generation request builder
- **Symptom/Risk:** 다인씬 슬롯은 positive 추가 프롬프트만 저장·전달할 수 있어 캐릭터별 scene negative를 지정할 수 없었고, UI만 추가하면 토큰 표시와 실제 요청이 달라지거나 main negative에 잘못 섞일 수 있었다.
- **Evidence:** 슬롯 assignment는 성별/직접 선택으로 최종 캐릭터 ID를 결정한 뒤 positive map만 만들었고, 공통 request builder의 character input도 positive append만 지원했다.
- **Invariant to preserve:** 다인씬 Base와 Negative는 하나의 slot assignment로 같은 캐릭터를 가리킨다. Base는 해당 character positive caption 뒤에, Negative는 해당 character negative caption 뒤에 결합하며 main prompt/negative에는 넣지 않는다. 슬롯에 `negativePrompt`가 없거나 비어 있으면 기존 payload가 바뀌지 않는다.
- **Fix:** 공통 slot assignment에서 positive·negative·position의 대상 ID를 함께 결정하고, 공통 generation request character input에 optional negative append를 전달한다. 토큰 미리보기도 동일한 negative map을 사용한다.
- **Regression coverage:** `npm run check:scene-multi-character`, TypeScript 및 production build.
- **Do not "fix" by:** UI 또는 API transport에서 성별을 다시 판별하거나, scene character negative를 main negative에 합치거나, 기존 슬롯을 일괄 migration하기.

---

## R-027 — 다중 계정 목록은 기존 단일 활성 토큰을 대체하지 않는다

- **Date:** 2026-08-30
- **Area:** NovelAI authentication, API settings, persisted auth state
- **Symptom/Risk:** 다중 계정 지원을 위해 인증 저장 구조를 교체하면 기존 사용자의 토큰이 사라지거나, 추가 토큰 검증 실패가 정상 사용 중인 계정까지 로그아웃시킬 수 있다.
- **Evidence:** 생성·도구·잔액 조회 경로는 모두 auth store의 단일 `token`을 활성 인증값으로 소비하며, 기존 설치의 `nais2-forge-auth`에는 `token`, `isVerified`, `tier`만 저장되어 있다.
- **Invariant to preserve:** `token`은 현재 활성 계정의 유일한 owner로 유지한다. `tokens`는 전환 가능한 저장 목록일 뿐 생성 요청에 직접 쓰지 않는다. 목록이 없는 이전 데이터는 기존 `token`을 첫 행으로 표시하며, 비활성 후보 검증 실패는 활성 계정 상태를 무효화하지 않는다. 계정별 Anlas·V5 할당량은 조회 결과일 뿐 영속화하지 않는다.
- **Fix:** 기존 auth 저장 키와 활성 토큰 필드를 유지한 채 선택적 토큰 목록을 추가하고, 설정 및 헤더 계정 메뉴에서 기존 검증 action을 통과한 경우에만 활성 토큰을 전환한다.
- **Regression coverage:** `npm run check:auth-token-list`, 기존 단일 토큰 fallback, 목록 중복 제거, 빈 설치 첫 행, 토큰 앞부분 표시, TypeScript 및 production build.
- **Do not "fix" by:** 기존 `token`을 목록으로 migration하거나 삭제하기, 모든 API 호출자가 토큰 목록에서 임의 선택하게 만들기, 비활성 토큰 검증 실패 시 현재 인증 상태를 초기화하기.

---

## R-028 — 계정 순환 장수는 모든 이미지 생성 경로가 공유한다

- **Date:** 2026-08-30
- **Area:** NovelAI authentication, main generation, scene queue, image regeneration
- **Symptom/Risk:** 화면별 생성 코드가 최초에 읽은 활성 토큰을 계속 사용하면 계정 순환이 일부 반복 생성이나 씬 큐에 적용되지 않고, 활성 토큰 우선으로 재정렬된 목록만 따라가면 세 계정 이상에서 일부 계정이 영구히 선택되지 않을 수 있다.
- **Evidence:** NovelAI 이미지 생성 호출자는 메인 생성 store, 씬 생성 hook, 메인 이미지 재생성, 히스토리 재생성의 네 경로이며 각각 API 호출 직전 토큰을 넘긴다. 기존 토큰 목록 정규화는 현재 활성 토큰을 항상 첫 항목으로 옮긴다.
- **Invariant to preserve:** 네 생성 경로는 실제 API 호출 직전에 auth store에서 생성 토큰을 준비하고, 이미지 데이터가 반환된 성공 건만 같은 실행 중 카운터에 기록한다. 순환 순서는 활성 토큰 표시에 따른 목록 재정렬과 독립적으로 안정되어야 한다. 사용자 정보 조회는 성공했지만 V5 할당량 필드가 없는 계정은 0으로 간주하지 않으며, 사용할 대체 계정이 없으면 현재 계정을 유지한다.
- **Fix:** auth store가 실행 중 순환 순서·성공 장수·동시 전환을 소유하고 기존 계정 검증 action으로만 활성 계정을 바꾼다. 각 생성 호출자는 요청 직전 준비와 성공 직후 기록만 수행한다.
- **Regression coverage:** `npm run check:auth-token-list`, 전체 `generateImage`/`generateImageStream` 호출자 검색, TypeScript 및 production build.
- **Do not "fix" by:** 화면별 별도 카운터를 두기, API transport에서 UI의 계정 순환 의미를 추론하기, 실패 요청을 성공 장수로 세기, 생성마다 카운터를 영속 저장하기.

---

## R-029 — V5 할당량 표시값은 계정 생성 가능 여부가 아니다

- **Date:** 2026-08-31
- **Area:** NovelAI account rotation, image generation transport errors
- **Symptom/Risk:** V5 할당량이 0%로 표시된 계정을 요청 전에 제외하면 반올림 오차로 남아 있는 생성분이나 사용 가능한 Anlas를 쓰지 못한다. 반대로 임의 오류에 계정을 바꿔 재시도하면 이미 처리된 요청을 중복 생성할 수 있다.
- **Evidence:** NovelAI 공식 FAQ는 V5 Opus 사용 한도가 소진돼도 사용 가능한 Anlas로 계속 생성한다고 명시한다. 생성 endpoint는 HTTP 402로 해당 요청의 결제 불가를 구분하며, 일반·스트리밍·native reference transport 모두 원래 응답 상태를 보존할 수 있다.
- **Invariant to preserve:** 계정 생성 가능 여부를 게이지 퍼센트나 조회 잔액으로 사전 추정하지 않는다. 자동 순환과 생성 불가 계정 건너뛰기가 모두 켜진 경우에만 실제 생성 요청의 HTTP 402에 반응해 아직 시도하지 않은 다음 계정으로 넘긴다. 402 이외 오류는 자동 재시도하지 않는다. 계정이 하나이거나 후보가 모두 402이면 마지막 원본 생성 오류를 기존 화면 흐름에 그대로 반환한다.
- **Fix:** 네 생성 경로가 공유하는 auth-store 실행 경계에서 요청·성공 장수 기록·402 fallback을 한 번에 소유하고, web/native 일반 및 스트리밍 transport가 HTTP status를 구조적으로 반환한다.
- **Regression coverage:** `npm run check:auth-token-list`의 402 전용 fallback 판정, 전체 생성 호출자 검색, TypeScript, Rust `cargo check`, production build.
- **Do not "fix" by:** V5 할당량 0% 또는 Anlas 조회값만 보고 계정을 제외하기, 오류 문자열을 화면별로 정규식 파싱하기, 429·timeout·5xx를 다른 계정에 자동 재전송하기.

---

## R-030 — 앱 식별자 변경은 WebView 생성 전에 데이터를 이전한다

- **Date:** 2026-08-31
- **Area:** Tauri identifier, app data paths, native SQLite, WebView IndexedDB/localStorage
- **Symptom/Risk:** 정식 앱 식별자를 바꾸면 Tauri의 Roaming·Local·WebView 저장 경로가 함께 바뀌어 기존 프롬프트, 프리셋, 씬, 인증, 레퍼런스가 삭제되지 않았어도 빈 앱처럼 보일 수 있다.
- **Evidence:** 기존 식별자 경로에 native SQLite, references와 WebView `IndexedDB`·`Local Storage`가 실제 존재하며, Tauri config schema는 identifier를 WebView data directory에 사용한다고 명시한다. v1.9.1 첫 실행에서는 HTTP 플러그인이 migration setup보다 먼저 새 Local 경로에 0바이트 `.cookies`를 만들고, 충돌 검사가 이를 별도 사용자 데이터로 판정해 이전을 중단했다.
- **Invariant to preserve:** 정식 앱의 설정 기반 WebView와 새 app-data 파일을 만드는 플러그인은 identifier migration 완료 전 초기화하지 않는다. 기존 Roaming·Local 경로와 새 경로가 동시에 비어 있지 않은 상태를 임의 병합하지 않으며, 같은 데이터 루트 안에서 `old → temporary → new` 순서로 원자적 이전한다. 중간 종료는 temporary 상태에서 재개하고, 충돌이나 실패 시 새 빈 저장소로 앱을 계속 시작하지 않는다.
- **Fix:** main window 자동 생성을 끄고 Tauri setup에서 두 데이터 루트를 임시 경로로 rename한 뒤 파일 수·총 크기를 확인하고 새 식별자 경로로 활성화한다. HTTP 플러그인은 이전 후 초기화한다. 이미 실패한 실행이 남긴 destination은 정확히 0바이트 `.cookies` 하나만 있을 때만 bootstrap 흔적을 제거하고 재개한다. 완료 marker로 재실행을 멱등 처리하고 기존 데이터가 있는 destination은 덮어쓰지 않는다.
- **Regression coverage:** 임시 디렉터리에서 중첩 데이터 이전·원본 경로 제거·통계 검증·재실행·temporary 상태 복구·destination 충돌 거부·0바이트 HTTP bootstrap 복구·내용 있는 cookie 보존 Rust test, 전체 Rust test, production build, config identifier/create/plugin 순서 검사.
- **Do not "fix" by:** identifier만 바꾸기, WebView나 app-data 생성 플러그인을 migration보다 먼저 초기화하기, WebView가 열린 뒤 frontend에서 복구하기, 서로 다른 상태의 old/new 경로를 자동 병합하기, 새 경로의 데이터를 묻지 않고 덮어쓰기, 알려진 0바이트 bootstrap 파일 외의 destination 내용을 자동 삭제하기.

---

## R-031 — 앱 내부 업데이트 설치는 공통 백업 경계를 통과한다

- **Date:** 2026-08-31
- **Area:** updater UI, `src/stores/update-store.ts`, `src/pages/Settings.tsx`
- **Symptom:** 릴리스마다 바로 업데이트했는데도 최신 3개가 아니라 `v1.4.3`, `v1.4.4`, `v1.8.0` 백업만 남았다.
- **Root cause:** 일반 업데이트 알림은 설치 전 백업을 만드는 공통 action을 사용했지만, 설정 화면의 다운로드 완료 action은 updater 객체의 `install()`을 직접 호출해 백업을 건너뛰었다.
- **Evidence:** 같은 백업 폴더에서 중간 버전 백업이 한 번이라도 생성됐다면 3개 순환 과정에서 1.4.x가 먼저 제거돼야 한다. 모든 관련 릴리스의 설정 화면에 직접 설치 호출이 남아 있었다.
- **Invariant to preserve:** 앱 내부의 모든 업데이트 설치 진입점은 `installPendingUpdate()`를 사용하며, 이미 다운로드한 updater 객체는 공통 action에 다운로드 완료 상태로 넘긴다. 백업 실패 시 설치하지 않는다.
- **Fix:** 설정 화면의 다운로드 완료 상태를 공통 update owner에 등록하고 직접 설치 호출을 공통 설치 action으로 교체했다.
- **Regression coverage:** updater 객체의 직접 `install()`/`downloadAndInstall()` 호출자가 공통 owner에만 남았는지 검색, TypeScript, lint 및 production build.
- **Do not "fix" by:** 새 설치 버튼에서 updater 객체를 직접 설치하거나 화면별 백업 호출을 복제하기.

---

## R-032 — 제작자명 변경 후에도 기존 설치 경로를 이어받는다

- **Date:** 2026-08-31
- **Area:** Tauri NSIS updater, Windows install registry
- **Symptom:** 기존 바로가기는 `D:\NAIS2-Forge`의 이전 버전을 실행하지만 업데이트는 Local Programs에 새로 설치되어, 사용자가 이전 버전을 거쳐야만 최신 데이터가 연결된 앱에 진입할 수 있었다.
- **Root cause:** Tauri NSIS의 이전 설치 위치 복원은 `Software\\<manufacturer>\\NAIS2-Forge`만 읽는데, 제작자명이 `sunakgo`에서 `IZTACIYU`로 바뀌면서 기존 설치 위치 등록값을 찾지 못했다.
- **Evidence:** 기존 레지스트리 키는 `D:\NAIS2-Forge`, 새 제작자 키와 uninstall 항목은 Local Programs를 가리켰고, 생성된 NSIS 스크립트의 `RestorePreviousInstallLocation`은 현재 제작자 키만 조회했다.
- **Invariant to preserve:** 이전 제작자 키가 가리키는 위치에 실제 주 실행파일이 있으면 업데이트 설치 전에 그 경로를 재사용한다. 문자열만 남은 오래된 키나 사용자 데이터 경로는 설치 대상으로 사용하지 않는다.
- **Fix:** NSIS preinstall 훅이 legacy 제작자 키와 실행파일 존재를 확인해 `$INSTDIR`을 복원한다. 이후 표준 설치 흐름이 현재 제작자 키도 같은 경로로 기록하므로 다음 업데이트부터는 기본 복원 로직이 연속성을 유지한다.
- **Regression coverage:** `npm run check:installer-continuity`가 legacy 키 조회, 실행파일 존재 확인, 설치 경로 복원을 검사한다.
- **Do not "fix" by:** 새 설치 루트를 정착시키거나, 사용자 데이터 폴더를 다시 복사·이동하거나, 실행파일 존재 확인 없이 오래된 레지스트리 문자열을 신뢰하기.

---

## R-033 — 조건 태그 후보는 강조 블록 내부 단위로 분리한다

- **Date:** 2026-09-02
- **Area:** conditional prompt matching, weighted prompt blocks
- **Symptom:** `#if+`·`#if-` 조건 태그가 다른 태그와 같은 `숫자::...::` 강조 블록에 있으면 조건이 일치하지 않았다. 강조 블록 안에 조건 태그 하나만 있으면 정상 동작했다.
- **Root cause:** 후보 수집기가 전체 줄의 외곽 강조 구문은 정규화했지만, 콤마 분리는 다시 원문에 수행해 첫 태그에 `숫자::`, 마지막 태그에 `::`가 남았다.
- **Invariant to preserve:** 외곽 강조 블록을 제거한 동일 문자열에서 개별 태그를 분리한다. 원본 프롬프트와 강조 구문은 변경하지 않는다.
- **Fix:** 공통 조건 후보 수집기가 정규화된 줄을 콤마 단위로 분리하도록 수정했다.
- **Regression coverage:** `npm run check:prompt-formatting`에서 같은 강조 블록 안의 복수 태그를 `#if+`와 `#if-`가 모두 인식하는지 검사한다.
- **Do not "fix" by:** 생성 직전 프롬프트에서 강조 구문을 제거하거나, main/character별 조건 처리기에 별도 예외를 추가하기.

---

## R-034 — 씬 카드 메모 비교는 카드에 표시하는 씬 필드를 포함한다

- **Date:** 2026-09-03
- **Area:** scene card rendering, resolution badge, memoization
- **Symptom/Risk:** 씬 해상도나 비율 표시 토글을 변경해도 사용자 정의 비교 함수가 관련 값을 무시하면 카드의 비율 이름이 이전 상태로 남는다.
- **Root cause:** 씬 카드는 드래그 중 렌더링을 줄이기 위해 일부 값만 비교하며, 새로 표시하는 필드와 prop은 자동으로 비교 대상에 포함되지 않는다.
- **Invariant to preserve:** 씬 카드 UI가 직접 표시하는 씬 필드와 표시 토글은 메모 비교에도 포함하고, 전역 설정은 필요한 파생 값만 구독한다.
- **Fix:** 카드 비교에 해상도와 비율 표시 prop을 추가하고 비율 배지는 일치하는 사용자 지정 프리셋 이름만 구독하는 별도 메모 컴포넌트로 분리했다.
- **Regression coverage:** 씬 해상도 변경 후 카드 배지가 즉시 갱신되는지와 사용자 지정 이름이 긴 경우 카드 폭 안에서 말줄임되는지 확인한다.
- **Do not "fix" by:** 메모를 제거하거나 전체 settings store를 카드마다 구독해 모든 설정 변경에 전체 씬 목록을 다시 렌더링하기.

---

## R-035 — 씬 검수와 외부 출력은 같은 대표 이미지 한 장을 사용한다

- **Date:** 2026-09-03
- **Area:** scene review, ZIP export, Cloudflare R2 upload
- **Symptom/Risk:** 검수창은 모든 이미지를 표시하고 ZIP은 모든 즐겨찾기를 내보내는 반면 Cloudflare는 한 장만 골라, 검수 결과와 실제 출력 대상이 달랐다.
- **Root cause:** 세 경로가 각자 이미지 선택 로직을 소유했다.
- **Invariant to preserve:** 각 씬에서는 최신 즐겨찾기 이미지 한 장을 우선하고, 즐겨찾기가 없으면 최신 이미지 한 장을 선택한다. 검수·ZIP·Cloudflare가 이 규칙을 공유한다.
- **Fix:** 단일 순회 대표 이미지 선택 함수를 세 경로가 함께 사용하도록 통일했다.
- **Regression coverage:** `npm run check:scene-image-selection`에서 빈 씬, 최신 이미지 fallback, 복수 즐겨찾기 중 최신 선택을 검사한다.
- **Do not "fix" by:** 검수창에서만 이미지를 숨기거나 각 출력 컴포넌트에 별도의 즐겨찾기 조건을 다시 추가하기.

---

## 새 항목 템플릿

### R-XXX — 짧은 제목

- **Date:** YYYY-MM-DD
- **Area:** 관련 경로/기능
- **Symptom:** 사용자가 본 증상
- **Root cause:** 확인된 원인
- **Evidence:** 로그/재현/commit/호출 흐름
- **Invariant to preserve:** 앞으로 반드시 유지할 규칙
- **Fix:** 근본 수정
- **Regression coverage:** 테스트 또는 수동 검증 절차
- **Do not "fix" by:** 다시 도입하면 안 되는 잘못된 접근
- **Related:** commit/R-ID/issue
