/* ============================================================
   compress.js — Kompresi gambar otomatis di browser (PRD F5)
   - sisi terpanjang maks. MAX_SIDE, tidak memperbesar gambar kecil
   - kualitas awal 85%, turun bertahap ke min. 60% sampai <= MAX_KB
   - jika masih besar, dimensi diperkecil lagi
   - deteksi transparansi (alpha) -> WebP tanpa isi latar
   - fallback bila browser tidak bisa WebP: PNG (transparan) / JPG
   - thumbnail ~400 px dengan format yang sama
   ============================================================ */
(function () {
  function loadBitmap(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file).catch(function () { return viaImg(file); });
    }
    return viaImg(file);
  }
  function viaImg(file) {
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(file), im = new Image();
      im.onload = function () { URL.revokeObjectURL(u); res(im); };
      im.onerror = function () { URL.revokeObjectURL(u); rej(new Error('Berkas bukan gambar yang valid atau rusak.')); };
      im.src = u;
    });
  }
  function dims(b) { return { w: b.width || b.naturalWidth, h: b.height || b.naturalHeight }; }

  function hasAlpha(bmp) {
    var d = dims(bmp), s = Math.min(1, 256 / Math.max(d.w, d.h));
    var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(d.w * s)); c.height = Math.max(1, Math.round(d.h * s));
    var x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0, c.width, c.height);
    var px = x.getImageData(0, 0, c.width, c.height).data;
    for (var i = 3; i < px.length; i += 4) if (px[i] < 250) return true;
    return false;
  }
  function render(bmp, w, h) {
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var x = c.getContext('2d');           // TIDAK mengisi latar: transparansi tetap terjaga
    x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, w, h);
    return c;
  }
  function toBlob(canvas, mime, q) {
    return new Promise(function (res) { canvas.toBlob(function (b) { res(b); }, mime, q); });
  }
  function ext(mime) { return mime === 'image/webp' ? 'webp' : (mime === 'image/png' ? 'png' : 'jpg'); }

  /** Pilih format: coba WebP; bila browser memberi tipe lain, pakai fallback. */
  function pickFormat(canvas, alpha, q) {
    return toBlob(canvas, 'image/webp', q).then(function (b) {
      if (b && b.type === 'image/webp') return { blob: b, mime: 'image/webp', webp: true };
      var mime = alpha ? 'image/png' : 'image/jpeg';
      return toBlob(canvas, mime, q).then(function (b2) { return { blob: b2, mime: mime, webp: false }; });
    });
  }
  function b64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result).split(',')[1]); };
      r.onerror = function () { rej(new Error('Gagal membaca hasil kompresi.')); };
      r.readAsDataURL(blob);
    });
  }

  /**
   * @param {File} file
   * @param {{maxSide,maxKB,quality,minQuality,thumbSide}} o
   * @param {function(pct,label)} onProgress
   */
  window.compressImage = function (file, o, onProgress) {
    o = o || {};
    var maxSide = o.maxSide || 1600, maxBytes = (o.maxKB || 2048) * 1024, q0 = o.quality || 0.85, qMin = o.minQuality || 0.6, tSide = o.thumbSide || 400;
    var step = function (p, l) { if (onProgress) onProgress(p, l); };
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return Promise.reject(new Error('Format tidak didukung. Gunakan JPG, PNG, atau WebP.'));
    step(8, 'Membaca gambar...');
    return loadBitmap(file).then(function (bmp) {
      var d = dims(bmp), alpha = hasAlpha(bmp), scale = Math.min(1, maxSide / Math.max(d.w, d.h));
      var w = Math.round(d.w * scale), h = Math.round(d.h * scale), q = q0, tries = 0, last = null;
      step(20, 'Mengompres gambar...');
      function attempt() {
        tries++;
        var cv = render(bmp, w, h);
        return pickFormat(cv, alpha, q).then(function (r) {
          last = { r: r, w: w, h: h, q: q };
          step(Math.min(80, 20 + tries * 8), 'Mengompres gambar... ' + Math.min(80, 20 + tries * 8) + '%');
          if (r.blob.size <= maxBytes) return last;
          // kualitas turun bertahap (hanya bermakna untuk WebP/JPG)
          if (r.mime !== 'image/png' && q - 0.05 >= qMin - 1e-9) { q = Math.round((q - 0.05) * 100) / 100; return attempt(); }
          // masih besar: perkecil dimensi 15%, kualitas dikembalikan ke awal
          if (Math.max(w, h) > 640 && tries < 30) { w = Math.round(w * 0.85); h = Math.round(h * 0.85); q = q0; return attempt(); }
          return last;
        });
      }
      return attempt().then(function (L) {
        step(85, 'Membuat thumbnail...');
        var ts = Math.min(1, tSide / Math.max(L.w, L.h)), tw = Math.max(1, Math.round(L.w * ts)), th = Math.max(1, Math.round(L.h * ts));
        var tc = render(bmp, tw, th);
        return toBlob(tc, L.r.mime, 0.8).then(function (tb) {
          step(95, 'Menyiapkan data...');
          return Promise.all([b64(L.r.blob), b64(tb)]).then(function (arr) {
            step(100, 'Siap diunggah');
            return {
              blob: L.r.blob, thumbBlob: tb, fileB64: arr[0], thumbB64: arr[1], mime: L.r.mime, format: ext(L.r.mime),
              w: L.w, h: L.h, sizeKB: Math.round(L.r.blob.size / 1024), originalKB: Math.round(file.size / 1024),
              origW: d.w, origH: d.h, quality: L.q, alpha: alpha, webp: L.r.webp, overLimit: L.r.blob.size > maxBytes,
              previewUrl: URL.createObjectURL(L.r.blob), thumbUrl: URL.createObjectURL(tb)
            };
          });
        });
      });
    });
  };
})();
