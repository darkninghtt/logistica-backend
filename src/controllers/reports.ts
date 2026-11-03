import type { RequestHandler } from 'express';
import { getActor } from '../middlewares/authenticate';
import { parseWith } from '../schemas/parse';
import { kardexQuerySchema } from '../schemas/reports';
import type { ReportsService } from '../services/reports';

export interface ReportsController {
  kardex: RequestHandler;
}

/** Solo HTTP: valida la query, llama al servicio y responde. */
export function createReportsController(service: ReportsService): ReportsController {
  return {
    async kardex(req, res) {
      res.json(await service.kardex(parseWith(kardexQuerySchema, req.query), getActor(req)));
    },
  };
}
