import { Bridges } from "../src";
import { ExampleBridge, ExampleProxy, LogProxy } from "./test-interfaces";
import { firstValueFrom, interval } from "rxjs";
import { InternalBridges } from "../src/bridges";

async function pause(period: number) {
  return firstValueFrom(interval(period));
}

function spyBridge(group: string, endPoint: string): jest.SpyInstance {
  return jest.spyOn(globalThis[InternalBridges.EXPOSE_KEY][group], endPoint);
}

describe("browser-side inside electron", () => {
  const renderer = {
    removeAllListeners: jest.fn().mockName("example:onDate:close"),
  };
  // @ts-ignore
  globalThis[InternalBridges.EXPOSE_KEY] = {
    log: {
      info: jest.fn().mockName("log:info"),
    },
    example: {
      doAction: jest.fn().mockName("example:doAction"),
      getConfig: jest.fn().mockName("example:getConfig"),
      calculate: jest.fn().mockName("example:calculate"),
      onDate: jest.fn(() => renderer).mockName("example:onDate"),
      watchMetrics: jest.fn(() => 0).mockName("example:watchMetrics"),
      "watchMetrics:__close": jest.fn().mockName("example:watchMetrics:close"),
    },
  };
  const infoSpy = spyBridge("log", "info");
  const configSpy = spyBridge("example", "getConfig");
  const calculateSpy = spyBridge("example", "calculate");
  const onSpy = spyBridge("example", "onDate");
  const onCloseSpy = jest.spyOn(renderer, "removeAllListeners");
  const watchSpy = spyBridge("example", "watchMetrics");
  const closeSpy = spyBridge("example", "watchMetrics:__close");

  const logProxy = new LogProxy();
  const exampleProxy = new ExampleProxy();

  afterEach(() => {
    Bridges.invalidateCaches();
    jest.clearAllMocks();
  });

  test("should be bound", () => {
    expect(InternalBridges.isBound("log")).toBeTruthy();
    expect(InternalBridges.isBound("example")).toBeTruthy();
  });

  test("should bind", () => {
    expect(InternalBridges.bind("log")).toMatchObject(globalThis[InternalBridges.EXPOSE_KEY]["log"]);
    expect(InternalBridges.bind("example")).toMatchObject(globalThis[InternalBridges.EXPOSE_KEY]["example"]);
  });

  test("should call bridge", () => {
    expect(infoSpy).not.toHaveBeenCalled();
    logProxy.info("test");
    expect(infoSpy).toHaveBeenCalledWith("test");
  });

  test("should not use cache", async () => {
    expect(calculateSpy).toHaveBeenCalledTimes(0);
    await exampleProxy.calculate({ x: 0 });
    expect(calculateSpy).toHaveBeenCalledTimes(1);
    await exampleProxy.calculate({ x: 0 });
    expect(calculateSpy).toHaveBeenCalledTimes(2);
  });

  test("should use cache", async () => {
    expect(configSpy).toHaveBeenCalledTimes(0);
    await exampleProxy.getConfiguration();
    expect(configSpy).toHaveBeenCalledTimes(1);
    await exampleProxy.getConfiguration();
    expect(configSpy).toHaveBeenCalledTimes(1);
  });

  test("should reset cache", async () => {
    expect(configSpy).toHaveBeenCalledTimes(0);
    await exampleProxy.getConfiguration();
    expect(configSpy).toHaveBeenCalledTimes(1);
    exampleProxy.resetConfig();
    await exampleProxy.getConfiguration();
    expect(configSpy).toHaveBeenCalledTimes(2);
  });

  test("should reset all cache", async () => {
    expect(configSpy).toHaveBeenCalledTimes(0);
    await exampleProxy.getConfiguration();
    expect(configSpy).toHaveBeenCalledTimes(1);
    Bridges.invalidateCaches();
    await exampleProxy.getConfiguration();
    expect(configSpy).toHaveBeenCalledTimes(2);
  });

  test("should reset cache after X times", async () => {
    const configMethod = InternalBridges.cache(InternalBridges.bind<ExampleBridge>("example")["getConfig"], {
      invalidate: {
        callCount: 2,
      },
    });

    expect(configSpy).toHaveBeenCalledTimes(0);
    await configMethod();
    expect(configSpy).toHaveBeenCalledTimes(1);
    await configMethod();
    expect(configSpy).toHaveBeenCalledTimes(1);
    await configMethod();
    expect(configSpy).toHaveBeenCalledTimes(2);
  });

  test("should reset cache after period", async () => {
    const configMethod = InternalBridges.cache(InternalBridges.bind<ExampleBridge>("example")["getConfig"], {
      invalidate: {
        duration: 2500,
      },
    });

    expect(configSpy).toHaveBeenCalledTimes(0);
    await configMethod();
    expect(configSpy).toHaveBeenCalledTimes(1);
    await configMethod();
    expect(configSpy).toHaveBeenCalledTimes(1);
    await pause(5000);
    await configMethod();
    expect(configSpy).toHaveBeenCalledTimes(2);
  }, 6000);

  test("should listen from observable", () => {
    expect(onSpy).not.toHaveBeenCalled();
    expect(onCloseSpy).not.toHaveBeenCalled();

    const subscription = new ExampleProxy().date$.subscribe();
    expect(onSpy).toHaveBeenCalled();
    expect(onCloseSpy).not.toHaveBeenCalled();

    subscription.unsubscribe();
    expect(onCloseSpy).toHaveBeenCalledWith("example:onDate");
  });

  test("should open and close callback", () => {
    expect(watchSpy).not.toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();

    const subscription = exampleProxy.watch({ period: 200 }, () => {});
    expect(watchSpy).toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();

    subscription.unsubscribe();
    expect(closeSpy).toHaveBeenCalledWith(0);
  });
});
