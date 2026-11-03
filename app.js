/* ============ Utilidades ============ */
const $ = s => document.querySelector(s);
const nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
const money = v => '$ ' + nf.format(v);
const pct = v => nf1.format(v) + ' %';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0]; // lunes a domingo
const LABEL = { rev: 'Ventas ($)', units: 'Unidades', tix: 'Tickets', margin: 'Margen ($)' };

// "1.234,56" -> 1234.56 | "1825,2" -> 1825.2
function num(v) {
  v = String(v ?? '').trim();
  if (!v) return 0;
  if (v.includes(',')) v = v.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}
const isoToDate = iso => new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const dateToIso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const shortDate = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7);

let ROWS = [];          // todas las filas ya normalizadas
let D = null;           // resultado de agregar el rango elegido
const S = { hMode: 'rev', tMode: 'units', sortK: 'units', sortD: -1, showAll: false };
const charts = {};

/* ============ Carga del archivo ============ */
function load(file) {
  $('#err').textContent = 'Procesando…';
  Papa.parse(file, {
    header: true, skipEmptyLines: true, delimiter: ';',
    complete: res => {
      try {
        ROWS = normalize(res.data);
        $('#fname').textContent = `${file.name} · ${nf.format(res.data.length)} filas`;
        const dates = ROWS.map(r => r.d).sort();
        $('#from').value = $('#from').min = $('#to').min = dates[0];
        $('#to').value = $('#from').max = $('#to').max = dates[dates.length - 1];
        $('#err').textContent = '';
        $('#drop').classList.add('hide');
        $('#app').classList.remove('hide');
        render();
      } catch (e) { $('#err').textContent = 'No pude interpretar el archivo: ' + e.message; }
    }
  });
}

function normalize(rows) {
  const need = ['Fecha_emision', 'Factura', 'Producto', 'Egreso', 'Prec_venta'];
  if (!rows.length || need.some(k => !(k in rows[0]))) throw new Error('faltan columnas (' + need.join(', ') + ')');
  const out = [];
  for (const r of rows) {
    const q = num(r.Egreso) - num(r.Ingreso);          // unidades netas vendidas
    const m = String(r.Fecha_emision).match(/(\d{2})-(\d{2})-(\d{4})\s+(\d{1,2})/);
    if (!q || !m) continue;
    const gross = q * num(r.Prec_venta), dto = num(r.Dto);
    const name = String(r.Producto).trim().replace(/\s+/g, ' ') || '(sin nombre)';
    out.push({
      d: `${m[3]}-${m[2]}-${m[1]}`, h: +m[4], f: r.Factura, n: name, k: r['Cod. Prod.'] || name,
      q, gross, net: gross * (1 - dto / 100), cost: q * num(r.Costo_unit)
    });
  }
  if (!out.length) throw new Error('no encontré ventas válidas');
  return out;
}

/* ============ Agregación (según el rango de fechas) ============ */
function weekInfo(iso, mode) {
  const dt = isoToDate(iso);
  if (mode === 'cal') {                                  // semana lunes-domingo
    const s = new Date(dt); s.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
    const k = dateToIso(s);
    return { key: k, label: 'Sem ' + shortDate(k) };
  }
  const w = Math.ceil(dt.getDate() / 7);                 // bloques de 7 días
  const last = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
  return { key: iso.slice(0, 7) + w, label: `Sem ${w} (${(w - 1) * 7 + 1}–${Math.min(w * 7, last)}/${iso.slice(5, 7)})` };
}

function aggregate(from, to, wmode) {
  const prods = new Map(), tix = new Map(), days = new Map(), weeks = new Map();
  const hours = Array.from({ length: 24 }, () => ({ rev: 0, units: 0, t: new Set() }));
  const T = { rev: 0, cost: 0, units: 0, lines: 0, disc: 0 };
  for (const r of ROWS) {
    if (r.d < from || r.d > to) continue;
    let p = prods.get(r.k); if (!p) prods.set(r.k, p = { name: r.n, units: 0, rev: 0, cost: 0, t: new Set(), dd: new Set() });
    p.units += r.q; p.rev += r.net; p.cost += r.cost; p.t.add(r.f); p.dd.add(r.d);
    tix.set(r.f, (tix.get(r.f) || 0) + r.net);
    const H = hours[r.h]; H.rev += r.net; H.units += r.q; H.t.add(r.f);
    let dy = days.get(r.d); if (!dy) days.set(r.d, dy = { rev: 0, t: new Set() });
    dy.rev += r.net; dy.t.add(r.f);
    T.rev += r.net; T.cost += r.cost; T.units += r.q; T.lines++; T.disc += r.gross - r.net;
  }
  const dayList = [...days].map(([d, v]) => ({ d, rev: v.rev, tix: v.t.size })).sort((a, b) => a.d.localeCompare(b.d));
  for (const dy of dayList) {                           // semanas
    const w = weekInfo(dy.d, wmode);
    const o = weeks.get(w.key) || { label: w.label, days: 0, rev: 0, tix: 0 };
    o.days++; o.rev += dy.rev; o.tix += dy.tix; weeks.set(w.key, o);
  }
  const dow = DOW.map(() => ({ rev: 0, n: 0 }));        // promedio por día de la semana
  for (const dy of dayList) { const g = dow[isoToDate(dy.d).getDay()]; g.rev += dy.rev; g.n++; }
  return {
    ...T, dayList, dow,
    weekList: [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(e => e[1]),
    hours: hours.map(h => ({ rev: h.rev, units: h.units, tix: h.t.size })),
    tickets: [...tix.values()],
    list: [...prods.values()].map(p => ({
      name: p.name, units: p.units, rev: p.rev, margin: p.rev - p.cost,
      mp: p.rev ? (p.rev - p.cost) / p.rev * 100 : 0, tix: p.t.size, days: p.dd.size
    }))
  };
}

/* ============ Gráficos ============ */
function theme() {
  const s = getComputedStyle(document.documentElement), g = n => s.getPropertyValue(n).trim();
  return { tx: g('--mu'), gr: g('--bd'), ac: g('--ac'), ac2: g('--ac2'), hi: g('--hi') };
}
function chart(id, cfg) {
  charts[id]?.destroy();
  Chart.defaults.color = theme().tx;
  cfg.options = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, ...cfg.options };
  charts[id] = new Chart($('#' + id), cfg);
}
const yAxis = (title, T = theme()) => ({ title: { display: !!title, text: title }, grid: { color: T.gr }, ticks: { callback: v => nf.format(v) } });
// resalta la barra con el valor más alto
const colors = (vals, base, hi) => { const mx = Math.max(...vals); return vals.map(v => v === mx ? hi : base); };

/* ============ Render principal ============ */
function render() {
  const from = $('#from').value, to = $('#to').value;
  D = aggregate(from, to, $('#wmode').value);
  const T = theme(), d = D, nt = d.tickets.length, multi = d.dayList.length > 1;
  if (!nt) { $('#kpis').innerHTML = '<p class="sub">No hay ventas en ese rango de fechas.</p>'; return; }

  const mg = d.rev - d.cost;
  const peak = d.hours.reduce((b, h, i) => h.rev > d.hours[b].rev ? i : b, 0);
  const bestDay = [...d.dayList].sort((a, b) => b.rev - a.rev)[0];
  const K = [
    ['Ventas totales', money(d.rev), multi ? `${d.dayList.length} días con ventas` : shortDate(d.dayList[0].d)],
    ['Tickets', nf.format(nt), nf.format(d.lines) + ' líneas'],
    ['Ticket promedio', money(d.rev / nt), '≈ ' + nf1.format(d.units / nt) + ' u. por ticket'],
    ['Unidades vendidas', nf.format(d.units), nf.format(d.list.length) + ' productos distintos'],
    ['Margen bruto', money(mg), pct(mg / d.rev * 100) + ' sobre ventas'],
    ['Hora pico', `${peak}:00 – ${peak + 1}:00`, money(d.hours[peak].rev) + ' · ' + d.hours[peak].tix + ' tickets']
  ];
  if (multi) K.push(
    ['Promedio diario', money(d.rev / d.dayList.length), nf.format(nt / d.dayList.length) + ' tickets por día'],
    ['Mejor día', shortDate(bestDay.d) + ' (' + DOW[isoToDate(bestDay.d).getDay()] + ')', money(bestDay.rev)]);
  $('#kpis').innerHTML = K.map(k => `<div class="card kpi"><div class="l">${k[0]}</div><div class="v">${k[1]}</div><div class="s">${k[2]}</div></div>`).join('');

  $('#month').classList.toggle('hide', !multi);
  if (multi) drawMonth(T);
  drawHours(); drawTop();

  const edges = [0, 2000, 5000, 10000, 20000, 40000, 80000, Infinity];
  const lb = ['< 2k', '2k–5k', '5k–10k', '10k–20k', '20k–40k', '40k–80k', '> 80k'], cnt = lb.map(() => 0);
  d.tickets.forEach(v => cnt[edges.findIndex((e, j) => v >= e && v < edges[j + 1])]++);
  chart('cTicket', { type: 'bar', data: { labels: lb, datasets: [{ data: cnt, backgroundColor: T.ac2, borderRadius: 4 }] },
    options: { scales: { y: yAxis('Tickets', T), x: { grid: { display: false } } } } });

  insights(multi, bestDay);
  drawTable();
}

function drawMonth(T) {
  const d = D;
  chart('cDay', { type: 'bar',
    data: { labels: d.dayList.map(x => shortDate(x.d) + ' ' + DOW[isoToDate(x.d).getDay()]),
            datasets: [{ data: d.dayList.map(x => x.rev), backgroundColor: colors(d.dayList.map(x => x.rev), T.ac, T.hi), borderRadius: 4 }] },
    options: { scales: { y: yAxis('', T), x: { grid: { display: false } } } } });
  chart('cWeek', { type: 'bar',
    data: { labels: d.weekList.map(w => w.label),
            datasets: [{ data: d.weekList.map(w => w.rev), backgroundColor: colors(d.weekList.map(w => w.rev), T.ac, T.hi), borderRadius: 4 }] },
    options: { scales: { y: yAxis('', T), x: { grid: { display: false } } } } });
  const order = DOW_ORDER.filter(i => d.dow[i].n);
  const avg = order.map(i => d.dow[i].rev / d.dow[i].n);
  chart('cDow', { type: 'bar',
    data: { labels: order.map(i => DOW[i]), datasets: [{ data: avg, backgroundColor: colors(avg, T.ac2, T.hi), borderRadius: 4 }] },
    options: { scales: { y: yAxis('$ promedio por día', T), x: { grid: { display: false } } } } });

  const best = Math.max(...d.weekList.map(w => w.rev));
  $('#wtable').innerHTML = '<thead><tr><th>Semana</th><th>Días</th><th>Ventas $</th><th>Prom./día</th><th>Tickets</th></tr></thead><tbody>' +
    d.weekList.map(w => `<tr class="${w.rev === best ? 'best' : ''}"><td>${w.label}</td><td>${w.days}</td><td>${money(w.rev)}</td><td>${money(w.rev / w.days)}</td><td>${nf.format(w.tix)}</td></tr>`).join('') + '</tbody>';
  const bw = d.weekList.find(w => w.rev === best), ba = [...d.weekList].sort((a, b) => b.rev / b.days - a.rev / a.days)[0];
  $('#wnote').textContent = `Más vendida: ${bw.label}.` + (ba !== bw ? ` Por promedio diario, la mejor fue ${ba.label} (semanas con menos días suman menos en total).` : '');
}

function insights(multi, bestDay) {
  const d = D, byRev = [...d.list].sort((a, b) => b.rev - a.rev), top = byRev.slice(0, 5).reduce((s, p) => s + p.rev, 0);
  const lowM = d.list.filter(p => p.rev > d.rev * 0.005).sort((a, b) => a.mp - b.mp)[0];
  const L = [`Los 5 productos que más facturan suman ${money(top)} (${pct(top / d.rev * 100)} de las ventas).`,
    `Producto más vendido en unidades: <b>${esc([...d.list].sort((a, b) => b.units - a.units)[0].name)}</b>.`,
    `Total vendido con descuento aplicado: ${money(d.disc)}.`];
  if (lowM) L.push(`Menor margen entre los productos relevantes: <b>${esc(lowM.name)}</b> (${pct(lowM.mp)}).`);
  if (multi) {
    const worst = [...d.dayList].sort((a, b) => a.rev - b.rev)[0];
    const dw = DOW_ORDER.filter(i => d.dow[i].n).sort((a, b) => d.dow[b].rev / d.dow[b].n - d.dow[a].rev / d.dow[a].n);
    L.push(`Mejor día: ${shortDate(bestDay.d)} (${money(bestDay.rev)}). Peor día: ${shortDate(worst.d)} (${money(worst.rev)}).`,
      `Día de la semana más fuerte en promedio: <b>${DOW[dw[0]]}</b>; el más flojo: <b>${DOW[dw[dw.length - 1]]}</b>.`);
  }
  $('#ins').innerHTML = L.map(t => '<li>' + t + '</li>').join('');
  let acc = 0, n80 = 0; for (const p of byRev) { acc += p.rev; n80++; if (acc >= d.rev * 0.8) break; }
  $('#par').innerHTML = `El 80 % de la facturación viene de <b>${nf.format(n80)}</b> productos (${pct(n80 / d.list.length * 100)} del surtido vendido).`;
}

function drawHours() {
  const act = D.hours.map((h, i) => h.tix ? i : -1).filter(i => i >= 0), idx = [];
  for (let i = Math.min(...act); i <= Math.max(...act); i++) idx.push(i);
  chart('cHour', { type: 'bar', data: { labels: idx.map(i => i + ':00'), datasets: [{ label: LABEL[S.hMode], data: idx.map(i => D.hours[i][S.hMode]), backgroundColor: theme().ac, borderRadius: 4 }] },
    options: { scales: { y: yAxis('', theme()), x: { grid: { display: false } } } } });
}
function drawTop() {
  const t = [...D.list].sort((a, b) => b[S.tMode] - a[S.tMode]).slice(0, 5);
  chart('cTop', { type: 'bar', data: { labels: t.map(p => p.name.length > 28 ? p.name.slice(0, 27) + '…' : p.name), datasets: [{ label: LABEL[S.tMode], data: t.map(p => p[S.tMode]), backgroundColor: theme().ac2, borderRadius: 4 }] },
    options: { indexAxis: 'y', scales: { x: yAxis('', theme()), y: { grid: { display: false } } } } });
}

function drawTable() {
  const q = $('#q').value.trim().toLowerCase();
  const rank = new Map([...D.list].sort((a, b) => b.units - a.units).map((p, i) => [p, i + 1]));
  const L = D.list.filter(p => p.name.toLowerCase().includes(q)), { sortK: k, sortD: dir } = S;
  L.sort((a, b) => k === 'name' ? dir * a.name.localeCompare(b.name) : k === 'rank' ? -dir * (rank.get(a) - rank.get(b)) : dir * (a[k] - b[k]));
  const shown = S.showAll || q ? L : L.slice(0, 50);
  $('#tb').innerHTML = shown.map(p => `<tr><td>${rank.get(p)}</td><td class="n" title="${esc(p.name)}">${esc(p.name)}</td><td>${nf1.format(p.units)}</td><td>${p.tix}</td><td>${p.days}</td><td>${money(p.rev)}</td><td>${money(p.margin)}</td><td>${pct(p.mp)}</td></tr>`).join('');
  $('#more').innerHTML = L.length > shown.length ? `Mostrando ${shown.length} de ${L.length}. <a href="#" id="all">Ver todos</a>` : `${L.length} productos`;
  const a = $('#all'); if (a) a.onclick = e => { e.preventDefault(); S.showAll = true; drawTable(); };
}

/* ============ Eventos ============ */
const drop = $('#drop'), fileInput = $('#file');
drop.onclick = () => fileInput.click();
fileInput.onchange = () => fileInput.files[0] && load(fileInput.files[0]);
drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); e.dataTransfer.files[0] && load(e.dataTransfer.files[0]); };
$('#reset').onclick = () => { $('#app').classList.add('hide'); drop.classList.remove('hide'); fileInput.value = ''; S.showAll = false; };
['#from', '#to', '#wmode'].forEach(s => $(s).onchange = () => { S.showAll = false; render(); });
$('#q').oninput = drawTable;

function toggle(sel, key, redraw) {
  $(sel).onclick = e => {
    const m = e.target.dataset.m; if (!m) return;
    S[key] = m; [...$(sel).children].forEach(b => b.classList.toggle('on', b === e.target)); redraw();
  };
}
toggle('#hm', 'hMode', drawHours);
toggle('#tm', 'tMode', drawTop);

document.querySelector('thead').onclick = e => {
  const k = e.target.dataset.k; if (!k) return;
  S.sortD = S.sortK === k ? -S.sortD : (k === 'name' || k === 'rank' ? 1 : -1);
  S.sortK = k; drawTable();
};
matchMedia('(prefers-color-scheme: dark)').onchange = () => D && render();
