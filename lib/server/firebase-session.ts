import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { firebaseAdminApp } from "./firebase-admin";

export class AuthError extends Error {
  constructor(
    message: string,
    public status = 403,
  ) {
    super(message);
  }
}
export function sessionCookie(request: Request) {
  return (
    request.headers
      .get("cookie")
      ?.match(/(?:^|;\s*)__session=([^;]+)(?:;|$)/)?.[1] || ""
  );
}
export function allowedOperator(claims: DecodedIdToken) {
  return (
    claims.email_verified === true &&
    claims.firebase?.sign_in_provider === "google.com" &&
    !!claims.email &&
    (process.env.OFFHIRE_OWNER_EMAILS || "")
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean)
      .includes(claims.email.toLowerCase())
  );
}
export async function firebaseIdentity(request: Request) {
  const cookie = sessionCookie(request);
  if (!cookie || cookie.startsWith("demo.") || cookie.length > 8192)
    return null;
  try {
    return await getAuth(firebaseAdminApp()).verifySessionCookie(cookie, true);
  } catch {
    return null;
  }
}
export function requireFirebaseOrigin(request: Request) {
  const expected = process.env.OFFHIRE_PUBLIC_ORIGIN;
  if (!expected)
    throw new AuthError("The server public origin is not configured.", 503);
  if (
    request.headers.get("origin") !== new URL(expected).origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new AuthError("Cross-origin changes are not allowed.");
}
export function firebaseCookie(value: string, maxAge: number) {
  const secure =
    process.env.NODE_ENV === "production" ||
    process.env.OFFHIRE_PUBLIC_ORIGIN?.startsWith("https://");
  return `__session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
export async function createOperatorSession(
  request: Request,
  idToken: unknown,
) {
  requireFirebaseOrigin(request);
  if (typeof idToken !== "string" || idToken.length > 8192)
    throw new AuthError("A valid sign-in token is required.", 400);
  const auth = getAuth(firebaseAdminApp());
  let claims: DecodedIdToken;
  try {
    claims = await auth.verifyIdToken(idToken, true);
  } catch {
    throw new AuthError("Sign-in could not be verified. Please sign in again.");
  }
  if (!allowedOperator(claims))
    throw new AuthError(
      "This account is not an authorized live-workspace operator.",
    );
  const age = Date.now() / 1000 - claims.auth_time;
  if (!Number.isFinite(age) || age < -60 || age > 300)
    throw new AuthError(
      "Please sign in again to create a fresh operator session.",
    );
  return auth.createSessionCookie(idToken, { expiresIn: 24 * 60 * 60 * 1000 });
}
