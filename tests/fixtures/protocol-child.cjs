// Test fixture that speaks the child-process protocol with configurable behaviour.
const fs = require('fs');

const mode = process.env.FIXTURE_MODE || 'ok';
const marker = process.env.FIXTURE_MARKER;
const V = 1;

function send(message) {
  process.send(Object.assign({ v: V }, message));
}

if (mode === 'crash-before-ready') {
  process.exit(1);
}

if (mode === 'hang') {
  process.on('SIGTERM', () => {
    // deliberately ignore, forcing the supervisor to escalate
  });
}

send({ type: 'ready' });

if (mode === 'crash-after-ready') {
  setTimeout(() => process.exit(1), 50);
}

if (mode === 'flaky' && marker) {
  if (!fs.existsSync(marker)) {
    fs.writeFileSync(marker, '');
    process.exit(1);
  }
}

process.on('message', (message) => {
  if (mode === 'legacy-suicide') {
    if (Array.isArray(message) && message[0] === 'suicide') {
      if (marker) fs.writeFileSync(marker, 'suicide');
      process.exit(0);
    }
    return;
  }

  if (!message || message.v !== V) return;

  if (message.type === 'shutdown') {
    // `legacy-suicide` only understands its own array-shaped stop command.
    if (mode !== 'hang' && mode !== 'legacy-suicide') process.exit(0);
    return;
  }

  if (message.type === 'configure') {
    send({ type: 'progress', phase: 'discovered', count: 5 });
    send({ type: 'log', level: 'info', message: 'configured' });
    send({
      type: 'complete',
      payload: {
        total: 1,
        sources: ['/src/a.mp4'],
        presets: ['-Z "x"'],
        skipOrCopy: [0],
        excluded: [null],
        destinations: ['/dst/a.mp4'],
        destinationsFinal: [null],
        notExists: 1,
      },
    });
  }
});
