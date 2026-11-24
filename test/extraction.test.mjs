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

test('문진 안내 예시의 식사량 감소와 원문 근거를 반환한다', () => {
  assert.deepEqual(extractCandidates('어제 저녁부터 두 번 토했어요. 밥도 평소보다 적게 먹고요.'), {
    onset: grounded('어제 저녁', '어제 저녁부터'),
    vomitCount: grounded(2, '두 번 토했어요'),
    mealChange: grounded('밥도 평소보다 적게 먹고요', '밥도 평소보다 적게 먹고요')
  });
});

test('산책 변화 시점 대신 명시된 첫 구토 시점을 연결한다', () => {
  assert.deepEqual(extractCandidates('어제부터 산책을 줄였어요. 오늘 처음 토했어요.'), {
    onset: grounded('오늘', '오늘 처음 토했어요'),
    vomitCount: unknown,
    mealChange: unknown
  });
  assert.deepEqual(extractCandidates('어제부터 산책을 줄였어요.').onset, unknown);
  assert.deepEqual(extractCandidates('오늘 토했어요.').onset, unknown);
});

test('대안으로 제시한 횟수와 추측한 식사 변화는 미확인이다', () => {
  assert.deepEqual(extractCandidates('구토는 2회 또는 3회였어요. 밥을 반만 먹었다고 추측해요.'), {
    onset: unknown, vomitCount: unknown, mealChange: unknown
  });
  assert.deepEqual(extractCandidates('두 번 혹은 세 번 토했어요.').vomitCount, unknown);
  assert.deepEqual(extractCandidates('2 또는 3회 토했어요.').vomitCount, unknown);
});

test('시작 시점의 대안과 구토 횟수의 하한을 확정값으로 표시하지 않는다', () => {
  assert.deepEqual(extractCandidates('어제나 오늘부터 토했어요. 최소 2회 구토했어요. 밥을 반만 먹은 듯해요.'), {
    onset: unknown,
    vomitCount: unknown,
    mealChange: unknown
  });
  assert.deepEqual(extractCandidates('어제 저녁 또는 오늘 아침 처음 토했어요.').onset, unknown);
  assert.deepEqual(extractCandidates('적어도 두 번 구토했어요.').vomitCount, unknown);
  assert.deepEqual(extractCandidates('최대 3회 구토했어요.').vomitCount, unknown);
  assert.deepEqual(extractCandidates('오늘부터 구토했어요. 최소 2회 구토했어요. 식욕이 줄었어요.'), {
    onset: grounded('오늘', '오늘부터'),
    vomitCount: unknown,
    mealChange: grounded('식욕이 줄었어요', '식욕이 줄었어요')
  });
});

test('가능성이나 보호자의 추측을 명시 답변으로 처리하지 않는다', () => {
  assert.deepEqual(extractCandidates('어제부터 토했을 수도 있어요. 2회 구토했을 수도 있어요. 밥을 반만 먹었다고 생각해요.'), {
    onset: unknown, vomitCount: unknown, mealChange: unknown
  });
});

test('구토를 총 몇 번 했는지 말한 문장의 근거를 연결한다', () => {
  const complaint = '구토를 총 두 번 했어요. 설사는 세 번 했어요.';
  assert.deepEqual(extractCandidates(complaint).vomitCount, grounded(2, '구토를 총 두 번 했어요'));
});

test('쉼표 뒤의 불확실성 표현과 확인 중인 증상은 미확인이다', () => {
  const complaints = [
    '어제부터 구토, 정확히는 모르겠어요.',
    '두 번 토했는지 확인 중이에요.',
    '밥을 반만 먹은 모양이에요.'
  ];
  for (const complaint of complaints) {
    assert.deepEqual(extractCandidates(complaint), {
      onset: unknown, vomitCount: unknown, mealChange: unknown
    }, complaint);
  }
});

test('쉼표 뒤의 독립된 추측과 같은 문장의 명시된 답변을 구분한다', () => {
  const complaint = '어제부터 구토, 정확히는 모르겠어요, 식욕이 줄었어요. 구토를 총 두 번 했어요, 밥을 반만 먹은 모양이에요.';
  assert.deepEqual(extractCandidates(complaint), {
    onset: unknown,
    vomitCount: grounded(2, '구토를 총 두 번 했어요'),
    mealChange: grounded('식욕이 줄었어요', '식욕이 줄었어요')
  });
});
