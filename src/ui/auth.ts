let enabled = false;

const signIn = () => {
    const url = new URL('/login', window.location.origin);
    url.searchParams.set('next', `${window.location.pathname}${window.location.search}`);
    window.location.replace(url);
};

const initAuth = async () => {
    const response = await fetch('/api/auth', { cache: 'no-store' });
    if (response.status === 401) {
        signIn();
        return false;
    }
    if (!response.ok) throw new Error('Could not check your sign-in session.');
    const session = await response.json();
    enabled = session.enabled;
    return true;
};

const logoutForm = () => {
    if (!enabled) return null;
    const form = document.createElement('form');
    form.className = 'logout-form';
    form.method = 'post';
    form.action = '/logout';
    const button = document.createElement('button');
    button.className = 'gallery-button';
    button.type = 'submit';
    button.textContent = 'Sign out';
    form.append(button);
    // Prevent the viewport controller from capturing presses on UI.
    form.addEventListener('pointerdown', (event) => event.stopPropagation());
    return form;
};

export { initAuth, logoutForm, signIn };
