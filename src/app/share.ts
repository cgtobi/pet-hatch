import { t } from '../i18n';

/** Send a link through the phone's share sheet, or copy it where there is none. */
export async function shareLink(text: string, link: string, toast: (text: string) => void): Promise<void> {
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Pet Hatch', text, url: link });
      return;
    }
  } catch (e) {
    // The share sheet was dismissed: nothing to do.
    if ((e as Error).name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(`${text} ${link}`);
    toast(t('toast.linkCopied'));
  } catch {
    toast(t('toast.copyFailed'));
  }
}
