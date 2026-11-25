import { createHash, randomUUID } from 'node:crypto';
import { CONSENT_VERSION, validateIntake } from '../lib/engine.mjs';
import { applyReview, newRecord, receipt, reviewError } from '../lib/intake-record.mjs';
import { emrAdapter } from '../lib/emr-adapter.mjs';

const roles = ['guardian', 'reception', 'vet'];
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const recordPath = /^\/api\/intakes\/([0-9a-f-]{36})(?:\/(review|export|audio))?$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const conflict = '문서 버전이 변경되었습니다. 최신 기록을 확인한 뒤 다시 시도해 주세요.';
const missing = '접수 자료가 없거나 접근할 수 없습니다.';
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

// Cloud Run IAM validates this header and strips the signature before forwarding it.
// Never derive a principal from the ordinary Authorization header or client role.
export function cloudRunPrincipal(req) {
  const token = req.headers['x-serverless-authorization']?.match(/^[Bb][Ee][Aa][Rr][Ee][Rr] [\w-]+\.([\w-]+)\.SIGNATURE_REMOVED_BY_GOOGLE$/)?.[1];
  if (!token) return null;
  try {
    const { sub, iss, exp } = JSON.parse(Buffer.from(token, 'base64url'));
    if (['https://accounts.google.com', 'accounts.google.com'].includes(iss) &&
        typeof sub === 'string' && sub && Number.isFinite(exp) && exp * 1000 > Date.now()) return sub;
  } catch { return null; }
  return null;
}

async function jsonBody(req, limit = 256_000) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') fail(415, 'JSON 요청이 필요합니다.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) fail(413, '요청이 너무 큽니다.');
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks)); } catch { fail(400, '잘못된 JSON 요청입니다.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, '잘못된 요청입니다.');
  return value;
}

export function createVisitsHandler({ store, audio, cleanupSubject, principal = cloudRunPrincipal, now = Date.now }) {
  return async function visits(req, path) {
    const subject = await principal(req);
    if (!subject) fail(401, '초대된 계정의 Cloud Run ID 토큰을 입력해 주세요.');
    if (path === '/api/intake/audio-cleanup') {
      if (subject !== cleanupSubject) fail(403, missing);
      if (req.method !== 'POST') fail(405, '지원하지 않는 요청입니다.');
      await audio.sweep(now());
      return { body: { ok: true } };
    }
    const owner = hash(subject);
    const role = req.headers['x-demo-role'] ?? 'guardian';
    if (!roles.includes(role)) fail(403, '시연 역할을 확인해 주세요.');
    const method = req.method;

    if (path === '/api/session' && method === 'GET') {
      return { body: { role, scope: owner, consentVersion: CONSENT_VERSION, emr: emrAdapter.status } };
    }
    if (path === '/api/intakes' && method === 'GET') {
      if (role === 'guardian') fail(403, '의료진 전용입니다.');
      const records = await store.list(owner, now());
      return { body: { items: records.filter(v => Date.parse(v.expiresAt) > now()).map(v => v.summary) } };
    }
    if (path === '/api/intakes' && method === 'POST') {
      if (role !== 'guardian') fail(403, '보호자 화면에서 제출해 주세요.');
      const b = await jsonBody(req, 1_656_000);
      const error = validateIntake(b);
      if (error) fail(400, error);
      const id = req.headers['idempotency-key'];
      if (!idPattern.test(id ?? '')) fail(400, '접수 재시도 식별자가 필요합니다.');
      const bytes = b.audio && Buffer.from(b.audio.base64, 'base64');
      if (bytes?.length > 1_000_000) fail(400, '음성 원본은 최대 1MB입니다.');
      if (bytes && !audio) fail(503, '음성 저장소를 사용할 수 없습니다.');
      const record = newRecord(b, id, now());
      const { expiresAt, consents } = record;
      const fingerprintInput = [record.petId, record.visitType, record.category, record.complaint,
        Object.entries(record.answers).sort(), record.risks, consents.version, consents.voice];
      // Preserve replay compatibility for text submissions made before audio was supported.
      if (consents.retainAudio) fingerprintInput.push(true, bytes ? [b.audio.type, hash(bytes)] : null);
      const fingerprint = hash(JSON.stringify(fingerprintInput));
      let original;
      const submit = existing => {
        if (existing && (!existing.record || Date.parse(existing.expiresAt) <= now()))
          return { result: { status: 409, body: { error: '이미 사용한 접수 식별자입니다.' } } };
        if (existing && existing.fingerprint !== fingerprint) return {
          result: { status: 409, body: {
            error: '첫 제출이 이미 접수되었습니다. 수정한 내용은 이 화면에 유지됩니다.',
            existingSubmissionId: id,
          } },
        };
        if (!existing && bytes && !original) return {};
        return { value: existing ? undefined : { expiresAt, record, fingerprint, history: [], ...(original && { original }) },
          result: { status: 201, body: receipt(recordFor(existing ?? { expiresAt, record, original }, now())),
            usedKey: existing ? existing.original?.key : original?.key } };
      };
      if (!bytes) return store.transact(owner, id, submit);
      const replay = await store.transact(owner, id, submit);
      if (replay) return replay;
      const audioExpiresAt = new Date(now() + 3_600_000).toISOString();
      original = { key: audioExpiresAt + '/' + randomUUID(), expiresAt: audioExpiresAt, type: b.audio.type };
      await audio.put(original.key, original.type, bytes);
      // An ambiguous commit may have published this object. Leave it for expiry cleanup.
      const response = await store.transact(owner, id, submit);
      if (response.usedKey !== original.key) await audio.remove(original.key).catch(() => {});
      return response;
    }

    const match = recordPath.exec(path);
    if (!match || !idPattern.test(match[1])) fail(404, missing);
    const [, id, action] = match;
    const deleting = (!action || action === 'audio') && method === 'DELETE';
    if (role !== 'vet' && !(role === 'guardian' && deleting)) fail(403, '원문·검토·복사는 수의사 전용입니다.');
    const b = method === 'POST' || (deleting && !action && role === 'vet') ? await jsonBody(req) : {};
    const result = await store.transact(owner, id, existing => {
      if (!existing || (!deleting && Date.parse(existing.expiresAt) <= now())) fail(404, missing);
      const { record, original } = existing;
      if (!record && !deleting) fail(404, missing);
      if (deleting) {
        if (!action && role === 'vet' && b.version !== (record?.version ?? existing.deletedVersion)) fail(409, conflict);
        const removed = original && { key: original.key, deleted: true };
        const value = action
          ? (original && !original.deleted ? { ...existing, original: removed } : undefined)
          : (record ? { expiresAt: existing.expiresAt, deletedVersion: record.version, ...(removed && { original: removed }) } : undefined);
        return { value, result: { body: { ok: true }, removeKey: original?.key } };
      }
      if (action === 'audio' && method === 'GET') {
        if (!audio || !activeOriginal(existing, now())) fail(404, missing);
        return { result: { original } };
      }
      if (!action && method === 'GET') return { result: { body: recordFor(existing, now()) } };
      if (action === 'review' && method === 'POST') {
        const error = reviewError(b, record);
        if (error) fail(400, error);
        const fingerprint = hash(JSON.stringify([b.version, b.status, b.hpi, b.soapS, b.note,
          b.confirmed === true, b.riskAcknowledged === true]));
        if (existing.history.at(-1)?.fingerprint === fingerprint) return { result: { body: recordFor(existing, now()) } };
        if (b.version !== record.version) fail(409, conflict);
        const updated = applyReview(record, b, '시험 수의사 ' + owner.slice(0, 6), new Date(now()).toISOString());
        const value = { ...existing, record: updated, history: [...existing.history,
          { version: updated.version, status: updated.status, review: updated.review, fingerprint }] };
        if (Buffer.byteLength(JSON.stringify(value)) > 900_000) fail(409, '이 문진의 검토 이력 저장 한도에 도달했습니다.');
        return { value, result: { body: recordFor(value, now()) } };
      }
      if (action === 'export' && method === 'POST') {
        if (b.version !== record.version) fail(409, conflict);
        try { return { result: { body: { text: emrAdapter.formatApproved(record, b.kind) } } }; }
        catch (error) { fail(409, error.message); }
      }
      fail(405, '지원하지 않는 요청입니다.');
    });
    if (result.removeKey) await audio.remove(result.removeKey);
    if (result.original) {
      const { key, type } = result.original;
      const bytes = await audio.get(key);
      if (!bytes) fail(404, missing);
      await store.transact(owner, id, existing => {
        if (!activeOriginal(existing, now()) || existing.original.key !== key) fail(404, missing);
        return {};
      });
      return { bytes, type };
    }
    return result;
  };
}

function activeOriginal(existing, now) {
  return existing?.record?.consents.voice === true && existing.record.consents.retainAudio === true &&
    Date.parse(existing.expiresAt) > now && !existing.original?.deleted && Date.parse(existing.original?.expiresAt) > now;
}

function recordFor(existing, now) {
  const audioAvailable = activeOriginal(existing, now);
  return audioAvailable
    ? { ...existing.record, audioAvailable, audioExpiresAt: existing.original.expiresAt }
    : existing.record;
}

