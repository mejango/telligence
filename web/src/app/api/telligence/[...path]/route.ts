import { gatewayMethodNotAllowed, proxyGateway } from "@/lib/telligence/gatewayProxy.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path: string[] }> };
async function handle(request: Request, { params }: Context) {
  return proxyGateway(request, (await params).path);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;

// Explicit handlers prevent Next from synthesizing HEAD or OPTIONS behavior.
export function HEAD(_request: Request) {
  return gatewayMethodNotAllowed();
}
export function OPTIONS(_request: Request) {
  return gatewayMethodNotAllowed();
}
export function PUT(_request: Request) {
  return gatewayMethodNotAllowed();
}
export function PATCH(_request: Request) {
  return gatewayMethodNotAllowed();
}
