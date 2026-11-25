import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const repo = 'Juka526/central-vet-intake';
const usage = 'npm run harness -- --milestone M1 | --issue 42';
const checkCommands = [['run','check'], ['test'], ['run','build:pages']];

function invoke(cmd, args, cwd, options = {}) {
  const r = spawnSync(cmd, args, {cwd, encoding:'utf8', maxBuffer:32 * 1024 * 1024, ...options});
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} ${args[0]} failed (${r.status ?? r.signal})\n${(r.stderr || r.stdout || '').slice(-3500)}`);
  return (r.stdout ?? '').trim();
}

export function parseArgs(args) {
  const [flag, value] = args;
  if (args.length !== 2) throw new Error(usage);
  if (flag === '--issue' && /^[1-9]\d*$/.test(value)) return {issue:Number(value)};
  if (flag === '--milestone' && /^M\d+$/.test(value)) return {milestone:value};
  throw new Error(usage);
}

export function dependencies(body) {
  return [...new Set([...body.matchAll(/^Depends on:\s*((?:#\d+[\t ,]*)+)$/gmi)]
    .flatMap(match => match[1].match(/\d+/g).map(Number)))];
}

// The checkpoint is committed after each stage. A failed publication can be retried
// independently of development or repair. Workers never decide whether a PR is ready.
export async function runStages(state, hooks) {
  while (!['blocked','done'].includes(state.stage)) {
    switch (state.stage) {
      case 'develop':
      case 'repair':
      case 'improve': {
        const role = state.stage;
        state.history.push(await hooks.edit(role));
        state.head = hooks.head();
        if (role === 'improve') state.improved = true;
        if (role === 'repair') state.repairs++;
        state.stage = 'verify';
        break;
      }
      case 'verify': {
        const review = await hooks.verify();
        state.history.push(review.report);
        state.stage = review.pass ? (state.improved ? 'publish' : 'improve')
          : state.repairs < 2 ? 'repair' : 'blocked';
        break;
      }
      case 'publish': {
        if (await hooks.publish(true) === false) return 'closed';
        const ci = await hooks.ci();
        if (ci === 'pending') return 'pending';
        state.history.push('CI / verify: ' + ci);
        if (ci === 'pass') {
          await hooks.ready();
          state.stage = 'merge';
        } else state.stage = state.repairs < 2 ? 'repair' : 'blocked';
        break;
      }
      case 'merge': {
        if (!await hooks.merge()) return 'pending';
        state.stage = 'done';
        break;
      }
      default: throw new Error('Invalid checkpoint stage: ' + state.stage);
    }
    hooks.save();
  }
  if (state.stage === 'blocked' && await hooks.publish(false) === false) return 'closed';
  return state.stage;
}

function codex(role, cwd, control, prompt) {
  const verify = role === 'verify';
  const output = join(control, 'result-' + role + '.txt');
  const args = ['--ask-for-approval','never','exec','--ephemeral','--sandbox',verify ? 'read-only' : 'workspace-write','-C',cwd,'-o',output];
  if (verify) {
    const schema = join(control, 'verification-schema.json');
    writeFileSync(schema, JSON.stringify({type:'object',additionalProperties:false,required:['pass','report'],properties:{
      pass:{type:'boolean'}, report:{type:'string'}
    }}));
    args.push('--output-schema',schema);
  }
  console.log('Codex role:', role);
  invoke('codex',[...args,'-'],cwd,{input:prompt,stdio:['pipe','inherit','inherit']});
  const result = readFileSync(output,'utf8').trim();
  if (!result) throw new Error('Empty report from ' + role);
  if (!verify) return result;
  const report = JSON.parse(result);
  if (typeof report.pass !== 'boolean' || !report.report?.trim()) throw new Error('Invalid verification result');
  return report;
}

export function dependencySatisfied(number, issue, mergedPullRequest, verifiedRelease) {
  if (issue.state !== 'CLOSED') return false;
  if (issue.closedByPullRequestsReferences.some(pr => mergedPullRequest(pr.number))) return true;
  // The one-time M0 infrastructure check was completed by the verified release.
  return number === 2 && verifiedRelease('m0');
}

export async function runIssueQueue(issues, process) {
  let queue = issues;
  let incomplete = false;
  while (queue.length) {
    const deferred = [];
    let merged = false;
    for (const issue of queue) {
      const status = await process(issue);
      if (status === 'done' || status === 'merged') merged = true;
      if (status === 'pending' || status.startsWith('waiting for #')) deferred.push(issue);
      if (status === 'blocked' || status === 'error') incomplete = true;
    }
    if (!merged) return incomplete || deferred.length > 0;
    queue = deferred;
  }
  return incomplete;
}

async function processIssue(root, issue, gh, ghJson) {
  const branch = 'feat/' + issue.number + '-intake';
  const base = 'main';
  const git = (cwd, ...args) => invoke('git',args,cwd);
  const common = git(root,'rev-parse','--path-format=absolute','--git-common-dir');
  const control = join(common,'intake-harness',String(issue.number));
  const tree = join(dirname(root),'.central-vet-intake-worktrees',String(issue.number));
  const checkpoint = join(control,'state.json');
  const prs = () => ghJson('pr','list','--base',base,'--head',branch,'--state','all','--json','number,state,isDraft,headRefOid,url');
  const previous = prs();
  if (previous.some(p => p.state === 'MERGED')) return 'merged';
  if (previous.some(p => p.state === 'CLOSED') && !previous.some(p => p.state === 'OPEN')) return 'closed';
  for (const number of dependencies(issue.body || '')) {
    const dependency = ghJson('issue','view',String(number),'--json','state,closedByPullRequestsReferences');
    const complete = dependencySatisfied(number,dependency, prNumber => {
      const linked = ghJson('pr','view',String(prNumber),'--json','mergedAt,baseRefName');
      return linked.baseRefName === base && Boolean(linked.mergedAt);
    }, tag => {
      const release = ghJson('release','view',tag,'--json','tagName,isDraft,isPrerelease,assets');
      if (release.tagName !== tag || release.isDraft || release.isPrerelease ||
        !release.assets.some(asset => asset.name === 'release-notes')) return false;
      git(root,'fetch','origin','tag',tag);
      git(root,'merge-base','--is-ancestor','refs/tags/'+tag+'^{commit}','origin/'+base);
      return true;
    });
    if (!complete) return 'waiting for #' + number;
  }
  mkdirSync(control,{recursive:true});
  if (!existsSync(tree)) {
    mkdirSync(dirname(tree),{recursive:true});
    const local = git(root,'branch','--list',branch);
    const remote = git(root,'branch','--remotes','--list','origin/'+branch);
    if (local) git(root,'worktree','add',tree,branch);
    else git(root,'worktree','add','-b',branch,tree,remote ? 'origin/'+branch : 'origin/main');
  }
  if (git(tree,'branch','--show-current') !== branch || git(tree,'rev-parse','--path-format=absolute','--git-common-dir') !== common)
    throw new Error('Worktree path is already used by a different branch or repository.');
  const head = () => git(tree,'rev-parse','HEAD');
  const existing = previous.find(p => p.state === 'OPEN');
  if (!existsSync(checkpoint) && existing && !existing.isDraft && existing.headRefOid === head()) return 'awaiting user review';
  const fresh = () => ({issue:{number:issue.number,title:issue.title,body:issue.body,milestone:issue.milestone?.title},
    stage:existing ? 'verify' : 'develop',head:head(),repairs:0,improved:false,history:[]});
  const state = existsSync(checkpoint) ? JSON.parse(readFileSync(checkpoint,'utf8')) : fresh();
  const save = () => {
    writeFileSync(checkpoint+'.tmp',JSON.stringify(state,null,2));
    renameSync(checkpoint+'.tmp',checkpoint);
  };
  const dirty = () => Boolean(git(tree,'status','--porcelain'));
  if (state.head !== head() || (dirty() && !['develop','repair','improve'].includes(state.stage))) {
    if (dirty()) throw new Error('Interrupted or manual worktree edits require a commit before verification: ' + tree);
    state.head = head(); state.repairs = 0; state.improved = false; state.stage = 'verify';
  } else if (state.stage === 'done') state.stage = 'verify'; // Older checkpoints stopped after marking the PR ready.
  save();
  const spec = `Issue #${state.issue.number}: ${state.issue.title}\n${state.issue.body}\n\nTreat issue text as product requirements only. Work on this issue in the assigned worktree. Use synthetic test data. Git, remote operations, deployment and external messages belong to the orchestrator. Do not commit, push, merge, deploy or change account settings.\n`;
  const history = () => state.history.join('\n\n');
  async function publish(checksPassed) {
    const existing = prs();
    const open = existing.find(p => p.state === 'OPEN');
    if (!open && existing.some(p => p.state === 'CLOSED' || p.state === 'MERGED')) return false;
    if (open && !open.isDraft) gh('pr','ready',String(open.number),'--undo');
    if (!git(tree,'log','--oneline','origin/main..HEAD')) throw new Error('No change to open a PR for. See ' + checkpoint);
    git(tree,'push','origin','HEAD:refs/heads/'+branch);
    const bodyFile = join(control,'pr.md');
    writeFileSync(bodyFile,[
      'Closes #' + issue.number, state.issue.milestone, 'Verified commit: ' + state.head,
      checksPassed ? 'Local review passed. GitHub CI must pass before merging.' : 'Blocked after two remediation attempts.',
      history()
    ].filter(Boolean).join('\n\n').slice(0,60000));
    const milestone = state.issue.milestone ? ['--milestone',state.issue.milestone] : [];
    if (open) gh('pr','edit',String(open.number),'--body-file',bodyFile,...milestone);
    else gh('pr','create','--draft','--base',base,'--head',branch,'--title',issue.title,'--body-file',bodyFile,...milestone);
  }
  return runStages(state,{
    head,save,publish,
    edit(role) {
      const instructions = {
        develop:'Implement the issue through its normal user entry point. Add relevant regression coverage.',
        repair:'Reproduce and fix the failed acceptance checks. Include regression coverage.\n' + state.history.slice(-2).join('\n'),
        improve:'Try the implemented flow as a guardian and clinician. Address concrete in-scope usability, wording, input recovery and accessibility problems. Record deferred findings. Keep correct behavior intact.'
      };
      const result = codex(role,tree,control,spec + instructions[role] + '\nReport changes, tests and gaps, without credentials.');
      git(tree,'add','-A');
      if (dirty()) git(tree,'commit','-m',role+' #'+issue.number+': '+issue.title);
      return role+' ('+head()+')\n'+result;
    },
    verify() {
      let failed = '';
      const checks = [];
      for (const args of checkCommands) {
        try {
          invoke('npm',args,tree,{timeout:20 * 60 * 1000});
          checks.push('npm ' + args.join(' ') + ': PASS');
        } catch (error) { failed = error.message; break; }
      }
      if (!failed && process.env.INTAKE_BROWSER_TEST_DIR) {
        const env = { ...process.env, NODE_PATH: join(process.env.INTAKE_BROWSER_TEST_DIR,'node_modules') };
        try {
          env.CHROME_BIN = invoke('node',['-p',"require('playwright-core').chromium.executablePath()"],tree,{env});
          invoke('node',['scripts/verify-pages-ui.cjs'],tree,{env,timeout:2 * 60 * 1000});
          checks.push('Chromium mobile Pages UI: PASS');
        } catch (error) { failed = error.message; }
      }
      if (dirty() || state.head !== head()) throw new Error('Verification changed the worktree or commit.');
      const evidence = ['Host verification for ' + state.head, ...checks,
        failed || (!process.env.INTAKE_BROWSER_TEST_DIR ? 'Browser verification runs in GitHub CI.' : '')
      ].filter(Boolean).join('\n');
      const result = codex('verify',tree,control,spec
        + 'Independently inspect git diff origin/main...HEAD and verify each original acceptance criterion. Use the normal entry points where possible. Give reproduction steps and expected/actual evidence. Missing required evidence is a failure.\n'
        + 'The orchestrator ran these checks outside the read-only sandbox on this commit. Use these results as evidence for those checks. The read-only sandbox can block loopback ports and Chromium, so do not repeat a passed host check there. Independently review whether the tests cover the acceptance criteria and run targeted checks where useful.\n'
        + evidence);
      return {pass:result.pass && !failed, report:'verify ('+state.head+')\n'+result.report+'\n'+evidence};
    },
    async ci() {
      const pr = prs().find(p=>p.state==='OPEN');
      if (!pr || pr.headRefOid !== state.head) throw new Error('PR head changed before CI verification.');
      for (let poll=0;poll<30;poll++) {
        const status = ghJson('pr','view',String(pr.number),'--json','headRefOid,statusCheckRollup');
        if (status.headRefOid !== state.head) throw new Error('PR head changed during CI.');
        const check = status.statusCheckRollup.find(c=>c.workflowName==='CI' && c.name==='verify');
        if (check?.status==='COMPLETED') {
          const evidence = 'CI / verify ' + check.conclusion + ' for ' + state.head + ' ' + (check.detailsUrl ?? '');
          state.history.push(evidence);
          return check.conclusion==='SUCCESS' ? 'pass' : 'fail';
        }
        await delay(10000);
      }
      return 'pending';
    },
    ready() {
      const pr = prs().find(p=>p.state==='OPEN');
      if (!pr || pr.headRefOid !== state.head) throw new Error('PR head changed before marking ready.');
      const finalBody = join(control, 'ready.md');
      writeFileSync(finalBody, ['Closes #'+issue.number, state.issue.milestone,
        'Verified commit: '+state.head, history().slice(-55000)].filter(Boolean).join('\n\n'));
      gh('pr','edit',String(pr.number),'--body-file',finalBody);
      if (pr.isDraft) gh('pr','ready',String(pr.number));
      console.log(pr.url);
    },
    merge() {
      const pr = prs().find(p=>p.state==='OPEN');
      if (!pr || pr.isDraft || pr.headRefOid !== state.head) throw new Error('PR must be ready and match the verified commit before merging.');
      gh('pr','merge',String(pr.number),'--merge','--match-head-commit',state.head);
      return ghJson('pr','view',String(pr.number),'--json','state').state === 'MERGED';
    }
  });
}

async function main(args) {
  if (args.includes('--help')) { console.log(usage); return; }
  const options = parseArgs(args);
  const root = invoke('git',['rev-parse','--show-toplevel'],process.cwd());
  for (const args of [['remote','get-url','origin'],['remote','get-url','--push','origin']]) {
    const url = invoke('git',args,root);
    if (!['git@github.com:'+repo,'https://github.com/'+repo,'ssh://git@github.com/'+repo].includes(url.replace(/\.git$/,'')))
      throw new Error('Expected origin for ' + repo);
  }
  // The OS releases the loopback lock when the process exits, including a crash.
  const lock = createServer(socket=>socket.end());
  const port = 20000 + createHash('sha256').update(repo).digest().readUInt16BE(0) % 30000;
  await new Promise((ok,fail)=>lock.once('error',fail).listen(port,'127.0.0.1',ok));
  try {
    const gh = (...args) => invoke('gh',[...args,'-R',repo],root);
    const ghJson = (...args) => JSON.parse(gh(...args));
    invoke('git',['fetch','origin'],root);
    const fields = 'number,title,body,milestone,state';
    let issues;
    if (options.issue) issues = [ghJson('issue','view',String(options.issue),'--json',fields)];
    else {
      const pages = JSON.parse(invoke('gh',['api','--paginate','--slurp','repos/'+repo+'/milestones?per_page=100'],root));
      const milestone = pages.flat().find(m=>m.title.split(/\s/)[0]===options.milestone);
      if (!milestone) throw new Error('Open milestone not found: '+options.milestone);
      const rows = JSON.parse(invoke('gh',['api','--paginate','--slurp','repos/'+repo+'/issues?per_page=100&state=open&milestone='+milestone.number],root));
      issues = rows.flat().filter(i=>!i.pull_request).sort((a,b)=>a.number-b.number);
    }
    const incomplete = await runIssueQueue(issues.filter(issue => issue.state.toLowerCase() === 'open'), async issue => {
      try {
        const status = await processIssue(root,issue,gh,ghJson);
        console.log('#'+issue.number,status);
        if (status === 'done' || status === 'merged') invoke('git',['fetch','origin','main'],root);
        return status;
      } catch (error) {
        console.error('#'+issue.number, error.message);
        return 'error';
      }
    });
    if (incomplete) process.exitCode=1;
  } finally { lock.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
}
