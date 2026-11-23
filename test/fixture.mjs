import {PETS,RISKS,CONSENT_VERSION,questions} from '../lib/engine.mjs';
export function fixture(overrides={}) {
 const f={synthetic:true,finalConfirm:true,petId:PETS[0].id,visitType:'first',category:'digestive',complaint:'어제 저녁부터 구토 두 번',answers:{},risks:Object.fromEntries(RISKS.map(r=>[r.id,'no'])),consents:{privacy:true,voice:false,retainAudio:false,version:CONSENT_VERSION},...overrides};
 f.answers=Object.fromEntries(questions(f.category,f.complaint,f.visitType).map(q=>[q.id,({onset:'어제 저녁',course:'두 번',meds:'없음',history:'모름'})[q.id]||'모름']));return f;
}
