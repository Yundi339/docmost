// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { downloadCodeBlock, getCodeBlockFilename } from "./code-block-download";

describe("code block download", () => {
  it("sanitizes paths, reserved names, and language extensions", () => {
    expect(getCodeBlockFilename("../../server", "typescript")).toBe(
      "-server.ts",
    );
    expect(getCodeBlockFilename("CON", "python")).toBe("_CON.py");
    expect(getCodeBlockFilename("query.sql", "javascript")).toBe("query.sql");
    expect(getCodeBlockFilename("", "unknown")).toBe("code-block.txt");
    expect(getCodeBlockFilename("a".repeat(200), "typescript")).toHaveLength(
      120,
    );
  });

  it("releases the object URL after triggering a download", () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:test");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    downloadCodeBlock("const value = 1;", "example", "javascript");

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
    expect(document.querySelector('a[href="blob:test"]')).toBeNull();
  });
});
