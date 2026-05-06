/**
 * Renderer-wide warning surfaced when `safeStorage` (the OS keychain) cannot
 * encrypt or decrypt at startup (Wave 4.3 commit 7.2).
 *
 * Provider API keys ride through `safeStorage`; an unavailable keychain means
 * any save attempt will hard-fail with `KeychainUnavailableError`. Showing this
 * banner pre-empts the user wondering why their next form submit will toast a
 * `KEYCHAIN_UNAVAILABLE` error from nowhere.
 *
 * The banner is dismissable per-session (state in zustand, NOT persisted) so
 * the user can clear it after acknowledging — but a fresh session re-surfaces
 * it as long as the keychain remains unavailable, by design. Persisting the
 * dismissal would suppress real, recurring problems.
 */

import { ShieldAlertIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { useConfigStore } from "../store";

export function KeychainWarningBanner() {
  const { t } = useTranslation();
  const keychainAvailable = useConfigStore((s) => s.keychainAvailable);
  const [dismissed, setDismissed] = useState(false);

  // null = not yet loaded; true = fine; false = surface banner
  if (keychainAvailable !== false || dismissed) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-[100] flex justify-center px-3">
      <Alert
        className="pointer-events-auto max-w-2xl shadow-lg"
        variant="warning"
        data-testid="keychain-warning-banner"
      >
        <ShieldAlertIcon />
        <AlertTitle>{t("keychain.unavailable.title")}</AlertTitle>
        <AlertDescription>{t("keychain.unavailable.description")}</AlertDescription>
        <AlertAction>
          <Button
            aria-label={t("keychain.unavailable.dismiss")}
            onClick={() => setDismissed(true)}
            size="icon"
            variant="ghost"
          >
            <XIcon className="size-4" />
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
}
