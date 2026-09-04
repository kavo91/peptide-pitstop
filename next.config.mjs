/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone", // small standalone Docker image
  reactStrictMode: true,
  // ESLint is a standalone step (`npm run lint`), not a build gate. Now that an
  // eslint config exists, `next build` would otherwise run lint and fail on the
  // pre-existing warning/error surface (e.g. react/no-unescaped-entities). Keep
  // lint runnable but decoupled from the build.
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    // pdfkit loads its bundled .afm font metrics from disk at runtime via fs. Keep
    // it external (un-bundled) so those data files resolve from node_modules in the
    // standalone build — and so the Alpine image needs NO system fonts.
    // web-push pulls node built-ins (https via https-proxy-agent) that break the
    // EDGE compile of instrumentation.ts even behind a dynamic import — external
    // keeps webpack from resolving it; the nodejs runtime requires it from
    // node_modules (traced into the standalone output).
    // (Next 14 still uses the experimental key; renamed to top-level
    // `serverExternalPackages` in Next 15.)
    // pdfjs-dist (legacy build) must also stay external: in Node it runs its parser
    // in-process by dynamically importing "./pdf.worker.mjs" relative to its own
    // module URL, which only resolves when Node loads the package natively from
    // node_modules (webpack would inline pdf.mjs and lose that sibling path).
    serverComponentsExternalPackages: ["pdfkit", "web-push", "pdfjs-dist"],
    serverActions: {
      allowedOrigins: ["peptides.example.com", "peptides-dev.example.com"],
      // Report uploads (`uploadDexaReport`) send a PDF through a server action; the
      // default 1 MB cap would reject most scanner reports. The action itself refuses
      // anything over 10 MB with a readable message; this only needs to be above that.
      bodySizeLimit: "11mb",
    },
    instrumentationHook: true,
  },
};

export default nextConfig;
