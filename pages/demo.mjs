import { CONSENT_VERSION, PETS, draft, validateIntake } from '../lib/engine.mjs';
import { emrAdapter } from '../lib/emr-adapter.mjs';

const hour = 3600000;
const records = new Map();
const recordings = new Map();
const events = [];
let role = 'guardian';

function log(action, target = '') {
  events.unshift({ at: new Date().toISOString(), actor: role, action, target });
  events.length = Math.min(events.length, 200);
}

function cleanup() {
  const now = Date.now();
  for (const [id, record] of records) {
    if (Date.parse(record.audioExpiresAt) <= now) recordings.delete(id);
    if (Date.parse(record.expiresAt) <= now) records.delete(id);
  }
  while (events.length && Date.parse(events.at(-1).at) + 24 * hour <= now) events.pop();
}

setInterval(cleanup, 60000).unref?.();

function requireRole(...allowed) {
  if (!allowed.includes(role)) throw new Error('이 역할에서는 사용할 수 없습니다.');
}

function submit(body) {
  requireRole('guardian');
  const error = validateIntake(body);
  if (error) throw new Error(error);
  if (records.size >= 250) throw new Error('시험 접수 한도에 도달했습니다.');
  const { petId, visitType, category, complaint, answers, risks, consents } = structuredClone(body);
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 24 * hour).toISOString();
  const input = { petId, visitType, category, complaint, answers, risks };
  const record = { ...input, id, pet: PETS.find(p => p.id === petId), draft: draft(input),
    status: 'pending', version: 1, createdAt, expiresAt, consents: { ...consents, at: createdAt }, review: null };
  if (body.audio) {
    const bytes = Uint8Array.from(atob(body.audio.base64), c => c.charCodeAt(0));
    recordings.set(id, new Blob([bytes], { type: body.audio.type }));
    record.audioExpiresAt = new Date(Date.now() + hour).toISOString();
    log('audio.retained', id);
  }
  records.set(id, record);
  log('intake.created', id);
  return { id, status: record.status, flags: record.draft.flags, expiresAt, audioExpiresAt: record.audioExpiresAt };
}

function summary(r) {
  const { id, status, createdAt, category, visitType, version } = r;
  const { name, species, age } = r.pet;
  return { id, status, createdAt, category, visitType, version, pet: { id: r.petId, name, species, age },
    riskCount: r.draft.flags.length, urgent: r.draft.flags.some(f => f.level === 'contact'), missingCount: r.draft.missing.length };
}

function saveReview(r, b) {
  if (!['approved','held'].includes(b.status) || !b.hpi?.trim() || !b.soapS?.trim() ||
      b.hpi.length > 14000 || b.soapS.length > 15000 || typeof b.note !== 'string' || b.note.length > 1000)
    throw new Error('검토 내용과 상태를 확인해 주세요.');
  if (b.status === 'approved' && (!b.confirmed || (r.draft.flags.length && !b.riskAcknowledged)))
    throw new Error('원문 대조와 위험 징후 확인 후 승인해 주세요.');
  if (b.status === 'held' && !b.note.trim()) throw new Error('보류 사유를 입력해 주세요.');
  const reviewed = text => b.status === 'held' ? text : text.replaceAll('[보호자 보고 · 수의사 검토 전 초안]', '[보호자 보고 · 수의사 검토 완료]');
  r.review = { by: '시연 수의사', at: new Date().toISOString(), note: b.note, confirmed: b.confirmed,
    riskAcknowledged: b.riskAcknowledged, hpi: reviewed(b.hpi), soapS: reviewed(b.soapS) };
  r.status = b.status;
  r.version++;
  log('review.' + r.status, r.id);
}

export function request(path, { method = 'GET', body } = {}) {
  cleanup();
  if (path === '/api/session') return { role, consentVersion: CONSENT_VERSION, emr: emrAdapter.status };
  if (path === '/api/login') {
    if (!['vet','reception'].includes(body.role)) throw new Error('역할을 선택해 주세요.');
    role = body.role;
    log('login.success');
    return { role };
  }
  if (path === '/api/logout') { log('logout'); role = 'guardian'; return { ok: true }; }
  if (path === '/api/audit') { requireRole('vet'); log('audit.view'); return { items: structuredClone(events) }; }
  if (path === '/api/intakes') {
    if (method === 'POST') return submit(body);
    requireRole('vet', 'reception');
    log('intake.list');
    return { items: Array.from(records.values(), summary).reverse() };
  }
  const [, , , id, action] = path.split('/');
  const r = records.get(id);
  if (!r) throw new Error('접수 자료가 없거나 보관 기간이 지났습니다.');
  if (action === 'chat') {
    requireRole('guardian', 'reception');
    r.messages ??= [];
    if (method === 'POST') {
      const text = body?.text?.trim();
      if (!text || text.length > 500) throw new Error('메시지를 1~500자로 입력해 주세요.');
      if (r.messages.length >= 100) throw new Error('이 문진의 메시지 한도에 도달했습니다.');
      r.messages.push({ role, text });
    }
    return structuredClone(r.messages);
  }
  if (method === 'DELETE') {
    requireRole('vet','guardian');
    recordings.delete(id);
    if (!action) records.delete(id);
    log(action === 'audio' ? 'audio.deleted' : 'intake.deleted', id);
    return { ok: true };
  }
  requireRole('vet');
  if (action === 'audio') {
    if (!recordings.has(id)) throw new Error('보관된 음성이 없습니다.');
    log('audio.played', id);
    return recordings.get(id);
  }
  if (action === 'review' || action === 'export') {
    if (body.version !== r.version) throw new Error('최신 문서를 다시 열어 주세요.');
    if (action === 'export') {
      const text = emrAdapter.formatApproved(r, body.kind);
      log('export.' + body.kind, id);
      return { text };
    }
    saveReview(r, body);
  } else { log('intake.view', id); }
  return { ...structuredClone(r), audioAvailable: recordings.has(id) };
}
