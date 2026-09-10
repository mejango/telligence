import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Creates credentials for a disposable local environment. Never prints or overwrites secrets. */
export async function initializeLocalEnvironment(root) {
  const secret = () => randomBytes(32).toString("base64url");
  const contents = `# Generated for local development only. Never commit this file.
POSTGRES_PASSWORD=${secret()}
POSTGRES_PORT=5432
API_KEY_PEPPER=${secret()}
AUTH_SIGNER_GATEWAY_SECRET=${secret()}
AUTH_SIGNER_WORKER_SECRET=${secret()}
SIGNER_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}
ALLOWED_WEB_ORIGINS=http://localhost:3000,http://localhost:3002
PUBLIC_API_BASE_URL=http://localhost:8080/api/v1
BASE_RPC_URL=
# Supply a verified deployment manifest before enabling project writes.
TELLIGENCE_MANIFEST_FILE=
# Supply a reviewed, unexpired model catalog before enabling inference.
MODEL_PRICES_JSON=
MODEL_POLICY_JSON=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_BENDYSTRAW_URL=https://bendystraw.up.railway.app
NEXT_PUBLIC_TESTNET_BENDYSTRAW_URL=https://testnet.bendystraw.xyz
# Public application key. Replace with your Para application's development key.
NEXT_PUBLIC_PARA_API_KEY=local-unconfigured
NEXT_PUBLIC_PARA_ENV=DEV
NEXT_PUBLIC_PARA_ONRAMP_PROVIDER=CDP
NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID=
NEXT_PUBLIC_VERSION=development
NEXT_PUBLIC_TELLIGENCE_FACTORY_ADDRESS=
TELLIGENCE_GATEWAY_URL=http://gateway.railway.internal:8080
KEEPER_EXECUTION_ENABLED=false
KEEPER_PRIVATE_KEY=
KEEPER_MAX_GAS=3000000
KEEPER_MAX_FEE_PER_GAS_WEI=5000000000
`;
  await writeFile(path.join(root, ".env"), contents, { mode: 0o600, flag: "wx" });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await initializeLocalEnvironment(fileURLToPath(new URL("../", import.meta.url)));
    process.stdout.write("Created .env with independent local credentials. Deployment and inference remain unconfigured.\n");
  } catch (error) {
    process.stderr.write(error.code === "EEXIST" ? ".env already exists; existing credentials were preserved.\n" : "Could not create the local environment.\n");
    process.exitCode = 1;
  }
}
