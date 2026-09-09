import { isSupportedPolicyVersion } from "../contracts.mjs";
import { randomBytes, randomUUID } from "node:crypto";
import { getAddress } from "viem";
import {
  challengeMessage,
  verifyCreatorSignature,
} from "../auth-signer/creator-auth.mjs";
import {
  ApiError,
  authorizeOrigin,
  digest,
  microToUsd,
  signKey,
  usdToMicro,
} from "./policy.mjs";
import { transaction } from "./store.mjs";
import { createSignerClient } from "../auth-signer/client.mjs";
import { syncProjectAuthentication } from "./authentication.mjs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function json(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}
function sessionCookie(req) {
  const cookies = (req.headers.cookie ?? "").split(";").map((v) => v.trim());
  return cookies
    .find((c) => c.startsWith("telligence_session="))
    ?.slice("telligence_session=".length);
}
function setSessionCookie(res, secret, secure, maxAge = 3600) {
  res.setHeader(
    "set-cookie",
    `telligence_session=${secret}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`,
  );
}
function textField(body, key, max, min = 1) {
  const value = body[key];
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    throw new ApiError(400, "invalid_input", `Invalid ${key}.`);
  return value.trim();
}
function address(value) {
  try {
    const result = getAddress(value);
    if (/^0x0{40}$/.test(result)) throw new Error();
    return result.toLowerCase();
  } catch {
    throw new ApiError(
      400,
      "invalid_address",
      "A valid nonzero Base address is required.",
    );
  }
}
function keyMetadata(row) {
  return {
    id: row.id,
    prefix: row.prefix,
    name: row.name,
    dailyLimitUsd: microToUsd(row.daily_limit_microusd),
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
  };
}
export async function readJson(req, maxBytes = 16384) {
  if (
    !/^application\/json(?:\s*;.*)?$/i.test(req.headers["content-type"] ?? "")
  )
    throw new ApiError(415, "content_type", "Use application/json.");
  if (
    req.headers["content-encoding"] &&
    req.headers["content-encoding"] !== "identity"
  )
    throw new ApiError(
      415,
      "content_encoding",
      "Compressed request bodies are not supported.",
    );
  const declared = Number(req.headers["content-length"] ?? 0);
  if (!Number.isFinite(declared) || declared > maxBytes)
    throw new ApiError(413, "body_too_large", "Request is too large.");
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes)
      throw new ApiError(413, "body_too_large", "Request is too large.");
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value;
  } catch {
    throw new ApiError(400, "invalid_json", "A JSON object is required.");
  }
}
export function createHandler({
  store,
  config,
  registry,
  signerCall,
  forwardInference,
}) {
  const callSigner =
    signerCall ??
    (async (path, body) => {
      const client = createSignerClient({
        url: config.signerUrl,
        secret: config.signerSecret,
      });
      try {
        if (path === "/v1/prepare-signer")
          return await client.prepareSigner(body);
        const matched = /^\/v1\/projects\/([^/]+)\/venice-signature$/.exec(
          path,
        );
        if (!matched) throw new Error("Invalid signer operation");
        return await client.getHeader(matched[1], body.resource);
      } catch {
        throw new ApiError(
          503,
          "signer_unavailable",
          "Project authentication is unavailable.",
        );
      }
    });
  return async (req, res) => {
    const requestId = randomUUID();
    res.setHeader("x-request-id", requestId);
    res.setHeader("x-content-type-options", "nosniff");
    try {
      const catalog =
        typeof config.getCatalog === "function"
          ? config.getCatalog()
          : config.catalog;
      const url = new URL(req.url, "http://gateway.internal");
      const path = url.pathname;
      const origin = req.headers.origin;
      if (url.search)
        throw new ApiError(
          400,
          "unsupported_query",
          "Query parameters are not supported.",
        );
      const allowed = authorizeOrigin(origin, config.allowedOrigins);
      if (origin && !allowed)
        throw new ApiError(
          403,
          "origin_forbidden",
          "This web origin is not permitted.",
        );
      if (allowed) {
        res.setHeader("access-control-allow-origin", origin);
        res.setHeader("access-control-allow-credentials", "true");
        res.setHeader("access-control-expose-headers", "X-Request-Id");
        res.setHeader("vary", "Origin");
      }
      if (req.method === "OPTIONS") {
        if (!allowed)
          throw new ApiError(
            403,
            "origin_forbidden",
            "This web origin is not permitted.",
          );
        res.writeHead(204, {
          "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
          "access-control-allow-headers":
            "Content-Type, X-CSRF-Token, Authorization, Idempotency-Key",
          "access-control-max-age": "600",
        });
        res.end();
        return;
      }
      if (path === "/healthz" && req.method === "GET")
        return json(res, 200, { status: "ok" });
      if (path === "/readyz" && req.method === "GET") {
        await store.pool.query("SELECT 1");
        return json(res, 200, { status: "ok" });
      }
      if (path === "/v1/config" && req.method === "GET")
        return json(res, 200, await registry.config(config.apiBaseUrl));
      const requestStatus = /^\/api\/v1\/requests\/([^/]+)$/.exec(path);
      if (requestStatus && req.method === "GET") {
        if (!UUID.test(requestStatus[1]))
          throw new ApiError(404, "not_found", "Request not found.");
        const secret = /^Bearer ([^\s]+)$/i.exec(
          req.headers.authorization ?? "",
        )?.[1];
        return json(
          res,
          200,
          await store.requestStatus(secret, requestStatus[1]),
        );
      }
      if (path === "/api/v1/models" && req.method === "GET") {
        await store.authenticate(
          (req.headers.authorization ?? "").replace(/^Bearer /, ""),
        );
        const fresh = catalog && Date.parse(catalog.validUntil) > Date.now();
        if (!fresh)
          throw new ApiError(
            503,
            "pricing_unavailable",
            "A current model catalog is required.",
          );
        return json(res, 200, {
          object: "list",
          data: Object.keys(catalog.models).map((id) => ({
            id,
            object: "model",
            owned_by: "venice",
          })),
        });
      }
      if (path === "/api/v1/chat/completions" && req.method === "POST") {
        if (!catalog || Date.parse(catalog.validUntil) <= Date.now())
          throw new ApiError(
            503,
            "pricing_unavailable",
            "A current model catalog is required.",
          );
        const body = await readJson(req, 131072);
        const transport =
          forwardInference ??
          (await import("./inference.mjs")).forwardInference;
        return await transport({
          request: req,
          response: res,
          body,
          store,
          prices: catalog,
          authHeader: async (projectId) => {
            const signed = await callSigner(
              `/v1/projects/${projectId}/venice-signature`,
              { resource: 0 },
            );
            const header =
              signed.header ?? signed.headerValue ?? signed.siwxHeader;
            if (typeof header !== "string")
              throw new ApiError(
                503,
                "signer_unavailable",
                "Project authentication is unavailable.",
              );
            return header;
          },
        });
      }
      if (path.startsWith("/v1/auth/") && req.method === "POST") {
        if (!allowed)
          throw new ApiError(
            403,
            "origin_forbidden",
            "A permitted web origin is required.",
          );
        await store.rateLimit(
          `auth-ip:${digest(req.socket.remoteAddress ?? "unknown", config.keyPepper)}`,
          120,
        );
      }
      if (path === "/v1/auth/challenge" && req.method === "POST") {
        const body = await readJson(req);
        const creator = address(body.address);
        await store.rateLimit(`challenge:${creator}`, 10);
        const now = Date.now();
        const challenge = {
          address: creator,
          domain: new URL(origin).host,
          origin,
          chainId: 8453,
          nonce: randomBytes(32).toString("hex"),
          issuedAt: new Date(now).toISOString(),
          expirationTime: new Date(now + 300000).toISOString(),
        };
        const id = randomUUID();
        const message = challengeMessage(challenge);
        await store.pool.query(
          "INSERT INTO auth_challenges(id,address,origin,message,challenge_data,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
          [id, creator, origin, message, challenge, challenge.expirationTime],
        );
        return json(res, 200, {
          challengeId: id,
          message,
          expiresAt: challenge.expirationTime,
        });
      }
      if (path === "/v1/auth/verify" && req.method === "POST") {
        const body = await readJson(req);
        if (!UUID.test(body.challengeId))
          throw new ApiError(401, "unauthorized", "Challenge is not valid.");
        const {
          rows: [challenge],
        } = await store.pool.query(
          "SELECT * FROM auth_challenges WHERE id=$1 AND origin=$2 AND consumed_at IS NULL AND expires_at>clock_timestamp()",
          [body.challengeId, origin],
        );
        if (
          !challenge ||
          !(await verifyCreatorSignature({
            challenge: challenge.challenge_data,
            signature: body.signature,
            expectedDomain: new URL(origin).host,
            expectedOrigin: origin,
            publicClient: registry.client,
          }))
        )
          throw new ApiError(
            401,
            "unauthorized",
            "Challenge signature is not valid.",
          );
        const session = await transaction(store.pool, async (c) => {
          const used = await c.query(
            "UPDATE auth_challenges SET consumed_at=clock_timestamp() WHERE id=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp() RETURNING id",
            [challenge.id],
          );
          if (!used.rowCount)
            throw new ApiError(
              401,
              "unauthorized",
              "Challenge has expired or already been used.",
            );
          return store.createSession(c, challenge.address, origin);
        });
        setSessionCookie(res, session.secret, config.secureCookies);
        return json(res, 200, {
          address: session.address,
          expiresAt: session.expiresAt,
          csrfToken: session.csrfToken,
        });
      }
      if (path === "/v1/auth/session" && req.method === "GET") {
        const secret = sessionCookie(req);
        const session = await store.session(secret, { origin });
        return json(res, 200, {
          address: session.address,
          expiresAt: session.expires_at.toISOString(),
          csrfToken: digest(`csrf:${secret}`, config.keyPepper),
        });
      }
      if (path === "/v1/auth/logout" && req.method === "POST") {
        const session = await store.session(sessionCookie(req), {
          origin,
          csrf: req.headers["x-csrf-token"] ?? "",
        });
        await store.pool.query(
          "UPDATE creator_sessions SET revoked_at=clock_timestamp() WHERE id=$1",
          [session.id],
        );
        setSessionCookie(res, "", config.secureCookies, 0);
        return json(res, 200, { signedOut: true });
      }
      if (path === "/v1/projects" && req.method === "GET")
        return json(res, 200, { projects: await store.projects() });
      if (/^\/v1\/projects\/[^/]+$/.test(path) && req.method === "GET") {
        const id = path.split("/")[3];
        if (!UUID.test(id))
          throw new ApiError(404, "not_found", "Project not found.");
        const [project] = await store.projects(id);
        if (!project)
          throw new ApiError(404, "not_found", "Project not found.");
        return json(res, 200, { project });
      }
      if (path === "/v1/projects/prepare" && req.method === "POST") {
        if (!allowed)
          throw new ApiError(
            403,
            "origin_forbidden",
            "A permitted web origin is required.",
          );
        const session = await store.session(sessionCookie(req), {
          origin,
          csrf: req.headers["x-csrf-token"] ?? "",
          recent: true,
        });
        await store.rateLimit(`prepare:${session.address}`, 5, 3600);
        await registry.assertDeployment();
        const preparationId = randomUUID();
        const result = await callSigner("/v1/prepare-signer", {
          creatorAddress: session.address,
          preparationId,
        });
        return json(res, 201, {
          preparationId,
          inferenceSigner: result.inferenceSigner,
          expiresAt: result.expiresAt,
        });
      }
      if (path === "/v1/projects" && req.method === "POST") {
        if (!allowed)
          throw new ApiError(
            403,
            "origin_forbidden",
            "A permitted web origin is required.",
          );
        const session = await store.session(sessionCookie(req), {
          origin,
          csrf: req.headers["x-csrf-token"] ?? "",
          recent: true,
        });
        const body = await readJson(req);
        if (
          typeof body.revnetId !== "string" ||
          !/^[1-9][0-9]{0,77}$/.test(body.revnetId) ||
          !UUID.test(body.preparationId)
        )
          throw new ApiError(
            400,
            "invalid_project",
            "Invalid confirmed project identity.",
          );
        const wrapperAddress = address(body.wrapperAddress),
          vaultAddress = address(body.vaultAddress);
        const name = textField(body, "name", 80),
          purpose = textField(body, "purpose", 4000),
          workload = textField(body, "workload", 1000, 0),
          target =
            body.targetDailyCreditUsd === undefined ||
            body.targetDailyCreditUsd === null
              ? null
              : usdToMicro(body.targetDailyCreditUsd);
        if (target !== null && target <= 0n)
          throw new ApiError(
            400,
            "invalid_amount",
            "Daily target must be positive.",
          );
        const {
          rows: [bound],
        } = await store.pool.query(
          "SELECT p.* FROM signer_preparations s JOIN projects p ON p.id=s.claimed_project_id WHERE s.id=$1 AND s.creator_address=$2",
          [body.preparationId, session.address],
        );
        if (bound) {
          if (
            bound.revnet_id !== body.revnetId ||
            bound.wrapper_address !== wrapperAddress ||
            bound.vault_address !== vaultAddress
          )
            throw new ApiError(
              409,
              "identity_conflict",
              "This preparation belongs to another confirmed project identity.",
            );
          const [project] = await store.projects(bound.id);
          return json(res, 200, { project });
        }
        const {
          rows: [preparation],
        } = await store.pool.query(
          "SELECT * FROM signer_preparations WHERE id=$1 AND creator_address=$2 AND claimed_project_id IS NULL",
          [body.preparationId, session.address],
        );
        if (!preparation)
          throw new ApiError(
            409,
            "invalid_preparation",
            "Signer preparation is missing or already bound to a project.",
          );
        const registrationProof = await registry.verifyProject({
          revnetId: body.revnetId,
          wrapperAddress,
          vaultAddress,
          creatorAddress: session.address,
          inferenceSigner: preparation.signer_address,
        });
        if (!isSupportedPolicyVersion(registrationProof.policyVersion))
          throw new ApiError(
            503,
            "deployment_unavailable",
            "A verified factory policy version is required.",
          );
        const id = randomUUID();
        await transaction(store.pool, async (c) => {
          await c.query(
            `INSERT INTO projects(id,revnet_id,wrapper_address,vault_address,creator_address,name,purpose,workload,target_daily_microusd,daily_limit_microusd,policy_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10)`,
            [
              id,
              body.revnetId,
              wrapperAddress,
              vaultAddress,
              session.address,
              name,
              purpose,
              workload,
              target?.toString() ?? null,
              registrationProof.policyVersion,
            ],
          );
          const claimed = await c.query(
            "UPDATE signer_preparations SET claimed_project_id=$2 WHERE id=$1 AND claimed_project_id IS NULL RETURNING id",
            [preparation.id, id],
          );
          if (!claimed.rowCount)
            throw new ApiError(
              409,
              "invalid_preparation",
              "Signer preparation is no longer available.",
            );
          await c.query(
            "INSERT INTO provider_bindings(project_id,signer_address,encrypted_signer,signer_generation) VALUES($1,$2,$3,$4)",
            [
              id,
              preparation.signer_address,
              preparation.encrypted_signer,
              registrationProof.signerGeneration,
            ],
          );
          await c.query(
            `INSERT INTO audit_events(project_id,actor_address,kind,object_id) VALUES($1::uuid,$2,'project.registered',$1::text)`,
            [id, session.address],
          );
        });
        const [project] = await store.projects(id);
        return json(res, 201, { project });
      }
      const authentication =
        /^\/v1\/projects\/([^/]+)\/(authentication\/sync|signer)$/.exec(path);
      if (authentication && req.method === "POST") {
        if (!UUID.test(authentication[1]))
          throw new ApiError(404, "not_found", "Project not found.");
        if (!allowed)
          throw new ApiError(
            403,
            "origin_forbidden",
            "A permitted web origin is required.",
          );
        const session = await store.session(sessionCookie(req), {
          origin,
          csrf: req.headers["x-csrf-token"] ?? "",
          recent: true,
        });
        const body = await readJson(req);
        const rotate = authentication[2] === "signer";
        if (
          (rotate &&
            (!UUID.test(body.preparationId) ||
              Object.keys(body).length !== 1)) ||
          (!rotate && Object.keys(body).length !== 0)
        )
          throw new ApiError(
            400,
            "invalid_input",
            "Use a signer preparation for rotation or an empty object for authentication sync.",
          );
        return json(
          res,
          200,
          await syncProjectAuthentication({
            store,
            registry,
            projectId: authentication[1],
            creatorAddress: session.address,
            preparationId: rotate ? body.preparationId : undefined,
          }),
        );
      }
      const keys = /^\/v1\/projects\/([^/]+)\/keys(?:\/([^/]+))?$/.exec(path);
      if (keys) {
        if (!UUID.test(keys[1]) || (keys[2] && !UUID.test(keys[2])))
          throw new ApiError(404, "not_found", "Key not found.");
        const mutation = req.method !== "GET";
        if (mutation && !allowed)
          throw new ApiError(
            403,
            "origin_forbidden",
            "A permitted web origin is required.",
          );
        const session = await store.session(sessionCookie(req), {
          origin,
          ...(mutation
            ? { csrf: req.headers["x-csrf-token"] ?? "", recent: true }
            : {}),
        });
        const project = await store.requireOwner(keys[1], session.address);
        if (req.method === "GET" && !keys[2]) {
          const { rows } = await store.pool.query(
            "SELECT * FROM api_keys WHERE project_id=$1 ORDER BY created_at DESC LIMIT 100",
            [project.id],
          );
          return json(res, 200, { keys: rows.map(keyMetadata) });
        }
        if (req.method === "POST" && !keys[2]) {
          const body = await readJson(req);
          const name = textField(body, "name", 80),
            limit = usdToMicro(body.dailyLimitUsd);
          if (
            limit <= 0n ||
            (project.daily_limit_microusd !== null &&
              limit > BigInt(project.daily_limit_microusd))
          )
            throw new ApiError(
              400,
              "invalid_limit",
              "Key limit must fit the project daily budget.",
            );
          let expiry = null;
          if (body.expiresAt !== undefined && body.expiresAt !== null) {
            expiry = new Date(body.expiresAt);
            if (
              !Number.isFinite(expiry.getTime()) ||
              expiry <= new Date() ||
              expiry.getTime() > Date.now() + 366 * 86400000
            )
              throw new ApiError(
                400,
                "invalid_expiry",
                "Key expiry must be within the next year.",
              );
          }
          const key = signKey(config.keyPepper);
          const row = await transaction(store.pool, async (c) => {
            await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [
              project.id,
            ]);
            const {
              rows: [count],
            } = await c.query(
              "SELECT count(*) AS n FROM api_keys WHERE project_id=$1 AND revoked_at IS NULL",
              [project.id],
            );
            if (Number(count.n) >= 100)
              throw new ApiError(
                409,
                "key_limit",
                "Revoke a key before creating another.",
              );
            const {
              rows: [created],
            } = await c.query(
              "INSERT INTO api_keys(id,project_id,prefix,secret_hash,name,daily_limit_microusd,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
              [
                key.id,
                project.id,
                key.prefix,
                key.hash,
                name,
                limit.toString(),
                expiry,
              ],
            );
            await c.query(
              `INSERT INTO audit_events(project_id,actor_address,kind,object_id) VALUES($1,$2,'key.created',$3)`,
              [project.id, session.address, key.id],
            );
            return created;
          });
          return json(res, 201, { key: keyMetadata(row), secret: key.secret });
        }
        if (req.method === "DELETE" && keys[2]) {
          await transaction(store.pool, async (c) => {
            await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [
              project.id,
            ]);
            const result = await c.query(
              "UPDATE api_keys SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE id=$1 AND project_id=$2 RETURNING id",
              [keys[2], project.id],
            );
            if (!result.rowCount)
              throw new ApiError(404, "not_found", "Key not found.");
            await c.query(
              `INSERT INTO audit_events(project_id,actor_address,kind,object_id) VALUES($1,$2,'key.revoked',$3)`,
              [project.id, session.address, keys[2]],
            );
          });
          return json(res, 200, { revoked: true });
        }
      }
      throw new ApiError(404, "not_found", "Route not found.");
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const known = error instanceof ApiError;
      const status = known ? error.status : error.code === "23505" ? 409 : 503;
      json(res, status, {
        error: {
          code: known
            ? error.code
            : error.code === "23505"
              ? "conflict"
              : "service_unavailable",
          message: known
            ? error.message
            : error.code === "23505"
              ? "This record is already registered."
              : "The service is temporarily unavailable.",
        },
      });
    }
  };
}
