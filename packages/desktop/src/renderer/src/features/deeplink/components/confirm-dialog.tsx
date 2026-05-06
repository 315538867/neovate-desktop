/**
 * Modal that asks the user to confirm a deeplink before main dispatches
 * it (Wave 4.3 commit 7.3).
 *
 * Why this exists: an external app/browser can fire `neovate://...`
 * without any user intent inside our app. Without this gate, the OS
 * happily routes those URLs to our handlers and side-effects run.
 * Default-deny on timeout (handled in `confirm-bus.ts`) means a
 * silent drop is the worst case if the renderer is unresponsive.
 *
 * Renders the head of `useDeeplinkConfirmStore().queue` only — multiple
 * pending deeplinks queue up rather than stacking modals.
 */

import debug from "debug";
import { ShieldQuestionIcon } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../../../components/ui/alert-dialog";
import { Button } from "../../../components/ui/button";
import { reportError } from "../../../core/error-reporter";
import { client } from "../../../orpc";
import { useDeeplinkConfirmStore } from "../store";

const log = debug("neovate:deeplink:confirm");

export function DeeplinkConfirmDialog() {
  const { t } = useTranslation();
  const head = useDeeplinkConfirmStore((s) => s.queue[0] ?? null);
  const shift = useDeeplinkConfirmStore((s) => s.shift);
  // Guard against double-respond: clicking the reject button fires onClick AND
  // closes the dialog, which would re-trigger onOpenChange(false). The ref is
  // keyed on the current head id so a fresh head always starts clean.
  const respondedRef = useRef<string | null>(null);

  if (!head) return null;

  const respond = async (approved: boolean) => {
    if (respondedRef.current === head.requestId) return;
    respondedRef.current = head.requestId;
    log("user response id=%s approved=%s", head.requestId, approved);
    shift();
    try {
      await client.deeplink.respondConfirmRequest({
        requestId: head.requestId,
        approved,
      });
    } catch (err) {
      reportError(err, { source: "deeplink-confirm-dialog" });
    }
  };

  return (
    <AlertDialog open onOpenChange={(open) => !open && void respond(false)}>
      <AlertDialogPopup data-testid="deeplink-confirm-dialog">
        <AlertDialogHeader>
          <div className="flex items-start gap-3">
            <ShieldQuestionIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-foreground/70" />
            <div className="flex flex-col gap-2 text-left">
              <AlertDialogTitle>{t("deeplink.confirm.title")}</AlertDialogTitle>
              <AlertDialogDescription>{t("deeplink.confirm.description")}</AlertDialogDescription>
              <code
                className="mt-2 break-all rounded-md bg-muted px-2 py-1 text-xs"
                data-testid="deeplink-confirm-url"
              >
                {head.url}
              </code>
            </div>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose
            render={<Button variant="outline" />}
            onClick={() => void respond(false)}
            data-testid="deeplink-confirm-reject"
          >
            {t("deeplink.confirm.reject")}
          </AlertDialogClose>
          <Button onClick={() => void respond(true)} data-testid="deeplink-confirm-approve">
            {t("deeplink.confirm.approve")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
