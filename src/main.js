// Boot. Tap the bookmark once to open the view, tap it again (or Escape, or "Back to ...") to close it.
// __CSS__ is replaced with the contents of ui.css by build.py.

const existing = document.getElementById("hwb-overlay");
if (existing) {
  existing.shadowRoot.querySelector("#close").click();
} else {
  const adapters = [dprStudent];  // more school platforms can be added here
  const adapter = adapters.find(a => a.matches()) || (window.__HWB_TEST__ ? adapters[0] : null);
  createUI(adapter || adapters[0], __CSS__).open({ wrongSite: !adapter });
}
