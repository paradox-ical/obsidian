import { reportProcessError, startRuntime } from "./runtime.js";

startRuntime("worker").catch(reportProcessError);
