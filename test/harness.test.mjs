import test from 'node:test';
import assert from 'node:assert/strict';
import {dependencies, dependencySatisfied, parseArgs, runIssueQueue, runStages} from '../scripts/harness.mjs';

function scenario(reviews, remote = ['pass']) {
  const state = {stage:'develop', repairs:0, improved:false, history:[]};
  const actions = [];
  let draft;
  const hooks = {
    async edit(role) { actions.push(role); return role; },
    async verify() {
      const pass = reviews.shift();
      assert.equal(typeof pass,'boolean');
      actions.push('verify');
      return {pass,report:pass?'test passed':'expected corrected answer; saw duplicate question'};
    },
    head() { return String(actions.length); }, save() {},
    async publish() { draft ??= {id:1,ready:false,merged:false}; },
    async ci() { return remote.shift(); },
    async ready() { draft.ready = true; },
    async merge() { assert.equal(draft.ready,true); draft.merged = true; return true; }
  };
  return {state,hooks,actions,pr:()=>draft};
}

test('입력은 정확히 하나의 이슈 또는 마일스톤을 지정한다',()=>{
  assert.deepEqual(parseArgs(['--issue','17']),{issue:17});
  assert.deepEqual(parseArgs(['--milestone','M2']),{milestone:'M2'});
  assert.throws(()=>parseArgs(['--issue','1;echo invalid']));
  assert.throws(()=>parseArgs(['--issue','1','--milestone','M1']));
});

test('명시적으로 선언한 선행 이슈만 선별한다',()=>{
  assert.deepEqual(dependencies('Related #3\nDepends on: #1, #2\nDepends on: #1'),[1,2]);
});

test('실패 두 차례 보완 후 초안 유지',async()=>{
  const s=scenario([false,false,false]);
  assert.equal(await runStages(s.state,s.hooks),'blocked');
  assert.equal(s.pr().ready,false);
  assert.equal(s.pr().merged,false);
  assert.deepEqual(s.actions,['develop','verify','repair','verify','repair','verify']);
});

test('세부 개선 이후 독립 검증이 실패하면 재보완한다',async()=>{
  const s=scenario([true,false,true]);
  assert.equal(await runStages(s.state,s.hooks),'done');
  assert.equal(s.pr().ready,true);
  assert.equal(s.pr().merged,true);
  assert.deepEqual(s.actions,['develop','verify','improve','verify','repair','verify']);
});

test('CI 대기 후 기존 체크포인트에서 재개하고 같은 초안 사용',async()=>{
  const s=scenario([true,true],['pending','pass']);
  assert.equal(await runStages(s.state,s.hooks),'pending');
  const pr=s.pr();
  assert.equal(pr.ready,false);
  const count=s.actions.length;
  assert.equal(await runStages(structuredClone(s.state),s.hooks),'done');
  assert.equal(s.actions.length,count);
  assert.strictEqual(pr,s.pr());
  assert.equal(pr.ready,true);
});

test('CI가 실패하면 준비 완료로 전환하지 않는다',async()=>{
  const s=scenario([true,true,true,true],['fail','fail','fail']);
  assert.equal(await runStages(s.state,s.hooks),'blocked');
  assert.equal(s.pr().ready,false);
  assert.equal(s.pr().merged,false);
});

test('병합 대기 후 검증을 반복하지 않고 같은 PR에서 재개한다',async()=>{
  const s=scenario([true,true]);
  const merge=s.hooks.merge;
  s.hooks.merge=async()=>false;
  assert.equal(await runStages(s.state,s.hooks),'pending');
  assert.equal(s.state.stage,'merge');
  const pr=s.pr();
  assert.equal(pr.merged,false);
  s.hooks.merge=merge;
  assert.equal(await runStages(structuredClone(s.state),s.hooks),'done');
  assert.strictEqual(s.pr(),pr);
  assert.equal(pr.merged,true);
});


test('보통 선행 이슈는 닫힌 상태와 병합 PR이 필요하며 #2는 검증된 M0 릴리스도 인정한다',()=>{
  const manual = {state:'CLOSED',closedByPullRequestsReferences:[]};
  const merged = {state:'CLOSED',closedByPullRequestsReferences:[{number:20}]};
  const matchesPr = id => id === 20;
  const verifiedRelease = tag => tag === 'm0';
  assert.equal(dependencySatisfied(2,manual,matchesPr,verifiedRelease),true);
  assert.equal(dependencySatisfied(2,manual,matchesPr,()=>false),false);
  assert.equal(dependencySatisfied(5,manual,matchesPr,verifiedRelease),false);
  assert.equal(dependencySatisfied(5,merged,matchesPr,verifiedRelease),true);
  assert.equal(dependencySatisfied(5,{...merged,state:'OPEN'},matchesPr,verifiedRelease),false);
});

test('닫힌 PR은 검증 후에도 다시 만들지 않는다',async()=>{
  const s=scenario([true,true]);
  s.hooks.publish=async()=>false;
  s.hooks.ci=()=>assert.fail('A closed PR cannot be checked for merge.');
  assert.equal(await runStages(s.state,s.hooks),'closed');
});

test('다른 이슈를 계속 처리하고 앞에서 대기한 의존성을 다시 확인한다',async()=>{
  const calls=[];
  let dependencyMerged=false;
  const incomplete=await runIssueQueue([5,6,7,8],async issue=>{
    calls.push(issue);
    if (issue === 5) return 'closed';
    if (issue === 6) return dependencyMerged ? 'done' : 'waiting for #7';
    if (issue === 7) {
      dependencyMerged=true;
      return 'done';
    }
    return 'blocked';
  });
  assert.deepEqual(calls,[5,6,7,8,6]);
  assert.equal(incomplete,true);
});
