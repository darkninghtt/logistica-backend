import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTaskQueue, type QueueLogger } from '../../src/task-queue';

function fakeLogger(): QueueLogger & { warnings: object[]; errors: object[] } {
  const warnings: object[] = [];
  const errors: object[] = [];
  return {
    warnings,
    errors,
    warn(fields) {
      warnings.push(fields);
    },
    error(fields) {
      errors.push(fields);
    },
  };
}

/** Tarea que falla las primeras `failures` veces y luego funciona. */
function flaky(failures: number): { task: () => Promise<void>; calls: () => number } {
  let calls = 0;
  return {
    task: async () => {
      calls++;
      if (calls <= failures) throw new Error(`fallo ${calls}`);
    },
    calls: () => calls,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('cola de tareas', () => {
  it('ejecuta la tarea una sola vez si funciona al primer intento', async () => {
    const logger = fakeLogger();
    const sleep = vi.fn(async () => undefined);
    const queue = createTaskQueue({ logger, sleep });
    const { task, calls } = flaky(0);

    queue.enqueue('publicar', task);
    await queue.idle();

    expect(calls()).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(logger.warnings).toEqual([]);
    expect(logger.errors).toEqual([]);
  });

  it('reintenta y termina bien si la tarea falla dos veces', async () => {
    const logger = fakeLogger();
    const sleep = vi.fn(async () => undefined);
    const queue = createTaskQueue({ logger, sleep });
    const { task, calls } = flaky(2);

    queue.enqueue('publicar', task);
    await queue.idle();

    expect(calls()).toBe(3);
    expect(logger.warnings).toHaveLength(2);
    expect(logger.errors).toEqual([]);
  });

  it('se rinde a los 3 intentos y registra el fallo con el correlationId de quien encoló', async () => {
    const logger = fakeLogger();
    const queue = createTaskQueue({
      logger,
      sleep: async () => undefined,
      correlationId: () => 'req-42',
    });
    const { task, calls } = flaky(10);

    queue.enqueue('publicar', task);
    await queue.idle();

    expect(calls()).toBe(3);
    expect(logger.errors).toHaveLength(1);
    expect(logger.errors[0]).toMatchObject({
      task: 'publicar',
      attempts: 3,
      correlationId: 'req-42',
    });
  });

  it('espera más en cada reintento (200 ms y luego 400 ms)', async () => {
    vi.useFakeTimers();
    const queue = createTaskQueue({ logger: fakeLogger() });
    const { task, calls } = flaky(10);

    queue.enqueue('publicar', task);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls()).toBe(1);

    await vi.advanceTimersByTimeAsync(199);
    expect(calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls()).toBe(2);

    await vi.advanceTimersByTimeAsync(399);
    expect(calls()).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls()).toBe(3);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls()).toBe(3);
  });

  it('una tarea que se rinde no detiene las siguientes y el orden se mantiene', async () => {
    const order: string[] = [];
    const queue = createTaskQueue({ logger: fakeLogger(), sleep: async () => undefined });

    queue.enqueue('a', async () => {
      order.push('a');
      throw new Error('siempre falla');
    });
    queue.enqueue('b', async () => {
      order.push('b');
    });
    await queue.idle();

    expect(order).toEqual(['a', 'a', 'a', 'b']);
  });

  it('encolar no espera a que la tarea termine', () => {
    const queue = createTaskQueue({ logger: fakeLogger() });
    const task = vi.fn(async () => undefined);

    queue.enqueue('publicar', task);

    expect(task).not.toHaveBeenCalled();
  });
});
