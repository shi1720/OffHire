import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["firebase-admin", "@google-cloud/firestore"],
  webpack(config, { webpack }) {
    config.resolve.alias["cloudflare:workers"] = path.resolve(
      process.cwd(),
      "lib/server/firebase-runtime.ts",
    );
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /^cloudflare:workers$/,
        (resource: { request: string }) => {
          resource.request = path.resolve(
            process.cwd(),
            "lib/server/firebase-runtime.ts",
          );
        },
      ),
    );
    return config;
  },
};

export default nextConfig;
