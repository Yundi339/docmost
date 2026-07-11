import { describe, expect, it } from "vitest";
import { parseUpdateLog } from "./update-log-service";

describe("parseUpdateLog", () => {
  it("validates and sorts releases newest first", () => {
    const result = parseUpdateLog({
      schemaVersion: 1,
      updatedAt: "2026-07-11T22:14:49+08:00",
      releases: [
        {
          version: "26.06.20.0",
          date: "2026-06-20",
          title: "OAuth",
          changes: [{ type: "added", text: "新增 OAuth 设置。" }],
        },
        {
          version: "26.07.11.0",
          date: "2026-07-11",
          title: "审计日志",
          changes: [{ type: "improved", text: "审计记录更容易理解。" }],
        },
      ],
    });

    expect(result.releases.map((release) => release.version)).toEqual([
      "26.07.11.0",
      "26.06.20.0",
    ]);
  });

  it("rejects unsupported fields and invalid versions", () => {
    expect(() =>
      parseUpdateLog({
        schemaVersion: 1,
        updatedAt: "2026-07-11T22:14:49+08:00",
        releases: [
          {
            version: "latest",
            date: "2026-07-11",
            title: "Invalid",
            changes: [{ type: "added", text: "Invalid" }],
            html: "<script>alert(1)</script>",
          },
        ],
      }),
    ).toThrow();
  });
});
