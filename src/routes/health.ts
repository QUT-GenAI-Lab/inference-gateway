import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

const route = new OpenAPIHono();

route.openapi(
  createRoute({
    path: "/",
    method: "get",
    security: [{ apiKey: [] }],
    responses: {
      200: {
        description: "Successful response",
        content: {
          "application/json": {
            schema: z
              .object({
                status: z.literal("ok"),
              })
              .openapi({
                example: {
                  status: "ok",
                },
              }),
          },
        },
      },
    },
  }),
  async (c) => {
    return c.json({ status: "ok" as const });
  },
);

export default route;
