import { ensureHostNativeModules } from "./ensure-host-native-modules";

export default function globalSetup(): void {
  ensureHostNativeModules();
}
