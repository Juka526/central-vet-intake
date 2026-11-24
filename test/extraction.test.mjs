import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCandidates } from '../lib/engine.mjs';
import { leoCases } from './leo-cases.mjs';

const unknown = { value: null, evidence: null };
const grounded = (value, evidence) => ({ value, evidence });

test('가상 레오 원문에서 답변 후보와 정확한 근거 구절을 반환한다', () => {
  const expected = [
    [grounded('어제 저녁', '어제 저녁부터'), unknown, grounded('밥을 절반만 먹어요', '밥을 절반만 먹어요')],
    [grounded('오늘 아침', '오늘 아침부터'), unknown, unknown],
    [unknown, unknown, unknown],
    [grounded('어제 저녁', '어제 저녁부터'), grounded(2, '두 번 토했어요'), unknown],
    [grounded('어제 저녁', '어제 저녁부터'), grounded(1, '한 번 토했어요'), grounded('사료는 평소의 절반만 먹었어요', '사료는 평소의 절반만 먹었어요')],
    [grounded('오늘 아침', '오늘 아침부터'), grounded(1, '한 번 토했어요'), unknown]
  ];
  for (const [index, scenario] of leoCases.entries()) {
    const [onset, vomitCount, mealChange] = expected[index];
    const candidates = extractCandidates(scenario.complaint);
    assert.deepEqual(candidates, { onset, vomitCount, mealChange }, scenario.id);
    for (const { evidence } of Object.values(candidates)) {
      if (evidence) assert.ok(scenario.complaint.includes(evidence), scenario.id);
    }
  }
});

test('원문 정정 후 현재 원문의 횟수를 연결한다', () => {
  const scenario = leoCases.find(({ id }) => id === 'correction');
  assert.equal(extractCandidates(scenario.original).vomitCount.value, 2);
  assert.equal(extractCandidates(scenario.complaint).vomitCount.value, 1);
});

test('불확실한 표현, 범위, 상충하는 횟수, 다른 증상 횟수는 미확인이다', () => {
  const complaints = [
    '어제부터였던 것 같아요. 구토는 2회 정도였어요. 밥을 반만 먹었는지 모르겠어요.',
    '설사 3회 했어요. 구토 1~2회 했어요.',
    '구토 2회. 구토 3회.',
    '두 번 기침했고 구토하지 않았어요.',
    '구토 두 번 이상 했어요.',
    '약 2회 구토했어요.',
    '오늘 아침부터 사료를 바꿨어요.'
  ];
  for (const complaint of complaints) {
    assert.deepEqual(extractCandidates(complaint), {
      onset: unknown, vomitCount: unknown, mealChange: unknown
    }, complaint);
  }
});

test('명시된 날짜, 숫자 횟수, 식욕 변화의 근거를 보존한다', () => {
  assert.deepEqual(extractCandidates('11월 23일부터 상태가 달라요. 구토 3회였어요. 식욕이 줄었어요.'), {
    onset: grounded('11월 23일', '11월 23일부터'),
    vomitCount: grounded(3, '구토 3회'),
    mealChange: grounded('식욕이 줄었어요', '식욕이 줄었어요')
  });
});

test('횟수가 구토 명사 앞에 오는 원문도 연결한다', () => {
  assert.deepEqual(extractCandidates('오늘 2회 구토. 설사 3회.').vomitCount, grounded(2, '2회 구토'));
});
