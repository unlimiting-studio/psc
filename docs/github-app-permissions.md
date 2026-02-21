# Unlimiting Sena GitHub App 권한 최소화 가이드

현재 `unlimiting-studio`에 설치된 `Unlimiting Sena` 앱은 다음 특성이 확인됩니다.

- Repository access: `all`
- Permission: 다수 영역 `write`

`psc` 저장소 자동화 목적 기준으로는 과도한 권한입니다.

## 권장 설정

1. Repository access
- `Only select repositories`로 변경
- `unlimiting-studio/psc`만 선택

2. Repository permissions
- `Contents`: Read & write
- `Metadata`: Read-only (필수)
- `Pull requests`: Read & write (PR 자동화 시)
- `Actions`: Read (워크플로우 트리거/조회만 필요하면) 또는 Read & write (워크플로우 파일 수정 자동화 시)
- 나머지는 `No access`

3. Organization permissions
- 기본적으로 모두 `No access`
- 조직 단위 자동화가 없으면 `Members`, `Administration`, `Secrets` 등은 열지 않음

## 운영 체크리스트

- 앱 설치 범위가 `psc` 단일 리포인지 확인
- 불필요 write 권한 제거
- 분기별(또는 월 1회) 권한 리뷰
- 키 유출 대비로 Private Key 로테이션 주기 운영
