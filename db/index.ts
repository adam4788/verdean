import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getD1() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Configure the `DB` binding before using Verdean persistence."
    );
  }
  return env.DB;
}

export function getDb() {
  return drizzle(getD1(), { schema });
}
