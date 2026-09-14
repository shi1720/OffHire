"use client";
import { useState } from "react";
import type { FirebaseOptions } from "firebase/app";

export function OperatorSignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signIn() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/config");
      const config = (await response.json()) as {
        provider: string;
        configured: boolean;
        firebase: FirebaseOptions;
      };
      if (config.provider === "sites") {
        window.location.assign(
          "/signin-with-chatgpt?return_to=/%3Fmode%3Dlive",
        );
        return;
      }
      if (!response.ok || !config.configured)
        throw new Error(
          "Google sign-in has not been configured on this deployment.",
        );
      const [
        { initializeApp, getApps },
        {
          getAuth,
          GoogleAuthProvider,
          signInWithPopup,
          setPersistence,
          inMemoryPersistence,
          signOut,
        },
      ] = await Promise.all([import("firebase/app"), import("firebase/auth")]);
      const app = getApps()[0] || initializeApp(config.firebase);
      const auth = getAuth(app);
      await setPersistence(auth, inMemoryPersistence);
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const result = await signInWithPopup(auth, provider);
      try {
        const saved = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken: await result.user.getIdToken() }),
        });
        const body = (await saved.json()) as { error?: string };
        if (!saved.ok)
          throw new Error(body.error || "Sign-in could not be completed.");
      } finally {
        await signOut(auth);
      }
      window.location.assign("/?mode=live");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Sign-in could not be completed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button className="button primary" disabled={busy} onClick={signIn}>
        {busy ? "Signing in…" : "Sign in as operator"}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
