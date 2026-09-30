import { render } from "preact";
import { App } from "./app";
import { onHostMessage, post } from "./bus";
import { applyHostMessage } from "./store";

onHostMessage(applyHostMessage);
render(<App />, document.getElementById("root")!);
post({ type: "ready" });
