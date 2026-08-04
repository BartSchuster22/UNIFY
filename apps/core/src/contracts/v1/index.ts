import { FormatRegistry } from "@sinclair/typebox";

if (!FormatRegistry.Has("date-time")) {
  FormatRegistry.Set("date-time", (value) => !Number.isNaN(Date.parse(value)) && /(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(value));
}
if (!FormatRegistry.Has("uri")) {
  FormatRegistry.Set("uri", (value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch {
      return false;
    }
  });
}

export * from "./primitives.js";
export * from "./envelopes.js";
export * from "./schemas.js";
export * from "./capabilities.js";
export * from "./api.js";
