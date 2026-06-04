/*!
 * RevenuePulse — pulse.js (DEMO sürümü)
 * ----------------------------------------------------------------------------
 * Bu, tracker/pulse.js'in demo'ya uyarlanmış halidir. Tek fark: olayları
 * aynı sunucudaki /collect adresine gönderir (n8n webhook'u yerine).
 * KVKK mantığı aynı: PII düz gönderilmez, anonim visitor_id kullanılır.
 * ----------------------------------------------------------------------------
 */
(function () {
  "use strict";

  var ENDPOINT = "/collect"; // aynı sunucu (demo)

  var currentScript =
    document.currentScript ||
    (function () { var s = document.getElementsByTagName("script"); return s[s.length - 1]; })();
  var SITE_KEY = currentScript ? currentScript.getAttribute("data-key") : "demo";

  function getVisitorId() {
    try {
      var k = "_rp_vid";
      var v = localStorage.getItem(k);
      if (!v) {
        v = "v_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
        localStorage.setItem(k, v);
      }
      return v;
    } catch (e) {
      return "v_tmp_" + Math.random().toString(36).slice(2, 10);
    }
  }
  var VISITOR_ID = getVisitorId();

  // Demo kolaylığı: kimliği sıfırlayıp "yeni ziyaretçi" gibi başlamak için
  window.RP_reset = function () {
    try { localStorage.removeItem("_rp_vid"); } catch (e) {}
    location.reload();
  };

  function send(eventType, properties, url) {
    var payload = {
      site_key: SITE_KEY,
      visitor_id: VISITOR_ID,
      event_type: eventType,
      page_url: url || window.location.href,
      properties: properties || {},
      occurred_at: new Date().toISOString(),
    };
    var body = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon) navigator.sendBeacon(ENDPOINT, body);
      else fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true });
    } catch (e) {}
  }

  // pulse.js'i SPA "sanal sayfa" geçişleri için dışarı aç (demo sitesi kullanır)
  window.RP = {
    pageView: function (virtualUrl, title) {
      _pageStart = Date.now();
      _scrollSeen = {};
      _currentUrl = virtualUrl;
      send("page_view", { title: title || document.title }, virtualUrl);
    },
    track: send,
  };

  var _currentUrl = window.location.href;
  var _pageStart = Date.now();
  var _scrollSeen = {};

  // İlk sayfa görüntüleme
  send("page_view", { title: document.title }, _currentUrl);

  // Scroll derinliği
  window.addEventListener("scroll", function () {
    var h = document.documentElement;
    var pct = Math.round(((h.scrollTop + window.innerHeight) / h.scrollHeight) * 100);
    [25, 50, 75, 100].forEach(function (t) {
      if (pct >= t && !_scrollSeen[t]) { _scrollSeen[t] = true; send("scroll", { depth: t }, _currentUrl); }
    });
  }, { passive: true });

  // Önemli tıklamalar
  document.addEventListener("click", function (e) {
    var el = e.target.closest("a,button");
    if (!el) return;
    var txt = (el.innerText || "").trim().slice(0, 80);
    send("click", { text: txt, href: el.getAttribute("href") || null }, _currentUrl);
  });

  // Form etkileşimi (değerler değil, yalnızca sinyal)
  document.addEventListener("focusin", function (e) {
    if (e.target.matches("input,textarea,select")) send("form_focus", { field: e.target.name || e.target.type }, _currentUrl);
  }, true);
  document.addEventListener("submit", function (e) {
    send("form_submit", { form_id: e.target.id || null }, _currentUrl);
  });

  // Sanal/gerçek sayfa değişiminde geçirilen süre
  function flushTime() {
    var secs = Math.round((Date.now() - _pageStart) / 1000);
    if (secs > 0) send("time_on_page", { seconds: secs }, _currentUrl);
  }
  window.addEventListener("pagehide", flushTime);
  window._RP_flushTime = flushTime; // SPA geçişlerinde demo sitesi çağırır
})();
