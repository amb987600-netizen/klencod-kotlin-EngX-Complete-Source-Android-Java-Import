import { describe, expect, it } from "vitest";
import { chatDomainMatches } from "../src/chat";

describe("chat domain scoping", () => {
  it("treats missing legacy domains as medical", () => {
    expect(chatDomainMatches(undefined, "medical")).toBe(true);
    expect(chatDomainMatches(undefined, "mobiles")).toBe(false);
  });

  it("matches only the normalized active domain", () => {
    expect(chatDomainMatches("mobiles", "mobiles")).toBe(true);
    expect(chatDomainMatches("mobiles", "screens")).toBe(false);
    expect(chatDomainMatches("unknown", "medical")).toBe(true);
  });
});
