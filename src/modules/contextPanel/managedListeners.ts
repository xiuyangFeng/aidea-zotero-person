/**
 * Managed listener registry for panel hosts.
 *
 * Panel hosts are persistent elements that outlive individual bootstrap runs:
 * when a shared reader/library panel is invalidated and re-bootstrapped,
 * document- and window-level listeners registered by the previous run would
 * otherwise accumulate (each stale closure keeps working on detached DOM).
 *
 * Listeners registered through `addManagedListener` are tracked on the host
 * element; `resetManagedListeners` disposes them all. Call it at the start of
 * every bootstrap and when a host is invalidated or removed.
 */

type ListenerDisposer = () => void;

interface ManagedListenerHost {
  __aideaManagedListenerDisposers?: ListenerDisposer[];
}

function getDisposers(
  host: Element,
  create: boolean,
): ListenerDisposer[] | null {
  const managedHost = host as Element & ManagedListenerHost;
  if (!managedHost.__aideaManagedListenerDisposers) {
    if (!create) return null;
    managedHost.__aideaManagedListenerDisposers = [];
  }
  return managedHost.__aideaManagedListenerDisposers;
}

/**
 * Register an event listener that is disposed together with the host's next
 * `resetManagedListeners()` call. Intended for document/window-scoped
 * listeners; element-scoped listeners die with the element itself and don't
 * need this.
 *
 * The listener type is deliberately loose (`any`-parameter function), mirroring
 * the bivariance of the DOM `addEventListener` overloads so strongly-typed
 * handlers (e.g. `(e: PointerEvent) => void`) pass without casts.
 */
export function addManagedListener(
  host: Element,
  target: EventTarget,
  type: string,
  listener: ((...args: any[]) => void) | EventListenerObject,
  options?: boolean | AddEventListenerOptions,
): void {
  const add = target.addEventListener as (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => void;
  add(type, listener, options);
  const disposers = getDisposers(host, true);
  disposers?.push(() => {
    try {
      const remove = target.removeEventListener as (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ) => void;
      remove(type, listener, options);
    } catch (_err) {
      void _err;
    }
  });
}

/**
 * Dispose every listener registered on `host` and leave an empty registry.
 * Safe to call repeatedly and on hosts that never registered anything.
 */
export function resetManagedListeners(host: Element): void {
  const disposers = getDisposers(host, false);
  if (!disposers) return;
  while (disposers.length) {
    const dispose = disposers.pop();
    try {
      dispose?.();
    } catch (_err) {
      void _err;
    }
  }
}
