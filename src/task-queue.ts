/** Lo que la cola necesita del logger (pino cumple con esto). */
export interface QueueLogger {
  warn(fields: object, message: string): void;
  error(fields: object, message: string): void;
}

export interface TaskQueue {
  /** Agrega la tarea al final de la cola y vuelve de inmediato (no espera a que se ejecute). */
  enqueue(name: string, task: () => Promise<void>): void;
  /** Se resuelve cuando ya no quedan tareas pendientes (sirve en las pruebas y al apagar). */
  idle(): Promise<void>;
}

export interface TaskQueueOptions {
  logger: QueueLogger;
  /** Correlation id de la petición que encola; se guarda para registrar los fallos con él. */
  correlationId?: () => string | undefined;
  /** Espera entre intentos; las pruebas pueden reemplazarla. */
  sleep?: (ms: number) => Promise<void>;
}

/** Intentos por tarea antes de rendirse. */
export const MAX_ATTEMPTS = 3;
/** Espera antes del segundo y del tercer intento (crece al doble). */
export const RETRY_DELAYS_MS: readonly number[] = [200, 400];

/**
 * Cola de tareas en memoria. Las tareas corren de una en una y en el orden en que llegan (así los
 * eventos de tiempo real salen en orden). Cada tarea se intenta hasta 3 veces con espera creciente;
 * si se agotan los intentos, el fallo queda en el log y la cola sigue con la siguiente: nunca
 * reintenta para siempre ni tumba el proceso. Si el proceso se reinicia, lo pendiente se pierde
 * (aceptado: la BD es la fuente de verdad y el cliente vuelve a pedir los datos al reconectar).
 */
export function createTaskQueue({
  logger,
  correlationId = () => undefined,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: TaskQueueOptions): TaskQueue {
  let tail: Promise<void> = Promise.resolve();

  async function runWithRetries(
    name: string,
    task: () => Promise<void>,
    requestId: string | undefined,
  ): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await task();
        return;
      } catch (err) {
        const delayMs = RETRY_DELAYS_MS[attempt - 1];
        if (attempt >= MAX_ATTEMPTS || delayMs === undefined) {
          logger.error(
            { task: name, attempts: attempt, correlationId: requestId, err },
            'Tarea abandonada tras agotar los intentos',
          );
          return;
        }
        logger.warn(
          { task: name, attempt, delayMs, correlationId: requestId, err },
          'Tarea fallida, se reintenta',
        );
        await sleep(delayMs);
      }
    }
  }

  return {
    enqueue(name, task) {
      // Se toma al encolar: cuando la tarea corra ya no estará dentro de la petición
      const requestId = correlationId();
      tail = tail.then(() => runWithRetries(name, task, requestId));
    },

    async idle() {
      // Si mientras se esperaba se encoló otra tarea, se espera también a esa
      let current: Promise<void>;
      do {
        current = tail;
        await current;
      } while (current !== tail);
    },
  };
}
