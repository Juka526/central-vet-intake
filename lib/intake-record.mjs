import { CONSENT_VERSION, PETS, RISKS, draft } from './engine.mjs';

export function newRecord(b, id, now) {
  const input = {
    petId: b.petId, visitType: b.visitType, category: b.category, complaint: b.complaint.trim(),
    answers: b.answers, risks: Object.fromEntries(RISKS.map(({ id }) => [id, b.risks[id]])),
  };
  if (b.questionVersion !== undefined) {
    input.questionVersion = b.questionVersion;
    input.categories = b.categories;
    input.symptomSelections = b.symptomSelections ?? [];
    input.corrections = b.corrections ?? [];
  }
  const createdAt = new Date(now).toISOString();
  return {
    id, ...input, pet: PETS.find(p => p.id === input.petId), draft: draft(input),
    status: 'pending', version: 1, createdAt, expiresAt: new Date(now + 86_400_000).toISOString(),
    consents: { version: CONSENT_VERSION, privacy: true, voice: b.consents.voice,
      retainAudio: b.consents.retainAudio, at: createdAt }, review: null,
  };
}

export function receipt(record) {
  return { id: record.id, status: 'pending', flags: record.draft.flags,
    expiresAt: record.expiresAt, audioExpiresAt: record.audioExpiresAt || null };
}

export function intakeSummary(v) {
  return { id: v.id, pet: { id: v.pet.id, name: v.pet.name, species: v.pet.species, age: v.pet.age },
    category: v.category, visitType: v.visitType, status: v.status, version: v.version, createdAt: v.createdAt,
    riskCount: v.draft.flags.length, urgent: v.draft.flags.some(f => f.level === 'contact'),
    missingCount: v.draft.missing.length };
}

export function reviewError(b, record) {
  if (!['approved', 'held'].includes(b.status) || typeof b.hpi !== 'string' || !b.hpi.trim() ||
      b.hpi.length > 14000 || typeof b.soapS !== 'string' || !b.soapS.trim() || b.soapS.length > 15000 ||
      typeof b.note !== 'string' || b.note.length > 1000) return '검토 내용과 상태를 확인해 주세요.';
  if (b.status === 'approved' && (b.confirmed !== true ||
      (record.draft.flags.length > 0 && b.riskAcknowledged !== true))) return '원문 대조와 위험 징후 확인 후 승인해 주세요.';
  if (b.status === 'held' && !b.note.trim()) return '보류 사유를 입력해 주세요.';
}

export function applyReview(record, b, by, at) {
  const finalize = value => b.status === 'approved'
    ? value.replaceAll('[보호자 보고 · 수의사 검토 전 초안]', '[보호자 보고 · 수의사 검토 완료]') : value;
  return { ...record, status: b.status, version: record.version + 1,
    review: { hpi: finalize(b.hpi), soapS: finalize(b.soapS), note: b.note, by, at,
      confirmed: b.confirmed === true, riskAcknowledged: b.riskAcknowledged === true } };
}
