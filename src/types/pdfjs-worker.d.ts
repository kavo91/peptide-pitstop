// pdfjs-dist ships types for `legacy/build/pdf.mjs` (pdf.d.mts beside it) but
// none for the worker bundle. `src/lib/pdf-text.ts` imports the worker module
// statically so Next's file tracing copies it into the standalone output (pdf.js
// would otherwise `import("./pdf.worker.mjs")` at runtime — a path nft cannot
// see — and the Docker image would ship without it).
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: { setup(handler: unknown, port: unknown): void };
}
