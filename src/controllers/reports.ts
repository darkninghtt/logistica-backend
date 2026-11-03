import type { RequestHandler } from 'express';
import { getActor } from '../middlewares/authenticate';
import { parseWith } from '../schemas/parse';
import {
  inTransitQuerySchema,
  kardexQuerySchema,
  shrinkageReportQuerySchema,
} from '../schemas/reports';
import type { ReportsService } from '../services/reports';

export interface ReportsController {
  kardex: RequestHandler;
  shrinkage: RequestHandler;
  inTransit: RequestHandler;
}

/** Solo HTTP: valida la query, llama al servicio y responde. */
export function createReportsController(service: ReportsService): ReportsController {
  return {
    async kardex(req, res) {
      res.json(await service.kardex(parseWith(kardexQuerySchema, req.query), getActor(req)));
    },

    async shrinkage(req, res) {
      const query = parseWith(shrinkageReportQuerySchema, req.query);
      res.json(await service.shrinkage(query, getActor(req)));
    },

    async inTransit(req, res) {
      const query = parseWith(inTransitQuerySchema, req.query);
      res.json(await service.inTransit(query, getActor(req)));
    },
  };
}
