import crypto from "crypto";

export function generateTempPassword() {
  return crypto.randomBytes(6).toString("base64url");
}
