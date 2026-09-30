// Ausführen mit: node engine.test.mjs
import assert from 'node:assert/strict';
import { simulate, grams, distributionFactor, dayKey, HOUR, MIN } from './engine.js';

const profile = { sex: 'm', weight: 80 };
const T0 = new Date(2026, 8, 30, 20, 0).getTime();
const drink = (t, ml, abv) => ({ type: 'drink', t, g: grams(ml, abv) });

assert.equal(grams(500, 5), 20);
assert.equal(grams(1000, 6), 48);
assert.equal(distributionFactor(profile), 0.68);

// Ein Bier 0,5 nüchtern: Peak ≈ 20·0,9/(80·0,68) − Abbau ≈ 0,33 − 0,07
{
  const s = simulate([drink(T0, 500, 5)], profile, T0 + 2 * HOUR);
  assert.ok(s.peak.bac > 0.22 && s.peak.bac < 0.33, `Peak ${s.peak.bac}`);
  assert.ok(Math.abs(s.peak.t - (T0 + 30 * MIN)) <= MIN);
  const hours = (s.sober - T0) / HOUR;
  assert.ok(hours > 1.8 && hours < 2.6, `nüchtern nach ${hours} h`);
}

// Mit Essen: niedrigerer, späterer Peak
{
  const fasting = simulate([drink(T0, 1000, 6)], profile, T0);
  const fed = simulate([{ type: 'food', t: T0 - HOUR }, drink(T0, 1000, 6)], profile, T0);
  assert.ok(fed.peak.bac < fasting.peak.bac * 0.8, `${fed.peak.bac} vs ${fasting.peak.bac}`);
  assert.ok(fed.peak.t > fasting.peak.t);
}

// Papst 10 min nach einer Maß: Rest im Magen ist weg
{
  const normal = simulate([drink(T0, 1000, 6)], profile, T0 + 11 * MIN);
  const papst = simulate([drink(T0, 1000, 6), { type: 'vomit', t: T0 + 10 * MIN }], profile, T0 + 11 * MIN);
  assert.ok(papst.peak.bac < normal.peak.bac / 2);
  assert.ok(papst.sober < normal.sober);
}

// Mehrere Getränke: aktueller Wert, unter 0,5 und nüchtern in richtiger Reihenfolge
{
  const e = [drink(T0, 500, 5), drink(T0 + HOUR, 500, 5), drink(T0 + 2 * HOUR, 500, 5), drink(T0 + 2.5 * HOUR, 20, 40)];
  const now = T0 + 3 * HOUR;
  const s = simulate(e, profile, now);
  assert.ok(s.current > 0.5, `aktuell ${s.current}`);
  assert.ok(s.below05 > now && s.below05 < s.sober);
}

// Alte Einträge (> 12 h Pause) gehören nicht zur Sitzung
assert.equal(simulate([drink(T0 - 20 * HOUR, 500, 5)], profile, T0), null);

// Tageswechsel um 6 Uhr
assert.equal(dayKey(new Date(2026, 9, 1, 2, 0).getTime()), '2026-09-30');

console.log('Alle Tests bestanden');
