import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { galleryServer } from './server.mjs';

test('gallery discovers uploads and safely streams files', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'supersplat-test-'));
    const dist = join(root, 'dist');
    const splats = join(root, 'splats');
    await mkdir(dist);
    await mkdir(splats);
    await writeFile(join(dist, 'index.html'), '<h1>Gallery</h1>');
    await writeFile(join(root, 'secret.txt'), 'private');
    const server = galleryServer({ dist, splats, auth: false });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
        await rm(root, { recursive: true, force: true });
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const get = (path, options) => fetch(`${base}${path}`, options);
    assert.deepEqual(await (await get('/api/splats')).json(), []);
    assert.equal(await (await get('/')).text(), '<h1>Gallery</h1>');

    const folder = join(splats, 'my room');
    await mkdir(folder);
    await writeFile(join(folder, 'room #1.ply'), '0123456789');
    await writeFile(join(folder, 'preview.jpg'), 'image');
    await writeFile(join(folder, 'settings.json'), JSON.stringify({ version: 2 }));
    await writeFile(join(folder, 'metadata.json'), JSON.stringify({ title: 'My room', description: '<script>not markup</script>', thumbnail: 'preview.jpg', tags: ['inside', 42], author: 'Bolty' }));
    const entries = await (await get('/api/splats')).json();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].title, 'My room');
    assert.equal(entries[0].bytes, 10);
    assert.deepEqual(entries[0].tags, ['inside']);
    assert.equal(entries[0].settingsUrl, '/splats/my%20room/settings.json');
    const defaultSettingsRes = await get('/settings.json');
    assert.equal(defaultSettingsRes.status, 200);
    assert.equal((await defaultSettingsRes.json()).version, 2);
    assert.equal(entries[0].url, '/splats/my%20room/room%20%231.ply');
    assert.equal(await (await get(entries[0].url)).text(), '0123456789');
    const range = await get(entries[0].url, { headers: { Range: 'bytes=2-5' } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(await range.text(), '2345');
    assert.equal(await (await get(entries[0].url, { headers: { Range: 'bytes=-3' } })).text(), '789');
    assert.equal((await get(entries[0].url, { headers: { Range: 'bytes=50-' } })).status, 416);
    assert.equal((await get(entries[0].url, { method: 'HEAD' })).headers.get('content-length'), '10');
    assert.equal((await get('/api/splats', { method: 'POST' })).status, 405);
    assert.equal((await get('/%ZZ')).status, 400);
    assert.equal((await get('/.git/config')).status, 404);
    await symlink(join(root, 'secret.txt'), join(folder, 'escape.ply'));
    assert.equal((await get('/splats/my%20room/escape.ply')).status, 404);
    await symlink(root, join(splats, 'outside'));
    assert.equal((await (await get('/api/splats')).json()).length, 1);
    assert.equal((await get('/splats/outside/secret.txt')).status, 404);

    await mkdir(join(splats, 'broken'));
    await writeFile(join(splats, 'broken', 'metadata.json'), '{invalid');
    assert.equal((await (await get('/api/splats')).json()).length, 1);
});
