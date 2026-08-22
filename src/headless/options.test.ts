import { describe, expect, test } from "vitest";
import { OUTPUT_FORMATS, resolveInvocation, type RawInvocation } from "./options.js";

function raw(overrides: Partial<RawInvocation> = {}): RawInvocation {
  return {
    positional: [],
    resumePicker: false,
    ...overrides,
  };
}

describe("resolveInvocation", () => {
  test("no --print, nothing else -> tui", () => {
    expect(resolveInvocation(raw())).toEqual({ mode: "tui" });
  });

  test("no --print, but --output-format given -> error naming the dependency", () => {
    const result = resolveInvocation(raw({ outputFormat: "json" }));
    expect(result.mode).toBe("error");
    expect((result as { message: string }).message).toMatch(/--output-format/);
    expect((result as { message: string }).message).toMatch(/--print/);
  });

  test("--print with only a positional prompt -> default format text", () => {
    const result = resolveInvocation(raw({ print: true, positional: ["explain", "this"] }));
    expect(result).toEqual({ mode: "print", prompt: "explain this", format: "text" });
  });

  test("--print with only stdin, clean string", () => {
    const result = resolveInvocation(raw({ print: true, stdin: "hello there" }));
    expect(result).toEqual({ mode: "print", prompt: "hello there", format: "text" });
  });

  test("--print with only stdin, whitespace trimmed", () => {
    const result = resolveInvocation(raw({ print: true, stdin: "  hello there  \n" }));
    expect(result).toEqual({ mode: "print", prompt: "hello there", format: "text" });
  });

  test("--print with both stdin and a positional combines them", () => {
    const result = resolveInvocation(
      raw({ print: true, stdin: "  some context  ", positional: ["do", "the", "thing"] }),
    );
    expect(result).toEqual({
      mode: "print",
      prompt: "some context\n\ndo the thing",
      format: "text",
    });
  });

  test("--print with neither stdin nor positional -> error", () => {
    const result = resolveInvocation(raw({ print: true }));
    expect(result.mode).toBe("error");
    expect((result as { message: string }).message).toMatch(/prompt/i);
  });

  test("--print --output-format json resolves correctly", () => {
    const result = resolveInvocation(
      raw({ print: true, outputFormat: "json", positional: ["hi"] }),
    );
    expect(result).toEqual({ mode: "print", prompt: "hi", format: "json" });
  });

  test("--print --output-format stream-json resolves correctly", () => {
    const result = resolveInvocation(
      raw({ print: true, outputFormat: "stream-json", positional: ["hi"] }),
    );
    expect(result).toEqual({ mode: "print", prompt: "hi", format: "stream-json" });
  });

  test("--print --output-format bogus -> error naming the valid set", () => {
    const result = resolveInvocation(
      raw({ print: true, outputFormat: "bogus", positional: ["hi"] }),
    );
    expect(result.mode).toBe("error");
    for (const format of OUTPUT_FORMATS) {
      expect((result as { message: string }).message).toMatch(new RegExp(format));
    }
  });

  test("--print --resume (picker) -> error", () => {
    const result = resolveInvocation(raw({ print: true, resumePicker: true, positional: ["hi"] }));
    expect(result.mode).toBe("error");
    expect((result as { message: string }).message).toMatch(/--resume/);
  });

  test("--print --resume <id> (resumePicker false) is not an error from this function", () => {
    const result = resolveInvocation(
      raw({ print: true, resumePicker: false, positional: ["some", "prompt"] }),
    );
    expect(result.mode).toBe("print");
  });

  describe("legacy -p <provider> misuse guard", () => {
    test("fires for lone 'anthropic' with no stdin", () => {
      const result = resolveInvocation(raw({ print: true, positional: ["anthropic"] }));
      expect(result.mode).toBe("error");
      expect((result as { message: string }).message).toMatch(/--provider/);
    });

    test("fires for lone 'openai' with no stdin", () => {
      const result = resolveInvocation(raw({ print: true, positional: ["openai"] }));
      expect(result.mode).toBe("error");
    });

    test("fires for lone 'ollama' with no stdin", () => {
      const result = resolveInvocation(raw({ print: true, positional: ["ollama"] }));
      expect(result.mode).toBe("error");
    });

    test("does not fire when 2+ positionals given", () => {
      const result = resolveInvocation(
        raw({ print: true, positional: ["anthropic", "explain quantum computing"] }),
      );
      expect(result.mode).toBe("print");
    });

    test("does not fire when stdin is present", () => {
      const result = resolveInvocation(
        raw({ print: true, positional: ["ollama"], stdin: "some piped context" }),
      );
      expect(result.mode).toBe("print");
    });

    test("does not fire for an unrelated single positional", () => {
      const result = resolveInvocation(raw({ print: true, positional: ["hello"] }));
      expect(result).toEqual({ mode: "print", prompt: "hello", format: "text" });
    });

    test("fires when stdin is an empty string (piped but empty, e.g. `< /dev/null`)", () => {
      const result = resolveInvocation(
        raw({ print: true, positional: ["ollama"], stdin: "" }),
      );
      expect(result.mode).toBe("error");
      expect((result as { message: string }).message).toMatch(/--provider/);
    });

    test("fires when stdin is whitespace-only", () => {
      const result = resolveInvocation(
        raw({ print: true, positional: ["ollama"], stdin: "   \n" }),
      );
      expect(result.mode).toBe("error");
    });

    test("does not fire when stdin has real (even short) content", () => {
      const result = resolveInvocation(
        raw({ print: true, positional: ["ollama"], stdin: "some real context" }),
      );
      expect(result.mode).toBe("print");
    });
  });
});

describe("--permission-mode", () => {
  test("no --print, but --permission-mode given -> error naming the dependency", () => {
    const result = resolveInvocation(raw({ permissionMode: "auto-bypass" }));
    expect(result.mode).toBe("error");
    expect((result as { message: string }).message).toMatch(/--permission-mode/);
    expect((result as { message: string }).message).toMatch(/--print/);
  });

  test("--print --permission-mode is carried through onto the print invocation", () => {
    const result = resolveInvocation(
      raw({ print: true, positional: ["hi"], permissionMode: "auto-bypass" }),
    );
    expect(result).toEqual({
      mode: "print",
      prompt: "hi",
      format: "text",
      permissionMode: "auto-bypass",
    });
  });

  test("--print without --permission-mode does not add the field", () => {
    const result = resolveInvocation(raw({ print: true, positional: ["hi"] }));
    expect(result).toEqual({ mode: "print", prompt: "hi", format: "text" });
  });
});
