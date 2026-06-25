// Light/dark theme toggle. The theme is applied before first paint by an inline
// bootstrap in index.html (cookie → OS preference → light). This script syncs the
// toggle button, flips the theme on click, persists an explicit choice to a cookie
// (which then overrides the OS preference), and — until the user has chosen —
// follows live OS preference changes. Self-contained; mirrors instructions.js.

(function () {
  var COOKIE = 'crosshatch_theme';

  function getCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function setCookie(name, value) {
    var oneYear = 365 * 24 * 60 * 60;
    document.cookie = name + '=' + encodeURIComponent(value) + '; max-age=' + oneYear + '; path=/; SameSite=Lax';
  }

  var root = document.documentElement;
  var btn = document.getElementById('theme-btn');

  function current() {
    return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  // Apply a mode and reflect it on the button: show the icon for the OTHER mode,
  // since clicking switches to it (☾ = "go dark", ☀ = "go light").
  function apply(mode) {
    root.setAttribute('data-theme', mode);
    if (btn) btn.textContent = mode === 'dark' ? '☀' : '☾';
  }

  apply(current()); // sync the glyph to whatever the bootstrap already set

  if (btn) {
    btn.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      apply(next);
      setCookie(COOKIE, next); // explicit choice persists and overrides the OS next visit
    });
  }

  // With no saved choice, track live OS preference changes.
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onChange = function (e) {
      if (!getCookie(COOKIE)) apply(e.matches ? 'dark' : 'light');
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange); // older Safari
  }
})();
