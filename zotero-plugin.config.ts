import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";

/**
 * Development builds are labelled separately from released ones so a locally
 * installed test build is never mistaken for a published version in Zotero's
 * plugin list. Triggered by `npm start` (serve) and `npm run build:dev`;
 * `npm run build` always produces a release artifact.
 */
const isDevBuild =
  process.env.AIDEA_BUILD_CHANNEL === "dev" ||
  process.env.npm_lifecycle_event === "build:dev" ||
  process.env.NODE_ENV === "development";

function devBuildStamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
  ].join("");
}

const addonName = isDevBuild
  ? `${pkg.config.addonName} (Dev)`
  : pkg.config.addonName;
// A `-` in the version also makes the scaffold point at update-beta.json.
const version = isDevBuild
  ? `${pkg.version}-dev.${devBuildStamp()}`
  : pkg.version;

export default defineConfig({
  source: ["src", "addon"],
  dist: ".scaffold/build",
  name: addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  xpiName: `${pkg.config.addonName}-${version}`,
  updateURL: `https://github.com/{{owner}}/{{repo}}/releases/download/release/${
    version.includes("-") ? "update-beta.json" : "update.json"
  }`,
  xpiDownloadLink:
    "https://github.com/{{owner}}/{{repo}}/releases/download/v{{version}}/{{xpiName}}.xpi",

  build: {
    assets: ["addon/**/*.*"],
    define: {
      ...pkg.config,
      addonName,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      buildVersion: version,
      buildTime: "{{buildTime}}",
    },
    fluent: {
      prefixFluentMessages: false,
    },
    prefs: {
      prefix: pkg.config.prefsPrefix,
    },
    esbuildOptions: [
      {
        entryPoints: ["src/index.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
        },
        bundle: true,
        target: "firefox115",
        outfile: `.scaffold/build/addon/content/scripts/${pkg.config.addonRef}.js`,
      },
    ],
  },

  test: {
    waitForPlugin: `() => Zotero.${pkg.config.addonInstance}.data.initialized`,
  },

  // If you need to see a more detailed log, uncomment the following line:
  // logLevel: "trace",
});
