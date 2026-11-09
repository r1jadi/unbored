import { describe, expect, it } from "vitest";

import { resolveApiBaseUrl } from "./config";

describe("resolveApiBaseUrl", () => {
  it("defaults to the same-origin API path", () => {
    expect(resolveApiBaseUrl("", "unbored.lol")).toBe("/api/v1");
    expect(resolveApiBaseUrl("/", "unbored.lol")).toBe("/api/v1");
  });

  it("keeps a relative path, without a trailing slash", () => {
    expect(resolveApiBaseUrl("/api/v2/", "unbored.lol")).toBe("/api/v2");
  });

  it("upgrades a non-local http base to https", () => {
    expect(resolveApiBaseUrl("http://unbored.lol/api/v1", "unbored.lol")).toBe(
      "https://unbored.lol/api/v1",
    );
    // On the server there is no page host; the upgrade must not depend on one.
    expect(resolveApiBaseUrl("http://unbored.lol/api/v1/", "")).toBe("https://unbored.lol/api/v1");
  });

  it("leaves https and local http bases alone", () => {
    expect(resolveApiBaseUrl("https://api.example.com/api/v1", "unbored.lol")).toBe(
      "https://api.example.com/api/v1",
    );
    expect(resolveApiBaseUrl("http://localhost:8080/api/v1", "localhost")).toBe(
      "http://localhost:8080/api/v1",
    );
    expect(resolveApiBaseUrl("http://[::1]:8080/api/v1", "localhost")).toBe(
      "http://[::1]:8080/api/v1",
    );
  });

  it("ignores a localhost base on a page that is not local", () => {
    expect(resolveApiBaseUrl("http://localhost:8080/api/v1", "unbored.lol")).toBe("/api/v1");
  });

  it("falls back for a value that is not an http(s) URL", () => {
    expect(resolveApiBaseUrl("ftp://unbored.lol/api", "unbored.lol")).toBe("/api/v1");
    expect(resolveApiBaseUrl("not a url", "unbored.lol")).toBe("/api/v1");
  });
});
