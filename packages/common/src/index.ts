import { IpcRenderer, IpcRendererEvent } from "electron";

export type CovalentData =
  | null
  | undefined
  | boolean
  | number
  | string
  | Buffer
  | Date
  | Array<CovalentData>
  | { [key: string | number | symbol]: CovalentData }
  | Map<CovalentData, CovalentData>
  | Set<CovalentData>
  | Uint8Array
  | Float32Array
  | Int32Array
  | ArrayBuffer
  | void;

/**
 * Namespace for common types of the Covalent library.
 */
export namespace Bridge {
  /**
   * Object representing data sent by the main process and received by the render processes.
   */
  export type Event<TypeEvent, TypeData> = {
    event?: TypeEvent;
    value: TypeData;
  };

  /**
   * Type for bridge endpoints which would be used by the front to send data to electron.
   */
  export type Send<Input extends CovalentData> = (data: Input) => void;
  /**
   * Type for bridge endpoints which would be used by the front to receive data from electron.
   */
  export type Invoke<Input extends CovalentData, Output extends CovalentData> = (data: Input) => Promise<Output>;

  /**
   * Type for bridge endpoints which would be used by the front to listen to electron.
   */
  export type On<Output extends CovalentData> = (listener: (event: Event<IpcRendererEvent, Output>) => void) => IpcRenderer;
  /**
   * Type for bridge endpoints which would be used by the front to send data to electron and then listen to it.
   */
  export type Callback<Input extends CovalentData, Output extends CovalentData> = (
    listener: (event: Event<MessageEvent, Output>) => void,
    input: Input,
  ) => number;
}

export namespace BridgeUtility {
  export type ExtractSend<F> = F extends Bridge.Invoke<any, any> ? never : F extends Bridge.On<any> ? never : F extends Bridge.Send<any> ? F : never;
  export type IfSendThen<F, Then = F> = F extends Bridge.Invoke<any, any> ? never : F extends Bridge.On<any> ? never : F extends Bridge.Send<any> ? Then : never;
  export type SendInput<F> = F extends Bridge.Send<infer Input> ? Input : never;

  export type ExtractInvoke<F> = F extends Bridge.Invoke<any, any> ? F : never;
  export type IfInvokeThen<F, Then = F> = F extends Bridge.Invoke<any, any> ? Then : never;
  export type InvokeInput<F> = F extends Bridge.Invoke<infer Input, any> ? Input : never;
  export type InvokeOutput<F> = F extends Bridge.Invoke<any, infer Output> ? Output : never;

  export type ExtractOn<F> = F extends Bridge.On<any> ? F : never;
  export type IfOnThen<F, Then = F> = F extends Bridge.On<any> ? Then : never;
  export type OnOutput<F> = F extends Bridge.On<infer Output> ? Output : never;

  export type ExtractCallback<F> = F extends Bridge.Callback<any, any> ? F : never;
  export type IfCallbackThen<F, Then = F> = F extends Bridge.Callback<any, any> ? Then : never;
  export type CallbackInput<F> = F extends Bridge.Callback<infer Input, any> ? Input : never;
  export type CallbackOutput<F> = F extends Bridge.Callback<any, infer Output> ? Output : never;
}
