import type { RequestHandler } from 'express';
import { idParamSchema, pageQuerySchema } from '../schemas/page';
import { parseWith } from '../schemas/parse';
import {
  createUserBodySchema,
  updateUserBodySchema,
  userWarehousesBodySchema,
} from '../schemas/users';
import type { UserManagementService } from '../services/user-management';

export interface UsersController {
  list: RequestHandler;
  create: RequestHandler;
  update: RequestHandler;
  setWarehouses: RequestHandler;
}

/** Solo HTTP: valida la entrada, llama al servicio y responde. */
export function createUsersController(service: UserManagementService): UsersController {
  return {
    async list(req, res) {
      res.json(await service.list(parseWith(pageQuerySchema, req.query)));
    },

    async create(req, res) {
      const created = await service.create(parseWith(createUserBodySchema, req.body));
      res.status(201).json(created);
    },

    async update(req, res) {
      const { id } = parseWith(idParamSchema, req.params);
      res.json(await service.update(id, parseWith(updateUserBodySchema, req.body)));
    },

    async setWarehouses(req, res) {
      const { id } = parseWith(idParamSchema, req.params);
      const { warehouseIds } = parseWith(userWarehousesBodySchema, req.body);
      res.json(await service.setWarehouses(id, warehouseIds));
    },
  };
}
