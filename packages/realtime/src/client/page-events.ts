import type { SocketTransport } from './transport.ts';

/** Something that can be listened to: a window, or its document. */
interface Listenable {
	addEventListener?: (type: string, listener: () => void) => void;
	removeEventListener?: (type: string, listener: () => void) => void;
}

/** As much of a page as `checkOnPageEvents` uses: a window, with its document. */
export interface PageLike extends Listenable {
	document?: Listenable & { readonly visibilityState?: string };
}

/**
 * Have a page's `online`, and its `visibilitychange` to visible, cut the wait
 * before the transport's next retry (ADR-0137). The transport itself knows no
 * page. Where there is none, as under Node, this does nothing.
 */
export function checkOnPageEvents(
	transport: Pick<SocketTransport, 'checkNow'>,
	page: PageLike = globalThis as PageLike,
): () => void {
	const onOnline = () => transport.checkNow();
	const onVisibilityChange = () => {
		if (page.document?.visibilityState !== 'hidden') transport.checkNow();
	};
	page.addEventListener?.('online', onOnline);
	page.document?.addEventListener?.('visibilitychange', onVisibilityChange);
	return () => {
		page.removeEventListener?.('online', onOnline);
		page.document?.removeEventListener?.('visibilitychange', onVisibilityChange);
	};
}
