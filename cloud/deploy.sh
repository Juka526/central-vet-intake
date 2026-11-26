#!/usr/bin/env bash
set -euo pipefail
project=${1:?Usage: deploy.sh PROJECT_ID}
[[ "$project" =~ ^central-vet-[a-z0-9-]+$ ]] || { echo 'Expected a dedicated central-vet-* project.' >&2; exit 1; }
region=asia-northeast3
service=intake-api
repo="$region-docker.pkg.dev"
sha=$(git rev-parse HEAD)
image="$repo/$project/intake/intake-api:$sha"
gcloud auth configure-docker "$repo" --project="$project" --quiet
docker buildx build --platform linux/amd64 --push --tag "$image" -f cloud/Dockerfile .
run=(--project="$project" --region="$region")
# Fail if the service listing is unavailable. First deployment cannot use --no-traffic.
services=$(gcloud run services list "${run[@]}" --format='value(metadata.name)')
deploy_args=(--tag=candidate)
if grep -Fxq "$service" <<<"$services"; then
  deploy_args+=(--no-traffic)
fi
# IAM invocation checks are enabled by default for new services. Do not add a public binding.
gcloud run deploy "$service" "${run[@]}" "${deploy_args[@]}" --image="$image" --quiet \
  --service-account="intake-runtime@$project.iam.gserviceaccount.com" \
  --update-env-vars="GCP_PROJECT_ID=$project,INTAKE_BUCKET=$project-intake" \
  --min=0 --max=3 --memory=256Mi --cpu=1 --timeout=90s --invoker-iam-check
description=$(gcloud run services describe "$service" "${run[@]}" --format=json)
python3 -c '
import json, os, sys
service=json.load(sys.stdin)["status"]
candidate=next(target for target in service["traffic"] if target.get("tag")=="candidate")
assert candidate["revisionName"]==service["latestReadyRevisionName"]
lines=["revision="+candidate["revisionName"], "candidate_url="+candidate["url"], "service_url="+service["url"]]
out=os.environ.get("GITHUB_OUTPUT")
with open(out, "a") if out else open("/dev/stdout", "w") as stream:
    print(*lines, sep="\n", file=stream)
' <<<"$description"
