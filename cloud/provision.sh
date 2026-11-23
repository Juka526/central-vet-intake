#!/usr/bin/env bash
# Run in a new, dedicated project as a bootstrap administrator.
set -euo pipefail
project=${1:?Usage: provision.sh PROJECT_ID BILLING_ACCOUNT GITHUB_REPO_ID MONTHLY_BUDGET}
billing=${2:?Supply the billing account to link}
repo_id=${3:?Supply the numeric ID of Juka526/central-vet-intake}
budget=${4:?Supply a budget with its billing currency, e.g. 10000KRW}
region=asia-northeast3
[[ "$project" =~ ^central-vet-[a-z0-9-]+$ && "$repo_id" =~ ^[0-9]+$ ]] || { echo 'Use a dedicated central-vet-* project and numeric repository ID.' >&2; exit 1; }
g() { gcloud "$@" --project="$project" --quiet; }
if ! g projects describe "$project" >/dev/null 2>&1; then
  g projects create "$project" --name="Central Vet Intake"
fi
linked=$(g billing projects describe "$project" --format='value(billingAccountName)')
if [[ -n "$linked" && "$linked" != "billingAccounts/$billing" ]]; then
  echo 'Existing billing account differs.' >&2; exit 1
fi
g billing projects link "$project" --billing-account="$billing"
g services enable run.googleapis.com firestore.googleapis.com storage.googleapis.com artifactregistry.googleapis.com iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com secretmanager.googleapis.com billingbudgets.googleapis.com
number=$(g projects describe "$project" --format='value(projectNumber)')
if [[ -z "$(g billing budgets list --billing-account="$billing" --filter="displayName=$project" --format='value(name)')" ]]; then
  g billing budgets create --billing-account="$billing" --display-name="$project" --budget-amount="$budget" --filter-projects="projects/$number" --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
fi

for sa in intake-runtime intake-deploy; do
  g iam service-accounts describe "$sa@$project.iam.gserviceaccount.com" >/dev/null 2>&1 || g iam service-accounts create "$sa"
done
runtime=intake-runtime@$project.iam.gserviceaccount.com
deploy=intake-deploy@$project.iam.gserviceaccount.com
g firestore databases describe --database='(default)' >/dev/null 2>&1 || g firestore databases create --database='(default)' --location="$region" --type=firestore-native
[[ "$(g firestore databases describe --database='(default)' --format='value(locationId)')" == "$region" ]]
g firestore fields ttls update expiresAt --collection-group=intakeHealthChecks --enable-ttl --async
bucket=gs://"$project"-intake
if ! g storage buckets describe "$bucket" >/dev/null 2>&1; then
  g storage buckets create "$bucket" --location="$region" --public-access-prevention --uniform-bucket-level-access --soft-delete-duration=0
fi
# Never reconfigure a bucket owned by another project.
[[ "$(g storage buckets describe "$bucket" --format='value(projectNumber)' --raw)" == "$number" ]]
[[ "$(g storage buckets describe "$bucket" --format='value(location)' --raw)" == "ASIA-NORTHEAST3" ]]
g storage buckets update "$bucket" --public-access-prevention --uniform-bucket-level-access --clear-soft-delete --no-versioning --lifecycle-file="$(dirname "$0")/health-lifecycle.json"
g storage buckets add-iam-policy-binding "$bucket" --member="serviceAccount:$runtime" --role=roles/storage.objectUser
g projects add-iam-policy-binding "$project" --member="serviceAccount:$runtime" --role=roles/datastore.user >/dev/null
g artifacts repositories describe intake --location="$region" >/dev/null 2>&1 || g artifacts repositories create intake --location="$region" --repository-format=docker
g artifacts repositories add-iam-policy-binding intake --location="$region" --member="serviceAccount:$deploy" --role=roles/artifactregistry.writer >/dev/null
for role in roles/run.developer roles/run.invoker; do
  g projects add-iam-policy-binding "$project" --member="serviceAccount:$deploy" --role="$role" >/dev/null
done
g iam service-accounts add-iam-policy-binding "$runtime" --member="serviceAccount:$deploy" --role=roles/iam.serviceAccountUser >/dev/null
pool=intake-github
g iam workload-identity-pools describe "$pool" --location=global >/dev/null 2>&1 || g iam workload-identity-pools create "$pool" --location=global --display-name='Intake GitHub'
provider=(github --location=global --workload-identity-pool="$pool")
condition="assertion.repository_id == '$repo_id' && assertion.sub == 'repo:Juka526/central-vet-intake:environment:production' && assertion.ref == 'refs/heads/main'"
settings=(--issuer-uri=https://token.actions.githubusercontent.com "--attribute-mapping=google.subject=assertion.sub,attribute.repository_id=assertion.repository_id" "--attribute-condition=$condition")
if g iam workload-identity-pools providers describe "${provider[@]}" >/dev/null 2>&1; then
  g iam workload-identity-pools providers update-oidc "${provider[@]}" "${settings[@]}"
else
  g iam workload-identity-pools providers create-oidc "${provider[@]}" "${settings[@]}"
fi
principal="principalSet://iam.googleapis.com/projects/$number/locations/global/workloadIdentityPools/$pool/attribute.repository_id/$repo_id"
g iam service-accounts add-iam-policy-binding "$deploy" --member="$principal" --role=roles/iam.workloadIdentityUser >/dev/null
printf 'GCP_PROJECT_ID=%s\nWIF_PROVIDER=projects/%s/locations/global/workloadIdentityPools/%s/providers/github\nGCP_DEPLOY_SERVICE_ACCOUNT=%s\n' "$project" "$number" "$pool" "$deploy"
