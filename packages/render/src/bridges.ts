import { IpcRendererEvent } from "electron";
import { Observable, Subscription, timer } from "rxjs";
import { Bridge, CovalentData } from "@electron-covalent/common";
import { CallbackManager, CallbackManagerImpl } from "./callback";
import { KeysOfType } from "./keys-of-type";

/**
 * Utility type to easily identify a proxy's observable linked to its bridge.
 */
export type BridgeOf<On> = On extends Bridge.On<infer Output> ? Observable<Output> : never;

/**
 * Utility class for manipulating bridge instances (library scope).
 */
export abstract class InternalBridges {
  // @ts-expect-error : this key should be exposed by electron
  public static readonly EXPOSE_KEY: keyof typeof globalThis = "covalent:bridge";

  /**
   * @param group the controller group to test
   * @return `true` if the controller is exposed by IPC, otherwise `false`
   */
  public static isBound(group: string): boolean {
    return !!globalThis[InternalBridges.EXPOSE_KEY]?.[group];
  }

  /**
   * @param group the controller group
   * @param defaultApi the default values to use if the controller is not exposed
   * @return the instance of the bridge, linked to the passed group controller
   */
  public static bind<T>(group: string, defaultApi?: Partial<T>): T {
    let obj: Record<string, unknown> = {};
    if (InternalBridges.isBound(group)) {
      Object.keys(globalThis[InternalBridges.EXPOSE_KEY][group]).forEach((key) => {
        Object.defineProperty(obj, key, {
          value: globalThis[InternalBridges.EXPOSE_KEY][group][key],
          writable: false,
        });
      });
    } else {
      console.warn("electron-covalent: Cannot get group bridge", group);
      obj = {};
      if (defaultApi) {
        Object.keys(defaultApi).forEach((key) => {
          Object.defineProperty(obj, key, {
            value: (...args: unknown[]) => {
              console.warn("electron-covalent: %s.%s is not exposed by the electron app", group, key);
              // @ts-expect-error key is indeed a key of defaultApi
              return defaultApi[key](...args);
            },
            writable: false,
          });
        });
      }
    }
    return obj as T;
  }

  /**
   * @param channel the bridge endpoint name
   * @param on the bridge endpoint
   * @return an observable bound to the passed `ON` endpoint
   */
  public static of<Output extends CovalentData>(
    channel: string | number | symbol,
    on: Bridge.On<Output>,
  ): Observable<Output> {
    return new Observable((subscriber) => {
      const renderer = on((event: Bridge.Event<IpcRendererEvent, Output>) => subscriber.next(event.value));
      return () => renderer.removeAllListeners(String(channel));
    });
  }

  /**
   * Create a callback manager.
   * It is named 'open' for Proxy map setting,
   * since the callback manager is encapsulated and only its open method is exposed by the decorator.
   *
   * @param bridge the proxy bridge
   * @param callbackKey the `CALLBACK` endpoint key in the bridge
   * @return the callback manager instance
   */
  public static manage<B, Input extends CovalentData, Output extends CovalentData>(
    bridge: B | undefined,
    callbackKey: Extract<KeysOfType<B, Bridge.Callback<Input, Output>>, string>,
  ): CallbackManager<Input, Output> {
    return new CallbackManagerImpl<B, Input, Output>(bridge, callbackKey);
  }

  public static readonly CACHE_MAP: Map<Bridge.Invoke<any, any>, Map<unknown, unknown>> = new Map();

  /**
   * Override an `INVOKE` function to implement a stored-value logic.
   * The original function is not altered.
   *
   * @param invoke the `INVOKE` function to override
   * @param options the cache options
   * @return the overridden function
   */
  public static cache<Input extends CovalentData, Output extends CovalentData>(
    invoke: Bridge.Invoke<Input, Output>,
    options?: {
      invalidate?: {
        duration?: number;
        callCount?: number;
      };
    },
  ): Bridge.Invoke<Input, Output> {
    const valueMap = new Map<Input, Output>();
    const callCount = new Map<Input, number>();
    const durationTimeout = new Map<Input, Subscription>();

    const fn = async function (data: Input): Promise<Output> {
      // Count calls of the function.
      callCount.set(data, (callCount.get(data) ?? 0) + 1);
      if (options?.invalidate?.callCount != undefined && callCount.get(data)! >= options.invalidate.callCount) {
        valueMap.delete(data);
      }
      let value: Output;

      // Call IPC.
      if (valueMap.has(data)) {
        value = valueMap.get(data)!;
      } else {
        // Invalidate
        callCount.delete(data);
        if (durationTimeout.has(data)) {
          durationTimeout.get(data)?.unsubscribe();
          durationTimeout.delete(data);
        }

        // Invoke
        value = await invoke(data);
        valueMap.set(data, value);

        if (options?.invalidate?.duration != undefined) {
          durationTimeout.set(
            data,
            timer(options.invalidate.duration).subscribe(() => valueMap.delete(data)),
          );
        }
      }

      return value;
    };

    this.CACHE_MAP.set(fn, valueMap);

    return fn;
  }
}

/**
 * Utility class for manipulating bridge instances.
 */
export abstract class Bridges {
  /**
   * Reset the stored-value of an overridden `INVOKE` function.
   * @param fn the overridden function to reset
   */
  public static invalidateCache<Input extends CovalentData, Output extends CovalentData>(
    fn: Bridge.Invoke<Input, Output>,
  ) {
    InternalBridges.CACHE_MAP.get(fn)?.clear();
  }

  /**
   * Reset the stored-value of all overridden `INVOKE` functions.
   */
  public static invalidateCaches() {
    InternalBridges.CACHE_MAP.forEach((_value, key) => this.invalidateCache(key));
  }

  /* istanbul ignore next */
  private constructor() {}
}
