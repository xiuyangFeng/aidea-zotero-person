import { assert } from "chai";

type OAuthCliModule = typeof import("../src/utils/oauthCli");
type PrefHelpersModule =
  typeof import("../src/modules/contextPanel/prefHelpers");
type StateModule = typeof import("../src/modules/contextPanel/state");

const PREF_PREFIX = "extensions.zotero.aidea";

let oauthCli: OAuthCliModule;
let prefHelpers: PrefHelpersModule;
let stateModule: StateModule;
let prefStore: Map<string, unknown>;

function setPref(key: string, value: unknown): void {
  prefStore.set(`${PREF_PREFIX}.${key}`, value);
}

function getPref(key: string): unknown {
  return prefStore.get(`${PREF_PREFIX}.${key}`);
}

/** A model catalogue holding one dead OAuth provider and one live custom API. */
function seedCatalogueAfterOAuthRemoval(): void {
  setPref(
    "oauthModelListCache",
    JSON.stringify({
      "openai-codex": [],
      "my-gateway-v1": [
        { id: "gpt-5.6-sol", apiBase: "https://gw.example/v1", apiKey: "sk-1" },
        { id: "grok-4.6", apiBase: "https://gw.example/v1", apiKey: "sk-1" },
      ],
    }),
  );
}

describe("OAuth provider removal cleanup", function () {
  before(async function () {
    prefStore = new Map<string, unknown>();
    (globalThis as any).Zotero = {
      Prefs: {
        get(key: string) {
          return prefStore.get(key);
        },
        set(key: string, value: unknown) {
          prefStore.set(key, value);
        },
      },
      locale: "en-US",
    };
    (globalThis as any).ztoolkit = {
      getGlobal: () => undefined,
      log: () => undefined,
    };

    oauthCli = await import("../src/utils/oauthCli");
    prefHelpers = await import("../src/modules/contextPanel/prefHelpers");
    stateModule = await import("../src/modules/contextPanel/state");
  });

  beforeEach(function () {
    prefStore.clear();
    stateModule.selectedModelCache.clear();
    stateModule.selectedModelProviderCache.clear();
  });

  describe("clearOAuthProviderReferences", function () {
    it("drops the provider from both model caches", function () {
      setPref(
        "oauthModelListCache",
        JSON.stringify({
          "openai-codex": [{ id: "gpt-5.1-codex" }],
          "my-gateway-v1": [{ id: "grok-4.6", apiBase: "https://gw/v1" }],
        }),
      );
      setPref(
        "oauthModelSelectionCache",
        JSON.stringify({
          "openai-codex": ["gpt-5.1-codex"],
          "my-gateway-v1": ["grok-4.6"],
        }),
      );

      oauthCli.clearOAuthProviderReferences("openai-codex");

      assert.deepEqual(JSON.parse(String(getPref("oauthModelListCache"))), {
        "my-gateway-v1": [{ id: "grok-4.6", apiBase: "https://gw/v1" }],
      });
      assert.deepEqual(
        JSON.parse(String(getPref("oauthModelSelectionCache"))),
        { "my-gateway-v1": ["grok-4.6"] },
      );
    });

    it("re-points a remembered model that another provider still serves", function () {
      setPref(
        "oauthModelListCache",
        JSON.stringify({
          "openai-codex": [{ id: "gpt-5.6-sol" }],
          "my-gateway-v1": [
            { id: "gpt-5.6-sol", apiBase: "https://gw/v1", apiKey: "sk-1" },
          ],
        }),
      );
      setPref("lastUsedModelProvider", "openai-codex");
      setPref("lastUsedModelName", "gpt-5.6-sol");

      oauthCli.clearOAuthProviderReferences("openai-codex");

      assert.equal(getPref("lastUsedModelProvider"), "my-gateway-v1");
      assert.equal(getPref("lastUsedModelName"), "gpt-5.6-sol");
    });

    it("forgets a remembered model no other provider serves", function () {
      setPref(
        "oauthModelListCache",
        JSON.stringify({ "openai-codex": [{ id: "gpt-5.1-codex" }] }),
      );
      setPref("selectionTranslate.provider", "openai-codex");
      setPref("selectionTranslate.model", "gpt-5.1-codex");

      oauthCli.clearOAuthProviderReferences("openai-codex");

      assert.equal(getPref("selectionTranslate.provider"), "");
      assert.equal(getPref("selectionTranslate.model"), "");
    });

    it("clears profile slots still holding the provider marker", function () {
      setPref("apiBasePrimary", "oauth://openai-codex");
      setPref("apiKeyPrimary", "");
      setPref("modelPrimary", "gpt-5.1-codex");
      setPref("apiBaseSecondary", "https://gw.example/v1");
      setPref("apiKeySecondary", "sk-1");
      setPref("modelSecondary", "grok-4.6");

      oauthCli.clearOAuthProviderReferences("openai-codex");

      assert.equal(getPref("apiBasePrimary"), "");
      assert.equal(getPref("modelPrimary"), "");
      assert.equal(getPref("apiBaseSecondary"), "https://gw.example/v1");
      assert.equal(getPref("modelSecondary"), "grok-4.6");
    });

    it("leaves a custom endpoint provider untouched", function () {
      setPref(
        "oauthModelListCache",
        JSON.stringify({
          "my-gateway-v1": [{ id: "grok-4.6", apiBase: "https://gw/v1" }],
        }),
      );
      setPref("lastUsedModelProvider", "my-gateway-v1");
      setPref("lastUsedModelName", "grok-4.6");

      oauthCli.clearOAuthProviderReferences("openai-codex");

      assert.equal(getPref("lastUsedModelProvider"), "my-gateway-v1");
      assert.deepEqual(JSON.parse(String(getPref("oauthModelListCache"))), {
        "my-gateway-v1": [{ id: "grok-4.6", apiBase: "https://gw/v1" }],
      });
    });
  });

  describe("repairStaleModelProviderRefs", function () {
    it("re-points prefs left naming a removed OAuth provider", function () {
      seedCatalogueAfterOAuthRemoval();
      setPref("lastUsedModelProvider", "openai-codex");
      setPref("lastUsedModelName", "gpt-5.6-sol");
      setPref("selectionTranslate.provider", "openai-codex");
      setPref("selectionTranslate.model", "grok-4.6");

      oauthCli.repairStaleModelProviderRefs();

      assert.equal(getPref("lastUsedModelProvider"), "my-gateway-v1");
      assert.equal(getPref("selectionTranslate.provider"), "my-gateway-v1");
    });

    it("drops OAuth providers left in the catalogue with no models", function () {
      seedCatalogueAfterOAuthRemoval();

      oauthCli.repairStaleModelProviderRefs();

      const cache = JSON.parse(String(getPref("oauthModelListCache")));
      assert.notProperty(cache, "openai-codex");
      assert.property(cache, "my-gateway-v1");
    });

    it("clears a provider id no catalogue entry can justify", function () {
      seedCatalogueAfterOAuthRemoval();
      setPref("lastUsedModelProvider", "openai-codex");
      setPref("lastUsedModelName", "gpt-5.1-codex");

      oauthCli.repairStaleModelProviderRefs();

      assert.equal(getPref("lastUsedModelProvider"), "");
      // The name is kept: the user may still be typing it into custom mode.
      assert.equal(getPref("lastUsedModelName"), "gpt-5.1-codex");
    });

    it("leaves a provider that genuinely serves its model alone", function () {
      setPref(
        "oauthModelListCache",
        JSON.stringify({ "openai-codex": [{ id: "gpt-5.1-codex" }] }),
      );
      setPref("lastUsedModelProvider", "openai-codex");
      setPref("lastUsedModelName", "gpt-5.1-codex");

      oauthCli.repairStaleModelProviderRefs();

      assert.equal(getPref("lastUsedModelProvider"), "openai-codex");
    });

    it("never rewrites a custom endpoint label", function () {
      seedCatalogueAfterOAuthRemoval();
      setPref("lastUsedModelProvider", "some-other-gateway");
      setPref("lastUsedModelName", "gpt-5.6-sol");

      oauthCli.repairStaleModelProviderRefs();

      assert.equal(getPref("lastUsedModelProvider"), "some-other-gateway");
    });
  });

  describe("getSelectedProfileForItem after a provider disappears", function () {
    it("does not send a model the catalogue no longer lists", function () {
      seedCatalogueAfterOAuthRemoval();
      setPref("primaryConnectionMode", "oauth");
      setPref("apiBasePrimary", "https://gw.example/v1");
      setPref("apiKeyPrimary", "sk-1");
      setPref("modelPrimary", "gpt-5.6-sol");
      // Left over from the OAuth login that was just removed.
      stateModule.selectedModelCache.set(7, "gpt-5.1-codex");

      const profile = prefHelpers.getSelectedProfileForItem(7);

      assert.equal(profile.apiBase, "https://gw.example/v1");
      assert.equal(profile.model, "gpt-5.6-sol");
    });

    it("keeps a hand-picked model when no catalogue was ever fetched", function () {
      setPref("primaryConnectionMode", "custom");
      setPref("apiBase", "https://gw.example/v1");
      setPref("apiKey", "sk-1");
      setPref("model", "configured-model");
      stateModule.selectedModelCache.set(7, "picked-model");

      const profile = prefHelpers.getSelectedProfileForItem(7);

      assert.equal(profile.model, "picked-model");
    });

    it("keeps a model the catalogue still lists", function () {
      seedCatalogueAfterOAuthRemoval();
      setPref("primaryConnectionMode", "oauth");
      setPref("apiBasePrimary", "https://gw.example/v1");
      setPref("apiKeyPrimary", "sk-1");
      setPref("modelPrimary", "gpt-5.6-sol");
      stateModule.selectedModelCache.set(7, "grok-4.6");

      const profile = prefHelpers.getSelectedProfileForItem(7);

      assert.equal(profile.model, "grok-4.6");
    });
  });
});
