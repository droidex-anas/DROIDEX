const container = document.getElementById('root');
if (!container) throw new Error('DROIDEX Remote is missing its root element.');

// Each route loads only its own code, so a profile visitor never downloads the app.
const path = window.location.pathname.split('/').filter(Boolean);
if (path[0] === 'public') {
  const username = path.length === 2 ? (path[1] ?? '') : '';
  void import('./publicEntry').then((entry) => {
    entry.startPublicProfile(container, username);
  });
} else {
  const requested = path.length === 1 ? (path[0] ?? '') : '';
  void import('./remoteEntry').then((entry) => entry.startRemote(container, requested));
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: '/' }).catch(() => {
    console.warn('DROIDEX Remote could not register its app worker.');
  });
}
