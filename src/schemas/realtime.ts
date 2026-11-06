import { z } from 'zod';

/** Respuesta de POST /api/realtime/ticket. */
export const realtimeTicketSchema = z.strictObject({
  ticket: z.string().meta({ description: 'Aleatorio, de un solo uso' }),
  expiresIn: z.int().meta({ description: 'Segundos de validez', example: 30 }),
});
