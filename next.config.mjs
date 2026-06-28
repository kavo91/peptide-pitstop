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
    // (Next 14 still uses the experimental key; renamed to top-level
    // `serverExternalPackages` in Next 15.)
    serverComponentsExternalPackages: ["pdfkit"],
    serverActions: { allowedOrigins: ["peptides.example.com", "peptides.example.com", "peptides-dev.example.com"] },
    instrumentationHook: true,
  },
};

export default nextConfig;
