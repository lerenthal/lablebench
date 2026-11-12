/**
 * Auth seam.
 *
 * Phase 1 runs with no auth: the app is open on the trusted LAN and every
 * template is readable and writable by anyone who can reach the server
 * (see the brief, "Target environment (locked)").
 *
 * This module exists so that adding a shared-password or API-key gate later
 * is a one-line config change plus a check here — no route, service, or editor
 * change required.
 */
import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import type { Actor } from "../services/templates.js";

export type AuthContext = {
  actor: Actor;
};

const ANONYMOUS: Actor = { subject: "anonymous" };

/**
 * Resolve the actor for a request.
 *
 * Phase 1 (`authMode === "none"`): always anonymous, always allowed.
 * Later (`authMode === "apikey"`): require `x-api-key` matching the configured key.
 */
export function authenticate(request: FastifyRequest, config: Config): AuthContext {
  if (config.authMode === "none") {
    return { actor: { ...ANONYMOUS } };
  }

  const provided = request.headers["x-api-key"];
  const expected = config.apiKey;

  if (typeof provided === "string" && expected !== undefined && constantTimeEquals(provided, expected)) {
    return { actor: { subject: "api-key" } };
  }

  return { actor: { subject: "anonymous" } };
}

/**
 * Gate for routes that must not be reachable without credentials.
 * Returns true when the request may proceed.
 */
export function isAuthorized(request: FastifyRequest, config: Config): boolean {
  if (config.authMode === "none") {
    return true;
  }

  const provided = request.headers["x-api-key"];
  const expected = config.apiKey;

  if (typeof provided !== "string" || expected === undefined) {
    return false;
  }

  return constantTimeEquals(provided, expected);
}

/** Reply with 401 when the request is not authorized. */
export function rejectUnauthorized(reply: FastifyReply): void {
  reply.code(401).send({ error: "unauthorized" });
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  if (bufA.length !== bufB.length) {
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}
