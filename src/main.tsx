import {
  installRendererDiagnostics,
  reportRendererBootstrapFailure,
} from "./lib/renderer-diagnostics";

installRendererDiagnostics();
void import("./bootstrap").catch(reportRendererBootstrapFailure);
