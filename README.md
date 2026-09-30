# Promille

Handy-Web-App (PWA): Getränk antippen, geschätzte Promille live sehen, Prognose bis nüchtern, Verlauf mit Heatmap.
Alle Daten bleiben lokal im Browser. Werte sind grobe Schätzungen (Widmark), nicht zur Fahrtauglichkeit.

- `engine.js` – Rechenkern (Widmark, Aufnahme über Zeit, Essen, Papst), Tests: `node engine.test.mjs`
- `app.js`, `index.html`, `style.css` – Oberfläche
- `sw.js`, `manifest.webmanifest` – Offline & Installation; bei Änderungen `VERSION` in `sw.js` erhöhen
- `tools/make-icons.mjs` – erzeugt die Icons

Lokal starten: `python -m http.server 8321`, dann http://localhost:8321
