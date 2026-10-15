import { Router } from 'express';
import { getHealth } from '../controllers/health';

export function createHealthRouter(): Router {
  const router = Router();
  router.get('/health', getHealth);
  return router;
}
