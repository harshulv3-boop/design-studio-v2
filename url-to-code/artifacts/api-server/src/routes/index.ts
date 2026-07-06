import { Router, type IRouter } from "express";
import healthRouter from "./health";
import cloneRouter from "./clone";
import resolveRouter from "./resolve";

const router: IRouter = Router();

router.use(healthRouter);
router.use(cloneRouter);
router.use(resolveRouter);

export default router;
