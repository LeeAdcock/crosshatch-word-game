// How-to-play dialog. Opens automatically the first time a visitor loads the
// game (remembered with a cookie so it never nags on return visits) and can be
// reopened any time via the header's ? button. Self-contained — no game logic.

(function () {
  const COOKIE = 'crosshatch_howto_seen';

  // Read a cookie value by name, or null if it isn't set.
  function getCookie(name) {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  // Persist a flag for ~1 year so the dialog only auto-shows once.
  function setCookie(name, value) {
    const oneYear = 365 * 24 * 60 * 60;
    document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${oneYear}; path=/; SameSite=Lax`;
  }

  const backdrop = document.getElementById('howto');
  const helpBtn = document.getElementById('help-btn');
  if (!backdrop) return;

  function open() {
    backdrop.hidden = false;
  }

  // Hide the dialog and record that it's been seen, so it won't auto-open again.
  function close() {
    backdrop.hidden = true;
    setCookie(COOKIE, '1');
  }

  if (helpBtn) helpBtn.addEventListener('click', open);
  document.getElementById('howto-ok').addEventListener('click', close);
  document.getElementById('howto-close').addEventListener('click', close);
  // Click the dimmed backdrop (outside the card) to dismiss.
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  // Escape closes it too.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !backdrop.hidden) close();
  });

  // First visit (no cookie yet) → show the instructions automatically.
  if (!getCookie(COOKIE)) open();
})();
