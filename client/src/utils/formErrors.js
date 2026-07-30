/**
 * formErrors — turn a normalized API error into a form-friendly shape.
 *
 * `services/api.js` already converts every failed response into an Error
 * with these fields attached:
 *   {
 *     message: string,           // top-level message from the server
 *     status:  number,           // HTTP status code (0 = network)
 *     details: {                 // server-provided details (optional)
 *       field?: 'email' | 'phone' | ...       // 409 conflict hint
 *       issues?: [{ path, message }, ...]     // 400 zod issues
 *     },
 *     raw: <original axios error>,
 *   }
 *
 * Pages call `extractFormError(error)` after `try { await login(...) } catch
 * (err) { ... }`. The returned object has:
 *   - `topMessage`    : a string suitable for an inline banner above the form
 *   - `fieldErrors`   : { [fieldName]: message } — for highlighting inputs
 *   - `status`        : passthrough HTTP status
 *
 * The function is pure and side-effect free. Unit-testable in isolation.
 *
 * Module 1.3.
 */

const NETWORK_ERROR_MESSAGE =
  'Could not reach the server. Check your connection and try again.';

/**
 * @param {Error & { status?: number, details?: any }} err
 * @returns {{ topMessage: string, fieldErrors: Record<string,string>, status: number }}
 */
export function extractFormError(err) {
  const status = (err && err.status) || 0;
  const details = (err && err.details) || {};

  // Default banner message: prefer the server's top-level message, then
  // status-specific fallbacks. We never leak server stack traces to the UI.
  let topMessage =
    (err && err.message) || `Request failed with status ${status || '?'}`;

  // Network / timeout (status 0 means axios never got a response).
  if (!status) {
    topMessage = NETWORK_ERROR_MESSAGE;
  }

  // Special-case 401 on login — don't reveal whether the identifier exists.
  // (We let the caller distinguish login vs other 401s via the status code.)
  if (status === 401 && (!topMessage || /token|jwt|auth/i.test(topMessage))) {
    topMessage = 'Invalid credentials';
  }

  // 403 with isActive=false (login blocked). The server message is already
  // human-readable, so we leave it as-is.

  // Map server-side issues → field-level errors. The server's zod issues
  // look like { path: 'email', message: 'email is not a valid address' }.
  // We use `path` directly as the field name. Nested paths (e.g. 'foo.bar')
  // are flattened to just the last segment; form pages can extend if they
  // ever need nested keys.
  const fieldErrors = {};

  if (Array.isArray(details.issues)) {
    for (const issue of details.issues) {
      const key = lastSegment(issue.path);
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
  }

  // 409 conflict with explicit field hint.
  if (typeof details.field === 'string' && !fieldErrors[details.field]) {
    fieldErrors[details.field] = topMessage;
  }

  return { topMessage, fieldErrors, status };
}

/**
 * Last segment of a dotted/zod path. 'foo.bar[0].baz' → 'baz'.
 */
function lastSegment(path) {
  if (!path) return '';
  const parts = String(path).split('.');
  const last = parts[parts.length - 1] || '';
  // strip array index suffixes like '[0]'
  return last.replace(/\[\d+\]/g, '').trim();
}