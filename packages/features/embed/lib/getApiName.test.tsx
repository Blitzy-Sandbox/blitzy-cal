import { describe, expect, it } from "vitest";
import { getApiNameForShareFlow, getApiNameWithNamespace } from "./getApiName";

describe("getApiNameWithNamespace", () => {
  describe("when namespace is a valid variable", () => {
    it("should return the correct API name with namespace for a non-hyphenated namespace", () => {
      const result = getApiNameWithNamespace({ namespace: "first", mainApiName: "cal" });
      expect(result).toBe("cal.ns.first");
    });
    it("should return the correct API name with namespace for a$b", () => {
      const result = getApiNameWithNamespace({ namespace: "a$b", mainApiName: "cal" });
      expect(result).toBe("cal.ns.a$b");
    });
  });

  describe("when namespace is not a valid variable", () => {
    it("should return the correct API name with namespace for a hyphenated namespace", () => {
      const result = getApiNameWithNamespace({ namespace: "first-one", mainApiName: "cal" });
      expect(result).toBe('cal.ns["first-one"]');
    });

    it("should return the correct API name with namespace for a&n", () => {
      const result = getApiNameWithNamespace({ namespace: "a&n", mainApiName: "cal" });
      expect(result).toBe('cal.ns["a&n"]');
    });
  });

  describe("share flow namespace patterns", () => {
    it("should use bracket notation for routing form slug with hyphens", () => {
      const result = getApiNameWithNamespace({ namespace: "routing-form-123", mainApiName: "Cal" });
      expect(result).toBe('Cal.ns["routing-form-123"]');
    });

    it("should use dot notation for a valid share flow namespace identifier", () => {
      const result = getApiNameWithNamespace({ namespace: "share", mainApiName: "Cal" });
      expect(result).toBe("Cal.ns.share");
    });

    it("should use bracket notation for an empty string namespace", () => {
      const result = getApiNameWithNamespace({ namespace: "", mainApiName: "Cal" });
      expect(result).toBe('Cal.ns[""]');
    });
  });
});

describe("getApiNameForShareFlow", () => {
  describe("when embedFramework is react", () => {
    it("should return the mainApiName directly without namespace qualification", () => {
      const result = getApiNameForShareFlow({
        namespace: "my-namespace",
        mainApiName: "Cal",
        embedFramework: "react",
      });
      expect(result).toBe("Cal");
    });

    it("should ignore namespace for React embed framework", () => {
      const result = getApiNameForShareFlow({
        namespace: "share",
        mainApiName: "Cal",
        embedFramework: "react",
      });
      expect(result).toBe("Cal");
    });
  });

  describe("when embedFramework is vanilla", () => {
    it("should return namespace-qualified API name with dot notation for valid identifiers", () => {
      const result = getApiNameForShareFlow({
        namespace: "share",
        mainApiName: "Cal",
        embedFramework: "vanilla",
      });
      expect(result).toBe("Cal.ns.share");
    });

    it("should return namespace-qualified API name with bracket notation for hyphenated slugs", () => {
      const result = getApiNameForShareFlow({
        namespace: "routing-form-123",
        mainApiName: "Cal",
        embedFramework: "vanilla",
      });
      expect(result).toBe('Cal.ns["routing-form-123"]');
    });

    it("should handle empty namespace with bracket notation for vanilla framework", () => {
      const result = getApiNameForShareFlow({
        namespace: "",
        mainApiName: "Cal",
        embedFramework: "vanilla",
      });
      expect(result).toBe('Cal.ns[""]');
    });
  });
});
