import { getApps, initializeApp } from "firebase-admin/app";

/** Cloud Run uses its attached service account. Never ship a JSON key. */
export function firebaseAdminApp() {
  return (
    getApps()[0] ||
    initializeApp({
      projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT,
    })
  );
}
