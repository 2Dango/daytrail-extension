const dayLabel = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const fullDayLabel = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const numbers = new Intl.NumberFormat();
const colors = { visits: '#287050', searches: '#a46822' };

function tickStep(peak) {
  if (peak <= 4) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(peak / 4));
  const step = [1, 2, 2.5, 5, 10].find((value) => value * magnitude >= peak / 4) ?? 10;
  return Math.ceil(step * magnitude);
}

export function activityChart(canvas, tooltip, announcement) {
  const pen = canvas.getContext('2d');
  const font = getComputedStyle(canvas).fontFamily;
  let timeline = [];
  let layout;
  let selected = -1;

  function draw() {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
    const width = Math.round(bounds.width * pixelRatio);
    const height = Math.round(bounds.height * pixelRatio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    pen.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    pen.clearRect(0, 0, bounds.width, bounds.height);
    pen.font = `11px ${font}`;

    const step = tickStep(Math.max(0, ...timeline.map(({ visits }) => visits)));
    const left = Math.max(25, pen.measureText(numbers.format(step * 4)).width + 10);
    const right = bounds.width - (bounds.width < 420 ? 20 : 26);
    const top = 12;
    const bottom = bounds.height - 28;
    const x = (index) => left + index / Math.max(1, timeline.length - 1) * (right - left);
    const y = (value) => bottom - value / (step * 4) * (bottom - top);
    layout = { left, right, x };

    for (let tick = 0; tick <= 4; tick += 1) {
      const value = tick * step;
      const at = y(value);
      pen.beginPath();
      pen.strokeStyle = '#e5ece3';
      pen.lineWidth = 1;
      pen.moveTo(left, at);
      pen.lineTo(right, at);
      pen.stroke();
      pen.textAlign = 'right';
      pen.textBaseline = 'middle';
      pen.fillStyle = '#5b6c62';
      pen.fillText(numbers.format(value), left - 8, at);
    }

    if (!timeline.length) {
      tooltip.hidden = true;
      return;
    }

    const labelCount = Math.min(timeline.length, bounds.width < 425 ? 4 : 6);
    const labels = Array.from({ length: labelCount }, (_, index) =>
      Math.round(index * (timeline.length - 1) / Math.max(1, labelCount - 1)));
    for (const index of labels) {
      pen.textAlign = index === 0 ? 'left' : index === timeline.length - 1 ? 'right' : 'center';
      pen.textBaseline = 'top';
      pen.fillStyle = '#53665a';
      pen.fillText(dayLabel.format(timeline[index].date), x(index), bottom + 10);
    }

    function trace(key) {
      pen.beginPath();
      pen.moveTo(x(0), y(timeline[0][key]));
      for (let index = 1; index < timeline.length; index += 1) {
        pen.lineTo(x(index), y(timeline[index][key]));
      }
    }

    const area = pen.createLinearGradient(0, top, 0, bottom);
    area.addColorStop(0, '#d7e9d8');
    area.addColorStop(1, '#f4f9f4');
    trace('visits');
    pen.lineTo(x(timeline.length - 1), bottom);
    pen.lineTo(x(0), bottom);
    pen.closePath();
    pen.fillStyle = area;
    pen.fill();

    for (const key of ['visits', 'searches']) {
      trace(key);
      pen.strokeStyle = colors[key];
      pen.lineWidth = key === 'visits' ? 2.25 : 1.75;
      pen.lineJoin = 'round';
      pen.lineCap = 'round';
      pen.stroke();
    }

    if (selected < 0) {
      tooltip.hidden = true;
      return;
    }

    const position = x(selected);
    const point = timeline[selected];
    pen.beginPath();
    pen.setLineDash([3, 3]);
    pen.lineWidth = 1;
    pen.strokeStyle = '#7c9283';
    pen.moveTo(position, top);
    pen.lineTo(position, bottom);
    pen.stroke();
    pen.setLineDash([]);
    for (const key of ['visits', 'searches']) {
      pen.beginPath();
      pen.arc(position, y(point[key]), 4, 0, Math.PI * 2);
      pen.fillStyle = colors[key];
      pen.fill();
      pen.lineWidth = 1.5;
      pen.strokeStyle = '#fff';
      pen.stroke();
    }

    const date = document.createElement('strong');
    date.textContent = fullDayLabel.format(point.date);
    const counts = `${numbers.format(point.visits)} visits · ${numbers.format(point.searches)} searches`;
    tooltip.replaceChildren(date, document.createTextNode(counts));
    tooltip.hidden = false;
    const tooltipWidth = tooltip.offsetWidth;
    const preferred = position + tooltipWidth + 12 < bounds.width ? position + 10 : position - tooltipWidth - 10;
    tooltip.style.left = `${Math.max(0, preferred)}px`;
  }

  function select(index, announce = false) {
    if (!timeline.length || selected === index) return;
    selected = index;
    draw();
    if (announce && index >= 0) {
      const point = timeline[index];
      announcement.textContent = `${fullDayLabel.format(point.date)}, ${point.visits} visits, ${point.searches} Google searches`;
    }
  }

  function selectPointer(event) {
    if (!timeline.length || !layout) return;
    const left = canvas.getBoundingClientRect().left;
    const relative = (event.clientX - left - layout.left) / (layout.right - layout.left);
    const index = Math.round(relative * (timeline.length - 1));
    select(Math.max(0, Math.min(timeline.length - 1, index)));
  }

  canvas.addEventListener('pointermove', selectPointer);
  canvas.addEventListener('pointerdown', selectPointer);
  canvas.addEventListener('pointerleave', () => select(-1));
  canvas.addEventListener('blur', () => select(-1));
  canvas.addEventListener('keydown', (event) => {
    if (!timeline.length) return;
    if (event.key === 'Escape') select(-1);
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;

    event.preventDefault();
    const delta = event.key === 'ArrowLeft' ? -1 : 1;
    const next = selected < 0 ? (delta < 0 ? timeline.length - 1 : 0) : selected + delta;
    select(Math.max(0, Math.min(timeline.length - 1, next)), true);
  });
  const resizeObserver = new ResizeObserver(draw);
  resizeObserver.observe(canvas);

  return {
    set(next) {
      timeline = next;
      selected = -1;
      announcement.textContent = '';
      draw();
    },
  };
}
