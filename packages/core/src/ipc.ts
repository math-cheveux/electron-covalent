import { BehaviorSubject, first, Subscription } from "rxjs";
import { contextBridge, ipcMain, IpcMainEvent, IpcMainInvokeEvent, ipcRenderer, webContents } from "electron";
import { Bridge, CovalentData } from "@electron-covalent/common";
import { Handler } from "./handler";
import { CallbackManager } from "./callback";
import { ReflectUtils } from "./reflect-utils";

/**
 * Generic type representing any constructor.
 */
export type Constructor<T extends Object = any> = new (...args: any[]) => T;

/**
 * Interface used when registering or exposing a covalent controller.
 * It allows more flexibility.
 *
 * @see Controllers.register
 * @see Controllers.exposeBridge
 */
export type Provider = {
  /**
   * The class to be used in constructor arguments.
   */
  provide: Constructor;
  /**
   * The class used for injection.
   */
  useClass: Constructor;
};

/**
 * Utility class for manipulating covalent controllers.
 */
export class Controllers {
  private static readonly _controllers = new Map<string, Object>();
  private static readonly _controllerProviders = new Map<string, Provider>();
  private static readonly _controllersInit = new Map<string, BehaviorSubject<boolean>>();
  private static readonly _controllersSubscriptions: Subscription[] = [];
  public static readonly BRIDGE_METADATA_PREFIX: string = "covalent:bridge:";
  public static readonly CALLBACK_MANAGERS_METADATA_KEY: string = "covalent:callback_managers";
  public static readonly EXPOSE_KEY = "covalent:bridge";

  /**
   * Register the passed covalent controllers (to use in the electron process).
   * The parameter order is not important.
   *
   * @param controllers the controllers to instantiate and register
   */
  public static async register(...controllers: (Constructor | Provider)[]) {
    const providers = controllers.map((controller) =>
      typeof controller === "object" ? controller : { provide: controller, useClass: controller },
    );
    const globalProviders: Provider[] = [...providers, ...this._controllerProviders.values()];
    const providerNames = globalProviders.map((provider) => provider.provide.name);
    // Check self dependencies.
    for (const provider of providers) {
      const depNames = this.getArgTypes(provider.useClass).map((arg) => (typeof arg === "function" ? arg.name : "?"));
      if (depNames.some((depName) => depName === provider.provide.name)) {
        console.error(`${provider.provide.name} has a direct dependency on itself.`);
        throw new Error("Error while registering controllers.");
      }
    }
    // Check unknown or missing dependencies.
    for (const provider of providers) {
      const depNames = this.getArgTypes(provider.useClass).map((arg) => (typeof arg === "function" ? arg.name : "?"));
      const errors = depNames.filter((depName) => !providerNames.includes(depName));
      if (errors.length > 0) {
        console.error(
          `${provider.useClass.name} has dependencies to unknown/missing controllers: ${errors.join(", ")}.`,
        );
        if (errors.includes("?")) {
          console.error(
            `If the arguments are actually registered controllers, this issue could be caused by a cycle dependency between controllers inside a same project.`,
          );
        }
        throw new Error("Error while registering controllers.");
      }
    }
    // Check cycle dependencies.
    for (const provider of providers) {
      const check = this.gatherCycleDependency(globalProviders, provider);
      if (check.length > 0) {
        console.error(`Cycle dependency found: ${check.join(" -> ")}`);
        throw new Error("Error while registering controllers.");
      }
    }
    // Order dependencies.
    while (this.forwardFirstDependency(providers)) {
      // Keep forwarding.
    }
    await this.init(providers);
  }

  private static getArgTypes(fn: Function): unknown[] {
    return Reflect.getMetadata("design:paramtypes", fn) ?? [];
  }

  /**
   * @return the cycle dependency if found, starting and ending with the same element name, otherwise an empty array.
   */
  private static gatherCycleDependency(providers: Provider[], provider: Provider, route: string[] = []): string[] {
    if (route.includes(provider.useClass.name)) {
      return [...route.slice(route.findIndex((node) => node === provider.useClass.name)), provider.useClass.name];
    }
    const depNames = this.getArgTypes(provider.useClass).map((arg) => (typeof arg === "function" ? arg.name : "?"));
    if (depNames.length === 0) {
      // If no dependency, no cycle.
      return [];
    }
    const deps = depNames.map((depName) => providers.find((p) => p.provide.name === depName)!);
    const newRoute = [...route, provider.useClass.name];
    for (const dep of deps) {
      const check = this.gatherCycleDependency(providers, dep, newRoute);
      if (check.length > 0) {
        return check;
      }
    }
    // If dependencies have no cycle dependency, no cycle.
    return [];
  }

  /**
   * Move one item in the provided array to respect the construction order.
   * @param providers the array to re-order
   * @return <code>true</code> if the array has been changed, otherwise <code>false</code>
   */
  private static forwardFirstDependency(providers: Provider[]): boolean {
    for (let i = 0; i < providers.length; i++) {
      const provider = providers[i];
      const depNames = this.getArgTypes(provider.useClass).map((arg) => (typeof arg === "function" ? arg.name : "?"));
      if (depNames.length === 0) {
        continue;
      }
      for (const depName of depNames) {
        const depIndex = providers.findIndex((p) => p.provide.name === depName);
        if (depIndex < i) {
          // If the dependency is already forward the controller, skip.
          continue;
        }
        providers.splice(0, 0, ...providers.splice(depIndex, 1));
        return true;
      }
    }
    return false;
  }

  /**
   * Instantiate the provided controllers, and then run their initialization method.
   * @param providers the controllers to initialize
   */
  private static async init(providers: Provider[]) {
    for (const provider of providers) {
      if (!this._controllers.has(provider.provide.name)) {
        this._controllers.set(provider.provide.name, new provider.useClass());
        this._controllerProviders.set(provider.provide.name, provider);
        this._controllersInit.set(provider.provide.name, new BehaviorSubject(false));
      }
    }
    // Init controllers when all controllers are defined for sure.
    const promises: Promise<void>[] = [];
    for (const provider of providers) {
      promises.push(
        Promise.resolve(this.getSync(provider.provide).onCovalentInit?.()).then(() => {
          const subject = this._controllersInit.get(provider.provide.name)!;
          subject.next(true);
        }),
      );
    }
    await Promise.all(promises);
  }

  /**
   * Get the singleton of the passed controller class. The controller may not be initialized.
   */
  public static getSync<T extends Object>(controller: Constructor<T>): T {
    return this._controllers.get(controller.name) as T;
  }

  /**
   * Get the initialized singleton of the passed controller class.
   * If the controller is not initialized yet, it will wait until it is.
   */
  public static get<T extends Object>(controller: Constructor<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this._controllersInit.has(controller.name)) {
        reject(new Error(`Controller ${controller.name} is not registered.`));
        return;
      }
      this._controllersInit
        .get(controller.name)!
        .pipe(first((value) => value))
        .subscribe(() => resolve(this.getSync(controller)));
    });
  }

  public static storeSubscriptionForDisposal(sub: Subscription) {
    this._controllersSubscriptions.push(sub);
  }

  /**
   * Return a promise that will resolve when all the passed controllers are initialized.
   */
  public static async waitInit<T extends Object>(...controllers: Constructor<T>[]) {
    await Promise.all(
      controllers.map(
        (controller) =>
          new Promise<void>((resolve) =>
            this._controllersInit
              .get(controller.name)!
              .pipe(first((value) => value))
              .subscribe(() => resolve()),
          ),
      ),
    );
  }

  /**
   * Expose the electron API interface defined by the covalent controllers (to use in the preload script).
   * @param controllers the controllers to expose
   */
  public static exposeBridge(...controllers: (Constructor | Provider)[]) {
    const bridge: { [name: string]: any } = {};
    const groupController: { [name: string]: string } = {};
    controllers.forEach((controller) => {
      const construct = "name" in controller ? controller : controller.useClass;
      const bridgeKey = Reflect.getMetadataKeys(construct).find(
        (key) => typeof key === "string" && key.startsWith(this.BRIDGE_METADATA_PREFIX),
      );
      if (!bridgeKey) {
        throw new Error(`${construct.name} is not a controller.`);
      }
      const group = bridgeKey.substring(this.BRIDGE_METADATA_PREFIX.length);
      if (group in groupController) {
        throw new Error(`Group of ${construct.name} ("${group}") is already defined by ${groupController[group]}.`);
      }
      bridge[group] = Reflect.getMetadata(bridgeKey, construct);
      groupController[group] = construct.name;
    });
    contextBridge.exposeInMainWorld(this.EXPOSE_KEY, bridge);
  }

  public static dispose() {
    for (const sub of this._controllersSubscriptions.splice(0)) {
      sub.unsubscribe();
    }
    for (const controller of this._controllers.values()) {
      for (const manager of ReflectUtils.computeMetadataIfAbsent(
        Controllers.CALLBACK_MANAGERS_METADATA_KEY,
        controller.constructor,
        () => new Map<string, CallbackManager<CovalentData, CovalentData>>(),
      ).values()) {
        manager.unwatchAll();
      }
    }
    this._controllers.clear();
    this._controllerProviders.clear();
    for (const subject of this._controllersInit.values()) {
      subject.complete();
    }
    this._controllersInit.clear();
  }
}

/**
 * Utility class for manipulating render processes.
 */
export class WebContents {
  /**
   * Send data to all render processes on a specific channel.
   */
  public static send(channel: string, ...args: any[]): void {
    webContents.getAllWebContents().forEach((wc) => {
      if (wc && !(wc.isDestroyed() || wc.isCrashed())) {
        wc.send(channel, ...args);
      }
    });
  }
}

/**
 * Utility class for IPC operations from render processes.
 */
export class Renderer {
  private static readonly CALLBACK_PORTS: Map<string, number> = new Map();

  public static send<Output extends CovalentData>(channel: string): Bridge.Send<Output> {
    return (...args: any[]) => ipcRenderer.send(channel, ...args);
  }

  public static invoke<Input extends CovalentData, Output extends CovalentData>(
    channel: string,
  ): Bridge.Invoke<Input, Output> {
    return (...args: any[]) => ipcRenderer.invoke(channel, ...args);
  }

  public static on<Output extends CovalentData>(channel: string): Bridge.On<Output> {
    return (on: (next: Bridge.Event<Electron.IpcRendererEvent, Output>) => void) => {
      return ipcRenderer.on(channel, (event, value) => on({ event, value }));
    };
  }

  public static callback<Input extends CovalentData, Output extends CovalentData>(
    channel: string,
  ): Bridge.Callback<Input, Output> {
    return (callback: (next: Bridge.Event<MessageEvent, Output>) => void, input?: Input) => {
      // MessageChannels are lightweight--it's cheap to create a new one for each
      // request.
      const { port1, port2 } = new MessageChannel();
      if (!Renderer.CALLBACK_PORTS.has(channel)) {
        Renderer.CALLBACK_PORTS.set(channel, 0);
      }
      const portId = Renderer.CALLBACK_PORTS.get(channel)!;
      Renderer.CALLBACK_PORTS.set(channel, portId + 1);

      // We send one end of the port to the main process ...
      ipcRenderer.postMessage(channel, { portId, input }, [port2]);

      // ... and we hang on to the other end. The main process will send messages
      // to its end of the port, and close it when it's finished.
      port1.onmessage = (event: MessageEvent<Output>) => callback({ event: event, value: event.data });
      return portId;
    };
  }
}

/**
 * Utility class for IPC operations from the main process.
 */
export class Main {
  public static on<Input extends CovalentData>(channel: string, handler: Handler.Send<Input>) {
    ipcMain.on(channel, (_event: IpcMainEvent, data: Input) => handler(data));
  }

  public static handle<Input extends CovalentData, Output extends CovalentData>(
    channel: string,
    handler: Handler.Invoke<Input, Output>,
  ) {
    ipcMain.handle(channel, (_event: IpcMainInvokeEvent, data: Input) => handler(data));
  }

  public static onMessagePort<Input extends CovalentData, Output extends CovalentData>(
    channel: string,
    handler: Handler.Callback<Input, Output>,
  ) {
    ipcMain.on(channel, (event: IpcMainEvent, data: { portId: number; input: Input }) => {
      const [replyPort] = event.ports;
      handler({
        id: data.portId,
        input: data.input,
        postMessage: (message) => replyPort.postMessage(message),
        close: () => replyPort.close(),
        onClose: (listener: () => void) => replyPort.once("close", listener),
      });
    });
  }
}
