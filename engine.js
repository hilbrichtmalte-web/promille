// Rechenkern: Blutalkohol nach Widmark mit zeitlicher Aufnahme, Essen und "Papst".
// Reine Funktionen ohne DOM, damit sie auch unter Node getestet werden können.

export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;

export const DRINKS = [
  { id: 'bier025', name: 'Bier', size: '0,25 l', ml: 250, abv: 5.0, icon: '🍺' },
  { id: 'bier05', name: 'Bier', size: '0,5 l', ml: 500, abv: 5.0, icon: '🍺' },
  { id: 'mass', name: 'Maß', size: 'Festbier 1 l', ml: 1000, abv: 6.0, icon: '🍻' },
  { id: 'wein', name: 'Wein', size: '0,2 l', ml: 200, abv: 12.0, icon: '🍷' },
  { id: 'sekt', name: 'Sekt', size: '0,1 l', ml: 100, abv: 11.0, icon: '🥂' },
  { id: 'shot', name: 'Shot', size: '2 cl', ml: 20, abv: 40.0, icon: '🥃' },
  { id: 'longdrink', name: 'Longdrink', size: '4 cl', ml: 40, abv: 40.0, icon: '🍹' },
];

export const PARAMS = {
  elimination: 0.15, // ‰ pro Stunde
  absorbFasting: 30, // Minuten bis ein Getränk vollständig aufgenommen ist
  absorbFed: 100,
  deficitFasting: 0.10, // Anteil, der nie ins Blut gelangt
  deficitFed: 0.25,
  foodWindowBefore: 3 * HOUR, // Essen wirkt auf Getränke bis 3 h danach
  foodWindowAfter: 30 * MIN, // ... und auf Getränke kurz davor
  sessionGap: 12 * HOUR,
};

export const grams = (ml, abv) => ml * (abv / 100) * 0.8;

// Verteilungsfaktor r: Watson-Formel, wenn Größe und Alter bekannt sind, sonst Widmark-Standard.
export function distributionFactor({ sex, weight, height, age }) {
  if (height && age) {
    const tbw = sex === 'f'
      ? -2.097 + 0.1069 * height + 0.2466 * weight
      : 2.447 - 0.09516 * age + 0.1074 * height + 0.3362 * weight;
    return (1.055 * tbw) / (0.8 * weight);
  }
  return sex === 'f' ? 0.55 : 0.68;
}

function isFed(t, foods) {
  return foods.some(f => t >= f.t - PARAMS.foodWindowAfter && t <= f.t + PARAMS.foodWindowBefore);
}

// Alle Einträge der aktuellen Sitzung: zurück bis zur ersten Lücke > sessionGap.
export function currentSession(entries, now) {
  const sorted = entries.filter(e => e.t <= now).sort((a, b) => b.t - a.t);
  const session = [];
  let last = now;
  for (const e of sorted) {
    if (last - e.t > PARAMS.sessionGap) break;
    session.push(e);
    last = e.t;
  }
  return session.reverse();
}

// Simuliert in Minutenschritten ab dem ersten Getränk bis zur Nüchternheit.
// Liefert die Kurve sowie Zeitpunkte für Peak, < 0,5 ‰ und 0 ‰.
export function simulate(entries, profile, now) {
  const session = currentSession(entries, now);
  const drinks = session.filter(e => e.type === 'drink');
  const foods = session.filter(e => e.type === 'food');
  const vomits = session.filter(e => e.type === 'vomit').map(e => e.t);
  if (!drinks.length || !profile.weight) return null;

  const r = distributionFactor(profile);
  const perGram = 1 / (profile.weight * r); // ‰ pro Gramm
  const start = drinks[0].t;

  const doses = drinks.map(d => {
    const fed = isFed(d.t, foods);
    return {
      t: d.t,
      g: d.g * (1 - (fed ? PARAMS.deficitFed : PARAMS.deficitFasting)),
      dur: (fed ? PARAMS.absorbFed : PARAMS.absorbFasting) * MIN,
      cut: vomits.find(v => v > d.t) ?? Infinity, // ab hier ist der Rest im Magen weg
      fed,
    };
  });

  const absorbed = (dose, t) => {
    const tt = Math.min(t, dose.cut);
    if (tt <= dose.t) return 0;
    return dose.g * Math.min(1, (tt - dose.t) / dose.dur);
  };
  const totalAbsorbed = t => doses.reduce((s, d) => s + absorbed(d, t), 0);
  const pending = t => doses.some(d => t < Math.min(d.t + d.dur, d.cut));

  const step = MIN;
  const elim = PARAMS.elimination / 60;
  const points = [];
  let bac = 0, prevAbs = 0, current = 0, peak = { t: start, bac: 0 };
  let sober = null;
  const limit = Math.max(now, start) + 72 * HOUR;

  for (let t = start; t <= limit; t += step) {
    const abs = totalAbsorbed(t);
    bac = Math.max(0, bac + (abs - prevAbs) * perGram - (t > start ? elim : 0));
    prevAbs = abs;
    points.push({ t, bac });
    if (t <= now) current = bac;
    if (bac > peak.bac) peak = { t, bac };
    if (t >= now && bac === 0 && !pending(t)) { sober = t; break; }
  }

  // "Unter 0,5 ‰" zählt erst nach dem letzten Überschreiten, auch wenn der Wert noch steigt.
  const lastAbove = [...points].reverse().find(p => p.bac >= 0.5);
  const below05 = lastAbove && lastAbove.t >= now ? lastAbove.t + step : now;

  const nowIdx = Math.min(points.length - 1, Math.max(0, Math.round((now - start) / step)));
  const next = points[Math.min(points.length - 1, nowIdx + 15)];
  const trend = next && now >= start ? next.bac - current : 0;

  return {
    start, now, current, peak, below05, sober, trend, points, r,
    fed: doses.length ? doses[doses.length - 1].fed : false,
    totalGrams: drinks.reduce((s, d) => s + d.g, 0),
  };
}

// Tagesschlüssel mit Tageswechsel um 6 Uhr, damit die Nacht zum Vorabend zählt.
export function dayKey(t) {
  const d = new Date(t - 6 * HOUR);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function gramsPerDay(entries) {
  const map = new Map();
  for (const e of entries) {
    if (e.type !== 'drink') continue;
    const k = dayKey(e.t);
    map.set(k, (map.get(k) || 0) + e.g);
  }
  return map;
}
