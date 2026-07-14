import { DatabasePageExtensionIndicator } from "./database-page-extension-indicator";
import { registerPageExtensionRenderer } from "@/features/page/tree/extensions/page-extension-registry";

export function registerDatabasePageExtension(): void {
  registerPageExtensionRenderer("database", DatabasePageExtensionIndicator);
}
