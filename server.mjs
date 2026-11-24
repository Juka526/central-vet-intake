import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { CONSENT_VERSION, PETS, draft, validateIntake } from './lib/engine.mjs';
import { emrAdapter } from './lib/emr-adapter.mjs';

const ROOT=dirname(fileURLToPath(import.meta.url));
const HOUR=3600000;
const uid=()=>randomBytes(18).toString('hex');
const same=(a,b)=>typeof a==='string' && typeof b==='string' && Buffer.byteLength(a)===Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function createApplication({vetCode=process.env.VET_CODE||uid(),receptionCode=process.env.RECEPTION_CODE||uid(),now=()=>Date.now()}={}) {
  if(vetCode.length<8 || receptionCode.length<8 || vetCode===receptionCode) throw new Error('서로 다른 8자 이상의 의료진 접근 코드를 설정하세요.');
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE intakes(id TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL, body TEXT NOT NULL); CREATE TABLE audit(id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL);');
  const sessions=new Map(), audio=new Map(), attempts=new Map();
  const stamp=()=>new Date(now()).toISOString();
  function audit(s,action,target='') { db.prepare('INSERT INTO audit(at,actor,action,target) VALUES(?,?,?,?)').run(stamp(),s?`${s.role}:${s.actor}`:'anonymous',action,target); }
  function eraseAudio(id) { const a=audio.get(id); if(a) { a.bytes.fill(0); audio.delete(id); } }
  function cleanup() {
    for(const [id,a] of audio) if(a.expires<=now()) {eraseAudio(id);audit(null,'audio.expired',id);}
    for(const r of db.prepare('SELECT id FROM intakes WHERE expires<=?').all(now())) {eraseAudio(r.id);db.prepare('DELETE FROM intakes WHERE id=?').run(r.id);audit(null,'intake.expired',r.id);}
    for(const [k,s] of sessions) if(s.expires<=now()) sessions.delete(k);
    for(const [k,a] of attempts) if(a.until<=now()) attempts.delete(k);
    db.prepare('DELETE FROM audit WHERE at<?').run(new Date(now()-24*HOUR).toISOString());
  }
  const timer=setInterval(cleanup,60000);timer.unref();
  const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  const fail=(res,status,message)=>send(res,status,{error:message});
  const get=id=>{const r=db.prepare('SELECT * FROM intakes WHERE id=?').get(id);return r?{row:r,record:JSON.parse(r.body)}:null;};
  const save=(id,record)=>db.prepare('UPDATE intakes SET body=? WHERE id=?').run(JSON.stringify(record),id);
  async function body(req) {
    if(!req.headers['content-type']?.startsWith('application/json')) {const e=new Error('JSON 요청이 필요합니다.');e.status=415;throw e;}
    let chunks=[],size=0,tooLarge=false;
    // Drain oversized bodies without buffering them so the next keep-alive request is not reset.
    for await (const chunk of req) {size+=chunk.length;if(size>2000000){tooLarge=true;chunks=[];}else if(!tooLarge)chunks.push(chunk);}
    if(tooLarge){const e=new Error('요청이 너무 큽니다.');e.status=413;throw e;}
    try{return JSON.parse(Buffer.concat(chunks).toString());}catch{const e=new Error('잘못된 JSON 요청입니다.');e.status=400;throw e;}
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Permissions-Policy','camera=(), geolocation=(), microphone=(self)');
    try {
      cleanup();
      const host=req.headers.host||'';
      if(!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return fail(res,403,'이 내부 시험 앱은 localhost에서만 실행합니다.');
      const origin=`http://${host}`;
      if(req.headers.origin && req.headers.origin!==origin) return fail(res,403,'허용되지 않은 출처입니다.');
      const url=new URL(req.url,origin), path=url.pathname;
      let sid=req.headers.cookie?.match(/(?:^|; )central_session=([a-f0-9]{36})(?:;|$)/)?.[1];
      let s=sessions.get(sid);
      if(path==='/api/session' && req.method==='GET') {
        if(!s) {sid=uid();s={role:'guardian',actor:uid(),csrf:uid(),expires:now()+HOUR};sessions.set(sid,s);res.setHeader('Set-Cookie',`central_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);}
        return send(res,200,{role:s.role,csrf:s.csrf,expiresAt:new Date(s.expires).toISOString(),consentVersion:CONSENT_VERSION,phone:process.env.HOSPITAL_PHONE||null,emr:emrAdapter.status});
      }
      if(path.startsWith('/api/')) {
        if(!s) return fail(res,401,'세션이 만료되었습니다. 새로고침 후 다시 시작해 주세요.');
        if(!['GET','HEAD'].includes(req.method) && !same(req.headers['x-csrf-token'],s.csrf)) return fail(res,403,'요청 확인에 실패했습니다. 새로고침해 주세요.');
        if(path==='/api/login' && req.method==='POST') {
          const key=req.socket.remoteAddress;let a=attempts.get(key)||{count:0,until:now()+60000};attempts.set(key,a);
          if(++a.count>8) return fail(res,429,'시도가 많습니다. 1분 후 다시 시도해 주세요.');
          const b=await body(req);
          if(!['vet','reception'].includes(b.role)||!same(b.code,b.role==='vet'?vetCode:receptionCode)){audit(s,'login.failed');return fail(res,401,'역할 또는 접근 코드를 확인해 주세요.');}
          audit(s,'login.success');sessions.delete(sid);sid=uid();s={role:b.role,actor:uid(),csrf:uid(),expires:now()+HOUR};sessions.set(sid,s);
          res.setHeader('Set-Cookie',`central_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);
          return send(res,200,{role:s.role,csrf:s.csrf});
        }
        if(path==='/api/logout' && req.method==='POST') {audit(s,'logout');sessions.delete(sid);res.setHeader('Set-Cookie','central_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(res,200,{ok:true});}
        if(path==='/api/intakes' && req.method==='POST') {
          if(s.role!=='guardian') return fail(res,403,'보호자 화면에서 제출해 주세요.');
          if(db.prepare('SELECT count(*) AS n FROM intakes').get().n>=250) return fail(res,429,'시험 접수 한도에 도달했습니다. 기존 자료를 삭제해 주세요.');
          const b=await body(req);const error=validateIntake(b);if(error)return fail(res,400,error);
          // Whitelist: client-supplied summaries, approval state and review identities are ignored.
          const input={petId:b.petId,visitType:b.visitType,category:b.category,complaint:b.complaint.trim(),answers:b.answers,...(b.questionVersion === undefined ? {} : {questionVersion:b.questionVersion,categories:b.categories,corrections:b.corrections ?? [],symptomSelections:b.symptomSelections ?? []}),risks:Object.fromEntries(Object.entries(b.risks).filter(([k])=>['breathing','collapse','bleeding','toxin','urine','abdomen','heat','birth'].includes(k)))};
          const id=uid(),createdAt=stamp();
          const record={id,...input,pet:PETS.find(p=>p.id===input.petId),draft:draft(input),status:'pending',version:1,createdAt,expiresAt:new Date(now()+24*HOUR).toISOString(),consents:{version:CONSENT_VERSION,privacy:true,voice:b.consents.voice,retainAudio:b.consents.retainAudio,at:createdAt},review:null};
          if(b.audio) {audio.set(id,{bytes:Buffer.from(b.audio.base64,'base64'),type:b.audio.type,expires:now()+HOUR});record.audioExpiresAt=new Date(now()+HOUR).toISOString();}
          db.prepare('INSERT INTO intakes VALUES(?,?,?,?)').run(id,s.actor,now()+24*HOUR,JSON.stringify(record));audit(s,'intake.created',id);if(b.audio)audit(s,'audio.retained',id);
          return send(res,201,{id,status:record.status,flags:record.draft.flags,expiresAt:record.expiresAt,audioExpiresAt:record.audioExpiresAt||null});
        }
        if(path==='/api/intakes' && req.method==='GET') {
          if(!['vet','reception'].includes(s.role))return fail(res,403,'의료진 전용입니다.');
          const list=db.prepare('SELECT body FROM intakes ORDER BY expires DESC').all().map(r=>{const v=JSON.parse(r.body);return {id:v.id,pet:{id:v.pet.id,name:v.pet.name,species:v.pet.species,age:v.pet.age},category:v.category,visitType:v.visitType,status:v.status,version:v.version,createdAt:v.createdAt,riskCount:v.draft.flags.length,urgent:v.draft.flags.some(f=>f.level==='contact'),missingCount:v.draft.missing.length};});
          audit(s,'intake.list');return send(res,200,{items:list});
        }
        if(path==='/api/audit' && req.method==='GET') {if(s.role!=='vet')return fail(res,403,'수의사 전용입니다.');audit(s,'audit.view');return send(res,200,{items:db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 200').all()});}
        const m=path.match(/^\/api\/intakes\/([a-f0-9]{36})(?:\/(review|export|audio))?$/);
        if(m) {
          const {row,record:r}=get(m[1])||{};
          if(!r || !(s.role==='vet'||s.role==='reception'||row.owner===s.actor))return fail(res,404,'접수 자료가 없거나 접근할 수 없습니다.');
          const action=m[2];
          if(!action && req.method==='DELETE') {
            if(s.role!=='vet' && row.owner!==s.actor)return fail(res,403,'삭제 권한이 없습니다.');
            eraseAudio(r.id);db.prepare('DELETE FROM intakes WHERE id=?').run(r.id);audit(s,'intake.deleted',r.id);return send(res,200,{ok:true});
          }
          if(action==='audio' && req.method==='DELETE') {
            if(s.role!=='vet'&&row.owner!==s.actor)return fail(res,403,'삭제 권한이 없습니다.');
            eraseAudio(r.id);audit(s,'audio.deleted',r.id);return send(res,200,{ok:true});
          }
          if(s.role!=='vet')return fail(res,403,'원문·검토·복사는 수의사 전용입니다.');
          if(!action && req.method==='GET'){audit(s,'intake.view',r.id);return send(res,200,{...r,audioAvailable:audio.has(r.id)});}
          if(action==='audio' && req.method==='GET') {
            const a=audio.get(r.id);if(!a)return fail(res,404,'보관된 음성이 없거나 보관 시간이 지났습니다.');audit(s,'audio.played',r.id);res.writeHead(200,{'Content-Type':a.type});return res.end(a.bytes);
          }
          if(action==='review' && req.method==='POST') {
            const b=await body(req);
            if(b.version!==get(r.id)?.record.version || b.version!==r.version)return fail(res,409,'다른 검토자가 변경했습니다. 목록에서 다시 열어 최신 내용을 확인해 주세요.');
            if(!['approved','held'].includes(b.status) || typeof b.hpi!=='string'||!b.hpi.trim()||b.hpi.length>14000||typeof b.soapS!=='string'||!b.soapS.trim()||b.soapS.length>15000||typeof b.note!=='string'||b.note.length>1000)return fail(res,400,'검토 내용과 상태를 확인해 주세요.');
            if(b.status==='approved' && (b.confirmed!==true || (r.draft.flags.length>0 && b.riskAcknowledged!==true)))return fail(res,400,'원문 대조와 위험 징후 확인 후 승인해 주세요.');
            if(b.status==='held'&&!b.note.trim())return fail(res,400,'보류 사유를 입력해 주세요.');
            r.status=b.status;r.version++;r.review={hpi:b.status==='approved'?b.hpi.replaceAll('[보호자 보고 · 수의사 검토 전 초안]','[보호자 보고 · 수의사 검토 완료]'):b.hpi,soapS:b.status==='approved'?b.soapS.replaceAll('[보호자 보고 · 수의사 검토 전 초안]','[보호자 보고 · 수의사 검토 완료]'):b.soapS,note:b.note,by:`시험 수의사 ${s.actor.slice(0,6)}`,at:stamp(),confirmed:b.confirmed===true,riskAcknowledged:b.riskAcknowledged===true};save(r.id,r);audit(s,`review.${b.status}`,r.id);return send(res,200,{...r,audioAvailable:audio.has(r.id)});
          }
          if(action==='export' && req.method==='POST') {
            const b=await body(req);if(b.version!==get(r.id)?.record.version || b.version!==r.version)return fail(res,409,'최신 승인본을 다시 확인해 주세요.');
            try{const text=emrAdapter.formatApproved(r,b.kind);audit(s,`export.${b.kind}`,r.id);return send(res,200,{text});}catch(e){return fail(res,409,e.message);}
          }
        }
        return fail(res,404,'요청한 기능을 찾을 수 없습니다.');
      }
      if(req.method!=='GET')return fail(res,405,'지원하지 않는 요청입니다.');
      const files={'/':'public/index.html','/favicon.svg':'public/favicon.svg','/app.js':'public/app.js','/styles.css':'public/styles.css','/lib/engine.mjs':'lib/engine.mjs'};
      if(!files[path])return fail(res,404,'페이지를 찾을 수 없습니다.');
      const content=await readFile(resolve(ROOT,files[path]));res.writeHead(200,{'Content-Type':path.endsWith('.svg')?'image/svg+xml':path.endsWith('.css')?'text/css; charset=utf-8':path.endsWith('.js')||path.endsWith('.mjs')?'text/javascript; charset=utf-8':'text/html; charset=utf-8'});res.end(content);
    }catch(e){if(!res.headersSent)fail(res,e.status||500,e.status?e.message:'처리 중 오류가 발생했습니다. 입력 내용을 확인하고 다시 시도해 주세요.');else res.end();}
  });
  server.requestTimeout=30000;server.headersTimeout=15000;
  return {server,cleanup,close(){clearInterval(timer);for(const id of audio.keys())eraseAudio(id);db.close();},codes:{vetCode,receptionCode}};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const app=createApplication();const port=Number(process.env.PORT||4317);
  app.server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'사용 중인 포트입니다. PORT를 변경해 다시 실행하세요.':`서버를 실행하지 못했습니다 (${e.code}).`);app.close();process.exitCode=1;});
  app.server.listen(port,'127.0.0.1',()=>console.log(`\n센트럴 문진 · 가상 데이터 전용\nhttp://127.0.0.1:${port}\n수의사 코드: ${app.codes.vetCode}\n접수 코드: ${app.codes.receptionCode}\n모든 자료는 메모리에만 보관되며 재시작 시 삭제됩니다.\n`));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.server.close(()=>{app.close();process.exit(0);}));
}
