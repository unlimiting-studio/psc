# @unlimiting/psc

Play Store 배포를 `asc` 스타일로 다루는 Google Play Developer API CLI입니다.

## 설치

```bash
npm i -g @unlimiting/psc
```

## 빠른 시작

서비스 계정 JSON 경로를 먼저 설정합니다.

```bash
export PLAY_SERVICE_ACCOUNT_JSON_PATH=/path/to/service-account.json
```

도움말:

```bash
psc --help
```

원샷 배포:

```bash
psc publish submit \
  --package-name team.whiskeycat.moneyflow \
  --aab apps/client-app/build/app/outputs/bundle/release/app-release.aab \
  --track internal \
  --status completed
```

## 명령 구조

- `auth token`
- `auth status --package-name <packageName>`
- `edits create|validate|commit`
- `bundles upload --aab <path>`
- `tracks get|update`
- `publish submit`

## 환경변수

- `PLAY_SERVICE_ACCOUNT_JSON_PATH`: Google 서비스 계정 JSON 파일 경로
- `PLAY_SERVICE_ACCOUNT_JSON`: Google 서비스 계정 JSON 문자열
- `PLAY_PACKAGE_NAME`: 기본 패키지명 (옵션)

## 보안

- access token은 출력 시 앞부분만 마스킹하여 표시합니다.
- 서비스 계정 키/토큰 전문을 로그에 남기지 마세요.

## 라이선스

MIT
