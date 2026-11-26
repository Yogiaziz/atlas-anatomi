/* ============================================================
   KONFIGURASI FRONTEND — satu-satunya file yang perlu Anda isi
   ============================================================ */
window.ATLAS_CONFIG = {
  // Tempel URL Web App Google Apps Script (berakhiran /exec).
  // Dikosongkan = MODE DEMO (data contoh di browser, tanpa server).
  GAS_URL: 'https://script.google.com/macros/s/AKfycbzwj_59Cf7HKXT_UduUHpKYtu-u7ufLxZ6NJaBtnhg6c5KUNIuQkgL8Cfaqp4BShgc19Q/exec',

  // Opsional: Client ID Google untuk tombol "Lanjutkan dengan Akun Google".
  // Kosongkan bila hanya memakai PIN.
  GOOGLE_CLIENT_ID: '',

  APP_NAME: 'Atlas Anatomi Tubuh',
  CACHE_VERSION: 'v1',        // naikkan bila struktur data berubah
  FRESH_TTL_MS: 60 * 1000     // data dianggap segar selama 60 detik (SWR)
};
