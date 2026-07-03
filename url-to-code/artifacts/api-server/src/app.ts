import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import dashboardHtml from "./dashboard.html";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Control-panel dashboard, served from the engine itself so opening
// http://localhost:<PORT>/ gives you a working UI on the same origin as the
// API (no separate service, no CORS, and if this loads the engine is up).
app.get(["/", "/dashboard"], (_req, res) => {
  res.type("html").send(dashboardHtml);
});

app.use("/api", router);

export default app;
