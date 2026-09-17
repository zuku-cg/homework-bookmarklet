// Toolbar button: draw the homework view on the tab the user is looking at.
// Uses activeTab, so the extension can only touch a page at the moment the user clicks the button.
chrome.action.onClicked.addListener(async tab => {
  if (!tab.id) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["view.js"] });
  } catch {
    // Pages an extension can't draw on (a new tab, browser settings, the extension store): go to DPR instead.
    chrome.tabs.create({ url: "https://www.dpr.education/" });
  }
});
