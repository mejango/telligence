export function fault(code, message = code, permanent = false) {
  return Object.assign(new Error(message), { code, permanent });
}

// RPC errors can contain URLs, payloads and credentials. Persist only our codes.
export function safeErrorCode(error) {
  return typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
    ? error.code : 'DEPENDENCY_UNAVAILABLE';
}
