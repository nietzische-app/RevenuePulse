/*!
 * RevenuePulse — pulse.js (MVP tracker)
 * ----------------------------------------------------------------------------
 * Müşteri sitesine TEK SATIR ile eklenir (Google Analytics gibi):
 *
 *   <script src="https://CDN/pulse.js" data-key="SITE_KEY"></script>
 *
 * KVKK notu: Bu script kişisel veriyi (isim/e-posta) düz GÖNDERMEZ. Anonim
 * bir visitor_id üretir. Tanımlı bilgi gerekiyorsa, sunucu tarafında (n8n)
 * hash'lenerek saklanır. Rıza (consent) yönetimi siteye entegre edilmelidir.
 * ----------------------------------------------------------------------------
 */
(function () {
  "use strict";

  // === AYAR: n8n "Akış A" Webhook Production URL'i ile değiştir ===
  var ENDPOINT = "https://YOUR-N8N-HOST/webhook/pulse-collect";

  // Site anahtarını <script data-key="..."> etiketinden oku
  var currentScript =
    document.currentScript ||
    (function () {
      var s = document.getElementsByTagName("script");
      return s[s.length - 1];
    })();
  var SITE_KEY = currentScript ? currentScript.getAttribute("data-key") : null;
  if (!SITE_KEY) {
    console.warn("[RevenuePulse] data-key eksik, izleme devre dışı.");
    return;
  }

  // --- Anonim, kalıcı ziyaretçi kimliği (1. taraf çerez / localStorage) ---
  function getVisitorId() {
    try {
      var k = "_rp_vid";
      var v = localStorage.getItem(k);
      if (!v) {
        v =
          "v_" +
          Date.now().toString(36) +
          "_" +
          Math.random().toString(36).slice(2, 10);
        localStorage.setItem(k, v);
      }
      return v;
    } catch (e) {
      // localStorage kapalıysa oturumluk geçici id
      return "v_tmp_" + Math.random().toString(36).slice(2, 10);
    }
  }
  var VISITOR_ID = getVisitorId();

  // --- UTM ve referans bilgisi (oturum bağlamı) ---
  function getUTM() {
    var p = new URLSearchParams(window.location.search);
    return {
      utm_source: p.get("utm_source"),
      utm_medium: p.get("utm_medium"),
      utm_campaign: p.get("utm_campaign"),
      referrer: document.referrer || null,
    };
  }

  // --- Olayı n8n'e gönder (sendBeacon: sayfa kapanırken bile güvenli) ---
  function send(eventType, properties) {
    var payload = {
      site_key: SITE_KEY,
      visitor_id: VISITOR_ID,
      event_type: eventType,
      page_url: window.location.href,
      properties: properties || {},
      context: getUTM(),
      occurred_at: new Date().toISOString(),
    };
    var body = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, body);
      } else {
        fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body,
          keepalive: true,
        });
      }
    } catch (e) {
      /* sessizce yut — kullanıcı deneyimini bozma */
    }
  }

  // === Yakalanan davranışlar ===

  // 1) Sayfa görüntüleme
  send("page_view", { title: document.title });

  // 2) Scroll derinliği (25/50/75/100% eşikleri)
  var seen = {};
  window.addEventListener(
    "scroll",
    function () {
      var h = document.documentElement;
      var pct = Math.round(
        ((h.scrollTop + window.innerHeight) / h.scrollHeight) * 100
      );
      [25, 50, 75, 100].forEach(function (t) {
        if (pct >= t && !seen[t]) {
          seen[t] = true;
          send("scroll", { depth: t });
        }
      });
    },
    { passive: true }
  );

  // 3) Önemli tıklamalar (CTA / fiyat / demo butonları)
  document.addEventListener("click", function (e) {
    var el = e.target.closest("a,button");
    if (!el) return;
    var txt = (el.innerText || "").trim().slice(0, 80);
    send("click", { text: txt, href: el.getAttribute("href") || null });
  });

  // 4) Form etkileşimi (doldurma sinyali — niyet göstergesi)
  document.addEventListener(
    "focusin",
    function (e) {
      if (e.target.matches("input,textarea,select")) {
        send("form_focus", { field: e.target.name || e.target.type });
      }
    },
    true
  );

  document.addEventListener("submit", function (e) {
    // NOT: Form alan DEĞERLERİNİ göndermiyoruz (KVKK). Sadece "form gönderildi".
    send("form_submit", { form_id: e.target.id || null });
  });

  // 5) Sayfada geçirilen süre (sayfa kapanırken)
  var start = Date.now();
  window.addEventListener("pagehide", function () {
    send("time_on_page", { seconds: Math.round((Date.now() - start) / 1000) });
  });
})();
