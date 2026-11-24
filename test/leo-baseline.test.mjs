import test from 'node:test';
import assert from 'node:assert/strict';
import { assess, ENGINE_VERSION, questions } from '../lib/engine.mjs';
import { leoCases, scoreQuestions } from './leo-cases.mjs';

test('레오 문진 기존 엔진 기준선 (rules-ko-0.1)', async t => {
  assert.equal(ENGINE_VERSION, 'rules-ko-0.1');
  let repeated = 0;
  let omitted = 0;
  for (const scenario of leoCases) {
    await t.test(scenario.id, () => {
      for (const evidence of Object.values(scenario.answered)) {
        assert.ok(scenario.complaint.includes(evidence), evidence);
      }
      const ids = questions('digestive', scenario.complaint, scenario.visitType).map(q => q.id);
      const score = scoreQuestions(scenario, ids);
      assert.deepEqual(score, scenario.baseline);
      if (scenario.flag) {
        assert.ok(assess(scenario.complaint, {}, { [scenario.flag]: 'no' })
          .some(flag => flag.id === scenario.flag && flag.level === 'candidate'));
      }
      repeated += score.repeated.length;
      omitted += score.omitted.length;
      t.diagnostic(`${scenario.id} 반복 ${score.repeated.length}건, 잘못 생략 ${score.omitted.length}건`);
    });
  }
  t.diagnostic(`합계 반복 ${repeated}건, 잘못 생략 ${omitted}건`);
});
