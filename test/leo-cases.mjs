const digestive = ['onset', 'course', 'daily', 'meds', 'history', 'vomit', 'exposure'];

// Evidence and required questions are annotated from each story independently of the engine.
// A question may repeat one fact and still be needed for other details.
export const leoCases = [
  {
    id: 'negation',
    complaint: '어제 저녁부터 메스꺼워 보이고 밥을 절반만 먹어요. 오늘은 구토하지 않았고 숨쉬기 힘들어하는 모습은 없어요.',
    answered: { onset: '어제 저녁부터', daily: '밥을 절반만 먹어요', vomit: '오늘은 구토하지 않았고' },
    required: [...digestive.filter(id => id !== 'onset'), 'breath'],
    flag: 'breathing',
    baseline: { repeated: ['daily', 'onset', 'vomit'], omitted: [] }
  },
  {
    id: 'past',
    complaint: '지난달에 경련으로 두 번 쓰러졌어요. 오늘 아침부터 메스꺼워 보여요.',
    answered: { onset: '오늘 아침부터' },
    required: digestive.filter(id => id !== 'onset'),
    flag: 'collapse',
    baseline: { repeated: ['onset'], omitted: [] }
  },
  {
    id: 'unknown',
    complaint: '구토한 시각과 횟수는 잘 모르겠어요. 밥을 먹었는지도 모름.',
    answered: {},
    required: digestive,
    risks: { toxin: 'unsure' },
    baseline: { repeated: [], omitted: [] }
  },
  {
    id: 'multiple',
    complaint: '어제 저녁부터 두 번 토했어요. 오늘 아침 기침하고 소변 양이 줄었고, 걸을 때 절뚝거려요.',
    answered: { onset: '어제 저녁부터', course: '두 번 토했어요', vomit: '두 번 토했어요', urine_detail: '소변 양이 줄었고', limb: '걸을 때 절뚝거려요' },
    required: [...digestive.filter(id => id !== 'onset'), 'breath', 'urine_detail', 'limb'],
    baseline: { repeated: ['course', 'onset', 'urine_detail', 'vomit'], omitted: ['limb'] }
  },
  {
    id: 'correction',
    original: '어제 저녁부터 두 번 토했어요. 사료는 평소의 절반만 먹었어요.',
    complaint: '어제 저녁부터 한 번 토했어요. 사료는 평소의 절반만 먹었어요.',
    answers: { course: '한 번. 이후 경과는 모름.', vomit: '한 번. 내용물과 피 여부는 모름.' },
    answered: { onset: '어제 저녁부터', course: '한 번 토했어요', daily: '사료는 평소의 절반만 먹었어요', vomit: '한 번 토했어요' },
    required: digestive.filter(id => id !== 'onset'),
    baseline: { repeated: ['course', 'daily', 'onset', 'vomit'], omitted: [] }
  },
  {
    id: 'return',
    visitType: 'return',
    complaint: '지난 진료 뒤 이틀은 괜찮았는데 오늘 아침부터 한 번 토했어요. 현재 먹는 약이나 영양제는 없어요.',
    answered: { onset: '오늘 아침부터', course: '한 번 토했어요', meds: '현재 먹는 약이나 영양제는 없어요', vomit: '한 번 토했어요', followup: '지난 진료 뒤 이틀은 괜찮았는데' },
    required: [...digestive.filter(id => !['onset', 'meds'].includes(id)), 'followup'],
    baseline: { repeated: ['course', 'followup', 'meds', 'onset', 'vomit'], omitted: [] }
  }
];

export function scoreQuestions(scenario, questionIds) {
  const shown = new Set(questionIds);
  return {
    repeated: Object.keys(scenario.answered).filter(id => shown.has(id)).sort(),
    omitted: scenario.required.filter(id => !shown.has(id)).sort()
  };
}
