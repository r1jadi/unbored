/**
 * The browser entry: TanStack Start's default, plus one step before hydration.
 * A page in Albanian fetches its dictionary first (`loadLanguage`), so the first
 * client render is in Albanian like the server's HTML; English pages skip it and
 * never download the dictionary.
 */
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { StartClient } from "@tanstack/react-start/client";

import { loadLanguage } from "@/lib/settings/language";

void loadLanguage()
  // Without the dictionary the page still works, in English.
  .catch(() => undefined)
  .then(() => {
    startTransition(() => {
      hydrateRoot(
        document,
        <StrictMode>
          <StartClient />
        </StrictMode>,
      );
    });
  });
