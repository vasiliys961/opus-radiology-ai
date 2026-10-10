/**
 * Browser-only no-op shim for Node's fs import inside generated Cornerstone
 * codec bundles. No filesystem operations are supported. The codecs' Node
 * runtime branch must remain unreachable in the browser.
 */
export {};
