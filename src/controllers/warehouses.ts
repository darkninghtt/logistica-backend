import type { RequestHandler } from 'express';
import { idParamSchema, pageQuerySchema } from '../schemas/page';
import { parseWith } from '../schemas/parse';
import { warehouseBodySchema } from '../schemas/warehouses';
import type { WarehousesService } from '../services/warehouses';

export interface WarehousesController {
  list: RequestHandler;
  create: RequestHandler;
  update: RequestHandler;
}

/** Solo HTTP: valida la entrada, llama al servicio y responde. */
export function createWarehousesController(service: WarehousesService): WarehousesController {
  return {
    async list(req, res) {
      res.json(await service.list(parseWith(pageQuerySchema, req.query)));
    },

    async create(req, res) {
      const created = await service.create(parseWith(warehouseBodySchema, req.body));
      res.status(201).json(created);
    },

    async update(req, res) {
      const { id } = parseWith(idParamSchema, req.params);
      res.json(await service.update(id, parseWith(warehouseBodySchema, req.body)));
    },
  };
}
