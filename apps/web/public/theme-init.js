// Applies the saved theme and language before first paint (avoids a flash of the wrong theme).
// Kept as a separate file so the Content Security Policy needs no 'unsafe-inline'.
(function () {
  try {
    var t = localStorage.getItem('todo.theme');
    if (t === 'light' || t === 'dark' || t === 'system') document.documentElement.dataset.theme = t;
    var l = localStorage.getItem('todo.locale');
    if (l) document.documentElement.lang = l;
  } catch {
    /* storage unavailable: keep defaults */
  }
})();
