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
const onsetDate = /(?<value>(?:(?:그제|어제|오늘|엊그제|지난\s*주|이번\s*주|지난달|(?:\d{4}년\s*)?\d{1,2}월\s*\d{1,2}일)(?:\s*(?:새벽|아침|오전|점심|오후|저녁|밤))?(?:\s*\d{1,2}\s*시(?:\s*\d{1,2}\s*분)?)?|(?:새벽|아침|오전|점심|오후|저녁|밤)(?:\s*\d{1,2}\s*시(?:\s*\d{1,2}\s*분)?)?|(?:\d+|한|두|세|네|며칠)\s*(?:시간|일|주|달)\s*전|방금))/u;
const countWord = '[0-9]+|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열';
const onsetTime = new RegExp(`${onsetDate.source}\\s*부터`, 'gu');
const firstVomit = new RegExp(`${onsetDate.source}(?:은|는)?\\s*처음(?:으로)?\\s*(?:구)?토(?:했|해)[가-힣]*`, 'gu');
const count = `(?<value>${countWord})\\s*(?:번|회)(?=$|[\\s을를은는이가와과,.!?。]|였|입니다)`;
const vomitCount = [
  new RegExp(`(?<![가-힣0-9.,+-])${count}\\s*(?:더\\s*)?(?:구)?토(?:했(?:어요|습니다|고|는데)?|하(?:고|는)?|해(?:요|서)?|함|(?=[\\s,.!?。]|$))`, 'gu'),
  new RegExp(`(?:구토(?:를|는|가|했어요|했습니다|했는데)?|토(?:했어요|했습니다|했는데))\\s*(?:총\\s*)?${count}(?:\\s*했(?:어요|습니다|고|는데))?`, 'gu')
];
const mealChange = /(?:(?:식사량|먹는\s*양|식욕)(?:이|가|은|는)?\s*(?:평소보다\s*)?(?:줄었|늘었|감소했|증가했|없|평소와\s*같|그대로)[가-힣]*|(?:밥|사료|식사)(?:을|를|은|는|도|이|가)?\s+(?:(?:평소의\s*)?(?:절반|반|[0-9]+\s*%)\s*(?:만\s*)?먹[가-힣]*|(?:거의\s+)?(?:안\s+먹|못\s+먹)[가-힣]*|(?:평소보다\s*(?:덜|더|적게|많이)|평소처럼)\s*먹[가-힣]*|거르[가-힣]*|걸렀[가-힣]*))/gu;
const koreanCounts = ['한','두','세','네','다섯','여섯','일곱','여덟','아홉','열'];

// Match the whole assertion separately so the evidence patterns keep their original spans.
const ending = '(?:어요|아요|여요|해요|요|습니다|ㅂ니다|니다|다|고요?|는데|지만|으며)';
const predicateEnding = `(?:았|었|였|했)?${ending}`;
const timePrefix = `(?:${onsetDate.source.replace('(?<value>', '(?:')}(?:부터|에)?(?:은|는)?\\s+)?`;
const countAmount = `(?:${countWord})\\s*(?:번|회)`;
const vomitPredicate = `(?:구)?토(?:했${ending}?|해(?:요)?|하고|함)`;
const countAssertion = new RegExp(
  `^${timePrefix}(?:${countAmount}\\s*(?:구토|${vomitPredicate})|(?:구토(?:를|는|가|했어요|했습니다|했는데)?|토(?:했어요|했습니다|했는데))\\s*(?:총\\s*)?${countAmount}(?:(?:을|를)?\\s*했${ending}?|였${ending}|입니다)?)$`, 'u'
);
const mealAssertion = new RegExp(
  `^${timePrefix}${mealChange.source.replaceAll('[가-힣]*', predicateEnding)}$`, 'u'
);
const firstVomitAssertion = new RegExp(
  `^${onsetDate.source}(?:은|는)?\\s*처음(?:으로)?\\s*${vomitPredicate}$`, 'u'
);
const explicitOnset = new RegExp(
  `^${onsetDate.source}(?:에\\s*|\\s+)(?:증상(?:이|은)?\\s*)?시작(?:됐|되었|했)${ending}$`, 'u'
);
const symptomAssertion = new RegExp(
  `^(?:${vomitPredicate}|상태가\\s*달라(?:요|졌${ending})|메스꺼워(?:요|\\s*보(?:여요|이고|입니다))|(?:증상(?:이|은)?\\s*(?:시작됐|생겼)|구토(?:를)?\\s*시작(?:했|됐|되었)|설사(?:를\\s*)?했|기침(?:을\\s*)?했|숨(?:쉬기\\s*)?\\s*힘들|절뚝거렸|경련(?:을\\s*)?했|가려웠|식욕(?:이\\s*)?줄었|기운이\\s*없)${ending})$`, 'u'
);
const detachedQualifier = /^(?:(?:그건|그게|그\s*말은)\s+)?(?:아직\s+)?(?:(?:정확히(?:는)?|잘)\s+)*(?:모르|몰라|모름|미확인|확실(?:하지|치|한\s*건\s*아니)|불확실|정확하지|기억(?:이|은|는)?\s*(?:안|나지\s*않)|확인\s*중|착오|잘못)/u;
const standaloneGuess = /^(?:아마(?:요|\s+(?:그랬을|그럴)\s*거\s*(?:예요|같아요))?|(?:그렇게\s*)?(?:짐작|추측|추정)(?:해요|합니다|했어요))[.!?。！？,，;]?$/u;
const correction = /^(?:아니|정정(?:하면|하자면))(?:[,，]?\s+|[,，]$)/u;
const detachedModifier = /^(?:아마|어쩌면|대충|대략|얼추|약)\s*[,，]$/u;
// Keep the connective in the first clause so its evidence stays verbatim.
const independentClause = /(?<=[가-힣](?:지만|는데|으며)|(?:았|었|했|이|하|없|있|먹|않)고)\s+(?=(?:식사량|먹는\s*양|식욕|밥|사료|식사|구토|설사|기침)[이가은는을를도]?\s|(?:오늘|어제|그제|엊그제)\s*(?:부터|\s))/u;
const scopedQualifier = /^(?<topic>시작\s*시점|시점|구토\s*횟수|횟수|식사\s*(?:량|변화)|먹는\s*양|식욕(?:\s*변화)?)(?:은|는|이|가)\s+(?<qualifier>.+)$/u;
const estimateQualifier = /^(?:(?:(?:제|저의|내)\s+)?(?:짐작|추측|추정|추정치|추정값|(?:짐작|추측|추정)한\s*것)\s*(?:예요|이에요|입니다|이다|였어요|였습니다)|(?:짐작|추측|추정)한\s*거\s*(?:예요|였어요|였습니다))[.!?。！？,，;]?$/u;

function assertedUtterance(part, preceding, following) {
  if (/[?？]$/u.test(part) || detachedModifier.test(preceding)) return '';
  const refersBack = /^(?:그건|그게|그\s*말은)\s/u.test(following);
  if (standaloneGuess.test(following) || estimateQualifier.test(following) || correction.test(following) || ((/[,，]$/u.test(part) || refersBack) && detachedQualifier.test(following))) return '';
  return part.replace(correction, '').replace(/^실제로\s+/u, '').replace(/[.!。！,，;]+$/u, '').trimEnd();
}

export function extractCandidates(complaint = '') {
  return extractFields(complaint);
}
function extractFields(complaint,countPatterns = null) {
  const matches = { onset: [], vomitCount: [], mealChange: [] };
  const parts = complaint.trim()
    .split(/(?<=[.!?。！？,，;])(?![0-9])|\n/u)
    .flatMap(part => part.trim().split(independentClause));
  for (const [index, part] of parts.entries()) {
    const scope = scopedQualifier.exec(part)?.groups;
    if (scope && (detachedQualifier.test(scope.qualifier) ||
      standaloneGuess.test(scope.qualifier) || estimateQualifier.test(scope.qualifier))) {
      const field = scope.topic.endsWith('시점') ? 'onset'
        : scope.topic.endsWith('횟수') ? 'vomitCount' : 'mealChange';
      matches[field].length = 0;
      continue;
    }
    const clause = assertedUtterance(part, parts[index - 1] ?? '', parts[index + 1] ?? '');
    if (!clause) continue;

    for (const match of clause.matchAll(onsetTime)) {
      if (match.index !== 0) continue;
      const following = clause.slice(match[0].length).trimStart();
      if (symptomAssertion.test(following) || countAssertion.test(following) || mealAssertion.test(following)) {
        matches.onset.push({ value: match.groups.value, evidence: match[0] });
      }
    }
    const explicitStart = explicitOnset.exec(clause);
    if (explicitStart) matches.onset.push({ value: explicitStart.groups.value, evidence: explicitStart[0] });
    if (firstVomitAssertion.test(clause)) {
      for (const match of clause.matchAll(firstVomit)) {
        matches.onset.push({ value: match.groups.value, evidence: match[0] });
      }
    }

    if (countPatterns ? !ambiguousSymptomCount(clause) : countAssertion.test(clause)) {
      for (const pattern of countPatterns ?? vomitCount) {
        for (const match of clause.matchAll(pattern)) {
          const word = match.groups.value;
          const value = koreanCounts.includes(word) ? koreanCounts.indexOf(word) + 1 : Number(word);
          if (Number.isSafeInteger(value)) matches.vomitCount.push({ value, evidence: match[0] });
        }
      }
    }

    if (mealAssertion.test(clause)) {
      for (const match of clause.matchAll(mealChange)) {
        matches.mealChange.push({ value: match[0], evidence: match[0] });
      }
    }
  }

  return Object.fromEntries(Object.entries(matches).map(([field, candidates]) => [
    field,
    candidates.length === 1 ? candidates[0] : { value: null, evidence: null }
  ]));
}

const onsetAlternativePrefix = new RegExp(
  `${onsetDate.source}\\s*(?:부터\\s*)?(?:이나|나|또는|혹은|아니면|부터|에서|[/~～–-])\\s*$`, 'u'
);
const negatedVomit = /구토\s*(?:하지\s*않|안|없|말고)|토하지\s*않|안\s*토/u;
const alternativeCount = new RegExp(`(?:${countWord})(?:\\s*(?:번|회))?\\s*(?:또는|혹은|아니면|내지|이나|나|[/~～–-])\\s*(?:${countWord})\\s*(?:번|회)`, 'u');
const boundedCount = new RegExp(
  `(?:최소(?:한)?|최대|적어도|많아야)\\s*(?:${countWord})\\s*(?:번|회)`, 'u'
);
const uncertain = /모르|몰라|모름|미확인|아마|어쩌면|추정|추측|기억.{0,8}(?:안|않)|(?:것|거)\s*같|것으로\s*보[여이였]|듯|쯤|정도|가량|확실하지|(?:을|ㄹ)\s*수\s*(?:도|있)|(?:다고|라고)\s*생각|는지\s*확인\s*중|모양(?:이|인)|(?:^|\s)약\s*[0-9]|[?？]/u;
const uncertaintyAfterComma = /^(?:(?:정확히(?:는)?|잘)\s*)*(?:모르|몰라|모름|미확인|확실하지|기억(?:이|은|는)?\s*(?:안|나지\s*않)|확인\s*중)/u;

const compactCountRange = /(?:한두|두세|두서너|서너|네다섯|대여섯|몇)\s*(?:번|회)/u;
const standaloneCountAnswer = /^(?:\d+|없(?:어요|습니다|음)|아니요)[.!]?$/u;
const countMentions = new RegExp(`(?<![가-힣0-9.,+-])${count}`, 'gu');

function ambiguousSymptomCount(clause) {
  return negatedVomit.test(clause) || alternativeCount.test(clause) || boundedCount.test(clause) ||
    /(?:번|회)\s*(?:안\s*했|아니|미만|이상|이하|초과)/u.test(clause) || compactCountRange.test(clause);
}

export const QUESTION_VERSION = 1;
const symptomTypes = [
  ['vomit','구토','digestive',/구토|토했|토해|토하|토한/u],
  ['diarrhea','설사','digestive',/설사/u],
  ['digestive','메스꺼움','digestive',/메스꺼|메스껍/u],
  ['cough','기침','respiratory',/기침/u],
  ['breath','호흡 변화','respiratory',/호흡|숨쉬|숨이/u],
  ['urine','배뇨 변화','urinary',/소변|오줌|배뇨/u],
  ['limb','보행 변화','mobility',/절뚝|다리|걷기/u],
  ['skin','피부·귀 증상','skin',/가려|피부|긁/u],
  ['neuro','행동·신경 증상','neuro',/경련|발작|떨림/u],
  ['eye','눈 증상','eye',/충혈|눈물/u],
  ['oral','입·치아 증상','oral',/치아|잇몸|씹기/u],
];
export const SELECTABLE_SYMPTOMS = symptomTypes.filter(([id, , category]) =>
  (category === 'digestive' && id !== 'digestive') || category === 'respiratory').map(([id,label,category]) => ({id,label,category}));

export function suggestedCategory(complaint) {
  return symptomTypes.find(([, , ,pattern]) => pattern.test(complaint))?.[2] ?? 'general';
}
const counted = new Set(['vomit','diarrhea','cough','neuro']);
const commonSlots = [
  ['meal','밥은 평소와 비교해 얼마나 먹었나요?'],
  ['water','물은 평소와 비교해 얼마나 마셨나요?', /(?:물|음수량)(?:을|은|이|는)?\s*(?:평소보다\s*(?:덜|더|적게|많이)\s*마[가-힣]*|평소와\s*(?:같|비슷)[가-힣]*)/u],
  ['activity','활력은 평소와 비교해 어땠나요?', /(?:평소보다\s*)?(?:기운|활력)이\s*(?:조금\s*)?(?:없|줄)[가-힣]*/u],
  ['stool','배변 상태는 평소와 비교해 어땠나요?', /배변(?:은|이)?\s*평소와\s*(?:같|비슷)[가-힣]*/u],
  ['meds','현재 먹는 약이나 영양제가 있나요?', /(?:현재\s*)?(?:먹는|복용\s*중인)\s*(?:약|영양제)[^.!?,\n]{0,25}없[가-힣]*/u],
  ['history','이전에 진단받은 질환이 있나요?', /(?:기존\s*질환|병력)(?:은|이|는)?\s*없[가-힣]*/u],
  ['followup','지난 진료 이후 상태는 어떻게 달라졌나요?', /지난\s*진료\s*(?:뒤|이후)\s*[^.!?,\n]{0,25}괜찮았[가-힣]*/u],
];
const detailSlots = {
  urine: [['amount','소변 양은 평소와 비교해 어땠나요?', /(?:소변|오줌)\s*양(?:이|은)?\s*(?:줄었|늘었|같았)[가-힣]*/u], ['frequency','소변을 얼마나 자주 봤나요?']],
  limb: [['location','어느 부위가 불편해 보이나요?'], ['walking','걸을 수 있나요?', /(?:걸을\s*때\s*)?절뚝[가-힣]*/u]],
  skin: [['location','어느 부위가 가렵거나 불편해 보이나요?']],
  eye: [['location','어느 눈이 불편해 보이나요?']],
  oral: [['location','입의 어느 부위가 불편해 보이나요?']],
};
const unknownAnswer = /모르|몰라|모름|미확인|기억.{0,8}(?:안|않)/u;
const currentNegative = {
  vomit: /구토(?:는|를)?\s*(?:안|없|하지\s*않)|안\s*토|토하지\s*않/u,
  diarrhea: /설사(?:는|를)?\s*(?:안\s*했|없|하지\s*않)/u,
  cough: /기침(?:은|을)?\s*(?:안\s*했|없|하지\s*않)/u,
  breath: /(?:호흡\s*곤란|숨쉬기\s*힘들어하는\s*모습)(?:은|이|는)?\s*없/u,
};
const mentionedDates = new RegExp(onsetDate.source,'gu');
const datedSymptomConjunction = new RegExp(
  '(?<=번|회)(?:과|와)\\s+(?=' + onsetDate.source.replace('?<value>','?:') + '(?:은|는|에|부터)?\\s+(?:' +
    symptomTypes.map(([, , ,pattern]) => pattern.source).join('|') + '))', 'u'
);
const datedCount = new RegExp('^(?:은|는|에)?\\s*' + count + '\\s*(?:했[가-힣]*)?[.!。]?$', 'u');
const unknownDatedCount = /^(?:은|는|에)?\s*(?:정확히\s*)?(?:몇\s*(?:번|회)|횟수)(?:\s*(?:인지는?|는|를))?\s*(?:잘\s*)?(?:모르|몰라|모름|미확인)/u;
const courseChange = /(?:좋아졌|나아졌|심해졌|악화됐|악화되었|멈췄)[가-힣]*|(?:이후|지금은|점점)\s*(?:좋아|나아|심해|줄어|늘어|그대로|멈췄)[가-힣]*/u;
const occurrenceBeforeCourse = {
  vomit: /(?:구)?토(?:했|하고|해(?:서|요)|함)/u,
  diarrhea: /설사(?:를|는|도)?\s*(?:했|하고|해(?:서|요)|함)/u,
  cough: /기침(?:을|은|도)?\s*(?:했|하고|해(?:서|요)|함)/u,
  neuro: /(?:경련|발작|떨림)(?:이|은|도)?\s*(?:있었|했고|했는데|했어요)/u,
};
const dateKey = date => Array.from(date.replace(/\s/gu,''), char => char.codePointAt(0).toString(36)).join('_');
const candidateOf = (value,evidence) => ({value,evidence});

// Recompute proposals from the source. Only guardian answers resolve a slot.
export function questionState(input) {
  const { complaint = '', category, categories = [category], visitType, answers = {} } = input;
  const slots = new Map();
  const observed = new Map();
  function add(id,label,required,candidate = null) {
    const slot = slots.get(id);
    if (!slot) slots.set(id,{id,label,required,candidate});
    else if (candidate && !slot.conflict) {
      if (!slot.candidate) slot.candidate = candidate;
      else if (slot.candidate.value !== candidate.value) {
        slot.candidate = null;
        slot.conflict = true;
      }
    }
  }
  const selected = symptomTypes.filter(([id]) => input.symptomSelections?.includes(id));
  const sourceClauses = complaint.split(/(?<=[.!?。！？,，;\n])(?![0-9])|(?<=[가-힣])고\s+(?=(?:방금|오늘|어제|그제|엊그제|(?:\d{4}년\s*)?\d{1,2}월\s*\d{1,2}일|설사|구토|기침|호흡|숨쉬|숨이|소변|절뚝|밥|사료|물|활력|기운|이후|지금은|점점))|(?<=[가-힣](?:는데|지만|으며))\s+(?=(?:(?:방금|오늘|어제|그제|엊그제)\S*\s+)?(?:토했|토해|구토|설사|기침|호흡|숨쉬|숨이|소변|절뚝|경련))|(?<=번|회)(?:과|와)\s+(?=구토|설사|기침)/u);
  const clauses = sourceClauses.flatMap(raw => raw.split(datedSymptomConjunction)).flatMap(raw => {
    const named = symptomTypes.filter(([, , ,pattern]) => pattern.test(raw));
    if (named.length !== 1 || !counted.has(named[0][0]) ||
      currentNegative[named[0][0]]?.test(raw) || /총/u.test(raw)) return [{raw}];
    const dates = [...raw.matchAll(mentionedDates)];
    if (dates.length < 2 || dates[0].index !== raw.search(/\S/u)) return [{raw}];
    const fragments = dates.slice(0,-1).map((date,index) => ({
      raw: raw.slice(date.index,dates[index+1].index).trimEnd(), symptom: named[0], dateLength:date[0].length,
    }));
    if (fragments.some(({raw,dateLength}) => !datedCount.test(raw.slice(dateLength)))) return [{raw}];
    return [...fragments,{raw:raw.slice(dates.at(-1).index)}];
  });
  // A comma-separated date/count fragment can borrow the symptom from the
  // next dated clause when that clause names a single counted symptom.
  let nextDatedSymptom;
  for (let index = clauses.length - 1; index >= 0; index--) {
    const fragment = clauses[index];
    const clause = fragment.raw.trim();
    const date = clause.match(onsetDate);
    const named = symptomTypes.filter(([, , ,pattern]) => pattern.test(clause));
    const afterDate = date?.index === 0 ? clause.slice(date[0].length) : '';
    if (nextDatedSymptom && !named.length && /[,，]$/u.test(clause) &&
      (datedCount.test(afterDate.slice(0,-1)) || unknownDatedCount.test(afterDate) || ambiguousSymptomCount(afterDate))) {
      fragment.symptom = nextDatedSymptom;
      continue;
    }
    nextDatedSymptom = fragment.symptom ?? (afterDate && named.length === 1 &&
      counted.has(named[0][0]) && !currentNegative[named[0][0]]?.test(clause) && !/총|부터/u.test(afterDate) &&
      (afterDate.search(countMentions) !== -1 || unknownDatedCount.test(afterDate)) ? named[0] : undefined);
  }
  const clear = clauses.map(({raw:clause},index) => !uncertain.test(clause) &&
    !(/[,，]$/u.test(clause) && uncertaintyAfterComma.test(clauses[index+1]?.raw.trimStart() ?? '')));
  let prior = [];
  for (const [index,{raw,symptom:inherited}] of clauses.entries()) {
    const clause = raw.trim();
    const named = symptomTypes.filter(([, , ,pattern]) => pattern.test(clause));
    const dateMatch = clause.match(onsetDate);
    const date = dateMatch?.groups.value;
    const shared = /둘\s*다|두\s*증상/u.test(clause);
    const afterDate = date ? clause.slice(dateMatch.index + date.length) : '';
    const dateCount = afterDate.replace(/[,，]$/u,'').match(datedCount);
    const unknownCount = dateMatch?.index === 0 && unknownDatedCount.test(afterDate);
    const course = clause.match(courseChange);
    let scoped = named;
    if (shared) {
      const group = [...new Set([...observed.values()].map(entry => entry.symptom).concat(named,selected))];
      scoped = group.length === 2 ? group : [];
    } else if (!named.length && (inherited || dateCount || (unknownCount && counted.has(prior[0]?.[0])) || (course && (dateMatch?.index === 0 || /이후|지금은|점점|부터/u.test(clause))))) {
      scoped = inherited ? [inherited] : prior.length === 1 ? prior : [];
    }
    if (named.length) prior = named.filter(([id]) => !currentNegative[id]?.test(clause));
    else if (!shared && !scoped.length && clause) prior = [];
    if (/지난달|작년|예전에|과거에/u.test(clause) && !/부터/u.test(clause)) {
      prior = [];
      continue;
    }
    for (const symptom of scoped) {
      const [id,name,,pattern] = symptom;
      if (currentNegative[id]?.test(clause)) continue;
      const entry = observed.get(id) ?? {symptom,dated:false};
      observed.set(id,entry);
      if (scoped.length > 1 && !shared) continue;
      const span = pattern.source;
      const patterns = id === 'vomit' ? vomitCount : [
        new RegExp('(?<![가-힣0-9.,+-])' + count + '\\s*(?:' + span + ')','gu'),
        new RegExp('(?:' + span + ')(?:를|는|가)?\\s*(?:(?:총|모두)\\s*)?(?:' + onsetDate.source.replace('?<value>','?:') + '(?:은|는|에)?\\s*)?' + count,'gu'),
      ];
      const fields = extractFields(clause,patterns);
      const validDate = date && !onsetAlternativePrefix.test(clause.slice(0,dateMatch.index)) &&
        !onsetDate.test(afterDate);
      const onset = validDate && !course && (fields.onset.value === date || /^\s*부터/u.test(afterDate) || /처음/u.test(clause));
      if (onset && clear[index]) add(id+'-onset',onsetLabel(id,name),true,candidateOf(date,clause));
      const period = validDate && !onset && !/총/u.test(clause) ? date : '';
      // A date can identify a required slot even when the reported value is uncertain.
      // A change alone dates the course. An explicit episode also dates the observation.
      const episode = course && occurrenceBeforeCourse[id]?.test(clause.slice(0,course.index));
      const observedPeriod = !course || episode ? period : '';
      if (observedPeriod && clear[index]) add(id+'-seen-'+dateKey(observedPeriod),
        name+' 관찰 시점 · '+observedPeriod,false,candidateOf(observedPeriod,clause));
      if (counted.has(id)) {
        const frequency = !named.length && dateCount && !shared
          ? extractFields(dateCount.groups.value+' 번 토했어요.').vomitCount : fields.vomitCount;
        const countPeriod = frequency.value !== null ? period : observedPeriod;
        if (countPeriod) entry.dated = true;
        if (countPeriod || clear[index] && frequency.value !== null && (!date || validDate)) {
          add(countId(id,countPeriod),countLabel(id,name,countPeriod),true,
            clear[index] && frequency.value !== null ? candidateOf(frequency.value+'회',clause) : null);
        }
      }
      if (course && clear[index]) add(id+'-course'+(period ? '-'+dateKey(period) : ''),
        (period ? period+' ' : '')+name+' 경과는 어떻게 달라졌나요?',visitType==='return',candidateOf(course[0],clause));
    }
  }

  for (const symptom of selected) {
    const [id] = symptom;
    if (!observed.has(id)) observed.set(id,{symptom,dated:false});
  }
  for (const categoryId of categories) {
    if ([...observed.values()].some(({symptom}) => symptom[2] === categoryId)) continue;
    const defaultId = {urinary:'urine',mobility:'limb'}[categoryId] ??
      (categoryId === 'digestive' && !/메스꺼/u.test(complaint) && !negatedVomit.test(complaint) ? 'vomit' : categoryId);
    const symptom = symptomTypes.find(([id]) => id === defaultId) ??
      [categoryId,CATEGORIES.find(item => item.id === categoryId)?.label,categoryId];
    observed.set(symptom[0],{symptom,dated:false});
  }
  const sourceCandidate = pattern => {
    const matches = clauses.flatMap(({raw:clause},index) => {
      const match = clear[index] && pattern && clause.match(pattern);
      return match ? [candidateOf(match[0],clause.trim())] : [];
    });
    return matches.length === 1 ? matches[0] : null;
  };
  for (const {symptom:[id,name],dated} of observed.values()) {
    add(id+'-onset',onsetLabel(id,name),true);
    if (counted.has(id) && !dated) add(countId(id),countLabel(id,name),true);
    if (![...slots.keys()].some(key => key.startsWith(id+'-course'))) {
      add(id+'-course',name+' 경과는 어떻게 달라졌나요?',visitType==='return');
    }
    if (id === 'vomit' || id === 'diarrhea') {
      add(id+'-appearance',name+'의 내용물은 어땠나요?',false);
      add(id+'-blood',name+'에 피가 보였나요?',false);
    }
    for (const [field,label,pattern] of detailSlots[id] ?? []) add(id+'-'+field,label,true,sourceCandidate(pattern));
  }
  const meal = extractCandidates(complaint).mealChange;
  for (const [id,label,pattern] of commonSlots) {
    if (id === 'followup' && visitType !== 'return') continue;
    const required = id === 'meal' || visitType === 'return' && ['meds','history','followup'].includes(id);
    add(id,label,required,id === 'meal' ? meal.value === null ? null : meal : sourceCandidate(pattern));
  }
  return Array.from(slots.values(),slot => {
    const answer = answers[slot.id]?.trim() || '';
    const status = !answer ? 'pending' : unknownAnswer.test(answer) ? 'unknown'
      : (input.corrections?.includes(slot.id) || slot.candidate && slot.candidate.value !== answer) ? 'corrected' : 'confirmed';
    return {...slot,answer,status};
  });
}
function onsetLabel(id,name) {
  return id === 'vomit' ? '처음 토한 때가 언제였나요?' : name+'의 첫 증상은 언제였나요?';
}
function countId(id,period = '') {
  return id+'-count'+(period ? '-'+dateKey(period) : '');
}
function countLabel(id,name,period = '') {
  return (period || '이번에')+(id === 'vomit' ? ' 몇 번 토했나요?' : ' '+name+(id === 'diarrhea' ? '가' : '이')+' 몇 번 있었나요?');
}

export function clarification(slot) {
  if (slot.id.includes('-count')) return '관찰한 횟수를 적어 주세요. 정확히 모르면 “모르겠어요”로 답해 주세요.';
  if (slot.id === 'water') return '평소만큼 마셨나요? 더 마셨거나 덜 마셨다면 얼마나 마셨는지 알려 주세요.';
  if (slot.id === 'meal') return '평소만큼 먹었나요? 더 먹거나 덜 먹었다면 얼마나 먹었는지 알려 주세요.';
  if (slot.id.endsWith('-onset')) return '처음 관찰한 날짜나 시간대를 적어 주세요.';
  return '어떤 변화가 있었는지 아는 만큼 구체적으로 적어 주세요.';
}
const comparisonSlots = new Set(['meal','water','activity','stool','urine-amount']);
const vagueComparison = /^(?:(?:식사량|먹는\s*양|밥|양|물|음수량|활력|기운|배변(?:\s*상태)?|소변\s*양)(?:은|는|이|가|을|를)?\s*)?(?:평소(?:랑|와|하고|보다)?\s*)?(?:(?:조금|좀|약간|많이)\s*)?(?:달라|달랐|달라졌|다릅|다른(?:데|\s*편)|다르|변했|바뀌었|변화가?\s*있)[가-힣]*[.! ]*$/u;
const onsetAnswerTime = /(?:그저께|엊저녁|(?:지난|이번)\s*주말|[월화수목금토일]요일|\d{1,2}\s*월|\d{1,2}\s*일|\d{1,2}\s*시|\d{1,2}[/-]\d{1,2}|\d{1,2}:\d{2}|자정|정오|방금|진료\s*직후)/u;

export function resolveQuestionAnswer(value, clarified = false, unknown = false, slot) {
  if (unknown || unknownAnswer.test(value)) return {answer:'모르겠어요',clarify:false};
  if (/아마|어쩌면|추정|추측|것\s*같|거\s*같|확실하지|[?？]/u.test(value) || compactCountRange.test(value) || alternativeCount.test(value) ||
    (slot?.id.includes('-count') && (uncertain.test(value) || ambiguousSymptomCount(value) || (!standaloneCountAnswer.test(value.trim()) && [...value.matchAll(countMentions)].length !== 1))) ||
    (comparisonSlots.has(slot?.id) && vagueComparison.test(value.trim())) ||
    (slot?.id.endsWith('-onset') && !onsetDate.test(value) && !onsetAnswerTime.test(value)) ||
    /^(?:그냥|글쎄요?|네|아니요|좀|조금)[.! ]*$/u.test(value.trim())) {
    return clarified ? {answer:'모르겠어요',clarify:false} : {answer:'',clarify:true};
  }
  return {answer:value.trim(),clarify:false};
}

export function intakeQuestions(input) {
  if (input.questionVersion === QUESTION_VERSION) return questionState(input);
  return questions(input.category,input.complaint,input.visitType,input.answers)
    .map(slot => ({...slot,answer:input.answers[slot.id]?.trim() || '',status:''}));
}
export function displayAnswer(slot) {
  if (!slot.answer || slot.status === 'unknown') return '미확인'+(slot.answer ? ' ('+slot.answer+')' : '');
  return slot.answer+(slot.status === 'corrected' ? ' (보호자 정정)' : '');
}

export function assess(complaint='', answers={}, risks={}) {
  const text=[complaint,...Object.values(answers)].join('\n');
  // Conservative lexical flags are candidates, never automated triage or a negative clearance.
  return RISKS.flatMap(r => risks[r.id]==='yes' ? [{id:r.id,label:r.label,source:'보호자 직접 선택',level:'contact'}] : risks[r.id]==='unsure' ? [{id:r.id,label:r.label,source:'보호자 확인 필요',level:'uncertain'}] : r.pattern.test(text) ? [{id:r.id,label:r.label,source:'원문 키워드 후보 · 부정·과거 표현 포함 가능',level:'candidate'}] : []);
}
export function draft(input) {
  const pet=PETS.find(p=>p.id===input.petId);
  const qs=intakeQuestions(input);
  const answer=id=>input.answers[id]?.trim() || '미확인';
  const flags=assess(input.complaint,input.answers,input.risks);
  const missing=qs.filter(x=>!x.answer || x.status==='unknown' || (!x.status && /^(모름|모르겠|미확인|잘 모르)/.test(x.answer))).map(x=>x.label);
  const lines=qs.map(x=>`${x.label} ${displayAnswer(x)}`);
  const timeline = input.questionVersion === QUESTION_VERSION
    ? qs.filter(slot=>/-(?:onset|course|count|seen)(?:-|$)/.test(slot.id)).map(slot=>({label:slot.label,text:displayAnswer(slot)}))
    : [{label:'시작',text:answer('onset')},{label:'경과',text:answer('course')}];
  const hpi=`[보호자 보고 · 수의사 검토 전 초안]\n${pet.name} / ${pet.species} / ${input.visitType==='return'?'재진':'초진'}\n주호소: ${input.complaint}\n${lines.join('\n')}\n위험 징후: ${flags.length?flags.map(x=>`${x.label} (${x.source})`).join('; '):'체크리스트상 모두 아니요. 응급 상태 배제를 의미하지 않음.'}\n누락·불확실: ${missing.join('; ') || '추가 문진으로 재확인 필요'}`;
  return {engine:ENGINE_VERSION,hpi,soapS:`S (Subjective, 보호자 진술만)\n${hpi}\nO/A/P: 본 도구에서 생성하지 않음.`,problems:[input.complaint],timeline,meds:answer('meds'),history:answer('history'),missing,flags};
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
  if(v.questionVersion !== undefined && v.questionVersion !== QUESTION_VERSION) return '질문 버전을 확인해 주세요.';
  if(v.questionVersion === QUESTION_VERSION && (!Array.isArray(v.categories) ||
    !v.categories.includes(v.category) || v.categories.length > CATEGORIES.length ||
    new Set(v.categories).size !== v.categories.length || v.categories.some(id=>!CATEGORIES.some(c=>c.id===id))))
    return '선택한 증상을 확인해 주세요.';
  if(v.questionVersion === QUESTION_VERSION && v.symptomSelections !== undefined &&
    (!Array.isArray(v.symptomSelections) || v.symptomSelections.length > SELECTABLE_SYMPTOMS.length ||
      new Set(v.symptomSelections).size !== v.symptomSelections.length ||
      v.symptomSelections.some(id=>!SELECTABLE_SYMPTOMS.some(item=>item.id===id && v.categories.includes(item.category)))))
    return '선택한 하위 증상을 확인해 주세요.';
  if(Object.values(v.answers).some(a=>typeof a!=='string'||a.length>1200)) return '답변 형식이나 길이를 확인해 주세요.';
  if(v.questionVersion === QUESTION_VERSION && v.corrections !== undefined &&
    (!Array.isArray(v.corrections) || v.corrections.length > Object.keys(v.answers).length ||
      v.corrections.some(id=>typeof id!=='string' || !Object.hasOwn(v.answers,id) || !v.answers[id].trim())))
    return '정정한 답변을 확인해 주세요.';
  const qs=intakeQuestions(v);
  const allowed=new Set(qs.map(q=>q.id));
  if(Object.keys(v.answers).some(k=>!allowed.has(k))) return '답변 형식이나 길이를 확인해 주세요.';
  if(qs.some(q=>(v.questionVersion === undefined || q.required) && !q.answer)) return '모든 후속 질문에 답해 주세요. 모르면 “모름”으로 입력할 수 있습니다.';
  if(v.questionVersion === QUESTION_VERSION && qs.some(q => q.answer && q.id.includes('-count') &&
    resolveQuestionAnswer(q.answer,false,false,q).clarify)) return '횟수 후속 질문에는 정확한 횟수나 모름으로 답해 주세요.';
  if(v.questionVersion === QUESTION_VERSION && qs.some(q => q.answer && q.id.endsWith('-onset') &&
    resolveQuestionAnswer(q.answer,false,false,q).clarify)) return '시작 시점 후속 질문에는 날짜나 시간대 또는 모름으로 답해 주세요.';
  if(v.questionVersion === QUESTION_VERSION && qs.some(q => q.id === 'meal' && q.answer &&
    resolveQuestionAnswer(q.answer,false,false,q).clarify)) return '식사량 후속 질문에는 평소와 비교한 양이나 모름으로 답해 주세요.';
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
