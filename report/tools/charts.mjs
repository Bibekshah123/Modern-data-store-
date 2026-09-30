import { writeFileSync } from 'node:fs';
const INK = '#1f1f1e', INK2 = '#5d5c55', GRID = '#e4e3dc', BG = '#fcfcfb', C1 = '#2a78d6', C2 = '#eb6834';
const font = `font-family="Arial, Helvetica, sans-serif"`;
const page = (w, h, body) => `<!doctype html><meta charset="utf-8"><body style="margin:0;background:${BG}"><svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" ${font}><rect width="${w}" height="${h}" fill="${BG}"/>${body}</svg>`;
// rounded end on the right only (data end), square at the baseline
const hbar = (x, y, w, h, fill, round) => round && w > 8
  ? `<path d="M${x} ${y} H${x + w - 4} Q${x + w} ${y} ${x + w} ${y + 4} V${y + h - 4} Q${x + w} ${y + h} ${x + w - 4} ${y + h} H${x} Z" fill="${fill}"/>`
  : `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;

// Chart 1: storage per variant, stacked data + index (MB)
{
  const rows = [
    ['Plain collection', 9468, 17384], ["Time-series 'seconds'", 5576, 14052],
    ["Time-series 'minutes' (chosen)", 1860, 1852], ["Time-series 'hours'", 1724, 244],
  ].map(([l, d, i]) => [l, d / 1024, i / 1024]);
  const W = 1000, H = 330, L = 250, R = 90, T = 70, bh = 34, gap = 26, max = 28;
  const sx = (v) => (v / max) * (W - L - R);
  let b = `<text x="20" y="30" font-size="19" font-weight="bold" fill="${INK}">Storage for the same 289,602 events (MB)</text>
  <rect x="${L}" y="44" width="12" height="12" rx="2" fill="${C1}"/><text x="${L + 18}" y="55" font-size="13" fill="${INK2}">Data (compressed)</text>
  <rect x="${L + 160}" y="44" width="12" height="12" rx="2" fill="${C2}"/><text x="${L + 178}" y="55" font-size="13" fill="${INK2}">Indexes</text>`;
  for (let v = 0; v <= max; v += 5) {
    const x = L + sx(v);
    b += `<line x1="${x}" y1="${T - 4}" x2="${x}" y2="${T + rows.length * (bh + gap) - gap + 4}" stroke="${GRID}"/><text x="${x}" y="${T + rows.length * (bh + gap) + 14}" font-size="12" fill="${INK2}" text-anchor="middle">${v}</text>`;
  }
  rows.forEach(([label, d, i], k) => {
    const y = T + k * (bh + gap);
    b += `<text x="${L - 12}" y="${y + bh / 2 + 5}" font-size="14" fill="${INK}" text-anchor="end" ${label.includes('chosen') ? 'font-weight="bold"' : ''}>${label}</text>`;
    b += hbar(L, y, sx(d), bh, C1, false);
    b += hbar(L + sx(d) + 2, y, Math.max(sx(i) - 2, 1), bh, C2, true);
    b += `<text x="${L + sx(d + i) + 8}" y="${y + bh / 2 + 5}" font-size="14" font-weight="bold" fill="${INK}">${(d + i).toFixed(1)}</text>`;
  });
  writeFileSync(process.argv[2] + '/chart-storage.html', page(W, H, b));
}

// Chart 2: motion detections by hour, home H005 (7 days)
{
  const data = { 6: 12, 7: 23, 8: 19, 9: 14, 10: 15, 11: 12, 12: 1, 13: 1, 14: 2, 15: 1, 17: 3, 18: 33, 19: 36, 20: 52, 21: 51, 22: 54, 23: 20 };
  const W = 1000, H = 380, L = 60, R = 20, T = 60, B = 50, max = 60;
  const ph = H - T - B, bw = (W - L - R) / 24;
  const sy = (v) => (v / max) * ph;
  let b = `<text x="20" y="30" font-size="19" font-weight="bold" fill="${INK}">Home H005: motion detections by hour of day (UK time), 7 days</text>`;
  for (let v = 0; v <= max; v += 20) {
    const y = T + ph - sy(v);
    b += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="${v ? GRID : '#b9b8b0'}"/><text x="${L - 8}" y="${y + 4}" font-size="12" fill="${INK2}" text-anchor="end">${v}</text>`;
  }
  for (let h = 0; h < 24; h++) {
    const v = data[h] || 0, x = L + h * bw + 2, w = bw - 4, y = T + ph - sy(v);
    if (v) b += `<path d="M${x} ${T + ph} V${y + 4} Q${x} ${y} ${x + 4} ${y} H${x + w - 4} Q${x + w} ${y} ${x + w} ${y + 4} V${T + ph} Z" fill="${C1}"/>`;
    b += `<text x="${x + w / 2}" y="${T + ph + 18}" font-size="12" fill="${INK2}" text-anchor="middle">${String(h).padStart(2, '0')}</text>`;
  }
  const note = (h, text) => `<text x="${L + h * bw + bw / 2}" y="${T + ph - sy(data[h]) - 8}" font-size="12" fill="${INK}" text-anchor="middle">${text}</text>`;
  b += note(7, 'wake-up 23') + note(22, 'evening 54');
  b += `<text x="${L + (W - L - R) / 2}" y="${H - 8}" font-size="13" fill="${INK2}" text-anchor="middle">Hour of day</text>`;
  b += `<text x="${L + 14.5 * bw}" y="${T + ph - 30}" font-size="12" fill="${INK2}" text-anchor="middle">out at work</text>`;
  writeFileSync(process.argv[2] + '/chart-activity.html', page(W, H, b));
}
