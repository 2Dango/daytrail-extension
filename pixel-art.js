const landscape = document.querySelector('#landscape');
const wordmark = document.querySelector('#wordmark');

if (landscape && wordmark) {
  const width = 768;
  const height = 240;
  landscape.width = width;
  landscape.height = height;
  const pen = landscape.getContext('2d');
  pen.imageSmoothingEnabled = false;

  const box = (x, y, w, h, color) => {
    pen.fillStyle = color;
    pen.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };

  function cloud(x, y, tone = '#fff9e8') {
    box(x + 12, y, 34, 7, tone);
    box(x + 5, y + 7, 52, 8, tone);
    box(x, y + 15, 68, 8, tone);
    box(x + 18, y - 6, 20, 6, tone);
    box(x + 10, y + 23, 45, 3, '#b8d7d3');
  }

  function pine(x, ground, scale = 1, dark = '#315c45') {
    const unit = Math.max(2, Math.round(3 * scale));
    box(x - unit, ground - 11 * unit, 2 * unit, 11 * unit, '#5a5541');
    box(x - 2 * unit, ground - 11 * unit, 4 * unit, 3 * unit, '#7ca274');
    box(x - 3 * unit, ground - 9 * unit, 6 * unit, 3 * unit, dark);
    box(x - 4 * unit, ground - 7 * unit, 8 * unit, 3 * unit, dark);
    box(x - 5 * unit, ground - 5 * unit, 10 * unit, 3 * unit, dark);
    box(x - 2 * unit, ground - 10 * unit, unit, 4 * unit, '#9ab786');
  }

  function flower(x, y, color) {
    box(x, y, 2, 7, '#4c794e');
    box(x - 2, y - 2, 2, 3, color);
    box(x + 2, y - 2, 2, 3, color);
    box(x, y - 4, 2, 3, '#f7e3a2');
  }

  function drawLandscape(cloudStep = 0) {
    pen.clearRect(0, 0, width, height);
    box(0, 0, width, height, '#c9e5df');
    box(0, 92, width, 3, '#bad9cf');

    // Sun and stepped halo.
    box(632, 22, 38, 38, '#e7b95b');
    box(626, 28, 50, 26, '#e7b95b');
    box(638, 16, 26, 50, '#e7b95b');
    box(639, 23, 24, 30, '#f4ce72');

    cloud(42 + cloudStep, 27);
    cloud(295 - cloudStep, 13, '#f8f5df');
    cloud(675 + Math.floor(cloudStep / 2), 73, '#eef1d9');

    // Far and middle mountain layers use blocky steps instead of smooth curves.
    const far = [95, 91, 87, 82, 78, 73, 68, 63, 59, 55, 62, 68, 74, 80, 86, 91, 96, 92, 88, 84, 79, 75, 70, 77, 83, 88, 94, 98];
    for (let x = 0; x < width; x += 28) box(x, far[(x / 28) % far.length], 29, height, '#9dbd9e');
    const middle = [128, 122, 116, 108, 101, 95, 105, 113, 119, 124, 116, 108, 102, 96, 90, 99, 106, 114, 121, 126, 118, 110, 103, 113];
    for (let x = 0; x < width; x += 32) box(x, middle[(x / 32) % middle.length], 33, height, '#6f9674');

    // Meadow stripes and near ridge.
    box(0, 147, width, 93, '#789760');
    for (let x = 0; x < width; x += 16) {
      const ridge = 15 + Math.round(9 * Math.sin(x / 48) + 5 * Math.cos(x / 27));
      box(x, 148 - ridge, 17, ridge + 12, '#477557');
    }
    box(0, 177, width, 63, '#86a867');
    box(0, 203, width, 37, '#719456');
    for (let x = 0; x < width; x += 18) box(x, 208 + (x % 36 ? 5 : 0), 10, 3, '#a8bd76');

    // A winding trail, widened in pixel steps toward the foreground.
    const trail = [
      [383, 137, 15, 8], [378, 145, 24, 8], [385, 153, 25, 8], [377, 161, 38, 8],
      [363, 169, 53, 9], [351, 178, 72, 10], [332, 188, 103, 11], [306, 199, 148, 13],
      [271, 212, 220, 14], [226, 226, 310, 14],
    ];
    for (const [x, y, w, h] of trail) {
      box(x, y, w, h, '#d7c28e');
      box(x + 5, y, Math.max(3, w - 12), 3, '#ead9a9');
    }

    // Cabin tucked into the right side of the meadow.
    box(564, 135, 79, 48, '#b7744b');
    box(557, 130, 93, 9, '#315c45');
    box(566, 122, 72, 9, '#315c45');
    box(579, 113, 46, 9, '#315c45');
    box(625, 112, 10, 20, '#78523d');
    box(576, 151, 18, 32, '#6b4b38');
    box(608, 149, 20, 18, '#f2cf72');
    box(611, 152, 6, 6, '#fff1a3');
    box(620, 152, 6, 6, '#fff1a3');
    box(600, 183, 20, 4, '#526b49');
    box(555, 183, 101, 5, '#5f7f4e');

    // Foreground framing trees echo the prototype, now with depth and highlights.
    for (const [x, y, scale] of [[25, 210, 1.7], [78, 215, 1.25], [130, 201, .9], [692, 215, 1.35], [744, 220, 1.65], [524, 190, .75]]) {
      pine(x, y, scale);
    }
    for (const [x, y, color] of [[164, 213, '#e7b25f'], [185, 222, '#e98f78'], [545, 211, '#d7c7f2'], [667, 197, '#f0b35f'], [104, 230, '#f1d1dd'], [509, 226, '#f5e18d']]) flower(x, y, color);

    // Tiny birds and trail markers keep the scene alive without changing its mood.
    box(210, 55, 6, 2, '#55766b'); box(216, 53, 6, 2, '#55766b');
    box(235, 68, 5, 2, '#55766b'); box(240, 66, 5, 2, '#55766b');
    box(436, 171, 5, 20, '#6c513a'); box(441, 171, 25, 5, '#d5b56b'); box(448, 176, 5, 4, '#d5b56b');
  }

  drawLandscape();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let step = 0;
  let timer;
  const animate = () => {
    if (document.hidden || reduced.matches) return;
    step = (step + 1) % 12;
    drawLandscape(step < 6 ? step : 11 - step);
  };
  const setAnimation = () => {
    clearInterval(timer);
    if (!reduced.matches) timer = setInterval(animate, 650);
    else drawLandscape(0);
  };
  setAnimation();
  reduced.addEventListener?.('change', setAnimation);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearInterval(timer);
    else setAnimation();
  });

  const letters = {
    D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
    T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    I: ['111', '010', '010', '010', '010', '010', '111'],
    L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  };
  wordmark.width = 344;
  wordmark.height = 68;
  const ink = wordmark.getContext('2d');
  ink.imageSmoothingEnabled = false;
  const drawWord = (offsetX, offsetY, color) => {
    let x = 8;
    for (const letter of 'DAYTRAIL') {
      const glyph = letters[letter];
      glyph.forEach((row, y) => Array.from(row).forEach((pixel, column) => {
        if (pixel === '1') {
          ink.fillStyle = color;
          ink.fillRect(x + column * 6 + offsetX, 8 + y * 6 + offsetY, 6, 6);
        }
      }));
      x += (glyph[0].length + 1) * 6;
    }
  };
  drawWord(5, 6, '#1f4434');
  drawWord(0, 0, '#fff7dc');
  drawWord(1, 1, '#fff7dc');
}
