import { assert } from "chai";
import {
  pickDirectory,
  pickPdfFile,
  resetFilePickerForTest,
  setFilePickerForTest,
} from "../../src/modules/pdfTranslator/nativePicker";

type PickerMode = "open" | "folder";
type PickerFilter = [string, string];
type PickerOptions = { startDir?: string };

type PickerCall = {
  win: Window;
  title: string;
  mode: PickerMode;
  filters?: PickerFilter[];
  options?: PickerOptions;
};

const calls: PickerCall[] = [];
let backendImpl: (
  ...args: PickerCallArgs
) => Promise<string | false> = async () => false;

type PickerCallArgs = [
  Window,
  string,
  PickerMode,
  PickerFilter[] | undefined,
  PickerOptions | undefined,
];

function makeBackend(): (
  win: Window,
  title: string,
  mode: PickerMode,
  filters?: PickerFilter[],
  options?: PickerOptions,
) => Promise<string | false> {
  return async (win, title, mode, filters, options) => {
    calls.push({ win, title, mode, filters, options });
    return backendImpl(win, title, mode, filters, options);
  };
}

describe("nativePicker", function () {
  beforeEach(function () {
    calls.length = 0;
    backendImpl = async () => false;
    setFilePickerForTest(makeBackend());
  });

  afterEach(function () {
    resetFilePickerForTest();
  });

  describe("pickPdfFile", function () {
    it("returns the selected PDF path", async function () {
      backendImpl = async () => "C:\\Users\\test\\paper.pdf";

      const result = await pickPdfFile({} as Window);

      assert.equal(result, "C:\\Users\\test\\paper.pdf");
      assert.lengthOf(calls, 1);
      assert.equal(calls[0].title, "Select PDF");
      assert.equal(calls[0].mode, "open");
      assert.deepEqual(calls[0].filters, [["PDF Files (*.pdf)", "*.pdf"]]);
    });

    it("passes the start directory option through", async function () {
      backendImpl = async () => "/tmp/paper.pdf";

      await pickPdfFile({} as Window, { startDir: "/Users/test/papers" });

      assert.equal(calls[0].options?.startDir, "/Users/test/papers");
    });

    it("returns null when the file picker is cancelled", async function () {
      const result = await pickPdfFile({} as Window);

      assert.isNull(result);
    });

    it("propagates picker errors instead of treating them as cancel", async function () {
      backendImpl = async () => {
        throw new Error("file picker failed");
      };

      let caught: unknown;
      try {
        await pickPdfFile({} as Window);
      } catch (err) {
        caught = err;
      }
      assert.match(String(caught), /file picker failed/);
    });
  });

  describe("pickDirectory", function () {
    it("returns the selected directory path", async function () {
      backendImpl = async () => "C:\\Users\\test\\output";

      const result = await pickDirectory({} as Window);

      assert.equal(result, "C:\\Users\\test\\output");
      assert.lengthOf(calls, 1);
      assert.equal(calls[0].title, "Select Save Directory");
      assert.equal(calls[0].mode, "folder");
      assert.isUndefined(calls[0].filters);
    });

    it("passes the start directory option through", async function () {
      backendImpl = async () => "/tmp/output";

      await pickDirectory({} as Window, { startDir: "/Users/test/output" });

      assert.equal(calls[0].options?.startDir, "/Users/test/output");
    });

    it("returns null when the directory picker is cancelled", async function () {
      const result = await pickDirectory({} as Window);

      assert.isNull(result);
    });

    it("propagates picker errors instead of treating them as cancel", async function () {
      backendImpl = async () => {
        throw new Error("directory picker failed");
      };

      let caught: unknown;
      try {
        await pickDirectory({} as Window);
      } catch (err) {
        caught = err;
      }
      assert.match(String(caught), /directory picker failed/);
    });
  });
});
