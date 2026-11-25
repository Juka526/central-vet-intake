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

검증은 매번 고유한 합성 문서와 객체를 사용하며 내용 대조 후 삭제 및 404 응답까지 확인한다. 실패 시 503을 반환하고 두 리소스의 정리를 시도한다. 프로세스 종료 등으로 남은 합성 자료에는 Firestore TTL과 버킷의 `health/` 전용 수명 주기 규칙이 적용된다. 동의한 음성 원본의 클라우드 보관은 후속 작업에서 다룬다.

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
