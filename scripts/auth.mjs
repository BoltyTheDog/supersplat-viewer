import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const SESSION_MS = 12 * 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const digest = value => createHash('sha256').update(value).digest();
const equal = (a, b) => timingSafeEqual(digest(a), digest(b));
const escape = value => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function hashPassword(password) {
    if (password.length < 12) throw new Error('Use a password of at least 12 characters.');
    const salt = randomBytes(16).toString('hex');
    const hash = await derive(password, salt, 64);
    return `scrypt:${salt}:${hash.toString('hex')}`;
}

export function authConfig(env = process.env) {
    if (env.AUTH_DISABLED === 'true') return false;
    const username = env.AUTH_USERNAME;
    const passwordHash = env.AUTH_PASSWORD_HASH;
    if (!username || !/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(passwordHash || '')) {
        throw new Error('Login is required: set AUTH_USERNAME and AUTH_PASSWORD_HASH (run npm run auth:password). For an intentionally public gallery only, set AUTH_DISABLED=true.');
    }
    return { username, passwordHash, secureCookie: env.AUTH_COOKIE_SECURE !== 'false' };
}

// Never accept external redirects, scheme-relative URLs, backslashes or control characters.
export function returnPath(value) {
    if (typeof value !== 'string' || !value.startsWith('/') || /^[\/]{2}/.test(value) || /[\\\x00-\x20\x7f]/.test(value)) return '/';
    const url = new URL(value, 'https://gallery.invalid');
    if (url.origin !== 'https://gallery.invalid' || ['/login', '/logout'].includes(url.pathname)) return '/';
    return `${url.pathname}${url.search}`;
}

function loginPage(next, error = '') {
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in | SuperSplat Viewer</title><link rel="stylesheet" href="/index.css"><link rel="stylesheet" href="/gallery.css"><link rel="icon" href="/static/icons/logo-192.png">
<style>html,body{height:100%;margin:0;padding:0;background-color:#171c20;color:#f5f5f5;font-family:Arial,sans-serif;}</style></head>
<body><main class="splat-gallery login-page"><section class="login-card">
<div class="gallery-brand">SUPERSPLAT <span>/ VIEWER</span></div>
<p class="gallery-eyebrow">PRIVATE COLLECTION</p><h1>Welcome back</h1>
<p class="gallery-subtitle">Sign in to explore the splat collection.</p>
${error ? `<p class="login-error" role="alert">${escape(error)}</p>` : ''}
<form method="post" action="/login" class="login-form">
<input type="hidden" name="next" value="${escape(next)}">
<label for="username">Username</label><input class="gallery-search" id="username" name="username" autocomplete="username" required maxlength="256" autofocus>
<label for="password">Password</label><input class="gallery-search" id="password" name="password" type="password" autocomplete="current-password" required maxlength="1024">
<button class="gallery-button login-submit" type="submit">Sign in →</button>
</form><p class="gallery-meta">Access is limited to invited visitors.</p>
</section></main></body></html>`;
}

export function createAuth(config) {
    if (config === false) return {
        enabled: false,
        user: () => null,
        handle: async (req, res, path) => {
            if (path === '/login' || path === '/logout') { res.writeHead(303, { Location: '/' }).end(); return true; }
            return false;
        }
    };
    if (!config?.username || !/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(config.passwordHash || '')) throw new Error('Invalid authentication configuration');
    const secure = config.secureCookie !== false;
    const cookieName = secure ? '__Host-supersplat' : 'supersplat_session';
    const now = config.now || Date.now;
    const sessions = new Map();
    const attempts = new Map();
    let pending = 0;
    const cookie = (token, age) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`;
    const sessionKey = req => {
        const token = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || '';
        return /^[a-f0-9]{64}$/.test(token) ? digest(token).toString('hex') : '';
    };
    const user = req => {
        const key = sessionKey(req);
        const session = sessions.get(key);
        if (!session || session.expires <= now()) { sessions.delete(key); return null; }
        return config.username;
    };
    const page = (res, next, error, status = 200, head = false) => {
        res.writeHead(status, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
        });
        res.end(head ? undefined : loginPage(next, error));
    };
    return {
        enabled: true,
        user,
        async handle(req, res, path) {
            // All private responses, including PLYs, must not enter shared/browser caches.
            res.setHeader('Cache-Control', 'private, no-store');
            if (path === '/login' && ['GET', 'HEAD'].includes(req.method)) {
                const next = returnPath(new URL(req.url, 'http://localhost').searchParams.get('next'));
                if (user(req)) res.writeHead(303, { Location: next }).end();
                else page(res, next, '', 200, req.method === 'HEAD');
                return true;
            }
            if (path === '/login' || path === '/logout') {
                if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }).end(); return true; }
                // Browser forms/fetches must originate on this exact host and scheme.
                // Do not trust user-supplied X-Forwarded-* headers for this check.
                if (req.headers.origin !== `${secure ? 'https' : 'http'}://${req.headers.host}` || req.headers['sec-fetch-site'] === 'cross-site') {
                    res.writeHead(403).end('Invalid request origin');
                    return true;
                }
                if (path === '/logout') {
                    sessions.delete(sessionKey(req));
                    res.writeHead(303, { Location: '/login', 'Set-Cookie': cookie('', 0) }).end();
                    return true;
                }
                if (req.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') {
                    res.writeHead(415).end(); return true;
                }
                const ip = req.socket.remoteAddress;
                for (const [key, entry] of attempts) if (entry.reset <= now()) attempts.delete(key);
                const attempt = attempts.get(ip) || { count: 0, reset: now() + WINDOW_MS };
                if (attempt.count >= 10 || pending >= 4 || (attempts.size >= 1024 && !attempts.has(ip))) {
                    res.setHeader('Retry-After', '900');
                    page(res, '/', 'Too many sign-in attempts. Please try again in 15 minutes.', 429);
                    return true;
                }
                attempt.count++;
                attempts.set(ip, attempt);
                if (Number(req.headers['content-length']) > 8192) { res.writeHead(413).end(); return true; }
                const chunks = [];
                let size = 0;
                for await (const chunk of req) {
                    size += chunk.length;
                    if (size > 8192) { res.writeHead(413).end(); return true; }
                    chunks.push(chunk);
                }
                const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
                const next = returnPath(form.get('next'));
                const password = form.get('password') || '';
                const username = form.get('username') || '';
                if (password.length > 1024 || username.length > 256) { page(res, next, 'Invalid username or password.', 401); return true; }
                const [, salt, expected] = config.passwordHash.split(':');
                pending++;
                let actual;
                try { actual = await derive(password, salt, 64); } finally { pending--; }
                if (!timingSafeEqual(actual, Buffer.from(expected, 'hex')) || !equal(username, config.username)) {
                    page(res, next, 'Invalid username or password.', 401);
                    return true;
                }
                for (const [key, session] of sessions) if (session.expires <= now()) sessions.delete(key);
                if (sessions.size >= 1000) sessions.delete(sessions.keys().next().value);
                // A fresh random token for every successful login prevents session fixation.
                sessions.delete(sessionKey(req));
                const token = randomBytes(32).toString('hex');
                sessions.set(digest(token).toString('hex'), { expires: now() + SESSION_MS });
                res.writeHead(303, { Location: next, 'Set-Cookie': cookie(token, SESSION_MS / 1000) }).end();
                return true;
            }
            // Only login styling and its favicon are public. Protect every other route.
            if (path === '/index.css' || path === '/gallery.css' || path === '/static/icons/logo-192.png' || user(req)) return false;
            if (['GET', 'HEAD'].includes(req.method) && (path === '/' || path === '/index.html')) {
                res.writeHead(303, { Location: `/login?next=${encodeURIComponent(returnPath(req.url))}` }).end();
            } else {
                res.writeHead(401, { 'Content-Type': 'application/json' }).end(req.method === 'HEAD' ? undefined : JSON.stringify({ error: 'Sign in required' }));
            }
            return true;
        }
    };
}
