import { Router, type IRouter } from "express";
import healthRouter from "./health";
import cloneRouter from "./clone";

const router: IRouter = Router();

router.use(healthRouter);
router.use(cloneRouter);

export default router;
