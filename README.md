# @unlimiting/psc

Google Play Developer API의 공식 **Edits workflow**를 따르는 Node.js ESM CLI입니다.

- 빌드 없이 `node`로 즉시 실행
- 패키지명: `@unlimiting/psc`
- 실행 명령: `psc`
- 인증 토큰 출력 시 자동 마스킹

## 설치

```bash
npm i -g @unlimiting/psc
```

또는 로컬 실행:

```bash
npx @unlimiting/psc --help
```

## 요구사항

- Node.js 20+
- Google Play Console에 연결된 Service Account JSON
- Service Account에 Android Publisher API 권한

## 환경변수

- `GOOGLE_APPLICATION_CREDENTIALS`: 서비스 계정 JSON 파일 경로 (표준)
- `PSC_SERVICE_ACCOUNT_JSON_PATH`: 서비스 계정 JSON 파일 경로 (대체)
- `PSC_SERVICE_ACCOUNT_JSON`: 서비스 계정 JSON 문자열 직접 주입
- `PSC_PACKAGE_NAME`: 기본 package name (예: `com.example.app`)
- `PSC_IMPERSONATE_SUBJECT`: 도메인 위임 사용 시 subject 이메일

우선순위:
1. `PSC_SERVICE_ACCOUNT_JSON`
2. `--credentials`
3. `PSC_SERVICE_ACCOUNT_JSON_PATH`
4. `GOOGLE_APPLICATION_CREDENTIALS`

## 명령 구조

- `auth token`
- `auth status --package-name`
- `edits create|validate|commit`
- `bundles upload --aab`
- `tracks get|update`
- `publish submit` (create -> upload -> track update -> validate -> commit)

## 사용 예시

### 1) 인증 상태 확인

```bash
psc auth token --credentials ./service-account.json
psc auth status --credentials ./service-account.json --package-name com.example.app
```

> `auth token`은 액세스 토큰을 전체 출력하지 않고 마스킹해서 보여줍니다.

### 2) 수동 Edits 흐름

```bash
# edit 생성
psc edits create --credentials ./service-account.json --package-name com.example.app

# AAB 업로드
psc bundles upload --credentials ./service-account.json --package-name com.example.app --edit-id <EDIT_ID> --aab ./app-release.aab

# 트랙 업데이트
psc tracks update --credentials ./service-account.json --package-name com.example.app --edit-id <EDIT_ID> --track internal --version-code 123 --status completed

# 유효성 검증
psc edits validate --credentials ./service-account.json --package-name com.example.app --edit-id <EDIT_ID>

# 커밋
psc edits commit --credentials ./service-account.json --package-name com.example.app --edit-id <EDIT_ID>
```

### 3) 원샷 배포

```bash
psc publish submit \
  --credentials ./service-account.json \
  --package-name com.example.app \
  --aab ./app-release.aab \
  --track internal \
  --status completed
```

### 4) 점진 배포(inProgress)

```bash
psc publish submit \
  --credentials ./service-account.json \
  --package-name com.example.app \
  --aab ./app-release.aab \
  --track production \
  --status inProgress \
  --user-fraction 0.1
```

## release notes 파일 형식

`--release-notes-file`은 JSON 배열 또는 JSON 객체를 지원합니다.

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

## 보안 메모

- 토큰/비밀키 전체값은 출력하지 않습니다.
- CLI 에러 로그도 민감정보를 직접 출력하지 않도록 최소화되어 있습니다.

## GitHub App + gh 래퍼 (`psc-gh`)

`psc-gh`는 GitHub App 설치 토큰을 매번 발급해서 `gh` CLI를 실행합니다.

기본값:
- App ID: `2913321` (`unlimiting-sena`)
- Installation ID: `111456446`
- PEM 경로: `~/vault/unlimiting-sena_pk.pem`

예시:

```bash
psc-gh repo view unlimiting-studio/psc
psc-gh -- gh api /repos/unlimiting-studio/psc
```

옵션:
- `--app-id`
- `--installation-id`
- `--pem-path`
- `--token-only` (마스킹된 토큰 메타정보 출력)

환경변수:
- `UNLIMITING_SENA_APP_ID`
- `UNLIMITING_SENA_INSTALLATION_ID`
- `UNLIMITING_SENA_PRIVATE_KEY_PATH`

## GitHub Actions

- `CI`: PR/`main` push 시 `npm ci`, `npm test`, `npm pack --dry-run`
- `Release`: 수동 실행(`workflow_dispatch`)으로 버전 입력 후 npm 배포

배포 워크플로우를 쓰려면 리포지토리 시크릿에 `NPM_TOKEN`을 추가하세요.
