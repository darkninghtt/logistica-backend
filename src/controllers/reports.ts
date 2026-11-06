import type { RequestHandler, Response } from 'express';
import { getActor } from '../middlewares/authenticate';
import { parseWith } from '../schemas/parse';
import {
  inTransitQuerySchema,
  kardexExportQuerySchema,
  kardexQuerySchema,
  shrinkageExportQuerySchema,
  shrinkageReportQuerySchema,
} from '../schemas/reports';
import type { ReportFile } from '../services/report-files';
import type { ReportsService } from '../services/reports';

export interface ReportsController {
  kardex: RequestHandler;
  exportKardex: RequestHandler;
  shrinkage: RequestHandler;
  exportShrinkage: RequestHandler;
  inTransit: RequestHandler;
  summary: RequestHandler;
}

/** Envía el archivo como descarga: texto de una vez o, si es un stream (PDF), por partes. */
function sendFile(res: Response, file: ReportFile): void {
  res.set('Content-Type', file.contentType);
  res.attachment(file.filename);
  if (typeof file.body === 'string') {
    res.send(file.body);
  } else {
    file.body.pipe(res);
  }
}

/** Solo HTTP: valida la query, llama al servicio y responde. */
export function createReportsController(service: ReportsService): ReportsController {
  return {
    async kardex(req, res) {
      res.json(await service.kardex(parseWith(kardexQuerySchema, req.query), getActor(req)));
    },

    async exportKardex(req, res) {
      const query = parseWith(kardexExportQuerySchema, req.query);
      sendFile(res, await service.exportKardex(query, getActor(req)));
    },

    async shrinkage(req, res) {
      const query = parseWith(shrinkageReportQuerySchema, req.query);
      res.json(await service.shrinkage(query, getActor(req)));
    },

    async exportShrinkage(req, res) {
      const query = parseWith(shrinkageExportQuerySchema, req.query);
      sendFile(res, await service.exportShrinkage(query, getActor(req)));
    },

    async inTransit(req, res) {
      const query = parseWith(inTransitQuerySchema, req.query);
      res.json(await service.inTransit(query, getActor(req)));
    },

    async summary(req, res) {
      res.json(await service.summary(getActor(req)));
    },
  };
}
