export const ENGINE_VERSION = 'rules-ko-0.1';
export const CONSENT_VERSION = 'demo-2026-11-23-v1';
export const SAFETY = '이 문진은 진단·처방 또는 응급 판단을 대신하지 않습니다. 위험 징후가 있거나 상태가 걱정되면 문진 완료나 답변을 기다리지 말고 병원에 즉시 연락하세요.';
export const PETS = [
  { id:'demo-bori', name:'보리', species:'강아지', breed:'말티즈', age:'7세', sex:'중성화 수컷', owner:'가상 보호자 A', history:'[가상 병력] 2026-10-14 피부 가려움 상담. 현재 약물·알레르기는 보호자에게 재확인 필요.' },
  { id:'demo-nabi', name:'나비', species:'고양이', breed:'코리안 쇼트헤어', age:'4세', sex:'중성화 수컷', owner:'가상 보호자 B', history:'[가상 병력] 2026-09-02 정기 검진. 현재 상태와의 관련성은 수의사 확인 필요.' },
  { id:'demo-dubu', name:'두부', species:'강아지', breed:'푸들', age:'2세', sex:'중성화 암컷', owner:'가상 보호자 C', history:'[가상 병력] 이전 문진 없음. 인투벳 GE에서 조회한 자료가 아닙니다.' },
  { id:'demo-leo', name:'레오', species:'강아지', breed:'품종 미입력', age:'나이 미입력', sex:'성별 미입력', owner:'가상 보호자 D', history:'등록된 이전 병력이 없습니다.' }
];
export const CATEGORIES = [
  ['digestive','구토·설사'],['respiratory','기침·호흡'],['skin','피부·귀'],['urinary','배뇨·음수'],['mobility','보행·통증'],['neuro','행동·신경'],['eye','눈'],['oral','입·치아'],['general','식욕·활력'],['other','기타 증상']
].map(([id,label])=>({id,label}));
export const RISKS = [
  ['breathing','숨쉬기 힘듦·입을 벌리고 호흡·잇몸이 파래짐',/숨.{0,7}(못|힘|어려)|호흡\s*곤란|입.{0,5}벌.{0,8}호흡|잇몸.{0,4}(파래|파랗)/],
  ['collapse','의식 저하·쓰러짐·현재 지속되거나 반복되는 경련',/의식.{0,5}(없|잃|저하)|쓰러|경련|발작/],
  ['bleeding','멈추지 않는 출혈·큰 외상',/피.{0,5}(안\s*멈|멈추지)|출혈|교통\s*사고|추락|큰\s*외상/],
  ['toxin','독성 물질·사람 약·이물 섭취 의심',/독성|중독|초콜릿|포도|쥐약|사람\s*약|이물|백합/],
  ['urine','힘을 줘도 소변이 안 나옴',/(소변|오줌).{0,12}(안\s*나|못|없)|배뇨\s*불가/],
  ['abdomen','배가 갑자기 부풀고 헛구역질·심한 통증',/헛구역|배.{0,8}(부풀|빵빵)|극심한\s*통증/],
  ['heat','고온 노출 후 심한 헐떡임·갑작스러운 쇠약',/열사병|고온|더위.{0,10}(쓰러|쇠약)|차\s*안.{0,10}(갇|방치)/],
  ['birth','출산 중 심한 어려움·새끼가 나오지 않음',/난산|출산.{0,10}(어려|안\s*나|못)/]
].map(([id,label,pattern])=>({id,label,pattern}));
const q = (id,label,help='모르면 “모름”으로 답해 주세요.')=>({id,label,help});
const COMMON = [q('onset','언제부터 시작됐나요?','처음 관찰한 날짜·시간을 알려 주세요.'),q('course','얼마나 자주 나타나고, 어떻게 달라졌나요?','횟수와 지속 시간, 좋아짐·나빠짐을 알려 주세요.'),q('daily','식사·물·활력·배변은 평소와 다른가요?'),q('meds','현재 먹는 약·영양제와 마지막 투약은?','없음 / 이름·양·횟수 / 모름 중 아는 만큼 적어 주세요.'),q('history','기존 질환·수술·알레르기가 있나요?')];
const BRANCH = {
  digestive:[q('vomit','구토·설사의 횟수와 내용물·혈액 여부는?'),q('exposure','사료 변경이나 평소와 다른 것을 먹었나요?')],
  respiratory:[q('breath','쉬고 있을 때도 숨이 힘들거나 기침하나요?'),q('trigger','운동·식사·수면 등 언제 두드러지나요?')],
  skin:[q('skin_location','어느 부위를 긁거나 핥고, 피부·귀에 어떤 변화가 있나요?'),q('skin_change','새 음식·목욕·환경·외부기생충 예방의 변화가 있나요?')],
  urinary:[q('urine_detail','소변 횟수·양·색과 힘주기·통증의 변화는?'),q('water','물을 마시는 양이 달라졌나요?')],
  mobility:[q('limb','어느 부위가 불편하며 걷거나 일어설 수 있나요?'),q('injury','넘어짐·충돌·운동 이후 시작됐나요?')],
  neuro:[q('episode','행동 변화나 떨림이 언제, 얼마나 지속됐나요?'),q('awareness','발생 중 반응과 이후 회복은 어땠나요?')],
  eye:[q('eye_detail','어느 눈이며 충혈·눈물·찡그림·시력 변화가 있나요?'),q('eye_injury','외상이나 이물 접촉, 사용 중인 안약이 있나요?')],
  oral:[q('oral_detail','먹기·씹기·삼키기와 침·출혈에 변화가 있나요?'),q('oral_onset','입의 어느 부위가 불편해 보이나요?')],
  general:[q('general_detail','체중·수면·식욕·활력에 어떤 변화가 있나요?'),q('environment','최근 여행·접촉 동물·생활환경 변화가 있나요?')],
  other:[q('other_detail','어느 부위에 어떤 변화가 있나요?'),q('other_trigger','언제 심해지고, 함께 나타나는 변화는 무엇인가요?')]
};
export function questions(category, complaint='', visitType='first', answers={}) {
  const base = BRANCH[category] || BRANCH.other;
  const extras = [];
  const context=[complaint,...Object.values(answers)].join('\n');
  const patterns = {digestive:/구토|설사|토했|토해/,respiratory:/기침|호흡|숨/,urinary:/소변|오줌|배뇨/,skin:/가려|피부|긁|귀/,mobility:/절뚝|다리|걷/};
  for(const [key,pattern] of Object.entries(patterns)) if(key!==category && pattern.test(context)) extras.push(BRANCH[key][0]);
  const selected = [...COMMON,...base,...extras.slice(0,2)];
  if(visitType==='return') selected.push(q('followup','지난 진료 이후 변화와 처방 이행·불편했던 점은?','가상 이전 기록과 다른 부분도 알려 주세요.'));
  return selected.slice(0,10);
}
// Keep these rules tied to explicit wording. Do not resolve relative dates,
// add counts across time periods, or derive a count from "구토하지 않았어요".
const onsetDate = /(?<value>(?:(?:그제|어제|오늘|엊그제|지난\s*주|이번\s*주|지난달)(?:\s*(?:새벽|아침|오전|점심|오후|저녁|밤))?(?:\s*\d{1,2}\s*시(?:\s*\d{1,2}\s*분)?)?|(?:새벽|아침|오전|점심|오후|저녁|밤)(?:\s*\d{1,2}\s*시(?:\s*\d{1,2}\s*분)?)?|(?:\d{4}년\s*)?\d{1,2}월\s*\d{1,2}일|(?:\d+|한|두|세|네|며칠)\s*(?:시간|일|주|달)\s*전))/u;
const countWord = '[0-9]+|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열';
const onsetTime = new RegExp(`${onsetDate.source}\\s*부터`, 'gu');
const firstVomit = new RegExp(`${onsetDate.source}(?:은|는)?\\s*처음(?:으로)?\\s*(?:구)?토(?:했|해)[가-힣]*`, 'gu');
const symptomAfterOnset = /^(?:상태가\s*달라|증상|메스꺼|구토|토했|토해|설사|기침|숨|절뚝|경련|가려|식욕|기운이\s*없)/u;
const negatedVomit = /구토\s*(?:하지\s*않|안|없|말고)|토하지\s*않|안\s*토/u;
const count = `(?<value>${countWord})\\s*(?:번|회)(?=$|[\\s을를은는이가와과,.!?。]|였|입니다)`;
const vomitCount = [
  new RegExp(`(?<![가-힣0-9.,+-])${count}\\s*(?:구)?토(?:했(?:어요|습니다|고|는데)?|하(?:고|는)?|해(?:요|서)?|함|(?=[\\s,.!?。]|$))`, 'gu'),
  new RegExp(`(?:구토(?:를|는|가|했어요|했습니다|했는데)?|토(?:했어요|했습니다|했는데))\\s*${count}`, 'gu')
];
const alternativeCount = new RegExp(`(?:${countWord})(?:\\s*(?:번|회))?\\s*(?:또는|혹은|아니면|내지|[/~～–-])\\s*(?:${countWord})\\s*(?:번|회)`, 'u');
const mealChange = /(?:(?:식사량|먹는\s*양|식욕)(?:이|가|은|는)?\s*(?:평소보다\s*)?(?:줄었|늘었|감소했|증가했|없|평소와\s*같|그대로)[가-힣]*|(?:밥|사료|식사)(?:을|를|은|는|도|이|가)?\s+(?:(?:평소의\s*)?(?:절반|반|[0-9]+\s*%)\s*(?:만\s*)?먹[가-힣]*|(?:거의\s+)?(?:안\s+먹|못\s+먹)[가-힣]*|(?:평소보다\s*(?:덜|더|적게|많이)|평소처럼)\s*먹[가-힣]*|거르[가-힣]*|걸렀[가-힣]*))/gu;
const uncertain = /모르|모름|미확인|아마|추정|추측|기억.{0,8}(?:안|않)|(?:것|거)\s*같|듯|쯤|정도|가량|확실하지|(?:^|\s)약\s*[0-9]|[?？]/u;
const koreanCounts = ['한','두','세','네','다섯','여섯','일곱','여덟','아홉','열'];

export function extractCandidates(complaint = '') {
  const matches = { onset: [], vomitCount: [], mealChange: [] };
  for (const part of complaint.split(/(?<=[.!?。！？,，;\n])(?![0-9])/u)) {
    const clause = part.trim();
    if (!clause || uncertain.test(clause)) continue;

    for (const match of clause.matchAll(onsetTime)) {
      const following = clause.slice(match.index + match[0].length).trimStart();
      if (negatedVomit.exec(following)?.index === 0) continue;
      const startsWithVomitCount = vomitCount.some(pattern => following.matchAll(pattern).next().value?.index === 0);
      if (symptomAfterOnset.test(following) || startsWithVomitCount) {
        matches.onset.push({ value: match.groups.value, evidence: match[0] });
      }
    }
    for (const match of clause.matchAll(firstVomit)) {
      matches.onset.push({ value: match.groups.value, evidence: match[0] });
    }

    if (!negatedVomit.test(clause) && !alternativeCount.test(clause) && !/(?:번|회)\s*(?:안\s*했|아니|미만|이상|이하)|(?:한두|두세|서너)\s*번/u.test(clause)) {
      for (const pattern of vomitCount) {
        for (const match of clause.matchAll(pattern)) {
          const word = match.groups.value;
          const value = koreanCounts.includes(word) ? koreanCounts.indexOf(word) + 1 : Number(word);
          if (Number.isSafeInteger(value)) matches.vomitCount.push({ value, evidence: match[0] });
        }
      }
    }

    for (const match of clause.matchAll(mealChange)) {
      if (!/먹지|먹는지|먹었는지|먹었을|먹다가|않|아니/u.test(match[0])) {
        matches.mealChange.push({ value: match[0], evidence: match[0] });
      }
    }
  }

  return Object.fromEntries(Object.entries(matches).map(([field, candidates]) => [
    field,
    candidates.length === 1 ? candidates[0] : { value: null, evidence: null }
  ]));
}

export function assess(complaint='', answers={}, risks={}) {
  const text=[complaint,...Object.values(answers)].join('\n');
  // Conservative lexical flags are candidates, never automated triage or a negative clearance.
  return RISKS.flatMap(r => risks[r.id]==='yes' ? [{id:r.id,label:r.label,source:'보호자 직접 선택',level:'contact'}] : risks[r.id]==='unsure' ? [{id:r.id,label:r.label,source:'보호자 확인 필요',level:'uncertain'}] : r.pattern.test(text) ? [{id:r.id,label:r.label,source:'원문 키워드 후보 · 부정·과거 표현 포함 가능',level:'candidate'}] : []);
}
export function draft(input) {
  const pet=PETS.find(p=>p.id===input.petId);
  const qs=questions(input.category,input.complaint,input.visitType,input.answers);
  const answer=id=>input.answers[id]?.trim() || '미확인';
  const flags=assess(input.complaint,input.answers,input.risks);
  const missing=qs.filter(x=>!input.answers[x.id]?.trim() || /^(모름|모르겠|미확인|잘 모르)/.test(input.answers[x.id])).map(x=>x.label);
  const lines=qs.map(x=>`${x.label} ${answer(x.id)}`);
  const hpi=`[보호자 보고 · 수의사 검토 전 초안]\n${pet.name} / ${pet.species} / ${input.visitType==='return'?'재진':'초진'}\n주호소: ${input.complaint}\n${lines.join('\n')}\n위험 징후: ${flags.length?flags.map(x=>`${x.label} (${x.source})`).join('; '):'체크리스트상 모두 아니요. 응급 상태 배제를 의미하지 않음.'}\n누락·불확실: ${missing.join('; ') || '추가 문진으로 재확인 필요'}`;
  return {engine:ENGINE_VERSION,hpi,soapS:`S (Subjective, 보호자 진술만)\n${hpi}\nO/A/P: 본 도구에서 생성하지 않음.`,problems:[input.complaint],timeline:[{label:'시작',text:answer('onset')},{label:'경과',text:answer('course')}],meds:answer('meds'),history:answer('history'),missing,flags};
}
export function validateIntake(v) {
  if(!v || typeof v!=='object' || Array.isArray(v)) return '잘못된 요청입니다.';
  if(v.finalConfirm!==true) return '입력 내용 최종 확인이 필요합니다.';
  if(v.synthetic!==true) return '가상 데이터 사용 확인이 필요합니다.';
  if(!PETS.some(p=>p.id===v.petId) || !CATEGORIES.some(c=>c.id===v.category) || !['first','return'].includes(v.visitType)) return '환자·증상·방문 유형을 확인해 주세요.';
  if(typeof v.complaint!=='string' || !v.complaint.trim() || v.complaint.length>3000) return '주호소를 1~3,000자로 입력해 주세요.';
  if(!v.consents || v.consents.privacy!==true || v.consents.version!==CONSENT_VERSION || typeof v.consents.voice!=='boolean' || typeof v.consents.retainAudio!=='boolean') return '필수 개인정보 동의와 동의 버전을 확인해 주세요.';
  if(v.consents.retainAudio && !v.consents.voice) return '음성 원본 보관에는 음성 처리 동의가 먼저 필요합니다.';
  if(!v.answers || Array.isArray(v.answers) || typeof v.answers!=='object') return '후속 질문에 답해 주세요.';
  const values=[v.complaint,...Object.values(v.answers)];
  if(values.some(x=>typeof x==='string' && /(?:01[016789][ -]?\d{3,4}[ -]?\d{4}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b\d{6}-[1-4]\d{6}\b)/i.test(x))) return '전화번호·이메일·주민등록번호 등 개인정보를 지우고 가상 내용만 입력해 주세요.';
  const qs=questions(v.category,v.complaint,v.visitType,v.answers);
  const allowed=new Set(qs.map(q=>q.id));
  if(Object.keys(v.answers).some(k=>!allowed.has(k)) || Object.values(v.answers).some(a=>typeof a!=='string'||a.length>1200)) return '답변 형식이나 길이를 확인해 주세요.';
  if(qs.some(q=>!v.answers[q.id]?.trim())) return '모든 후속 질문에 답해 주세요. 모르면 “모름”으로 입력할 수 있습니다.';
  if(!v.risks || RISKS.some(r=>!['yes','no','unsure'].includes(v.risks[r.id]))) return '위험 징후 항목을 모두 확인해 주세요.';
  if(v.audio && (!v.consents.voice || !v.consents.retainAudio)) return '별도 동의 없는 음성 저장은 허용되지 않습니다.';
  if(v.audio && (!['audio/webm','audio/ogg','audio/mp4'].includes(v.audio.type) || typeof v.audio.base64!=='string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(v.audio.base64) || v.audio.base64.length>1400000)) return '음성 형식 또는 크기를 확인해 주세요. 최대 약 1MB입니다.';
  if(v.audio){
    let bytes;
    try { bytes = atob(v.audio.base64); } catch { return '음성 파일을 읽을 수 없습니다.'; }
    const valid = v.audio.type === 'audio/webm' ? bytes.startsWith('\x1a\x45\xdf\xa3')
      : v.audio.type === 'audio/ogg' ? bytes.startsWith('OggS') : bytes.slice(4,8) === 'ftyp';
    if(!valid || bytes.length>1000000) return '음성 파일 형식 또는 크기가 올바르지 않습니다.';
  }
  return null;
}
