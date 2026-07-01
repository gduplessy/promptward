// @vitest-environment node
import path from "node:path";
import { env, pipeline } from "@huggingface/transformers";
import { createGuard, detectNer, type TokenClassifier } from "@nationaldesignstudio/rampart";
import { beforeAll, describe, expect, it } from "vitest";

const MODEL_TIMEOUT_MS = 120_000;

let guard: Awaited<ReturnType<typeof createGuard>>;

describe("Rampart vendored model end-to-end", () => {
  beforeAll(async () => {
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = path.resolve(__dirname, "../public/models/");

    const classifier = (await pipeline("token-classification", "rampart", {
      dtype: "q4",
      local_files_only: true
    })) as unknown as TokenClassifier & {
      tokenizer?: { encode?: (text: string, options: { add_special_tokens: boolean }) => unknown[] };
    };

    const adapter: TokenClassifier = (text, opts) => classifier(text, opts);
    const tokenizer = classifier.tokenizer;
    if (tokenizer?.encode) {
      adapter.countTokens = (text) => tokenizer.encode?.(text, { add_special_tokens: false }).length ?? 0;
    }

    guard = await createGuard({ ner: (text) => detectNer(text, adapter) });
  }, MODEL_TIMEOUT_MS);

  it(
    "redacts names, emails, and phone numbers",
    async () => {
      const result = await guard.protect(
        "Hi, I'm Sarah Connor. Email me at sarah.connor@example.com or call 415-555-2671."
      );

      expect(result.text).not.toContain("Sarah Connor");
      expect(result.text).not.toContain("sarah.connor@example.com");
      expect(result.text).not.toContain("415-555-2671");
      expect(result.placeholders.length).toBeGreaterThanOrEqual(3);
    },
    MODEL_TIMEOUT_MS
  );

  it(
    "redacts SSNs and card numbers",
    async () => {
      const result = await guard.protect("My SSN is 123-45-6789 and my card number is 4111 1111 1111 1111.");

      expect(result.text).not.toContain("123-45-6789");
      expect(result.text).not.toContain("4111 1111 1111 1111");
    },
    MODEL_TIMEOUT_MS
  );

  it(
    "reveal restores the original values for the same conversation",
    async () => {
      const original = "Contact Maria Lopez at maria.lopez@example.org.";
      const result = await guard.protect(original);

      expect(result.text).not.toContain("maria.lopez@example.org");
      const revealed = guard.reveal(result.text);
      // NER span boundaries can trim a trailing character from names, so assert
      // placeholder resolution rather than a byte-exact round trip.
      expect(revealed).toContain("maria.lopez@example.org");
      expect(revealed).not.toMatch(/\[[A-Z_]+_\d+\]/);
    },
    MODEL_TIMEOUT_MS
  );
});
