/**
 * Renders the source SVGs in `src/assets/icons/source` into every app and tray
 * icon the packaging and runtime need. Run with `pnpm icons`.
 *
 * Electron is used as the renderer because it ships with the project, renders
 * SVG identically to the app's Chromium, and keeps the generator free of native
 * image dependencies on Linux, macOS and Windows.
 */
const { app, BrowserWindow } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();
// The generator closes its hidden window between renders. Without a listener
// Electron treats the last window closing as "quit the app".
app.on('window-all-closed', () => undefined);

const ROOT = path.resolve(__dirname, '..');
const ICONS = path.join(ROOT, 'src', 'assets', 'icons');
const SOURCE = path.join(ICONS, 'source');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hbbatchbeast-icons-'));

/** Status badge colours follow the app's semantic palette. */
const STATUS = {
  running: {
    color: '#22c55e',
    glyph:
      '<path d="M 756 194 L 756 266 L 812 230 Z" fill="#ffffff" stroke="#ffffff" stroke-width="10" stroke-linejoin="round"/>',
  },
  paused: {
    color: '#f59e0b',
    glyph:
      '<rect x="750" y="192" width="22" height="76" rx="11" fill="#ffffff"/>' +
      '<rect x="784" y="192" width="22" height="76" rx="11" fill="#ffffff"/>',
  },
  error: {
    color: '#ef4444',
    glyph:
      '<rect x="767" y="188" width="22" height="52" rx="11" fill="#ffffff"/>' +
      '<circle cx="778" cy="262" r="12" fill="#ffffff"/>',
  },
};

const ICNS_TYPES = {
  16: 'icp4',
  32: 'icp5',
  64: 'icp6',
  128: 'ic07',
  256: 'ic08',
  512: 'ic09',
  1024: 'ic10',
};

const readSource = (name) => fs.readFileSync(path.join(SOURCE, name), 'utf8');

function withBadge(svg, status) {
  if (!status) return svg;
  const badge = STATUS[status];
  return svg.replace(
    '</svg>',
    `<g>
      <circle cx="778" cy="230" r="105" fill="#ffffff"/>
      <circle cx="778" cy="230" r="90" fill="${badge.color}"/>
      ${badge.glyph}
    </g>
    </svg>`,
  );
}

function pngSize(buffer) {
  const signature = buffer.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') {
    throw new Error('Renderer did not return a PNG');
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

let renderWindow = null;

async function render(svg, size) {
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
  svg { display: block; width: ${size}px; height: ${size}px; }
</style>
</head>
<body>${svg.replace(/width="1024" height="1024"/, `width="${size}" height="${size}"`)}</body>
</html>`;

  const id = crypto.randomBytes(8).toString('hex');
  const file = path.join(TMP, `render-${id}.html`);
  fs.writeFileSync(file, html);

  const windowSize = Math.max(size, 512);
  if (!renderWindow || renderWindow.isDestroyed()) {
    renderWindow = new BrowserWindow({
      width: windowSize,
      height: windowSize,
      useContentSize: true,
      show: true,
      opacity: 0,
      focusable: false,
      skipTaskbar: true,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: { offscreen: false },
    });
  } else {
    renderWindow.setContentSize(windowSize, windowSize);
  }

  await renderWindow.loadFile(file);
  await renderWindow.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
  );

  const image = await renderWindow.webContents.capturePage({
    x: 0,
    y: 0,
    width: size,
    height: size,
  });
  fs.rmSync(file, { force: true });

  let png = image.toPNG();
  const rendered = pngSize(png);
  if (rendered.width !== size || rendered.height !== size) {
    png = image.resize({ width: size, height: size, quality: 'best' }).toPNG();
    const resized = pngSize(png);
    if (resized.width !== size || resized.height !== size) {
      throw new Error(
        `Expected a ${size}x${size} icon, got ${resized.width}x${resized.height}`,
      );
    }
  }
  return png;
}

function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;
  entries.forEach(({ size, png }, index) => {
    const at = index * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, at);
    directory.writeUInt8(size >= 256 ? 0 : size, at + 1);
    directory.writeUInt8(0, at + 2);
    directory.writeUInt8(0, at + 3);
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });

  return Buffer.concat([header, directory, ...entries.map((e) => e.png)]);
}

function buildIcns(entries) {
  const chunks = entries.map(({ size, png }) => {
    const type = ICNS_TYPES[size];
    if (!type) throw new Error(`No ICNS chunk type for ${size}px`);
    const chunk = Buffer.alloc(8);
    chunk.write(type, 0, 4, 'ascii');
    chunk.writeUInt32BE(8 + png.length, 4);
    return Buffer.concat([chunk, png]);
  });
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(
    8 + chunks.reduce((total, chunk) => total + chunk.length, 0),
    4,
  );
  return Buffer.concat([header, ...chunks]);
}

const detailed = readSource('icon.svg');
const small = readSource('icon-small.svg');
const tiny = readSource('icon-16.svg');

/**
 * 16px only has room for a play mark; 24px can keep one queue line; larger
 * sizes use the full three-line batch glyph.
 */
const sourceFor = (size, status) => {
  if (size <= 16) return withBadge(tiny, status);
  if (size <= 24) return withBadge(small, status);
  return withBadge(detailed, status);
};

const cache = new Map();
async function pngFor(svg, size) {
  const key = `${size}:${crypto.createHash('sha1').update(svg).digest('hex')}`;
  if (!cache.has(key)) cache.set(key, await render(svg, size));
  return cache.get(key);
}

function write(relativePath, data) {
  const target = path.join(ICONS, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
  console.log(
    `  ${relativePath.padEnd(28)} ${
      Buffer.isBuffer(data) ? `${data.length.toLocaleString()} bytes` : data
    }`,
  );
}

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const ICNS_SIZES = [16, 32, 64, 128, 256, 512, 1024];

async function buildIcnsFor(status) {
  const entries = [];
  for (const size of ICNS_SIZES) {
    entries.push({ size, png: await pngFor(sourceFor(size, status), size) });
  }
  return buildIcns(entries);
}

async function buildIcoFor(status) {
  const entries = [];
  for (const size of ICO_SIZES) {
    entries.push({ size, png: await pngFor(sourceFor(size, status), size) });
  }
  return buildIco(entries);
}

async function writeBundle() {
  console.log('App icon');
  write('png/icon.png', await pngFor(detailed, 1024));
  write('mac/icon.icns', await buildIcnsFor());
  write('win/icon.ico', await buildIcoFor());

  for (const status of ['running', 'watching', 'error']) {
    const badgeStatus = status === 'watching' ? 'paused' : status;
    const trayName =
      status === 'running'
        ? 'iconrunning'
        : status === 'watching'
          ? 'iconwatching'
          : 'iconerror';
    console.log(`\n${trayName}`);
    write(
      `png/${trayName}.png`,
      await pngFor(withBadge(small, badgeStatus), 64),
    );
    write(`mac/${trayName}.icns`, await buildIcnsFor(badgeStatus));
    write(`win/${trayName}.ico`, await buildIcoFor(badgeStatus));
  }
}

async function main() {
  console.log('Building HBBatchBeast icons');
  console.log('Tray idle');
  write('png/tray.png', await pngFor(small, 64));
  await writeBundle();
  console.log('\nDone. Unused legacy icon2.* assets were left untouched.');
}

app.whenReady().then(async () => {
  try {
    await main();
    renderWindow?.destroy();
    fs.rmSync(TMP, { recursive: true, force: true });
    app.quit();
  } catch (error) {
    console.error(error);
    renderWindow?.destroy();
    fs.rmSync(TMP, { recursive: true, force: true });
    app.exit(1);
  }
});

setTimeout(() => {
  console.error('Icon generation timed out');
  app.exit(2);
}, 120000).unref();
