import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These packages use dynamic require() or have CJS/ESM split issues
  // that break Next.js bundling. Marking them external tells Next to
  // import them at Node.js runtime instead of bundling them.
  serverExternalPackages: [
    "pdf-parse",
  ],
};

export default nextConfig;
