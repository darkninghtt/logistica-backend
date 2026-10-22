import type { RequestHandler } from 'express';
import { getActor } from '../middlewares/authenticate';
import { parseWith } from '../schemas/parse';
import { stockEntryBodySchema } from '../schemas/stock';
import type { StockService } from '../services/stock';

export interface StockController {
  createEntry: RequestHandler;
}

/** Solo HTTP: valida la entrada, llama al servicio y responde. */
export function createStockController(service: StockService): StockController {
  return {
    async createEntry(req, res) {
      const input = parseWith(stockEntryBodySchema, req.body);
      res.status(201).json(await service.registerEntry(input, getActor(req)));
    },
  };
}
