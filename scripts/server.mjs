import { createReadStream, existsSync } from 'node:fs';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

import { authConfig, createAuth } from './auth.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultDist = existsSync(resolve(root, 'public')) ? resolve(root, 'public') : resolve(root, 'dist');

const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.ply': 'application/octet-stream',
    '.sog': 'application/octet-stream',
    '.splat': 'application/octet-stream',
    '.ksplat': 'application/octet-stream'
};

const inside = (base, path) => {
    const rel = relative(base, path);
    return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel);
};
const localFile = name => typeof name === 'string' && name.length > 0 && !/[\\/\u0000]/.test(name) && !name.startsWith('.');

// Resolve real paths too: an accidentally uploaded symlink must never expose host files.
async function safePath(base, name) {
    const canonicalBase = await realpath(base);
    const path = await realpath(resolve(base, name));
    if (!inside(canonicalBase, path)) throw Object.assign(new Error('Not found'), { code: 'ENOENT' });
    return path;
}

export async function listSplats(base) {
    const dirs = await readdir(base, { withFileTypes: true }).catch((err) => {
        if (err.code === 'ENOENT') return [];
        throw err;
    });
    const entries = await Promise.all(dirs.filter(d => d.isDirectory() && !d.name.startsWith('.')).map(async (dir) => {
        try {
            const folder = resolve(base, dir.name);
            let metadata = {};
            try {
                metadata = JSON.parse(await readFile(await safePath(folder, 'metadata.json'), 'utf8'));
                if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Expected a JSON object');
            } catch (err) {
                if (err.code !== 'ENOENT') throw err;
            }
            const files = await readdir(folder, { withFileTypes: true });
            const splatFiles = files.filter(f => f.isFile() && (/\.(ply|sog|splat|ksplat)$/i.test(f.name) || f.name.toLowerCase() === 'lod-meta.json')).map(f => f.name).sort();
            const preferred = splatFiles.find(f => /\.sog$/i.test(f))
                ?? splatFiles.find(f => f.toLowerCase() === 'lod-meta.json')
                ?? splatFiles.find(f => /\.compressed\.ply$/i.test(f))
                ?? splatFiles.find(f => /\.ply$/i.test(f))
                ?? splatFiles[0];
            const file = metadata.file ?? preferred;
            if (!localFile(file) || !splatFiles.includes(file)) throw new Error('No valid splat file');
            const info = await stat(await safePath(folder, file));
            const url = name => `/splats/${encodeURIComponent(dir.name)}/${encodeURIComponent(name)}`;
            let thumbnail;
            if (localFile(metadata.thumbnail) && /\.(png|jpe?g|webp)$/i.test(metadata.thumbnail)) {
                await safePath(folder, metadata.thumbnail);
                thumbnail = url(metadata.thumbnail);
            }
            let settingsUrl;
            if (files.some(f => f.isFile() && f.name.toLowerCase() === 'settings.json')) {
                await safePath(folder, 'settings.json');
                settingsUrl = url('settings.json');
            }
            return {
                id: dir.name,
                title: typeof metadata.title === 'string' ? metadata.title : dir.name,
                description: typeof metadata.description === 'string' ? metadata.description : '',
                author: typeof metadata.author === 'string' ? metadata.author : '',
                date: typeof metadata.date === 'string' ? metadata.date : '',
                tags: Array.isArray(metadata.tags) ? metadata.tags.filter(t => typeof t === 'string') : [],
                url: url(file), thumbnail, settingsUrl, bytes: info.size
            };
        } catch (err) {
            console.warn(`Skipping splat ${dir.name}: ${err.message}`);
            return null;
        }
    }));
    return entries.filter(Boolean).sort((a, b) => a.title.localeCompare(b.title));
}

const defaultSettingsJson = JSON.stringify({
    version: 2,
    tonemapping: 'linear',
    highPrecisionRendering: false,
    background: { color: [0, 0, 0] },
    postEffectSettings: {
        sharpness: { enabled: false, amount: 0 },
        bloom: { enabled: false, intensity: 0.1, blurLevel: 2 },
        grading: { enabled: false, brightness: 1, contrast: 1, saturation: 1, tint: [1, 1, 1] },
        vignette: { enabled: false, intensity: 0.5, inner: 0.3, outer: 0.75, curvature: 1 },
        fringing: { enabled: false, intensity: 0.5 }
    },
    animTracks: [],
    cameras: [{ initial: { position: [0, 2, 0], target: [2, 2, 0], fov: 85 } }],
    annotations: [],
    startMode: 'default'
});

export function galleryServer({ dist = defaultDist, splats = process.env.SPLATS_DIR || resolve(root, 'splats'), auth = authConfig() } = {}) {
    const authentication = createAuth(auth);
    return createServer(async (req, res) => {
        try {
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('X-Frame-Options', 'DENY');
            res.setHeader('Referrer-Policy', 'same-origin');
            const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
            if (await authentication.handle(req, res, path)) return;
            if (!['GET', 'HEAD'].includes(req.method)) {
                res.writeHead(405, { Allow: 'GET, HEAD' }).end();
                return;
            }
            if (path === '/api/auth') {
                res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
                res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ enabled: authentication.enabled, username: authentication.user(req) }));
                return;
            }
            if (path === '/api/splats') {
                const body = JSON.stringify(await listSplats(splats));
                res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' });
                res.end(req.method === 'HEAD' ? undefined : body);
                return;
            }
            const isSplat = path.startsWith('/splats/');
            const name = isSplat ? path.slice(8) : path === '/' ? 'index.html' : path.slice(1);
            if (name.split('/').some(part => part.startsWith('.')) || name.includes('\\') || name.includes('\0')) {
                res.writeHead(404).end();
                return;
            }
            if (!isSplat && name === 'settings.json' && !existsSync(resolve(dist, 'settings.json'))) {
                res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
                res.end(req.method === 'HEAD' ? undefined : defaultSettingsJson);
                return;
            }
            const file = await safePath(isSplat ? splats : dist, name);
            const info = await stat(file);
            if (!info.isFile()) { res.writeHead(404).end(); return; }
            res.setHeader('Content-Type', mime[extname(file).toLowerCase()] || 'application/octet-stream');
            res.setHeader('Cache-Control', authentication.enabled ? 'private, no-store' : 'no-cache');
            res.setHeader('Accept-Ranges', 'bytes');
            let start = 0;
            let end = info.size - 1;
            if (req.headers.range) {
                const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
                if (match && (match[1] || match[2])) {
                    start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
                    end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
                } else {
                    start = -1;
                }
                if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= info.size) {
                    res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }).end();
                    return;
                }
                res.statusCode = 206;
                res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
            }
            res.setHeader('Content-Length', Math.max(0, end - start + 1));
            if (req.method === 'HEAD' || info.size === 0) { res.end(); return; }
            await pipeline(createReadStream(file, { start, end }), res);
        } catch (err) {
            if (res.headersSent) { res.destroy(); return; }
            const status = ['ENOENT', 'ENOTDIR'].includes(err.code) ? 404 : err instanceof URIError ? 400 : 500;
            if (status === 500) console.error(err);
            res.writeHead(status).end(status === 404 ? 'Not found' : 'Request failed');
        }
    });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    // Environment variables take precedence over the optional local secrets file.
    try { process.loadEnvFile(resolve(root, '.env')); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    const port = Number(process.env.PORT || 3000);
    const host = process.env.HOST || '0.0.0.0';
    galleryServer().listen(port, host, () => console.log(`SuperSplat viewer gallery listening on http://${host}:${port}`));
}
