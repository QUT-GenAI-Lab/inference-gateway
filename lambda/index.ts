import { handle } from "hono/aws-lambda";
import generateRoute from "./routes/generate";
import { OpenAPIHono } from "@hono/zod-openapi";

export const app = new OpenAPIHono();

app.get("/", (c) => c.text("Hello Hono!"));
app.route("/generate", generateRoute);

export const handler = handle(app);
