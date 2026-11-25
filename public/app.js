import { PETS, CATEGORIES, RISKS, CONSENT_VERSION, SAFETY, questions, assess, extractCandidates } from '/lib/engine.mjs';
const pages = document.documentElement.hasAttribute('data-static-demo');
const cloud = pages && new URLSearchParams(location.search).get('cloud') === '1';
let cloudToken = '', cloudScope = '', submission, cloudActionPending = false;
let cloudRequests = cloud ? new AbortController() : null;
const reviewEdits = new Map();
const demo = pages && !cloud ? await import('/pages/demo.mjs') : null;
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={paw:'<circle cx="8" cy="7" r="2"/><circle cx="16" cy="7" r="2"/><circle cx="4.5" cy="12" r="1.6"/><circle cx="19.5" cy="12" r="1.6"/><path d="M7 18c0-6 10-6 10 0 0 4-3 1-5 1s-5 3-5-1Z"/>',mic:'<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',check:'<path d="m5 12 4 4L19 6"/>',shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',file:'<path d="M14 3H5v18h14V8l-5-5Z M14 3v6h5M8 13h8M8 17h6"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',alert:'<path d="m12 3 10 18H2L12 3Z M12 9v5M12 17v1"/>',copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',heart:'<path d="M20 5c-3-3-6-1-8 1-2-2-5-4-8-1-4 5 3 11 8 15 5-4 12-10 8-15Z"/>',home:'<path d="m3 11 9-8 9 8M5 10v11h14V10M9 21v-7h6v7"/>',logout:'<path d="M10 4H4v16h6M10 12h11m-4-4 4 4-4 4"/>'};
const icon=(name,cls='')=>`<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.file}</svg>`;
const blank=()=>({petId:PETS[0].id,visitType:'first',category:'digestive',complaint:'',answers:{},risks:{},consents:{privacy:false,voice:false,retainAudio:false,version:CONSENT_VERSION},synthetic:false});
let session,view='guardian',step=0,form=blank(),receipt=null,items=[],selected=null,filter='all',query='',auditOpen=false,activeRecordTab='hpi',busy=false;
let guardianChat = null;
let playbackURL=null;
function chatButton(id, label) {
  return demo && id ? `<button class="secondary compact" data-chat="${esc(id)}">${label}</button>` : '';
}
const klatInvite = demo && new URLSearchParams(location.hash.slice(1)).get('klat');
const klatRooms = new Map();
async function klatRequest(room, method, body) {
  const response = await fetch('/api/klat/' + room, {
    method, headers: { Authorization: 'Bearer ' + klatInvite, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Klat 연결에 실패했습니다.');
  return result;
}
async function openChat(id) {
  const path = '/api/intakes/' + id + '/chat';
  const dialog = document.createElement('dialog');
  dialog.className = 'contact-dialog';
  dialog.setAttribute('aria-label', '문진 대화');
  dialog.innerHTML = '<h2>문진 대화</h2><p>보호자와 접수 담당자의 가상 대화입니다. 메시지는 이 탭에만 보관됩니다.</p><div role="log"></div><form><label>메시지<textarea name="message" required maxlength="500" rows="2"></textarea></label><button class="primary">보내기</button></form><form method="dialog"><button class="secondary">닫기</button></form>';
  const history = dialog.querySelector('[role=log]');
  function show(messages) {
    history.replaceChildren(...messages.map(({ role, text }) => {
      const line = document.createElement('p');
      line.textContent = (role === 'guardian' ? '보호자 · ' : '접수 · ') + text;
      return line;
    }));
    if (!messages.length) history.textContent = '아직 메시지가 없습니다.';
    history.scrollTop = history.scrollHeight;
  }
  demo.request(path); // Check the current record and simulated role before opening the chat.
  const role = session.role;
  if (klatInvite) dialog.querySelector('p').textContent = '가상 메시지만 보내 주세요. 보내기를 누르면 입력한 메시지와 시연 역할이 Klat에 저장됩니다. 대화는 탭을 닫아도 Klat에 남습니다. 문진을 삭제하면 연결된 대화도 삭제됩니다.';
  const existingRoom = klatRooms.get(id);
  let messages = existingRoom ? await klatRequest(existingRoom, 'GET') : demo.request(path);
  if (session.role !== role) return;
  show(messages);
  const send = dialog.querySelector('form');
  send.onsubmit = async event => {
    event.preventDefault();
    const submit = send.querySelector('button');
    if (submit.disabled) return;
    submit.disabled = true;
    try {
      const text = send.elements.message.value.trim();
      if (!text) throw new Error('메시지를 입력해 주세요.');
      if (klatInvite) {
        let room = klatRooms.get(id);
        if (!room) {
          room = crypto.randomUUID();
          await klatRequest(room, 'PUT');
          klatRooms.set(id, room);
        }
        const sent = await klatRequest(room, 'POST', { role, text });
        messages = [...messages, sent].slice(-50);
      } else {
        messages = demo.request(path, { method: 'POST', body: { text } });
      }
      show(messages);
      send.reset();
      send.elements.message.focus();
    } catch (error) { toast(error.message, true); }
    finally { submit.disabled = false; }
  };
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
}

let speech=null,recorder=null,stream=null,audioBlob=null,voiceTimer=null,listening=false,stopRecordingPromise=null;
function toast(text,error=false){const el=$('#toast');el.textContent=text;el.className=error?'show error':'show';clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.className='',5000);}
async function api(path,options={}){
  if(demo)return demo.request(path,options);
  const signal=cloudRequests?.signal;
  const res=await fetch(path,{...options,...(signal?{signal}:{}),headers:{'Content-Type':'application/json',...(cloud?{Authorization:'Bearer '+cloudToken,'X-Demo-Role':session?.role||'guardian'}:{'X-CSRF-Token':session?.csrf||''}),...options.headers},body:options.body?JSON.stringify(options.body):undefined});
  let data;
  try { data = await res.json(); }
  catch (error) {
    signal?.throwIfAborted();
    if (!cloud) throw error;
    throw new Error('클라우드 응답을 확인할 수 없습니다. 현재 입력을 유지한 채 다시 시도해 주세요.');
  }
  signal?.throwIfAborted();
  if(!res.ok)throw Object.assign(new Error(data.error||'요청 처리에 실패했습니다.'),{existingSubmissionId:data.existingSubmissionId});
  return data;
}
function connectCloud() {
  if ($('#cloud-auth')) return;
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-label', '클라우드 시연 연결');
  dialog.id = 'cloud-auth';
  dialog.className = 'contact-dialog';
  dialog.innerHTML = '<form><h2>클라우드 시연 연결</h2><label for="cloud-token">초대 계정의 Cloud Run ID 토큰</label><input id="cloud-token" type="password" autocomplete="off" required><p id="cloud-error" class="error-text" role="alert"></p><button class="primary" type="submit">연결</button></form>';
  document.body.append(dialog);
  dialog.addEventListener('cancel', event => { if (!session) event.preventDefault(); });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.querySelector('form').onsubmit = async event => {
    event.preventDefault();
    const button = dialog.querySelector('button');
    button.disabled = true;
    try {
      const token = dialog.querySelector('input').value.trim();
      const next = await api('/api/session', { headers: { Authorization: 'Bearer ' + token } });
      if (!dialog.isConnected) return;
      if (cloudScope && next.scope !== cloudScope) throw new Error('같은 초대 계정의 토큰을 입력해 주세요.');
      cloudToken = token;
      cloudScope = next.scope;
      if (!session) { session = next; render(); }
      dialog.close();
    } catch (error) { dialog.querySelector('#cloud-error').textContent = error.message; }
    finally { button.disabled = false; }
  };
  dialog.showModal();
}
function clearCloud() {
  cloudRequests.abort();
  cloudRequests=new AbortController();
  busy=false;cloudActionPending=false;filter='all';query='';
  clearTimeout(toast.timer);
  const notice=$('#toast');
  notice.textContent='';notice.className='';
  cloudToken='';cloudScope='';session=null;submission=null;reviewEdits.clear();
  form=blank();receipt=null;selected=null;items=[];audioBlob=null;auditOpen=false;step=0;view='guardian';
  $('#app').replaceChildren();
  $('#cloud-auth')?.remove();
  connectCloud();
}
const date=v=>new Intl.DateTimeFormat('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Seoul'}).format(new Date(v));
const pet=()=>PETS.find(p=>p.id===form.petId);
const statusLabel=s=>({pending:'검토 대기',approved:'승인 완료',held:'보류'}[s]||s);
function header(){return `<header class="topbar${cloud?' cloud-topbar':''}"><a href="${cloud?'/?cloud=1':'/'}" class="brand" aria-label="센트럴 문진 처음으로"><span class="brand-symbol">${icon('paw')}</span><span>센트럴 <b>문진</b><small>CENTRAL · PRE-VISIT INTAKE</small></span></a><div class="top-actions">${cloud?'<button class="nav-btn" data-action="cloud-auth">연결 갱신</button>':''}<span class="demo-label">내부 시험 · 가상 데이터</span><button class="nav-btn ${view==='guardian'?'active':''}" data-action="guardian">보호자 문진</button><button class="nav-btn ${view==='staff'?'active':''}" data-action="staff">${icon('file')}의료진 공간</button>${(cloud||session?.role!=='guardian')?`<button class="icon-btn" title="로그아웃" aria-label="로그아웃" data-action="logout">${icon('logout')}</button>`:''}</div></header>`;}
function foot(){return `<footer><span>전주 센트럴 동물메디컬센터 <span class="muted">· 내부 시험용 MVP</span></span><span>음성 원본 기본 미보관 · 외부 AI 전송 없음</span></footer>`;}
function contact(){return `<div class="contact-callout">${icon('alert')}<div><b>긴급한 상태라면 문진을 기다리지 마세요.</b><p>${session?.phone?`병원에 즉시 연락하세요. <a href="tel:${esc(session.phone.replace(/[^+\d]/g,''))}">${esc(session.phone)}</a>`:'원내에서는 직원에게 즉시 알려 주세요. 원외에서는 병원 또는 가까운 응급 동물병원에 즉시 연락하세요.'}</p>${!session?.phone?'<small>시험 환경: 병원 대표번호 미설정</small>':''}</div></div>`;}
function sidebar(){return `<aside class="intake-side"><div class="eyebrow">진료 전, 미리 들려주세요</div><h2>우리 아이 이야기를<br>충분히 듣는 시간.</h2><p>보호자의 관찰이 더 나은<br>진료의 시작이 됩니다.</p><ol class="steps">${['아이와 보호자 확인','증상 들려주기','조금 더 알아보기','확인하고 제출'].map((label,i)=>`<li class="${step===i?'current':step>i?'done':''}"><span>${step>i?icon('check'):i+1}</span><div>${label}<small>${['가상 환자 · 동의','음성 또는 텍스트','상태에 맞는 후속 질문','위험 징후 · 최종 확인'][i]}</small></div></li>`).join('')}</ol><div class="side-note">${icon('shield')}<p>작성한 문진은 수의사가<br>확인하고 승인합니다.</p></div></aside>`;}
function petCard(){return `<aside class="context-side"><div class="pet-preview"><span class="eyebrow">오늘의 문진</span><div class="pet-avatar">${icon('paw')}</div><h3>${esc(pet().name)} <span>가상 환자</span></h3><p>${esc(pet().breed)} · ${esc(pet().age)}<br>${esc(pet().sex)}</p><div class="divider"></div><dl><dt>방문 유형</dt><dd>${form.visitType==='return'?'재진':'초진'}</dd><dt>작성 예상</dt><dd>약 3–5분</dd><dt>문진 방식</dt><dd>보호자 직접 작성</dd></dl></div><div class="quiet-card">${icon('heart')}<b>보이는 그대로 알려 주세요.</b><p>정확한 의학 용어를 몰라도 괜찮아요. 언제, 어떤 모습이었는지 이야기해 주세요.</p></div><button class="text-btn contact-button" data-action="contact">${icon('alert')}지금 많이 아파 보여요</button></aside>`;}
function consent(){return `<div class="section-heading"><span class="eyebrow">시작하기</span><h1 tabindex="-1">안녕하세요, 보호자님.</h1><p>내원 전, 아이의 상태를 편하게 알려 주세요.</p></div><div class="hospital-line">${icon('home')}<div><strong>전주 센트럴 동물메디컬센터</strong><span>내원 전 보호자 문진 · 내부 시험</span></div><span class="pill green">가상 병원 환경</span></div><h3 class="field-title">문진할 아이를 선택해 주세요</h3><div class="pet-options">${PETS.map(p=>`<label class="pet-option ${form.petId===p.id?'selected':''}"><input type="radio" name="petId" value="${p.id}" ${form.petId===p.id?'checked':''}><span class="small-avatar">${icon('paw')}</span><strong>${p.name}</strong><span>${p.species} · ${p.age}</span></label>`).join('')}</div><div class="split"><div><label class="field-title" for="visitType">이번 방문은 어떤 진료인가요?</label><select id="visitType" name="visitType"><option value="first" ${form.visitType==='first'?'selected':''}>초진 · 새로운 증상 상담</option><option value="return" ${form.visitType==='return'?'selected':''}>재진 · 이전 진료 이후 경과</option></select></div><div class="identity-note">${icon('file')}<p>${esc(pet().owner)}<br><small>실제 이름·연락처를 입력하지 마세요.</small></p></div></div>${form.visitType==='return'?`<div class="info-box"><b>이전 기록 연결은 준비 중입니다.</b><p>${esc(pet().history)}</p><small>실제 인투벳 GE 연동이 아닙니다. 현재 복용약과 병력을 다시 알려 주세요.</small></div>`:''}<h3 class="field-title space">안전한 시험을 위해 확인해 주세요</h3><div class="consents"><label class="checkbox"><input type="checkbox" name="synthetic" ${form.synthetic?'checked':''}><span><b>[필수] 가상 정보만으로 시험합니다.</b><small>본인·가족의 개인정보, 실제 환자 정보를 입력하지 않습니다.</small></span></label><label class="checkbox"><input type="checkbox" name="privacy" ${form.consents.privacy?'checked':''}><span><b>[필수] 문진 정보 처리에 동의합니다.</b><small>가상 환자 식별·증상·답변을 접수와 수의사 검토에 사용합니다. ${cloud?'클라우드에 최대 24시간 보관하며 직접 삭제할 수 있습니다.':demo?'문진은 이 탭에만 최대 24시간 보관됩니다. 새로고침하거나 탭을 닫으면 삭제됩니다.':'이 실행 서버의 메모리에 최대 24시간 보관하며, 직접 삭제하거나 서버를 종료하면 사라집니다.'} 거부하면 문진을 제출할 수 없습니다.</small></span></label><label class="checkbox"><input type="checkbox" name="voice" ${form.consents.voice?'checked':''}><span><b>[선택] 음성을 글자로 변환하는 데 동의합니다.</b><small>기기 내 한국어 인식을 지원할 때만 작동합니다. 외부 음성 서비스로 전환하지 않으며, 미지원 시 텍스트를 이용합니다. 인식된 글은 문진 정보로 제출됩니다. 거부해도 텍스트 문진이 가능합니다.</small></span></label>${cloud?'':`<label class="checkbox"><input type="checkbox" name="retainAudio" ${form.consents.retainAudio?'checked':''} ${!form.consents.voice||cloud?'disabled':''}><span><b>[선택] 시험 음성 원본을 최대 1시간 보관합니다.</b><small>수의사가 인식 오류를 대조할 때만 사용합니다. 최대 60초·1MB이며 자동 삭제 또는 즉시 삭제할 수 있습니다. 동의하지 않으면 이 앱은 원본을 녹음·저장하지 않습니다.</small></span></label>`}</div><div class="inline-note">${icon('shield')}진단·처방을 제공하지 않으며 수의사의 확인이 필요합니다.</div>`;}
function complaint(){return `<div class="section-heading"><span class="eyebrow">보호자 이야기</span><h1 tabindex="-1">${esc(pet().name)}는 어디가 불편한가요?</h1><p>가장 걱정되는 증상을 선택하고, 관찰한 내용을 들려주세요.</p></div><label class="field-title" for="category">가장 주된 증상</label><div class="chips">${CATEGORIES.map(c=>`<button class="chip ${form.category===c.id?'selected':''}" data-category="${c.id}" aria-pressed="${form.category===c.id}">${c.label}</button>`).join('')}</div><div class="voice-card"><div class="voice-orb ${listening?'listening':''}">${icon('mic')}</div><h3>${listening?'듣고 있어요. 편하게 말씀해 주세요.':'말로 들려주셔도 좋아요'}</h3><p>“어제 저녁부터 두 번 토했어요.<br>밥도 평소보다 적게 먹고요.”</p><button class="${listening?'danger':'primary'}" data-action="voice">${icon(listening?'check':'mic')}${listening?'음성 입력 마치기':'음성으로 이야기하기'}</button><small>${form.consents.voice?'기기 내 인식 지원 시 가능 · 최대 60초':'음성 처리 동의 후 사용 가능 · 텍스트 입력은 바로 가능'}</small><div id="voice-message" role="status" aria-live="polite"></div></div><div class="label-row"><label class="field-title" for="complaint">직접 쓰거나, 인식된 내용을 고쳐 주세요</label><button class="text-btn" data-action="sample-complaint">가상 예시 넣기</button></div><textarea id="complaint" name="complaint" rows="5" maxlength="3000" placeholder="언제부터, 어떤 증상이, 얼마나 자주 나타났나요?">${esc(form.complaint)}</textarea><div class="input-meta"><span>이름·전화번호 등 개인정보는 적지 마세요.</span><span id="char-count">${form.complaint.length}/3,000</span></div>${audioBlob?`<p class="inline-note">선택 동의한 시험 음성이 메모리에 준비되었습니다. ${demo?'이 탭에서만 사용합니다.':'제출 전까지 서버로 전송하지 않습니다.'}</p>`:''}<div id="live-risk">${liveRisk()}</div>`;}
function liveRisk(){const flags=assess(form.complaint,form.answers,form.risks);return flags.length?`<div class="risk-banner" role="alert">${icon('alert')}<div><b>확인이 필요한 위험 징후 표현이 있어요.</b><p>${flags.map(f=>esc(f.label)).join(' · ')}</p><small>키워드 후보에는 과거·부정 표현이 포함될 수 있습니다. 현재 상태가 이와 같거나 불확실하면 병원에 즉시 연락하세요.</small><button class="text-btn" data-action="contact">병원 연락 안내 보기</button></div></div>`:'';}
function candidatePreview(complaint) {
  const candidates = extractCandidates(complaint);
  const labels = { onset: '시작 시점', vomitCount: '구토 횟수', mealChange: '식사 변화' };
  return `<section class="info-box"><h2>증상 설명에서 찾은 답변 후보</h2><dl>${Object.entries(labels).map(([field, label]) => {
    const { value, evidence } = candidates[field];
    const display = value === null ? '미확인' : field === 'vomitCount' ? `${value}회` : value;
    return `<dt><strong>${label}</strong></dt><dd>${esc(display)}${evidence ? ` · 원문 <q>${esc(evidence)}</q>` : ''}</dd>`;
  }).join('')}</dl></section>`;
}
function followup(){const qs=questions(form.category,form.complaint,form.visitType,form.answers);return `<div class="section-heading"><span class="eyebrow">맞춤 후속 질문 · ${qs.length}개</span><h1 tabindex="-1">조금만 더 알려 주세요.</h1><p>앞서 알려주신 증상을 바탕으로 필요한 내용을 확인할게요.<br>모르는 항목은 “모름”, 해당하지 않으면 “없음”으로 적어 주세요.</p></div><div class="quote-box"><span>증상 설명</span><p>${esc(form.complaint)}</p><button class="text-btn" data-action="back">증상 설명 수정</button></div>${candidatePreview(form.complaint)}${Object.keys(form.answers).length ? '<p id="answer-recovery" class="info-box">이전에 작성한 답변을 불러왔어요. 증상 설명을 고쳤다면 관련 답변도 수정해 주세요.</p>' : ''}<div class="label-row"><p class="muted">${CATEGORIES.find(c=>c.id===form.category).label} 중심 문진</p><button class="text-btn" data-action="sample-answers">가상 답변 채우기</button></div>${qs.map((q,i)=>`<div class="question"><label for="q-${q.id}"><span class="question-no">${i+1}</span>${esc(q.label)}</label><small id="help-${q.id}">${esc(q.help)}</small><textarea id="q-${q.id}" aria-describedby="help-${q.id}" data-answer="${q.id}" rows="2" maxlength="1200" placeholder="관찰한 내용 또는 모름">${esc(form.answers[q.id]||'')}</textarea></div>`).join('')}<div id="live-risk">${liveRisk()}</div>`;}
function confirmation(){return `<div class="section-heading"><span class="eyebrow">마지막 확인</span><h1 tabindex="-1">위험 징후를 확인해 주세요.</h1><p>현재 모습과 가장 가까운 답을 골라 주세요.<br>“모르겠어요”도 의료진이 확인할 중요한 정보입니다.</p></div>${contact()}<div class="risk-list">${RISKS.map(r=>`<fieldset><legend>${esc(r.label)}</legend><div class="risk-options">${[['yes','예'],['no','아니요'],['unsure','모르겠어요']].map(([v,l])=>`<label class="risk-option ${form.risks[r.id]===v?'chosen '+v:''}"><input type="radio" name="risk-${r.id}" value="${v}" ${form.risks[r.id]===v?'checked':''}>${l}</label>`).join('')}</div></fieldset>`).join('')}</div><div id="live-risk">${liveRisk()}</div><details class="review-details"><summary>제출할 문진 내용 확인</summary><dl><dt>환자 · 방문</dt><dd>${esc(pet().name)} · ${form.visitType==='return'?'재진':'초진'} · 가상 정보</dd><dt>주호소</dt><dd>${esc(form.complaint)}</dd>${questions(form.category,form.complaint,form.visitType,form.answers).map(q=>`<dt>${esc(q.label)}</dt><dd>${esc(form.answers[q.id])}</dd>`).join('')}</dl><p>음성 원본 보관: ${form.consents.retainAudio?'선택 동의 · 녹음이 있는 경우 제출 후 최대 1시간':'동의 안 함 · 원본 녹음 없음'}</p></details><label class="checkbox final-check"><input type="checkbox" id="final-confirm"><span>입력 내용을 확인했습니다. 이 문진은 응급 연락이나 진료를 대체하지 않음을 이해합니다.</span></label>`;}
function receiptView(){return `<main class="receipt-wrap"><section class="receipt card"><span class="success-orb">${icon('check')}</span><span class="eyebrow">문진 제출 완료</span><h1 tabindex="-1">${esc(pet().name)}의 이야기를 전달했어요.</h1><p>수의사가 원문과 문진 초안을 검토합니다.<br>${cloud?'접수 당시에는 <b>검토 대기</b> 상태입니다. 검토 결과는 의료진 공간에서 확인할 수 있습니다.':'지금은 <b>검토 대기</b> 상태입니다. 자동 승인되지 않습니다.'}</p><div class="receipt-id">접수 번호 <b>${esc(receipt.id.slice(0,8).toUpperCase())}</b><small>가상 정보 · ${date(receipt.expiresAt)}까지 보관${cloud?'':demo?' (새로고침·탭 닫기 시 삭제)':' (서버 종료 시 즉시 소멸)'}</small></div>${receipt.flags.length?contact():`<div class="info-box">위험 징후가 체크되지 않았어도 응급 상태가 배제된 것은 아닙니다.<br>상태가 나빠지거나 걱정되면 즉시 병원에 연락해 주세요.</div>`}<div class="button-row"><button class="primary" data-action="new">새 문진 시작 · 화면 비우기</button><button class="secondary" data-action="staff">의료진 검토 시험</button></div><div class="receipt-controls">${chatButton(receipt.id,'접수 담당자와 대화')}<button class="text-btn" data-action="delete-own">제출 자료 삭제</button>${receipt.audioExpiresAt?'<button class="text-btn" data-action="delete-own-audio">음성 원본만 삭제</button>':''}</div><p class="muted small">${esc(SAFETY)}</p></section></main>`;}
function showSubmissionConflict() {
  const notice = $('#submission-conflict');
  if (notice && submission?.conflict) {
    notice.hidden = false;
    notice.textContent = submission.conflict;
  }
}
function guardian(){if(receipt)return receiptView();return `<div class="guardian-layout">${sidebar()}<main class="intake-main"><div class="mobile-progress"><span>단계 ${step+1} / 4</span><progress value="${step+1}" max="4"></progress></div>${[consent,complaint,followup,confirmation][step]()} ${cloud?'<p id="submission-conflict" class="info-box" role="status" hidden></p>':''}<div class="form-actions"><button class="secondary" data-action="back" ${step===0?'disabled':''}>이전</button><span>${step+1} / 4</span><button class="primary" data-action="next" ${busy?'disabled':''}>${busy?'처리 중…':step===3?'문진 제출하기':'다음으로'}</button></div><p class="bottom-hint">${icon('clock')}언제든 천천히 작성하세요. 이 화면의 입력은 제출 전까지 브라우저 메모리에만 있습니다.</p></main>${petCard()}</div>`;}
function login(){return `<main class="login-wrap"><section class="card login"><span class="eyebrow">의료진 전용</span><h1 tabindex="-1">문진 검토 공간</h1><p>접수 담당자는 접수 상태를 확인하고,<br>수의사는 원문 검토·수정·승인·보류를 할 수 있습니다.</p><div class="info-box">${cloud?'이 초대 계정에서 사용할 시연 역할을 선택해 주세요.':demo?'같은 탭에서 제출한 가상 문진을 확인하려면 시연할 역할을 선택해 주세요.':'내부 시험용 접근 코드입니다. 실행 터미널에 표시된 역할별 코드를 입력해 주세요. 실제 운영에서는 직원 개인별 로그인으로 교체해야 합니다.'}</div><form id="login-form"><label for="role">역할</label><select name="role" id="role"><option value="vet">수의사 · 검토 및 승인</option><option value="reception">접수 담당자 · 최소 접수 정보</option></select>${demo||cloud?'':'<label for="code">접근 코드</label><input name="code" id="code" type="password" autocomplete="off" required minlength="8" placeholder="실행 화면의 접근 코드">'}<button class="primary full" type="submit">의료진 공간 열기</button><p id="login-error" class="error-text" role="alert"></p></form><button class="text-btn" data-action="guardian">보호자 화면으로 돌아가기</button></section></main>`;}
function metrics(){return `<div class="metrics">${[['전체 접수',items.length,'file'],['검토 대기',items.filter(x=>x.status==='pending').length,'clock'],['위험 징후 확인',items.filter(x=>x.riskCount>0 && x.status!=='approved').length,'alert'],['승인 완료',items.filter(x=>x.status==='approved').length,'check']].map(([l,n,i])=>`<div class="metric ${i==='alert'?'risk-metric':''}"><span>${l}</span><b>${n}<small>건</small></b>${icon(i)}</div>`).join('')}</div>`;}
function table(){const filtered=items.filter(x=>(filter==='all'||filter==='risk'&&x.riskCount>0||x.status===filter)&&[x.pet.name,x.id,x.pet.species].some(v=>v.toLowerCase().includes(query.toLowerCase())));return `<div class="table-scroll"><table><thead><tr><th>환자</th><th>주요 증상</th><th>접수 시간</th><th>확인 사항</th><th>상태</th><th><span class="sr-only">검토</span></th></tr></thead><tbody>${filtered.length?filtered.map(x=>`<tr class="${selected?.id===x.id?'active-row':''}"><td><div class="patient-cell"><span class="small-avatar">${icon('paw')}</span><div><b>${esc(x.pet.name)}</b><small>${esc(x.pet.species)} · ${esc(x.pet.age)} · ${x.visitType==='return'?'재진':'초진'}</small></div></div></td><td>${CATEGORIES.find(c=>c.id===x.category)?.label||'기타'}</td><td>${date(x.createdAt)}<small class="block muted">${x.id.slice(0,8).toUpperCase()}</small></td><td>${x.riskCount?`<span class="pill red">${icon('alert')}위험 후보 ${x.riskCount}</span>`:'<span class="muted">체크된 징후 없음</span>'}${x.missingCount?`<small class="block muted">미확인 ${x.missingCount}항목</small>`:''}</td><td><span class="status ${x.status}">${statusLabel(x.status)}</span></td><td>${session.role==='vet'?`<button class="secondary compact" data-open="${x.id}">검토하기</button>`:demo?chatButton(x.id,'보호자와 대화'):'<small class="muted">수의사 검토 전용</small>'}</td></tr>`).join(''):`<tr><td colspan="6"><div class="empty-state">${icon('file')}<h3>아직 접수된 문진이 없어요.</h3><p>보호자 화면에서 가상 문진을 제출해 시험해 보세요.</p></div></td></tr>`}</tbody></table></div>`;}
function clinician(){if(session.role==='guardian')return login();return `<main class="staff-main"><div class="staff-title"><div><span class="eyebrow">CLINICAL WORKSPACE</span><h1 tabindex="-1">문진 접수함</h1><p>보호자의 이야기를 먼저 읽고, 진료를 준비하세요.</p></div><div class="staff-title-actions"><span class="pill green">${session.role==='vet'?'수의사':'접수 담당자'} · 시험 세션</span><button class="secondary" data-action="refresh">새로고침</button></div></div>${metrics()}<div class="staff-notice">${icon('shield')}<span>초안은 반드시 원문과 대조하세요. <b>승인 전에는 HPI·SOAP S 복사가 잠겨 있습니다.</b> 위험 후보는 자동 진단이나 응급도 판정이 아닙니다.</span></div><section class="card inbox"><div class="inbox-tools"><div class="tabs">${[['all','전체'],['pending','검토 대기'],['held','보류'],['approved','승인'],['risk','위험 후보']].map(([v,l])=>`<button data-filter="${v}" class="${filter===v?'active':''}">${l}</button>`).join('')}</div><input type="search" id="search" value="${esc(query)}" placeholder="가상 환자명 · 접수번호 검색" aria-label="접수 검색"></div><div id="table-container">${table()}</div></section>${selected?reviewPanel():''}<div class="staff-bottom"><span>인투벳 GE · ${esc(session.emr?.notice||'공식 연동 미확정')} · 현재 복사 방식</span>${session.role==='vet'&&!cloud?'<button class="text-btn" data-action="audit">감사로그 보기</button>':''}</div>${auditOpen?'<section class="card audit"><h2>감사로그</h2><p>원문·음성·접근 코드를 기록하지 않습니다. 최대 24시간 보관합니다.</p><div id="audit-content"></div></section>':''}</main>`;}
function reviewPanel(){const r=selected;return `<section class="card review-panel" id="review-panel"><div class="review-header"><div><span class="eyebrow">수의사 검토</span><h2 tabindex="-1">${esc(r.pet.name)} <span class="status ${r.status}">${statusLabel(r.status)}</span></h2><p>${r.id.slice(0,8).toUpperCase()} · ${date(r.createdAt)} · 문서 버전 ${r.version}</p></div><div class="button-row review-actions">${cloud?`<button class="secondary compact" data-open="${esc(r.id)}">최신 기록 다시 열기</button>`:''}<button class="secondary compact" data-action="close-review">검토창 닫기</button></div></div>${r.draft.flags.length?`<div class="risk-banner">${icon('alert')}<div><b>위험 후보 ${r.draft.flags.length}건 · 직접 확인이 필요합니다.</b><ul>${r.draft.flags.map(f=>`<li>${esc(f.label)} <small>· ${esc(f.source)}</small></li>`).join('')}</ul><small>과거·부정 표현을 자동으로 배제하지 않습니다. 현재 상태와 연락 필요성을 직접 판단하세요.</small></div></div>`:'<p class="info-box">위험 징후가 체크되지 않았어도 응급 상태 배제를 뜻하지 않습니다.</p>'}<div class="clinical-strip"><div><strong>문제목록 · 보호자 표현</strong><p>${esc(r.draft.problems.join('\n'))}</p></div><div><strong>시간 흐름</strong>${r.draft.timeline.map(t=>`<p>${t.label}: ${esc(t.text)}</p>`).join('')}</div><div><strong>약물 · 기왕력</strong><p>복용약: ${esc(r.draft.meds)}<br>병력: ${esc(r.draft.history)}</p></div></div><div class="parallel"><article class="source-pane"><div class="pane-title"><h3>보호자 원문</h3><span class="pill">수정 불가</span></div><p class="source-label">주호소</p><p class="source-text">${esc(r.complaint)}</p>${questions(r.category,r.complaint,r.visitType,r.answers).map(q=>`<div class="source-answer"><b>${esc(q.label)}</b><p>${esc(r.answers[q.id]||'미확인')}</p></div>`).join('')}<details><summary>위험 체크 · 동의 내역 확인</summary><ul>${RISKS.map(risk=>`<li>${esc(risk.label)}: ${esc({yes:'예',no:'아니요',unsure:'모름'}[r.risks[risk.id]])}</li>`).join('')}</ul><p>동의 ${esc(r.consents.version)} / ${date(r.consents.at)}<br>정보 처리: 동의 · 음성 처리: ${r.consents.voice?'동의':'미동의'} · 원본 보관: ${r.consents.retainAudio?'동의':'미동의'}</p></details>${r.visitType==='return'?`<div class="info-box">${esc(r.pet.history)}<br>인투벳 GE 연결 없음 · 보호자 보고와 별도 확인</div>`:''}${r.audioAvailable?`<div class="audio-box"><p>선택 동의한 원본 · ${date(r.audioExpiresAt)} 자동 삭제</p><button class="secondary compact" data-action="play-audio">음성 대조하기</button><button class="text-btn" data-action="delete-audio">원본 즉시 삭제</button><div id="audio-player"></div></div>`:'<p class="muted small">보관 중인 음성 원본 없음</p>'}</article><article class="draft-pane"><div class="pane-title"><h3>문진 요약 초안</h3><span class="pill green">결정적 규칙 엔진</span></div><div class="missing-box"><b>누락·불확실 정보</b><p>${r.draft.missing.length?r.draft.missing.map(esc).join(' · '):'추가 문진으로 재확인 필요'}</p></div><div class="tabs document-tabs"><button class="${activeRecordTab==='hpi'?'active':''}" data-doc="hpi" aria-pressed="${activeRecordTab==='hpi'}">HPI</button><button class="${activeRecordTab==='soapS'?'active':''}" data-doc="soapS" aria-pressed="${activeRecordTab==='soapS'}">SOAP · S</button></div><label class="sr-only" for="review-hpi">HPI 수정</label><textarea id="review-hpi" class="document-editor ${activeRecordTab!=='hpi'?'hidden':''}" rows="18" maxlength="14000">${esc(r.working?.hpi??r.review?.hpi??r.draft.hpi)}</textarea><label class="sr-only" for="review-soapS">SOAP S 수정</label><textarea id="review-soapS" class="document-editor ${activeRecordTab!=='soapS'?'hidden':''}" rows="18" maxlength="15000">${esc(r.working?.soapS??r.review?.soapS??r.draft.soapS)}</textarea>${cloud&&reviewEdits.has(r.id)?`<details class="review-details"><summary>현재 저장본 확인 · 내 수정은 입력란에 유지</summary><p>HPI</p><pre class="source-text">${esc(r.review?.hpi??r.draft.hpi)}</pre><p>SOAP S</p><pre class="source-text">${esc(r.review?.soapS??r.draft.soapS)}</pre></details>`: ''}<p class="small muted">보호자 진술을 구조화한 초안입니다. O·A·P, 진단, 처방은 생성하지 않습니다. HPI와 SOAP S는 각각 확인해 주세요.</p><label for="review-note" class="field-title">검토 메모 / 보류 사유</label><textarea id="review-note" rows="2" maxlength="1000" placeholder="보류 시 사유를 입력하세요.">${esc(r.working?.note??r.review?.note??'')}</textarea></article></div><div class="review-approval"><div><label class="checkbox"><input id="source-confirmed" type="checkbox"><span>원문·누락정보와 HPI·SOAP S를 모두 대조했습니다.</span></label>${r.draft.flags.length?'<label class="checkbox"><input id="risk-confirmed" type="checkbox"><span>위험 후보와 현재 상태를 확인하고 연락·내원 필요성을 직접 판단했습니다.</span></label>':''}</div><div class="button-row"><button class="secondary" data-action="hold">보류하기</button><button class="primary" data-action="approve">${icon('check')}수정 내용 승인</button></div></div><div class="export-bar"><span>${r.status==='approved'?`수의사 승인본 · ${date(r.review.at)}`:'승인 전 · EMR 전달 잠금'}</span><div class="button-row"><button class="secondary compact" data-export="hpi" ${r.status!=='approved'?'disabled':''}>${icon('copy')}HPI 복사</button><button class="secondary compact" data-export="soapS" ${r.status!=='approved'?'disabled':''}>${icon('copy')}SOAP S 복사</button></div></div><div id="copy-fallback"></div><button class="text-btn delete-link" data-action="delete-record">${cloud?'이 가상 문진 삭제':'이 가상 문진과 음성 삭제'}</button></section>`;}
function render(){ document.querySelector('dialog[aria-label="문진 대화"]')?.close(); if(playbackURL){URL.revokeObjectURL(playbackURL);playbackURL=null;} $('#app').innerHTML=header()+(view==='guardian'?guardian():clinician())+(view==='guardian' && session.role==='guardian' && guardianChat && !receipt ? `<div class="button-row">${chatButton(guardianChat,'이전 문진 대화 열기')}</div>` : '')+foot(); showSubmissionConflict(); }
function top(){window.scrollTo({top:0,behavior:'smooth'});$('main h1')?.focus({preventScroll:true});}
async function refresh(){items=(await api('/api/intakes')).items;}
async function stopVoice(){
  listening=false;clearTimeout(voiceTimer);speech?.stop();speech=null;
  if(recorder && recorder.state!=='inactive'){stopRecordingPromise=new Promise(resolve=>recorder.addEventListener('stop',resolve,{once:true}));recorder.stop();await stopRecordingPromise;}
  stream?.getTracks().forEach(t=>t.stop());stream=null;recorder=null;
}
async function startVoice(){
  const signal=cloudRequests?.signal;
  if(listening){await stopVoice();if(!signal?.aborted)render();return;}
  if(!form.consents.voice){toast('첫 단계에서 선택 음성 처리 동의를 체크해 주세요.',true);return;}
  const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!Speech){toast('이 브라우저는 기기 내 한국어 음성 인식을 지원하지 않습니다. 아래 입력란에 작성해 주세요.',true);$('#complaint')?.focus();return;}
  const r=new Speech();
  if(!('processLocally' in r)){toast('외부 전송 없는 음성 인식을 지원하지 않습니다. 텍스트로 이어가 주세요.',true);$('#complaint')?.focus();return;}
  r.processLocally=true;r.lang='ko-KR';r.continuous=true;r.interimResults=false;
  try {
    if (Speech.available) {
      const options = { langs: ['ko-KR'], processLocally: true };
      const availability = await Speech.available(options);
      if(signal?.aborted)return;
      if (availability === 'downloadable' && Speech.install) {
        const message = $('#voice-message');
        if (!message) return;
        const install = document.createElement('button');
        install.className = 'secondary';
        install.textContent = '한국어 받아쓰기 팩 설치';
        install.onclick = async () => {
          install.disabled = true;
          try {
            const ready = await Speech.install(options);
            if(!signal?.aborted)toast(ready ? '설치했습니다. 음성으로 이야기하기를 다시 눌러 주세요.' : '한국어 팩을 설치하지 못했습니다.', !ready);
          } catch { if(!signal?.aborted)toast('한국어 팩을 설치하지 못했습니다. 텍스트로 입력해 주세요.', true); }
          finally { install.remove(); }
        };
        message.replaceChildren(install);
        return;
      }
      if (availability !== 'available') throw new Error(availability === 'downloading' ? '한국어 팩을 받는 중입니다. 완료 후 다시 눌러 주세요.' : '이 기기에서는 한국어 받아쓰기를 사용할 수 없습니다. 텍스트로 입력해 주세요.');
    }
    if(form.consents.retainAudio){
      if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw new Error('이 기기는 원본 녹음을 지원하지 않습니다. 원본 보관 선택을 해제하거나 텍스트를 이용해 주세요.');
      stream=await navigator.mediaDevices.getUserMedia({audio:true});recorder=new MediaRecorder(stream);const chunks=[];
      recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.onstop=()=>{const blob=new Blob(chunks,{type:recorder.mimeType.split(';')[0]});audioBlob=form.consents.retainAudio&&blob.size<=1000000?blob:null;if(blob.size>1000000)toast('원본이 1MB를 넘어 보관하지 않습니다. 인식된 글은 유지됩니다.',true);};recorder.start();
    }
    speech=r;listening=true;
    r.onresult=e=>{if(signal?.aborted)return;for(let i=e.resultIndex;i<e.results.length;i++)if(e.results[i].isFinal)form.complaint=(form.complaint+' '+e.results[i][0].transcript).trim().slice(0,3000);if($('#complaint'))$('#complaint').value=form.complaint;updateLive();};
    r.onerror=async()=>{if(signal?.aborted)return;await stopVoice();if(signal?.aborted)return;render();toast('음성 인식을 완료하지 못했습니다. 인식된 글을 확인하고 텍스트로 이어가 주세요.',true);};
    r.onend=async()=>{if(listening&&!signal?.aborted){await stopVoice();if(!signal?.aborted)render();}};
    r.start();voiceTimer=setTimeout(async()=>{await stopVoice();if(signal?.aborted)return;render();toast('60초 입력을 마쳤습니다. 인식된 내용을 확인해 주세요.');},60000);render();
  } catch(e){if(signal?.aborted)return;await stopVoice();if(signal?.aborted)return;render();toast(e.message||'마이크 사용에 실패했습니다. 텍스트로 이어가 주세요.',true);}
}
function updateLive(){if($('#live-risk'))$('#live-risk').innerHTML=liveRisk();if($('#char-count'))$('#char-count').textContent=`${form.complaint.length}/3,000`;}
function syncReview(){
  if(!selected||!$('#review-hpi'))return;
  const working={hpi:$('#review-hpi').value,soapS:$('#review-soapS').value,note:$('#review-note').value};
  selected.working=working;
  if (cloud && Object.keys(working).some(key => working[key] !== (selected.review?.[key] ?? selected.draft[key] ?? '')))
    reviewEdits.set(selected.id, working);
  else if (cloud) reviewEdits.delete(selected.id);
}
async function review(status, button){
  syncReview();const w=selected.working;
  if(cloud)reviewEdits.set(selected.id,w);
  const panel=$('#review-panel');
  const signal=cloudRequests?.signal;
  if(cloud){busy=true;panel.inert=true;}
  let updated;
  try{updated=await api(`/api/intakes/${selected.id}/review`,{method:'POST',body:{...w,version:selected.version,status,confirmed:$('#source-confirmed').checked,riskAcknowledged:$('#risk-confirmed')?.checked||false}});
  }finally{
    if(cloud&&!signal.aborted){
      busy=false;
      panel.inert=false;
      if (!updated) {
        button.disabled=false;
        button.focus({preventScroll:true});
      }
    }
  }
  reviewEdits.delete(updated.id);
  selected=updated;
  if(cloud)items=items.map(item=>item.id===updated.id?{...item,status:updated.status,version:updated.version}:item);
  else await refresh();
  render();toast(status==='approved'?'수의사 승인 완료. 승인본을 복사할 수 있습니다.':'보류했습니다. 복사는 계속 잠겨 있습니다.');$('#review-panel h2')?.focus({preventScroll:true});$('#review-panel')?.scrollIntoView({block:'start'});
}
async function exportRecord(kind){
  const signal=cloudRequests?.signal;
  $('#copy-fallback').replaceChildren();
  if($('#review-hpi').value!==selected.review.hpi||$('#review-soapS').value!==selected.review.soapS){toast('승인 후 수정된 내용이 있습니다. 다시 승인한 뒤 복사해 주세요.',true);return;}
  const {text}=await api(`/api/intakes/${selected.id}/export`,{method:'POST',body:{kind,version:selected.version}});
  try{await navigator.clipboard.writeText(text);if(!signal?.aborted)toast('승인본을 복사했습니다. EMR 환자와 붙여넣을 위치를 다시 확인해 주세요.');}catch{if(signal?.aborted)return;$('#copy-fallback').innerHTML=`<label for="copy-text">자동 복사가 허용되지 않았습니다. 승인본을 직접 선택해 복사해 주세요.</label><textarea id="copy-text" rows="8" readonly>${esc(text)}</textarea>`;$('#copy-text').focus();$('#copy-text').select();}
}
async function next(){
  const signal=cloudRequests?.signal;
  if(step===0){if(!form.synthetic||!form.consents.privacy)throw new Error('가상 정보 사용 확인과 필수 정보 처리 동의가 필요합니다.');}
  if(step===1){await stopVoice();if(signal?.aborted)return;if(!form.complaint.trim()){$('#complaint').focus();throw new Error('증상을 말하거나 직접 입력해 주세요.');}const allowed=new Set(questions(form.category,form.complaint,form.visitType,form.answers).map(q=>q.id));form.answers=Object.fromEntries(Object.entries(form.answers).filter(([k])=>allowed.has(k)));}
  if(step===2){const empty=questions(form.category,form.complaint,form.visitType,form.answers).find(q=>!form.answers[q.id]?.trim());if(empty){if(!$(`#q-${empty.id}`)){render();toast('답변 내용에 따라 후속 질문을 추가했습니다.');}$(`#q-${empty.id}`)?.focus();throw new Error('모든 질문에 답해 주세요. 모르면 “모름”이라고 적을 수 있습니다.');}}
  if(step===3){
    const unanswered=RISKS.find(r=>!form.risks[r.id]);
    if(unanswered){
      $(`input[name="risk-${unanswered.id}"]`).focus();
      throw new Error('위험 징후를 모두 확인해 주세요. 모르면 “모르겠어요”를 골라 주세요.');
    }
    if(!$('#final-confirm').checked){
      $('#final-confirm').focus();
      throw new Error('입력 내용 최종 확인을 체크해 주세요.');
    }
    busy=true;
    try {
      const payload={...structuredClone(form),finalConfirm:true};
      if(form.consents.retainAudio&&audioBlob){
        const bytes=new Uint8Array(await audioBlob.arrayBuffer());
        let binary='';
        for(const byte of bytes)binary+=String.fromCharCode(byte);
        payload.audio={type:audioBlob.type,base64:btoa(binary)};
      }
      if (cloud) submission ??= { id: crypto.randomUUID() };
      receipt=await api('/api/intakes',{method:'POST',body:payload,
        headers:cloud?{'Idempotency-Key':submission.id}:undefined});
      if(demo)guardianChat=receipt.id;
      audioBlob=null;
    } catch (error) {
      if (signal?.aborted || !cloud || !submission || error.existingSubmissionId !== submission.id) throw error;
      submission.conflict = `첫 제출이 이미 접수되었습니다 (접수 번호 ${submission.id.slice(0,8).toUpperCase()}). 의료진 공간에서 첫 접수본을 확인할 수 있습니다. 이후 수정 내용은 이 화면에 남아 있습니다.`;
      showSubmissionConflict();
      return;
    } finally { if(!signal?.aborted)busy=false; }
    render();top();return;
  }
  step++;render();top();
}
$('#app').addEventListener('input',e=>{const t=e.target;if(['review-hpi','review-soapS','review-note'].includes(t.id))syncReview();if(t.name==='complaint'){form.complaint=t.value;updateLive();}if(t.dataset.answer){form.answers[t.dataset.answer]=t.value;updateLive();}if(t.id==='search'){query=t.value;$('#table-container').innerHTML=table();}});
$('#app').addEventListener('change',async e=>{const t=e.target;if(['petId','visitType'].includes(t.name)){form[t.name]=t.value;render();}if(t.name==='synthetic')form.synthetic=t.checked;if(['privacy','voice','retainAudio'].includes(t.name)){form.consents[t.name]=t.checked;if(!form.consents.voice){form.consents.retainAudio=false;await stopVoice();audioBlob=null;}if(t.name==='retainAudio'&&!t.checked){await stopVoice();audioBlob=null;}render();}if(t.name.startsWith('risk-')){
  form.risks[t.name.slice(5)]=t.value;
  for(const input of t.closest('fieldset').querySelectorAll('input')){
    input.closest('label').className=`risk-option${input.checked?' chosen '+input.value:''}`;
  }
  updateLive();
}});
$('#app').addEventListener('submit', async e => {
  if (e.target.id !== 'login-form') return;
  e.preventDefault();
  if (cloudActionPending) return;
  const signal = cloudRequests?.signal;
  const button = e.target.querySelector('[type="submit"]');
  if (cloud) {
    cloudActionPending = true;
    button.disabled = true;
  }
  try {
    const data = new FormData(e.target);
    const headers = { 'X-Demo-Role': data.get('role') };
    const login = cloud ? await api('/api/session', { headers })
      : await api('/api/login', { method: 'POST', body: { role: data.get('role'), code: data.get('code') } });
    if (cloud) items = (await api('/api/intakes', { headers })).items;
    session = { ...session, ...login };
    if (!cloud) {
      form = blank(); receipt = null; step = 0; audioBlob = null;
      await refresh();
    }
    render();
    top();
  } catch (error) {
    if (!signal?.aborted) $('#login-error').textContent = error.message;
  } finally {
    if (!signal?.aborted && cloud) {
      cloudActionPending = false;
      button.disabled = false;
    }
  }
});
$('#app').addEventListener('click',async e=>{
  const button=e.target.closest('button');if(!button||button.disabled||busy||cloudActionPending)return;button.disabled=true;
  const signal=cloudRequests?.signal;
  if(cloud)cloudActionPending=true;
  try {
    if(button.dataset.category){form.category=button.dataset.category;render();return;}
    if(button.dataset.filter){filter=button.dataset.filter;render();return;}
    if(button.dataset.chat){await openChat(button.dataset.chat);return;}
    if(button.dataset.open){
      if(cloud)syncReview();
      selected=await api(`/api/intakes/${button.dataset.open}`);if(cloud&&reviewEdits.has(selected.id))selected.working=reviewEdits.get(selected.id);
      activeRecordTab='hpi';render();
      $('#review-panel h2').focus({preventScroll:true});
      $('#review-panel').scrollIntoView();
      return;
    }
    if(button.dataset.doc){activeRecordTab=button.dataset.doc;for(const kind of ['hpi','soapS'])$(`#review-${kind}`).classList.toggle('hidden',kind!==activeRecordTab);for(const tab of document.querySelectorAll('[data-doc]')){
      const active=tab.dataset.doc===activeRecordTab;
      tab.classList.toggle('active',active);
      tab.setAttribute('aria-pressed',String(active));
    }return;}
    if(button.dataset.export){await exportRecord(button.dataset.export);return;}
    const action=button.dataset.action;
    if(action==='cloud-auth')connectCloud();
    if(action==='next')await next();
    if(action==='back'){await stopVoice();if(signal?.aborted)return;step=Math.max(0,step-1);render();top();}
    if(action==='guardian'){await stopVoice();if(signal?.aborted)return;if(session.role!=='guardian'){if(cloud){syncReview();session={...session,role:'guardian'};}else{await api('/api/logout',{method:'POST',body:{}});session=await api('/api/session');form=blank();receipt=null;audioBlob=null;step=0;}selected=null;items=[];auditOpen=false;}view='guardian';render();top();}
    if(action==='staff'){await stopVoice();if(signal?.aborted)return;view='staff';if(session.role!=='guardian')await refresh();render();top();}
    if(action==='logout'){guardianChat=null;await stopVoice();if(signal?.aborted)return;if(cloud){clearCloud();return;}await api('/api/logout',{method:'POST',body:{}});session=await api('/api/session');selected=null;items=[];auditOpen=false;form=blank();receipt=null;audioBlob=null;view='guardian';step=0;render();}
    if(action==='voice')await startVoice();
    if(action==='sample-complaint'){form.complaint='어제 저녁부터 두 번 토했어요. 오늘 아침 사료를 절반 정도 먹었고 평소보다 기운이 조금 없어요.';render();}
    if(action==='sample-answers'){const defaults={onset:'가상 답변: 어제 오후 8시',course:'가상 답변: 어제 1회, 오늘 아침 1회. 이후 관찰 중',daily:'가상 답변: 식사 절반, 물과 소변 평소와 비슷함',meds:'없음',history:'모름',vomit:'가상 답변: 노란 액체 2회, 피는 관찰 못함',exposure:'가상 답변: 최근 사료 변경 없음',followup:'가상 답변: 지난 진료와 다른 증상'};for(let pass=0;pass<2;pass++)for(const q of questions(form.category,form.complaint,form.visitType,form.answers))form.answers[q.id]=defaults[q.id]||'모름';render();toast('가상 답변을 채웠습니다. 시험 목적에 맞게 수정해 주세요.');}
    if(action==='contact'){const dialog=document.createElement('dialog');dialog.className='contact-dialog';dialog.innerHTML=`<h2>문진보다 연락이 먼저예요.</h2>${contact()}<p>${esc(SAFETY)}</p><form method="dialog"><button class="primary">안내 확인</button></form>`;document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();}
    if(action==='new'){submission=null;guardianChat=null;form=blank();receipt=null;step=0;audioBlob=null;render();top();}
    if(action==='refresh'){
      await refresh();
      if(cloud)syncReview();
      render();toast('최신 접수 목록을 불러왔습니다.');
    }
    if(action==='close-review'){
      if(cloud)syncReview();
      const id=selected.id;
      selected=null;render();
      $(`[data-open="${CSS.escape(id)}"]`)?.focus();
    }
    if(action==='approve')await review('approved',button);
    if(action==='hold')await review('held',button);
    if(['delete-own','delete-record','delete-own-audio','delete-audio'].includes(action)){
      const isAudio=action.includes('audio');if(!confirm(isAudio?'보관한 시험 음성을 즉시 삭제할까요?':cloud?'가상 문진과 검토 이력을 삭제할까요? 이 작업은 되돌릴 수 없습니다.':'가상 문진과 음성을 삭제할까요? 이 작업은 되돌릴 수 없습니다.'))return;
      const id=action.includes('own')?receipt.id:selected.id;
      if(!isAudio && klatRooms.has(id)){await klatRequest(klatRooms.get(id),'DELETE');klatRooms.delete(id);}
      await api(`/api/intakes/${id}${isAudio?'/audio':''}`,{method:'DELETE',body:cloud&&action==='delete-record'?{version:selected.version}:{}});
      if(!isAudio && guardianChat===id)guardianChat=null;
      if (action === 'delete-own' || (cloud && action === 'delete-record' && receipt?.id === id)) {
        receipt = null;
        form = blank();
        step = 0;
        audioBlob = null;
      }
      if (action === 'delete-own' || (cloud && action === 'delete-record' && submission?.id === id)) {
        submission = null;
      }
      if (action === 'delete-record') {
        reviewEdits.delete(id);
        selected = null;
        if (cloud) items = items.filter(item => item.id !== id);
        else await refresh();
      }
      if (action === 'delete-audio') selected = await api(`/api/intakes/${id}`);
      if (action === 'delete-own-audio') receipt.audioExpiresAt = null;
      render();
      if (cloud) top();
      toast(isAudio?'음성 원본을 삭제했습니다.':cloud?'문진과 검토 이력을 삭제했습니다.':'문진과 음성을 삭제했습니다.');
    }
    if(action==='play-audio'){const path=`/api/intakes/${selected.id}/audio`;let blob;if(demo){blob=demo.request(path);}else{const res=await fetch(path);if(!res.ok)throw new Error('음성이 없거나 보관 기간이 지났습니다.');blob=await res.blob();}if(playbackURL)URL.revokeObjectURL(playbackURL);const url=URL.createObjectURL(blob);playbackURL=url;$('#audio-player').innerHTML='<audio controls></audio>';const el=$('#audio-player audio');el.src=url;el.onended=()=>{URL.revokeObjectURL(url);playbackURL=null;el.removeAttribute('src');};el.play().catch(()=>{});}
    if(action==='audit'){auditOpen=!auditOpen;render();if(auditOpen){const data=await api('/api/audit');$('#audit-content').innerHTML=`<div class="table-scroll"><table><thead><tr><th>시각</th><th>역할·시험 식별자</th><th>작업</th><th>대상</th></tr></thead><tbody>${data.items.map(x=>`<tr><td>${date(x.at)}</td><td>${esc(x.actor)}</td><td>${esc(x.action)}</td><td>${esc(x.target.slice(0,8))}</td></tr>`).join('')}</tbody></table></div>`;$('.audit').scrollIntoView({behavior:'smooth'});}}
  }catch(err){if(!signal?.aborted)toast(err.message,true);}finally{if(!signal?.aborted)cloudActionPending=false;if(button.isConnected)button.disabled=false;}
});
window.addEventListener('pagehide',()=>{speech?.abort();stream?.getTracks().forEach(t=>t.stop());audioBlob=null;});
if (cloud) connectCloud();
else try{session=await api('/api/session');if(session.role!=='guardian'){view='staff';await refresh();}render();}catch(e){$('#app').innerHTML=`<main class="card"><h1 tabindex="-1">앱을 불러오지 못했습니다.</h1><p>${esc(e.message)}</p><p>실행 서버가 켜져 있는지 확인하고 새로고침해 주세요.</p></main>`;}

let idleTimer;
function resetIdle(){clearTimeout(idleTimer);idleTimer=setTimeout(async()=>{guardianChat=null;await stopVoice();if(cloud){clearCloud();return;}try{await api('/api/logout',{method:'POST',body:{}});}catch{} form=blank();receipt=null;selected=null;items=[];audioBlob=null;auditOpen=false;step=0;view='guardian';try{session=await api('/api/session');render();toast('15분 동안 사용하지 않아 화면과 세션을 비웠습니다.');}catch{location.reload();}},15*60*1000);}
for(const event of ['pointerdown','keydown'])window.addEventListener(event,resetIdle,{passive:true});resetIdle();
