---
name: psc
description: Google Play Developer API Edits workflow CLI(@unlimiting/psc)를 설치하고 사용해 Android 앱 배포를 수행한다. psc 설치, 서비스 계정 인증, auth 상태 점검, edits/bundles/tracks 수동 배포, publish submit 원샷 배포, 점진 배포(inProgress), release notes JSON 적용, 자격증명/환경변수 우선순위 설정이 필요한 작업에서 사용한다.
---

# PSC CLI Skill

## 1) 설치
1. Node.js 버전을 확인한다. `node -v`가 `20` 이상이 아니면 업그레이드한다.
2. 전역 설치를 우선 사용한다.

```bash
npm i -g @unlimiting/psc
psc --help
```

3. 전역 설치가 어려우면 `npx`로 실행한다.

```bash
npx @unlimiting/psc --help
```

## 2) 사전 준비
- Google Play Console에 연결된 Service Account JSON을 준비한다.
- Service Account에 Android Publisher API 권한을 부여한다.
- 대상 패키지명(`com.example.app`)과 배포할 AAB 파일 경로를 확인한다.

## 3) 인증 설정(최초 1회)
1. 자격증명을 저장한다.

```bash
# 전역 저장: ~/.psc/service-account.json, ~/.psc/config.json
psc auth login --credentials ./service-account.json

# 로컬 저장: ./.psc/service-account.json, ./.psc/config.json
psc auth login --credentials ./service-account.json --local
```

2. 인증/접근 상태를 점검한다.

```bash
psc auth token
psc auth status --package-name com.example.app
```

3. 필요 시 즉시 경로를 직접 지정한다.

```bash
psc auth token --credentials ./service-account.json
psc auth status --credentials ./service-account.json --package-name com.example.app
```

## 4) 자격증명/설정 우선순위
자격증명은 다음 순서로 해석한다.
1. `PSC_SERVICE_ACCOUNT_JSON`
2. `--credentials`
3. `PSC_SERVICE_ACCOUNT_JSON_PATH`
4. `GOOGLE_APPLICATION_CREDENTIALS`
5. `./.psc/config.json` 또는 `~/.psc/config.json`의 `credentialsPath`

설정 관련 환경변수를 활용한다.
- `PSC_CONFIG_PATH`: config 파일 직접 지정
- `PSC_PACKAGE_NAME`: 기본 package name 지정
- `PSC_IMPERSONATE_SUBJECT`: domain-wide delegation subject 지정

옵션 우선순위를 유지한다.
- package name: `--package-name` 우선, 없으면 `PSC_PACKAGE_NAME`
- impersonation subject: `--subject` 우선, 없으면 `PSC_IMPERSONATE_SUBJECT`

## 5) 권장 배포(원샷)
기본 배포는 `publish submit`을 사용한다.

```bash
psc publish submit \
  --credentials ./service-account.json \
  --package-name com.example.app \
  --aab ./app-release.aab \
  --track internal \
  --status completed
```

점진 배포는 `inProgress`와 `--user-fraction`을 함께 사용한다.

```bash
psc publish submit \
  --credentials ./service-account.json \
  --package-name com.example.app \
  --aab ./app-release.aab \
  --track production \
  --status inProgress \
  --user-fraction 0.1
```

## 6) 수동 Edits 워크플로우
문제 분석/세밀 제어가 필요하면 수동 순서로 실행한다.

```bash
# 1) edit 생성
psc edits create --credentials ./service-account.json --package-name com.example.app

# 2) AAB 업로드
psc bundles upload --credentials ./service-account.json --package-name com.example.app --edit-id <EDIT_ID> --aab ./app-release.aab

# 3) 트랙 업데이트
psc tracks update --credentials ./service-account.json --package-name com.example.app --edit-id <EDIT_ID> --track internal --version-code 123 --status completed

# 4) validate
psc edits validate --credentials ./service-account.json --package-name com.example.app --edit-id <EDIT_ID>

# 5) commit
psc edits commit --credentials ./service-account.json --package-name com.example.app --edit-id <EDIT_ID>
```

## 7) release notes 형식
`--release-notes-file`은 JSON 배열/객체를 모두 지원한다.

배열 형식:

```json
[
  { "language": "en-US", "text": "Bug fixes" },
  { "language": "ko-KR", "text": "버그 수정" }
]
```

객체 형식:

```json
{
  "en-US": "Bug fixes",
  "ko-KR": "버그 수정"
}
```

## 8) 실행 규칙
- `--status inProgress`이면 반드시 `--user-fraction`을 함께 지정한다.
- `--version-code`는 `tracks update`에서 최소 1개 이상 필요하다.
- `--in-app-update-priority`는 `0~5` 정수만 허용한다.
- AAB 경로는 실제 파일이어야 한다.

## 9) 작업 절차(에이전트 실행용)
1. `psc --help`와 `psc auth --help`로 CLI 가용성을 먼저 확인한다.
2. 인증이 불확실하면 `psc auth status --package-name <pkg>`를 먼저 실행한다.
3. 일반 배포 요청은 `publish submit`을 우선 사용한다.
4. 실패 시 수동 Edits 워크플로우로 전환해 실패 지점을 분리한다.
5. 민감정보(토큰/키) 원문 출력은 피하고 마스킹된 출력만 공유한다.
