import { describe, expect, it } from 'vitest';
import { EncoderRunner } from '../src/backend/workers/runner';

const node = process.execPath;

describe('EncoderRunner', () => {
  it('streams stdout/stderr and reports the exit code', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const runner = new EncoderRunner();

    const result = await runner.run({
      executable: node,
      args: [
        '-e',
        'process.stdout.write("hello"); process.stderr.write("warn");',
      ],
      onStdout: (chunk) => stdout.push(chunk),
      onStderr: (chunk) => stderr.push(chunk),
    });

    expect(result.code).toBe(0);
    expect(stdout.join('')).toBe('hello');
    expect(stderr.join('')).toBe('warn');
    expect(runner.isCancelled).toBe(false);
  });

  it('reports a non-zero exit code', async () => {
    const runner = new EncoderRunner();
    const result = await runner.run({
      executable: node,
      args: ['-e', 'process.exit(3)'],
    });
    expect(result.code).toBe(3);
  });

  it('rejects when the executable cannot be spawned', async () => {
    const runner = new EncoderRunner();
    await expect(
      runner.run({
        executable: '/definitely/not/a/real/encoder',
        args: [],
      }),
    ).rejects.toThrow();
  });

  it('cancels a running encoder and its process group', async () => {
    const runner = new EncoderRunner();
    const running = runner.run({
      executable: node,
      args: ['-e', 'setInterval(() => {}, 1000)'],
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
    await runner.cancel();
    const result = await running;

    expect(runner.isCancelled).toBe(true);
    expect(result.signal === 'SIGTERM' || result.code !== 0).toBe(true);
  });

  it('applies low priority without failing when unsupported', async () => {
    const runner = new EncoderRunner();
    const result = await runner.run({
      executable: node,
      args: ['-e', 'process.exit(0)'],
      lowPriority: true,
    });
    expect(result.code).toBe(0);
  });
});
