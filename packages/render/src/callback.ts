import { Observable, Subscription } from "rxjs";
import { Bridge, CovalentData } from "@electron-covalent/common";
import { KeysOfType } from "./keys-of-type";

export type BridgeOpen<Callback> = Callback extends Bridge.Callback<infer Input, infer Output>
  ? (input: Input, subscriber: (next: Output) => void) => Subscription
  : never;

/**
 * Type for 'callback' message handlers.
 */
export interface CallbackManager<Input extends CovalentData, Output extends CovalentData> {
  /**
   * Send a request to open a communication channel and return an observable linked to this channel.
   *
   * @param input the callback input
   * @param subscriber the callback subscriber
   * @return the callback observable
   */
  open(input: Input, subscriber: (next: Output) => void): Subscription;
}

export class CallbackManagerImpl<B, Input extends CovalentData, Output extends CovalentData>
  implements CallbackManager<Input, Output>
{
  private readonly closeKey: Extract<KeysOfType<B, Bridge.Send<number>>, string>;

  public constructor(
    private readonly bridge: B | undefined,
    private readonly callbackKey: Extract<KeysOfType<B, Bridge.Callback<Input, Output>>, string>,
  ) {
    this.closeKey = (callbackKey + ":__close") as Extract<KeysOfType<B, Bridge.Send<number>>, string>;
  }

  public open(input: Input, subscriber: (next: Output) => void): Subscription {
    const callback = this.bridge?.[this.callbackKey] as Bridge.Callback<Input, Output> | undefined;
    const close = this.bridge?.[this.closeKey] as Bridge.Send<number> | undefined;
    return new Observable<Output>((subscriber) => {
      if (callback && close) {
        const closingPort = callback(
          (event: Bridge.Event<MessageEvent, Output>) => subscriber.next(event.value),
          input,
        );
        return () => close(closingPort);
      }
    }).subscribe(subscriber);
  }
}
