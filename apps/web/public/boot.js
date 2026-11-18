// Runs in <head> before the app's JavaScript arrives. Kept as a file so the CSP needs no 'unsafe-inline'.
(function () {
  // 1. Apply the saved theme and language before first paint (no flash of the wrong theme).
  try {
    var t = localStorage.getItem('todo.theme');
    if (t === 'light' || t === 'dark' || t === 'system') document.documentElement.dataset.theme = t;
    var l = localStorage.getItem('todo.locale');
    if (l) document.documentElement.lang = l;
  } catch {
    /* storage unavailable: keep defaults */
  }

  // 2. Start the first screen's API requests now, in parallel with the app download.
  //    The app's API client uses these responses instead of asking again (src/api/client.ts).
  //    URLs must match exactly what the app builds (src/routes/tasks-params.ts + toQueryString).
  try {
    var path = location.pathname;
    var urls = [];
    if (path === '/today') urls.push('/api/v1/tasks?view=today&limit=100');
    if (path === '/tasks') {
      var s = new URLSearchParams(location.search);
      var q = new URLSearchParams();
      var tab = s.get('tab');
      q.set('view', tab === 'overdue' || tab === 'completed' ? tab : 'mine');
      ['q', 'status', 'priority', 'dueFrom', 'dueTo'].forEach(function (k) {
        var v = s.get(k);
        if (v) q.set(k, v);
      });
      q.set('limit', '30');
      urls.push('/api/v1/tasks?' + q.toString());
    }
    if (urls.length) {
      urls.push('/api/v1/me', '/api/v1/tasks/counts');
      var early = {};
      urls.forEach(function (u) {
        early[u] = fetch(u, {
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        });
        early[u].catch(function () {});
      });
      window.__todoEarly = early;
      window.__todoEarlyAt = Date.now();
    }
  } catch {
    /* fall back to normal loading */
  }
})();
