import { createHmac, randomBytes } from "crypto";
import { getAuthSecret } from "./env";

export const createSessionToken = () => randomBytes(32).toString("base64url");

export const hashSessionToken = (token: string) =>
  createHmac("sha256", getAuthSecret()).update(token).digest("hex");
