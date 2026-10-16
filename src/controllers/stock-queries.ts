import type { RequestHandler } from 'express';
import { parseWith } from '../schemas/parse';
import { stockLevelsQuerySchema, stockMovementsQuerySchema } from '../schemas/stock-queries';
import type { StockQueryService } from '../services/stock-queries';

export interface StockQueryController {
  listLevels: RequestHandler;
  listMovements: RequestHandler;
}

/** Solo HTTP: valida la query, llama al servicio y responde. */
export function createStockQueryController(service: StockQueryService): StockQueryController {
  return {
    async listLevels(req, res) {
      res.json(await service.listLevels(parseWith(stockLevelsQuerySchema, req.query)));
    },

    async listMovements(req, res) {
      res.json(await service.listMovements(parseWith(stockMovementsQuerySchema, req.query)));
    },
  };
}
