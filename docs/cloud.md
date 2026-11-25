# Google Cloud 시연 배포

기존 Pages 데모는 기본적으로 브라우저 탭에서 실행된다. M0는 운영 데이터를 다루기 전, 같은 Pages 주소를 통해 Cloud Run에서 Firestore 문서와 Cloud Storage 객체를 생성·조회·삭제할 수 있는지 확인하는 단계다. 초대 계정은 별도 클라우드 시연 주소에서 문진과 승인본을 저장하고 다시 열 수 있다.

## 전용 프로젝트 준비

관리자 계정에서 gcloud에 로그인한다. GitHub 비공개 저장소를 만든 뒤 해당 저장소의 숫자 ID, 프로젝트 생성 권한, 사용할 결제 계정 ID와 월 예산을 확인한다. 프로젝트 ID에는 전 세계에서 고유한 `central-vet-` 접두어를 쓴다. 아래 예시의 환경변수를 실제 값으로 설정한 뒤 프로젝트 루트에서 실행한다.

```sh
repo_id=$(gh api repos/Juka526/central-vet-intake --jq '.id')
bash cloud/provision.sh "$GCP_PROJECT_ID" "$BILLING_ACCOUNT" "$repo_id" "$MONTHLY_BUDGET"
```

이 명령은 결제 계정을 연결하고 리소스를 만든다. 월 예산은 결제 계정 통화에 맞게 지정한다(예: `10USD`). 예산 50%, 90%, 100% 도달 시 결제 관리자에게 알림이 전달되며 비용은 계속 발생할 수 있다. 기존 작업에 쓰던 gcloud 기본 프로젝트를 변경할 필요가 없다.

스크립트는 서울(`asia-northeast3`)에 Firestore Native 기본 데이터베이스, 비공개 버킷, Artifact Registry를 구성하고 Secret Manager API를 활성화한다. 런타임 서비스 계정은 문서 접근 및 지정된 버킷의 객체 접근 권한을 받는다. 버킷은 공개 차단, 균일 권한, 버전 관리 비활성, 소프트 삭제 비활성으로 구성한다. 이 스크립트는 센트럴 문진 전용 버킷의 수명 주기 정책을 관리한다.

## GitHub Actions 배포

스크립트 마지막에 출력된 `WIF_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT`, `GCP_PROJECT_ID` 값을 GitHub의 production 환경 변수로 설정한다. GitHub 토큰의 저장소 숫자 ID, production 환경, main ref를 확인하는 Workload Identity Federation을 사용한다. GitHub Actions는 main에서 수동 시작 후 검증한 릴리스 커밋을 checkout한다. 배포용 서비스 계정은 Artifact Registry 업로드, Cloud Run 수정·호출, 지정된 런타임 계정 사용 권한을 받는다.

```sh
bash cloud/deploy.sh "$GCP_PROJECT_ID"
```

이 명령은 프로젝트 루트에서 Docker Buildx로 Linux amd64 컨테이너를 만들고 전용 Registry에 업로드한다. 최초 배포에서는 후보 리비전이 서비스 요청을 받는다. 이후에는 candidate 태그를 단 리비전을 트래픽 0%로 배포한다. 출력되는 `service_url`은 ID 토큰의 audience와 Pages 백엔드 origin으로, `candidate_url`은 직접 검증용 URL로 사용한다. `INTAKE_API_ORIGIN="$service_url" npm run build:pages`로 해당 리비전과 함께 릴리스할 Pages 번들을 만든다. Pages에 같은 이름의 런타임 환경변수가 있으면 그 값이 우선한다.

`POST /api/intake/storage-check`는 요청 본문 없이 호출한다. Cloud Run IAM에서 canonical 서비스 URL을 audience로 한 단기 Google ID 토큰과 호출자 권한을 확인한다. 저장소 검사는 기존대로 지정된 HTTPS Cloud Run 서비스에 Authorization 헤더를 전달한다. 사용자용 Klat 키·브라우저 쿠키·운영 자료는 검증에 필요하지 않다. 성공 시 아래 JSON이 반환된다.

```json
{"ok":true,"firestore":true,"storage":true}
```

검증은 매번 고유한 합성 문서와 객체를 사용하며 내용 대조 후 삭제 및 404 응답까지 확인한다. 실패 시 503을 반환하고 두 리소스의 정리를 시도한다. 프로세스 종료 등으로 남은 합성 자료에는 Firestore TTL과 버킷의 `health/` 전용 수명 주기 규칙이 적용된다.

## 로컬 검증

```sh
node --test cloud/storage.test.mjs
```

Firestore 에뮬레이터와 Cloud Storage JSON API를 지원하는 에뮬레이터(fake-gcs-server)를 기동한 환경에서는 다음과 같이 검증한다. 두 프로세스 모두 로컬 루프백 주소를 사용한다.

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 STORAGE_EMULATOR_HOST=127.0.0.1:4443 node cloud/emulator-check.mjs
```

운영 인증과 WIF 구성은 [Cloud Run 서비스 인증](https://cloud.google.com/run/docs/authenticating/service-to-service)과 [GitHub Actions를 위한 WIF](https://cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines)를 따른다.


## 초대 계정의 클라우드 문진

Pages 주소에 `?cloud=1`을 붙여 열고, 해당 Cloud Run 서비스의 호출 권한을 받은 초대 계정으로 발급한 단기 Google ID 토큰을 연결 창에 입력한다. 토큰 입력값은 현재 탭의 메모리에만 둔다. 같은 계정으로 발급한 토큰을 **연결 갱신**에 입력하면 작성 중인 문진이나 검토 내용을 이어갈 수 있다. **로그아웃** 또는 15분 동안 입력이 없으면 탭의 토큰과 편집 상태를 비운다. 합성 자료만 사용한다.

Cloud Run IAM 호출 검사와 비공개 서비스 설정을 유지한다. Pages는 문진 API에만 토큰을 `X-Serverless-Authorization`으로 전달하고 Cloud Run이 확인한 Google 계정 식별자로 저장 범위를 지정한다. 시연자는 같은 계정 안에서 보호자, 접수 담당자, 수의사로 전환한다. 접수 담당자는 목록용 요약을 보고, 수의사 시연 역할에서 원문과 승인본을 확인한다. 계정 간 공유와 직원별 역할 부여는 별도 마일스톤이다. [Cloud Run 호출 인증](https://docs.cloud.google.com/run/docs/authenticating/service-to-service)

문진과 검토 이력은 같은 Firestore 문서에서 트랜잭션으로 갱신한다. 접수 재시도 식별자와 검토 버전으로 중복 저장을 막는다. 삭제하면 방문 본문과 검토 이력을 즉시 제거하며, 재시도 처리를 위한 만료 시각과 삭제 당시 버전만 원래 만료 시각까지 남긴다. 만료된 문진은 API에서 즉시 접근을 차단한다. 기존 프로젝트에서 `demoIntakeVisits` 컬렉션 그룹의 `expiresAt` TTL 정책을 적용해야 Firestore가 만료 문서를 비동기로 제거한다. 신규 프로젝트는 `cloud/provision.sh`에서 이 정책을 구성한다.

`node --test cloud/visits.test.mjs`는 합성 호출로 계정 분리, 동시 검토, 승인본 복사, 저장 응답 유실과 재시도를 확인한다. Firestore 에뮬레이터가 있으면 `FIRESTORE_EMULATOR_HOST`를 루프백 주소로 설정해 같은 방문 수명 주기를 확인한다.

CI의 **Verify visit transactions against the Firestore emulator** 단계는 에뮬레이터 주소가 없으면 실패한다. 호스트에서도 에뮬레이터를 시작한 뒤 같은 조건으로 실행한다.

```sh
REQUIRE_FIRESTORE_EMULATOR=1 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node --test cloud/visits.test.mjs
```

Cloud Run 후보 리비전이 검증 대상 커밋과 일치하는지 확인한 뒤, 실행 환경에 아래 값을 주입하고 `node scripts/verify-cloud-visits.mjs`를 실행한다.

- `CLOUD_VISITS_ORIGIN`에는 후보 리비전의 HTTPS `run.app` 오리진을 지정한다.
- `CLOUD_VISITS_INVITED_TOKEN`과 `CLOUD_VISITS_UNINVITED_TOKEN`에는 각각 호출 권한이 있는 시연 계정과 호출 권한이 없는 계정의 단기 Google ID 토큰을 주입한다. 두 토큰의 audience는 canonical 서비스 URL이다.

스크립트는 IAM 거부, 합성 문진 제출과 재시도, 접수 요약, 승인과 버전 충돌, 승인본 재조회와 HPI·SOAP S 복사, 삭제 후 404를 확인한다. 오류가 발생하면 합성 문진 삭제를 시도한다. 검증 결과는 후보 리비전과 커밋 SHA에 연결해 기록하고, 토큰과 응답 본문은 기록하지 않는다.

Issue #6 하네스는 호스트에서 두 검사를 필수로 실행한다. 실행 환경에 위 값과 `FIRESTORE_EMULATOR_HOST`를 준비한다. 오케스트레이터가 후보 URL이 가리키는 리비전과 그 이미지의 커밋을 확인한 뒤 `CLOUD_VISITS_CANDIDATE_REVISION`과 `CLOUD_VISITS_CANDIDATE_SHA`에 각각 리비전 이름과 전체 커밋 SHA를 전달한다. 하네스는 현재 검증 SHA와 후보 SHA가 일치할 때만 후보 검사를 실행하고, 두 검사 결과를 독립 검토에 전달한다. 하네스가 새 커밋을 검증할 때는 그 커밋의 후보 정보가 필요하다.

### 선택 음성 및 삭제

보호자가 음성 처리와 원본 보관에 모두 동의한 경우에만 원본을 비공개 접수 버킷의 `intake-audio/`에 저장한다. 음성 재생에는 수의사 시연 역할과 Cloud Run이 인증한 계정의 재생 권한이 모두 필요하다. 운영자는 후보 리비전에 `AUDIO_VET_SUBJECTS`를 설정하고 재생을 허용할 초대 계정의 Google `sub` 값을 쉼표로 구분해 입력한다. 설정이 비어 있으면 모든 재생 요청이 거부된다. 재생 권한을 받은 계정도 자기 계정에 저장된 음성만 재생할 수 있다. API는 음성 1시간과 문진 24시간 경계부터 조회를 차단한다. 보호자는 자기 접수의 음성이나 문진을 삭제할 수 있고, 수의사 시연 역할의 문진 삭제는 문서 버전을 확인한다. 버킷 삭제 중 오류가 나면 접근 차단 상태를 유지하며, 화면에서 같은 삭제를 다시 요청할 수 있다.

만료 객체를 주기적으로 지우려면 운영자가 전용 서비스 계정에 해당 Cloud Run 서비스의 호출 권한을 부여하고 `AUDIO_CLEANUP_SUBJECT`를 해당 계정의 숫자 고유 ID로 설정한다. Cloud Scheduler가 이 계정의 OIDC 토큰으로 Pages 주소의 `POST /api/intake/audio-cleanup`을 호출하도록 분 단위 주기 및 오류 재시도를 구성한다. 토큰의 audience는 Cloud Run 서비스의 canonical URL을 사용한다. Pages가 토큰을 Cloud Run IAM용 헤더로 전달하며, API가 전용 계정의 ID를 확인한다. 기존 Firestore TTL은 문진을 비동기로 제거하고, 버킷에 갱신된 일 단위 수명 주기 규칙을 적용하면 예약 작업이 실패한 경우에도 음성 객체를 정리한다.

#### 후보 리비전에서 음성 인수 검증

검증할 커밋과 후보 리비전을 연결하여 기록한다. 실제 비공개 버킷과 Cloud Run IAM을 사용하는 전용 후보 환경에서 합성 음성만 사용하고, 테스트마다 새 접수 ID를 발급한다.

1. 재생 권한이 있는 초대 계정과 권한이 없는 초대 계정으로 각각 합성 음성을 제출한다. 동의 항목을 하나씩 빼면 제출이 `400`이고 객체가 생기지 않는지 확인한다. 두 항목에 모두 동의한 제출은 `201`이어야 한다.
2. 테스트 저장소 조회 권한으로 합성 문진의 Firestore `payload.original.key`를 확인한다. 인증 정보 없이 해당 `intake-audio/` 객체의 직접 다운로드를 요청해 `401` 또는 `403`을 확인한다. 인증된 문진 API에서 재생 권한이 있는 동일 계정의 수의사 요청이 `200`, 원본과 같은 바이트, `Cache-Control: no-store`를 반환하는지 확인한다. 보호자·접수 역할과 재생 권한이 없는 계정이 자기 접수에 수의사 헤더를 보낸 경우는 `403`이어야 한다.
3. 한 접수는 음성 삭제, 다른 접수는 문진 삭제를 실행한다. 재생 요청이 즉시 `404`이고 저장소 조회 권한을 사용한 해당 객체 조회도 `404`인지 확인한다. 같은 삭제 요청을 반복하면 `200`이어야 한다.
4. 예약 정리를 검증할 별도 합성 접수는 음성 만료까지 유지한다. 응답의 `audioExpiresAt` 이후 재생이 `404`인지, Cloud Scheduler의 실행 기록에 성공이 남고 객체 조회도 `404`로 바뀌는지 확인한다. 접수의 `expiresAt` 이후 원문 조회가 `404`이고 목록에서 사라졌는지 확인한다. 1ms 단위 경계와 저장소 `503` 후 재시도는 합성 시계와 저장소 오류 주입을 사용하는 로컬 테스트로 확인한다.

후보 검증 결과에는 커밋, 리비전, 각 검사 결과만 기록한다. 토큰, 계정 ID, 문진 본문, 음성 원본은 기록하지 않는다.
