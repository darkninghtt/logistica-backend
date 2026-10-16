import type { RequestHandler } from 'express';
import { idParamSchema, pageQuerySchema } from '../schemas/page';
import { parseWith } from '../schemas/parse';
import { productBodySchema } from '../schemas/products';
import type { ProductsService } from '../services/products';

export interface ProductsController {
  list: RequestHandler;
  create: RequestHandler;
  update: RequestHandler;
}

/** Solo HTTP: valida la entrada, llama al servicio y responde. */
export function createProductsController(service: ProductsService): ProductsController {
  return {
    async list(req, res) {
      res.json(await service.list(parseWith(pageQuerySchema, req.query)));
    },

    async create(req, res) {
      const created = await service.create(parseWith(productBodySchema, req.body));
      res.status(201).json(created);
    },

    async update(req, res) {
      const { id } = parseWith(idParamSchema, req.params);
      res.json(await service.update(id, parseWith(productBodySchema, req.body)));
    },
  };
}
