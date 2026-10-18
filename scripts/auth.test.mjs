import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { authConfig, hashPassword, returnPath } from './auth.mjs';
import { galleryServer } from './server.mjs';

const password = 'test-only-long-password';
const passwordHash = await hashPassword(password);

async function fixture(t, options = {}) {
    const root = await mkdtemp(join(tmpdir(), 'supersplat-auth-'));
    const dist = join(root, 'dist');
    const splats = join(root, 'splats');
    await mkdir(dist);
    await mkdir(join(splats, 'Setup'), { recursive: true });
    await writeFile(join(dist, 'index.html'), 'private app');
    await writeFile(join(dist, 'index.css'), '/* login styling */');
    await writeFile(join(dist, 'index.js'), '/* app code */');
    await writeFile(join(splats, 'Setup', 'scene.ply'), '0123456789');
    await writeFile(join(splats, 'Setup', 'metadata.json'), '{}');
    const server = galleryServer({ dist, splats, auth: { username: 'bolty', passwordHash, secureCookie: false, ...options } });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
        await rm(root, { recursive: true, force: true });
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = (path, opts) => fetch(`${base}${path}`, { redirect: 'manual', ...opts });
    const login = (fields = {}, headers = {}) => request('/login', {
        method: 'POST', headers: { Origin: base, ...headers },
        body: new URLSearchParams({ username: 'bolty', password, next: '/?splat=Setup', ...fields })
    });
    return { base, request, login };
}

test('fails closed without credentials and rejects invalid configuration', async () => {
    assert.throws(() => authConfig({}), /Login is required/);
    assert.throws(() => authConfig({ AUTH_USERNAME: 'bolty', AUTH_PASSWORD_HASH: 'plain-text' }));
    assert.equal(authConfig({ AUTH_DISABLED: 'true' }), false);
    assert.equal(authConfig({ AUTH_USERNAME: 'bolty', AUTH_PASSWORD_HASH: passwordHash }).secureCookie, true);
    await assert.rejects(hashPassword('short'), /at least 12/);
    for (const path of ['https://evil.test', '//evil.test', '/' + String.fromCharCode(92) + 'evil.test', '/' + String.fromCharCode(13, 10), '/login', '/logout']) assert.equal(returnPath(path), '/');
    assert.equal(returnPath('/?splat=Setup'), '/?splat=Setup');
});

test('protects pages, API, metadata, PLY downloads and range/HEAD requests', async (t) => {
    const { request } = await fixture(t);
    const home = await request('/?splat=Setup');
    assert.equal(home.status, 303);
    assert.equal(home.headers.get('location'), '/login?next=%2F%3Fsplat%3DSetup');
    assert.match(home.headers.get('cache-control'), /no-store/);
    for (const path of ['/api/splats', '/api/auth', '/index.js', '/splats/Setup/metadata.json', '/splats/Setup/scene.ply', '/splats%2FSetup%2Fscene.ply']) {
        for (const method of ['GET', 'HEAD']) {
            const response = await request(path, { method, headers: { Range: 'bytes=0-2' } });
            assert.equal(response.status, 401, `${method} ${path}`);
        }
    }
    const page = await request('/login?next=%22%3E%3Cscript%3E');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal((await page.text()).includes('<script>'), false);
    assert.equal((await request('/index.css')).status, 200);
});

test('login, logout, expiry, fixation prevention and safe redirects', async (t) => {
    let time = Date.now();
    const { request, login, base } = await fixture(t, { now: () => time });
    assert.equal((await login({ password: 'wrong' })).status, 401);
    assert.equal((await login({ username: 'wrong' })).status, 401);
    const response = await login();
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/?splat=Setup');
    const setCookie = response.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.match(setCookie, /Max-Age=43200/);
    const cookie = setCookie.split(';')[0];
    assert.equal((await request('/', { headers: { Cookie: cookie } })).status, 200);
    const api = await request('/api/auth', { headers: { Cookie: cookie } });
    assert.deepEqual(await api.json(), { enabled: true, username: 'bolty' });
    const file = await request('/splats/Setup/scene.ply', { headers: { Cookie: cookie, Range: 'bytes=2-4' } });
    assert.equal(file.status, 206);
    assert.equal(await file.text(), '234');
    assert.match(file.headers.get('cache-control'), /private, no-store/);
    const rotated = await login({}, { Cookie: cookie });
    assert.notEqual(rotated.headers.get('set-cookie'), setCookie);
    assert.equal((await request('/api/splats', { headers: { Cookie: cookie } })).status, 401);
    const rotatedCookie = rotated.headers.get('set-cookie').split(';')[0];
    const logout = await request('/logout', { method: 'POST', headers: { Origin: base, Cookie: rotatedCookie } });
    assert.equal(logout.status, 303);
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await request('/api/splats', { headers: { Cookie: rotatedCookie } })).status, 401);
    const next = await login({ next: '//evil.test' });
    assert.equal(next.headers.get('location'), '/');
    time += 12 * 60 * 60 * 1000 + 1;
    assert.equal((await request('/api/splats', { headers: { Cookie: next.headers.get('set-cookie').split(';')[0] } })).status, 401);
});

test('blocks cross-origin requests, oversized forms and brute-force attempts', async (t) => {
    const { request, login, base } = await fixture(t);
    assert.equal((await login({}, { Origin: 'https://evil.test' })).status, 403);
    assert.equal((await login({}, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await request('/logout')).status, 405);
    assert.equal((await request('/logout', { method: 'POST' })).status, 403);
    assert.equal((await request('/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{}' })).status, 415);
    assert.equal((await login({ password: 'x'.repeat(9000) })).status, 413);
    for (let i = 0; i < 9; i++) assert.equal((await login({ password: 'wrong' })).status, 401);
    const blocked = await login();
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('retry-after'), '900');
});

test('production sessions use secure host-only cookies', async (t) => {
    const { login, base } = await fixture(t, { secureCookie: true });
    const response = await login({}, { Origin: base.replace('http:', 'https:') });
    assert.equal(response.status, 303);
    assert.match(response.headers.get('set-cookie'), /^__Host-supersplat=/);
    assert.match(response.headers.get('set-cookie'), /; Secure/);
    assert.doesNotMatch(response.headers.get('set-cookie'), /Domain=/);
});
