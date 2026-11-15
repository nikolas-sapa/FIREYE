import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import data from '../src/console/data/greece-wildfire-fatalities.json';
import { WildfireFatalityChart } from '../src/console/ui/WildfireFatalityChart';

const bytes = readFileSync('src/console/data/greece-wildfire-fatalities.json');
assert.equal(createHash('sha256').update(bytes).digest('hex'), '44c6466f79bce7b917456e50f3e4af44b57a1381cffb7e84e0b378bfc9cbc2a1', 'GH01 frozen bytes, including all row fields, source URL and caveats');
assert.equal(data.values.length, 45);
assert.deepEqual(data.values.map(row => row.year), Array.from({ length: 45 }, (_, i) => 1980 + i));
assert.ok(data.values.every(row => Number.isInteger(row.fatalities) && row.fatalities >= 0));
assert.equal(data.total_recorded, 245);
assert.equal(data.values.find(row => row.year === 2018)?.fatalities, 102);
assert.equal(data.values.find(row => row.year === 2024)?.fatalities, 1);
assert.equal(data.source_page, 'https://climate-adapt.eea.europa.eu/en/observatory/topics/health-impacts/wildfires');
assert.equal(data.limitations.length, 4);
console.log('GH01 PASS: 45 frozen annual rows, exact source bytes and metadata');

const markup = renderToStaticMarkup(createElement(WildfireFatalityChart));
const bars = [...markup.matchAll(/<rect\b[^>]*data-year="\d+"[^>]*>/g)].map(match => match[0]);
assert.equal(bars.length, 45, 'GH02 annual bars');
assert.match(markup, /role="img"/);
assert.match(markup, /viewBox="0 0 736 190"/);
for (const text of ['Greece: recorded wildfire fatalities', '1980–2024', 'Recorded in this source', '245', 'EEA', 'CATDAT', 'Historical records, not projected deaths. Source-vintage counts may differ from later revisions; zeros mean none recorded in this series.']) assert.ok(markup.includes(text), text);
assert.ok(markup.includes(`href="${data.source_page}"`));
assert.match(markup, /target="_blank" rel="noopener noreferrer"/);
assert.doesNotMatch(markup, /lives[\s-]*saved/i);
assert.doesNotMatch(markup, /NaN|Infinity/);
for (const [i, bar] of bars.entries()) {
  const row = data.values[i];
  const attr = (name: string) => Number(bar.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1]);
  assert.equal(attr('data-year'), row.year);
  assert.ok(Math.abs(attr('x') - (72 + i * (636 / 45) + 2)) < 1e-9);
  assert.ok(Math.abs(attr('width') - (636 / 45 - 4)) < 1e-9);
  assert.match(bar, /class="fill-bone-dim"/);
  assert.doesNotMatch(bar, /fill="#/);
  assert.ok(Math.abs(attr('y') - (148 - row.fatalities / 110 * 132)) < 1e-9);
  assert.ok(Math.abs(attr('height') - row.fatalities / 110 * 132) < 1e-9);
  assert.ok(Math.abs(attr('y') + attr('height') - 148) < 1e-9, 'zero baseline');
  assert.ok(markup.includes(`<title>${row.year}: ${row.fatalities} recorded fatalities</title>`));
}
for (const tick of [0, 50, 100, 1980, 1990, 2000, 2010, 2024]) assert.ok(markup.includes(`>${tick}</text>`));
const labels = [...markup.matchAll(/<text\b([^>]*)>(\d+)<\/text>/g)];
assert.equal(labels.length, 8);
for (const [, attributes, value] of labels) {
  const attr = (name: string) => Number(attributes.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1]);
  assert.equal(attr('font-size'), 12, 'GH02 SSR width736 uses font12');
  const tick = Number(value);
  assert.ok(Math.abs(attr('x') - (tick < 1980 ? 62 : 72 + data.values.findIndex(row => row.year === tick) * (636 / 45) + (636 / 45) / 2)) < 1e-9);
}
const twice = renderToStaticMarkup(createElement('div', null, createElement(WildfireFatalityChart), createElement(WildfireFatalityChart)));
const ids = [...twice.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(ids.length, 4);
assert.equal(new Set(ids).size, 4, 'GH02 unique useId title and description IDs');
for (const match of twice.matchAll(/aria-labelledby="([^"]+)"/g)) {
  const references = match[1].split(' ');
  assert.equal(references.length, 2);
  for (const id of references) assert.ok(ids.includes(id));
}
console.log('GH02 PASS: actual SVG render, 45 exact bars, zero baseline, attribution and unique accessible IDs');
