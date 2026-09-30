import { describe, expect, it } from "vitest";
import { pngBytes } from "../exportFile";

describe("pngBytes", () => {
  it("accepts a real PNG", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    expect(pngBytes(`data:image/png;base64,${png.toString("base64")}`)?.length).toBe(11);
  });

  it("refuses anything that is not a PNG", () => {
    expect(
      pngBytes(`data:image/png;base64,${Buffer.from("<html>").toString("base64")}`),
    ).toBeNull();
    expect(pngBytes("data:text/plain;base64,aGk=")).toBeNull();
  });
});
