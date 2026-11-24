import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { QUESTION_VERSION, RISKS, draft, intakeQuestions, resolveQuestionAnswer, validateIntake } from '../lib/engine.mjs';
import { request as pages } from '../pages/demo.mjs';
import { createApplication } from '../server.mjs';
import { fixture } from './fixture.mjs';

const short = '어제 저녁부터 두 번 토했어요. 사료를 절반만 먹었어요.';
const dated = '어제 두 번 토했어요. 오늘 한 번 토했어요. 설사는 오늘 세 번 했어요. 둘 다 어제부터였어요. 사료를 절반만 먹었어요.';
const multiple = '어제부터 두 번 토했어요. 오늘 아침 기침하고 소변 양이 줄었고, 걸을 때 절뚝거려요. 사료를 절반만 먹었어요.';

function intake(complaint, overrides) {
  return {...fixture({petId:'demo-leo',complaint}), questionVersion:QUESTION_VERSION,
    categories:['digestive'], answers:{}, ...overrides};
}
function confirm(input) {
  for (const slot of intakeQuestions(input)) if (slot.candidate) input.answers[slot.id] = slot.candidate.value;
  return input;
}
function remaining(input) {
  return intakeQuestions(input).filter(slot => slot.required && !slot.answer);
}

test('짧은 레오 사례는 확인 후 0~2개 질문, 선택 질문은 제출을 막지 않음', () => {
  const input = intake(short);
  assert.match(validateIntake(input), /후속 질문/);
  confirm(input);
  assert.deepEqual(remaining(input), []);
  assert.equal(validateIntake(input), null);
  for (const id of ['water','activity','stool','meds','history']) {
    const slot = intakeQuestions(input).find(slot => slot.id === id);
    assert.equal(slot.answer, '', id);
    assert.equal(slot.candidate, null, id);
  }
  for (const id of ['vomit-onset','vomit-count','meal']) {
    const answers = {...input.answers};
    delete answers[id];
    assert.match(validateIntake({...input,answers}), /후속 질문/, id);
  }
  assert.deepEqual(remaining(confirm(intake('어제부터 토했어요.'))).map(slot => slot.label),
    ['이번에 몇 번 토했나요?','밥은 평소와 비교해 얼마나 먹었나요?']);
});

test('같은 분류의 증상과 날짜별 횟수 정정을 독립적으로 유지', () => {
  const input = confirm(intake(dated));
  const slots = intakeQuestions(input);
  const counts = slots.filter(slot => slot.id.includes('-count'));
  assert.deepEqual(counts.map(slot => [slot.label,slot.answer]), [
    ['어제 몇 번 토했나요?','2회'], ['오늘 몇 번 토했나요?','1회'], ['오늘 설사가 몇 번 있었나요?','3회'],
  ]);
  assert.equal(slots.find(slot => slot.id === 'vomit-onset').answer,'어제');
  assert.equal(slots.find(slot => slot.id === 'diarrhea-onset').answer,'어제');
  input.answers[counts[0].id] = '4회';
  input.answers.history = '모르겠어요';
  input.answers.meds = '없어요';
  assert.deepEqual(remaining(input), []);
  const result = draft(input);
  assert.match(result.hpi, /어제 몇 번 토했나요\? 4회 \(보호자 정정\)/);
  assert.match(result.hpi, /오늘 몇 번 토했나요\? 1회/);
  assert.match(result.hpi, /오늘 설사가 몇 번 있었나요\? 3회/);
  assert.match(result.hpi, /현재 먹는 약이나 영양제가 있나요\? 없어요/);
  assert.match(result.soapS, /이전에 진단받은 질환이 있나요\? 미확인 \(모르겠어요\)/);
  assert.equal(intakeQuestions(input).filter(slot => slot.id === 'meal').length,1);
  assert.equal(intakeQuestions(input).filter(slot => slot.id === 'meds').length,1);
  assert.equal(intakeQuestions(input).filter(slot => slot.id === 'history').length,1);
  const selected = intake(short,{symptomSelections:['vomit','diarrhea']});
  assert.ok(remaining(selected).some(slot => slot.id === 'diarrhea-onset'));
  assert.ok(remaining(selected).some(slot => slot.id === 'diarrhea-count'));
  assert.match(validateIntake({...selected,symptomSelections:['cough']}), /하위 증상/);
  const separate = confirm(intake('어제부터 구토했어요. 설사도 했어요.'));
  assert.equal(separate.answers['diarrhea-onset'],undefined);
});

test('한 문장 안의 날짜별 횟수와 증상별 횟수도 각각 유지', () => {
  const shorthand = confirm(intake('어제 두 번 오늘 한 번 토했어요.'));
  assert.deepEqual(intakeQuestions(shorthand).filter(slot => slot.answer && slot.id.includes('-count'))
    .map(slot => [slot.label,slot.answer]), [['어제 몇 번 토했나요?','2회'],['오늘 몇 번 토했나요?','1회']]);
  const combined = confirm(intake('구토 두 번과 설사 세 번 했어요.'));
  assert.equal(combined.answers['vomit-count'],'2회');
  assert.equal(combined.answers['diarrhea-count'],'3회');
  const ambiguous = confirm(intake('어제나 오늘 한 번 토했어요.'));
  assert.ok(remaining(ambiguous).some(slot => slot.id === 'vomit-count'));
});

test('과거와 부정 표현은 현재 횟수 후보가 되지 않으며 위험 원문은 유지', () => {
  const input = confirm(intake('지난달에 경련으로 두 번 쓰러졌어요. 오늘은 구토하지 않았고 숨쉬기 힘들어하는 모습은 없어요.'));
  const slots = intakeQuestions(input);
  assert.ok(slots.every(slot => !/^(neuro|breath|vomit)-/.test(slot.id)));
  assert.ok(draft(input).flags.some(flag => flag.id === 'collapse' && flag.level === 'candidate'));
  assert.ok(draft(input).flags.some(flag => flag.id === 'breathing' && flag.level === 'candidate'));
});

test('다른 분류를 누락하지 않고 답한 하위 항목만 제외', () => {
  const input = confirm(intake(multiple,{categories:['digestive','respiratory','urinary','mobility']}));
  assert.deepEqual(remaining(input).map(slot => slot.id).sort(), [
    'cough-onset','limb-location','limb-onset','urine-frequency','urine-onset',
    intakeQuestions(input).find(slot => slot.id.startsWith('cough-count-')).id,
  ].sort());
  assert.ok(input.answers['urine-amount']);
  assert.ok(input.answers['limb-walking']);
  for (const slot of remaining(input)) {
    const answers = {...input.answers};
    for (const other of remaining(input)) if (other.id !== slot.id) answers[other.id] = '모르겠어요';
    assert.match(validateIntake({...input,answers}), /후속 질문/, slot.id);
  }
  const selected = intake(short,{categories:['digestive','mobility','urinary']});
  assert.ok(remaining(selected).some(slot => slot.id === 'limb-location'));
  assert.ok(remaining(selected).some(slot => slot.id === 'urine-amount'));
});

test('불확실 답을 한 번 되묻고 명시적 모름과 없음은 구별', () => {
  assert.deepEqual(resolveQuestionAnswer('글쎄요'), {answer:'',clarify:true});
  assert.deepEqual(resolveQuestionAnswer('아마 어제',true), {answer:'모르겠어요',clarify:false});
  assert.deepEqual(resolveQuestionAnswer('모르겠어요'), {answer:'모르겠어요',clarify:false});
  assert.deepEqual(resolveQuestionAnswer('없어요'), {answer:'없어요',clarify:false});
  assert.deepEqual(resolveQuestionAnswer('평소의 절반 정도'), {answer:'평소의 절반 정도',clarify:false});
  const input = confirm(intake('아마 어제부터 두 번 토했어요. 밥을 먹었는지는 모르겠어요.'));
  assert.deepEqual(remaining(input).map(slot => slot.id), ['vomit-onset','vomit-count','meal']);
});

test('재진의 약·경과는 방문에서 한 번 확인하고 위험 8항목은 직접 응답', () => {
  const input = confirm(intake('지난 진료 뒤 이틀은 괜찮았는데 오늘 아침부터 한 번 토했어요. 현재 먹는 약이나 영양제는 없어요. 사료를 절반만 먹었어요.',{visitType:'return'}));
  assert.deepEqual(remaining(input).map(slot => slot.id), ['vomit-course','history']);
  for (const slot of remaining(input)) input.answers[slot.id] = '모르겠어요';
  for (const {id} of RISKS) {
    const risks = {...input.risks};
    delete risks[id];
    assert.match(validateIntake({...input,risks}), /위험 징후/);
  }
  assert.equal(validateIntake(input),null);
});

test('Pages 접수·조회에서 기존/새 형식과 보호자 정정을 보존', () => {
  const input = confirm(intake(dated));
  input.answers['vomit-onset'] = '그제';
  const incomplete = {...input,risks:{}};
  assert.throws(() => pages('/api/intakes',{method:'POST',body:incomplete}), /위험 징후/);
  const old = pages('/api/intakes',{method:'POST',body:fixture()});
  const receipt = pages('/api/intakes',{method:'POST',body:input});
  pages('/api/login',{method:'POST',body:{role:'vet'}});
  try {
    const record = pages('/api/intakes/'+receipt.id);
    assert.equal(record.questionVersion,QUESTION_VERSION);
    assert.match(record.draft.hpi,/그제 \(보호자 정정\)/);
    assert.match(pages('/api/intakes/'+old.id).draft.hpi,/언제부터 시작됐나요/);
  } finally {
    pages('/api/logout');
  }
});

test('로컬 서버 HTTP 처리기에서 위험 응답 검증 후 질문 상태로 초안 작성', async () => {
  const app = createApplication({vetCode:'fictional-test-code'});
  const handle = app.server.listeners('request')[0];
  let cookie, csrf;
  async function call(url,method='GET',body) {
    const headers = {host:'localhost','content-type':'application/json',cookie,'x-csrf-token':csrf};
    const req = Object.assign(Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []),
      {url,method,headers,socket:{remoteAddress:'127.0.0.1'}});
    let status, data;
    await handle(req,{
      setHeader(name,value) { if (name === 'Set-Cookie') cookie = value.split(';')[0]; },
      writeHead(code) { status=code; },
      end(raw) { data=JSON.parse(raw); },
    });
    if (data.csrf) csrf=data.csrf;
    return {status,data};
  }
  try {
    await call('/api/session');
    const input = confirm(intake(short));
    input.answers['vomit-count'] = '1회';
    assert.equal((await call('/api/intakes','POST',{...input,risks:{}})).status,400);
    const receipt = await call('/api/intakes','POST',input);
    assert.equal(receipt.status,201);
    assert.equal((await call('/api/login','POST',{role:'vet',code:'fictional-test-code'})).status,200);
    const record = await call('/api/intakes/'+receipt.data.id);
    assert.equal(record.status,200);
    assert.equal(record.data.answers['vomit-count'],'1회');
    assert.match(record.data.draft.soapS,/1회 \(보호자 정정\)/);
  } finally {
    app.close();
  }
});
