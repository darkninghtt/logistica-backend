import type { RequestHandler } from 'express';
import { getActor } from '../middlewares/authenticate';
import { parseWith } from '../schemas/parse';
import { idParamSchema } from '../schemas/page';
import {
  cancelTransferBodySchema,
  createTransferBodySchema,
  listTransfersQuerySchema,
  receiveTransferBodySchema,
  resolveTransferBodySchema,
} from '../schemas/transfers';
import type { TransfersService } from '../services/transfers';

export interface TransfersController {
  create: RequestHandler;
  list: RequestHandler;
  get: RequestHandler;
  cancel: RequestHandler;
  dispatch: RequestHandler;
  receive: RequestHandler;
  resolve: RequestHandler;
}

/** Solo HTTP: valida la entrada, llama al servicio y responde. */
export function createTransfersController(service: TransfersService): TransfersController {
  return {
    async create(req, res) {
      const input = parseWith(createTransferBodySchema, req.body);
      res.status(201).json(await service.create(input, getActor(req)));
    },

    async list(req, res) {
      res.json(await service.list(parseWith(listTransfersQuerySchema, req.query), getActor(req)));
    },

    async get(req, res) {
      const { id } = parseWith(idParamSchema, req.params);
      res.json(await service.get(id, getActor(req)));
    },

    async cancel(req, res) {
      const { id } = parseWith(idParamSchema, req.params);
      // El cuerpo es opcional: sin él se cancela sin motivo
      const input = parseWith(cancelTransferBodySchema, req.body ?? {});
      res.json(await service.cancel(id, input, getActor(req)));
    },

    async dispatch(req, res) {
      const { id } = parseWith(idParamSchema, req.params);
      res.json(await service.dispatch(id, getActor(req)));
    },

    async receive(req, res) {
      const { id } = parseWith(idParamSchema, req.params);
      const input = parseWith(receiveTransferBodySchema, req.body);
      res.json(await service.receive(id, input, getActor(req)));
    },

    async resolve(req, res) {
      const { id } = parseWith(idParamSchema, req.params);
      const input = parseWith(resolveTransferBodySchema, req.body);
      res.json(await service.resolve(id, input, getActor(req)));
    },
  };
}
