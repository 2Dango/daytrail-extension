import { categories } from './categories.js';
import { formatDuration } from './time-data.js';

const colors = ['#8c552d', '#27718a', '#6a558b', '#68705b', '#ad5a4c', '#78527d', '#37734e',
  '#a86c29', '#45806c', '#405a88', '#997187', '#969237', '#575a50', '#c48131'];
const colorByCategory = new Map(categories.map((name, index) => [name, colors[index]]));
const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 });

export function initCategoryChart() {
  const metric = document.getElementById('category-metric');
  const pie = document.getElementById('category-pie');
  const center = document.getElementById('category-pie-total');
  const legend = document.getElementById('category-summary');
  const empty = document.getElementById('category-empty');
  let data = [];

  function draw() {
    const field = metric.value;
    const rows = data.filter((row) => row[field] > 0).sort((a, b) => b[field] - a[field]);
    const total = rows.reduce((sum, row) => sum + row[field], 0);
    pie.hidden = !total;
    empty.hidden = Boolean(total);
    empty.textContent = field === 'ms' ? 'No active time recorded in this date range.' : 'No website visits in this date range.';
    const format = field === 'ms' ? formatDuration : (number) => number.toLocaleString() + (number === 1 ? ' visit' : ' visits');
    center.textContent = format(total);
    let offset = 0;
    const stops = [];
    legend.replaceChildren(...rows.map(({ category, [field]: value }) => {
      const color = colorByCategory.get(category) ?? '#b4b19d';
      const end = (offset + value) / total * 100;
      stops.push(color + ' ' + (offset / total * 100) + '% ' + end + '%');
      offset += value;
      const row = document.createElement('li');
      const swatch = document.createElement('i');
      swatch.className = 'category-swatch';
      swatch.style.backgroundColor = color;
      swatch.setAttribute('aria-hidden', 'true');
      const label = document.createElement('strong');
      label.textContent = category;
      const detail = document.createElement('span');
      detail.textContent = format(value) + ' · ' + percent.format(value / total);
      row.append(swatch, label, detail);
      return row;
    }));
    pie.style.backgroundImage = total ? 'conic-gradient(' + stops.join(', ') + ')' : 'none';
  }

  metric.addEventListener('change', draw);
  return (rows) => { data = rows; draw(); };
}
