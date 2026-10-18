/* global HTMLElementTagNameMap */
import { logoutForm, signIn } from './auth';

type GalleryEntry = {
    id: string;
    title: string;
    description: string;
    author: string;
    date: string;
    tags: string[];
    url: string;
    thumbnail?: string;
    settingsUrl?: string;
    bytes: number;
    splatCount?: number;
};

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
};

// Keep locale selection on navigation, but never carry viewer load parameters back home.
const galleryUrl = () => {
    const url = new URL('./', document.baseURI);
    const language = new URL(window.location.href).searchParams.get('lang');
    if (language) url.searchParams.set('lang', language);
    return url;
};

const ensureGalleryStyles = () => {
    if (!document.querySelector('link[href*="gallery.css"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = new URL('./gallery.css', document.baseURI).href;
        document.head.append(link);
    }
};

const startGallery = async (open: (url?: string) => Promise<void> | void) => {
    ensureGalleryStyles();
    const params = new URL(window.location.href).searchParams;
    if (params.has('content') || params.has('splat')) {
        await open();
        return;
    }

    const root = element('main', 'splat-gallery');
    const header = element('header', 'gallery-header');
    const brand = element('div', 'gallery-brand', 'SUPERSPLAT');
    brand.append(element('span', '', ' / VIEWER'));
    const actions = element('div', 'gallery-actions');
    const logout = logoutForm();
    if (logout) actions.append(logout);
    header.append(brand, actions);
    const content = element('section', 'gallery-content');
    const intro = element('div', 'gallery-intro');
    intro.append(
        element('p', 'gallery-eyebrow', 'GAUSSIAN SPLATS'),
        element('h1', '', 'Explore the collection'),
        element('p', 'gallery-subtitle', 'Choose a splat to open it in the SuperSplat Viewer.')
    );
    const tools = element('div', 'gallery-tools');
    const search = element('input', 'gallery-search');
    search.type = 'search';
    search.placeholder = 'Search splats…';
    search.setAttribute('aria-label', 'Search splats');
    const count = element('span', 'gallery-count');
    const refresh = element('button', 'gallery-button', 'Refresh');
    tools.append(search, count, refresh);
    const status = element('p', 'gallery-status', 'Loading splats…');
    status.setAttribute('role', 'status');
    const grid = element('div', 'gallery-grid');
    content.append(intro, tools, status, grid);
    root.append(header, content);
    document.body.append(root);

    let entries: GalleryEntry[] = [];
    const render = () => {
        const query = search.value.trim().toLocaleLowerCase();
        const matches = entries.filter((entry) =>
            [entry.title, entry.description, entry.author, ...entry.tags].join(' ').toLocaleLowerCase().includes(query)
        );
        count.textContent = `${matches.length} splat${matches.length === 1 ? '' : 's'}`;
        grid.replaceChildren();
        status.textContent =
            entries.length === 0
                ? 'No splats yet. Add a folder with a splat file and metadata.json to /splats, then refresh.'
                : matches.length === 0
                  ? 'No splats match your search.'
                  : '';
        for (const entry of matches) {
            const card = element('a', 'gallery-card');
            const url = galleryUrl();
            url.searchParams.set('splat', entry.id);
            url.searchParams.set('content', entry.url);
            if (entry.settingsUrl) url.searchParams.set('settings', entry.settingsUrl);
            card.href = url.href;
            const preview = element('div', 'gallery-preview');
            preview.append(element('span', 'gallery-placeholder', '◈'));
            if (entry.thumbnail) {
                const image = element('img', '');
                image.src = entry.thumbnail;
                image.alt = '';
                image.loading = 'lazy';
                image.addEventListener('error', () => image.remove(), { once: true });
                preview.append(image);
            }
            const details = element('div', 'gallery-details');
            details.append(
                element('h2', '', entry.title),
                element('p', 'gallery-description', entry.description || 'Gaussian splat')
            );
            const splatCountStr = entry.splatCount
                ? `${(entry.splatCount / 1_000_000).toFixed(1)}M splats`
                : null;
            const bytesStr = entry.bytes > 0
                ? `${(entry.bytes / (1024 * 1024)).toFixed(1)} MB`
                : null;
            const meta = [entry.author, entry.date, splatCountStr, bytesStr]
                .filter(Boolean)
                .join(' · ');
            details.append(element('p', 'gallery-meta', meta));
            if (entry.tags.length) details.append(element('p', 'gallery-tags', entry.tags.join(' / ')));
            details.append(element('span', 'gallery-open', 'Open splat →'));
            card.append(preview, details);
            grid.append(card);
        }
    };
    const load = async (initial = false) => {
        refresh.disabled = true;
        status.textContent = 'Loading splats…';
        try {
            const response = await fetch('/api/splats', { cache: 'no-store' });
            if (response.status === 401) {
                signIn();
                return;
            }
            if (!response.ok) throw new Error(`Server returned ${response.status}`);
            entries = await response.json();
            render();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            status.textContent = `Could not load the collection. Run the gallery server with npm start, then refresh. ${message}`;
            refresh.disabled = false;
            return;
        }
        refresh.disabled = false;
        if (initial && params.has('splat') && !params.has('content')) {
            const entry = entries.find((e) => e.id === params.get('splat'));
            if (entry) {
                root.remove();
                document.title = `${entry.title} | SuperSplat Viewer`;
                await open(entry.url);
            } else {
                status.textContent = 'This splat is no longer available. Choose another from the collection.';
            }
        }
    };
    search.addEventListener('input', render);
    refresh.addEventListener('click', () => {
        load().catch(console.error);
    });
    await load(true);
};

export { ensureGalleryStyles, galleryUrl, startGallery };
