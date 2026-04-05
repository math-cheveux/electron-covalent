import { interval, map } from "rxjs";
import { Bridge } from "@electron-covalent/common";
import { Bridges, Proxies } from "../src";

export interface LogBridge {
  info: Bridge.Send<string>;
}

export interface ExampleBridge {
  doAction: Bridge.Send<string>;
  getConfig: Bridge.Invoke<void, { url: string }>;
  calculate: Bridge.Invoke<{ x: number }, number>;
  onDate: Bridge.On<Date>;
  watchMetrics: Bridge.Callback<{ period: number }, { percentCpuUsage: number }>;
}

export class LogProxy {
  private readonly $ = Proxies.createDefaultFactoryBuilder<LogBridge>()
    .onSend("info", (value: string) => console.log(`[INFO] ${value}`))
    .build("log");

  public readonly info = this.$.send("info");
}

export const defaultDoActionSpy = jest.fn((action: string) => console.log(`do ${action}`));

export class ExampleProxy {
  private readonly $ = Proxies.createDefaultFactoryBuilder<ExampleBridge>()
    .onSend("doAction", defaultDoActionSpy)
    .onInvoke("getConfig", { url: "/" })
    .onInvoke("calculate", ({ x }) => x)
    .listenTo("onDate", interval(250).pipe(map(() => new Date())))
    .watchTo("watchMetrics", ({ period }) =>
      interval(period).pipe(
        map(() => ({
          percentCpuUsage: Number.NaN,
        })),
      ),
    )
    .build("example");

  public readonly doAction = this.$.send("doAction");
  public readonly getConfiguration = this.$.invoke.cache("getConfig");
  public readonly calculate = this.$.invoke("calculate");
  public readonly date$ = this.$.of("onDate");
  public readonly watch = this.$.open("watchMetrics");

  public resetConfig(): void {
    Bridges.invalidateCache(this.getConfiguration);
  }
}
