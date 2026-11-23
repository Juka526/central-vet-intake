// Official GE API access, cost and scope are unconfirmed. No DB, filesystem or network access.
export const emrAdapter = {
  status: { mode:'copy-only', vendor:'인투벳 GE', connected:false, notice:'공식 API 접근권·비용·연동 가능 여부 미확정' },
  async fetchHistory() { return { available:false, records:[], reason:'공식 연동 계약·권한 확인 전 비활성' }; },
  formatApproved(record,kind) {
    if(record.status!=='approved' || !record.review) throw new Error('수의사 승인 후 복사할 수 있습니다.');
    if(!['hpi','soapS'].includes(kind)) throw new Error('지원하지 않는 문서 형식입니다.');
    return `[가상 환자 · 내부 시험용]\n[수의사 검토·승인 / ${record.review.by} / ${record.review.at}]\n${record.review[kind]}`;
  }
};
