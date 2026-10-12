import { reportProcessError, startRuntime } from "./runtime.js";

startRuntime("bot").catch(reportProcessError);
