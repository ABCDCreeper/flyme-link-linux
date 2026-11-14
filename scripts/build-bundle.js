#!/usr/bin/env node
"use strict";

// Bundle the daemon into a single CommonJS file for AppImage / portable
// packages. Native-optional modules of ws are left external on purpose.
const path = require("path");
const esbuild = require("esbuild");

const root = path.join(__dirname, "..");

esbuild
  .build({
    entryPoints: [path.join(root, "bin", "flyme-link.js")],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "cjs",
    outfile: path.join(root, "dist", "flyme-link.cjs"),
    external: ["bufferutil", "utf-8-validate", "usocket", "x11"],
    logLevel: "info",
    sourcemap: false,
    minify: false,
    legalComments: "external",
  })
  .then(() => {
    console.log("bundle written to dist/flyme-link.cjs");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
