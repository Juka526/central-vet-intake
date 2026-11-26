const appId = '1f7c0870-dcc2-4895-ab50-777608c94c5d';
const inviteDigest = 'ce20d0d6ee5b9c125e23e4dae5376872eaa2131dcfc7df56b209a705d7d23ec8';
const rooms = /^\/api\/klat\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;

function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function authorized(request) {
  const invite = request.headers.get('Authorization')?.match(/^Bearer ([0-9a-f]{40})$/)?.[1];
  if (!invite) return false;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(invite));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('') === inviteDigest;
}

async function klat(env, path, method = 'GET', body) {
  const r = await fetch('https://api.talkplus.io/v1.4/api' + path, {
    method, redirect: 'manual',
    headers: { 'app-id': appId, 'api-key': env.KLAT_API_KEY, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const result = await r.json().catch(() => ({ error: true, code: r.status }));
  if (!r.ok || result.error) {
    const error = new Error('Klat 요청에 실패했습니다.');
    error.code = String(result.code ?? r.status);
    throw error;
  }
  return result;
}

async function chat(request, env, room) {
  if (!await authorized(request)) return json({ error: 'Klat 시연 링크로 열어 주세요.' }, 403);
  if (!env.KLAT_API_KEY) return json({ error: 'Klat 키가 설정되지 않았습니다.' }, 503);
  const channelId = 'cvd-' + room;
  const channel = '/channels/' + channelId;
  try {
    if (request.method === 'DELETE') {
      await klat(env, channel, 'DELETE');
      return json({ ok: true });
    }
    if (request.method === 'PUT') {
      try {
        await klat(env, channel);
      } catch (error) {
        if (error.code !== '2003') throw error;
        await klat(env, '/channels/create', 'POST', { channelId, type: 'private', name: '가상 문진 대화' });
      }
      return json({ ok: true });
    }
    if (request.method === 'GET') {
      const result = await klat(env, channel + '/messages?limit=50&order=latest');
      return json(result.messages.filter(m => ['guardian','reception'].includes(m.data?.role))
        .reverse().map(m => ({ role: m.data.role, text: m.text })));
    }
    if (request.method !== 'POST') return json({ error: '지원하지 않는 요청입니다.' }, 405);
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) return json({ error: 'JSON 요청이 필요합니다.' }, 415);
    const b = await request.json().catch(() => null);
    if (!['guardian','reception'].includes(b?.role) || typeof b.text !== 'string' || !b.text.trim() || b.text.length > 500)
      return json({ error: '시연 역할과 메시지(1~500자)를 확인해 주세요.' }, 400);
    const result = await klat(env, channel + '/messages/admin/send', 'POST', {
      text: b.text.trim(), data: { role: b.role }, disablePushNotification: true
    });
    return json({ role: b.role, text: result.message.text }, 201);
  } catch (error) {
    if (request.method === 'DELETE' && error.code === '2003') return json({ ok: true });
    const code = /^\d{3,6}$/.test(error.code ?? '') ? error.code : '연결 오류';
    return json({ error: 'Klat 요청 실패 (' + code + ')' }, 502);
  }
}

async function intake(request, env, path) {
  const probe = path === '/api/intake/storage-check';
  if (probe && request.method !== 'POST') return json({ error: 'POST required' }, 405);
  if (!probe && !['GET', 'POST', 'DELETE'].includes(request.method))
    return json({ error: '지원하지 않는 요청입니다.' }, 405);
  if (!probe && request.headers.get('Origin') && request.headers.get('Origin') !== new URL(request.url).origin)
    return json({ error: '허용되지 않은 출처입니다.' }, 403);
  const target = env.INTAKE_API_ORIGIN || (typeof builtIntakeApiOrigin === 'string' && builtIntakeApiOrigin);
  if (!target) return json({ error: 'Cloud Run is not configured' }, 503);
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Cloud Run identity token required' }, 401);
  try {
    const origin = new URL(target);
    if (origin.protocol !== 'https:' || !origin.hostname.endsWith('.run.app') || origin.origin !== target)
      return json({ error: 'Invalid Cloud Run origin' }, 503);
    const headers = new Headers({ [probe ? 'Authorization' : 'X-Serverless-Authorization']: auth });
    if (!probe) {
      for (const name of ['Content-Type', 'X-Demo-Role', 'Idempotency-Key']) {
        if (request.headers.has(name)) headers.set(name, request.headers.get(name));
      }
    }
    const result = await fetch(origin.origin + path, {
      method: request.method, headers, redirect: 'manual',
      body: probe || request.method === 'GET' ? undefined : request.body,
    });
    if (result.status >= 300 && result.status < 400) return json({ error: 'Unexpected upstream redirect' }, 502);
    const type = result.headers.get('Content-Type');
    const audio = request.method === 'GET' && path.endsWith('/audio') &&
      result.status === 200 && ['audio/webm', 'audio/ogg', 'audio/mp4'].includes(type);
    if (!probe && !audio && !type?.includes('application/json')) {
      if ([401, 403].includes(result.status)) return json({ error: '초대 권한과 ID 토큰을 확인해 주세요.' }, result.status);
      return json({ error: '클라우드 문진에 연결하지 못했습니다.' }, 502);
    }
    return new Response(result.body, { status: result.status, headers: {
      'Content-Type': type || 'application/json',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    } });
  } catch { return json({ error: 'Cloud Run unavailable' }, 502); }
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/api/intake/audio-cleanup' && request.method !== 'POST')
      return json({ error: 'POST required' }, 405);
    if (path === '/api/intake/audio-cleanup' || path === '/api/intake/storage-check' || path === '/api/session' || path === '/api/intakes' ||
        /^\/api\/intakes\/[0-9a-f-]{36}(?:\/(review|export|audio))?$/.test(path)) return intake(request, env, path);
    if (path === '/api/klat/status' && request.method === 'GET') {
      // A fixed, synthetic lookup checks authentication without returning customer data.
      try {
        await klat(env, '/channels/cvd-readiness-probe');
        return json({ connected: true });
      } catch (error) {
        if (error.code === '2003') return json({ connected: true });
        return json({ connected: false, code: /^\d{3,6}$/.test(error.code ?? '') ? error.code : 'network' }, 503);
      }
    }
    const room = rooms.exec(path);
    if (room) return chat(request, env, room[1]);
    const file = files[path === '/' ? '/index.html' : path];
    if (!Array.isArray(file)) return new Response('Not found', { status: 404 });
    if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    return new Response(request.method === 'HEAD' ? null : file[1], { headers: {
      'Content-Type': file[0] + '; charset=utf-8', 'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    } });
  }
};
