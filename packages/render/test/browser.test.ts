import { Bridge } from "@electron-covalent/common";
import { defaultDoActionSpy, ExampleProxy, LogProxy } from "./test-interfaces";
import { Bridges, InternalBridges } from "../src/bridges";
import { Proxies } from "../src";
import { firstValueFrom, timer } from "rxjs";

describe("browser-side without electron", () => {
  // @ts-ignore
  globalThis[InternalBridges.EXPOSE_KEY] = undefined;

  const logProxy = new LogProxy();
  const exampleProxy = new ExampleProxy();

  afterEach(() => {
    Bridges.invalidateCaches();
    jest.clearAllMocks();
  });

  test("should not be bound", () => {
    expect(InternalBridges.isBound("log")).toBeFalsy();
    expect(InternalBridges.isBound("example")).toBeFalsy();
  });

  test("should not bind", () => {
    expect(InternalBridges.bind("log")).toStrictEqual({});
    expect(InternalBridges.bind("example")).toStrictEqual({});
  });

  test("should not throw errors if default is defined", async () => {
    expect(() => logProxy.info("test")).not.toThrow();
    expect(() => exampleProxy.doAction("test")).not.toThrow();
    await expect(exampleProxy.getConfiguration()).resolves.not.toThrow();
    await expect(exampleProxy.calculate({ x: 0 })).resolves.toBe(0);
    expect(() => exampleProxy.watch({ period: 100 }, () => {})).not.toThrow();
  });

  test("should throw errors if default is not defined", async () => {
    const factory = Proxies.createFactory<{
      send: Bridge.Send<any>;
      invoke: Bridge.Invoke<any, any>;
      on: Bridge.On<any>;
      callback: Bridge.Callback<any, any>;
    }>("error");

    expect(() => factory.send("send")).toThrow();
    expect(() => factory.invoke("invoke")).toThrow();
    expect(() => factory.of("on")).toThrow();
    expect(() => factory.open("callback")).toThrow();
  });

  test("should have default API", async () => {
    interface TestBridge {
      testSend: Bridge.Send<string>;
      testInvoke: Bridge.Invoke<string, string>;
      testCallback: Bridge.Callback<string, string>;
    }

    const defaultBridge: TestBridge = {
      testSend: jest.fn(),
      testInvoke: jest.fn(),
      testCallback: jest.fn(),
    };
    const sendSpy = jest.spyOn(defaultBridge, "testSend");
    const invokeSpy = jest.spyOn(defaultBridge, "testInvoke");
    const callbackSpy = jest.spyOn(defaultBridge, "testCallback");

    const bridge = InternalBridges.bind<TestBridge>("test", defaultBridge);

    expect(sendSpy).not.toHaveBeenCalled();
    bridge.testSend("test");
    expect(sendSpy).toHaveBeenCalled();

    expect(invokeSpy).not.toHaveBeenCalled();
    await bridge.testInvoke("test");
    expect(invokeSpy).toHaveBeenCalled();

    expect(callbackSpy).not.toHaveBeenCalled();
    bridge.testCallback(() => {}, "test");
    expect(callbackSpy).toHaveBeenCalled();
  });

  test("should have default behavior", async () => {
    expect(defaultDoActionSpy).not.toHaveBeenCalled();
    exampleProxy.doAction("test");
    expect(defaultDoActionSpy).toHaveBeenCalledWith("test");

    expect(await exampleProxy.getConfiguration()).toStrictEqual({ url: "/" });

    expect(await exampleProxy.calculate({ x: 0 })).toStrictEqual(0);

    const onSpy = jest.fn();
    const onSubscription = exampleProxy.date$.subscribe(onSpy);
    await firstValueFrom(timer(1100));
    onSubscription.unsubscribe();
    expect(onSpy).toHaveBeenCalledTimes(4);

    const watchSpy = jest.fn();
    const watchSubscription = exampleProxy.watch({ period: 200 }, watchSpy);
    await firstValueFrom(timer(1100));
    watchSubscription.unsubscribe();
    expect(watchSpy).toHaveBeenCalledTimes(5);
    expect(watchSpy).toHaveBeenCalledWith({
      percentCpuUsage: Number.NaN,
    });
  });
});
