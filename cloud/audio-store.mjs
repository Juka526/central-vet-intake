const prefix = 'intake-audio/';

export function privateAudio({ bucket, token, origin = 'https://storage.googleapis.com', request = fetch }) {
  const objects = '/b/' + encodeURIComponent(bucket) + '/o';
  const api = origin + '/storage/v1' + objects;
  const object = key => api + '/' + encodeURIComponent(prefix + key);

  async function call(url, options = {}, allowed = []) {
    const response = await request(url, {
      ...options, redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { ...options.headers, Authorization: 'Bearer ' + await token() },
    });
    if (!response.ok && !allowed.includes(response.status)) throw new Error('Audio storage request failed');
    return response;
  }

  async function remove(key) {
    await call(object(key), { method: 'DELETE' }, [404]);
  }

  return {
    async put(key, type, bytes) {
      const query = new URLSearchParams({ uploadType: 'media', ifGenerationMatch: '0', name: prefix + key });
      await call(origin + '/upload/storage/v1' + objects + '?' + query, {
        method: 'POST', headers: { 'Content-Type': type }, body: bytes,
      });
    },
    async get(key) {
      const response = await call(object(key) + '?alt=media', {}, [404]);
      return response.status === 404 ? null : Buffer.from(await response.arrayBuffer());
    },
    remove,
    async sweep(now) {
      // The exclusive end offset sorts after every key with the exact expiry timestamp.
      const cutoff = new Date(now).toISOString();
      const query = new URLSearchParams({ prefix, endOffset: prefix + cutoff + '0',
        fields: 'items(name),nextPageToken', maxResults: '100' });
      let failed = false;
      do {
        const page = await (await call(api + '?' + query)).json();
        const results = await Promise.allSettled((page.items ?? []).map(({ name }) => remove(name.slice(prefix.length))));
        failed ||= results.some(result => result.status === 'rejected');
        if (!page.nextPageToken) break;
        query.set('pageToken', page.nextPageToken);
      } while (true);
      if (failed) throw new Error('Audio cleanup incomplete');
    },
  };
}
