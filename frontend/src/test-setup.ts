import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
// jsdom does not implement the native modal lifecycle.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  const wasOpen = this.hasAttribute("open");
  this.removeAttribute("open");
  if (wasOpen) this.dispatchEvent(new Event("close"));
};
afterEach(cleanup);
