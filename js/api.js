/* ============================================================
   api.js — Lapisan data: Store (cache lokal), jaringan tahan HP,
   Auth stateless, telemetri Perf, dan MODE DEMO (tanpa server)
   ============================================================ */
(function () {
  var CFG = window.ATLAS_CONFIG, PFX = 'atlas:' + CFG.CACHE_VERSION + ':';

  /* ---------- Store: localStorage ber-namespace + versi skema ---------- */
  var Store = {
    get: function (k) { try { var v = localStorage.getItem(PFX + k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(PFX + k, JSON.stringify(v)); } catch (e) { /* kuota penuh: abaikan */ } },
    del: function (k) { try { localStorage.removeItem(PFX + k); } catch (e) {} }
  };

  /* ---------- Perf: telemetri total / server / jaringan ---------- */
  var Perf = {
    log: [],
    mark: function (action, total, server) {
      var net = Math.max(0, total - (server || 0));
      this.log.push({ action: action, total: Math.round(total), server: server || 0, net: Math.round(net) });
      if (this.log.length > 60) this.log.shift();
      if (total > 3000) console.warn('[Perf] lambat:', action, Math.round(total) + 'ms (server ' + (server || 0) + 'ms, jaringan ' + Math.round(net) + 'ms)');
    }
  };

  var uuid = function () { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  /* ---------- Auth: token HMAC dari server, disimpan lokal ---------- */
  var Auth = {
    get: function () { var a = Store.get('auth'); if (a && a.exp > Date.now()) return a; if (a) Store.del('auth'); return null; },
    set: function (a) { Store.set('auth', a); },
    clear: function () { Store.del('auth'); Store.del('admin:boot'); },
    token: function () { var a = this.get(); return a ? a.token : null; }
  };

  /* ---------- Jaringan: timeout + retry + idempoten ---------- */
  function http(url, opt, timeout) {
    var ac = new AbortController(), to = setTimeout(function () { ac.abort(); }, timeout);
    return fetch(url, Object.assign({ redirect: 'follow', signal: ac.signal }, opt)).then(function (res) {
      if (res.status >= 500 || res.status === 429) { var e = new Error('Server sibuk (' + res.status + ').'); e.retry = true; throw e; }
      return res.json().catch(function () { var e = new Error('Respons server tidak valid.'); e.retry = true; throw e; });
    }, function (err) {
      var e = new Error(err && err.name === 'AbortError' ? 'Waktu habis. Periksa sambungan internet.' : 'Tidak dapat terhubung ke server.');
      e.retry = true; e.net = true; throw e;
    }).then(function (r) { clearTimeout(to); return r; }, function (e) { clearTimeout(to); throw e; });
  }

  function withRetry(fn, tries) {
    var n = 0;
    function go() {
      return fn().catch(function (e) {
        n++;
        if (e.retry && n < tries) return sleep(500 * n).then(go);
        throw e;
      });
    }
    return go();
  }

  function getAct(action) {
    return withRetry(function () { return http(CFG.GAS_URL + '?action=' + encodeURIComponent(action), {}, 25000); }, 3);
  }
  function postAct(action, data, tries, timeout) {
    var body = JSON.stringify({ action: action, data: data || {}, token: Auth.token() });
    return withRetry(function () {
      return http(CFG.GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body }, timeout || 30000);
    }, tries || 1);
  }
  function beacon(action, data) {            // fire & forget, tidak memblokir UI
    try {
      fetch(CFG.GAS_URL, { method: 'POST', mode: 'no-cors', keepalive: true, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: action, data: data }) }).catch(function () {});
    } catch (e) {}
  }

  var demo = !CFG.GAS_URL;

  function call(action, kind, data, opt) {
    var t0 = performance.now();
    opt = opt || {};
    var p;
    if (demo) p = Mock.handle(action, data || {});
    else if (kind === 'get') p = getAct(action);
    else p = postAct(action, data, opt.tries, opt.timeout);
    return p.then(function (res) {
      Perf.mark(action, performance.now() - t0, res && res.ms);
      if (res && res.code === 'UNAUTHORIZED') { Auth.clear(); window.dispatchEvent(new Event('atlas:unauth')); }
      return res;
    });
  }

  var API = {
    demo: demo,
    bootstrap: function () { return call('bootstrap', 'get'); },
    login: function (pin) { return call('login', 'post', { pin: pin }, { tries: 2 }); },
    loginGoogle: function (idToken) { return call('loginGoogle', 'post', { idToken: idToken }, { tries: 2 }); },
    adminBootstrap: function () { return call('adminBootstrap', 'post', {}, { tries: 3 }); },
    adminStats: function (range) { return call('adminStats', 'post', { range: range }, { tries: 3 }); },
    addImage: function (p) { p.reqId = p.reqId || uuid(); return call('addImage', 'post', p, { tries: 3, timeout: 90000 }); },
    updateImage: function (p) { p.reqId = p.reqId || uuid(); return call('updateImage', 'post', p, { tries: 3, timeout: 90000 }); },
    deleteImage: function (p) { p.reqId = p.reqId || uuid(); return call('deleteImage', 'post', p, { tries: 3, timeout: 60000 }); },
    logView: function (id) { if (demo) Mock.handle('logView', { id: id }); else beacon('logView', { id: id }); },
    logSearch: function (q) { if (demo) Mock.handle('logSearch', { q: q }); else beacon('logSearch', { q: q }); }
  };

  /* ============================================================
     MODE DEMO — meniru bentuk respons server (untuk pratinjau)
     ============================================================ */
  var Mock = (function () {
    var KEY = 'mock', lat = function () { return sleep(90 + Math.random() * 80); };

    function art(name, motif, hue) {
      var s = '#0F6CBD', f = 'rgba(255,255,255,.65)', g = '';
      if (motif === 'bone') g = '<g stroke="' + s + '" stroke-width="5" fill="' + f + '"><rect x="300" y="150" width="60" height="300" rx="30" transform="rotate(18 330 300)"/><circle cx="260" cy="170" r="42"/><circle cx="330" cy="140" r="30"/><circle cx="470" cy="440" r="42"/><circle cx="400" cy="470" r="30"/></g>';
      else if (motif === 'organ') g = '<g stroke="' + s + '" stroke-width="5" fill="' + f + '"><path d="M400 450C250 360 200 270 270 200c50-45 110-15 130 30 20-45 80-75 130-30 70 70 20 160-130 250z"/><path d="M400 230v110M345 280c25 25 80 25 110 0" fill="none"/></g>';
      else if (motif === 'spine') { for (var i = 0; i < 5; i++) g += '<rect x="' + (330 - i * 4) + '" y="' + (110 + i * 78) + '" width="' + (140 + i * 8) + '" height="56" rx="18"/><path d="M' + (330 - i * 4) + ' ' + (140 + i * 78) + 'h-40m' + (140 + i * 8) + ' 0h40" />'; g = '<g stroke="' + s + '" stroke-width="5" fill="' + f + '">' + g + '</g>'; }
      else g = '<g stroke="' + s + '" stroke-width="5" fill="' + f + '"><path d="M330 90c40 0 50 60 40 130l-20 120c-6 40-60 40-66 0L264 220c-10-70 26-130 66-130z" transform="rotate(10 330 250)"/><path d="M470 520c-40 0-50-60-40-130l20-120c6-40 60-40 66 0l20 120c10 70-26 130-66 130z" transform="rotate(10 470 350)"/><ellipse cx="400" cy="300" rx="62" ry="40" fill="none" stroke-dasharray="10 8"/></g>';
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(' + hue + ',55%,96%)"/><stop offset="1" stop-color="hsl(' + hue + ',50%,88%)"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/>' + g + '<text x="400" y="568" text-anchor="middle" font-family="Arial" font-size="26" fill="#12263F" opacity=".7">' + name.replace(/&/g, '&amp;') + '</text></svg>';
      return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    }

    function seed() {
      var cats = ['Kepala dan Leher', 'Dada', 'Perut', 'Punggung', 'Lengan dan Tangan', 'Panggul', 'Kaki dan Telapak', 'Sistem Organ'].map(function (n, i) { return { id: 'KAT-0' + (i + 1), n: n, o: i + 1 }; });
      var L = [
        ['Sendi Lutut & Meniskus Medial', 7, 'Penampang frontal artikulasio genu, ligamen krusiatum anterior dan bantalan fibrokartilago meniskus.', 'lutut,meniskus,acl,patella,tibia', 412, 520, 'bone', 205],
        ['Penampang Ventrikel & Katup Jantung', 8, 'Arsitektur miokardium ventrikel kiri dan kanan serta katup semilunaris aorta.', 'jantung,ventrikel,katup,dada sesak', 389, 390, 'organ', 350],
        ['Tulang Selangka & Sternum', 2, 'Sendi sternoklavikularis, manubrium sterni, dan insersi kartilago kosta.', 'klavikula,sternum,tulang dada', 195, 80, 'bone', 210],
        ['Vertebra Kolumna Lumbal L1-L5', 4, 'Korpus vertebra, pedikel, kanalis spinalis, dan foramen intervertebralis.', 'pinggang,tulang belakang,lumbal,diskus', 304, 415, 'spine', 200],
        ['Gaster, Pilorus & Duodenum', 3, 'Mukosa antrum pilorikum, sfingter sirkular, dan kanalis bulbus duodeni.', 'lambung,maag,usus dua belas jari', 178, 60, 'organ', 30],
        ['Karpal, Metakarpal & Falang', 5, 'Susunan 8 ossa carpi, basis metakarpal, dan sendi interfalangeal.', 'tangan,jari,pergelangan', 162, 40, 'bone', 180],
        ['Mandibula, Sendi TMJ & Molar', 1, 'Prosesus kondilaris, diskus artikularis fossa mandibularis, dan saraf alveolaris.', 'rahang,gigi,tmj', 180, 35, 'joint', 190],
        ['Pelvis, Sacrum & Asetabulum', 6, 'Gelang panggul, sendi sakroiliaka, dan fossa asetabulum tempat artikulasi kaput femur.', 'panggul,pinggul,sendi panggul', 145, 30, 'bone', 215],
        ['Ligamen Rotator Cuff', 5, 'Tendon supraspinatus, infraspinatus, teres minor, dan subskapularis di sekitar bahu.', 'bahu,rotator cuff,supraspinatus,bahu kaku', 210, 185, 'joint', 220],
        ['Appendiks Vermiformis', 3, 'Posisi sekum dan apendiks vermiformis pada kuadran kanan bawah abdomen.', 'usus buntu,apendiks,nyeri perut kanan', 267, 210, 'organ', 165],
        ['Paru-paru & Bronkus', 8, 'Percabangan bronkus utama, lobus paru kanan-kiri, dan pleura.', 'paru,napas,bronkus,batuk', 120, 90, 'organ', 195],
        ['Vertebra Servikal C1-C7', 1, 'Atlas, aksis, dan vertebra servikal bawah dengan foramen transversarium.', 'leher,servikal,saraf kejepit', 98, 70, 'spine', 205]
      ];
      var imgs = L.map(function (r, i) {
        var id = 'IMG-' + ('00' + (i + 1)).slice(-3), a = art(r[0], r[6], r[7]);
        return { id: id, n: r[0], c: 'KAT-0' + r[1], d: r[2], k: r[3].split(','), f: a, t: a, fm: i % 4 === 2 ? 'png' : 'webp', kb: 900 + i * 83, w: 1600, h: 1200, v: r[4], dt: new Date(Date.now() - (30 - i) * 86400000).toISOString(), by: 'dokter', sb: r[5] };
      });
      var log = [
        { t: new Date(Date.now() - 3600e3).toISOString(), e: 'dokter@klinik.id', a: 'Tambah', id: 'IMG-012', k: 'Unggah WEBP 1.410 KB (asal 8240 KB)' },
        { t: new Date(Date.now() - 2 * 86400e3).toISOString(), e: 'dokter@klinik.id', a: 'Edit', id: 'IMG-003', k: 'Perubahan: deskripsi' },
        { t: new Date(Date.now() - 4 * 86400e3).toISOString(), e: 'dokter@klinik.id', a: 'Hapus', id: 'IMG-009', k: 'Berkas dipindahkan ke Sampah Drive: Buram Sinus' },
        { t: new Date(Date.now() - 6 * 86400e3).toISOString(), e: 'dokter@klinik.id', a: 'Tambah', id: 'IMG-004', k: 'Unggah WEBP 1.120 KB' },
        { t: new Date(Date.now() - 9 * 86400e3).toISOString(), e: 'dokter@klinik.id', a: 'Edit', id: 'IMG-001', k: 'Perubahan: nama, kategori dipindah' }
      ];
      return { ver: String(Date.now()), cats: cats, imgs: imgs, log: log, fails: 0, words: [['lutut', 520], ['pinggang', 415], ['jantung', 390], ['dada sesak', 280], ['usus buntu', 210], ['bahu kaku', 185]] };
    }

    var D = null;
    function load() { if (D) return D; D = Store.get(KEY); if (!D) { D = seed(); save(); } return D; }
    function save() { Store.set(KEY, D); }
    function boot() {
      var d = load();
      return { success: true, ver: d.ver, cats: d.cats, imgs: d.imgs, pend: {}, cfg: { TOP_N: 5, MAX_SIDE: 1600, THUMB_SIDE: 400, MAX_KB: 2048, QUALITY: 0.85, MIN_QUALITY: 0.6, NAMA_DOKTER: 'dr. Ananto, Sp.Rad' }, ms: 0 };
    }
    function stats(range) {
      var d = load(), f = range === 'all' ? 1.6 : (range === '7' ? 0.22 : 1), tv = 0;
      var tops = d.imgs.slice().sort(function (a, b) { return b.v - a.v; }).slice(0, 10).map(function (i) { var n = Math.round(i.v * f); tv += n; return { id: i.id, nama: i.n, n: n }; });
      var words = d.words.map(function (w, i) { return { k: w[0], n: Math.round(w[1] * f), last: new Date(Date.now() - (i * 5 + 1) * 3600e3).toISOString() }; });
      var tc = {}; d.imgs.forEach(function (i) { tc[i.c] = (tc[i.c] || 0) + 1; });
      var best = Object.keys(tc).sort(function (a, b) { return tc[b] - tc[a]; })[0];
      var cn = d.cats.filter(function (c) { return c.id === best; })[0];
      return { range: range, totalImages: d.imgs.length, totalViews: Math.round(14280 * f), totalSearches: Math.round(3890 * f), trend: range === 'all' ? null : (range === '7' ? 8.1 : 12.4), topCat: { id: best, nama: cn ? cn.n : '', n: tc[best] }, topViews: tops, topWords: words.slice(0, 10) };
    }
    function adminBoot() { var d = load(); return { stats: stats('30'), log: d.log.slice(0, 300), drive: { used: 2.1 * 1073741824, limit: 15 * 1073741824 }, cfg: {} }; }
    function addLog(a, id, k) { var d = load(); d.log.unshift({ t: new Date().toISOString(), e: 'dokter@klinik.id', a: a, id: id, k: k }); }
    function bump() { D.ver = String(Date.now()); save(); }
    function dataUrl(b64, ext) { return 'data:image/' + (ext === 'jpg' ? 'jpeg' : ext) + ';base64,' + b64; }
    function nextId(d) { var m = 0; d.imgs.forEach(function (i) { m = Math.max(m, Number(i.id.replace(/\D/g, ''))); }); return 'IMG-' + ('00' + (m + 1)).slice(-3); }
    function dupe(d, nama, except) { var n = nama.trim().toLowerCase(); return d.imgs.some(function (i) { return i.id !== except && i.n.trim().toLowerCase() === n; }); }
    function issue() { var exp = Date.now() + 12 * 3600e3; var a = { token: 'demo-token', exp: exp, dokter: { email: 'dokter@klinik.id', nama: 'dr. Ananto, Sp.Rad' } }; return a; }

    function needAuth() { var a = Auth.get(); return !!a; }

    return {
      handle: function (action, p) {
        var d = load();
        if (action === 'logView') { d.imgs.forEach(function (i) { if (i.id === p.id) i.v++; }); save(); return Promise.resolve({ success: true }); }
        if (action === 'logSearch') { var q = String(p.q || '').toLowerCase().trim(), hit = false; d.words.forEach(function (w) { if (w[0] === q) { w[1]++; hit = true; } }); if (!hit && q) d.words.push([q, 1]); save(); return Promise.resolve({ success: true }); }
        return lat().then(function () {
          if (action === 'bootstrap') return boot();
          if (action === 'login') {
            if (d.fails >= 5) return { success: false, code: 'LOCKED', message: 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.' };
            if (p.pin !== '123456') { d.fails++; save(); return { success: false, code: 'BAD_PIN', message: 'PIN salah.', left: 5 - d.fails }; }
            d.fails = 0; save();
            return Object.assign({ success: true }, issue(), { boot: adminBoot() });
          }
          if (action === 'loginGoogle') return { success: false, code: 'DENIED', message: 'Akun ini tidak terdaftar sebagai dokter.', email: 'tamu@gmail.com' };
          if (!needAuth()) return { success: false, code: 'UNAUTHORIZED', message: 'Sesi dokter berakhir. Silakan masuk kembali.' };
          if (action === 'adminBootstrap') return Object.assign({ success: true }, adminBoot());
          if (action === 'adminStats') return { success: true, stats: stats(p.range) };
          if (action === 'addImage') {
            if (dupe(d, p.nama) && !p.force) return { success: false, code: 'DUPLICATE', message: 'Nama bagian tubuh sudah ada.' };
            var id = nextId(d), u = dataUrl(p.fileB64, p.format), t = p.thumbB64 ? dataUrl(p.thumbB64, p.format) : u;
            var im = { id: id, n: p.nama, c: p.kategoriId, d: p.deskripsi || '', k: p.kataKunci || [], f: u, t: t, fm: p.format, kb: p.sizeKB || 0, w: p.lebar, h: p.tinggi, v: 0, dt: new Date().toISOString(), by: 'dokter', sb: 0 };
            d.imgs.unshift(im); addLog('Tambah', id, 'Unggah ' + String(p.format).toUpperCase() + ' ' + (p.sizeKB || 0) + ' KB'); bump();
            return { success: true, img: im, message: 'Gambar berhasil disimpan.' };
          }
          if (action === 'updateImage') {
            var cur = d.imgs.filter(function (i) { return i.id === p.id; })[0];
            if (!cur) return { success: false, code: 'NOT_FOUND', message: 'Gambar tidak ditemukan.' };
            if (dupe(d, p.nama, p.id) && !p.force) return { success: false, code: 'DUPLICATE', message: 'Nama bagian tubuh sudah ada.' };
            cur.n = p.nama; cur.c = p.kategoriId; cur.d = p.deskripsi || ''; cur.k = p.kataKunci || [];
            if (p.fileB64) { cur.f = dataUrl(p.fileB64, p.format); cur.t = p.thumbB64 ? dataUrl(p.thumbB64, p.format) : cur.f; cur.fm = p.format; cur.kb = p.sizeKB || cur.kb; cur.w = p.lebar; cur.h = p.tinggi; }
            addLog('Edit', cur.id, p.fileB64 ? 'Perubahan: gambar diganti' : 'Pembaruan metadata'); bump();
            return { success: true, img: cur, message: 'Perubahan disimpan.' };
          }
          if (action === 'deleteImage') {
            var del = d.imgs.filter(function (i) { return i.id === p.id; })[0];
            d.imgs = d.imgs.filter(function (i) { return i.id !== p.id; });
            if (del) addLog('Hapus', del.id, 'Berkas dipindahkan ke Sampah Drive: ' + del.n); bump();
            return { success: true, id: p.id, message: 'Gambar dipindahkan ke tempat sampah.' };
          }
          return { success: false, code: 'BAD_ACTION', message: 'Action tidak dikenal' };
        });
      },
      reset: function () { D = seed(); save(); }
    };
  })();

  window.Store = Store; window.Perf = Perf; window.Auth = Auth; window.API = API; window.uuid = uuid; window.__mock = Mock;
})();
