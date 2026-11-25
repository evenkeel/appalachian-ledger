/**
 * One server-sent event stream shared by everything on the screen that uses it. It opens with its first
 * user, closes with its last, rests while the page is hidden and comes back by itself after a failure.
 */
export function sharedStream(url: string, receive: (message: unknown) => void, changed: () => void) {
  let source: EventSource | null = null;
  let retry = 0;
  let users = 0;
  let connected = false;
  // Raised by reset, so a stop function from before it no longer counts.
  let era = 0;

  const setConnected = (value: boolean) => {
    if (connected === value) return;
    connected = value;
    changed();
  };
  const close = () => {
    window.clearTimeout(retry);
    source?.close();
    source = null;
    setConnected(false);
  };
  const open = () => {
    if (source || !users || document.hidden || typeof EventSource === "undefined") return;
    const stream = new EventSource(url);
    source = stream;
    stream.onopen = () => setConnected(true);
    stream.onmessage = (event) => {
      let message: unknown;
      try {
        message = JSON.parse(event.data as string);
      } catch {
        return; // A line that is not a message is ignored.
      }
      setConnected(true);
      receive(message);
    };
    stream.onerror = () => {
      setConnected(false);
      // The browser reconnects by itself unless the server refused; then try again after a pause.
      if (stream.readyState !== 2) return;
      if (source === stream) source = null;
      window.clearTimeout(retry);
      retry = window.setTimeout(open, 5000);
    };
  };
  const onVisibility = () => (document.hidden ? close() : open());

  return {
    /** Start using the stream. Returns the function that stops. */
    use() {
      if (!users++) document.addEventListener("visibilitychange", onVisibility);
      open();
      const mine = era;
      let stopped = false;
      return () => {
        if (stopped || mine !== era) return;
        stopped = true;
        if (--users) return;
        document.removeEventListener("visibilitychange", onVisibility);
        close();
      };
    },
    isConnected: () => connected,
    /** Forget every user, for tests. */
    reset() {
      era++;
      users = 0;
      document.removeEventListener("visibilitychange", onVisibility);
      close();
    },
  };
}
