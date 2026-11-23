import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const repo = 'Juka526/central-vet-intake';
const api = (path, data) => JSON.parse(execFileSync('gh', ['api', path, ...(data ? ['-X','POST','--input','-'] : [])], {
  encoding:'utf8', input:data ? JSON.stringify(data) : undefined
}));
const all = path => JSON.parse(execFileSync('gh',['api','--paginate','--slurp',path],{encoding:'utf8'})).flat();
const base = 'repos/' + repo;
const project = api(base);
if (project.full_name !== repo || !project.private || !project.permissions?.push) throw Error('대상 비공개 저장소의 쓰기 권한을 확인하세요.');
const milestones = all(base + '/milestones?state=all&per_page=100');
const issues = all(base + '/issues?state=all&per_page=100').filter(i=>!i.pull_request);
const catalog = JSON.parse(readFileSync(new URL('../docs/milestones.json', import.meta.url)));
const numbers = new Map();
for (const {title,goal,issues:tasks} of catalog) {
  const milestone = milestones.find(m=>m.title===title) ?? api(base+'/milestones',{title,description:goal});
  for (const [key,summary,criteria,deps] of tasks) {
    const marker = '<!-- central-vet-task:' + key + ' -->';
    let issue = issues.find(i=>i.body?.includes(marker));
    if (!issue) {
      const dependencies = deps.map(d=>{
        if (!numbers.has(d)) throw Error('Unknown dependency: ' + d);
        return '#' + numbers.get(d);
      });
      const body = [marker,'## 인수 조건과 검증',criteria,dependencies.length ? 'Depends on: '+dependencies.join(', ') : ''].join('\n\n');
      issue = api(base+'/issues',{title:summary,body,milestone:milestone.number});
    }
    numbers.set(key,issue.number);
    console.log(milestone.title.split(' ')[0], key, issue.html_url);
  }
}
