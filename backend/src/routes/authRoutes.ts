import { Router } from 'express';
import { login, requestRegistration, confirmRegistration } from '../controllers/authController';

const router = Router();

router.post('/login', login);
router.post('/register/request', requestRegistration);
router.post('/register/confirm', confirmRegistration);

export default router;