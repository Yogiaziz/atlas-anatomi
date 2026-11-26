/* ============================================================
   app.js — Atlas Anatomi Tubuh (SPA tanpa reload)
   Prinsip performa (GAS Instant UX PRO):
   1) Data diambil SATU kali (bootstrap) lalu disimpan lokal; pencarian,
      filter, urutan, pagination semuanya dihitung di browser (instan).
   2) Render dari cache dahulu, revalidasi di latar (stale-while-revalidate).
   3) Aksi dokter bersifat optimistik (hapus/edit metadata) + rollback.
   4) Log penayangan/pencarian dikirim fire-and-forget (tidak menunggu).
   ============================================================ */
(function () {
  'use strict';
  var CFG = window.ATLAS_CONFIG;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); };
  var nf = new Intl.NumberFormat('id-ID');
  var fmtNum = function (n) { return nf.format(Math.round(Number(n) || 0)); };
  function fmtKB(kb) { kb = Number(kb) || 0; return kb >= 1024 ? (kb / 1024).toFixed(1).replace('.', ',') + ' MB' : fmtNum(kb) + ' KB'; }
  function fmtBytes(b) { b = Number(b) || 0; return b >= 1073741824 ? (b / 1073741824).toFixed(1).replace('.', ',') + ' GB' : (b / 1048576).toFixed(0) + ' MB'; }
  var FMT = { webp: 'WebP', jpg: 'JPG', jpeg: 'JPG', png: 'PNG' };
  var fmtName = function (f) { return FMT[String(f).toLowerCase()] || String(f || '').toUpperCase(); };
  var dtf = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  var dtt = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  var fDate = function (iso) { var d = new Date(iso); return isNaN(d) ? '-' : dtf.format(d); };
  var fDT = function (iso) { var d = new Date(iso); return isNaN(d) ? '-' : dtt.format(d).replace(',', ''); };
  function ago(iso) { var s = (Date.now() - new Date(iso)) / 1000; if (isNaN(s)) return '-'; if (s < 60) return 'baru saja'; if (s < 3600) return Math.floor(s / 60) + ' mnt lalu'; if (s < 86400) return Math.floor(s / 3600) + ' jam lalu'; if (s < 172800) return 'Kemarin'; return fDate(iso); }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim(); }
  function hydrate(root) { $$('[data-ic]', root || document).forEach(function (e) { e.innerHTML = ic(e.getAttribute('data-ic')); e.removeAttribute('data-ic'); }); }
  var go = function (h) { if (location.hash === h) route(); else location.hash = h; };

  /* ---------- state ---------- */
  var S = {
    ready: false, err: null, cats: [], catMap: {}, imgs: [], byId: {}, pend: {}, ver: '', sig: '', t: 0,
    cfg: { TOP_N: 5, MAX_SIDE: 1600, THUMB_SIDE: 400, MAX_KB: 2048, QUALITY: 0.85, MIN_QUALITY: 0.6, NAMA_DOKTER: 'Dokter' },
    home: { cat: 'all', shown: 8 }, search: { q: '', cat: 'all', sort: 'rel' }, scroll: {}, nav: 0, view: '', full: false, lastView: { id: '', t: 0 }, logged: {},
    adm: { boot: null, bootT: 0, stats: {}, range: '30', f: { q: '', cat: 'all', fmt: 'all', sort: 'views', view: 'table', page: 1, per: 8 }, lf: { act: 'all', from: '', to: '', page: 1 } }
  };

  function indexImg(i) {
    i._v = (i.v || 0) + (S.pend[i.id] || 0);
    i._s = { n: norm(i.n), k: (i.k || []).map(norm), d: norm(i.d), c: norm((S.catMap[i.c] || {}).n) };
    return i;
  }
  function applyBoot(b) {
    S.cats = b.cats || []; S.catMap = {}; S.cats.forEach(function (c) { S.catMap[c.id] = c; });
    S.cfg = Object.assign(S.cfg, b.cfg || {}); S.pend = b.pend || {}; S.ver = b.ver;
    S.imgs = (b.imgs || []).map(indexImg); S.byId = {}; S.imgs.forEach(function (i) { S.byId[i.id] = i; });
    S.sig = b.ver + '|' + JSON.stringify(S.pend);
  }
  function persist() {
    Store.set('boot', { t: S.t || Date.now(), data: { ver: S.ver, cats: S.cats, cfg: S.cfg, pend: S.pend, imgs: S.imgs.map(function (i) { var o = {}; for (var k in i) if (k[0] !== '_') o[k] = i[k]; return o; }) } });
  }
  function ratioLabel(w, h) {
    if (!w || !h) return '';
    var r = w / h, c = [[4, 3], [3, 4], [16, 9], [9, 16], [1, 1], [3, 2], [2, 3]], best = null;
    c.forEach(function (x) { var d = Math.abs(r - x[0] / x[1]) / r; if (d < 0.05 && (!best || d < best.d)) best = { d: d, l: x[0] + ':' + x[1] }; });
    return best ? best.l : r.toFixed(1).replace('.', ',') + ':1';
  }
  var catName = function (id) { return (S.catMap[id] || {}).n || '-'; };

  /* ---------- URL gambar (Drive) ---------- */
  function drive(id, w) { if (!id) return ''; if (id.indexOf('data:') === 0) return id; return 'https://lh3.googleusercontent.com/d/' + id + (w ? '=w' + w : ''); }
  function driveFb(id) { return (!id || id.indexOf('data:') === 0) ? '' : 'https://drive.google.com/uc?export=view&id=' + id; }
  var thumbUrl = function (im) { return drive(im.t || im.f, 480); };
  var fullUrl = function (im) { return drive(im.f, 1600); };
  function thumbHtml(im, eager) {
    return '<div class="thumb"><img class="ld" ' + (eager ? 'fetchpriority="high"' : 'loading="lazy"') + ' decoding="async" src="' + esc(thumbUrl(im)) + '" data-fb="' + esc(driveFb(im.t || im.f)) + '" alt="' + esc(im.n) + '"></div>';
  }
  document.addEventListener('load', function (e) { var t = e.target; if (t.tagName === 'IMG' && t.classList.contains('ld')) t.classList.remove('ld'); }, true);
  document.addEventListener('error', function (e) {
    var t = e.target; if (t.tagName !== 'IMG' || !t.classList.contains('ld')) return;
    var fb = t.getAttribute('data-fb'); if (fb && t.src !== fb) { t.removeAttribute('data-fb'); t.src = fb; } else t.classList.remove('ld');
  }, true);

  /* ---------- pencarian lokal (instan) ---------- */
  function search(q, cat) {
    var toks = norm(q).split(' ').filter(Boolean); if (!toks.length) return [];
    var out = [];
    S.imgs.forEach(function (im) {
      if (cat && cat !== 'all' && im.c !== cat) return;
      var total = 0, best = { s: 0, l: 'nama' }, ok = true;
      toks.forEach(function (t) {
        var s = 0, l = '';
        var n = im._s.n;
        if (n.indexOf(t) === 0 || n.indexOf(' ' + t) >= 0) { s = 10; l = 'nama'; } else if (n.indexOf(t) >= 0) { s = 7; l = 'nama'; }
        im._s.k.forEach(function (k) { var ks = k === t ? 9 : (k.indexOf(t) >= 0 ? 6 : 0); if (ks > s) { s = ks; l = 'kata kunci'; } });
        if (s < 3 && im._s.d.indexOf(t) >= 0) { s = 3; l = 'deskripsi'; }
        if (s < 2 && im._s.c.indexOf(t) >= 0) { s = 2; l = 'kategori'; }
        if (!s) ok = false; total += s; if (s > best.s) best = { s: s, l: l };
      });
      if (ok) out.push({ im: im, s: total, m: best.l });
    });
    out.sort(function (a, b) { return (b.s - a.s) || (b.im._v - a.im._v); });
    return out;
  }
  function topList() {
    var n = Number(S.cfg.TOP_N) || 5;
    return S.imgs.slice().sort(function (a, b) { return ((b._v + (b.sb || 0)) - (a._v + (a.sb || 0))) || (a.id < b.id ? 1 : -1); }).slice(0, n);
  }

  /* ---------- toast & modal ---------- */
  function toast(msg, type) {
    type = type || 'info';
    var el = document.createElement('div'); el.className = 'toast ' + type;
    el.innerHTML = ic(type === 'success' ? 'okc' : (type === 'info' ? 'info' : 'alert')) + '<span>' + esc(msg) + '</span>';
    $('#toasts').appendChild(el);
    setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 300); }, type === 'error' ? 5200 : 3400);
  }
  function modal(o) {
    return new Promise(function (res) {
      var root = $('#modal-root'), prevFocus = document.activeElement;
      root.innerHTML = '<div class="scrim"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mt"><div class="m-ic ' + (o.danger ? '' : 'info') + '">' + ic(o.icon || (o.danger ? 'alert' : 'info')) + '</div><h2 id="mt">' + esc(o.title) + '</h2><p>' + o.body + '</p><div class="btns"><button type="button" class="btn btn-outline" data-m="0">' + esc(o.cancel || 'Batal') + '</button><button type="button" class="btn ' + (o.danger ? 'btn-danger' : 'btn-primary') + '" data-m="1">' + esc(o.ok || 'Ya') + '</button></div></div></div>';
      var done = function (v) { root.innerHTML = ''; document.removeEventListener('keydown', key, true); if (prevFocus && prevFocus.focus) prevFocus.focus(); res(v); };
      var key = function (e) { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
      document.addEventListener('keydown', key, true);
      root.firstChild.addEventListener('click', function (e) { var b = e.target.closest('[data-m]'); if (b) done(b.dataset.m === '1'); else if (e.target === root.firstChild) done(false); });
      setTimeout(function () { var b = $('[data-m="1"]', root); if (b) b.focus(); }, 30);
    });
  }

  /* ---------- komponen umum ---------- */
  function errState() {
    return '<div class="wrap"><div class="empty err-state"><div class="e-ic">' + ic('wifiOff') + '</div><h2>Data belum bisa dimuat</h2><p>' + esc(S.err || 'Periksa sambungan internet Anda lalu coba lagi.') + '</p><button type="button" class="btn btn-primary" data-retry>' + ic('refresh') + 'Coba lagi</button></div></div>';
  }
  function skelGrid(n) { var h = ''; for (var i = 0; i < n; i++) h += '<div class="sk sk-card"></div>'; return '<div class="gal">' + h + '</div>'; }
  function gcard(im, match) {
    return '<a class="gcard" href="#/gambar/' + esc(im.id) + '">' + thumbHtml(im).replace('</div>', (match ? '<span class="match">Cocok: ' + esc(match) + '</span>' : '') + '</div>') +
      '<div class="gc-body"><div class="gc-meta"><span class="pill pill-cat">' + esc(catName(im.c)) + '</span><span class="ref">' + esc(im.id) + '</span></div><h3>' + esc(im.n) + '</h3><p class="gc-desc">' + esc(im.d) + '</p></div>' +
      '<div class="gc-foot"><span>' + ic('image') + fmtName(im.fm) + ' · ' + fmtKB(im.kb) + '</span><span>' + ic('eye') + fmtNum(im._v) + 'x dilihat</span></div></a>';
  }
  function emptyBlock(icon, title, text, extra) {
    return '<div class="empty"><div class="e-ic">' + ic(icon) + '</div><h2>' + esc(title) + '</h2><p>' + esc(text) + '</p>' + (extra || '') + '</div>';
  }

  /* ============================================================
     HALAMAN PUBLIK
     ============================================================ */
  function renderHome() {
    var el = $('#view-home');
    if (!el.dataset.built) { el.innerHTML = '<div class="wrap"><section id="hTop"></section><section id="hChips"></section><section id="hGal"></section></div>'; el.dataset.built = '1'; }
    if (!S.ready) {
      if (S.err) { el.innerHTML = errState(); delete el.dataset.built; return; }
      $('#hTop').innerHTML = '<div class="sec-h"><h2>' + ic('flame') + 'Paling Sering Dicari</h2></div><div class="top-row">' + '<div class="sk" style="height:220px"></div>'.repeat(5) + '</div>';
      $('#hChips').innerHTML = ''; $('#hGal').innerHTML = '<div class="sec-h"><h2>Galeri Anatomi</h2></div>' + skelGrid(8); return;
    }
    renderTop(); renderChips(); renderGal();
  }
  function renderTop() {
    var box = $('#hTop'); if (!box) return;
    var t = topList();
    if (!t.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="sec-h"><div><h2>' + ic('flame') + 'Paling Sering Dicari</h2><p>Berdasarkan total pencarian &amp; penayangan</p></div></div><div class="top-row">' +
      t.map(function (im, i) {
        return '<a class="topcard' + (i === 0 ? ' first' : '') + '" href="#/gambar/' + esc(im.id) + '"><div class="tc-h"><span class="rank">#' + (i + 1) + '</span><span class="views">' + ic('eye') + fmtNum(im._v) + 'x</span></div>' + thumbHtml(im, i < 3) + '<h3>' + esc(im.n) + '</h3><small>' + esc(catName(im.c)) + '</small></a>';
      }).join('') + '</div>';
  }
  function renderChips() {
    var box = $('#hChips'); if (!box) return;
    var cnt = {}; S.imgs.forEach(function (i) { cnt[i.c] = (cnt[i.c] || 0) + 1; });
    box.innerHTML = '<div class="sec-h"><div><h2>' + ic('filter') + 'Filter Kategori Anatomi</h2></div><p id="hCount"></p></div><div class="chips" role="tablist">' +
      '<button type="button" class="chip' + (S.home.cat === 'all' ? ' on' : '') + '" data-cat="all">Semua <b>' + S.imgs.length + '</b></button>' +
      S.cats.map(function (c) { return '<button type="button" class="chip' + (S.home.cat === c.id ? ' on' : '') + '" data-cat="' + esc(c.id) + '">' + esc(c.n) + ' <b>' + (cnt[c.id] || 0) + '</b></button>'; }).join('') + '</div>';
  }
  function homeList() {
    var l = S.imgs.filter(function (i) { return S.home.cat === 'all' || i.c === S.home.cat; });
    return l.sort(function (a, b) { return a.dt < b.dt ? 1 : (a.dt > b.dt ? -1 : (a.id < b.id ? 1 : -1)); });
  }
  function renderGal() {
    var box = $('#hGal'); if (!box) return;
    var l = homeList(), n = Math.min(S.home.shown, l.length);
    if (!S.imgs.length) { box.innerHTML = emptyBlock('image', 'Atlas masih kosong', 'Belum ada gambar anatomi. Dokter dapat menambahkannya melalui menu Masuk Dokter.'); $('#hCount').textContent = ''; return; }
    if (!l.length) { box.innerHTML = emptyBlock('image', 'Belum ada gambar di kategori ini', 'Coba pilih kategori lain atau gunakan kolom pencarian.'); $('#hCount').textContent = ''; return; }
    $('#hCount').textContent = 'Menampilkan ' + n + ' dari ' + l.length + ' gambar';
    box.innerHTML = '<div class="gal" id="galGrid">' + l.slice(0, n).map(function (i) { return gcard(i); }).join('') + '</div>' + moreBtn(n, l.length);
  }
  function moreBtn(n, total) {
    return n < total ? '<div class="more" id="more"><button type="button" class="btn btn-outline btn-lg" data-more>Muat lebih banyak (' + n + ' dari ' + total + ' gambar)' + ic('chevD') + '</button><span>Gambar dimuat bertahap agar halaman tetap ringan</span></div>' : '';
  }
  function appendGal() {
    var l = homeList(), old = $$('#galGrid .gcard').length, n = Math.min(old + 8, l.length);
    S.home.shown = n;
    $('#galGrid').insertAdjacentHTML('beforeend', l.slice(old, n).map(function (i) { return gcard(i); }).join(''));
    var m = $('#more'); if (m) m.outerHTML = moreBtn(n, l.length);
    $('#hCount').textContent = 'Menampilkan ' + n + ' dari ' + l.length + ' gambar';
  }

  /* ----- hasil pencarian ----- */
  function renderSearch(q) {
    var el = $('#view-search'), changed = S.search.q !== q;
    S.search.q = q;
    if (!S.ready) { el.innerHTML = S.err ? errState() : '<div class="wrap"><div class="sk" style="height:72px;margin-top:24px"></div><div style="height:20px"></div>' + skelGrid(8) + '</div>'; return; }
    if (changed) { S.search.cat = 'all'; S.search.sort = 'rel'; }
    el.innerHTML = '<div class="wrap"><div class="card res-head" id="rHead"></div><div id="rBody" style="margin-top:20px"></div></div>';
    drawSearch();
    var res = search(q, 'all');
    if (res.length && !S.logged[norm(q)]) { S.logged[norm(q)] = 1; API.logSearch(norm(q)); }
  }
  function drawSearch() {
    var q = S.search.q, res = search(q, S.search.cat), s = S.search.sort;
    if (s === 'views') res.sort(function (a, b) { return b.im._v - a.im._v; });
    else if (s === 'name') res.sort(function (a, b) { return a.im.n.localeCompare(b.im.n, 'id'); });
    $('#rHead').innerHTML = '<h2>Ditemukan <em>' + res.length + ' hasil</em> untuk kata kunci</h2><span class="kw">#' + esc(q) + ' <a href="#/" aria-label="Hapus kata kunci">' + ic('x') + '</a></span>' +
      '<select class="sel" id="sCat" aria-label="Kategori"><option value="all">Kategori: Semua</option>' + S.cats.map(function (c) { return '<option value="' + esc(c.id) + '"' + (S.search.cat === c.id ? ' selected' : '') + '>' + esc(c.n) + '</option>'; }).join('') + '</select>' +
      '<select class="sel" id="sSort" aria-label="Urutkan"><option value="rel"' + (s === 'rel' ? ' selected' : '') + '>Urutkan: Paling relevan</option><option value="views"' + (s === 'views' ? ' selected' : '') + '>Paling sering dilihat</option><option value="name"' + (s === 'name' ? ' selected' : '') + '>Nama A-Z</option></select>' +
      ((S.search.cat !== 'all' || s !== 'rel') ? '<button type="button" class="btn btn-ghost btn-sm" id="sReset">Bersihkan filter</button>' : '');
    var body = $('#rBody');
    if (!res.length) {
      var sug = topList().slice(0, 5).map(function (i) { return (i.k && i.k[0]) || i.n; });
      body.innerHTML = emptyBlock('search', 'Bagian tubuh tidak ditemukan', 'Tidak ada gambar yang cocok dengan kata kunci Anda. Coba periksa ejaan, gunakan istilah lain, atau telusuri berdasarkan kategori.',
        '<div class="mlabel">Saran kata kunci</div><div class="chips">' + sug.map(function (k) { return '<a class="chip" href="#/cari/' + encodeURIComponent(k) + '">#' + esc(k) + '</a>'; }).join('') + '</div><a class="btn btn-primary btn-lg" href="#/">Lihat semua gambar (' + S.imgs.length + ')</a>');
    } else body.innerHTML = '<div class="gal">' + res.map(function (r) { return gcard(r.im, r.m); }).join('') + '</div>';
  }

  /* ----- pelengkapan otomatis di bilah pencarian ----- */
  var sg = { items: [], idx: -1 };
  function hl(text, q) {
    var t = text.toLowerCase(), toks = norm(q).split(' ').filter(Boolean), i = -1, len = 0;
    for (var k = 0; k < toks.length; k++) { var p = t.indexOf(toks[k]); if (p >= 0) { i = p; len = toks[k].length; break; } }
    return i < 0 ? esc(text) : esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + len)) + '</mark>' + esc(text.slice(i + len));
  }
  function closeSugg() { var b = $('#sugg'); b.hidden = true; $('#q').setAttribute('aria-expanded', 'false'); sg.idx = -1; }
  function drawSugg() {
    var q = $('#q').value.trim(), box = $('#sugg');
    $('#qclear').hidden = !$('#q').value; $('#kbd').hidden = !!$('#q').value;
    if (!q || !S.ready) return closeSugg();
    var r = search(q, 'all'); sg.items = r.slice(0, 5).map(function (x) { return x.im; }); sg.idx = -1;
    box.innerHTML = (sg.items.length ? sg.items.map(function (im, i) { return '<button type="button" role="option" data-s="' + i + '">' + ic('search') + '<span class="s-t">' + hl(im.n, q) + '</span><span class="pill pill-cat up">' + esc(catName(im.c)) + '</span></button>'; }).join('') : '<button type="button" disabled style="color:#5C6F84">Tidak ada saran. Tekan Enter untuk mencari.</button>') +
      '<div class="s-foot"><span>↑↓ navigasi · Enter buka</span><span>' + r.length + ' hasil</span></div>';
    box.hidden = false; $('#q').setAttribute('aria-expanded', 'true');
  }
  function pickSugg(i) { var im = sg.items[i]; if (!im) return; var q = norm($('#q').value); if (q && !S.logged[q]) { S.logged[q] = 1; API.logSearch(q); } closeSugg(); go('#/gambar/' + im.id); }
  function submitSearch() { var q = $('#q').value.trim(); closeSugg(); if (q) go('#/cari/' + encodeURIComponent(q)); }

  /* ----- detail & penampil ----- */
  var V = null, vCat = '';
  function destroyViewer() { if (S.full) setFull(false); if (V) { V.destroy(); V = null; } S.shownId = ''; var el = $('#view-detail'); if (el) delete el.dataset.mode; }
  function setFull(on) {
    S.full = !!on; if (V) V.setFull(on);
    document.body.classList.toggle('lock', !!on);
    if (on) { try { var d = document.documentElement; (d.requestFullscreen || d.webkitRequestFullscreen || function () {}).call(d); } catch (e) {} }
    else if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (e) {} }
  }
  document.addEventListener('fullscreenchange', function () { if (!document.fullscreenElement && S.full) setFull(false); });

  function renderDetail(id) {
    var el = $('#view-detail');
    S.cur = { id: id };
    if (!S.ready) { destroyViewer(); el.innerHTML = S.err ? errState() : '<div class="wrap"><div class="sk" style="height:560px;margin-top:24px"></div></div>'; return; }
    var im = S.byId[id];
    if (!im) { destroyViewer(); el.innerHTML = '<div class="wrap">' + emptyBlock('image', 'Gambar tidak ditemukan', 'Gambar ini mungkin sudah dihapus atau tautannya keliru.', '<a class="btn btn-primary btn-lg" href="#/">Kembali ke atlas</a>') + '</div>'; return; }
    var sibs = S.imgs.filter(function (x) { return x.c === im.c; }).sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    var idx = sibs.indexOf(im), n = sibs.length;
    var prev = sibs[(idx - 1 + n) % n], next = sibs[(idx + 1) % n];
    S.cur = { id: id, prev: prev, next: next };
    if (V && (el.dataset.mode !== 'detail' || vCat !== im.c)) destroyViewer();
    if (!V) {
      el.innerHTML = '<div class="wrap"><div class="dt-top"><a class="btn btn-ghost" href="#/" data-back>' + ic('arrowL') + 'Kembali ke galeri</a><div class="crumbs" id="dtCrumbs"></div></div><div class="dt-grid"><div class="dt-view" id="dtViewer"></div><aside class="dt-info" id="dtInfo"></aside></div></div>';
      el.dataset.mode = 'detail'; vCat = im.c;
      V = createViewer($('#dtViewer'), {
        onPrev: n > 1 ? function () { go('#/gambar/' + S.cur.prev.id); } : null, onNext: n > 1 ? function () { go('#/gambar/' + S.cur.next.id); } : null,
        onFull: function () { setFull(!S.full); }, onToast: toast
      });
    }
    $('#dtCrumbs').innerHTML = '<a href="#/">Beranda</a>' + ic('chevR') + '<span>' + esc(catName(im.c)) + '</span>' + ic('chevR') + '<b>' + esc(im.n) + '</b>';
    var fresh = S.shownId !== id;
    if (fresh) { V.setSrc(fullUrl(im), { thumb: thumbUrl(im), fallback: driveFb(im.f), alt: im.n, counter: 'Gambar ' + (idx + 1) + ' dari ' + n + ' pada kategori ini' }); S.shownId = id; }
    var doc = Auth.get();
    $('#dtInfo').innerHTML =
      '<div class="card"><span class="pill pill-cat">' + esc(catName(im.c)) + '</span> <span class="ref" style="float:right;margin-top:3px">' + esc(im.id) + '</span><h1>' + esc(im.n) + '</h1>' +
      '<p class="dt-desc">' + (esc(im.d) || '<span class="muted">Belum ada deskripsi.</span>') + '</p>' +
      (im.k && im.k.length ? '<div class="mlabel">Kata kunci terkait</div><div class="tags">' + im.k.map(function (k) { return '<a class="kw" href="#/cari/' + encodeURIComponent(k) + '">#' + esc(k) + '</a>'; }).join('') + '</div>' : '') +
      '<div class="fileinfo"><div><span>Format</span><b>' + fmtName(im.fm) + '</b></div><div><span>Dimensi</span><b>' + (im.w ? im.w + ' × ' + im.h + ' px' : '-') + '</b></div><div><span>Ukuran berkas</span><b>' + fmtKB(im.kb) + '</b></div><div><span>Dilihat</span><b>' + fmtNum(im._v) + ' kali</b></div></div></div>' +
      (doc ? '<div class="card docbox"><span class="doc-badge">' + ic('lock') + 'KHUSUS DOKTER</span><p>Hanya dokter terdaftar yang dapat mengubah atau menghapus gambar ini.</p><div class="row"><a class="btn btn-outline" href="#/kelola/edit/' + esc(im.id) + '">' + ic('pencil') + 'Edit</a><button type="button" class="btn btn-danger-o" data-del="' + esc(im.id) + '" data-after="home">' + ic('trash') + 'Hapus</button></div></div>' : '');
    document.title = im.n + ' · Atlas Anatomi Tubuh';
    if (fresh) {
      if (S.lastView.id !== id || Date.now() - S.lastView.t > 20000) { API.logView(id); S.lastView = { id: id, t: Date.now() }; im._v++; }
      [prev, next].forEach(function (x) { if (x && x !== im) { var p = new Image(); p.src = fullUrl(x); } });   // prefetch tetangga
    }
  }

  /* ----- masuk dokter ----- */
  var pinBusy = false;
  function renderLogin() {
    var el = $('#view-login');
    if (Auth.get()) { go('#/kelola'); return; }
    el.innerHTML = '<div class="login"><div class="card login-card" id="lcard"><span class="brand-mark">' + ic('body') + '</span><h1>Masuk Dokter</h1><p class="sub">Gunakan akun Google yang terdaftar atau PIN dokter untuk membuka Panel Kelola.</p>' +
      (CFG.GOOGLE_CLIENT_ID ? '<div id="gbtn"></div><div class="or">atau PIN dokter</div>' : '') +
      '<div class="mlabel">PIN 6 digit</div><div class="pin" id="pin">' + '<input inputmode="numeric" pattern="[0-9]*" maxlength="1" autocomplete="one-time-code" aria-label="Digit PIN">'.repeat(6) + '</div><div id="lmsg"></div>' +
      '<button type="button" class="btn btn-primary btn-lg btn-block" id="btnPin">' + ic('key') + 'Masuk dengan PIN</button>' +
      (API.demo ? '<div class="msg msg-info">' + ic('info') + '<span>Mode demo: gunakan PIN <b>123456</b>.</span></div>' : '') +
      '<p style="text-align:center;margin-top:16px"><a href="#/" class="btn btn-ghost btn-sm">' + ic('arrowL') + 'Kembali ke atlas</a></p></div></div>';
    var ins = $$('#pin input');
    ins.forEach(function (inp, i) {
      inp.addEventListener('input', function () { inp.value = inp.value.replace(/\D/g, '').slice(-1); if (inp.value && ins[i + 1]) ins[i + 1].focus(); if (ins.every(function (x) { return x.value; })) doPin(); });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Backspace' && !inp.value && ins[i - 1]) { ins[i - 1].focus(); ins[i - 1].value = ''; } else if (e.key === 'Enter') doPin(); });
      inp.addEventListener('paste', function (e) { var t = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6); if (!t) return; e.preventDefault(); t.split('').forEach(function (c, k) { if (ins[k]) ins[k].value = c; }); (ins[Math.min(t.length, 5)]).focus(); if (t.length === 6) doPin(); });
    });
    setTimeout(function () { if (ins[0]) ins[0].focus(); }, 40);
    $('#btnPin').onclick = doPin;
    if (CFG.GOOGLE_CLIENT_ID) loadGoogle();
  }
  function loginMsg(t, type) { var m = $('#lmsg'); if (m) m.innerHTML = t ? '<div class="msg msg-' + (type || 'err') + '">' + ic('alert') + '<span>' + esc(t) + '</span></div>' : ''; }
  function finishLogin(r) {
    Auth.set({ token: r.token, exp: r.exp, dokter: r.dokter });
    S.adm.boot = r.boot || null; S.adm.bootT = Date.now(); if (r.boot) { Store.set('admin:boot', { t: Date.now(), data: r.boot }); S.adm.stats['30'] = { t: Date.now(), data: r.boot.stats }; }
    toast('Selamat datang, ' + ((r.dokter && r.dokter.nama) || 'Dokter') + '.', 'success'); go('#/kelola');
  }
  function doPin() {
    if (pinBusy) return;
    var ins = $$('#pin input'), pin = ins.map(function (x) { return x.value; }).join('');
    if (pin.length < 6) { loginMsg('Masukkan 6 digit PIN.'); return; }
    pinBusy = true; var b = $('#btnPin'); b.disabled = true; b.innerHTML = '<span class="spin"></span>Memeriksa...'; loginMsg('');
    API.login(pin).then(function (r) {
      if (r.success) return finishLogin(r);
      $('#pin').classList.add('bad'); setTimeout(function () { var p = $('#pin'); if (p) p.classList.remove('bad'); }, 500);
      ins.forEach(function (x) { x.value = ''; }); ins[0].focus();
      loginMsg(r.code === 'BAD_PIN' ? 'PIN salah. Sisa percobaan: ' + r.left + '.' : (r.message || 'Gagal masuk.'));
    }).catch(function (e) { loginMsg(e.message || 'Gagal terhubung ke server.'); })
      .then(function () { pinBusy = false; var bb = $('#btnPin'); if (bb) { bb.disabled = false; bb.innerHTML = ic('key') + 'Masuk dengan PIN'; } });
  }
  function loadGoogle() {
    function init() {
      try {
        google.accounts.id.initialize({ client_id: CFG.GOOGLE_CLIENT_ID, callback: function (resp) {
          loginMsg(''); API.loginGoogle(resp.credential).then(function (r) { if (r.success) finishLogin(r); else if (r.code === 'DENIED') showDenied(r.email); else loginMsg(r.message); }).catch(function (e) { loginMsg(e.message); });
        } });
        google.accounts.id.renderButton($('#gbtn'), { theme: 'filled_blue', size: 'large', text: 'continue_with', shape: 'rectangular', width: 360 });
      } catch (e) { /* abaikan */ }
    }
    if (window.google && google.accounts) return init();
    var s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = init; document.head.appendChild(s);
  }
  function showDenied(email) {
    $('#lcard').innerHTML = '<div class="denied"><div class="big">' + ic('shield') + '</div><h1 style="font-size:22px;line-height:28px">Akun ini tidak terdaftar sebagai dokter</h1><div class="acct"><div class="mlabel">Akun Google</div><b>' + esc(email || '-') + '</b><p class="muted" style="margin-top:6px">Hanya dokter yang emailnya terdaftar yang dapat membuka Panel Kelola.</p></div><a class="btn btn-primary btn-lg btn-block" href="#/">Kembali ke atlas</a><button type="button" class="btn btn-outline btn-lg btn-block" data-relogin>Ganti akun Google</button></div>';
  }

  /* ============================================================
     PANEL DOKTER
     ============================================================ */
  var AV = $('#view-admin'), admCur = { sub: '', param: '' };
  var crumb = function (h) { $('#crumb').innerHTML = h; };
  var driveLink = 'https://drive.google.com/drive/my-drive';

  function adminRoute(sub, param) {
    var a = Auth.get(); if (!a) { go('#/masuk'); return; }
    setShell('admin');
    var nm = (a.dokter && a.dokter.nama) || S.cfg.NAMA_DOKTER || 'Dokter';
    $('#whoName').textContent = nm; $('#whoEmail').textContent = (a.dokter && a.dokter.email) || '';
    $('#whoAv').textContent = nm.replace(/^dr\.?\s*/i, '').charAt(0).toUpperCase() || 'D';
    document.body.classList.remove('menu-open');
    var nav = { '': 'list', tambah: 'add', edit: 'list', statistik: 'stats', riwayat: 'log' }[sub] || 'list';
    $$('.side-nav [data-nav]').forEach(function (x) { x.classList.toggle('on', x.dataset.nav === nav); });
    loadAdminBoot();
    window.scrollTo(0, 0);
    document.title = 'Panel Dokter · Atlas Anatomi Tubuh';
    if (sub === 'tambah') adminForm(null); else if (sub === 'edit') adminForm(param || '__x'); else if (sub === 'statistik') adminStats(); else if (sub === 'riwayat') adminLog(); else adminList();
  }
  function loadAdminBoot(force) {
    if (!S.adm.boot) { var c = Store.get('admin:boot'); if (c && c.data) { S.adm.boot = c.data; S.adm.bootT = c.t || 0; } }
    if (!force && S.adm.boot && Date.now() - S.adm.bootT < CFG.FRESH_TTL_MS * 2) return;
    API.adminBootstrap().then(function (r) {
      if (!r || !r.success) return;
      S.adm.boot = { stats: r.stats, log: r.log, drive: r.drive, cfg: r.cfg }; S.adm.bootT = Date.now();
      Store.set('admin:boot', { t: Date.now(), data: S.adm.boot }); S.adm.stats['30'] = { t: Date.now(), data: r.stats };
      if (document.body.dataset.shell === 'admin') { if (admCur.sub === '' ) adminList(); else if (admCur.sub === 'riwayat') adminLog(); else if (admCur.sub === 'tambah' || admCur.sub === 'edit') drawBanner(); }
    }).catch(function () {});
  }
  function driveInfo() {
    var d = S.adm.boot && S.adm.boot.drive; if (!d || !d.limit) return null;
    var pct = d.used / d.limit * 100, lim = Number((S.adm.boot.cfg || {}).DRIVE_WARN_PCT) || 95;
    return { used: d.used, limit: d.limit, pct: pct, full: pct >= lim || (d.limit - d.used) < 52428800 };
  }
  function skelAdmin() { return '<div class="sk" style="height:96px;margin-bottom:16px"></div><div class="sk" style="height:360px"></div>'; }

  /* ----- daftar gambar ----- */
  function filterAdmin() {
    var f = S.adm.f, q = norm(f.q);
    var l = S.imgs.filter(function (i) {
      if (f.cat !== 'all' && i.c !== f.cat) return false;
      if (f.fmt !== 'all' && String(i.fm).toLowerCase().replace('jpeg', 'jpg') !== f.fmt) return false;
      if (q && (i._s.n.indexOf(q) < 0 && norm(i.id).indexOf(q) < 0 && i._s.k.join(' ').indexOf(q) < 0)) return false;
      return true;
    });
    l.sort(function (a, b) {
      if (f.sort === 'new') return a.dt < b.dt ? 1 : -1;
      if (f.sort === 'name') return a.n.localeCompare(b.n, 'id');
      if (f.sort === 'size') return b.kb - a.kb;
      return b._v - a._v;
    });
    return l;
  }
  function adminList() {
    crumb('Panel Kelola <span>›</span> <b>Daftar Gambar</b>');
    if (!S.ready) { AV.innerHTML = S.err ? errState() : skelAdmin(); return; }
    var f = S.adm.f, cnt = {}, tv = 0, di = driveInfo();
    S.imgs.forEach(function (i) { cnt[i.c] = (cnt[i.c] || 0) + 1; tv += i._v; });
    var best = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; })[0];
    AV.innerHTML = '<div class="ph"><div><h1>Daftar Gambar <span class="pill">' + S.imgs.length + ' gambar</span></h1><p>Kelola gambar atlas untuk edukasi pasien.</p></div><a class="btn btn-primary btn-lg" href="#/kelola/tambah">' + ic('plus') + 'Tambah Gambar</a></div>' +
      '<div class="stats">' +
      '<div class="card stat"><div class="l">Total gambar ' + ic('image') + '</div><div class="v">' + S.imgs.length + '</div><div class="s">' + S.cats.length + ' kategori anatomi</div></div>' +
      '<div class="card stat"><div class="l">Total penayangan ' + ic('eye') + '</div><div class="v">' + fmtNum(tv) + '<small> kali</small></div><div class="s">Seluruh gambar</div></div>' +
      '<div class="card stat"><div class="l">Kategori terbanyak ' + ic('folder') + '</div><div class="v" style="font-size:20px;line-height:34px">' + (best ? esc(catName(best)) : '-') + '</div><div class="s">' + (best ? cnt[best] + ' gambar' : 'Belum ada data') + '</div></div>' +
      '<div class="card stat"><div class="l">Penyimpanan Drive ' + ic('drive') + '</div>' + (di ? '<div class="v">' + fmtBytes(di.used) + '<small> / ' + fmtBytes(di.limit) + '</small></div><div class="bar' + (di.pct >= 95 ? ' crit' : (di.pct >= 80 ? ' warn' : '')) + '"><i style="width:' + Math.min(100, di.pct).toFixed(1) + '%"></i></div><div class="s"><a href="' + driveLink + '" target="_blank" rel="noopener">Buka Google Drive</a></div>' : '<div class="v">-</div><div class="s">Memuat status...</div>') + '</div></div>' +
      '<div class="card filters"><div class="sf">' + ic('search') + '<input class="inp" id="aq" type="search" placeholder="Cari nama bagian tubuh, ID, atau kata kunci" value="' + esc(f.q) + '" aria-label="Cari gambar"></div>' +
      '<select class="inp sel" id="acat" style="width:auto" aria-label="Kategori"><option value="all">Kategori: Semua</option>' + S.cats.map(function (c) { return '<option value="' + esc(c.id) + '"' + (f.cat === c.id ? ' selected' : '') + '>' + esc(c.n) + '</option>'; }).join('') + '</select>' +
      '<select class="inp sel" id="afmt" style="width:auto" aria-label="Format">' + [['all', 'Format: Semua'], ['webp', 'WebP'], ['jpg', 'JPG'], ['png', 'PNG']].map(function (o) { return '<option value="' + o[0] + '"' + (f.fmt === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
      '<select class="inp sel" id="asort" style="width:auto" aria-label="Urutkan">' + [['views', 'Paling sering dilihat'], ['new', 'Terbaru'], ['name', 'Nama A-Z'], ['size', 'Ukuran terbesar']].map(function (o) { return '<option value="' + o[0] + '"' + (f.sort === o[0] ? ' selected' : '') + '>Urutkan: ' + o[1] + '</option>'; }).join('') + '</select>' +
      '<div class="seg" id="aview"><button type="button" data-v="table" class="' + (f.view === 'table' ? 'on' : '') + '">' + ic('table') + 'Tabel</button><button type="button" data-v="grid" class="' + (f.view === 'grid' ? 'on' : '') + '">' + ic('grid') + 'Grid</button></div></div>' +
      '<div class="card" id="aTable"></div>';
    var rd = function () { f.page = 1; drawATable(); };
    $('#aq').addEventListener('input', function (e) { f.q = e.target.value; rd(); });
    $('#acat').addEventListener('change', function (e) { f.cat = e.target.value; rd(); });
    $('#afmt').addEventListener('change', function (e) { f.fmt = e.target.value; rd(); });
    $('#asort').addEventListener('change', function (e) { f.sort = e.target.value; rd(); });
    $('#aview').addEventListener('click', function (e) { var b = e.target.closest('[data-v]'); if (!b) return; f.view = b.dataset.v; $$('#aview button').forEach(function (x) { x.classList.toggle('on', x === b); }); drawATable(); });
    drawATable();
  }
  function pageList(cur, n) {
    if (n <= 7) { var a = []; for (var i = 1; i <= n; i++) a.push(i); return a; }
    var s = { 1: 1, 2: 1, 3: 1 }; s[n] = 1; s[cur] = 1; s[cur - 1] = 1; s[cur + 1] = 1;
    var keys = Object.keys(s).map(Number).filter(function (x) { return x >= 1 && x <= n; }).sort(function (a, b) { return a - b; }), out = [], last = 0;
    keys.forEach(function (k) { if (last && k - last > 1) out.push('…'); out.push(k); last = k; }); return out;
  }
  function drawATable() {
    var box = $('#aTable'); if (!box) return;
    var f = S.adm.f, l = filterAdmin(), pages = Math.max(1, Math.ceil(l.length / f.per)); if (f.page > pages) f.page = pages;
    var a = (f.page - 1) * f.per, rows = l.slice(a, a + f.per), body;
    if (!l.length) { box.innerHTML = '<div style="padding:12px">' + emptyBlock('image', S.imgs.length ? 'Tidak ada gambar yang cocok' : 'Belum ada gambar', S.imgs.length ? 'Ubah kata kunci atau filter pencarian Anda.' : 'Mulai dengan menambahkan gambar anatomi pertama.', '<a class="btn btn-primary" href="#/kelola/tambah">' + ic('plus') + 'Tambah Gambar</a>') + '</div>'; return; }
    var act = function (i) { return '<div class="t-act"><a class="icon-btn" href="#/kelola/edit/' + esc(i.id) + '" aria-label="Edit ' + esc(i.n) + '" title="Edit">' + ic('pencil') + '</a><button type="button" class="icon-btn del" data-del="' + esc(i.id) + '" aria-label="Hapus ' + esc(i.n) + '" title="Hapus">' + ic('trash') + '</button></div>'; };
    if (f.view === 'grid') {
      body = '<div class="agrid">' + rows.map(function (i) { return '<div class="acard">' + thumbHtml(i) + '<div class="b"><div class="t-name">' + esc(i.n) + '</div><div class="t-id">' + esc(i.id) + ' · ' + esc(catName(i.c)) + ' · ' + fmtNum(i._v) + 'x</div></div>' + act(i) + '</div>'; }).join('') + '</div>';
    } else {
      body = '<div class="tbl-wrap"><table class="tbl-resp"><thead><tr><th></th><th>Nama bagian tubuh &amp; ID</th><th>Kategori</th><th>Format</th><th class="r">Ukuran</th><th class="r">Dilihat</th><th>Diunggah</th><th class="r">Aksi</th></tr></thead><tbody>' +
        rows.map(function (i) {
          return '<tr><td class="c-thumb"><a class="t-thumb" href="#/gambar/' + esc(i.id) + '"><img class="ld" loading="lazy" decoding="async" src="' + esc(thumbUrl(i)) + '" data-fb="' + esc(driveFb(i.t || i.f)) + '" alt=""></a></td>' +
            '<td class="c-name"><div class="t-name">' + esc(i.n) + '</div><div class="t-id">' + esc(i.id) + '</div></td><td class="c-meta"><span class="pill pill-cat up">' + esc(catName(i.c)) + '</span></td>' +
            '<td class="hide-m"><span class="pill up">' + fmtName(i.fm) + '</span>' + (i.w ? ' <span class="t-id">' + ratioLabel(i.w, i.h) + '</span>' : '') + '</td><td class="r tab c-meta" data-l="Ukuran">' + fmtKB(i.kb) + '</td><td class="r tab c-meta" data-l="Dilihat">' + fmtNum(i._v) + 'x</td>' +
            '<td class="hide-m">' + fDate(i.dt) + '<div class="t-id">' + esc((i.by || '').split('@')[0]) + '</div></td><td class="c-act">' + act(i) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    box.innerHTML = body + '<div class="pager"><span>Menampilkan ' + (a + 1) + '–' + (a + rows.length) + ' dari ' + l.length + ' gambar</span><div class="pg"><button type="button" data-pg="' + (f.page - 1) + '"' + (f.page <= 1 ? ' disabled' : '') + ' aria-label="Sebelumnya">' + ic('chevL') + '</button>' +
      pageList(f.page, pages).map(function (p) { return p === '…' ? '<button type="button" disabled>…</button>' : '<button type="button" data-pg="' + p + '" class="' + (p === f.page ? 'on' : '') + '">' + p + '</button>'; }).join('') +
      '<button type="button" data-pg="' + (f.page + 1) + '"' + (f.page >= pages ? ' disabled' : '') + ' aria-label="Berikutnya">' + ic('chevR') + '</button></div></div>';
  }

  /* ----- hapus (optimistik + rollback) ----- */
  function softSync() { setTimeout(function () { if (S.ready) refreshBoot(); }, 1200); }
  function doDelete(id, after) {
    var im = S.byId[id]; if (!im) return;
    modal({ danger: true, icon: 'alert', title: 'Hapus gambar "' + im.n + '"?', body: 'Gambar dan thumbnail akan dipindahkan ke tempat sampah Google Drive dan masih dapat dipulihkan dari Drive. Gambar tidak akan tampil lagi di atlas.<br><br><span class="mono">' + esc(im.id) + '</span>', ok: 'Ya, Hapus' }).then(function (ok) {
      if (!ok) return;
      var idx = S.imgs.indexOf(im); S.imgs.splice(idx, 1); delete S.byId[id]; persist();
      if (after === 'home') go('#/'); else renderCurrent(true);
      toast('Gambar dipindahkan ke tempat sampah.', 'success');
      API.deleteImage({ id: id }).then(function (r) { if (!r || !r.success) throw new Error((r && r.message) || 'Server menolak permintaan.'); S.adm.bootT = 0; softSync(); })
        .catch(function (e) { S.imgs.splice(idx, 0, im); S.byId[id] = im; persist(); renderCurrent(true); toast('Gagal menghapus: ' + e.message + ' Gambar dikembalikan.', 'error'); });
    });
  }

  /* ----- form tambah / edit ----- */
  function drawBanner() {
    var b = $('#fBanner'); if (!b) return; var di = driveInfo();
    b.innerHTML = di && di.full ? '<div class="msg msg-err" style="margin-bottom:16px">' + ic('alert') + '<span><b>Penyimpanan Google Drive hampir penuh (' + Math.round(di.pct) + '%).</b> Unggahan gambar dinonaktifkan sementara. Kosongkan Sampah atau tambah kuota di <a href="' + driveLink + '" target="_blank" rel="noopener">Google Drive</a>.</span></div>' : '';
    var drop = $('#drop'); if (drop) drop.classList.toggle('off', !!(di && di.full));
    var sb = $('#fSave'); if (sb && !S.F.busy) sb.disabled = !!(di && di.full && (!S.F.edit || S.F.comp));
  }
  function adminForm(id) {
    if (!S.ready) { crumb('Panel Kelola'); AV.innerHTML = S.err ? errState() : skelAdmin(); return; }
    var edit = (id && id !== '__x') ? S.byId[id] : null;
    if (id && !edit) { crumb('Panel Kelola <span>›</span> <b>Edit</b>'); AV.innerHTML = emptyBlock('image', 'Gambar tidak ditemukan', 'Gambar ini mungkin sudah dihapus.', '<a class="btn btn-primary" href="#/kelola">Kembali ke daftar</a>'); return; }
    if (S.F && S.F.comp) { URL.revokeObjectURL(S.F.comp.previewUrl); URL.revokeObjectURL(S.F.comp.thumbUrl); }
    var F = S.F = { edit: edit, comp: null, working: false, busy: false, pct: 0, label: '', tags: edit ? (edit.k || []).slice() : [] };
    crumb('Panel Kelola <span>›</span> <a href="#/kelola">Daftar Gambar</a> <span>›</span> <b>' + (edit ? 'Edit ' + esc(edit.id) : 'Tambah Gambar') + '</b>');
    AV.innerHTML = '<div class="ph"><div><a class="btn btn-ghost btn-sm" href="#/kelola" style="margin-left:-12px">' + ic('arrowL') + 'Kembali ke daftar gambar</a><h1 style="margin-top:6px">' + (edit ? 'Edit Gambar Anatomi' : 'Tambah Gambar Anatomi') + '</h1></div></div><div id="fBanner"></div>' +
      '<div class="fgrid"><div class="card fcard"><h2>Informasi gambar</h2><p class="sub">Isi data agar gambar mudah ditemukan saat konsultasi.</p>' +
      '<div class="fld"><label>Berkas gambar ' + (edit ? '(opsional, untuk mengganti)' : '<i>*</i>') + '</label><div class="drop" id="drop" tabindex="0" role="button" aria-label="Pilih berkas gambar">' + ic('upload') + '<b id="dropT">Tarik gambar ke sini atau klik untuk memilih</b><small>Format JPG, PNG, atau WebP. Gambar dikompres otomatis.</small></div><input type="file" id="file" accept="image/jpeg,image/png,image/webp" hidden><div class="help" id="fileHelp"></div></div>' +
      '<div class="fld"><label>Nama bagian tubuh <i>*</i></label><input class="inp" id="fNama" maxlength="120" autocomplete="off" value="' + esc(edit ? edit.n : '') + '" placeholder="mis. Sendi Lutut &amp; Meniskus Medial"><div class="help" id="nmHelp"></div></div>' +
      '<div class="fld"><label>Kategori anatomi <i>*</i></label><select class="inp sel" id="fCat"><option value="">Pilih kategori</option>' + S.cats.map(function (c) { return '<option value="' + esc(c.id) + '"' + (edit && edit.c === c.id ? ' selected' : '') + '>' + esc(c.n) + '</option>'; }).join('') + '</select><div class="help" id="catHelp"></div></div>' +
      '<div class="fld"><label>Deskripsi singkat untuk pasien</label><textarea class="inp" id="fDesk" maxlength="500" placeholder="Jelaskan bagian ini dengan bahasa yang mudah dipahami pasien.">' + esc(edit ? edit.d : '') + '</textarea></div>' +
      '<div class="fld" style="margin-bottom:0"><label>Kata kunci pencarian (tekan Enter)</label><div class="taginp" id="tags"></div><div class="help">Contoh: lutut, meniskus, sendi. Dipakai untuk pencarian dan saran otomatis.</div></div></div>' +
      '<div class="card fcard" id="fRight"></div></div>' +
      '<div class="actbar"><span class="l muted">' + (edit ? 'Perubahan akan tercatat di Riwayat Aktivitas.' : 'Gambar akan diunggah ke Google Drive dan dicatat di Google Sheets.') + '</span><a class="btn btn-outline btn-lg" href="#/kelola">Batal</a><button type="button" class="btn btn-primary btn-lg" id="fSave">' + ic('upload') + (edit ? 'Simpan Perubahan' : 'Simpan & Unggah') + '</button></div>';
    drawTags(); drawInsp(); drawBanner(); checkName();
    var drop = $('#drop'), fi = $('#file');
    drop.addEventListener('click', function () { if (!drop.classList.contains('off')) fi.click(); });
    drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!drop.classList.contains('off')) fi.click(); } });
    ['dragenter', 'dragover'].forEach(function (n) { drop.addEventListener(n, function (e) { e.preventDefault(); if (!drop.classList.contains('off')) drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (n) { drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { if (!drop.classList.contains('off') && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
    fi.addEventListener('change', function () { if (fi.files[0]) handleFile(fi.files[0]); fi.value = ''; });
    $('#fNama').addEventListener('input', checkName);
    $('#fSave').addEventListener('click', function () { submitForm(false); });
    $('#tags').addEventListener('click', function (e) { var x = e.target.closest('[data-rm]'); if (x) { F.tags.splice(+x.dataset.rm, 1); drawTags(); $('#tagIn').focus(); } else $('#tagIn').focus(); });
  }
  function drawTags() {
    var F = S.F, box = $('#tags'); if (!box) return;
    box.innerHTML = F.tags.map(function (t, i) { return '<span class="kw">' + esc(t) + '<button type="button" data-rm="' + i + '" aria-label="Hapus kata kunci ' + esc(t) + '">' + ic('x') + '</button></span>'; }).join('') + '<input id="tagIn" placeholder="' + (F.tags.length ? '' : 'Tambah kata kunci...') + '" maxlength="40" aria-label="Tambah kata kunci">';
    var inp = $('#tagIn');
    function add() { var v = inp.value.replace(/,/g, '').trim().toLowerCase(); if (v && F.tags.indexOf(v) < 0 && F.tags.length < 20) { F.tags.push(v); drawTags(); $('#tagIn').focus(); } else inp.value = ''; }
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } else if (e.key === 'Backspace' && !inp.value && F.tags.length) { F.tags.pop(); drawTags(); $('#tagIn').focus(); } });
    inp.addEventListener('blur', function () { if (inp.value.trim()) add(); });
  }
  function checkName() {
    var v = $('#fNama').value.trim(), h = $('#nmHelp'), n = norm(v), F = S.F; if (!h) return;
    $('#fNama').classList.remove('bad');
    if (!n) { h.className = 'help'; h.textContent = ''; return; }
    var exact = S.imgs.some(function (i) { return i._s.n === n && (!F.edit || i.id !== F.edit.id); });
    var close = !exact && S.imgs.some(function (i) { return (!F.edit || i.id !== F.edit.id) && (i._s.n.indexOf(n) >= 0 || n.indexOf(i._s.n) >= 0); });
    h.className = 'help ' + (exact ? 'bad' : (close ? 'warn' : '')); h.textContent = exact ? 'Nama ini sudah ada. Gunakan nama yang berbeda (mis. tambahkan Kanan/Kiri).' : (close ? 'Nama mirip dengan gambar yang sudah ada. Pastikan bukan duplikat.' : '');
  }
  function handleFile(file) {
    var F = S.F;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { $('#fileHelp').className = 'help bad'; $('#fileHelp').textContent = 'Format tidak didukung. Gunakan JPG, PNG, atau WebP.'; toast('Format tidak didukung. Gunakan JPG, PNG, atau WebP.', 'error'); return; }
    $('#fileHelp').textContent = ''; $('#fileHelp').className = 'help';
    if (F.comp) { URL.revokeObjectURL(F.comp.previewUrl); URL.revokeObjectURL(F.comp.thumbUrl); F.comp = null; }
    F.working = true; F.pct = 4; F.label = 'Membaca gambar...'; drawInsp();
    $('#dropT').textContent = file.name + ' · ' + fmtKB(Math.round(file.size / 1024));
    var nm = $('#fNama'); if (!nm.value.trim()) { nm.value = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }); checkName(); }
    window.compressImage(file, { maxSide: S.cfg.MAX_SIDE, maxKB: S.cfg.MAX_KB, quality: S.cfg.QUALITY, minQuality: S.cfg.MIN_QUALITY, thumbSide: S.cfg.THUMB_SIDE }, function (p, l) { F.pct = p; F.label = l; drawInsp(); })
      .then(function (c) { F.comp = c; F.working = false; drawInsp(); drawBanner(); if (c.overLimit) toast('Gambar masih di atas batas ' + fmtKB(S.cfg.MAX_KB) + ' setelah dikompres maksimal.', 'warning'); })
      .catch(function (e) { F.working = false; $('#dropT').textContent = 'Tarik gambar ke sini atau klik untuk memilih'; $('#fileHelp').className = 'help bad'; $('#fileHelp').textContent = e.message; drawInsp(); toast(e.message, 'error'); });
  }
  function drawInsp() {
    var F = S.F, box = $('#fRight'); if (!box) return;
    var head = '<div class="insp-head"><div><h2>Kompresi otomatis di browser</h2><p class="sub">Gambar diperkecil sebelum dikirim ke Google Drive agar cepat dan hemat kuota.</p></div><span class="pill pill-teal">Aktif</span></div>', body;
    if (F.working) body = '<div class="pv"><div class="ph-t"><span class="spin" style="width:28px;height:28px"></span><span>' + esc(F.label) + '</span></div></div><div class="prog"><div class="row"><span>' + esc(F.label) + '</span><b>' + F.pct + '%</b></div><div class="bar"><i style="width:' + F.pct + '%"></i></div></div>';
    else if (F.comp) {
      var c = F.comp, save = c.originalKB > 0 ? Math.round((1 - c.sizeKB / c.originalKB) * 1000) / 10 : 0;
      body = '<div class="pv"><img src="' + c.previewUrl + '" alt="Pratinjau hasil kompresi"></div><div class="kv">' +
        '<div><span>Ukuran berkas asal</span><b>' + fmtKB(c.originalKB) + ' · ' + c.origW + ' × ' + c.origH + ' px</b></div>' +
        '<div><span>Hasil kompresi</span><b class="good">' + fmtKB(c.sizeKB) + ' · sisi terpanjang ' + Math.max(c.w, c.h) + ' px</b></div>' +
        '<div><span>Penghematan</span><b>' + (save > 0 ? save.toString().replace('.', ',') + '%' : 'Sudah optimal') + '</b></div>' +
        '<div><span>Format akhir</span><b>' + (c.webp ? 'WebP' : (c.alpha ? 'PNG (cadangan)' : 'JPG (cadangan)')) + (c.alpha ? ' · transparansi dipertahankan' : '') + '</b></div></div>' +
        '<div class="prog"><div class="row"><span>Kualitas kompresi</span><b>' + (c.format === 'png' ? 'PNG tanpa penurunan kualitas' : Math.round(c.quality * 100) + '%') + '</b></div><div class="bar"><i style="width:' + (c.format === 'png' ? 100 : Math.round(c.quality * 100)) + '%"></i></div></div>' +
        '<div class="thumbrow"><div class="tt"><img src="' + c.thumbUrl + '" alt="Thumbnail"></div><div><b>Thumbnail otomatis</b><div class="muted">Dibuat dengan sisi terpanjang ' + S.cfg.THUMB_SIDE + ' px untuk galeri yang cepat.</div></div></div>' +
        (c.overLimit ? '<div class="msg msg-warn">' + ic('alert') + '<span>Ukuran masih melebihi batas ' + fmtKB(S.cfg.MAX_KB) + '. Server dapat menolaknya.</span></div>' : '') +
        '<div class="ready">' + ic('okc') + 'Berkas siap diunggah ke Google Drive<small>Siap kirim</small></div>';
    } else if (F.edit) {
      body = '<div class="pv"><img src="' + esc(fullUrl(F.edit)) + '" data-fb="' + esc(driveFb(F.edit.f)) + '" alt="' + esc(F.edit.n) + '"></div><div class="kv"><div><span>Format</span><b>' + fmtName(F.edit.fm) + '</b></div><div><span>Dimensi</span><b>' + (F.edit.w ? F.edit.w + ' × ' + F.edit.h + ' px' : '-') + '</b></div><div><span>Ukuran berkas</span><b>' + fmtKB(F.edit.kb) + '</b></div><div><span>Dilihat</span><b>' + fmtNum(F.edit._v) + ' kali</b></div><div><span>Diunggah</span><b>' + fDate(F.edit.dt) + '</b></div></div><p class="muted" style="margin-top:12px">Pilih berkas baru di sebelah kiri bila ingin mengganti gambar. Jika tidak, hanya data teks yang diperbarui.</p>';
    } else body = '<div class="pv"><div class="ph-t">' + ic('image') + '<b>Pratinjau akan tampil di sini</b><span>Pilih gambar untuk melihat hasil kompresi sebelum disimpan.</span></div></div><div class="kv"><div><span>Sisi terpanjang maksimal</span><b>' + S.cfg.MAX_SIDE + ' px</b></div><div><span>Ukuran maksimal</span><b>' + fmtKB(S.cfg.MAX_KB) + '</b></div><div><span>Kualitas awal</span><b>' + Math.round(S.cfg.QUALITY * 100) + '%</b></div></div>';
    box.innerHTML = head + body;
  }
  function submitForm(force) {
    var F = S.F; if (F.busy) return;
    var nama = $('#fNama').value.trim(), cat = $('#fCat').value, desk = $('#fDesk').value.trim(), bad = false;
    if (!nama) { $('#fNama').classList.add('bad'); $('#nmHelp').className = 'help bad'; $('#nmHelp').textContent = 'Nama bagian tubuh wajib diisi.'; bad = true; }
    if (!cat) { $('#catHelp').className = 'help bad'; $('#catHelp').textContent = 'Pilih kategori anatomi.'; bad = true; } else $('#catHelp').textContent = '';
    if (!F.edit && !F.comp) { $('#fileHelp').className = 'help bad'; $('#fileHelp').textContent = F.working ? 'Tunggu hingga kompresi selesai.' : 'Pilih berkas gambar terlebih dahulu.'; bad = true; }
    if (F.working) { toast('Tunggu hingga kompresi selesai.', 'warning'); return; }
    if (bad) { var first = $('.bad, .help.bad', AV); if (first && first.scrollIntoView) first.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    var n = norm(nama), dup = S.imgs.some(function (i) { return i._s.n === n && (!F.edit || i.id !== F.edit.id); });
    if (dup && !force) { modal({ title: 'Nama sudah ada', icon: 'alert', body: 'Sudah ada gambar dengan nama "' + esc(nama) + '". Tetap simpan dengan nama yang sama?', ok: 'Tetap simpan', cancel: 'Ubah nama' }).then(function (ok) { if (ok) submitForm(true); }); return; }
    var p = { nama: nama, kategoriId: cat, deskripsi: desk, kataKunci: F.tags.slice() };
    if (force) p.force = true;
    if (F.comp) { var c = F.comp; p.fileB64 = c.fileB64; p.thumbB64 = c.thumbB64; p.format = c.format; p.lebar = c.w; p.tinggi = c.h; p.sizeKB = c.sizeKB; p.asalKB = c.originalKB; }
    var btn = $('#fSave'), lbl = btn.innerHTML;
    var unbusy = function () { F.busy = false; btn.disabled = false; btn.innerHTML = lbl; drawBanner(); };
    var onFail = function (r) {
      if (r && r.code === 'DUPLICATE') { modal({ title: 'Nama sudah ada', icon: 'alert', body: 'Server mendeteksi nama yang sama. Tetap simpan?', ok: 'Tetap simpan', cancel: 'Ubah nama' }).then(function (ok) { if (ok) submitForm(true); }); return; }
      if (r && r.code === 'STORAGE_FULL') { S.adm.boot = S.adm.boot || {}; var d = S.adm.boot.drive || { used: 1, limit: 1 }; S.adm.boot.drive = { used: d.limit || 1, limit: d.limit || 1 }; }
      toast((r && r.message) || 'Gagal menyimpan.', 'error');
    };
    if (F.edit) p.id = F.edit.id;
    if (F.edit && !F.comp) {                      // metadata saja: optimistik
      var im = F.edit, snap = { n: im.n, c: im.c, d: im.d, k: im.k.slice() };
      im.n = nama; im.c = cat; im.d = desk; im.k = p.kataKunci.slice(); indexImg(im); persist();
      toast('Perubahan disimpan.', 'success'); go('#/kelola');
      API.updateImage(p).then(function (r) { if (!r || !r.success) throw r || new Error('Gagal'); S.adm.bootT = 0; softSync(); })
        .catch(function (r) { im.n = snap.n; im.c = snap.c; im.d = snap.d; im.k = snap.k; indexImg(im); persist(); renderCurrent(true); toast('Perubahan dibatalkan: ' + ((r && r.message) || 'gagal terhubung.'), 'error'); });
      return;
    }
    F.busy = true; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Mengunggah ke Google Drive...';
    var call = F.edit ? API.updateImage(p) : API.addImage(p);
    call.then(function (r) {
      if (!r || !r.success) { unbusy(); return onFail(r); }
      if (F.edit) { Object.assign(F.edit, r.img); indexImg(F.edit); } else { var ni = indexImg(r.img); S.imgs.unshift(ni); S.byId[ni.id] = ni; }
      persist(); S.adm.bootT = 0; toast(r.message || 'Gambar berhasil disimpan.', 'success'); go('#/kelola'); softSync();
    }).catch(function (e) { unbusy(); toast(e.message || 'Gagal menghubungi server.', 'error'); });
  }

  /* ----- statistik ----- */
  function adminStats() {
    crumb('Panel Kelola <span>›</span> <b>Statistik</b>');
    var range = S.adm.range, c = S.adm.stats[range];
    AV.innerHTML = '<div class="ph"><div><h1>Statistik</h1><p>Analitik penayangan gambar dan pencarian kata kunci.</p></div><div class="seg" id="rng">' + [['7', '7 hari'], ['30', '30 hari'], ['all', 'Semua']].map(function (o) { return '<button type="button" data-r="' + o[0] + '" class="' + (range === o[0] ? 'on' : '') + '">' + o[1] + '</button>'; }).join('') + '</div></div><div id="stBody"></div>';
    $('#rng').addEventListener('click', function (e) { var b = e.target.closest('[data-r]'); if (!b) return; S.adm.range = b.dataset.r; adminStats(); });
    drawStats(c && c.data);
    if (!c || Date.now() - c.t > 15000) {            // statistik: data maksimal 15 detik
      API.adminStats(range).then(function (r) {
        if (r && r.success) { S.adm.stats[range] = { t: Date.now(), data: r.stats }; if (S.adm.range === range && admCur.sub === 'statistik') drawStats(r.stats); }
        else if (!c) $('#stBody').innerHTML = emptyBlock('alert', 'Statistik belum dapat dimuat', (r && r.message) || '', '');
      }).catch(function (e) { if (!c && $('#stBody')) $('#stBody').innerHTML = emptyBlock('wifiOff', 'Statistik belum dapat dimuat', e.message, '<button type="button" class="btn btn-primary" data-retry-stats>Coba lagi</button>'); });
    }
  }
  function drawStats(st) {
    var box = $('#stBody'); if (!box) return;
    if (!st) { box.innerHTML = '<div class="stats" style="grid-template-columns:repeat(3,1fr)">' + '<div class="sk" style="height:104px"></div>'.repeat(3) + '</div><div class="sk" style="height:380px"></div>'; return; }
    var tr = st.trend == null ? '' : '<span class="trend ' + (st.trend >= 0 ? 'up' : 'down') + '">' + (st.trend >= 0 ? '▲ +' : '▼ ') + String(st.trend).replace('.', ',') + '%</span> <span class="muted">vs periode sebelumnya</span>';
    var max = (st.topViews[0] && st.topViews[0].n) || 1, ticks = [0, .25, .5, .75, 1].map(function (x) { return fmtNum(max * x); });
    box.innerHTML = '<div class="stats" style="grid-template-columns:repeat(3,1fr)">' +
      '<div class="card stat"><div class="l">Total gambar ' + ic('image') + '</div><div class="v">' + fmtNum(st.totalImages) + '</div><div class="s">' + (st.topCat ? 'Terbanyak: ' + esc(st.topCat.nama) : '') + '</div></div>' +
      '<div class="card stat"><div class="l">Total dilihat ' + ic('eye') + '</div><div class="v">' + fmtNum(st.totalViews) + '<small> kali</small></div><div class="s">' + tr + '</div></div>' +
      '<div class="card stat"><div class="l">Pencarian ' + ic('search') + '</div><div class="v">' + fmtNum(st.totalSearches) + '<small> kueri</small></div><div class="s">Hanya pencarian yang menemukan hasil</div></div></div>' +
      '<div class="two"><div class="card panel"><h3>10 Bagian Tubuh Paling Sering Dibuka</h3><p class="sub">Frekuensi gambar ditampilkan saat konsultasi.</p>' +
      (st.topViews.length ? st.topViews.map(function (v, i) { return '<div class="hb' + (i < 5 ? ' top' : '') + '"><span class="nm" title="' + esc(v.nama) + '">' + (i + 1) + '. ' + esc(v.nama) + '</span><div class="tr"><i style="width:' + Math.max(2, v.n / max * 100).toFixed(1) + '%"></i></div><b>' + fmtNum(v.n) + 'x</b></div>'; }).join('') + '<div class="scale">' + ticks.map(function (t) { return '<span>' + t + '</span>'; }).join('') + '</div>' : '<p class="muted" style="padding:20px 0">Belum ada penayangan pada rentang ini.</p>') + '</div>' +
      '<div class="card panel"><h3>Kata Kunci Paling Sering Dicari</h3><p class="sub">Pola pencarian gejala atau organ.</p>' +
      (st.topWords.length ? '<div class="tbl-wrap"><table><thead><tr><th>#</th><th>Kata kunci</th><th class="r">Frekuensi</th><th class="r">Terakhir</th></tr></thead><tbody>' + st.topWords.map(function (w, i) { return '<tr><td class="tab">' + (i + 1) + '</td><td><b>' + esc(w.k) + '</b></td><td class="r tab">' + fmtNum(w.n) + 'x</td><td class="r muted">' + ago(w.last) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="muted" style="padding:20px 0">Belum ada pencarian pada rentang ini.</p>') + '</div></div>';
  }

  /* ----- riwayat aktivitas ----- */
  function adminLog() {
    crumb('Panel Kelola <span>›</span> <b>Riwayat Aktivitas</b>');
    var b = S.adm.boot, f = S.adm.lf;
    if (!b) { AV.innerHTML = skelAdmin(); return; }
    var local = function (t) { var d = new Date(t); return isNaN(d) ? '' : d.toLocaleDateString('sv-SE'); };
    var rows = (b.log || []).filter(function (r) { return (f.act === 'all' || r.a === f.act) && (!f.from || local(r.t) >= f.from) && (!f.to || local(r.t) <= f.to); });
    var per = 10, pages = Math.max(1, Math.ceil(rows.length / per)); if (f.page > pages) f.page = pages;
    var a = (f.page - 1) * per, view = rows.slice(a, a + per);
    var pill = { Tambah: 'pill-ok', Edit: 'pill-info', Hapus: 'pill-danger' };
    AV.innerHTML = '<div class="ph"><div><h1>Riwayat Aktivitas</h1><p>Catatan tambah, edit, dan hapus gambar (maksimal 300 terbaru).</p></div><button type="button" class="btn btn-outline" id="lgRef">' + ic('refresh') + 'Muat ulang</button></div>' +
      '<div class="card filters"><select class="inp sel" id="lgAct" style="width:auto" aria-label="Aksi">' + [['all', 'Semua aksi'], ['Tambah', 'Tambah'], ['Edit', 'Edit'], ['Hapus', 'Hapus']].map(function (o) { return '<option value="' + o[0] + '"' + (f.act === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
      '<label class="muted" style="display:flex;gap:6px;align-items:center">Dari <input type="date" class="inp" id="lgFrom" style="width:auto" value="' + esc(f.from) + '"></label><label class="muted" style="display:flex;gap:6px;align-items:center">Sampai <input type="date" class="inp" id="lgTo" style="width:auto" value="' + esc(f.to) + '"></label>' +
      ((f.act !== 'all' || f.from || f.to) ? '<button type="button" class="btn btn-ghost btn-sm" id="lgClr">Bersihkan filter</button>' : '') + '</div>' +
      '<div class="card">' + (view.length ? '<div class="tbl-wrap"><table><thead><tr><th>Waktu</th><th>Operator</th><th>Aksi</th><th>Gambar</th><th>Keterangan</th></tr></thead><tbody>' +
        view.map(function (r) { var im = S.byId[r.id]; return '<tr><td class="tab" style="white-space:nowrap">' + fDT(r.t) + '</td><td>' + esc(r.e) + '</td><td><span class="pill ' + (pill[r.a] || '') + '">' + esc(r.a) + '</span></td><td><span class="mono">' + esc(r.id) + '</span> ' + (im ? esc(im.n) : '<span class="muted">(sudah dihapus)</span>') + '</td><td class="muted">' + esc(r.k) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
        '<div class="pager"><span>Halaman ' + f.page + ' dari ' + pages + ' (' + rows.length + ' catatan)</span><div class="pg"><button type="button" data-lpg="' + (f.page - 1) + '"' + (f.page <= 1 ? ' disabled' : '') + ' aria-label="Sebelumnya">' + ic('chevL') + '</button><button type="button" data-lpg="' + (f.page + 1) + '"' + (f.page >= pages ? ' disabled' : '') + ' aria-label="Berikutnya">' + ic('chevR') + '</button></div></div>'
        : '<div style="padding:12px">' + emptyBlock('history', 'Belum ada aktivitas', 'Aktivitas tambah, edit, dan hapus akan tampil di sini.') + '</div>') + '</div>';
    $('#lgAct').addEventListener('change', function (e) { f.act = e.target.value; f.page = 1; adminLog(); });
    $('#lgFrom').addEventListener('change', function (e) { f.from = e.target.value; f.page = 1; adminLog(); });
    $('#lgTo').addEventListener('change', function (e) { f.to = e.target.value; f.page = 1; adminLog(); });
    var clr = $('#lgClr'); if (clr) clr.addEventListener('click', function () { f.act = 'all'; f.from = ''; f.to = ''; f.page = 1; adminLog(); });
    $('#lgRef').addEventListener('click', function () { toast('Memuat ulang riwayat...', 'info'); loadAdminBoot(true); });
  }

  /* ============================================================
     SHELL, ROUTER, SINKRONISASI DATA, EVENT
     ============================================================ */
  function setShell(s) {
    document.body.dataset.shell = s;
    var adm = s === 'admin';
    $('#adminshell').hidden = !adm; $('#pubbar').hidden = adm; $('#pubfoot').hidden = adm; $('#main').hidden = adm;
    if (adm) $$('.view').forEach(function (v) { v.hidden = true; });
  }
  function showView(name) {
    ['home', 'search', 'detail', 'login'].forEach(function (n) { $('#view-' + n).hidden = n !== name; });
    document.body.dataset.page = name;
  }
  function updateDoctorBtn() {
    var b = $('#btnDokter'), a = Auth.get();
    b.setAttribute('href', a ? '#/kelola' : '#/masuk'); $('.pub-doc-t', b).textContent = a ? 'Panel Dokter' : 'Masuk Dokter';
  }
  function renderCurrent(full) {
    if (S.view === 'home') { if (full) renderHome(); else renderTop(); }
    else if (S.view === 'search') renderSearch(S.search.q);
    else if (S.view === 'detail') { if (S.cur) renderDetail(S.cur.id); }
    else if (S.view === 'admin' && document.body.dataset.shell === 'admin') {
      if (admCur.sub === '') adminList(); else if (admCur.sub === 'riwayat') adminLog(); else if (!S.F && (admCur.sub === 'tambah' || admCur.sub === 'edit')) adminRoute(admCur.sub, admCur.param);
    }
  }
  function route() {
    var parts = location.hash.replace(/^#\/?/, '').split('/'), r = parts[0] || '', prev = S.view;
    S.nav++;
    if (prev === 'home') S.scroll.home = window.scrollY;
    if (r !== 'gambar') destroyViewer();
    closeSugg();
    var q = $('#q');
    if (r === 'kelola') {
      S.view = 'admin'; admCur = { sub: parts[1] || '', param: parts[2] ? decodeURIComponent(parts[2]) : '' };
      if (admCur.sub !== 'tambah' && admCur.sub !== 'edit') S.F = null;
      adminRoute(admCur.sub, admCur.param); return;
    }
    S.F = null;
    setShell('public'); updateDoctorBtn();
    if (r === 'cari') {
      var term = decodeURIComponent(parts.slice(1).join('/')); q.value = term; S.view = 'search'; showView('search'); renderSearch(term);
      document.title = '“' + term + '” · Atlas Anatomi Tubuh'; window.scrollTo(0, 0);
    } else if (r === 'gambar') {
      q.value = ''; S.view = 'detail'; showView('detail'); renderDetail(decodeURIComponent(parts[1] || '')); window.scrollTo(0, 0);
    } else if (r === 'masuk') {
      q.value = ''; S.view = 'login'; showView('login'); renderLogin(); document.title = 'Masuk Dokter · Atlas Anatomi Tubuh'; window.scrollTo(0, 0);
    } else {
      q.value = ''; S.view = 'home'; showView('home'); renderHome(); document.title = 'Atlas Anatomi Tubuh';
      var y = (S.back && prev !== 'home') ? (S.scroll.home || 0) : 0; requestAnimationFrame(function () { window.scrollTo(0, y); });
    }
    S.back = false;
    $('#qclear').hidden = !q.value; $('#kbd').hidden = !!q.value;
  }

  var syncing = null;
  function refreshBoot() {
    if (syncing) return syncing;
    syncing = API.bootstrap().then(function (r) {
      if (!r || !r.success) throw new Error((r && r.message) || 'Gagal memuat data.');
      S.err = null; S.t = Date.now();
      var sig = r.ver + '|' + JSON.stringify(r.pend || {}), first = !S.ready, verChanged = r.ver !== S.ver;
      if (first || sig !== S.sig) { applyBoot(r); S.ready = true; persist(); renderCurrent(first || verChanged); }
      else Store.set('boot', Object.assign(Store.get('boot') || {}, { t: S.t }));
    }).catch(function (e) {
      if (!S.ready) { S.err = e.message; renderCurrent(true); } else console.warn('[sinkron]', e.message);
    }).then(function () { syncing = null; });
    return syncing;
  }

  function onSearchKey(e) {
    var box = $('#sugg');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (box.hidden) drawSugg(); if (!sg.items.length) return; e.preventDefault();
      sg.idx = (sg.idx + (e.key === 'ArrowDown' ? 1 : -1) + sg.items.length) % sg.items.length;
      $$('#sugg [data-s]').forEach(function (b, i) { b.classList.toggle('on', i === sg.idx); });
    } else if (e.key === 'Enter') { e.preventDefault(); if (sg.idx >= 0 && !box.hidden) pickSugg(sg.idx); else submitSearch(); }
    else if (e.key === 'Escape') { closeSugg(); }
  }
  function logout() { Auth.clear(); S.adm.boot = null; S.adm.stats = {}; go('#/'); toast('Anda telah keluar dari Panel Dokter.', 'info'); }

  function bind() {
    window.addEventListener('hashchange', route);
    window.addEventListener('popstate', function () { S.back = true; });
    window.addEventListener('atlas:unauth', function () { toast('Sesi dokter berakhir. Silakan masuk kembali.', 'warning'); go('#/masuk'); });
    window.addEventListener('online', function () { $('#offline').hidden = true; refreshBoot(); });
    window.addEventListener('offline', function () { $('#offline').hidden = false; });
    document.addEventListener('visibilitychange', function () { if (!document.hidden && S.ready && Date.now() - S.t > CFG.FRESH_TTL_MS * 2) refreshBoot(); });
    var q = $('#q'), tm;
    q.addEventListener('input', function () { clearTimeout(tm); tm = setTimeout(drawSugg, 60); $('#qclear').hidden = !q.value; $('#kbd').hidden = !!q.value; });
    q.addEventListener('focus', function () { if (q.value) drawSugg(); });
    q.addEventListener('keydown', onSearchKey);
    $('#qclear').addEventListener('click', function () { q.value = ''; closeSugg(); q.focus(); $('#qclear').hidden = true; $('#kbd').hidden = false; });
    document.addEventListener('keydown', function (e) {
      var typing = /INPUT|TEXTAREA|SELECT/.test((e.target.tagName || '')) || e.target.isContentEditable;
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) { if (document.body.dataset.shell === 'public') { e.preventDefault(); q.focus(); q.select(); } }
      else if (e.key === 'Escape') { if (S.full) setFull(false); else closeSugg(); }
    });
    document.addEventListener('click', function (e) {
      var t = e.target, el;
      if ((el = t.closest('#hChips [data-cat]'))) { S.home.cat = el.dataset.cat; S.home.shown = 8; $$('#hChips .chip').forEach(function (x) { x.classList.toggle('on', x === el); }); renderGal(); return; }
      if (t.closest('[data-more]')) return appendGal();
      if ((el = t.closest('[data-del]'))) return doDelete(el.dataset.del, el.dataset.after);
      if (t.closest('[data-retry]')) { S.err = null; renderCurrent(true); refreshBoot(); return; }
      if (t.closest('[data-retry-stats]')) { adminStats(); return; }
      if (t.closest('[data-back]')) { e.preventDefault(); if (S.nav > 1) history.back(); else go('#/'); return; }
      if ((el = t.closest('#sugg [data-s]'))) return pickSugg(+el.dataset.s);
      if ((el = t.closest('[data-pg]'))) { S.adm.f.page = +el.dataset.pg; drawATable(); var tb = $('#aTable'); if (tb) tb.scrollIntoView({ block: 'nearest' }); return; }
      if ((el = t.closest('[data-lpg]'))) { S.adm.lf.page = +el.dataset.lpg; adminLog(); return; }
      if (t.closest('#sReset')) { S.search.cat = 'all'; S.search.sort = 'rel'; drawSearch(); return; }
      if (t.closest('[data-relogin]')) { renderLogin(); return; }
      if (t.closest('#btnLogout')) return logout();
      if (t.closest('#btnMenu')) { document.body.classList.toggle('menu-open'); return; }
      if (t.closest('#scrim') || t.closest('.side-nav a')) document.body.classList.remove('menu-open');
      if (!t.closest('#search')) closeSugg();
    });
    document.addEventListener('change', function (e) {
      if (e.target.id === 'sCat') { S.search.cat = e.target.value; drawSearch(); }
      else if (e.target.id === 'sSort') { S.search.sort = e.target.value; drawSearch(); }
    });
  }

  function init() {
    hydrate(); bind();
    var c = Store.get('boot');
    if (c && c.data && c.data.imgs) { try { applyBoot(c.data); S.ready = true; S.t = c.t || 0; } catch (e) { S.ready = false; } }
    if (!navigator.onLine) $('#offline').hidden = false;
    route();
    if (!S.ready || Date.now() - S.t > CFG.FRESH_TTL_MS) refreshBoot();
    var pc = $('.pub-doc-t'); if (pc && API.demo) { /* mode demo ditandai di footer */ var f = $('.pubfoot-in span:last-child'); if (f) f.textContent = 'Akses publik tanpa login · MODE DEMO'; }
  }
  window.__atlas = { S: S, route: route, toast: toast, showDenied: showDenied, refresh: refreshBoot };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
