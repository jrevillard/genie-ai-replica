const { traceQuery } = require("../tracing-db");

describe("tracing-db.js", () => {
  it("calls the query function and returns the result", async () => {
    const mockResult = { all: () => Promise.resolve([{ _key: "1" }]) };
    const queryFn = jest.fn().mockResolvedValue(mockResult);

    const result = await traceQuery(queryFn, {
      collection: "users",
      operation: "FOR",
    });

    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(result).toBe(mockResult);
  });

  it("propagates query errors", async () => {
    const error = new Error("query failed");
    const queryFn = jest.fn().mockRejectedValue(error);

    await expect(
      traceQuery(queryFn, { collection: "users", operation: "INSERT" }),
    ).rejects.toThrow("query failed");
  });

  it("works with no-op tracer in test mode (no errors)", async () => {
    const queryFn = jest.fn().mockResolvedValue("ok");
    const result = await traceQuery(queryFn, {
      collection: "messages",
      operation: "FOR",
    });
    expect(result).toBe("ok");
  });

  it("handles multiple sequential traceQuery calls", async () => {
    const fn1 = jest.fn().mockResolvedValue("result1");
    const fn2 = jest.fn().mockResolvedValue("result2");

    const r1 = await traceQuery(fn1, { collection: "users", operation: "FOR" });
    const r2 = await traceQuery(fn2, {
      collection: "conversations",
      operation: "INSERT",
    });

    expect(r1).toBe("result1");
    expect(r2).toBe("result2");
  });
});

describe("tracing-db.js span lifecycle (with mock tracer)", () => {
  let traceQueryMocked;
  let mockSpan;

  beforeAll(() => {
    mockSpan = {
      setAttribute: jest.fn(),
      setStatus: jest.fn(),
      recordException: jest.fn(),
      end: jest.fn(),
    };
    const mockTracer = { startSpan: jest.fn().mockReturnValue(mockSpan) };

    jest.isolateModules(() => {
      jest.doMock("../tracing", () => ({ getTracer: () => mockTracer }));
      traceQueryMocked = require("../tracing-db").traceQuery;
    });
  });

  beforeEach(() => {
    mockSpan.setAttribute.mockClear();
    mockSpan.setStatus.mockClear();
    mockSpan.recordException.mockClear();
    mockSpan.end.mockClear();
  });

  it("sets span status to ERROR on query failure", async () => {
    const queryFn = jest.fn().mockRejectedValue(new Error("db timeout"));

    await expect(
      traceQueryMocked(queryFn, { collection: "users", operation: "FOR" }),
    ).rejects.toThrow("db timeout");

    expect(mockSpan.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({ message: "db timeout" }),
    );
    expect(mockSpan.recordException).toHaveBeenCalled();
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it("sets db attributes on successful query", async () => {
    const queryFn = jest.fn().mockResolvedValue("ok");

    await traceQueryMocked(queryFn, {
      collection: "messages",
      operation: "INSERT",
    });

    expect(mockSpan.setAttribute).toHaveBeenCalledWith("db.system", "arangodb");
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      "db.collection",
      "messages",
    );
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      "db.operation",
      "INSERT",
    );
    expect(mockSpan.end).toHaveBeenCalled();
    expect(mockSpan.setStatus).not.toHaveBeenCalled();
  });
});
