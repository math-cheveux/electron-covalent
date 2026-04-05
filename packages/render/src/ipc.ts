import { BridgeOf, InternalBridges } from "./bridges";
import { BridgeOpen } from "./callback";
import { Bridge, BridgeUtility, CovalentData } from "@electron-covalent/common";
import { KeysOfType } from "./keys-of-type";
import { map, Observable, Subscription } from "rxjs";
import { IpcRenderer, IpcRendererEvent } from "electron";

export interface ProxyFactory<B> {
  /** Create a SEND endpoint. */
  readonly send: <K extends keyof B>(key: K) => BridgeUtility.ExtractSend<B[K]>;
  readonly invoke: {
    /** Create a INVOKE endpoint. */
    <K extends keyof B>(key: K): BridgeUtility.ExtractInvoke<B[K]>;
    /** Create a cached INVOKE endpoint. */
    cache: <K extends keyof B>(key: K) => BridgeUtility.ExtractInvoke<B[K]>;
  };
  /** Create a mapped ON endpoint. */
  readonly of: <K extends keyof B>(key: K) => BridgeOf<B[K]>;
  /** Create a mapped CALLBACK endpoint. */
  readonly open: <K extends keyof B>(key: K) => BridgeOpen<B[K]>;
}

class ProxyFactoryImpl<B> implements ProxyFactory<B> {
  private readonly bridge: Partial<B> | undefined;

  constructor(private readonly group: string, private readonly defaultApi?: Partial<B>) {
    this.bridge = globalThis[InternalBridges.EXPOSE_KEY]?.[this.group] ?? this.defaultApi;

    const invoke = <K extends keyof B>(key: K) => {
      if (!this.bridge?.[key]) {
        throw new Error(`"${String(key)}" INVOKE operation is not defined on the group ${this.group}`);
      }
      return this.bridge?.[key] as BridgeUtility.ExtractInvoke<B[K]>;
    };

    invoke.cache = <K extends keyof B>(key: K) =>
      InternalBridges.cache(invoke<K>(key)) as BridgeUtility.ExtractInvoke<B[K]>;

    this.invoke = invoke;
  }

  send<K extends keyof B>(key: K): BridgeUtility.ExtractSend<B[K]> {
    if (!this.bridge?.[key]) {
      throw new Error(`"${String(key)}" SEND operation is not defined on the group ${this.group}`);
    }
    return this.bridge?.[key] as BridgeUtility.ExtractSend<B[K]>;
  }

  readonly invoke: {
    <K extends keyof B>(key: K): BridgeUtility.ExtractInvoke<B[K]>;
    cache: <K extends keyof B>(key: K) => BridgeUtility.ExtractInvoke<B[K]>;
  };

  of<K extends keyof B>(key: K): BridgeOf<B[K]> {
    if (!this.bridge?.[key]) {
      throw new Error(`"${String(key)}" ON operation is not defined on the group ${this.group}`);
    }
    return InternalBridges.of(
      this.group + ":" + String(key),
      this.bridge?.[key] as BridgeUtility.ExtractOn<B[K]>,
    ) as BridgeOf<B[K]>;
  }

  open<K extends keyof B>(key: K): BridgeOpen<B[K]> {
    if (!this.bridge?.[key]) {
      throw new Error(`"${String(key)}" CALLBACK operation is not defined on the group ${this.group}`);
    }
    const callbackManager = InternalBridges.manage(
      this.bridge,
      key as unknown as Extract<KeysOfType<Partial<B>, Bridge.Callback<CovalentData, CovalentData>>, string>,
    );
    return callbackManager.open.bind(callbackManager) as BridgeOpen<B[K]>;
  }
}

/**
 * Class builder to implement default behaviors to a `ProxyFactory` if the bridge is not exposed.
 */
export interface ProxyDefaultFactoryBuilder<B> {
  readonly onSend: <K extends keyof B>(
    key: BridgeUtility.IfSendThen<B[K], K>,
    fn: (input: BridgeUtility.SendInput<B[K]>) => void,
  ) => this;
  readonly onInvoke: <K extends keyof B>(
    key: BridgeUtility.IfInvokeThen<B[K], K>,
    fn:
      | BridgeUtility.InvokeOutput<B[K]>
      | ((
          input: BridgeUtility.InvokeInput<B[K]>,
        ) => BridgeUtility.InvokeOutput<B[K]> | Promise<BridgeUtility.InvokeOutput<B[K]>>),
  ) => this;
  readonly listenTo: <K extends keyof B>(
    key: BridgeUtility.IfOnThen<B[K], K>,
    obs: Observable<BridgeUtility.OnOutput<B[K]>>,
  ) => this;
  readonly watchTo: <K extends keyof B>(
    key: BridgeUtility.IfCallbackThen<B[K], K>,
    fn: (input: BridgeUtility.CallbackInput<B[K]>) => Observable<BridgeUtility.CallbackOutput<B[K]>>,
  ) => this;
  readonly build: (group: string) => ProxyFactory<B>;
}

class ProxyDefaultFactoryImpl<B> implements ProxyDefaultFactoryBuilder<B> {
  private readonly defaultApi: Partial<B> = {};
  private readonly watchMap = new Map<number, Subscription>();
  private watchCounter = 0;

  onSend<K extends keyof B>(
    key: BridgeUtility.IfSendThen<B[K], K>,
    fn: (input: BridgeUtility.SendInput<B[K]>) => void,
  ): this {
    // @ts-expect-error key has the correct constraint
    this.defaultApi[key] = fn;
    return this;
  }

  onInvoke<K extends keyof B>(
    key: BridgeUtility.IfInvokeThen<B[K], K>,
    fn:
      | BridgeUtility.InvokeOutput<B[K]>
      | ((
          input: BridgeUtility.InvokeInput<B[K]>,
        ) => BridgeUtility.InvokeOutput<B[K]> | Promise<BridgeUtility.InvokeOutput<B[K]>>),
  ): this {
    // @ts-expect-error key has the correct constraint, and `CovalentData` can't be a function
    this.defaultApi[key] =
      typeof fn === "function"
        ? (input: BridgeUtility.InvokeInput<B[K]>) => Promise.resolve(fn(input))
        : () => Promise.resolve(fn);
    return this;
  }

  listenTo<K extends keyof B>(
    key: BridgeUtility.IfOnThen<B[K], K>,
    obs: Observable<BridgeUtility.OnOutput<B[K]>>,
  ): this {
    const eventObs = obs.pipe(
      map((value) => ({ value } as Bridge.Event<IpcRendererEvent, BridgeUtility.OnOutput<B[K]>>)),
    );
    // @ts-expect-error key has the correct constraint
    this.defaultApi[key] = (
      listener: (event: Bridge.Event<IpcRendererEvent, BridgeUtility.OnOutput<B[K]>>) => void,
    ) => {
      const subscription = eventObs.subscribe(listener);
      return {
        removeAllListeners () {
          subscription.unsubscribe();
          return this as IpcRenderer;
        },
      } satisfies Pick<IpcRenderer, "removeAllListeners">;
    };
    return this;
  }

  watchTo<K extends keyof B>(
    key: BridgeUtility.IfCallbackThen<B[K], K>,
    fn: (input: BridgeUtility.CallbackInput<B[K]>) => Observable<BridgeUtility.CallbackOutput<B[K]>>,
  ): this {
    // @ts-expect-error key has the correct constraint
    this.defaultApi[key] = (
      listener: (event: Bridge.Event<MessageEvent, BridgeUtility.CallbackOutput<B[K]>>) => void,
      input: BridgeUtility.CallbackInput<B[K]>,
    ) => {
      const counter = this.watchCounter++;
      this.watchMap.set(
        counter,
        fn(input)
          .pipe(map((value) => ({ value } as Bridge.Event<MessageEvent, BridgeUtility.CallbackOutput<B[K]>>)))
          .subscribe(listener),
      );
      return counter;
    };
    // @ts-expect-error needed to prevent calling on an undefined value by the callback manager
    this.defaultApi[String(key) + ":__close"] = (counter: number) => {
      this.watchMap.get(counter)?.unsubscribe();
      this.watchMap.delete(counter);
    };
    return this;
  }

  build(group: string): ProxyFactory<B> {
    return new ProxyFactoryImpl<B>(group, this.defaultApi);
  }
}

export class Proxies {
  /**
   * Creates a factory to create proxies from one bridge group.
   * If your application can be run outside electron, you should use {@link createDefaultFactoryBuilder} instead.
   * @param group the bridge group
   */
  public static createFactory<B>(group: string): ProxyFactory<B> {
    return new ProxyFactoryImpl<B>(group);
  }

  /**
   * Creates a factory to create proxies from one bridge group.
   * If your application does not run outside electron, you can use {@link createFactory} instead.
   */
  public static createDefaultFactoryBuilder<B>(): ProxyDefaultFactoryBuilder<B> {
    return new ProxyDefaultFactoryImpl<B>();
  }

  /* istanbul ignore next */
  private constructor() {}
}
