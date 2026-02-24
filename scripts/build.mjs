import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "out/extension.js",
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  sourcemap: true,
  logLevel: "info"
});

if (watch) {
  await ctx.watch();
  console.log("Watching extension build...");
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
