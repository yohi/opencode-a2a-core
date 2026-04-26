import { describe, it, expect, vi } from "vitest";
import { ConsoleLogger, type Logger } from "../../src/core/logger.js";

describe("ConsoleLogger", () => {
  it("implements Logger interface", () => {
    const log: Logger = new ConsoleLogger();
    expect(typeof log.debug).toBe("function");
    expect(typeof log.info).toBe("function");
    expect(typeof log.warn).toBe("function");
    expect(typeof log.error).toBe("function");
  });

  it("writes info to stdout in JSON format", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const log = new ConsoleLogger({ level: "info" });
    log.info("hello", { taskId: "t1" });
    expect(spy).toHaveBeenCalledOnce();
    const [line] = spy.mock.calls[0] as [string];
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("hello");
    expect(parsed.taskId).toBe("t1");
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    spy.mockRestore();
  });

  it("filters below configured level", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const log = new ConsoleLogger({ level: "warn" });
    log.debug("hidden");
    log.info("hidden");
    log.warn("shown");
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("masks secret-like keys in context", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const log = new ConsoleLogger({ level: "info" });
    log.info("event", { 
      apiKey: "s3cr3t", 
      api_key: "s3cr3t",
      token: "abc", 
      access_token: "at",
      refresh_token: "rt",
      client_secret: "cs",
      safe: "ok",
      level: "fake", // 予約キーとの衝突
      auth: { token: "secret" } // ネストされた機密情報
    });
    const [line] = spy.mock.calls[0] as [string];
    const parsed = JSON.parse(line);
    expect(parsed.apiKey).toBe("***");
    expect(parsed.api_key).toBe("***");
    expect(parsed.token).toBe("***");
    expect(parsed.access_token).toBe("***");
    expect(parsed.refresh_token).toBe("***");
    expect(parsed.client_secret).toBe("***");
    expect(parsed.safe).toBe("ok");
    // コアフィールドが優先され、ctx による上書きが防止されていること
    expect(parsed.level).toBe("info");
    // ネストされたオブジェクト内もマスクされていること
    expect(parsed.auth.token).toBe("***");
    spy.mockRestore();
  });
});
