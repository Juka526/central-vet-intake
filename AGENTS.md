# 센트럴 문진 개발 지침

## GitHub PR 검토와 병합

- PR과 GitHub CI 상태는 GitHub CLI의 `gh` 스킬을 사용해 확인합니다. PR 번호, 대상 브랜치, HEAD SHA를 확인하고 변경 내용 및 검사 로그를 그 커밋에 연결합니다.
- 독립 검증에는 `verification-before-completion`을 적용합니다. 결과를 주장하기 전에 같은 커밋의 실제 테스트 결과를 확인합니다. 하네스가 실행한 호스트 검증 결과를 사용하고, 인수 조건과 관련한 누락을 별도로 검토합니다.
- 리뷰 보완에는 `receiving-code-review`를 적용합니다. 지적 사항을 실제 코드나 재현 사례와 대조하고 근거가 확인되면 수정한 뒤 동일 사례를 다시 실행합니다.
- PR 게시와 병합에는 `finishing-a-development-branch`의 검증 및 통합 순서를 적용합니다. 하네스가 PR 작성, 갱신, 병합을 담당합니다. 독립 검증과 GitHub `CI / verify`가 통과하고, PR HEAD가 검증한 커밋과 일치할 때 기존 권한과 GitHub 병합 규칙에 따라 병합합니다. CI 실패 시 해당 커밋의 검사 로그에서 실패한 단계와 재현 결과를 기록합니다.
- Cloud Shell의 사용자 스킬은 GitHub `cli/cli`의 `761ea6d`와 `obra/superpowers`의 `22f0b46` 버전에서 설치합니다.
